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

import { getPool } from "@/lib/db";
import { closeTestHttpServer } from "../helpers/closeTestHttpServer";
import { resolveCapabilityGatewayDefinition, resetCustomerServicePortForTests, setCustomerMasterProjectionReaderForTests } from "@/lib/brain/commercial/capability-gateway";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway";
import { runCustomerOnboardingPostPlanStage } from "@/lib/brain/commercial/native-cycle/customer-session/runCustomerOnboardingPostPlanStage";
import { parseConsentEvidence } from "@/lib/brain/commercial/native-cycle/customer-session/consentEvidence";
import { resolveRuntimeIdentityContext } from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import type { RuntimeIdentityContext } from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";
import {
  buildCommercialWorkFinalizerMessage,
  IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS,
  IDENTITY_DECISION_STATUS_TO_MISSING_REQUIREMENT,
  type CommercialObjective
} from "@/lib/brain/commercial/work";
import type { PersistedCommercialWork } from "@/lib/brain/commercial/work/persistenceTypes";
import { evaluateCommercialIdentityRequirement, type CommercialIdentityRequirementDecision } from "@/lib/brain/commercial/identity/commercial-identity-requirement";
import { recordIdentityEvidence } from "@/lib/domains/customer-identity-evidence";
import { upsertExternalIdentity } from "@/lib/integrations/customer-external-identity";
import { setupR2BenchmarkEnvironment, type R2BenchmarkEnvironment } from "@/lib/brain/commercial/work/benchmark/environment";
import { normalizeWaId } from "@/lib/customer-identity/normalize";

/**
 * SALES-AGENT-R2-ID-R2-A08.1. READY_TO_LINK live E2E closure attempt.
 *
 * ROOT CAUSE FOUND (documented in full in the release doc, PARTE "Bugs
 * encontrados"): `link_external_identity` (the capability
 * findIdentityOnboardingTrigger/runCustomerOnboardingPostPlanStage's step 4
 * calls when it fires) and its authority (`evaluateLinkExternalIdentityAuthority`,
 * ACS-R1-04) are hard-scoped to bridging the CURRENT WHATSAPP CHANNEL to a
 * resolved master (`externalIdentity.provider` is hardcoded "whatsapp" in
 * customerIdentityCapabilities.ts; the authority denies unless
 * `waId === inboundWaId`, i.e. a PrestaShop customer id can never pass that
 * check). A04/A06's READY_TO_LINK status (evaluate.ts) is about a COMPLETELY
 * DIFFERENT bridge: a `customer_external_identity` row with
 * `provider = "prestashop"`. No writer for that row exists anywhere in this
 * codebase (grepped: the only production caller of `upsertExternalIdentity`
 * is native-whatsapp/service.ts, whatsapp-provider only) - it is exactly
 * ID-R2-A07's own "Next slice" recommendation, `ID-R2-A09 - PrestaShop
 * Identity Bridge`, which has not been built yet.
 *
 * This is not a small bug fixable within this task's "minimal fix" policy
 * (PARTE 11) without building A09's actual deliverable - so this suite
 * proves every part of the chain that DOES work for real (READY_TO_LINK
 * reached via real A04/A05/A06 computation over real seeded evidence, A08's
 * real consent wording, the real consent parser, the real
 * link_external_identity Capability Gateway call against a real HTTP test
 * server, real negative paths), and then PROVES - rather than assumes - the
 * exact point where the chain cannot close: calling link_external_identity
 * with full valid consent never produces a PrestaShop bridge, and
 * RuntimeIdentityContext genuinely never reaches LEVEL_3 through it. Group F
 * additionally proves, in isolation, that A04/A05's OWN live-LEVEL_3 check
 * is correct once such a bridge exists - so the gap is precisely located in
 * "no writer exists", not in the verification policy itself.
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
  await closeTestHttpServer(server);
});

beforeEach(() => {
  requestCount = 0;
  lastBody = null;
  lastHeaders = {};
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

// ---------------------------------------------------------------------------
// Realistic scenario seeding (PARTE 2). Real writers only:
// - upsertExternalIdentity (the same repository function production uses for
//   the whatsapp channel link) for the base LEVEL_2 (wa_id already linked).
// - recordIdentityEvidence (the same function A02's resolver calls every
//   turn) for the PrestaShop-track weak/verified candidate.
// Never a hand-built RuntimeIdentityContext - resolveRuntimeIdentityContext
// (real, A04/A05) is always what actually computes the decision.
// ---------------------------------------------------------------------------

/**
 * resolveRuntimeIdentityContext (A05) always looks up
 * customer_external_identity by normalizeWaId(externalId), never the raw
 * inbound value - the benchmark harness's synthetic waId ("wa-<ts>-<hex>")
 * is not phone-shaped, so it must be seeded under the SAME normalized form
 * production/A05 will actually query, or the lookup silently misses.
 */
function normalizedWaId(env: R2BenchmarkEnvironment): string {
  const normalized = normalizeWaId(env.waId);
  assert.ok(normalized, "the benchmark waId must normalize to a non-null value");
  return normalized!;
}

async function seedWhatsAppChannelLink(env: R2BenchmarkEnvironment): Promise<void> {
  const externalId = normalizedWaId(env);
  await upsertExternalIdentity({ customerId: env.masterCustomerId, provider: "whatsapp", identityType: "phone", externalId, normalizedValue: externalId, isVerified: true });
}

async function seedPrestashopCandidateEvidence(env: R2BenchmarkEnvironment, prestashopCustomerId: string, strength: "candidate" | "verified" = "verified"): Promise<void> {
  const result = await recordIdentityEvidence({
    conversationId: String(env.conversationId),
    correlationId: uniqueSuffix("corr"),
    channel: "whatsapp",
    provider: "prestashop",
    signalType: "prestashop_customer_id",
    source: "prestashop",
    prestashopCustomerId,
    strength,
    verified: strength === "verified",
    observedAt: new Date().toISOString()
  });
  assert.equal(result.ok, true, `seeding prestashop candidate evidence must succeed: ${result.ok ? "" : result.error}`);
}

/** The canonical bridge a future PrestaShop Identity Bridge writer (A09) would produce - used ONLY in Group F, isolated from the capability under test. */
async function seedCanonicalPrestashopBridge(env: R2BenchmarkEnvironment, prestashopCustomerId: string): Promise<void> {
  await upsertExternalIdentity({ customerId: env.masterCustomerId, provider: "prestashop", identityType: "prestashop_customer_id", externalId: prestashopCustomerId, normalizedValue: prestashopCustomerId, isVerified: true });
  const result = await recordIdentityEvidence({
    conversationId: String(env.conversationId),
    correlationId: uniqueSuffix("corr"),
    channel: "whatsapp",
    provider: "prestashop",
    signalType: "prestashop_customer_id",
    source: "customer_external_identity",
    masterCustomerId: String(env.masterCustomerId),
    prestashopCustomerId,
    strength: "verified",
    verified: true,
    observedAt: new Date().toISOString()
  });
  assert.equal(result.ok, true, `seeding the canonical bridge evidence must succeed: ${result.ok ? "" : result.error}`);
}

async function currentRuntimeIdentity(env: R2BenchmarkEnvironment): Promise<RuntimeIdentityContext> {
  return resolveRuntimeIdentityContext({ conversationId: String(env.conversationId), externalId: env.waId, detail: undefined });
}

// ---------------------------------------------------------------------------
// PARTE 1: at the time this suite was written, no live CommercialObjectiveType
// reaches a LEVEL_3 requirement - the guardrail below confirms that premise,
// so this file's own harness (below) documents itself honestly as a probe,
// not organic coverage.
// ---------------------------------------------------------------------------

test("PARTE 1: no live CommercialObjectiveType reaches a LEVEL_3 requirement today - customer_profile_history has no real caller yet", async () => {
  const gate = await import("@/lib/brain/commercial/work/commercialIdentityGate");
  const mappedOperations = new Set(Object.values(gate.COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION));
  assert.equal(mappedOperations.has("customer_profile_history"), false);
});

/** An independent, lower-level probe: a real A06 decision, computed for the real "customer_profile_history" (LEVEL_3) operation, carried by a CREATE_QUOTE-labeled probe objective, through A07's real, unmodified status/missingRequirement mapping tables (imported, never re-derived). */
function harnessObjectiveFromRealDecision(decision: CommercialIdentityRequirementDecision): CommercialObjective {
  const status = decision.status === "SUFFICIENT" ? "READY" : IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS[decision.status];
  const missingRequirement = decision.status === "SUFFICIENT" ? undefined : IDENTITY_DECISION_STATUS_TO_MISSING_REQUIREMENT[decision.status];
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
    blockers: [{ code: "IDENTITY_REQUIREMENT", source: "objective", objectiveId: "probe-1", identityDecision: decision }]
  };
}

function workFromObjectives(objectives: CommercialObjective[], status: PersistedCommercialWork["status"]): PersistedCommercialWork {
  const now = new Date().toISOString();
  return {
    id: "work-1",
    projectionVersion: 1,
    opportunityId: null,
    conversationId: 1,
    sourceMessageId: null,
    sourceSequence: null,
    lastReconciledSequence: null,
    previousWorkPublicId: null,
    supersedesWorkPublicId: null,
    trigger: { type: "CUSTOMER_MESSAGE", conversationId: 1, opportunityId: null, sourceMessageId: null },
    status,
    objectives,
    steps: [],
    blockers: [],
    derivedAt: now,
    metrics: { objectiveCount: objectives.length, readyStepCount: 0, waitingCustomerObjectiveCount: 0, waitingSystemStepCount: 0, blockerCount: 0 },
    publicId: "work-1",
    correlationKey: "corr-1",
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null
  };
}

// ===========================================================================
// GROUP A - RTL01: real READY_TO_LINK, reached via real seeded evidence and
// real A04/A05/A06 computation, produces A08's real consent wording.
// ===========================================================================

test("RTL01: real seeded evidence -> real resolveRuntimeIdentityContext (A05) -> READY_TO_LINK -> real evaluateCommercialIdentityRequirement (A06, customer_profile_history/LEVEL_3) -> real A08 consent wording", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-501");

    const runtimeIdentity = await currentRuntimeIdentity(env);
    assert.equal(runtimeIdentity.status, "READY_TO_LINK");
    assert.equal(runtimeIdentity.identityLevel, "LEVEL_2_MASTER_RESOLVED");
    assert.equal(runtimeIdentity.masterCustomerId, String(env.masterCustomerId));
    assert.equal(runtimeIdentity.prestashopCustomerId, "ps-501");

    const decision = evaluateCommercialIdentityRequirement("customer_profile_history", runtimeIdentity);
    assert.equal(decision.status, "READY_TO_LINK");

    const objective = harnessObjectiveFromRealDecision(decision);
    assert.equal(objective.status, "BLOCKED");
    assert.equal(objective.missingRequirements[0], "IDENTITY_LINK_PENDING");

    const work = workFromObjectives([objective], "ACTIVE");
    const result = buildCommercialWorkFinalizerMessage(work, null);
    assert.equal(result.disposition, "BLOCKED");
    assert.match(result.message, /vinculemos a tu perfil/);
    // PARTE 20/24: no candidate id, no master id, no level literal ever reaches the message.
    assert.doesNotMatch(result.message, /ps-501|LEVEL_|501/);
  } finally {
    await env.teardown();
  }
});

// ===========================================================================
// GROUP B - RTL02/03/04/05: consent gating over the real parser and the real
// Capability Gateway definition (never mocking the parser's own result).
// ===========================================================================

function trustedSession(env: R2BenchmarkEnvironment, overrides: Partial<NativeCustomerSessionExecutionContext> = {}): NativeCustomerSessionExecutionContext {
  return {
    conversationId: String(env.conversationId),
    opportunityId: String(env.opportunityId),
    trustedInbound: { channel: "whatsapp", externalId: env.waId, normalizedPhone: env.waId, messageId: uniqueSuffix("msg"), receivedAt: new Date().toISOString() },
    identity: { status: "identified", customerId: String(env.masterCustomerId), source: "normalized_phone", localResolutionOutcome: "identified", externalResolutionOutcome: null },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_source_unsupported" },
    runtimeIdentity: { status: "READY_TO_LINK", identityLevel: "LEVEL_2_MASTER_RESOLVED", masterCustomerId: String(env.masterCustomerId), prestashopCustomerId: "ps-501", verificationRequired: false, requiredEvidence: [], readyToLink: true, conflictCode: null, policyCode: "IDENTITY_READY_TO_LINK", evidenceRefs: [] },
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

function linkDefinition() {
  const found = resolveCapabilityGatewayDefinition("link_external_identity");
  assert.ok(found, "link_external_identity must be registered");
  return found!;
}

test("RTL02: READY_TO_LINK scenario with no consent this turn never calls Customer Service", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    const outcome = await linkDefinition().execute({}, gatewayContext(trustedSession(env)));
    assert.equal(outcome.status, "denied");
    assert.equal(outcome.errorCode, "consent_required:link_external_identity");
    assert.equal(requestCount, 0);
  } finally {
    await env.teardown();
  }
});

test("RTL03: parseConsentEvidence is stateless across turns - a prior message's consent can never leak into a later, unrelated message's result", () => {
  const capturedAt1 = "2026-08-20T10:00:00.000Z";
  const turn1 = parseConsentEvidence({ messageText: "si, vincula este whatsapp a mi cuenta", messageId: "wamid.turn1", capturedAt: capturedAt1 }, "link_external_identity");
  assert.ok(turn1, "turn 1 itself must parse as valid consent (sanity check on the fixture)");

  // A later, unrelated message (no consent language at all) must parse to
  // null regardless of what a PRIOR call to this same pure function returned
  // - there is no cross-call memory to leak from.
  const turn2 = parseConsentEvidence({ messageText: "cuanto cuesta el envio a providencia", messageId: "wamid.turn2", capturedAt: "2026-08-20T10:05:00.000Z" }, "link_external_identity");
  assert.equal(turn2, null);
});

test("RTL04: an explicit negative reply never authorizes the link, Customer Service never called", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    const consent = parseConsentEvidence({ messageText: "no, no quiero vincular mi whatsapp a esa cuenta", messageId: "wamid.1", capturedAt: new Date().toISOString() }, "link_external_identity");
    assert.equal(consent, null, "the real parser must reject an explicit negation (sanity check)");

    const outcome = await linkDefinition().execute({}, gatewayContext(trustedSession(env, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: consent, linkPrestashopIdentity: null } })));
    assert.equal(outcome.status, "denied");
    assert.equal(requestCount, 0);
  } finally {
    await env.teardown();
  }
});

test("RTL05: a real, current-turn affirmative consent phrase parses and authorizes exactly one Customer Service call", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    handler = (_req, res) => sendJson(res, 201, { status: "completed", customerMasterId: String(env.masterCustomerId), externalIdentityId: "ext-1" });
    const messageId = uniqueSuffix("msg");
    const consent = parseConsentEvidence({ messageText: "si, autorizo vincular este whatsapp a mi cuenta", messageId, capturedAt: new Date().toISOString() }, "link_external_identity");
    assert.ok(consent, "the real parser must accept this explicit, action-verb+target-noun phrase (sanity check)");
    assert.equal(consent!.messageId, messageId);

    const outcome = await linkDefinition().execute({}, gatewayContext(trustedSession(env, { currentTurnConsent: { createCustomer: null, linkExternalIdentity: consent, linkPrestashopIdentity: null } })));
    assert.equal(outcome.status, "completed");
    assert.equal(requestCount, 1);
  } finally {
    await env.teardown();
  }
});

// ===========================================================================
// GROUP C - the structural gap, proven rather than assumed (RTL06/RTL07 as
// negative findings, not faked successes - PARTE 5/11).
// ===========================================================================

test("GAP 1: when the wa_id is ALREADY canonically linked (source=external_identity), runCustomerOnboardingPostPlanStage's step 4 never even attempts link_external_identity, regardless of READY_TO_LINK/consent", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env); // wa_id already linked -> local resolver would report source="external_identity"
    await seedPrestashopCandidateEvidence(env, "ps-501");
    const runtimeIdentity = await currentRuntimeIdentity(env);
    assert.equal(runtimeIdentity.status, "READY_TO_LINK");

    const messageId = uniqueSuffix("msg");
    const consent = parseConsentEvidence({ messageText: "si, autorizo vincular este whatsapp a mi cuenta", messageId, capturedAt: new Date().toISOString() }, "link_external_identity");
    assert.ok(consent);

    const session = trustedSession(env, {
      identity: { status: "identified", customerId: String(env.masterCustomerId), source: "external_identity", localResolutionOutcome: "identified", externalResolutionOutcome: null },
      runtimeIdentity,
      currentTurnConsent: { createCustomer: null, linkExternalIdentity: consent, linkPrestashopIdentity: null }
    });

    const result = await runCustomerOnboardingPostPlanStage({
      plannedOperation: { operation: "create_quote" },
      messageText: "si, autorizo vincular este whatsapp a mi cuenta",
      correlationId: uniqueSuffix("corr"),
      customerSessionExecution: session,
      opportunityId: String(env.opportunityId)
    });

    assert.equal(result.attemptedOperation, "none", "step 4's own guard (source !== external_identity) never fires here - the consent goes nowhere");
    assert.equal(requestCount, 0);

    const after = await currentRuntimeIdentity(env);
    assert.equal(after.status, "READY_TO_LINK", "identity is exactly as before - fail closed, never a false LEVEL_3");
  } finally {
    await env.teardown();
  }
});

test("GAP 2: when the wa_id is NOT yet linked (source=normalized_phone), step 4 DOES call link_external_identity, but it links provider=whatsapp - the PrestaShop bridge READY_TO_LINK actually needs is never written, so identity never reaches LEVEL_3", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    // Real base LEVEL_2 seeded the same way as GAP 1 (Case A, computeBaseLevel)
    // so resolveRuntimeIdentityContext genuinely reaches READY_TO_LINK below -
    // A02's real PHONE-convergence path (Case B, the other way to reach
    // LEVEL_2) lives in a separate domain (lib/domains/customer-identity/service.ts)
    // A07's own suite already covers; this test only needs THIS turn's local
    // session.identity.source to plausibly read "normalized_phone" (a real,
    // reachable value per resolveNativeCustomerSession.ts's own mapping) to
    // isolate step 4's branch on that field - set directly here rather than
    // re-deriving it from a second real resolver call.
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-501");

    handler = (_req, res) => sendJson(res, 201, { status: "completed", customerMasterId: String(env.masterCustomerId), externalIdentityId: "ext-1" });
    const messageId = uniqueSuffix("msg");
    const consent = parseConsentEvidence({ messageText: "si, autorizo vincular este whatsapp a mi cuenta", messageId, capturedAt: new Date().toISOString() }, "link_external_identity");
    assert.ok(consent);

    const session = trustedSession(env, {
      identity: { status: "identified", customerId: String(env.masterCustomerId), source: "normalized_phone", localResolutionOutcome: "identified", externalResolutionOutcome: null },
      currentTurnConsent: { createCustomer: null, linkExternalIdentity: consent, linkPrestashopIdentity: null }
    });

    const result = await runCustomerOnboardingPostPlanStage({
      plannedOperation: { operation: "create_quote" },
      messageText: "si, autorizo vincular este whatsapp a mi cuenta",
      correlationId: uniqueSuffix("corr"),
      customerSessionExecution: session,
      opportunityId: String(env.opportunityId)
    });

    assert.equal(result.attemptedOperation, "link_external_identity", "step 4's guard DOES fire this time");
    assert.equal(requestCount, 1, "Customer Service was really called");
    const externalIdentity = lastBody?.externalIdentity as { provider?: string; externalId?: string } | undefined;
    assert.equal(externalIdentity?.provider, "whatsapp", "confirmed root cause: the capability only ever links the whatsapp channel, never the pending prestashop candidate");
    assert.notEqual(externalIdentity?.externalId, "ps-501");

    // RTL06/07 as a documented negative finding: the "link" reported success,
    // but it was the wrong bridge - RuntimeIdentityContext still never
    // reaches LEVEL_3/VERIFIED for this master. No false positive.
    const after = await currentRuntimeIdentity(env);
    assert.notEqual(after.identityLevel, "LEVEL_3_PRESTASHOP_LINKED");
    assert.notEqual(after.status, "PRESTASHOP_LINKED");
    // The prestashop candidate evidence is untouched - still READY_TO_LINK.
    assert.equal(after.status, "READY_TO_LINK");
  } finally {
    await env.teardown();
  }
});

// ===========================================================================
// GROUP D - RTL08/09/10: since Group C proves the chain cannot close, "same
// work resumes / no duplicate work / no duplicate live step" cannot be
// demonstrated for a real LEVEL_3 transition. What IS real and verified: the
// probe decision recomputed with the SAME (unchanged) runtimeIdentity is
// byte-for-byte identical across two independent evaluations (restart-safe,
// same discipline as A07's CIW30) - i.e. nothing here would silently
// duplicate or drift if a future A09 bridge writer did complete the chain.
// ===========================================================================

test("RTL08/09/10 (bounded by GAP 1/2): the real decision is pure and idempotent across re-evaluations while the gap persists - proves no drift, not a resume this task cannot produce", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-501");
    const runtimeIdentityFirst = await currentRuntimeIdentity(env);
    const runtimeIdentitySecond = await currentRuntimeIdentity(env);
    assert.deepEqual(runtimeIdentityFirst, runtimeIdentitySecond);

    const decisionFirst = evaluateCommercialIdentityRequirement("customer_profile_history", runtimeIdentityFirst);
    const decisionSecond = evaluateCommercialIdentityRequirement("customer_profile_history", runtimeIdentitySecond);
    assert.deepEqual(decisionFirst, decisionSecond);
  } finally {
    await env.teardown();
  }
});

// ===========================================================================
// GROUP E - RTL11/12: Customer Service failure/conflict paths, real HTTP
// test server, never mocked at the domain boundary.
// ===========================================================================

test("RTL11: a Customer Service timeout/503 leaves identity exactly as before - system-owned, never a false LEVEL_3", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedPrestashopCandidateEvidence(env, "ps-501");
    const before = await currentRuntimeIdentity(env);

    handler = (_req, res) => sendJson(res, 503, { error: { code: "SERVICE_DOWN", message: "down" } });
    const consent = parseConsentEvidence({ messageText: "si, autorizo vincular este whatsapp a mi cuenta", messageId: uniqueSuffix("msg"), capturedAt: new Date().toISOString() }, "link_external_identity");
    const outcome = await linkDefinition().execute({}, gatewayContext(trustedSession(env, { identity: { status: "identified", customerId: String(env.masterCustomerId), source: "normalized_phone", localResolutionOutcome: "identified", externalResolutionOutcome: null }, currentTurnConsent: { createCustomer: null, linkExternalIdentity: consent, linkPrestashopIdentity: null } })));
    assert.equal(outcome.status, "temporarily_blocked");

    const after = await currentRuntimeIdentity(env);
    assert.deepEqual(after, before);
  } finally {
    await env.teardown();
  }
});

test("RTL12: a Customer Service link conflict never produces LEVEL_3", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedPrestashopCandidateEvidence(env, "ps-501");
    handler = (_req, res) => sendJson(res, 409, { error: { code: "ALREADY_LINKED", conflictCode: "linked_to_other_customer" } });
    const consent = parseConsentEvidence({ messageText: "si, autorizo vincular este whatsapp a mi cuenta", messageId: uniqueSuffix("msg"), capturedAt: new Date().toISOString() }, "link_external_identity");
    const outcome = await linkDefinition().execute({}, gatewayContext(trustedSession(env, { identity: { status: "identified", customerId: String(env.masterCustomerId), source: "normalized_phone", localResolutionOutcome: "identified", externalResolutionOutcome: null }, currentTurnConsent: { createCustomer: null, linkExternalIdentity: consent, linkPrestashopIdentity: null } })));
    assert.equal(outcome.errorCode, "customer_link_conflict");

    const after = await currentRuntimeIdentity(env);
    assert.notEqual(after.identityLevel, "LEVEL_3_PRESTASHOP_LINKED");
  } finally {
    await env.teardown();
  }
});

// ===========================================================================
// GROUP F - PARTE 6, isolated: A04/A05's OWN live-LEVEL_3 check is correct
// once a canonical bridge genuinely exists - proving the gap is "no writer",
// never "the verification policy itself is broken". Uses the same real
// repository writers as Group A's seeding (never a hand-built
// RuntimeIdentityContext - PARTE 6 forbids that explicitly).
// ===========================================================================

test("RTL07 (isolated, PARTE 6): once a real canonical prestashop bridge exists (as a future A09 writer would produce), resolveRuntimeIdentityContext genuinely computes LEVEL_3 live - proving the gap is the missing writer, not the verification policy", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedCanonicalPrestashopBridge(env, "ps-501");

    const runtimeIdentity = await currentRuntimeIdentity(env);
    assert.equal(runtimeIdentity.status, "PRESTASHOP_LINKED");
    assert.equal(runtimeIdentity.identityLevel, "LEVEL_3_PRESTASHOP_LINKED");
    assert.equal(runtimeIdentity.masterCustomerId, String(env.masterCustomerId));
    assert.equal(runtimeIdentity.prestashopCustomerId, "ps-501");

    const decision = evaluateCommercialIdentityRequirement("customer_profile_history", runtimeIdentity);
    assert.equal(decision.status, "SUFFICIENT", "LEVEL_3 is now genuinely enough for the LEVEL_3 operation - proves the whole downstream chain (A04 live-check -> A05 -> A06) works correctly once the bridge exists");
  } finally {
    await env.teardown();
  }
});

test("RTL13-equivalent live-check: a bridge row for a DIFFERENT master never confirms LEVEL_3 for this one - fails closed to LEVEL_2, not a false positive", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    // Durable evidence claims the bridge, but the live customer_external_identity
    // row (if it existed) would point at a different master - simulated here
    // by never writing the live row at all, so decideWithLiveLevel3Check's
    // findExternalIdentity("prestashop", ...) lookup finds nothing live.
    await recordIdentityEvidence({
      conversationId: String(env.conversationId),
      correlationId: uniqueSuffix("corr"),
      channel: "whatsapp",
      provider: "prestashop",
      signalType: "prestashop_customer_id",
      source: "customer_external_identity",
      masterCustomerId: String(env.masterCustomerId),
      prestashopCustomerId: "ps-stale",
      strength: "verified",
      verified: true,
      observedAt: new Date().toISOString()
    });

    const runtimeIdentity = await currentRuntimeIdentity(env);
    assert.notEqual(runtimeIdentity.identityLevel, "LEVEL_3_PRESTASHOP_LINKED", "stale durable evidence without a live bridge row must never grant LEVEL_3");
  } finally {
    await env.teardown();
  }
});

// ===========================================================================
// GROUP G - RTL14 (replay/idempotency) and RTL15 (privacy).
// ===========================================================================

test("RTL14: replaying the exact same consent message twice sends the exact same idempotency key both times (CRM's own replay-safety guarantee)", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    handler = (_req, res) => sendJson(res, 201, { status: "completed", customerMasterId: String(env.masterCustomerId), externalIdentityId: "ext-1" });
    const messageId = uniqueSuffix("msg");
    const consent = parseConsentEvidence({ messageText: "si, autorizo vincular este whatsapp a mi cuenta", messageId, capturedAt: new Date().toISOString() }, "link_external_identity");
    const correlationId = uniqueSuffix("corr");
    const session = trustedSession(env, { identity: { status: "identified", customerId: String(env.masterCustomerId), source: "normalized_phone", localResolutionOutcome: "identified", externalResolutionOutcome: null }, currentTurnConsent: { createCustomer: null, linkExternalIdentity: consent, linkPrestashopIdentity: null } });

    await linkDefinition().execute({}, { correlationId, trustedCustomerSession: session });
    const firstKey = lastHeaders["idempotency-key"];
    await linkDefinition().execute({}, { correlationId, trustedCustomerSession: session });
    const secondKey = lastHeaders["idempotency-key"];

    assert.equal(requestCount, 2, "the Gateway layer itself has no dedupe - deduplication is Customer Service's responsibility, driven by this deterministic key");
    assert.equal(firstKey, secondKey);
    assert.equal(firstKey, `customer-service:link:${correlationId}:link_external_identity`);
  } finally {
    await env.teardown();
  }
});

test("RTL15: the READY_TO_LINK consent message never contains a raw customer/prestashop id, level literal, or policy code", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedWhatsAppChannelLink(env);
    await seedPrestashopCandidateEvidence(env, "ps-999999");
    const runtimeIdentity = await currentRuntimeIdentity(env);
    const decision = evaluateCommercialIdentityRequirement("customer_profile_history", runtimeIdentity);
    const objective = harnessObjectiveFromRealDecision(decision);
    const result = buildCommercialWorkFinalizerMessage(workFromObjectives([objective], "ACTIVE"), null);

    assert.doesNotMatch(result.message, new RegExp(String(env.masterCustomerId)));
    assert.doesNotMatch(result.message, /ps-999999|999999/);
    assert.doesNotMatch(result.message, /LEVEL_|READY_TO_LINK|policyCode/);
  } finally {
    await env.teardown();
  }
});
