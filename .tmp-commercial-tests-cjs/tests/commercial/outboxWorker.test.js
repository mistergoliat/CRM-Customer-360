"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const index_js_1 = require("../../lib/brain/messaging/outbox-worker/index.js");
const FIXED_NOW = "2026-06-17T12:00:00.000Z";
const BASE_CREATED_AT = "2026-06-17T10:00:00.000Z";
const BASE_EXPIRES_AT = "2026-06-18T12:00:00.000Z";
const BASE_WORKER_ID = "worker-1";
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
function shiftIso(iso, seconds) {
    return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}
function makeRecord(overrides = {}) {
    const { metadata: metadataOverrides, ...recordOverrides } = overrides;
    const base = {
        rowId: 1,
        commandId: "command-001",
        idempotencyKey: "outbox:test-001",
        actionId: "action-001",
        channel: "whatsapp",
        commandType: "whatsapp_text",
        recipient: "56911111111",
        messageText: "Hola, te ayudamos con tu consulta.",
        status: "pending",
        attemptCount: 0,
        maxAttempts: 3,
        availableAt: FIXED_NOW,
        expiresAt: BASE_EXPIRES_AT,
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null,
        lastAttemptAt: null,
        deliveredAt: null,
        providerMessageId: null,
        lastErrorCode: null,
        lastErrorMessageSafe: null,
        metadata: {
            source: "ai_sdr",
            sandbox: true,
            riskLevel: "low",
            approvalRequirement: "none"
        },
        createdAt: BASE_CREATED_AT,
        updatedAt: BASE_CREATED_AT
    };
    return {
        ...base,
        ...recordOverrides,
        metadata: {
            ...base.metadata,
            ...(metadataOverrides ?? {})
        }
    };
}
function makeConfig(overrides = {}) {
    return {
        workerEnabled: true,
        transportEnabled: true,
        workerId: BASE_WORKER_ID,
        batchSize: 10,
        leaseSeconds: 60,
        defaultMaxAttempts: 3,
        baseRetrySeconds: 30,
        maxRetrySeconds: 3600,
        retryJitterEnabled: false,
        recoverExpiredLeases: false,
        sandboxRequired: false,
        ...overrides
    };
}
function makeInput(overrides = {}) {
    return {
        now: overrides.now ?? FIXED_NOW,
        record: makeRecord(overrides.record ?? {}),
        config: makeConfig(overrides.config ?? {})
    };
}
function makeTransport(scenarios) {
    return new index_js_1.FakeMessageTransport({
        scenarioByIdempotencyKey: scenarios
    });
}
function makeTransportScenario(scenario) {
    return scenario;
}
function expectNoSideEffects(plan) {
    strict_1.default.equal(plan.sideEffects.databaseWritten, false);
    strict_1.default.equal(plan.sideEffects.externalMessageSent, false);
    strict_1.default.equal(plan.sideEffects.metaCalled, false);
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
function readTestAndModuleSource() {
    const folder = (0, node_path_1.resolve)(process.cwd(), "lib/brain/messaging/outbox-worker");
    const testFile = (0, node_path_1.resolve)(process.cwd(), "tests/commercial/outboxWorker.test.ts");
    return `${readSourceTree(folder)}\n${(0, node_fs_1.readFileSync)(testFile, "utf8")}`;
}
function hasForbiddenSource(source) {
    const pattern = new RegExp([
        "D" + "ate\\.now",
        "r" + "andomUUID",
        "M" + "ath\\.random",
        "set" + "Timeout",
        "set" + "Interval",
        "process" + "\\.env",
        "fetch\\(",
        "my" + "sql2",
        "from ['\"]" + "pg" + "['\"]",
        "supa" + "base",
        "SE" + "LECT\\s",
        "IN" + "SERT\\s",
        "UP" + "DATE\\s",
        "DE" + "LETE\\s",
        "graph" + "\\.facebook",
        "send" + "WhatsApp"
    ].join("|"));
    return pattern.test(source);
}
(0, node_test_1.default)("worker disabled produces a skip decision", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ config: { workerEnabled: false } }));
    strict_1.default.equal(result.decision, "skip");
    strict_1.default.equal(result.reasons[0], "worker_disabled");
});
(0, node_test_1.default)("transport disabled produces a skip decision", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ config: { transportEnabled: false } }));
    strict_1.default.equal(result.decision, "skip");
    strict_1.default.equal(result.reasons[0], "transport_disabled");
});
(0, node_test_1.default)("sandbox required but missing is invalid", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({
        config: { sandboxRequired: true },
        record: { metadata: { sandbox: false } }
    }));
    strict_1.default.equal(result.decision, "invalid");
    strict_1.default.equal(result.reasons[0], "sandbox_required");
});
(0, node_test_1.default)("missing command id is invalid", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { commandId: "" } }));
    strict_1.default.equal(result.decision, "invalid");
    strict_1.default.equal(result.reasons[0], "missing_command_id");
});
(0, node_test_1.default)("missing idempotency key is invalid", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { idempotencyKey: " " } }));
    strict_1.default.equal(result.decision, "invalid");
    strict_1.default.equal(result.reasons[0], "missing_idempotency_key");
});
(0, node_test_1.default)("unsupported channel is invalid", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { channel: "email" } }));
    strict_1.default.equal(result.decision, "invalid");
    strict_1.default.equal(result.reasons[0], "unsupported_channel");
});
(0, node_test_1.default)("unsupported command type is invalid", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { commandType: "email_text" } }));
    strict_1.default.equal(result.decision, "invalid");
    strict_1.default.equal(result.reasons[0], "unsupported_command_type");
});
(0, node_test_1.default)("missing recipient is invalid", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { recipient: " " } }));
    strict_1.default.equal(result.decision, "invalid");
    strict_1.default.equal(result.reasons[0], "missing_recipient");
});
(0, node_test_1.default)("missing message is invalid", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { messageText: " " } }));
    strict_1.default.equal(result.decision, "invalid");
    strict_1.default.equal(result.reasons[0], "missing_message");
});
(0, node_test_1.default)("pending candidate is processable", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput());
    strict_1.default.equal(result.decision, "process");
    strict_1.default.equal(result.actionable, true);
});
(0, node_test_1.default)("retry_scheduled candidate is processable", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { status: "retry_scheduled" } }));
    strict_1.default.equal(result.decision, "process");
    strict_1.default.equal(result.actionable, true);
});
(0, node_test_1.default)("delivered candidate is skipped", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { status: "delivered" } }));
    strict_1.default.equal(result.decision, "skip");
    strict_1.default.equal(result.reasons[0], "status_not_reclaimable");
});
(0, node_test_1.default)("dead_letter candidate is skipped", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { status: "dead_letter" } }));
    strict_1.default.equal(result.decision, "skip");
    strict_1.default.equal(result.reasons[0], "status_not_reclaimable");
});
(0, node_test_1.default)("cancelled candidate is skipped", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { status: "cancelled" } }));
    strict_1.default.equal(result.decision, "skip");
    strict_1.default.equal(result.reasons[0], "status_not_reclaimable");
});
(0, node_test_1.default)("not yet available candidate is skipped", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { availableAt: shiftIso(FIXED_NOW, 300) } }));
    strict_1.default.equal(result.decision, "skip");
    strict_1.default.equal(result.reasons[0], "not_yet_available");
});
(0, node_test_1.default)("expired candidate is expired", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { expiresAt: "2026-06-17T11:59:59.000Z" } }));
    strict_1.default.equal(result.decision, "expire");
    strict_1.default.equal(result.reasons[0], "message_expired");
});
(0, node_test_1.default)("attempts exhausted candidate is dead_letter", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { attemptCount: 3, maxAttempts: 3 } }));
    strict_1.default.equal(result.decision, "dead_letter");
    strict_1.default.equal(result.reasons[0], "attempts_exhausted");
});
(0, node_test_1.default)("wrong worker claim is skipped", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({
        record: {
            status: "claimed",
            claimedBy: "worker-2",
            leaseExpiresAt: "2026-06-17T13:00:00.000Z"
        },
        config: { workerId: "worker-1" }
    }));
    strict_1.default.equal(result.decision, "skip");
    strict_1.default.equal(result.reasons[0], "wrong_worker_claim");
});
(0, node_test_1.default)("expired lease can be reclaimed", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({
        record: {
            status: "claimed",
            claimedBy: "worker-2",
            leaseExpiresAt: "2026-06-17T11:00:00.000Z"
        },
        config: { workerId: "worker-1", recoverExpiredLeases: true }
    }));
    strict_1.default.equal(result.decision, "process");
    strict_1.default.equal(result.claimRecoverable, true);
});
(0, node_test_1.default)("active lease that is not recoverable is skipped", () => {
    const result = (0, index_js_1.evaluateOutboxCandidate)(makeInput({
        record: {
            status: "claimed",
            claimedBy: "worker-2",
            leaseExpiresAt: "2026-06-17T13:00:00.000Z"
        },
        config: { workerId: "worker-1", recoverExpiredLeases: false }
    }));
    strict_1.default.equal(result.decision, "skip");
    strict_1.default.equal(result.reasons[0], "wrong_worker_claim");
});
(0, node_test_1.default)("retry schedule is deterministic and capped", () => {
    const exponential = (0, index_js_1.calculateOutboxRetrySchedule)({
        now: FIXED_NOW,
        attemptCount: 3,
        maxAttempts: 10,
        expiresAt: null,
        retryAfterSeconds: null,
        baseRetrySeconds: 30,
        maxRetrySeconds: 3600
    });
    const capped = (0, index_js_1.calculateOutboxRetrySchedule)({
        now: FIXED_NOW,
        attemptCount: 4,
        maxAttempts: 10,
        expiresAt: null,
        retryAfterSeconds: null,
        baseRetrySeconds: 1000,
        maxRetrySeconds: 120
    });
    strict_1.default.equal(exponential.retryAt, "2026-06-17T12:02:00.000Z");
    strict_1.default.equal(exponential.delaySeconds, 120);
    strict_1.default.equal(exponential.exhausted, false);
    strict_1.default.equal(capped.delaySeconds, 120);
});
(0, node_test_1.default)("build ids are deterministic", () => {
    const base = {
        rowId: 1,
        commandId: "command-001",
        attemptCount: 0,
        planType: "mark_delivered",
        createdAt: FIXED_NOW
    };
    strict_1.default.equal((0, index_js_1.buildOutboxWorkerPlanId)(base), (0, index_js_1.buildOutboxWorkerPlanId)(base));
    strict_1.default.equal((0, index_js_1.buildOutboxWorkerPlanKey)(base), (0, index_js_1.buildOutboxWorkerPlanKey)(base));
    strict_1.default.equal((0, index_js_1.buildOutboxAuditEventId)({
        ...base,
        eventType: "outbox_delivered",
        createdAt: FIXED_NOW
    }), (0, index_js_1.buildOutboxAuditEventId)({
        ...base,
        eventType: "outbox_delivered",
        createdAt: FIXED_NOW
    }));
    strict_1.default.equal((0, index_js_1.buildFakeProviderMessageId)({ commandId: base.commandId }), "fake-provider:command-001");
});
(0, node_test_1.default)("same input produces the same plan", () => {
    const input = {
        now: FIXED_NOW,
        record: makeRecord(),
        config: makeConfig()
    };
    const first = (0, index_js_1.buildProcessingOutboxWorkerPlan)({
        now: input.now,
        record: input.record,
        config: input.config,
        evaluation: (0, index_js_1.evaluateOutboxCandidate)(input)
    });
    const second = (0, index_js_1.buildProcessingOutboxWorkerPlan)({
        now: input.now,
        record: input.record,
        config: input.config,
        evaluation: (0, index_js_1.evaluateOutboxCandidate)(input)
    });
    strict_1.default.deepEqual(first, second);
});
(0, node_test_1.default)("input is not mutated by the builder or processor", async () => {
    const input = makeInput();
    const inputCopy = cloneJson(input);
    (0, index_js_1.buildOutboxWorkerPlan)({
        now: input.now,
        record: input.record,
        config: input.config,
        evaluation: (0, index_js_1.evaluateOutboxCandidate)(input),
        transportResult: null,
        phase: "final"
    });
    await (0, index_js_1.processOutboxMessage)(input, { transport: new index_js_1.FakeMessageTransport() });
    strict_1.default.deepEqual(input, inputCopy);
});
(0, node_test_1.default)("accepted transport marks delivered", async () => {
    const input = makeInput({ record: { idempotencyKey: "outbox:accepted" } });
    const transport = makeTransport({ "outbox:accepted": makeTransportScenario("accepted") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    strict_1.default.equal(result.status, "delivered");
    strict_1.default.equal(result.finalPlan?.planType, "mark_delivered");
    strict_1.default.equal(result.finalPlan?.patch.nextStatus, "delivered");
    strict_1.default.equal(transport.snapshotCalls().length, 1);
});
(0, node_test_1.default)("duplicate accepted transport marks delivered", async () => {
    const input = makeInput({ record: { idempotencyKey: "outbox:duplicate" } });
    const transport = makeTransport({ "outbox:duplicate": makeTransportScenario("duplicate_accepted") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    strict_1.default.equal(result.status, "delivered");
    strict_1.default.equal(result.finalPlan?.planType, "mark_delivered");
    strict_1.default.equal(result.finalPlan?.patch.nextStatus, "delivered");
});
(0, node_test_1.default)("temporary failure schedules retry", async () => {
    const input = makeInput({ record: { idempotencyKey: "outbox:retry-001" } });
    const transport = makeTransport({ "outbox:retry-001": makeTransportScenario("temporary_failure") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    strict_1.default.equal(result.status, "retry_scheduled");
    strict_1.default.equal(result.finalPlan?.planType, "schedule_retry");
    strict_1.default.equal(result.finalPlan?.patch.nextStatus, "retry_scheduled");
    strict_1.default.equal(result.finalPlan?.patch.availableAt, "2026-06-17T12:00:30.000Z");
});
(0, node_test_1.default)("timeout schedules retry", async () => {
    const input = makeInput({ record: { idempotencyKey: "outbox:retry-002" } });
    const transport = makeTransport({ "outbox:retry-002": makeTransportScenario("timeout") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    strict_1.default.equal(result.status, "retry_scheduled");
    strict_1.default.equal(result.finalPlan?.patch.availableAt, "2026-06-17T12:01:00.000Z");
});
(0, node_test_1.default)("rate limit respects retry-after", async () => {
    const input = makeInput({ record: { idempotencyKey: "outbox:retry-003" } });
    const transport = makeTransport({ "outbox:retry-003": makeTransportScenario("rate_limited") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    strict_1.default.equal(result.status, "retry_scheduled");
    strict_1.default.equal(result.finalPlan?.patch.availableAt, "2026-06-17T12:02:00.000Z");
});
(0, node_test_1.default)("permanent failure dead-letters", async () => {
    const input = makeInput({ record: { idempotencyKey: "outbox:perm-001" } });
    const transport = makeTransport({ "outbox:perm-001": makeTransportScenario("permanent_failure") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    strict_1.default.equal(result.status, "dead_letter");
    strict_1.default.equal(result.finalPlan?.patch.nextStatus, "dead_letter");
});
(0, node_test_1.default)("invalid recipient dead-letters", async () => {
    const input = makeInput({ record: { idempotencyKey: "outbox:invalid-001" } });
    const transport = makeTransport({ "outbox:invalid-001": makeTransportScenario("invalid_recipient") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    strict_1.default.equal(result.status, "dead_letter");
    strict_1.default.equal(result.finalPlan?.patch.lastErrorCode, "invalid_recipient");
});
(0, node_test_1.default)("invalid payload dead-letters", async () => {
    const input = makeInput({ record: { idempotencyKey: "outbox:invalid-002" } });
    const transport = makeTransport({ "outbox:invalid-002": makeTransportScenario("invalid_payload") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    strict_1.default.equal(result.status, "dead_letter");
    strict_1.default.equal(result.finalPlan?.patch.lastErrorCode, "invalid_payload");
});
(0, node_test_1.default)("authentication error dead-letters", async () => {
    const input = makeInput({ record: { idempotencyKey: "outbox:auth-001" } });
    const transport = makeTransport({ "outbox:auth-001": makeTransportScenario("authentication_error") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    strict_1.default.equal(result.status, "dead_letter");
    strict_1.default.equal(result.finalPlan?.patch.lastErrorCode, "authentication_error");
});
(0, node_test_1.default)("max attempts exhausted dead-letters before transport", async () => {
    const input = makeInput({
        record: {
            attemptCount: 3,
            maxAttempts: 3,
            idempotencyKey: "outbox:max-attempts"
        }
    });
    const transport = makeTransport({ "outbox:max-attempts": makeTransportScenario("accepted") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    strict_1.default.equal(result.status, "dead_letter");
    strict_1.default.equal(transport.snapshotCalls().length, 0);
});
(0, node_test_1.default)("retry beyond expiry dead-letters", async () => {
    const input = makeInput({
        record: {
            expiresAt: "2026-06-17T12:00:10.000Z",
            idempotencyKey: "outbox:expiry-retry"
        }
    });
    const transport = makeTransport({ "outbox:expiry-retry": makeTransportScenario("temporary_failure") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    strict_1.default.equal(result.status, "dead_letter");
    strict_1.default.equal(result.finalPlan?.planType, "move_to_dead_letter");
});
(0, node_test_1.default)("delivered rows are not resent", async () => {
    const input = makeInput({ record: { status: "delivered", idempotencyKey: "outbox:done" } });
    const transport = makeTransport({ "outbox:done": makeTransportScenario("accepted") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    strict_1.default.equal(result.status, "skipped");
    strict_1.default.equal(transport.snapshotCalls().length, 0);
});
(0, node_test_1.default)("claim sets lease and worker ownership", async () => {
    const repo = new index_js_1.InMemoryOutboxWorkerRepository([makeRecord()]);
    const claimed = await repo.claimAvailable({
        now: FIXED_NOW,
        workerId: "worker-1",
        batchSize: 1,
        leaseExpiresAt: "2026-06-17T12:01:00.000Z",
        recoverExpiredLeases: false
    });
    strict_1.default.equal(claimed.length, 1);
    strict_1.default.equal(claimed[0].status, "claimed");
    strict_1.default.equal(claimed[0].claimedBy, "worker-1");
    strict_1.default.equal(claimed[0].leaseExpiresAt, "2026-06-17T12:01:00.000Z");
});
(0, node_test_1.default)("two workers cannot claim the same row", async () => {
    const repo = new index_js_1.InMemoryOutboxWorkerRepository([makeRecord()]);
    const first = await repo.claimAvailable({
        now: FIXED_NOW,
        workerId: "worker-1",
        batchSize: 1,
        leaseExpiresAt: "2026-06-17T12:01:00.000Z",
        recoverExpiredLeases: false
    });
    const second = await repo.claimAvailable({
        now: FIXED_NOW,
        workerId: "worker-2",
        batchSize: 1,
        leaseExpiresAt: "2026-06-17T12:01:00.000Z",
        recoverExpiredLeases: false
    });
    strict_1.default.equal(first.length, 1);
    strict_1.default.equal(second.length, 0);
});
(0, node_test_1.default)("expired lease can be reclaimed", async () => {
    const repo = new index_js_1.InMemoryOutboxWorkerRepository([
        makeRecord({
            status: "claimed",
            claimedBy: "worker-2",
            leaseExpiresAt: "2026-06-17T11:00:00.000Z"
        })
    ]);
    const claimed = await repo.claimAvailable({
        now: FIXED_NOW,
        workerId: "worker-1",
        batchSize: 1,
        leaseExpiresAt: "2026-06-17T12:01:00.000Z",
        recoverExpiredLeases: true
    });
    strict_1.default.equal(claimed.length, 1);
    strict_1.default.equal(claimed[0].claimedBy, "worker-1");
    strict_1.default.equal(claimed[0].status, "claimed");
});
(0, node_test_1.default)("optimistic conflict is detected", async () => {
    const repo = new index_js_1.InMemoryOutboxWorkerRepository([makeRecord()]);
    const plan = (0, index_js_1.buildFinalOutboxWorkerPlan)({
        now: FIXED_NOW,
        record: makeRecord(),
        config: makeConfig(),
        evaluation: (0, index_js_1.evaluateOutboxCandidate)(makeInput()),
        transportResult: {
            status: "accepted",
            providerMessageId: "fake-provider:command-001",
            providerRequestId: "fake-request:command-001",
            errorCode: "none",
            errorMessageSafe: null,
            retryAfterSeconds: null,
            acceptedAt: FIXED_NOW,
            completedAt: FIXED_NOW,
            metadata: {
                provider: "fake",
                sandbox: true,
                simulated: true
            }
        }
    });
    const result = await repo.applyWorkerPlan(plan);
    strict_1.default.equal(result.applied, false);
    strict_1.default.equal(result.conflict, true);
});
(0, node_test_1.default)("duplicate plan key is ignored", async () => {
    const repo = new index_js_1.InMemoryOutboxWorkerRepository([makeRecord()]);
    const plan = (0, index_js_1.buildProcessingOutboxWorkerPlan)({
        now: FIXED_NOW,
        record: makeRecord(),
        config: makeConfig(),
        evaluation: (0, index_js_1.evaluateOutboxCandidate)(makeInput())
    });
    const first = await repo.applyWorkerPlan(plan);
    const second = await repo.applyWorkerPlan(plan);
    strict_1.default.equal(first.applied, true);
    strict_1.default.equal(second.applied, false);
    strict_1.default.equal(second.duplicate, true);
});
(0, node_test_1.default)("duplicate idempotency is rolled back", async () => {
    const repo = new index_js_1.InMemoryOutboxWorkerRepository([
        makeRecord({ rowId: 1, idempotencyKey: "outbox:dupe-key" }),
        makeRecord({ rowId: 2, idempotencyKey: "outbox:dupe-key" })
    ]);
    const before = repo.snapshotState();
    const uow = new index_js_1.InMemoryOutboxWorkerUnitOfWork(repo);
    await strict_1.default.rejects(async () => {
        await uow.run(async ({ outbox }) => {
            const first = (0, index_js_1.buildProcessingOutboxWorkerPlan)({
                now: FIXED_NOW,
                record: makeRecord({ rowId: 1, idempotencyKey: "outbox:dupe-key" }),
                config: makeConfig(),
                evaluation: (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { rowId: 1, idempotencyKey: "outbox:dupe-key" } }))
            });
            const second = (0, index_js_1.buildProcessingOutboxWorkerPlan)({
                now: FIXED_NOW,
                record: makeRecord({ rowId: 2, idempotencyKey: "outbox:dupe-key" }),
                config: makeConfig(),
                evaluation: (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { rowId: 2, idempotencyKey: "outbox:dupe-key" } }))
            });
            const firstResult = await outbox.applyWorkerPlan(first);
            strict_1.default.equal(firstResult.applied, true);
            const secondResult = await outbox.applyWorkerPlan(second);
            if (secondResult.duplicate) {
                throw new Error("duplicate_idempotency");
            }
            return secondResult;
        });
    });
    strict_1.default.deepEqual(repo.snapshotState(), before);
});
(0, node_test_1.default)("repository failure rolls back a staged transaction", async () => {
    const repo = new index_js_1.InMemoryOutboxWorkerRepository([makeRecord()], {
        failureFlags: {
            failOnPlanType: ["mark_delivered"]
        }
    });
    const before = repo.snapshotState();
    const uow = new index_js_1.InMemoryOutboxWorkerUnitOfWork(repo);
    await strict_1.default.rejects(async () => {
        await uow.run(async ({ outbox }) => {
            const processing = (0, index_js_1.buildProcessingOutboxWorkerPlan)({
                now: FIXED_NOW,
                record: makeRecord(),
                config: makeConfig(),
                evaluation: (0, index_js_1.evaluateOutboxCandidate)(makeInput())
            });
            await outbox.applyWorkerPlan(processing);
            const delivered = (0, index_js_1.buildFinalOutboxWorkerPlan)({
                now: FIXED_NOW,
                record: makeRecord({ attemptCount: 1, status: "processing" }),
                config: makeConfig(),
                evaluation: (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { status: "processing", attemptCount: 1 } })),
                transportResult: {
                    status: "accepted",
                    providerMessageId: "fake-provider:command-001",
                    providerRequestId: "fake-request:command-001",
                    errorCode: "none",
                    errorMessageSafe: null,
                    retryAfterSeconds: null,
                    acceptedAt: FIXED_NOW,
                    completedAt: FIXED_NOW,
                    metadata: {
                        provider: "fake",
                        sandbox: true,
                        simulated: true
                    }
                }
            });
            await outbox.applyWorkerPlan(delivered);
        });
    });
    strict_1.default.deepEqual(repo.snapshotState(), before);
});
(0, node_test_1.default)("processing-plan failure prevents transport", async () => {
    const repo = new index_js_1.InMemoryOutboxWorkerRepository([makeRecord()], {
        failureFlags: {
            failOnPlanType: ["mark_processing"]
        }
    });
    const uow = new index_js_1.InMemoryOutboxWorkerUnitOfWork(repo);
    const transport = new index_js_1.FakeMessageTransport();
    const result = await (0, index_js_1.processOutboxBatch)({
        now: FIXED_NOW,
        config: makeConfig({ batchSize: 1 })
    }, {
        transport,
        unitOfWork: uow
    });
    strict_1.default.equal(result.failed, 1);
    strict_1.default.equal(transport.snapshotCalls().length, 0);
});
(0, node_test_1.default)("final-plan failure reports failure", async () => {
    const repo = new index_js_1.InMemoryOutboxWorkerRepository([makeRecord()], {
        failureFlags: {
            failOnPlanType: ["mark_delivered"]
        }
    });
    const uow = new index_js_1.InMemoryOutboxWorkerUnitOfWork(repo);
    const result = await (0, index_js_1.processOutboxBatch)({
        now: FIXED_NOW,
        config: makeConfig({ batchSize: 1 })
    }, {
        transport: new index_js_1.FakeMessageTransport({ scenarioByIdempotencyKey: { "outbox:test-001": "accepted" } }),
        unitOfWork: uow
    });
    strict_1.default.equal(result.failed, 1);
    strict_1.default.equal(result.results[0]?.status, "failed");
});
(0, node_test_1.default)("no partial state remains after a failed commit", async () => {
    const repo = new index_js_1.InMemoryOutboxWorkerRepository([makeRecord()]);
    const before = repo.snapshotState();
    const uow = new index_js_1.InMemoryOutboxWorkerUnitOfWork(repo, { failNextCommit: true });
    await strict_1.default.rejects(async () => {
        await uow.run(async ({ outbox }) => {
            const processing = (0, index_js_1.buildProcessingOutboxWorkerPlan)({
                now: FIXED_NOW,
                record: makeRecord(),
                config: makeConfig(),
                evaluation: (0, index_js_1.evaluateOutboxCandidate)(makeInput())
            });
            await outbox.applyWorkerPlan(processing);
        });
    });
    strict_1.default.deepEqual(repo.snapshotState(), before);
});
(0, node_test_1.default)("batch respects batch size", async () => {
    const repo = new index_js_1.InMemoryOutboxWorkerRepository([
        makeRecord({ rowId: 1, idempotencyKey: "batch-001" }),
        makeRecord({ rowId: 2, idempotencyKey: "batch-002" }),
        makeRecord({ rowId: 3, idempotencyKey: "batch-003" })
    ]);
    const transport = new index_js_1.FakeMessageTransport({
        scenarioByIdempotencyKey: {
            "batch-001": "accepted",
            "batch-002": "accepted",
            "batch-003": "accepted"
        }
    });
    const uow = new index_js_1.InMemoryOutboxWorkerUnitOfWork(repo);
    const result = await (0, index_js_1.processOutboxBatch)({
        now: FIXED_NOW,
        config: makeConfig({ batchSize: 2 })
    }, {
        transport,
        unitOfWork: uow
    });
    strict_1.default.equal(result.claimed, 2);
    strict_1.default.equal(result.processed, 2);
    strict_1.default.equal(result.results.length, 2);
    strict_1.default.equal(repo.snapshot().length, 3);
    strict_1.default.equal(repo.snapshot()[2].status, "pending");
});
(0, node_test_1.default)("batch processes records sequentially", async () => {
    const repo = new index_js_1.InMemoryOutboxWorkerRepository([
        makeRecord({ rowId: 1, idempotencyKey: "seq-001" }),
        makeRecord({ rowId: 2, idempotencyKey: "seq-002" })
    ]);
    const transport = new index_js_1.FakeMessageTransport({
        scenarioByIdempotencyKey: {
            "seq-001": "accepted",
            "seq-002": "temporary_failure"
        }
    });
    const uow = new index_js_1.InMemoryOutboxWorkerUnitOfWork(repo);
    const result = await (0, index_js_1.processOutboxBatch)({
        now: FIXED_NOW,
        config: makeConfig({ batchSize: 2 })
    }, {
        transport,
        unitOfWork: uow
    });
    strict_1.default.deepEqual(transport.snapshotCalls().map((call) => call.idempotencyKey), ["seq-001", "seq-002"]);
    strict_1.default.equal(result.delivered, 1);
    strict_1.default.equal(result.retryScheduled, 1);
});
(0, node_test_1.default)("batch summary is correct", async () => {
    const repo = new index_js_1.InMemoryOutboxWorkerRepository([
        makeRecord({ rowId: 1, idempotencyKey: "summary-001" }),
        makeRecord({ rowId: 2, idempotencyKey: "summary-002" })
    ]);
    const transport = new index_js_1.FakeMessageTransport({
        scenarioByIdempotencyKey: {
            "summary-001": "accepted",
            "summary-002": "permanent_failure"
        }
    });
    const uow = new index_js_1.InMemoryOutboxWorkerUnitOfWork(repo);
    const result = await (0, index_js_1.processOutboxBatch)({
        now: FIXED_NOW,
        config: makeConfig({ batchSize: 2 })
    }, {
        transport,
        unitOfWork: uow
    });
    strict_1.default.equal(result.claimed, 2);
    strict_1.default.equal(result.processed, 2);
    strict_1.default.equal(result.delivered, 1);
    strict_1.default.equal(result.deadLettered, 1);
    strict_1.default.equal(result.failed, 0);
});
(0, node_test_1.default)("audit data does not include recipient or message body", async () => {
    const input = makeInput({ record: { idempotencyKey: "audit-001" } });
    const transport = makeTransport({ "audit-001": makeTransportScenario("accepted") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    const serialized = JSON.stringify(result.finalPlan);
    strict_1.default.equal(serialized.includes(input.record.recipient), false);
    strict_1.default.equal(serialized.includes(input.record.messageText), false);
});
(0, node_test_1.default)("errors are sanitized", () => {
    const sanitized = (0, index_js_1.sanitizeOutboxWorkerErrorMessage)("Bearer secret-token 1234567890\npassword=abc");
    strict_1.default.equal(sanitized?.includes("secret-token"), false);
    strict_1.default.equal(sanitized?.includes("1234567890"), false);
    strict_1.default.equal(sanitized?.includes("\n"), false);
});
(0, node_test_1.default)("side effect flags are stable and correct", async () => {
    const input = makeInput({ record: { idempotencyKey: "side-effects-001" } });
    const transport = makeTransport({ "side-effects-001": makeTransportScenario("accepted") });
    const result = await (0, index_js_1.processOutboxMessage)(input, { transport });
    strict_1.default.equal(result.sideEffects.databaseWritten, false);
    strict_1.default.equal(result.sideEffects.externalMessageSent, false);
    strict_1.default.equal(result.sideEffects.metaCalled, false);
    strict_1.default.equal(result.sideEffects.messageTransportCalled, true);
    strict_1.default.equal(result.processingPlan?.sideEffects.messageTransportCalled, false);
    strict_1.default.equal(result.finalPlan?.sideEffects.messageTransportCalled, true);
    expectNoSideEffects(result.processingPlan);
});
(0, node_test_1.default)("plan retry helper is idempotent", () => {
    const input = {
        now: FIXED_NOW,
        record: makeRecord(),
        config: makeConfig(),
        evaluation: (0, index_js_1.evaluateOutboxCandidate)(makeInput()),
        transportResult: {
            status: "accepted",
            providerMessageId: "fake-provider:command-001",
            providerRequestId: "fake-request:command-001",
            errorCode: "none",
            errorMessageSafe: null,
            retryAfterSeconds: null,
            acceptedAt: FIXED_NOW,
            completedAt: FIXED_NOW,
            metadata: {
                provider: "fake",
                sandbox: true,
                simulated: true
            }
        }
    };
    const first = (0, index_js_1.buildFinalOutboxWorkerPlan)(input);
    const second = (0, index_js_1.buildFinalOutboxWorkerPlan)(input);
    strict_1.default.deepEqual(first, second);
});
(0, node_test_1.default)("build skipped plan stays no change", () => {
    const plan = (0, index_js_1.buildSkippedOutboxWorkerPlan)({
        now: FIXED_NOW,
        record: makeRecord({ status: "delivered" }),
        config: makeConfig(),
        evaluation: (0, index_js_1.evaluateOutboxCandidate)(makeInput({ record: { status: "delivered" } }))
    });
    strict_1.default.equal(plan.planType, "no_change");
    strict_1.default.equal(plan.patch.nextStatus, "delivered");
    expectNoSideEffects(plan);
});
(0, node_test_1.default)("source scan rejects forbidden integration and runtime strings", () => {
    const source = readTestAndModuleSource();
    strict_1.default.equal(hasForbiddenSource(source), false);
});
