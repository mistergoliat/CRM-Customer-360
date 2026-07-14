import assert from "node:assert/strict";
import test from "node:test";
import { planCommercialFollowUp, toProposedActionPreview, validateFollowUpPlan } from "../../lib/brain/commercial/follow-up-planner";
import type { CommercialFollowUpPlanningInput } from "../../lib/brain/commercial/follow-up-planner";

const FIXED_TIME = "2026-06-17T12:00:00.000Z";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeInput(overrides: Partial<CommercialFollowUpPlanningInput> = {}): CommercialFollowUpPlanningInput {
  const base = {
    now: FIXED_TIME,
    timezone: "America/Santiago",
    opportunity: {
      id: "opp-001",
      status: "qualifying",
      stage: "qualification",
      temperature: "warm",
      priority: "high",
      primaryIntent: "product_inquiry",
      currentSummary: "Cliente consulta por producto.",
      missingRequirements: [],
      productInterests: ["banca"],
      objections: [],
      signals: ["customer_message_present"],
      lastActivityAt: "2026-06-17T11:10:00.000Z",
      lastCustomerMessageId: "msg-001",
      lastAgentDecisionId: "decision-001",
      nextActionType: null,
      humanOwnerActive: false,
      aiBlocked: false,
      closedAt: null
    },
    caseContext: {
      caseId: "case-001",
      status: "open",
      lifecycleStatus: "open",
      department: "ventas",
      priority: "medium",
      requiresHuman: false,
      lastMessageAt: "2026-06-17T11:55:00.000Z",
      closedAt: null
    },
    conversation: {
      waId: "56912345678",
      channel: "whatsapp",
      lastCustomerMessageAt: "2026-06-17T10:50:00.000Z",
      lastAgentMessageAt: "2026-06-17T11:00:00.000Z",
      lastInboundText: "Hola, quiero saber mas del producto.",
      lastOutboundText: "Perfecto, te ayudo."
    },
    lastDecision: null,
    policy: {
      maxAttempts: 3,
      cooldownHours: 0,
      defaultDelayHours: 2,
      requireOperatorReview: false,
      allowLowRiskAutoApprovalPreview: true
    }
  } as const;

  const hasOverride = (key: keyof CommercialFollowUpPlanningInput) => Object.prototype.hasOwnProperty.call(overrides, key);

  return {
    ...base,
    ...overrides,
    opportunity: hasOverride("opportunity") ? (overrides.opportunity ?? null) : base.opportunity,
    caseContext: hasOverride("caseContext") ? (overrides.caseContext ?? null) : base.caseContext,
    conversation: hasOverride("conversation") ? (overrides.conversation ?? null) : base.conversation,
    lastDecision: hasOverride("lastDecision") ? (overrides.lastDecision ?? null) : base.lastDecision,
    policy: hasOverride("policy") ? (overrides.policy ?? null) : base.policy
  } as CommercialFollowUpPlanningInput;
}

function makeOpportunity(
  overrides: Partial<NonNullable<CommercialFollowUpPlanningInput["opportunity"]>> = {}
): NonNullable<CommercialFollowUpPlanningInput["opportunity"]> {
  return {
    id: "opp-001",
    status: "qualifying",
    stage: "qualification",
    temperature: "warm",
    priority: "high",
    primaryIntent: "product_inquiry",
    currentSummary: "Cliente consulta por producto.",
    missingRequirements: [],
    productInterests: ["banca"],
    objections: [],
    signals: ["customer_message_present"],
    lastActivityAt: "2026-06-17T11:10:00.000Z",
    lastCustomerMessageId: "msg-001",
    lastAgentDecisionId: "decision-001",
    nextActionType: null,
    humanOwnerActive: false,
    aiBlocked: false,
    closedAt: null,
    ...overrides
  };
}

test("returns not_needed when there is no opportunity", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      opportunity: null
    })
  );

  assert.equal(plan.status, "not_needed");
  assert.equal(plan.intent, "no_followup");
  assert.equal(plan.executable, false);
  assert.equal(plan.persisted, false);
});

test("blocks a closed case", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      caseContext: {
        caseId: "case-001",
        status: "closed",
        lifecycleStatus: "closed",
        department: "ventas",
        priority: "medium",
        requiresHuman: false,
        lastMessageAt: "2026-06-17T11:55:00.000Z",
        closedAt: "2026-06-17T11:59:00.000Z"
      }
    })
  );

  assert.equal(plan.status, "blocked");
  assert.equal(plan.blockReasons.includes("case_closed"), true);
  assert.equal(plan.cancelReason, null);
});

test("blocks when AI is blocked", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      opportunity: {
        ...makeOpportunity(),
        aiBlocked: true
      }
    })
  );

  assert.equal(plan.status, "blocked");
  assert.equal(plan.blockReasons.includes("ai_blocked"), true);
});

test("requires operator review when human ownership is active and policy requires review", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      opportunity: {
        ...makeOpportunity(),
        humanOwnerActive: true
      },
      policy: {
        maxAttempts: 3,
        cooldownHours: 1,
        defaultDelayHours: 2,
        requireOperatorReview: true,
        allowLowRiskAutoApprovalPreview: false
      }
    })
  );

  assert.equal(plan.status, "requires_operator_review");
  assert.equal(plan.approvalRequirement, "operator_review");
  assert.equal(plan.scheduledFor !== null, true);
});

test("blocks when human ownership is active and policy does not require review", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      opportunity: {
        ...makeOpportunity(),
        humanOwnerActive: true
      },
      policy: {
        maxAttempts: 3,
        cooldownHours: 1,
        defaultDelayHours: 2,
        requireOperatorReview: false,
        allowLowRiskAutoApprovalPreview: true
      }
    })
  );

  assert.equal(plan.status, "blocked");
  assert.equal(plan.blockReasons.includes("human_owner_active"), true);
});

test("cancels follow-up when the customer replied after the last agent message", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      conversation: {
        waId: "56912345678",
        channel: "whatsapp",
        lastCustomerMessageAt: "2026-06-17T11:59:30.000Z",
        lastAgentMessageAt: "2026-06-17T11:55:00.000Z",
        lastInboundText: "Volvi a escribir.",
        lastOutboundText: "Te dejo el seguimiento."
      }
    })
  );

  assert.equal(plan.status, "cancelled");
  assert.equal(plan.cancelReason, "customer_replied");
  assert.equal(plan.blockReasons.includes("customer_replied_after_last_agent_message"), true);
  assert.equal(plan.executable, false);
  assert.equal(plan.persisted, false);
});

test("marks follow-up as expired when the previous decision expired", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      lastDecision: {
        decisionId: "decision-expired",
        nextActionJson: {
          status: "expired"
        },
        policyStatus: "blocked",
        riskLevel: "low",
        approvalRequirement: "blocked",
        decisionStatus: "expired",
        createdAt: "2026-06-17T10:00:00.000Z"
      }
    })
  );

  assert.equal(plan.status, "expired");
  assert.equal(plan.cancelReason, "expired");
  assert.equal(plan.blockReasons.includes("outside_policy_window"), true);
});

test("blocks when the cooldown window is active", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      conversation: {
        waId: "56912345678",
        channel: "whatsapp",
        lastCustomerMessageAt: "2026-06-17T11:00:00.000Z",
        lastAgentMessageAt: "2026-06-17T11:40:00.000Z",
        lastInboundText: "Hola, sigo atento.",
        lastOutboundText: "Te respondo pronto."
      },
      policy: {
        maxAttempts: 3,
        cooldownHours: 2,
        defaultDelayHours: 2,
        requireOperatorReview: false,
        allowLowRiskAutoApprovalPreview: true
      }
    })
  );

  assert.equal(plan.status, "blocked");
  assert.equal(plan.blockReasons.includes("cooldown_active"), true);
  assert.equal(plan.scheduledFor, "2026-06-17T13:40:00.000Z");
});

test("blocks high-risk intents", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      conversation: {
        waId: "56912345678",
        channel: "whatsapp",
        lastCustomerMessageAt: "2026-06-17T11:50:00.000Z",
        lastAgentMessageAt: "2026-06-17T11:55:00.000Z",
        lastInboundText: "Quiero hacer una devolucion y reclamo.",
        lastOutboundText: "Entiendo."
      }
    })
  );

  assert.equal(plan.status, "blocked");
  assert.ok(plan.blockReasons.includes("complaint_or_warranty") || plan.blockReasons.includes("high_risk_intent"));
});

test("blocks WhatsApp follow-up when waId is missing", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      conversation: {
        waId: null,
        channel: "whatsapp",
        lastCustomerMessageAt: "2026-06-17T11:50:00.000Z",
        lastAgentMessageAt: "2026-06-17T11:55:00.000Z",
        lastInboundText: "Hola, quiero saber mas del producto.",
        lastOutboundText: "Perfecto."
      }
    })
  );

  assert.equal(plan.status, "blocked");
  assert.equal(plan.blockReasons.includes("missing_customer_identity"), true);
});

test("blocks when the channel is missing", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      conversation: {
        waId: "56912345678",
        channel: "unknown",
        lastCustomerMessageAt: "2026-06-17T11:50:00.000Z",
        lastAgentMessageAt: "2026-06-17T11:55:00.000Z",
        lastInboundText: "Hola, quiero saber mas del producto.",
        lastOutboundText: "Perfecto."
      }
    })
  );

  assert.equal(plan.status, "blocked");
  assert.equal(plan.blockReasons.includes("missing_channel"), true);
});

test("recommends follow-up for a warm commercial opportunity", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      opportunity: {
        ...makeOpportunity(),
        primaryIntent: "product_inquiry",
        missingRequirements: [],
        nextActionType: null
      },
      policy: {
        maxAttempts: 3,
        cooldownHours: 0,
        defaultDelayHours: 2,
        requireOperatorReview: false,
        allowLowRiskAutoApprovalPreview: true
      }
    })
  );

  assert.equal(plan.status, "recommended");
  assert.equal(plan.executable, false);
  assert.equal(plan.persisted, false);
  assert.ok(plan.draftMessage);
});

test("quote follow-up generates a safe draft", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      opportunity: {
        ...makeOpportunity(),
        primaryIntent: "quote_request",
        currentSummary: "Cliente pide cotizacion formal.",
        missingRequirements: [],
        nextActionType: null
      }
    })
  );

  assert.equal(plan.intent, "quote_followup");
  assert.equal(plan.status === "recommended" || plan.status === "requires_operator_review", true);
  assert.ok((plan.draftMessage ?? "").toLowerCase().includes("cotizacion"));
  assert.equal((plan.draftMessage ?? "").toLowerCase().includes("precio"), false);
  assert.equal((plan.draftMessage ?? "").toLowerCase().includes("stock"), false);
  assert.equal((plan.draftMessage ?? "").toLowerCase().includes("descuento"), false);
});

test("missing information follow-up generates a safe draft", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      opportunity: {
        ...makeOpportunity(),
        primaryIntent: "general_information",
        currentSummary: "Falta producto y comuna.",
        missingRequirements: ["producto", "comuna"],
        nextActionType: "ask_clarifying_question"
      }
    })
  );

  assert.equal(plan.intent, "missing_information_followup");
  assert.ok((plan.draftMessage ?? "").toLowerCase().includes("falta"));
  assert.ok((plan.draftMessage ?? "").toLowerCase().includes("producto"));
  assert.equal((plan.draftMessage ?? "").toLowerCase().includes("precio"), false);
});

test("limits attempts and blocks when the maximum is reached", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      lastDecision: {
        decisionId: "decision-attempts",
        nextActionJson: {
          attemptNumber: 3
        },
        policyStatus: "allowed",
        riskLevel: "low",
        approvalRequirement: "none",
        decisionStatus: "recorded",
        createdAt: "2026-06-17T11:00:00.000Z"
      },
      policy: {
        maxAttempts: 2,
        cooldownHours: 0,
        defaultDelayHours: 2,
        requireOperatorReview: false,
        allowLowRiskAutoApprovalPreview: true
      }
    })
  );

  assert.equal(plan.status, "blocked");
  assert.equal(plan.blockReasons.includes("max_attempts_reached"), true);
});

test("returns a stable idempotency key and JSON serializable output", () => {
  const input = makeInput();
  const before = JSON.stringify(input);
  const first = planCommercialFollowUp(input);
  const second = planCommercialFollowUp(cloneJson(input));

  assert.equal(before, JSON.stringify(input));
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  assert.doesNotThrow(() => JSON.stringify(first));
});

test("idempotencyKey/planId stay stable for the same logical plan even when `now` (and therefore scheduledFor) drifts between calls", () => {
  const opportunity = {
    ...makeOpportunity(),
    primaryIntent: "product_inquiry",
    missingRequirements: [],
    nextActionType: null
  };
  const policy = {
    maxAttempts: 3,
    cooldownHours: 0,
    defaultDelayHours: 2,
    requireOperatorReview: false,
    allowLowRiskAutoApprovalPreview: true
  };

  const first = planCommercialFollowUp(makeInput({ now: "2026-06-17T12:00:00.000Z", opportunity, policy }));
  // A later call, seconds after, for the exact same logical plan (same
  // opportunity/intent/attemptNumber/status/policy) - only `now` differs.
  const second = planCommercialFollowUp(makeInput({ now: "2026-06-17T12:00:07.421Z", opportunity, policy }));

  assert.equal(first.status, "recommended");
  assert.equal(second.status, "recommended");
  assert.notEqual(first.scheduledFor, second.scheduledFor, "sanity check: scheduledFor does drift with now");
  assert.equal(first.planId, second.planId);
  assert.equal(first.idempotencyKey, second.idempotencyKey);

  // A genuinely different attempt (durable history advanced) must still get
  // a different identity, so this is not a blanket "always equal" digest.
  const thirdLastDecision = { decisionId: null, nextActionJson: { attemptNumber: 1 }, policyStatus: null, riskLevel: null, approvalRequirement: null, decisionStatus: null, createdAt: null };
  const third = planCommercialFollowUp(makeInput({ now: "2026-06-17T12:00:00.000Z", opportunity, policy, lastDecision: thirdLastDecision }));
  assert.notEqual(third.attemptNumber, first.attemptNumber);
  assert.notEqual(third.idempotencyKey, first.idempotencyKey);
});

test("validates the plan and keeps the proposed action non executable", () => {
  const plan = planCommercialFollowUp(makeInput());
  const validation = validateFollowUpPlan(plan);
  const preview = toProposedActionPreview(plan);

  assert.equal(validation.valid, true);
  assert.equal(preview.type, "schedule_followup");
  assert.equal(preview.executable, false);
  assert.equal(preview.finalPayload, null);
  assert.ok(preview.draftPayload);
});

test("does not invent price, stock or discounts in the draft", () => {
  const plan = planCommercialFollowUp(
    makeInput({
      opportunity: {
        ...makeOpportunity(),
        primaryIntent: "quote_request",
        currentSummary: "Cliente pide cotizacion.",
        missingRequirements: [],
        nextActionType: null
      }
    })
  );

  const draft = (plan.draftMessage ?? "").toLowerCase();
  assert.equal(draft.includes("precio"), false);
  assert.equal(draft.includes("stock"), false);
  assert.equal(draft.includes("descuento"), false);
  assert.equal(draft.includes("garantia"), false);
});
