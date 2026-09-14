import { createQuoteServicePort } from "@/lib/integrations/quote-service";
import type { QuoteServicePort } from "@/lib/domains/quote-service";
import { getActiveCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";
import type { CapabilityGatewayContext, CapabilityGatewayDefinition } from "./types";
import {
  CAPABILITY_GATEWAY_VERSION,
  buildQuoteActionIdempotencyKey,
  mapQuoteServiceErrorToOutcome,
  noCreatedQuoteOutcome,
  projectIssuedQuote,
  quoteActor,
  quoteEvidence,
  quoteSource,
  hasIssuedDocument
} from "./quoteLifecycleCapabilitySupport";

export const ISSUE_QUOTE_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false
} as const;

const POST_ISSUED_QUOTE_STATUSES = new Set(["issued", "accepted", "paid", "cancelled", "expired"]);

export function issueQuoteCapability(
  getQuoteServicePort: () => QuoteServicePort | null = createQuoteServicePort,
  getCreatedQuote = getActiveCreatedQuoteForOpportunity
): CapabilityGatewayDefinition<Record<string, never>, Record<string, unknown>> {
  return {
    capability: "issue_quote",
    version: CAPABILITY_GATEWAY_VERSION,
    description:
      "Issues the opportunity's existing draft quote through Quote Service, which durably generates and stores its PDF/HTML artifacts. Takes no arguments: the quote is resolved internally and the fresh Quote Service version is used. Repeated calls reuse an already issued/post-issued quote and never email or send WhatsApp documents.",
    governance: { sideEffect: "mutating", authority: "autonomous", riskClass: "medium" },
    maxRetries: 1,
    inputSchema: ISSUE_QUOTE_INPUT_SCHEMA,
    evidenceProduced: ["QUOTE_ISSUED", "QUOTE_DOCUMENT_AVAILABLE"],
    useWhen: "the existing quote is ready to become the durable issued commercial snapshot and its product selection is already confirmed",
    doNotUseWhen: "no created quote exists, the quote is still being assembled, or the customer only needs to inspect the current quote without issuing it",
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

      // This read is intentionally immediately before the issue command. The
      // durable locator's status/version is only a locator, never authority.
      const current = await port.getQuote(locator.quoteId);
      if (!current.ok) return mapQuoteServiceErrorToOutcome(current.error);
      const quote = current.value;

      if (quote.status !== "draft") {
        if (!POST_ISSUED_QUOTE_STATUSES.has(quote.status)) {
          return { status: "failed", data: null, errorCode: "quote_issuance_not_allowed", retryable: false, evidence: [] };
        }
        if (quote.status === "issued" && !hasIssuedDocument(quote)) {
          return { status: "failed", data: null, errorCode: "issued_document_unavailable", retryable: false, evidence: [] };
        }
        const evidence = [quoteEvidence("quote_service", `issue_quote reused post-issued quoteId=${quote.quoteId} status=${quote.status}.`)];
        if (hasIssuedDocument(quote)) evidence.push(quoteEvidence("quote_service", `quoteId=${quote.quoteId} has durable PDF/HTML issuance artifacts.`));
        return { status: "completed", data: projectIssuedQuote(quote), errorCode: null, retryable: false, evidence };
      }

      const issued = await port.issueQuote(
        { quoteId: quote.quoteId, expectedVersion: quote.version, actor: quoteActor(), source: quoteSource(context.correlationId) },
        { idempotencyKey: buildQuoteActionIdempotencyKey("issue", quote.quoteId) }
      );
      if (!issued.ok) return mapQuoteServiceErrorToOutcome(issued.error);

      const evidence = [quoteEvidence("quote_service", `issue_quote issued quoteId=${issued.value.quoteId} quoteNumber=${issued.value.quoteNumber}.`)];
      if (hasIssuedDocument(issued.value)) evidence.push(quoteEvidence("quote_service", `quoteId=${issued.value.quoteId} has durable PDF/HTML issuance artifacts.`));
      return { status: "completed", data: projectIssuedQuote(issued.value), errorCode: null, retryable: false, evidence };
    }
  };
}
