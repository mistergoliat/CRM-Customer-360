import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { createHttpQuoteServiceAdapter } from "@/lib/integrations/quote-service/httpQuoteServiceAdapter";
import { readQuoteServiceConfig } from "@/lib/integrations/quote-service/config";
import type { QuoteServicePort } from "@/lib/domains/quote-service/ports";
import type { QuoteServiceCreateQuoteInput } from "@/lib/domains/quote-service/types";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let lastRequest: { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string } | null = null;

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      lastRequest = { method: req.method, url: req.url, headers: req.headers, body };
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeAdapter(timeoutMs = 500, authToken = "test-token-123"): QuoteServicePort {
  return createHttpQuoteServiceAdapter({ baseUrl, authToken, timeoutMs });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

test.beforeEach(() => {
  lastRequest = null;
  handler = (_req, res) => res.writeHead(500).end();
});

// ---- fixtures mirroring the real service's PublicQuoteDto/PublicQuoteDeliveryDto exactly ----

function quoteFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    quoteId: "8400c470-0000-4000-8000-000000000001",
    quoteNumber: "Q-2026-0001",
    opportunityId: "opp-123",
    customerId: "customer-123",
    conversationId: "conversation-123",
    actor: { type: "sales_agent", id: "agent-1" },
    source: { system: "crm_customer_360", correlationId: "corr-1" },
    status: "draft",
    currency: "CLP",
    customerSnapshot: { name: "Jane Doe", businessName: null, email: "jane@example.com", phone: null, address: null, district: null, region: null },
    items: [
      {
        lineId: "line-1",
        type: "product",
        externalSource: "catalog_service",
        externalItemId: "sku-1",
        externalVariantId: null,
        sku: "SKU-1",
        description: "Line 1",
        quantity: "2",
        unitPrice: "4990",
        taxIncluded: true,
        taxRate: "0.19",
        lineSubtotal: "8387",
        lineTax: "1593",
        lineTotal: "9980"
      }
    ],
    pricing: { subtotal: "8387", taxAmount: "1593", total: "9980" },
    validUntil: "2026-08-20T00:00:00.000Z",
    version: 1,
    revision: { rootId: "8400c470-0000-4000-8000-000000000001", previousRevisionId: null, supersedesQuoteId: null, supersededByQuoteId: null },
    issuedDocument: { available: false, contentHash: null, renderVersion: null, generatedAt: null, pdf: { documentRef: null, sha256: null }, html: { documentRef: null, sha256: null } },
    timestamps: { createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z", issuedAt: null, acceptedAt: null, paidAt: null, cancelledAt: null, expiredAt: null },
    ...overrides
  };
}

function deliveryFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deliveryId: "delivery-1",
    quoteId: "8400c470-0000-4000-8000-000000000001",
    channel: "email",
    recipient: "jane@example.com",
    status: "pending",
    attemptCount: 0,
    providerMessageId: null,
    failureCode: null,
    failureMessage: null,
    actor: { type: "sales_agent", id: "agent-1" },
    source: { system: "crm_customer_360", correlationId: "corr-2" },
    timestamps: { createdAt: "2026-08-13T00:00:00.000Z", processingAt: null, sentAt: null, failedAt: null, nextAttemptAt: null },
    ...overrides
  };
}

const createInput: QuoteServiceCreateQuoteInput = {
  opportunityId: "opp-123",
  customerId: "customer-123",
  conversationId: "conversation-123",
  actor: { type: "sales_agent", id: "agent-1" },
  source: { system: "crm_customer_360", correlationId: "corr-1" },
  currency: "CLP",
  customerSnapshot: { name: "Jane Doe", email: "jane@example.com" },
  items: [{ type: "product", externalItemId: "sku-1", sku: "SKU-1", description: "Line 1", quantity: "2", unitPrice: "4990", taxIncluded: true, taxRate: "0.19" }],
  validUntil: "2026-08-20T00:00:00.000Z"
};

// ---- anti-double-tax regression (SALES-AGENT-R1-T1.1, task section 14) ----
// A Catalog-authorized, tax-included unitPrice must reach Quote Service
// unchanged - never multiplied by (1+taxRate) anywhere in this adapter.
// The adapter has no money math at all (task section 8: "the adapter only
// transports"); this test exists to keep that invariant explicit, not
// implicit in the absence of arithmetic.

test("tax-included catalog price is not taxed twice: unitPrice/taxRate are sent and read back byte-for-byte, never recalculated", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      201,
      quoteFixture({
        items: [
          {
            lineId: "line-1",
            type: "product",
            externalSource: "catalog_service",
            externalItemId: "545",
            externalVariantId: null,
            sku: "BAR-OLY-20",
            description: "Barra olimpica 20 kg",
            quantity: "1",
            unitPrice: "99990",
            taxIncluded: true,
            taxRate: "0.19",
            // Real Quote Service arithmetic (QuoteLine.calculateAmounts,
            // taxIncluded branch): lineTotal = unitPrice*quantity exactly -
            // never unitPrice*1.19.
            lineSubtotal: "84025",
            lineTax: "15965",
            lineTotal: "99990"
          }
        ],
        pricing: { subtotal: "84025", taxAmount: "15965", total: "99990" }
      })
    );

  const result = await makeAdapter().createQuote(
    {
      ...createInput,
      items: [
        {
          type: "product",
          externalSource: "catalog_service",
          externalItemId: "545",
          externalVariantId: null,
          sku: "BAR-OLY-20",
          description: "Barra olimpica 20 kg",
          quantity: "1",
          unitPrice: "99990",
          taxIncluded: true,
          taxRate: "0.19"
        }
      ]
    },
    { idempotencyKey: "idem-anti-double-tax" }
  );

  const sentBody = JSON.parse(lastRequest!.body);
  assert.equal(sentBody.items[0].unitPrice, "99990", "the adapter must send unitPrice verbatim, never pre-multiplied by tax");
  assert.equal(sentBody.items[0].taxRate, "0.19");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.items[0].lineTotal, "99990");
  assert.notEqual(result.value.items[0].lineTotal, "118988");
  assert.notEqual(result.value.items[0].lineTotal, "118989");
  assert.notEqual(result.value.items[0].lineTotal, "118990");
});

// ---- createQuote ----

test("createQuote: POST /v1/quotes with Authorization/Idempotency-Key headers and exact allowlisted body", async () => {
  handler = (_req, res) => sendJson(res, 201, quoteFixture());
  const result = await makeAdapter().createQuote(createInput, { idempotencyKey: "idem-1" });

  assert.equal(result.ok, true);
  assert.ok(lastRequest);
  assert.equal(lastRequest!.method, "POST");
  assert.equal(lastRequest!.url, "/v1/quotes");
  assert.equal(lastRequest!.headers.authorization, "Bearer test-token-123");
  assert.equal(lastRequest!.headers["idempotency-key"], "idem-1");

  const body = JSON.parse(lastRequest!.body);
  assert.deepEqual(body, {
    opportunityId: "opp-123",
    customerId: "customer-123",
    conversationId: "conversation-123",
    actor: { type: "sales_agent", id: "agent-1" },
    source: { system: "crm_customer_360", correlationId: "corr-1" },
    currency: "CLP",
    customerSnapshot: { name: "Jane Doe", email: "jane@example.com" },
    items: [{ type: "product", externalItemId: "sku-1", sku: "SKU-1", description: "Line 1", quantity: "2", unitPrice: "4990", taxIncluded: true, taxRate: "0.19" }],
    validUntil: "2026-08-20T00:00:00.000Z"
  });
});

test("createQuote: money fields (quantity/unitPrice/taxRate) are passed through as exact strings, never parsed to float", async () => {
  handler = (_req, res) => sendJson(res, 201, quoteFixture());
  await makeAdapter().createQuote(
    { ...createInput, items: [{ ...createInput.items[0], quantity: "2.500", unitPrice: "4990.10", taxRate: "0.190" }] },
    { idempotencyKey: "idem-1" }
  );
  const body = JSON.parse(lastRequest!.body);
  assert.equal(body.items[0].quantity, "2.500");
  assert.equal(body.items[0].unitPrice, "4990.10");
  assert.equal(body.items[0].taxRate, "0.190");
});

test("createQuote: response maps to QuoteServiceQuote, preserving decimal strings in items/pricing verbatim", async () => {
  handler = (_req, res) => sendJson(res, 201, quoteFixture());
  const result = await makeAdapter().createQuote(createInput, { idempotencyKey: "idem-1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.quoteId, "8400c470-0000-4000-8000-000000000001");
  assert.equal(result.value.items[0].unitPrice, "4990");
  assert.equal(result.value.items[0].lineTotal, "9980");
  assert.equal(result.value.pricing.total, "9980");
  assert.equal(typeof result.value.items[0].unitPrice, "string");
});

test("createQuote: optional customerId/conversationId omitted from body when not supplied", async () => {
  handler = (_req, res) => sendJson(res, 201, quoteFixture());
  const { customerId: _customerId, conversationId: _conversationId, ...withoutOptional } = createInput;
  await makeAdapter().createQuote(withoutOptional, { idempotencyKey: "idem-1" });
  const body = JSON.parse(lastRequest!.body);
  assert.equal("customerId" in body, false);
  assert.equal("conversationId" in body, false);
});

// SALES-AGENT-R1-T1.1: externalSource/externalItemId/externalVariantId are
// transported verbatim, never concatenated/parsed, and never required.
test("createQuote: externalSource/externalItemId/externalVariantId are transported verbatim when supplied", async () => {
  handler = (_req, res) => sendJson(res, 201, quoteFixture());
  await makeAdapter().createQuote(
    {
      ...createInput,
      items: [{ ...createInput.items[0], externalSource: "catalog_service", externalItemId: "545", externalVariantId: "31" }]
    },
    { idempotencyKey: "idem-1" }
  );
  const body = JSON.parse(lastRequest!.body);
  assert.equal(body.items[0].externalSource, "catalog_service");
  assert.equal(body.items[0].externalItemId, "545");
  assert.equal(body.items[0].externalVariantId, "31");
});

test("createQuote: externalSource/externalItemId/externalVariantId are entirely absent from the body when not supplied - never sent as null/empty", async () => {
  handler = (_req, res) => sendJson(res, 201, quoteFixture());
  const { externalItemId: _externalItemId, ...lineWithoutIdentity } = createInput.items[0];
  await makeAdapter().createQuote(
    { ...createInput, items: [lineWithoutIdentity] },
    { idempotencyKey: "idem-1" }
  );
  const body = JSON.parse(lastRequest!.body);
  assert.equal("externalSource" in body.items[0], false);
  assert.equal("externalItemId" in body.items[0], false);
  assert.equal("externalVariantId" in body.items[0], false);
});

test("createQuote: response maps externalSource/externalItemId/externalVariantId from the real response shape", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      201,
      quoteFixture({
        items: [
          {
            lineId: "line-1",
            type: "product",
            externalSource: "catalog_service",
            externalItemId: "545",
            externalVariantId: "31",
            sku: "SKU-1",
            description: "Line 1",
            quantity: "2",
            unitPrice: "4990",
            taxIncluded: true,
            taxRate: "0.19",
            lineSubtotal: "8387",
            lineTax: "1593",
            lineTotal: "9980"
          }
        ]
      })
    );
  const result = await makeAdapter().createQuote(createInput, { idempotencyKey: "idem-1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.items[0].externalSource, "catalog_service");
  assert.equal(result.value.items[0].externalItemId, "545");
  assert.equal(result.value.items[0].externalVariantId, "31");
});

test("createQuote: a response with null externalSource/externalItemId/externalVariantId (a legacy/manual line) parses successfully, never rejected as malformed", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      201,
      quoteFixture({
        items: [
          {
            lineId: "line-1",
            type: "service",
            externalSource: null,
            externalItemId: null,
            externalVariantId: null,
            sku: null,
            description: "Servicio de instalacion",
            quantity: "1",
            unitPrice: "15000",
            taxIncluded: true,
            taxRate: "0.19",
            lineSubtotal: "12605",
            lineTax: "2395",
            lineTotal: "15000"
          }
        ]
      })
    );
  const result = await makeAdapter().createQuote(createInput, { idempotencyKey: "idem-1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.items[0].externalSource, null);
  assert.equal(result.value.items[0].externalItemId, null);
  assert.equal(result.value.items[0].externalVariantId, null);
});

// ---- updateDraft ----

test("updateDraft: PUT /v1/quotes/:quoteId/draft carries expectedVersion and Idempotency-Key", async () => {
  handler = (_req, res) => sendJson(res, 200, quoteFixture({ version: 2 }));
  const result = await makeAdapter().updateDraft(
    {
      quoteId: "8400c470-0000-4000-8000-000000000001",
      expectedVersion: 1,
      actor: { type: "sales_agent", id: "agent-1" },
      source: { system: "crm_customer_360", correlationId: "corr-2" },
      customerSnapshot: { name: "Jane Doe" },
      items: createInput.items,
      validUntil: "2026-08-22T00:00:00.000Z"
    },
    { idempotencyKey: "idem-2" }
  );

  assert.equal(result.ok, true);
  assert.equal(lastRequest!.method, "PUT");
  assert.equal(lastRequest!.url, "/v1/quotes/8400c470-0000-4000-8000-000000000001/draft");
  assert.equal(lastRequest!.headers["idempotency-key"], "idem-2");
  const body = JSON.parse(lastRequest!.body);
  assert.equal(body.expectedVersion, 1);
  assert.equal("quoteId" in body, false, "quoteId travels only in the path, never duplicated in the body");
});

// ---- issueQuote ----

test("issueQuote: POST /v1/quotes/:quoteId/issue carries expectedVersion and Idempotency-Key, no body fields beyond actor/source/expectedVersion", async () => {
  handler = (_req, res) => sendJson(res, 200, quoteFixture({ status: "issued", version: 2 }));
  const result = await makeAdapter().issueQuote(
    { quoteId: "8400c470-0000-4000-8000-000000000001", expectedVersion: 1, actor: { type: "operator", id: "operator-1" }, source: { system: "manual", correlationId: "corr-3" } },
    { idempotencyKey: "idem-3" }
  );

  assert.equal(result.ok, true);
  assert.equal(lastRequest!.method, "POST");
  assert.equal(lastRequest!.url, "/v1/quotes/8400c470-0000-4000-8000-000000000001/issue");
  assert.equal(lastRequest!.headers["idempotency-key"], "idem-3");
  const body = JSON.parse(lastRequest!.body);
  assert.deepEqual(Object.keys(body).sort(), ["actor", "expectedVersion", "source"]);
});

// ---- sendQuoteEmail ----

test("sendQuoteEmail: explicit recipient is transported", async () => {
  handler = (_req, res) => sendJson(res, 202, deliveryFixture({ recipient: "other@example.com" }));
  const result = await makeAdapter().sendQuoteEmail(
    {
      quoteId: "8400c470-0000-4000-8000-000000000001",
      recipient: "other@example.com",
      actor: { type: "sales_agent", id: "agent-1" },
      source: { system: "crm_customer_360", correlationId: "corr-4" }
    },
    { idempotencyKey: "idem-4" }
  );
  assert.equal(result.ok, true);
  const body = JSON.parse(lastRequest!.body);
  assert.equal(body.recipient, "other@example.com");
});

test("sendQuoteEmail: no recipient supplied - field is entirely absent from the body, never sent as null/empty", async () => {
  handler = (_req, res) => sendJson(res, 202, deliveryFixture());
  await makeAdapter().sendQuoteEmail(
    { quoteId: "8400c470-0000-4000-8000-000000000001", actor: { type: "sales_agent", id: "agent-1" }, source: { system: "crm_customer_360", correlationId: "corr-4" } },
    { idempotencyKey: "idem-5" }
  );
  const body = JSON.parse(lastRequest!.body);
  assert.equal("recipient" in body, false);
});

test("sendQuoteEmail: maps the 202 delivery response, never treated as an error", async () => {
  handler = (_req, res) => sendJson(res, 202, deliveryFixture());
  const result = await makeAdapter().sendQuoteEmail(
    { quoteId: "8400c470-0000-4000-8000-000000000001", actor: { type: "sales_agent", id: "agent-1" }, source: { system: "crm_customer_360", correlationId: "corr-4" } },
    { idempotencyKey: "idem-6" }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.deliveryId, "delivery-1");
  assert.equal(result.value.status, "pending");
});

// ---- reads ----

test("getQuote: GET /v1/quotes/:quoteId, no Idempotency-Key header sent on a read", async () => {
  handler = (_req, res) => sendJson(res, 200, quoteFixture());
  const result = await makeAdapter().getQuote("8400c470-0000-4000-8000-000000000001");
  assert.equal(result.ok, true);
  assert.equal(lastRequest!.method, "GET");
  assert.equal(lastRequest!.url, "/v1/quotes/8400c470-0000-4000-8000-000000000001");
  assert.equal(lastRequest!.headers["idempotency-key"], undefined);
  assert.equal(lastRequest!.body, "");
});

test("getQuoteByNumber: GET /v1/quotes/by-number/:quoteNumber, value URL-encoded", async () => {
  handler = (_req, res) => sendJson(res, 200, quoteFixture());
  const result = await makeAdapter().getQuoteByNumber("Q/2026 0001");
  assert.equal(result.ok, true);
  assert.equal(lastRequest!.url, `/v1/quotes/by-number/${encodeURIComponent("Q/2026 0001")}`);
});

test("getQuoteDelivery: GET /v1/quotes/:quoteId/deliveries/:deliveryId", async () => {
  handler = (_req, res) => sendJson(res, 200, deliveryFixture());
  const result = await makeAdapter().getQuoteDelivery("8400c470-0000-4000-8000-000000000001", "delivery-1");
  assert.equal(result.ok, true);
  assert.equal(lastRequest!.url, "/v1/quotes/8400c470-0000-4000-8000-000000000001/deliveries/delivery-1");
  if (!result.ok) return;
  assert.equal(result.value.deliveryId, "delivery-1");
});

test("listQuoteDeliveries: GET with optional channel/limit/offset query params", async () => {
  handler = (_req, res) => sendJson(res, 200, { items: [deliveryFixture()], pagination: { limit: 50, offset: 0, count: 1 } });
  const result = await makeAdapter().listQuoteDeliveries("8400c470-0000-4000-8000-000000000001", { channel: "email", limit: 10, offset: 5 });
  assert.equal(result.ok, true);
  const url = new URL(lastRequest!.url!, "http://localhost");
  assert.equal(url.pathname, "/v1/quotes/8400c470-0000-4000-8000-000000000001/deliveries");
  assert.equal(url.searchParams.get("channel"), "email");
  assert.equal(url.searchParams.get("limit"), "10");
  assert.equal(url.searchParams.get("offset"), "5");
  if (!result.ok) return;
  assert.equal(result.value.items.length, 1);
  assert.equal(result.value.pagination.count, 1);
});

test("listQuoteDeliveries: no query supplied - no query string sent", async () => {
  handler = (_req, res) => sendJson(res, 200, { items: [], pagination: { limit: 50, offset: 0, count: 0 } });
  await makeAdapter().listQuoteDeliveries("8400c470-0000-4000-8000-000000000001");
  assert.equal(lastRequest!.url, "/v1/quotes/8400c470-0000-4000-8000-000000000001/deliveries");
});

// ---- error mapping (real captured envelope shape: {"error":{"code":"...","message":"..."}}) ----

test("400 validation_error maps to class 'validation', code and message preserved", async () => {
  handler = (_req, res) => sendJson(res, 400, { error: { code: "invalid_line_quantity", message: "items.quantity must be greater than zero" } });
  const result = await makeAdapter().createQuote(createInput, { idempotencyKey: "idem-7" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "validation");
  assert.equal(result.error.code, "invalid_line_quantity");
  assert.equal(result.error.message, "items.quantity must be greater than zero");
  assert.equal(result.error.httpStatus, 400);
  assert.equal(result.error.retryable, false);
});

test("401 missing_authentication maps to class 'auth', never retryable", async () => {
  handler = (_req, res) => sendJson(res, 401, { error: { code: "missing_authentication", message: "Authentication is required" } });
  const result = await makeAdapter().getQuote("8400c470-0000-4000-8000-000000000001");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "auth");
  assert.equal(result.error.code, "missing_authentication");
  assert.equal(result.error.retryable, false);
});

test("404 quote_not_found maps to class 'not_found'", async () => {
  handler = (_req, res) => sendJson(res, 404, { error: { code: "quote_not_found", message: "Quote not found" } });
  const result = await makeAdapter().getQuote("does-not-exist");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "not_found");
  assert.equal(result.error.code, "quote_not_found");
});

test("409 optimistic_concurrency_conflict maps to class 'conflict', includes details, never retryable", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "optimistic_concurrency_conflict", message: "Quote version does not match expectedVersion", details: { expectedVersion: 1, currentVersion: 2 } } });
  const result = await makeAdapter().issueQuote(
    { quoteId: "8400c470-0000-4000-8000-000000000001", expectedVersion: 1, actor: { type: "operator", id: "op-1" }, source: { system: "manual" } },
    { idempotencyKey: "idem-8" }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "conflict");
  assert.equal(result.error.code, "optimistic_concurrency_conflict");
  assert.deepEqual(result.error.details, { expectedVersion: 1, currentVersion: 2 });
  assert.equal(result.error.retryable, false);
});

test("409 invalid_quote_status_transition maps to its own class 'invalid_transition', distinct from generic conflict", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "invalid_quote_status_transition", message: "Quote status transition is not allowed" } });
  const result = await makeAdapter().issueQuote(
    { quoteId: "8400c470-0000-4000-8000-000000000001", expectedVersion: 1, actor: { type: "operator", id: "op-1" }, source: { system: "manual" } },
    { idempotencyKey: "idem-9" }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "invalid_transition");
});

test("409 idempotency_key_reused_with_different_payload maps to class 'conflict'", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "idempotency_key_reused_with_different_payload", message: "Idempotency key reused with a different payload" } });
  const result = await makeAdapter().createQuote(createInput, { idempotencyKey: "idem-10" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "conflict");
  assert.equal(result.error.code, "idempotency_key_reused_with_different_payload");
});

test("503 document_generation_failed maps to class 'upstream_unavailable', retryable", async () => {
  handler = (_req, res) => sendJson(res, 503, { error: { code: "document_generation_failed", message: "PDF rendering failed" } });
  const result = await makeAdapter().issueQuote(
    { quoteId: "8400c470-0000-4000-8000-000000000001", expectedVersion: 1, actor: { type: "operator", id: "op-1" }, source: { system: "manual" } },
    { idempotencyKey: "idem-11" }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "upstream_unavailable");
  assert.equal(result.error.retryable, true);
});

test("500 internal_server_error maps to class 'upstream_unavailable', retryable", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: { code: "internal_server_error", message: "Unexpected server error" } });
  const result = await makeAdapter().getQuote("8400c470-0000-4000-8000-000000000001");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "upstream_unavailable");
  assert.equal(result.error.retryable, true);
});

test("an unrecognized error code falls back to an HTTP-status-based class, never dropped/crashes", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "some_future_code_this_adapter_does_not_know", message: "future" } });
  const result = await makeAdapter().getQuote("8400c470-0000-4000-8000-000000000001");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "conflict");
  assert.equal(result.error.code, "some_future_code_this_adapter_does_not_know");
});

test("timeout maps to class 'timeout', retryable, never throws", async () => {
  handler = () => {
    /* never responds */
  };
  const result = await makeAdapter(50).getQuote("8400c470-0000-4000-8000-000000000001");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "timeout");
  assert.equal(result.error.retryable, true);
});

test("network failure (connection refused) maps to class 'upstream_unavailable'", async () => {
  const adapter = createHttpQuoteServiceAdapter({ baseUrl: "http://127.0.0.1:1", authToken: "token", timeoutMs: 500 });
  const result = await adapter.getQuote("8400c470-0000-4000-8000-000000000001");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "upstream_unavailable");
  assert.equal(result.error.retryable, true);
});

test("malformed (non-JSON) success body fails closed as 'malformed_response', never partially trusted", async () => {
  handler = (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("not json");
  };
  const result = await makeAdapter().getQuote("8400c470-0000-4000-8000-000000000001");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "malformed_response");
});

test("schema-invalid 2xx response (missing required field) fails closed, never a partial quote object", async () => {
  const { pricing: _pricing, ...withoutPricing } = quoteFixture();
  handler = (_req, res) => sendJson(res, 200, withoutPricing);
  const result = await makeAdapter().getQuote("8400c470-0000-4000-8000-000000000001");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "malformed_response");
});

test("error response with a non-object 'error' shape fails closed as malformed_response, never crashes", async () => {
  handler = (_req, res) => sendJson(res, 400, { error: "just a string, not an envelope" });
  const result = await makeAdapter().getQuote("8400c470-0000-4000-8000-000000000001");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.class, "malformed_response");
});

// ---- secret safety ----

test("the auth token never appears in a returned error message or details, even when the mock echoes the Authorization header back", async () => {
  handler = (req, res) => {
    sendJson(res, 400, { error: { code: "validation_error", message: `Rejected request with header ${req.headers.authorization}` } });
  };
  const result = await makeAdapter(500, "super-secret-token-xyz").getQuote("8400c470-0000-4000-8000-000000000001");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(!result.error.message.includes("super-secret-token-xyz"), "token must never leak into a returned error message");
  assert.ok(result.error.message.includes("[redacted]"));
});

test("the auth token is sent as a real Bearer header, never logged/serialized as raw Authorization in the request body", async () => {
  handler = (_req, res) => sendJson(res, 200, quoteFixture());
  await makeAdapter(500, "super-secret-token-xyz").getQuote("8400c470-0000-4000-8000-000000000001");
  assert.equal(lastRequest!.headers.authorization, "Bearer super-secret-token-xyz");
  assert.equal(lastRequest!.body, "", "a GET request must never carry the token (or anything else) in the body");
});

// ---- config ----

test("readQuoteServiceConfig: valid env produces a trimmed baseUrl and the configured timeout", () => {
  const config = readQuoteServiceConfig({ QUOTE_SERVICE_BASE_URL: "http://example.test/", QUOTE_SERVICE_AUTH_TOKEN: "tok", QUOTE_SERVICE_TIMEOUT_MS: "9000" });
  assert.deepEqual(config, { baseUrl: "http://example.test", authToken: "tok", timeoutMs: 9000 });
});

test("readQuoteServiceConfig: missing QUOTE_SERVICE_BASE_URL returns null (unconfigured)", () => {
  const config = readQuoteServiceConfig({ QUOTE_SERVICE_AUTH_TOKEN: "tok" });
  assert.equal(config, null);
});

test("readQuoteServiceConfig: missing QUOTE_SERVICE_AUTH_TOKEN returns null (unconfigured)", () => {
  const config = readQuoteServiceConfig({ QUOTE_SERVICE_BASE_URL: "http://example.test" });
  assert.equal(config, null);
});

test("readQuoteServiceConfig: invalid/absent timeout falls back to the 5000ms default", () => {
  const config = readQuoteServiceConfig({ QUOTE_SERVICE_BASE_URL: "http://example.test", QUOTE_SERVICE_AUTH_TOKEN: "tok", QUOTE_SERVICE_TIMEOUT_MS: "not-a-number" });
  assert.equal(config?.timeoutMs, 5000);
});

test("readQuoteServiceConfig: a negative/zero timeout also falls back to the default, never a non-positive timeout", () => {
  const config = readQuoteServiceConfig({ QUOTE_SERVICE_BASE_URL: "http://example.test", QUOTE_SERVICE_AUTH_TOKEN: "tok", QUOTE_SERVICE_TIMEOUT_MS: "0" });
  assert.equal(config?.timeoutMs, 5000);
});
