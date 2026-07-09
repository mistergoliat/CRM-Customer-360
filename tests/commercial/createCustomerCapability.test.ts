import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before, beforeEach } from "node:test";
import { resolveCapabilityGatewayDefinition, resetCustomerServicePortForTests, setOnboardingServiceForTests, resetOnboardingServiceForTests } from "@/lib/brain/commercial/capability-gateway";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { CustomerOnboardingMutationResult, CustomerOnboardingService, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";

// ACS-R1-04-T06, contract section 16: create_customer's own execution logic
// - policy gating, server-side input assembly, and the outcome -> onboarding
// state-transition table. Real local HTTP server for Customer Service (same
// convention as tests/integrations/customerServiceHttpAdapter.test.ts);
// in-memory onboarding fake instead of the real DB-backed service, since
// this file is about the capability's own logic, not onboarding persistence.

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: unknown) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let requestCount = 0;
let lastBody: Record<string, unknown> | null = null;
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
      lastBody = body as Record<string, unknown> | null;
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

beforeEach(() => {
  requestCount = 0;
  lastBody = null;
  lastHeaders = {};
  handler = (_req, res) => res.writeHead(500).end();
  process.env.CUSTOMER_SERVICE_BASE_URL = baseUrl;
  process.env.CUSTOMER_SERVICE_API_KEY = "test-key";
  resetCustomerServicePortForTests();
  resetOnboardingServiceForTests();
});

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Minimal in-memory onboarding fake with a call log - faithful enough for the transitions this capability triggers. */
function makeOnboardingFake(initial: CustomerOnboardingState) {
  let state: CustomerOnboardingState | null = initial;
  const calls: string[] = [];
  function bump(patch: Partial<CustomerOnboardingState>): CustomerOnboardingMutationResult {
    state = { ...(state as CustomerOnboardingState), ...patch, version: (state as CustomerOnboardingState).version + 1 };
    return { ok: true, status: "updated", state };
  }
  const service: CustomerOnboardingService = {
    async getState() {
      return state;
    },
    async startOnboarding() {
      throw new Error("unused");
    },
    async collectFields(input) {
      calls.push("collectFields");
      return bump({ status: "collecting", pendingFields: input.pendingFields });
    },
    async markResolving() {
      calls.push("markResolving");
      return bump({ status: "resolving" });
    },
    async completeOnboarding(input) {
      calls.push("completeOnboarding");
      return bump({ status: "completed", customerId: input.customerId, completedAt: new Date().toISOString() });
    },
    async markConflict() {
      calls.push("markConflict");
      return bump({ status: "conflict" });
    },
    async markTemporarilyUnavailable() {
      calls.push("markTemporarilyUnavailable");
      return bump({ status: "temporarily_unavailable" });
    },
    async retryResolution() {
      throw new Error("unused");
    },
    async recordVerificationFailure() {
      throw new Error("unused");
    }
  };
  return { service, calls, getState: () => state };
}

function onboardingRow(overrides: Partial<CustomerOnboardingState> = {}): CustomerOnboardingState {
  return {
    id: 1,
    conversationId: "conv-1",
    opportunityId: null,
    status: "collecting",
    purpose: "quote",
    collected: { firstName: "Ana", email: "ana@example.com" },
    pendingFields: [],
    customerId: null,
    failedVerificationAttempts: 0,
    version: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    completedAt: null,
    ...overrides
  };
}

const FRESH_NO_MATCH = { source: "customer_service" as const, requestId: "req-1", checkedAt: "2026-07-09T12:00:00.000Z", result: { status: "no_match" as const } };

function session(overrides: Partial<NativeCustomerSessionExecutionContext> = {}): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "conv-1",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56911112222", normalizedPhone: "56911112222", messageId: "wamid.1", receivedAt: "2026-07-09T12:00:00.000Z" },
    identity: { status: "identification_required", customerId: null, source: "none", localResolutionOutcome: "identification_required", externalResolutionOutcome: "no_match" },
    onboarding: onboardingRow(),
    contextAccess: "none",
    currentTurnConsent: {
      createCustomer: { scope: "create_customer", messageId: "wamid.1", capturedAt: "2026-07-09T12:00:00.000Z", source: "current_inbound" },
      linkExternalIdentity: null
    },
    freshExternalResolutionEvidence: FRESH_NO_MATCH,
    ...overrides
  };
}

function context(trustedCustomerSession: NativeCustomerSessionExecutionContext | null): CapabilityGatewayContext {
  return { correlationId: "corr-1", trustedCustomerSession };
}

function definition() {
  const found = resolveCapabilityGatewayDefinition("create_customer");
  assert.ok(found, "create_customer must be registered");
  return found!;
}

// ---------------------------------------------------------------------------
// Group 7: create_customer (57-70)
// ---------------------------------------------------------------------------

test("57: an onboarding purpose outside the allowed set is denied before Customer Service is ever called", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ purpose: "order_inquiry" }));
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "purpose_not_authorized_for_customer_creation");
  assert.equal(requestCount, 0);
});

test("58: a missing trusted session denies immediately with a structured errorCode", async () => {
  const outcome = await definition().execute({}, context(null));
  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "missing_trusted_session");
  assert.equal(requestCount, 0);
});

test("59: absent fresh resolution evidence never equals no_match - it is denied, never treated as available to create", async () => {
  const onboarding = makeOnboardingFake(onboardingRow());
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState(), freshExternalResolutionEvidence: null })));
  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "resolution_status_temporarily_unavailable");
  assert.equal(requestCount, 0);
});

test("60: fresh evidence that is not no_match (e.g. resolved) is denied - create_customer never runs on top of an existing match", async () => {
  const onboarding = makeOnboardingFake(onboardingRow());
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute(
    {},
    context(session({ onboarding: onboarding.getState(), freshExternalResolutionEvidence: { source: "customer_service", requestId: "r", checkedAt: "2026-07-09T12:00:00.000Z", result: { status: "resolved", customerId: "999" } } }))
  );
  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "resolution_status_resolved");
  assert.equal(requestCount, 0);
});

test("61: missing required fields yields missing_information and updates onboarding's pendingFields via the domain", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ collected: {} }));
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.status, "missing_information");
  assert.ok((outcome.data as { requiredFields: string[] }).requiredFields.includes("firstName"));
  assert.ok(onboarding.calls.includes("collectFields"));
  assert.equal(requestCount, 0, "policy denies before Customer Service is called");
});

test("62: missing explicit consent denies with a structured consent_required errorCode, Customer Service never called", async () => {
  const onboarding = makeOnboardingFake(onboardingRow());
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState(), currentTurnConsent: { createCustomer: null, linkExternalIdentity: null } })));
  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "consent_required:create_customer");
  assert.equal(requestCount, 0);
});

test("63: a valid request that Customer Service creates completes and persists onboarding as completed with the new customerId", async () => {
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerId: "555" });
  const onboarding = makeOnboardingFake(onboardingRow());
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.status, "completed");
  assert.equal(requestCount, 1);
  assert.equal(onboarding.getState()?.status, "completed");
  assert.equal(onboarding.getState()?.customerId, "555");
});

test("64: matched_existing is treated the same as created - onboarding completes with the matched customerId", async () => {
  handler = (_req, res) => sendJson(res, 200, { status: "matched_existing", customerId: "42" });
  const onboarding = makeOnboardingFake(onboardingRow());
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.status, "completed");
  assert.equal(onboarding.getState()?.status, "completed");
  assert.equal(onboarding.getState()?.customerId, "42");
});

test("65: a Customer Service conflict lands onboarding in conflict and reports a structured conflict errorCode - never a silent success", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "CUSTOMER_ALREADY_EXISTS", conflictCode: "already_exists", message: "conflict" } });
  const onboarding = makeOnboardingFake(onboardingRow());
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.errorCode, "customer_creation_conflict");
  assert.equal(onboarding.getState()?.status, "conflict");
});

test("66: a Customer Service denial changes nothing in onboarding", async () => {
  handler = (_req, res) => sendJson(res, 200, { status: "denied", reason: "policy_blocked" });
  const onboarding = makeOnboardingFake(onboardingRow());
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "policy_blocked");
  assert.equal(onboarding.calls.length, 0);
});

test("67: a temporarily_unavailable Customer Service response never creates a customer and leaves onboarding untouched", async () => {
  handler = (_req, res) => sendJson(res, 503, { error: { code: "SERVICE_DOWN", message: "down" } });
  const onboarding = makeOnboardingFake(onboardingRow());
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.status, "temporarily_blocked");
  assert.equal(onboarding.calls.length, 0);
});

test("68: an invalid_input (422) response maps to invalid_arguments with the reported fields, never fabricated success", async () => {
  handler = (_req, res) => sendJson(res, 422, { error: { code: "INVALID_INPUT", message: "bad", fields: ["email"] } });
  const onboarding = makeOnboardingFake(onboardingRow());
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.errorCode, "email");
});

test("69: the idempotency key sent to Customer Service is derived from the Gateway's correlationId, never chosen by the model", async () => {
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerId: "1" });
  const onboarding = makeOnboardingFake(onboardingRow());
  setOnboardingServiceForTests(onboarding.service);
  await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(lastHeaders["idempotency-key"], "customer-service:create:corr-1:create_customer");
});

test("70: the request body is assembled entirely from the trusted session - LLM-supplied tool-request input is never read", async () => {
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerId: "1" });
  const onboarding = makeOnboardingFake(onboardingRow({ collected: { firstName: "RealName", email: "real@example.com" } }));
  setOnboardingServiceForTests(onboarding.service);
  await definition().execute(
    { firstName: "FakeInjectedName", email: "fake@evil.example", customerId: "999", phoneNumber: "10000000" },
    context(session({ onboarding: onboarding.getState() }))
  );
  assert.equal(lastBody?.firstName, "RealName");
  assert.equal(lastBody?.email, "real@example.com");
  assert.equal(lastBody?.phoneNumber, "56911112222");
  assert.doesNotMatch(JSON.stringify(lastBody), /FakeInjectedName|fake@evil\.example|999|10000000/);
});
