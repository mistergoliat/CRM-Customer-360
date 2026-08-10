import { createPcPosCommuneResolver } from "@/lib/integrations/logistics";
import type { CommuneResolver } from "@/lib/domains/commune-resolution";
import { setShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import type { CapabilityGatewayContext, CapabilityGatewayDefinition } from "./types";

const CAPABILITY_GATEWAY_VERSION = "capability-gateway.v1" as const;

/**
 * CRM-R1-T13D. The agent supplies only the destination text it observed in
 * the conversation - never a communeId. The backend (CommuneResolver, T13C)
 * is the only source of that identity; see setShippingDestinationForOpportunity.
 */
export const SET_SHIPPING_DESTINATION_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["destination"],
  properties: {
    destination: { type: "string" }
  }
} as const;

let cachedResolver: CommuneResolver | undefined;
function getSharedCommuneResolver(): CommuneResolver {
  if (!cachedResolver) cachedResolver = createPcPosCommuneResolver();
  return cachedResolver;
}

/** Test-only: force the registry to re-create the commune resolver (e.g. after injecting a fake). */
export function resetCommuneResolverForTests() {
  cachedResolver = undefined;
}

/** Test-only: inject a fake resolver directly, bypassing the real pc_pos-backed default. */
export function setCommuneResolverForTests(resolver: CommuneResolver) {
  cachedResolver = resolver;
}

function asDestinationText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * set_shipping_destination: mutating, autonomous (an explicit, unambiguous
 * customer-stated commune needs no operator pre-approval - same class as
 * create_customer/link_external_identity, see customerIdentityCapabilities.ts
 * for the authority-field rationale). Requires an active opportunity
 * (context.opportunityId) to anchor the durable fact to - denied, never
 * persisted under an invented anchor, when none exists yet.
 */
export function setShippingDestinationCapability(
  getResolver: () => CommuneResolver = getSharedCommuneResolver
): CapabilityGatewayDefinition<{ destination: string }, Record<string, unknown>> {
  return {
    capability: "set_shipping_destination",
    version: CAPABILITY_GATEWAY_VERSION,
    description:
      "Resolves a customer-stated destination commune (free text only, never a communeId) against the canonical pc_pos.comuna catalog and persists it as this opportunity's durable, authoritative shipping destination. Superseded automatically when the customer states a different commune. Never resolves an ambiguous city/region (e.g. Santiago, Arica y Parinacota) - returns needs_clarification instead.",
    governance: { sideEffect: "mutating", authority: "autonomous", riskClass: "low" },
    maxRetries: 0,
    inputSchema: SET_SHIPPING_DESTINATION_INPUT_SCHEMA,
    async checkAvailability() {
      return { status: "available", reason: null };
    },
    async execute(input, context: CapabilityGatewayContext) {
      const destination = asDestinationText(input.destination);
      if (!destination) {
        return { status: "invalid_arguments", data: null, errorCode: "destination_required", retryable: false, evidence: [] };
      }

      const opportunityId = typeof context.opportunityId === "number" ? context.opportunityId : null;
      if (!opportunityId) {
        return { status: "denied", data: null, errorCode: "no_active_opportunity", retryable: false, evidence: [] };
      }

      const result = await setShippingDestinationForOpportunity(
        { opportunityId, inputText: destination, sourceToolExecutionId: context.correlationId },
        { resolver: getResolver() }
      );

      const evidence = [{ source: "commune_resolution", summary: `set_shipping_destination resolved to status=${result.status}.`, capturedAt: new Date().toISOString() }];

      switch (result.status) {
        case "resolved":
          return {
            status: "completed",
            data: { status: "resolved", destination: { communeId: result.destination.communeId, canonicalName: result.destination.canonicalName }, persisted: true, changed: result.changed },
            errorCode: null,
            retryable: false,
            evidence
          };
        case "needs_clarification":
          return { status: "completed", data: { status: "needs_clarification", input: result.input, reason: result.reason }, errorCode: null, retryable: false, evidence };
        case "not_found":
          return { status: "completed", data: { status: "not_found", input: result.input }, errorCode: null, retryable: false, evidence };
        case "invalid_input":
          return { status: "invalid_arguments", data: null, errorCode: "destination_required", retryable: false, evidence: [] };
        case "resolver_error":
          return { status: "temporarily_blocked", data: null, errorCode: result.reason, retryable: true, evidence };
        case "persistence_failed":
          return { status: "failed", data: null, errorCode: "shipping_destination_persistence_failed", retryable: false, evidence: [] };
        default:
          return { status: "failed", data: null, errorCode: "unknown_result", retryable: false, evidence: [] };
      }
    }
  };
}
