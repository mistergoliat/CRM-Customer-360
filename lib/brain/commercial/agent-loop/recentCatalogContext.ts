import { safeQueryRows } from "@/lib/db";

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
    sourceTool: "search_products" | "get_product_details";
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

function isCatalogTool(value: unknown): value is "search_products" | "get_product_details" {
  return value === "search_products" || value === "get_product_details";
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
        AND e.capability_name IN ('search_products', 'get_product_details')
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

    const rawProducts = sourceTool === "search_products" ? productsFromSearchProducts(payload) : productsFromProductDetails(payload);
    const remaining = RECENT_CATALOG_CONTEXT_MAX_PRODUCTS - productCount;
    const products = rawProducts.slice(0, Math.max(remaining, 0));
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
