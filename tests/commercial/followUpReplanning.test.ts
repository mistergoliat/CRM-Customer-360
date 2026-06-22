import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  applyFollowUpMutationPlanInMemory,
  buildBlockingPlan,
  buildCancellationPlan,
  buildExpirationPlan,
  buildFollowUpAuditEventId,
  buildFollowUpMutationPlan,
  buildFollowUpMutationPlanId,
  buildReplacementActionId,
  buildReplacementIdempotencyKey,
  buildReplanningPlan,
  validateFollowUpMutationPlan,
  type FollowUpMutationInput,
  type FollowUpMutationMemoryState,
  type FollowUpMutationPlan
} from "../../lib/brain/commercial/follow-up-replanning";

const FIXED_NOW = "2026-06-17T12:00:00.000Z";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeSchedulingResult(
  overrides: any = {}
): FollowUpMutationInput["schedulingResult"] {
  return {
    decision: "replan",
    actionable: false,
    actionId: "action-001",
    reasons: ["replanned_after_cooldown"],
    warnings: [],
    originalScheduledFor: "2026-06-17T13:00:00.000Z",
    effectiveScheduledFor: "2026-06-17T13:00:00.000Z",
    nextScheduledFor: "2026-06-17T14:00:00.000Z",
    timing: {
      evaluatedAt: FIXED_NOW,
      due: false,
      expired: false,
      cooldownUntil: null,
      outsideBusinessHours: false
    },
    retry: {
      attemptCount: 1,
      maxAttempts: 3,
      attemptsRemaining: 2
    },
    sideEffects: {
      actionUpdated: false,
      actionInserted: false,
      outboxWritten: false,
      messageSent: false,
      workerTriggered: false
    },
    ...overrides
  } as FollowUpMutationInput["schedulingResult"];
}

function makeInput(overrides: any = {}): FollowUpMutationInput {
  const base: FollowUpMutationInput = {
    now: FIXED_NOW,
    originalAction: {
      rowId: 1,
      actionId: "action-001",
      idempotencyKey: "idem-action-001",
      actionType: "schedule_followup",
      status: "planned",
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: null,
      scheduledFor: "2026-06-17T13:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: "Hola, te escribo para dar seguimiento.",
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      parentActionId: null,
      supersededByActionId: null,
      lifecycleVersion: "brain.commercial.action-lifecycle.v1",
      policyVersion: "brain.commercial.follow-up-scheduling.v1",
      runtimeVersion: null
    },
    schedulingResult: makeSchedulingResult(),
    currentContext: {
      caseStatus: "open",
      lifecycleStatus: "open",
      humanOwnerActive: false,
      aiBlocked: false,
      requiresHuman: false,
      opportunityStatus: "open",
      opportunityStage: "qualifying",
      opportunityStageChangedAt: null,
      policyStatus: "allowed",
      lastInboundAt: null,
      lastOutboundAt: null,
      conflictingActionId: null,
      duplicateActionId: null
    },
    policy: {
      allowReplacementOnReplan: true,
      allowInPlaceScheduleUpdate: true,
      preserveOriginalAction: false,
      requireAuditEvent: true,
      resetAttemptsOnStageChange: true,
      incrementGenerationOnReplacement: true
    }
  };

  return {
    ...base,
    ...overrides,
    originalAction: {
      ...base.originalAction,
      ...(overrides.originalAction ?? {})
    } as FollowUpMutationInput["originalAction"],
    schedulingResult: (overrides.schedulingResult ?? base.schedulingResult) as FollowUpMutationInput["schedulingResult"],
    currentContext: {
      ...base.currentContext,
      ...(overrides.currentContext ?? {})
    } as FollowUpMutationInput["currentContext"],
    policy: {
      ...base.policy,
      ...(overrides.policy ?? {})
    } as FollowUpMutationInput["policy"]
  } as FollowUpMutationInput;
}

function buildPlan(overrides: any = {}): FollowUpMutationPlan {
  return buildFollowUpMutationPlan(makeInput(overrides));
}

function getOriginalActionIds(plan: FollowUpMutationPlan) {
  const update = plan.operations.find((operation) => operation.type === "update_existing_action");
  const replacement = plan.operations.find((operation) => operation.type === "create_replacement_action");
  const audit = plan.operations.find((operation) => operation.type === "append_audit_event");
  return {
    update,
    replacement,
    audit
  };
}

function makeState(actions: FollowUpMutationMemoryState["actions"], appliedPlanKeys: string[] = []): FollowUpMutationMemoryState {
  return {
    actions: cloneJson(actions),
    auditEvents: [],
    appliedPlanKeys: [...appliedPlanKeys]
  };
}

function sourceText(): string {
  const folder = resolve(process.cwd(), "lib/brain/commercial/follow-up-replanning");
  const files = readdirSync(folder).filter((file) => file.endsWith(".ts"));
  const testFile = resolve(process.cwd(), "tests/commercial/followUpReplanning.test.ts");
  return [...files.map((file) => readFileSync(resolve(folder, file), "utf8")), readFileSync(testFile, "utf8")].join("\n");
}

function assertNoForbiddenSourceText(value: string): void {
  const pattern = new RegExp(
    [
      "D" + "ate\\.now",
      "random" + "UUID",
      "Math\\.random",
      "set" + "Timeout",
      "set" + "Interval",
      "pro" + "cess\\.env",
      "my" + "sql2",
      "from ['\"]" + "pg" + "['\"]",
      "supa" + "base",
      "SE" + "LECT ",
      "IN" + "SERT ",
      "UP" + "DATE ",
      "DE" + "LETE ",
      "brain_" + "message_" + "outbox",
      "send" + "WhatsApp",
      "graph\\.facebook"
    ].join("|"),
    ""
  );
  assert.equal(pattern.test(value), false);
}

test("wait produces no_change", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "wait", reasons: ["scheduled_time_not_reached"], nextScheduledFor: null, actionable: false })
  });

  assert.equal(plan.planType, "no_change");
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.replacementActionId, null);
});

test("ready produces no_change", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "ready", reasons: ["scheduled_time_reached"], actionable: true })
  });

  assert.equal(plan.planType, "no_change");
  assert.equal(plan.operations.length, 0);
});

test("customer reply cancels", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["customer_replied_after_action_created"] }),
    currentContext: { lastInboundAt: "2026-06-17T11:00:00.000Z" }
  });

  assert.equal(plan.planType, "cancel_action");
  assert.equal(plan.reasons.includes("customer_replied_after_action_created"), true);
});

test("human owner cancels", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["human_owner_active"] }),
    currentContext: { humanOwnerActive: true }
  });

  assert.equal(plan.planType, "cancel_action");
  assert.equal(plan.reasons.includes("human_owner_active"), true);
});

test("case closed cancels", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["case_closed"] }),
    currentContext: { caseStatus: "closed", lifecycleStatus: "closed" }
  });

  assert.equal(plan.planType, "cancel_action");
  assert.equal(plan.reasons.includes("case_closed"), true);
});

test("opportunity won cancels", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["opportunity_closed_won"] }),
    currentContext: { opportunityStatus: "won" }
  });

  assert.equal(plan.planType, "cancel_action");
});

test("opportunity lost cancels", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["opportunity_closed_lost"] }),
    currentContext: { opportunityStatus: "lost" }
  });

  assert.equal(plan.planType, "cancel_action");
});

test("duplicate action cancels", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["duplicate_action"] }),
    currentContext: { duplicateActionId: "action-duplicate" }
  });

  assert.equal(plan.planType, "cancel_action");
  assert.equal(plan.reasons.includes("duplicate_action"), true);
});

test("expiry expires", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "expire", reasons: ["action_expired"] })
  });

  assert.equal(plan.planType, "expire_action");
  assert.equal(plan.reasons.includes("action_expired"), true);
});

test("max attempts expires", () => {
  const plan = buildPlan({
    originalAction: { attemptCount: 3, maxAttempts: 3 },
    schedulingResult: makeSchedulingResult({ decision: "expire", reasons: ["max_attempts_reached"] })
  });

  assert.equal(plan.planType, "expire_action");
  assert.equal(plan.reasons.includes("max_attempts_reached"), true);
});

test("AI blocked blocks", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["ai_blocked"] }),
    currentContext: { aiBlocked: true }
  });

  assert.equal(plan.planType, "block_action");
});

test("opportunity paused blocks", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["opportunity_paused"] }),
    currentContext: { opportunityStatus: "paused" }
  });

  assert.equal(plan.planType, "block_action");
});

test("policy blocked blocks", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["policy_blocked"] }),
    currentContext: { policyStatus: "blocked" }
  });

  assert.equal(plan.planType, "block_action");
});

test("risk high blocks", () => {
  const plan = buildPlan({
    originalAction: { riskLevel: "high" },
    schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["risk_too_high"] })
  });

  assert.equal(plan.planType, "block_action");
});

test("approval required blocks", () => {
  const plan = buildPlan({
    originalAction: { approvalRequirement: "operator_review" },
    schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["approval_required"] })
  });

  assert.equal(plan.planType, "block_action");
});

test("conflict blocks", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["conflicting_action"] }),
    currentContext: { conflictingActionId: "action-conflict" }
  });

  assert.equal(plan.planType, "block_action");
  assert.equal(plan.reasons.includes("conflicting_action"), true);
});

test("cooldown replans in place", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_cooldown"], nextScheduledFor: "2026-06-17T15:00:00.000Z" })
  });

  assert.equal(plan.planType, "replan_action");
  assert.equal(plan.replacementActionId, null);
  assert.equal(plan.operations.some((operation) => operation.type === "update_existing_action"), true);
});

test("business-hours replans in place", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_for_business_hours"], nextScheduledFor: "2026-06-17T15:00:00.000Z" })
  });

  assert.equal(plan.planType, "replan_action");
  assert.equal(plan.replacementActionId, null);
});

test("recent outbound replans in place", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_recent_outbound"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { lastOutboundAt: "2026-06-17T11:45:00.000Z" }
  });

  assert.equal(plan.planType, "replan_action");
  assert.equal(plan.replacementActionId, null);
});

test("stage change supersedes", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
  });

  assert.equal(plan.planType, "supersede_action");
  assert.notEqual(plan.replacementActionId, null);
});

test("preserve original creates replacement", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" },
    policy: { preserveOriginalAction: true }
  });

  assert.equal(plan.planType, "cancel_and_create_replacement");
  assert.notEqual(plan.replacementActionId, null);
});

test("replacement links parent", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
  });
  const replacement = getOriginalActionIds(plan).replacement;

  assert.equal(replacement?.type, "create_replacement_action");
  assert.equal(replacement?.action.parentActionId, "action-001");
});

test("original links supersededBy", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
  });
  const update = getOriginalActionIds(plan).update;

  assert.equal(update?.type, "update_existing_action");
  assert.equal(update?.patch.supersededByActionId, plan.replacementActionId);
});

test("attempts reset on stage change", () => {
  const plan = buildPlan({
    originalAction: { attemptCount: 2 },
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" },
    policy: { resetAttemptsOnStageChange: true }
  });
  const replacement = getOriginalActionIds(plan).replacement;

  assert.equal(replacement?.type, "create_replacement_action");
  assert.equal(replacement?.action.attemptCount, 0);
});

test("attempts preserved when configured", () => {
  const plan = buildPlan({
    originalAction: { attemptCount: 2 },
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" },
    policy: { resetAttemptsOnStageChange: false }
  });
  const replacement = getOriginalActionIds(plan).replacement;

  assert.equal(replacement?.action.attemptCount, 2);
});

test("replacement generation increments", () => {
  const plan = buildPlan({
    originalAction: { attemptCount: 2 },
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
  });
  const replacement = getOriginalActionIds(plan).replacement;

  assert.equal(replacement?.action.generation, 3);
});

test("replacement ID deterministic", () => {
  const first = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
  });
  const second = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
  });

  assert.equal(first.replacementActionId, second.replacementActionId);
});

test("plan ID deterministic", () => {
  const first = buildPlan();
  const second = buildPlan();

  assert.equal(first.planId, second.planId);
});

test("plan key deterministic", () => {
  const first = buildPlan();
  const second = buildPlan();

  assert.equal(first.idempotency.planKey, second.idempotency.planKey);
});

test("audit event deterministic", () => {
  const first = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_cooldown"], nextScheduledFor: "2026-06-17T15:00:00.000Z" })
  });
  const second = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_cooldown"], nextScheduledFor: "2026-06-17T15:00:00.000Z" })
  });
  const firstAudit = getOriginalActionIds(first).audit;
  const secondAudit = getOriginalActionIds(second).audit;

  assert.equal(firstAudit?.type, "append_audit_event");
  assert.equal(firstAudit && "event" in firstAudit ? firstAudit.event.eventId : null, secondAudit && "event" in secondAudit ? secondAudit.event.eventId : null);
});

test("same input same output", () => {
  const first = buildPlan();
  const second = buildPlan();

  assert.deepEqual(first, second);
});

test("input not mutated", () => {
  const input = makeInput();
  const before = cloneJson(input);

  buildFollowUpMutationPlan(input);

  assert.deepEqual(input, before);
});

test("terminal cancelled action immutable", () => {
  const plan = buildPlan({
    originalAction: { status: "cancelled" }
  });

  assert.equal(plan.planType, "no_change");
  assert.equal(plan.reasons.includes("terminal_action_immutable"), true);
});

test("terminal expired action immutable", () => {
  const plan = buildPlan({
    originalAction: { status: "expired" }
  });

  assert.equal(plan.planType, "no_change");
  assert.equal(plan.reasons.includes("terminal_action_immutable"), true);
});

test("terminal executed action immutable", () => {
  const plan = buildPlan({
    originalAction: { status: "executed" }
  });

  assert.equal(plan.planType, "no_change");
  assert.equal(plan.reasons.includes("terminal_action_immutable"), true);
});

test("missing next schedule invalid", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_cooldown"], nextScheduledFor: null })
  });

  assert.equal(plan.planType, "no_change");
  assert.equal(plan.reasons.includes("missing_next_schedule"), true);
});

test("replan beyond expiry becomes expire", () => {
  const plan = buildPlan({
    originalAction: { expiresAt: "2026-06-17T13:30:00.000Z" },
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_cooldown"], nextScheduledFor: "2026-06-17T14:00:00.000Z" })
  });

  assert.equal(plan.planType, "expire_action");
  assert.equal(plan.reasons.includes("replacement_would_exceed_expiry"), true);
});

test("replacement cannot equal original ID", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
  });

  assert.notEqual(plan.replacementActionId, plan.actionId);
});

test("replacement idempotency unique", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
  });
  const replacement = getOriginalActionIds(plan).replacement;

  assert.equal(replacement?.type, "create_replacement_action");
  assert.notEqual(replacement?.action.idempotencyKey, "idem-action-001");
});

test("in-memory apply success", () => {
  const plan = buildPlan();
  const state = makeState([
    {
      rowId: 1,
      actionId: "action-001",
      idempotencyKey: "idem-action-001",
      actionType: "schedule_followup",
      status: "planned",
      scheduledFor: "2026-06-17T13:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: "Hola, te escribo para dar seguimiento.",
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      supersededByActionId: null,
      parentActionId: null,
      generation: 1,
      lifecycleVersion: "brain.commercial.action-lifecycle.v1",
      policyVersion: "brain.commercial.follow-up-scheduling.v1",
      runtimeVersion: null,
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: null
    }
  ]);
  const result = applyFollowUpMutationPlanInMemory(state, plan);

  assert.equal(result.applied, true);
  assert.equal(result.conflict, false);
  assert.equal(result.duplicate, false);
  assert.equal(result.nextState.actions[0].status, "scheduled");
  assert.equal(result.nextState.appliedPlanKeys.includes(plan.idempotency.planKey), true);
});

test("in-memory retry duplicate", () => {
  const plan = buildPlan();
  const state = makeState([
    {
      rowId: 1,
      actionId: "action-001",
      idempotencyKey: "idem-action-001",
      actionType: "schedule_followup",
      status: "planned",
      scheduledFor: "2026-06-17T13:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: "Hola, te escribo para dar seguimiento.",
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      supersededByActionId: null,
      parentActionId: null,
      generation: 1,
      lifecycleVersion: "brain.commercial.action-lifecycle.v1",
      policyVersion: "brain.commercial.follow-up-scheduling.v1",
      runtimeVersion: null,
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: null
    }
  ], [plan.idempotency.planKey]);
  const result = applyFollowUpMutationPlanInMemory(state, plan);

  assert.equal(result.duplicate, true);
  assert.equal(result.applied, false);
});

test("optimistic status conflict", () => {
  const plan = buildPlan();
  const state = makeState([
    {
      rowId: 1,
      actionId: "action-001",
      idempotencyKey: "idem-action-001",
      actionType: "schedule_followup",
      status: "approved",
      scheduledFor: "2026-06-17T13:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: "Hola, te escribo para dar seguimiento.",
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      supersededByActionId: null,
      parentActionId: null,
      generation: 1,
      lifecycleVersion: "brain.commercial.action-lifecycle.v1",
      policyVersion: "brain.commercial.follow-up-scheduling.v1",
      runtimeVersion: null,
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: null
    }
  ]);
  const result = applyFollowUpMutationPlanInMemory(state, plan);

  assert.equal(result.conflict, true);
  assert.equal(result.rolledBack, true);
  assert.equal(result.nextState.actions[0].status, "approved");
});

test("duplicate action ID rollback", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
  });
  const replacement = getOriginalActionIds(plan).replacement as { action: { actionId: string; idempotencyKey: string } } | undefined;
  const state = makeState([
    {
      rowId: 1,
      actionId: "action-001",
      idempotencyKey: "idem-action-001",
      actionType: "schedule_followup",
      status: "planned",
      scheduledFor: "2026-06-17T13:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: "Hola, te escribo para dar seguimiento.",
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      supersededByActionId: null,
      parentActionId: null,
      generation: 1,
      lifecycleVersion: "brain.commercial.action-lifecycle.v1",
      policyVersion: "brain.commercial.follow-up-scheduling.v1",
      runtimeVersion: null,
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: null
    },
    {
      rowId: 2,
      actionId: replacement?.action.actionId ?? "replacement-dupe",
      idempotencyKey: "other",
      actionType: "schedule_followup",
      status: "planned",
      scheduledFor: "2026-06-17T16:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 0,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: null,
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      supersededByActionId: null,
      parentActionId: null,
      generation: 1,
      lifecycleVersion: null,
      policyVersion: null,
      runtimeVersion: null,
      createdAt: "2026-06-17T11:00:00.000Z",
      updatedAt: null
    }
  ]);
  const result = applyFollowUpMutationPlanInMemory(state, plan);

  assert.equal(result.duplicate, true);
  assert.equal(result.rolledBack, true);
});

test("duplicate idempotency rollback", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
  });
  const replacement = getOriginalActionIds(plan).replacement as { action: { actionId: string; idempotencyKey: string } } | undefined;
  const state = makeState([
    {
      rowId: 1,
      actionId: "action-001",
      idempotencyKey: "idem-action-001",
      actionType: "schedule_followup",
      status: "planned",
      scheduledFor: "2026-06-17T13:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: "Hola, te escribo para dar seguimiento.",
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      supersededByActionId: null,
      parentActionId: null,
      generation: 1,
      lifecycleVersion: "brain.commercial.action-lifecycle.v1",
      policyVersion: "brain.commercial.follow-up-scheduling.v1",
      runtimeVersion: null,
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: null
    },
    {
      rowId: 2,
      actionId: "other",
      idempotencyKey: replacement?.action.idempotencyKey ?? "duplicate-idem",
      actionType: "schedule_followup",
      status: "planned",
      scheduledFor: "2026-06-17T16:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 0,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: null,
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      supersededByActionId: null,
      parentActionId: null,
      generation: 1,
      lifecycleVersion: null,
      policyVersion: null,
      runtimeVersion: null,
      createdAt: "2026-06-17T11:00:00.000Z",
      updatedAt: null
    }
  ]);
  const result = applyFollowUpMutationPlanInMemory(state, plan);

  assert.equal(result.duplicate, true);
  assert.equal(result.rolledBack, true);
});

test("failed second operation rolls back first", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
  });
  const state = makeState([
    {
      rowId: 1,
      actionId: "action-001",
      idempotencyKey: "idem-action-001",
      actionType: "schedule_followup",
      status: "planned",
      scheduledFor: "2026-06-17T13:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: "Hola, te escribo para dar seguimiento.",
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      supersededByActionId: null,
      parentActionId: null,
      generation: 1,
      lifecycleVersion: "brain.commercial.action-lifecycle.v1",
      policyVersion: "brain.commercial.follow-up-scheduling.v1",
      runtimeVersion: null,
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: null
    },
    {
      rowId: 2,
      actionId: plan.replacementActionId ?? "replacement-action",
      idempotencyKey: "different-idem",
      actionType: "schedule_followup",
      status: "planned",
      scheduledFor: "2026-06-17T16:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 0,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: null,
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      supersededByActionId: null,
      parentActionId: null,
      generation: 1,
      lifecycleVersion: null,
      policyVersion: null,
      runtimeVersion: null,
      createdAt: "2026-06-17T11:00:00.000Z",
      updatedAt: null
    }
  ]);
  const result = applyFollowUpMutationPlanInMemory(state, plan);

  assert.equal(result.applied, false);
  assert.equal(result.rolledBack, true);
  assert.equal(result.nextState.actions[0].status, "planned");
});

test("no partial state", () => {
  const plan = buildPlan({
    schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["stale_action_context"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }),
    currentContext: { opportunityStageChangedAt: "2026-06-17T11:30:00.000Z" }
  });
  const state = makeState([
    {
      rowId: 1,
      actionId: "action-001",
      idempotencyKey: "idem-action-001",
      actionType: "schedule_followup",
      status: "planned",
      scheduledFor: "2026-06-17T13:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: "Hola, te escribo para dar seguimiento.",
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      supersededByActionId: null,
      parentActionId: null,
      generation: 1,
      lifecycleVersion: "brain.commercial.action-lifecycle.v1",
      policyVersion: "brain.commercial.follow-up-scheduling.v1",
      runtimeVersion: null,
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: null
    },
    {
      rowId: 2,
      actionId: plan.replacementActionId ?? "followup-replacement:action-001:g2:duplicate",
      idempotencyKey: "other",
      actionType: "schedule_followup",
      status: "planned",
      scheduledFor: "2026-06-17T16:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 0,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: null,
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      supersededByActionId: null,
      parentActionId: null,
      generation: 1,
      lifecycleVersion: null,
      policyVersion: null,
      runtimeVersion: null,
      createdAt: "2026-06-17T11:00:00.000Z",
      updatedAt: null
    }
  ]);
  const result = applyFollowUpMutationPlanInMemory(state, plan);

  assert.deepEqual(result.nextState, result.previousState);
});

test("audit event appended", () => {
  const plan = buildPlan();
  const state = makeState([
    {
      rowId: 1,
      actionId: "action-001",
      idempotencyKey: "idem-action-001",
      actionType: "schedule_followup",
      status: "planned",
      scheduledFor: "2026-06-17T13:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: "Hola, te escribo para dar seguimiento.",
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      supersededByActionId: null,
      parentActionId: null,
      generation: 1,
      lifecycleVersion: "brain.commercial.action-lifecycle.v1",
      policyVersion: "brain.commercial.follow-up-scheduling.v1",
      runtimeVersion: null,
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: null
    }
  ]);
  const result = applyFollowUpMutationPlanInMemory(state, plan);

  assert.equal(result.nextState.auditEvents.length, 1);
});

test("audit disabled produces no event", () => {
  const plan = buildPlan({ policy: { requireAuditEvent: false } });
  const state = makeState([
    {
      rowId: 1,
      actionId: "action-001",
      idempotencyKey: "idem-action-001",
      actionType: "schedule_followup",
      status: "planned",
      scheduledFor: "2026-06-17T13:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      draftMessage: "Hola, te escribo para dar seguimiento.",
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      supersededByActionId: null,
      parentActionId: null,
      generation: 1,
      lifecycleVersion: "brain.commercial.action-lifecycle.v1",
      policyVersion: "brain.commercial.follow-up-scheduling.v1",
      runtimeVersion: null,
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: null
    }
  ]);
  const result = applyFollowUpMutationPlanInMemory(state, plan);

  assert.equal(result.nextState.auditEvents.length, 0);
});

test("no DB", () => {
  assertNoForbiddenSourceText(sourceText());
});

test("no SQL", () => {
  assertNoForbiddenSourceText(sourceText());
});

test("no outbox", () => {
  assertNoForbiddenSourceText(sourceText());
});

test("no send", () => {
  assertNoForbiddenSourceText(sourceText());
});

test("no Meta", () => {
  assertNoForbiddenSourceText(sourceText());
});

test("no worker", () => {
  assertNoForbiddenSourceText(sourceText());
});

test("side effects always false", () => {
  const plan = buildPlan();
  assert.deepEqual(plan.sideEffects, {
    databaseWritten: false,
    actionMutated: false,
    actionInserted: false,
    outboxWritten: false,
    messageSent: false,
    workerTriggered: false
  });
});

test("validator accepts generated plans", () => {
  const plans = [
    buildPlan(),
    buildCancellationPlan(makeInput({ schedulingResult: makeSchedulingResult({ decision: "cancel", reasons: ["human_owner_active"] }) })),
    buildExpirationPlan(makeInput({ schedulingResult: makeSchedulingResult({ decision: "expire", reasons: ["action_expired"] }) })),
    buildBlockingPlan(makeInput({ schedulingResult: makeSchedulingResult({ decision: "block", reasons: ["policy_blocked"] }) })),
    buildReplanningPlan(makeInput({ schedulingResult: makeSchedulingResult({ decision: "replan", reasons: ["replanned_after_cooldown"], nextScheduledFor: "2026-06-17T15:00:00.000Z" }) }))
  ];

  for (const plan of plans) {
    const validation = validateFollowUpMutationPlan(plan);
    assert.equal(validation.valid, true, plan.planType);
  }
});

test("helpers are deterministic", () => {
  assert.equal(
    buildFollowUpMutationPlanId({
      actionId: "action-001",
      planType: "cancel_action",
      createdAt: FIXED_NOW,
      reasons: ["human_owner_active"],
      operations: []
    }),
    buildFollowUpMutationPlanId({
      actionId: "action-001",
      planType: "cancel_action",
      createdAt: FIXED_NOW,
      reasons: ["human_owner_active"],
      operations: []
    })
  );
  assert.equal(
    buildReplacementActionId({
      originalActionId: "action-001",
      generation: 2,
      nextScheduledFor: "2026-06-17T15:00:00.000Z",
      reason: "stale_action_context"
    }),
    buildReplacementActionId({
      originalActionId: "action-001",
      generation: 2,
      nextScheduledFor: "2026-06-17T15:00:00.000Z",
      reason: "stale_action_context"
    })
  );
  assert.equal(
    buildReplacementIdempotencyKey({
      originalActionId: "action-001",
      generation: 2,
      nextScheduledFor: "2026-06-17T15:00:00.000Z",
      reason: "stale_action_context"
    }),
    buildReplacementIdempotencyKey({
      originalActionId: "action-001",
      generation: 2,
      nextScheduledFor: "2026-06-17T15:00:00.000Z",
      reason: "stale_action_context"
    })
  );
  assert.equal(
    buildFollowUpAuditEventId({
      actionId: "action-001",
      eventType: "follow_up_replanned",
      reason: "cooldown_replan",
      createdAt: FIXED_NOW,
      replacementActionId: null
    }),
    buildFollowUpAuditEventId({
      actionId: "action-001",
      eventType: "follow_up_replanned",
      reason: "cooldown_replan",
      createdAt: FIXED_NOW,
      replacementActionId: null
    })
  );
});

test("source scan rejects forbidden patterns", () => {
  assertNoForbiddenSourceText(sourceText());
});
