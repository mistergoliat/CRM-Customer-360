import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";
import { getPool } from "@/lib/db";
import { closeTestHttpServer } from "../helpers/closeTestHttpServer";
import { resetCustomerServicePortForTests, resetOnboardingServiceForTests, setOnboardingServiceForTests, setCustomerMasterProjectionReaderForTests } from "@/lib/brain/commercial/capability-gateway";
import { runCustomerOnboardingPostPlanStage } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { CustomerOnboardingPostPlanDependencies } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { CustomerOnboardingMutationResult, CustomerOnboardingService, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";
import type { CustomerResolutionEvidence } from "@/lib/domains/customer-service";

// ACS-R1-04-T06.1. Groups: Fase post-plan (1-5), Persistencia (16-21),
// Customer nuevo (22-33), Link (34-40).

const SOURCE = readFileSync(
  join(__dirname, "..", "..", "lib", "brain", "commercial", "native-cycle", "customer-session", "runCustomerOnboardingPostPlanStage.ts"),
  "utf8"
);

// ---------------------------------------------------------------------------
// Local Customer Service HTTP server (same convention as T06's capability tests).
// ---------------------------------------------------------------------------

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: unknown) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let requestCount = 0;
let lastUrl = "";
let lastBody: Record<string, unknown> | null = null;

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
  await getPool().end();
});

beforeEach(() => {
  requestCount = 0;
  lastUrl = "";
  lastBody = null;
  handler = (_req, res) => res.writeHead(500).end();
  process.env.CUSTOMER_SERVICE_BASE_URL = baseUrl;
  process.env.CUSTOMER_SERVICE_API_KEY = "test-key";
  resetCustomerServicePortForTests();
  resetOnboardingServiceForTests();
  // ACS-R1-04-T08.1: this file exercises the post-plan stage's own logic,
  // not the customer_master projection gate itself.
  setCustomerMasterProjectionReaderForTests({ async exists() { return true; } });
});

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// Faithful in-memory CustomerOnboardingService fake with a full call log.
// ---------------------------------------------------------------------------

function makeOnboardingFake(initial: CustomerOnboardingState | null) {
  let state = initial;
  const calls: string[] = [];
  const COLLECT_FROM = ["required", "collecting", "conflict"];
  const RESOLVE_FROM = ["required", "collecting"];

  function bump(patch: Partial<CustomerOnboardingState>): CustomerOnboardingMutationResult {
    state = { ...(state as CustomerOnboardingState), ...patch, version: (state as CustomerOnboardingState).version + 1, updatedAt: new Date().toISOString() };
    return { ok: true, status: "updated", state };
  }
  function checkVersion(expectedVersion: number): CustomerOnboardingMutationResult | null {
    if (!state) return { ok: false, status: "not_found", error: "no row" };
    if (state.version !== expectedVersion) return { ok: false, status: "onboarding_state_version_conflict", error: "version mismatch" };
    return null;
  }

  const service: CustomerOnboardingService = {
    async getState() {
      calls.push("getState");
      return state;
    },
    async startOnboarding(input) {
      calls.push("startOnboarding");
      if (state) {
        if (state.purpose === input.purpose) return { ok: true, status: "unchanged", state };
        return { ok: false, status: "purpose_conflict", error: "purpose_conflict" };
      }
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
      const conflict = checkVersion(input.expectedVersion);
      if (conflict) return conflict;
      if (!COLLECT_FROM.includes((state as CustomerOnboardingState).status)) return { ok: false, status: "invalid_transition", error: "bad transition" };
      return bump({ status: "collecting", pendingFields: input.pendingFields, collected: { ...(state as CustomerOnboardingState).collected, ...input.collectedPatch } });
    },
    async markResolving(input) {
      calls.push("markResolving");
      const conflict = checkVersion(input.expectedVersion);
      if (conflict) return conflict;
      if (!RESOLVE_FROM.includes((state as CustomerOnboardingState).status)) return { ok: false, status: "invalid_transition", error: "bad transition" };
      return bump({ status: "resolving" });
    },
    async completeOnboarding(input) {
      calls.push("completeOnboarding");
      if (state?.status === "completed") {
        if (state.customerId === input.customerId) return { ok: true, status: "unchanged", state };
        return { ok: false, status: "customer_conflict", error: "customer_conflict" };
      }
      const conflict = checkVersion(input.expectedVersion);
      if (conflict) return conflict;
      if ((state as CustomerOnboardingState).status !== "resolving") return { ok: false, status: "invalid_transition", error: "bad transition" };
      return bump({ status: "completed", customerId: input.customerId, completedAt: new Date().toISOString() });
    },
    async markConflict(input) {
      calls.push("markConflict");
      const conflict = checkVersion(input.expectedVersion);
      if (conflict) return conflict;
      if ((state as CustomerOnboardingState).status !== "resolving") return { ok: false, status: "invalid_transition", error: "bad transition" };
      return bump({ status: "conflict", customerId: null });
    },
    async markTemporarilyUnavailable(input) {
      calls.push("markTemporarilyUnavailable");
      const conflict = checkVersion(input.expectedVersion);
      if (conflict) return conflict;
      if ((state as CustomerOnboardingState).status !== "resolving") return { ok: false, status: "invalid_transition", error: "bad transition" };
      return bump({ status: "temporarily_unavailable" });
    },
    retryResolution: async () => {
      throw new Error("retryResolution must not be called by the post-plan stage");
    },
    recordVerificationFailure: async () => {
      throw new Error("recordVerificationFailure must not be called by the post-plan stage");
    }
  };

  return { service, calls, getState: () => state };
}

function onboardingRow(overrides: Partial<CustomerOnboardingState> = {}): CustomerOnboardingState {
  return {
    id: 1,
    conversationId: "conv-1",
    opportunityId: null,
    status: "required",
    purpose: "quote",
    collected: {},
    pendingFields: ["firstName", "email"],
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
    identity: { status: "identification_required", customerId: null, source: "none", localResolutionOutcome: "identification_required", externalResolutionOutcome: null },
    onboarding: null,
    contextAccess: "none",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null },
    freshExternalResolutionEvidence: null,
    ...overrides
  };
}

const CREATE_CONSENT = { scope: "create_customer" as const, messageId: "wamid.1", capturedAt: "2026-07-09T12:00:00.000Z", source: "current_inbound" as const };
const LINK_CONSENT = { scope: "link_external_identity" as const, messageId: "wamid.1", capturedAt: "2026-07-09T12:00:00.000Z", source: "current_inbound" as const };

function noMatchEvidence(): CustomerResolutionEvidence {
  return { source: "customer_service", requestId: "r", checkedAt: "2026-07-09T12:00:00.000Z", result: { status: "no_match" } };
}
function resolvedEvidence(customerMasterId: string): CustomerResolutionEvidence {
  return { source: "customer_service", requestId: "r", checkedAt: "2026-07-09T12:00:00.000Z", result: { status: "resolved", customerMasterId } };
}
function conflictEvidence(): CustomerResolutionEvidence {
  return { source: "customer_service", requestId: "r", checkedAt: "2026-07-09T12:00:00.000Z", result: { status: "conflict", conflictCode: "multiple_candidates" } };
}
function unavailableEvidence(): CustomerResolutionEvidence {
  return { source: "customer_service", requestId: "r", checkedAt: "2026-07-09T12:00:00.000Z", result: { status: "temporarily_unavailable", retryable: true } };
}

/**
 * Also aligns the Capability Gateway's own module-level onboarding service
 * (used internally by create_customer/link_external_identity's execute())
 * with this test's fake, so a real capability execution's own onboarding
 * transition is visible through the same fake this test asserts against.
 */
function deps(onboardingService: CustomerOnboardingService, resolveCustomerExternal?: CustomerOnboardingPostPlanDependencies["resolveCustomerExternal"]): CustomerOnboardingPostPlanDependencies {
  setOnboardingServiceForTests(onboardingService);
  return { onboardingService, resolveCustomerExternal };
}

// ---------------------------------------------------------------------------
// Group: Fase post-plan (1-5)
// ---------------------------------------------------------------------------

test("1: a structured quote operation starts onboarding in the current turn", async () => {
  const onboarding = makeOnboardingFake(null);
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "quiero cotizar una banca",
    correlationId: "corr-1",
    customerSessionExecution: session(),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.attemptedOperation, "start_onboarding");
  assert.equal(result.onboarding?.status, "required");
  assert.equal(result.onboarding?.purpose, "quote");
});

test("2: a public query (no structured operation) never starts onboarding", async () => {
  const onboarding = makeOnboardingFake(null);
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: null },
    messageText: "cuanto cuesta el envio",
    correlationId: "corr-1",
    customerSessionExecution: session(),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.attemptedOperation, "none");
  assert.equal(result.onboarding, null);
});

test("3: the post-plan stage never repeats local identity resolution - it never imports the identity domain at all", () => {
  assert.doesNotMatch(SOURCE, /customer-identity/);
});

test("4: the post-plan stage never loads Customer 360", () => {
  assert.doesNotMatch(SOURCE, /customer-360/);
  assert.doesNotMatch(SOURCE, /Customer360/);
});

test("5: the post-plan stage reuses the pre-plan session's onboarding - it never reloads it when already present", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting" }));
  await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "hola",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState() }),
    dependencies: deps(onboarding.service)
  });
  assert.ok(!onboarding.calls.includes("getState"), "the initial onboarding load is never repeated - only session.onboarding is used");
});

// ---------------------------------------------------------------------------
// Group: Persistencia (16-21)
// ---------------------------------------------------------------------------

test("16: valid captured fields are persisted exclusively through CustomerOnboardingService.collectFields", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required", collected: {} }));
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "me llamo Pedro Perez, mi correo es pedro@example.com",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState() }),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.attemptedOperation, "collect_fields");
  assert.equal(result.onboarding?.collected.firstName, "Pedro");
  assert.equal(result.onboarding?.collected.email, "pedro@example.com");
  assert.ok(onboarding.calls.includes("collectFields"));
});

test("17: the full raw message is never persisted into onboarding.collected", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  const messageText = "me llamo Pedro Perez, mi correo es pedro@example.com, y ademas quiero preguntar por el envio a Temuco";
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText,
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState() }),
    dependencies: deps(onboarding.service)
  });
  const serialized = JSON.stringify(result.onboarding?.collected);
  assert.doesNotMatch(serialized, /Temuco/);
  assert.notEqual(result.onboarding?.collected.firstName, messageText);
});

test("18: consent text is never persisted into onboarding", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerMasterId: "1" });
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "autorizo crear mi ficha de cliente",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState(), currentTurnConsent: { createCustomer: CREATE_CONSENT, linkExternalIdentity: null }, freshExternalResolutionEvidence: noMatchEvidence() }),
    dependencies: deps(onboarding.service)
  });
  const serialized = JSON.stringify(result.onboarding);
  assert.doesNotMatch(serialized, /autorizo/i);
  assert.doesNotMatch(serialized, /wamid\.1/);
});

test("19: a transient no_match is never persisted anywhere in onboarding", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  handler = (_req, res) => sendJson(res, 200, { status: "no_match" });
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "hola",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState(), currentTurnConsent: { createCustomer: null, linkExternalIdentity: null } }),
    dependencies: deps(onboarding.service)
  });
  const serialized = JSON.stringify(result.onboarding);
  assert.doesNotMatch(serialized, /no_match/);
});

test("20: an optimistic-locking version conflict never overwrites newer state", async () => {
  const row = onboardingRow({ status: "required", version: 5 });
  const onboarding = makeOnboardingFake(row);
  // Force a stale expectedVersion by handing the session an outdated copy.
  const staleOnboarding = { ...row, version: 1 };
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "me llamo Pedro Perez",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: staleOnboarding }),
    dependencies: deps(onboarding.service)
  });
  assert.ok(result.warnings.includes("customer_onboarding_version_conflict"));
  assert.equal(result.onboarding?.version, 5, "the real (newer) state was reloaded, never overwritten by the stale write");
});

test("21: a version conflict reloads at most once - never loops", async () => {
  const row = onboardingRow({ status: "required", version: 5 });
  const onboarding = makeOnboardingFake(row);
  const staleOnboarding = { ...row, version: 1 };
  await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "me llamo Pedro Perez",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: staleOnboarding }),
    dependencies: deps(onboarding.service)
  });
  assert.equal(onboarding.calls.filter((c) => c === "getState").length, 1);
  assert.equal(onboarding.calls.filter((c) => c === "collectFields").length, 1, "no retry loop");
});

// ---------------------------------------------------------------------------
// Group: Customer nuevo (22-33)
// ---------------------------------------------------------------------------

test("22: turn 1 starts onboarding from a structured quote operation", async () => {
  const onboarding = makeOnboardingFake(null);
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "quiero cotizar",
    correlationId: "corr-1",
    customerSessionExecution: session(),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.attemptedOperation, "start_onboarding");
  assert.equal(result.capabilityOutcome, null, "no create attempt yet - no data, no consent");
});

test("23: turn 2 persists name and email onto the existing onboarding", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "me llamo Pedro Perez, mi correo es pedro@example.com",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState() }),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.onboarding?.collected.firstName, "Pedro");
  assert.equal(result.onboarding?.collected.email, "pedro@example.com");
});

test("24: turn 2 never creates a customer without explicit consent, even with sufficient data", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "me llamo Pedro Perez, mi correo es pedro@example.com",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState() }),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.capabilityOutcome, null);
  assert.equal(requestCount, 0);
});

test("25: turn 3 requires create consent from THIS turn - missing consent still blocks create with sufficient data", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "gracias",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState(), currentTurnConsent: { createCustomer: null, linkExternalIdentity: null } }),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.capabilityOutcome, null);
  assert.equal(requestCount, 0);
});

test("26: turn 3 executes exactly one resolve_customer call before create", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  let resolveCalls = 0;
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerMasterId: "500" });
  await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "autorizo crear mi ficha de cliente",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState(), currentTurnConsent: { createCustomer: CREATE_CONSENT, linkExternalIdentity: null } }),
    dependencies: deps(onboarding.service, async () => {
      resolveCalls += 1;
      return noMatchEvidence();
    })
  });
  assert.equal(resolveCalls, 1);
});

test("27: a fresh no_match allows create to proceed", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerMasterId: "500" });
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "autorizo crear mi ficha de cliente",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState(), currentTurnConsent: { createCustomer: CREATE_CONSENT, linkExternalIdentity: null }, freshExternalResolutionEvidence: noMatchEvidence() }),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.attemptedOperation, "create_customer");
  assert.equal(result.capabilityOutcome?.status, "completed");
});

test("28: with no evidence carried over from pre-plan, post-plan resolves fresh itself before creating - never treats absence as authorization", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  let resolveCalls = 0;
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerMasterId: "500" });
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "autorizo crear mi ficha de cliente",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState(), currentTurnConsent: { createCustomer: CREATE_CONSENT, linkExternalIdentity: null }, freshExternalResolutionEvidence: null }),
    dependencies: deps(onboarding.service, async () => {
      resolveCalls += 1;
      return noMatchEvidence();
    })
  });
  assert.equal(resolveCalls, 1);
  assert.equal(result.attemptedOperation, "create_customer");
});

test("29: a resolved evidence completes onboarding with the resolved customerId and never creates", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "autorizo crear mi ficha de cliente",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState(), currentTurnConsent: { createCustomer: CREATE_CONSENT, linkExternalIdentity: null } }),
    dependencies: deps(onboarding.service, async () => resolvedEvidence("999"))
  });
  assert.equal(result.onboarding?.status, "completed");
  assert.equal(result.onboarding?.customerId, "999");
  assert.equal(requestCount, 0, "create_customer's HTTP endpoint was never called");
});

test("30: a conflict evidence blocks create and lands onboarding in conflict", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "autorizo crear mi ficha de cliente",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState(), currentTurnConsent: { createCustomer: CREATE_CONSENT, linkExternalIdentity: null } }),
    dependencies: deps(onboarding.service, async () => conflictEvidence())
  });
  assert.equal(result.onboarding?.status, "conflict");
  assert.equal(requestCount, 0);
});

test("31: a temporarily_unavailable evidence blocks create without changing onboarding", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "autorizo crear mi ficha de cliente",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState(), currentTurnConsent: { createCustomer: CREATE_CONSENT, linkExternalIdentity: null } }),
    dependencies: deps(onboarding.service, async () => unavailableEvidence())
  });
  assert.equal(result.onboarding?.status, "collecting");
  assert.equal(requestCount, 0);
  assert.ok(result.warnings.includes("customer_service_unavailable"));
});

test("32: create completes onboarding with the new customerId", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerMasterId: "777" });
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "autorizo crear mi ficha de cliente",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState(), currentTurnConsent: { createCustomer: CREATE_CONSENT, linkExternalIdentity: null }, freshExternalResolutionEvidence: noMatchEvidence() }),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.onboarding?.status, "completed");
  assert.equal(result.onboarding?.customerId, "777");
});

test("33: a successful create never also triggers link_external_identity in the same turn", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerMasterId: "777" });
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "autorizo crear mi ficha de cliente",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState(), currentTurnConsent: { createCustomer: CREATE_CONSENT, linkExternalIdentity: LINK_CONSENT }, freshExternalResolutionEvidence: noMatchEvidence() }),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.attemptedOperation, "create_customer");
  assert.doesNotMatch(lastUrl, /external-identities/);
});

// ---------------------------------------------------------------------------
// Group: Link (34-40)
// ---------------------------------------------------------------------------

test("34: link requires a consistent customerId - never attempted without one", async () => {
  const onboarding = makeOnboardingFake(null);
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: null },
    messageText: "autorizo vincular este whatsapp a mi cuenta",
    correlationId: "corr-1",
    customerSessionExecution: session({ identity: { status: "identification_required", customerId: null, source: "none", localResolutionOutcome: "identification_required", externalResolutionOutcome: null }, currentTurnConsent: { createCustomer: null, linkExternalIdentity: LINK_CONSENT } }),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.attemptedOperation, "none");
  assert.equal(requestCount, 0);
});

test("35: link requires explicit link consent from the current turn - identified alone is not enough", async () => {
  const onboarding = makeOnboardingFake(null);
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: null },
    messageText: "hola",
    correlationId: "corr-1",
    customerSessionExecution: session({ identity: { status: "identified", customerId: "700", source: "normalized_phone", localResolutionOutcome: "identified", externalResolutionOutcome: null } }),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.attemptedOperation, "none");
  assert.equal(requestCount, 0);
});

test("36: create consent never authorizes link - the scopes are never interchangeable", async () => {
  const onboarding = makeOnboardingFake(null);
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: null },
    messageText: "autorizo crear mi ficha de cliente",
    correlationId: "corr-1",
    customerSessionExecution: session({
      identity: { status: "identified", customerId: "700", source: "normalized_phone", localResolutionOutcome: "identified", externalResolutionOutcome: null },
      currentTurnConsent: { createCustomer: CREATE_CONSENT, linkExternalIdentity: null }
    }),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.attemptedOperation, "none");
  assert.equal(requestCount, 0);
});

test("37: link sends the trusted inbound externalId, never a model-supplied one", async () => {
  const onboarding = makeOnboardingFake(null);
  handler = (_req, res) => sendJson(res, 201, { status: "completed", customerMasterId: "700", externalIdentityId: "ext-1" });
  await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: null },
    messageText: "autorizo vincular este whatsapp a mi cuenta",
    correlationId: "corr-1",
    customerSessionExecution: session({
      identity: { status: "identified", customerId: "700", source: "normalized_phone", localResolutionOutcome: "identified", externalResolutionOutcome: null },
      currentTurnConsent: { createCustomer: null, linkExternalIdentity: LINK_CONSENT }
    }),
    dependencies: deps(onboarding.service)
  });
  const externalIdentity = lastBody?.externalIdentity as { externalId?: string } | undefined;
  assert.equal(externalIdentity?.externalId, "56911112222");
});

test("38: link only fires when identity was already identified BEFORE this turn's post-plan ran - never in the same turn create runs", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerMasterId: "777" });
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "autorizo crear mi ficha de cliente y vincular whatsapp",
    correlationId: "corr-1",
    customerSessionExecution: session({
      identity: { status: "identification_required", customerId: null, source: "none", localResolutionOutcome: "identification_required", externalResolutionOutcome: null },
      onboarding: onboarding.getState(),
      currentTurnConsent: { createCustomer: CREATE_CONSENT, linkExternalIdentity: LINK_CONSENT },
      freshExternalResolutionEvidence: noMatchEvidence()
    }),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.attemptedOperation, "create_customer");
  assert.doesNotMatch(lastUrl, /external-identities/);
});

test("39: a successful create result never causes link to also execute", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Pedro", email: "pedro@example.com" } }));
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerMasterId: "777" });
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "autorizo crear mi ficha de cliente",
    correlationId: "corr-1",
    customerSessionExecution: session({ onboarding: onboarding.getState(), currentTurnConsent: { createCustomer: CREATE_CONSENT, linkExternalIdentity: null }, freshExternalResolutionEvidence: noMatchEvidence() }),
    dependencies: deps(onboarding.service)
  });
  assert.notEqual(result.attemptedOperation, "link_external_identity");
});

test("40: already_linked is treated as an idempotent success, never an error", async () => {
  const onboarding = makeOnboardingFake(null);
  handler = (_req, res) => sendJson(res, 200, { status: "already_linked", customerMasterId: "700", externalIdentityId: "ext-1" });
  const result = await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: null },
    messageText: "autorizo vincular este whatsapp a mi cuenta",
    correlationId: "corr-1",
    customerSessionExecution: session({
      identity: { status: "identified", customerId: "700", source: "normalized_phone", localResolutionOutcome: "identified", externalResolutionOutcome: null },
      currentTurnConsent: { createCustomer: null, linkExternalIdentity: LINK_CONSENT }
    }),
    dependencies: deps(onboarding.service)
  });
  assert.equal(result.capabilityOutcome?.status, "completed");
  assert.equal(result.capabilityOutcome?.errorCode, null);
});
