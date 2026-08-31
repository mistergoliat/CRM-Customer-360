import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { createInMemoryAgentSessionStore } from "@/lib/brain/commercial/agent-session/inMemoryAgentSessionStore";
import type { AgentSessionEvent } from "@/lib/brain/commercial/agent-session/types";
import { buildReadToolRequestFromAtlStep } from "@/lib/brain/commercial/read-tool-request/atlAdapter";
import { buildReadToolRequestId } from "@/lib/brain/commercial/read-tool-request/requestIdentity";
import { executeReadTool } from "@/lib/brain/commercial/read-tool-request/executeReadTool";
import type { ReadToolRequest } from "@/lib/brain/commercial/read-tool-request/types";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway/types";

/**
 * SALES-AGENT-R3-A04. Tests for the ReadToolGateway boundary - the sole path
 * through which an agent-visible READ_TOOL capability may execute. Mirrors
 * the DB-backed integration pattern already established in
 * tests/commercial/commercialActionRequest.test.ts (A03).
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

function gatewayContext(conversationId: number | null, correlationId: string): CapabilityGatewayContext {
  return { correlationId, conversationId, opportunityId: null, trustedCustomerSession: null };
}

async function loadExecutionRow(correlationId: string) {
  const rows = await queryRows<Record<string, unknown>>("SELECT * FROM crm_capability_executions WHERE correlation_id = ? ORDER BY id DESC LIMIT 1", [correlationId]);
  return rows[0] ?? null;
}

async function eventsFor(store: ReturnType<typeof createInMemoryAgentSessionStore>, conversationId: number): Promise<AgentSessionEvent[]> {
  const session = await store.loadSessionForConversation(conversationId);
  if (!session) return [];
  return store.loadRecentEvents({ sessionId: session.id });
}

function baseRequest(overrides: Partial<ReadToolRequest> = {}): ReadToolRequest {
  return {
    requestId: "rtr_test",
    conversationId: 1,
    opportunityId: null,
    correlationId: "corr-read-tool",
    causationId: "wamid.1",
    tool: "search_company_knowledge",
    input: { query: "horario" },
    createdAt: "2026-08-31T12:00:00.000Z",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// [20] ATL adapter
// ---------------------------------------------------------------------------

test("a read-only ATL tool request adapts into a well-formed ReadToolRequest", () => {
  const request = buildReadToolRequestFromAtlStep({
    step: { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
    conversationId: 1,
    opportunityId: 42,
    correlationId: "corr-atl-read",
    inboundMessageId: "wamid.1"
  });
  assert.ok(request);
  assert.equal(request?.tool, "search_products");
  assert.equal(request?.conversationId, 1);
  assert.equal(request?.opportunityId, 42);
  assert.equal(request?.causationId, "wamid.1");
  assert.deepEqual(request?.input, { query: "kettlebell" });
});

test("a mutating (COMMERCIAL_ACTION) ATL tool request never becomes a ReadToolRequest", () => {
  const request = buildReadToolRequestFromAtlStep({
    step: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 1 }] } },
    conversationId: 1,
    opportunityId: 42,
    correlationId: "corr-atl-read-2",
    inboundMessageId: "wamid.2"
  });
  assert.equal(request, null);
});

test("a NOT_AGENT_EXPOSED tool never becomes a ReadToolRequest, even though it is registered and read_only", () => {
  const request = buildReadToolRequestFromAtlStep({
    step: { type: "use_tool", tool: "get_customer_purchase_history", arguments: {} },
    conversationId: 1,
    opportunityId: 42,
    correlationId: "corr-atl-read-3",
    inboundMessageId: "wamid.3"
  });
  assert.equal(request, null);
});

test("a null conversationId falls back to no ReadToolRequest (caller keeps calling the Gateway directly)", () => {
  const request = buildReadToolRequestFromAtlStep({
    step: { type: "use_tool", tool: "search_products", arguments: { query: "x" } },
    conversationId: null,
    opportunityId: null,
    correlationId: "corr-atl-read-4",
    inboundMessageId: "wamid.4"
  });
  assert.equal(request, null);
});

// ---------------------------------------------------------------------------
// deterministic requestId
// ---------------------------------------------------------------------------

test("the same logical read request always recomputes the same requestId, different input gets a different one", () => {
  const first = buildReadToolRequestId({ conversationId: 1, causationId: "wamid.1", tool: "search_products", input: { query: "a", limit: 5 } });
  const second = buildReadToolRequestId({ conversationId: 1, causationId: "wamid.1", tool: "search_products", input: { limit: 5, query: "a" } });
  const third = buildReadToolRequestId({ conversationId: 1, causationId: "wamid.1", tool: "search_products", input: { query: "b" } });
  assert.equal(first, second, "key order must not affect the id");
  assert.notEqual(first, third);
});

// ---------------------------------------------------------------------------
// [5][13(D)] a real read-only capability executes through the ReadToolGateway
// ---------------------------------------------------------------------------

test("executeReadTool: search_company_knowledge (read_only, no external dependency) completes and writes a real crm_capability_executions row", async () => {
  const store = createInMemoryAgentSessionStore();
  const request = baseRequest({ conversationId: 601, correlationId: "corr-read-completed" });

  const result = await executeReadTool(request, gatewayContext(601, request.correlationId), { sessionStore: store });

  assert.equal(result.status, "COMPLETED");
  assert.ok(result.data);
  assert.notEqual(result.gatewayResult.executionPublicId, null, "a completed read must reach the Gateway and be audited");

  const row = await loadExecutionRow(request.correlationId);
  assert.ok(row, "the real crm_capability_executions audit trail must cover read tools identically to actions");
  assert.equal(row?.capability_name, "search_company_knowledge");
});

// ---------------------------------------------------------------------------
// [6][28] a mutating capability can never execute through the ReadToolGateway
// ---------------------------------------------------------------------------

test("executeReadTool: a genuinely mutating capability (select_products) fails closed and never reaches the Gateway, even under a normal (correct) classification lookup", async () => {
  const store = createInMemoryAgentSessionStore();
  const request = baseRequest({ tool: "select_products", conversationId: 602, correlationId: "corr-read-mutating-blocked", input: { items: [{ productId: "501", quantity: 1 }] } });

  const result = await executeReadTool(request, gatewayContext(602, request.correlationId), { sessionStore: store });

  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.errorCode, "read_tool_not_exposed");
  assert.equal(result.gatewayResult.executionPublicId, null, "must never reach executeGovernedCapability - no mutation, no audit row for an actual execution");
});

// ---------------------------------------------------------------------------
// [7] critical invariant: even if classification says READ_TOOL, live
// governance still wins - the gateway fails closed automatically, never by
// convention
// ---------------------------------------------------------------------------

test("executeReadTool: a mutating capability is rejected even when the exposure classification (injected) incorrectly says READ_TOOL - governance is re-checked live, never trusted from the classification map", async () => {
  const store = createInMemoryAgentSessionStore();
  const request = baseRequest({ tool: "select_products", conversationId: 603, correlationId: "corr-read-governance-mismatch", input: { items: [{ productId: "501", quantity: 1 }] } });

  const result = await executeReadTool(request, gatewayContext(603, request.correlationId), {
    sessionStore: store,
    resolveExposure: () => "READ_TOOL"
  });

  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.errorCode, "capability_not_read_only");
  assert.equal(result.gatewayResult.executionPublicId, null, "must still never reach executeGovernedCapability despite the (wrong) classification override");
});

// ---------------------------------------------------------------------------
// unknown capability fails closed
// ---------------------------------------------------------------------------

test("executeReadTool: an unregistered tool name fails closed before the Gateway", async () => {
  const store = createInMemoryAgentSessionStore();
  const request = baseRequest({ tool: "totally_made_up_tool", conversationId: 604, correlationId: "corr-read-unknown", input: {} });

  const result = await executeReadTool(request, gatewayContext(604, request.correlationId), { sessionStore: store });

  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.gatewayResult.executionPublicId, null);
});

// ---------------------------------------------------------------------------
// schema validation is deliberately advisory, not blocking (see
// executeReadTool.ts's own Phase 4/11 comment for the regression evidence)
// ---------------------------------------------------------------------------

test("executeReadTool: malformed input (search_company_knowledge missing required query) is NOT re-validated here - it reaches the real capability, which owns that check with its own precise error code", async () => {
  const store = createInMemoryAgentSessionStore();
  const request = baseRequest({ tool: "search_company_knowledge", conversationId: 605, correlationId: "corr-read-schema-invalid", input: {} });

  const result = await executeReadTool(request, gatewayContext(605, request.correlationId), { sessionStore: store });

  assert.equal(result.errorCode, "query_required");
  assert.notEqual(result.gatewayResult.executionPublicId, null, "this must reach the real capability, not be rejected by this boundary's own schema layer");
});

test("executeReadTool: a no-argument tool (calculate_shipping) with an empty object reaches the real capability", async () => {
  const store = createInMemoryAgentSessionStore();
  const request = baseRequest({ tool: "calculate_shipping", conversationId: 606, correlationId: "corr-read-noargs", input: {} });

  const result = await executeReadTool(request, gatewayContext(606, request.correlationId), { sessionStore: store });

  // No opportunity in this gatewayContext, so the real capability itself
  // denies with no_active_opportunity - proof this reached execute().
  assert.equal(result.errorCode, "no_active_opportunity");
  assert.notEqual(result.gatewayResult.executionPublicId, null);
});

// ---------------------------------------------------------------------------
// AgentSession integration
// ---------------------------------------------------------------------------

test("session events: a completed read emits READ_TOOL_REQUESTED then READ_TOOL_COMPLETED", async () => {
  const store = createInMemoryAgentSessionStore();
  const request = baseRequest({ conversationId: 607, correlationId: "corr-read-events-ok" });

  await executeReadTool(request, gatewayContext(607, request.correlationId), { sessionStore: store });

  const events = await eventsFor(store, 607);
  assert.deepEqual(events.map((event) => event.eventType), ["READ_TOOL_REQUESTED", "READ_TOOL_COMPLETED"]);
});

test("session events: a rejected read (not exposed) emits READ_TOOL_REQUESTED then READ_TOOL_FAILED only", async () => {
  const store = createInMemoryAgentSessionStore();
  const request = baseRequest({ tool: "select_products", conversationId: 608, correlationId: "corr-read-events-rejected", input: { items: [] } });

  await executeReadTool(request, gatewayContext(608, request.correlationId), { sessionStore: store });

  const events = await eventsFor(store, 608);
  assert.deepEqual(events.map((event) => event.eventType), ["READ_TOOL_REQUESTED", "READ_TOOL_FAILED"]);
});

test("session event payloads carry no PII and no raw model output", async () => {
  const store = createInMemoryAgentSessionStore();
  const request = baseRequest({ conversationId: 609, correlationId: "corr-read-events-pii", input: { query: "telefono contacto 56911112222" } });

  await executeReadTool(request, gatewayContext(609, request.correlationId), { sessionStore: store });

  const events = await eventsFor(store, 609);
  const serialized = JSON.stringify(events.map((event) => event.payload));
  assert.doesNotMatch(serialized, /56911112222|reasoning|prompt|raw_output/i);
  assert.deepEqual(Object.keys(events[0].payload).sort(), ["opportunityId", "tool"]);
});
