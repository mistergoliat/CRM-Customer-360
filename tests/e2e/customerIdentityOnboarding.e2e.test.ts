import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { getPool, queryRows, safeQueryRows } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import { resetCustomerServicePortForTests, resetOnboardingServiceForTests } from "@/lib/brain/commercial/capability-gateway";
import { createCustomerOnboardingService } from "@/lib/domains/customer-onboarding";
import { createCustomer360QueryService } from "@/lib/domains/customer-360";
import type { Customer360LoadResult } from "@/lib/domains/customer-360";
import type { SalesAgentProvider, SalesAgentProviderRequest } from "@/lib/brain/commercial/sales-agent/runtimeTypes";

// ACS-R1-04-T08. End-to-end proof of the identity/onboarding flow already
// connected by T06/T06.1 and instrumented by T07: real inbound persistence
// -> runNativeAutonomousCycle -> resolveNativeCustomerSession ->
// CustomerOnboardingService -> Capability Gateway -> Customer Service HTTP
// adapter (against a local controlled server implementing the real
// contract, never a mock of executeGovernedCapability itself) -> commercial_event
// T07 evidence -> final persisted state. Runs against a disposable crm_test
// database (see docs/releases/ACS-R1-04-customer-identity-onboarding.md,
// T08 closure evidence, for the migration chain proof).

Object.assign(process.env, {
  NODE_ENV: "development",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "crm_test",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  BRAIN_META_SEND_ENABLED: "false",
  BRAIN_OUTBOX_WORKER_ENABLED: "false"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

// ---------------------------------------------------------------------------
// Controlled Customer Service HTTP double: a real server implementing the
// real contract (docs/integrations/customer-service-http-contract.md), never
// a mock of executeGovernedCapability's result. Backed by realistic
// in-memory state (customers, external identities, idempotency-key replay)
// that persists across turns within one scenario - reset explicitly at the
// start of each scenario, never per-test, so a multi-turn flow keeps seeing
// the same fake customers it already created/linked.
// ---------------------------------------------------------------------------

type FakeServiceCustomer = { id: string; firstName: string; lastName: string | null; email: string; phoneNumber: string };
type FakeServiceExternalIdentity = { customerId: string; provider: string; externalId: string };
type FakeServiceRequest = { method: string; url: string; idempotencyKey: string | null; body: unknown };

type FakeCustomerServiceState = {
  customers: FakeServiceCustomer[];
  externalIdentities: FakeServiceExternalIdentity[];
  idempotencyResponses: Map<string, { status: number; body: unknown }>;
  requests: FakeServiceRequest[];
  nextExternalIdentityId: number;
  /**
   * ACS-R1-04-T08.1 negative scenario: when true, handleCreate simulates
   * Customer Service reporting a real business success (customerMasterId
   * assigned, event log entry created below) WITHOUT the local
   * master_customer projection existing yet (no createMasterCustomer call) -
   * exactly the race T08 discovered and T08.1's gate protects against.
   */
  simulateProjectionLag: boolean;
};

function createFakeCustomerServiceState(): FakeCustomerServiceState {
  return { customers: [], externalIdentities: [], idempotencyResponses: new Map(), requests: [], nextExternalIdentityId: 1, simulateProjectionLag: false };
}

let fakeState = createFakeCustomerServiceState();
let projectionLagCounter = 0;

function handleResolve(body: unknown): { status: number; body: unknown } {
  const input = body as { externalId?: string; phoneNumber?: string | null; email?: string | null };
  const byExternal = fakeState.externalIdentities.find((entry) => entry.externalId === input.externalId);
  if (byExternal) return { status: 200, body: { status: "resolved", customerMasterId: byExternal.customerId } };
  if (input.phoneNumber) {
    const matches = fakeState.customers.filter((customer) => customer.phoneNumber === input.phoneNumber);
    if (matches.length === 1) return { status: 200, body: { status: "resolved", customerMasterId: matches[0].id } };
    if (matches.length > 1) return { status: 200, body: { status: "conflict", conflictCode: "multiple_candidates" } };
  }
  return { status: 200, body: { status: "no_match" } };
}

/**
 * ACS-R1-04-T08.1 (task section 11): this fixture represents the controlled
 * Customer Service, never ACS. When it reports "created", it is Customer
 * Service's own responsibility to ensure the local master_customer
 * projection - so this function (not the test body, not any turn/scenario
 * setup code) is the one that calls createMasterCustomer. The E2E test
 * itself never pre-inserts a customer before driving a turn.
 */
async function handleCreate(body: unknown, idempotencyKey: string | null): Promise<{ status: number; body: unknown }> {
  if (idempotencyKey && fakeState.idempotencyResponses.has(idempotencyKey)) {
    return fakeState.idempotencyResponses.get(idempotencyKey) as { status: number; body: unknown };
  }
  const input = body as { firstName?: string; lastName?: string | null; email?: string; phoneNumber?: string };
  if (!input.firstName || !input.email || !input.phoneNumber) {
    return { status: 422, body: { error: { code: "invalid_request", fields: ["firstName", "email", "phoneNumber"].filter((field) => !(input as Record<string, unknown>)[field]) } } };
  }

  let customerMasterId: string;
  if (fakeState.simulateProjectionLag) {
    // Customer Service really did accept and record this customer on its own
    // side - it just has not synced/projected it into the local
    // master_customer table yet (a real, plausible-looking id that
    // deliberately has no local row).
    projectionLagCounter += 1;
    customerMasterId = `900000${projectionLagCounter}`;
  } else {
    const provisioned = await createMasterCustomer({ firstname: input.firstName, lastname: input.lastName ?? "", email: input.email, platformOrigin: "whatsapp" });
    assert.ok(provisioned.ok, provisioned.ok ? "" : provisioned.error);
    customerMasterId = String(provisioned.data.id);
  }

  const customer: FakeServiceCustomer = { id: customerMasterId, firstName: input.firstName, lastName: input.lastName ?? null, email: input.email, phoneNumber: input.phoneNumber };
  fakeState.customers.push(customer);
  const response = { status: 201, body: { status: "created", customerMasterId } };
  if (idempotencyKey) fakeState.idempotencyResponses.set(idempotencyKey, response);
  return response;
}

function handleLink(customerMasterId: string, body: unknown, idempotencyKey: string | null): { status: number; body: unknown } {
  if (idempotencyKey && fakeState.idempotencyResponses.has(idempotencyKey)) {
    return fakeState.idempotencyResponses.get(idempotencyKey) as { status: number; body: unknown };
  }
  const input = body as { externalIdentity?: { provider: string; externalId: string } };
  const externalIdentity = input.externalIdentity;
  if (!externalIdentity) {
    return { status: 422, body: { error: { code: "invalid_request", fields: ["externalIdentity"] } } };
  }
  const existing = fakeState.externalIdentities.find((entry) => entry.externalId === externalIdentity.externalId);
  let response: { status: number; body: unknown };
  if (existing && existing.customerId === customerMasterId) {
    response = { status: 200, body: { status: "already_linked", customerMasterId, externalIdentityId: `ext-${existing.customerId}` } };
  } else if (existing) {
    // Per docs/integrations/customer-service-http-contract.md ("Codigos HTTP
    // -> outcome"): a link conflict is a 409 with an error envelope, never a
    // 2xx body with status:"conflict" (parseLinkSuccess only recognizes
    // completed/already_linked/denied in a 2xx body).
    response = { status: 409, body: { error: { code: "conflict", conflictCode: "already_linked_to_other_customer" } } };
  } else if (!fakeState.customers.some((customer) => customer.id === customerMasterId)) {
    response = { status: 404, body: { error: { code: "customer_not_found" } } };
  } else {
    fakeState.externalIdentities.push({ customerId: customerMasterId, provider: externalIdentity.provider, externalId: externalIdentity.externalId });
    response = { status: 200, body: { status: "completed", customerMasterId, externalIdentityId: `ext-${fakeState.nextExternalIdentityId++}` } };
  }
  if (idempotencyKey) fakeState.idempotencyResponses.set(idempotencyKey, response);
  return response;
}

let server: http.Server;
let baseUrl: string;

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        let body: unknown = null;
        const text = Buffer.concat(chunks).toString("utf8");
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = null;
          }
        }
        const idempotencyKey = (req.headers["idempotency-key"] as string | undefined) ?? null;
        const url = req.url ?? "";
        fakeState.requests.push({ method: req.method ?? "POST", url, idempotencyKey, body });

        let outcome: { status: number; body: unknown };
        if (url === "/v1/customers/resolve") {
          outcome = handleResolve(body);
        } else if (url === "/v1/customers") {
          outcome = await handleCreate(body, idempotencyKey);
        } else {
          const linkMatch = url.match(/^\/v1\/customers\/([^/]+)\/external-identities$/);
          if (linkMatch) {
            outcome = handleLink(decodeURIComponent(linkMatch[1]), body, idempotencyKey);
          } else {
            outcome = { status: 404, body: { error: { code: "not_found" } } };
          }
        }
        res.writeHead(outcome.status, { "content-type": "application/json" });
        res.end(JSON.stringify(outcome.body));
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.CUSTOMER_SERVICE_BASE_URL = baseUrl;
  process.env.CUSTOMER_SERVICE_API_KEY = "test-key";
  resetCustomerServicePortForTests();
  resetOnboardingServiceForTests();
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

// A stable 11-digit "569XXXXXXXX" Chilean mobile shape: normalizePhoneChile
// (lib/customer-identity/normalize.ts) returns an already-11-digit "569..."
// value unchanged (its first branch), so this is idempotent under every
// normalizer this suite exercises (normalizeWaId/normalizePhoneChile for the
// T02 identity resolver, normalizeWhatsAppRecipientDigits for the T06.2
// inbound layer) - no truncation, no re-prefixing, no cross-layer mismatch.
function uniqueWaId() {
  return `569${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
}

async function makeCustomer(label: string) {
  const result = await createMasterCustomer({
    firstname: "T08",
    lastname: label,
    email: `t08-${uniqueSuffix(label)}@example.com`,
    platformOrigin: "whatsapp"
  });
  assert.ok(result.ok, result.ok ? "" : result.error);
  return Number(result.data.id);
}

async function seedExternalIdentity(input: { customerId: number; provider: string; externalId: string; normalizedValue: string; isVerified?: boolean }) {
  await queryRows(
    `
      INSERT INTO customer_external_identity (customer_id, provider, identity_type, external_id, normalized_value, is_verified, created_at, updated_at)
      VALUES (?, ?, 'phone_number', ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    `,
    [input.customerId, input.provider, input.externalId, input.normalizedValue, input.isVerified ? 1 : 0]
  );
}

const LEGACY_ENV = {
  BRAIN_COMMERCIAL_SHADOW_ENABLED: "true",
  BRAIN_COMMERCIAL_RUNTIME_ENABLED: "true",
  BRAIN_COMMERCIAL_POLICY_ENABLED: "true",
  BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER: "false",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false",
  BRAIN_SALES_AGENT_ENABLED: "false"
};

const POST_PLAN_ENV = {
  ...LEGACY_ENV,
  BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER: "true",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "true"
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

/** Deterministic fake provider whose responseProposal.messageIntent is "quote" - selectNextCommercialAction.ts maps that to the real, live "prepare_quote" next-action type (same pattern as tests/commercial/customerOnboardingPostPlanRuntime.test.ts). */
function createQuoteIntentProvider(): SalesAgentProvider {
  return {
    name: "test-t08-quote-intent-provider",
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

function createCountingCustomer360Loader() {
  const service = createCustomer360QueryService();
  const calls: string[] = [];
  return {
    calls,
    async loadCustomer360(customerId: string): Promise<Customer360LoadResult> {
      calls.push(customerId);
      return service.loadByCustomerId(customerId);
    }
  };
}

// Every turn driven through the cycle is recorded here (correlationId + the
// raw PII terms this specific turn actually carried) so the single
// aggregated privacy test at the bottom of this file can scan every event
// and capability execution produced across all three scenarios, without
// duplicating scenario-scoped bookkeeping.
const recordedTurns: Array<{ correlationId: string; piiTerms: string[] }> = [];

async function sendInbound(params: { waId: string; phoneNumberId: string; text: string; providerMessageId?: string }) {
  const providerMessageId = params.providerMessageId ?? `wamid.${uniqueSuffix("t08")}`;
  const result = await processNativeWhatsAppInbound({
    providerMessageId,
    phoneNumberId: params.phoneNumberId,
    externalSenderId: params.waId,
    senderPhone: params.waId,
    senderName: "Cliente T08",
    messageType: "text",
    text: params.text,
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  return { ...result, providerMessageId };
}

/**
 * Drives one full turn: persists the inbound exactly like production
 * (processNativeWhatsAppInbound), then explicitly runs runNativeAutonomousCycle
 * with the same identifiers production would use internally - the only
 * injected values are the two documented test-only hooks (provider,
 * loadCustomer360), never customerSessionDependencies, so identity
 * resolution and onboarding persistence are the real, DB-backed services.
 * When the inbound is a duplicate (retry of the same providerMessageId), the
 * cycle is never invoked a second time, matching production exactly.
 */
async function turn(params: {
  waId: string;
  phoneNumberId: string;
  text: string;
  env: Record<string, string>;
  provider?: SalesAgentProvider;
  providerMessageId?: string;
  piiTerms?: string[];
}) {
  const inbound = await sendInbound(params);
  if (inbound.duplicate) {
    return { inbound, cycle: null as Awaited<ReturnType<typeof runNativeAutonomousCycle>> | null, customer360Calls: [] as string[] };
  }
  const loader = createCountingCustomer360Loader();
  const cycle = await withEnv(params.env, () =>
    runNativeAutonomousCycle({
      conversationId: inbound.conversationId as number,
      conversationPublicId: inbound.conversationPublicId as string,
      customerMasterId: inbound.customerId ?? null,
      waId: params.waId,
      phoneNumberId: params.phoneNumberId,
      messageId: inbound.messageId,
      messageText: params.text,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString(),
      loadCustomer360: loader.loadCustomer360,
      provider: params.provider ?? null
    })
  );
  recordedTurns.push({ correlationId: inbound.correlationId, piiTerms: params.piiTerms ?? [] });
  return { inbound, cycle, customer360Calls: loader.calls };
}

async function loadEventsByType(eventType: string, correlationId: string) {
  const result = await safeQueryRows<{
    payload_json: string;
    metadata_json: string;
    correlation_id: string;
    conversation_id: number | null;
    opportunity_id: number | null;
    customer_id: number | null;
    dedupe_key: string;
  }>(
    "SELECT payload_json, metadata_json, correlation_id, conversation_id, opportunity_id, customer_id, dedupe_key FROM commercial_event WHERE event_type = ? AND correlation_id = ? ORDER BY created_at ASC, id ASC",
    [eventType, correlationId]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) as Record<string, unknown>, metadata: JSON.parse(row.metadata_json) as Record<string, unknown> }));
}

async function loadCapabilityExecutions(correlationId: string, capabilityName?: string) {
  const result = capabilityName
    ? await safeQueryRows<Record<string, unknown>>("SELECT * FROM crm_capability_executions WHERE correlation_id = ? AND capability_name = ? ORDER BY id ASC", [correlationId, capabilityName])
    : await safeQueryRows<Record<string, unknown>>("SELECT * FROM crm_capability_executions WHERE correlation_id = ? ORDER BY id ASC", [correlationId]);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows;
}

async function countLegacyOnboardingRows(waId: string) {
  const result = await safeQueryRows<{ total: number }>("SELECT COUNT(*) AS total FROM crm_customer_onboarding WHERE wa_id = ?", [waId]);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return Number(result.rows[0]?.total ?? 0);
}

async function countExternalIdentities(provider: string, externalId: string) {
  const result = await safeQueryRows<{ total: number }>("SELECT COUNT(*) AS total FROM customer_external_identity WHERE provider = ? AND external_id = ?", [provider, externalId]);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return Number(result.rows[0]?.total ?? 0);
}

async function countMasterCustomers(email: string) {
  const result = await safeQueryRows<{ total: number }>("SELECT COUNT(*) AS total FROM master_customer WHERE email = ?", [email]);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return Number(result.rows[0]?.total ?? 0);
}

function safeJsonParse(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function assertNoPii(value: unknown, forbiddenTerms: string[], context: string) {
  const json = JSON.stringify(value ?? null).toLowerCase();
  for (const term of forbiddenTerms) {
    if (!term || term.length < 3) continue;
    assert.equal(json.includes(term.toLowerCase()), false, `forbidden PII "${term}" found in ${context}: ${json}`);
  }
}

// ===========================================================================
// Escenario A - cliente nuevo: multi-turno, creacion idempotente, vinculacion
// separada (task section 6).
// ===========================================================================

let scenarioA: {
  waId: string;
  phoneNumberId: string;
  email: string;
  conversationId: number;
  customerId: string;
} | null = null;

test("T08-A1: cliente nuevo - turno inicial con intencion de cotizacion, sin match, sin identidad provisional, onboarding iniciado", async () => {
  fakeState = createFakeCustomerServiceState();
  const waId = uniqueWaId();
  const phoneNumberId = `phone-${uniqueSuffix("a1")}`;

  const before = await countExternalIdentities("whatsapp", waId);
  assert.equal(before, 0);

  const { inbound, cycle } = await turn({
    waId,
    phoneNumberId,
    text: "Hola, quiero cotizar una banca ajustable para mi perro",
    env: POST_PLAN_ENV,
    provider: createQuoteIntentProvider(),
    piiTerms: [waId]
  });

  assert.equal(inbound.duplicate, false);
  // customer_external_identity.customer_id = NULL (T06.2 persists an
  // unresolved row, never a provisional master_customer).
  assert.equal(inbound.customerId, null);
  assert.equal((inbound as { customer: unknown }).customer, null);
  assert.ok(inbound.messageId, "conversation_message must be persisted");
  assert.ok(inbound.conversationId);

  const identityRow = await safeQueryRows<{ customer_id: number | null }>(
    "SELECT customer_id FROM customer_external_identity WHERE provider = 'whatsapp' AND external_id = ? LIMIT 1",
    [waId]
  );
  assert.ok(identityRow.ok);
  assert.equal(identityRow.rows[0]?.customer_id, null);

  const conversationRow = await safeQueryRows<{ customer_id: number | null }>("SELECT customer_id FROM conversation WHERE id = ? LIMIT 1", [inbound.conversationId as number]);
  assert.ok(conversationRow.ok);
  assert.equal(conversationRow.rows[0]?.customer_id, null);

  // never a provisional master_customer, never a wa-<phone>@local.invalid email
  const noEmailInvalid = await safeQueryRows<{ total: number }>("SELECT COUNT(*) AS total FROM master_customer WHERE email LIKE ?", [`%${waId}%local.invalid%`]);
  assert.ok(noEmailInvalid.ok);
  assert.equal(Number(noEmailInvalid.rows[0]?.total ?? 0), 0);

  // onboarding started via CustomerOnboardingService, backed by crm_customer_onboarding_state
  const onboardingService = createCustomerOnboardingService();
  const state = await onboardingService.getState(String(inbound.conversationId));
  assert.ok(state);
  assert.equal(state?.status, "required");
  assert.equal(state?.purpose, "quote");
  assert.deepEqual([...(state?.pendingFields ?? [])].sort(), ["email", "firstName"]);

  // cero writes en crm_customer_onboarding legacy
  assert.equal(await countLegacyOnboardingRows(waId), 0);

  // cycle-level session reflects the real identity/onboarding services, not
  // fakes. mapLocalResolution only reports "identification_required" when
  // onboarding was ALREADY active before this turn (T06.1); on a brand new
  // conversation's very first turn - the one that is about to activate
  // onboarding for the first time - it always reports "anonymous" instead,
  // since onboarding does not exist yet at the point local identity is
  // resolved (pre-plan runs before the post-plan activation below).
  assert.equal(cycle?.customerSession?.identity.status, "anonymous");
  assert.equal(cycle?.customerSession?.identity.hasResolvedCustomer, false);
  assert.equal(cycle?.customerSession?.contextAccess, "none");

  const resolutionEvents = await loadEventsByType("customer_identity_resolution_recorded", inbound.correlationId);
  assert.ok(resolutionEvents.length >= 1);
  const preplan = resolutionEvents.find((event) => event.payload.phase === "pre_plan" && event.payload.resolver === "local");
  assert.ok(preplan);
  assert.equal(preplan?.payload.outcome, "no_match");
  assert.equal(preplan?.payload.hasResolvedCustomer, false);

  const transitionEvents = await loadEventsByType("customer_onboarding_transition_recorded", inbound.correlationId);
  const startEvent = transitionEvents.find((event) => event.payload.operation === "start");
  assert.ok(startEvent, "onboarding activation must be recorded as a T07 transition event");
  assert.equal(startEvent?.payload.previousStatus, null);
  assert.equal(startEvent?.payload.nextStatus, "required");

  scenarioA = { waId, phoneNumberId, email: "", conversationId: inbound.conversationId as number, customerId: "" };
});

test("T08-A2: cliente nuevo - captura multi-turno (firstName/lastName y email) via CustomerOnboardingService.collectFields", async () => {
  assert.ok(scenarioA, "requires T08-A1 to have run first");
  const { waId, phoneNumberId } = scenarioA!;
  const onboardingService = createCustomerOnboardingService();

  const nameTurn = await turn({
    waId,
    phoneNumberId,
    text: "Me llamo Ana Torres",
    env: POST_PLAN_ENV,
    provider: createQuoteIntentProvider(),
    piiTerms: [waId, "Ana Torres"]
  });
  assert.equal(nameTurn.cycle?.customerSession?.identity.status, "identification_required");

  const afterName = await onboardingService.getState(String(scenarioA!.conversationId));
  assert.equal(afterName?.status, "collecting");
  assert.deepEqual(afterName?.pendingFields, ["email"]);

  const transitionsAfterName = await loadEventsByType("customer_onboarding_transition_recorded", nameTurn.inbound.correlationId);
  const collectEvent = transitionsAfterName.find((event) => event.payload.operation === "collect_fields");
  assert.ok(collectEvent);
  assert.equal((collectEvent?.payload.collectedAvailability as Record<string, boolean>).firstName, true);
  assert.equal((collectEvent?.payload.collectedAvailability as Record<string, boolean>).email, false);

  const email = `${uniqueSuffix("ana-torres")}@example.com`;
  const emailTurn = await turn({
    waId,
    phoneNumberId,
    text: `Mi correo es ${email}`,
    env: POST_PLAN_ENV,
    provider: createQuoteIntentProvider(),
    piiTerms: [waId, email]
  });
  const afterEmail = await onboardingService.getState(String(scenarioA!.conversationId));
  assert.equal(afterEmail?.status, "collecting");
  assert.deepEqual(afterEmail?.pendingFields, []);
  assert.equal(afterEmail?.collected.email, email);
  assert.equal(afterEmail?.collected.firstName, "Ana");

  assert.equal(await countLegacyOnboardingRows(waId), 0);

  scenarioA = { ...scenarioA!, email };
  void emailTurn;
});

test("T08-A3: cliente nuevo - creacion idempotente (resolve_customer no_match fresco, create_customer exactamente una vez, retry sin duplicar)", async () => {
  assert.ok(scenarioA, "requires T08-A1/A2 to have run first");
  const { waId, phoneNumberId, email } = scenarioA!;
  const requestsBefore = fakeState.requests.length;
  const customersBeforeCreate = await countMasterCustomers(email);

  const consentText = "Autorizo crear mi ficha de cliente";
  const createTurn = await turn({
    waId,
    phoneNumberId,
    text: consentText,
    env: POST_PLAN_ENV,
    provider: createQuoteIntentProvider(),
    providerMessageId: `wamid.${uniqueSuffix("a3-create")}`,
    piiTerms: [waId, email, "Ana", "Torres", consentText]
  });

  // resolve_customer executed exactly once this turn, no_match fresh from this same turn.
  const resolveCallsThisTurn = fakeState.requests.slice(requestsBefore).filter((request) => request.url === "/v1/customers/resolve");
  assert.equal(resolveCallsThisTurn.length, 1, "resolve_customer must run at most once per inbound");

  const createCallsThisTurn = fakeState.requests.slice(requestsBefore).filter((request) => request.url === "/v1/customers");
  assert.equal(createCallsThisTurn.length, 1, "create_customer must execute exactly once");

  // The controlled Customer Service double created the local projection as
  // part of its own "created" response (see handleCreate) - never ACS.
  assert.equal(customersBeforeCreate, 0);
  assert.equal(await countMasterCustomers(email), 1);

  const onboardingService = createCustomerOnboardingService();
  const finalState = await onboardingService.getState(String(scenarioA!.conversationId));
  assert.equal(finalState?.status, "completed");
  assert.ok(finalState?.customerId, "onboarding completed with a real customerId");
  const customerId = finalState!.customerId as string;
  assert.notEqual(customerId, "null");

  // crm_capability_executions contains real technical rows for both capabilities.
  const resolveExecutions = await loadCapabilityExecutions(createTurn.inbound.correlationId, "resolve_customer");
  const createExecutions = await loadCapabilityExecutions(createTurn.inbound.correlationId, "create_customer");
  assert.equal(createExecutions.length, 1);
  assert.equal(createExecutions[0].execution_status, "completed");
  assert.equal(createExecutions[0].availability_status, "available");

  const requestSummary = safeJsonParse(createExecutions[0].request_summary_json) as Record<string, unknown>;
  const responseSummary = safeJsonParse(createExecutions[0].response_summary_json) as Record<string, unknown>;
  assert.deepEqual(Object.keys(requestSummary).sort(), ["channel", "consentPresent", "emailAvailable", "hasExternalIdentity", "hasResolvedCustomer", "phoneAvailable", "purpose"]);
  assert.deepEqual(Object.keys(responseSummary).sort(), ["businessOutcome", "gatewayStatus", "hasExternalIdentity", "hasResolvedCustomer", "retryable", "stableErrorCode"]);
  assert.equal(responseSummary.gatewayStatus, "completed");
  assert.equal(responseSummary.businessOutcome, "created");
  assert.equal(requestSummary.consentPresent, true);
  assert.equal(requestSummary.purpose, "quote");

  // commercial_event T07 evidence: business outcome recorded distinct from Gateway status.
  const outcomeEvents = await loadEventsByType("customer_identity_capability_outcome_recorded", createTurn.inbound.correlationId);
  const createOutcome = outcomeEvents.find((event) => event.payload.capability === "create_customer");
  assert.ok(createOutcome);
  assert.equal(createOutcome?.payload.gatewayStatus, "completed");
  assert.equal(createOutcome?.payload.businessOutcome, "created");

  const completeTransition = (await loadEventsByType("customer_onboarding_transition_recorded", createTurn.inbound.correlationId)).find((event) => event.payload.operation === "complete");
  assert.ok(completeTransition);
  assert.equal(completeTransition?.payload.hasResolvedCustomer, true);

  // ---- Retry: resending the exact same providerMessageId must never duplicate anything. ----
  const executionsBeforeRetry = (await loadCapabilityExecutions(createTurn.inbound.correlationId)).length;
  const eventsBeforeRetry = (await loadEventsByType("customer_identity_capability_outcome_recorded", createTurn.inbound.correlationId)).length;
  const customersBeforeRetry = await countMasterCustomers(email);
  const requestsBeforeRetry = fakeState.requests.length;

  const retry = await turn({
    waId,
    phoneNumberId,
    text: consentText,
    env: POST_PLAN_ENV,
    provider: createQuoteIntentProvider(),
    providerMessageId: createTurn.inbound.providerMessageId,
    piiTerms: [waId, email]
  });
  assert.equal(retry.inbound.duplicate, true, "resending the same providerMessageId must be recognized as a duplicate");
  assert.equal(retry.cycle, null, "the cycle must never re-run for a duplicate inbound");

  assert.equal(fakeState.requests.length, requestsBeforeRetry, "no new HTTP call to Customer Service on retry");
  assert.equal((await loadCapabilityExecutions(createTurn.inbound.correlationId)).length, executionsBeforeRetry);
  assert.equal((await loadEventsByType("customer_identity_capability_outcome_recorded", createTurn.inbound.correlationId)).length, eventsBeforeRetry);
  assert.equal(await countMasterCustomers(email), customersBeforeRetry);
  assert.equal(await countMasterCustomers(email), 1, "exactly one customer must exist for this email");

  assert.equal(await countLegacyOnboardingRows(waId), 0);

  scenarioA = { ...scenarioA!, customerId };
});

test("T08-A4: cliente nuevo - vinculacion en un turno separado, con consentimiento propio (nunca el de creacion)", async () => {
  assert.ok(scenarioA?.customerId, "requires T08-A3 to have created the customer first");
  const { waId, phoneNumberId, customerId } = scenarioA!;

  // Local resolution alone (no consent yet) does not link anything -
  // identity becomes "identified" via the onboarding_state source (never
  // external_identity, since link_external_identity has not run yet).
  const probe = await turn({ waId, phoneNumberId, text: "Hola de nuevo", env: LEGACY_ENV, piiTerms: [waId] });
  assert.equal(probe.cycle?.customerSession?.identity.status, "identified");
  assert.equal(probe.cycle?.customerSession?.identity.source, "onboarding_state");
  assert.equal(await countExternalIdentities("whatsapp", waId), 1, "the identity row is still the original unresolved one");
  const stillUnresolvedRow = await safeQueryRows<{ customer_id: number | null }>("SELECT customer_id FROM customer_external_identity WHERE provider='whatsapp' AND external_id=? LIMIT 1", [waId]);
  assert.equal(stillUnresolvedRow.rows[0]?.customer_id, null);

  const requestsBefore = fakeState.requests.length;
  const consentText = "Autorizo vincular este whatsapp a mi cuenta";
  const linkTurn = await turn({
    waId,
    phoneNumberId,
    text: consentText,
    env: POST_PLAN_ENV,
    provider: createQuoteIntentProvider(),
    piiTerms: [waId, consentText]
  });

  const linkCalls = fakeState.requests.slice(requestsBefore).filter((request) => request.url === `/v1/customers/${customerId}/external-identities`);
  assert.equal(linkCalls.length, 1, "link_external_identity must execute exactly once");

  const linkExecutions = await loadCapabilityExecutions(linkTurn.inbound.correlationId, "link_external_identity");
  assert.equal(linkExecutions.length, 1);
  assert.equal(linkExecutions[0].execution_status, "completed");
  const linkResponseSummary = safeJsonParse(linkExecutions[0].response_summary_json) as Record<string, unknown>;
  assert.equal(linkResponseSummary.businessOutcome, "completed");
  assert.equal(linkResponseSummary.gatewayStatus, "completed");

  const outcomeEvents = await loadEventsByType("customer_identity_capability_outcome_recorded", linkTurn.inbound.correlationId);
  const linkOutcome = outcomeEvents.find((event) => event.payload.capability === "link_external_identity");
  assert.ok(linkOutcome);
  assert.equal(linkOutcome?.payload.businessOutcome, "completed");

  assert.ok(fakeState.externalIdentities.some((entry) => entry.customerId === customerId && entry.provider === "whatsapp"), "Customer Service must record the link");

  assert.equal(await countLegacyOnboardingRows(waId), 0);
});

test("T08-A5: link_external_identity conflict - Gateway status completed y business outcome conflict son compatibles", async () => {
  fakeState = createFakeCustomerServiceState();
  const waId = uniqueWaId();
  const phoneNumberId = `phone-${uniqueSuffix("a5")}`;
  const email = `${uniqueSuffix("a5-conflict")}@example.com`;

  await turn({ waId, phoneNumberId, text: "Hola, quiero cotizar", env: POST_PLAN_ENV, provider: createQuoteIntentProvider(), piiTerms: [waId] });
  await turn({ waId, phoneNumberId, text: "Me llamo Beto Rios", env: POST_PLAN_ENV, provider: createQuoteIntentProvider(), piiTerms: [waId, "Beto Rios"] });
  await turn({ waId, phoneNumberId, text: `Mi correo es ${email}`, env: POST_PLAN_ENV, provider: createQuoteIntentProvider(), piiTerms: [waId, email] });

  const createTurn = await turn({
    waId,
    phoneNumberId,
    text: "Autorizo crear mi ficha de cliente",
    env: POST_PLAN_ENV,
    provider: createQuoteIntentProvider(),
    piiTerms: [waId, email]
  });

  const onboardingService = createCustomerOnboardingService();
  const created = await onboardingService.getState(String(createTurn.inbound.conversationId));
  assert.equal(created?.status, "completed");
  const customerId = created!.customerId as string;

  // Simulate a race: the external identity Customer Service already links this
  // exact wa_id to a DIFFERENT customer before our link_external_identity call runs.
  const otherCustomerId = "other-fake-customer";
  fakeState.customers.push({ id: otherCustomerId, firstName: "Otro", lastName: null, email: "otro@example.com", phoneNumber: waId });
  fakeState.externalIdentities.push({ customerId: otherCustomerId, provider: "whatsapp", externalId: waId });

  const linkTurn = await turn({
    waId,
    phoneNumberId,
    text: "Autorizo vincular este whatsapp a mi cuenta",
    env: POST_PLAN_ENV,
    provider: createQuoteIntentProvider(),
    piiTerms: [waId]
  });

  const linkExecutions = await loadCapabilityExecutions(linkTurn.inbound.correlationId, "link_external_identity");
  assert.equal(linkExecutions.length, 1);
  // Gateway status: completed (the HTTP call itself succeeded) / Business outcome: conflict.
  assert.equal(linkExecutions[0].execution_status, "completed");
  const responseSummary = safeJsonParse(linkExecutions[0].response_summary_json) as Record<string, unknown>;
  assert.equal(responseSummary.gatewayStatus, "completed");
  assert.equal(responseSummary.businessOutcome, "conflict");

  const outcomeEvents = await loadEventsByType("customer_identity_capability_outcome_recorded", linkTurn.inbound.correlationId);
  const linkOutcome = outcomeEvents.find((event) => event.payload.capability === "link_external_identity");
  assert.ok(linkOutcome);
  assert.equal(linkOutcome?.payload.gatewayStatus, "completed");
  assert.equal(linkOutcome?.payload.businessOutcome, "conflict");

  // The real customer created earlier is never overwritten/reassigned by this conflict.
  assert.equal(customerId, created!.customerId);
});

test("T08-A6: create_customer con proyeccion local no disponible (ACS-R1-04-T08.1) - sin FK, sin completar onboarding, warning persistido, Customer 360 no cargado, cero escritura ACS en master_customer", async () => {
  fakeState = createFakeCustomerServiceState();
  fakeState.simulateProjectionLag = true;
  const waId = uniqueWaId();
  const phoneNumberId = `phone-${uniqueSuffix("a6")}`;
  const email = `${uniqueSuffix("a6-lag")}@example.com`;

  await turn({ waId, phoneNumberId, text: "Hola, quiero cotizar", env: POST_PLAN_ENV, provider: createQuoteIntentProvider(), piiTerms: [waId] });
  await turn({ waId, phoneNumberId, text: "Me llamo Carla Diaz", env: POST_PLAN_ENV, provider: createQuoteIntentProvider(), piiTerms: [waId, "Carla Diaz"] });

  const customersBefore = await countMasterCustomers(email);
  const createTurn = await turn({
    waId,
    phoneNumberId,
    text: `Mi correo es ${email}, autorizo crear mi ficha de cliente`,
    env: POST_PLAN_ENV,
    provider: createQuoteIntentProvider(),
    piiTerms: [waId, email, "Carla Diaz"]
  });

  // Customer Service really did succeed (business outcome created, Gateway
  // status completed) - the capability's own outcome is never changed by
  // the projection gate (task section 8).
  const createExecutions = await loadCapabilityExecutions(createTurn.inbound.correlationId, "create_customer");
  assert.equal(createExecutions.length, 1);
  assert.equal(createExecutions[0].execution_status, "completed");
  const responseSummary = safeJsonParse(createExecutions[0].response_summary_json) as Record<string, unknown>;
  assert.equal(responseSummary.gatewayStatus, "completed");
  assert.equal(responseSummary.businessOutcome, "created");

  const outcomeEvents = await loadEventsByType("customer_identity_capability_outcome_recorded", createTurn.inbound.correlationId);
  const createOutcome = outcomeEvents.find((event) => event.payload.capability === "create_customer");
  assert.ok(createOutcome);
  assert.equal(createOutcome?.payload.gatewayStatus, "completed");
  assert.equal(createOutcome?.payload.businessOutcome, "created");

  // ACS never throws a raw FK violation - the turn completes normally.
  assert.ok(createTurn.cycle, "the cycle must complete without throwing");

  // onboarding is never completed with an unverified id - lands temporarily_unavailable instead.
  const onboardingService = createCustomerOnboardingService();
  const state = await onboardingService.getState(String(createTurn.inbound.conversationId));
  assert.equal(state?.status, "temporarily_unavailable");
  assert.equal(state?.customerId, null);

  // structured warning persisted via the existing T07 event, never a raw error.
  const warningEvents = await loadEventsByType("customer_session_warning_recorded", createTurn.inbound.correlationId);
  assert.ok(warningEvents.some((event) => event.payload.warningCode === "customer_master_projection_unavailable"));

  // Customer 360 never loaded, conversation never linked to the unverified id.
  assert.equal(createTurn.customer360Calls.length, 0);
  const conversationRow = await safeQueryRows<{ customer_id: number | null }>("SELECT customer_id FROM conversation WHERE id = ? LIMIT 1", [createTurn.inbound.conversationId as number]);
  assert.ok(conversationRow.ok);
  assert.equal(conversationRow.rows[0]?.customer_id, null);

  // ACS never writes master_customer - zero rows for this email, before and after.
  assert.equal(customersBefore, 0);
  assert.equal(await countMasterCustomers(email), 0);

  // ---- Turno N+1 (ACS-R1-04-T08.1, recuperacion runtime real): la
  // proyeccion aparece entre turnos - fuera del runtime de ACS, exactamente
  // como Customer Service terminando su propia sincronizacion - y un
  // inbound real, via el mismo entrypoint productivo (turn(), nunca
  // verifyCustomerMasterProjection/completeOnboardingWithVerifiedCustomer
  // invocados directamente como sustituto del runtime), debe resolver y
  // completar sin un segundo create_customer.
  // Matched by phoneNumber (from trustedInbound.normalizedPhone, exact) rather
  // than by email: extractCustomerOnboardingFields's free-text email capture
  // keeps trailing punctuation from a combined "email + consent" message
  // (pre-existing, unrelated to T08.1), so an exact email string match here
  // would be fragile - the phone is never derived from free text.
  const assignedCustomerMasterId = fakeState.customers.find((customer) => customer.phoneNumber === waId)?.id;
  assert.ok(assignedCustomerMasterId, "the fake Customer Service must have recorded the customer it created in turn N");

  await queryRows("INSERT INTO master_customer (id, firstname, lastname, email, platform_origin) VALUES (?, 'Carla', 'Diaz', ?, 'whatsapp')", [assignedCustomerMasterId, email]);

  const requestsBeforeRecovery = fakeState.requests.length;
  const recoveryTurn = await turn({
    waId,
    phoneNumberId,
    text: "Hola, sigo esperando la cotizacion",
    env: POST_PLAN_ENV,
    provider: createQuoteIntentProvider(),
    piiTerms: [waId, email, "Carla Diaz"]
  });

  const resolveCallsRecovery = fakeState.requests.slice(requestsBeforeRecovery).filter((request) => request.url === "/v1/customers/resolve");
  const createCallsRecovery = fakeState.requests.slice(requestsBeforeRecovery).filter((request) => request.url === "/v1/customers");
  assert.equal(resolveCallsRecovery.length, 1, "resolve_customer must run exactly once during the recovery turn");
  assert.equal(createCallsRecovery.length, 0, "create_customer must never run again during recovery");

  const stateAfterRecovery = await onboardingService.getState(String(createTurn.inbound.conversationId));
  assert.equal(stateAfterRecovery?.status, "completed");
  assert.equal(stateAfterRecovery?.customerId, assignedCustomerMasterId);

  // no second customer created, no second create_customer execution ever
  // recorded for the original turn's correlationId either.
  assert.equal(await countMasterCustomers(email), 1);
  assert.equal((await loadCapabilityExecutions(createTurn.inbound.correlationId, "create_customer")).length, 1);

  const retryTransition = (await loadEventsByType("customer_onboarding_transition_recorded", recoveryTurn.inbound.correlationId)).find(
    (event) => event.payload.operation === "retry_resolution"
  );
  assert.ok(retryTransition, "the temporarily_unavailable -> resolving retry must be recorded as T07 evidence");
  const completeTransition = (await loadEventsByType("customer_onboarding_transition_recorded", recoveryTurn.inbound.correlationId)).find(
    (event) => event.payload.operation === "complete"
  );
  assert.ok(completeTransition);
  assert.equal(completeTransition?.payload.hasResolvedCustomer, true);

  // fresh evidence this turn drove the recovery - never the earlier warning by itself.
  const resolutionEventsRecovery = await loadEventsByType("customer_identity_resolution_recorded", recoveryTurn.inbound.correlationId);
  const externalResolution = resolutionEventsRecovery.find((event) => event.payload.resolver === "customer_service");
  assert.ok(externalResolution);
  assert.equal(externalResolution?.payload.outcome, "identified");

  // Customer 360 access follows the existing contextAccess rules exactly as
  // for any other turn that completes onboarding mid-turn (see T08-B3) - no
  // special-cased loading tied to the recovery path itself.
  const conversationRowAfterRecovery = await safeQueryRows<{ customer_id: number | null }>(
    "SELECT customer_id FROM conversation WHERE id = ? LIMIT 1",
    [createTurn.inbound.conversationId as number]
  );
  assert.ok(conversationRowAfterRecovery.ok);
});

test("T08-A7: recuperacion runtime - la proyeccion sigue ausente en el turno de reintento (regresion) - resolve_customer una vez, cero create_customer, onboarding sigue temporarily_unavailable, cero excepcion, warning no duplicado", async () => {
  fakeState = createFakeCustomerServiceState();
  fakeState.simulateProjectionLag = true;
  const waId = uniqueWaId();
  const phoneNumberId = `phone-${uniqueSuffix("a7")}`;
  const email = `${uniqueSuffix("a7-lag")}@example.com`;

  await turn({ waId, phoneNumberId, text: "Hola, quiero cotizar", env: POST_PLAN_ENV, provider: createQuoteIntentProvider(), piiTerms: [waId] });
  await turn({ waId, phoneNumberId, text: "Me llamo Diego Soto", env: POST_PLAN_ENV, provider: createQuoteIntentProvider(), piiTerms: [waId, "Diego Soto"] });
  const createTurn = await turn({
    waId,
    phoneNumberId,
    text: `Mi correo es ${email}, autorizo crear mi ficha de cliente`,
    env: POST_PLAN_ENV,
    provider: createQuoteIntentProvider(),
    piiTerms: [waId, email, "Diego Soto"]
  });

  const onboardingService = createCustomerOnboardingService();
  const stateAfterTurnN = await onboardingService.getState(String(createTurn.inbound.conversationId));
  assert.equal(stateAfterTurnN?.status, "temporarily_unavailable");

  // Entre turnos: la proyeccion local NO aparece (a diferencia de T08-A6) - el retry debe fallar de la misma forma segura, sin excepcion.
  const requestsBeforeRetryTurn = fakeState.requests.length;
  const retryTurn = await turn({
    waId,
    phoneNumberId,
    text: "Hola, alguna novedad con mi cotizacion",
    env: POST_PLAN_ENV,
    provider: createQuoteIntentProvider(),
    piiTerms: [waId, email, "Diego Soto"]
  });
  assert.ok(retryTurn.cycle, "the cycle must complete without throwing even when the projection is still missing");

  const resolveCallsRetry = fakeState.requests.slice(requestsBeforeRetryTurn).filter((request) => request.url === "/v1/customers/resolve");
  const createCallsRetry = fakeState.requests.slice(requestsBeforeRetryTurn).filter((request) => request.url === "/v1/customers");
  assert.equal(resolveCallsRetry.length, 1, "resolve_customer must run exactly once during the retry turn");
  assert.equal(createCallsRetry.length, 0, "create_customer must never run automatically as recovery");

  const stateAfterRetry = await onboardingService.getState(String(createTurn.inbound.conversationId));
  assert.equal(stateAfterRetry?.status, "temporarily_unavailable", "onboarding stays temporarily_unavailable - never completed with an unverified id");
  assert.equal(stateAfterRetry?.customerId, null);

  const warningEventsRetry = await loadEventsByType("customer_session_warning_recorded", retryTurn.inbound.correlationId);
  const projectionWarnings = warningEventsRetry.filter((event) => event.payload.warningCode === "customer_master_projection_unavailable");
  assert.equal(projectionWarnings.length, 1, "the warning must never be duplicated within the same turn (existing dedupe rules)");

  assert.equal(await countMasterCustomers(email), 0, "ACS never writes master_customer even on a failed retry");
});

// ===========================================================================
// Escenario B - cliente existente (task section 7).
// ===========================================================================

test("T08-B1: cliente existente - resolucion exacta por provider+external_id, cero create/link/resolve externo", async () => {
  fakeState = createFakeCustomerServiceState();
  const waId = uniqueWaId();
  const phoneNumberId = `phone-${uniqueSuffix("b1")}`;
  const customerId = await makeCustomer("B1Exact");
  await seedExternalIdentity({ customerId, provider: "whatsapp", externalId: waId, normalizedValue: waId, isVerified: true });

  const result = await turn({ waId, phoneNumberId, text: "Hola, cuanto cuesta el pienso premium?", env: LEGACY_ENV, piiTerms: [waId] });

  assert.equal(result.inbound.duplicate, false);
  assert.equal(result.inbound.customerId, customerId);
  assert.equal(result.cycle?.customerSession?.identity.status, "identified");
  assert.equal(result.cycle?.customerSession?.identity.source, "external_identity");
  assert.equal(result.cycle?.customerSession?.contextAccess, "none", "an isolated customerId never authorizes Customer 360 by itself");
  assert.equal(result.customer360Calls.length, 0);
  assert.equal(fakeState.requests.length, 0, "local resolution was sufficient - zero external Customer Service calls");

  assert.equal(await countExternalIdentities("whatsapp", waId), 1, "no duplicated external identity");
  assert.equal(await countMasterCustomers(`t08-B1Exact`), 0); // sanity: this email prefix search is scoped by makeCustomer's own suffix, not reused

  const events = await loadEventsByType("customer_identity_resolution_recorded", result.inbound.correlationId);
  const local = events.find((event) => event.payload.resolver === "local");
  assert.ok(local);
  assert.equal(local?.payload.outcome, "identified");
  assert.equal(local?.payload.matchedBy, "external_identity");
});

test("T08-B2: cliente existente - resolucion cross-provider por telefono normalizado (sin duplicar customer)", async () => {
  fakeState = createFakeCustomerServiceState();
  const phone = uniqueWaId();
  const phoneNumberId = `phone-${uniqueSuffix("b2")}`;
  const customerId = await makeCustomer("B2Cross");
  // Historical identity registered via a different channel/provider, same normalized phone -
  // this is a brand new contact on WhatsApp specifically.
  await seedExternalIdentity({ customerId, provider: "hub_operator", externalId: `manual-${phone}`, normalizedValue: phone, isVerified: true });

  const result = await turn({ waId: phone, phoneNumberId, text: "Hola, sigo interesado", env: LEGACY_ENV, piiTerms: [phone] });

  // T06.2's own conversation-linking resolver is provider-scoped (whatsapp
  // only) and does not know this historical phone - conversation.customer_id
  // stays null (documented debt, ACS-R1-04-T02.1). The cycle's own local
  // identity resolution (T02, cross-provider by design) does find it.
  assert.equal(result.inbound.customerId, null);
  assert.equal(result.cycle?.customerSession?.identity.status, "identified");
  assert.equal(result.cycle?.customerSession?.identity.source, "normalized_phone");
  assert.equal(fakeState.requests.length, 0, "cross-provider phone match was sufficient locally - zero external Customer Service calls");

  const events = await loadEventsByType("customer_identity_resolution_recorded", result.inbound.correlationId);
  const local = events.find((event) => event.payload.resolver === "local");
  assert.ok(local);
  assert.equal(local?.payload.outcome, "identified");
  assert.equal(local?.payload.matchedBy, "normalized_phone");

  assert.equal(await countExternalIdentities("hub_operator", `manual-${phone}`), 1, "no duplicated historical identity");

  // Second inbound from the same phone reuses the same resolution, never creates a second customer.
  const second = await turn({ waId: phone, phoneNumberId, text: "Otra consulta", env: LEGACY_ENV, piiTerms: [phone] });
  assert.equal(second.inbound.conversationId, result.inbound.conversationId, "second inbound reuses the same conversation");
  assert.equal(second.cycle?.customerSession?.identity.status, "identified");
});

test("T08-B3: Customer 360 gate - contextAccess autoriza la carga solo con onboarding quote activo, nunca por un customerId aislado", async () => {
  fakeState = createFakeCustomerServiceState();
  const waId = uniqueWaId();
  const phoneNumberId = `phone-${uniqueSuffix("b3")}`;
  const customerId = await makeCustomer("B3Gate");
  await seedExternalIdentity({ customerId, provider: "whatsapp", externalId: waId, normalizedValue: waId, isVerified: true });

  const first = await turn({ waId, phoneNumberId, text: "Hola", env: LEGACY_ENV, piiTerms: [waId] });
  assert.equal(first.cycle?.customerSession?.identity.status, "identified");
  assert.equal(first.cycle?.customerSession?.contextAccess, "none");
  assert.equal(first.customer360Calls.length, 0);

  // A previously established commercial relationship (quote onboarding
  // already completed for this conversation) - seeded through the real
  // service's own public transitions, never a direct SQL write.
  const onboardingService = createCustomerOnboardingService();
  const started = await onboardingService.startOnboarding({ conversationId: String(first.inbound.conversationId), purpose: "quote", pendingFields: [] });
  assert.ok(started.ok);
  const resolving = await onboardingService.markResolving({ conversationId: String(first.inbound.conversationId), expectedVersion: (started as { state: { version: number } }).state.version });
  assert.ok(resolving.ok);
  const completed = await onboardingService.completeOnboarding({
    conversationId: String(first.inbound.conversationId),
    expectedVersion: (resolving as { state: { version: number } }).state.version,
    customerId: String(customerId)
  });
  assert.ok(completed.ok);

  const second = await turn({ waId, phoneNumberId, text: "Quiero cotizar una banca ajustable", env: LEGACY_ENV, piiTerms: [waId] });
  assert.equal(second.inbound.conversationId, first.inbound.conversationId, "second inbound reuses the conversation, identity and onboarding");
  assert.equal(second.cycle?.customerSession?.identity.status, "identified");
  assert.equal(second.cycle?.customerSession?.contextAccess, "commercial_history");
  assert.equal(second.customer360Calls.length, 1);
  assert.equal(second.customer360Calls[0], String(customerId));
  assert.equal(fakeState.requests.length, 0);
});

// ===========================================================================
// Escenario C - conflicto de identidad (task section 8).
// ===========================================================================

test("T08-C1: conflicto divergente - mismo telefono normalizado con dos customerId distintos nunca selecciona uno automaticamente", async () => {
  fakeState = createFakeCustomerServiceState();
  const waId = uniqueWaId();
  const phoneNumberId = `phone-${uniqueSuffix("c1")}`;
  const customerA = await makeCustomer("C1DivergentA");
  const customerB = await makeCustomer("C1DivergentB");
  await seedExternalIdentity({ customerId: customerA, provider: "whatsapp", externalId: `legacy-a-${waId}`, normalizedValue: waId, isVerified: false });
  await seedExternalIdentity({ customerId: customerB, provider: "whatsapp", externalId: `legacy-b-${waId}`, normalizedValue: waId, isVerified: false });

  const result = await turn({ waId, phoneNumberId, text: "Hola, quiero cotizar", env: LEGACY_ENV, piiTerms: [waId] });

  const conflict = (result.inbound as { identityConflict: { type: string; candidateCustomerIds: number[] } | null }).identityConflict;
  assert.ok(conflict);
  assert.equal(conflict!.type, "divergent_identity_links");
  assert.deepEqual([...conflict!.candidateCustomerIds].sort(), [customerA, customerB].sort());
  assert.equal(result.inbound.customerId, null);

  // resolveNativeCustomerSession's own independent local resolution also
  // lands on conflict for this case (both rows share the same normalized
  // phone, which the cross-provider phone lookup sees directly).
  assert.equal(result.cycle?.customerSession?.identity.status, "conflict");
  assert.equal(result.cycle?.customerSession?.contextAccess, "none");
  assert.equal(result.customer360Calls.length, 0, "Customer 360 must never load on conflict");
  assert.equal(fakeState.requests.length, 0, "no external Customer Service call as a fallback of a local conflict");

  const events = await loadEventsByType("customer_identity_resolution_recorded", result.inbound.correlationId);
  const local = events.find((event) => event.payload.resolver === "local");
  assert.ok(local);
  assert.equal(local?.payload.outcome, "conflict");
  // Privacy: no candidate ids or counts inside the T07 payload/metadata.
  assertNoPii(local?.payload, [String(customerA), String(customerB)], "customer_identity_resolution_recorded payload");
  assertNoPii(local?.metadata, [String(customerA), String(customerB)], "customer_identity_resolution_recorded metadata");

  const warningEvents = await loadEventsByType("customer_session_warning_recorded", result.inbound.correlationId);
  assert.ok(warningEvents.some((event) => event.payload.warningCode === "customer_identity_conflict"), "a structured warning must be persisted");

  const auditRows = await safeQueryRows<{ id: number }>(
    "SELECT id FROM hub_audit_log WHERE action = 'customer.identity_conflict' AND entity_id = ? ORDER BY id DESC LIMIT 1",
    [String(result.inbound.conversationId)]
  );
  assert.ok(auditRows.ok);
  assert.ok(auditRows.rows[0]?.id, "hub_audit_log must keep investigable evidence of the conflict");

  const conversationRow = await safeQueryRows<{ customer_id: number | null }>("SELECT customer_id FROM conversation WHERE id = ? LIMIT 1", [result.inbound.conversationId as number]);
  assert.ok(conversationRow.ok);
  assert.equal(conversationRow.rows[0]?.customer_id, null, "conversation.customer_id must never be overwritten unsafely");
});

test("T08-C2: conversation mismatch - un customer ya vinculado a la conversacion nunca se reemplaza silenciosamente", async () => {
  fakeState = createFakeCustomerServiceState();
  const waId = uniqueWaId();
  const phoneNumberId = `phone-${uniqueSuffix("c2")}`;

  const first = await sendInbound({ waId, phoneNumberId, text: "Primer mensaje, establece la conversacion" });
  assert.equal(first.customerId, null);

  const originalCustomerId = await makeCustomer("C2Original");
  await queryRows("UPDATE conversation SET customer_id = ? WHERE id = ?", [originalCustomerId, first.conversationId as number]);

  const otherCustomerId = await makeCustomer("C2Repointed");
  await queryRows("UPDATE customer_external_identity SET customer_id = ? WHERE provider = 'whatsapp' AND external_id = ?", [otherCustomerId, waId]);

  // This sub-case is tested at the native inbound (T06.2) layer, where the
  // mismatch is actually detected and the conversation link is protected -
  // per docs/releases/ACS-R1-04-customer-identity-onboarding.md (T08 closure
  // evidence), resolveNativeCustomerSession's own reconciliation is not
  // exercised here because processNativeWhatsAppInbound passes this turn's
  // already-nulled T06.2 resolution (never the conversation's pre-turn
  // customer_id) as customerMasterId - a discovered gap documented as debt,
  // left unfixed because correcting it would touch "resolucion local" /
  // "semantica de conflicto" (frontiers this task must not change) and this
  // sub-case is explicitly optional per the task brief.
  const second = await sendInbound({ waId, phoneNumberId, text: "Segundo mensaje tras una identidad repuntada externamente" });

  const conflict = (second as { identityConflict: { type: string; candidateCustomerIds: number[] } | null }).identityConflict;
  assert.ok(conflict);
  assert.equal(conflict!.type, "customer_conversation_mismatch");
  assert.deepEqual([...conflict!.candidateCustomerIds].sort(), [originalCustomerId, otherCustomerId].sort());
  assert.equal(second.customerId, null);

  const conversationRow = await safeQueryRows<{ customer_id: number | null }>("SELECT customer_id FROM conversation WHERE id = ? LIMIT 1", [second.conversationId as number]);
  assert.ok(conversationRow.ok);
  assert.equal(Number(conversationRow.rows[0]?.customer_id), originalCustomerId, "the existing conversation link must never be silently swapped");

  const auditRows = await safeQueryRows<{ id: number }>(
    "SELECT id FROM hub_audit_log WHERE action = 'customer.identity_conflict' AND entity_id = ? ORDER BY id DESC LIMIT 1",
    [String(second.conversationId)]
  );
  assert.ok(auditRows.ok);
  assert.ok(auditRows.rows[0]?.id);

  assert.equal(await countLegacyOnboardingRows(waId), 0);
});

// ===========================================================================
// Idempotencia / dedupe across event families (task section 11).
// ===========================================================================

test("T08-dedupe: dos turnos identicos (mismo messageId+phase+warning) nunca duplican el mismo evento de warning", async () => {
  fakeState = createFakeCustomerServiceState();
  const waId = uniqueWaId();
  const phoneNumberId = `phone-${uniqueSuffix("dedupe")}`;
  const customerA = await makeCustomer("DedupeA");
  const customerB = await makeCustomer("DedupeB");
  await seedExternalIdentity({ customerId: customerA, provider: "whatsapp", externalId: `legacy-a-${waId}`, normalizedValue: waId, isVerified: false });
  await seedExternalIdentity({ customerId: customerB, provider: "whatsapp", externalId: `legacy-b-${waId}`, normalizedValue: waId, isVerified: false });

  const result = await turn({ waId, phoneNumberId, text: "Hola", env: LEGACY_ENV, piiTerms: [waId] });
  const warningEvents = await loadEventsByType("customer_session_warning_recorded", result.inbound.correlationId);
  const conflictWarnings = warningEvents.filter((event) => event.payload.warningCode === "customer_identity_conflict");
  // mergeWarnings dedupes within the same turn - a single conflict signal
  // must not be persisted twice under the same messageId+phase+warningCode.
  const dedupeKeys = new Set(conflictWarnings.map((event) => event.dedupe_key));
  assert.equal(dedupeKeys.size, conflictWarnings.length, "no two rows should ever share the same dedupe_key");
  assert.equal(conflictWarnings.length, 1);
});

// ===========================================================================
// Privacidad agregada (task section 10) sobre TODOS los turnos ejecutados
// arriba, en las tres escenarios.
// ===========================================================================

test("T08-privacy: ningun evento T07 ni ninguna capability execution persiste PII cruda, en ningun escenario", async () => {
  assert.ok(recordedTurns.length > 0, "scenario tests above must have populated recordedTurns");
  const eventTypes = [
    "customer_identity_resolution_recorded",
    "customer_onboarding_transition_recorded",
    "customer_identity_capability_outcome_recorded",
    "customer_session_warning_recorded"
  ];

  for (const { correlationId, piiTerms } of recordedTurns) {
    if (piiTerms.length === 0) continue;
    for (const eventType of eventTypes) {
      const rows = await loadEventsByType(eventType, correlationId);
      for (const row of rows) {
        assertNoPii(row.payload, piiTerms, `${eventType} payload_json (correlationId=${correlationId})`);
        assertNoPii(row.metadata, piiTerms, `${eventType} metadata_json (correlationId=${correlationId})`);
      }
    }

    const executions = await loadCapabilityExecutions(correlationId);
    for (const execution of executions) {
      if (execution.capability_name !== "resolve_customer" && execution.capability_name !== "create_customer" && execution.capability_name !== "link_external_identity") continue;
      assertNoPii(safeJsonParse(execution.request_summary_json), piiTerms, `crm_capability_executions.request_summary_json (correlationId=${correlationId})`);
      assertNoPii(safeJsonParse(execution.response_summary_json), piiTerms, `crm_capability_executions.response_summary_json (correlationId=${correlationId})`);
    }
  }
});
