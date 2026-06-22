"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const index_js_1 = require("../../lib/brain/messaging/whatsapp-transport/index.js");
const index_js_2 = require("../../lib/brain/messaging/outbox-worker/index.js");
const FIXED_NOW = "2026-06-17T12:00:00.000Z";
const FIXED_COMPLETED_AT = "2026-06-17T12:00:01.000Z";
const GRAPH_BASE_URL = "https://" + "graph" + "." + "facebook.com";
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
function makeConfig(overrides = {}) {
    return {
        enabled: true,
        sandbox: true,
        graphBaseUrl: GRAPH_BASE_URL,
        graphApiVersion: "v25.0",
        phoneNumberId: "1234567890",
        accessToken: "token-abc-123",
        timeoutMs: 10_000,
        allowedRecipients: ["56911111111"],
        requireExactWhitelistMatch: true,
        maxTextLength: 160,
        ...overrides
    };
}
function makeInput(overrides = {}) {
    return {
        now: overrides.now ?? FIXED_NOW,
        input: {
            commandId: "command-001",
            idempotencyKey: "whatsapp:test-001",
            channel: "whatsapp",
            commandType: "whatsapp_text",
            recipient: "+56 9 1111 1111",
            messageText: "Hola, este es un mensaje de prueba.",
            sandbox: true,
            attemptedAt: overrides.now ?? FIXED_NOW,
            ...overrides.input
        },
        config: makeConfig(overrides.config ?? {})
    };
}
function makeTransport(overrides = {}) {
    return new index_js_1.WhatsAppMessageTransport({
        config: makeConfig(overrides.config ?? {}),
        client: overrides.client ?? new index_js_1.FakeWhatsAppHttpClient()
    });
}
function makeRecord(overrides = {}) {
    return {
        rowId: 1,
        commandId: "command-001",
        idempotencyKey: "whatsapp:test-001",
        actionId: "action-001",
        channel: "whatsapp",
        commandType: "whatsapp_text",
        recipient: "+56 9 1111 1111",
        messageText: "Hola, este es un mensaje de prueba.",
        status: "pending",
        attemptCount: 0,
        maxAttempts: 3,
        availableAt: FIXED_NOW,
        expiresAt: "2026-06-18T12:00:00.000Z",
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
        createdAt: "2026-06-17T10:00:00.000Z",
        updatedAt: "2026-06-17T10:00:00.000Z",
        ...overrides
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
function readTestAndModuleSource() {
    const folder = (0, node_path_1.resolve)(process.cwd(), "lib/brain/messaging/whatsapp-transport");
    const testFile = (0, node_path_1.resolve)(process.cwd(), "tests/commercial/whatsappTransport.test.ts");
    return `${readSourceTree(folder)}\n${(0, node_fs_1.readFileSync)(testFile, "utf8")}`;
}
function hasForbiddenSource(source) {
    const pattern = new RegExp([
        "f" + "etch\\(",
        "ax" + "ios",
        "face" + "book-nodejs",
        "whats" + "app.*" + "sdk",
        "pro" + "cess" + "\\.env",
        "D" + "ate\\.now",
        "r" + "andomUUID",
        "M" + "ath\\.random",
        "set" + "Timeout",
        "set" + "Interval",
        "my" + "sql2",
        "from ['\"]" + "pg" + "['\"]",
        "supa" + "base",
        "SE" + "LECT\\s",
        "IN" + "SERT\\s",
        "UP" + "DATE\\s",
        "DE" + "LETE\\s"
    ].join("|"));
    return pattern.test(source);
}
(0, node_test_1.default)("normalize recipient accepts formatted digits and rejects invalid values", () => {
    strict_1.default.equal((0, index_js_1.normalizeWhatsAppRecipient)("+56 9 1111 1111"), "56911111111");
    strict_1.default.equal((0, index_js_1.normalizeWhatsAppRecipient)("56911111111"), "56911111111");
    strict_1.default.equal((0, index_js_1.normalizeWhatsAppRecipient)("56A911111111"), null);
});
(0, node_test_1.default)("validation fails closed for disabled transport and missing sandbox", () => {
    const disabled = (0, index_js_1.validateWhatsAppTransportInput)(makeInput().input, makeConfig({ enabled: false }));
    const sandboxOff = (0, index_js_1.validateWhatsAppTransportInput)(makeInput().input, makeConfig({ sandbox: false }));
    strict_1.default.equal(disabled.ok, false);
    strict_1.default.equal(disabled.errorCode, "policy_rejected");
    strict_1.default.equal(sandboxOff.ok, false);
    strict_1.default.equal(sandboxOff.errorCode, "policy_rejected");
});
(0, node_test_1.default)("validation rejects missing recipient, invalid recipient and whitelist mismatches", () => {
    const missing = (0, index_js_1.validateWhatsAppTransportInput)(makeInput({ input: { recipient: " " } }).input, makeConfig());
    const invalid = (0, index_js_1.validateWhatsAppTransportInput)(makeInput({ input: { recipient: "abc" } }).input, makeConfig());
    const partial = (0, index_js_1.validateWhatsAppTransportInput)(makeInput({ input: { recipient: "5691111111" } }).input, makeConfig());
    strict_1.default.equal(missing.errorCode, "invalid_recipient");
    strict_1.default.equal(invalid.errorCode, "invalid_recipient");
    strict_1.default.equal(partial.errorCode, "invalid_recipient");
});
(0, node_test_1.default)("validation rejects missing ids, unsupported values and malformed payloads", () => {
    const base = makeInput();
    strict_1.default.equal((0, index_js_1.validateWhatsAppTransportInput)({ ...base.input, commandId: "" }, base.config).errorCode, "invalid_payload");
    strict_1.default.equal((0, index_js_1.validateWhatsAppTransportInput)({ ...base.input, idempotencyKey: " " }, base.config).errorCode, "invalid_payload");
    strict_1.default.equal((0, index_js_1.validateWhatsAppTransportInput)({ ...base.input, channel: "email" }, base.config).errorCode, "invalid_payload");
    strict_1.default.equal((0, index_js_1.validateWhatsAppTransportInput)({ ...base.input, commandType: "email_text" }, base.config).errorCode, "invalid_payload");
    strict_1.default.equal((0, index_js_1.validateWhatsAppTransportInput)({ ...base.input, messageText: " " }, base.config).errorCode, "invalid_payload");
    strict_1.default.equal((0, index_js_1.validateWhatsAppTransportInput)({ ...base.input, messageText: "{" + '"' + "messaging_product" + '"' + ":" + '"' + "whatsapp" + '"' + "}" }, base.config).errorCode, "invalid_payload");
    strict_1.default.equal((0, index_js_1.validateWhatsAppTransportInput)({ ...base.input, messageText: "Hola {{name}}" }, base.config).errorCode, "invalid_payload");
});
(0, node_test_1.default)("validation rejects config gaps and invalid timeout", () => {
    const base = makeInput();
    strict_1.default.equal((0, index_js_1.validateWhatsAppTransportInput)(base.input, makeConfig({ phoneNumberId: "" })).errorCode, "invalid_payload");
    strict_1.default.equal((0, index_js_1.validateWhatsAppTransportInput)(base.input, makeConfig({ graphApiVersion: "" })).errorCode, "invalid_payload");
    strict_1.default.equal((0, index_js_1.validateWhatsAppTransportInput)(base.input, makeConfig({ graphBaseUrl: "" })).errorCode, "invalid_payload");
    strict_1.default.equal((0, index_js_1.validateWhatsAppTransportInput)(base.input, makeConfig({ timeoutMs: 0 })).errorCode, "invalid_payload");
    strict_1.default.equal((0, index_js_1.validateWhatsAppTransportInput)(base.input, makeConfig({ accessToken: "" })).errorCode, "authentication_error");
});
(0, node_test_1.default)("request builder produces deterministic request id, URL and body", () => {
    const input = makeInput();
    const request = (0, index_js_1.buildWhatsAppTextRequest)(input.input, input.config);
    strict_1.default.equal(request.requestId, (0, index_js_1.buildWhatsAppRequestId)("command-001", "whatsapp:test-001"));
    strict_1.default.equal(request.url, `${GRAPH_BASE_URL}/v25.0/1234567890/messages`);
    strict_1.default.equal(request.method, "POST");
    strict_1.default.equal(request.body.messaging_product, "whatsapp");
    strict_1.default.equal(request.body.recipient_type, "individual");
    strict_1.default.equal(request.body.to, "56911111111");
    strict_1.default.equal(request.body.type, "text");
    strict_1.default.equal(request.body.text.preview_url, false);
    strict_1.default.equal(request.headers.Authorization.startsWith("Bearer "), true);
    strict_1.default.equal(request.headers["X-Idempotency-Key"], "whatsapp:test-001");
});
(0, node_test_1.default)("safe request summary omits sensitive fields", () => {
    const request = (0, index_js_1.buildWhatsAppTextRequest)(makeInput().input, makeConfig());
    const summary = (0, index_js_1.buildSafeWhatsAppRequestSummary)(request);
    const serialized = JSON.stringify(summary);
    strict_1.default.equal(serialized.includes("token-abc-123"), false);
    strict_1.default.equal(serialized.includes("56911111111"), false);
    strict_1.default.equal(serialized.includes("Bearer "), false);
    strict_1.default.equal(summary.recipientMasked?.includes("56911111111"), false);
    strict_1.default.equal(summary.bodyLength > 0, true);
});
(0, node_test_1.default)("accepted send returns accepted and the fake client records safe logs", async () => {
    const client = new index_js_1.FakeWhatsAppHttpClient({
        scenarioByIdempotencyKey: { "whatsapp:test-001": "accepted" }
    });
    const transport = makeTransport({ client });
    const result = await transport.send(makeInput().input);
    strict_1.default.equal(result.status, "accepted");
    strict_1.default.equal(result.errorCode, "none");
    strict_1.default.equal(result.providerMessageId?.startsWith("wamid.fake:"), true);
    strict_1.default.equal(client.rawRequestsForTests.length, 1);
    strict_1.default.equal(client.snapshotSafeLog()[0]?.recipientMasked?.includes("56911111111"), false);
});
(0, node_test_1.default)("malformed 2xx response is treated as temporary failure", async () => {
    const client = new index_js_1.FakeWhatsAppHttpClient({
        scenarioByIdempotencyKey: { "whatsapp:test-001": "malformed_success" }
    });
    const result = await makeTransport({ client }).send(makeInput().input);
    strict_1.default.equal(result.status, "temporary_failure");
    strict_1.default.equal(result.errorCode, "unknown");
    strict_1.default.equal(result.providerMessageId, null);
});
(0, node_test_1.default)("duplicate accepted responses are preserved", async () => {
    const client = new index_js_1.FakeWhatsAppHttpClient({
        scenarioByIdempotencyKey: { "whatsapp:test-001": "duplicate_accepted" }
    });
    const result = await makeTransport({ client }).send(makeInput().input);
    strict_1.default.equal(result.status, "duplicate_accepted");
    strict_1.default.equal(result.errorCode, "provider_duplicate");
    strict_1.default.equal(result.providerMessageId?.startsWith("wamid.fake:"), true);
});
(0, node_test_1.default)("provider 400, 401, 403 and 404 responses are normalized", async () => {
    const client = new index_js_1.FakeWhatsAppHttpClient({
        scenarioByIdempotencyKey: {
            "whatsapp:test-001": "invalid_recipient",
            "whatsapp:test-002": "invalid_payload",
            "whatsapp:test-003": "policy_rejected",
            "whatsapp:test-004": "authentication_error",
            "whatsapp:test-005": "permission_error"
        }
    });
    const transport = makeTransport({ client });
    strict_1.default.equal((await transport.send({ ...makeInput({ input: { idempotencyKey: "whatsapp:test-001" } }).input })).errorCode, "invalid_recipient");
    strict_1.default.equal((await transport.send({ ...makeInput({ input: { idempotencyKey: "whatsapp:test-002" } }).input })).errorCode, "invalid_payload");
    strict_1.default.equal((await transport.send({ ...makeInput({ input: { idempotencyKey: "whatsapp:test-003" } }).input })).errorCode, "policy_rejected");
    strict_1.default.equal((await transport.send({ ...makeInput({ input: { idempotencyKey: "whatsapp:test-004" } }).input })).errorCode, "authentication_error");
    strict_1.default.equal((await transport.send({ ...makeInput({ input: { idempotencyKey: "whatsapp:test-005" } }).input })).errorCode, "permission_error");
});
(0, node_test_1.default)("HTTP 408, 409, 429 and 5xx responses are classified defensively", () => {
    const context = {
        requestId: "whatsapp-request:test",
        commandId: "command-001",
        idempotencyKey: "whatsapp:test-001",
        attemptedAt: FIXED_NOW,
        recipientMasked: "569***111",
        sandbox: true,
        simulated: true
    };
    const timeout = (0, index_js_1.classifyWhatsAppResponse)({
        statusCode: 408,
        headers: {},
        body: { error: { message: "timeout" } },
        completedAt: FIXED_COMPLETED_AT
    }, context);
    const conflict = (0, index_js_1.classifyWhatsAppResponse)({
        statusCode: 409,
        headers: {},
        body: { error: { message: "conflict" } },
        completedAt: FIXED_COMPLETED_AT
    }, context);
    const rateLimited = (0, index_js_1.classifyWhatsAppResponse)({
        statusCode: 429,
        headers: { "Retry-After": "120" },
        body: { error: { message: "rate limited" } },
        completedAt: FIXED_COMPLETED_AT
    }, context);
    const rateLimitedMalformed = (0, index_js_1.classifyWhatsAppResponse)({
        statusCode: 429,
        headers: { "Retry-After": "bogus" },
        body: { error: { message: "rate limited" } },
        completedAt: FIXED_COMPLETED_AT
    }, context);
    const failure = (0, index_js_1.classifyWhatsAppResponse)({
        statusCode: 500,
        headers: {},
        body: { error: { message: "server error" } },
        completedAt: FIXED_COMPLETED_AT
    }, context);
    const providerUnavailable = (0, index_js_1.classifyWhatsAppResponse)({
        statusCode: 503,
        headers: {},
        body: { error: { message: "unavailable" } },
        completedAt: FIXED_COMPLETED_AT
    }, context);
    const invalidPayload404 = (0, index_js_1.classifyWhatsAppResponse)({
        statusCode: 404,
        headers: {},
        body: { error: { message: "not found" } },
        completedAt: FIXED_COMPLETED_AT
    }, context);
    strict_1.default.equal(timeout.status, "timeout");
    strict_1.default.equal(conflict.status, "temporary_failure");
    strict_1.default.equal(rateLimited.status, "rate_limited");
    strict_1.default.equal(rateLimited.retryAfterSeconds, 120);
    strict_1.default.equal(rateLimitedMalformed.retryAfterSeconds, null);
    strict_1.default.equal(failure.errorCode, "provider_unavailable");
    strict_1.default.equal(providerUnavailable.errorCode, "provider_unavailable");
    strict_1.default.equal(invalidPayload404.errorCode, "invalid_payload");
});
(0, node_test_1.default)("client exceptions are normalized", async () => {
    const timeoutClient = new index_js_1.FakeWhatsAppHttpClient({
        scenarioByIdempotencyKey: { "whatsapp:test-001": "timeout" }
    });
    const networkClient = new index_js_1.FakeWhatsAppHttpClient({
        scenarioByIdempotencyKey: { "whatsapp:test-002": "network_error" }
    });
    const unknownClient = new index_js_1.FakeWhatsAppHttpClient({
        scenarioByIdempotencyKey: { "whatsapp:test-003": "unknown_error" }
    });
    const timeoutResult = await makeTransport({ client: timeoutClient }).send(makeInput().input);
    const networkResult = await makeTransport({ client: networkClient }).send({
        ...makeInput({ input: { idempotencyKey: "whatsapp:test-002" } }).input
    });
    const unknownResult = await makeTransport({ client: unknownClient }).send({
        ...makeInput({ input: { idempotencyKey: "whatsapp:test-003" } }).input
    });
    strict_1.default.equal(timeoutResult.status, "timeout");
    strict_1.default.equal(timeoutResult.errorCode, "timeout");
    strict_1.default.equal(networkResult.status, "temporary_failure");
    strict_1.default.equal(networkResult.errorCode, "network_error");
    strict_1.default.equal(unknownResult.status, "temporary_failure");
    strict_1.default.equal(unknownResult.errorCode, "unknown");
});
(0, node_test_1.default)("provider errors are sanitized and do not expose bearer tokens or full phone numbers", () => {
    const safe = (0, index_js_1.extractSafeWhatsAppProviderError)({
        error: {
            message: "Bearer secret-token 56911111111 stack trace",
            code: "invalid_payload",
            error_subcode: "subcode-1",
            fbtrace_id: "fbtrace-abcdef123456"
        }
    });
    const raw = (0, index_js_1.sanitizeWhatsAppProviderError)("Bearer secret-token 56911111111\nstack trace");
    strict_1.default.equal(safe.providerCode, "invalid_payload");
    strict_1.default.equal(safe.providerSubcode, "subcode-1");
    strict_1.default.equal(safe.traceIdMasked !== null, true);
    strict_1.default.equal(safe.traceIdMasked?.includes("abcdef123456"), false);
    strict_1.default.equal(String(raw).includes("secret-token"), false);
    strict_1.default.equal(String(raw).includes("56911111111"), false);
});
(0, node_test_1.default)("transport validation failure uses fail-closed result and never retries internally", async () => {
    const client = new index_js_1.FakeWhatsAppHttpClient();
    const transport = makeTransport({ client, config: { enabled: false } });
    const result = await transport.send(makeInput().input);
    strict_1.default.equal(result.status, "permanent_failure");
    strict_1.default.equal(result.errorCode, "policy_rejected");
    strict_1.default.equal(client.rawRequestsForTests.length, 0);
});
(0, node_test_1.default)("same input yields the same request and the adapter does not mutate input", async () => {
    const input = makeInput();
    const original = cloneJson(input);
    const requestA = (0, index_js_1.buildWhatsAppTextRequest)(input.input, input.config);
    const requestB = (0, index_js_1.buildWhatsAppTextRequest)(input.input, input.config);
    const transport = makeTransport({
        client: new index_js_1.FakeWhatsAppHttpClient({
            scenarioByIdempotencyKey: { "whatsapp:test-001": "accepted" }
        })
    });
    const resultA = await transport.send(input.input);
    const resultB = await transport.send(input.input);
    strict_1.default.deepEqual(requestA, requestB);
    strict_1.default.deepEqual(input, original);
    strict_1.default.equal(resultA.status, "accepted");
    strict_1.default.equal(resultB.status, "accepted");
});
(0, node_test_1.default)("worker integration delivers on accepted and schedules retry on temporary failure", async () => {
    const acceptedClient = new index_js_1.FakeWhatsAppHttpClient({
        scenarioByIdempotencyKey: { "whatsapp:test-001": "accepted" }
    });
    const retryClient = new index_js_1.FakeWhatsAppHttpClient({
        scenarioByIdempotencyKey: { "whatsapp:test-002": "rate_limited" },
        explicitRetryAfterSeconds: 120
    });
    const permanentClient = new index_js_1.FakeWhatsAppHttpClient({
        scenarioByIdempotencyKey: { "whatsapp:test-003": "invalid_payload" }
    });
    const acceptedWorker = await (0, index_js_2.processOutboxMessage)({
        now: FIXED_NOW,
        record: makeRecord({ idempotencyKey: "whatsapp:test-001" }),
        config: {
            workerEnabled: true,
            transportEnabled: true,
            workerId: "worker-1",
            batchSize: 10,
            leaseSeconds: 60,
            defaultMaxAttempts: 3,
            baseRetrySeconds: 30,
            maxRetrySeconds: 3600,
            retryJitterEnabled: false,
            recoverExpiredLeases: false,
            sandboxRequired: false
        }
    }, {
        transport: makeTransport({ client: acceptedClient })
    });
    const retryWorker = await (0, index_js_2.processOutboxMessage)({
        now: FIXED_NOW,
        record: makeRecord({ rowId: 2, idempotencyKey: "whatsapp:test-002" }),
        config: {
            workerEnabled: true,
            transportEnabled: true,
            workerId: "worker-1",
            batchSize: 10,
            leaseSeconds: 60,
            defaultMaxAttempts: 3,
            baseRetrySeconds: 30,
            maxRetrySeconds: 3600,
            retryJitterEnabled: false,
            recoverExpiredLeases: false,
            sandboxRequired: false
        }
    }, {
        transport: makeTransport({ client: retryClient })
    });
    const deadLetterWorker = await (0, index_js_2.processOutboxMessage)({
        now: FIXED_NOW,
        record: makeRecord({ rowId: 3, idempotencyKey: "whatsapp:test-003" }),
        config: {
            workerEnabled: true,
            transportEnabled: true,
            workerId: "worker-1",
            batchSize: 10,
            leaseSeconds: 60,
            defaultMaxAttempts: 3,
            baseRetrySeconds: 30,
            maxRetrySeconds: 3600,
            retryJitterEnabled: false,
            recoverExpiredLeases: false,
            sandboxRequired: false
        }
    }, {
        transport: makeTransport({ client: permanentClient })
    });
    strict_1.default.equal(acceptedWorker.status, "delivered");
    strict_1.default.equal(retryWorker.status, "retry_scheduled");
    strict_1.default.equal(retryWorker.finalPlan?.patch.availableAt, "2026-06-17T12:02:00.000Z");
    strict_1.default.equal(deadLetterWorker.status, "dead_letter");
});
(0, node_test_1.default)("trace and safe logs omit tokens, full recipient and full message text", async () => {
    const client = new index_js_1.FakeWhatsAppHttpClient({
        scenarioByIdempotencyKey: { "whatsapp:test-001": "accepted" }
    });
    const transport = makeTransport({ client });
    const result = await transport.send(makeInput().input);
    const trace = transport.buildTrace(result, makeInput().input, result.completedAt);
    const safeLog = client.snapshotSafeLog()[0];
    const serialized = JSON.stringify({ result, trace, safeLog });
    strict_1.default.equal(serialized.includes("token-abc-123"), false);
    strict_1.default.equal(serialized.includes("Hola, este es un mensaje de prueba."), false);
    strict_1.default.equal(serialized.includes("56911111111"), false);
    strict_1.default.equal(trace.simulated, true);
});
(0, node_test_1.default)("source scan rejects forbidden transport and runtime strings", () => {
    const source = readTestAndModuleSource();
    strict_1.default.equal(hasForbiddenSource(source), false);
});
