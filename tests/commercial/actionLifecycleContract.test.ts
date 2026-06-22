import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMERCIAL_ACTION_APPROVAL_REQUIREMENTS,
  COMMERCIAL_ACTION_CHANNELS,
  COMMERCIAL_ACTION_LIFECYCLE_ALLOWED_TRANSITIONS,
  COMMERCIAL_ACTION_RISK_LEVELS,
  COMMERCIAL_ACTION_STATUSES,
  COMMERCIAL_ACTION_TYPES,
  OPERATOR_REVIEW_DECISIONS,
  validateActionLifecycleTransition,
  validateCommercialActionDecision,
  validateCommercialExecutableCommandPreview,
  validateCommercialOperatorReviewDraft,
  validateCommercialProposedAction
} from "../../lib/brain/commercial/action-lifecycle";

test("exposes the lifecycle contract constants", () => {
  assert.ok(COMMERCIAL_ACTION_TYPES.includes("send_whatsapp_reply"));
  assert.ok(COMMERCIAL_ACTION_TYPES.includes("no_action"));
  assert.ok(COMMERCIAL_ACTION_STATUSES.includes("draft"));
  assert.ok(COMMERCIAL_ACTION_STATUSES.includes("executed"));
  assert.ok(OPERATOR_REVIEW_DECISIONS.includes("approve"));
  assert.ok(OPERATOR_REVIEW_DECISIONS.includes("mark_not_useful"));
  assert.ok(COMMERCIAL_ACTION_APPROVAL_REQUIREMENTS.includes("manager_review"));
  assert.ok(COMMERCIAL_ACTION_RISK_LEVELS.includes("critical"));
  assert.ok(COMMERCIAL_ACTION_CHANNELS.includes("internal"));
  assert.ok(COMMERCIAL_ACTION_LIFECYCLE_ALLOWED_TRANSITIONS.includes("draft->proposed"));
});

function makeProposedAction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    actionId: "action-001",
    decisionId: "decision-001",
    opportunityId: "opp-001",
    caseId: "case-001",
    messageId: "msg-001",
    type: "send_whatsapp_reply",
    status: "proposed",
    channel: "whatsapp",
    riskLevel: "low",
    approvalRequirement: "operator_review",
    draftPayload: {
      text: "Hola, te ayudamos."
    },
    finalPayload: null,
    reason: "Proposal requires human review.",
    blockedReasons: [],
    idempotencyKey: "idem-action-001",
    executable: false,
    createdAt: "2026-06-17T12:00:00.000Z",
    updatedAt: null,
    ...overrides
  };
}

function makeReviewDraft(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    reviewId: "review-001",
    actionId: "action-001",
    decision: "approve",
    editedPayload: null,
    comment: "Looks good.",
    reviewerId: "operator-001",
    createdAt: "2026-06-17T12:00:00.000Z",
    persisted: false,
    ...overrides
  };
}

function makeCommandPreview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    commandId: "command-001",
    actionId: "action-001",
    commandType: "send_whatsapp_reply",
    payloadPreview: {
      text: "Hola, te ayudamos."
    },
    target: {
      channel: "whatsapp",
      recipient: "56912345678"
    },
    canExecute: false,
    blockedReasons: [],
    ...overrides
  };
}

test("validates a proposed action and preserves executable=false", () => {
  const result = validateCommercialProposedAction(makeProposedAction());
  assert.equal(result.valid, true);
  assert.equal(result.value?.executable, false);
  assert.equal(JSON.stringify(result.value).includes("action-001"), true);
});

test("rejects a proposed action without idempotency key", () => {
  const result = validateCommercialProposedAction(makeProposedAction({ idempotencyKey: "" }));
  assert.equal(result.valid, false);
  assert.equal(result.code, "missing_idempotency_key");
});

test("validates a review draft and keeps persisted=false", () => {
  const result = validateCommercialOperatorReviewDraft(makeReviewDraft());
  assert.equal(result.valid, true);
  assert.equal(result.value?.persisted, false);
});

test("validates a command preview and keeps canExecute=false", () => {
  const result = validateCommercialExecutableCommandPreview(makeCommandPreview());
  assert.equal(result.valid, true);
  assert.equal(result.value?.canExecute, false);
});

test("validates a decision and keeps the embedded next action non executable", () => {
  const result = validateCommercialActionDecision({
    decisionId: "decision-001",
    opportunityId: "opp-001",
    caseId: "case-001",
    messageId: "msg-001",
    nextAction: makeProposedAction({
      status: "requires_review",
      approvalRequirement: "operator_review"
    }),
    rationale: "Operational decision recorded.",
    createdAt: "2026-06-17T12:00:00.000Z"
  });

  assert.equal(result.valid, true);
  assert.equal(result.value?.nextAction.executable, false);
});

test("allows the contractual lifecycle transitions", () => {
  const allowedPairs = [
    ["draft", "proposed"],
    ["proposed", "requires_review"],
    ["requires_review", "approved"],
    ["requires_review", "rejected"],
    ["requires_review", "edited"],
    ["edited", "approved"],
    ["proposed", "planned"],
    ["approved", "planned"],
    ["planned", "scheduled"],
    ["scheduled", "scheduled"],
    ["proposed", "blocked"],
    ["approved", "blocked"],
    ["planned", "blocked"],
    ["scheduled", "blocked"],
    ["proposed", "cancelled"],
    ["approved", "cancelled"],
    ["planned", "cancelled"],
    ["scheduled", "cancelled"],
    ["proposed", "expired"],
    ["approved", "expired"],
    ["planned", "expired"],
    ["scheduled", "expired"]
  ] as const;

  for (const [fromStatus, toStatus] of allowedPairs) {
    const result = validateActionLifecycleTransition({
      fromStatus,
      toStatus,
      actionType: "send_whatsapp_reply",
      reviewDecision: "approve",
      currentTime: "2026-06-17T12:00:00.000Z",
      metadata: { caseId: "case-001" }
    });

    assert.equal(result.allowed, true, `${fromStatus} -> ${toStatus} should be allowed`);
    assert.equal(result.code, "valid");
  }
});

test("blocks direct execution and returns the P1K-011A execution reason", () => {
  const blockedPairs = [
    ["proposed", "executed"],
    ["requires_review", "executed"],
    ["approved", "executing"],
    ["planned", "executing"],
    ["executing", "executed"],
    ["executing", "failed"]
  ] as const;

  for (const [fromStatus, toStatus] of blockedPairs) {
    const result = validateActionLifecycleTransition({
      fromStatus,
      toStatus,
      actionType: "send_whatsapp_reply",
      reviewDecision: "approve",
      currentTime: "2026-06-17T12:00:00.000Z",
      metadata: {}
    });

    assert.equal(result.allowed, false, `${fromStatus} -> ${toStatus} should be blocked`);
    assert.equal(result.reason, "execution_not_enabled_in_p1k_011a");
  }
});

test("blocks protected terminal statuses from moving forward", () => {
  const blockedPairs = [
    ["rejected", "approved"],
    ["blocked", "approved"],
    ["executed", "edited"],
    ["cancelled", "executed"],
    ["expired", "executed"]
  ] as const;

  for (const [fromStatus, toStatus] of blockedPairs) {
    const result = validateActionLifecycleTransition({
      fromStatus,
      toStatus,
      actionType: "send_whatsapp_reply",
      reviewDecision: "approve",
      currentTime: "2026-06-17T12:00:00.000Z",
      metadata: {}
    });

    assert.equal(result.allowed, false, `${fromStatus} -> ${toStatus} should be blocked`);
    assert.equal(result.code, "terminal_status_protected");
  }
});

test("rejects invalid lifecycle inputs safely", () => {
  const statusResult = validateActionLifecycleTransition({
    fromStatus: "draft",
    toStatus: "not-a-status",
    currentTime: "2026-06-17T12:00:00.000Z",
    metadata: {}
  });

  const rootResult = validateCommercialProposedAction(null);

  assert.equal(statusResult.allowed, false);
  assert.equal(statusResult.code, "invalid_status");
  assert.equal(rootResult.valid, false);
  assert.equal(rootResult.code, "invalid_root");
});

test("is JSON serializable and deterministic", () => {
  const action = validateCommercialProposedAction(makeProposedAction()).value;
  const first = validateActionLifecycleTransition({
    fromStatus: "draft",
    toStatus: "proposed",
    actionType: "send_whatsapp_reply",
    reviewDecision: "approve",
    currentTime: "2026-06-17T12:00:00.000Z",
    metadata: { nested: { ok: true } }
  });
  const second = validateActionLifecycleTransition({
    fromStatus: "draft",
    toStatus: "proposed",
    actionType: "send_whatsapp_reply",
    reviewDecision: "approve",
    currentTime: "2026-06-17T12:00:00.000Z",
    metadata: { nested: { ok: true } }
  });

  assert.doesNotThrow(() => JSON.stringify(action));
  assert.doesNotThrow(() => JSON.stringify(first));
  assert.deepEqual(first, second);
});
