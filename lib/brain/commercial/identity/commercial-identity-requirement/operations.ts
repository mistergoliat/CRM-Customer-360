import type { CommercialIdentityRequirement } from "./types";

// SALES-AGENT-R2-ID-R2-A06, PARTE 1/5. Real operations audited directly
// against the codebase - never invented. Sources:
//   - lib/brain/commercial/capability-gateway/registry.ts (CAPABILITY_GATEWAY_REGISTRY)
//   - lib/brain/commercial/capability-gateway/customerIdentityCapabilities.ts
//   - lib/brain/commercial/work/stepTypes.ts (COMMERCIAL_WORK_STEP_CAPABILITIES)
//   - lib/brain/commercial/customer-profile-context/ (real module, not a
//     Capability Gateway capability - loaded directly by the Agent Tool Loop)
//   - lib/domains/customer-identity-verification (evaluateEntityVerification,
//     entityType "order" - the LEVEL_4 mechanism already exists; no
//     Capability Gateway tool calls it yet)
//
// | Operation | Exists today | Runtime owner | Mutating | Customer-specific | Sensitive | Requirement |
// |---|---|---|---|---|---|---|
// | search_products | yes (capability) | CommercialWork/Agent Tool Loop/legacy | no | no | no | NONE |
// | get_product_details | yes (capability) | same | no | no | no | NONE |
// | batch_get_products | yes (capability) | same | no | no | no | NONE |
// | explore_catalog | yes (capability) | same | no | no | no | NONE |
// | search_company_knowledge | yes (capability) | Agent Tool Loop | no | no | no | NONE |
// | recommend_catalog_products | yes (capability) | same | no | no | no | NONE |
// | select_products | yes (capability) | same | yes (durable line items) | no | no | NONE |
// | set_shipping_destination | yes (capability) | same | yes (durable destination) | no | no | NONE |
// | calculate_shipping | yes (capability) | same | no | no | no | NONE |
// | select_shipping_option | yes (capability) | same | yes (durable selection) | no | no | NONE |
// | create_quote | yes (capability) | same | yes (external Quote Service) | yes | yes (pricing) | MINIMUM_LEVEL LEVEL_2 |
// | resolve_customer | yes (capability) | native-cycle session boundary | no | yes | yes | NONE (bootstrapping - called precisely because identity is not resolved yet) |
// | link_external_identity | yes (capability) | native-cycle session boundary | yes (customer_external_identity) | yes | yes | MINIMUM_LEVEL LEVEL_2 (necessary precondition only - see doc) |
// | assisted_sale_handoff | yes (CommercialWork HANDOFF step type + dispatch, no capability) | CommercialWork/Agent Tool Loop | no (dispatch only) | no | no | MINIMUM_LEVEL LEVEL_1 |
// | customer_profile_history | yes (lib/brain/commercial/customer-profile-context) | Agent Tool Loop | no | yes | yes (purchase history/RFM) | MINIMUM_LEVEL LEVEL_3 |
// | order_status_entity_verification | mechanism exists (A04 evaluateEntityVerification, entityType "order"); no Capability Gateway tool calls it yet | none yet | no | yes | yes | ENTITY_VERIFICATION(order) |
//
// create_customer is deliberately EXCLUDED from this catalog (PARTE 5: "no
// duplicar ACS-R1-04 eligibility policy"). Its eligibility (purpose,
// consent, fresh no_match, projection gate) already lives entirely in
// runCustomerOnboardingPostPlanStage.ts/evaluateCreateCustomerAuthority - a
// MINIMUM_LEVEL requirement would not even make sense for it (it is called
// exactly when identity is NOT yet resolved), and re-modeling its real
// eligibility rules here would be exactly the duplication the task
// prohibits. If a future slice needs create_customer represented in this
// catalog, it must reuse the existing authority, never redefine it.

export const COMMERCIAL_OPERATIONS = [
  "search_products",
  "get_product_details",
  "batch_get_products",
  "explore_catalog",
  "search_company_knowledge",
  "recommend_catalog_products",
  "select_products",
  "set_shipping_destination",
  "calculate_shipping",
  "select_shipping_option",
  "create_quote",
  "resolve_customer",
  "link_external_identity",
  "assisted_sale_handoff",
  "customer_profile_history",
  "order_status_entity_verification"
] as const;

export type CommercialOperation = (typeof COMMERCIAL_OPERATIONS)[number];

const REQUIREMENT_BY_OPERATION: Record<CommercialOperation, CommercialIdentityRequirement> = {
  search_products: { kind: "NONE" },
  get_product_details: { kind: "NONE" },
  batch_get_products: { kind: "NONE" },
  explore_catalog: { kind: "NONE" },
  search_company_knowledge: { kind: "NONE" },
  recommend_catalog_products: { kind: "NONE" },
  select_products: { kind: "NONE" },
  // PARTE 5: shipping data (a comuna/address) is never identity - collecting
  // or estimating it never requires a resolved customer.
  set_shipping_destination: { kind: "NONE" },
  calculate_shipping: { kind: "NONE" },
  select_shipping_option: { kind: "NONE" },
  // PARTE 5: "probable LEVEL_2" - assembleQuoteInput reads customer identity
  // from context and degrades gracefully today when it is missing (never a
  // hard block at the capability layer yet); this is the PROPOSED
  // requirement for a future gating slice (A07+), not a behavior change here.
  create_quote: { kind: "MINIMUM_LEVEL", level: "LEVEL_2_MASTER_RESOLVED" },
  resolve_customer: { kind: "NONE" },
  // PARTE 5: necessary but not sufficient - the real authorization (explicit
  // consent this turn, no_match freshness) is governed entirely by the
  // existing ACS-R1-04 link authority, never duplicated here.
  link_external_identity: { kind: "MINIMUM_LEVEL", level: "LEVEL_2_MASTER_RESOLVED" },
  // PARTE 7: assisted sale must never require full onboarding just because
  // checkout does not exist yet - a human can carry an anonymous-ish
  // conversation forward once the channel itself is observed.
  assisted_sale_handoff: { kind: "MINIMUM_LEVEL", level: "LEVEL_1_CHANNEL_OBSERVED" },
  // PARTE 5: purchase history/RFM is sourced from PrestaShop - a LEVEL_2
  // master resolved via wa_id/phone alone is not proof this person owns the
  // PrestaShop account whose history would be disclosed.
  customer_profile_history: { kind: "MINIMUM_LEVEL", level: "LEVEL_3_PRESTASHOP_LINKED" },
  order_status_entity_verification: { kind: "ENTITY_VERIFICATION", entityType: "order" }
};

/** PARTE 15: pure lookup, no I/O. */
export function getCommercialIdentityRequirement(operation: CommercialOperation): CommercialIdentityRequirement {
  return REQUIREMENT_BY_OPERATION[operation];
}
