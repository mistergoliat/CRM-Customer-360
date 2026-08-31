import type { CommercialOperation } from "./operations";

// SALES-AGENT-R3-A02. The single, explicit translation from a registered
// Capability Gateway capability name (lib/brain/commercial/capability-gateway/
// registry.ts + customerIdentityCapabilities.ts) to A06's CommercialOperation
// vocabulary (operations.ts) - mirrors commercialIdentityGate.ts's own
// COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION pattern (objective type -> operation)
// one layer down (capability -> operation), so the shared execution-boundary
// gate (capability-gateway/identityGate.ts) never re-derives a requirement,
// only looks one up. Capability names equal their operation name in every
// case except the two Customer Profile reads, which share operations.ts's
// single `customer_profile_history` LEVEL_3 boundary (see operations.ts).
const CAPABILITY_TO_COMMERCIAL_OPERATION: Partial<Record<string, CommercialOperation>> = {
  search_products: "search_products",
  get_product_details: "get_product_details",
  batch_get_products: "batch_get_products",
  explore_catalog: "explore_catalog",
  search_company_knowledge: "search_company_knowledge",
  recommend_catalog_products: "recommend_catalog_products",
  select_products: "select_products",
  set_shipping_destination: "set_shipping_destination",
  calculate_shipping: "calculate_shipping",
  select_shipping_option: "select_shipping_option",
  create_quote: "create_quote",
  resolve_customer: "resolve_customer",
  link_external_identity: "link_external_identity",
  get_customer_purchase_history: "customer_profile_history",
  get_customer_recommendation_signal: "customer_profile_history"
};

/**
 * Registered mutating capabilities whose real identity/consent authority is
 * already fully owned by their own execute() and must never be re-decided by
 * the generic MINIMUM_LEVEL gate:
 *   - create_customer: called exactly when identity is NOT yet resolved
 *     (operations.ts already excludes it from COMMERCIAL_OPERATIONS for the
 *     same reason) - its eligibility (purpose, consent, fresh no_match,
 *     projection gate) lives entirely in evaluateCreateCustomerAuthority.
 *   - link_prestashop_identity: gated on the strictly narrower
 *     RuntimeIdentityContext.status === "READY_TO_LINK" precondition inline
 *     in its own execute() (customerIdentityCapabilities.ts) - a
 *     MINIMUM_LEVEL requirement cannot express that predicate without
 *     duplicating it.
 * Never grown to cover a capability that simply forgot to register a
 * requirement - a genuinely unmapped mutating capability must fail closed
 * (see identityGate.ts), not be silently exempted here.
 */
const IDENTITY_SELF_GOVERNED_CAPABILITIES: ReadonlySet<string> = new Set(["create_customer", "link_prestashop_identity"]);

/** Pure lookup, no I/O. Null for a capability with no generic identity requirement mapping. */
export function getCommercialOperationForCapability(capability: string): CommercialOperation | null {
  return CAPABILITY_TO_COMMERCIAL_OPERATION[capability] ?? null;
}

export function isIdentitySelfGovernedCapability(capability: string): boolean {
  return IDENTITY_SELF_GOVERNED_CAPABILITIES.has(capability);
}
