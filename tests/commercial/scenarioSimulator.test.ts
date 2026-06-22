import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildScenarioExpectationResultId,
  buildScenarioReportId,
  buildScenarioRunId,
  buildScenarioStepRunId,
  compareScenarioExpectation,
  executeScenario,
  exportScenarioSafeResult,
  getScenarioDefinitionById,
  validateScenarioDefinition,
  validateScenarioInvariants,
  type ScenarioDefinition,
  type ScenarioExpectation,
  type ScenarioStep,
  type ScenarioStepResult
} from "../../lib/brain/commercial/scenario-simulator/index.js";
import { lowRiskPriceQuestionFixture } from "../../lib/brain/commercial/autonomous-loop/index.js";

const FIXED_NOW = "2026-06-17T12:00:00.000Z";
const SIMULATOR_VERSION = "brain.commercial.scenario-simulator.v1";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function makeBaseStep(stepId = "step-1", title = "Paso sintético", now = FIXED_NOW): ScenarioStep {
  return {
    stepId,
    title,
    now,
    mode: "execute_fake",
    input: clone(lowRiskPriceQuestionFixture().input),
    expectedCheckpointIds: ["loop_status:delivered"],
    notes: ["synthetic"],
    replayFollowUp: false
  };
}

function makeBaseScenario(overrides: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return {
    scenarioId: "scenario-simulator-base",
    name: "Scenario simulator base",
    description: "Synthetic scenario for simulator tests.",
    category: "sales",
    tags: ["synthetic", "test"],
    initialState: {
      runtimeSeed: {
        opportunities: [],
        decisions: [],
        actions: [],
        outbox: [],
        deliveryResults: [],
        auditEvents: []
      },
      configuration: {
        sandboxAutonomyEnabled: true,
        autonomousReplyEnabled: true,
        whitelistedWaIds: ["56911111111"],
        executionGateEnabled: true,
        outboxBridgeEnabled: true,
        outboxWorkerEnabled: true,
        messageTransportEnabled: true,
        followUpEnabled: true,
        sandboxRequired: true
      }
    },
    steps: [makeBaseStep()],
    expectations: [],
    metadata: {
      version: SIMULATOR_VERSION,
      deterministic: true,
      syntheticDataOnly: true
    },
    ...overrides
  };
}

function makeStepResult(overrides: Partial<ScenarioStepResult> = {}): ScenarioStepResult {
  const baseInput = makeBaseStep().input;
  const base = {
    stepId: "step-1",
    index: 0,
    title: "Paso sintético",
    inputSummary: {
      scenarioId: "scenario-simulator-base",
      stepId: "step-1",
      mode: "execute_fake" as ScenarioStepResult["inputSummary"]["mode"],
      now: FIXED_NOW,
      correlationId: baseInput.correlationId,
      tenantId: baseInput.tenantId,
      waIdMasked: "5691111****",
      caseId: baseInput.caseContext.caseId,
      opportunityId: baseInput.commercialContext.opportunityId,
      messageId: baseInput.inbound.messageId,
      actionTypeHint: baseInput.scenario.forceActionType ?? null,
      transportScenario: baseInput.scenario.transportScenario,
      noteCount: 1
    },
    loopResult: {
      runId: "scenario-run:base",
      correlationId: baseInput.correlationId,
      tenantId: baseInput.tenantId,
      mode: "execute_fake",
      status: "delivered",
      finalStage: "delivery_reconciliation",
      opportunity: { opportunityId: 202 },
      decision: { decision: "respond_now", type: "respond_now", actionId: "decision-1" },
      action: {
        actionId: "action-1",
        actionType: "send_whatsapp_reply",
        status: "executed"
      },
      sandboxEvaluation: null,
      executionGateResult: null,
      outbox: {
        command: null,
        record: null,
        workerResult: { status: "delivered" },
        transportResult: { status: "accepted", providerMessageId: "wamid-1", errorCode: null, errorMessageSafe: null, retryAfterSeconds: null }
      },
      followUp: {
        schedulingResult: {
          decision: "ready",
          actionable: true,
          actionId: "followup-action-1",
          reasons: [],
          warnings: [],
          originalScheduledFor: FIXED_NOW,
          effectiveScheduledFor: FIXED_NOW,
          nextScheduledFor: FIXED_NOW,
          timing: {
            evaluatedAt: FIXED_NOW,
            due: true,
            expired: false,
            cooldownUntil: null,
            outsideBusinessHours: false
          },
          retry: {
            attemptCount: 0,
            maxAttempts: 3,
            attemptsRemaining: 3
          },
          sideEffects: {
            actionUpdated: false,
            actionInserted: false,
            outboxWritten: false,
            messageSent: false,
            workerTriggered: false
          }
        },
        mutationPlan: null,
        mutationApplyResult: null
      },
      reconciliation: {
        actionStatusBefore: "planned",
        actionStatusAfter: "executed",
        deliveryStatus: "delivered",
        providerMessageId: "wamid-1",
        followUpRequired: false
      },
      auditTrail: [
        {
          eventId: "audit-1",
          runId: "scenario-run:base",
          stage: "audit",
          eventType: "loop_completed",
          entityType: "runtime",
          entityId: "runtime-1",
          status: "completed",
          reason: null,
          metadata: {},
          createdAt: FIXED_NOW
        }
      ],
      warnings: [],
      errors: [],
      sideEffects: {
        realDatabaseWritten: false,
        realOutboxWritten: false,
        realMessageSent: false,
        metaCalled: false,
        schedulerTriggered: false,
        inMemoryStateChanged: true,
        fakeTransportCalled: true
      },
      startedAt: FIXED_NOW,
      completedAt: FIXED_NOW
    },
    previousSnapshot: {
      opportunities: [],
      decisions: [],
      actions: [],
      outbox: [],
      deliveryResults: [],
      followUpMutationPlans: [],
      auditEvents: [],
      processedCorrelationIds: [],
      processedProviderMessageIds: [],
      updatedAt: null
    },
    nextSnapshot: {
      opportunities: [],
      decisions: [],
      actions: [],
      outbox: [],
      deliveryResults: [],
      followUpMutationPlans: [],
      auditEvents: [],
      processedCorrelationIds: [],
      processedProviderMessageIds: [],
      updatedAt: null
    },
    stateDiff: {
      opportunities: { added: [], updated: [], removed: [] },
      decisions: { added: [] },
      actions: { added: [], updated: [], removed: [] },
      outbox: { added: [], updated: [] },
      audit: { addedCount: 1 }
    },
    expectationResults: [],
    invariantResults: [],
    followUpReplay: null,
    passed: true,
    ...overrides
  } as ScenarioStepResult;
  return base;
}

function makeExpectation(overrides: Partial<ScenarioExpectation> = {}): ScenarioExpectation {
  return {
    expectationId: "expectation-1",
    stepId: "step-1",
    type: "loop_status",
    path: "loop.status",
    operator: "equals",
    expected: "delivered",
    ...overrides
  };
}

function makeInvalidScenario(overrides: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return makeBaseScenario(overrides);
}

function readTree(folder: string): string {
  const entries = readdirSync(folder, { withFileTypes: true });
  const parts: string[] = [];
  for (const entry of entries) {
    const fullPath = resolve(folder, entry.name);
    if (entry.isDirectory()) {
      parts.push(readTree(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      parts.push(readFileSync(fullPath, "utf8"));
    }
  }
  return parts.join("\n");
}

function collectSource(): string {
  const folders = [
    resolve(process.cwd(), "lib/brain/commercial/scenario-simulator"),
    resolve(process.cwd(), "components/cases/ai-sdr/scenario-simulator")
  ];
  return folders.map((folder) => readTree(folder)).join("\n");
}

function buildExpectedScenarioRunId(scenario: ScenarioDefinition): string {
  return buildScenarioRunId({
    scenarioId: scenario.scenarioId,
    stepCount: scenario.steps.length,
    tenantId: String(scenario.steps[0]?.input.tenantId ?? "tenant-scenario-simulator"),
    initialStateHash: JSON.stringify({
      runtimeSeed: scenario.initialState.runtimeSeed,
      configuration: scenario.initialState.configuration
    })
  });
}

test("validation fails closed for invalid scenario id, empty steps, duplicate step ids, timestamps, unsafe text and recipients", () => {
  const invalidId = validateScenarioDefinition(makeInvalidScenario({ scenarioId: "" }));
  const emptySteps = validateScenarioDefinition(makeInvalidScenario({ steps: [] }));
  const duplicateStep = validateScenarioDefinition(makeInvalidScenario({ steps: [makeBaseStep(), makeBaseStep()] }));
  const invalidTimestamp = validateScenarioDefinition(makeInvalidScenario({ steps: [makeBaseStep("step-1", "Paso", "invalid")] }));
  const unsafeToken = validateScenarioDefinition(
    makeInvalidScenario({
      steps: [
        {
          ...makeBaseStep(),
          input: {
            ...makeBaseStep().input,
            inbound: { ...makeBaseStep().input.inbound, text: "Bearer secret-token" }
          }
        }
      ]
    })
  );
  const realRecipient = validateScenarioDefinition(
    makeInvalidScenario({
      steps: [
        {
          ...makeBaseStep(),
          input: {
            ...makeBaseStep().input,
            inbound: { ...makeBaseStep().input.inbound, waId: "+1234567890" }
          }
        }
      ]
    })
  );

  assert.equal(invalidId.ok, false);
  assert.equal(emptySteps.ok, false);
  assert.equal(duplicateStep.ok, false);
  assert.equal(invalidTimestamp.ok, false);
  assert.equal(unsafeToken.ok, false);
  assert.equal(realRecipient.ok, false);
});

test("catalog scenarios validate", () => {
  for (const scenarioId of [
    "low-risk-autonomous-reply",
    "request-more-context",
    "recipient-not-whitelisted",
    "human-handoff",
    "complaint-blocked",
    "closed-case",
    "ai-blocked",
    "opportunity-won",
    "temporary-transport-failure",
    "rate-limit",
    "permanent-transport-failure",
    "duplicate-inbound",
    "duplicate-execution",
    "follow-up-wait",
    "follow-up-ready",
    "customer-reply-cancels-follow-up",
    "human-takeover-cancels-follow-up",
    "opportunity-stage-replacement",
    "follow-up-expired",
    "max-attempts-exhausted",
    "full-rollback"
  ]) {
    const scenario = getScenarioDefinitionById(scenarioId);
    assert.ok(scenario, `scenario ${scenarioId} should exist`);
    const validation = validateScenarioDefinition(clone(scenario!));
    assert.equal(validation.ok, true, scenarioId);
  }
});

test("observe, simulate and execute_fake modes are supported", async () => {
  const observeScenario = makeBaseScenario({
    scenarioId: "observe-scenario",
    steps: [{ ...makeBaseStep(), mode: "observe" }],
    expectations: []
  });
  const simulateScenario = makeBaseScenario({
    scenarioId: "simulate-scenario",
    steps: [{ ...makeBaseStep(), mode: "simulate" }],
    expectations: []
  });
  const executeScenarioDef = makeBaseScenario({
    scenarioId: "execute-fake-scenario",
    steps: [{ ...makeBaseStep(), mode: "execute_fake" }],
    expectations: []
  });

  const observe = await executeScenario(observeScenario);
  const simulate = await executeScenario(simulateScenario);
  const executed = await executeScenario(executeScenarioDef);

  assert.equal(observe.steps[0]?.loopResult.mode, "observe");
  assert.equal(simulate.steps[0]?.loopResult.mode, "simulate");
  assert.equal(executed.steps[0]?.loopResult.mode, "execute_fake");
});

test("critical catalog scenarios produce their expected loop outcomes", async () => {
  const lowRisk = await executeScenario(getScenarioDefinitionById("low-risk-autonomous-reply")!);
  const requestMore = await executeScenario(getScenarioDefinitionById("request-more-context")!);
  const whitelist = await executeScenario(getScenarioDefinitionById("recipient-not-whitelisted")!);
  const human = await executeScenario(getScenarioDefinitionById("human-handoff")!);
  const complaint = await executeScenario(getScenarioDefinitionById("complaint-blocked")!);
  const closedCase = await executeScenario(getScenarioDefinitionById("closed-case")!);
  const aiBlocked = await executeScenario(getScenarioDefinitionById("ai-blocked")!);
  const opportunityWon = await executeScenario(getScenarioDefinitionById("opportunity-won")!);

  assert.equal(lowRisk.steps[0]?.loopResult.status, "delivered");
  assert.equal(requestMore.steps[0]?.loopResult.status, "delivered");
  assert.equal(whitelist.steps[0]?.loopResult.status, "blocked");
  assert.equal(human.steps[0]?.loopResult.status, "requires_human");
  assert.equal(complaint.steps[0]?.loopResult.status, "blocked");
  assert.equal(closedCase.steps[0]?.loopResult.status, "cancelled");
  assert.equal(aiBlocked.steps[0]?.loopResult.status, "blocked");
  assert.equal(opportunityWon.steps[0]?.loopResult.status, "cancelled");
});

test("transport and retry catalog scenarios produce the right terminal states", async () => {
  const temporaryFailure = await executeScenario(getScenarioDefinitionById("temporary-transport-failure")!);
  const rateLimit = await executeScenario(getScenarioDefinitionById("rate-limit")!);
  const permanentFailure = await executeScenario(getScenarioDefinitionById("permanent-transport-failure")!);

  assert.equal(temporaryFailure.steps[0]?.loopResult.status, "retry_scheduled");
  assert.equal(rateLimit.steps[0]?.loopResult.status, "retry_scheduled");
  assert.equal(rateLimit.steps[0]?.loopResult.outbox.transportResult?.retryAfterSeconds, 30);
  assert.equal(permanentFailure.steps[0]?.loopResult.status, "dead_letter");
});

test("idempotency scenarios stay stable across reruns", async () => {
  const duplicateInbound = getScenarioDefinitionById("duplicate-inbound")!;
  const duplicateExecution = getScenarioDefinitionById("duplicate-execution")!;
  const duplicateInboundResult = await executeScenario(duplicateInbound);
  const duplicateExecutionResult = await executeScenario(duplicateExecution);

  assert.equal(duplicateInboundResult.steps[1]?.loopResult.status, "completed");
  assert.equal(duplicateExecutionResult.steps[1]?.loopResult.status, "completed");
  assert.equal(duplicateExecutionResult.steps[1]?.stateDiff.outbox.added.length, 0);
});

test("follow-up catalog scenarios cover wait, ready, cancel, replan, expire and max attempts", async () => {
  const wait = await executeScenario(getScenarioDefinitionById("follow-up-wait")!);
  const ready = await executeScenario(getScenarioDefinitionById("follow-up-ready")!);
  const cancel = await executeScenario(getScenarioDefinitionById("customer-reply-cancels-follow-up")!);
  const humanCancel = await executeScenario(getScenarioDefinitionById("human-takeover-cancels-follow-up")!);
  const replan = await executeScenario(getScenarioDefinitionById("opportunity-stage-replacement")!);
  const expired = await executeScenario(getScenarioDefinitionById("follow-up-expired")!);
  const maxAttempts = await executeScenario(getScenarioDefinitionById("max-attempts-exhausted")!);

  assert.equal(wait.steps[0]?.followUpReplay?.schedulingResult?.decision, "wait");
  assert.equal(ready.steps[0]?.followUpReplay?.schedulingResult?.decision, "ready");
  assert.equal(cancel.steps[1]?.followUpReplay?.schedulingResult?.decision, "cancel");
  assert.equal(humanCancel.steps[1]?.followUpReplay?.schedulingResult?.decision, "cancel");
  assert.equal(replan.steps[1]?.followUpReplay?.schedulingResult?.decision, "replan");
  assert.equal(expired.steps[0]?.followUpReplay?.schedulingResult?.decision, "expire");
  assert.equal(maxAttempts.steps[0]?.followUpReplay?.schedulingResult?.decision, "expire");
});

test("full rollback scenario fails without leaving partial side effects", async () => {
  const fullRollback = await executeScenario(getScenarioDefinitionById("full-rollback")!, { failureMode: "after_outbox" });
  assert.equal(fullRollback.steps[0]?.loopResult.status, "failed");
  assert.equal(fullRollback.finalSnapshot.outbox.length, 0);
});

test("previous and next snapshots preserve state between steps", async () => {
  const scenario = getScenarioDefinitionById("customer-reply-cancels-follow-up")!;
  const result = await executeScenario(scenario);
  const first = result.steps[0];
  const second = result.steps[1];

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.previousSnapshot.actions.length, 1);
  assert.equal(first.nextSnapshot.actions.length, 2);
  assert.equal(second.previousSnapshot.actions.length, 2);
  assert.equal(second.nextSnapshot.actions.length, second.previousSnapshot.actions.length);
});

test("state diff exposes actions and outbox safely", async () => {
  const result = await executeScenario(getScenarioDefinitionById("low-risk-autonomous-reply")!);
  const step = result.steps[0];

  assert.ok(step.stateDiff.actions.added.length >= 1);
  assert.ok(step.stateDiff.outbox.added.length >= 0);
  assert.ok(step.stateDiff.audit.addedCount >= 0);
});

test("expectation comparison supports equals, contains, exists and greater_than", () => {
  const stepResult = makeStepResult({
    loopResult: {
      ...makeStepResult().loopResult,
      status: "delivered",
      decision: { decision: "respond_now" },
      outbox: {
        ...makeStepResult().loopResult.outbox,
        workerResult: { status: "delivered" }
      }
  } as ScenarioStepResult["loopResult"]
  });

  const equals = compareScenarioExpectation(makeExpectation({ path: "loop.status", expected: "delivered", operator: "equals" }), stepResult, stepResult.nextSnapshot);
  const contains = compareScenarioExpectation(makeExpectation({ path: "loop.finalStage", operator: "contains", expected: "delivery", type: "final_stage", expectationId: "exp-2" }), stepResult, stepResult.nextSnapshot);
  const greaterThan = compareScenarioExpectation(makeExpectation({ path: "runtime.actions.count", operator: "greater_than", expected: -1, type: "runtime_count", expectationId: "exp-5" }), stepResult, stepResult.nextSnapshot);
  const exists = compareScenarioExpectation(makeExpectation({ path: "action.status", operator: "exists", expected: true, type: "action_status", expectationId: "exp-3" }), stepResult, stepResult.nextSnapshot);
  const invalidPath = compareScenarioExpectation(makeExpectation({ path: "report.result.status", operator: "equals", expected: "delivered", expectationId: "exp-4" }), stepResult, stepResult.nextSnapshot);

  assert.equal(equals.passed, true);
  assert.equal(contains.passed, true);
  assert.equal(greaterThan.passed, true);
  assert.equal(exists.passed, true);
  assert.equal(invalidPath.passed, false);
});

test("invariants detect duplicate ids, orphan outbox, missing delivery and terminal issues", () => {
  const step = makeBaseStep();
  const prev = makeStepResult().previousSnapshot;
  const baseStepResult = makeStepResult();
  const next = makeStepResult({
    nextSnapshot: {
      ...baseStepResult.nextSnapshot,
      actions: [
        { actionId: "action-1", status: "executed", createdAt: FIXED_NOW, updatedAt: FIXED_NOW, source: { actionId: "action-1", status: "planned", idempotencyKey: "dup-1" } },
        { actionId: "action-1", status: "planned", createdAt: FIXED_NOW, updatedAt: FIXED_NOW, source: { actionId: "action-1", status: "planned", idempotencyKey: "dup-1" } }
      ],
      outbox: [
        { rowId: 1, actionId: "missing-action", idempotencyKey: "outbox-1", status: "pending", providerMessageId: null } as never
      ],
      deliveryResults: [],
      auditEvents: [
        { eventId: "audit-1", runId: "run", stage: "audit", eventType: "loop_completed", entityType: "runtime", entityId: "entity", status: "completed", reason: null, metadata: {}, createdAt: FIXED_NOW }
      ]
    }
  });
  const results = validateScenarioInvariants(makeStepResult(), prev, next.nextSnapshot, step);

  assert.ok(results.some((item) => item.invariantId === "duplicate_action_id" && !item.passed));
  assert.ok(results.some((item) => item.invariantId === "duplicate_idempotency_key" && !item.passed));
  assert.ok(results.some((item) => item.invariantId === "no_orphan_outbox" && !item.passed));
  assert.ok(results.some((item) => item.invariantId === "executed_requires_delivery" && !item.passed));
});

test("invariants detect replacement lineage and terminal reactivation", () => {
  const step = makeBaseStep();
  const prev = makeStepResult().previousSnapshot;
  const next = makeStepResult({
    nextSnapshot: {
      ...makeStepResult().nextSnapshot,
      actions: [
        {
          actionId: "child-1",
          status: "scheduled",
          createdAt: FIXED_NOW,
          updatedAt: FIXED_NOW,
          source: { actionId: "child-1", status: "scheduled", idempotencyKey: "child-1", parentActionId: null, supersededByActionId: "parent-1" }
        }
      ]
    }
  });
  const results = validateScenarioInvariants(makeStepResult(), prev, next.nextSnapshot, step);
  assert.ok(results.some((item) => item.invariantId === "replacement_has_parent" && !item.passed));
  assert.ok(results.some((item) => item.invariantId === "terminal_action_immutable" && item.passed));
});

test("invariants detect retry duplication, leaks and safe side effects", () => {
  const step = makeBaseStep();
  const prev = makeStepResult().previousSnapshot;
  const next = makeStepResult({
    nextSnapshot: {
      ...makeStepResult().nextSnapshot,
      actions: [
        {
          actionId: "action-1",
          status: "executed",
          createdAt: FIXED_NOW,
          updatedAt: FIXED_NOW,
          source: { actionId: "action-1", status: "executed", idempotencyKey: "retry-1" }
        }
      ],
      outbox: [
        { rowId: 1, actionId: "action-1", idempotencyKey: "outbox-1", status: "delivered", providerMessageId: null } as never,
        { rowId: 1, actionId: "action-1", idempotencyKey: "outbox-1", status: "delivered", providerMessageId: null } as never
      ],
      auditEvents: [
        { eventId: "audit-1", runId: "run", stage: "audit", eventType: "loop_completed", entityType: "runtime", entityId: "entity", status: "completed", reason: null, metadata: {}, createdAt: FIXED_NOW }
      ],
      processedCorrelationIds: ["corr-1", "corr-1"]
    }
  });
  const stepResult = makeStepResult({
    loopResult: {
      ...makeStepResult().loopResult,
      sideEffects: {
        realDatabaseWritten: false,
        realOutboxWritten: false,
        realMessageSent: false,
        metaCalled: false,
        schedulerTriggered: false,
        inMemoryStateChanged: true,
        fakeTransportCalled: true
      }
    } as ScenarioStepResult["loopResult"]
  });
  const results = validateScenarioInvariants(stepResult, prev, next.nextSnapshot, step);

  assert.ok(results.some((item) => item.invariantId === "retry_does_not_duplicate_outbox" && !item.passed));
  assert.ok(results.some((item) => item.invariantId === "same_inbound_no_second_executable_decision" && !item.passed));
  assert.ok(results.some((item) => item.invariantId === "real_side_effects_false" && item.passed));
});

test("invariants detect phone, message and token leaks", () => {
  const step = makeBaseStep();
  const prev = makeStepResult().previousSnapshot;
  const leakedText = JSON.stringify({
    phone: step.input.inbound.waId,
    message: step.input.inbound.text,
    token: "Bearer leaked-token"
  });
  const next = makeStepResult({
    nextSnapshot: {
      ...makeStepResult().nextSnapshot,
      auditEvents: [
        {
          eventId: "audit-leak",
          runId: "run",
          stage: "audit",
          eventType: "loop_completed",
          entityType: "runtime",
          entityId: "entity",
          status: "completed",
          reason: null,
          metadata: { leakedText },
          createdAt: FIXED_NOW
        }
      ]
    }
  });
  const results = validateScenarioInvariants(makeStepResult(), prev, next.nextSnapshot, step);

  assert.ok(results.some((item) => item.invariantId === "phone_not_exposed" && !item.passed));
  assert.ok(results.some((item) => item.invariantId === "message_not_exposed" && !item.passed));
  assert.ok(results.some((item) => item.invariantId === "token_not_exposed" && !item.passed));
});

test("deterministic identifiers are stable", () => {
  const scenario = makeBaseScenario();
  const runIdA = buildScenarioRunId({
    scenarioId: scenario.scenarioId,
    stepCount: scenario.steps.length,
    tenantId: "tenant-1",
    initialStateHash: JSON.stringify(scenario.initialState)
  });
  const runIdB = buildScenarioRunId({
    scenarioId: scenario.scenarioId,
    stepCount: scenario.steps.length,
    tenantId: "tenant-1",
    initialStateHash: JSON.stringify(scenario.initialState)
  });
  const stepRunIdA = buildScenarioStepRunId({ runId: runIdA, stepId: "step-1", index: 0, now: FIXED_NOW });
  const stepRunIdB = buildScenarioStepRunId({ runId: runIdB, stepId: "step-1", index: 0, now: FIXED_NOW });
  const reportIdA = buildScenarioReportId({ runId: runIdA, scenarioId: scenario.scenarioId, status: "passed", completedAt: FIXED_NOW });
  const reportIdB = buildScenarioReportId({ runId: runIdB, scenarioId: scenario.scenarioId, status: "passed", completedAt: FIXED_NOW });
  const expectationIdA = buildScenarioExpectationResultId({ runId: runIdA, stepId: "step-1", expectationId: "exp-1", operator: "equals", path: "loop.status" });
  const expectationIdB = buildScenarioExpectationResultId({ runId: runIdB, stepId: "step-1", expectationId: "exp-1", operator: "equals", path: "loop.status" });

  assert.equal(runIdA, runIdB);
  assert.equal(stepRunIdA, stepRunIdB);
  assert.equal(reportIdA, reportIdB);
  assert.equal(expectationIdA, expectationIdB);
});

test("same scenario and same state produce the same result and do not mutate input", async () => {
  const scenario = getScenarioDefinitionById("low-risk-autonomous-reply")!;
  const snapshot = clone(scenario);
  const first = await executeScenario(clone(scenario));
  const second = await executeScenario(clone(scenario));

  assert.deepEqual(scenario, snapshot);
  assert.deepEqual(
    {
      status: first.status,
      finalStage: first.steps.at(-1)?.loopResult.finalStage ?? null,
      summary: first.summary,
      report: first.report
    },
    {
      status: second.status,
      finalStage: second.steps.at(-1)?.loopResult.finalStage ?? null,
      summary: second.summary,
      report: second.report
    }
  );
});

test("safe report and export omit phone, message and token data", async () => {
  const result = await executeScenario(getScenarioDefinitionById("low-risk-autonomous-reply")!);
  const report = result.report;
  const exported = exportScenarioSafeResult(result);
  const text = JSON.stringify(report);
  const inputText = lowRiskPriceQuestionFixture().input.inbound.text;
  const phone = lowRiskPriceQuestionFixture().input.inbound.waId;

  assert.equal(exported.includes(phone), false);
  assert.equal(exported.includes(inputText), false);
  assert.equal(exported.includes("Bearer"), false);
  assert.equal(text.includes(phone), false);
});

test("UI selector and panel stay read-only and disabled by default", () => {
  const selectorSource = readFileSync(resolve(process.cwd(), "components/cases/ai-sdr/scenario-simulator/ScenarioSelector.tsx"), "utf8");
  const panelSource = readFileSync(resolve(process.cwd(), "components/cases/ai-sdr/scenario-simulator/ScenarioSimulatorPanel.tsx"), "utf8");
  const pageSource = readFileSync(resolve(process.cwd(), "app/(hub)/dev/ai-sdr-simulator/page.tsx"), "utf8");

  assert.equal(selectorSource.includes("method=\"get\""), true);
  assert.equal(selectorSource.includes("execute_fake"), true);
  assert.equal(panelSource.includes("El simulador est"), true);
  assert.equal(pageSource.includes("BRAIN_SCENARIO_SIMULATOR_ENABLED"), true);
  assert.equal(pageSource.includes("BRAIN_SCENARIO_SIMULATOR_ALLOW_EXECUTE_FAKE"), true);
});

test("source tree excludes DB, SQL, fetch, Meta, timers and random IDs", () => {
  const source = collectSource();
  const forbidden = new RegExp(
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
  assert.equal(forbidden.test(source), false);
});
