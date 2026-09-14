import { createHash } from "node:crypto";
import { classifyQuoteServiceErrorCode, isRetryableQuoteServiceErrorClass } from "@/lib/domains/quote-service";
import type { QuoteServiceError, QuoteServiceQuote } from "@/lib/domains/quote-service";
import type { CapabilityEvidence, CapabilityExecutionOutcome } from "./types";

export const CAPABILITY_GATEWAY_VERSION = "capability-gateway.v1" as const;
export const QUOTE_SERVICE_ACTOR_ID = "native_agent_tool_loop" as const;

export type QuoteProjection = {
  quoteId: string;
  quoteNumber: string;
  status: string;
  currency: string;
  total: string;
  validUntil: string;
  issuedDocument: {
    available: boolean;
    pdf: { documentRef: string | null; sha256: string | null };
    html: { documentRef: string | null };
  };
};

export type IssuedQuoteProjection = Omit<QuoteProjection, "status"> & { quoteStatus: string };

export function buildQuoteActionIdempotencyKey(action: "issue" | "send-email", quoteId: string, recipient?: string): string {
  const suffix = recipient ? `:${recipient.trim().toLowerCase()}` : "";
  return createHash("sha256").update(`quote-action:${action}:${quoteId}${suffix}`).digest("hex").slice(0, 32);
}

export function quoteSource(correlationId: string) {
  return { system: "crm_customer_360" as const, correlationId };
}

export function quoteActor() {
  return { type: "sales_agent" as const, id: QUOTE_SERVICE_ACTOR_ID };
}

export function projectQuote(quote: QuoteServiceQuote): QuoteProjection {
  return {
    quoteId: quote.quoteId,
    quoteNumber: quote.quoteNumber,
    status: quote.status,
    currency: quote.currency,
    total: quote.pricing.total,
    validUntil: quote.validUntil,
    issuedDocument: {
      available: quote.issuedDocument.available,
      pdf: { documentRef: quote.issuedDocument.pdf.documentRef, sha256: quote.issuedDocument.pdf.sha256 },
      html: { documentRef: quote.issuedDocument.html.documentRef }
    }
  };
}

export function projectIssuedQuote(quote: QuoteServiceQuote): IssuedQuoteProjection {
  const projected = projectQuote(quote);
  const { status, ...withoutStatus } = projected;
  return { ...withoutStatus, quoteStatus: status };
}

export function quoteEvidence(source: string, summary: string): CapabilityEvidence {
  return { source, summary, capturedAt: new Date().toISOString() };
}

export function mapQuoteServiceErrorToOutcome(error: QuoteServiceError): CapabilityExecutionOutcome {
  const errorClass = classifyQuoteServiceErrorCode(error.code, error.httpStatus ?? 0);
  const retryable = isRetryableQuoteServiceErrorClass(errorClass);
  return { status: retryable ? "temporarily_blocked" : "failed", data: null, errorCode: error.code, retryable, evidence: [] };
}

export function noCreatedQuoteOutcome(): CapabilityExecutionOutcome {
  return { status: "missing_information", data: { status: "no_created_quote" }, errorCode: "created_quote_required", retryable: false, evidence: [] };
}

export function hasIssuedDocument(quote: QuoteServiceQuote): boolean {
  return quote.issuedDocument.available === true;
}
