import { checkShippingEvidenceFreshness, setSelectedShippingOptionForOpportunity, SHIPPING_CALCULATION_STALE_ERROR_CODE } from "@/lib/domains/selected-shipping-option";
import { resolveObservedShippingOption } from "../agent-loop/resolveObservedShippingOption";
import type { CapabilityGatewayContext, CapabilityGatewayDefinition } from "./types";

const CAPABILITY_GATEWAY_VERSION = "capability-gateway.v1" as const;

/**
 * SALES-AGENT-R1-T2.1. The model supplies only `optionIndex` - the array
 * position of an option it already saw in a real calculate_shipping
 * response this conversation. Structurally cannot supply totalCost/
 * carrierName/serviceType - those fields do not exist in this schema at
 * all, so a fabricated price is not merely rejected, it is impossible to
 * send.
 */
export const SELECT_SHIPPING_OPTION_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["optionIndex"],
  properties: {
    optionIndex: { type: "integer", minimum: 0 }
  }
} as const;

/**
 * select_shipping_option: mutating, autonomous (an explicit, evidence-grounded
 * customer shipping choice needs no operator pre-approval - same governance
 * class as select_products/set_shipping_destination). Requires an active
 * opportunity AND conversation (context.opportunityId/conversationId) -
 * denied, never persisted under an invented anchor, when either is missing.
 *
 * Evidence gate lives HERE (inside execute()), not in runAgentToolLoop.ts's
 * pre-Gateway check like select_products/recommend_catalog_products use -
 * deliberately different from that pattern because the rationale for
 * checking evidence before the Gateway (avoid a wasted real HTTP call to
 * Catalog Service on a fabricated reference) does not apply: this capability
 * makes no external call, only a DB read+write, and shipping evidence has
 * exactly one consumer (this tool), unlike catalog evidence which several
 * tools share. See lib/brain/commercial/agent-loop/resolveObservedShippingOption.ts.
 *
 * SALES-AGENT-R1-T2.1.1. A resolved-but-stale evidence is rejected too, still
 * before any write: if commercial_line_items or shipping_destination changed
 * since the calculate_shipping run this option was observed in, persisting it
 * now would silently apply a tariff to a cart/destination it was never
 * actually calculated for. Checked here (not only later in
 * assembleQuoteInput, which remains a defense-in-depth check on the
 * already-persisted selection) via the same checkShippingEvidenceFreshness
 * rule assembleQuoteInput uses post-write.
 */
export function selectShippingOptionCapability(): CapabilityGatewayDefinition<{ optionIndex: unknown }, Record<string, unknown>> {
  return {
    capability: "select_shipping_option",
    version: CAPABILITY_GATEWAY_VERSION,
    description:
      "Records the customer's confirmed shipping choice (carrier + service type) as this opportunity's durable, authoritative selected shipping option. The ONLY input is optionIndex - the position of an option the customer picked from a calculate_shipping result already shown this conversation. Never accepts a carrier name, service type, or price from the model - a fabricated or unobserved optionIndex is rejected before anything is persisted.",
    governance: { sideEffect: "mutating", authority: "autonomous", riskClass: "low" },
    maxRetries: 0,
    inputSchema: SELECT_SHIPPING_OPTION_INPUT_SCHEMA,
    async checkAvailability() {
      return { status: "available", reason: null };
    },
    async execute(input, context: CapabilityGatewayContext) {
      const opportunityId = typeof context.opportunityId === "number" ? context.opportunityId : null;
      const conversationId = typeof context.conversationId === "number" ? context.conversationId : null;
      if (!opportunityId || !conversationId) {
        return { status: "denied", data: null, errorCode: "no_active_opportunity", retryable: false, evidence: [] };
      }

      const evidence = await resolveObservedShippingOption({ conversationId, optionIndex: input.optionIndex });
      if (evidence.status === "blocked") {
        return { status: "invalid_arguments", data: null, errorCode: evidence.reason, retryable: false, evidence: [] };
      }

      const freshness = await checkShippingEvidenceFreshness(opportunityId, {
        selectionFactId: evidence.option.selectionFactId,
        destinationFactId: evidence.option.destinationFactId
      });
      if (!freshness.fresh) {
        return {
          status: "invalid_arguments",
          data: { status: "shipping_calculation_stale", reason: freshness.reason },
          errorCode: SHIPPING_CALCULATION_STALE_ERROR_CODE,
          retryable: false,
          evidence: []
        };
      }

      const result = await setSelectedShippingOptionForOpportunity({
        opportunityId,
        option: {
          carrierName: evidence.option.carrierName,
          serviceType: evidence.option.serviceType,
          totalCost: evidence.option.totalCost,
          estimatedDelivery: evidence.option.estimatedDelivery,
          optionIndex: evidence.option.optionIndex,
          shippingQuoteExecutionId: evidence.option.shippingQuoteExecutionId,
          shippingQuoteCorrelationId: evidence.option.shippingQuoteCorrelationId,
          selectionFactId: evidence.option.selectionFactId,
          destinationFactId: evidence.option.destinationFactId,
          calculatedAt: evidence.option.calculatedAt
        },
        sourceToolExecutionId: context.correlationId
      });

      if (!result.ok) {
        return { status: "failed", data: null, errorCode: "selected_shipping_option_persistence_failed", retryable: false, evidence: [] };
      }

      return {
        status: "completed",
        data: {
          status: "selected",
          carrierName: result.selection.carrierName,
          serviceType: result.selection.serviceType,
          totalCost: result.selection.totalCost,
          estimatedDelivery: result.selection.estimatedDelivery,
          changed: result.changed
        },
        errorCode: null,
        retryable: false,
        evidence: [
          {
            source: "calculate_shipping_execution",
            summary: `select_shipping_option resolved optionIndex=${evidence.option.optionIndex} from execution=${evidence.option.shippingQuoteExecutionId}.`,
            capturedAt: new Date().toISOString()
          }
        ]
      };
    }
  };
}
