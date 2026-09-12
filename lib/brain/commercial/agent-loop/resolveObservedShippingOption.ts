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

export type ShippingExecutionDataAccess = {
  queryRows(sql: string, params: unknown[]): Promise<{ ok: true; rows: ShippingExecutionRow[] } | { ok: false; rows: ShippingExecutionRow[]; error: string }>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
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
 * SALES-AGENT-R3-SHIPPING-CONTEXT-PROJECTION-V1. The single durable reader
 * both the post-decision resolver below (one specific optionIndex) and the
 * pre-decision projector (resolveLatestShippingQuoteContext.ts, every
 * option) build on - one SQL query, one parse, one envelope-validity
 * definition, never duplicated. Distinguishes "no row at all" from "a row
 * exists but is structurally unusable" so callers can keep their own
 * existing reason-code granularity (resolveObservedShippingOption did before
 * this task; the projector never needs to).
 */
export type CalculateShippingEvidenceEnvelope = {
  shippingQuoteExecutionId: string;
  shippingQuoteCorrelationId: string | null;
  calculatedAt: string;
  selectionFactId: string;
  destinationFactId: string;
  destination: { communeId: number; canonicalName: string } | null;
  totalWeightKg: number | null;
  totalBoleta: number | null;
  /** Unvalidated per-option records - each caller applies its own validation (one index vs. every option). */
  rawOptions: unknown[];
};

export type ReadLatestCalculateShippingEvidenceResult =
  | { status: "found"; evidence: CalculateShippingEvidenceEnvelope }
  | { status: "no_row" }
  | { status: "malformed" };

/**
 * Reads exactly the most recent COMPLETED calculate_shipping execution for
 * this conversation - a calculation superseded by a newer one (task section
 * 16, "multiple calculations") never resurfaces once a newer completed
 * execution exists, same discipline pendingCatalogAction.ts already
 * establishes for its own single-row lookback.
 */
export async function readLatestCalculateShippingEvidence(input: {
  conversationId: number;
  dataAccess?: ShippingExecutionDataAccess | null;
}): Promise<ReadLatestCalculateShippingEvidenceResult> {
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
    return { status: "no_row" };
  }

  const row = result.rows[0];
  const payload = parseJsonRecord(row.response_summary_json);
  const calculatedAt = toIsoOrNull(row.completed_at);
  const shippingQuoteExecutionId = asString(row.public_id);

  if (!payload || payload.status !== "available" || !Array.isArray(payload.options) || !calculatedAt || !shippingQuoteExecutionId) {
    return { status: "malformed" };
  }

  const selectionFactId = asString(payload.selectionFactId);
  const destinationFactId = asString(payload.destinationFactId);
  if (!selectionFactId || !destinationFactId) {
    return { status: "malformed" };
  }

  const rawDestination = payload.destination;
  const destination =
    isRecord(rawDestination) && typeof rawDestination.communeId === "number" && typeof rawDestination.canonicalName === "string"
      ? { communeId: rawDestination.communeId, canonicalName: rawDestination.canonicalName }
      : null;
  const totalWeightKg = typeof payload.totalWeightKg === "number" && Number.isFinite(payload.totalWeightKg) ? payload.totalWeightKg : null;
  const totalBoleta = typeof payload.totalBoleta === "number" && Number.isFinite(payload.totalBoleta) ? payload.totalBoleta : null;

  return {
    status: "found",
    evidence: {
      shippingQuoteExecutionId,
      shippingQuoteCorrelationId: asString(row.correlation_id),
      calculatedAt,
      selectionFactId,
      destinationFactId,
      destination,
      totalWeightKg,
      totalBoleta,
      rawOptions: payload.options
    }
  };
}

export async function resolveObservedShippingOption(input: {
  conversationId: number;
  optionIndex: unknown;
  dataAccess?: ShippingExecutionDataAccess | null;
}): Promise<ResolveObservedShippingOptionResult> {
  const optionIndex = typeof input.optionIndex === "number" && Number.isInteger(input.optionIndex) && input.optionIndex >= 0 ? input.optionIndex : null;

  const read = await readLatestCalculateShippingEvidence({ conversationId: input.conversationId, dataAccess: input.dataAccess });
  if (read.status === "no_row") {
    return { status: "blocked", reason: "no_recent_shipping_calculation" };
  }
  if (read.status === "malformed") {
    return { status: "blocked", reason: "shipping_calculation_not_available" };
  }

  const { evidence } = read;
  if (optionIndex === null || optionIndex >= evidence.rawOptions.length) {
    return { status: "blocked", reason: "shipping_option_index_out_of_range" };
  }

  const rawOption = evidence.rawOptions[optionIndex];
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
      shippingQuoteExecutionId: evidence.shippingQuoteExecutionId,
      shippingQuoteCorrelationId: evidence.shippingQuoteCorrelationId,
      selectionFactId: evidence.selectionFactId,
      destinationFactId: evidence.destinationFactId,
      calculatedAt: evidence.calculatedAt
    }
  };
}
