import { createHash } from "node:crypto";
import type { CommercialProposedAction } from "../action-lifecycle";
import { sanitizeCommercialObject } from "../context/adapters";
import {
  COMMERCIAL_FOLLOW_UP_ACTIVE_OPPORTUNITY_STATUSES,
  COMMERCIAL_FOLLOW_UP_DEFAULT_DRAFTS,
  COMMERCIAL_FOLLOW_UP_MAX_ATTEMPT_NUMBER
} from "./constants";
import { validateFollowUpPlan } from "./validateFollowUpPlan";
import type {
  CommercialFollowUpApprovalRequirement,
  CommercialFollowUpBlockReason,
  CommercialFollowUpCancelReason,
  CommercialFollowUpChannel,
  CommercialFollowUpIntent,
  CommercialFollowUpLastDecision,
  CommercialFollowUpOpportunitySnapshot,
  CommercialFollowUpPlan,
  CommercialFollowUpPlanningInput,
  CommercialFollowUpPolicy,
  CommercialFollowUpRiskLevel
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function asIso(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizePolicy(policy: CommercialFollowUpPolicy): CommercialFollowUpPolicy {
  return {
    maxAttempts: Math.max(1, Math.floor(asNumber(policy.maxAttempts, 1))),
    cooldownHours: Math.max(0, asNumber(policy.cooldownHours, 0)),
    defaultDelayHours: Math.max(0, asNumber(policy.defaultDelayHours, 0)),
    requireOperatorReview: Boolean(policy.requireOperatorReview),
    allowLowRiskAutoApprovalPreview: Boolean(policy.allowLowRiskAutoApprovalPreview)
  };
}

function lowerText(value: unknown): string {
  const text = asText(value);
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function collectStrings(value: unknown, output: string[], seen: WeakSet<object>, depth = 0): void {
  if (value === null || value === undefined || output.length >= 200 || depth > 4) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) output.push(trimmed);
    return;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    output.push(String(value));
    return;
  }
  if (value instanceof Date) {
    output.push(Number.isNaN(value.getTime()) ? "invalid-date" : value.toISOString());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 40)) {
      collectStrings(item, output, seen, depth + 1);
      if (output.length >= 200) return;
    }
    return;
  }
  if (!isRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, nestedValue] of Object.entries(value)) {
    collectStrings(key, output, seen, depth + 1);
    collectStrings(nestedValue, output, seen, depth + 1);
    if (output.length >= 200) return;
  }
}

function buildSearchCorpus(...values: unknown[]): string {
  const collected: string[] = [];
  const seen = new WeakSet<object>();
  for (const value of values) {
    collectStrings(value, collected, seen);
  }
  const sanitized = sanitizeCommercialObject(collected.join(" | "));
  return lowerText(sanitized.value?.valueOf() ?? collected.join(" | "));
}

function hasCommercialOpportunityNeed(input: CommercialFollowUpPlanningInput): boolean {
  const opportunity = input.opportunity;
  if (!opportunity) return false;
  if ((COMMERCIAL_FOLLOW_UP_ACTIVE_OPPORTUNITY_STATUSES as readonly string[]).includes(String(opportunity.status ?? ""))) {
    return true;
  }
  if (asText(opportunity.primaryIntent) && lowerText(opportunity.primaryIntent) !== "unknown") return true;
  if (asText(opportunity.currentSummary)) return true;
  if (asText(opportunity.nextActionType)) return true;
  if (asText(opportunity.lastActivityAt) || asText(opportunity.lastCustomerMessageId) || asText(opportunity.lastAgentDecisionId)) return true;
  if (Array.isArray(opportunity.missingRequirements) && opportunity.missingRequirements.length > 0) return true;
  if (Array.isArray(opportunity.productInterests) && opportunity.productInterests.length > 0) return true;
  if (Array.isArray(opportunity.objections) && opportunity.objections.length > 0) return true;
  if (Array.isArray(opportunity.signals) && opportunity.signals.length > 0) return true;
  return false;
}

function hasMissingInformationSignal(input: CommercialFollowUpPlanningInput): boolean {
  const opportunity = input.opportunity;
  const corpus = buildSearchCorpus(
    opportunity?.missingRequirements,
    opportunity?.nextActionType,
    opportunity?.currentSummary,
    opportunity?.signals,
    input.caseContext?.department,
    input.conversation.lastInboundText,
    input.lastDecision?.nextActionJson
  );

  if (corpus.includes("falta") || corpus.includes("faltan") || corpus.includes("dato") || corpus.includes("detalle") || corpus.includes("clarify") || corpus.includes("need more")) {
    return true;
  }

  if (opportunity?.nextActionType && ["ask_clarifying_question", "request_more_context"].includes(String(opportunity.nextActionType))) {
    return true;
  }

  return Boolean(
    opportunity &&
      (Array.isArray(opportunity.missingRequirements)
        ? opportunity.missingRequirements.length > 0
        : Boolean(opportunity.missingRequirements))
  );
}

function isCaseClosed(caseContext: CommercialFollowUpPlanningInput["caseContext"]): boolean {
  if (!caseContext) return false;
  if (asIso(caseContext.closedAt)) return true;
  const status = lowerText(caseContext.status);
  const lifecycleStatus = lowerText(caseContext.lifecycleStatus);
  return [status, lifecycleStatus].some((value) => /closed|resolved|done|cancelled|canceled|archived|won|lost|finished/.test(value));
}

function isOpportunityClosed(opportunity: CommercialFollowUpOpportunitySnapshot | null): boolean {
  if (!opportunity) return false;
  if (asIso(opportunity.closedAt)) return true;
  const status = lowerText(opportunity.status);
  return ["won", "lost", "cancelled", "canceled", "archived"].includes(status);
}

function isCustomerReplyAfterAgent(conversation: CommercialFollowUpPlanningInput["conversation"]): boolean {
  const customer = asIso(conversation.lastCustomerMessageAt);
  const agent = asIso(conversation.lastAgentMessageAt);
  if (!customer || !agent) return false;
  return new Date(customer).getTime() > new Date(agent).getTime();
}

function isExpiredSignal(lastDecision: CommercialFollowUpLastDecision | null): boolean {
  if (!lastDecision) return false;
  if (lowerText(lastDecision.decisionStatus) === "expired") return true;
  if (isRecord(lastDecision.nextActionJson)) {
    const nextAction = lastDecision.nextActionJson;
    const status = lowerText(nextAction.status ?? nextAction.planStatus ?? nextAction.lifecycleStatus);
    if (status === "expired") return true;
    if (nextAction.expired === true) return true;
  }
  return false;
}

function isHighRiskIntent(input: CommercialFollowUpPlanningInput): CommercialFollowUpBlockReason | null {
  const corpus = buildSearchCorpus(
    input.opportunity?.primaryIntent,
    input.opportunity?.currentSummary,
    input.opportunity?.missingRequirements,
    input.opportunity?.productInterests,
    input.opportunity?.objections,
    input.opportunity?.signals,
    input.opportunity?.nextActionType,
    input.caseContext?.department,
    input.conversation.lastInboundText,
    input.conversation.lastOutboundText,
    input.lastDecision?.nextActionJson,
    input.lastDecision?.decisionStatus
  );

  if (["complaint", "warranty", "return", "exchange", "refund", "devolucion", "reclamo", "garantia"].some((token) => corpus.includes(token))) {
    return "complaint_or_warranty";
  }
  if (["legal", "angry_customer", "human_request"].some((token) => corpus.includes(token))) {
    return "high_risk_intent";
  }
  return null;
}

function inferFollowUpIntent(input: CommercialFollowUpPlanningInput): CommercialFollowUpIntent {
  const opportunity = input.opportunity;
  const corpus = buildSearchCorpus(
    opportunity?.primaryIntent,
    opportunity?.currentSummary,
    opportunity?.missingRequirements,
    opportunity?.productInterests,
    opportunity?.objections,
    opportunity?.signals,
    opportunity?.nextActionType,
    input.caseContext?.department,
    input.conversation.lastInboundText,
    input.conversation.lastOutboundText,
    input.lastDecision?.nextActionJson
  );

  if (hasMissingInformationSignal(input)) return "missing_information_followup";
  if (corpus.includes("quote") || corpus.includes("cotiz") || corpus.includes("quotation")) return "quote_followup";
  if (corpus.includes("payment") || corpus.includes("checkout") || corpus.includes("pago") || corpus.includes("cobro")) return "payment_or_checkout_followup";
  if (corpus.includes("stock") || corpus.includes("availability") || corpus.includes("disponibilidad") || corpus.includes("despacho") || corpus.includes("entrega")) {
    return "availability_followup";
  }
  if (corpus.includes("postventa") || corpus.includes("handoff") || corpus.includes("maintenance") || corpus.includes("mantenimiento") || corpus.includes("assembly") || corpus.includes("ensambl")) {
    return "post_handoff_followup";
  }
  if (corpus.includes("reactiv") || corpus.includes("retomar") || corpus.includes("volver a contactar")) return "reactivation_followup";

  const primaryIntent = lowerText(opportunity?.primaryIntent);
  if (["quote_request", "price_request", "bulk_purchase", "equipment_project", "discount_request"].includes(primaryIntent)) {
    return "quote_followup";
  }
  if (["stock_request", "delivery_request"].includes(primaryIntent)) {
    return "availability_followup";
  }
  if (["maintenance_request", "assembly_request", "post_sale_request"].includes(primaryIntent)) {
    return "post_handoff_followup";
  }
  if (["product_inquiry", "product_recommendation", "general_information", "unknown"].includes(primaryIntent)) {
    return "product_interest_followup";
  }

  return "product_interest_followup";
}

function extractPriorAttemptCount(lastDecision: CommercialFollowUpLastDecision | null): number {
  if (!lastDecision || !lastDecision.nextActionJson || !isRecord(lastDecision.nextActionJson)) return 0;
  const value = lastDecision.nextActionJson;
  const directCandidates = [value.attemptNumber, value.attemptCount, value.attemptsCount];
  for (const candidate of directCandidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0) return candidate;
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number(candidate);
      if (Number.isInteger(parsed) && parsed >= 0) return parsed;
    }
  }
  if (Array.isArray(value.attempts)) return value.attempts.length;
  return 0;
}

function deriveRiskLevel(intent: CommercialFollowUpIntent, corpus: string): CommercialFollowUpRiskLevel {
  if (corpus.includes("legal")) return "critical";
  if (intent === "payment_or_checkout_followup") return "high";
  if (intent === "quote_followup" || intent === "post_handoff_followup" || intent === "missing_information_followup") return "medium";
  if (intent === "no_followup") return "unknown";
  return "low";
}

function deriveApprovalRequirement(
  intent: CommercialFollowUpIntent,
  riskLevel: CommercialFollowUpRiskLevel,
  policy: CommercialFollowUpPlanningInput["policy"]
): CommercialFollowUpApprovalRequirement {
  if (riskLevel === "critical") return "blocked";
  if (intent === "payment_or_checkout_followup") return "manager_review";
  if (intent === "quote_followup" || intent === "post_handoff_followup") return policy.requireOperatorReview ? "operator_review" : "operator_review";
  if (policy.requireOperatorReview) return "operator_review";
  if (riskLevel === "high") return "manager_review";
  return "none";
}

function buildDraftMessage(intent: CommercialFollowUpIntent): string | null {
  if (intent === "no_followup") return null;
  return COMMERCIAL_FOLLOW_UP_DEFAULT_DRAFTS[intent];
}

function plusHours(iso: string, hours: number): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Date(parsed.getTime() + Math.max(0, hours) * 60 * 60 * 1000).toISOString();
}

function buildPolicyNotes(input: {
  intent: CommercialFollowUpIntent;
  status: string;
  policy: CommercialFollowUpPlanningInput["policy"];
  reason: string;
  scheduledFor: string | null;
}) {
  const notes = [
    `follow_up_status=${input.status}`,
    `follow_up_intent=${input.intent}`,
    `cooldown_hours=${input.policy.cooldownHours}`,
    `default_delay_hours=${input.policy.defaultDelayHours}`,
    `max_attempts=${input.policy.maxAttempts}`,
    `operator_review=${input.policy.requireOperatorReview ? "required" : "optional"}`,
    "no_outbox",
    "no_execution",
    "no_scheduler",
    `reason=${input.reason}`
  ];
  if (input.scheduledFor) {
    notes.push(`scheduled_for=${input.scheduledFor}`);
  }
  return [...new Set(notes)].slice(0, 12);
}

// Deliberately excludes scheduledFor (and any other now/createdAt-derived
// value): scheduledFor = plusHours(createdAt, defaultDelayHours), so it
// drifts on every call even when the logical plan (opportunity/intent/
// attemptNumber/status/policy) did not change. Including it here would make
// planId/idempotencyKey unstable across two calls at different wall-clock
// moments for what is otherwise the exact same retry - the caller-facing
// identity of a plan must depend only on its commercial content, never on
// when it happened to be computed.
function buildSignature(input: {
  status: string;
  intent: string;
  channel: string;
  recipient: string | null;
  reasonCode: string;
  attemptNumber: number;
  maxAttempts: number;
  opportunityId: string | null;
  decisionId: string | null;
  caseId: string | null;
  messageId: string | null;
  policy: CommercialFollowUpPlanningInput["policy"];
}) {
  return JSON.stringify({
    status: input.status,
    intent: input.intent,
    channel: input.channel,
    recipient: input.recipient,
    reasonCode: input.reasonCode,
    attemptNumber: input.attemptNumber,
    maxAttempts: input.maxAttempts,
    opportunityId: input.opportunityId,
    decisionId: input.decisionId,
    caseId: input.caseId,
    messageId: input.messageId,
    policy: {
      maxAttempts: input.policy.maxAttempts,
      cooldownHours: input.policy.cooldownHours,
      defaultDelayHours: input.policy.defaultDelayHours,
      requireOperatorReview: input.policy.requireOperatorReview,
      allowLowRiskAutoApprovalPreview: input.policy.allowLowRiskAutoApprovalPreview
    }
  });
}

function finalizePlan(plan: CommercialFollowUpPlan, policy: CommercialFollowUpPlanningInput["policy"]): CommercialFollowUpPlan {
  const signature = buildSignature({
    status: plan.status,
    intent: plan.intent,
    channel: plan.channel,
    recipient: plan.recipient,
    reasonCode: plan.rationale,
    attemptNumber: plan.attemptNumber,
    maxAttempts: plan.maxAttempts,
    opportunityId: plan.opportunityId,
    decisionId: plan.decisionId,
    caseId: plan.caseId,
    messageId: plan.messageId,
    policy
  });

  const digest = createHash("sha256").update(signature).digest("hex");
  const validated = validateFollowUpPlan({
    ...plan,
    planId: `followup-plan-${digest.slice(0, 24)}`,
    idempotencyKey: `commercial-followup:${digest}`
  });

  return validated.value ?? buildInvalidPlan(plan, validated.reason);
}

function buildInvalidPlan(input: CommercialFollowUpPlanningInput | CommercialFollowUpPlan, reason: string): CommercialFollowUpPlan {
  if ("now" in input) {
    return {
      planId: `followup-plan-invalid-${createHash("sha256").update(reason).digest("hex").slice(0, 16)}`,
      opportunityId: input.opportunity?.id ?? null,
      decisionId: input.lastDecision?.decisionId ?? input.opportunity?.lastAgentDecisionId ?? null,
      caseId: input.caseContext?.caseId ?? null,
      messageId: input.opportunity?.lastCustomerMessageId ?? null,
      status: "invalid",
      intent: "no_followup",
      channel: input.conversation.channel,
      recipient: input.conversation.channel === "whatsapp" ? input.conversation.waId : null,
      scheduledFor: null,
      timezone: input.timezone.trim() || "UTC",
      draftMessage: null,
      riskLevel: "unknown",
      approvalRequirement: "blocked",
      blockReasons: ["unsafe_message"],
      cancelReason: null,
      rationale: reason,
      policyNotes: ["input_invalid", "no_execution", "no_outbox", "no_scheduler"],
      attemptNumber: 0,
      maxAttempts: Math.max(1, Math.floor(input.policy.maxAttempts || 1)),
      idempotencyKey: `commercial-followup-invalid-${createHash("sha256").update(reason).digest("hex").slice(0, 16)}`,
      executable: false,
      persisted: false,
      createdAt: asIso(input.now) ?? new Date(0).toISOString()
    };
  }

  return {
    planId: `followup-plan-invalid-${createHash("sha256").update(reason).digest("hex").slice(0, 16)}`,
    opportunityId: input.opportunityId,
    decisionId: input.decisionId,
    caseId: input.caseId,
    messageId: input.messageId,
    status: "invalid",
    intent: "no_followup",
    channel: input.channel,
    recipient: input.recipient,
    scheduledFor: null,
    timezone: input.timezone,
    draftMessage: null,
    riskLevel: "unknown",
    approvalRequirement: "blocked",
    blockReasons: ["unsafe_message"],
    cancelReason: null,
    rationale: reason,
    policyNotes: ["input_invalid", "no_execution", "no_outbox", "no_scheduler"],
    attemptNumber: 0,
    maxAttempts: input.maxAttempts,
    idempotencyKey: `commercial-followup-invalid-${createHash("sha256").update(reason).digest("hex").slice(0, 16)}`,
    executable: false,
    persisted: false,
    createdAt: input.createdAt
  };
}

function buildBlockedPlan(input: {
  planInput: CommercialFollowUpPlanningInput;
  status: "blocked" | "cancelled" | "expired";
  intent: CommercialFollowUpIntent;
  channel: CommercialFollowUpChannel;
  recipient: string | null;
  scheduledFor: string | null;
  riskLevel: CommercialFollowUpRiskLevel;
  approvalRequirement: CommercialFollowUpApprovalRequirement;
  blockReasons: CommercialFollowUpBlockReason[];
  cancelReason: CommercialFollowUpCancelReason | null;
  rationale: string;
  attemptNumber: number;
  createdAt: string;
  messageId: string | null;
  decisionId: string | null;
  opportunityId: string | null;
  caseId: string | null;
  maxAttempts: number;
  timezone: string;
  policyNotesReason: string;
}): CommercialFollowUpPlan {
  const plan: CommercialFollowUpPlan = {
    planId: "",
    opportunityId: input.opportunityId,
    decisionId: input.decisionId,
    caseId: input.caseId,
    messageId: input.messageId,
    status: input.status,
    intent: input.intent,
    channel: input.channel,
    recipient: input.recipient,
    scheduledFor: input.scheduledFor,
    timezone: input.timezone,
    draftMessage: null,
    riskLevel: input.riskLevel,
    approvalRequirement: input.approvalRequirement,
    blockReasons: [...input.blockReasons],
    cancelReason: input.cancelReason,
    rationale: input.rationale,
    policyNotes: buildPolicyNotes({
      intent: input.intent,
      status: input.status,
      policy: input.planInput.policy,
      reason: input.policyNotesReason,
      scheduledFor: input.scheduledFor
    }),
    attemptNumber: input.attemptNumber,
    maxAttempts: input.maxAttempts,
    idempotencyKey: "",
    executable: false,
    persisted: false,
    createdAt: input.createdAt
  };

  return finalizePlan(plan, input.planInput.policy);
}

export function planCommercialFollowUp(input: CommercialFollowUpPlanningInput): CommercialFollowUpPlan {
  const normalizedPolicy = normalizePolicy(input.policy);
  const createdAt = asIso(input.now);
  const timezone = input.timezone.trim();

  if (!createdAt || !timezone) {
    return buildInvalidPlan(input, "Invalid follow-up planning input.");
  }

  const opportunity = input.opportunity;
  const caseContext = input.caseContext;
  const conversation = input.conversation;
  const lastDecision = input.lastDecision;

  const opportunityId = opportunity?.id ?? null;
  const decisionId = lastDecision?.decisionId ?? opportunity?.lastAgentDecisionId ?? null;
  const caseId = caseContext?.caseId ?? null;
  const messageId = opportunity?.lastCustomerMessageId ?? null;
  const channel = conversation.channel;
  const recipient = channel === "whatsapp" ? conversation.waId : null;

  if (isCaseClosed(caseContext)) {
    return buildBlockedPlan({
      planInput: { ...input, policy: normalizedPolicy },
      status: "blocked",
      intent: "no_followup",
      channel,
      recipient,
      scheduledFor: null,
      riskLevel: "high",
      approvalRequirement: "blocked",
      blockReasons: ["case_closed"],
      cancelReason: null,
      rationale: "Follow-up blocked because the case is closed.",
      attemptNumber: 0,
      createdAt,
      messageId,
      decisionId,
      opportunityId,
      caseId,
      maxAttempts: normalizedPolicy.maxAttempts,
      timezone,
      policyNotesReason: "case_closed"
    });
  }

  if (!opportunity || !hasCommercialOpportunityNeed(input)) {
    const plan: CommercialFollowUpPlan = {
      planId: "",
      opportunityId,
      decisionId,
      caseId,
      messageId,
      status: "not_needed",
      intent: "no_followup",
      channel,
      recipient,
      scheduledFor: null,
      timezone,
      draftMessage: null,
      riskLevel: "unknown",
      approvalRequirement: "none",
      blockReasons: ["no_commercial_opportunity"],
      cancelReason: null,
      rationale: "No commercial opportunity or follow-up need was detected.",
      policyNotes: buildPolicyNotes({
        intent: "no_followup",
        status: "not_needed",
        policy: normalizedPolicy,
        reason: "no_commercial_opportunity",
        scheduledFor: null
      }),
      attemptNumber: 0,
      maxAttempts: normalizedPolicy.maxAttempts,
      idempotencyKey: "",
      executable: false,
      persisted: false,
      createdAt
    };
    return finalizePlan(plan, normalizedPolicy);
  }

  if (isOpportunityClosed(opportunity)) {
    return buildBlockedPlan({
      planInput: { ...input, policy: normalizedPolicy },
      status: "blocked",
      intent: "no_followup",
      channel,
      recipient,
      scheduledFor: null,
      riskLevel: "medium",
      approvalRequirement: "blocked",
      blockReasons: ["no_commercial_opportunity"],
      cancelReason: "opportunity_closed",
      rationale: "Follow-up blocked because the opportunity is terminal or closed.",
      attemptNumber: 0,
      createdAt,
      messageId,
      decisionId,
      opportunityId,
      caseId,
      maxAttempts: normalizedPolicy.maxAttempts,
      timezone,
      policyNotesReason: "opportunity_closed"
    });
  }

  if (opportunity.aiBlocked || opportunity.humanOwnerActive || caseContext?.requiresHuman === true) {
    const status = normalizedPolicy.requireOperatorReview ? "requires_operator_review" : "blocked";
    const approvalRequirement: CommercialFollowUpApprovalRequirement = normalizedPolicy.requireOperatorReview ? "operator_review" : "blocked";
    const scheduledFor = status === "requires_operator_review" ? plusHours(createdAt, normalizedPolicy.defaultDelayHours) : null;
    const blockReasons: CommercialFollowUpBlockReason[] = opportunity.aiBlocked ? ["ai_blocked"] : ["human_owner_active"];
    const plan: CommercialFollowUpPlan = {
      planId: "",
      opportunityId,
      decisionId,
      caseId,
      messageId,
      status,
      intent: "no_followup",
      channel,
      recipient,
      scheduledFor,
      timezone,
      draftMessage: null,
      riskLevel: opportunity.aiBlocked ? "high" : "medium",
      approvalRequirement,
      blockReasons,
      cancelReason: null,
      rationale: opportunity.aiBlocked
        ? "Follow-up blocked because AI is blocked for this opportunity."
        : "Follow-up requires human ownership review before it can proceed.",
      policyNotes: buildPolicyNotes({
        intent: "no_followup",
        status,
        policy: normalizedPolicy,
        reason: blockReasons[0],
        scheduledFor
      }),
      attemptNumber: 0,
      maxAttempts: normalizedPolicy.maxAttempts,
      idempotencyKey: "",
      executable: false,
      persisted: false,
      createdAt
    };
    const planWithNotes = {
      ...plan,
      policyNotes: buildPolicyNotes({
        intent: "no_followup",
        status,
        policy: normalizedPolicy,
        reason: blockReasons[0],
        scheduledFor
      })
    } as CommercialFollowUpPlan;
    return finalizePlan(planWithNotes, normalizedPolicy);
  }

  if (isCustomerReplyAfterAgent(conversation)) {
    return buildBlockedPlan({
      planInput: { ...input, policy: normalizedPolicy },
      status: "cancelled",
      intent: "no_followup",
      channel,
      recipient,
      scheduledFor: null,
      riskLevel: "unknown",
      approvalRequirement: "blocked",
      blockReasons: ["customer_replied_after_last_agent_message"],
      cancelReason: "customer_replied",
      rationale: "Follow-up cancelled because the customer replied after the last agent message.",
      attemptNumber: 0,
      createdAt,
      messageId,
      decisionId,
      opportunityId,
      caseId,
      maxAttempts: normalizedPolicy.maxAttempts,
      timezone,
      policyNotesReason: "customer_replied"
    });
  }

  if (isExpiredSignal(lastDecision)) {
    return buildBlockedPlan({
      planInput: { ...input, policy: normalizedPolicy },
      status: "expired",
      intent: "no_followup",
      channel,
      recipient,
      scheduledFor: null,
      riskLevel: "unknown",
      approvalRequirement: "blocked",
      blockReasons: ["outside_policy_window"],
      cancelReason: "expired",
      rationale: "Follow-up expired and should be reevaluated by the operational loop.",
      attemptNumber: 0,
      createdAt,
      messageId,
      decisionId,
      opportunityId,
      caseId,
      maxAttempts: normalizedPolicy.maxAttempts,
      timezone,
      policyNotesReason: "expired"
    });
  }

  if (channel === "unknown") {
    return buildBlockedPlan({
      planInput: { ...input, policy: normalizedPolicy },
      status: "blocked",
      intent: "no_followup",
      channel,
      recipient,
      scheduledFor: null,
      riskLevel: "unknown",
      approvalRequirement: "blocked",
      blockReasons: ["missing_channel"],
      cancelReason: null,
      rationale: "Follow-up blocked because the channel is missing or unsupported.",
      attemptNumber: 0,
      createdAt,
      messageId,
      decisionId,
      opportunityId,
      caseId,
      maxAttempts: normalizedPolicy.maxAttempts,
      timezone,
      policyNotesReason: "missing_channel"
    });
  }

  if (channel === "whatsapp" && !conversation.waId) {
    return buildBlockedPlan({
      planInput: { ...input, policy: normalizedPolicy },
      status: "blocked",
      intent: "no_followup",
      channel,
      recipient: null,
      scheduledFor: null,
      riskLevel: "high",
      approvalRequirement: "blocked",
      blockReasons: ["missing_customer_identity"],
      cancelReason: null,
      rationale: "Follow-up blocked because WhatsApp recipient identity is missing.",
      attemptNumber: 0,
      createdAt,
      messageId,
      decisionId,
      opportunityId,
      caseId,
      maxAttempts: normalizedPolicy.maxAttempts,
      timezone,
      policyNotesReason: "missing_customer_identity"
    });
  }

  const highRiskReason = isHighRiskIntent(input);
  if (highRiskReason) {
    const riskLevel: CommercialFollowUpRiskLevel = highRiskReason === "complaint_or_warranty" ? "critical" : "high";
    return buildBlockedPlan({
      planInput: { ...input, policy: normalizedPolicy },
      status: "blocked",
      intent: "no_followup",
      channel,
      recipient,
      scheduledFor: null,
      riskLevel,
      approvalRequirement: "blocked",
      blockReasons: [highRiskReason],
      cancelReason: null,
      rationale: "Follow-up blocked because the conversation contains a high-risk commercial or support signal.",
      attemptNumber: 0,
      createdAt,
      messageId,
      decisionId,
      opportunityId,
      caseId,
      maxAttempts: normalizedPolicy.maxAttempts,
      timezone,
      policyNotesReason: highRiskReason
    });
  }

  const lastAgentAt = asIso(conversation.lastAgentMessageAt) ?? asIso(lastDecision?.createdAt) ?? asIso(opportunity?.lastActivityAt);
  const cooldownActive = Boolean(
    lastAgentAt &&
      normalizedPolicy.cooldownHours > 0 &&
      new Date(createdAt).getTime() - new Date(lastAgentAt).getTime() < normalizedPolicy.cooldownHours * 60 * 60 * 1000
  );
  if (cooldownActive) {
    const scheduledFor = lastAgentAt ? plusHours(lastAgentAt, normalizedPolicy.cooldownHours) : null;
    return buildBlockedPlan({
      planInput: { ...input, policy: normalizedPolicy },
      status: "blocked",
      intent: "no_followup",
      channel,
      recipient,
      scheduledFor,
      riskLevel: "medium",
      approvalRequirement: "blocked",
      blockReasons: ["cooldown_active"],
      cancelReason: null,
      rationale: "Follow-up blocked because the cooldown window is still active.",
      attemptNumber: 0,
      createdAt,
      messageId,
      decisionId,
      opportunityId,
      caseId,
      maxAttempts: normalizedPolicy.maxAttempts,
      timezone,
      policyNotesReason: "cooldown_active"
    });
  }

  const intent = inferFollowUpIntent(input);
  if (intent === "no_followup") {
    const plan: CommercialFollowUpPlan = {
      planId: "",
      opportunityId,
      decisionId,
      caseId,
      messageId,
      status: "not_needed",
      intent,
      channel,
      recipient,
      scheduledFor: null,
      timezone,
      draftMessage: null,
      riskLevel: "unknown",
      approvalRequirement: "none",
      blockReasons: ["no_commercial_opportunity"],
      cancelReason: null,
      rationale: "No follow-up is needed after evaluating the commercial context.",
      policyNotes: buildPolicyNotes({
        intent,
        status: "not_needed",
        policy: normalizedPolicy,
        reason: "no_commercial_opportunity",
        scheduledFor: null
      }),
      attemptNumber: 0,
      maxAttempts: normalizedPolicy.maxAttempts,
      idempotencyKey: "",
      executable: false,
      persisted: false,
      createdAt
    };
    return finalizePlan(plan, normalizedPolicy);
  }

  const priorAttempts = extractPriorAttemptCount(lastDecision);
  const attemptNumber = Math.min(COMMERCIAL_FOLLOW_UP_MAX_ATTEMPT_NUMBER, priorAttempts + 1);
  if (attemptNumber > normalizedPolicy.maxAttempts) {
    return buildBlockedPlan({
      planInput: { ...input, policy: normalizedPolicy },
      status: "blocked",
      intent,
      channel,
      recipient,
      scheduledFor: null,
      riskLevel: intent === "payment_or_checkout_followup" ? "high" : "medium",
      approvalRequirement: "blocked",
      blockReasons: ["max_attempts_reached"],
      cancelReason: null,
      rationale: "Follow-up blocked because the maximum number of attempts was reached.",
      attemptNumber,
      createdAt,
      messageId,
      decisionId,
      opportunityId,
      caseId,
      maxAttempts: normalizedPolicy.maxAttempts,
      timezone,
      policyNotesReason: "max_attempts_reached"
    });
  }

  const corpus = buildSearchCorpus(
    input.opportunity?.primaryIntent,
    input.opportunity?.currentSummary,
    input.opportunity?.missingRequirements,
    input.opportunity?.productInterests,
    input.opportunity?.objections,
    input.opportunity?.signals,
    input.opportunity?.nextActionType,
    input.caseContext?.department,
    input.conversation.lastInboundText,
    input.conversation.lastOutboundText,
    input.lastDecision?.nextActionJson
  );
  const riskLevel = deriveRiskLevel(intent, corpus);
  const approvalRequirement = deriveApprovalRequirement(intent, riskLevel, normalizedPolicy);
  const status: CommercialFollowUpPlan["status"] =
    approvalRequirement === "blocked"
      ? "blocked"
      : approvalRequirement === "none" && !normalizedPolicy.requireOperatorReview
        ? "recommended"
        : "requires_operator_review";
  const scheduledFor = plusHours(createdAt, normalizedPolicy.defaultDelayHours);
  const effectiveScheduledFor = status === "blocked" ? null : scheduledFor;
  const draftMessage = status === "blocked" ? null : buildDraftMessage(intent);
  const rationale =
    status === "recommended"
      ? `Follow-up recommended for ${intent.replace(/_/g, " ")} based on the current commercial state.`
      : `Follow-up requires review for ${intent.replace(/_/g, " ")} based on the current commercial state.`;
  const plan: CommercialFollowUpPlan = {
    planId: "",
    opportunityId,
    decisionId,
    caseId,
    messageId,
    status,
    intent,
    channel,
    recipient,
    scheduledFor: effectiveScheduledFor,
    timezone,
    draftMessage: draftMessage ? draftMessage.slice(0, 320) : null,
    riskLevel,
    approvalRequirement,
    blockReasons: [],
    cancelReason: null,
    rationale,
    policyNotes: buildPolicyNotes({
      intent,
      status,
      policy: normalizedPolicy,
      reason: rationale,
      scheduledFor: effectiveScheduledFor
    }),
    attemptNumber,
    maxAttempts: normalizedPolicy.maxAttempts,
    idempotencyKey: "",
    executable: false,
    persisted: false,
    createdAt
  };
  return finalizePlan(plan, normalizedPolicy);
}

export function toProposedActionPreview(plan: CommercialFollowUpPlan): CommercialProposedAction {
  const statusMap: Record<CommercialFollowUpPlan["status"], CommercialProposedAction["status"]> = {
    not_needed: "blocked",
    recommended: "proposed",
    requires_operator_review: "requires_review",
    blocked: "blocked",
    cancelled: "cancelled",
    expired: "expired",
    invalid: "blocked"
  };

  return {
    actionId: `action-${plan.planId}`,
    decisionId: plan.decisionId,
    opportunityId: plan.opportunityId,
    caseId: plan.caseId,
    messageId: plan.messageId,
    type: "schedule_followup",
    status: statusMap[plan.status],
    channel: plan.channel,
    riskLevel: plan.riskLevel,
    approvalRequirement: plan.approvalRequirement,
    draftPayload: plan,
    finalPayload: null,
    reason: plan.rationale,
    blockedReasons: [...plan.blockReasons],
    idempotencyKey: plan.idempotencyKey,
    executable: false,
    createdAt: plan.createdAt,
    updatedAt: null
  };
}
