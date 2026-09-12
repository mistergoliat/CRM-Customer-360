import { checkShippingEvidenceFreshness } from "@/lib/domains/selected-shipping-option";
import { asString, isRecord, readLatestCalculateShippingEvidence } from "./resolveObservedShippingOption";
import type { ShippingExecutionDataAccess } from "./resolveObservedShippingOption";

/**
 * SALES-AGENT-R3-SHIPPING-CONTEXT-PROJECTION-V1. Pre-decision evidence
 * projection - fixes TS005_PRIOR_OPTIONS_NOT_PROJECTED (calculate_shipping's
 * options were durable and validated post-decision by
 * resolveObservedShippingOption/select_shipping_option, but never visible to
 * the model BEFORE it decides the next AgentStep). This is factual evidence
 * only: no selected/preferred/cheapest/recommended option, no customer
 * intent, no next-action hint. Whether to call select_shipping_option stays
 * entirely the model's own decision - see runAgentToolLoop.ts's call site.
 */
export type LatestShippingQuoteOption = {
  index: number;
  carrierName: string;
  serviceType: string;
  totalCost: number;
  estimatedDelivery: string;
};

export type LatestShippingQuoteContext = {
  sourceExecutionId: string;
  destination: { communeId: number; canonicalName: string } | null;
  totalWeightKg: number | null;
  totalBoleta: number | null;
  options: LatestShippingQuoteOption[];
};

/**
 * Fails closed (returns null) whenever the latest completed calculate_shipping
 * execution for this conversation is not a clean, still-fresh "available"
 * quote:
 *  - no completed execution at all
 *  - malformed/incomplete envelope (see readLatestCalculateShippingEvidence)
 *  - any option entry itself malformed (never surfaces a partial/broken list)
 *  - stale: selectionFactId/destinationFactId no longer match the
 *    opportunity's CURRENT commercial_line_items/shipping_destination facts -
 *    checked via checkShippingEvidenceFreshness, the exact same freshness
 *    definition select_shipping_option's own evidence gate already enforces
 *    post-decision (lib/domains/selected-shipping-option/service.ts). One
 *    freshness rule, two callers - never a second, drifting definition here.
 */
export async function resolveLatestShippingQuoteContext(input: {
  conversationId: number;
  opportunityId: number;
  dataAccess?: ShippingExecutionDataAccess | null;
  checkFreshness?: typeof checkShippingEvidenceFreshness;
}): Promise<LatestShippingQuoteContext | null> {
  const read = await readLatestCalculateShippingEvidence({ conversationId: input.conversationId, dataAccess: input.dataAccess });
  if (read.status !== "found") return null;

  const options: LatestShippingQuoteOption[] = [];
  for (const rawOption of read.evidence.rawOptions) {
    if (!isRecord(rawOption)) return null;
    const index = typeof rawOption.index === "number" && Number.isInteger(rawOption.index) ? rawOption.index : null;
    const carrierName = asString(rawOption.carrierName);
    const serviceType = asString(rawOption.serviceType);
    const estimatedDelivery = asString(rawOption.estimatedDelivery);
    const totalCost = typeof rawOption.totalCost === "number" && Number.isFinite(rawOption.totalCost) ? rawOption.totalCost : null;
    if (index === null || !carrierName || !serviceType || !estimatedDelivery || totalCost === null) return null;
    options.push({ index, carrierName, serviceType, totalCost, estimatedDelivery });
  }
  if (options.length === 0) return null;

  const checkFreshness = input.checkFreshness ?? checkShippingEvidenceFreshness;
  const freshness = await checkFreshness(input.opportunityId, {
    selectionFactId: read.evidence.selectionFactId,
    destinationFactId: read.evidence.destinationFactId
  });
  if (!freshness.fresh) return null;

  return {
    sourceExecutionId: read.evidence.shippingQuoteExecutionId,
    destination: read.evidence.destination,
    totalWeightKg: read.evidence.totalWeightKg,
    totalBoleta: read.evidence.totalBoleta,
    options
  };
}
