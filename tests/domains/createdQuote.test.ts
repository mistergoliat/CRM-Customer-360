import assert from "node:assert/strict";
import test from "node:test";
import { getActiveCreatedQuoteForOpportunity, setCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";
import type { CreatedQuoteFactValue, SetCreatedQuoteInput } from "@/lib/domains/created-quote";
import type { RequestFact, UpsertRequestFactInput, UpsertRequestFactResult } from "@/lib/brain/commercial/request-facts";

/**
 * SALES-AGENT-R1-T3. DB-free domain tests for the durable created-quote
 * reference - same pattern as tests/domains/selectedShippingOption.test.ts:
 * setCreatedQuoteForOpportunity/getActiveCreatedQuoteForOpportunity both
 * accept injectable dependencies, so no MariaDB is required here.
 */

function createFakeFactStore() {
  let seq = 0;
  const active = new Map<string, RequestFact>();
  return {
    store: active,
    async getActiveFact(requestId: string, factKey: string): Promise<RequestFact | null> {
      return active.get(`${requestId}:${factKey}`) ?? null;
    },
    async upsertFact(input: UpsertRequestFactInput): Promise<UpsertRequestFactResult> {
      seq += 1;
      const key = `${input.requestId}:${input.factKey}`;
      const existed = active.has(key);
      const now = new Date().toISOString();
      const fact: RequestFact = {
        factId: `fact-${seq}`,
        requestId: input.requestId,
        factKey: input.factKey,
        value: input.value,
        status: input.status ?? "inferred",
        sourceMessageId: input.sourceMessageId ?? null,
        sourceToolExecutionId: input.sourceToolExecutionId ?? null,
        confidence: input.confidence ?? null,
        createdAt: now,
        updatedAt: now,
        supersededAt: null
      };
      active.set(key, fact);
      return { ok: true, status: existed ? "versioned" : "created", fact };
    }
  };
}

function quoteInput(overrides: Partial<Omit<CreatedQuoteFactValue, "createdAt">> = {}): Omit<CreatedQuoteFactValue, "createdAt"> {
  return {
    quoteId: "quote-1",
    quoteNumber: "Q-0001",
    status: "draft",
    currency: "CLP",
    total: "118988",
    validUntil: "2026-08-20T00:00:00.000Z",
    selectionFactId: "commercial-line-items-fact-1",
    idempotencyKey: "idem-1",
    ...overrides
  };
}

test("creating a quote persists it as the confirmed active reference", async () => {
  const fakeStore = createFakeFactStore();
  const input: SetCreatedQuoteInput = { opportunityId: 1, quote: quoteInput() };

  const result = await setCreatedQuoteForOpportunity(input, { getActiveFact: fakeStore.getActiveFact, upsertFact: fakeStore.upsertFact });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.quote.quoteId, "quote-1");
  assert.equal(result.quote.selectionFactId, "commercial-line-items-fact-1");
});

test("rehydration returns the persisted quote", async () => {
  const fakeStore = createFakeFactStore();
  const opportunityId = 2;
  await setCreatedQuoteForOpportunity({ opportunityId, quote: quoteInput() }, { getActiveFact: fakeStore.getActiveFact, upsertFact: fakeStore.upsertFact });

  const active = await getActiveCreatedQuoteForOpportunity(opportunityId, { getActiveFact: fakeStore.getActiveFact });
  assert.ok(active);
  assert.equal(active?.quoteId, "quote-1");
});

test("rehydration returns null when no quote has been created yet", async () => {
  const fakeStore = createFakeFactStore();
  const active = await getActiveCreatedQuoteForOpportunity(999, { getActiveFact: fakeStore.getActiveFact });
  assert.equal(active, null);
});

test("creating a second quote (selection changed) supersedes the prior reference - exactly one active row", async () => {
  const fakeStore = createFakeFactStore();
  const opportunityId = 3;

  const first = await setCreatedQuoteForOpportunity(
    { opportunityId, quote: quoteInput({ quoteId: "quote-1", selectionFactId: "sel-1" }) },
    { getActiveFact: fakeStore.getActiveFact, upsertFact: fakeStore.upsertFact }
  );
  assert.equal(first.ok, true);

  const second = await setCreatedQuoteForOpportunity(
    { opportunityId, quote: quoteInput({ quoteId: "quote-2", selectionFactId: "sel-2" }) },
    { getActiveFact: fakeStore.getActiveFact, upsertFact: fakeStore.upsertFact }
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.quote.quoteId, "quote-2");
  assert.notEqual(second.quote.factId, (first.ok && first.quote.factId) || null);

  // Exactly one active row per opportunity - the fake store only ever holds one entry per (requestId, factKey) key, mirroring crm_request_facts' unique-active-row constraint.
  assert.equal(fakeStore.store.size, 1);

  const active = await getActiveCreatedQuoteForOpportunity(opportunityId, { getActiveFact: fakeStore.getActiveFact });
  assert.equal(active?.quoteId, "quote-2");
});

test("a persistence failure never returns a false success", async () => {
  const result = await setCreatedQuoteForOpportunity(
    { opportunityId: 4, quote: quoteInput() },
    { getActiveFact: async () => null, upsertFact: async () => ({ ok: false, status: "error", fact: null, warning: "simulated_db_failure" }) }
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "persistence_failed");
});
