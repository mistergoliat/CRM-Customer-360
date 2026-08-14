import type { CatalogPort } from "@/lib/catalog";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import type { ShippingDestination } from "@/lib/domains/shipping-destination";
import type { SelectedShippingOption } from "@/lib/domains/selected-shipping-option";
import type { MasterCustomerRow } from "@/lib/integrations/customer-master/types";
import type { QuoteServiceActorRef, QuoteServiceCreateQuoteInput, QuoteServiceSourceRef } from "@/lib/domains/quote-service";

/**
 * SALES-AGENT-R1-T2. Minimal, opportunity-scoped read of crm_opportunities -
 * only the fields quote assembly needs (customer identity anchor + the
 * WhatsApp-equivalent phone reference already used across this codebase as
 * the provisional identity phone, never a fabricated one). Deliberately not
 * the Hub's OpportunityDetailReadModel (lib/domains/opportunities/service.ts) -
 * that read model carries UI formatting/timeline/copilot baggage this
 * assembler has no use for.
 */
export type OpportunityCoreForQuoteAssembly = {
  id: number;
  customerMasterId: string | null;
  waId: string | null;
};

/**
 * SALES-AGENT-R1-T2 input. `actor`/`source` identify who is triggering
 * assembly (the same vocabulary Quote Service's own contract already uses,
 * see lib/domains/quote-service/types.ts) - never derived, always supplied
 * by the caller (a future capability/application layer, T3+).
 * `requireShipping` defaults to false because no durable selected-carrier
 * mechanism exists yet AND Quote Service's own line-item contract has no
 * shipping representation at all (QUOTE_LINE_TYPES = product|service only,
 * confirmed in the real service) - see "Shipping" in
 * docs/integrations/quote-input-assembly.md. Passing `true` always fails
 * closed with `shipping_selection_missing` today; this is a documented,
 * deliberate gap, not an oversight.
 */
export type AssembleQuoteInputInput = {
  opportunityId: number;
  conversationId?: string | null;
  correlationId: string;
  actor: QuoteServiceActorRef;
  source: QuoteServiceSourceRef;
  requireShipping?: boolean;
};

/** Test-only injection points; production callers rely on the real repository/adapter defaults - same pattern as ShippingDestinationDependencies/calculateShippingCapability's getCatalogPort. */
export type AssembleQuoteInputDependencies = {
  getCommercialLineItems?: (opportunityId: number) => Promise<CommercialLineItemSelection | null>;
  getShippingDestination?: (opportunityId: number) => Promise<ShippingDestination | null>;
  getSelectedShippingOption?: (opportunityId: number) => Promise<SelectedShippingOption | null>;
  getCatalogPort?: () => CatalogPort | null;
  getOpportunityCore?: (opportunityId: number) => Promise<OpportunityCoreForQuoteAssembly | null>;
  getMasterCustomer?: (customerMasterId: string) => Promise<MasterCustomerRow | null>;
  /** Injectable clock - never Date.now() inline (task section 24: determinism). Drives validUntil only. */
  now?: () => Date;
};

export type QuoteAssemblyEvidence = {
  opportunityId: number;
  correlationId: string;
  conversationId: string | null;
  customerId: string;
  selection: { factId: string; updatedAt: string; itemCount: number };
  catalog: { resolvedAt: string; currency: string };
  shipping: { requested: boolean; resolved: false; reason: string | null };
};

export type AssembleQuoteInputSuccess = {
  ok: true;
  request: QuoteServiceCreateQuoteInput;
  evidence: QuoteAssemblyEvidence;
};
