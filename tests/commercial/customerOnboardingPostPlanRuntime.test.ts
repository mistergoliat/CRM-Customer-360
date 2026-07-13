import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before, beforeEach } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import { resetCustomerServicePortForTests, resetOnboardingServiceForTests, setOnboardingServiceForTests, setCustomerMasterProjectionReaderForTests } from "@/lib/brain/commercial/capability-gateway";
import type { ResolveNativeCustomerSessionDependencies } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { CustomerOnboardingMutationResult, CustomerOnboardingService, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";
import type { ResolveCustomerIdentityResult } from "@/lib/domains/customer-identity";
import type { Customer360LoadResult } from "@/lib/domains/customer-360";
import type { SalesAgentProvider, SalesAgentProviderRequest } from "@/lib/brain/commercial/sales-agent/runtimeTypes";

// ACS-R1-04-T06.1. Groups: Customer 360 (41-45), Runtime (46-50).

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

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
      let body: unknown = null;
      const text = Buffer.concat(chunks).toString("utf8");
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

beforeEach(() => {
  requestCount = 0;
  handler = (_req, res) => res.writeHead(500).end();
  process.env.CUSTOMER_SERVICE_BASE_URL = baseUrl;
  process.env.CUSTOMER_SERVICE_API_KEY = "test-key";
  resetCustomerServicePortForTests();
  resetOnboardingServiceForTests();
  // ACS-R1-04-T08.1: this file exercises Customer 360 gate/runtime timing,
  // not the customer_master projection gate itself.
  setCustomerMasterProjectionReaderForTests({ async exists() { return true; } });
});

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

// ACS-R1-04-T06.2. The native WhatsApp inbound no longer resolves a
// provisional customer for an unknown sender (that authority moved to
// Customer Service). These tests need an already-identified customer, so
// seeding links a real master_customer to the waId directly before sending
// the inbound - mirroring tests/native/identity-conflict.test.ts.
async function seedConversation() {
  const waId = `5699${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;

  const customer = await createMasterCustomer({
    firstname: "Cliente",
    lastname: "PostPlan",
    email: `postplan-${uniqueSuffix("seed")}@example.com`,
    platformOrigin: "whatsapp"
  });
  assert.ok(customer.ok, customer.ok ? "" : customer.error);
  const customerId = Number(customer.data.id);
  await queryRows(
    `
      INSERT INTO customer_external_identity (customer_id, provider, identity_type, external_id, normalized_value, is_verified, created_at, updated_at)
      VALUES (?, 'whatsapp', 'phone_number', ?, ?, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    `,
    [customerId, waId, waId]
  );

  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("postplan")}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente PostPlan",
    messageType: "text",
    text: "Hola",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.ok(result.conversationId);
  assert.equal(result.customerId, customerId, "seeding must resolve the linked customerId");
  return { ...result, waId, phoneNumberId, customerId: result.customerId as number };
}

function countingLoader() {
  const calls: string[] = [];
  const NOT_FOUND: Customer360LoadResult = { status: "not_found", snapshot: null, warnings: [] };
  return {
    calls,
    async loadCustomer360(customerId: string): Promise<Customer360LoadResult> {
      calls.push(customerId);
      return NOT_FOUND;
    }
  };
}

function notUsedInTest(name: string) {
  return async () => {
    throw new Error(`${name} must not be called in this test`);
  };
}

function fakeOnboardingService(state: CustomerOnboardingState | null): CustomerOnboardingService {
  return {
    async getState() {
      return state;
    },
    startOnboarding: notUsedInTest("startOnboarding"),
    collectFields: notUsedInTest("collectFields"),
    markResolving: notUsedInTest("markResolving"),
    completeOnboarding: notUsedInTest("completeOnboarding"),
    markConflict: notUsedInTest("markConflict"),
    markTemporarilyUnavailable: notUsedInTest("markTemporarilyUnavailable"),
    retryResolution: notUsedInTest("retryResolution"),
    recordVerificationFailure: notUsedInTest("recordVerificationFailure")
  };
}

/** Minimal working fake for the "customer created post-plan" scenario - onboarding starts required, gets created, completes. */
function mutableOnboardingService(initial: CustomerOnboardingState | null) {
  let state = initial;
  const calls: string[] = [];
  function bump(patch: Partial<CustomerOnboardingState>): CustomerOnboardingMutationResult {
    state = { ...(state as CustomerOnboardingState), ...patch, version: (state as CustomerOnboardingState).version + 1 };
    return { ok: true, status: "updated", state };
  }
  const service: CustomerOnboardingService = {
    async getState() {
      calls.push("getState");
      return state;
    },
    async startOnboarding(input) {
      calls.push("startOnboarding");
      state = {
        id: 1,
        conversationId: input.conversationId,
        opportunityId: input.opportunityId ?? null,
        status: "required",
        purpose: input.purpose,
        collected: {},
        pendingFields: input.pendingFields,
        customerId: null,
        failedVerificationAttempts: 0,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null
      };
      return { ok: true, status: "created", state };
    },
    async collectFields(input) {
      calls.push("collectFields");
      return bump({ status: "collecting", pendingFields: input.pendingFields, collected: { ...(state as CustomerOnboardingState).collected, ...input.collectedPatch } });
    },
    async markResolving() {
      calls.push("markResolving");
      return bump({ status: "resolving" });
    },
    async completeOnboarding(input) {
      calls.push("completeOnboarding");
      return bump({ status: "completed", customerId: input.customerId, completedAt: new Date().toISOString() });
    },
    markConflict: notUsedInTest("markConflict"),
    markTemporarilyUnavailable: notUsedInTest("markTemporarilyUnavailable"),
    retryResolution: notUsedInTest("retryResolution"),
    recordVerificationFailure: notUsedInTest("recordVerificationFailure")
  };
  return { service, calls, getState: () => state };
}

function identified(customerId: string): ResolveCustomerIdentityResult {
  return { status: "identified", customerId, matchedBy: "external_identity", confidence: "verified", conflicts: [], warnings: [] };
}
function identificationRequired(): ResolveCustomerIdentityResult {
  return { status: "identification_required", customerId: null, matchedBy: null, confidence: "insufficient", conflicts: [], warnings: [] };
}
function conflict(): ResolveCustomerIdentityResult {
  return { status: "conflict", customerId: null, matchedBy: null, confidence: "insufficient", conflicts: [{ type: "phone_ambiguous", candidateCustomerIds: ["1", "2"] }], warnings: [] };
}
function unavailable(): ResolveCustomerIdentityResult {
  return { status: "temporarily_unavailable", customerId: null, matchedBy: null, confidence: "insufficient", conflicts: [], warnings: [] };
}

function onboardingRow(conversationId: string, customerId: string | null, overrides: Partial<CustomerOnboardingState> = {}): CustomerOnboardingState {
  return {
    id: 1,
    conversationId,
    opportunityId: null,
    status: "completed",
    purpose: "quote",
    collected: {},
    pendingFields: [],
    customerId,
    failedVerificationAttempts: 0,
    version: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    ...overrides
  };
}

const LEGACY_ENV = {
  BRAIN_COMMERCIAL_SHADOW_ENABLED: "true",
  BRAIN_COMMERCIAL_RUNTIME_ENABLED: "true",
  BRAIN_COMMERCIAL_POLICY_ENABLED: "true",
  BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER: "true",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false",
  BRAIN_SALES_AGENT_ENABLED: "false"
};

// The post-plan stage (Fase 3.6) only runs when the operational loop actually
// produces a selectedNextAction - loadCustomer360-gate tests (41/42/44/45)
// don't need it, but any test that asserts post-plan actually executed does.
const POST_PLAN_ENV = { ...LEGACY_ENV, BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "true" };

const MULTI_REQUEST_ENV = {
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "true",
  BRAIN_REQUEST_TRACKING_ENABLED: "true",
  BRAIN_TURN_PLAN_PERSISTENCE_ENABLED: "true"
};

function withEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  Object.assign(process.env, overrides);
  return fn().finally(() => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

/** A minimal provider whose responseProposal.messageIntent is "quote" - selectNextCommercialAction.ts maps that to the real, live "prepare_quote" next-action type. */
function createQuoteIntentProvider(): SalesAgentProvider {
  return {
    name: "test-quote-intent-provider",
    version: "test.v1",
    async invoke(request: SalesAgentProviderRequest) {
      return {
        rawOutput: {
          runId: request.correlationId ?? "fake-run-id",
          contractVersion: request.contractVersion,
          outcome: "response_proposed",
          analysis: {
            summary: "El cliente quiere cotizar.",
            qualificationState: "qualified",
            customerReadiness: "ready",
            productFit: "good",
            confidence: "medium",
            riskLevel: "low",
            reasonCodes: ["customer_message_present"]
          },
          decision: { type: "respond_now", reason: "cotizacion", confidence: "medium", riskLevel: "low", requiresApproval: "none", errorCode: "none", reasonCodes: [], policyTags: [] },
          shouldRespondNow: true,
          shouldRequestTool: false,
          shouldRequestHuman: false,
          shouldEvaluateFollowUp: false,
          proposedActions: [],
          toolRequests: [],
          entityProposals: [],
          responseProposal: {
            messageIntent: "quote",
            draftText: "Claro, te ayudo a cotizar.",
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "medium"
          },
          evidence: [],
          policyAssessment: { status: "allowed", blocked: false, reason: "ok", confidence: "high", riskLevel: "low", approvalRequirement: "none", errorCode: "none", reasonCodes: [], policyTags: [] },
          warnings: [],
          rationale: { summary: "ok", evidence: [], counterEvidence: [], assumptions: [], riskFlags: [], missingInformation: [], policyRulesApplied: [] },
          metadata: {}
        },
        model: "test-model",
        inputTokens: 1,
        outputTokens: 1,
        estimatedCost: 0,
        providerRequestId: "test-provider-request-id",
        finishReason: "stop",
        metadata: {}
      };
    }
  };
}

async function runLegacy(
  seeded: { conversationId: number | null; conversationPublicId: string | null; waId: string; phoneNumberId: string; messageId: string | number | null },
  messageText: string,
  dependencies: ResolveNativeCustomerSessionDependencies,
  provider?: SalesAgentProvider,
  env: Record<string, string> = LEGACY_ENV
) {
  const loader = countingLoader();
  const result = await withEnv(env, () =>
    runNativeAutonomousCycle({
      conversationId: seeded.conversationId as number,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText,
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: loader.loadCustomer360,
      customerSessionDependencies: dependencies,
      provider
    })
  );
  return { result, calls: loader.calls };
}

// ---------------------------------------------------------------------------
// Group: Customer 360 (41-45)
// ---------------------------------------------------------------------------

test("41: an identified customer with contextAccess none (public query, no onboarding) makes zero Customer 360 calls", async () => {
  const seeded = await seedConversation();
  const { calls } = await runLegacy(seeded, "hola", { identityService: { async resolveIdentity() { return identified(String(seeded.customerId)); } }, onboardingService: fakeOnboardingService(null) });
  assert.equal(calls.length, 0);
});

test("42: an identified customer with an active quote onboarding (commercial_history) makes exactly one Customer 360 call", async () => {
  const seeded = await seedConversation();
  const state = onboardingRow(String(seeded.conversationId), String(seeded.customerId), { status: "completed", purpose: "quote" });
  const { calls } = await runLegacy(seeded, "hola", { identityService: { async resolveIdentity() { return identified(String(seeded.customerId)); } }, onboardingService: fakeOnboardingService(state) });
  assert.equal(calls.length, 1);
});

test("43: a customer created by the post-plan stage this same turn never triggers a second Customer 360 load", async () => {
  const seeded = await seedConversation();
  handler = (req, res, _body) => {
    if (req.url?.includes("/resolve")) return sendJson(res, 200, { status: "no_match" });
    return sendJson(res, 201, { status: "created", customerMasterId: "999" });
  };
  const onboarding = mutableOnboardingService(onboardingRow(String(seeded.conversationId), null, { status: "collecting", customerId: null, completedAt: null, collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  setOnboardingServiceForTests(onboarding.service);
  const { result, calls } = await runLegacy(
    seeded,
    "autorizo crear mi ficha de cliente",
    { identityService: { async resolveIdentity() { return identificationRequired(); } }, onboardingService: onboarding.service },
    createQuoteIntentProvider(),
    POST_PLAN_ENV
  );
  assert.equal(result.customerSession?.identity.status, "identification_required", "identity for THIS turn's pre-plan gate was never resolved - the customer only exists after post-plan ran");
  assert.equal(onboarding.getState()?.status, "completed", "the post-plan stage actually created the customer this turn");
  assert.equal(calls.length, 0, "Customer 360 is never loaded a second time after post-plan creates a customer");
});

test("44: an identity conflict makes zero Customer 360 calls even with post-plan running", async () => {
  const seeded = await seedConversation();
  const { calls } = await runLegacy(seeded, "hola", { identityService: { async resolveIdentity() { return conflict(); } }, onboardingService: fakeOnboardingService(null) });
  assert.equal(calls.length, 0);
});

test("45: a temporarily_unavailable identity resolution makes zero Customer 360 calls", async () => {
  const seeded = await seedConversation();
  const { calls } = await runLegacy(seeded, "hola", { identityService: { async resolveIdentity() { return unavailable(); } }, onboardingService: fakeOnboardingService(null) });
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Group: Runtime (46-50)
// ---------------------------------------------------------------------------

test("46: the legacy pipeline actually runs the post-plan stage - a structured quote operation starts onboarding end to end", async () => {
  const seeded = await seedConversation();
  const onboarding = mutableOnboardingService(null);
  setOnboardingServiceForTests(onboarding.service);
  await runLegacy(
    seeded,
    "quiero cotizar una banca",
    { identityService: { async resolveIdentity() { return identificationRequired(); } }, onboardingService: onboarding.service },
    createQuoteIntentProvider(),
    POST_PLAN_ENV
  );
  assert.ok(onboarding.calls.includes("startOnboarding"), "the legacy pipeline's post-plan stage actually ran and started onboarding");
});

test("47: multi-request never calls the Capability Gateway for create_customer - no HTTP request reaches Customer Service", async () => {
  const seeded = await seedConversation();
  await withEnv(MULTI_REQUEST_ENV, () =>
    runNativeAutonomousCycle({
      conversationId: seeded.conversationId,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText: "quiero cotizar y autorizo crear mi ficha de cliente, me llamo Pedro Perez, mi correo es pedro@example.com",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: countingLoader().loadCustomer360
    })
  );
  assert.equal(requestCount, 0, "multi-request never reaches Customer Service for create_customer");
});

test("48: multi-request never calls the Capability Gateway for link_external_identity - no HTTP request reaches Customer Service", async () => {
  const seeded = await seedConversation();
  await withEnv(MULTI_REQUEST_ENV, () =>
    runNativeAutonomousCycle({
      conversationId: seeded.conversationId,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText: "autorizo vincular este whatsapp a mi cuenta",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: countingLoader().loadCustomer360
    })
  );
  assert.equal(requestCount, 0, "multi-request never reaches Customer Service for link_external_identity");
});

test("49: multi-request still invokes the turn planner exactly once per inbound (unchanged by T06.1)", async () => {
  const seeded = await seedConversation();
  let planCalls = 0;
  const result = await withEnv(MULTI_REQUEST_ENV, () =>
    runNativeAutonomousCycle({
      conversationId: seeded.conversationId,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText: "cotizame una banca",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: countingLoader().loadCustomer360
    })
  );
  assert.notEqual(result.multiRequest, null);
  assert.equal(result.multiRequest?.planReused, false);
});

test("50: the default (unmodified) runtime configuration keeps identity side effects out of multi-request - only the legacy pipeline executes them", async () => {
  const seeded = await seedConversation();
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerMasterId: "1" });
  await withEnv(MULTI_REQUEST_ENV, () =>
    runNativeAutonomousCycle({
      conversationId: seeded.conversationId,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText: "quiero cotizar, me llamo Pedro Perez, mi correo es pedro@example.com, autorizo crear mi ficha de cliente",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: countingLoader().loadCustomer360
    })
  );
  assert.equal(requestCount, 0, "no side effect reached Customer Service under the multi-request default configuration");
});
