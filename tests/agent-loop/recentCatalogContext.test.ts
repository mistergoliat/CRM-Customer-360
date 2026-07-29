import assert from "node:assert/strict";
import test from "node:test";
import {
  loadRecentCatalogContext,
  RECENT_CATALOG_CONTEXT_MAX_INTERACTIONS,
  RECENT_CATALOG_CONTEXT_SQL_CANDIDATE_LIMIT,
  RECENT_CATALOG_CONTEXT_MAX_PRODUCTS
} from "@/lib/brain/commercial/agent-loop/recentCatalogContext";

const CURRENT_TIME = "2026-07-28T16:00:00.000Z";

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
  assert.match(captured.sql, /e\.capability_name IN \('search_products', 'get_product_details', 'explore_catalog'\)/);
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

test("a productId already surfaced by a more recent interaction is deduplicated, never repeated across interactions", async () => {
  const result = await loadRecentCatalogContext({
    conversationId: 7,
    currentTime: CURRENT_TIME,
    dataAccess: {
      async queryRows() {
        return {
          ok: true,
          // Most recent first (matches the real query's ORDER BY completed_at DESC):
          // a later explore_catalog turn re-surfaces productId 101, already seen
          // in the earlier (but processed-second) search_products interaction.
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
                items: [{ productId: "101", name: "Barra olimpica 20 kg" }]
              })
            }),
            searchRow({ inbound_message_id: "msg-search-1", completed_at: "2026-07-28T15:55:00.000Z" })
          ]
        };
      }
    }
  });

  assert.equal(result.context.interactions.length, 2);
  assert.deepEqual(result.context.interactions[0].products, [{ position: 1, productId: "101", name: "Barra olimpica 20 kg" }]);
  // The second (older) interaction keeps 102/103, but never repeats 101 - it was already claimed by the more recent explore_catalog interaction.
  const secondInteractionIds = result.context.interactions[1].products.map((product) => product.productId);
  assert.deepEqual(secondInteractionIds, ["102", "103"]);
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
