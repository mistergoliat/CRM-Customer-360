import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { runAgentToolLoop } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { CapabilityEligibilitySnapshot } from "@/lib/brain/commercial/capability-eligibility/types";
import type { EnsureCommercialActionOpportunityInput } from "@/lib/brain/commercial/commercial-action-request/ensureCommercialActionOpportunity";

// SALES-AGENT-R3-P7.2 (Invocation Coherence Telemetry). DB-backed integration
// tests, same shared local-dev credentials/harness pattern as
// tests/agent-loop/runAgentToolLoop.test.ts (see that file's own comment) -
// ENVIRONMENT_BLOCKED without a reachable local MariaDB, same as the rest of
// that suite. These assert the commercial_event row this task adds, never
// re-asserting P7.1/P6.2's own already-covered contracts.

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
  DATABASE_URL: ""
});

let inboundSeq = Date.now();
function uniqueInboundMessageId() {
  inboundSeq += 1;
  return `p7-2-inbound-${inboundSeq}`;
}

async function loadInvocationObservedRows(inboundMessageId: string) {
  return queryRows<{ payload_json: string; dedupe_key: string }>(
    "SELECT payload_json, dedupe_key FROM commercial_event WHERE source_event_id = ? AND event_type = 'commercial_capability_invocation_observed' ORDER BY id ASC",
    [inboundMessageId]
  );
}

function parsePayload(row: { payload_json: string }) {
  return JSON.parse(row.payload_json) as Record<string, unknown>;
}

async function testOpportunityUnavailable(input: EnsureCommercialActionOpportunityInput) {
  if (input.existingOpportunityId !== null) {
    return { ok: true as const, opportunityId: input.existingOpportunityId, source: "existing" as const };
  }
  return { ok: false as const, reason: "test_fixture_opportunity_resolution_disabled" };
}

const baseInput = {
  correlationId: "corr-p7-2",
  conversationId: 1,
  opportunityId: null,
  currentTime: "2026-09-17T12:00:00.000Z",
  ensureOpportunity: testOpportunityUnavailable
};

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function productIntentResolvedPayload() {
  return {
    query: { original: "kettlebell", normalized: "kettlebell" },
    resolution: { status: "resolved", confidence: 0.92, sourceProduct: { productId: "501", combinationId: "1" } },
    candidates: [
      {
        product: {
          productId: "501",
          combinationId: "1",
          name: "Kettlebell 16kg",
          reference: "KB-16",
          description: "Kettlebell de fundicion 16kg.",
          price: null,
          stock: { status: "in_stock", available: true, quantity: 4 }
        },
        match: { rank: 1, score: 0.92, reasons: ["EXACT_NAME_MATCH"] }
      }
    ],
    statistics: { retrieved: 1, eligible: 1, returned: 1 },
    warnings: [],
    correlationId: "c"
  };
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let handler: Handler = (_req, res) => res.writeHead(500).end();

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  process.env.CATALOG_SERVICE_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.CATALOG_SERVICE_API_KEY = "test-key";
  resetCapabilityGatewayCatalogPortForTests();
  handler = (req, res) => {
    if (req.url === "/api/v2/catalog/resolve-product-intent" && req.method === "POST") {
      return sendJson(res, 200, productIntentResolvedPayload());
    }
    return sendJson(res, 404, { error: "not_found" });
  };
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures - test results already reported
  }
});

const SEARCH_PRODUCTS_ELIGIBLE_SNAPSHOT: CapabilityEligibilitySnapshot = {
  schemaVersion: "1",
  workId: "cw-p7-2",
  workVersion: 5,
  objectiveId: "obj-p7-2",
  objectiveType: "QUOTE",
  evaluatedAt: "2026-09-17T12:00:00.000Z",
  eligible: [{ capability: "search_products", status: "ELIGIBLE", reasonCodes: [], executionClass: "read_only" }],
  blocked: [],
  metadataVersion: "p6.2-b.1"
};

test("P7.2-A: ELIGIBLE snapshot + Gateway completed - eligibilityAtTurnStart/gateway/toolObservation all recorded coherently", async () => {
  const inboundMessageId = uniqueInboundMessageId();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "respond", message: "Esto es lo que encontre." }
    ]
  });

  await runAgentToolLoop({
    ...baseInput,
    inboundMessageId,
    workId: "cw-p7-2",
    workVersion: 5,
    objectiveId: "obj-p7-2",
    objectiveType: "QUOTE",
    preCognitionCapabilityEligibility: SEARCH_PRODUCTS_ELIGIBLE_SNAPSHOT,
    customerMessage: "Busco un kettlebell.",
    commercialContextSummary: {},
    provider
  });

  const rows = await loadInvocationObservedRows(inboundMessageId);
  assert.equal(rows.length, 1);
  const payload = parsePayload(rows[0]);
  assert.equal(payload.capability, "search_products");
  assert.equal(payload.stepIndex, 0);
  assert.equal(payload.workId, "cw-p7-2");
  assert.equal(payload.objectiveId, "obj-p7-2");
  assert.deepEqual(payload.eligibilityAtTurnStart, { status: "ELIGIBLE", reasonCodes: [], metadataVersion: "p6.2-b.1" });
  assert.equal((payload.gateway as Record<string, unknown>).status, "completed");
  assert.equal((payload.toolObservation as Record<string, unknown>).status, "completed");
});

test("P7.2-E: no eligibility snapshot this turn - eligibilityAtTurnStart is null, tool execution unaffected", async () => {
  const inboundMessageId = uniqueInboundMessageId();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "respond", message: "Esto es lo que encontre." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    inboundMessageId,
    customerMessage: "Busco un kettlebell.",
    commercialContextSummary: {},
    provider
  });

  assert.equal(result.steps[0].observation?.status, "completed");
  const rows = await loadInvocationObservedRows(inboundMessageId);
  assert.equal(rows.length, 1);
  assert.equal(parsePayload(rows[0]).eligibilityAtTurnStart, null);
});

test("P7.2-F: pre-Gateway duplicate rejection is recorded with gateway=null - never a fabricated Gateway outcome", async () => {
  const inboundMessageId = uniqueInboundMessageId();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "respond", message: "Esto es lo que encontre." }
    ]
  });

  await runAgentToolLoop({
    ...baseInput,
    inboundMessageId,
    customerMessage: "Busco un kettlebell.",
    commercialContextSummary: {},
    provider
  });

  const rows = await loadInvocationObservedRows(inboundMessageId);
  assert.equal(rows.length, 2, "one real Gateway execution plus one pre-Gateway duplicate rejection");
  const first = parsePayload(rows[0]);
  const second = parsePayload(rows[1]);
  assert.equal(first.stepIndex, 0);
  assert.equal((first.gateway as Record<string, unknown>).status, "completed");
  assert.equal(second.stepIndex, 1);
  assert.equal(second.gateway, null);
  assert.equal((second.toolObservation as Record<string, unknown>).errorCode, "duplicate_tool_call");
});

test("P7.2-G: an unregistered capability is recorded with gateway=null", async () => {
  const inboundMessageId = uniqueInboundMessageId();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "create_checkout_link", arguments: {} },
      { type: "respond", message: "No puedo hacer eso." }
    ]
  });

  await runAgentToolLoop({
    ...baseInput,
    inboundMessageId,
    customerMessage: "Cierra la compra ahora.",
    commercialContextSummary: {},
    provider
  });

  const rows = await loadInvocationObservedRows(inboundMessageId);
  assert.equal(rows.length, 1);
  const payload = parsePayload(rows[0]);
  assert.equal(payload.capability, "create_checkout_link");
  assert.equal(payload.gateway, null);
  assert.equal((payload.toolObservation as Record<string, unknown>).errorCode, "capability_not_registered");
});

test("P7.2-H: two distinct tool calls in the same turn record two distinct, individually addressable rows", async () => {
  const inboundMessageId = uniqueInboundMessageId();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell 24kg" } },
      { type: "respond", message: "Esto es lo que encontre." }
    ]
  });

  await runAgentToolLoop({
    ...baseInput,
    inboundMessageId,
    customerMessage: "Busco un kettlebell.",
    commercialContextSummary: {},
    provider
  });

  const rows = await loadInvocationObservedRows(inboundMessageId);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dedupe_key, `commercial-capability-invocation-observed:${inboundMessageId}:0:search_products`);
  assert.equal(rows[1].dedupe_key, `commercial-capability-invocation-observed:${inboundMessageId}:1:search_products`);
});

test("P7.2-K: no raw arguments/customer text leak into the recorded payload", async () => {
  const inboundMessageId = uniqueInboundMessageId();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "un producto muy especifico del cliente" } },
      { type: "respond", message: "Esto es lo que encontre." }
    ]
  });

  await runAgentToolLoop({
    ...baseInput,
    inboundMessageId,
    customerMessage: "un producto muy especifico del cliente",
    commercialContextSummary: {},
    provider
  });

  const rows = await loadInvocationObservedRows(inboundMessageId);
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].payload_json.includes("un producto muy especifico del cliente"));
});

test("P7.2-L: the model cannot spoof workId/objectiveId via tool arguments - the recorded row only reflects runtime-supplied trusted context", async () => {
  const inboundMessageId = uniqueInboundMessageId();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell", workId: "fake-spoofed-work", objectiveId: "fake-spoofed-objective" } },
      { type: "respond", message: "Esto es lo que encontre." }
    ]
  });

  await runAgentToolLoop({
    ...baseInput,
    inboundMessageId,
    workId: "cw-real",
    workVersion: 1,
    objectiveId: "obj-real",
    objectiveType: "QUOTE",
    customerMessage: "Busco un kettlebell.",
    commercialContextSummary: {},
    provider
  });

  const rows = await loadInvocationObservedRows(inboundMessageId);
  assert.equal(rows.length, 1);
  const payload = parsePayload(rows[0]);
  assert.equal(payload.workId, "cw-real");
  assert.equal(payload.objectiveId, "obj-real");
});
