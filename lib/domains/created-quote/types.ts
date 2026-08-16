import type { getActiveRequestFact, upsertRequestFact } from "@/lib/brain/commercial/request-facts";
import type { QuoteServiceCurrency, QuoteServiceStatus } from "@/lib/domains/quote-service";

/**
 * Persisted verbatim as crm_request_facts.value_json. `selectionFactId` is
 * the commercial_line_items.factId active when this quote was created - the
 * single reuse anchor (mirrors selectionFactId/destinationFactId in
 * selected-shipping-option): createQuoteCapability.ts treats an existing
 * created_quote as still current only while the opportunity's active
 * commercial_line_items.factId still equals this value. `idempotencyKey` is
 * the exact key sent to Quote Service for this creation, kept for
 * traceability - never regenerated on reuse.
 */
export type CreatedQuoteFactValue = {
  quoteId: string;
  quoteNumber: string;
  status: QuoteServiceStatus;
  currency: QuoteServiceCurrency;
  total: string;
  validUntil: string;
  selectionFactId: string;
  idempotencyKey: string;
  createdAt: string;
};

/** Rehydrated, durable state - what a caller (capability) consumes. */
export type CreatedQuote = CreatedQuoteFactValue & {
  factId: string;
  updatedAt: string;
};

export type SetCreatedQuoteInput = {
  opportunityId: number;
  quote: Omit<CreatedQuoteFactValue, "createdAt">;
  /** ACS-R1-04-T07 style traceability - the tool execution that produced this write. */
  sourceToolExecutionId?: string | null;
};

export type SetCreatedQuoteResult =
  | { ok: true; status: "created"; quote: CreatedQuote }
  | { ok: false; status: "persistence_failed"; warning: string };

export type CreatedQuoteDependencies = {
  /** Test-only injection point; production callers rely on the real crm_request_facts repository defaults. */
  getActiveFact?: typeof getActiveRequestFact;
  /** Test-only injection point; production callers rely on the real crm_request_facts repository defaults. */
  upsertFact?: typeof upsertRequestFact;
  now?: () => Date;
};
