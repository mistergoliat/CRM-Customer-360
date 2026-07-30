import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeExecute, safeQueryRows } from "@/lib/db";
import {
  loadPendingCatalogAction,
  normalizePendingCatalogActionForEvidence
} from "@/lib/brain/commercial/agent-loop/pendingCatalogAction";
import { normalizeAgentToolLoopCompletedCommercialEvent, recordCommercialEvent } from "@/lib/brain/commercial/events";

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

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function eventRow(payload: Record<string, unknown>) {
  return { payload_json: JSON.stringify(payload) };
}

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function baseAgentToolLoopEvent(input: {
  conversationId: number;
  inboundMessageId: string;
  pendingCatalogAction?: { actionType: "send_product_link"; candidateProductIds: string[] };
}) {
  return normalizeAgentToolLoopCompletedCommercialEvent({
    inboundMessageId: input.inboundMessageId,
    terminalReason: "responded",
    decisionCount: 1,
    toolExecutionCount: 0,
    toolsUsed: [],
    finalMessagePresent: true,
    handoffReasonPresent: false,
    stepsSummary: [],
    correlationId: `corr-${input.inboundMessageId}`,
    conversationId: input.conversationId,
    opportunityId: null,
    configurationSource: "safe_default",
    configurationRecordId: null,
    configurationVersion: null,
    configurationHash: null,
    effectiveModel: "brain-agent-loop",
    effectiveTemperature: 0,
    effectiveMaxOutputSize: null,
    effectiveTimeoutMs: 20000,
    effectiveMaxAgentStepsPerTurn: 3,
    effectiveMaxToolCallsPerTurn: 2,
    ...(input.pendingCatalogAction ? { pendingCatalogAction: input.pendingCatalogAction } : {})
  });
}

async function persistEventAt(event: ReturnType<typeof baseAgentToolLoopEvent>, createdAt: string) {
  const result = await recordCommercialEvent(event);
  assert.equal(result.ok, true);
  const updated = await safeExecute("UPDATE commercial_event SET created_at = ? WHERE id = ?", [createdAt, event.id]);
  assert.ok(updated.ok, updated.ok ? "" : updated.error);
}

async function countAgentToolLoopEventsByInboundMessageId(inboundMessageId: string) {
  const rows = await safeQueryRows<{ count: number | string | bigint }>(
    "SELECT COUNT(*) AS count FROM commercial_event WHERE event_type = 'agent_tool_loop_completed' AND source_event_id = ?",
    [inboundMessageId]
  );
  assert.ok(rows.ok, rows.ok ? "" : rows.error);
  return Number(rows.rows[0]?.count ?? 0);
}

test("returns null with no warnings when the conversation has no agent_tool_loop_completed row", async () => {
  const result = await loadPendingCatalogAction({
    conversationId: 7,
    dataAccess: { async queryRows() { return { ok: true, rows: [] }; } }
  });
  assert.equal(result.pendingCatalogAction, null);
  assert.deepEqual(result.warnings, []);
});

test("reads pendingCatalogAction from the most recent event row's payload", async () => {
  let capturedSql = "";
  let capturedParams: unknown[] = [];
  const result = await loadPendingCatalogAction({
    conversationId: 7,
    dataAccess: {
      async queryRows(sql, params) {
        capturedSql = sql;
        capturedParams = params;
        return {
          ok: true,
          rows: [eventRow({ pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["80", "2164"] } })]
        };
      }
    }
  });

  assert.match(capturedSql, /agent_tool_loop_completed/);
  assert.match(capturedSql, /ORDER BY created_at DESC, id DESC/);
  assert.deepEqual(capturedParams, ["7"]);
  assert.deepEqual(result.pendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["80", "2164"] });
  assert.deepEqual(result.warnings, ["pending_catalog_action_loaded:send_product_link:candidateCount=2"]);
});

test("returns null when the most recent row's payload has no pendingCatalogAction", async () => {
  const result = await loadPendingCatalogAction({
    conversationId: 7,
    dataAccess: { async queryRows() { return { ok: true, rows: [eventRow({ terminalReason: "responded" })] }; } }
  });
  assert.equal(result.pendingCatalogAction, null);
  assert.deepEqual(result.warnings, []);
});

test("ignores a malformed pendingCatalogAction payload (unknown actionType, empty candidates, non-array)", async () => {
  const unknownType = await loadPendingCatalogAction({
    conversationId: 7,
    dataAccess: {
      async queryRows() {
        return { ok: true, rows: [eventRow({ pendingCatalogAction: { actionType: "compare_products", candidateProductIds: ["80"] } })] };
      }
    }
  });
  assert.equal(unknownType.pendingCatalogAction, null);

  const emptyCandidates = await loadPendingCatalogAction({
    conversationId: 7,
    dataAccess: {
      async queryRows() {
        return { ok: true, rows: [eventRow({ pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: [] } })] };
      }
    }
  });
  assert.equal(emptyCandidates.pendingCatalogAction, null);

  const notArray = await loadPendingCatalogAction({
    conversationId: 7,
    dataAccess: {
      async queryRows() {
        return { ok: true, rows: [eventRow({ pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: "80" } })] };
      }
    }
  });
  assert.equal(notArray.pendingCatalogAction, null);
});

test("query failure degrades to null with a warning, never throws", async () => {
  const result = await loadPendingCatalogAction({
    conversationId: 7,
    dataAccess: { async queryRows() { return { ok: false, rows: [], error: "ECONNREFUSED" }; } }
  });
  assert.equal(result.pendingCatalogAction, null);
  assert.deepEqual(result.warnings, ["pending_catalog_action_query_failed:ECONNREFUSED"]);
});

test("invalid conversationId short-circuits without querying", async () => {
  let called = false;
  const result = await loadPendingCatalogAction({
    conversationId: -1,
    dataAccess: {
      async queryRows() {
        called = true;
        return { ok: true, rows: [] };
      }
    }
  });
  assert.equal(called, false);
  assert.deepEqual(result.warnings, ["pending_catalog_action_invalid_input"]);
});

test("DB: newer event without pendingCatalogAction invalidates an older pending action", async () => {
  const conversationId = 991001;
  await persistEventAt(
    baseAgentToolLoopEvent({
      conversationId,
      inboundMessageId: `msg-${uniqueSuffix("old-with-pending")}`,
      pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["80"] }
    }),
    "2026-01-01 10:00:00.000"
  );
  await persistEventAt(
    baseAgentToolLoopEvent({
      conversationId,
      inboundMessageId: `msg-${uniqueSuffix("new-without-pending")}`
    }),
    "2026-01-01 10:00:01.000"
  );

  const loaded = await loadPendingCatalogAction({ conversationId });
  assert.equal(loaded.pendingCatalogAction, null);
});

test("DB: newer event with pendingCatalogAction is loaded over an older event without one", async () => {
  const conversationId = 991002;
  await persistEventAt(
    baseAgentToolLoopEvent({
      conversationId,
      inboundMessageId: `msg-${uniqueSuffix("old-without-pending")}`
    }),
    "2026-01-01 11:00:00.000"
  );
  await persistEventAt(
    baseAgentToolLoopEvent({
      conversationId,
      inboundMessageId: `msg-${uniqueSuffix("new-with-pending")}`,
      pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["2164"] }
    }),
    "2026-01-01 11:00:01.000"
  );

  const loaded = await loadPendingCatalogAction({ conversationId });
  assert.deepEqual(loaded.pendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["2164"] });
});

test("DB: identical created_at values use id DESC as a deterministic tie breaker", async () => {
  const conversationId = 991003;
  const first = baseAgentToolLoopEvent({
    conversationId,
    inboundMessageId: `msg-a-${uniqueSuffix("tie")}`,
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["80"] }
  });
  const second = baseAgentToolLoopEvent({
    conversationId,
    inboundMessageId: `msg-z-${uniqueSuffix("tie")}`,
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["2164"] }
  });
  const tieIdSuffix = Date.now().toString(16).padStart(31, "0").slice(0, 31);
  first.id = `cevt_1${tieIdSuffix}`;
  second.id = `cevt_2${tieIdSuffix}`;
  const createdAt = "2026-01-01 12:00:00.000";
  await persistEventAt(first, createdAt);
  await persistEventAt(second, createdAt);

  const loaded = await loadPendingCatalogAction({ conversationId });
  assert.deepEqual(loaded.pendingCatalogAction?.candidateProductIds, ["2164"]);
});

test("DB: one-turn sequence N persists, N+1 consumes, N+2 does not revive the older pending action", async () => {
  const conversationId = Number(`${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-9));
  const turnNInboundMessageId = `msg-${uniqueSuffix("one-turn-n")}`;
  const turnNPlusOneInboundMessageId = `msg-${uniqueSuffix("one-turn-n1")}`;
  await persistEventAt(
    baseAgentToolLoopEvent({
      conversationId,
      inboundMessageId: turnNInboundMessageId,
      pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] }
    }),
    "2026-01-01 13:00:00.000"
  );

  const loadedAfterTurnN = await loadPendingCatalogAction({ conversationId });
  assert.deepEqual(loadedAfterTurnN.pendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["501"] });

  await persistEventAt(
    baseAgentToolLoopEvent({
      conversationId,
      inboundMessageId: turnNPlusOneInboundMessageId
    }),
    "2026-01-01 13:00:01.000"
  );

  const loadedAfterTurnNPlusOne = await loadPendingCatalogAction({ conversationId });
  assert.equal(loadedAfterTurnNPlusOne.pendingCatalogAction, null);

  const loadedAtTurnNPlusTwo = await loadPendingCatalogAction({ conversationId });
  assert.equal(loadedAtTurnNPlusTwo.pendingCatalogAction, null);
  assert.equal(await countAgentToolLoopEventsByInboundMessageId(turnNInboundMessageId), 1, "the original pending event still exists");
  assert.equal(await countAgentToolLoopEventsByInboundMessageId(turnNPlusOneInboundMessageId), 1, "the consuming event exists and is newer");
});

test("normalizes candidates by trimming, deduplicating, preserving order and intersecting with RecentCatalogContext", () => {
  const result = normalizePendingCatalogActionForEvidence({
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["80", " 80 ", "999", "2164"] },
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-1",
          completedAt: "2026-01-01T00:00:00.000Z",
          sourceTool: "search_products",
          products: [
            { position: 1, productId: "80", name: "Magnesio" },
            { position: 2, productId: "2164", name: "Otro" }
          ]
        }
      ]
    },
    toolObservations: [],
    correlationId: "corr-normalize"
  });

  assert.deepEqual(result.pendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["80", "2164"] });
  assert.ok(result.warnings.some((warning) => warning.startsWith("pending_catalog_action_sanitized:send_product_link:")));
});

test("drops the pending action when every candidate is outside the allowed evidence", () => {
  const result = normalizePendingCatalogActionForEvidence({
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["999"] },
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-1",
          completedAt: "2026-01-01T00:00:00.000Z",
          sourceTool: "search_products",
          products: [{ position: 1, productId: "80", name: "Magnesio" }]
        }
      ]
    },
    toolObservations: [],
    correlationId: "corr-drop"
  });

  assert.equal(result.pendingCatalogAction, undefined);
  assert.ok(result.warnings.some((warning) => warning.startsWith("pending_catalog_action_dropped_no_candidates:send_product_link:")));
});

test("collects allowed candidates from search_products, explore_catalog and get_product_details observations", () => {
  const result = normalizePendingCatalogActionForEvidence({
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501", "1532", "777", "999"] },
    recentCatalogContext: null,
    toolObservations: [
      { tool: "search_products", status: "completed", data: { items: [{ productId: "501", name: "Kettlebell" }] } },
      { tool: "explore_catalog", status: "completed", data: { products: [{ productId: "1532", name: "Camara" }] } },
      { tool: "get_product_details", status: "completed", data: { productId: "777", name: "Barra" } }
    ],
    correlationId: "corr-observations"
  });

  assert.deepEqual(result.pendingCatalogAction?.candidateProductIds, ["501", "1532", "777"]);
});

test("caps normalized candidates at 20 after evidence intersection", () => {
  const ids = Array.from({ length: 25 }, (_, index) => `p-${index}`);
  const result = normalizePendingCatalogActionForEvidence({
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ids },
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-1",
          completedAt: "2026-01-01T00:00:00.000Z",
          sourceTool: "search_products",
          products: ids.map((productId, index) => ({ position: index + 1, productId, name: `Producto ${index}` }))
        }
      ]
    },
    toolObservations: []
  });

  assert.equal(result.pendingCatalogAction?.candidateProductIds.length, 20);
  assert.deepEqual(result.pendingCatalogAction?.candidateProductIds.slice(0, 3), ["p-0", "p-1", "p-2"]);
});
