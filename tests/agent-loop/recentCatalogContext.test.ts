import assert from "node:assert/strict";
import test from "node:test";
import {
  loadRecentCatalogContext,
  RECENT_CATALOG_CONTEXT_MAX_INTERACTIONS,
  RECENT_CATALOG_CONTEXT_SQL_CANDIDATE_LIMIT,
  RECENT_CATALOG_CONTEXT_MAX_PRODUCTS
} from "@/lib/brain/commercial/agent-loop/recentCatalogContext";

const CURRENT_TIME = "2026-07-28T16:00:00.000Z";

/** Recursive Object.freeze - a shallow freeze would leave nested arrays/objects (e.g. `items`) writable. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

type CapturedQuery = { sql: string; params: unknown[] };

function searchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    correlation_id: "corr-search",
    capability_name: "search_products",
    completed_at: "2026-07-28T15:55:00.000Z",
    inbound_message_id: "msg-search",
    response_summary_json: JSON.stringify({
      query: "barra",
      items: [
        {
          productId: "101",
          combinationId: "201",
          name: "Barra olimpica 20 kg",
          variantLabel: "20 kg",
          price: { amount: 129990 },
          stockQuantity: 3,
          availability: "in_stock",
          publicLink: { canonicalUrl: "https://example.test/barra" }
        },
        { productId: "102", combinationId: "202", name: "Barra tecnica", variantLabel: null },
        { productId: "103", name: "Barra Z" }
      ]
    }),
    ...overrides
  };
}

function detailsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    correlation_id: "corr-details",
    capability_name: "get_product_details",
    completed_at: "2026-07-28T15:50:00.000Z",
    inbound_message_id: "msg-details",
    response_summary_json: JSON.stringify({
      productId: "501",
      combinationId: "601",
      name: "Disco bumper 10 kg",
      price: { amount: 39990 },
      stockQuantity: 7,
      availability: "in_stock",
      publicLink: { canonicalUrl: "https://example.test/disco" }
    }),
    ...overrides
  };
}

test("search_products preserves positions and product identity only", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: { async queryRows() { return { ok: true, rows: [searchRow()] }; } }
  });

  assert.deepEqual(result.warnings, []);
  assert.equal(result.context.interactions.length, 1);
  assert.equal(result.context.interactions[0].inboundMessageId, "msg-search");
  assert.equal(result.context.interactions[0].sourceTool, "search_products");
  assert.deepEqual(result.context.interactions[0].products, [
    { position: 1, productId: "101", combinationId: "201", name: "Barra olimpica 20 kg", variantLabel: "20 kg" },
    { position: 2, productId: "102", combinationId: "202", name: "Barra tecnica", variantLabel: null },
    { position: 3, productId: "103", name: "Barra Z" }
  ]);

  const serialized = JSON.stringify(result.context);
  assert.doesNotMatch(serialized, /price|stock|availability|publicLink|canonicalUrl|129990/);
});

test("get_product_details creates one product interaction without commercial truth", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: { async queryRows() { return { ok: true, rows: [detailsRow()] }; } }
  });

  assert.equal(result.context.interactions.length, 1);
  assert.deepEqual(result.context.interactions[0].products, [
    { productId: "501", combinationId: "601", name: "Disco bumper 10 kg" }
  ]);
  const serialized = JSON.stringify(result.context);
  assert.doesNotMatch(serialized, /agentFinalMessage|39990|publicLink|stockQuantity|availability|https?:\/\//);
});

test("invalid payloads and rows without valid products are ignored with warnings", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [
            searchRow({ response_summary_json: "{bad json" }),
            detailsRow({ response_summary_json: JSON.stringify({ productId: "x" }) })
          ]
        };
      }
    }
  });

  assert.deepEqual(result.context.interactions, []);
  assert.ok(result.warnings.includes("recent_catalog_context_invalid_response_summary"));
  assert.ok(result.warnings.includes("recent_catalog_context_no_valid_products"));
});

test("first five invalid candidate rows do not hide a sixth valid interaction", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [
            searchRow({ response_summary_json: "{bad json" }),
            searchRow({ completed_at: null }),
            searchRow({ inbound_message_id: null }),
            searchRow({ response_summary_json: JSON.stringify({ items: [{ productId: "x" }] }) }),
            searchRow({ capability_name: "send_message" }),
            searchRow({ id: 6, inbound_message_id: "msg-sixth" })
          ]
        };
      }
    }
  });

  assert.equal(result.context.interactions.length, 1);
  assert.equal(result.context.interactions[0].inboundMessageId, "msg-sixth");
});

test("query failure degrades to an empty context", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: { async queryRows() { return { ok: false, rows: [], error: "db_down" }; } }
  });

  assert.deepEqual(result.context, { interactions: [] });
  assert.deepEqual(result.warnings, ["recent_catalog_context_query_failed:db_down"]);
});

test("query applies conversation, window and candidate limit without joining crm_agent_actions", async () => {
  let captured: CapturedQuery = { sql: "", params: [] };
  const manyRows = Array.from({ length: RECENT_CATALOG_CONTEXT_SQL_CANDIDATE_LIMIT }, (_, index) =>
    searchRow({
      id: index + 1,
      correlation_id: `corr-${index}`,
      inbound_message_id: `msg-${index}`,
      response_summary_json: JSON.stringify({
        items: Array.from({ length: 1 }, (_unused, productIndex) => ({
          productId: `${index}-${productIndex}`,
          name: `Producto ${index}-${productIndex}`
        }))
      })
    })
  );

  await loadRecentCatalogContext({
    conversationId: 99,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows(sql, params) {
        captured = { sql, params };
        return { ok: true, rows: manyRows };
      }
    }
  });

  assert.match(captured.sql, /e\.conversation_id = \?/);
  assert.match(captured.sql, /e\.capability_name IN \('search_products', 'get_product_details', 'explore_catalog', 'recommend_catalog_products'\)/);
  assert.match(captured.sql, /e\.execution_status = 'completed'/);
  assert.match(captured.sql, /e\.completed_at >= \?/);
  assert.equal(captured.params[0], 99);
  assert.equal(captured.params.at(-1), RECENT_CATALOG_CONTEXT_SQL_CANDIDATE_LIMIT);
  assert.doesNotMatch(captured.sql, /JOIN\s+crm_agent_actions/i);
});

test("multiple commercial_event rows for the same correlation_id cannot duplicate an execution", async () => {
  let captured: CapturedQuery = { sql: "", params: [] };
  await loadRecentCatalogContext({
    conversationId: 99,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows(sql, params) {
        captured = { sql, params };
        return { ok: true, rows: [searchRow()] };
      }
    }
  });

  assert.match(captured.sql, /COALESCE\(/);
  assert.match(captured.sql, /direct_event\.id = e\.commercial_event_id/);
  assert.match(captured.sql, /correlated_event\.correlation_id = e\.correlation_id/);
  assert.match(captured.sql, /ORDER BY correlated_event\.occurred_at DESC, correlated_event\.id DESC/);
  assert.match(captured.sql, /LIMIT 1/);
  assert.doesNotMatch(captured.sql, /LEFT\s+JOIN\s+commercial_event/i);
});

test("context keeps at most five valid interactions after validation", async () => {
  const rows = Array.from({ length: RECENT_CATALOG_CONTEXT_MAX_INTERACTIONS + 1 }, (_, index) =>
    searchRow({
      id: index + 1,
      inbound_message_id: `msg-${index + 1}`,
      response_summary_json: JSON.stringify({
        items: [{ productId: `p-${index + 1}`, name: `Producto ${index + 1}` }]
      })
    })
  );

  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: { async queryRows() { return { ok: true, rows }; } }
  });

  assert.equal(result.context.interactions.length, RECENT_CATALOG_CONTEXT_MAX_INTERACTIONS);
  assert.equal(result.context.interactions.at(-1)?.inboundMessageId, "msg-5");
});

test("context keeps at most twelve products across valid interactions", async () => {
  const rows = Array.from({ length: RECENT_CATALOG_CONTEXT_MAX_INTERACTIONS }, (_, index) =>
    searchRow({
      id: index + 1,
      inbound_message_id: `msg-${index + 1}`,
      response_summary_json: JSON.stringify({
        items: Array.from({ length: 4 }, (_unused, productIndex) => ({
          productId: `p-${index + 1}-${productIndex + 1}`,
          name: `Producto ${index + 1}-${productIndex + 1}`
        }))
      })
    })
  );

  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: { async queryRows() { return { ok: true, rows }; } }
  });

  const totalProducts = result.context.interactions.reduce((sum, interaction) => sum + interaction.products.length, 0);
  assert.equal(totalProducts, RECENT_CATALOG_CONTEXT_MAX_PRODUCTS);
});

function exploreRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    correlation_id: "corr-explore",
    capability_name: "explore_catalog",
    completed_at: "2026-07-28T15:58:00.000Z",
    inbound_message_id: "msg-explore",
    response_summary_json: JSON.stringify({
      scope: { availability: "available" },
      sort: { by: "price", direction: "asc" },
      totalMatched: 3,
      exhaustiveForScope: true,
      items: [
        { productId: "501", name: "Banca plana", price: 49990, currency: "CLP", stockQuantity: 5, stockScope: "product", availability: "available" },
        { productId: "502", name: "Banca ajustable", price: 69990, currency: "CLP", stockQuantity: 2, stockScope: "product", availability: "available" },
        { productId: "503", name: "Banca multifuncion", price: 89990, currency: "CLP", stockQuantity: 0, stockScope: "product_aggregate", availability: "out_of_stock" }
      ]
    }),
    ...overrides
  };
}

// --- ACS-R1-05.1-T02.6: explore_catalog as a RecentCatalogContext source ---

test("explore_catalog is captured as a valid source, preserving ranking position/productId/name only", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: { async queryRows() { return { ok: true, rows: [exploreRow()] }; } }
  });

  assert.deepEqual(result.warnings, []);
  assert.equal(result.context.interactions.length, 1);
  assert.equal(result.context.interactions[0].sourceTool, "explore_catalog");
  assert.equal(result.context.interactions[0].inboundMessageId, "msg-explore");
  assert.deepEqual(result.context.interactions[0].products, [
    { position: 1, productId: "501", name: "Banca plana" },
    { position: 2, productId: "502", name: "Banca ajustable" },
    { position: 3, productId: "503", name: "Banca multifuncion" }
  ]);

  const serialized = JSON.stringify(result.context);
  assert.doesNotMatch(serialized, /price|49990|69990|89990|stock|stockQuantity|stockScope|availability|exhaustiveForScope|totalMatched/i);
});

test("an identical productId+combinationId already surfaced by a more recent interaction is deduplicated, never repeated across interactions", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          // Most recent first (matches the real query's ORDER BY completed_at DESC):
          // a later explore_catalog turn re-surfaces the exact same productId+combinationId (101, no variant),
          // already seen in the earlier (but processed-second) search_products interaction's own bare-101 entry.
          rows: [
            exploreRow({
              id: 4,
              inbound_message_id: "msg-explore-2",
              completed_at: "2026-07-28T15:59:00.000Z",
              response_summary_json: JSON.stringify({
                scope: { availability: "available" },
                sort: { by: "price", direction: "asc" },
                totalMatched: 1,
                exhaustiveForScope: true,
                items: [{ productId: "103", name: "Barra Z" }]
              })
            }),
            searchRow({ inbound_message_id: "msg-search-1", completed_at: "2026-07-28T15:55:00.000Z" })
          ]
        };
      }
    }
  });

  assert.equal(result.context.interactions.length, 2);
  assert.deepEqual(result.context.interactions[0].products, [{ position: 1, productId: "103", name: "Barra Z" }]);
  // The second (older) interaction keeps 101/102 (both variant-specific, never seen before), but never repeats
  // 103 (no variant) - it was already claimed, with the exact same identity, by the more recent explore_catalog interaction.
  const secondInteractionIds = result.context.interactions[1].products.map((product) => product.productId);
  assert.deepEqual(secondInteractionIds, ["101", "102"]);
});

// CP-R1-T10B8D (post-audit fix). Before this fix, dedup was keyed by productId
// alone, so a bare-productId observation (explore_catalog here) would silently
// swallow a *different*, variant-specific observation of the same productId
// from another interaction - permanently losing that variant's identity from
// recentCatalogContext (and therefore from
// resolveObservedRecommendationSourceProduct's evidence pool). This is exactly
// the false-negative risk the audit flagged: a real, previously observed
// variant would read as "never observed" and be blocked.
test("a bare-productId observation never dedupes away a different, variant-specific observation of the same productId (and vice versa)", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [
            // More recent: explore_catalog observes productId 101 with no variant at all.
            exploreRow({
              id: 4,
              inbound_message_id: "msg-explore-2",
              completed_at: "2026-07-28T15:59:00.000Z",
              response_summary_json: JSON.stringify({
                scope: { availability: "available" },
                sort: { by: "price", direction: "asc" },
                totalMatched: 1,
                exhaustiveForScope: true,
                items: [{ productId: "101", name: "Barra olimpica 20 kg" }]
              })
            }),
            // Older: search_products observed the same productId 101, but a specific variant (combinationId 201).
            searchRow({ inbound_message_id: "msg-search-1", completed_at: "2026-07-28T15:55:00.000Z" })
          ]
        };
      }
    }
  });

  assert.equal(result.context.interactions.length, 2);
  assert.deepEqual(result.context.interactions[0].products, [{ position: 1, productId: "101", name: "Barra olimpica 20 kg" }]);
  // The older interaction's variant-specific 101/201 survives - it is different evidence, never collapsed
  // into the newer bare-101 entry.
  assert.deepEqual(result.context.interactions[1].products, [
    { position: 1, productId: "101", combinationId: "201", name: "Barra olimpica 20 kg", variantLabel: "20 kg" },
    { position: 2, productId: "102", combinationId: "202", name: "Barra tecnica", variantLabel: null },
    { position: 3, productId: "103", name: "Barra Z" }
  ]);
});

test("two distinct combinationIds of the same productId across interactions are both kept, never merged or dropped", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [
            detailsRow({
              id: 6,
              inbound_message_id: "msg-details-variant-a",
              completed_at: "2026-07-28T15:59:00.000Z",
              response_summary_json: JSON.stringify({ productId: "700", combinationId: "1", name: "Polera talla S" })
            }),
            detailsRow({
              id: 7,
              inbound_message_id: "msg-details-variant-b",
              completed_at: "2026-07-28T15:58:00.000Z",
              response_summary_json: JSON.stringify({ productId: "700", combinationId: "2", name: "Polera talla M" })
            })
          ]
        };
      }
    }
  });

  assert.equal(result.context.interactions.length, 2);
  assert.deepEqual(result.context.interactions[0].products, [{ productId: "700", combinationId: "1", name: "Polera talla S" }]);
  assert.deepEqual(result.context.interactions[1].products, [{ productId: "700", combinationId: "2", name: "Polera talla M" }]);
});

test("an interaction whose every candidate was already deduplicated is skipped with a distinct warning, not miscounted as invalid", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [
            exploreRow({
              response_summary_json: JSON.stringify({
                scope: { availability: "available" },
                sort: { by: "price", direction: "asc" },
                totalMatched: 1,
                exhaustiveForScope: true,
                items: [{ productId: "999", name: "Repetido" }]
              })
            }),
            exploreRow({
              id: 5,
              inbound_message_id: "msg-explore-older",
              completed_at: "2026-07-28T15:50:00.000Z",
              response_summary_json: JSON.stringify({
                scope: { availability: "available" },
                sort: { by: "price", direction: "asc" },
                totalMatched: 1,
                exhaustiveForScope: true,
                items: [{ productId: "999", name: "Repetido" }]
              })
            })
          ]
        };
      }
    }
  });

  assert.equal(result.context.interactions.length, 1);
  assert.ok(result.warnings.includes("recent_catalog_context_all_candidates_deduped"));
});

test("explore_catalog interactions respect the same MAX_INTERACTIONS/MAX_PRODUCTS limits as search_products", async () => {
  const rows = Array.from({ length: RECENT_CATALOG_CONTEXT_MAX_INTERACTIONS + 1 }, (_, index) =>
    exploreRow({
      id: index + 1,
      inbound_message_id: `msg-explore-${index + 1}`,
      completed_at: `2026-07-28T15:${59 - index}:00.000Z`,
      response_summary_json: JSON.stringify({
        scope: { availability: "available" },
        sort: { by: "price", direction: "asc" },
        totalMatched: 1,
        exhaustiveForScope: true,
        items: [{ productId: `explore-${index + 1}`, name: `Producto ${index + 1}` }]
      })
    })
  );

  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: { async queryRows() { return { ok: true, rows }; } }
  });

  assert.equal(result.context.interactions.length, RECENT_CATALOG_CONTEXT_MAX_INTERACTIONS);
});

test("adding explore_catalog does not change search_products or get_product_details behavior when mixed in the same window", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [
            // Deliberately non-colliding productIds (601-603) with searchRow's
            // 101/102/103 and detailsRow's 501 - this test proves plain
            // coexistence of the three sourceTools, not dedup (covered above).
            exploreRow({
              completed_at: "2026-07-28T15:58:00.000Z",
              response_summary_json: JSON.stringify({
                scope: { availability: "available" },
                sort: { by: "price", direction: "asc" },
                totalMatched: 3,
                exhaustiveForScope: true,
                items: [
                  { productId: "601", name: "Banca plana" },
                  { productId: "602", name: "Banca ajustable" },
                  { productId: "603", name: "Banca multifuncion" }
                ]
              })
            }),
            searchRow({ inbound_message_id: "msg-search-mixed", completed_at: "2026-07-28T15:55:00.000Z" }),
            detailsRow({ inbound_message_id: "msg-details-mixed", completed_at: "2026-07-28T15:50:00.000Z" })
          ]
        };
      }
    }
  });

  assert.equal(result.context.interactions.length, 3);
  assert.deepEqual(
    result.context.interactions.map((interaction) => interaction.sourceTool),
    ["explore_catalog", "search_products", "get_product_details"]
  );
  assert.deepEqual(result.context.interactions[1].products[0], { position: 1, productId: "101", combinationId: "201", name: "Barra olimpica 20 kg", variantLabel: "20 kg" });
  assert.deepEqual(result.context.interactions[2].products, [{ productId: "501", combinationId: "601", name: "Disco bumper 10 kg" }]);
});

test("contract never carries agent text, price, stock, availability or URL fields", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: { async queryRows() { return { ok: true, rows: [searchRow(), detailsRow()] }; } }
  });

  const serialized = JSON.stringify(result.context);
  assert.doesNotMatch(serialized, /agentFinalMessage|final_message|draft_message|Te envie|Te mostre/i);
  assert.doesNotMatch(serialized, /price|39990|129990|stock|stockQuantity|availability|publicLink|canonicalUrl|https?:\/\//i);
});

// --- CP-R1-T10B8D: recommend_catalog_products as a RecentCatalogContext source ---

function recommendation(productId: string, rank: number, overrides: Record<string, unknown> = {}) {
  return {
    product: { productId, name: `Recomendado ${productId}` },
    rank,
    score: 0.9 - rank * 0.05,
    commercialScore: 0.8,
    affinityScore: 0.5,
    reasons: [{ code: "STRONG_COMMERCIAL_RELEVANCE" }],
    ownership: { previouslyPurchased: false, exactVariantPreviouslyPurchased: false },
    warnings: [],
    ...overrides
  };
}

function recommendRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    correlation_id: "corr-recommend",
    capability_name: "recommend_catalog_products",
    completed_at: "2026-07-28T15:57:00.000Z",
    inbound_message_id: "msg-recommend",
    response_summary_json: JSON.stringify({
      status: "completed",
      customerMode: "generic",
      recommendations: [recommendation("801", 1), recommendation("802", 2)],
      excluded: [],
      warnings: [],
      personalization: { applied: false },
      execution: { degraded: false },
      statistics: {},
      snapshot: { id: "snap-1" },
      metadata: { recommendationCount: 2, degraded: false }
    }),
    ...overrides
  };
}

test("recommend_catalog_products completed candidates become a valid interaction, only productId/combinationId/name/variantLabel/position", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: { async queryRows() { return { ok: true, rows: [recommendRow()] }; } }
  });

  assert.deepEqual(result.warnings, []);
  assert.equal(result.context.interactions.length, 1);
  assert.equal(result.context.interactions[0].sourceTool, "recommend_catalog_products");
  assert.deepEqual(result.context.interactions[0].products, [
    { position: 1, productId: "801", name: "Recomendado 801" },
    { position: 2, productId: "802", name: "Recomendado 802" }
  ]);

  const serialized = JSON.stringify(result.context);
  assert.doesNotMatch(serialized, /score|rank|ownership|previouslyPurchased|reasons|warnings|snapshot|customerMode|personalization|statistics|execution|degraded/i);
});

test("recommend_catalog_products preserves combinationId when the candidate has one", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [
            recommendRow({
              response_summary_json: JSON.stringify({
                status: "completed",
                recommendations: [recommendation("801", 1, { product: { productId: "801", combinationId: "11", name: "Variante 801" } })],
                metadata: { recommendationCount: 1, degraded: false }
              })
            })
          ]
        };
      }
    }
  });

  assert.deepEqual(result.context.interactions[0].products, [{ position: 1, productId: "801", combinationId: "11", name: "Variante 801" }]);
});

test("recommend_catalog_products caps candidates at the same limit buildToolObservation projects to the model, even when the stored payload has more", async () => {
  const recommendations = Array.from({ length: 8 }, (_unused, index) => recommendation(`${900 + index}`, index + 1));
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return { ok: true, rows: [recommendRow({ response_summary_json: JSON.stringify({ status: "completed", recommendations, metadata: { recommendationCount: 8, degraded: false } }) })] };
      }
    }
  });

  assert.equal(result.context.interactions[0].products.length, 5);
  assert.deepEqual(
    result.context.interactions[0].products.map((product) => product.productId),
    ["900", "901", "902", "903", "904"]
  );
});

test("recommend_catalog_products degraded=true execution still registers its valid candidates", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [recommendRow({ response_summary_json: JSON.stringify({ status: "completed", recommendations: [recommendation("801", 1)], metadata: { recommendationCount: 1, degraded: true } }) })]
        };
      }
    }
  });

  assert.equal(result.context.interactions.length, 1);
  assert.deepEqual(result.context.interactions[0].products, [{ position: 1, productId: "801", name: "Recomendado 801" }]);
});

test("recommend_catalog_products empty recommendations produces no interaction", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return { ok: true, rows: [recommendRow({ response_summary_json: JSON.stringify({ status: "completed", recommendations: [], metadata: { recommendationCount: 0, degraded: false } }) })] };
      }
    }
  });

  assert.deepEqual(result.context.interactions, []);
  assert.ok(result.warnings.includes("recent_catalog_context_no_valid_products"));
});

test("recommend_catalog_products skipped payload produces no interaction", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return { ok: true, rows: [recommendRow({ response_summary_json: JSON.stringify({ status: "skipped", reason: "source_product_invalid" }) })] };
      }
    }
  });

  assert.deepEqual(result.context.interactions, []);
  assert.ok(result.warnings.includes("recent_catalog_context_no_valid_products"));
});

test("recommend_catalog_products coexists with search_products/get_product_details/explore_catalog in the same window", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [
            recommendRow(),
            searchRow({ inbound_message_id: "msg-search-mixed", completed_at: "2026-07-28T15:55:00.000Z" }),
            detailsRow({ inbound_message_id: "msg-details-mixed", completed_at: "2026-07-28T15:50:00.000Z" })
          ]
        };
      }
    }
  });

  assert.equal(result.context.interactions.length, 3);
  assert.deepEqual(
    result.context.interactions.map((interaction) => interaction.sourceTool),
    ["recommend_catalog_products", "search_products", "get_product_details"]
  );
});

// --- Immutability (post-audit, closure-audit Minor-2) ---
//
// `response_summary_json` is passed here as a real, deep-frozen object
// (rather than the JSON.stringify'd string every other test in this file
// uses) so any attempted mutation is both real (parseJsonRecord returns the
// same object reference for an already-parsed value) and immediately fatal
// (Object.freeze + strict-mode ESM throws a TypeError on write) - a passing
// test is proof, not assumption, that nothing here writes to its input.

test("does not mutate the interaction rows supplied by the data access layer", async () => {
  const rows = deepFreeze([
    {
      id: 1,
      correlation_id: "corr-search-immutable",
      capability_name: "search_products",
      completed_at: "2026-07-28T15:55:00.000Z",
      inbound_message_id: "msg-search-immutable",
      response_summary_json: { query: "barra", items: [{ productId: "101", combinationId: "201", name: "Barra olimpica" }] }
    },
    {
      id: 3,
      correlation_id: "corr-explore-immutable",
      capability_name: "explore_catalog",
      completed_at: "2026-07-28T15:58:00.000Z",
      inbound_message_id: "msg-explore-immutable",
      response_summary_json: { scope: {}, sort: {}, totalMatched: 1, exhaustiveForScope: true, items: [{ productId: "101", name: "Barra olimpica" }] }
    }
  ]);
  const snapshot = JSON.parse(JSON.stringify(rows));

  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: { async queryRows() { return { ok: true, rows }; } }
  });

  assert.equal(result.context.interactions.length, 2);
  assert.deepEqual(rows, snapshot, "the rows array/objects returned by the data access layer must never be mutated");
});

test("does not mutate the original product objects inside each interaction's payload", async () => {
  const originalItems = deepFreeze([
    { productId: "101", combinationId: "201", name: "Barra olimpica", variantLabel: "20 kg" },
    { productId: "102", name: "Barra tecnica" }
  ]);
  const itemsSnapshot = JSON.parse(JSON.stringify(originalItems));

  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [
            {
              id: 1,
              correlation_id: "corr-search-products-immutable",
              capability_name: "search_products",
              completed_at: "2026-07-28T15:55:00.000Z",
              inbound_message_id: "msg-search-products-immutable",
              response_summary_json: { query: "barra", items: originalItems }
            }
          ]
        };
      }
    }
  });

  assert.equal(result.context.interactions[0].products.length, 2);
  assert.deepEqual(originalItems, itemsSnapshot, "the original product objects/array must never be mutated");
});

test("the result's interactions and products are new arrays/objects, never the same references as the input", async () => {
  const originalItems = [{ productId: "101", combinationId: "201", name: "Barra olimpica" }];

  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [
            {
              id: 1,
              correlation_id: "corr-reference-check",
              capability_name: "search_products",
              completed_at: "2026-07-28T15:55:00.000Z",
              inbound_message_id: "msg-reference-check",
              response_summary_json: { query: "barra", items: originalItems }
            }
          ]
        };
      }
    }
  });

  const products = result.context.interactions[0].products;
  assert.notEqual(products, originalItems, "the products array must be a new array, not the same reference as the input items array");
  assert.notEqual(products[0] as unknown, originalItems[0], "each product must be a new object, not the same reference as the input item");
  assert.deepEqual(products[0], { position: 1, productId: "101", combinationId: "201", name: "Barra olimpica" });
});

test("deduplication (productId+combinationId) does not mutate the raw per-interaction product arrays it filters", async () => {
  const newerItems = deepFreeze([{ productId: "101", name: "Barra olimpica" }]);
  const olderItems = deepFreeze([
    { productId: "101", combinationId: "201", name: "Barra olimpica" },
    { productId: "102", name: "Barra tecnica" }
  ]);
  const newerSnapshot = JSON.parse(JSON.stringify(newerItems));
  const olderSnapshot = JSON.parse(JSON.stringify(olderItems));

  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          rows: [
            {
              id: 4,
              correlation_id: "corr-explore-dedup-immutable",
              capability_name: "explore_catalog",
              completed_at: "2026-07-28T15:59:00.000Z",
              inbound_message_id: "msg-explore-dedup-immutable",
              response_summary_json: { scope: {}, sort: {}, totalMatched: 1, exhaustiveForScope: true, items: newerItems }
            },
            {
              id: 1,
              correlation_id: "corr-search-dedup-immutable",
              capability_name: "search_products",
              completed_at: "2026-07-28T15:55:00.000Z",
              inbound_message_id: "msg-search-dedup-immutable",
              response_summary_json: { query: "barra", items: olderItems }
            }
          ]
        };
      }
    }
  });

  // Same collision scenario as the dedup tests above: newer bare-101 is kept, older variant-specific 101/201 survives too (different key).
  assert.deepEqual(
    result.context.interactions.map((interaction) => interaction.products.map((p) => p.productId)),
    [["101"], ["101", "102"]]
  );
  assert.deepEqual(newerItems, newerSnapshot, "dedup filtering must never mutate the raw newer-interaction product array");
  assert.deepEqual(olderItems, olderSnapshot, "dedup filtering must never mutate the raw older-interaction product array");
});
