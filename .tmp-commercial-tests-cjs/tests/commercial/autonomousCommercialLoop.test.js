"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const index_js_1 = require("../../lib/brain/commercial/follow-up-replanning/index.js");
const index_js_2 = require("../../lib/brain/commercial/follow-up-scheduling/index.js");
const index_js_3 = require("../../lib/brain/commercial/autonomous-loop/index.js");
const index_js_4 = require("../../lib/brain/commercial/autonomous-loop/index.js");
const FIXED_NOW = "2026-06-17T12:00:00.000Z";
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
function makeRuntimeSnapshot(overrides = {}) {
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
function makeLoopInput(fixture, overrides = {}) {
    return Object.assign(cloneJson(fixture.input), cloneJson(overrides));
}
function makeFollowUpSchedulingInput(overrides = {}) {
    const base = {
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
function buildFollowUpMutationInput(schedulingResult = (0, index_js_2.evaluateFollowUpSchedule)(makeFollowUpSchedulingInput()), overrides = {}) {
    const base = {
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
function readSourceTree(folder) {
    const entries = (0, node_fs_1.readdirSync)(folder, { withFileTypes: true });
    const chunks = [];
    for (const entry of entries) {
        const fullPath = (0, node_path_1.resolve)(folder, entry.name);
        if (entry.isDirectory()) {
            chunks.push(readSourceTree(fullPath));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".ts")) {
            chunks.push((0, node_fs_1.readFileSync)(fullPath, "utf8"));
        }
    }
    return chunks.join("\n");
}
function autonomousLoopSource() {
    const folder = (0, node_path_1.resolve)(process.cwd(), "lib/brain/commercial/autonomous-loop");
    return readSourceTree(folder);
}
function hasForbiddenSourceText(source) {
    const pattern = new RegExp([
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
    return pattern.test(source);
}
function assertCommonSafeSideEffects(result) {
    strict_1.default.equal(result.sideEffects.realDatabaseWritten, false);
    strict_1.default.equal(result.sideEffects.realOutboxWritten, false);
    strict_1.default.equal(result.sideEffects.realMessageSent, false);
    strict_1.default.equal(result.sideEffects.metaCalled, false);
    strict_1.default.equal(result.sideEffects.schedulerTriggered, false);
}
(0, node_test_1.default)("invalid timestamp fails closed", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const result = await (0, index_js_3.evaluateAutonomousLoop)(makeLoopInput(fixture, { now: "invalid" }));
    strict_1.default.equal(result.status, "invalid");
    strict_1.default.equal(result.errors[0]?.code, "invalid_timestamp");
    assertCommonSafeSideEffects(result);
});
(0, node_test_1.default)("operation loop disabled fails closed", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const result = await (0, index_js_3.evaluateAutonomousLoop)(makeLoopInput(fixture, {
        configuration: {
            ...fixture.input.configuration,
            operationalLoopEnabled: false
        }
    }));
    strict_1.default.equal(result.status, "invalid");
    strict_1.default.equal(result.errors[0]?.code, "operational_loop_disabled");
});
(0, node_test_1.default)("observe mode produces preview without execution", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const result = await (0, index_js_3.evaluateAutonomousLoop)(makeLoopInput(fixture, { mode: "observe" }));
    strict_1.default.equal(result.mode, "observe");
    strict_1.default.equal(result.finalStage, "sandbox");
    strict_1.default.equal(result.outbox.record, null);
    strict_1.default.equal(result.outbox.workerResult, null);
    strict_1.default.equal(result.sideEffects.fakeTransportCalled, false);
});
(0, node_test_1.default)("simulate mode produces preview without execution", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const result = await (0, index_js_3.evaluateAutonomousLoop)(makeLoopInput(fixture, { mode: "simulate" }));
    strict_1.default.equal(result.mode, "simulate");
    strict_1.default.equal(result.outbox.workerResult, null);
    strict_1.default.equal(result.sideEffects.fakeTransportCalled, false);
});
(0, node_test_1.default)("execute_fake mode runs the full pipeline", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const runtime = new index_js_4.InMemoryAutonomousCommercialRuntime();
    const result = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture, { mode: "execute_fake" }), runtime);
    strict_1.default.equal(result.status, "delivered");
    strict_1.default.equal(result.finalStage, "delivery_reconciliation");
    strict_1.default.equal(result.outbox.workerResult?.status, "delivered");
    strict_1.default.equal(result.outbox.transportResult?.status, "accepted");
    strict_1.default.equal(result.reconciliation.actionStatusAfter, "executed");
    assertCommonSafeSideEffects(result);
});
(0, node_test_1.default)("duplicate correlation id is skipped", async () => {
    const fixture = (0, index_js_4.duplicateInboundFixture)();
    const result = await (0, index_js_3.evaluateAutonomousLoop)(fixture.input, fixture.snapshot);
    strict_1.default.equal(result.status, "completed");
    strict_1.default.ok(result.warnings.includes("duplicate_inbound"));
});
(0, node_test_1.default)("duplicate provider message id is skipped", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const snapshot = makeRuntimeSnapshot({
        processedProviderMessageIds: [fixture.input.inbound.providerMessageId ?? fixture.input.inbound.messageId]
    });
    const result = await (0, index_js_3.evaluateAutonomousLoop)(fixture.input, snapshot);
    strict_1.default.equal(result.status, "completed");
    strict_1.default.ok(result.warnings.includes("duplicate_inbound"));
});
(0, node_test_1.default)("low risk eligible reply is delivered", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const result = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture, { mode: "execute_fake" }), new index_js_4.InMemoryAutonomousCommercialRuntime());
    strict_1.default.equal(result.status, "delivered");
    strict_1.default.equal(result.outbox.workerResult?.status, "delivered");
    strict_1.default.equal(result.reconciliation.actionStatusAfter, "executed");
});
(0, node_test_1.default)("reply not whitelisted is blocked", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const result = await (0, index_js_3.evaluateAutonomousLoop)(makeLoopInput(fixture, {
        configuration: {
            ...fixture.input.configuration,
            whitelistedWaIds: ["56922222222"]
        }
    }));
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.equal(result.executionGateResult?.status, "blocked");
});
(0, node_test_1.default)("medium or high risk is blocked", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const result = await (0, index_js_3.evaluateAutonomousLoop)(makeLoopInput(fixture, { scenario: { ...fixture.input.scenario, forceRiskLevel: "high" } }));
    strict_1.default.equal(result.status, "blocked");
});
(0, node_test_1.default)("approval required is blocked", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const result = await (0, index_js_3.evaluateAutonomousLoop)(makeLoopInput(fixture, { scenario: { ...fixture.input.scenario, forceApprovalRequirement: "operator_review" } }));
    strict_1.default.equal(result.status, "blocked");
});
(0, node_test_1.default)("human owner active requires human", async () => {
    const fixture = (0, index_js_4.humanHandoffFixture)();
    const result = await (0, index_js_3.evaluateAutonomousLoop)(makeLoopInput(fixture, { mode: "execute_fake" }));
    strict_1.default.equal(result.status, "requires_human");
});
(0, node_test_1.default)("ai blocked is blocked", async () => {
    const fixture = (0, index_js_4.aiBlockedFixture)();
    const result = await (0, index_js_3.evaluateAutonomousLoop)(makeLoopInput(fixture));
    strict_1.default.equal(result.status, "blocked");
});
(0, node_test_1.default)("case closed cancels the loop", async () => {
    const fixture = (0, index_js_4.closedCaseFixture)();
    const result = await (0, index_js_3.evaluateAutonomousLoop)(makeLoopInput(fixture));
    strict_1.default.equal(result.status, "cancelled");
});
(0, node_test_1.default)("opportunity won cancels the loop", async () => {
    const fixture = (0, index_js_4.opportunityWonFixture)();
    const result = await (0, index_js_3.evaluateAutonomousLoop)(makeLoopInput(fixture));
    strict_1.default.equal(result.status, "cancelled");
});
(0, node_test_1.default)("opportunity paused blocks the loop", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const result = await (0, index_js_3.evaluateAutonomousLoop)(makeLoopInput(fixture, {
        commercialContext: {
            ...fixture.input.commercialContext,
            opportunityStatus: "paused"
        }
    }));
    strict_1.default.equal(result.status, "blocked");
});
(0, node_test_1.default)("request more context can execute through the fake transport", async () => {
    const fixture = (0, index_js_4.requestMoreContextFixture)();
    const result = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture), new index_js_4.InMemoryAutonomousCommercialRuntime());
    strict_1.default.equal(result.outbox.workerResult?.status, "delivered");
    strict_1.default.equal(result.outbox.transportResult?.status, "accepted");
});
(0, node_test_1.default)("temporary transport failure schedules retry", async () => {
    const fixture = (0, index_js_4.temporaryTransportFailureFixture)();
    const result = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture), new index_js_4.InMemoryAutonomousCommercialRuntime());
    strict_1.default.equal(result.status, "retry_scheduled");
    strict_1.default.equal(result.outbox.workerResult?.status, "retry_scheduled");
});
(0, node_test_1.default)("timeout transport failure schedules retry", async () => {
    const fixture = (0, index_js_4.temporaryTransportFailureFixture)();
    const result = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture, {
        scenario: {
            ...fixture.input.scenario,
            transportScenario: "timeout"
        }
    }), new index_js_4.InMemoryAutonomousCommercialRuntime());
    strict_1.default.equal(result.status, "retry_scheduled");
    strict_1.default.equal(result.outbox.workerResult?.status, "retry_scheduled");
});
(0, node_test_1.default)("rate limited transport schedules retry with retry-after", async () => {
    const fixture = (0, index_js_4.rateLimitedTransportFixture)();
    const result = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture), new index_js_4.InMemoryAutonomousCommercialRuntime());
    strict_1.default.equal(result.status, "retry_scheduled");
    strict_1.default.equal(result.outbox.transportResult?.status, "rate_limited");
    strict_1.default.equal(result.outbox.transportResult?.retryAfterSeconds, 30);
});
(0, node_test_1.default)("permanent transport failure dead letters the message", async () => {
    const fixture = (0, index_js_4.permanentTransportFailureFixture)();
    const result = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture), new index_js_4.InMemoryAutonomousCommercialRuntime());
    strict_1.default.equal(result.status, "dead_letter");
    strict_1.default.equal(result.outbox.workerResult?.status, "dead_letter");
});
(0, node_test_1.default)("transport disabled keeps the worker from sending", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const result = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture, {
        configuration: {
            ...fixture.input.configuration,
            messageTransportEnabled: false
        }
    }), new index_js_4.InMemoryAutonomousCommercialRuntime());
    strict_1.default.equal(result.outbox.workerResult?.status, "skipped");
    strict_1.default.equal(result.outbox.transportResult, null);
});
(0, node_test_1.default)("worker disabled keeps the worker from sending", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const result = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture, {
        configuration: {
            ...fixture.input.configuration,
            outboxWorkerEnabled: false
        }
    }), new index_js_4.InMemoryAutonomousCommercialRuntime());
    strict_1.default.equal(result.outbox.workerResult?.status, "skipped");
    strict_1.default.equal(result.outbox.transportResult, null);
});
(0, node_test_1.default)("same input yields the same run id and deterministic outbox ids", () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const input = fixture.input;
    const runIdA = (0, index_js_3.buildAutonomousLoopRunId)({
        tenantId: input.tenantId,
        correlationId: input.correlationId,
        messageId: input.inbound.messageId,
        now: input.now
    });
    const runIdB = (0, index_js_3.buildAutonomousLoopRunId)({
        tenantId: input.tenantId,
        correlationId: input.correlationId,
        messageId: input.inbound.messageId,
        now: input.now
    });
    const outboxIdA = (0, index_js_3.buildOutboxRecordId)({
        runId: runIdA,
        actionId: "action-001",
        commandId: "command-001",
        idempotencyKey: "idempotency-001"
    });
    const outboxIdB = (0, index_js_3.buildOutboxRecordId)({
        runId: runIdB,
        actionId: "action-001",
        commandId: "command-001",
        idempotencyKey: "idempotency-001"
    });
    const auditIdA = (0, index_js_3.buildAutonomousAuditEventId)({
        runId: runIdA,
        stage: "audit",
        eventType: "loop_completed",
        entityId: input.correlationId,
        status: "completed",
        createdAt: input.now
    });
    const auditIdB = (0, index_js_3.buildAutonomousAuditEventId)({
        runId: runIdB,
        stage: "audit",
        eventType: "loop_completed",
        entityId: input.correlationId,
        status: "completed",
        createdAt: input.now
    });
    const deliveryIdA = (0, index_js_3.buildDeliveryReconciliationId)({
        runId: runIdA,
        outboxRowId: 1,
        status: "delivered",
        completedAt: input.now
    });
    const deliveryIdB = (0, index_js_3.buildDeliveryReconciliationId)({
        runId: runIdB,
        outboxRowId: 1,
        status: "delivered",
        completedAt: input.now
    });
    strict_1.default.equal(runIdA, runIdB);
    strict_1.default.equal(outboxIdA, outboxIdB);
    strict_1.default.equal(auditIdA, auditIdB);
    strict_1.default.equal(deliveryIdA, deliveryIdB);
});
(0, node_test_1.default)("execute_fake keeps the input immutable", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const input = cloneJson(fixture.input);
    const snapshot = cloneJson(input);
    await (0, index_js_3.executeAutonomousLoop)(input, new index_js_4.InMemoryAutonomousCommercialRuntime());
    strict_1.default.deepEqual(input, snapshot);
});
(0, node_test_1.default)("same input and same runtime state produce the same result", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const runtimeA = new index_js_4.InMemoryAutonomousCommercialRuntime();
    const runtimeB = new index_js_4.InMemoryAutonomousCommercialRuntime();
    const resultA = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture), runtimeA);
    const resultB = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture), runtimeB);
    strict_1.default.deepEqual({
        status: resultA.status,
        finalStage: resultA.finalStage,
        runId: resultA.runId,
        outboxCommandId: resultA.outbox.command?.commandId ?? null,
        workerStatus: resultA.outbox.workerResult?.status ?? null,
        providerMessageId: resultA.outbox.transportResult?.providerMessageId ?? null
    }, {
        status: resultB.status,
        finalStage: resultB.finalStage,
        runId: resultB.runId,
        outboxCommandId: resultB.outbox.command?.commandId ?? null,
        workerStatus: resultB.outbox.workerResult?.status ?? null,
        providerMessageId: resultB.outbox.transportResult?.providerMessageId ?? null
    });
});
(0, node_test_1.default)("delivered message is not duplicated on the same runtime", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const runtime = new index_js_4.InMemoryAutonomousCommercialRuntime();
    const first = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture), runtime);
    const second = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture), runtime);
    strict_1.default.equal(first.status, "delivered");
    strict_1.default.equal(second.status, "completed");
    strict_1.default.ok(second.warnings.includes("duplicate_inbound"));
    strict_1.default.equal(runtime.getSnapshot().outbox.length, 1);
});
(0, node_test_1.default)("follow-up scheduling wait and ready are deterministic", () => {
    const waitResult = (0, index_js_2.evaluateFollowUpSchedule)(makeFollowUpSchedulingInput({
        action: {
            scheduledFor: "2026-06-17T14:00:00.000Z"
        }
    }));
    const readyResult = (0, index_js_2.evaluateFollowUpSchedule)(makeFollowUpSchedulingInput({
        action: {
            scheduledFor: FIXED_NOW
        }
    }));
    strict_1.default.equal(waitResult.decision, "wait");
    strict_1.default.equal(readyResult.decision, "ready");
});
(0, node_test_1.default)("follow-up expiry wins over ready", () => {
    const result = (0, index_js_2.evaluateFollowUpSchedule)(makeFollowUpSchedulingInput({
        action: {
            expiresAt: "2026-06-17T11:00:00.000Z"
        }
    }));
    strict_1.default.equal(result.decision, "expire");
    strict_1.default.ok(result.reasons.includes("action_expired"));
});
(0, node_test_1.default)("follow-up blocks on policy, risk, approval, human ownership and AI block", () => {
    const blockedByPolicy = (0, index_js_2.evaluateFollowUpSchedule)(makeFollowUpSchedulingInput({
        policy: {
            ...makeFollowUpSchedulingInput().policy,
            followUpEnabled: false
        }
    }));
    const blockedByRisk = (0, index_js_2.evaluateFollowUpSchedule)(makeFollowUpSchedulingInput({
        action: {
            riskLevel: "critical"
        }
    }));
    const blockedByApproval = (0, index_js_2.evaluateFollowUpSchedule)(makeFollowUpSchedulingInput({
        action: {
            approvalRequirement: "operator_review"
        }
    }));
    const blockedByHuman = (0, index_js_2.evaluateFollowUpSchedule)(makeFollowUpSchedulingInput({
        context: {
            humanOwnerActive: true
        }
    }));
    const blockedByAi = (0, index_js_2.evaluateFollowUpSchedule)(makeFollowUpSchedulingInput({
        context: {
            aiBlocked: true
        }
    }));
    strict_1.default.equal(blockedByPolicy.decision, "cancel");
    strict_1.default.equal(blockedByRisk.decision, "block");
    strict_1.default.equal(blockedByApproval.decision, "block");
    strict_1.default.equal(blockedByHuman.decision, "cancel");
    strict_1.default.equal(blockedByAi.decision, "block");
});
(0, node_test_1.default)("customer reply cancels follow-up through the loop", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
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
    const result = await (0, index_js_3.executeAutonomousLoop)(input, new index_js_4.InMemoryAutonomousCommercialRuntime());
    strict_1.default.equal(result.followUp.schedulingResult?.decision, "cancel");
    strict_1.default.equal(result.followUp.mutationPlan?.planType, "cancel_action");
    strict_1.default.equal(result.status, "cancelled");
});
(0, node_test_1.default)("stage change replans follow-up through the loop", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
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
    const result = await (0, index_js_3.executeAutonomousLoop)(input, new index_js_4.InMemoryAutonomousCommercialRuntime());
    strict_1.default.equal(result.followUp.schedulingResult?.decision, "replan");
    strict_1.default.ok(["replan_action", "supersede_action", "cancel_and_create_replacement"].includes(result.followUp.mutationPlan?.planType ?? ""));
});
(0, node_test_1.default)("follow-up mutation plan can be applied in memory", () => {
    const schedulingResult = (0, index_js_2.evaluateFollowUpSchedule)(makeFollowUpSchedulingInput({
        action: {
            scheduledFor: FIXED_NOW
        }
    }));
    const plan = (0, index_js_1.buildFollowUpMutationPlan)(buildFollowUpMutationInput(schedulingResult));
    const result = (0, index_js_1.applyFollowUpMutationPlanInMemory)({
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
    }, plan);
    strict_1.default.equal(result.rolledBack, false);
    strict_1.default.equal(result.applied, true);
});
(0, node_test_1.default)("orchestrator result exposes safe side effects only", async () => {
    const fixture = (0, index_js_4.lowRiskPriceQuestionFixture)();
    const result = await (0, index_js_3.executeAutonomousLoop)(makeLoopInput(fixture), new index_js_4.InMemoryAutonomousCommercialRuntime());
    assertCommonSafeSideEffects(result);
    strict_1.default.equal(result.sideEffects.fakeTransportCalled, true);
});
(0, node_test_1.default)("autonomous loop source is free of forbidden runtime and storage calls", () => {
    const source = autonomousLoopSource();
    strict_1.default.equal(hasForbiddenSourceText(source), false);
});
