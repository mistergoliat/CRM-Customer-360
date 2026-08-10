import type { CommuneClarificationReason, CommuneCatalogFailureReason, CommuneResolutionMatchedVia, CommuneResolver } from "@/lib/domains/commune-resolution";
import type { getActiveRequestFact, upsertRequestFact } from "@/lib/brain/commercial/request-facts";

/**
 * Persisted verbatim as crm_request_facts.value_json. Deliberately does not
 * carry weightKg, carrier code/id, rate, full address, LLM reasoning or a
 * fuzzy score - T13D scope boundary (see task section 7/21/26). communeId is
 * the only identity T13E needs to combine with Catalog Service weights later.
 */
export type ShippingDestinationFactValue = {
  inputText: string;
  communeId: number;
  canonicalName: string;
  matchedVia: CommuneResolutionMatchedVia;
  source: "conversation";
};

/** Rehydrated, durable state - what CommercialContextSnapshot exposes. Always "confirmed": see setShippingDestinationForOpportunity for why an explicit, unambiguous resolution never needs a second confirmation. */
export type ShippingDestination = {
  communeId: number;
  canonicalName: string;
  matchedVia: CommuneResolutionMatchedVia;
  factId: string;
  updatedAt: string;
};

export type SetShippingDestinationResult =
  | { ok: true; status: "resolved"; destination: ShippingDestination; changed: boolean }
  | { ok: false; status: "needs_clarification"; input: string; reason: CommuneClarificationReason }
  | { ok: false; status: "not_found"; input: string }
  | { ok: false; status: "invalid_input"; input: string }
  | { ok: false; status: "resolver_error"; reason: CommuneCatalogFailureReason; detail: string }
  | { ok: false; status: "persistence_failed"; warning: string };

export type SetShippingDestinationInput = {
  opportunityId: number;
  inputText: string;
  /** ACS-R1-04-T07 style traceability - the tool execution that produced this write, never a raw message body. */
  sourceToolExecutionId?: string | null;
};

export type ShippingDestinationDependencies = {
  resolver: CommuneResolver;
  /** Test-only injection point; production callers rely on the real crm_request_facts repository defaults. */
  getActiveFact?: typeof getActiveRequestFact;
  /** Test-only injection point; production callers rely on the real crm_request_facts repository defaults. */
  upsertFact?: typeof upsertRequestFact;
};
