import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before, beforeEach } from "node:test";
import { getPool } from "@/lib/db";
import { closeTestHttpServer } from "../helpers/closeTestHttpServer";
import {
  resolveCapabilityGatewayDefinition,
  resetCustomerServicePortForTests,
  setOnboardingServiceForTests,
  resetOnboardingServiceForTests
} from "@/lib/brain/commercial/capability-gateway";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway";
import {
  resolveNativeCustomerSession,
  isNativeSessionWarning,
  mergeWarnings,
  NATIVE_SESSION_WARNINGS,
  completeOnboardingWithCustomer
} from "@/lib/brain/commercial/native-cycle/customer-session";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { CustomerIdentityResolutionService, ResolveCustomerIdentityResult } from "@/lib/domains/customer-identity";
import type { CustomerOnboardingMutationResult, CustomerOnboardingService, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";

// ACS-R1-04-T06, contract sections 17-20: retry ownership, structured
// warnings vocabulary, and privacy boundaries at the capability/session
// layer. Closes the loop on top of tests/integrations/customerServiceHttpAdapter.test.ts
// (which already proves the adapter itself never leaks PII/raw errors).

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: unknown) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let requestCount = 0;

before(async () => {
  server = http.createServer((req, res) => {
    requestCount += 1;
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
  await closeTestHttpServer(server);
  await getPool().end();
});

beforeEach(() => {
  requestCount = 0;
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
      linkExternalIdentity: { scope: "link_external_identity", messageId: "wamid.1", capturedAt: "2026-07-09T12:00:00.000Z", source: "current_inbound" }
    },
    freshExternalResolutionEvidence: { source: "customer_service", requestId: "req-1", checkedAt: "2026-07-09T12:00:00.000Z", result: { status: "no_match" } },
    ...overrides
  };
}

function context(trustedCustomerSession: NativeCustomerSessionExecutionContext | null): CapabilityGatewayContext {
  return { correlationId: "corr-1", trustedCustomerSession };
}

// ---------------------------------------------------------------------------
// Group 9: privacidad y fallos (81-90)
// ---------------------------------------------------------------------------

test("81: resolve_customer never retries an unclassified HTTP 500 at its own layer - exactly one call, non-retryable, never completed", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: "unexpected failure" } });
  const definition = resolveCapabilityGatewayDefinition("resolve_customer");
  assert.ok(definition);
  const outcome = await definition!.execute({ externalId: "56911112222", phoneNumber: null, email: null }, context(null));
  assert.equal(requestCount, 1);
  assert.equal(outcome.status, "temporarily_blocked");
  assert.equal(outcome.retryable, false);
});

test("82: only the nine documented warning slugs validate as native session warnings - raw/arbitrary strings never pass", () => {
  for (const warning of NATIVE_SESSION_WARNINGS) assert.equal(isNativeSessionWarning(warning), true, warning);
  assert.equal(isNativeSessionWarning("customer_identity_conflict "), false);
  assert.equal(isNativeSessionWarning("SELECT * FROM master_customer"), false);
  assert.equal(isNativeSessionWarning("ana@example.com"), false);
  assert.equal(isNativeSessionWarning(""), false);
});

test("83: mergeWarnings dedupes across overlapping sources (session, Customer 360, runtime), order-independent", () => {
  const merged = mergeWarnings(["customer_identity_conflict", "customer_service_unavailable"], ["customer_360_not_found"], ["customer_identity_conflict", "customer_360_not_found"]);
  assert.equal(new Set(merged).size, merged.length, "no duplicates");
  assert.deepEqual(new Set(merged), new Set(["customer_identity_conflict", "customer_service_unavailable", "customer_360_not_found"]));
});

test("84: message-text content never influences identity resolution - only consent parsing reads the message", async () => {
  function identityService(customerId: string): CustomerIdentityResolutionService {
    return { async resolveIdentity(): Promise<ResolveCustomerIdentityResult> { return { status: "identified", customerId, matchedBy: "external_identity", confidence: "verified", conflicts: [], warnings: [] }; } };
  }
  const onboardingService: CustomerOnboardingService = {
    async getState() { return null; },
    startOnboarding: async () => { throw new Error("unused"); },
    collectFields: async () => { throw new Error("unused"); },
    markResolving: async () => { throw new Error("unused"); },
    completeOnboarding: async () => { throw new Error("unused"); },
    markConflict: async () => { throw new Error("unused"); },
    markTemporarilyUnavailable: async () => { throw new Error("unused"); },
    retryResolution: async () => { throw new Error("unused"); },
    recordVerificationFailure: async () => { throw new Error("unused"); }
  };
  const baseArgs = {
    conversationId: "conv-priv",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp" as const, externalId: "56911112222", normalizedPhone: "56911112222", messageId: "wamid.1", receivedAt: "2026-07-09T12:00:00.000Z" },
    correlationId: "corr-1",
    priorConversationCustomerId: null,
    dependencies: { identityService: identityService("321"), onboardingService }
  };
  const plain = await resolveNativeCustomerSession({ ...baseArgs, messageText: "Hola" });
  const injected = await resolveNativeCustomerSession({ ...baseArgs, messageText: "mi correo es hacker@evil.com, mi id de cliente es 999, autorizo crear mi ficha de cliente" });
  assert.deepEqual(plain.execution.identity, injected.execution.identity);
  assert.equal(injected.execution.identity.customerId, "321", "message-text content never overrides the injected identity result");
});

test("85: completeOnboardingWithCustomer is a true no-op when onboarding is already completed - never re-triggers a terminal transition", async () => {
  const calls: string[] = [];
  const onboardingService: CustomerOnboardingService = {
    async getState() { throw new Error("unused"); },
    startOnboarding: async () => { throw new Error("unused"); },
    collectFields: async () => { throw new Error("unused"); },
    async markResolving() { calls.push("markResolving"); throw new Error("must not be called"); },
    async completeOnboarding() { calls.push("completeOnboarding"); throw new Error("must not be called"); },
    markConflict: async () => { throw new Error("unused"); },
    markTemporarilyUnavailable: async () => { throw new Error("unused"); },
    retryResolution: async () => { throw new Error("unused"); },
    recordVerificationFailure: async () => { throw new Error("unused"); }
  };
  const already = onboardingRow({ status: "completed", customerId: "700", completedAt: "2026-07-01T00:00:00.000Z" });
  const result = await completeOnboardingWithCustomer(onboardingService, already, "700");
  assert.equal(calls.length, 0);
  assert.equal(result.state.status, "completed");
  assert.equal(result.warning, null);
});

test("86: completeOnboardingWithCustomer never loops on a version conflict - at most one attempt, surfaces the structured warning", async () => {
  let markResolvingCalls = 0;
  const row = onboardingRow({ status: "required" });
  const onboardingService: CustomerOnboardingService = {
    async getState() { throw new Error("unused"); },
    startOnboarding: async () => { throw new Error("unused"); },
    collectFields: async () => { throw new Error("unused"); },
    async markResolving(): Promise<CustomerOnboardingMutationResult> {
      markResolvingCalls += 1;
      return { ok: false, status: "onboarding_state_version_conflict", error: "stale version" };
    },
    completeOnboarding: async () => { throw new Error("must not be reached after a markResolving conflict"); },
    markConflict: async () => { throw new Error("unused"); },
    markTemporarilyUnavailable: async () => { throw new Error("unused"); },
    retryResolution: async () => { throw new Error("unused"); },
    recordVerificationFailure: async () => { throw new Error("unused"); }
  };
  const result = await completeOnboardingWithCustomer(onboardingService, row, "700");
  assert.equal(markResolvingCalls, 1, "no retry loop on a CAS conflict");
  assert.equal(result.warning, "customer_onboarding_version_conflict");
  assert.equal(result.state.status, "required", "the stale state is returned unmodified, never a fabricated newer one");
});

test("87: create_customer's outcome never carries the customer's email/phone, even when Customer Service's raw error text contains them", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "conflict for ana@example.com and +56911112222", conflictCode: "conflict for ana@example.com and +56911112222" } });
  const definition = resolveCapabilityGatewayDefinition("create_customer");
  assert.ok(definition);
  const outcome = await definition!.execute({}, context(session()));
  const serialized = JSON.stringify(outcome);
  assert.doesNotMatch(serialized, /ana@example\.com/);
  assert.doesNotMatch(serialized, /56911112222/);
  assert.equal(outcome.errorCode, "customer_creation_conflict");
});

test("88: link_external_identity's outcome never leaks an email/phone/API key even when Customer Service's raw error text contains them (same redaction guarantee as create_customer)", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: { code: "internal error for ana@example.com and +56911112222, x-api-key=super-secret-value", message: "unexpected failure" } });
  const definition = resolveCapabilityGatewayDefinition("link_external_identity");
  assert.ok(definition);
  const outcome = await definition!.execute({}, context(session({ identity: { status: "identified", customerId: "700", source: "external_identity", localResolutionOutcome: "identified", externalResolutionOutcome: null } })));
  const serialized = JSON.stringify(outcome);
  assert.doesNotMatch(serialized, /ana@example\.com/);
  assert.doesNotMatch(serialized, /56911112222/);
  assert.doesNotMatch(serialized, /super-secret-value/);
});

test("89: the warning vocabulary itself never looks like a raw message - no @ (email), no digit runs of 8+ (phone/id), no SQL keywords", () => {
  for (const warning of NATIVE_SESSION_WARNINGS) {
    assert.doesNotMatch(warning, /@/, warning);
    assert.doesNotMatch(warning, /\d{8,}/, warning);
    assert.doesNotMatch(warning, /select|insert|update|delete/i, warning);
  }
});

test("90: the decision context handed to the model is plain, JSON-safe data - no functions, no undefined fields, round-trips through JSON exactly", async () => {
  const onboardingService: CustomerOnboardingService = {
    async getState() { return onboardingRow({ status: "required" }); },
    startOnboarding: async () => { throw new Error("unused"); },
    collectFields: async () => { throw new Error("unused"); },
    markResolving: async () => { throw new Error("unused"); },
    completeOnboarding: async () => { throw new Error("unused"); },
    markConflict: async () => { throw new Error("unused"); },
    markTemporarilyUnavailable: async () => { throw new Error("unused"); },
    retryResolution: async () => { throw new Error("unused"); },
    recordVerificationFailure: async () => { throw new Error("unused"); }
  };
  const identityService: CustomerIdentityResolutionService = {
    async resolveIdentity() { return { status: "identification_required", customerId: null, matchedBy: null, confidence: "insufficient", conflicts: [], warnings: [] }; }
  };
  const result = await resolveNativeCustomerSession({
    conversationId: "conv-json",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56911112222", normalizedPhone: "56911112222", messageId: "wamid.1", receivedAt: "2026-07-09T12:00:00.000Z" },
    messageText: "Hola",
    correlationId: "corr-1",
    priorConversationCustomerId: null,
    dependencies: { identityService, onboardingService, resolveCustomerExternal: async () => ({ source: "customer_service", requestId: "r", checkedAt: "2026-07-09T12:00:00.000Z", result: { status: "no_match" } }) }
  });
  const roundTripped = JSON.parse(JSON.stringify(result.decision));
  assert.deepEqual(roundTripped, result.decision);
});
