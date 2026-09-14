import type { QuoteServiceResult } from "./errors";
import type {
  QuoteServiceCreateQuoteInput,
  QuoteServiceDelivery,
  QuoteServiceDeliveryList,
  QuoteServiceIssueQuoteInput,
  QuoteServiceListDeliveriesQuery,
  QuoteServiceMutationOptions,
  QuoteServiceQuote,
  QuoteServiceSendQuoteEmailInput,
  QuoteServiceUpdateDraftInput
} from "./types";

/**
 * Boundary the commercial domain will depend on (T2+) - the one real
 * implementation is lib/integrations/quote-service/httpQuoteServiceAdapter.ts.
 * Capabilities own the orchestration boundary while Quote Service remains
 * authoritative for quote state, documents and delivery. CRM assembly and
 * durable commercial facts stay outside this transport port.
 *
 * Deliberately minimal - matches exactly the operations T1 was scoped to
 * cover, plus getQuoteByNumber/listQuoteDeliveries (both real, already-stable
 * endpoints on the real service, explicitly allowed by the task). No
 * acceptQuote/markQuotePaid/cancelQuote/expireQuote/createRevision/listQuotes/
 * getQuoteDocuments/getQuoteAuditEvents - all real endpoints on the actual
 * service today, intentionally not wrapped here to keep this port's surface
 * matched to what T1 was asked to deliver (see report section U).
 */
export interface QuoteServicePort {
  createQuote(input: QuoteServiceCreateQuoteInput, options: QuoteServiceMutationOptions): Promise<QuoteServiceResult<QuoteServiceQuote>>;
  updateDraft(input: QuoteServiceUpdateDraftInput, options: QuoteServiceMutationOptions): Promise<QuoteServiceResult<QuoteServiceQuote>>;
  issueQuote(input: QuoteServiceIssueQuoteInput, options: QuoteServiceMutationOptions): Promise<QuoteServiceResult<QuoteServiceQuote>>;
  sendQuoteEmail(input: QuoteServiceSendQuoteEmailInput, options: QuoteServiceMutationOptions): Promise<QuoteServiceResult<QuoteServiceDelivery>>;
  getQuote(quoteId: string): Promise<QuoteServiceResult<QuoteServiceQuote>>;
  getQuoteByNumber(quoteNumber: string): Promise<QuoteServiceResult<QuoteServiceQuote>>;
  getQuoteDelivery(quoteId: string, deliveryId: string): Promise<QuoteServiceResult<QuoteServiceDelivery>>;
  listQuoteDeliveries(quoteId: string, query?: QuoteServiceListDeliveriesQuery): Promise<QuoteServiceResult<QuoteServiceDeliveryList>>;
}
