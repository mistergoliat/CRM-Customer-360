import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { createCustomerServicePort, createHttpCustomerServiceAdapter } from "../../lib/integrations/customer-service/http-adapter";
import type { CustomerServicePort } from "../../lib/domains/customer-service/ports";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: unknown) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let requestCount = 0;
let lastHeaders: http.IncomingHttpHeaders = {};

before(async () => {
  server = http.createServer((req, res) => {
    requestCount += 1;
    lastHeaders = req.headers;
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeAdapter(timeoutMs = 500): CustomerServicePort {
  return createHttpCustomerServiceAdapter({ baseUrl, apiKey: "test-key", timeoutMs });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

test.beforeEach(() => {
  requestCount = 0;
  lastHeaders = {};
  handler = (_req, res) => res.writeHead(500).end();
});

test("resolveCustomer maps a resolved response", async () => {
  handler = (_req, res) => sendJson(res, 200, { status: "resolved", customerId: "123" });
  const result = await makeAdapter().resolveCustomer({ channel: "whatsapp", externalId: "56912345678" });
  assert.deepEqual(result, { status: "resolved", customerId: "123" });
  assert.equal(requestCount, 1);
});

test("resolveCustomer maps a no_match response", async () => {
  handler = (_req, res) => sendJson(res, 200, { status: "no_match" });
  const result = await makeAdapter().resolveCustomer({ channel: "whatsapp", externalId: "56912345678" });
  assert.deepEqual(result, { status: "no_match" });
});

test("resolveCustomer maps a conflict response", async () => {
  handler = (_req, res) => sendJson(res, 200, { status: "conflict", conflictCode: "multiple_candidates" });
  const result = await makeAdapter().resolveCustomer({ channel: "whatsapp", externalId: "56912345678" });
  assert.deepEqual(result, { status: "conflict", conflictCode: "multiple_candidates" });
});

test("createCustomer maps a created response", async () => {
  handler = (req, res) => {
    assert.equal(req.headers["x-api-key"], "test-key");
    sendJson(res, 201, { status: "created", customerId: "999" });
  };
  const result = await makeAdapter().createCustomer(baseCreateInput());
  assert.deepEqual(result, { status: "created", customerId: "999" });
});

test("createCustomer maps a matched_existing response", async () => {
  handler = (_req, res) => sendJson(res, 200, { status: "matched_existing", customerId: "42" });
  const result = await makeAdapter().createCustomer(baseCreateInput());
  assert.deepEqual(result, { status: "matched_existing", customerId: "42" });
});

test("createCustomer maps a 409 conflict", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "CUSTOMER_ALREADY_EXISTS", conflictCode: "already_exists", message: "conflict" } });
  const result = await makeAdapter().createCustomer(baseCreateInput());
  assert.deepEqual(result, { status: "conflict", conflictCode: "already_exists" });
});

test("linkExternalIdentity maps a completed response", async () => {
  handler = (_req, res) => sendJson(res, 201, { status: "completed", customerId: "cust-1", externalIdentityId: "ext-1" });
  const result = await makeAdapter().linkExternalIdentity(baseLinkInput());
  assert.deepEqual(result, { status: "completed", customerId: "cust-1", externalIdentityId: "ext-1" });
});

test("linkExternalIdentity maps an already_linked response", async () => {
  handler = (_req, res) => sendJson(res, 200, { status: "already_linked", customerId: "cust-1", externalIdentityId: "ext-1" });
  const result = await makeAdapter().linkExternalIdentity(baseLinkInput());
  assert.deepEqual(result, { status: "already_linked", customerId: "cust-1", externalIdentityId: "ext-1" });
});

test("a 422 maps to invalid_input with the reported fields", async () => {
  handler = (_req, res) => sendJson(res, 422, { error: { code: "INVALID_INPUT", message: "bad request", fields: ["email"] } });
  const result = await makeAdapter().createCustomer(baseCreateInput());
  assert.deepEqual(result, { status: "invalid_input", fields: ["email"] });
  assert.equal(requestCount, 1);
});

test("a 409 on link maps to conflict", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "ALREADY_LINKED", conflictCode: "linked_to_other_customer" } });
  const result = await makeAdapter().linkExternalIdentity(baseLinkInput());
  assert.deepEqual(result, { status: "conflict", conflictCode: "linked_to_other_customer" });
});

test("a 503 maps to temporarily_unavailable, retryable", async () => {
  handler = (_req, res) => sendJson(res, 503, { error: { code: "SERVICE_DOWN", message: "down" } });
  const result = await makeAdapter().createCustomer(baseCreateInput());
  assert.deepEqual(result, { status: "temporarily_unavailable", retryable: true });
  assert.equal(requestCount, 1, "no adapter-level retry");
});

test("resolveCustomer on an unclassified HTTP 500 maps to temporarily_unavailable, not retryable, no fallback", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: "unexpected failure" } });
  const result = await makeAdapter().resolveCustomer({ channel: "whatsapp", externalId: "56912345678" });
  assert.deepEqual(result, { status: "temporarily_unavailable", retryable: false });
  assert.equal(result.status, "temporarily_unavailable");
  if (result.status === "temporarily_unavailable") assert.equal(result.retryable, false);
  assert.equal(requestCount, 1, "no adapter-level retry");
  assert.ok(!("customerId" in result), "no local fallback ever fabricates a customerId");
});

test("a timeout maps to temporarily_unavailable and never throws", async () => {
  handler = (_req, res) => {
    setTimeout(() => sendJson(res, 200, { status: "no_match" }), 2000);
  };
  const result = await makeAdapter(50).resolveCustomer({ channel: "whatsapp", externalId: "56912345678" });
  assert.deepEqual(result, { status: "temporarily_unavailable", retryable: true });
});

test("invalid JSON on a 200 response never crashes and maps to a safe failure", async () => {
  handler = (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{not-json");
  };
  const resolveResult = await makeAdapter().resolveCustomer({ channel: "whatsapp", externalId: "56912345678" });
  assert.deepEqual(resolveResult, { status: "temporarily_unavailable", retryable: false });

  const createResult = await makeAdapter().createCustomer(baseCreateInput());
  assert.deepEqual(createResult, { status: "failed", code: "invalid_response", retryable: false });
});

test("mutating requests carry the caller-provided Idempotency-Key header", async () => {
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerId: "1" });
  await makeAdapter().createCustomer(baseCreateInput({ idempotencyKey: "customer-service:create:exec-77" }));
  assert.equal(lastHeaders["idempotency-key"], "customer-service:create:exec-77");
});

test("two consecutive calls are two physical HTTP calls, never a hidden multiplier", async () => {
  handler = (_req, res) => sendJson(res, 200, { status: "no_match" });
  const adapter = makeAdapter();
  await adapter.resolveCustomer({ channel: "whatsapp", externalId: "56912345678" });
  await adapter.resolveCustomer({ channel: "whatsapp", externalId: "56912345678" });
  assert.equal(requestCount, 2);
});

test("error responses never leak the configured API key", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: { code: "x-api-key=super-secret-value leaked", message: "x-api-key=super-secret-value leaked" } });
  const result = await makeAdapter().createCustomer(baseCreateInput());
  assert.doesNotMatch(JSON.stringify(result), /super-secret-value/);
});

test("error responses never leak an email or a full phone number", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "conflict for ana@example.com and +56912345678", conflictCode: "conflict for ana@example.com and +56912345678" } });
  const result = await makeAdapter().createCustomer(baseCreateInput());
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /ana@example\.com/);
  assert.doesNotMatch(serialized, /56912345678/);
});

test("absent configuration fails closed as temporarily_unavailable, never no_match", async () => {
  const previousBaseUrl = process.env.CUSTOMER_SERVICE_BASE_URL;
  const previousApiKey = process.env.CUSTOMER_SERVICE_API_KEY;
  delete process.env.CUSTOMER_SERVICE_BASE_URL;
  delete process.env.CUSTOMER_SERVICE_API_KEY;
  try {
    const port = createCustomerServicePort();
    const resolveResult = await port.resolveCustomer({ channel: "whatsapp", externalId: "56912345678" });
    assert.deepEqual(resolveResult, { status: "temporarily_unavailable", retryable: true });
    const createResult = await port.createCustomer(baseCreateInput());
    assert.deepEqual(createResult, { status: "temporarily_unavailable", retryable: true });
    const linkResult = await port.linkExternalIdentity(baseLinkInput());
    assert.deepEqual(linkResult, { status: "temporarily_unavailable", retryable: true });
  } finally {
    if (previousBaseUrl !== undefined) process.env.CUSTOMER_SERVICE_BASE_URL = previousBaseUrl;
    if (previousApiKey !== undefined) process.env.CUSTOMER_SERVICE_API_KEY = previousApiKey;
  }
});

function baseCreateInput(overrides: Partial<Parameters<CustomerServicePort["createCustomer"]>[0]> = {}) {
  return {
    firstName: "Ana",
    lastName: "Perez",
    email: "ana@example.com",
    phoneNumber: "+56912345678",
    origin: { channel: "whatsapp" as const, externalId: "56912345678" },
    commercialPurpose: "quote" as const,
    consent: { createCustomer: true as const, messageId: "m1", capturedAt: "2026-07-09T00:00:00.000Z" },
    idempotencyKey: "customer-service:create:exec-1",
    ...overrides
  };
}

function baseLinkInput(overrides: Partial<Parameters<CustomerServicePort["linkExternalIdentity"]>[0]> = {}) {
  return {
    customerId: "cust-1",
    externalIdentity: { provider: "whatsapp" as const, externalId: "56912345678", normalizedPhone: "56912345678" },
    consent: { granted: true as const, messageId: "m1", capturedAt: "2026-07-09T00:00:00.000Z" },
    idempotencyKey: "customer-service:link:exec-2",
    ...overrides
  };
}
