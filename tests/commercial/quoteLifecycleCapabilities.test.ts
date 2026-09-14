import assert from "node:assert/strict";
import test from "node:test";
import { getQuoteCapability } from "@/lib/brain/commercial/capability-gateway/getQuoteCapability";
import { issueQuoteCapability } from "@/lib/brain/commercial/capability-gateway/issueQuoteCapability";
import { sendQuoteEmailCapability } from "@/lib/brain/commercial/capability-gateway/sendQuoteEmailCapability";
import { buildCommercialActionRequestFromWorkStep } from "@/lib/brain/commercial/commercial-action-request/workAdapter";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway/types";
import type { CreatedQuote } from "@/lib/domains/created-quote";
import type { QuoteServicePort, QuoteServiceQuote } from "@/lib/domains/quote-service";
import type { CommercialWorkStep } from "@/lib/brain/commercial/work/types";

const context: CapabilityGatewayContext = { correlationId: "corr-quote-lifecycle", conversationId: 17, opportunityId: 42 };

function quote(overrides: Partial<QuoteServiceQuote> = {}): QuoteServiceQuote {
  return {
    quoteId: "quote-42",
    quoteNumber: "Q-0042",
    opportunityId: "42",
    customerId: "customer-42",
    conversationId: "17",
    actor: { type: "sales_agent", id: "native_agent_tool_loop" },
    source: { system: "crm_customer_360", correlationId: "corr-upstream" },
    status: "draft",
    currency: "CLP",
    customerSnapshot: { name: "Jane Doe", businessName: null, email: "jane@example.com", phone: null, address: null, district: null, region: null },
    items: [],
    pricing: { subtotal: "1000", taxAmount: "190", total: "1190" },
    validUntil: "2026-12-31T00:00:00.000Z",
    version: 1,
    revision: { rootId: "quote-42", previousRevisionId: null, supersedesQuoteId: null, supersededByQuoteId: null },
    issuedDocument: {
      available: false,
      contentHash: null,
      renderVersion: null,
      generatedAt: null,
      pdf: { documentRef: null, sha256: null },
      html: { documentRef: null, sha256: null }
    },
    timestamps: { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", issuedAt: null, acceptedAt: null, paidAt: null, cancelledAt: null, expiredAt: null },
    ...overrides
  };
}

function locator(overrides: Partial<CreatedQuote> = {}): CreatedQuote {
  return {
    quoteId: "quote-42",
    quoteNumber: "Q-0042",
    status: "draft",
    currency: "CLP",
    total: "1190",
    validUntil: "2026-12-31T00:00:00.000Z",
    selectionFactId: "selection-1",
    idempotencyKey: "old-locator-key",
    createdAt: "2026-09-01T00:00:00.000Z",
    factId: "fact-1",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

function fakePort(overrides: Partial<QuoteServicePort> = {}): QuoteServicePort {
  return {
    async createQuote() { throw new Error("not used"); },
    async updateDraft() { throw new Error("not used"); },
    async issueQuote() { throw new Error("not used"); },
    async sendQuoteEmail() { throw new Error("not used"); },
    async getQuote() { throw new Error("not used"); },
    async getQuoteByNumber() { throw new Error("not used"); },
    async getQuoteDelivery() { throw new Error("not used"); },
    async listQuoteDeliveries() { throw new Error("not used"); },
    ...overrides
  };
}

function issuedDocument() {
  return {
    available: true,
    contentHash: "content-hash",
    renderVersion: "quote-pdf-v1",
    generatedAt: "2026-09-02T00:00:00.000Z",
    pdf: { documentRef: "doc-pdf-42", sha256: "sha-pdf-42" },
    html: { documentRef: "doc-html-42", sha256: "sha-html-42" }
  };
}

test("get_quote reads fresh Quote Service truth and ignores stale locator status", async () => {
  let reads = 0;
  const result = await getQuoteCapability(
    () => fakePort({ async getQuote() { reads += 1; return { ok: true, value: quote({ status: "issued", version: 9, issuedDocument: issuedDocument() }) }; } }),
    async () => locator({ status: "draft" })
  ).execute({}, context);

  assert.equal(result.status, "completed");
  assert.equal(reads, 1);
  assert.deepEqual(result.data, {
    quoteId: "quote-42",
    quoteNumber: "Q-0042",
    status: "issued",
    currency: "CLP",
    total: "1190",
    validUntil: "2026-12-31T00:00:00.000Z",
    issuedDocument: { available: true, pdf: { documentRef: "doc-pdf-42", sha256: "sha-pdf-42" }, html: { documentRef: "doc-html-42" } }
  });
});

test("get_quote fails closed for no opportunity, no created quote, and unavailable Quote Service", async () => {
  const noOpportunity = await getQuoteCapability(() => fakePort(), async () => locator()).execute({}, { ...context, opportunityId: null });
  assert.equal(noOpportunity.status, "denied");
  assert.equal(noOpportunity.errorCode, "no_active_opportunity");

  const noQuote = await getQuoteCapability(() => fakePort(), async () => null).execute({}, context);
  assert.equal(noQuote.status, "missing_information");
  assert.equal(noQuote.errorCode, "created_quote_required");

  const unavailable = await getQuoteCapability(() => null, async () => locator()).execute({}, context);
  assert.equal(unavailable.status, "temporarily_blocked");
  assert.equal(unavailable.errorCode, "quote_service_not_configured");
});

test("issue_quote uses the fresh version and a stable idempotency key for a draft", async () => {
  const calls: Array<{ expectedVersion: number; idempotencyKey: string }> = [];
  const result = await issueQuoteCapability(
    () => fakePort({
      async getQuote() { return { ok: true, value: quote({ version: 8 }) }; },
      async issueQuote(input, options) {
        calls.push({ expectedVersion: input.expectedVersion, idempotencyKey: options.idempotencyKey });
        return { ok: true, value: quote({ status: "issued", version: 9, issuedDocument: issuedDocument() }) };
      }
    }),
    async () => locator({ status: "draft" })
  ).execute({}, context);

  assert.equal(result.status, "completed");
  assert.equal((result.data as Record<string, unknown>).quoteStatus, "issued");
  assert.deepEqual(Object.keys(result.data as Record<string, unknown>).sort(), ["currency", "issuedDocument", "quoteId", "quoteNumber", "quoteStatus", "total", "validUntil"]);
  assert.deepEqual(calls, [{ expectedVersion: 8, idempotencyKey: calls[0]?.idempotencyKey }]);
  assert.equal(calls[0]?.idempotencyKey.length, 32);
  assert.equal(result.evidence.length, 2, "issuance and durable document evidence are distinct");
});

test("issue_quote reuses an already-issued quote with documents and performs no mutation", async () => {
  let issueCalls = 0;
  const result = await issueQuoteCapability(
    () => fakePort({
      async getQuote() { return { ok: true, value: quote({ status: "accepted", issuedDocument: issuedDocument() }) }; },
      async issueQuote() { issueCalls += 1; return { ok: true, value: quote() }; }
    }),
    async () => locator({ status: "draft" })
  ).execute({}, context);

  assert.equal(result.status, "completed");
  assert.equal((result.data as Record<string, unknown>).quoteStatus, "accepted");
  assert.equal(issueCalls, 0);
  assert.equal(result.evidence.length, 2);
});

test("issue_quote maps transient/document failures without claiming issuance", async () => {
  const transient = await issueQuoteCapability(
    () => fakePort({
      async getQuote() { return { ok: true, value: quote() }; },
      async issueQuote() { return { ok: false, error: { class: "upstream_unavailable", code: "document_generation_failed", message: "temporary renderer failure", httpStatus: 503, retryable: true } }; }
    }),
    async () => locator()
  ).execute({}, context);
  assert.equal(transient.status, "temporarily_blocked");
  assert.equal(transient.errorCode, "document_generation_failed");
  assert.equal(transient.data, null);

  const missingDocument = await issueQuoteCapability(
    () => fakePort({
      async getQuote() { return { ok: true, value: quote({ status: "issued" }) }; }
    }),
    async () => locator()
  ).execute({}, context);
  assert.equal(missingDocument.status, "failed");
  assert.equal(missingDocument.errorCode, "issued_document_unavailable");
});

test("send_quote_email requests durable delivery, returns pending for HTTP 202, and never claims EMAIL_SENT", async () => {
  let sentInput: string | undefined;
  let sentKey: string | undefined;
  const result = await sendQuoteEmailCapability(
    () => fakePort({
      async getQuote() { return { ok: true, value: quote({ status: "issued", issuedDocument: issuedDocument() }) }; },
      async sendQuoteEmail(input, options) {
        sentInput = input.recipient;
        sentKey = options.idempotencyKey;
        return { ok: true, value: { deliveryId: "delivery-42", quoteId: "quote-42", channel: "email", recipient: input.recipient!, status: "pending", attemptCount: 0, providerMessageId: null, failureCode: null, failureMessage: null, actor: input.actor, source: { system: "crm_customer_360", correlationId: "corr-quote-lifecycle" }, timestamps: { createdAt: "2026-09-02T00:00:00.000Z", processingAt: null, sentAt: null, failedAt: null, nextAttemptAt: null } } };
      }
    }),
    async () => locator()
  ).execute({}, context);

  assert.equal(result.status, "completed");
  assert.deepEqual(result.data, { deliveryId: "delivery-42", deliveryStatus: "pending", recipient: "jane@example.com" });
  assert.equal(sentInput, "jane@example.com");
  assert.equal(sentKey?.length, 32);
  assert.equal(result.evidence.length, 1);
  assert.doesNotMatch(result.evidence[0].summary, /EMAIL_SENT|sent/i);
});

test("send_quote_email does not call Quote Service for a draft", async () => {
  let sendCalls = 0;
  const result = await sendQuoteEmailCapability(
    () => fakePort({
      async getQuote() { return { ok: true, value: quote({ status: "draft" }) }; },
      async sendQuoteEmail() { sendCalls += 1; throw new Error("must not be called"); }
    }),
    async () => locator()
  ).execute({}, context);

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "quote_email_delivery_not_allowed");
  assert.equal(sendCalls, 0);
});

test("send_quote_email keeps a deterministic request key across retries and does not mutate quote state on provider failure", async () => {
  const keys: string[] = [];
  let sendCalls = 0;
  const capability = sendQuoteEmailCapability(
    () => fakePort({
      async getQuote() { return { ok: true, value: quote({ status: "accepted", issuedDocument: issuedDocument() }) }; },
      async sendQuoteEmail(_input, options) {
        sendCalls += 1;
        keys.push(options.idempotencyKey);
        return { ok: false, error: { class: "upstream_unavailable", code: "email_delivery_unavailable", message: "provider unavailable", httpStatus: 503, retryable: true } };
      }
    }),
    async () => locator()
  );

  const first = await capability.execute({}, context);
  const second = await capability.execute({}, context);
  assert.equal(first.status, "temporarily_blocked");
  assert.equal(second.status, "temporarily_blocked");
  assert.equal(first.errorCode, "email_delivery_unavailable");
  assert.equal(sendCalls, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(first.data, null);
});

test("CommercialWork quote mutations use the same durable CommercialActionRequest boundary", () => {
  const step = {
    stepId: "work-42:step:issue-quote",
    capabilityName: "issue_quote",
    input: {},
    type: "ISSUE_QUOTE"
  } as CommercialWorkStep;
  const request = buildCommercialActionRequestFromWorkStep({
    step,
    context: { conversationId: 17, opportunityId: 42, correlationId: "corr-work-quote" },
    now: () => new Date("2026-09-02T00:00:00.000Z")
  });

  assert.equal(request?.actionType, "ISSUE_QUOTE");
  assert.equal(request?.source, "commercial_work");
  assert.equal(request?.causationId, step.stepId);
  assert.deepEqual(request?.input, {});
  assert.equal(request?.requestId, buildCommercialActionRequestFromWorkStep({
    step,
    context: { conversationId: 17, opportunityId: 42, correlationId: "different-correlation" },
    now: () => new Date("2030-01-01T00:00:00.000Z")
  })?.requestId);
});
