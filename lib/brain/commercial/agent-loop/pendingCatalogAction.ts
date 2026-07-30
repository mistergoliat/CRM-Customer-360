import { safeQueryRows } from "@/lib/db";
import type { PendingCatalogActionStep, ToolObservation } from "./agentStepTypes";
import type { RecentCatalogContext } from "./recentCatalogContext";

const MAX_CANDIDATE_PRODUCT_IDS = 20;

export type PendingCatalogActionLoadResult = {
  pendingCatalogAction: PendingCatalogActionStep | null;
  warnings: string[];
};

type PendingCatalogActionEventRow = {
  payload_json?: unknown;
};

type PendingCatalogActionDataAccess = {
  queryRows(sql: string, params: unknown[]): Promise<{ ok: true; rows: PendingCatalogActionEventRow[] } | { ok: false; rows: PendingCatalogActionEventRow[]; error: string }>;
};

export type LoadPendingCatalogActionInput = {
  conversationId: number;
  dataAccess?: PendingCatalogActionDataAccess | null;
};

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

function asProductId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function parsePendingCatalogAction(value: unknown): PendingCatalogActionStep | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.actionType !== "send_product_link") return null;
  if (!Array.isArray(record.candidateProductIds)) return null;

  const seen = new Set<string>();
  const candidateProductIds: string[] = [];
  for (const rawId of record.candidateProductIds) {
    const productId = asProductId(rawId);
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    candidateProductIds.push(productId);
    if (candidateProductIds.length >= MAX_CANDIDATE_PRODUCT_IDS) break;
  }

  return candidateProductIds.length > 0 ? { actionType: "send_product_link", candidateProductIds } : null;
}

function addAllowedProductId(target: string[], seen: Set<string>, value: unknown) {
  const productId = asProductId(value);
  if (!productId || seen.has(productId)) return;
  seen.add(productId);
  target.push(productId);
}

function collectAllowedProductIds(input: {
  recentCatalogContext?: RecentCatalogContext | null;
  toolObservations?: Array<ToolObservation | null | undefined>;
}): string[] {
  const allowed: string[] = [];
  const seen = new Set<string>();

  for (const interaction of input.recentCatalogContext?.interactions ?? []) {
    for (const product of interaction.products ?? []) {
      addAllowedProductId(allowed, seen, product.productId);
    }
  }

  for (const observation of input.toolObservations ?? []) {
    if (!observation || observation.status !== "completed") continue;
    const data = observation.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const record = data as Record<string, unknown>;

    if (observation.tool === "search_products" && Array.isArray(record.items)) {
      for (const item of record.items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        addAllowedProductId(allowed, seen, (item as Record<string, unknown>).productId);
      }
      continue;
    }

    if (observation.tool === "explore_catalog" && Array.isArray(record.products)) {
      for (const product of record.products) {
        if (!product || typeof product !== "object" || Array.isArray(product)) continue;
        addAllowedProductId(allowed, seen, (product as Record<string, unknown>).productId);
      }
      continue;
    }

    if (observation.tool === "get_product_details") {
      addAllowedProductId(allowed, seen, record.productId);
    }
  }

  return allowed;
}

function warningSuffix(input: { actionType: string; candidateCountBefore: number; candidateCountAfter: number; correlationId?: string | null }) {
  return [
    input.actionType,
    `candidateCountBefore=${input.candidateCountBefore}`,
    `candidateCountAfter=${input.candidateCountAfter}`,
    ...(input.correlationId ? [`correlationId=${input.correlationId}`] : [])
  ].join(":");
}

export type NormalizePendingCatalogActionForEvidenceInput = {
  pendingCatalogAction?: PendingCatalogActionStep | null;
  recentCatalogContext?: RecentCatalogContext | null;
  toolObservations?: Array<ToolObservation | null | undefined>;
  correlationId?: string | null;
};

export type NormalizePendingCatalogActionForEvidenceResult = {
  pendingCatalogAction: PendingCatalogActionStep | undefined;
  warnings: string[];
  allowedProductIds: string[];
};

export function normalizePendingCatalogActionForEvidence(
  input: NormalizePendingCatalogActionForEvidenceInput
): NormalizePendingCatalogActionForEvidenceResult {
  const allowedProductIds = collectAllowedProductIds(input);
  const parsed = parsePendingCatalogAction(input.pendingCatalogAction);
  if (!parsed) return { pendingCatalogAction: undefined, warnings: [], allowedProductIds };

  const allowed = new Set(allowedProductIds);
  const candidateCountBefore = Array.isArray(input.pendingCatalogAction?.candidateProductIds) ? input.pendingCatalogAction.candidateProductIds.length : 0;
  const candidateProductIds = parsed.candidateProductIds.filter((productId) => allowed.has(productId)).slice(0, MAX_CANDIDATE_PRODUCT_IDS);
  const candidateCountAfter = candidateProductIds.length;
  const suffix = warningSuffix({
    actionType: parsed.actionType,
    candidateCountBefore,
    candidateCountAfter,
    correlationId: input.correlationId
  });

  if (candidateCountAfter === 0) {
    return {
      pendingCatalogAction: undefined,
      warnings: [`pending_catalog_action_dropped_no_candidates:${suffix}`],
      allowedProductIds
    };
  }

  return {
    pendingCatalogAction: { actionType: parsed.actionType, candidateProductIds },
    warnings: [`pending_catalog_action_sanitized:${suffix}`],
    allowedProductIds
  };
}

/**
 * ACS-R1-05.1-T02.7. The single most recent agent_tool_loop_completed event
 * for this conversation IS the immediately preceding assistant turn (each
 * inbound customer message drives exactly one cycle to completion), so
 * reading only that one row already answers "is a catalog action pending
 * for the very next customer message" with no separate turn-counter or
 * expiry timestamp to maintain in the normal AI flow: a pending action from
 * any older completed AI turn never resurfaces, because the turn that
 * superseded it (whether it renews the same action, opens a different one,
 * or opens none) produced its own newer event, and that is the row this
 * query returns instead. Same one-row-lookback shape as
 * recentCatalogContext.ts, deliberately not reused from it: the source
 * table, key and payload shape are both different, and duplicating this
 * much SQL is cheaper to read than a shared abstraction for two callers.
 */
export async function loadPendingCatalogAction(input: LoadPendingCatalogActionInput): Promise<PendingCatalogActionLoadResult> {
  if (!Number.isInteger(input.conversationId) || input.conversationId <= 0) {
    return { pendingCatalogAction: null, warnings: ["pending_catalog_action_invalid_input"] };
  }

  const dataAccess = input.dataAccess ?? { queryRows: (sql: string, params: unknown[]) => safeQueryRows<PendingCatalogActionEventRow>(sql, params) };
  const result = await dataAccess.queryRows(
    `SELECT payload_json FROM commercial_event WHERE conversation_id = ? AND event_type = 'agent_tool_loop_completed' ORDER BY created_at DESC, id DESC LIMIT 1`,
    [String(input.conversationId)]
  );

  if (!result.ok) {
    return { pendingCatalogAction: null, warnings: [`pending_catalog_action_query_failed:${result.error}`] };
  }
  if (result.rows.length === 0) {
    return { pendingCatalogAction: null, warnings: [] };
  }

  const payload = parseJsonRecord(result.rows[0].payload_json);
  const pendingCatalogAction = payload ? parsePendingCatalogAction(payload.pendingCatalogAction) : null;

  return {
    pendingCatalogAction,
    warnings: pendingCatalogAction ? [`pending_catalog_action_loaded:${pendingCatalogAction.actionType}:candidateCount=${pendingCatalogAction.candidateProductIds.length}`] : []
  };
}
