import { createHash } from "node:crypto";
import { createQuoteServicePort } from "@/lib/integrations/quote-service";
import type { QuoteServicePort } from "@/lib/domains/quote-service";
import { classifyQuoteServiceErrorCode, isRetryableQuoteServiceErrorClass } from "@/lib/domains/quote-service";
import type { QuoteServiceError } from "@/lib/domains/quote-service";
import { assembleQuoteInput } from "../quote-assembly";
import type { QuoteAssemblyError } from "../quote-assembly";
import { getActiveCreatedQuoteForOpportunity, setCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";
import type { CapabilityEvidence, CapabilityExecutionOutcome, CapabilityGatewayContext, CapabilityGatewayDefinition } from "./types";

const CAPABILITY_GATEWAY_VERSION = "capability-gateway.v1" as const;

/**
 * SALES-AGENT-R1-T3. The model decides only that a formal quote is needed -
 * every parameter (products, prices, customer identity) is backend state
 * assembled by assembleQuoteInput (T2). Takes no arguments, same pattern as
 * calculate_shipping. requireShipping is hardcoded false: a quote WITH
 * shipping cannot be assembled today for any opportunity (Carrier MS reports
 * no tax metadata per option, Quote Service has no shipping line-item type -
 * see docs/integrations/quote-input-assembly.md "Shipping tax gap") - this
 * is a pre-existing contract gap between two other services, out of scope
 * for T3 (docs/audits/SALES-AGENT-R1-T3-create-quote-wiring-audit.md).
 */
export const CREATE_QUOTE_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false
} as const;

const QUOTE_SERVICE_ACTOR_ID = "native_agent_tool_loop" as const;

function buildIdempotencyKey(opportunityId: number, selectionFactId: string): string {
  return createHash("sha256").update(`create-quote:${opportunityId}:${selectionFactId}`).digest("hex").slice(0, 32);
}

function completed(status: string, extra: Record<string, unknown> = {}, evidence: CapabilityEvidence[] = []): CapabilityExecutionOutcome {
  return { status: "completed", data: { status, ...extra }, errorCode: null, retryable: false, evidence };
}

function technicalFailure(errorCode: string, retryable: boolean): CapabilityExecutionOutcome {
  return { status: retryable ? "temporarily_blocked" : "failed", data: null, errorCode, retryable, evidence: [] };
}

/**
 * Assembly errors are backend-state gaps (missing selection, catalog data,
 * customer identity), never something the model can fix by retrying with
 * different arguments (this capability takes none) - each maps to an
 * informational `completed` outcome the model can relay, except the two
 * that indicate a real technical/data-integrity problem.
 */
function mapAssemblyErrorToOutcome(error: QuoteAssemblyError): CapabilityExecutionOutcome {
  switch (error.code) {
    case "catalog_unavailable":
      return technicalFailure("catalog_unavailable", true);
    case "missing_opportunity":
    case "invalid_quantity":
      return technicalFailure(error.code, false);
    default:
      return completed(error.code, error.details ?? {});
  }
}

function mapQuoteServiceErrorToOutcome(error: QuoteServiceError): CapabilityExecutionOutcome {
  const errorClass = classifyQuoteServiceErrorCode(error.code, error.httpStatus ?? 0);
  return technicalFailure(error.code, isRetryableQuoteServiceErrorClass(errorClass));
}

export function createQuoteCapability(
  getQuoteServicePort: () => QuoteServicePort | null = createQuoteServicePort
): CapabilityGatewayDefinition<Record<string, never>, Record<string, unknown>> {
  return {
    capability: "create_quote",
    version: CAPABILITY_GATEWAY_VERSION,
    description:
      "Creates a formal, real draft quote for the customer's confirmed product selection via the external Quote Service - the sole authority over quote numbering/validity/pricing snapshot. Takes no arguments: products/quantities come from select_products, pricing from Catalog Service. Never includes shipping (a real, pre-existing contract gap - shipping cost is communicated separately, never invented as a quote line). Repeated calls for the SAME unchanged selection reuse the existing quote, never create a duplicate.",
    governance: { sideEffect: "mutating", authority: "autonomous", riskClass: "medium" },
    maxRetries: 0,
    inputSchema: CREATE_QUOTE_INPUT_SCHEMA,
    async checkAvailability() {
      if (!getQuoteServicePort()) {
        return { status: "unavailable", reason: "quote_service_not_configured" };
      }
      return { status: "available", reason: null };
    },
    async execute(_input, context: CapabilityGatewayContext) {
      const opportunityId = typeof context.opportunityId === "number" ? context.opportunityId : null;
      if (!opportunityId) {
        return { status: "denied", data: null, errorCode: "no_active_opportunity", retryable: false, evidence: [] };
      }

      const port = getQuoteServicePort();
      if (!port) {
        return technicalFailure("quote_service_not_configured", true);
      }

      const assembled = await assembleQuoteInput({
        opportunityId,
        conversationId: context.conversationId != null ? String(context.conversationId) : null,
        correlationId: context.correlationId,
        actor: { type: "sales_agent", id: QUOTE_SERVICE_ACTOR_ID },
        source: { system: "crm_customer_360", correlationId: context.correlationId },
        requireShipping: false
      });
      if (!assembled.ok) {
        return mapAssemblyErrorToOutcome(assembled.error);
      }

      const selectionFactId = assembled.evidence.selection.factId;

      // Reuse: the same commercial selection this opportunity already has a
      // created quote for never gets a second Quote Service call - mirrors
      // the "changed:false" idempotency of setSelectedShippingOptionForOpportunity,
      // applied one layer up (before any external HTTP call is attempted).
      const existing = await getActiveCreatedQuoteForOpportunity(opportunityId);
      if (existing && existing.selectionFactId === selectionFactId) {
        return completed("reused", {
          quoteId: existing.quoteId,
          quoteNumber: existing.quoteNumber,
          quoteStatus: existing.status,
          currency: existing.currency,
          total: existing.total,
          validUntil: existing.validUntil
        });
      }

      const idempotencyKey = buildIdempotencyKey(opportunityId, selectionFactId);
      const created = await port.createQuote(assembled.request, { idempotencyKey });
      if (!created.ok) {
        return mapQuoteServiceErrorToOutcome(created.error);
      }

      const quote = created.value;
      const persisted = await setCreatedQuoteForOpportunity({
        opportunityId,
        quote: {
          quoteId: quote.quoteId,
          quoteNumber: quote.quoteNumber,
          status: quote.status,
          currency: quote.currency,
          total: quote.pricing.total,
          validUntil: quote.validUntil,
          selectionFactId,
          idempotencyKey
        },
        sourceToolExecutionId: context.correlationId
      });

      const evidence: CapabilityEvidence[] = [
        {
          source: "quote_service",
          summary: `create_quote created quoteId=${quote.quoteId} quoteNumber=${quote.quoteNumber} for opportunity=${opportunityId}.`,
          capturedAt: new Date().toISOString()
        }
      ];

      if (!persisted.ok) {
        // The quote WAS created upstream (idempotencyKey already bound to it) -
        // safely retryable: a retry resends the identical key+payload, which
        // Quote Service returns unchanged rather than duplicating.
        return { status: "temporarily_blocked", data: null, errorCode: "created_quote_persistence_failed", retryable: true, evidence };
      }

      return completed(
        "created",
        {
          quoteId: quote.quoteId,
          quoteNumber: quote.quoteNumber,
          quoteStatus: quote.status,
          currency: quote.currency,
          total: quote.pricing.total,
          validUntil: quote.validUntil
        },
        evidence
      );
    }
  };
}
