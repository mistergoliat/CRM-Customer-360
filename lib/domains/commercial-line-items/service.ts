import { getActiveRequestFact, upsertRequestFact } from "@/lib/brain/commercial/request-facts";
import type { RequestFact } from "@/lib/brain/commercial/request-facts";
import { buildCommercialLineItemsRequestAnchor, COMMERCIAL_LINE_ITEMS_FACT_KEY } from "./constants";
import type {
  CommercialLineItem,
  CommercialLineItemSelection,
  CommercialLineItemsDependencies,
  CommercialLineItemsFactValue,
  SetCommercialLineItemsInput,
  SetCommercialLineItemsResult
} from "./types";

function isCommercialLineItem(value: unknown): value is CommercialLineItem {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.productId === "string" &&
    record.productId.length > 0 &&
    (record.combinationId === null || typeof record.combinationId === "string") &&
    typeof record.quantity === "number" &&
    Number.isInteger(record.quantity) &&
    record.quantity > 0
  );
}

function isCommercialLineItemsFactValue(value: unknown): value is CommercialLineItemsFactValue {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.items) && record.items.length > 0 && record.items.every(isCommercialLineItem);
}

function toSelection(fact: RequestFact): CommercialLineItemSelection | null {
  if (!isCommercialLineItemsFactValue(fact.value)) return null;
  return { items: fact.value.items, factId: fact.factId, updatedAt: fact.updatedAt };
}

/**
 * Validates and normalizes the caller-supplied items: rejects an empty
 * array, a blank productId, or a non-positive/non-integer quantity - never
 * silently drops a bad item and proceeds with the rest (fail closed on the
 * whole selection, same policy as weight validation in
 * lib/domains/shipping-calculation/weight.ts). Duplicate (productId,
 * combinationId) pairs within one call are merged by summing quantity
 * (documented decision, T13E.2) rather than kept as two separate lines or
 * rejected outright - the model is not expected to pre-deduplicate its own
 * selection.
 */
function normalizeItems(rawItems: readonly CommercialLineItem[]): { ok: true; items: CommercialLineItem[] } | { ok: false; reason: "items_required" | "invalid_product_id" | "invalid_quantity" } {
  if (rawItems.length === 0) return { ok: false, reason: "items_required" };

  const merged = new Map<string, CommercialLineItem>();
  for (const item of rawItems) {
    if (typeof item.productId !== "string" || item.productId.trim().length === 0) {
      return { ok: false, reason: "invalid_product_id" };
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { ok: false, reason: "invalid_quantity" };
    }
    const combinationId = item.combinationId ?? null;
    const key = JSON.stringify([item.productId, combinationId]);
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, quantity: existing.quantity + item.quantity } : { productId: item.productId, combinationId, quantity: item.quantity });
  }

  return { ok: true, items: [...merged.values()] };
}

/** Order-independent equality for the idempotency check below. */
function sameItems(a: readonly CommercialLineItem[], b: readonly CommercialLineItem[]): boolean {
  if (a.length !== b.length) return false;
  const key = (item: CommercialLineItem) => JSON.stringify([item.productId, item.combinationId, item.quantity]);
  const sortedA = [...a].map(key).sort();
  const sortedB = [...b].map(key).sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

/**
 * The single write path for an opportunity's commercial line-item selection.
 * Each call REPLACES the entire active selection (full replacement, not a
 * delta/merge across calls) - the model must supply the complete desired
 * list every time, same explicit-replacement policy as
 * setShippingDestinationForOpportunity (T13D). Evidence-grounding (that
 * every productId/combinationId was actually observed this conversation) is
 * the caller's responsibility (runAgentToolLoop.ts's evidence gate) - this
 * function trusts its input is already evidence-validated, mirroring how
 * setShippingDestinationForOpportunity trusts CommuneResolver's output.
 */
export async function setCommercialLineItemsForOpportunity(input: SetCommercialLineItemsInput, deps: CommercialLineItemsDependencies = {}): Promise<SetCommercialLineItemsResult> {
  const normalized = normalizeItems(input.items);
  if (!normalized.ok) return { ok: false, status: "invalid_input", reason: normalized.reason };

  const getActiveFact = deps.getActiveFact ?? getActiveRequestFact;
  const upsertFact = deps.upsertFact ?? upsertRequestFact;

  const anchor = buildCommercialLineItemsRequestAnchor(input.opportunityId);
  const current = await getActiveFact(anchor, COMMERCIAL_LINE_ITEMS_FACT_KEY);
  const currentValue = current && isCommercialLineItemsFactValue(current.value) ? current.value : null;

  if (currentValue && sameItems(currentValue.items, normalized.items)) {
    const selection = current ? toSelection(current) : null;
    if (selection) return { ok: true, status: "selected", selection, changed: false };
  }

  const value: CommercialLineItemsFactValue = { items: normalized.items };

  const upserted = await upsertFact({
    requestId: anchor,
    factKey: COMMERCIAL_LINE_ITEMS_FACT_KEY,
    value,
    status: "confirmed",
    sourceToolExecutionId: input.sourceToolExecutionId ?? null
  });

  if (!upserted.ok) {
    return { ok: false, status: "persistence_failed", warning: upserted.warning };
  }

  const selection = toSelection(upserted.fact);
  if (!selection) {
    return { ok: false, status: "persistence_failed", warning: "commercial_line_items_fact_reload_malformed" };
  }

  return { ok: true, status: "selected", selection, changed: true };
}

/** Rehydration: read-only, durable-state-first. Null whenever no confirmed selection exists yet for this opportunity. */
export async function getActiveCommercialLineItemsForOpportunity(opportunityId: number): Promise<CommercialLineItemSelection | null> {
  const anchor = buildCommercialLineItemsRequestAnchor(opportunityId);
  const fact = await getActiveRequestFact(anchor, COMMERCIAL_LINE_ITEMS_FACT_KEY);
  if (!fact || fact.status !== "confirmed") return null;
  return toSelection(fact);
}
