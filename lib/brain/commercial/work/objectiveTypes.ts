export const COMMERCIAL_OBJECTIVE_TYPES = [
  "DISCOVER_PRODUCTS",
  "COMPARE_PRODUCTS",
  "RECOMMEND_PRODUCTS",
  "SELECT_PRODUCTS",
  "CHANGE_QUANTITY",
  "SET_DESTINATION",
  "GET_SHIPPING_QUOTE",
  "SELECT_SHIPPING_OPTION",
  "CREATE_QUOTE",
  "WAIT_FOR_QUOTE_APPROVAL",
  "HANDOFF",
  // SALES-AGENT-R2-ID-R2-A11. "Repeat a previous purchase" - customer profile
  // purchase history resolved into a productReference, then handed to the
  // exact same catalog-resolution/select_products chain a fresh product
  // request already uses (never a parallel workflow).
  "REPEAT_PURCHASE",
  // SALES-AGENT-R2-ID-R2-A12. "Recommend something based on purchase
  // history/behavior" - LEVEL_3-gated like REPEAT_PURCHASE (see
  // commercialIdentityGate.ts), but degrades to a generic Catalog search
  // (never blocks, never re-triggers onboarding) whenever history is absent
  // or Customer Profile is unavailable. Candidates always come from a real
  // search_products/T12 execution, never from historical data directly.
  "CUSTOMER_AWARE_RECOMMENDATION",
  // SALES-AGENT-R3-P5. R3's own, coarser objective vocabulary
  // (CommercialProposalV1's CommercialObjectiveKind) - additive, never
  // replaces the R2 values above. SELECT_PRODUCTS is intentionally shared
  // (same name, same meaning) rather than duplicated as e.g.
  // "R3_SELECT_PRODUCTS". No CHECK constraint exists on this column
  // (migrations/029, `type VARCHAR(64)`), so this extension needs no
  // migration. R2's own consumers of CommercialObjectiveType
  // (deriveCommercialObjectives.ts's commercialObjectiveSupersessionFamily,
  // objectiveFollowUpPolicies.ts, commercialIdentityGate.ts) were audited and
  // none switches exhaustively on this union - every one either only
  // type-annotates or falls back to "other" for an unrecognized value, so
  // these four new values are inert to R2's own pipeline (which R3 never
  // calls anyway - see objective-reconciliation/reconcile.ts's own comment).
  "DISCOVER_NEED",
  "QUOTE",
  "ORDER",
  "AFTER_SALES"
] as const;

export type CommercialObjectiveType = (typeof COMMERCIAL_OBJECTIVE_TYPES)[number];
