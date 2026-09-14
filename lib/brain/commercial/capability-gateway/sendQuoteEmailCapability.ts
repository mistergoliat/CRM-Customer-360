import { createQuoteServicePort } from "@/lib/integrations/quote-service";
import type { QuoteServicePort } from "@/lib/domains/quote-service";
import { getActiveCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";
import type { CapabilityGatewayContext, CapabilityGatewayDefinition } from "./types";
import {
  CAPABILITY_GATEWAY_VERSION,
  buildQuoteActionIdempotencyKey,
  mapQuoteServiceErrorToOutcome,
  noCreatedQuoteOutcome,
  quoteActor,
  quoteEvidence,
  quoteSource,
  hasIssuedDocument
} from "./quoteLifecycleCapabilitySupport";

export type SendQuoteEmailInput = { recipient?: string };

export const SEND_QUOTE_EMAIL_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { recipient: { type: "string" } }
} as const;

export function sendQuoteEmailCapability(
  getQuoteServicePort: () => QuoteServicePort | null = createQuoteServicePort,
  getCreatedQuote = getActiveCreatedQuoteForOpportunity
): CapabilityGatewayDefinition<SendQuoteEmailInput, Record<string, unknown>> {
  return {
    capability: "send_quote_email",
    version: CAPABILITY_GATEWAY_VERSION,
    description:
      "Requests durable email delivery of the opportunity's already issued quote through Quote Service. The quote is resolved internally; recipient is optional only when Quote Service has a customer snapshot email. HTTP 202 means delivery requested/pending, never that email was sent. Never sends WhatsApp or changes quote status.",
    governance: { sideEffect: "mutating", authority: "autonomous", riskClass: "medium" },
    maxRetries: 1,
    inputSchema: SEND_QUOTE_EMAIL_INPUT_SCHEMA,
    evidenceProduced: ["QUOTE_EMAIL_DELIVERY_REQUESTED"],
    useWhen: "the quote is already issued with durable document artifacts and the customer has asked for email delivery",
    doNotUseWhen: "the quote is a draft, has no durable issued document, has no usable recipient, or the customer has not asked for email delivery",
    async checkAvailability() {
      return getQuoteServicePort() ? { status: "available", reason: null } : { status: "unavailable", reason: "quote_service_not_configured" };
    },
    async execute(input, context: CapabilityGatewayContext) {
      const opportunityId = typeof context.opportunityId === "number" ? context.opportunityId : null;
      if (!opportunityId) return { status: "denied", data: null, errorCode: "no_active_opportunity", retryable: false, evidence: [] };
      const port = getQuoteServicePort();
      if (!port) return { status: "temporarily_blocked", data: null, errorCode: "quote_service_not_configured", retryable: true, evidence: [] };

      const locator = await getCreatedQuote(opportunityId);
      if (!locator) return noCreatedQuoteOutcome();
      const current = await port.getQuote(locator.quoteId);
      if (!current.ok) return mapQuoteServiceErrorToOutcome(current.error);
      const quote = current.value;

      // Quote Service currently accepts delivery only for issued/accepted
      // quotes. Keep that authority explicit: paid/cancelled/expired are
      // valid post-issued states for issuance, but not send-email states.
      if ((quote.status !== "issued" && quote.status !== "accepted") || !hasIssuedDocument(quote)) {
        return { status: "failed", data: null, errorCode: "quote_email_delivery_not_allowed", retryable: false, evidence: [] };
      }

      const requestedRecipient = typeof input.recipient === "string" && input.recipient.trim() ? input.recipient.trim() : null;
      const snapshotRecipient = typeof quote.customerSnapshot.email === "string" && quote.customerSnapshot.email.trim() ? quote.customerSnapshot.email.trim() : null;
      const recipient = requestedRecipient ?? snapshotRecipient;
      if (!recipient) return { status: "failed", data: null, errorCode: "quote_email_recipient_missing", retryable: false, evidence: [] };

      const delivery = await port.sendQuoteEmail(
        { quoteId: quote.quoteId, recipient, actor: quoteActor(), source: quoteSource(context.correlationId) },
        { idempotencyKey: buildQuoteActionIdempotencyKey("send-email", quote.quoteId, recipient) }
      );
      if (!delivery.ok) return mapQuoteServiceErrorToOutcome(delivery.error);

      return {
        status: "completed",
        data: { deliveryId: delivery.value.deliveryId, deliveryStatus: delivery.value.status, recipient: delivery.value.recipient },
        errorCode: null,
        retryable: false,
        evidence: [quoteEvidence("quote_service", `send_quote_email requested deliveryId=${delivery.value.deliveryId} for quoteId=${quote.quoteId}; provider delivery remains asynchronous.`)]
      };
    }
  };
}
