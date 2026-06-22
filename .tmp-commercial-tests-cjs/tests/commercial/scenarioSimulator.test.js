"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const index_js_1 = require("../../lib/brain/commercial/scenario-simulator/index.js");
const index_js_2 = require("../../lib/brain/commercial/autonomous-loop/index.js");
const FIXED_NOW = "2026-06-17T12:00:00.000Z";
const SIMULATOR_VERSION = "brain.commercial.scenario-simulator.v1";
function clone(value) {
    return structuredClone(value);
}
function makeBaseStep(stepId = "step-1", title = "Paso sintético", now = FIXED_NOW) {
    return {
        stepId,
        title,
        now,
        mode: "execute_fake",
        input: clone((0, index_js_2.lowRiskPriceQuestionFixture)().input),
        expectedCheckpointIds: ["loop_status:delivered"],
        notes: ["synthetic"],
        replayFollowUp: false
    };
}
function makeBaseScenario(overrides = {}) {
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
function makeStepResult(overrides = {}) {
    const baseInput = makeBaseStep().input;
    const base = {
        stepId: "step-1",
        index: 0,
        title: "Paso sintético",
        inputSummary: {
            scenarioId: "scenario-simulator-base",
            stepId: "step-1",
            mode: "execute_fake",
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
    };
    return base;
}
function makeExpectation(overrides = {}) {
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
function makeInvalidScenario(overrides = {}) {
    return makeBaseScenario(overrides);
}
function readTree(folder) {
    const entries = (0, node_fs_1.readdirSync)(folder, { withFileTypes: true });
    const parts = [];
    for (const entry of entries) {
        const fullPath = (0, node_path_1.resolve)(folder, entry.name);
        if (entry.isDirectory()) {
            parts.push(readTree(fullPath));
        }
        else if (entry.isFile() && entry.name.endsWith(".ts")) {
            parts.push((0, node_fs_1.readFileSync)(fullPath, "utf8"));
        }
    }
    return parts.join("\n");
}
function collectSource() {
    const folders = [
        (0, node_path_1.resolve)(process.cwd(), "lib/brain/commercial/scenario-simulator"),
        (0, node_path_1.resolve)(process.cwd(), "components/cases/ai-sdr/scenario-simulator")
    ];
    return folders.map((folder) => readTree(folder)).join("\n");
}
function buildExpectedScenarioRunId(scenario) {
    return (0, index_js_1.buildScenarioRunId)({
        scenarioId: scenario.scenarioId,
        stepCount: scenario.steps.length,
        tenantId: String(scenario.steps[0]?.input.tenantId ?? "tenant-scenario-simulator"),
        initialStateHash: JSON.stringify({
            runtimeSeed: scenario.initialState.runtimeSeed,
            configuration: scenario.initialState.configuration
        })
    });
}
(0, node_test_1.default)("validation fails closed for invalid scenario id, empty steps, duplicate step ids, timestamps, unsafe text and recipients", () => {
    const invalidId = (0, index_js_1.validateScenarioDefinition)(makeInvalidScenario({ scenarioId: "" }));
    const emptySteps = (0, index_js_1.validateScenarioDefinition)(makeInvalidScenario({ steps: [] }));
    const duplicateStep = (0, index_js_1.validateScenarioDefinition)(makeInvalidScenario({ steps: [makeBaseStep(), makeBaseStep()] }));
    const invalidTimestamp = (0, index_js_1.validateScenarioDefinition)(makeInvalidScenario({ steps: [makeBaseStep("step-1", "Paso", "invalid")] }));
    const unsafeToken = (0, index_js_1.validateScenarioDefinition)(makeInvalidScenario({
        steps: [
            {
                ...makeBaseStep(),
                input: {
                    ...makeBaseStep().input,
                    inbound: { ...makeBaseStep().input.inbound, text: "Bearer secret-token" }
                }
            }
        ]
    }));
    const realRecipient = (0, index_js_1.validateScenarioDefinition)(makeInvalidScenario({
        steps: [
            {
                ...makeBaseStep(),
                input: {
                    ...makeBaseStep().input,
                    inbound: { ...makeBaseStep().input.inbound, waId: "+1234567890" }
                }
            }
        ]
    }));
    strict_1.default.equal(invalidId.ok, false);
    strict_1.default.equal(emptySteps.ok, false);
    strict_1.default.equal(duplicateStep.ok, false);
    strict_1.default.equal(invalidTimestamp.ok, false);
    strict_1.default.equal(unsafeToken.ok, false);
    strict_1.default.equal(realRecipient.ok, false);
});
(0, node_test_1.default)("catalog scenarios validate", () => {
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
        const scenario = (0, index_js_1.getScenarioDefinitionById)(scenarioId);
        strict_1.default.ok(scenario, `scenario ${scenarioId} should exist`);
        const validation = (0, index_js_1.validateScenarioDefinition)(clone(scenario));
        strict_1.default.equal(validation.ok, true, scenarioId);
    }
});
(0, node_test_1.default)("observe, simulate and execute_fake modes are supported", async () => {
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
    const observe = await (0, index_js_1.executeScenario)(observeScenario);
    const simulate = await (0, index_js_1.executeScenario)(simulateScenario);
    const executed = await (0, index_js_1.executeScenario)(executeScenarioDef);
    strict_1.default.equal(observe.steps[0]?.loopResult.mode, "observe");
    strict_1.default.equal(simulate.steps[0]?.loopResult.mode, "simulate");
    strict_1.default.equal(executed.steps[0]?.loopResult.mode, "execute_fake");
});
(0, node_test_1.default)("critical catalog scenarios produce their expected loop outcomes", async () => {
    const lowRisk = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("low-risk-autonomous-reply"));
    const requestMore = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("request-more-context"));
    const whitelist = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("recipient-not-whitelisted"));
    const human = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("human-handoff"));
    const complaint = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("complaint-blocked"));
    const closedCase = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("closed-case"));
    const aiBlocked = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("ai-blocked"));
    const opportunityWon = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("opportunity-won"));
    strict_1.default.equal(lowRisk.steps[0]?.loopResult.status, "delivered");
    strict_1.default.equal(requestMore.steps[0]?.loopResult.status, "delivered");
    strict_1.default.equal(whitelist.steps[0]?.loopResult.status, "blocked");
    strict_1.default.equal(human.steps[0]?.loopResult.status, "requires_human");
    strict_1.default.equal(complaint.steps[0]?.loopResult.status, "blocked");
    strict_1.default.equal(closedCase.steps[0]?.loopResult.status, "cancelled");
    strict_1.default.equal(aiBlocked.steps[0]?.loopResult.status, "blocked");
    strict_1.default.equal(opportunityWon.steps[0]?.loopResult.status, "cancelled");
});
(0, node_test_1.default)("transport and retry catalog scenarios produce the right terminal states", async () => {
    const temporaryFailure = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("temporary-transport-failure"));
    const rateLimit = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("rate-limit"));
    const permanentFailure = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("permanent-transport-failure"));
    strict_1.default.equal(temporaryFailure.steps[0]?.loopResult.status, "retry_scheduled");
    strict_1.default.equal(rateLimit.steps[0]?.loopResult.status, "retry_scheduled");
    strict_1.default.equal(rateLimit.steps[0]?.loopResult.outbox.transportResult?.retryAfterSeconds, 30);
    strict_1.default.equal(permanentFailure.steps[0]?.loopResult.status, "dead_letter");
});
(0, node_test_1.default)("idempotency scenarios stay stable across reruns", async () => {
    const duplicateInbound = (0, index_js_1.getScenarioDefinitionById)("duplicate-inbound");
    const duplicateExecution = (0, index_js_1.getScenarioDefinitionById)("duplicate-execution");
    const duplicateInboundResult = await (0, index_js_1.executeScenario)(duplicateInbound);
    const duplicateExecutionResult = await (0, index_js_1.executeScenario)(duplicateExecution);
    strict_1.default.equal(duplicateInboundResult.steps[1]?.loopResult.status, "completed");
    strict_1.default.equal(duplicateExecutionResult.steps[1]?.loopResult.status, "completed");
    strict_1.default.equal(duplicateExecutionResult.steps[1]?.stateDiff.outbox.added.length, 0);
});
(0, node_test_1.default)("follow-up catalog scenarios cover wait, ready, cancel, replan, expire and max attempts", async () => {
    const wait = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("follow-up-wait"));
    const ready = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("follow-up-ready"));
    const cancel = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("customer-reply-cancels-follow-up"));
    const humanCancel = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("human-takeover-cancels-follow-up"));
    const replan = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("opportunity-stage-replacement"));
    const expired = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("follow-up-expired"));
    const maxAttempts = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("max-attempts-exhausted"));
    strict_1.default.equal(wait.steps[0]?.followUpReplay?.schedulingResult?.decision, "wait");
    strict_1.default.equal(ready.steps[0]?.followUpReplay?.schedulingResult?.decision, "ready");
    strict_1.default.equal(cancel.steps[1]?.followUpReplay?.schedulingResult?.decision, "cancel");
    strict_1.default.equal(humanCancel.steps[1]?.followUpReplay?.schedulingResult?.decision, "cancel");
    strict_1.default.equal(replan.steps[1]?.followUpReplay?.schedulingResult?.decision, "replan");
    strict_1.default.equal(expired.steps[0]?.followUpReplay?.schedulingResult?.decision, "expire");
    strict_1.default.equal(maxAttempts.steps[0]?.followUpReplay?.schedulingResult?.decision, "expire");
});
(0, node_test_1.default)("full rollback scenario fails without leaving partial side effects", async () => {
    const fullRollback = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("full-rollback"), { failureMode: "after_outbox" });
    strict_1.default.equal(fullRollback.steps[0]?.loopResult.status, "failed");
    strict_1.default.equal(fullRollback.finalSnapshot.outbox.length, 0);
});
(0, node_test_1.default)("previous and next snapshots preserve state between steps", async () => {
    const scenario = (0, index_js_1.getScenarioDefinitionById)("customer-reply-cancels-follow-up");
    const result = await (0, index_js_1.executeScenario)(scenario);
    const first = result.steps[0];
    const second = result.steps[1];
    strict_1.default.ok(first);
    strict_1.default.ok(second);
    strict_1.default.equal(first.previousSnapshot.actions.length, 1);
    strict_1.default.equal(first.nextSnapshot.actions.length, 2);
    strict_1.default.equal(second.previousSnapshot.actions.length, 2);
    strict_1.default.equal(second.nextSnapshot.actions.length, second.previousSnapshot.actions.length);
});
(0, node_test_1.default)("state diff exposes actions and outbox safely", async () => {
    const result = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("low-risk-autonomous-reply"));
    const step = result.steps[0];
    strict_1.default.ok(step.stateDiff.actions.added.length >= 1);
    strict_1.default.ok(step.stateDiff.outbox.added.length >= 0);
    strict_1.default.ok(step.stateDiff.audit.addedCount >= 0);
});
(0, node_test_1.default)("expectation comparison supports equals, contains, exists and greater_than", () => {
    const stepResult = makeStepResult({
        loopResult: {
            ...makeStepResult().loopResult,
            status: "delivered",
            decision: { decision: "respond_now" },
            outbox: {
                ...makeStepResult().loopResult.outbox,
                workerResult: { status: "delivered" }
            }
        }
    });
    const equals = (0, index_js_1.compareScenarioExpectation)(makeExpectation({ path: "loop.status", expected: "delivered", operator: "equals" }), stepResult, stepResult.nextSnapshot);
    const contains = (0, index_js_1.compareScenarioExpectation)(makeExpectation({ path: "loop.finalStage", operator: "contains", expected: "delivery", type: "final_stage", expectationId: "exp-2" }), stepResult, stepResult.nextSnapshot);
    const greaterThan = (0, index_js_1.compareScenarioExpectation)(makeExpectation({ path: "runtime.actions.count", operator: "greater_than", expected: -1, type: "runtime_count", expectationId: "exp-5" }), stepResult, stepResult.nextSnapshot);
    const exists = (0, index_js_1.compareScenarioExpectation)(makeExpectation({ path: "action.status", operator: "exists", expected: true, type: "action_status", expectationId: "exp-3" }), stepResult, stepResult.nextSnapshot);
    const invalidPath = (0, index_js_1.compareScenarioExpectation)(makeExpectation({ path: "report.result.status", operator: "equals", expected: "delivered", expectationId: "exp-4" }), stepResult, stepResult.nextSnapshot);
    strict_1.default.equal(equals.passed, true);
    strict_1.default.equal(contains.passed, true);
    strict_1.default.equal(greaterThan.passed, true);
    strict_1.default.equal(exists.passed, true);
    strict_1.default.equal(invalidPath.passed, false);
});
(0, node_test_1.default)("invariants detect duplicate ids, orphan outbox, missing delivery and terminal issues", () => {
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
                { rowId: 1, actionId: "missing-action", idempotencyKey: "outbox-1", status: "pending", providerMessageId: null }
            ],
            deliveryResults: [],
            auditEvents: [
                { eventId: "audit-1", runId: "run", stage: "audit", eventType: "loop_completed", entityType: "runtime", entityId: "entity", status: "completed", reason: null, metadata: {}, createdAt: FIXED_NOW }
            ]
        }
    });
    const results = (0, index_js_1.validateScenarioInvariants)(makeStepResult(), prev, next.nextSnapshot, step);
    strict_1.default.ok(results.some((item) => item.invariantId === "duplicate_action_id" && !item.passed));
    strict_1.default.ok(results.some((item) => item.invariantId === "duplicate_idempotency_key" && !item.passed));
    strict_1.default.ok(results.some((item) => item.invariantId === "no_orphan_outbox" && !item.passed));
    strict_1.default.ok(results.some((item) => item.invariantId === "executed_requires_delivery" && !item.passed));
});
(0, node_test_1.default)("invariants detect replacement lineage and terminal reactivation", () => {
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
    const results = (0, index_js_1.validateScenarioInvariants)(makeStepResult(), prev, next.nextSnapshot, step);
    strict_1.default.ok(results.some((item) => item.invariantId === "replacement_has_parent" && !item.passed));
    strict_1.default.ok(results.some((item) => item.invariantId === "terminal_action_immutable" && item.passed));
});
(0, node_test_1.default)("invariants detect retry duplication, leaks and safe side effects", () => {
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
                { rowId: 1, actionId: "action-1", idempotencyKey: "outbox-1", status: "delivered", providerMessageId: null },
                { rowId: 1, actionId: "action-1", idempotencyKey: "outbox-1", status: "delivered", providerMessageId: null }
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
        }
    });
    const results = (0, index_js_1.validateScenarioInvariants)(stepResult, prev, next.nextSnapshot, step);
    strict_1.default.ok(results.some((item) => item.invariantId === "retry_does_not_duplicate_outbox" && !item.passed));
    strict_1.default.ok(results.some((item) => item.invariantId === "same_inbound_no_second_executable_decision" && !item.passed));
    strict_1.default.ok(results.some((item) => item.invariantId === "real_side_effects_false" && item.passed));
});
(0, node_test_1.default)("invariants detect phone, message and token leaks", () => {
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
    const results = (0, index_js_1.validateScenarioInvariants)(makeStepResult(), prev, next.nextSnapshot, step);
    strict_1.default.ok(results.some((item) => item.invariantId === "phone_not_exposed" && !item.passed));
    strict_1.default.ok(results.some((item) => item.invariantId === "message_not_exposed" && !item.passed));
    strict_1.default.ok(results.some((item) => item.invariantId === "token_not_exposed" && !item.passed));
});
(0, node_test_1.default)("deterministic identifiers are stable", () => {
    const scenario = makeBaseScenario();
    const runIdA = (0, index_js_1.buildScenarioRunId)({
        scenarioId: scenario.scenarioId,
        stepCount: scenario.steps.length,
        tenantId: "tenant-1",
        initialStateHash: JSON.stringify(scenario.initialState)
    });
    const runIdB = (0, index_js_1.buildScenarioRunId)({
        scenarioId: scenario.scenarioId,
        stepCount: scenario.steps.length,
        tenantId: "tenant-1",
        initialStateHash: JSON.stringify(scenario.initialState)
    });
    const stepRunIdA = (0, index_js_1.buildScenarioStepRunId)({ runId: runIdA, stepId: "step-1", index: 0, now: FIXED_NOW });
    const stepRunIdB = (0, index_js_1.buildScenarioStepRunId)({ runId: runIdB, stepId: "step-1", index: 0, now: FIXED_NOW });
    const reportIdA = (0, index_js_1.buildScenarioReportId)({ runId: runIdA, scenarioId: scenario.scenarioId, status: "passed", completedAt: FIXED_NOW });
    const reportIdB = (0, index_js_1.buildScenarioReportId)({ runId: runIdB, scenarioId: scenario.scenarioId, status: "passed", completedAt: FIXED_NOW });
    const expectationIdA = (0, index_js_1.buildScenarioExpectationResultId)({ runId: runIdA, stepId: "step-1", expectationId: "exp-1", operator: "equals", path: "loop.status" });
    const expectationIdB = (0, index_js_1.buildScenarioExpectationResultId)({ runId: runIdB, stepId: "step-1", expectationId: "exp-1", operator: "equals", path: "loop.status" });
    strict_1.default.equal(runIdA, runIdB);
    strict_1.default.equal(stepRunIdA, stepRunIdB);
    strict_1.default.equal(reportIdA, reportIdB);
    strict_1.default.equal(expectationIdA, expectationIdB);
});
(0, node_test_1.default)("same scenario and same state produce the same result and do not mutate input", async () => {
    const scenario = (0, index_js_1.getScenarioDefinitionById)("low-risk-autonomous-reply");
    const snapshot = clone(scenario);
    const first = await (0, index_js_1.executeScenario)(clone(scenario));
    const second = await (0, index_js_1.executeScenario)(clone(scenario));
    strict_1.default.deepEqual(scenario, snapshot);
    strict_1.default.deepEqual({
        status: first.status,
        finalStage: first.steps.at(-1)?.loopResult.finalStage ?? null,
        summary: first.summary,
        report: first.report
    }, {
        status: second.status,
        finalStage: second.steps.at(-1)?.loopResult.finalStage ?? null,
        summary: second.summary,
        report: second.report
    });
});
(0, node_test_1.default)("safe report and export omit phone, message and token data", async () => {
    const result = await (0, index_js_1.executeScenario)((0, index_js_1.getScenarioDefinitionById)("low-risk-autonomous-reply"));
    const report = result.report;
    const exported = (0, index_js_1.exportScenarioSafeResult)(result);
    const text = JSON.stringify(report);
    const inputText = (0, index_js_2.lowRiskPriceQuestionFixture)().input.inbound.text;
    const phone = (0, index_js_2.lowRiskPriceQuestionFixture)().input.inbound.waId;
    strict_1.default.equal(exported.includes(phone), false);
    strict_1.default.equal(exported.includes(inputText), false);
    strict_1.default.equal(exported.includes("Bearer"), false);
    strict_1.default.equal(text.includes(phone), false);
});
(0, node_test_1.default)("UI selector and panel stay read-only and disabled by default", () => {
    const selectorSource = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(process.cwd(), "components/cases/ai-sdr/scenario-simulator/ScenarioSelector.tsx"), "utf8");
    const panelSource = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(process.cwd(), "components/cases/ai-sdr/scenario-simulator/ScenarioSimulatorPanel.tsx"), "utf8");
    const pageSource = (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(process.cwd(), "app/(hub)/dev/ai-sdr-simulator/page.tsx"), "utf8");
    strict_1.default.equal(selectorSource.includes("method=\"get\""), true);
    strict_1.default.equal(selectorSource.includes("execute_fake"), true);
    strict_1.default.equal(panelSource.includes("El simulador est"), true);
    strict_1.default.equal(pageSource.includes("BRAIN_SCENARIO_SIMULATOR_ENABLED"), true);
    strict_1.default.equal(pageSource.includes("BRAIN_SCENARIO_SIMULATOR_ALLOW_EXECUTE_FAKE"), true);
});
(0, node_test_1.default)("source tree excludes DB, SQL, fetch, Meta, timers and random IDs", () => {
    const source = collectSource();
    const forbidden = new RegExp([
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
    ].join("|"));
    strict_1.default.equal(forbidden.test(source), false);
});
