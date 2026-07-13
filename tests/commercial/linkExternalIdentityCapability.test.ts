import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before, beforeEach } from "node:test";
import { resolveCapabilityGatewayDefinition, resetCustomerServicePortForTests, setOnboardingServiceForTests, resetOnboardingServiceForTests, setCustomerMasterProjectionReaderForTests } from "@/lib/brain/commercial/capability-gateway";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { CustomerOnboardingMutationResult, CustomerOnboardingService, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";

// ACS-R1-04-T06, contract section 16: link_external_identity's own execution
// logic. Same conventions as createCustomerCapability.test.ts.

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: unknown) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let requestCount = 0;
let lastBody: Record<string, unknown> | null = null;
let lastHeaders: http.IncomingHttpHeaders = {};
let lastUrl = "";

before(async () => {
  server = http.createServer((req, res) => {
    requestCount += 1;
    lastHeaders = req.headers;
    lastUrl = req.url ?? "";
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
  // ACS-R1-04-T08.1: this file exercises link_external_identity's own
  // execution logic, not the customer_master projection gate itself.
  setCustomerMasterProjectionReaderForTests({ async exists() { return true; } });
});

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function makeOnboardingFake(initial: CustomerOnboardingState | null) {
  let state = initial;
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
    async collectFields() {
      throw new Error("unused");
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
      return bump({ status: "temporarily_unavailable", customerId: null });
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
    status: "resolving",
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

function session(overrides: Partial<NativeCustomerSessionExecutionContext> = {}): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "conv-1",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56911112222", normalizedPhone: "56911112222", messageId: "wamid.1", receivedAt: "2026-07-09T12:00:00.000Z" },
    identity: { status: "identified", customerId: "700", source: "external_identity", localResolutionOutcome: "identified", externalResolutionOutcome: null },
    onboarding: onboardingRow({ status: "completed", customerId: "700", completedAt: "2026-07-01T00:00:00.000Z" }),
    contextAccess: "commercial_history",
    currentTurnConsent: {
      createCustomer: null,
      linkExternalIdentity: { scope: "link_external_identity", messageId: "wamid.1", capturedAt: "2026-07-09T12:00:00.000Z", source: "current_inbound" }
    },
    freshExternalResolutionEvidence: null,
    ...overrides
  };
}

function context(trustedCustomerSession: NativeCustomerSessionExecutionContext | null): CapabilityGatewayContext {
  return { correlationId: "corr-1", trustedCustomerSession };
}

function definition() {
  const found = resolveCapabilityGatewayDefinition("link_external_identity");
  assert.ok(found, "link_external_identity must be registered");
  return found!;
}

// ---------------------------------------------------------------------------
// Group 8: link_external_identity (71-80)
// ---------------------------------------------------------------------------

test("71: no resolved customerId in the session denies immediately, Customer Service never called", async () => {
  const outcome = await definition().execute({}, context(session({ identity: { status: "identification_required", customerId: null, source: "none", localResolutionOutcome: "identification_required", externalResolutionOutcome: null } })));
  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "customer_id_required");
  assert.equal(requestCount, 0);
});

test("72: missing explicit link consent denies with a structured errorCode, Customer Service never called", async () => {
  const outcome = await definition().execute({}, context(session({ currentTurnConsent: { createCustomer: null, linkExternalIdentity: null } })));
  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "consent_required:link_external_identity");
  assert.equal(requestCount, 0);
});

test("73: the linked externalId and the inbound waId sent to Customer Service are always the same value - never model-controlled, never mismatched", async () => {
  handler = (_req, res) => sendJson(res, 201, { status: "completed", customerMasterId: "700", externalIdentityId: "ext-1" });
  await definition().execute({}, context(session()));
  const externalIdentity = lastBody?.externalIdentity as { externalId?: string } | undefined;
  assert.equal(externalIdentity?.externalId, "56911112222");
});

test("74: a completed link keeps the identified customer and completes onboarding if it wasn't already", async () => {
  handler = (_req, res) => sendJson(res, 201, { status: "completed", customerMasterId: "700", externalIdentityId: "ext-1" });
  const onboarding = makeOnboardingFake(onboardingRow({ status: "resolving", customerId: null, completedAt: null }));
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.status, "completed");
  assert.equal(onboarding.getState()?.status, "completed");
  assert.equal(onboarding.getState()?.customerId, "700");
});

test("75: already_linked is treated the same as completed - keeps the identified customer, completes onboarding", async () => {
  handler = (_req, res) => sendJson(res, 200, { status: "already_linked", customerMasterId: "700", externalIdentityId: "ext-1" });
  const onboarding = makeOnboardingFake(onboardingRow({ status: "resolving", customerId: null, completedAt: null }));
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.status, "completed");
  assert.equal(onboarding.getState()?.status, "completed");
});

test("76: a linking conflict lands onboarding in conflict and reports a structured conflict errorCode, never a silent success", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "ALREADY_LINKED", conflictCode: "linked_to_other_customer" } });
  const onboarding = makeOnboardingFake(onboardingRow({ status: "resolving", customerId: null, completedAt: null }));
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.errorCode, "customer_link_conflict");
  assert.equal(onboarding.getState()?.status, "conflict");
});

test("77: a denied link changes nothing in identity or onboarding", async () => {
  handler = (_req, res) => sendJson(res, 200, { status: "denied", reason: "policy_blocked" });
  const onboarding = makeOnboardingFake(onboardingRow({ status: "completed", customerId: "700", completedAt: "2026-07-01T00:00:00.000Z" }));
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "policy_blocked");
  assert.equal(onboarding.calls.length, 0);
});

test("78: a temporarily_unavailable Customer Service response never mutates identity", async () => {
  handler = (_req, res) => sendJson(res, 503, { error: { code: "SERVICE_DOWN", message: "down" } });
  const onboarding = makeOnboardingFake(onboardingRow({ status: "completed", customerId: "700", completedAt: "2026-07-01T00:00:00.000Z" }));
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.status, "temporarily_blocked");
  assert.equal(onboarding.calls.length, 0);
});

test("79: an invalid_input (422) response maps to invalid_arguments with the reported fields, never fabricated success", async () => {
  handler = (_req, res) => sendJson(res, 422, { error: { code: "INVALID_INPUT", message: "bad", fields: ["externalId"] } });
  const outcome = await definition().execute({}, context(session()));
  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.errorCode, "externalId");
});

test("80: idempotency key and every sensitive field are server-assembled from the session - the model's tool-request input is never read", async () => {
  handler = (_req, res) => sendJson(res, 201, { status: "completed", customerMasterId: "700", externalIdentityId: "ext-1" });
  await definition().execute({ customerId: "999", externalId: "0000000", granted: true, idempotencyKey: "attacker-chosen" }, context(session()));
  assert.equal(lastHeaders["idempotency-key"], "customer-service:link:corr-1:link_external_identity");
  assert.match(lastUrl, /\/customers\/700\//, "the URL path carries the session's own customerId, not the model's");
  assert.doesNotMatch(JSON.stringify(lastBody), /999|0000000|attacker-chosen/);
  assert.doesNotMatch(lastUrl, /999/);
});

// ACS-R1-04-T08.1 (task section 12, item 6): Customer Service reports a
// completed link, but the echoed-back customerMasterId has no local
// master_customer projection yet - onboarding never completes, warning
// surfaces on the outcome, businessOutcome stays completed.
test("81: Customer Service reports completed but the local projection is unavailable - onboarding never completes, warning surfaces on the outcome", async () => {
  handler = (_req, res) => sendJson(res, 201, { status: "completed", customerMasterId: "700", externalIdentityId: "ext-1" });
  setCustomerMasterProjectionReaderForTests({ async exists() { return false; } });
  const onboarding = makeOnboardingFake(onboardingRow({ status: "resolving", customerId: null, completedAt: null }));
  setOnboardingServiceForTests(onboarding.service);
  const outcome = await definition().execute({}, context(session({ onboarding: onboarding.getState() })));
  assert.equal(outcome.status, "completed", "Gateway status: the HTTP call itself succeeded");
  assert.equal((outcome.data as { status: string }).status, "completed", "business outcome is unchanged by the projection gate");
  assert.ok(outcome.warnings?.includes("customer_master_projection_unavailable"));
  assert.notEqual(onboarding.getState()?.status, "completed");
});
