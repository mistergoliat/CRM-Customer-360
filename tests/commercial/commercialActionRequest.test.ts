import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows, safeExecute } from "@/lib/db";
import { createInMemoryAgentSessionStore } from "@/lib/brain/commercial/agent-session/inMemoryAgentSessionStore";
import type { AgentSessionEvent } from "@/lib/brain/commercial/agent-session/types";
import { buildCommercialActionRequestFromAtlStep } from "@/lib/brain/commercial/commercial-action-request/atlAdapter";
import { getActionTypeForCapability, getCapabilityMappingForActionType } from "@/lib/brain/commercial/commercial-action-request/actionCapabilityMapping";
import { buildCommercialActionRequestId } from "@/lib/brain/commercial/commercial-action-request/requestIdentity";
import { validateCommercialActionRequest } from "@/lib/brain/commercial/commercial-action-request/validateCommercialActionRequest";
import { executeCommercialActionRequest } from "@/lib/brain/commercial/commercial-action-request/executeCommercialActionRequest";
import type { CommercialActionRequest } from "@/lib/brain/commercial/commercial-action-request/types";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway/types";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";

/**
 * SALES-AGENT-R3-A03. Tests for the CommercialActionRequest boundary - the
 * canonical R3 boundary between agent reasoning and commercial mutation.
 * Mirrors the DB-backed integration pattern already established in
 * tests/commercial/capabilityGatewayIdentityGate.test.ts (A02) and
 * tests/commercial/createQuoteCapability.test.ts (SALES-AGENT-R1-T3).
 */

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: ""
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueOpportunityId(): number {
  return 831000000 + Math.floor(Math.random() * 9999999);
}

/**
 * crm_capability_executions.opportunity_id carries a real FK to
 * crm_opportunities(id) (ON DELETE SET NULL) - unlike the capabilities'
 * own domain writes (crm_request_facts, anchored by a plain "opportunity:<id>"
 * string with no FK), the audit row itself requires a real opportunity to
 * exist. Only the one test that asserts on the audit row directly needs
 * this - every other test here only asserts on the typed CommercialActionResult,
 * which is correct and returned regardless of whether the (best-effort,
 * never-blocking) audit insert succeeds.
 */
async function seedOpportunity(): Promise<number> {
  const key = `sales-agent-r3-a03-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const waId = `5692${String(Date.now()).slice(-8)}`;
  await safeExecute(
    `INSERT INTO crm_opportunities (opportunity_key, requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json, wa_id)
     VALUES (?, '{}', '[]', '[]', '[]', '[]', ?)`,
    [key, waId]
  );
  const rows = await queryRows<{ id: number }>(`SELECT id FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1`, [key]);
  return rows[0].id;
}

function fakeSession(overrides: Partial<NativeCustomerSessionExecutionContext["runtimeIdentity"]> = {}): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "conv-1",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56911112222", normalizedPhone: "56911112222", messageId: "wamid.1", receivedAt: "2026-08-30T12:00:00.000Z" },
    identity: { status: "anonymous", customerId: null, source: "none", localResolutionOutcome: "anonymous", externalResolutionOutcome: null },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_source_unsupported" },
    runtimeIdentity: {
      status: "ANONYMOUS",
      identityLevel: "LEVEL_0_ANONYMOUS",
      masterCustomerId: null,
      prestashopCustomerId: null,
      verificationRequired: false,
      requiredEvidence: [],
      readyToLink: false,
      conflictCode: null,
      policyCode: "NO_CHANNEL_EVIDENCE",
      evidenceRefs: [],
      ...overrides
    },
    onboarding: null,
    contextAccess: "none",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
    freshExternalResolutionEvidence: null
  };
}

function level2Session(): NativeCustomerSessionExecutionContext {
  return fakeSession({ status: "MASTER_RESOLVED", identityLevel: "LEVEL_2_MASTER_RESOLVED", masterCustomerId: "700" });
}

function gatewayContext(session: NativeCustomerSessionExecutionContext | null, opportunityId: number | null, correlationId: string): CapabilityGatewayContext {
  return { correlationId, conversationId: 1, opportunityId, trustedCustomerSession: session };
}

async function loadExecutionRow(correlationId: string) {
  const rows = await queryRows<Record<string, unknown>>(
    "SELECT * FROM crm_capability_executions WHERE correlation_id = ? ORDER BY id DESC LIMIT 1",
    [correlationId]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// [1] canonical action -> capability mapping
// ---------------------------------------------------------------------------

test("action type <-> capability mapping is exhaustive and bidirectional", () => {
  assert.equal(getCapabilityMappingForActionType("SELECT_PRODUCTS").capability, "select_products");
  assert.equal(getCapabilityMappingForActionType("SET_SHIPPING_DESTINATION").capability, "set_shipping_destination");
  assert.equal(getCapabilityMappingForActionType("SELECT_SHIPPING_OPTION").capability, "select_shipping_option");
  assert.equal(getCapabilityMappingForActionType("CREATE_QUOTE").capability, "create_quote");
  assert.equal(getActionTypeForCapability("select_products"), "SELECT_PRODUCTS");
  assert.equal(getActionTypeForCapability("create_quote"), "CREATE_QUOTE");
  assert.equal(getActionTypeForCapability("search_products"), null, "a read-only capability must never map to an action type");
});

// ---------------------------------------------------------------------------
// [2][5][6] request validation
// ---------------------------------------------------------------------------

function baseRequest(overrides: Partial<CommercialActionRequest> = {}): CommercialActionRequest {
  return {
    requestId: "car_test",
    conversationId: 1,
    opportunityId: 42,
    correlationId: "corr-validate",
    causationId: "wamid.1",
    source: "agent_tool_loop",
    createdAt: "2026-08-30T12:00:00.000Z",
    actionType: "SET_SHIPPING_DESTINATION",
    input: { destination: "Ñuñoa" },
    ...overrides
  } as CommercialActionRequest;
}

test("valid SET_SHIPPING_DESTINATION request passes validation", () => {
  assert.deepEqual(validateCommercialActionRequest(baseRequest()), { valid: true });
});

test("valid SELECT_PRODUCTS request passes validation", () => {
  const request = baseRequest({ actionType: "SELECT_PRODUCTS", input: { items: [{ productId: "501", quantity: 2 }] } } as Partial<CommercialActionRequest>);
  assert.deepEqual(validateCommercialActionRequest(request), { valid: true });
});

test("valid SELECT_SHIPPING_OPTION request passes validation", () => {
  const request = baseRequest({ actionType: "SELECT_SHIPPING_OPTION", input: { optionIndex: 0 } } as Partial<CommercialActionRequest>);
  assert.deepEqual(validateCommercialActionRequest(request), { valid: true });
});

test("valid CREATE_QUOTE request passes validation", () => {
  const request = baseRequest({ actionType: "CREATE_QUOTE", input: {} } as Partial<CommercialActionRequest>);
  assert.deepEqual(validateCommercialActionRequest(request), { valid: true });
});

test("unknown action type fails closed", () => {
  const request = baseRequest({ actionType: "DELETE_EVERYTHING" as never });
  const result = validateCommercialActionRequest(request);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, "unknown_action_type");
});

test("malformed input fails closed: SELECT_PRODUCTS with an empty items array", () => {
  const request = baseRequest({ actionType: "SELECT_PRODUCTS", input: { items: [] } } as Partial<CommercialActionRequest>);
  const result = validateCommercialActionRequest(request);
  assert.equal(result.valid, false);
});

test("malformed input fails closed: SET_SHIPPING_DESTINATION with a non-string destination", () => {
  const request = baseRequest({ input: { destination: 12345 as unknown as string } });
  const result = validateCommercialActionRequest(request);
  assert.equal(result.valid, false);
});

test("malformed input fails closed: CREATE_QUOTE with an unexpected extra property", () => {
  const request = baseRequest({ actionType: "CREATE_QUOTE", input: { discountPercent: 50 } as never } as Partial<CommercialActionRequest>);
  const result = validateCommercialActionRequest(request);
  assert.equal(result.valid, false);
});

test("null on an optional property is treated as absent, not a type violation", () => {
  const request = baseRequest({
    actionType: "SELECT_PRODUCTS",
    input: { items: [{ productId: "501", combinationId: null as unknown as string, quantity: 1 }] }
  } as Partial<CommercialActionRequest>);
  assert.deepEqual(validateCommercialActionRequest(request), { valid: true });
});

// ---------------------------------------------------------------------------
// [11][12] ATL adapter
// ---------------------------------------------------------------------------

test("read-only tools never become a CommercialActionRequest", () => {
  const request = buildCommercialActionRequestFromAtlStep({
    step: { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
    conversationId: 1,
    opportunityId: 42,
    correlationId: "corr-atl",
    inboundMessageId: "wamid.1"
  });
  assert.equal(request, null);
});

test("a mutating ATL tool request adapts into a well-formed CommercialActionRequest", () => {
  const request = buildCommercialActionRequestFromAtlStep({
    step: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 2 }] } },
    conversationId: 1,
    opportunityId: 42,
    correlationId: "corr-atl-2",
    inboundMessageId: "wamid.2"
  });
  assert.ok(request);
  assert.equal(request?.actionType, "SELECT_PRODUCTS");
  assert.equal(request?.conversationId, 1);
  assert.equal(request?.opportunityId, 42);
  assert.equal(request?.causationId, "wamid.2");
  assert.equal(request?.source, "agent_tool_loop");
  assert.deepEqual(validateCommercialActionRequest(request!), { valid: true });
});

test("create_quote ATL adapter never trusts the model's raw arguments - always {}", () => {
  const request = buildCommercialActionRequestFromAtlStep({
    step: { type: "use_tool", tool: "create_quote", arguments: { discountPercent: 90 } },
    conversationId: 1,
    opportunityId: 42,
    correlationId: "corr-atl-3",
    inboundMessageId: "wamid.3"
  });
  assert.deepEqual(request?.input, {});
});

test("a null conversationId falls back to no CommercialActionRequest (caller keeps calling the Gateway directly)", () => {
  const request = buildCommercialActionRequestFromAtlStep({
    step: { type: "use_tool", tool: "select_products", arguments: { items: [] } },
    conversationId: null,
    opportunityId: 42,
    correlationId: "corr-atl-4",
    inboundMessageId: "wamid.4"
  });
  assert.equal(request, null);
});

// ---------------------------------------------------------------------------
// [13][14] idempotent, deterministic requestId
// ---------------------------------------------------------------------------

test("the same logical request (conversation + causation + action type + normalized input) always recomputes the same requestId", () => {
  const first = buildCommercialActionRequestId({ conversationId: 1, causationId: "wamid.1", actionType: "SELECT_PRODUCTS", input: { items: [{ productId: "501", quantity: 2 }] } });
  const second = buildCommercialActionRequestId({ conversationId: 1, causationId: "wamid.1", actionType: "SELECT_PRODUCTS", input: { items: [{ productId: "501", quantity: 2 }] } });
  assert.equal(first, second);
});

test("requestId is stable regardless of key order in the input (canonical JSON)", () => {
  const first = buildCommercialActionRequestId({ conversationId: 1, causationId: "wamid.1", actionType: "SET_SHIPPING_DESTINATION", input: { destination: "Ñuñoa", extra: 1 } });
  const second = buildCommercialActionRequestId({ conversationId: 1, causationId: "wamid.1", actionType: "SET_SHIPPING_DESTINATION", input: { extra: 1, destination: "Ñuñoa" } });
  assert.equal(first, second);
});

test("a genuinely different logical request (different input) gets a different requestId", () => {
  const first = buildCommercialActionRequestId({ conversationId: 1, causationId: "wamid.1", actionType: "SELECT_PRODUCTS", input: { items: [{ productId: "501", quantity: 2 }] } });
  const second = buildCommercialActionRequestId({ conversationId: 1, causationId: "wamid.1", actionType: "SELECT_PRODUCTS", input: { items: [{ productId: "999", quantity: 1 }] } });
  assert.notEqual(first, second);
});

// ---------------------------------------------------------------------------
// [8][9][10][22] identity gate inherited from A02
// ---------------------------------------------------------------------------

test("executeCommercialActionRequest: CREATE_QUOTE at LEVEL_0 is denied, Quote Service never consulted", async () => {
  const store = createInMemoryAgentSessionStore();
  const opportunityId = uniqueOpportunityId();
  const request = baseRequest({ actionType: "CREATE_QUOTE", input: {}, opportunityId, correlationId: `corr-cq-l0-${opportunityId}` } as Partial<CommercialActionRequest>);

  const result = await executeCommercialActionRequest(request, gatewayContext(fakeSession(), opportunityId, request.correlationId), { sessionStore: store });

  assert.equal(result.status, "DENIED");
  assert.equal(result.errorCode, "master_identity_required");
  assert.notEqual(result.errorCode, "quote_service_not_configured");
  assert.notEqual(result.errorCode, "no_active_opportunity");
});

test("executeCommercialActionRequest: CREATE_QUOTE at LEVEL_2 passes the identity gate and reaches the real capability", async () => {
  const store = createInMemoryAgentSessionStore();
  const opportunityId = uniqueOpportunityId();
  const request = baseRequest({ actionType: "CREATE_QUOTE", input: {}, opportunityId, correlationId: `corr-cq-l2-${opportunityId}` } as Partial<CommercialActionRequest>);

  const result = await executeCommercialActionRequest(request, gatewayContext(level2Session(), opportunityId, request.correlationId), { sessionStore: store });

  // The identity gate let it through to the real capability's own
  // checkAvailability - Quote Service is unconfigured in this test
  // environment, so it reports its own real, unrelated failure mode
  // (quote_service_not_configured) rather than the identity denial from the
  // LEVEL_0 test above. That distinction IS the proof the gate passed.
  assert.equal(result.status, "RETRYABLE");
  assert.equal(result.errorCode, "quote_service_not_configured");
});

test("executeCommercialActionRequest: SELECT_PRODUCTS remains ungated by identity even at LEVEL_0", async () => {
  const store = createInMemoryAgentSessionStore();
  const opportunityId = uniqueOpportunityId();
  const request = baseRequest({
    actionType: "SELECT_PRODUCTS",
    input: { items: [{ productId: "501", quantity: 2 }] },
    opportunityId,
    correlationId: `corr-sp-l0-${opportunityId}`
  } as Partial<CommercialActionRequest>);

  const result = await executeCommercialActionRequest(request, gatewayContext(fakeSession(), opportunityId, request.correlationId), { sessionStore: store });

  assert.equal(result.status, "COMPLETED");
});

// ---------------------------------------------------------------------------
// [7] missing opportunity where required
// ---------------------------------------------------------------------------

test("executeCommercialActionRequest: SELECT_PRODUCTS with no active opportunity is denied by the real capability, not fabricated by this boundary", async () => {
  const store = createInMemoryAgentSessionStore();
  const request = baseRequest({
    actionType: "SELECT_PRODUCTS",
    input: { items: [{ productId: "501", quantity: 1 }] },
    opportunityId: null,
    correlationId: "corr-sp-no-opp"
  } as Partial<CommercialActionRequest>);

  const result = await executeCommercialActionRequest(request, gatewayContext(fakeSession(), null, request.correlationId), { sessionStore: store });

  assert.equal(result.status, "DENIED");
  assert.equal(result.errorCode, "no_active_opportunity");
});

// ---------------------------------------------------------------------------
// [15] capability result maps to the typed CommercialActionResult
// ---------------------------------------------------------------------------

test("a structurally malformed request (missing required property) maps to BLOCKED, never reaching the Gateway", async () => {
  const store = createInMemoryAgentSessionStore();
  const request = baseRequest({ actionType: "SET_SHIPPING_DESTINATION", input: {} as never, correlationId: "corr-blocked" });

  const result = await executeCommercialActionRequest(request, gatewayContext(fakeSession(), 42, request.correlationId), { sessionStore: store });

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.gatewayResult.executionPublicId, null, "a request rejected before the Gateway has no crm_capability_executions row");
});

test("a syntactically valid but semantically empty value (e.g. an empty destination string) is NOT re-validated here - it reaches the real capability, which owns that check", async () => {
  const store = createInMemoryAgentSessionStore();
  const request = baseRequest({ actionType: "SET_SHIPPING_DESTINATION", input: { destination: "" }, correlationId: "corr-empty-string" });

  const result = await executeCommercialActionRequest(request, gatewayContext(fakeSession(), 42, request.correlationId), { sessionStore: store });

  // Reached the real capability (setShippingDestinationCapability.ts's own
  // asDestinationText) rather than being rejected by this boundary's
  // structural validation - proof Phase 4's "do not duplicate capability
  // validation logic" was actually honored, not just claimed.
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.errorCode, "destination_required");
  assert.notEqual(result.gatewayResult.executionPublicId, null, "this one DID reach the Gateway, unlike the missing-property case above");
});

// ---------------------------------------------------------------------------
// [16][17][18][19][20] AgentSession integration
// ---------------------------------------------------------------------------

async function eventsFor(store: ReturnType<typeof createInMemoryAgentSessionStore>, conversationId: number): Promise<AgentSessionEvent[]> {
  const session = await store.loadSessionForConversation(conversationId);
  if (!session) return [];
  return store.loadRecentEvents({ sessionId: session.id });
}

test("session events: an accepted request emits REQUESTED, ACCEPTED, then COMPLETED", async () => {
  const store = createInMemoryAgentSessionStore();
  const opportunityId = uniqueOpportunityId();
  const request = baseRequest({
    actionType: "SELECT_PRODUCTS",
    input: { items: [{ productId: "501", quantity: 1 }] },
    conversationId: 555,
    opportunityId,
    correlationId: `corr-events-ok-${opportunityId}`
  } as Partial<CommercialActionRequest>);

  await executeCommercialActionRequest(request, gatewayContext(fakeSession(), opportunityId, request.correlationId), { sessionStore: store });

  const events = await eventsFor(store, 555);
  assert.deepEqual(
    events.map((event) => event.eventType),
    ["COMMERCIAL_ACTION_REQUESTED", "COMMERCIAL_ACTION_ACCEPTED", "COMMERCIAL_ACTION_COMPLETED"]
  );
});

test("session events: a rejected (identity-denied) request emits REQUESTED then REJECTED only - never ACCEPTED/COMPLETED", async () => {
  const store = createInMemoryAgentSessionStore();
  const opportunityId = uniqueOpportunityId();
  const request = baseRequest({
    actionType: "CREATE_QUOTE",
    input: {},
    conversationId: 556,
    opportunityId,
    correlationId: `corr-events-denied-${opportunityId}`
  } as Partial<CommercialActionRequest>);

  await executeCommercialActionRequest(request, gatewayContext(fakeSession(), opportunityId, request.correlationId), { sessionStore: store });

  const events = await eventsFor(store, 556);
  assert.deepEqual(events.map((event) => event.eventType), ["COMMERCIAL_ACTION_REQUESTED", "COMMERCIAL_ACTION_REJECTED"]);
});

test("session events: a structurally malformed request emits REQUESTED then REJECTED, never ACCEPTED", async () => {
  const store = createInMemoryAgentSessionStore();
  const request = baseRequest({ actionType: "SET_SHIPPING_DESTINATION", input: {} as never, conversationId: 557, correlationId: "corr-events-malformed" });

  await executeCommercialActionRequest(request, gatewayContext(fakeSession(), 42, request.correlationId), { sessionStore: store });

  const events = await eventsFor(store, 557);
  assert.deepEqual(events.map((event) => event.eventType), ["COMMERCIAL_ACTION_REQUESTED", "COMMERCIAL_ACTION_REJECTED"]);
});

test("session events: replaying the identical logical request is idempotent - the store's own dedupeKey collapses the repeat", async () => {
  const store = createInMemoryAgentSessionStore();
  const opportunityId = uniqueOpportunityId();
  const request = baseRequest({
    actionType: "SELECT_PRODUCTS",
    input: { items: [{ productId: "501", quantity: 1 }] },
    conversationId: 558,
    opportunityId,
    correlationId: `corr-events-replay-${opportunityId}`
  } as Partial<CommercialActionRequest>);

  await executeCommercialActionRequest(request, gatewayContext(fakeSession(), opportunityId, request.correlationId), { sessionStore: store });
  await executeCommercialActionRequest(request, gatewayContext(fakeSession(), opportunityId, request.correlationId), { sessionStore: store });

  const events = await eventsFor(store, 558);
  assert.deepEqual(
    events.map((event) => event.eventType),
    ["COMMERCIAL_ACTION_REQUESTED", "COMMERCIAL_ACTION_ACCEPTED", "COMMERCIAL_ACTION_COMPLETED"],
    "a replayed request must never produce a second REQUESTED/ACCEPTED/COMPLETED row"
  );
});

test("session event payloads carry no PII and no raw model output", async () => {
  const store = createInMemoryAgentSessionStore();
  const opportunityId = uniqueOpportunityId();
  const request = baseRequest({
    actionType: "SELECT_PRODUCTS",
    input: { items: [{ productId: "501", quantity: 1 }] },
    conversationId: 559,
    opportunityId,
    correlationId: `corr-events-pii-${opportunityId}`
  } as Partial<CommercialActionRequest>);

  await executeCommercialActionRequest(request, gatewayContext(fakeSession(), opportunityId, request.correlationId), { sessionStore: store });

  const events = await eventsFor(store, 559);
  const serialized = JSON.stringify(events.map((event) => event.payload));
  assert.doesNotMatch(serialized, /56911112222|wa_id|reasoning|prompt|raw_output/i);
  assert.deepEqual(Object.keys(events[0].payload).sort(), ["actionType", "opportunityId"]);
});

// ---------------------------------------------------------------------------
// [21] capability audit is still written for an accepted request
// ---------------------------------------------------------------------------

test("executeCommercialActionRequest: an accepted request still writes a crm_capability_executions audit row", async () => {
  const store = createInMemoryAgentSessionStore();
  const opportunityId = await seedOpportunity();
  const correlationId = `corr-audit-${opportunityId}`;
  const request = baseRequest({ actionType: "SELECT_PRODUCTS", input: { items: [{ productId: "501", quantity: 1 }] }, opportunityId, correlationId } as Partial<CommercialActionRequest>);

  const result = await executeCommercialActionRequest(request, gatewayContext(fakeSession(), opportunityId, correlationId), { sessionStore: store });
  assert.equal(result.status, "COMPLETED");
  assert.ok(result.gatewayResult.executionPublicId, "an executed request must have a real audit row id");

  const row = await loadExecutionRow(correlationId);
  assert.ok(row, "expected a crm_capability_executions row for an accepted, executed request");
  assert.equal(row!.capability_name, "select_products");
  assert.equal(row!.execution_status, "completed");
});
