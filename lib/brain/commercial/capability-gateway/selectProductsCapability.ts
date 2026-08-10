import { setCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import type { CommercialLineItem } from "@/lib/domains/commercial-line-items";
import type { CapabilityGatewayContext, CapabilityGatewayDefinition } from "./types";

const CAPABILITY_GATEWAY_VERSION = "capability-gateway.v1" as const;

/**
 * CRM-R1-T13E.2. The model supplies productId/combinationId/quantity it
 * already observed via search_products/get_product_details/explore_catalog
 * this conversation - never a fabricated id, never dimensions, price or
 * weight (those are backend-hydrated later, from Catalog Service). Evidence
 * grounding (that every item was actually observed) happens in
 * runAgentToolLoop.ts BEFORE this capability's execute() ever runs - same
 * pattern already established for recommend_catalog_products' sourceProduct
 * (resolveObservedRecommendationSourceProduct.ts) - this capability trusts
 * that gate, it does not re-check evidence itself.
 */
export const SELECT_PRODUCTS_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["productId", "quantity"],
        properties: {
          productId: { type: "string" },
          combinationId: { type: "string" },
          quantity: { type: "integer", minimum: 1 }
        }
      }
    }
  }
} as const;

function asLineItems(value: unknown): CommercialLineItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items: CommercialLineItem[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const record = entry as Record<string, unknown>;
    const productId = typeof record.productId === "string" ? record.productId.trim() : "";
    if (!productId) return null;
    if (typeof record.quantity !== "number" || !Number.isInteger(record.quantity) || record.quantity <= 0) return null;
    const combinationId = typeof record.combinationId === "string" && record.combinationId.trim() ? record.combinationId.trim() : null;
    items.push({ productId, combinationId, quantity: record.quantity });
  }
  return items;
}

/**
 * select_products: mutating, autonomous (an explicit, evidence-grounded
 * customer product selection needs no operator pre-approval - same
 * governance class as set_shipping_destination). Requires an active
 * opportunity (context.opportunityId) to anchor the durable fact to -
 * denied, never persisted under an invented anchor, when none exists yet.
 * Each call replaces the opportunity's entire active selection - the model
 * must supply the complete desired list, not a delta.
 */
export function selectProductsCapability(): CapabilityGatewayDefinition<{ items: unknown }, Record<string, unknown>> {
  return {
    capability: "select_products",
    version: CAPABILITY_GATEWAY_VERSION,
    description:
      "Records the customer's confirmed product selection (productId/combinationId/quantity) as this opportunity's durable, authoritative commercial line items, replacing any prior selection entirely. Every item must reference a product this conversation actually observed via search_products/get_product_details/explore_catalog - a fabricated or unobserved productId is rejected before this capability runs. Each call must include the complete desired selection, never just the items being added.",
    governance: { sideEffect: "mutating", authority: "autonomous", riskClass: "low" },
    maxRetries: 0,
    inputSchema: SELECT_PRODUCTS_INPUT_SCHEMA,
    async checkAvailability() {
      return { status: "available", reason: null };
    },
    async execute(input, context: CapabilityGatewayContext) {
      const opportunityId = typeof context.opportunityId === "number" ? context.opportunityId : null;
      if (!opportunityId) {
        return { status: "denied", data: null, errorCode: "no_active_opportunity", retryable: false, evidence: [] };
      }

      const items = asLineItems(input.items);
      if (!items) {
        return { status: "invalid_arguments", data: null, errorCode: "items_required", retryable: false, evidence: [] };
      }

      const result = await setCommercialLineItemsForOpportunity({ opportunityId, items, sourceToolExecutionId: context.correlationId });

      const evidence = [{ source: "commercial_line_items", summary: `select_products resolved to status=${result.status}.`, capturedAt: new Date().toISOString() }];

      switch (result.status) {
        case "selected":
          return {
            status: "completed",
            data: { status: "selected", items: result.selection.items, changed: result.changed },
            errorCode: null,
            retryable: false,
            evidence
          };
        case "invalid_input":
          return { status: "invalid_arguments", data: null, errorCode: `invalid_input:${result.reason}`, retryable: false, evidence: [] };
        case "persistence_failed":
          return { status: "failed", data: null, errorCode: "commercial_line_items_persistence_failed", retryable: false, evidence: [] };
        default:
          return { status: "failed", data: null, errorCode: "unknown_result", retryable: false, evidence: [] };
      }
    }
  };
}
