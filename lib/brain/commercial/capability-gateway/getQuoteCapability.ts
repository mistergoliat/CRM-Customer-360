import { createQuoteServicePort } from "@/lib/integrations/quote-service";
import type { QuoteServicePort } from "@/lib/domains/quote-service";
import { getActiveCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";
import type { CapabilityGatewayContext, CapabilityGatewayDefinition } from "./types";
import {
  CAPABILITY_GATEWAY_VERSION,
  mapQuoteServiceErrorToOutcome,
  noCreatedQuoteOutcome,
  projectQuote
} from "./quoteLifecycleCapabilitySupport";

export const GET_QUOTE_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false
} as const;

export function getQuoteCapability(
  getQuoteServicePort: () => QuoteServicePort | null = createQuoteServicePort,
  getCreatedQuote = getActiveCreatedQuoteForOpportunity
): CapabilityGatewayDefinition<Record<string, never>, Record<string, unknown>> {
  return {
    capability: "get_quote",
    version: CAPABILITY_GATEWAY_VERSION,
    description:
      "Reads the current truth for the opportunity's created quote from Quote Service, including status, amount, validity and issued document availability. Takes no arguments: the quote is resolved from the current opportunity; stale CRM quote metadata is never authoritative.",
    governance: { sideEffect: "read_only", authority: "autonomous", riskClass: "low" },
    maxRetries: 1,
    inputSchema: GET_QUOTE_INPUT_SCHEMA,
    useWhen: "the customer or agent needs the current status or document availability of the quote already created for this opportunity",
    doNotUseWhen: "no quote has been created for this opportunity, or the question is about creating, issuing, or delivering a quote",
    async checkAvailability() {
      return getQuoteServicePort() ? { status: "available", reason: null } : { status: "unavailable", reason: "quote_service_not_configured" };
    },
    async execute(_input, context: CapabilityGatewayContext) {
      const opportunityId = typeof context.opportunityId === "number" ? context.opportunityId : null;
      if (!opportunityId) return { status: "denied", data: null, errorCode: "no_active_opportunity", retryable: false, evidence: [] };
      const port = getQuoteServicePort();
      if (!port) return { status: "temporarily_blocked", data: null, errorCode: "quote_service_not_configured", retryable: true, evidence: [] };

      const locator = await getCreatedQuote(opportunityId);
      if (!locator) return noCreatedQuoteOutcome();

      const quote = await port.getQuote(locator.quoteId);
      if (!quote.ok) return mapQuoteServiceErrorToOutcome(quote.error);
      return { status: "completed", data: projectQuote(quote.value), errorCode: null, retryable: false, evidence: [] };
    }
  };
}
