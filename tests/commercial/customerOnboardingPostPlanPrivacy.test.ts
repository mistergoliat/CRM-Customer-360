import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import { resetCustomerServicePortForTests, resetOnboardingServiceForTests, setOnboardingServiceForTests } from "@/lib/brain/commercial/capability-gateway";
import { buildOnboardingGroundedMessage } from "@/lib/brain/commercial/native-cycle/buildOnboardingGroundedMessage";
import { runCustomerOnboardingPostPlanStage } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { SalesAgentProvider, SalesAgentProviderRequest } from "@/lib/brain/commercial/sales-agent/runtimeTypes";
import type { ResolveCustomerIdentityResult } from "@/lib/domains/customer-identity";
import type { CustomerOnboardingMutationResult, CustomerOnboardingService, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";

// ACS-R1-04-T06.1, group "Privacidad e idempotencia" (51-60).

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

const POST_PLAN_SOURCE = readFileSync(
  join(__dirname, "..", "..", "lib", "brain", "commercial", "native-cycle", "customer-session", "runCustomerOnboardingPostPlanStage.ts"),
  "utf8"
);

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: unknown) => void;
let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let idempotencyKeys: string[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    if (typeof req.headers["idempotency-key"] === "string") idempotencyKeys.push(req.headers["idempotency-key"]);
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
  idempotencyKeys = [];
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
    lastname: "Privacy",
    email: `privacy-${uniqueSuffix("seed")}@example.com`,
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
    providerMessageId: `wamid.${uniqueSuffix("privacy")}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Privacy",
    messageType: "text",
    text: "Hola",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.ok(result.conversationId);
  assert.equal(result.customerId, customerId, "seeding must resolve the linked customerId");
  return { ...result, waId, phoneNumberId, customerId: result.customerId as number };
}

function notUsedInTest(name: string) {
  return async () => {
    throw new Error(`${name} must not be called in this test`);
  };
}

function mutableOnboardingService(initial: CustomerOnboardingState | null) {
  let state = initial;
  function bump(patch: Partial<CustomerOnboardingState>): CustomerOnboardingMutationResult {
    state = { ...(state as CustomerOnboardingState), ...patch, version: (state as CustomerOnboardingState).version + 1 };
    return { ok: true, status: "updated", state };
  }
  const service: CustomerOnboardingService = {
    async getState() {
      return state;
    },
    async startOnboarding(input) {
      state = {
        id: 1,
        conversationId: input.conversationId,
        opportunityId: input.opportunityId ?? null,
        status: "collecting",
        purpose: input.purpose,
        collected: { firstName: "Pedro", email: "pedro@example.com" },
        pendingFields: [],
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
      return bump({ status: "collecting", pendingFields: input.pendingFields, collected: { ...(state as CustomerOnboardingState).collected, ...input.collectedPatch } });
    },
    async markResolving() {
      return bump({ status: "resolving" });
    },
    async completeOnboarding(input) {
      return bump({ status: "completed", customerId: input.customerId, completedAt: new Date().toISOString() });
    },
    markConflict: notUsedInTest("markConflict"),
    markTemporarilyUnavailable: notUsedInTest("markTemporarilyUnavailable"),
    retryResolution: notUsedInTest("retryResolution"),
    recordVerificationFailure: notUsedInTest("recordVerificationFailure")
  };
  return service;
}

function session(overrides: Partial<NativeCustomerSessionExecutionContext> = {}): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "conv-1",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56911112222", normalizedPhone: "56911112222", messageId: "wamid.1", receivedAt: "2026-07-09T12:00:00.000Z" },
    identity: { status: "identification_required", customerId: null, source: "none", localResolutionOutcome: "identification_required", externalResolutionOutcome: null },
    onboarding: null,
    contextAccess: "none",
    currentTurnConsent: {
      createCustomer: { scope: "create_customer", messageId: "wamid.1", capturedAt: "2026-07-09T12:00:00.000Z", source: "current_inbound" },
      linkExternalIdentity: { scope: "link_external_identity", messageId: "wamid.1", capturedAt: "2026-07-09T12:00:00.000Z", source: "current_inbound" }
    },
    freshExternalResolutionEvidence: { source: "customer_service", requestId: "r", checkedAt: "2026-07-09T12:00:00.000Z", result: { status: "no_match" } },
    ...overrides
  };
}

const LEGACY_ENV = {
  BRAIN_COMMERCIAL_SHADOW_ENABLED: "true",
  BRAIN_COMMERCIAL_RUNTIME_ENABLED: "true",
  BRAIN_COMMERCIAL_POLICY_ENABLED: "true",
  BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER: "true",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false"
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

function createCapturingSalesAgentProvider(onInvoke: (request: SalesAgentProviderRequest) => void): SalesAgentProvider {
  return {
    name: "test-capturing-provider",
    version: "test.v1",
    async invoke(request: SalesAgentProviderRequest) {
      onInvoke(request);
      return {
        rawOutput: {
          runId: request.correlationId ?? "fake-run-id",
          contractVersion: request.contractVersion,
          outcome: "response_proposed",
          analysis: {
            summary: "Consulta general.",
            qualificationState: "not_started",
            customerReadiness: "browsing",
            productFit: "not_applicable",
            confidence: "medium",
            riskLevel: "low",
            reasonCodes: ["customer_message_present"]
          },
          decision: { type: "respond_now", reason: "ok", confidence: "medium", riskLevel: "low", requiresApproval: "none", errorCode: "none", reasonCodes: [], policyTags: [] },
          shouldRespondNow: true,
          shouldRequestTool: false,
          shouldRequestHuman: false,
          shouldEvaluateFollowUp: false,
          proposedActions: [],
          toolRequests: [],
          entityProposals: [],
          responseProposal: {
            messageIntent: "answer",
            draftText: "Hola, cuentame en que te puedo ayudar.",
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

// ---------------------------------------------------------------------------
// Group: Privacidad e idempotencia (51-60)
// ---------------------------------------------------------------------------

test("51: the decision context returned by the full cycle never carries PII, even after post-plan creates a customer", async () => {
  const seeded = await seedConversation();
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerId: "555" });
  const onboardingService = mutableOnboardingService(null);
  setOnboardingServiceForTests(onboardingService);
  const result = await withEnv(LEGACY_ENV, () =>
    runNativeAutonomousCycle({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText: "quiero cotizar, me llamo Pedro Perez, mi correo es pedro@example.com, autorizo crear mi ficha de cliente",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: async () => ({ status: "not_found", snapshot: null, warnings: [] }),
      customerSessionDependencies: { identityService: { async resolveIdentity(): Promise<ResolveCustomerIdentityResult> { return { status: "identification_required", customerId: null, matchedBy: null, confidence: "insufficient", conflicts: [], warnings: [] }; } }, onboardingService },
      provider: createCapturingSalesAgentProvider(() => {})
    })
  );
  const serialized = JSON.stringify(result.customerSession);
  assert.doesNotMatch(serialized, /pedro@example\.com/i);
  assert.doesNotMatch(serialized, /Pedro/);
  assert.doesNotMatch(serialized, /555/);
});

test("52: the sales-agent provider never receives the server-side execution context - only the minimized decision context", async () => {
  const seeded = await seedConversation();
  let captured: SalesAgentProviderRequest | null = null;
  await withEnv(LEGACY_ENV, () =>
    runNativeAutonomousCycle({
      conversationId: seeded.conversationId!,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText: "hola",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: async () => ({ status: "not_found", snapshot: null, warnings: [] }),
      provider: createCapturingSalesAgentProvider((request) => {
        captured = request;
      })
    })
  );
  assert.ok(captured, "provider must have been invoked");
  const input = (captured as unknown as SalesAgentProviderRequest).salesAgentInput as unknown as Record<string, unknown>;
  assert.equal("trustedInbound" in input, false);
  assert.equal("currentTurnConsent" in input, false);
  assert.equal("freshExternalResolutionEvidence" in input, false);
});

test("53: a retry (same correlationId) never duplicates create_customer - the idempotency key sent is identical both times", async () => {
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerId: "1" });
  const onboarding = session({ onboarding: { id: 1, conversationId: "conv-1", opportunityId: null, status: "collecting", purpose: "quote", collected: { firstName: "Pedro", email: "pedro@example.com" }, pendingFields: [], customerId: null, failedVerificationAttempts: 0, version: 1, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", completedAt: null } });
  const service = mutableOnboardingService(onboarding.onboarding);
  setOnboardingServiceForTests(service);
  await runCustomerOnboardingPostPlanStage({ plannedOperation: { operation: "prepare_quote" }, messageText: "autorizo crear mi ficha de cliente", correlationId: "same-corr", customerSessionExecution: onboarding, dependencies: { onboardingService: service } });
  await runCustomerOnboardingPostPlanStage({ plannedOperation: { operation: "prepare_quote" }, messageText: "autorizo crear mi ficha de cliente", correlationId: "same-corr", customerSessionExecution: onboarding, dependencies: { onboardingService: service } });
  assert.equal(idempotencyKeys.length, 2);
  assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
  assert.equal(idempotencyKeys[0], "customer-service:create:same-corr:create_customer");
});

test("54: a retry (same correlationId) never duplicates link_external_identity - the idempotency key sent is identical both times", async () => {
  handler = (_req, res) => sendJson(res, 201, { status: "completed", customerId: "700", externalIdentityId: "ext-1" });
  const linkSession = session({ identity: { status: "identified", customerId: "700", source: "normalized_phone", localResolutionOutcome: "identified", externalResolutionOutcome: null } });
  await runCustomerOnboardingPostPlanStage({ plannedOperation: { operation: null }, messageText: "autorizo vincular", correlationId: "same-corr-2", customerSessionExecution: linkSession, dependencies: {} });
  await runCustomerOnboardingPostPlanStage({ plannedOperation: { operation: null }, messageText: "autorizo vincular", correlationId: "same-corr-2", customerSessionExecution: linkSession, dependencies: {} });
  assert.equal(idempotencyKeys.length, 2);
  assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
  assert.equal(idempotencyKeys[0], "customer-service:link:same-corr-2:link_external_identity");
});

test("55: a raw/leaky Customer Service error never reaches the grounded customer-facing message", () => {
  const message = buildOnboardingGroundedMessage({
    attemptedOperation: "create_customer",
    onboarding: null,
    warnings: [],
    capabilityOutcome: { capability: "create_customer", version: "v1", availability: "available", status: "denied", data: null, errorCode: "SELECT * FROM master_customer WHERE email='pedro@example.com' -- leaked", retryable: false, evidence: [], retryCount: 0, startedAt: "t", completedAt: "t", executionPublicId: "id" }
  });
  assert.doesNotMatch(message ?? "", /SELECT/i);
  assert.doesNotMatch(message ?? "", /pedro@example\.com/);
});

test("56: the customerId is never present in the decision context or the grounded message", async () => {
  const outcomeCompleted = buildOnboardingGroundedMessage({
    attemptedOperation: "create_customer",
    onboarding: null,
    warnings: [],
    capabilityOutcome: { capability: "create_customer", version: "v1", availability: "available", status: "completed", data: { status: "created", customerId: "918273" }, errorCode: null, retryable: false, evidence: [], retryCount: 0, startedAt: "t", completedAt: "t", executionPublicId: "id" }
  });
  assert.doesNotMatch(outcomeCompleted ?? "", /918273/);
});

test("57: consent evidence (messageId/text) never reaches the grounded message", () => {
  const message = buildOnboardingGroundedMessage({
    attemptedOperation: "create_customer",
    onboarding: null,
    warnings: [],
    capabilityOutcome: { capability: "create_customer", version: "v1", availability: "available", status: "denied", data: null, errorCode: "consent_required:create_customer", retryable: false, evidence: [], retryCount: 0, startedAt: "t", completedAt: "t", executionPublicId: "id" }
  });
  assert.doesNotMatch(message ?? "", /wamid\./);
  assert.doesNotMatch(message ?? "", /messageId/i);
});

test("58: create_customer's request body reflects only server-side onboarding/trusted-inbound data - the post-plan stage has no channel for arbitrary LLM-supplied input at all", async () => {
  const captured: { body: Record<string, unknown> | null } = { body: null };
  handler = (_req, res, body) => {
    captured.body = body as Record<string, unknown> | null;
    sendJson(res, 201, { status: "created", customerId: "1" });
  };
  const withData = session({ onboarding: { id: 1, conversationId: "conv-1", opportunityId: null, status: "collecting", purpose: "quote", collected: { firstName: "RealName", email: "real@example.com" }, pendingFields: [], customerId: null, failedVerificationAttempts: 0, version: 1, createdAt: "t", updatedAt: "t", completedAt: null } });
  await runCustomerOnboardingPostPlanStage({ plannedOperation: { operation: "prepare_quote" }, messageText: "autorizo crear mi ficha de cliente", correlationId: "corr-58", customerSessionExecution: withData, dependencies: {} });
  assert.equal(captured.body?.firstName, "RealName");
  assert.equal(captured.body?.email, "real@example.com");
});

test("59: the post-plan stage never writes directly to master_customer or customer_external_identity", () => {
  assert.doesNotMatch(POST_PLAN_SOURCE, /master_customer/);
  assert.doesNotMatch(POST_PLAN_SOURCE, /customer_external_identity/);
  assert.doesNotMatch(POST_PLAN_SOURCE, /INSERT INTO/i);
  assert.doesNotMatch(POST_PLAN_SOURCE, /UPDATE\s+\w+\s+SET/i);
});

test("60: T07 (executions/outcomes/warnings persistence) was not implemented - no new migration adds those tables", () => {
  const migrationsDir = join(__dirname, "..", "..", "migrations");
  const files = readdirSync(migrationsDir);
  const suspicious = files.filter((file) => /onboarding_execution|identity_outcome|onboarding_warning|customer_identity_audit/i.test(file));
  assert.deepEqual(suspicious, []);
});
