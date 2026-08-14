import type { getActiveRequestFact, upsertRequestFact } from "@/lib/brain/commercial/request-facts";

/**
 * Persisted verbatim as crm_request_facts.value_json. Every field is either a
 * real, unmodified Carrier MS field (carrierName/serviceType/totalCost/
 * estimatedDelivery - Carrier MS provides no option-level id/code, no
 * currency, no tax metadata of its own, confirmed live - see
 * docs/integrations/quote-input-assembly.md "Shipping tax gap") or a
 * traceability anchor pointing back at the exact calculate_shipping
 * execution/durable state versions the customer's choice was evidenced
 * against - never an LLM-supplied value, never invented.
 */
export type SelectedShippingOptionFactValue = {
  carrierName: string;
  serviceType: string;
  totalCost: number;
  estimatedDelivery: string;
  /** The single option index (array position) within the source calculate_shipping response - the model's only input, never a label. */
  optionIndex: number;
  /** crm_capability_executions.public_id of the calculate_shipping run this option was observed in - "which calculation produced this value" (task section 18). */
  shippingQuoteExecutionId: string;
  shippingQuoteCorrelationId: string | null;
  /** commercial_line_items.factId active when the source calculation ran - staleness anchor (task section 6). */
  selectionFactId: string;
  /** shipping_destination.factId active when the source calculation ran - staleness anchor. */
  destinationFactId: string;
  /** crm_capability_executions.completed_at of the source calculation - never "now", Carrier MS reports no expiration/validity of its own (confirmed live). */
  calculatedAt: string;
  selectedAt: string;
};

/** Rehydrated, durable state - what a caller (assembler, capability) consumes. */
export type SelectedShippingOption = {
  carrierName: string;
  serviceType: string;
  totalCost: number;
  estimatedDelivery: string;
  optionIndex: number;
  shippingQuoteExecutionId: string;
  shippingQuoteCorrelationId: string | null;
  selectionFactId: string;
  destinationFactId: string;
  calculatedAt: string;
  selectedAt: string;
  factId: string;
  updatedAt: string;
};

export type SetSelectedShippingOptionResult =
  | { ok: true; status: "selected"; selection: SelectedShippingOption; changed: boolean }
  | { ok: false; status: "persistence_failed"; warning: string };

export type SetSelectedShippingOptionInput = {
  opportunityId: number;
  option: Omit<SelectedShippingOptionFactValue, "selectedAt">;
  /** ACS-R1-04-T07 style traceability - the tool execution that produced this write. */
  sourceToolExecutionId?: string | null;
};

export type SelectedShippingOptionDependencies = {
  /** Test-only injection point; production callers rely on the real crm_request_facts repository defaults. */
  getActiveFact?: typeof getActiveRequestFact;
  /** Test-only injection point; production callers rely on the real crm_request_facts repository defaults. */
  upsertFact?: typeof upsertRequestFact;
  now?: () => Date;
};

/**
 * Result of checking a durable selection against the opportunity's CURRENT
 * commercial_line_items/shipping_destination facts (task section 6/14) -
 * separate from SetSelectedShippingOptionResult because staleness is a
 * read-time/consume-time concern, never decided at selection time (the
 * selection was valid when made; it is the world around it that may have
 * moved since).
 */
export type ShippingSelectionFreshnessCheck =
  | { fresh: true }
  | { fresh: false; reason: "selection_changed" | "destination_changed" };

/**
 * SALES-AGENT-R1-T2.1.1. The minimal input checkShippingEvidenceFreshness
 * needs - just the two staleness anchors, never the rest of a persisted
 * SelectedShippingOption (which does not exist yet at select_shipping_option
 * time, before the write). A SelectedShippingOption satisfies this shape
 * structurally, so checkShippingSelectionFreshness (used post-write by
 * assembleQuoteInput/checkShippingSelectionReadiness) delegates to the same
 * definition - one freshness rule, never duplicated.
 */
export type ShippingFreshnessEvidence = {
  selectionFactId: string;
  destinationFactId: string;
};

/**
 * select_shipping_option's own errorCode when checkShippingEvidenceFreshness
 * reports stale BEFORE persisting - a single definition so
 * selectShippingOptionCapability.ts and buildToolObservation.ts can never
 * drift apart on this literal.
 */
export const SHIPPING_CALCULATION_STALE_ERROR_CODE = "shipping_calculation_stale" as const;
