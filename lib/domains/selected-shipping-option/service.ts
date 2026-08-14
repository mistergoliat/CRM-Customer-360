import { getActiveRequestFact, upsertRequestFact } from "@/lib/brain/commercial/request-facts";
import type { RequestFact } from "@/lib/brain/commercial/request-facts";
import { getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import { buildSelectedShippingOptionRequestAnchor, SELECTED_SHIPPING_OPTION_FACT_KEY } from "./constants";
import type {
  SelectedShippingOption,
  SelectedShippingOptionDependencies,
  SelectedShippingOptionFactValue,
  SetSelectedShippingOptionInput,
  SetSelectedShippingOptionResult,
  ShippingFreshnessEvidence,
  ShippingSelectionFreshnessCheck
} from "./types";

type FreshnessDependencies = {
  getCommercialLineItems?: typeof getActiveCommercialLineItemsForOpportunity;
  getShippingDestination?: typeof getActiveShippingDestinationForOpportunity;
};

function isSelectedShippingOptionFactValue(value: unknown): value is SelectedShippingOptionFactValue {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.carrierName === "string" &&
    typeof record.serviceType === "string" &&
    typeof record.totalCost === "number" &&
    typeof record.estimatedDelivery === "string" &&
    typeof record.optionIndex === "number" &&
    typeof record.shippingQuoteExecutionId === "string" &&
    (record.shippingQuoteCorrelationId === null || typeof record.shippingQuoteCorrelationId === "string") &&
    typeof record.selectionFactId === "string" &&
    typeof record.destinationFactId === "string" &&
    typeof record.calculatedAt === "string" &&
    typeof record.selectedAt === "string"
  );
}

function toSelection(fact: RequestFact): SelectedShippingOption | null {
  if (!isSelectedShippingOptionFactValue(fact.value)) return null;
  return { ...fact.value, factId: fact.factId, updatedAt: fact.updatedAt };
}

/** Same-value equality for the idempotency check below - the traceability anchors (which execution/factIds it was evidenced against) are part of "sameness" too, not just the commercial fields. */
function sameOption(a: SelectedShippingOptionFactValue, b: Omit<SelectedShippingOptionFactValue, "selectedAt">): boolean {
  return (
    a.carrierName === b.carrierName &&
    a.serviceType === b.serviceType &&
    a.totalCost === b.totalCost &&
    a.estimatedDelivery === b.estimatedDelivery &&
    a.optionIndex === b.optionIndex &&
    a.shippingQuoteExecutionId === b.shippingQuoteExecutionId &&
    a.selectionFactId === b.selectionFactId &&
    a.destinationFactId === b.destinationFactId
  );
}

/**
 * The single write path for an opportunity's selected shipping option. Each
 * call REPLACES the entire active selection - same explicit-replacement
 * policy as setCommercialLineItemsForOpportunity/setShippingDestinationForOpportunity.
 * The caller (selectShippingOptionCapability.ts) is responsible for evidence
 * (that the option was actually observed in a real, recent calculate_shipping
 * response) - this function trusts its input, mirroring how the sibling
 * durable-state writers trust their own callers' evidence gates.
 */
export async function setSelectedShippingOptionForOpportunity(
  input: SetSelectedShippingOptionInput,
  deps: SelectedShippingOptionDependencies = {}
): Promise<SetSelectedShippingOptionResult> {
  const getActiveFact = deps.getActiveFact ?? getActiveRequestFact;
  const upsertFact = deps.upsertFact ?? upsertRequestFact;
  const now = deps.now ?? (() => new Date());

  const anchor = buildSelectedShippingOptionRequestAnchor(input.opportunityId);
  const current = await getActiveFact(anchor, SELECTED_SHIPPING_OPTION_FACT_KEY);
  const currentValue = current && isSelectedShippingOptionFactValue(current.value) ? current.value : null;

  if (currentValue && sameOption(currentValue, input.option)) {
    const selection = current ? toSelection(current) : null;
    if (selection) return { ok: true, status: "selected", selection, changed: false };
  }

  const value: SelectedShippingOptionFactValue = { ...input.option, selectedAt: now().toISOString() };

  const upserted = await upsertFact({
    requestId: anchor,
    factKey: SELECTED_SHIPPING_OPTION_FACT_KEY,
    value,
    status: "confirmed",
    sourceToolExecutionId: input.sourceToolExecutionId ?? null
  });

  if (!upserted.ok) {
    return { ok: false, status: "persistence_failed", warning: upserted.warning };
  }

  const selection = toSelection(upserted.fact);
  if (!selection) {
    return { ok: false, status: "persistence_failed", warning: "selected_shipping_option_fact_reload_malformed" };
  }

  return { ok: true, status: "selected", selection, changed: true };
}

/** Rehydration: read-only, durable-state-first. Null whenever no confirmed selection exists yet for this opportunity. */
export async function getActiveSelectedShippingOptionForOpportunity(opportunityId: number): Promise<SelectedShippingOption | null> {
  const anchor = buildSelectedShippingOptionRequestAnchor(opportunityId);
  const fact = await getActiveRequestFact(anchor, SELECTED_SHIPPING_OPTION_FACT_KEY);
  if (!fact || fact.status !== "confirmed") return null;
  return toSelection(fact);
}

/**
 * SALES-AGENT-R1-T2.1.1. The single freshness definition - compares
 * evidence's two staleness anchors (captured at calculate_shipping time)
 * against the opportunity's CURRENT active commercial_line_items/
 * shipping_destination facts - never against values at selection/calculation
 * time, which could themselves already be stale. Pure w.r.t. its two
 * injected readers: usable both BEFORE a selection is persisted
 * (selectShippingOptionCapability.ts, evidence only) and AFTER
 * (checkShippingSelectionFreshness below, a persisted SelectedShippingOption
 * satisfies ShippingFreshnessEvidence structurally) - one rule, two callers,
 * never duplicated.
 */
export async function checkShippingEvidenceFreshness(
  opportunityId: number,
  evidence: ShippingFreshnessEvidence,
  deps: FreshnessDependencies = {}
): Promise<ShippingSelectionFreshnessCheck> {
  const getCommercialLineItems = deps.getCommercialLineItems ?? getActiveCommercialLineItemsForOpportunity;
  const getShippingDestination = deps.getShippingDestination ?? getActiveShippingDestinationForOpportunity;

  const [currentSelection, currentDestination] = await Promise.all([
    getCommercialLineItems(opportunityId),
    getShippingDestination(opportunityId)
  ]);

  if (!currentSelection || currentSelection.factId !== evidence.selectionFactId) {
    return { fresh: false, reason: "selection_changed" };
  }
  if (!currentDestination || currentDestination.factId !== evidence.destinationFactId) {
    return { fresh: false, reason: "destination_changed" };
  }
  return { fresh: true };
}

/** Task section 6/14: same rule as checkShippingEvidenceFreshness, applied to an already-persisted selection (assembleQuoteInput/checkShippingSelectionReadiness). */
export async function checkShippingSelectionFreshness(
  opportunityId: number,
  selection: SelectedShippingOption,
  deps: FreshnessDependencies = {}
): Promise<ShippingSelectionFreshnessCheck> {
  return checkShippingEvidenceFreshness(opportunityId, selection, deps);
}
