"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const autonomy_sandbox_1 = require("../../lib/brain/commercial/autonomy-sandbox");
const buildOutboxCommand_1 = require("../../lib/brain/commercial/execution-gate/buildOutboxCommand");
const execution_gate_1 = require("../../lib/brain/commercial/execution-gate");
const FIXED_TIME = "2026-06-17T12:00:00.000Z";
function makeAction(overrides = {}) {
    return {
        id: null,
        actionId: "action-001",
        idempotencyKey: "gate:test-001",
        opportunityId: "opp-001",
        decisionId: "decision-001",
        decisionRowId: 1,
        conversationCaseId: "case-001",
        messageId: "msg-001",
        waId: "56911111111",
        channel: "whatsapp",
        actionType: "send_whatsapp_reply",
        status: "proposed",
        riskLevel: "low",
        approvalRequirement: "none",
        draftPayload: null,
        finalPayload: null,
        executionPayload: null,
        draftMessage: "Hola, te ayudamos con tu consulta.",
        finalMessage: null,
        scheduledFor: null,
        expiresAt: "2026-06-20T12:00:00.000Z",
        attemptNumber: 1,
        maxAttempts: 3,
        blockReasons: [],
        cancelReason: null,
        failureReason: null,
        policyStatus: "allowed",
        policyNotes: [],
        source: "ai_sdr",
        createdBy: "ai",
        approvedBy: null,
        approvedAt: null,
        executedAt: null,
        cancelledAt: null,
        outboxMessageId: null,
        lifecycleVersion: "brain.commercial.action-lifecycle.v1",
        policyVersion: "brain.commercial.policy.v1",
        runtimeVersion: "brain.commercial.runtime.v1",
        createdAt: FIXED_TIME,
        updatedAt: FIXED_TIME,
        ...overrides
    };
}
function makeContext(overrides = {}) {
    return {
        now: FIXED_TIME,
        caseId: "case-001",
        caseStatus: "open",
        lifecycleStatus: "open",
        humanOwnerActive: false,
        aiBlocked: false,
        requiresHuman: false,
        policyStatus: "allowed",
        conflictingActionExists: false,
        ...overrides
    };
}
function makeSandboxEvaluation(action, context, overrides = {}, configOverrides = {}) {
    const config = (0, autonomy_sandbox_1.buildSandboxAutonomyConfig)({
        sandboxEnabled: true,
        autonomousReplyEnabled: true,
        whitelistedWaIds: action.waId ? [action.waId] : [],
        allowedActionTypes: ["send_whatsapp_reply", "request_more_context"],
        maxRiskLevel: "low",
        ...configOverrides
    });
    const base = (0, autonomy_sandbox_1.evaluateAgentActionForSandbox)(action, context, config);
    return {
        ...base,
        ...overrides,
        executionPreview: {
            ...base.executionPreview,
            ...(overrides.executionPreview ?? {})
        }
    };
}
function makeGateInput(options = {}) {
    const action = makeAction(options.action);
    const context = makeContext(options.context);
    const sandboxEvaluation = makeSandboxEvaluation(action, context, options.sandboxEvaluation ?? {}, options.sandboxConfig ?? {});
    return {
        now: FIXED_TIME,
        config: {
            executionGateEnabled: true,
            outboxBridgeEnabled: true,
            sandboxModeRequired: true,
            ...options.config
        },
        action,
        context,
        sandboxEvaluation
    };
}
function makeRepositoryHarness(action, options = {}) {
    const actionRepo = new execution_gate_1.InMemoryAgentActionRepository([action], { failureFlags: options.actionFailures });
    const outboxRepo = new execution_gate_1.InMemoryOutboxRepository(options.outboxSeed ?? [], { failureFlags: options.outboxFailures });
    const unitOfWork = new execution_gate_1.InMemoryExecutionUnitOfWork(actionRepo, outboxRepo, options.uow);
    return { actionRepo, outboxRepo, unitOfWork };
}
function makeThrowingUnitOfWork() {
    return {
        async run() {
            throw new Error("unit of work should not be called");
        }
    };
}
function readExecutionGateSources() {
    const folder = (0, node_path_1.resolve)(process.cwd(), "lib/brain/commercial/execution-gate");
    const files = (0, node_fs_1.readdirSync)(folder).filter((file) => file.endsWith(".ts"));
    const testFile = (0, node_path_1.resolve)(process.cwd(), "tests/commercial/executionGate.test.ts");
    return [...files.map((file) => (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(folder, file), "utf8")), (0, node_fs_1.readFileSync)(testFile, "utf8")].join("\n");
}
function hasForbiddenStorageText(source) {
    const forbiddenPattern = new RegExp([
        "S" + "ELECT\\b",
        "I" + "NSERT\\b",
        "U" + "PDATE\\b",
        "D" + "ELETE\\b",
        "my" + "sql2",
        "from ['\"]" + "pg" + "['\"]",
        "supa" + "base"
    ].join("|"), "");
    return forbiddenPattern.test(source);
}
(0, node_test_1.default)("execution gate disabled blocks before repositories are used", async () => {
    const input = makeGateInput({
        config: {
            executionGateEnabled: false
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "disabled");
    strict_1.default.equal(result.allowed, false);
    strict_1.default.deepEqual(result.blockReasons, ["execution_gate_disabled"]);
});
(0, node_test_1.default)("outbox bridge disabled blocks before repositories are used", async () => {
    const input = makeGateInput({
        config: {
            outboxBridgeEnabled: false
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "disabled");
    strict_1.default.deepEqual(result.blockReasons, ["execution_gate_disabled"]);
});
(0, node_test_1.default)("sandbox not eligible blocks before repositories are used", async () => {
    const input = makeGateInput({
        sandboxEvaluation: {
            status: "blocked",
            eligible: false,
            blockReasons: ["recipient_not_whitelisted"],
            warnings: [],
            executionPreview: {
                canExecute: false,
                channel: "whatsapp",
                recipientMasked: "569*****111",
                messagePreview: null,
                idempotencyKey: "outbox:action:action-001:gate:test-001"
            }
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("sandbox_not_eligible"));
});
(0, node_test_1.default)("unsupported action type blocks before repositories are used", async () => {
    const input = makeGateInput({
        action: {
            actionType: "schedule_followup"
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("unsupported_action_type"));
});
(0, node_test_1.default)("invalid lifecycle status blocks before repositories are used", async () => {
    const input = makeGateInput({
        action: {
            status: "executed"
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("invalid_lifecycle_transition"));
});
(0, node_test_1.default)("risk too high blocks before repositories are used", async () => {
    const input = makeGateInput({
        action: {
            riskLevel: "medium"
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("risk_not_allowed"));
});
(0, node_test_1.default)("approval required blocks before repositories are used", async () => {
    const input = makeGateInput({
        action: {
            approvalRequirement: "operator_review"
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("approval_not_satisfied"));
});
(0, node_test_1.default)("human owner active blocks before repositories are used", async () => {
    const input = makeGateInput({
        context: {
            humanOwnerActive: true
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("human_owner_active"));
});
(0, node_test_1.default)("ai blocked blocks before repositories are used", async () => {
    const input = makeGateInput({
        context: {
            aiBlocked: true
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("ai_blocked"));
});
(0, node_test_1.default)("closed case blocks before repositories are used", async () => {
    const input = makeGateInput({
        context: {
            caseStatus: "closed"
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("case_closed"));
});
(0, node_test_1.default)("missing recipient blocks before repositories are used", async () => {
    const input = makeGateInput({
        action: {
            waId: null
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("missing_recipient"));
});
(0, node_test_1.default)("missing message blocks before repositories are used", async () => {
    const input = makeGateInput({
        action: {
            draftMessage: null,
            finalMessage: null
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("unsafe_message"));
});
(0, node_test_1.default)("unsafe message blocks before repositories are used", async () => {
    const input = makeGateInput({
        action: {
            draftMessage: "Hay stock asegurado para hoy.",
            finalMessage: null
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("unsafe_message"));
});
(0, node_test_1.default)("expired action blocks before repositories are used", async () => {
    const input = makeGateInput({
        action: {
            expiresAt: "2026-06-16T12:00:00.000Z"
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "expired");
    strict_1.default.ok(result.blockReasons.includes("action_expired"));
});
(0, node_test_1.default)("conflicting action blocks before repositories are used", async () => {
    const input = makeGateInput({
        context: {
            conflictingActionExists: true
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.blockReasons.includes("conflicting_action"));
});
(0, node_test_1.default)("missing idempotency key is invalid", async () => {
    const input = makeGateInput({
        action: {
            idempotencyKey: ""
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: makeThrowingUnitOfWork() });
    strict_1.default.equal(result.status, "invalid");
    strict_1.default.ok(result.blockReasons.includes("missing_idempotency_key"));
});
(0, node_test_1.default)("pure evaluator allows an eligible action", () => {
    const evaluation = (0, execution_gate_1.evaluateExecutionGate)(makeGateInput());
    strict_1.default.equal(evaluation.status, "allowed");
    strict_1.default.equal(evaluation.allowed, true);
    strict_1.default.deepEqual(evaluation.blockReasons, []);
});
(0, node_test_1.default)("proposed low-risk action plans through the gate", async () => {
    const input = makeGateInput();
    const harness = makeRepositoryHarness(input.action);
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: harness.unitOfWork });
    strict_1.default.equal(result.status, "allowed");
    strict_1.default.equal(result.allowed, true);
    strict_1.default.equal(result.outboxCommand?.commandType, "whatsapp_text");
    strict_1.default.equal(result.repositoryResult.outboxInserted, true);
    strict_1.default.equal(result.repositoryResult.actionUpdated, true);
    strict_1.default.equal(result.repositoryResult.duplicateDetected, false);
    strict_1.default.equal(result.sideEffects.messageSent, false);
    strict_1.default.equal(result.sideEffects.metaCalled, false);
    strict_1.default.equal(result.sideEffects.workerTriggered, false);
    strict_1.default.equal(harness.actionRepo.snapshot()[0].status, "planned");
    strict_1.default.equal(harness.actionRepo.snapshot()[0].outboxMessageId, harness.outboxRepo.snapshot()[0].id);
    strict_1.default.equal(harness.outboxRepo.snapshot().length, 1);
    strict_1.default.equal(harness.outboxRepo.snapshot()[0].status, "planned");
});
(0, node_test_1.default)("approved action also plans through the gate", async () => {
    const input = makeGateInput({
        action: {
            status: "approved"
        }
    });
    const harness = makeRepositoryHarness(input.action);
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: harness.unitOfWork });
    strict_1.default.equal(result.status, "allowed");
    strict_1.default.equal(harness.actionRepo.snapshot()[0].status, "planned");
});
(0, node_test_1.default)("command builder is deterministic", () => {
    const action = makeAction();
    const first = (0, buildOutboxCommand_1.buildOutboxCommand)({ action, evaluatedAt: FIXED_TIME });
    const second = (0, buildOutboxCommand_1.buildOutboxCommand)({ action, evaluatedAt: FIXED_TIME });
    strict_1.default.deepEqual(first, second);
    strict_1.default.equal(first.commandId, "outbox:action:action-001:gate:test-001");
    strict_1.default.equal(first.idempotencyKey, "outbox:action:action-001:gate:test-001");
});
(0, node_test_1.default)("duplicate outbox is detected without inserting a second row", async () => {
    const input = makeGateInput();
    const seededCommand = (0, buildOutboxCommand_1.buildOutboxCommand)({ action: input.action, evaluatedAt: FIXED_TIME });
    const harness = makeRepositoryHarness(input.action, {
        outboxSeed: [
            {
                id: 7,
                status: "planned",
                command: seededCommand
            }
        ]
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: harness.unitOfWork });
    strict_1.default.equal(result.status, "duplicate");
    strict_1.default.equal(result.repositoryResult.duplicateDetected, true);
    strict_1.default.equal(result.repositoryResult.outboxInserted, false);
    strict_1.default.equal(harness.actionRepo.snapshot()[0].status, "planned");
    strict_1.default.equal(harness.actionRepo.snapshot()[0].outboxMessageId, 7);
    strict_1.default.equal(harness.outboxRepo.snapshot().length, 1);
});
(0, node_test_1.default)("retry does not duplicate the outbox", async () => {
    const input = makeGateInput();
    const seededCommand = (0, buildOutboxCommand_1.buildOutboxCommand)({ action: input.action, evaluatedAt: FIXED_TIME });
    const harness = makeRepositoryHarness(input.action, {
        outboxSeed: [
            {
                id: 7,
                status: "planned",
                command: seededCommand
            }
        ]
    });
    const first = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: harness.unitOfWork });
    const second = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: harness.unitOfWork });
    strict_1.default.equal(first.status, "duplicate");
    strict_1.default.equal(second.status, "duplicate");
    strict_1.default.equal(harness.outboxRepo.snapshot().length, 1);
});
(0, node_test_1.default)("repository failure returns failed", async () => {
    const input = makeGateInput();
    const harness = makeRepositoryHarness(input.action, {
        outboxFailures: {
            failNextInsert: true
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: harness.unitOfWork });
    strict_1.default.equal(result.status, "failed");
    strict_1.default.ok(result.blockReasons.includes("repository_failure"));
});
(0, node_test_1.default)("transaction failure rolls back and leaves no orphan outbox", async () => {
    const input = makeGateInput();
    const harness = makeRepositoryHarness(input.action, {
        uow: {
            failNextCommit: true
        }
    });
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: harness.unitOfWork });
    strict_1.default.equal(result.status, "failed");
    strict_1.default.ok(result.blockReasons.includes("transaction_failure"));
    strict_1.default.equal(harness.outboxRepo.snapshot().length, 0);
    strict_1.default.equal(harness.actionRepo.snapshot()[0].status, "proposed");
    strict_1.default.equal(harness.actionRepo.snapshot()[0].outboxMessageId, null);
});
(0, node_test_1.default)("allowed execution never sends, calls Meta or triggers a worker", async () => {
    const input = makeGateInput();
    const harness = makeRepositoryHarness(input.action);
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: harness.unitOfWork });
    strict_1.default.deepEqual(result.sideEffects, {
        messageSent: false,
        metaCalled: false,
        workerTriggered: false
    });
});
(0, node_test_1.default)("input action is not mutated", async () => {
    const input = makeGateInput();
    const before = JSON.stringify(input.action);
    const harness = makeRepositoryHarness(input.action);
    await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork: harness.unitOfWork });
    strict_1.default.equal(JSON.stringify(input.action), before);
});
(0, node_test_1.default)("in-memory repositories work as a storage-agnostic adapter", async () => {
    const input = makeGateInput({
        action: {
            status: "approved"
        }
    });
    const actionRepo = new execution_gate_1.InMemoryAgentActionRepository([input.action]);
    const outboxRepo = new execution_gate_1.InMemoryOutboxRepository([]);
    const unitOfWork = new execution_gate_1.InMemoryExecutionUnitOfWork(actionRepo, outboxRepo);
    const result = await (0, execution_gate_1.executeActionThroughGate)(input, { unitOfWork });
    strict_1.default.equal(result.status, "allowed");
    strict_1.default.equal(actionRepo.snapshot()[0].status, "planned");
    strict_1.default.equal(outboxRepo.snapshot().length, 1);
});
(0, node_test_1.default)("recipient remains masked in previews", () => {
    strict_1.default.equal((0, autonomy_sandbox_1.maskWaId)("56912345678"), "569*****678");
});
(0, node_test_1.default)("execution gate source stays free of direct storage keywords and adapters", () => {
    const source = readExecutionGateSources();
    strict_1.default.equal(hasForbiddenStorageText(source), false);
});
