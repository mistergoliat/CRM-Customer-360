import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeExecute, safeQueryRows } from "@/lib/db";
import {
  buildPendingCatalogActionFromRecommendation,
  loadPendingCatalogAction,
  matchesPendingCatalogActionCandidate,
  normalizePendingCatalogActionForEvidence
} from "@/lib/brain/commercial/agent-loop/pendingCatalogAction";
import type { ToolObservation } from "@/lib/brain/commercial/agent-loop/agentStepTypes";
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

/** Recursive Object.freeze - a shallow freeze would leave nested arrays/objects writable. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
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

test("CP-R1-T10B8D: collects allowed candidates from a recommend_catalog_products observation too, same treatment as the other catalog tools", () => {
  const result = normalizePendingCatalogActionForEvidence({
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["801", "802", "999"] },
    recentCatalogContext: null,
    toolObservations: [
      {
        tool: "recommend_catalog_products",
        status: "completed",
        data: { recommendations: [{ productId: "801", name: "Recomendado 801", rank: 1, score: 0.9 }, { productId: "802", name: "Recomendado 802", rank: 2, score: 0.8 }] }
      }
    ],
    correlationId: "corr-recommend-observations"
  });

  assert.deepEqual(result.pendingCatalogAction?.candidateProductIds, ["801", "802"]);
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

// --- CP-R1-T10B8D: get_product_details continuity ---

function recommendationObservation(recommendations: Array<{ productId: string; combinationId?: string; name?: string }>, overrides: Partial<ToolObservation> = {}): ToolObservation {
  return {
    tool: "recommend_catalog_products",
    status: "completed",
    data: { recommendations: recommendations.map((r) => ({ name: "Producto", rank: 1, score: 0.5, ...r })) },
    ...overrides
  };
}

test("buildPendingCatalogActionFromRecommendation: completed with candidates builds candidateProductIds and candidateProducts, order preserved", () => {
  const result = buildPendingCatalogActionFromRecommendation(recommendationObservation([{ productId: "801" }, { productId: "802", combinationId: "11" }]));
  assert.deepEqual(result, {
    actionType: "send_product_link",
    candidateProductIds: ["801", "802"],
    candidateProducts: [{ productId: "801" }, { productId: "802", combinationId: "11" }]
  });
});

test("buildPendingCatalogActionFromRecommendation: never carries score, rank, ownership, or any field beyond productId/combinationId", () => {
  const result = buildPendingCatalogActionFromRecommendation({
    tool: "recommend_catalog_products",
    status: "completed",
    data: {
      recommendations: [
        { productId: "801", name: "X", rank: 1, score: 0.9, ownership: { previouslyPurchased: true }, reasons: ["STRONG_COMMERCIAL_RELEVANCE"] }
      ]
    }
  });
  assert.deepEqual(result, { actionType: "send_product_link", candidateProductIds: ["801"], candidateProducts: [{ productId: "801" }] });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /score|rank|ownership|previouslyPurchased|reasons/i);
});

test("buildPendingCatalogActionFromRecommendation: empty recommendations returns null", () => {
  assert.equal(buildPendingCatalogActionFromRecommendation(recommendationObservation([])), null);
});

test("buildPendingCatalogActionFromRecommendation: skipped/failed/blocked observations return null", () => {
  assert.equal(buildPendingCatalogActionFromRecommendation({ tool: "recommend_catalog_products", status: "skipped", reason: "source_product_invalid" }), null);
  assert.equal(buildPendingCatalogActionFromRecommendation({ tool: "recommend_catalog_products", status: "failed", errorCode: "catalog_service_error" }), null);
  assert.equal(buildPendingCatalogActionFromRecommendation({ tool: "recommend_catalog_products", status: "blocked", errorCode: "source_product_not_observed" }), null);
});

test("buildPendingCatalogActionFromRecommendation: a different tool's completed observation returns null", () => {
  assert.equal(buildPendingCatalogActionFromRecommendation({ tool: "search_products", status: "completed", data: { items: [] } }), null);
});

test("buildPendingCatalogActionFromRecommendation: deduplicates repeated productIds", () => {
  const result = buildPendingCatalogActionFromRecommendation(recommendationObservation([{ productId: "801" }, { productId: "801" }, { productId: "802" }]));
  assert.deepEqual(result?.candidateProductIds, ["801", "802"]);
});

test("matchesPendingCatalogActionCandidate: exact productId, no combinationId on either side matches", () => {
  assert.equal(matchesPendingCatalogActionCandidate({ productId: "501" }, { productId: "501" }), true);
});

test("matchesPendingCatalogActionCandidate: different productId never matches", () => {
  assert.equal(matchesPendingCatalogActionCandidate({ productId: "501" }, { productId: "502" }), false);
});

test("matchesPendingCatalogActionCandidate: candidate with combinationId requires an exact combinationId match", () => {
  assert.equal(matchesPendingCatalogActionCandidate({ productId: "501", combinationId: "10" }, { productId: "501", combinationId: "10" }), true);
  assert.equal(matchesPendingCatalogActionCandidate({ productId: "501", combinationId: "10" }, { productId: "501", combinationId: "11" }), false);
});

test("matchesPendingCatalogActionCandidate: a bare productId request never matches a variant-specific candidate", () => {
  assert.equal(matchesPendingCatalogActionCandidate({ productId: "501", combinationId: "10" }, { productId: "501" }), false);
});

test("matchesPendingCatalogActionCandidate: candidate without combinationId matches any requested combinationId - never fabricates a variant", () => {
  assert.equal(matchesPendingCatalogActionCandidate({ productId: "501" }, { productId: "501", combinationId: "10" }), true);
});

// --- Immutability (post-audit, closure-audit Minor-2) ---
//
// Fixtures are deep-frozen where the function under test only ever needs to
// read them - Object.freeze + strict-mode ESM turns any attempted write into
// an immediate TypeError, so a passing test is proof, not assumption, that
// nothing here mutates its input.

test("buildPendingCatalogActionFromRecommendation: creation does not mutate the input observation", () => {
  const observation = deepFreeze(recommendationObservation([{ productId: "801" }, { productId: "802", combinationId: "11" }]));
  const snapshot = JSON.parse(JSON.stringify(observation));

  const result = buildPendingCatalogActionFromRecommendation(observation);

  assert.ok(result);
  assert.deepEqual(observation, snapshot, "the input ToolObservation must never be mutated by creation");
});

test("buildPendingCatalogActionFromRecommendation: renewal (a later call for a different recommendation) never mutates an earlier call's result", () => {
  const first = buildPendingCatalogActionFromRecommendation(recommendationObservation([{ productId: "801" }]));
  const firstSnapshot = JSON.parse(JSON.stringify(first));

  const second = buildPendingCatalogActionFromRecommendation(recommendationObservation([{ productId: "900", combinationId: "5" }]));

  assert.deepEqual(first, firstSnapshot, "an earlier action must be unaffected by building a later, unrelated one - no shared mutable state");
  assert.deepEqual(second, { actionType: "send_product_link", candidateProductIds: ["900"], candidateProducts: [{ productId: "900", combinationId: "5" }] });
});

test("matchesPendingCatalogActionCandidate: consumption check never mutates candidateProductIds or candidateProducts", () => {
  const pendingCatalogAction = deepFreeze({
    actionType: "send_product_link" as const,
    candidateProductIds: ["801", "802"],
    candidateProducts: [{ productId: "801" }, { productId: "802", combinationId: "11" }]
  });
  const snapshot = JSON.parse(JSON.stringify(pendingCatalogAction));

  // Same shape as runAgentToolLoop.ts's own consumption check: `.some()` over `candidateProducts`.
  const matched = pendingCatalogAction.candidateProducts.some((candidate) => matchesPendingCatalogActionCandidate(candidate, { productId: "802", combinationId: "11" }));

  assert.equal(matched, true);
  assert.deepEqual(pendingCatalogAction, snapshot, "checking a candidate for consumption must never mutate candidateProductIds or candidateProducts");
});

test("buildPendingCatalogActionFromRecommendation: mutating the returned action never alters the original observation's recommendations (result uses new arrays/objects)", () => {
  const observation = recommendationObservation([{ productId: "801" }, { productId: "802", combinationId: "11" }]);
  const originalRecommendations = (observation.data as { recommendations: unknown[] }).recommendations;
  const originalSnapshot = JSON.parse(JSON.stringify(originalRecommendations));

  const result = buildPendingCatalogActionFromRecommendation(observation)!;
  result.candidateProductIds.push("999");
  result.candidateProducts![0].productId = "corrupted";
  result.candidateProducts!.push({ productId: "999" });

  assert.deepEqual(originalRecommendations, originalSnapshot, "mutating the result must never alter the original observation fixture");
});

test("legacy compatibility: an event with candidateProductIds but no candidateProducts still loads (pre-T10B8D payload)", async () => {
  const result = await loadPendingCatalogAction({
    conversationId: 7,
    dataAccess: {
      async queryRows() {
        return { ok: true, rows: [{ payload_json: JSON.stringify({ pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["80", "2164"] } }) }] };
      }
    }
  });
  assert.deepEqual(result.pendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["80", "2164"] });
  assert.equal("candidateProducts" in (result.pendingCatalogAction ?? {}), false);
});

test("loadPendingCatalogAction parses candidateProducts when present, preserving combinationId", async () => {
  const result = await loadPendingCatalogAction({
    conversationId: 7,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [
            {
              payload_json: JSON.stringify({
                pendingCatalogAction: {
                  actionType: "send_product_link",
                  candidateProductIds: ["801", "802"],
                  candidateProducts: [{ productId: "801" }, { productId: "802", combinationId: "11" }]
                }
              })
            }
          ]
        };
      }
    }
  });
  assert.deepEqual(result.pendingCatalogAction, {
    actionType: "send_product_link",
    candidateProductIds: ["801", "802"],
    candidateProducts: [{ productId: "801" }, { productId: "802", combinationId: "11" }]
  });
});

test("loadPendingCatalogAction drops candidateProducts entries whose productId is not in candidateProductIds (defense in depth)", async () => {
  const result = await loadPendingCatalogAction({
    conversationId: 7,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [
            {
              payload_json: JSON.stringify({
                pendingCatalogAction: {
                  actionType: "send_product_link",
                  candidateProductIds: ["801"],
                  candidateProducts: [{ productId: "801" }, { productId: "999" }]
                }
              })
            }
          ]
        };
      }
    }
  });
  assert.deepEqual(result.pendingCatalogAction?.candidateProducts, [{ productId: "801" }]);
});
