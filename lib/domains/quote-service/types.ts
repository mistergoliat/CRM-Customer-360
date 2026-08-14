/**
 * Transport DTOs for the external Quote Service (MS-pesaschile-quote-service).
 * Field shapes mirror that service's real Fastify routes/Zod schemas exactly
 * (src/http/routes/quote-route.ts, src/domain/*.ts) - never CRM's own
 * internal domain types (commercial_line_items, crm_opportunities, etc.).
 * SALES-AGENT-R1-T1: adapter boundary only, no mapping to/from CRM domain
 * types exists yet - that mapping is T2 (assembler).
 */

export const QUOTE_SERVICE_ACTOR_TYPES = ["sales_agent", "operator", "system", "service"] as const;
export type QuoteServiceActorType = (typeof QUOTE_SERVICE_ACTOR_TYPES)[number];

/** POST /:quoteId/expire restricts actor.type to this subset - enforced by the real service, not this adapter. */
export const QUOTE_SERVICE_EXPIRE_ACTOR_TYPES = ["system", "service"] as const;
export type QuoteServiceExpireActorType = (typeof QUOTE_SERVICE_EXPIRE_ACTOR_TYPES)[number];

export const QUOTE_SERVICE_SOURCE_SYSTEMS = ["crm_customer_360", "manual", "api", "scheduler"] as const;
export type QuoteServiceSourceSystem = (typeof QUOTE_SERVICE_SOURCE_SYSTEMS)[number];

export const QUOTE_SERVICE_LINE_TYPES = ["product", "service"] as const;
export type QuoteServiceLineType = (typeof QUOTE_SERVICE_LINE_TYPES)[number];

export const QUOTE_SERVICE_STATUSES = ["draft", "issued", "accepted", "paid", "cancelled", "expired"] as const;
export type QuoteServiceStatus = (typeof QUOTE_SERVICE_STATUSES)[number];

export const QUOTE_SERVICE_DELIVERY_CHANNELS = ["email"] as const;
export type QuoteServiceDeliveryChannel = (typeof QUOTE_SERVICE_DELIVERY_CHANNELS)[number];

export const QUOTE_SERVICE_DELIVERY_STATUSES = ["pending", "processing", "sent", "failed"] as const;
export type QuoteServiceDeliveryStatus = (typeof QUOTE_SERVICE_DELIVERY_STATUSES)[number];

/** Real contract v1 only supports CLP (domain/constants.ts SUPPORTED_CURRENCIES). */
export const QUOTE_SERVICE_SUPPORTED_CURRENCIES = ["CLP"] as const;
export type QuoteServiceCurrency = (typeof QUOTE_SERVICE_SUPPORTED_CURRENCIES)[number];

export type QuoteServiceActorRef = {
  readonly type: QuoteServiceActorType;
  readonly id: string;
};

export type QuoteServiceExpireActorRef = {
  readonly type: QuoteServiceExpireActorType;
  readonly id: string;
};

export type QuoteServiceSourceRef = {
  readonly system: QuoteServiceSourceSystem;
  readonly correlationId?: string | null;
};

/** Response shape - correlationId is always present (nullable), never omitted like the request form. */
export type QuoteServiceSourceRefState = {
  readonly system: QuoteServiceSourceSystem;
  readonly correlationId: string | null;
};

/** Request shape - all fields but name are optional/nullable, matching customerSnapshotSchema. */
export type QuoteServiceCustomerSnapshotInput = {
  readonly name: string;
  readonly businessName?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly address?: string | null;
  readonly district?: string | null;
  readonly region?: string | null;
};

/** Response shape - every optional key is always present, nullable (server-normalized). */
export type QuoteServiceCustomerSnapshot = {
  readonly name: string;
  readonly businessName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  readonly district: string | null;
  readonly region: string | null;
};

/**
 * Request line item. Money fields (quantity/unitPrice/taxRate) are decimal
 * strings matching the real service's pattern (/^-?(0|[1-9]\d*)(\.\d+)?$/) -
 * never numbers. This adapter never parses, rounds, or computes them.
 *
 * SALES-AGENT-R1-T1.1 closed the identity gap T1 documented: the Quote
 * Service now has explicit externalSource/externalVariantId fields
 * alongside externalItemId (migration 000004, additive, nullable - see
 * docs/integrations/quote-service-adapter.md). Semantics for PesasChile:
 * externalSource="catalog_service", externalItemId=productId,
 * externalVariantId=combinationId - the same identity commercial_line_items
 * already carries, transported verbatim, never concatenated ("545:31"),
 * never parsed heuristically. This adapter only transports the three
 * fields - mapping commercial_line_items -> these fields is still T2.
 * None of the three is required on every line (a type="service" or a
 * legacy/manual line may carry none of them, all null).
 */
export type QuoteServiceLineInput = {
  readonly type: QuoteServiceLineType;
  readonly externalSource?: string | null;
  readonly externalItemId?: string | null;
  readonly externalVariantId?: string | null;
  readonly sku?: string | null;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly taxIncluded: boolean;
  readonly taxRate: string;
};

/** Response line item - includes server-computed lineSubtotal/lineTax/lineTotal (decimal strings, never recomputed here). */
export type QuoteServiceLine = {
  readonly lineId: string;
  readonly type: QuoteServiceLineType;
  readonly externalSource: string | null;
  readonly externalItemId: string | null;
  readonly externalVariantId: string | null;
  readonly sku: string | null;
  readonly description: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly taxIncluded: boolean;
  readonly taxRate: string;
  readonly lineSubtotal: string;
  readonly lineTax: string;
  readonly lineTotal: string;
};

export type QuoteServicePricing = {
  readonly subtotal: string;
  readonly taxAmount: string;
  readonly total: string;
};

export type QuoteServiceRevisionRefs = {
  readonly rootId: string;
  readonly previousRevisionId: string | null;
  readonly supersedesQuoteId: string | null;
  readonly supersededByQuoteId: string | null;
};

export type QuoteServiceIssuedDocument = {
  readonly available: boolean;
  readonly contentHash: string | null;
  readonly renderVersion: string | null;
  readonly generatedAt: string | null;
  readonly pdf: {
    readonly documentRef: string | null;
    readonly sha256: string | null;
  };
  readonly html: {
    readonly documentRef: string | null;
    readonly sha256: string | null;
  };
};

export type QuoteServiceTimestamps = {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly issuedAt: string | null;
  readonly acceptedAt: string | null;
  readonly paidAt: string | null;
  readonly cancelledAt: string | null;
  readonly expiredAt: string | null;
};

/** Canonical quote response (mirrors PublicQuoteDto exactly - src/http/quote-presenter.ts). */
export type QuoteServiceQuote = {
  readonly quoteId: string;
  readonly quoteNumber: string;
  readonly opportunityId: string;
  readonly customerId: string | null;
  readonly conversationId: string | null;
  readonly actor: QuoteServiceActorRef;
  readonly source: QuoteServiceSourceRefState;
  readonly status: QuoteServiceStatus;
  readonly currency: QuoteServiceCurrency;
  readonly customerSnapshot: QuoteServiceCustomerSnapshot;
  readonly items: readonly QuoteServiceLine[];
  readonly pricing: QuoteServicePricing;
  readonly validUntil: string;
  readonly version: number;
  readonly revision: QuoteServiceRevisionRefs;
  readonly issuedDocument: QuoteServiceIssuedDocument;
  readonly timestamps: QuoteServiceTimestamps;
};

export type QuoteServiceDelivery = {
  readonly deliveryId: string;
  readonly quoteId: string;
  readonly channel: QuoteServiceDeliveryChannel;
  readonly recipient: string;
  readonly status: QuoteServiceDeliveryStatus;
  readonly attemptCount: number;
  readonly providerMessageId: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly actor: QuoteServiceActorRef;
  readonly source: QuoteServiceSourceRefState;
  readonly timestamps: {
    readonly createdAt: string;
    readonly processingAt: string | null;
    readonly sentAt: string | null;
    readonly failedAt: string | null;
    readonly nextAttemptAt: string | null;
  };
};

export type QuoteServicePagination = {
  readonly limit: number;
  readonly offset: number;
  readonly count: number;
};

export type QuoteServiceDeliveryList = {
  readonly items: readonly QuoteServiceDelivery[];
  readonly pagination: QuoteServicePagination;
};

/**
 * POST /v1/quotes body. Caller-controlled fields never include quoteId,
 * quoteNumber, lineId, pricing totals, timestamps, status or revision
 * metadata (server-owned - README "HTTP Contract").
 */
export type QuoteServiceCreateQuoteInput = {
  readonly opportunityId: string;
  readonly customerId?: string | null;
  readonly conversationId?: string | null;
  readonly actor: QuoteServiceActorRef;
  readonly source: QuoteServiceSourceRef;
  readonly currency: QuoteServiceCurrency;
  readonly customerSnapshot: QuoteServiceCustomerSnapshotInput;
  readonly items: readonly QuoteServiceLineInput[];
  /** ISO-8601 datetime with an explicit offset (real service requires z.string().datetime({offset:true})). */
  readonly validUntil: string;
};

/** PUT /v1/quotes/:quoteId/draft body. */
export type QuoteServiceUpdateDraftInput = {
  readonly quoteId: string;
  readonly expectedVersion: number;
  readonly actor: QuoteServiceActorRef;
  readonly source: QuoteServiceSourceRef;
  readonly customerSnapshot: QuoteServiceCustomerSnapshotInput;
  readonly items: readonly QuoteServiceLineInput[];
  readonly validUntil: string;
};

/** POST /v1/quotes/:quoteId/issue body. */
export type QuoteServiceIssueQuoteInput = {
  readonly quoteId: string;
  readonly expectedVersion: number;
  readonly actor: QuoteServiceActorRef;
  readonly source: QuoteServiceSourceRef;
};

/**
 * POST /v1/quotes/:quoteId/send-email body. `recipient` is transported only
 * when the caller supplies it - the real service falls back to
 * customerSnapshot.email on its own when absent (README "Send Email").
 * This adapter never resolves a recipient itself.
 */
export type QuoteServiceSendQuoteEmailInput = {
  readonly quoteId: string;
  readonly recipient?: string;
  readonly actor: QuoteServiceActorRef;
  readonly source: QuoteServiceSourceRef;
};

export type QuoteServiceListDeliveriesQuery = {
  readonly channel?: QuoteServiceDeliveryChannel;
  readonly limit?: number;
  readonly offset?: number;
};

/** Every mutating endpoint requires Idempotency-Key (README "Idempotency") - never generated by this adapter, always caller-supplied. */
export type QuoteServiceMutationOptions = {
  readonly idempotencyKey: string;
};
