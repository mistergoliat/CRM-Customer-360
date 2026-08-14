import { safeQueryRows } from "@/lib/db";

/**
 * SALES-AGENT-R1-T2.1. Evidence gate for select_shipping_option - same
 * family as resolveObservedRecommendationSourceProduct.ts (recommend_catalog_products'
 * sourceProduct) and select_products' evidence check: the model's only input
 * is a bare `optionIndex` (an integer, never a label, never a price) which
 * this function resolves against the REAL, most-recently-completed
 * calculate_shipping execution for this conversation - never free text, never
 * a fabricated option. Same one-row-lookback shape as pendingCatalogAction.ts
 * (deliberately not shared code - different table/key/payload shape).
 */

export type ObservedShippingOption = {
  carrierName: string;
  serviceType: string;
  totalCost: number;
  estimatedDelivery: string;
  optionIndex: number;
  shippingQuoteExecutionId: string;
  shippingQuoteCorrelationId: string | null;
  selectionFactId: string;
  destinationFactId: string;
  calculatedAt: string;
};

export const SHIPPING_OPTION_BLOCKED_REASONS = [
  "no_recent_shipping_calculation",
  "shipping_calculation_not_available",
  "shipping_option_index_out_of_range"
] as const;
export type ShippingOptionBlockedReason = (typeof SHIPPING_OPTION_BLOCKED_REASONS)[number];

export type ResolveObservedShippingOptionResult =
  | { status: "resolved"; option: ObservedShippingOption }
  | { status: "blocked"; reason: ShippingOptionBlockedReason };

type ShippingExecutionRow = {
  public_id?: string | null;
  correlation_id?: string | null;
  response_summary_json?: unknown;
  completed_at?: string | Date | null;
};

type ShippingExecutionDataAccess = {
  queryRows(sql: string, params: unknown[]): Promise<{ ok: true; rows: ShippingExecutionRow[] } | { ok: false; rows: ShippingExecutionRow[]; error: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toIsoOrNull(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reads exactly the most recent COMPLETED calculate_shipping execution for
 * this conversation - a calculation superseded by a newer one (task section
 * 16, "multiple calculations") never resurfaces once a newer completed
 * execution exists, same discipline pendingCatalogAction.ts already
 * establishes for its own single-row lookback.
 */
export async function resolveObservedShippingOption(input: {
  conversationId: number;
  optionIndex: unknown;
  dataAccess?: ShippingExecutionDataAccess | null;
}): Promise<ResolveObservedShippingOptionResult> {
  const optionIndex = typeof input.optionIndex === "number" && Number.isInteger(input.optionIndex) && input.optionIndex >= 0 ? input.optionIndex : null;

  const dataAccess = input.dataAccess ?? { queryRows: (sql: string, params: unknown[]) => safeQueryRows<ShippingExecutionRow>(sql, params) };
  const result = await dataAccess.queryRows(
    `
      SELECT public_id, correlation_id, response_summary_json, completed_at
      FROM crm_capability_executions
      WHERE conversation_id = ?
        AND capability_name = 'calculate_shipping'
        AND execution_status = 'completed'
      ORDER BY completed_at DESC, id DESC
      LIMIT 1
    `,
    [input.conversationId]
  );

  if (!result.ok || result.rows.length === 0) {
    return { status: "blocked", reason: "no_recent_shipping_calculation" };
  }

  const row = result.rows[0];
  const payload = parseJsonRecord(row.response_summary_json);
  const calculatedAt = toIsoOrNull(row.completed_at);
  const shippingQuoteExecutionId = asString(row.public_id);

  if (!payload || payload.status !== "available" || !Array.isArray(payload.options) || !calculatedAt || !shippingQuoteExecutionId) {
    return { status: "blocked", reason: "shipping_calculation_not_available" };
  }

  const selectionFactId = asString(payload.selectionFactId);
  const destinationFactId = asString(payload.destinationFactId);
  if (!selectionFactId || !destinationFactId) {
    return { status: "blocked", reason: "shipping_calculation_not_available" };
  }

  if (optionIndex === null || optionIndex >= payload.options.length) {
    return { status: "blocked", reason: "shipping_option_index_out_of_range" };
  }

  const rawOption = payload.options[optionIndex];
  if (!isRecord(rawOption)) {
    return { status: "blocked", reason: "shipping_option_index_out_of_range" };
  }

  const carrierName = asString(rawOption.carrierName);
  const serviceType = asString(rawOption.serviceType);
  const estimatedDelivery = asString(rawOption.estimatedDelivery);
  const totalCost = typeof rawOption.totalCost === "number" && Number.isFinite(rawOption.totalCost) ? rawOption.totalCost : null;
  if (!carrierName || !serviceType || !estimatedDelivery || totalCost === null) {
    return { status: "blocked", reason: "shipping_calculation_not_available" };
  }

  return {
    status: "resolved",
    option: {
      carrierName,
      serviceType,
      totalCost,
      estimatedDelivery,
      optionIndex,
      shippingQuoteExecutionId,
      shippingQuoteCorrelationId: asString(row.correlation_id),
      selectionFactId,
      destinationFactId,
      calculatedAt
    }
  };
}
