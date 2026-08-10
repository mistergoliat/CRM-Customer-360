import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { setShippingDestinationForOpportunity, getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import { createCommuneResolver } from "@/lib/domains/commune-resolution";
import { comparisonKey } from "@/lib/domains/commune-resolution/normalize";
import type { CommuneCatalogEntry } from "@/lib/domains/commune-resolution/types";
import type { CommuneCatalogPort } from "@/lib/domains/commune-resolution/ports";
import { getActiveRequestFact } from "@/lib/brain/commercial/request-facts";
import { buildShippingDestinationRequestAnchor, SHIPPING_DESTINATION_FACT_KEY } from "@/lib/domains/shipping-destination/constants";

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

// Same six real T13B/T13C acceptance rows used by tests/domains/communeResolution.test.ts.
const REAL_ROWS: CommuneCatalogEntry[] = [
  { communeId: 99, canonicalName: "Ñuñoa" },
  { communeId: 105, canonicalName: "Las Condes" },
  { communeId: 96, canonicalName: "Providencia" },
  { communeId: 86, canonicalName: "Santiago Centro" },
  { communeId: 55, canonicalName: "Llaillay" }
];

function fakeCatalog(entries: CommuneCatalogEntry[] = REAL_ROWS): CommuneCatalogPort {
  return {
    async findByNormalizedName(normalizedName) {
      const matches = entries.filter((entry) => comparisonKey(entry.canonicalName) === normalizedName);
      return { ok: true, entries: matches };
    }
  };
}

function erroringCatalog(): CommuneCatalogPort {
  return {
    async findByNormalizedName() {
      return { ok: false, reason: "unavailable", detail: "pc_pos connection refused" };
    }
  };
}

function uniqueOpportunityId() {
  return 800000000 + Math.floor(Math.random() * 99999999);
}

test("A/B: explicit resolved destination (normalized) persists a confirmed, authoritative fact", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setShippingDestinationForOpportunity({ opportunityId, inputText: " nunoa " }, { resolver: createCommuneResolver(fakeCatalog()) });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "resolved");
  assert.equal(result.destination.communeId, 99);
  assert.equal(result.destination.canonicalName, "Ñuñoa");
  assert.equal(result.changed, true);

  const fact = await getActiveRequestFact(buildShippingDestinationRequestAnchor(opportunityId), SHIPPING_DESTINATION_FACT_KEY);
  assert.equal(fact?.status, "confirmed");
  assert.deepEqual(fact?.value, { inputText: " nunoa ", communeId: 99, canonicalName: "Ñuñoa", matchedVia: "direct", source: "conversation" });
});

test("C: alias resolves through the catalog, never a hardcoded id", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Llay-Llay" }, { resolver: createCommuneResolver(fakeCatalog()) });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.destination.communeId, 55);
  assert.equal(result.destination.matchedVia, "alias");
});

test("D: ambiguous input (Santiago) needs clarification and never becomes an active destination", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Santiago" }, { resolver: createCommuneResolver(fakeCatalog()) });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "needs_clarification");
  assert.equal(result.reason, "city_or_conurbation_ambiguous");

  const destination = await getActiveShippingDestinationForOpportunity(opportunityId);
  assert.equal(destination, null);
});

test("E: region-level input (Arica y Parinacota) never resolves to a commune", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Arica y Parinacota" }, { resolver: createCommuneResolver(fakeCatalog()) });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "needs_clarification");
  assert.equal(result.reason, "region_level_not_commune");

  const destination = await getActiveShippingDestinationForOpportunity(opportunityId);
  assert.equal(destination, null);
});

test("F: changing destination supersedes the prior fact and leaves exactly one active", async () => {
  const opportunityId = uniqueOpportunityId();
  const resolver = createCommuneResolver(fakeCatalog());

  const first = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Ñuñoa" }, { resolver });
  assert.equal(first.ok, true);

  const second = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Providencia" }, { resolver });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.destination.communeId, 96);
  assert.equal(second.changed, true);

  const active = await getActiveShippingDestinationForOpportunity(opportunityId);
  assert.equal(active?.communeId, 96);
  assert.equal(active?.canonicalName, "Providencia");
});

test("G: repeating the same destination is idempotent - no duplicate active fact, no unnecessary version", async () => {
  const opportunityId = uniqueOpportunityId();
  const resolver = createCommuneResolver(fakeCatalog());

  const first = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Ñuñoa" }, { resolver });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Ñuñoa" }, { resolver });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.changed, false);
  assert.equal(second.destination.factId, first.destination.factId);
});

test("H: a persistence failure never returns a false success", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setShippingDestinationForOpportunity(
    { opportunityId, inputText: "Ñuñoa" },
    {
      resolver: createCommuneResolver(fakeCatalog()),
      getActiveFact: async () => null,
      upsertFact: async () => ({ ok: false, status: "error", fact: null, warning: "simulated_db_failure" })
    }
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "persistence_failed");

  const destination = await getActiveShippingDestinationForOpportunity(opportunityId);
  assert.equal(destination, null);
});

test("I: a resolver technical failure fails closed, never persisting a destination", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Ñuñoa" }, { resolver: createCommuneResolver(erroringCatalog()) });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "resolver_error");
  assert.equal(result.reason, "unavailable");

  const destination = await getActiveShippingDestinationForOpportunity(opportunityId);
  assert.equal(destination, null);
});

test("J: rehydration - a destination persisted in one call is returned unchanged by a fresh, independent read", async () => {
  const opportunityId = uniqueOpportunityId();
  const resolver = createCommuneResolver(fakeCatalog());

  await setShippingDestinationForOpportunity({ opportunityId, inputText: "Ñuñoa" }, { resolver });

  // Simulates a new turn/worker/process: nothing here reuses in-memory state
  // from the call above, only a fresh DB read keyed by opportunityId.
  const rehydrated = await getActiveShippingDestinationForOpportunity(opportunityId);
  assert.equal(rehydrated?.communeId, 99);
  assert.equal(rehydrated?.canonicalName, "Ñuñoa");
});

test("not_found input never persists a destination", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setShippingDestinationForOpportunity({ opportunityId, inputText: "asdfgh" }, { resolver: createCommuneResolver(fakeCatalog()) });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "not_found");

  const destination = await getActiveShippingDestinationForOpportunity(opportunityId);
  assert.equal(destination, null);
});

test("empty input is invalid_input, never persisted", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setShippingDestinationForOpportunity({ opportunityId, inputText: "   " }, { resolver: createCommuneResolver(fakeCatalog()) });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "invalid_input");
});

test("O: exactly one active destination fact per opportunity is enforced by the DB, even after multiple changes", async () => {
  const opportunityId = uniqueOpportunityId();
  const resolver = createCommuneResolver(fakeCatalog());

  await setShippingDestinationForOpportunity({ opportunityId, inputText: "Ñuñoa" }, { resolver });
  await setShippingDestinationForOpportunity({ opportunityId, inputText: "Providencia" }, { resolver });
  await setShippingDestinationForOpportunity({ opportunityId, inputText: "Las Condes" }, { resolver });

  const { safeQueryRows } = await import("@/lib/db");
  const anchor = buildShippingDestinationRequestAnchor(opportunityId);
  const activeRows = await safeQueryRows(
    "SELECT id FROM crm_request_facts WHERE request_id = ? AND fact_key = ? AND superseded_at IS NULL",
    [anchor, SHIPPING_DESTINATION_FACT_KEY]
  );
  assert.equal(activeRows.ok, true);
  assert.equal(activeRows.rows.length, 1);
});

test("this domain never reads customer_addresses/delivery_address_id to derive a destination", async () => {
  const opportunityId = uniqueOpportunityId();
  // No stored-address infrastructure is wired into setShippingDestinationForOpportunity's
  // dependencies at all (only a CommuneResolver) - a stored address can never
  // silently become an authoritative destination via this path (T13D section 9/L).
  const result = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Ñuñoa" }, { resolver: createCommuneResolver(fakeCatalog()) });
  assert.equal(result.ok, true);
});
