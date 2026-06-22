import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  FakeWhatsAppHttpClient,
  WhatsAppMessageTransport,
  buildSafeWhatsAppRequestSummary,
  buildWhatsAppRequestId,
  buildWhatsAppTextRequest,
  classifyWhatsAppResponse,
  extractSafeWhatsAppProviderError,
  normalizeWhatsAppRecipient,
  sanitizeWhatsAppProviderError,
  validateWhatsAppTransportInput
} from "../../lib/brain/messaging/whatsapp-transport/index.js";
import {
  processOutboxMessage,
  type OutboxMessageRecord,
  type OutboxWorkerConfig
} from "../../lib/brain/messaging/outbox-worker/index.js";

const FIXED_NOW = "2026-06-17T12:00:00.000Z";
const FIXED_COMPLETED_AT = "2026-06-17T12:00:01.000Z";
const GRAPH_BASE_URL = "https://" + "graph" + "." + "facebook.com";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeConfig(overrides: Partial<import("../../lib/brain/messaging/whatsapp-transport").WhatsAppTransportConfig> = {}) {
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

function makeInput(
  overrides: {
    now?: string;
    input?: Partial<import("../../lib/brain/messaging/whatsapp-transport").WhatsAppTransportSendInput>;
    config?: Partial<import("../../lib/brain/messaging/whatsapp-transport").WhatsAppTransportConfig>;
  } = {}
) {
  return {
    now: overrides.now ?? FIXED_NOW,
    input: {
      commandId: "command-001",
      idempotencyKey: "whatsapp:test-001",
      channel: "whatsapp" as const,
      commandType: "whatsapp_text" as const,
      recipient: "+56 9 1111 1111",
      messageText: "Hola, este es un mensaje de prueba.",
      sandbox: true,
      attemptedAt: overrides.now ?? FIXED_NOW,
      ...overrides.input
    },
    config: makeConfig(overrides.config ?? {})
  };
}

function makeTransport(
  overrides: {
    config?: Partial<import("../../lib/brain/messaging/whatsapp-transport").WhatsAppTransportConfig>;
    client?: FakeWhatsAppHttpClient;
  } = {}
) {
  return new WhatsAppMessageTransport({
    config: makeConfig(overrides.config ?? {}),
    client: overrides.client ?? new FakeWhatsAppHttpClient()
  });
}

function makeRecord(overrides: Partial<OutboxMessageRecord> = {}): OutboxMessageRecord {
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

function readTestAndModuleSource(): string {
  const folder = resolve(process.cwd(), "lib/brain/messaging/whatsapp-transport");
  const testFile = resolve(process.cwd(), "tests/commercial/whatsappTransport.test.ts");
  return `${readSourceTree(folder)}\n${readFileSync(testFile, "utf8")}`;
}

function hasForbiddenSource(source: string): boolean {
  const pattern = new RegExp(
    [
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
    ].join("|")
  );
  return pattern.test(source);
}

test("normalize recipient accepts formatted digits and rejects invalid values", () => {
  assert.equal(normalizeWhatsAppRecipient("+56 9 1111 1111"), "56911111111");
  assert.equal(normalizeWhatsAppRecipient("56911111111"), "56911111111");
  assert.equal(normalizeWhatsAppRecipient("56A911111111"), null);
});

test("validation fails closed for disabled transport and missing sandbox", () => {
  const disabled = validateWhatsAppTransportInput(makeInput().input, makeConfig({ enabled: false }));
  const sandboxOff = validateWhatsAppTransportInput(makeInput().input, makeConfig({ sandbox: false }));

  assert.equal(disabled.ok, false);
  assert.equal(disabled.errorCode, "policy_rejected");
  assert.equal(sandboxOff.ok, false);
  assert.equal(sandboxOff.errorCode, "policy_rejected");
});

test("validation rejects missing recipient, invalid recipient and whitelist mismatches", () => {
  const missing = validateWhatsAppTransportInput(makeInput({ input: { recipient: " " } }).input, makeConfig());
  const invalid = validateWhatsAppTransportInput(makeInput({ input: { recipient: "abc" } }).input, makeConfig());
  const partial = validateWhatsAppTransportInput(makeInput({ input: { recipient: "5691111111" } }).input, makeConfig());

  assert.equal(missing.errorCode, "invalid_recipient");
  assert.equal(invalid.errorCode, "invalid_recipient");
  assert.equal(partial.errorCode, "invalid_recipient");
});

test("validation rejects missing ids, unsupported values and malformed payloads", () => {
  const base = makeInput();
  assert.equal(validateWhatsAppTransportInput({ ...base.input, commandId: "" }, base.config).errorCode, "invalid_payload");
  assert.equal(validateWhatsAppTransportInput({ ...base.input, idempotencyKey: " " }, base.config).errorCode, "invalid_payload");
  assert.equal(validateWhatsAppTransportInput({ ...base.input, channel: "email" as never }, base.config).errorCode, "invalid_payload");
  assert.equal(validateWhatsAppTransportInput({ ...base.input, commandType: "email_text" as never }, base.config).errorCode, "invalid_payload");
  assert.equal(validateWhatsAppTransportInput({ ...base.input, messageText: " " }, base.config).errorCode, "invalid_payload");
  assert.equal(validateWhatsAppTransportInput({ ...base.input, messageText: "{" + '"' + "messaging_product" + '"' + ":" + '"' + "whatsapp" + '"' + "}" }, base.config).errorCode, "invalid_payload");
  assert.equal(validateWhatsAppTransportInput({ ...base.input, messageText: "Hola {{name}}" }, base.config).errorCode, "invalid_payload");
});

test("validation rejects config gaps and invalid timeout", () => {
  const base = makeInput();
  assert.equal(validateWhatsAppTransportInput(base.input, makeConfig({ phoneNumberId: "" })).errorCode, "invalid_payload");
  assert.equal(validateWhatsAppTransportInput(base.input, makeConfig({ graphApiVersion: "" })).errorCode, "invalid_payload");
  assert.equal(validateWhatsAppTransportInput(base.input, makeConfig({ graphBaseUrl: "" })).errorCode, "invalid_payload");
  assert.equal(validateWhatsAppTransportInput(base.input, makeConfig({ timeoutMs: 0 })).errorCode, "invalid_payload");
  assert.equal(validateWhatsAppTransportInput(base.input, makeConfig({ accessToken: "" })).errorCode, "authentication_error");
});

test("request builder produces deterministic request id, URL and body", () => {
  const input = makeInput();
  const request = buildWhatsAppTextRequest(input.input, input.config);

  assert.equal(request.requestId, buildWhatsAppRequestId("command-001", "whatsapp:test-001"));
  assert.equal(request.url, `${GRAPH_BASE_URL}/v25.0/1234567890/messages`);
  assert.equal(request.method, "POST");
  assert.equal(request.body.messaging_product, "whatsapp");
  assert.equal(request.body.recipient_type, "individual");
  assert.equal(request.body.to, "56911111111");
  assert.equal(request.body.type, "text");
  assert.equal(request.body.text.preview_url, false);
  assert.equal(request.headers.Authorization.startsWith("Bearer "), true);
  assert.equal(request.headers["X-Idempotency-Key"], "whatsapp:test-001");
});

test("safe request summary omits sensitive fields", () => {
  const request = buildWhatsAppTextRequest(makeInput().input, makeConfig());
  const summary = buildSafeWhatsAppRequestSummary(request);
  const serialized = JSON.stringify(summary);

  assert.equal(serialized.includes("token-abc-123"), false);
  assert.equal(serialized.includes("56911111111"), false);
  assert.equal(serialized.includes("Bearer "), false);
  assert.equal(summary.recipientMasked?.includes("56911111111"), false);
  assert.equal(summary.bodyLength > 0, true);
});

test("accepted send returns accepted and the fake client records safe logs", async () => {
  const client = new FakeWhatsAppHttpClient({
    scenarioByIdempotencyKey: { "whatsapp:test-001": "accepted" }
  });
  const transport = makeTransport({ client });
  const result = await transport.send(makeInput().input);

  assert.equal(result.status, "accepted");
  assert.equal(result.errorCode, "none");
  assert.equal(result.providerMessageId?.startsWith("wamid.fake:"), true);
  assert.equal(client.rawRequestsForTests.length, 1);
  assert.equal(client.snapshotSafeLog()[0]?.recipientMasked?.includes("56911111111"), false);
});

test("malformed 2xx response is treated as temporary failure", async () => {
  const client = new FakeWhatsAppHttpClient({
    scenarioByIdempotencyKey: { "whatsapp:test-001": "malformed_success" }
  });
  const result = await makeTransport({ client }).send(makeInput().input);

  assert.equal(result.status, "temporary_failure");
  assert.equal(result.errorCode, "unknown");
  assert.equal(result.providerMessageId, null);
});

test("duplicate accepted responses are preserved", async () => {
  const client = new FakeWhatsAppHttpClient({
    scenarioByIdempotencyKey: { "whatsapp:test-001": "duplicate_accepted" }
  });
  const result = await makeTransport({ client }).send(makeInput().input);

  assert.equal(result.status, "duplicate_accepted");
  assert.equal(result.errorCode, "provider_duplicate");
  assert.equal(result.providerMessageId?.startsWith("wamid.fake:"), true);
});

test("provider 400, 401, 403 and 404 responses are normalized", async () => {
  const client = new FakeWhatsAppHttpClient({
    scenarioByIdempotencyKey: {
      "whatsapp:test-001": "invalid_recipient",
      "whatsapp:test-002": "invalid_payload",
      "whatsapp:test-003": "policy_rejected",
      "whatsapp:test-004": "authentication_error",
      "whatsapp:test-005": "permission_error"
    }
  });
  const transport = makeTransport({ client });

  assert.equal((await transport.send({ ...makeInput({ input: { idempotencyKey: "whatsapp:test-001" } }).input })).errorCode, "invalid_recipient");
  assert.equal((await transport.send({ ...makeInput({ input: { idempotencyKey: "whatsapp:test-002" } }).input })).errorCode, "invalid_payload");
  assert.equal((await transport.send({ ...makeInput({ input: { idempotencyKey: "whatsapp:test-003" } }).input })).errorCode, "policy_rejected");
  assert.equal((await transport.send({ ...makeInput({ input: { idempotencyKey: "whatsapp:test-004" } }).input })).errorCode, "authentication_error");
  assert.equal((await transport.send({ ...makeInput({ input: { idempotencyKey: "whatsapp:test-005" } }).input })).errorCode, "permission_error");
});

test("HTTP 408, 409, 429 and 5xx responses are classified defensively", () => {
  const context = {
    requestId: "whatsapp-request:test",
    commandId: "command-001",
    idempotencyKey: "whatsapp:test-001",
    attemptedAt: FIXED_NOW,
    recipientMasked: "569***111",
    sandbox: true as const,
    simulated: true
  };

  const timeout = classifyWhatsAppResponse(
    {
      statusCode: 408,
      headers: {},
      body: { error: { message: "timeout" } },
      completedAt: FIXED_COMPLETED_AT
    },
    context
  );
  const conflict = classifyWhatsAppResponse(
    {
      statusCode: 409,
      headers: {},
      body: { error: { message: "conflict" } },
      completedAt: FIXED_COMPLETED_AT
    },
    context
  );
  const rateLimited = classifyWhatsAppResponse(
    {
      statusCode: 429,
      headers: { "Retry-After": "120" },
      body: { error: { message: "rate limited" } },
      completedAt: FIXED_COMPLETED_AT
    },
    context
  );
  const rateLimitedMalformed = classifyWhatsAppResponse(
    {
      statusCode: 429,
      headers: { "Retry-After": "bogus" },
      body: { error: { message: "rate limited" } },
      completedAt: FIXED_COMPLETED_AT
    },
    context
  );
  const failure = classifyWhatsAppResponse(
    {
      statusCode: 500,
      headers: {},
      body: { error: { message: "server error" } },
      completedAt: FIXED_COMPLETED_AT
    },
    context
  );
  const providerUnavailable = classifyWhatsAppResponse(
    {
      statusCode: 503,
      headers: {},
      body: { error: { message: "unavailable" } },
      completedAt: FIXED_COMPLETED_AT
    },
    context
  );
  const invalidPayload404 = classifyWhatsAppResponse(
    {
      statusCode: 404,
      headers: {},
      body: { error: { message: "not found" } },
      completedAt: FIXED_COMPLETED_AT
    },
    context
  );

  assert.equal(timeout.status, "timeout");
  assert.equal(conflict.status, "temporary_failure");
  assert.equal(rateLimited.status, "rate_limited");
  assert.equal(rateLimited.retryAfterSeconds, 120);
  assert.equal(rateLimitedMalformed.retryAfterSeconds, null);
  assert.equal(failure.errorCode, "provider_unavailable");
  assert.equal(providerUnavailable.errorCode, "provider_unavailable");
  assert.equal(invalidPayload404.errorCode, "invalid_payload");
});

test("client exceptions are normalized", async () => {
  const timeoutClient = new FakeWhatsAppHttpClient({
    scenarioByIdempotencyKey: { "whatsapp:test-001": "timeout" }
  });
  const networkClient = new FakeWhatsAppHttpClient({
    scenarioByIdempotencyKey: { "whatsapp:test-002": "network_error" }
  });
  const unknownClient = new FakeWhatsAppHttpClient({
    scenarioByIdempotencyKey: { "whatsapp:test-003": "unknown_error" }
  });

  const timeoutResult = await makeTransport({ client: timeoutClient }).send(makeInput().input);
  const networkResult = await makeTransport({ client: networkClient }).send({
    ...makeInput({ input: { idempotencyKey: "whatsapp:test-002" } }).input
  });
  const unknownResult = await makeTransport({ client: unknownClient }).send({
    ...makeInput({ input: { idempotencyKey: "whatsapp:test-003" } }).input
  });

  assert.equal(timeoutResult.status, "timeout");
  assert.equal(timeoutResult.errorCode, "timeout");
  assert.equal(networkResult.status, "temporary_failure");
  assert.equal(networkResult.errorCode, "network_error");
  assert.equal(unknownResult.status, "temporary_failure");
  assert.equal(unknownResult.errorCode, "unknown");
});

test("provider errors are sanitized and do not expose bearer tokens or full phone numbers", () => {
  const safe = extractSafeWhatsAppProviderError({
    error: {
      message: "Bearer secret-token 56911111111 stack trace",
      code: "invalid_payload",
      error_subcode: "subcode-1",
      fbtrace_id: "fbtrace-abcdef123456"
    }
  });
  const raw = sanitizeWhatsAppProviderError("Bearer secret-token 56911111111\nstack trace");

  assert.equal(safe.providerCode, "invalid_payload");
  assert.equal(safe.providerSubcode, "subcode-1");
  assert.equal(safe.traceIdMasked !== null, true);
  assert.equal(safe.traceIdMasked?.includes("abcdef123456"), false);
  assert.equal(String(raw).includes("secret-token"), false);
  assert.equal(String(raw).includes("56911111111"), false);
});

test("transport validation failure uses fail-closed result and never retries internally", async () => {
  const client = new FakeWhatsAppHttpClient();
  const transport = makeTransport({ client, config: { enabled: false } });
  const result = await transport.send(makeInput().input);

  assert.equal(result.status, "permanent_failure");
  assert.equal(result.errorCode, "policy_rejected");
  assert.equal(client.rawRequestsForTests.length, 0);
});

test("same input yields the same request and the adapter does not mutate input", async () => {
  const input = makeInput();
  const original = cloneJson(input);
  const requestA = buildWhatsAppTextRequest(input.input, input.config);
  const requestB = buildWhatsAppTextRequest(input.input, input.config);
  const transport = makeTransport({
    client: new FakeWhatsAppHttpClient({
      scenarioByIdempotencyKey: { "whatsapp:test-001": "accepted" }
    })
  });

  const resultA = await transport.send(input.input);
  const resultB = await transport.send(input.input);

  assert.deepEqual(requestA, requestB);
  assert.deepEqual(input, original);
  assert.equal(resultA.status, "accepted");
  assert.equal(resultB.status, "accepted");
});

test("worker integration delivers on accepted and schedules retry on temporary failure", async () => {
  const acceptedClient = new FakeWhatsAppHttpClient({
    scenarioByIdempotencyKey: { "whatsapp:test-001": "accepted" }
  });
  const retryClient = new FakeWhatsAppHttpClient({
    scenarioByIdempotencyKey: { "whatsapp:test-002": "rate_limited" },
    explicitRetryAfterSeconds: 120
  });
  const permanentClient = new FakeWhatsAppHttpClient({
    scenarioByIdempotencyKey: { "whatsapp:test-003": "invalid_payload" }
  });

  const acceptedWorker = await processOutboxMessage(
    {
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
      } satisfies OutboxWorkerConfig
    },
    {
      transport: makeTransport({ client: acceptedClient })
    }
  );
  const retryWorker = await processOutboxMessage(
    {
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
      } satisfies OutboxWorkerConfig
    },
    {
      transport: makeTransport({ client: retryClient })
    }
  );
  const deadLetterWorker = await processOutboxMessage(
    {
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
      } satisfies OutboxWorkerConfig
    },
    {
      transport: makeTransport({ client: permanentClient })
    }
  );

  assert.equal(acceptedWorker.status, "delivered");
  assert.equal(retryWorker.status, "retry_scheduled");
  assert.equal(retryWorker.finalPlan?.patch.availableAt, "2026-06-17T12:02:00.000Z");
  assert.equal(deadLetterWorker.status, "dead_letter");
});

test("trace and safe logs omit tokens, full recipient and full message text", async () => {
  const client = new FakeWhatsAppHttpClient({
    scenarioByIdempotencyKey: { "whatsapp:test-001": "accepted" }
  });
  const transport = makeTransport({ client });
  const result = await transport.send(makeInput().input);
  const trace = transport.buildTrace(result, makeInput().input, result.completedAt);
  const safeLog = client.snapshotSafeLog()[0];
  const serialized = JSON.stringify({ result, trace, safeLog });

  assert.equal(serialized.includes("token-abc-123"), false);
  assert.equal(serialized.includes("Hola, este es un mensaje de prueba."), false);
  assert.equal(serialized.includes("56911111111"), false);
  assert.equal(trace.simulated, true);
});

test("source scan rejects forbidden transport and runtime strings", () => {
  const source = readTestAndModuleSource();
  assert.equal(hasForbiddenSource(source), false);
});
