import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeExecute } from "@/lib/db";
import {
  createQuoteDraft,
  expireQuote,
  getCurrentQuoteForRequest,
  listQuoteVersions,
  loadQuote,
  markQuoteSent,
  recordQuoteDecision,
  QUOTE_TABLE
} from "@/lib/brain/commercial/quotes";
import type { QuoteItem, QuoteTotals } from "@/lib/brain/commercial/quotes";
import {
  createConversationRequest,
  listRequestEvents,
  loadConversationRequest,
  transitionConversationRequest
} from "@/lib/brain/commercial/conversation-request";
import type { AddressSnapshot } from "@/lib/domains/customer-addresses";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: ""
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function makeQuoteRequest(conversationId = 900000000 + Math.floor(Math.random() * 99999999)) {
  const created = await createConversationRequest({
    creationKey: uniqueSuffix("creation"),
    conversationId,
    intentType: "product_quote",
    intentDomain: "sales",
    createdFromMessageId: uniqueSuffix("cm")
  });
  assert.equal(created.ok, true, created.ok ? "" : created.warning);
  await transitionConversationRequest({ requestId: created.request!.requestId, fromStatus: "detected", toStatus: "active" });
  return created.request!;
}

function makeItems(): QuoteItem[] {
  return [
    { productId: "prod-1", name: "Banca plana PRO", quantity: 2, unitPrice: 89990, lineTotal: 179980 },
    { productId: "prod-2", name: "Set discos 100kg", quantity: 1, unitPrice: 249990, lineTotal: 249990 }
  ];
}

function makeTotals(): QuoteTotals {
  return { subtotal: 429970, shipping: 15000, total: 444970, currency: "CLP" };
}

function makeSnapshot(): AddressSnapshot {
  return {
    addressId: "addr-original",
    recipientName: "Cliente Uno",
    recipientPhone: "+56990000001",
    streetName: "Avenida Original",
    streetNumber: "123",
    unit: null,
    commune: "Providencia",
    city: "Santiago",
    region: "Metropolitana",
    postalCode: null,
    deliveryNotes: "Dejar en conserjería"
  };
}

test("createQuoteDraft persists version 1 with snapshots and is idempotent per action", async () => {
  const request = await makeQuoteRequest();
  const actionId = uniqueSuffix("action");

  const first = await createQuoteDraft({
    requestId: request.requestId,
    items: makeItems(),
    totals: makeTotals(),
    addressSnapshot: makeSnapshot(),
    createdByActionId: actionId
  });
  assert.equal(first.ok, true);
  assert.equal(first.status, "created");
  assert.equal(first.quote?.version, 1);
  assert.equal(first.quote?.status, "draft");
  assert.equal(first.quote?.items.length, 2);
  assert.equal(first.quote?.totals.total, 444970);
  assert.equal(first.quote?.addressSnapshot?.streetName, "Avenida Original");

  const retry = await createQuoteDraft({ requestId: request.requestId, items: makeItems(), totals: makeTotals(), createdByActionId: actionId });
  assert.equal(retry.status, "duplicate");
  assert.equal(retry.quote?.quoteId, first.quote?.quoteId);
  assert.equal((await listQuoteVersions(request.requestId)).length, 1);

  const events = await listRequestEvents(request.requestId);
  assert.equal(events.filter((event) => event.eventType === "quote_created").length, 1);
});

test("modifying a quote creates a new version; the old one is superseded with its content intact", async () => {
  const request = await makeQuoteRequest();
  const v1 = await createQuoteDraft({ requestId: request.requestId, items: makeItems(), totals: makeTotals() });

  const cheaperItems: QuoteItem[] = [{ productId: "prod-1", name: "Banca plana PRO", quantity: 1, unitPrice: 89990, lineTotal: 89990 }];
  const v2 = await createQuoteDraft({
    requestId: request.requestId,
    items: cheaperItems,
    totals: { subtotal: 89990, shipping: 15000, total: 104990, currency: "CLP" }
  });

  assert.equal(v2.ok, true);
  assert.equal(v2.quote?.version, 2);

  const current = await getCurrentQuoteForRequest(request.requestId);
  assert.equal(current?.quoteId, v2.quote?.quoteId);

  const history = await listQuoteVersions(request.requestId);
  assert.equal(history.length, 2);
  assert.equal(history[0].status, "superseded");
  // The superseded version keeps its original content - documents never mutate.
  assert.equal(history[0].items.length, 2);
  assert.equal(history[0].totals.total, 444970);
});

test("the DB itself rejects a second current quote for the same request", async () => {
  const request = await makeQuoteRequest();
  await createQuoteDraft({ requestId: request.requestId, items: makeItems(), totals: makeTotals() });

  const raw = await safeExecute(
    `INSERT INTO ${QUOTE_TABLE} (quote_id, request_id, conversation_id, version, status, items_json, totals_json)
     VALUES (?, ?, ?, 99, 'draft', '[]', '{}')`,
    [uniqueSuffix("quote"), request.requestId, request.conversationId]
  );
  assert.equal(raw.ok, false);
  assert.match(raw.ok ? "" : raw.error, /duplicate/i);
});

test("quote_sent resolves the product_quote request through the deterministic reducer", async () => {
  const request = await makeQuoteRequest();
  const draft = await createQuoteDraft({ requestId: request.requestId, items: makeItems(), totals: makeTotals() });

  const sent = await markQuoteSent(draft.quote!.quoteId);
  assert.equal(sent.ok, true);
  assert.equal(sent.quote?.status, "sent");
  assert.notEqual(sent.quote?.sentAt, null);

  const resolved = await loadConversationRequest(request.requestId);
  assert.equal(resolved?.status, "resolved");
  assert.equal(resolved?.resolution?.type, "quote_sent");

  // Sending twice conflicts; the request stays resolved exactly once.
  const again = await markQuoteSent(draft.quote!.quoteId);
  assert.equal(again.ok, false);
  assert.equal(again.status, "conflict");
});

test("customer decisions are recorded on sent quotes only; rejection frees the slot for a new version", async () => {
  const request = await makeQuoteRequest();
  const draft = await createQuoteDraft({ requestId: request.requestId, items: makeItems(), totals: makeTotals() });

  const early = await recordQuoteDecision(draft.quote!.quoteId, "accepted");
  assert.equal(early.ok, false);
  assert.equal(early.status, "conflict");

  await markQuoteSent(draft.quote!.quoteId);
  const rejected = await recordQuoteDecision(draft.quote!.quoteId, "rejected", { sourceMessageId: uniqueSuffix("cm") });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.quote?.status, "rejected");

  const events = await listRequestEvents(request.requestId);
  assert.equal(events.some((event) => event.eventType === "quote_rejected"), true);

  // Slot freed: a new version can be drafted after rejection.
  const v2 = await createQuoteDraft({ requestId: request.requestId, items: makeItems(), totals: makeTotals() });
  assert.equal(v2.ok, true);
  assert.equal(v2.quote?.version, 2);
});

test("an accepted quote is never silently replaced", async () => {
  const request = await makeQuoteRequest();
  const draft = await createQuoteDraft({ requestId: request.requestId, items: makeItems(), totals: makeTotals() });
  await markQuoteSent(draft.quote!.quoteId);
  const accepted = await recordQuoteDecision(draft.quote!.quoteId, "accepted");
  assert.equal(accepted.ok, true);

  const replacement = await createQuoteDraft({ requestId: request.requestId, items: makeItems(), totals: makeTotals() });
  assert.equal(replacement.ok, false);
  assert.equal(replacement.status, "conflict");
});

test("quotes stay isolated between requests; invalid content is rejected; expiry works from draft or sent", async () => {
  const conversationId = 900000000 + Math.floor(Math.random() * 99999999);
  const requestA = await makeQuoteRequest(conversationId);
  const requestB = await makeQuoteRequest(conversationId);

  await createQuoteDraft({ requestId: requestA.requestId, items: makeItems(), totals: makeTotals() });
  assert.equal(await getCurrentQuoteForRequest(requestB.requestId), null);

  const noItems = await createQuoteDraft({ requestId: requestB.requestId, items: [], totals: makeTotals() });
  assert.equal(noItems.ok, false);
  assert.equal(noItems.warning, "quote_items_required");

  const badTotal = await createQuoteDraft({
    requestId: requestB.requestId,
    items: makeItems(),
    totals: { subtotal: 1, shipping: null, total: Number.NaN, currency: "CLP" }
  });
  assert.equal(badTotal.ok, false);
  assert.equal(badTotal.warning, "quote_total_invalid");

  const draft = await createQuoteDraft({ requestId: requestB.requestId, items: makeItems(), totals: makeTotals() });
  const expired = await expireQuote(draft.quote!.quoteId);
  assert.equal(expired.ok, true);
  assert.equal((await loadQuote(draft.quote!.quoteId))?.status, "expired");
});
