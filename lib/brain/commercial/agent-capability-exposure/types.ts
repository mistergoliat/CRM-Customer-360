// SALES-AGENT-R3-A04, Phase 2. The ONE canonical source answering "may an
// agent see/use this Capability Gateway capability, and through which
// surface?" This module never re-derives existence, governance, schemas or
// execution - capability-gateway/registry.ts remains the sole source of
// truth for those (see docs/architecture/SALES-AGENT-R3-A00-target-architecture.md,
// section C/D and docs/releases/SALES-AGENT-R3-A04-read-action-tool-surfaces.md
// Phase 1/2 for the full audit evidence behind every entry below).

export const AGENT_CAPABILITY_EXPOSURES = ["READ_TOOL", "COMMERCIAL_ACTION", "NOT_AGENT_EXPOSED"] as const;
export type AgentCapabilityExposure = (typeof AGENT_CAPABILITY_EXPOSURES)[number];

/**
 * Exhaustive over CAPABILITY_GATEWAY_REGISTRY at the time of A04 (17 entries -
 * verified by a test that diffs this map's keys against the live registry, so
 * a future capability added to the Gateway without a classification entry
 * here fails that test, never silently defaults through). Classified from
 * real implementation/governance/business-effect, never from the capability
 * name alone (task Phase 1 instruction).
 */
export const AGENT_CAPABILITY_EXPOSURE_CLASSIFICATION: Record<string, AgentCapabilityExposure> = {
  // Already in AGENT_LOOP_TOOL_POOL, governance.sideEffect=read_only, no
  // durable write of their own - see registry.ts/calculateShippingCapability.ts.
  search_products: "READ_TOOL",
  get_product_details: "READ_TOOL",
  explore_catalog: "READ_TOOL",
  search_company_knowledge: "READ_TOOL",
  recommend_catalog_products: "READ_TOOL",
  // calculate_shipping: real audit (A04 Phase 8) confirms execute() persists
  // nothing of its own - shipping_destination/commercial_line_items are
  // already durable via set_shipping_destination/select_products; it only
  // reads them plus a live Carrier MS quote. governance.sideEffect has been
  // read_only since this capability's introduction (git blame: c57b9a7),
  // never mutating - contradicting SALES-AGENT-R3-A02's audit table, which
  // is documented, not corrected (historical audits are not rewritten).
  calculate_shipping: "READ_TOOL",

  // The four capabilities R3-A03's CommercialActionRequest boundary already
  // maps - commercial-action-request/actionCapabilityMapping.ts remains the
  // single source for the action-type<->capability mapping; this entry only
  // records that these four are agent-visible through that surface.
  select_products: "COMMERCIAL_ACTION",
  set_shipping_destination: "COMMERCIAL_ACTION",
  select_shipping_option: "COMMERCIAL_ACTION",
  create_quote: "COMMERCIAL_ACTION",

  // Internal hydration - never aliased in AGENT_LOOP_TOOL_POOL, the Sales
  // Agent never decides to call this for itself (registry.ts's own comment).
  batch_get_products: "NOT_AGENT_EXPOSED",
  // Identity capabilities - invoked directly by resolveNativeCustomerSession/
  // runCustomerOnboardingPostPlanStage, never by a model tool request; no
  // tool alias exists for any of the four (toolAliases.ts/AGENT_LOOP_TOOL_POOL).
  resolve_customer: "NOT_AGENT_EXPOSED",
  create_customer: "NOT_AGENT_EXPOSED",
  link_external_identity: "NOT_AGENT_EXPOSED",
  link_prestashop_identity: "NOT_AGENT_EXPOSED",
  // get_customer_purchase_history / get_customer_recommendation_signal:
  // governance.sideEffect has been read_only since introduction (git blame:
  // 1135036, 0ca08bd) - contradicting both A00 Phase 2.C's and A02's "mutating
  // (durable read persisted as fact)" characterization, documented not
  // corrected. Structurally they COULD pass ReadToolGateway's read_only check
  // today. Classified NOT_AGENT_EXPOSED anyway per this task's Phase 9
  // preference: never aliased in AGENT_LOOP_TOOL_POOL, dispatched only by
  // CommercialWork's deterministic REPEAT_PURCHASE/CUSTOMER_AWARE_RECOMMENDATION
  // executor, gated on LEVEL_3_PRESTASHOP_LINKED via their own re-gate inside
  // loadCommercialCustomerContext - exposing them as a free-standing agent
  // tool would let the model pull customer purchase history outside that
  // controlled objective flow for no product need this task was asked to add.
  get_customer_purchase_history: "NOT_AGENT_EXPOSED",
  get_customer_recommendation_signal: "NOT_AGENT_EXPOSED"
};

/**
 * Unknown capability -> NOT_AGENT_EXPOSED, always (Phase 2's fail-closed
 * instruction) - never throws, never defaults to READ_TOOL/COMMERCIAL_ACTION.
 */
export function resolveAgentCapabilityExposure(capability: string): AgentCapabilityExposure {
  return AGENT_CAPABILITY_EXPOSURE_CLASSIFICATION[capability] ?? "NOT_AGENT_EXPOSED";
}

export function listCapabilitiesByExposure(exposure: AgentCapabilityExposure): string[] {
  return Object.entries(AGENT_CAPABILITY_EXPOSURE_CLASSIFICATION)
    .filter(([, value]) => value === exposure)
    .map(([capability]) => capability);
}
