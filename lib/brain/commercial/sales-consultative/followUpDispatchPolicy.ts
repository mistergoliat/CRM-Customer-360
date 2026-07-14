import { safeQueryRows } from "@/lib/db";
import {
  COMMERCIAL_POLICY_CONTRACT_VERSION,
  COMMERCIAL_POLICY_VERSION,
  evaluateCommercialPolicy
} from "../policy";
import type { CommercialPolicyApprovalRequirement, CommercialPolicyChannelContext, CommercialPolicyFeatureFlags, CommercialPolicyRiskLevel } from "../policy";
import type { SalesAgentResult } from "../sales-agent/validationTypes";
import { FOLLOW_UP_TIMEZONE } from "./followUpPlanAdapter";

// ACS-R1-05-T02. Contract: docs/product/follow-up-decision-policy.md,
// docs/releases/ACS-R1-05-autonomous-follow-up-runtime.md (T02 DoD).
//
// This module is the follow_up_dispatch_policy gate: it wires the real,
// already-migrated signal sources (conversation.ai_enabled/human_owner_active,
// crm_customer_onboarding_state.status, crm_opportunities.signals_json, and an
// explicit currentTime/timezone) into policy/evaluateCommercialPolicy.ts as a
// pure channel-level gate - never a copy of its blocking rules, never a call
// into runCommercialShadowEvaluation, never gated by a flag named "shadow".
//
// Deliberately does NOT propose any claims/actions/toolRequests/entityProposals
// - evaluateCommercialPolicy's channel-context gate (opt-out/quiet-hours/
// identity-conflict/ai-blocked -> blocked; human-owner/quiet-hours -> review)
// is independent of those arrays, so an intentionally empty SalesAgentResult
// exercises exactly the "pure boundary" the task allows, without duplicating
// its internal logic here.

export type FollowUpDispatchDecision = "allow" | "require_review" | "deny" | "failed_safe";

export type FollowUpDispatchPolicyResult = {
  decision: FollowUpDispatchDecision;
  policyStatus: "allowed" | "allowed_with_restrictions" | "requires_review" | "blocked" | "failed_safe";
  overallDecision: string;
  requiresApproval: CommercialPolicyApprovalRequirement;
  riskLevel: CommercialPolicyRiskLevel;
  reasonCodes: string[];
  policyNotes: string[];
};

export type FollowUpDispatchChannelSignals = CommercialPolicyChannelContext;

// Quiet hours window is a T02 default (no prior canonical value exists -
// docs/product/follow-up-decision-policy.md leaves the window "configurable
// by context", not universally fixed). Local time in FOLLOW_UP_TIMEZONE.
export const FOLLOW_UP_QUIET_HOURS_START_HOUR = 21;
export const FOLLOW_UP_QUIET_HOURS_END_HOUR = 9;

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function toNumericId(value: number | string | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Explicit time + explicit timezone, never the server's implicit local time
 * (task section 6, rules 4-5). An unparseable currentTime fails closed
 * (treated as inside quiet hours) rather than silently allowing dispatch.
 */
export function computeQuietHoursActive(currentTime: string, timezone: string = FOLLOW_UP_TIMEZONE): boolean {
  const date = new Date(currentTime);
  if (Number.isNaN(date.getTime())) return true;

  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false
  }).format(date);
  const hour = Number(formatted) % 24;
  if (!Number.isFinite(hour)) return true;

  return hour >= FOLLOW_UP_QUIET_HOURS_START_HOUR || hour < FOLLOW_UP_QUIET_HOURS_END_HOUR;
}

type ConversationChannelRow = {
  status: string;
  ai_enabled: number;
  human_owner_active: number;
  onboarding_status: string | null;
};

function baseChannelSignals(input: { optOut: boolean; quietHoursActive: boolean }): FollowUpDispatchChannelSignals {
  return {
    channel: "whatsapp",
    available: true,
    outboundAllowed: true,
    manualApprovalRequired: false,
    optOut: input.optOut,
    quietHoursActive: input.quietHoursActive,
    humanOwnerActive: false,
    aiBlocked: false,
    identityConflict: false,
    recentCustomerReply: false,
    recentHumanContact: false
  };
}

/**
 * Loads the real, structured signal sources for the follow-up dispatch gate:
 *
 * - optOut: crm_opportunities.signals_json (structured array already loaded
 *   on the opportunity, never the free-text of the last message - task
 *   section 6, rule 1). No upstream writer populates an "opt_out" entry yet
 *   (there is no opt-out capture channel/table in this repo today, and T02
 *   must not add a new Customer Preference domain - task section 6, rule 7),
 *   so this evaluates false in practice until such a writer exists; the gate
 *   itself is real and wired, not a hardcoded constant.
 * - quietHoursActive: explicit currentTime + FOLLOW_UP_TIMEZONE (never the
 *   server's local timezone - rules 4-5).
 * - humanOwnerActive / aiBlocked: conversation.human_owner_active /
 *   conversation.ai_enabled (migration 010/008) - the same columns
 *   updateOpportunityHandoffState (native-whatsapp/service.ts) reliably
 *   writes, unlike crm_opportunities.human_owner_active/ai_blocked (that
 *   write path re-persists the pre-turn value - see release notes for the
 *   full explanation - so it is not the reliable signal). Sourced as two
 *   independent booleans, not combined: evaluateCommercialPolicy already
 *   gives aiBlocked a stronger severity (part of the hard channel block)
 *   than humanOwnerActive alone (review-only) - collapsing them here would
 *   make "human owner active but AI not explicitly disabled" unreachable as
 *   a review-only outcome.
 * - identityConflict: crm_customer_onboarding_state.status = 'conflict'
 *   (migration 023, ACS-R1-04's real native identity resolution state),
 *   never the legacy resolver_identity.identity_type used by the shadow
 *   runtime.
 * - conversation status ('open'/other): feeds available/outboundAllowed.
 *
 * A conversationId that does not resolve to any conversation row (never
 * enforced as a foreign key on crm_agent_actions.conversation_case_id) is not
 * a technical failure - it degrades to "no additional signal" (task section
 * 10 precedent: a safe fallback without full context is an existing,
 * preserved invariant). Only a real query failure (connection error, missing
 * table) fails closed.
 */
export async function loadFollowUpDispatchChannelSignals(input: {
  conversationId: number | string | null;
  opportunitySignals: readonly string[];
  currentTime: string;
  timezone?: string;
}): Promise<{ ok: true; signals: FollowUpDispatchChannelSignals } | { ok: false; warning: string }> {
  const timezone = input.timezone ?? FOLLOW_UP_TIMEZONE;
  const quietHoursActive = computeQuietHoursActive(input.currentTime, timezone);
  const optOut = input.opportunitySignals.includes("opt_out");
  const fallbackSignals = baseChannelSignals({ optOut, quietHoursActive });

  const conversationId = toNumericId(input.conversationId);
  if (conversationId === null) {
    return { ok: true, signals: fallbackSignals };
  }

  const result = await safeQueryRows<ConversationChannelRow>(
    `
      SELECT c.status AS status, c.ai_enabled AS ai_enabled, c.human_owner_active AS human_owner_active,
             o.status AS onboarding_status
      FROM conversation c
      LEFT JOIN crm_customer_onboarding_state o ON o.conversation_id = c.id
      WHERE c.id = ?
      LIMIT 1
    `,
    [conversationId]
  );
  if (!result.ok) {
    return { ok: false, warning: result.error };
  }

  const row = result.rows[0];
  if (!row) {
    return { ok: true, signals: fallbackSignals };
  }

  // Deliberately independent signals, not the combined "aiBlocked ||
  // humanOwnerActive" formula native-whatsapp/service.ts uses for its own
  // (different) autonomous-reply decision. evaluateCommercialPolicy already
  // encodes the severity difference itself (computeChannelSignals:
  // aiBlocked is part of the hard channelBlock; humanOwnerActive alone is
  // only channelReview) - collapsing them here would make "human owner
  // active but AI not explicitly disabled" unreachable as a review-only
  // outcome and always deny instead.
  const humanOwnerActive = Boolean(Number(row.human_owner_active));
  const aiBlocked = !Boolean(Number(row.ai_enabled));
  const identityConflict = row.onboarding_status === "conflict";
  const available = row.status === "open";

  return {
    ok: true,
    signals: {
      ...fallbackSignals,
      available,
      outboundAllowed: available,
      manualApprovalRequired: humanOwnerActive,
      humanOwnerActive,
      aiBlocked,
      identityConflict
    }
  };
}

const FOLLOW_UP_DISPATCH_POLICY_FEATURE_FLAGS: CommercialPolicyFeatureFlags = {
  commercialPolicyEnabled: true,
  allowDraftReplies: false,
  allowToolRequests: false,
  allowEntityProposals: false,
  allowFollowUpEvaluation: true,
  allowInternalTasks: false,
  allowQuoteDraftRequests: false,
  allowOperatorReviewRequests: false,
  allowSensitiveClaims: false,
  allowOutboundProposals: false
};

function buildEmptySalesAgentResult(): SalesAgentResult {
  return {
    runId: "follow-up-dispatch-policy",
    contractVersion: COMMERCIAL_POLICY_CONTRACT_VERSION,
    outcome: "no_commercial_action",
    analysis: {
      summary: "Follow-up dispatch policy channel gate.",
      qualificationState: "unknown",
      customerReadiness: "unknown",
      productFit: "unknown",
      confidence: "medium",
      riskLevel: "low",
      reasonCodes: []
    },
    decision: {
      type: "no_commercial_action",
      reason: "Follow-up dispatch policy channel gate.",
      confidence: "medium",
      riskLevel: "low",
      requiresApproval: "none",
      errorCode: null,
      reasonCodes: [],
      policyTags: []
    },
    shouldRespondNow: false,
    shouldRequestTool: false,
    shouldRequestHuman: false,
    shouldEvaluateFollowUp: true,
    proposedActions: [],
    toolRequests: [],
    entityProposals: [],
    responseProposal: null,
    evidence: [],
    policyAssessment: {
      status: "allowed",
      blocked: false,
      reason: "Follow-up dispatch policy channel gate.",
      confidence: "medium",
      riskLevel: "low",
      approvalRequirement: "none",
      errorCode: null,
      reasonCodes: [],
      policyTags: []
    },
    warnings: [],
    rationale: {
      summary: "Follow-up dispatch policy channel gate.",
      evidence: [],
      counterEvidence: [],
      assumptions: [],
      riskFlags: [],
      missingInformation: [],
      policyRulesApplied: []
    },
    metadata: {}
  };
}

function buildDispatchReasonCodes(signals: FollowUpDispatchChannelSignals): string[] {
  return uniqueStrings([
    signals.optOut ? "opt_out_active" : "",
    signals.quietHoursActive ? "quiet_hours_active" : "",
    signals.identityConflict ? "identity_conflict" : "",
    signals.aiBlocked ? "ai_blocked" : "",
    signals.humanOwnerActive ? "human_owner_active" : "",
    !signals.available ? "conversation_unavailable" : ""
  ]);
}

function buildFailedSafeResult(reasonCode: string): FollowUpDispatchPolicyResult {
  return {
    decision: "failed_safe",
    policyStatus: "failed_safe",
    overallDecision: "failed_safe",
    requiresApproval: "blocked",
    riskLevel: "blocked",
    reasonCodes: [reasonCode],
    policyNotes: ["Follow-up dispatch policy failed safe."]
  };
}

/**
 * Pure status mapping, independently testable from the full
 * evaluateCommercialPolicy call: "allowed" and "allowed_with_restrictions"
 * both dispatch as "allow" (task section 8 "Permitido": either status,
 * without a channel block, may persist the plan as planned) - the pure
 * channel gate this adapter builds never produces blocked content items
 * itself (no claims/actions are proposed), so "allowed_with_restrictions"
 * cannot occur through evaluateFollowUpDispatchPolicy today, but the mapping
 * stays total over every CommercialPolicyStatus the boundary can return.
 */
export function mapCommercialPolicyStatusToDispatchDecision(
  status: "allowed" | "allowed_with_restrictions" | "requires_review" | "blocked" | "failed_safe"
): FollowUpDispatchDecision {
  if (status === "failed_safe") return "failed_safe";
  if (status === "blocked") return "deny";
  if (status === "requires_review") return "require_review";
  return "allow";
}

/**
 * Pure evaluation boundary: never persists anything, never reads from a
 * caller-provided plan/opportunity object directly - only from the already
 * real, explicit signals passed in. `policyEnabled` must come from
 * BRAIN_COMMERCIAL_POLICY_ENABLED (or the typed readEnvFlag mechanism), never
 * from a flag named "shadow" (task section 9). When disabled, or when the
 * channel signal source itself failed, this fails safe rather than silently
 * behaving as "allowed" (task section 9/section 8 "Fail-safe").
 */
export function evaluateFollowUpDispatchPolicy(input: {
  currentTime: string;
  policyEnabled: boolean;
  channelSignals: FollowUpDispatchChannelSignals | null;
  channelSignalsWarning?: string | null;
  /** Test-only injection point - production callers omit these and get the canonical versions. */
  policyVersionOverride?: string;
  contractVersionOverride?: string;
}): FollowUpDispatchPolicyResult {
  if (!input.policyEnabled) {
    return buildFailedSafeResult("policy_disabled");
  }
  if (!input.channelSignals) {
    return buildFailedSafeResult(input.channelSignalsWarning ?? "channel_signal_source_unavailable");
  }

  const policyResult = evaluateCommercialPolicy({
    salesAgentResult: buildEmptySalesAgentResult(),
    currentTime: input.currentTime,
    contractVersion: input.contractVersionOverride ?? COMMERCIAL_POLICY_CONTRACT_VERSION,
    policyVersion: input.policyVersionOverride ?? COMMERCIAL_POLICY_VERSION,
    allowedCapabilities: [],
    commercialContext: {},
    channelContext: input.channelSignals,
    featureFlags: FOLLOW_UP_DISPATCH_POLICY_FEATURE_FLAGS,
    metadata: {}
  });

  const reasonCodes = buildDispatchReasonCodes(input.channelSignals);
  const decision = mapCommercialPolicyStatusToDispatchDecision(policyResult.status);

  if (decision === "failed_safe") {
    return {
      decision,
      policyStatus: "failed_safe",
      overallDecision: policyResult.overallDecision,
      requiresApproval: policyResult.requiresApproval,
      riskLevel: policyResult.riskLevel,
      reasonCodes: uniqueStrings([...reasonCodes, "policy_evaluation_failed_safe"]),
      policyNotes: ["Commercial policy evaluation failed safe."]
    };
  }

  if (decision === "deny") {
    return {
      decision,
      policyStatus: policyResult.status,
      overallDecision: policyResult.overallDecision,
      requiresApproval: policyResult.requiresApproval,
      riskLevel: policyResult.riskLevel,
      reasonCodes,
      policyNotes: ["Commercial policy blocked follow-up dispatch by channel policy."]
    };
  }

  if (decision === "require_review") {
    return {
      decision,
      policyStatus: policyResult.status,
      overallDecision: policyResult.overallDecision,
      requiresApproval: policyResult.requiresApproval,
      riskLevel: policyResult.riskLevel,
      reasonCodes,
      policyNotes: ["Commercial policy requires operator review before dispatch."]
    };
  }

  return {
    decision,
    policyStatus: policyResult.status,
    overallDecision: policyResult.overallDecision,
    requiresApproval: policyResult.requiresApproval,
    riskLevel: policyResult.riskLevel,
    reasonCodes,
    policyNotes: []
  };
}
