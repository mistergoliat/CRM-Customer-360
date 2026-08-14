/**
 * HTTP adapter for the external Quote Service (MS-pesaschile-quote-service).
 * Endpoints, headers, request/response shapes and error codes below mirror
 * that service's real Fastify routes (src/http/routes/quote-route.ts) and
 * README ("HTTP Contract"/"Endpoints"/"Main Error Codes") exactly, ported
 * here (not imported as a dependency) - same convention already used for
 * MS-pesaschile-catalog-service (lib/catalog/httpCatalogAdapter.ts).
 *
 * SALES-AGENT-R1-T1 scope only: this file transports data, it never decides
 * what a quote should contain. No commercial_line_items/shipping_destination
 * read, no capability registration, no crm_quotes write.
 *
 * Exactly one physical HTTP call per invocation - no adapter-level retry
 * (task section 15 / same rule already applied to every other adapter in
 * this repo: retry ownership belongs to whatever governs the call, never the
 * transport boundary itself).
 */
import {
  classifyQuoteServiceErrorCode,
  isRetryableQuoteServiceErrorClass,
  QUOTE_SERVICE_ADAPTER_ERROR_CODES,
  type QuoteServiceError,
  type QuoteServiceErrorClass,
  type QuoteServiceResult
} from "@/lib/domains/quote-service/errors";
import {
  QUOTE_SERVICE_ACTOR_TYPES,
  QUOTE_SERVICE_DELIVERY_CHANNELS,
  QUOTE_SERVICE_DELIVERY_STATUSES,
  QUOTE_SERVICE_LINE_TYPES,
  QUOTE_SERVICE_SOURCE_SYSTEMS,
  QUOTE_SERVICE_STATUSES,
  QUOTE_SERVICE_SUPPORTED_CURRENCIES,
  type QuoteServiceActorRef,
  type QuoteServiceCreateQuoteInput,
  type QuoteServiceCustomerSnapshot,
  type QuoteServiceCustomerSnapshotInput,
  type QuoteServiceDelivery,
  type QuoteServiceDeliveryList,
  type QuoteServiceIssueQuoteInput,
  type QuoteServiceIssuedDocument,
  type QuoteServiceLine,
  type QuoteServiceLineInput,
  type QuoteServiceListDeliveriesQuery,
  type QuoteServiceMutationOptions,
  type QuoteServicePricing,
  type QuoteServiceQuote,
  type QuoteServiceRevisionRefs,
  type QuoteServiceSendQuoteEmailInput,
  type QuoteServiceSourceRef,
  type QuoteServiceSourceRefState,
  type QuoteServiceTimestamps,
  type QuoteServiceUpdateDraftInput
} from "@/lib/domains/quote-service/types";
import type { QuoteServicePort } from "@/lib/domains/quote-service/ports";
import type { QuoteServiceConfig } from "./config";

// ---- generic parse helpers (same primitives as every other adapter in this repo) ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return asString(value) ?? undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isEnumValue<T extends readonly string[]>(allowed: T, value: unknown): value is T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** Defence in depth: the token is never interpolated into a returned error, but strip anything header-shaped in case the upstream ever echoes request context back in a message body. */
function sanitizeMessage(message: string): string {
  return message.replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [redacted]").replace(/Authorization['":\s]*[^\s,;"']+/gi, "Authorization=[redacted]");
}

// ---- response parsing (fails closed - a shape mismatch is malformed_response, never a partial/best-effort object) ----

function parseActorRef(value: unknown): QuoteServiceActorRef | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  const id = asNonEmptyString(value.id);
  if (!isEnumValue(QUOTE_SERVICE_ACTOR_TYPES, type) || !id) return null;
  return { type, id };
}

function parseSourceRefState(value: unknown): QuoteServiceSourceRefState | null {
  if (!isRecord(value)) return null;
  const system = value.system;
  if (!isEnumValue(QUOTE_SERVICE_SOURCE_SYSTEMS, system)) return null;
  const correlationId = asNullableString(value.correlationId);
  if (correlationId === undefined) return null;
  return { system, correlationId };
}

function parseCustomerSnapshot(value: unknown): QuoteServiceCustomerSnapshot | null {
  if (!isRecord(value)) return null;
  const name = asNonEmptyString(value.name);
  if (!name) return null;
  const businessName = asNullableString(value.businessName);
  const email = asNullableString(value.email);
  const phone = asNullableString(value.phone);
  const address = asNullableString(value.address);
  const district = asNullableString(value.district);
  const region = asNullableString(value.region);
  if (businessName === undefined || email === undefined || phone === undefined || address === undefined || district === undefined || region === undefined) {
    return null;
  }
  return { name, businessName, email, phone, address, district, region };
}

function parseLine(value: unknown): QuoteServiceLine | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  const lineId = asNonEmptyString(value.lineId);
  const description = asNonEmptyString(value.description);
  const quantity = asNonEmptyString(value.quantity);
  const unitPrice = asNonEmptyString(value.unitPrice);
  const taxIncluded = asBoolean(value.taxIncluded);
  const taxRate = asNonEmptyString(value.taxRate);
  const lineSubtotal = asNonEmptyString(value.lineSubtotal);
  const lineTax = asNonEmptyString(value.lineTax);
  const lineTotal = asNonEmptyString(value.lineTotal);
  if (
    !isEnumValue(QUOTE_SERVICE_LINE_TYPES, type) ||
    !lineId ||
    !description ||
    !quantity ||
    !unitPrice ||
    taxIncluded === null ||
    !taxRate ||
    !lineSubtotal ||
    !lineTax ||
    !lineTotal
  ) {
    return null;
  }
  const externalSource = asNullableString(value.externalSource);
  const externalItemId = asNullableString(value.externalItemId);
  const externalVariantId = asNullableString(value.externalVariantId);
  const sku = asNullableString(value.sku);
  if (externalSource === undefined || externalItemId === undefined || externalVariantId === undefined || sku === undefined) return null;
  return {
    lineId,
    type,
    externalSource,
    externalItemId,
    externalVariantId,
    sku,
    description,
    quantity,
    unitPrice,
    taxIncluded,
    taxRate,
    lineSubtotal,
    lineTax,
    lineTotal
  };
}

function parseLines(value: unknown): readonly QuoteServiceLine[] | null {
  if (!Array.isArray(value)) return null;
  const items: QuoteServiceLine[] = [];
  for (const entry of value) {
    const line = parseLine(entry);
    if (!line) return null;
    items.push(line);
  }
  return items;
}

function parsePricing(value: unknown): QuoteServicePricing | null {
  if (!isRecord(value)) return null;
  const subtotal = asNonEmptyString(value.subtotal);
  const taxAmount = asNonEmptyString(value.taxAmount);
  const total = asNonEmptyString(value.total);
  if (!subtotal || !taxAmount || !total) return null;
  return { subtotal, taxAmount, total };
}

function parseRevision(value: unknown): QuoteServiceRevisionRefs | null {
  if (!isRecord(value)) return null;
  const rootId = asNonEmptyString(value.rootId);
  if (!rootId) return null;
  const previousRevisionId = asNullableString(value.previousRevisionId);
  const supersedesQuoteId = asNullableString(value.supersedesQuoteId);
  const supersededByQuoteId = asNullableString(value.supersededByQuoteId);
  if (previousRevisionId === undefined || supersedesQuoteId === undefined || supersededByQuoteId === undefined) return null;
  return { rootId, previousRevisionId, supersedesQuoteId, supersededByQuoteId };
}

function parseIssuedDocument(value: unknown): QuoteServiceIssuedDocument | null {
  if (!isRecord(value)) return null;
  const available = asBoolean(value.available);
  if (available === null) return null;
  const contentHash = asNullableString(value.contentHash);
  const renderVersion = asNullableString(value.renderVersion);
  const generatedAt = asNullableString(value.generatedAt);
  if (contentHash === undefined || renderVersion === undefined || generatedAt === undefined) return null;
  if (!isRecord(value.pdf) || !isRecord(value.html)) return null;
  const pdfDocumentRef = asNullableString(value.pdf.documentRef);
  const pdfSha256 = asNullableString(value.pdf.sha256);
  const htmlDocumentRef = asNullableString(value.html.documentRef);
  const htmlSha256 = asNullableString(value.html.sha256);
  if (pdfDocumentRef === undefined || pdfSha256 === undefined || htmlDocumentRef === undefined || htmlSha256 === undefined) return null;
  return {
    available,
    contentHash,
    renderVersion,
    generatedAt,
    pdf: { documentRef: pdfDocumentRef, sha256: pdfSha256 },
    html: { documentRef: htmlDocumentRef, sha256: htmlSha256 }
  };
}

function parseTimestamps(value: unknown): QuoteServiceTimestamps | null {
  if (!isRecord(value)) return null;
  const createdAt = asNonEmptyString(value.createdAt);
  const updatedAt = asNonEmptyString(value.updatedAt);
  if (!createdAt || !updatedAt) return null;
  const issuedAt = asNullableString(value.issuedAt);
  const acceptedAt = asNullableString(value.acceptedAt);
  const paidAt = asNullableString(value.paidAt);
  const cancelledAt = asNullableString(value.cancelledAt);
  const expiredAt = asNullableString(value.expiredAt);
  if (issuedAt === undefined || acceptedAt === undefined || paidAt === undefined || cancelledAt === undefined || expiredAt === undefined) return null;
  return { createdAt, updatedAt, issuedAt, acceptedAt, paidAt, cancelledAt, expiredAt };
}

function parseQuote(value: unknown): QuoteServiceQuote | null {
  if (!isRecord(value)) return null;
  const quoteId = asNonEmptyString(value.quoteId);
  const quoteNumber = asNonEmptyString(value.quoteNumber);
  const opportunityId = asNonEmptyString(value.opportunityId);
  const status = value.status;
  const currency = value.currency;
  const validUntil = asNonEmptyString(value.validUntil);
  const version = asNumber(value.version);
  if (
    !quoteId ||
    !quoteNumber ||
    !opportunityId ||
    !isEnumValue(QUOTE_SERVICE_STATUSES, status) ||
    !isEnumValue(QUOTE_SERVICE_SUPPORTED_CURRENCIES, currency) ||
    !validUntil ||
    version === null
  ) {
    return null;
  }
  const customerId = asNullableString(value.customerId);
  const conversationId = asNullableString(value.conversationId);
  if (customerId === undefined || conversationId === undefined) return null;

  const actor = parseActorRef(value.actor);
  const source = parseSourceRefState(value.source);
  const customerSnapshot = parseCustomerSnapshot(value.customerSnapshot);
  const items = parseLines(value.items);
  const pricing = parsePricing(value.pricing);
  const revision = parseRevision(value.revision);
  const issuedDocument = parseIssuedDocument(value.issuedDocument);
  const timestamps = parseTimestamps(value.timestamps);
  if (!actor || !source || !customerSnapshot || !items || !pricing || !revision || !issuedDocument || !timestamps) return null;

  return {
    quoteId,
    quoteNumber,
    opportunityId,
    customerId,
    conversationId,
    actor,
    source,
    status,
    currency,
    customerSnapshot,
    items,
    pricing,
    validUntil,
    version,
    revision,
    issuedDocument,
    timestamps
  };
}

function parseDelivery(value: unknown): QuoteServiceDelivery | null {
  if (!isRecord(value)) return null;
  const deliveryId = asNonEmptyString(value.deliveryId);
  const quoteId = asNonEmptyString(value.quoteId);
  const channel = value.channel;
  const recipient = asNonEmptyString(value.recipient);
  const status = value.status;
  const attemptCount = asNumber(value.attemptCount);
  if (
    !deliveryId ||
    !quoteId ||
    !isEnumValue(QUOTE_SERVICE_DELIVERY_CHANNELS, channel) ||
    !recipient ||
    !isEnumValue(QUOTE_SERVICE_DELIVERY_STATUSES, status) ||
    attemptCount === null
  ) {
    return null;
  }
  const providerMessageId = asNullableString(value.providerMessageId);
  const failureCode = asNullableString(value.failureCode);
  const failureMessage = asNullableString(value.failureMessage);
  if (providerMessageId === undefined || failureCode === undefined || failureMessage === undefined) return null;

  const actor = parseActorRef(value.actor);
  const source = parseSourceRefState(value.source);
  if (!actor || !source) return null;

  if (!isRecord(value.timestamps)) return null;
  const createdAt = asNonEmptyString(value.timestamps.createdAt);
  if (!createdAt) return null;
  const processingAt = asNullableString(value.timestamps.processingAt);
  const sentAt = asNullableString(value.timestamps.sentAt);
  const failedAt = asNullableString(value.timestamps.failedAt);
  const nextAttemptAt = asNullableString(value.timestamps.nextAttemptAt);
  if (processingAt === undefined || sentAt === undefined || failedAt === undefined || nextAttemptAt === undefined) return null;

  return {
    deliveryId,
    quoteId,
    channel,
    recipient,
    status,
    attemptCount,
    providerMessageId,
    failureCode,
    failureMessage,
    actor,
    source,
    timestamps: { createdAt, processingAt, sentAt, failedAt, nextAttemptAt }
  };
}

function parseDeliveryList(value: unknown): QuoteServiceDeliveryList | null {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.pagination)) return null;
  const items: QuoteServiceDelivery[] = [];
  for (const entry of value.items) {
    const delivery = parseDelivery(entry);
    if (!delivery) return null;
    items.push(delivery);
  }
  const limit = asNumber(value.pagination.limit);
  const offset = asNumber(value.pagination.offset);
  const count = asNumber(value.pagination.count);
  if (limit === null || offset === null || count === null) return null;
  return { items, pagination: { limit, offset, count } };
}

// ---- request body builders (explicit key-by-key allowlist, never spread the caller's input) ----

function buildActorBody(actor: QuoteServiceActorRef) {
  return { type: actor.type, id: actor.id };
}

function buildSourceBody(source: QuoteServiceSourceRef) {
  const body: Record<string, unknown> = { system: source.system };
  if (source.correlationId !== undefined) body.correlationId = source.correlationId;
  return body;
}

function buildCustomerSnapshotBody(snapshot: QuoteServiceCustomerSnapshotInput) {
  const body: Record<string, unknown> = { name: snapshot.name };
  if (snapshot.businessName !== undefined) body.businessName = snapshot.businessName;
  if (snapshot.email !== undefined) body.email = snapshot.email;
  if (snapshot.phone !== undefined) body.phone = snapshot.phone;
  if (snapshot.address !== undefined) body.address = snapshot.address;
  if (snapshot.district !== undefined) body.district = snapshot.district;
  if (snapshot.region !== undefined) body.region = snapshot.region;
  return body;
}

function buildLineBody(line: QuoteServiceLineInput) {
  const body: Record<string, unknown> = {
    type: line.type,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxIncluded: line.taxIncluded,
    taxRate: line.taxRate
  };
  if (line.externalSource !== undefined) body.externalSource = line.externalSource;
  if (line.externalItemId !== undefined) body.externalItemId = line.externalItemId;
  if (line.externalVariantId !== undefined) body.externalVariantId = line.externalVariantId;
  if (line.sku !== undefined) body.sku = line.sku;
  return body;
}

function buildLinesBody(items: readonly QuoteServiceLineInput[]) {
  return items.map(buildLineBody);
}

// ---- transport ----

type FetchOutcome = { status: number; body: unknown } | { networkError: true } | { timeoutError: true };

async function fetchJson(
  config: QuoteServiceConfig,
  path: string,
  init: { method: "GET" | "POST" | "PUT"; body?: unknown; idempotencyKey?: string }
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = { authorization: `Bearer ${config.authToken}` };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.idempotencyKey !== undefined) headers["Idempotency-Key"] = init.idempotencyKey;

    const response = await fetch(`${config.baseUrl}${path}`, {
      method: init.method,
      signal: controller.signal,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
    });

    const text = await response.text();
    if (!text) return { status: response.status, body: null };
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      return { status: response.status, body: undefined };
    }
  } catch {
    if (controller.signal.aborted) return { timeoutError: true };
    return { networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

function errorEnvelope(body: unknown): { code: string; message: string; details?: Record<string, unknown> } | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const code = asNonEmptyString(body.error.code);
  const message = asString(body.error.message);
  if (!code || message === null) return null;
  const details = isRecord(body.error.details) ? body.error.details : undefined;
  return { code, message, ...(details ? { details } : {}) };
}

function buildError(errorClass: QuoteServiceErrorClass, code: string, message: string, httpStatus: number | null, details?: Record<string, unknown>): QuoteServiceError {
  return {
    class: errorClass,
    code,
    message: sanitizeMessage(message),
    httpStatus,
    ...(details ? { details } : {}),
    retryable: isRetryableQuoteServiceErrorClass(errorClass)
  };
}

function mapFailureOutcome(outcome: Exclude<FetchOutcome, { status: number; body: unknown }>): QuoteServiceError {
  if ("timeoutError" in outcome) {
    return buildError("timeout", QUOTE_SERVICE_ADAPTER_ERROR_CODES.timeout, "Quote Service request timed out.", null);
  }
  return buildError("upstream_unavailable", QUOTE_SERVICE_ADAPTER_ERROR_CODES.networkUnavailable, "Quote Service request failed at the network level.", null);
}

function mapHttpFailure(status: number, body: unknown): QuoteServiceError {
  if (body === undefined) {
    return buildError("malformed_response", QUOTE_SERVICE_ADAPTER_ERROR_CODES.malformedResponse, "Quote Service returned a non-JSON body.", status);
  }
  const envelope = errorEnvelope(body);
  if (!envelope) {
    return buildError("malformed_response", QUOTE_SERVICE_ADAPTER_ERROR_CODES.malformedResponse, `Quote Service returned an unexpected error shape (HTTP ${status}).`, status);
  }
  const errorClass = classifyQuoteServiceErrorCode(envelope.code, status);
  return buildError(errorClass, envelope.code, envelope.message, status, envelope.details);
}

/**
 * Single request/parse/error-map pipeline every operation below reuses.
 * `parse` runs only on a genuine 2xx - a shape mismatch there always maps to
 * malformed_response, never a best-effort partial value.
 */
async function requestQuoteService<T>(
  config: QuoteServiceConfig,
  path: string,
  init: { method: "GET" | "POST" | "PUT"; body?: unknown; idempotencyKey?: string },
  parse: (payload: unknown) => T | null
): Promise<QuoteServiceResult<T>> {
  const outcome = await fetchJson(config, path, init);

  if ("status" in outcome) {
    if (outcome.status >= 200 && outcome.status < 300) {
      const parsed = parse(outcome.body);
      if (parsed === null) {
        return { ok: false, error: buildError("malformed_response", QUOTE_SERVICE_ADAPTER_ERROR_CODES.malformedResponse, "Quote Service returned an unexpected payload shape.", outcome.status) };
      }
      return { ok: true, value: parsed };
    }
    return { ok: false, error: mapHttpFailure(outcome.status, outcome.body) };
  }

  return { ok: false, error: mapFailureOutcome(outcome) };
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function buildDeliveryListQuery(query?: QuoteServiceListDeliveriesQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  if (query.channel !== undefined) params.set("channel", query.channel);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Real HTTP adapter. `config` is read once by the caller (createQuoteServicePort)
 * so tests can point it at a local mock server per-test - same pattern as
 * createHttpCatalogAdapter/createHttpCarrierServiceAdapter.
 */
export function createHttpQuoteServiceAdapter(config: QuoteServiceConfig): QuoteServicePort {
  return {
    async createQuote(input: QuoteServiceCreateQuoteInput, options: QuoteServiceMutationOptions) {
      const body: Record<string, unknown> = {
        opportunityId: input.opportunityId,
        actor: buildActorBody(input.actor),
        source: buildSourceBody(input.source),
        currency: input.currency,
        customerSnapshot: buildCustomerSnapshotBody(input.customerSnapshot),
        items: buildLinesBody(input.items),
        validUntil: input.validUntil
      };
      if (input.customerId !== undefined) body.customerId = input.customerId;
      if (input.conversationId !== undefined) body.conversationId = input.conversationId;

      return requestQuoteService(config, "/v1/quotes", { method: "POST", body, idempotencyKey: options.idempotencyKey }, parseQuote);
    },

    async updateDraft(input: QuoteServiceUpdateDraftInput, options: QuoteServiceMutationOptions) {
      const body = {
        expectedVersion: input.expectedVersion,
        actor: buildActorBody(input.actor),
        source: buildSourceBody(input.source),
        customerSnapshot: buildCustomerSnapshotBody(input.customerSnapshot),
        items: buildLinesBody(input.items),
        validUntil: input.validUntil
      };
      return requestQuoteService(
        config,
        `/v1/quotes/${encodePathSegment(input.quoteId)}/draft`,
        { method: "PUT", body, idempotencyKey: options.idempotencyKey },
        parseQuote
      );
    },

    async issueQuote(input: QuoteServiceIssueQuoteInput, options: QuoteServiceMutationOptions) {
      const body = {
        expectedVersion: input.expectedVersion,
        actor: buildActorBody(input.actor),
        source: buildSourceBody(input.source)
      };
      return requestQuoteService(
        config,
        `/v1/quotes/${encodePathSegment(input.quoteId)}/issue`,
        { method: "POST", body, idempotencyKey: options.idempotencyKey },
        parseQuote
      );
    },

    async sendQuoteEmail(input: QuoteServiceSendQuoteEmailInput, options: QuoteServiceMutationOptions) {
      const body: Record<string, unknown> = {
        actor: buildActorBody(input.actor),
        source: buildSourceBody(input.source)
      };
      // Never resolved here: transported only when the caller supplies it -
      // the real service falls back to customerSnapshot.email on its own.
      if (input.recipient !== undefined) body.recipient = input.recipient;

      return requestQuoteService(
        config,
        `/v1/quotes/${encodePathSegment(input.quoteId)}/send-email`,
        { method: "POST", body, idempotencyKey: options.idempotencyKey },
        parseDelivery
      );
    },

    async getQuote(quoteId: string) {
      return requestQuoteService(config, `/v1/quotes/${encodePathSegment(quoteId)}`, { method: "GET" }, parseQuote);
    },

    async getQuoteByNumber(quoteNumber: string) {
      return requestQuoteService(config, `/v1/quotes/by-number/${encodePathSegment(quoteNumber)}`, { method: "GET" }, parseQuote);
    },

    async getQuoteDelivery(quoteId: string, deliveryId: string) {
      return requestQuoteService(
        config,
        `/v1/quotes/${encodePathSegment(quoteId)}/deliveries/${encodePathSegment(deliveryId)}`,
        { method: "GET" },
        parseDelivery
      );
    },

    async listQuoteDeliveries(quoteId: string, query?: QuoteServiceListDeliveriesQuery) {
      return requestQuoteService(
        config,
        `/v1/quotes/${encodePathSegment(quoteId)}/deliveries${buildDeliveryListQuery(query)}`,
        { method: "GET" },
        parseDeliveryList
      );
    }
  };
}
