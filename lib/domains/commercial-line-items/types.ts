import type { getActiveRequestFact, upsertRequestFact } from "@/lib/brain/commercial/request-facts";

/**
 * Persisted verbatim as crm_request_facts.value_json. Deliberately does not
 * carry price, weightKg, subtotal, carrier or shipping rate (T13E.2 section
 * 5) - those are hydrated from Catalog Service / Carrier MS on demand, never
 * cached here, so they can never silently drift from the live source.
 */
export type CommercialLineItem = {
  productId: string;
  combinationId: string | null;
  quantity: number;
};

export type CommercialLineItemsFactValue = {
  items: CommercialLineItem[];
};

/** Rehydrated, durable state - what a capability reads back. */
export type CommercialLineItemSelection = {
  items: CommercialLineItem[];
  factId: string;
  updatedAt: string;
};

export type SetCommercialLineItemsInput = {
  opportunityId: number;
  items: CommercialLineItem[];
  /** ACS-R1-04-T07 style traceability - the tool execution that produced this write. */
  sourceToolExecutionId?: string | null;
};

export const SET_COMMERCIAL_LINE_ITEMS_INVALID_REASONS = ["items_required", "invalid_product_id", "invalid_quantity"] as const;
export type SetCommercialLineItemsInvalidReason = (typeof SET_COMMERCIAL_LINE_ITEMS_INVALID_REASONS)[number];

export type SetCommercialLineItemsResult =
  | { ok: true; status: "selected"; selection: CommercialLineItemSelection; changed: boolean }
  | { ok: false; status: "invalid_input"; reason: SetCommercialLineItemsInvalidReason }
  | { ok: false; status: "persistence_failed"; warning: string };

export type CommercialLineItemsDependencies = {
  /** Test-only injection point; production callers rely on the real crm_request_facts repository defaults. */
  getActiveFact?: typeof getActiveRequestFact;
  /** Test-only injection point; production callers rely on the real crm_request_facts repository defaults. */
  upsertFact?: typeof upsertRequestFact;
};
