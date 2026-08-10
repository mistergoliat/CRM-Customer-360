import { getActiveRequestFact, upsertRequestFact } from "@/lib/brain/commercial/request-facts";
import type { RequestFact } from "@/lib/brain/commercial/request-facts";
import { buildShippingDestinationRequestAnchor, SHIPPING_DESTINATION_FACT_KEY } from "./constants";
import type { SetShippingDestinationInput, SetShippingDestinationResult, ShippingDestination, ShippingDestinationDependencies, ShippingDestinationFactValue } from "./types";

function isShippingDestinationFactValue(value: unknown): value is ShippingDestinationFactValue {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.communeId === "number" && typeof record.canonicalName === "string" && (record.matchedVia === "direct" || record.matchedVia === "alias");
}

function toShippingDestination(fact: RequestFact): ShippingDestination | null {
  if (!isShippingDestinationFactValue(fact.value)) return null;
  return {
    communeId: fact.value.communeId,
    canonicalName: fact.value.canonicalName,
    matchedVia: fact.value.matchedVia,
    factId: fact.factId,
    updatedAt: fact.updatedAt
  };
}

/**
 * The single write path for an opportunity's shipping destination. Resolves
 * `inputText` via CommuneResolver (T13C, the only source of `communeId` -
 * never fabricated here) and, only on an unambiguous "resolved" result,
 * persists it as this opportunity's durable, authoritative destination.
 *
 * Confirmation policy (T13D section 8): an explicit, unambiguous customer-
 * stated commune is persisted `status: "confirmed"` directly - resolveCommune
 * already fails closed to `needs_clarification` for anything ambiguous
 * (Santiago, a region name, a multi-catalog-match), so nothing "resolved"
 * ever needs a redundant second confirmation from the customer.
 *
 * Idempotent: repeating the same already-active commune performs no write
 * (changed: false) - mirrors selectAddressForRequest's
 * `current.value !== input.addressId` guard in
 * lib/domains/customer-addresses/requestSelection.ts. A different commune
 * supersedes the active fact via upsertRequestFact's existing transaction
 * (one superseded row, one new active row, DB-enforced uniqueness) - the
 * superseded factId is exactly the signal a future shipping quote (T13E) can
 * check to know it was computed against a now-stale destination.
 */
export async function setShippingDestinationForOpportunity(
  input: SetShippingDestinationInput,
  deps: ShippingDestinationDependencies
): Promise<SetShippingDestinationResult> {
  const resolution = await deps.resolver.resolve(input.inputText);

  if (resolution.status === "invalid_input") {
    return { ok: false, status: "invalid_input", input: resolution.input };
  }
  if (resolution.status === "needs_clarification") {
    return { ok: false, status: "needs_clarification", input: resolution.input, reason: resolution.reason };
  }
  if (resolution.status === "not_found") {
    return { ok: false, status: "not_found", input: resolution.input };
  }
  if (resolution.status === "error") {
    return { ok: false, status: "resolver_error", reason: resolution.reason, detail: resolution.detail };
  }

  const getActiveFact = deps.getActiveFact ?? getActiveRequestFact;
  const upsertFact = deps.upsertFact ?? upsertRequestFact;

  const anchor = buildShippingDestinationRequestAnchor(input.opportunityId);
  const current = await getActiveFact(anchor, SHIPPING_DESTINATION_FACT_KEY);
  const currentValue = current && isShippingDestinationFactValue(current.value) ? current.value : null;

  if (currentValue && currentValue.communeId === resolution.communeId) {
    const destination = current ? toShippingDestination(current) : null;
    if (destination) return { ok: true, status: "resolved", destination, changed: false };
  }

  const value: ShippingDestinationFactValue = {
    inputText: input.inputText,
    communeId: resolution.communeId,
    canonicalName: resolution.canonicalName,
    matchedVia: resolution.matchedVia,
    source: "conversation"
  };

  const upserted = await upsertFact({
    requestId: anchor,
    factKey: SHIPPING_DESTINATION_FACT_KEY,
    value,
    status: "confirmed",
    sourceToolExecutionId: input.sourceToolExecutionId ?? null
  });

  if (!upserted.ok) {
    return { ok: false, status: "persistence_failed", warning: upserted.warning };
  }

  const destination = toShippingDestination(upserted.fact);
  if (!destination) {
    return { ok: false, status: "persistence_failed", warning: "shipping_destination_fact_reload_malformed" };
  }

  return { ok: true, status: "resolved", destination, changed: true };
}

/** Rehydration: read-only, durable-state-first (never conversational memory). Null whenever no confirmed destination exists yet for this opportunity - never a stale/superseded value. */
export async function getActiveShippingDestinationForOpportunity(opportunityId: number): Promise<ShippingDestination | null> {
  const anchor = buildShippingDestinationRequestAnchor(opportunityId);
  const fact = await getActiveRequestFact(anchor, SHIPPING_DESTINATION_FACT_KEY);
  if (!fact || fact.status !== "confirmed") return null;
  return toShippingDestination(fact);
}
