import { createCatalogPort } from "@/lib/catalog";
import type { CatalogPort } from "@/lib/catalog";
import { createCarrierService } from "@/lib/integrations/carrier-service";
import type { CarrierService } from "@/lib/domains/carrier-service";
import { getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import { getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { validateAndSumTotalBoleta, validateAndSumWeightKg } from "@/lib/domains/shipping-calculation";
import type { PricedLineItem, ShippingCalculationLineItem } from "@/lib/domains/shipping-calculation";
import type { CapabilityEvidence, CapabilityGatewayContext, CapabilityGatewayDefinition, CapabilityExecutionOutcome } from "./types";

const CAPABILITY_GATEWAY_VERSION = "capability-gateway.v1" as const;

/**
 * CRM-R1-T13E.2. The model decides only that shipping needs calculating -
 * every parameter (destination, products, quantities, weight, price) is
 * backend state. No property accepts anything from the model - a fabricated
 * communeId/kilos/total_boleta in the raw tool call is structurally
 * impossible, not merely ignored.
 */
export const CALCULATE_SHIPPING_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false
} as const;

let cachedCatalogPort: CatalogPort | null | undefined;
function getSharedCatalogPortForShipping(): CatalogPort | null {
  if (cachedCatalogPort === undefined) cachedCatalogPort = createCatalogPort();
  return cachedCatalogPort;
}
/** Test-only: force re-read of env / re-creation of the catalog port. */
export function resetCalculateShippingCatalogPortForTests() {
  cachedCatalogPort = undefined;
}
/** Test-only: inject a fake catalog port directly. */
export function setCalculateShippingCatalogPortForTests(port: CatalogPort | null) {
  cachedCatalogPort = port;
}

let cachedCarrierService: CarrierService | null | undefined;
function getSharedCarrierServiceForShipping(): CarrierService | null {
  if (cachedCarrierService === undefined) cachedCarrierService = createCarrierService();
  return cachedCarrierService;
}
/** Test-only: force re-read of env / re-creation of the carrier service. */
export function resetCalculateShippingCarrierServiceForTests() {
  cachedCarrierService = undefined;
}
/** Test-only: inject a fake carrier service directly. */
export function setCalculateShippingCarrierServiceForTests(service: CarrierService | null) {
  cachedCarrierService = service;
}

function completed(status: string, extra: Record<string, unknown> = {}, evidence: CapabilityEvidence[] = []): CapabilityExecutionOutcome {
  return { status: "completed", data: { status, ...extra }, errorCode: null, retryable: false, evidence };
}

function technicalFailure(errorCode: string, retryable: boolean): CapabilityExecutionOutcome {
  return { status: retryable ? "temporarily_blocked" : "failed", data: null, errorCode, retryable, evidence: [] };
}

/**
 * calculate_shipping: mutating=false in spirit (it persists nothing of its
 * own - shipping_destination and commercial_line_items are already
 * durable), but classed read_only/autonomous/low, same governance shape as
 * the other read-oriented capabilities. Executor pipeline (T13E.2 section
 * 16): opportunityId -> shipping_destination (T13D) -> commercial_line_items
 * (T13E.2) -> Catalog Service batch hydration -> totalWeightKg/total_boleta
 * -> CarrierService.quoteAll() -> normalized result. Fails closed at every
 * step - never a fabricated coverage/carrier/rate.
 */
export function calculateShippingCapability(
  getCatalogPort: () => CatalogPort | null = getSharedCatalogPortForShipping,
  getCarrierService: () => CarrierService | null = getSharedCarrierServiceForShipping
): CapabilityGatewayDefinition<Record<string, never>, Record<string, unknown>> {
  return {
    capability: "calculate_shipping",
    version: CAPABILITY_GATEWAY_VERSION,
    description:
      "Calculates real shipping alternatives (carrier, service type, cost, estimated delivery) for the customer's confirmed destination and selected products via Carrier MS - the sole authority over coverage/carriers/rates. Takes no arguments: destination comes from set_shipping_destination (T13D), products/quantities from select_products. Denies with a typed reason when destination or product selection is missing, or when weight/price cannot be resolved for a selected product - never estimates or invents any of these.",
    governance: { sideEffect: "read_only", authority: "autonomous", riskClass: "low" },
    maxRetries: 0,
    inputSchema: CALCULATE_SHIPPING_INPUT_SCHEMA,
    async checkAvailability() {
      return { status: "available", reason: null };
    },
    async execute(_input, context: CapabilityGatewayContext) {
      const opportunityId = typeof context.opportunityId === "number" ? context.opportunityId : null;
      if (!opportunityId) {
        return { status: "denied", data: null, errorCode: "no_active_opportunity", retryable: false, evidence: [] };
      }

      const destination = await getActiveShippingDestinationForOpportunity(opportunityId);
      if (!destination) {
        return completed("shipping_destination_required");
      }

      const selection = await getActiveCommercialLineItemsForOpportunity(opportunityId);
      if (!selection || selection.items.length === 0) {
        return completed("commercial_items_required");
      }

      const catalogPort = getCatalogPort();
      if (!catalogPort) {
        return technicalFailure("catalog_unavailable", true);
      }

      const batchResult = await catalogPort.batchGetProducts(
        { items: selection.items.map((item) => ({ productId: item.productId, ...(item.combinationId ? { combinationId: item.combinationId } : {}), quantity: item.quantity })) },
        { correlationId: context.correlationId }
      );
      if (!batchResult.ok) {
        return technicalFailure("catalog_unavailable", true);
      }

      const quantityByKey = new Map(selection.items.map((item) => [`${item.productId}:${item.combinationId ?? ""}`, item.quantity]));
      const weightItems: ShippingCalculationLineItem[] = [];
      const priceItems: PricedLineItem[] = [];

      for (const result of batchResult.value.items) {
        if (!result.ok) {
          return completed("catalog_product_unavailable", { productId: result.input.productId });
        }
        const key = `${result.input.productId}:${result.input.combinationId ?? ""}`;
        const quantity = quantityByKey.get(key);
        if (quantity === undefined) {
          // Defensive only: every batch item was built 1:1 from selection.items - this should be unreachable.
          return technicalFailure("catalog_response_mismatch", false);
        }
        const combinationId = result.input.combinationId ?? null;
        weightItems.push({ productId: result.product.productId, combinationId, quantity, unitWeightKg: result.product.weightKg });
        priceItems.push({ productId: result.product.productId, combinationId, quantity, unitPrice: result.product.price?.amount ?? null });
      }

      const weightResult = validateAndSumWeightKg(weightItems);
      if (!weightResult.ok) {
        if (weightResult.status === "weight_unavailable") return completed("weight_unavailable");
        return technicalFailure(weightResult.reason, false);
      }

      const subtotalResult = validateAndSumTotalBoleta(priceItems);
      if (!subtotalResult.ok) {
        if (subtotalResult.status === "price_unavailable") return completed("price_unavailable");
        return technicalFailure(subtotalResult.reason, false);
      }

      const carrierService = getCarrierService();
      if (!carrierService) {
        return technicalFailure("carrier_service_unavailable", true);
      }

      const quote = await carrierService.quoteAll({
        destination: destination.canonicalName,
        totalWeightKg: weightResult.totalWeightKg,
        totalBoleta: subtotalResult.totalBoleta
      });

      const evidence: CapabilityEvidence[] = [
        {
          source: "carrier_service",
          summary: `calculate_shipping requested destino=${destination.canonicalName} kilos=${weightResult.totalWeightKg} total_boleta=${subtotalResult.totalBoleta}.`,
          capturedAt: new Date().toISOString()
        }
      ];

      if (!quote.ok) {
        const retryable = quote.reason !== "carrier_invalid_response";
        return { status: retryable ? "temporarily_blocked" : "failed", data: null, errorCode: quote.reason, retryable, evidence };
      }

      const destinationSummary = { communeId: destination.communeId, canonicalName: destination.canonicalName };

      if (quote.options.length === 0) {
        return completed("no_shipping_options", { destination: destinationSummary, totalWeightKg: weightResult.totalWeightKg }, evidence);
      }

      return completed(
        "available",
        {
          destination: destinationSummary,
          totalWeightKg: weightResult.totalWeightKg,
          totalBoleta: subtotalResult.totalBoleta,
          // SALES-AGENT-R1-T2.1. `index` is the option's stable, deterministic
          // identity within THIS calculation (array position - Carrier MS
          // provides no option-level id/code of its own, confirmed live; an
          // invented random id would add no real traceability per the task's
          // own guidance). select_shipping_option's evidence gate
          // (resolveObservedShippingOption.ts) re-reads this exact array from
          // crm_capability_executions.response_summary_json later and
          // resolves the model's `optionIndex` against it - never against
          // free text/labels.
          options: quote.options.map((option, index) => ({
            index,
            carrierName: option.carrierName,
            serviceType: option.serviceType,
            totalCost: option.totalCost,
            estimatedDelivery: option.estimatedDelivery
          })),
          // Internal-only evidence (never shown to the model - stripped by
          // buildToolObservation.ts's projectCalculateShipping allowlist):
          // the exact durable fact versions this calculation was computed
          // against, so a later select_shipping_option call can be checked
          // for staleness if either changes before the customer picks.
          selectionFactId: selection.factId,
          destinationFactId: destination.factId
        },
        evidence
      );
    }
  };
}
