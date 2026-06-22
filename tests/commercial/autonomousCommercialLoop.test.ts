import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  applyFollowUpMutationPlanInMemory,
  buildFollowUpMutationPlan,
  type FollowUpMutationInput
} from "../../lib/brain/commercial/follow-up-replanning/index.js";
import {
  evaluateFollowUpSchedule,
  type FollowUpSchedulingInput
} from "../../lib/brain/commercial/follow-up-scheduling/index.js";
import {
  buildAutonomousAuditEventId,
  buildAutonomousLoopRunId,
  buildDeliveryReconciliationId,
  buildOutboxRecordId,
  evaluateAutonomousLoop,
  executeAutonomousLoop,
  type AutonomousCommercialLoopInput,
  type AutonomousCommercialLoopResult,
  type AutonomousLoopRuntimeSnapshot
} from "../../lib/brain/commercial/autonomous-loop/index.js";
import {
  InMemoryAutonomousCommercialRuntime,
  lowRiskPriceQuestionFixture,
  requestMoreContextFixture,
  humanHandoffFixture,
  complaintBlockedFixture,
  customerReplyCancelsFollowUpFixture,
  temporaryTransportFailureFixture,
  rateLimitedTransportFixture,
  permanentTransportFailureFixture,
  duplicateInboundFixture,
  duplicateExecutionFixture,
  closedCaseFixture,
  aiBlockedFixture,
  opportunityWonFixture
} from "../../lib/brain/commercial/autonomous-loop/index.js";

const FIXED_NOW = "2026-06-17T12:00:00.000Z";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeRuntimeSnapshot(overrides: Partial<AutonomousLoopRuntimeSnapshot> = {}): AutonomousLoopRuntimeSnapshot {
  return {
    opportunities: [],
    decisions: [],
    actions: [],
    outbox: [],
    deliveryResults: [],
    followUpMutationPlans: [],
    auditEvents: [],
    processedCorrelationIds: [],
    processedProviderMessageIds: [],
    updatedAt: null,
    ...overrides
  };
}

function makeLoopInput(
  fixture: ReturnType<typeof lowRiskPriceQuestionFixture> | ReturnType<typeof requestMoreContextFixture> | ReturnType<typeof humanHandoffFixture> | ReturnType<typeof complaintBlockedFixture> | ReturnType<typeof customerReplyCancelsFollowUpFixture> | ReturnType<typeof temporaryTransportFailureFixture> | ReturnType<typeof rateLimitedTransportFixture> | ReturnType<typeof permanentTransportFailureFixture> | ReturnType<typeof duplicateInboundFixture> | ReturnType<typeof duplicateExecutionFixture> | ReturnType<typeof closedCaseFixture> | ReturnType<typeof aiBlockedFixture> | ReturnType<typeof opportunityWonFixture>,
  overrides: Partial<AutonomousCommercialLoopInput> = {}
): AutonomousCommercialLoopInput {
  return Object.assign(cloneJson(fixture.input), cloneJson(overrides));
}

function makeFollowUpSchedulingInput(overrides: any = {}): FollowUpSchedulingInput {
  const base: FollowUpSchedulingInput = {
    now: FIXED_NOW,
    action: {
      actionId: "followup-action-001",
      idempotencyKey: "followup:test-001",
      actionType: "schedule_followup",
      status: "planned",
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: null,
      scheduledFor: "2026-06-17T12:30:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 0,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56911111111",
      blockReasons: [],
      cancelReason: null
    },
    activity: {
      lastInboundAt: null,
      lastOutboundAt: null,
      lastHumanMessageAt: null,
      lastAiMessageAt: null
    },
    context: {
      caseStatus: "open",
      lifecycleStatus: "open",
      humanOwnerActive: false,
      aiBlocked: false,
      requiresHuman: false,
      opportunityStatus: "open",
      opportunityStage: "discovery",
      opportunityStageChangedAt: null,
      policyStatus: "allowed",
      conflictingActionExists: false,
      duplicateActionExists: false
    },
    policy: {
      followUpEnabled: true,
      allowedActionTypes: ["schedule_followup", "send_followup_message", "request_more_context"],
      maxRiskLevel: "high",
      cooldownMinutesAfterInbound: 0,
      cooldownMinutesAfterOutbound: 0,
      businessHoursEnabled: false,
      businessTimezone: "America/Santiago",
      businessDays: [1, 2, 3, 4, 5],
      businessStartHour: 9,
      businessEndHour: 18,
      replanOutsideBusinessHours: true,
      replanAfterCooldown: true,
      requireExpiry: false,
      maxFutureDays: 30
    }
  };

  return {
    ...base,
    ...overrides,
    action: { ...base.action, ...(overrides.action ?? {}) },
    activity: { ...base.activity, ...(overrides.activity ?? {}) },
    context: { ...base.context, ...(overrides.context ?? {}) },
    policy: { ...base.policy, ...(overrides.policy ?? {}) }
  };
}

function buildFollowUpMutationInput(
  schedulingResult = evaluateFollowUpSchedule(makeFollowUpSchedulingInput()),
  overrides: any = {}
): FollowUpMutationInput {
  const base: FollowUpMutationInput = {
    now: FIXED_NOW,
    originalAction: {
      rowId: 1,
      actionId: "followup-action-001",
      idempotencyKey: "followup:test-001",
      actionType: "schedule_followup",
      status: "planned",
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: null,
      scheduledFor: "2026-06-17T12:30:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 1,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56911111111",
      draftMessage: "Hola, retomamos el seguimiento.",
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      parentActionId: null,
      supersededByActionId: null,
      lifecycleVersion: "brain.commercial.action-lifecycle.v1",
      policyVersion: "brain.commercial.policy.v1",
      runtimeVersion: "brain.commercial.runtime.v1"
    },
    schedulingResult,
    currentContext: {
      caseStatus: "open",
      lifecycleStatus: "open",
      humanOwnerActive: false,
      aiBlocked: false,
      requiresHuman: false,
      opportunityStatus: "open",
      opportunityStage: "discovery",
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
    originalAction: { ...base.originalAction, ...(overrides.originalAction ?? {}) },
    currentContext: { ...base.currentContext, ...(overrides.currentContext ?? {}) },
    policy: { ...base.policy, ...(overrides.policy ?? {}) }
  };
}

function readSourceTree(folder: string): string {
  const entries = readdirSync(folder, { withFileTypes: true });
  const chunks: string[] = [];
  for (const entry of entries) {
    const fullPath = resolve(folder, entry.name);
    if (entry.isDirectory()) {
      chunks.push(readSourceTree(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      chunks.push(readFileSync(fullPath, "utf8"));
    }
  }
  return chunks.join("\n");
}

function autonomousLoopSource(): string {
  const folder = resolve(process.cwd(), "lib/brain/commercial/autonomous-loop");
  return readSourceTree(folder);
}

function hasForbiddenSourceText(source: string): boolean {
  const pattern = new RegExp(
    [
      "D" + "ate\\.now",
      "r" + "andomUUID",
      "M" + "ath\\.random",
      "set" + "Timeout",
      "set" + "Interval",
      "pro" + "cess\\.env",
      "f" + "etch\\(",
      "my" + "sql2",
      "from ['\"]" + "pg" + "['\"]",
      "supa" + "base",
      "SE" + "LECT\\s",
      "IN" + "SERT\\s",
      "UP" + "DATE\\s",
      "DE" + "LETE\\s",
      "graph\\.facebook"
    ].join("|")
  );
  return pattern.test(source);
}

function assertCommonSafeSideEffects(result: AutonomousCommercialLoopResult): void {
  assert.equal(result.sideEffects.realDatabaseWritten, false);
  assert.equal(result.sideEffects.realOutboxWritten, false);
  assert.equal(result.sideEffects.realMessageSent, false);
  assert.equal(result.sideEffects.metaCalled, false);
  assert.equal(result.sideEffects.schedulerTriggered, false);
}

test("invalid timestamp fails closed", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const result = await evaluateAutonomousLoop(makeLoopInput(fixture, { now: "invalid" }));

  assert.equal(result.status, "invalid");
  assert.equal(result.errors[0]?.code, "invalid_timestamp");
  assertCommonSafeSideEffects(result);
});

test("operation loop disabled fails closed", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const result = await evaluateAutonomousLoop(
    makeLoopInput(fixture, {
      configuration: {
        ...fixture.input.configuration,
        operationalLoopEnabled: false
      }
    })
  );

  assert.equal(result.status, "invalid");
  assert.equal(result.errors[0]?.code, "operational_loop_disabled");
});

test("observe mode produces preview without execution", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const result = await evaluateAutonomousLoop(makeLoopInput(fixture, { mode: "observe" }));

  assert.equal(result.mode, "observe");
  assert.equal(result.finalStage, "sandbox");
  assert.equal(result.outbox.record, null);
  assert.equal(result.outbox.workerResult, null);
  assert.equal(result.sideEffects.fakeTransportCalled, false);
});

test("simulate mode produces preview without execution", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const result = await evaluateAutonomousLoop(makeLoopInput(fixture, { mode: "simulate" }));

  assert.equal(result.mode, "simulate");
  assert.equal(result.outbox.workerResult, null);
  assert.equal(result.sideEffects.fakeTransportCalled, false);
});

test("execute_fake mode runs the full pipeline", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const runtime = new InMemoryAutonomousCommercialRuntime();
  const result = await executeAutonomousLoop(makeLoopInput(fixture, { mode: "execute_fake" }), runtime);

  assert.equal(result.status, "delivered");
  assert.equal(result.finalStage, "delivery_reconciliation");
  assert.equal(result.outbox.workerResult?.status, "delivered");
  assert.equal(result.outbox.transportResult?.status, "accepted");
  assert.equal(result.reconciliation.actionStatusAfter, "executed");
  assertCommonSafeSideEffects(result);
});

test("duplicate correlation id is skipped", async () => {
  const fixture = duplicateInboundFixture();
  const result = await evaluateAutonomousLoop(fixture.input, fixture.snapshot);

  assert.equal(result.status, "completed");
  assert.ok(result.warnings.includes("duplicate_inbound"));
});

test("duplicate provider message id is skipped", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const snapshot = makeRuntimeSnapshot({
    processedProviderMessageIds: [fixture.input.inbound.providerMessageId ?? fixture.input.inbound.messageId]
  });
  const result = await evaluateAutonomousLoop(fixture.input, snapshot);

  assert.equal(result.status, "completed");
  assert.ok(result.warnings.includes("duplicate_inbound"));
});

test("low risk eligible reply is delivered", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const result = await executeAutonomousLoop(makeLoopInput(fixture, { mode: "execute_fake" }), new InMemoryAutonomousCommercialRuntime());

  assert.equal(result.status, "delivered");
  assert.equal(result.outbox.workerResult?.status, "delivered");
  assert.equal(result.reconciliation.actionStatusAfter, "executed");
});

test("reply not whitelisted is blocked", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const result = await evaluateAutonomousLoop(
    makeLoopInput(fixture, {
      configuration: {
        ...fixture.input.configuration,
        whitelistedWaIds: ["56922222222"]
      }
    })
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.executionGateResult?.status, "blocked");
});

test("medium or high risk is blocked", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const result = await evaluateAutonomousLoop(makeLoopInput(fixture, { scenario: { ...fixture.input.scenario, forceRiskLevel: "high" } }));

  assert.equal(result.status, "blocked");
});

test("approval required is blocked", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const result = await evaluateAutonomousLoop(makeLoopInput(fixture, { scenario: { ...fixture.input.scenario, forceApprovalRequirement: "operator_review" } }));

  assert.equal(result.status, "blocked");
});

test("human owner active requires human", async () => {
  const fixture = humanHandoffFixture();
  const result = await evaluateAutonomousLoop(makeLoopInput(fixture, { mode: "execute_fake" }));

  assert.equal(result.status, "requires_human");
});

test("ai blocked is blocked", async () => {
  const fixture = aiBlockedFixture();
  const result = await evaluateAutonomousLoop(makeLoopInput(fixture));

  assert.equal(result.status, "blocked");
});

test("case closed cancels the loop", async () => {
  const fixture = closedCaseFixture();
  const result = await evaluateAutonomousLoop(makeLoopInput(fixture));

  assert.equal(result.status, "cancelled");
});

test("opportunity won cancels the loop", async () => {
  const fixture = opportunityWonFixture();
  const result = await evaluateAutonomousLoop(makeLoopInput(fixture));

  assert.equal(result.status, "cancelled");
});

test("opportunity paused blocks the loop", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const result = await evaluateAutonomousLoop(
    makeLoopInput(fixture, {
      commercialContext: {
        ...fixture.input.commercialContext,
        opportunityStatus: "paused"
      }
    })
  );

  assert.equal(result.status, "blocked");
});

test("request more context can execute through the fake transport", async () => {
  const fixture = requestMoreContextFixture();
  const result = await executeAutonomousLoop(makeLoopInput(fixture), new InMemoryAutonomousCommercialRuntime());

  assert.equal(result.outbox.workerResult?.status, "delivered");
  assert.equal(result.outbox.transportResult?.status, "accepted");
});

test("temporary transport failure schedules retry", async () => {
  const fixture = temporaryTransportFailureFixture();
  const result = await executeAutonomousLoop(makeLoopInput(fixture), new InMemoryAutonomousCommercialRuntime());

  assert.equal(result.status, "retry_scheduled");
  assert.equal(result.outbox.workerResult?.status, "retry_scheduled");
});

test("timeout transport failure schedules retry", async () => {
  const fixture = temporaryTransportFailureFixture();
  const result = await executeAutonomousLoop(
    makeLoopInput(fixture, {
      scenario: {
        ...fixture.input.scenario,
        transportScenario: "timeout"
      }
    }),
    new InMemoryAutonomousCommercialRuntime()
  );

  assert.equal(result.status, "retry_scheduled");
  assert.equal(result.outbox.workerResult?.status, "retry_scheduled");
});

test("rate limited transport schedules retry with retry-after", async () => {
  const fixture = rateLimitedTransportFixture();
  const result = await executeAutonomousLoop(makeLoopInput(fixture), new InMemoryAutonomousCommercialRuntime());

  assert.equal(result.status, "retry_scheduled");
  assert.equal(result.outbox.transportResult?.status, "rate_limited");
  assert.equal(result.outbox.transportResult?.retryAfterSeconds, 30);
});

test("permanent transport failure dead letters the message", async () => {
  const fixture = permanentTransportFailureFixture();
  const result = await executeAutonomousLoop(makeLoopInput(fixture), new InMemoryAutonomousCommercialRuntime());

  assert.equal(result.status, "dead_letter");
  assert.equal(result.outbox.workerResult?.status, "dead_letter");
});

test("transport disabled keeps the worker from sending", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const result = await executeAutonomousLoop(
    makeLoopInput(fixture, {
      configuration: {
        ...fixture.input.configuration,
        messageTransportEnabled: false
      }
    }),
    new InMemoryAutonomousCommercialRuntime()
  );

  assert.equal(result.outbox.workerResult?.status, "skipped");
  assert.equal(result.outbox.transportResult, null);
});

test("worker disabled keeps the worker from sending", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const result = await executeAutonomousLoop(
    makeLoopInput(fixture, {
      configuration: {
        ...fixture.input.configuration,
        outboxWorkerEnabled: false
      }
    }),
    new InMemoryAutonomousCommercialRuntime()
  );

  assert.equal(result.outbox.workerResult?.status, "skipped");
  assert.equal(result.outbox.transportResult, null);
});

test("same input yields the same run id and deterministic outbox ids", () => {
  const fixture = lowRiskPriceQuestionFixture();
  const input = fixture.input;
  const runIdA = buildAutonomousLoopRunId({
    tenantId: input.tenantId,
    correlationId: input.correlationId,
    messageId: input.inbound.messageId,
    now: input.now
  });
  const runIdB = buildAutonomousLoopRunId({
    tenantId: input.tenantId,
    correlationId: input.correlationId,
    messageId: input.inbound.messageId,
    now: input.now
  });
  const outboxIdA = buildOutboxRecordId({
    runId: runIdA,
    actionId: "action-001",
    commandId: "command-001",
    idempotencyKey: "idempotency-001"
  });
  const outboxIdB = buildOutboxRecordId({
    runId: runIdB,
    actionId: "action-001",
    commandId: "command-001",
    idempotencyKey: "idempotency-001"
  });
  const auditIdA = buildAutonomousAuditEventId({
    runId: runIdA,
    stage: "audit",
    eventType: "loop_completed",
    entityId: input.correlationId,
    status: "completed",
    createdAt: input.now
  });
  const auditIdB = buildAutonomousAuditEventId({
    runId: runIdB,
    stage: "audit",
    eventType: "loop_completed",
    entityId: input.correlationId,
    status: "completed",
    createdAt: input.now
  });
  const deliveryIdA = buildDeliveryReconciliationId({
    runId: runIdA,
    outboxRowId: 1,
    status: "delivered",
    completedAt: input.now
  });
  const deliveryIdB = buildDeliveryReconciliationId({
    runId: runIdB,
    outboxRowId: 1,
    status: "delivered",
    completedAt: input.now
  });

  assert.equal(runIdA, runIdB);
  assert.equal(outboxIdA, outboxIdB);
  assert.equal(auditIdA, auditIdB);
  assert.equal(deliveryIdA, deliveryIdB);
});

test("execute_fake keeps the input immutable", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const input = cloneJson(fixture.input);
  const snapshot = cloneJson(input);

  await executeAutonomousLoop(input, new InMemoryAutonomousCommercialRuntime());

  assert.deepEqual(input, snapshot);
});

test("same input and same runtime state produce the same result", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const runtimeA = new InMemoryAutonomousCommercialRuntime();
  const runtimeB = new InMemoryAutonomousCommercialRuntime();
  const resultA = await executeAutonomousLoop(makeLoopInput(fixture), runtimeA);
  const resultB = await executeAutonomousLoop(makeLoopInput(fixture), runtimeB);

  assert.deepEqual(
    {
      status: resultA.status,
      finalStage: resultA.finalStage,
      runId: resultA.runId,
      outboxCommandId: resultA.outbox.command?.commandId ?? null,
      workerStatus: resultA.outbox.workerResult?.status ?? null,
      providerMessageId: resultA.outbox.transportResult?.providerMessageId ?? null
    },
    {
      status: resultB.status,
      finalStage: resultB.finalStage,
      runId: resultB.runId,
      outboxCommandId: resultB.outbox.command?.commandId ?? null,
      workerStatus: resultB.outbox.workerResult?.status ?? null,
      providerMessageId: resultB.outbox.transportResult?.providerMessageId ?? null
    }
  );
});

test("delivered message is not duplicated on the same runtime", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const runtime = new InMemoryAutonomousCommercialRuntime();
  const first = await executeAutonomousLoop(makeLoopInput(fixture), runtime);
  const second = await executeAutonomousLoop(makeLoopInput(fixture), runtime);

  assert.equal(first.status, "delivered");
  assert.equal(second.status, "completed");
  assert.ok(second.warnings.includes("duplicate_inbound"));
  assert.equal(runtime.getSnapshot().outbox.length, 1);
});

test("follow-up scheduling wait and ready are deterministic", () => {
  const waitResult = evaluateFollowUpSchedule(
    makeFollowUpSchedulingInput({
      action: {
        scheduledFor: "2026-06-17T14:00:00.000Z"
      }
    })
  );
  const readyResult = evaluateFollowUpSchedule(
    makeFollowUpSchedulingInput({
      action: {
        scheduledFor: FIXED_NOW
      }
    })
  );

  assert.equal(waitResult.decision, "wait");
  assert.equal(readyResult.decision, "ready");
});

test("follow-up expiry wins over ready", () => {
  const result = evaluateFollowUpSchedule(
    makeFollowUpSchedulingInput({
      action: {
        expiresAt: "2026-06-17T11:00:00.000Z"
      }
    })
  );

  assert.equal(result.decision, "expire");
  assert.ok(result.reasons.includes("action_expired"));
});

test("follow-up blocks on policy, risk, approval, human ownership and AI block", () => {
  const blockedByPolicy = evaluateFollowUpSchedule(
    makeFollowUpSchedulingInput({
      policy: {
        ...makeFollowUpSchedulingInput().policy,
        followUpEnabled: false
      }
    })
  );
  const blockedByRisk = evaluateFollowUpSchedule(
    makeFollowUpSchedulingInput({
      action: {
        riskLevel: "critical"
      }
    })
  );
  const blockedByApproval = evaluateFollowUpSchedule(
    makeFollowUpSchedulingInput({
      action: {
        approvalRequirement: "operator_review"
      }
    })
  );
  const blockedByHuman = evaluateFollowUpSchedule(
    makeFollowUpSchedulingInput({
      context: {
        humanOwnerActive: true
      }
    })
  );
  const blockedByAi = evaluateFollowUpSchedule(
    makeFollowUpSchedulingInput({
      context: {
        aiBlocked: true
      }
    })
  );

  assert.equal(blockedByPolicy.decision, "cancel");
  assert.equal(blockedByRisk.decision, "block");
  assert.equal(blockedByApproval.decision, "block");
  assert.equal(blockedByHuman.decision, "cancel");
  assert.equal(blockedByAi.decision, "block");
});

test("customer reply cancels follow-up through the loop", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const input = makeLoopInput(fixture, {
    mode: "execute_fake",
    scenario: {
      ...fixture.input.scenario,
      forceActionType: "schedule_followup",
      forceDecision: "respond_now",
      forceRiskLevel: "low",
      forceApprovalRequirement: "none"
    },
    commercialContext: {
      ...fixture.input.commercialContext,
      lastInboundAt: "2026-06-17T13:00:00.000Z"
    }
  });
  const result = await executeAutonomousLoop(input, new InMemoryAutonomousCommercialRuntime());

  assert.equal(result.followUp.schedulingResult?.decision, "cancel");
  assert.equal(result.followUp.mutationPlan?.planType, "cancel_action");
  assert.equal(result.status, "cancelled");
});

test("stage change replans follow-up through the loop", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const input = makeLoopInput(fixture, {
    mode: "execute_fake",
    scenario: {
      ...fixture.input.scenario,
      forceActionType: "schedule_followup",
      forceDecision: "respond_now",
      forceRiskLevel: "low",
      forceApprovalRequirement: "none"
    },
    commercialContext: {
      ...fixture.input.commercialContext,
      opportunityStageChangedAt: "2026-06-17T13:00:00.000Z"
    }
  });
  const result = await executeAutonomousLoop(input, new InMemoryAutonomousCommercialRuntime());

  assert.equal(result.followUp.schedulingResult?.decision, "replan");
  assert.ok(["replan_action", "supersede_action", "cancel_and_create_replacement"].includes(result.followUp.mutationPlan?.planType ?? ""));
});

test("follow-up mutation plan can be applied in memory", () => {
  const schedulingResult = evaluateFollowUpSchedule(
    makeFollowUpSchedulingInput({
      action: {
        scheduledFor: FIXED_NOW
      }
    })
  );
  const plan = buildFollowUpMutationPlan(buildFollowUpMutationInput(schedulingResult));
  const result = applyFollowUpMutationPlanInMemory(
    {
      actions: [
        {
          rowId: 1,
          actionId: "followup-action-001",
          idempotencyKey: "followup:test-001",
          actionType: "schedule_followup",
          status: "planned",
          scheduledFor: FIXED_NOW,
          expiresAt: "2026-06-18T12:00:00.000Z",
          attemptCount: 1,
          maxAttempts: 3,
          riskLevel: "low",
          approvalRequirement: "none",
          opportunityId: "opp-001",
          conversationCaseId: "case-001",
          waId: "56911111111",
          draftMessage: "Hola, retomamos el seguimiento.",
          finalMessage: null,
          blockReasons: [],
          cancelReason: null,
          supersededByActionId: null,
          parentActionId: null,
          generation: 1,
          lifecycleVersion: "brain.commercial.action-lifecycle.v1",
          policyVersion: "brain.commercial.policy.v1",
          runtimeVersion: "brain.commercial.runtime.v1",
          createdAt: "2026-06-17T10:00:00.000Z",
          updatedAt: null
        }
      ],
      auditEvents: [],
      appliedPlanKeys: []
    },
    plan
  );

  assert.equal(result.rolledBack, false);
  assert.equal(result.applied, true);
});

test("orchestrator result exposes safe side effects only", async () => {
  const fixture = lowRiskPriceQuestionFixture();
  const result = await executeAutonomousLoop(makeLoopInput(fixture), new InMemoryAutonomousCommercialRuntime());

  assertCommonSafeSideEffects(result);
  assert.equal(result.sideEffects.fakeTransportCalled, true);
});

test("autonomous loop source is free of forbidden runtime and storage calls", () => {
  const source = autonomousLoopSource();
  assert.equal(hasForbiddenSourceText(source), false);
});
