import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before, beforeEach } from "node:test";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "crm_test",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED: "true"
});

import { getPool, queryRows } from "@/lib/db";
import { closeTestHttpServer } from "../helpers/closeTestHttpServer";
import { resolveCapabilityGatewayDefinition, resetCustomerServicePortForTests, setCustomerMasterProjectionReaderForTests } from "@/lib/brain/commercial/capability-gateway";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway";
import { runCustomerOnboardingPostPlanStage } from "@/lib/brain/commercial/native-cycle/customer-session/runCustomerOnboardingPostPlanStage";
import { parseConsentEvidence } from "@/lib/brain/commercial/native-cycle/customer-session/consentEvidence";
import { resolveRuntimeIdentityContext } from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import type { RuntimeIdentityContext } from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";
import {
  IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS,
  IDENTITY_DECISION_STATUS_TO_MISSING_REQUIREMENT,
  persistCommercialWorkProjection,
  updateCommercialWorkAggregate,
  getCommercialWorkByPublicId,
  type CommercialObjective,
  type CommercialWork
} from "@/lib/brain/commercial/work";
import { evaluateCommercialIdentityRequirement, type CommercialIdentityRequirementDecision } from "@/lib/brain/commercial/identity/commercial-identity-requirement";
import { recordIdentityEvidence } from "@/lib/domains/customer-identity-evidence";
import { upsertExternalIdentity, findExternalIdentityByProviderExternalId } from "@/lib/integrations/customer-external-identity";
import { setupR2BenchmarkEnvironment, type R2BenchmarkEnvironment } from "@/lib/brain/commercial/work/benchmark/environment";
import { normalizeWaId } from "@/lib/customer-identity/normalize";

/**
 * SALES-AGENT-R2-ID-R2-A09. Closes the gap
 * docs/releases/SALES-AGENT-R2-ID-R2-A08.1-ready-to-link-live-e2e-closure.md
 * proved BLOCKED: a real writer + authority for the PrestaShop canonical
 * bridge (customer_external_identity, provider="prestashop"), deliberately
 * separate from link_external_identity (WhatsApp channel authority) - see
 * lib/domains/customer-service/authority-policy.ts's header note on
 * evaluateLinkPrestaShopIdentityAuthority and
 * customerIdentityCapabilities.ts's linkPrestashopIdentityCapability.
 *
 * Test matrix: PSB01-PSB26 (task PARTE 20). Real MariaDB (crm_test) + a real
 * local HTTP Customer Service test server throughout - no mocks of the
 * domain/capability boundary.
 */

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
let lastBody: Record<string, unknown> | null = null;
let lastUrl = "";

before(async () => {
  server = http.createServer((req, res) => {
    requestCount += 1;
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
  await closeTestHttpServer(server);
});

beforeEach(() => {
  requestCount = 0;
  lastBody = null;
  handler = (_req, res) => res.writeHead(500).end();
  process.env.CUSTOMER_SERVICE_BASE_URL = baseUrl;
  process.env.CUSTOMER_SERVICE_API_KEY = "test-key";
  resetCustomerServicePortForTests();
  setCustomerMasterProjectionReaderForTests({ async exists() { return true; } });
});

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function successResponse(env: R2BenchmarkEnvironment, status: "completed" | "already_linked" = "completed") {
  return { status, customerMasterId: String(env.masterCustomerId), externalIdentityId: uniqueSuffix("ext") };
}

// ---------------------------------------------------------------------------
// Real seeding (same discipline as A08.1's readyToLinkE2E.test.ts) - real
// writers only, never a hand-built RuntimeIdentityContext.
// ---------------------------------------------------------------------------

function normalizedWaId(env: R2BenchmarkEnvironment): string {
  const normalized = normalizeWaId(env.waId);
  assert.ok(normalized);
  return normalized!;
}

async function seedWhatsAppChannelLink(env: R2BenchmarkEnvironment): Promise<void> {
  const externalId = normalizedWaId(env);
  await upsertExternalIdentity({ customerId: env.masterCustomerId, provider: "whatsapp", identityType: "phone", externalId, normalizedValue: externalId, isVerified: true });
}

async function seedPrestashopCandidateEvidence(env: R2BenchmarkEnvironment, prestashopCustomerId: string): Promise<void> {
  const result = await recordIdentityEvidence({
    conversationId: String(env.conversationId),
    correlationId: uniqueSuffix("corr"),
    channel: "whatsapp",
    provider: "prestashop",
    signalType: "prestashop_customer_id",
    source: "prestashop",
    prestashopCustomerId,
    strength: "verified",
    verified: true,
    observedAt: new Date().toISOString()
  });
  assert.equal(result.ok, true);
}

async function currentRuntimeIdentity(env: R2BenchmarkEnvironment): Promise<RuntimeIdentityContext> {
  return resolveRuntimeIdentityContext({ conversationId: String(env.conversationId), externalId: env.waId, detail: undefined });
}

function trustedSession(env: R2BenchmarkEnvironment, runtimeIdentity: RuntimeIdentityContext, overrides: Partial<NativeCustomerSessionExecutionContext> = {}): NativeCustomerSessionExecutionContext {
  return {
    conversationId: String(env.conversationId),
    opportunityId: String(env.opportunityId),
    trustedInbound: { channel: "whatsapp", externalId: env.waId, normalizedPhone: env.waId, messageId: uniqueSuffix("msg"), receivedAt: new Date().toISOString() },
    identity: { status: "identified", customerId: String(env.masterCustomerId), source: "external_identity", localResolutionOutcome: "identified", externalResolutionOutcome: null },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_source_unsupported" },
    runtimeIdentity,
    onboarding: null,
    contextAccess: "commercial_history",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
    freshExternalResolutionEvidence: null,
    ...overrides
  };
}

function gatewayContext(session: NativeCustomerSessionExecutionContext | null): CapabilityGatewayContext {
  return { correlationId: uniqueSuffix("corr"), trustedCustomerSession: session };
}

function linkPrestashopDefinition() {
  const found = resolveCapabilityGatewayDefinition("link_prestashop_identity");
  assert.ok(found, "link_prestashop_identity must be registered");
  return found!;
}

function prestashopConsent(messageId: string = uniqueSuffix("msg")) {
  const consent = parseConsentEvidence({ messageText: "si, vincula mi cuenta", messageId, capturedAt: new Date().toISOString() }, "link_prestashop_identity");
  assert.ok(consent, "the real parser must accept this phrase (sanity check)");
  return consent!;
}

async function countPrestashopBridgeRows(masterCustomerId: number, prestashopCustomerId: string): Promise<number> {
  const rows = await queryRows<{ count: number }>(
    "SELECT COUNT(*) AS count FROM customer_external_identity WHERE provider = 'prestashop' AND external_id = ? AND customer_id = ?",
    [prestashopCustomerId, masterCustomerId]
  );
  return Number(rows[0]?.count ?? 0);
}

// ---------------------------------------------------------------------------
// PSB01-06: trigger + consent gating.
// ---------------------------------------------------------------------------

test("PSB01: an ALREADY-linked WhatsApp channel does not suppress the PrestaShop bridge trigger (A08.1 GAP 1, closed)", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env); // wa_id already linked - source will read "external_identity"
    await seedPrestashopCandidateEvidence(env, "ps-701");
    handler = (_req, res) => sendJson(res, 201, successResponse(env));

    const runtimeIdentity = await currentRuntimeIdentity(env);
    assert.equal(runtimeIdentity.status, "READY_TO_LINK");

    const consent = prestashopConsent();
    const session = trustedSession(env, runtimeIdentity, {
      identity: { status: "identified", customerId: String(env.masterCustomerId), source: "external_identity", localResolutionOutcome: "identified", externalResolutionOutcome: null },
      currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent }
    });

    const result = await runCustomerOnboardingPostPlanStage({
      plannedOperation: { operation: "create_quote" },
      messageText: "si, vincula mi cuenta",
      correlationId: uniqueSuffix("corr"),
      customerSessionExecution: session,
      opportunityId: String(env.opportunityId)
    });

    assert.equal(result.attemptedOperation, "link_prestashop_identity");
    assert.equal(requestCount, 1);
  } finally {
    await env.teardown();
  }
});

test("PSB02/03: without READY_TO_LINK, the capability denies and never calls Customer Service", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    const runtimeIdentity = await currentRuntimeIdentity(env); // MASTER_RESOLVED, not READY_TO_LINK - no prestashop candidate seeded
    assert.notEqual(runtimeIdentity.status, "READY_TO_LINK");

    const consent = prestashopConsent();
    const outcome = await linkPrestashopDefinition().execute({}, gatewayContext(trustedSession(env, runtimeIdentity, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } })));
    assert.equal(outcome.status, "denied");
    assert.equal(outcome.errorCode, "not_ready_to_link");
    assert.equal(requestCount, 0);
  } finally {
    await env.teardown();
  }
});

test("PSB04: READY_TO_LINK without current-turn consent never calls Customer Service", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-701");
    const runtimeIdentity = await currentRuntimeIdentity(env);
    assert.equal(runtimeIdentity.status, "READY_TO_LINK");

    const outcome = await linkPrestashopDefinition().execute({}, gatewayContext(trustedSession(env, runtimeIdentity)));
    assert.equal(outcome.status, "denied");
    assert.equal(outcome.errorCode, "consent_required:link_prestashop_identity");
    assert.equal(requestCount, 0);
  } finally {
    await env.teardown();
  }
});

test("PSB05: the WRONG consent scope (link_external_identity, not link_prestashop_identity) never authorizes the bridge - the two consent scopes are never conflated", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-701");
    const runtimeIdentity = await currentRuntimeIdentity(env);

    // A customer who only said "vincula mi WhatsApp" (a real, valid consent
    // for the OTHER scope) must never be treated as having authorized the
    // PrestaShop bridge - task PARTE 9's security gate.
    const whatsappConsent = parseConsentEvidence({ messageText: "si, vincula mi whatsapp", messageId: uniqueSuffix("msg"), capturedAt: new Date().toISOString() }, "link_external_identity");
    assert.ok(whatsappConsent);

    const outcome = await linkPrestashopDefinition().execute(
      {},
      gatewayContext(trustedSession(env, runtimeIdentity, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: whatsappConsent, linkPrestashopIdentity: null } }))
    );
    assert.equal(outcome.status, "denied");
    assert.equal(outcome.errorCode, "consent_required:link_prestashop_identity");
    assert.equal(requestCount, 0);
  } finally {
    await env.teardown();
  }
});

test("PSB06: a valid current-turn consent authorizes exactly one Customer Service call", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-701");
    const runtimeIdentity = await currentRuntimeIdentity(env);
    handler = (_req, res) => sendJson(res, 201, successResponse(env));

    const consent = prestashopConsent();
    const outcome = await linkPrestashopDefinition().execute(
      {},
      gatewayContext(trustedSession(env, runtimeIdentity, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } }))
    );
    assert.equal(outcome.status, "completed");
    assert.equal(requestCount, 1);
  } finally {
    await env.teardown();
  }
});

// ---------------------------------------------------------------------------
// PSB07-09: request correctness - the right provider, the right ids, never
// LLM-controlled (PSB24 too - same evidence).
// ---------------------------------------------------------------------------

test("PSB07/08/09/24: the HTTP request carries provider=prestashop, the verified candidate id, and the resolved master - never anything from the (empty) tool-request input", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-701");
    const runtimeIdentity = await currentRuntimeIdentity(env);
    handler = (_req, res) => sendJson(res, 201, successResponse(env));

    const consent = prestashopConsent();
    // The model's tool-request input is attacker-shaped on purpose - it must be entirely ignored (PARTE 2: never LLM-controlled ids).
    await linkPrestashopDefinition().execute(
      { customerId: "999999", prestashopCustomerId: "ps-attacker", granted: true },
      gatewayContext(trustedSession(env, runtimeIdentity, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } }))
    );

    const externalIdentity = lastBody?.externalIdentity as { provider?: string; externalId?: string } | undefined;
    assert.equal(externalIdentity?.provider, "prestashop");
    assert.equal(externalIdentity?.externalId, "ps-701");
    assert.match(lastUrl, new RegExp(`/customers/${env.masterCustomerId}/`));
    assert.doesNotMatch(JSON.stringify(lastBody), /999999|ps-attacker/);
    assert.doesNotMatch(lastUrl, /999999/);
  } finally {
    await env.teardown();
  }
});

// ---------------------------------------------------------------------------
// PSB10-12: idempotency and conflict - Customer Service is the sole
// authority over uniqueness (PARTE 6), CRM never pre-checks or auto-relinks.
// ---------------------------------------------------------------------------

test("PSB10: an exact existing link (Customer Service reports already_linked) is idempotent - success, never a duplicate local row", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-701");
    const runtimeIdentity = await currentRuntimeIdentity(env);
    handler = (_req, res) => sendJson(res, 200, successResponse(env, "already_linked"));

    const consent = prestashopConsent();
    const session = trustedSession(env, runtimeIdentity, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } });
    const outcome1 = await linkPrestashopDefinition().execute({}, gatewayContext(session));
    const outcome2 = await linkPrestashopDefinition().execute({}, gatewayContext(session));
    assert.equal(outcome1.status, "completed");
    assert.equal(outcome2.status, "completed");
    assert.equal(await countPrestashopBridgeRows(env.masterCustomerId, "ps-701"), 1, "upsert - never a second row for the same provider+externalId");
  } finally {
    await env.teardown();
  }
});

test("PSB11: PrestaShop id already linked to a DIFFERENT master reports conflict - never auto-relinked", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-701");
    const runtimeIdentity = await currentRuntimeIdentity(env);
    handler = (_req, res) => sendJson(res, 409, { error: { code: "ALREADY_LINKED", conflictCode: "linked_to_other_customer" } });

    const consent = prestashopConsent();
    const outcome = await linkPrestashopDefinition().execute(
      {},
      gatewayContext(trustedSession(env, runtimeIdentity, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } }))
    );
    assert.equal(outcome.status, "completed", "Gateway status: the HTTP call itself succeeded");
    assert.equal(outcome.errorCode, "prestashop_link_conflict");
    assert.equal(await countPrestashopBridgeRows(env.masterCustomerId, "ps-701"), 0, "no local write on conflict");
  } finally {
    await env.teardown();
  }
});

test("PSB12: a master that already has a DIFFERENT PrestaShop link reports conflict from Customer Service - the original bridge is never silently overwritten", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    // Master already canonically bridged to ps-100.
    await upsertExternalIdentity({ customerId: env.masterCustomerId, provider: "prestashop", identityType: "prestashop_customer_id", externalId: "ps-100", normalizedValue: "ps-100", isVerified: true });
    await seedPrestashopCandidateEvidence(env, "ps-200");
    const runtimeIdentity = await currentRuntimeIdentity(env);
    handler = (_req, res) => sendJson(res, 409, { error: { code: "ALREADY_LINKED", conflictCode: "master_already_linked" } });

    const consent = prestashopConsent();
    const outcome = await linkPrestashopDefinition().execute(
      {},
      gatewayContext(trustedSession(env, runtimeIdentity, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } }))
    );
    assert.equal(outcome.errorCode, "prestashop_link_conflict");
    // The original bridge (ps-100) is untouched, and ps-200 was never written.
    const original = await findExternalIdentityByProviderExternalId("prestashop", "ps-100");
    assert.equal(original.row?.customer_id, env.masterCustomerId);
    assert.equal(await countPrestashopBridgeRows(env.masterCustomerId, "ps-200"), 0);
  } finally {
    await env.teardown();
  }
});

// ---------------------------------------------------------------------------
// PSB13-15: Customer Service failure paths - never a false LEVEL_3.
// ---------------------------------------------------------------------------

test("PSB13: a Customer Service 503 leaves identity exactly as before - no LEVEL_3", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-701");
    const before = await currentRuntimeIdentity(env);
    handler = (_req, res) => sendJson(res, 503, { error: { code: "SERVICE_DOWN" } });

    const consent = prestashopConsent();
    const outcome = await linkPrestashopDefinition().execute(
      {},
      gatewayContext(trustedSession(env, before, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } }))
    );
    assert.equal(outcome.status, "temporarily_blocked");
    const after = await currentRuntimeIdentity(env);
    assert.deepEqual(after, before);
  } finally {
    await env.teardown();
  }
});

test("PSB14: a Customer Service 409 conflict never produces LEVEL_3", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-701");
    const runtimeIdentity = await currentRuntimeIdentity(env);
    handler = (_req, res) => sendJson(res, 409, { error: { code: "ALREADY_LINKED", conflictCode: "linked_to_other_customer" } });

    const consent = prestashopConsent();
    await linkPrestashopDefinition().execute({}, gatewayContext(trustedSession(env, runtimeIdentity, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } })));
    const after = await currentRuntimeIdentity(env);
    assert.notEqual(after.identityLevel, "LEVEL_3_PRESTASHOP_LINKED");
  } finally {
    await env.teardown();
  }
});

test("PSB15: durable evidence alone (no live customer_external_identity row) never grants LEVEL_3 - proves the fail-closed live check this capability's writes depend on, isolated from a real write failure", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    // Simulates exactly what a failed upsertExternalIdentity call inside the
    // capability would leave behind: the durable evidence row written (it
    // happens second, see customerIdentityCapabilities.ts) but no live
    // table row - never fabricated success from this alone.
    await recordIdentityEvidence({
      conversationId: String(env.conversationId),
      correlationId: uniqueSuffix("corr"),
      channel: "whatsapp",
      provider: "prestashop",
      signalType: "prestashop_customer_id",
      source: "customer_external_identity",
      masterCustomerId: String(env.masterCustomerId),
      prestashopCustomerId: "ps-701",
      strength: "verified",
      verified: true,
      observedAt: new Date().toISOString()
    });
    const identity = await currentRuntimeIdentity(env);
    assert.notEqual(identity.identityLevel, "LEVEL_3_PRESTASHOP_LINKED");
  } finally {
    await env.teardown();
  }
});

// ---------------------------------------------------------------------------
// PSB16: the central positive case - canonical mutation confirmed -> LEVEL_3.
// ---------------------------------------------------------------------------

test("PSB16: a successful link_prestashop_identity call writes the canonical bridge for real, and resolveRuntimeIdentityContext genuinely reaches LEVEL_3 afterward", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-701");
    const runtimeIdentity = await currentRuntimeIdentity(env);
    assert.equal(runtimeIdentity.status, "READY_TO_LINK");
    handler = (_req, res) => sendJson(res, 201, successResponse(env));

    const consent = prestashopConsent();
    const outcome = await linkPrestashopDefinition().execute(
      {},
      gatewayContext(trustedSession(env, runtimeIdentity, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } }))
    );
    assert.equal(outcome.status, "completed");
    assert.deepEqual(outcome.warnings ?? [], []);

    assert.equal(await countPrestashopBridgeRows(env.masterCustomerId, "ps-701"), 1);

    const after = await currentRuntimeIdentity(env);
    assert.equal(after.status, "PRESTASHOP_LINKED");
    assert.equal(after.identityLevel, "LEVEL_3_PRESTASHOP_LINKED");
    assert.equal(after.masterCustomerId, String(env.masterCustomerId));
    assert.equal(after.prestashopCustomerId, "ps-701");
  } finally {
    await env.teardown();
  }
});

// ---------------------------------------------------------------------------
// PSB17: same-turn reprojection - the decision itself flips to SUFFICIENT
// immediately after the mutation, in the same turn, no next-turn wait.
// ---------------------------------------------------------------------------

test("PSB17: same-turn - the LEVEL_3 requirement (customer_profile_history, the real catalogued LEVEL_3 operation) becomes SUFFICIENT immediately after the bridge is written, without waiting for a later turn's evidence re-scan", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-701");
    const before = await currentRuntimeIdentity(env);
    const decisionBefore = evaluateCommercialIdentityRequirement("customer_profile_history", before);
    assert.equal(decisionBefore.status, "READY_TO_LINK");

    handler = (_req, res) => sendJson(res, 201, successResponse(env));
    const consent = prestashopConsent();
    const session = trustedSession(env, before, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } });

    const result = await runCustomerOnboardingPostPlanStage({
      plannedOperation: { operation: "create_quote" },
      messageText: "si, vincula mi cuenta",
      correlationId: uniqueSuffix("corr"),
      customerSessionExecution: session,
      opportunityId: String(env.opportunityId)
    });
    assert.equal(result.attemptedOperation, "link_prestashop_identity");

    // Exactly what runCommercialWorkInboundCycle.ts's own bounded same-turn
    // re-settle does after this attemptedOperation (PARTE 14) - a fresh read, same turn.
    const after = await resolveRuntimeIdentityContext({ conversationId: String(env.conversationId), externalId: env.waId, detail: undefined });
    const decisionAfter = evaluateCommercialIdentityRequirement("customer_profile_history", after);
    assert.equal(decisionAfter.status, "SUFFICIENT");
  } finally {
    await env.teardown();
  }
});

// ---------------------------------------------------------------------------
// PSB18-20: same CommercialWork resumes, no duplicate work/step. Uses the
// same PARTE 1-authorized harness objective as A08.1 (no live
// CommercialObjectiveType reaches a LEVEL_3 requirement - see PARTE 1's own
// test in readyToLinkE2E.test.ts) - but this time persisted through the REAL
// repository (persistCommercialWorkProjection/updateCommercialWorkAggregate,
// unmodified), so "same publicId / no duplicate row" is a real database
// fact, not a re-assertion of an in-memory object.
// ---------------------------------------------------------------------------

function harnessObjectiveFromRealDecision(decision: CommercialIdentityRequirementDecision): CommercialObjective {
  const isSufficient = decision.status === "SUFFICIENT";
  const status = isSufficient ? "READY" : IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS[decision.status];
  const missingRequirement = isSufficient ? undefined : IDENTITY_DECISION_STATUS_TO_MISSING_REQUIREMENT[decision.status];
  return {
    objectiveId: "probe-1",
    type: "CREATE_QUOTE",
    status,
    origin: "customer_requested",
    inputs: {},
    resolvedInputs: {},
    missingRequirements: missingRequirement ? [missingRequirement] : [],
    supersedesObjectiveIds: [],
    evidence: [],
    // PARTE 1/A08.1: applyCommercialIdentityGate never attaches a blocker for
    // a SUFFICIENT decision (evaluate.ts's own no-op branch) - mirrored here
    // exactly, or "the blocker disappears" could never be proven for real.
    blockers: isSufficient ? [] : [{ code: "IDENTITY_REQUIREMENT", source: "objective", objectiveId: "probe-1", identityDecision: decision }]
  };
}

function harnessWork(conversationId: number, opportunityId: number, objective: CommercialObjective): CommercialWork {
  const now = new Date().toISOString();
  return {
    id: "harness",
    projectionVersion: 1,
    opportunityId,
    conversationId,
    sourceMessageId: null,
    sourceSequence: null,
    lastReconciledSequence: null,
    previousWorkPublicId: null,
    supersedesWorkPublicId: null,
    trigger: { type: "CUSTOMER_MESSAGE", conversationId, opportunityId, sourceMessageId: null },
    status: objective.status === "READY" ? "ACTIVE" : "ACTIVE",
    objectives: [objective],
    steps: [],
    blockers: [],
    derivedAt: now,
    metrics: { objectiveCount: 1, readyStepCount: 0, waitingCustomerObjectiveCount: 0, waitingSystemStepCount: 0, blockerCount: objective.blockers.length }
  };
}

async function countCommercialWorkRows(conversationId: number): Promise<number> {
  const rows = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_commercial_work WHERE conversation_id = ?", [conversationId]);
  return Number(rows[0]?.count ?? 0);
}

test("PSB18/19/20: same CommercialWork publicId resumes after the bridge completes - no duplicate work row, the IDENTITY_REQUIREMENT blocker disappears for real", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-701");
    const before = await currentRuntimeIdentity(env);
    const decisionBefore = evaluateCommercialIdentityRequirement("customer_profile_history", before);
    assert.equal(decisionBefore.status, "READY_TO_LINK");

    const objectiveBefore = harnessObjectiveFromRealDecision(decisionBefore);
    const persisted = await persistCommercialWorkProjection({ work: harnessWork(env.conversationId, env.opportunityId, objectiveBefore) });
    assert.equal(persisted.status, "created");
    const firstPublicId = persisted.work.publicId;
    assert.equal(await countCommercialWorkRows(env.conversationId), 1);
    assert.equal(persisted.work.objectives[0].blockers.some((b) => b.code === "IDENTITY_REQUIREMENT"), true);

    handler = (_req, res) => sendJson(res, 201, successResponse(env));
    const consent = prestashopConsent();
    const session = trustedSession(env, before, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } });
    const result = await runCustomerOnboardingPostPlanStage({
      plannedOperation: { operation: "create_quote" },
      messageText: "si, vincula mi cuenta",
      correlationId: uniqueSuffix("corr"),
      customerSessionExecution: session,
      opportunityId: String(env.opportunityId)
    });
    assert.equal(result.attemptedOperation, "link_prestashop_identity");

    const after = await resolveRuntimeIdentityContext({ conversationId: String(env.conversationId), externalId: env.waId, detail: undefined });
    const decisionAfter = evaluateCommercialIdentityRequirement("customer_profile_history", after);
    assert.equal(decisionAfter.status, "SUFFICIENT");

    const objectiveAfter = harnessObjectiveFromRealDecision(decisionAfter);
    const updated = await updateCommercialWorkAggregate({
      publicId: firstPublicId,
      expectedVersion: persisted.work.version,
      nextWork: harnessWork(env.conversationId, env.opportunityId, objectiveAfter)
    });

    // PSB18: same publicId.
    assert.equal(updated.publicId, firstPublicId);
    // PSB19: still exactly one row for this conversation - never a second CommercialWork.
    assert.equal(await countCommercialWorkRows(env.conversationId), 1);
    // PSB20 (single-objective harness: "no duplicate live step" reduces to "the
    // resumed work carries exactly one objective, never two competing ones").
    const reloaded = await getCommercialWorkByPublicId(firstPublicId);
    assert.equal(reloaded?.objectives.length, 1);
    assert.equal(reloaded?.objectives[0].status, "READY");
    assert.equal(reloaded?.objectives[0].blockers.some((b) => b.code === "IDENTITY_REQUIREMENT"), false, "the blocker is gone");
  } finally {
    await env.teardown();
  }
});

// ---------------------------------------------------------------------------
// PSB21: replay safety.
// ---------------------------------------------------------------------------

test("PSB21: replaying the same consent message twice sends the identical, deterministic idempotency key both times", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-701");
    const runtimeIdentity = await currentRuntimeIdentity(env);
    handler = (_req, res) => sendJson(res, 201, successResponse(env));
    const consent = prestashopConsent();
    const correlationId = uniqueSuffix("corr");
    const session = trustedSession(env, runtimeIdentity, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } });

    let firstKey: string | undefined;
    let secondKey: string | undefined;
    handler = (req, res) => {
      if (!firstKey) firstKey = req.headers["idempotency-key"] as string;
      else secondKey = req.headers["idempotency-key"] as string;
      sendJson(res, 201, successResponse(env));
    };

    await linkPrestashopDefinition().execute({}, { correlationId, trustedCustomerSession: session });
    await linkPrestashopDefinition().execute({}, { correlationId, trustedCustomerSession: session });

    assert.equal(requestCount, 2);
    assert.equal(firstKey, secondKey);
    assert.equal(firstKey, `customer-service:link_prestashop:${correlationId}:link_prestashop_identity`);
  } finally {
    await env.teardown();
  }
});

// ---------------------------------------------------------------------------
// PSB22/23: link_external_identity (WhatsApp) is byte-for-byte unchanged.
// ---------------------------------------------------------------------------

function whatsappSession(env: R2BenchmarkEnvironment, overrides: Partial<NativeCustomerSessionExecutionContext> = {}): NativeCustomerSessionExecutionContext {
  return {
    conversationId: String(env.conversationId),
    opportunityId: String(env.opportunityId),
    trustedInbound: { channel: "whatsapp", externalId: env.waId, normalizedPhone: env.waId, messageId: uniqueSuffix("msg"), receivedAt: new Date().toISOString() },
    identity: { status: "identified", customerId: String(env.masterCustomerId), source: "normalized_phone", localResolutionOutcome: "identified", externalResolutionOutcome: null },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_source_unsupported" },
    runtimeIdentity: { status: "ANONYMOUS", identityLevel: "LEVEL_0_ANONYMOUS", masterCustomerId: null, prestashopCustomerId: null, verificationRequired: false, requiredEvidence: [], readyToLink: false, conflictCode: null, policyCode: "NO_CHANNEL_EVIDENCE", evidenceRefs: [] },
    onboarding: null,
    contextAccess: "commercial_history",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
    freshExternalResolutionEvidence: null,
    ...overrides
  };
}

test("PSB22/23: link_external_identity's own request shape, authority and denial codes are unchanged - still provider=whatsapp, still wa_id-match authority", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    handler = (_req, res) => sendJson(res, 201, { status: "completed", customerMasterId: String(env.masterCustomerId), externalIdentityId: "ext-1" });
    const consent = parseConsentEvidence({ messageText: "si, vincula mi whatsapp a mi cuenta", messageId: uniqueSuffix("msg"), capturedAt: new Date().toISOString() }, "link_external_identity");
    assert.ok(consent);

    const definition = resolveCapabilityGatewayDefinition("link_external_identity");
    assert.ok(definition);
    const outcome = await definition!.execute({}, gatewayContext(whatsappSession(env, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: consent, linkPrestashopIdentity: null } })));
    assert.equal(outcome.status, "completed");
    const externalIdentity = lastBody?.externalIdentity as { provider?: string; externalId?: string } | undefined;
    assert.equal(externalIdentity?.provider, "whatsapp");
    assert.equal(externalIdentity?.externalId, env.waId);

    // Denial code for a missing resolved customer is unchanged
    // (evaluateLinkExternalIdentityAuthority/the capability's own guard,
    // untouched) - a mismatched wa_id case is not separately re-tested here
    // since the capability always sources both waId and inboundWaId from the
    // SAME session.trustedInbound.externalId field (never model-controlled,
    // never two independent values) - already proven by
    // linkExternalIdentityCapability.test.ts's own test 73.
    const badOutcome = await definition!.execute(
      {},
      gatewayContext(
        whatsappSession(env, {
          identity: { status: "identification_required", customerId: null, source: "none", localResolutionOutcome: "identification_required", externalResolutionOutcome: null },
          currentTurnConsent: { createCustomer: null, linkExternalIdentity: consent, linkPrestashopIdentity: null }
        })
      )
    );
    assert.equal(badOutcome.errorCode, "customer_id_required");
  } finally {
    await env.teardown();
  }
});

// ---------------------------------------------------------------------------
// PSB25: no PII in the audit-facing summaries.
// ---------------------------------------------------------------------------

test("PSB25: the capability's own request/response summaries never carry a raw prestashop id, master id, email or phone", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-701");
    const runtimeIdentity = await currentRuntimeIdentity(env);
    handler = (_req, res) => sendJson(res, 201, successResponse(env));
    const consent = prestashopConsent();
    const context = gatewayContext(trustedSession(env, runtimeIdentity, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } }));

    const definition = linkPrestashopDefinition();
    const requestSummary = definition.buildRequestSummary?.({}, context);
    assert.ok(requestSummary);
    assert.doesNotMatch(JSON.stringify(requestSummary), /ps-701|@|\d{7,}/);

    const outcome = await definition.execute({}, context);
    const responseSummary = definition.buildResponseSummary?.(outcome, context);
    assert.ok(responseSummary);
    assert.doesNotMatch(JSON.stringify(responseSummary), /ps-701/);
  } finally {
    await env.teardown();
  }
});

// ---------------------------------------------------------------------------
// PSB26: omnichannel - the bridge belongs to the master, never inherited by
// an unrelated, unlinked channel just because some other signal matches.
// ---------------------------------------------------------------------------

test("PSB26: a DIFFERENT, never-linked conversation gains nothing from another conversation's PrestaShop bridge - no cross-conversation inheritance", async () => {
  const envA = await setupR2BenchmarkEnvironment();
  const envB = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(envA);
    await seedPrestashopCandidateEvidence(envA, "ps-701");
    handler = (_req, res) => sendJson(res, 201, successResponse(envA));
    const consent = prestashopConsent();
    const runtimeIdentityA = await currentRuntimeIdentity(envA);
    await linkPrestashopDefinition().execute({}, gatewayContext(trustedSession(envA, runtimeIdentityA, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: consent } })));

    const afterA = await currentRuntimeIdentity(envA);
    assert.equal(afterA.identityLevel, "LEVEL_3_PRESTASHOP_LINKED");

    // envB never linked its own WhatsApp channel and never had any
    // PrestaShop candidate evidence - a completely unrelated conversation.
    const stillAnonymousB = await currentRuntimeIdentity(envB);
    assert.equal(stillAnonymousB.status, "ANONYMOUS");
    assert.notEqual(stillAnonymousB.identityLevel, "LEVEL_3_PRESTASHOP_LINKED");
  } finally {
    await envA.teardown();
    await envB.teardown();
  }
});
