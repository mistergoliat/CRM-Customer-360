import { resolveCapabilityGatewayDefinition } from "../capability-gateway/registry";
import { getCommercialOperationForCapability } from "../identity/commercial-identity-requirement/capabilityOperations";
import { getCommercialIdentityRequirement } from "../identity/commercial-identity-requirement/operations";
import type { CapabilityEligibilityDefinition, ResolvedCapabilityEligibilityDefinition } from "./types";

export const CAPABILITY_ELIGIBILITY_METADATA_VERSION = "p6.2-b.1" as const;

/**
 * P6.2's narrow structural scope. This is a sidecar of the Gateway
 * registry, not a second capability registry: it can only describe a name
 * that the Gateway already registers, and side-effect classification is read
 * from that canonical definition at evaluation time.
 */
export const CAPABILITY_ELIGIBILITY_DEFINITIONS = [
  { capability: "search_products", supportedObjectives: null, prerequisites: [] },
  { capability: "search_products_by_semantics", supportedObjectives: null, prerequisites: [] },
  { capability: "explore_catalog", supportedObjectives: null, prerequisites: [] },
  { capability: "get_product_details", supportedObjectives: null, prerequisites: [] },
  { capability: "recommend_catalog_products", supportedObjectives: null, prerequisites: [] },
  { capability: "select_products", supportedObjectives: ["SELECT_PRODUCTS"], prerequisites: [] },
  { capability: "set_shipping_destination", supportedObjectives: ["QUOTE"], prerequisites: [] },
  { capability: "calculate_shipping", supportedObjectives: ["QUOTE"], prerequisites: ["CURRENT_SELECTION", "CURRENT_DESTINATION"] },
  // Quote assembly currently has requireShipping:false. Do not make
  // destination/shipping facts an invented prerequisite here.
  { capability: "create_quote", supportedObjectives: ["QUOTE"], prerequisites: ["CURRENT_SELECTION"] },
  { capability: "get_quote", supportedObjectives: ["QUOTE"], prerequisites: ["CURRENT_QUOTE"] }
] as const satisfies readonly CapabilityEligibilityDefinition[];

export function resolveCapabilityEligibilityDefinitions(): readonly ResolvedCapabilityEligibilityDefinition[] {
  return CAPABILITY_ELIGIBILITY_DEFINITIONS.map((definition) => {
    const gatewayDefinition = resolveCapabilityGatewayDefinition(definition.capability);
    if (!gatewayDefinition) {
      throw new Error(`capability_eligibility_gateway_definition_missing:${definition.capability}`);
    }
    const operation = getCommercialOperationForCapability(definition.capability);
    if (!operation) {
      throw new Error(`capability_eligibility_identity_operation_missing:${definition.capability}`);
    }
    const identityRequirement = getCommercialIdentityRequirement(operation);
    // P6.2-B admits the canonical minimum-level policy of create_quote, but
    // entity-scoped verification has no equivalent complete DRM fact yet.
    if (identityRequirement.kind === "ENTITY_VERIFICATION") {
      throw new Error(`capability_eligibility_identity_scope_unsupported:${definition.capability}`);
    }
    return {
      ...definition,
      executionClass: gatewayDefinition.governance.sideEffect,
      identityRequirement
    };
  });
}
