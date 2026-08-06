import { safeQueryRows } from "@/lib/db";
import { MAX_RECOMMENDATIONS } from "./buildToolObservation";

export const RECENT_CATALOG_CONTEXT_SQL_CANDIDATE_LIMIT = 20;
export const RECENT_CATALOG_CONTEXT_MAX_INTERACTIONS = 5;
export const RECENT_CATALOG_CONTEXT_MAX_PRODUCTS = 12;
export const RECENT_CATALOG_CONTEXT_WINDOW_HOURS = 24;

export type RecentCatalogContextProduct = {
  position?: number;
  productId: string;
  combinationId?: string;
  name: string;
  variantLabel?: string | null;
};

export type RecentCatalogContext = {
  interactions: Array<{
    inboundMessageId: string;
    completedAt: string;
    /**
     * ACS-R1-05.1-T02.6: explore_catalog reuses the same items-array shape as
     * search_products (productId/name/position only - never price/stock/
     * availability). CP-R1-T10B8D added recommend_catalog_products - its
     * candidates are recorded here too (see productsFromRecommendCatalogProducts)
     * so a later turn's get_product_details/recommend_catalog_products call
     * can cite a recommended product as observed evidence, same as any other
     * catalog tool.
     */
    sourceTool: "search_products" | "get_product_details" | "explore_catalog" | "recommend_catalog_products";
    products: RecentCatalogContextProduct[];
  }>;
};

export type RecentCatalogContextLoadResult = {
  context: RecentCatalogContext;
  warnings: string[];
};

type RecentCatalogExecutionRow = {
  id?: number | string | null;
  correlation_id?: string | null;
  capability_name?: string | null;
  response_summary_json?: unknown;
  completed_at?: string | Date | null;
  inbound_message_id?: unknown;
};

type RecentCatalogContextDataAccess = {
  queryRows(sql: string, params: unknown[]): Promise<{ ok: true; rows: RecentCatalogExecutionRow[] } | { ok: false; rows: RecentCatalogExecutionRow[]; error: string }>;
};

export type LoadRecentCatalogContextInput = {
  conversationId: number;
  currentTime: string | Date;
  dataAccess?: RecentCatalogContextDataAccess | null;
};

const EMPTY_RECENT_CATALOG_CONTEXT: RecentCatalogContext = { interactions: [] };

function toIsoOrNull(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asOptionalText(value: unknown): string | undefined {
  const text = asText(value);
  return text ?? undefined;
}

function isCatalogTool(value: unknown): value is "search_products" | "get_product_details" | "explore_catalog" | "recommend_catalog_products" {
  return value === "search_products" || value === "get_product_details" || value === "explore_catalog" || value === "recommend_catalog_products";
}

/**
 * CP-R1-T10B8D (post-audit fix). Dedup key is productId+combinationId, never
 * productId alone: a bare-productId observation (e.g. explore_catalog) and a
 * variant-specific one (e.g. search_products/recommend_catalog_products) for
 * the same productId are different evidence and must never collapse into
 * one - otherwise a real, later variant observation would silently vanish
 * from recentCatalogContext (and from
 * resolveObservedRecommendationSourceProduct's evidence pool) just because
 * the bare productId was already claimed by another interaction.
 * JSON.stringify of the [productId, combinationId] tuple is a collision-free
 * key with no custom separator to get wrong.
 */
function productDedupeKey(product: RecentCatalogContextProduct): string {
  return JSON.stringify([product.productId, product.combinationId ?? null]);
}

function normalizeProductCandidate(input: {
  value: unknown;
  position?: number;
  includePosition: boolean;
}): RecentCatalogContextProduct | null {
  if (!input.value || typeof input.value !== "object" || Array.isArray(input.value)) return null;
  const record = input.value as Record<string, unknown>;
  const productId = asText(record.productId);
  const name = asText(record.name);
  if (!productId || !name) return null;

  return {
    ...(input.includePosition && input.position !== undefined ? { position: input.position } : {}),
    productId,
    ...(asOptionalText(record.combinationId) ? { combinationId: asOptionalText(record.combinationId) } : {}),
    name,
    ...(record.variantLabel === null ? { variantLabel: null } : asOptionalText(record.variantLabel) ? { variantLabel: asOptionalText(record.variantLabel) } : {})
  };
}

/** Shared by search_products and explore_catalog - both return {items: [{productId, name, ...}]} (ACS-R1-05.1-T02.6). */
function productsFromSearchProducts(payload: Record<string, unknown>): RecentCatalogContextProduct[] {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const products: RecentCatalogContextProduct[] = [];
  for (const [index, item] of items.entries()) {
    const product = normalizeProductCandidate({ value: item, position: index + 1, includePosition: true });
    if (product) products.push(product);
  }
  return products;
}

function productsFromProductDetails(payload: Record<string, unknown>): RecentCatalogContextProduct[] {
  const product = normalizeProductCandidate({ value: payload, includePosition: false });
  return product ? [product] : [];
}

/**
 * CP-R1-T10B8D. `response_summary_json` for a completed recommend_catalog_products
 * execution holds the Gateway's full, untruncated recommendations list (see
 * mapCatalogRecommendationResultToOutcome) - sliced here to MAX_RECOMMENDATIONS
 * (the same limit buildToolObservation.ts applies to the live observation) so
 * a later turn can never treat a candidate the model never actually saw as
 * observed evidence. A "skipped" payload (status !== "completed") never
 * contributes products - it never reached a real recommendation result.
 */
function productsFromRecommendCatalogProducts(payload: Record<string, unknown>): RecentCatalogContextProduct[] {
  if (payload.status !== "completed" || !Array.isArray(payload.recommendations)) return [];
  const products: RecentCatalogContextProduct[] = [];
  for (const [index, recommendation] of payload.recommendations.slice(0, MAX_RECOMMENDATIONS).entries()) {
    if (!recommendation || typeof recommendation !== "object" || Array.isArray(recommendation)) continue;
    const product = normalizeProductCandidate({ value: (recommendation as Record<string, unknown>).product, position: index + 1, includePosition: true });
    if (product) products.push(product);
  }
  return products;
}

function buildExecutionQuery(windowStart: string, currentTime: string) {
  return {
    sql: `
      SELECT
        e.id,
        e.correlation_id,
        e.capability_name,
        e.response_summary_json,
        e.completed_at,
        COALESCE(
          (
            SELECT JSON_UNQUOTE(JSON_EXTRACT(direct_event.payload_json, '$.inboundMessageId'))
            FROM commercial_event direct_event
            WHERE direct_event.id = e.commercial_event_id
              AND direct_event.event_type = 'agent_tool_loop_completed'
            LIMIT 1
          ),
          (
            SELECT JSON_UNQUOTE(JSON_EXTRACT(correlated_event.payload_json, '$.inboundMessageId'))
            FROM commercial_event correlated_event
            WHERE correlated_event.correlation_id = e.correlation_id
              AND correlated_event.event_type = 'agent_tool_loop_completed'
            ORDER BY correlated_event.occurred_at DESC, correlated_event.id DESC
            LIMIT 1
          )
        ) AS inbound_message_id
      FROM crm_capability_executions e
      WHERE e.conversation_id = ?
        AND e.capability_name IN ('search_products', 'get_product_details', 'explore_catalog', 'recommend_catalog_products')
        AND e.execution_status = 'completed'
        AND e.response_summary_json IS NOT NULL
        AND e.completed_at >= ?
        AND e.completed_at <= ?
      ORDER BY e.completed_at DESC, e.id DESC
      LIMIT ?
    `,
    params: [windowStart, currentTime]
  };
}

export async function loadRecentCatalogContext(input: LoadRecentCatalogContextInput): Promise<RecentCatalogContextLoadResult> {
  const currentTime = toIsoOrNull(input.currentTime);
  if (!Number.isInteger(input.conversationId) || input.conversationId <= 0 || !currentTime) {
    return { context: EMPTY_RECENT_CATALOG_CONTEXT, warnings: ["recent_catalog_context_invalid_input"] };
  }

  const currentDate = new Date(currentTime);
  const windowStart = new Date(currentDate.getTime() - RECENT_CATALOG_CONTEXT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const query = buildExecutionQuery(windowStart, currentTime);
  const dataAccess = input.dataAccess ?? { queryRows: (sql: string, params: unknown[]) => safeQueryRows<RecentCatalogExecutionRow>(sql, params) };
  const result = await dataAccess.queryRows(query.sql, [
    input.conversationId,
    ...query.params,
    RECENT_CATALOG_CONTEXT_SQL_CANDIDATE_LIMIT
  ]);

  if (!result.ok) {
    return { context: EMPTY_RECENT_CATALOG_CONTEXT, warnings: [`recent_catalog_context_query_failed:${result.error}`] };
  }

  const warnings: string[] = [];
  const interactions: RecentCatalogContext["interactions"] = [];
  let productCount = 0;
  const seenProductKeys = new Set<string>();

  for (const row of result.rows) {
    const sourceTool = row.capability_name;
    if (!isCatalogTool(sourceTool)) continue;

    const completedAt = toIsoOrNull(row.completed_at);
    if (!completedAt) {
      warnings.push("recent_catalog_context_invalid_completed_at");
      continue;
    }

    const payload = parseJsonRecord(row.response_summary_json);
    if (!payload) {
      warnings.push("recent_catalog_context_invalid_response_summary");
      continue;
    }

    const inboundMessageId = asText(row.inbound_message_id);
    if (!inboundMessageId) {
      warnings.push("recent_catalog_context_missing_inbound_message_id");
      continue;
    }

    const rawProducts =
      sourceTool === "get_product_details"
        ? productsFromProductDetails(payload)
        : sourceTool === "recommend_catalog_products"
          ? productsFromRecommendCatalogProducts(payload)
          : productsFromSearchProducts(payload);
    if (rawProducts.length === 0) {
      warnings.push("recent_catalog_context_no_valid_products");
      continue;
    }

    // ACS-R1-05.1-T02.6 (CP-R1-T10B8D, post-audit fix: keyed by
    // productId+combinationId, see productDedupeKey): a product+variant
    // already surfaced by a more recent interaction is skipped here - avoids
    // spending the shared product budget on a repeat (e.g. explore_catalog
    // returning the same top item across consecutive turns). A different
    // variant of an already-seen productId is never treated as the repeat.
    // Reuses the same accumulation loop, never a second, parallel memory.
    const dedupedProducts = rawProducts.filter((product) => {
      const key = productDedupeKey(product);
      if (seenProductKeys.has(key)) return false;
      seenProductKeys.add(key);
      return true;
    });
    if (dedupedProducts.length === 0) {
      warnings.push("recent_catalog_context_all_candidates_deduped");
      continue;
    }

    const remaining = RECENT_CATALOG_CONTEXT_MAX_PRODUCTS - productCount;
    const products = dedupedProducts.slice(0, Math.max(remaining, 0));
    if (products.length === 0) {
      warnings.push("recent_catalog_context_no_valid_products");
      continue;
    }

    productCount += products.length;
    interactions.push({
      inboundMessageId,
      completedAt,
      sourceTool,
      products
    });

    if (interactions.length >= RECENT_CATALOG_CONTEXT_MAX_INTERACTIONS || productCount >= RECENT_CATALOG_CONTEXT_MAX_PRODUCTS) break;
  }

  return { context: { interactions }, warnings };
}
