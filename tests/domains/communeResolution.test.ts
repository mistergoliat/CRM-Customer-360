import assert from "node:assert/strict";
import test from "node:test";
import { comparisonKey, normalizeCommuneText } from "@/lib/domains/commune-resolution/normalize";
import { resolveCommune } from "@/lib/domains/commune-resolution/service";
import type { CommuneCatalogEntry, CommuneCatalogLookupResult } from "@/lib/domains/commune-resolution/types";
import type { CommuneCatalogPort } from "@/lib/domains/commune-resolution/ports";

// The six real T13B/T13C acceptance rows (pc_pos.comuna, verified against
// production - see docs/audits/CRM-R1-T13B-*).
const REAL_ROWS: CommuneCatalogEntry[] = [
  { communeId: 99, canonicalName: "Ñuñoa" },
  { communeId: 105, canonicalName: "Las Condes" },
  { communeId: 86, canonicalName: "Santiago Centro" },
  { communeId: 55, canonicalName: "Llaillay" },
  { communeId: 164, canonicalName: "Marchigüe" },
  { communeId: 151, canonicalName: "San Vicente de Tagua Tagua" }
];

function fakeCatalog(entries: CommuneCatalogEntry[]): CommuneCatalogPort {
  return {
    async findByNormalizedName(normalizedName) {
      const matches = entries.filter((entry) => comparisonKey(entry.canonicalName) === normalizedName);
      return { ok: true, entries: matches };
    }
  };
}

function throwingCatalog(): CommuneCatalogPort {
  return {
    async findByNormalizedName() {
      throw new Error("catalog must not be queried for a known-ambiguous term");
    }
  };
}

function failingCatalog(result: CommuneCatalogLookupResult & { ok: false }): CommuneCatalogPort {
  return { async findByNormalizedName() { return result; } };
}

// --- normalization ---

test("normalize: trims, lowercases and folds accents for comparison", () => {
  assert.equal(comparisonKey("  ÑUÑOA "), comparisonKey("nunoa"));
  assert.equal(comparisonKey("Ñuñoa"), "nunoa");
});

test("normalize: collapses internal whitespace", () => {
  assert.equal(comparisonKey("San   Vicente"), comparisonKey("San Vicente"));
});

test("normalize: collapses dash variants to a single space", () => {
  assert.equal(comparisonKey("Llay-Llay"), comparisonKey("Llay Llay"));
});

test("normalize: preserves display casing and accents (not a display transform)", () => {
  assert.equal(normalizeCommuneText("  ÑUÑOA  "), "ÑUÑOA");
});

// --- acceptance cases (section 15) ---

test("resolves Ñuñoa", async () => {
  const result = await resolveCommune("Ñuñoa", fakeCatalog(REAL_ROWS));
  assert.deepEqual(result, { status: "resolved", communeId: 99, canonicalName: "Ñuñoa", matchedVia: "direct" });
});

test("resolves case/accent-insensitive variants of Ñuñoa", async () => {
  for (const input of ["nunoa", " ÑUÑOA "]) {
    const result = await resolveCommune(input, fakeCatalog(REAL_ROWS));
    assert.equal(result.status, "resolved");
    assert.equal((result as { communeId: number }).communeId, 99);
  }
});

test("resolves Las Condes", async () => {
  const result = await resolveCommune("Las Condes", fakeCatalog(REAL_ROWS));
  assert.deepEqual(result, { status: "resolved", communeId: 105, canonicalName: "Las Condes", matchedVia: "direct" });
});

test("resolves Santiago Centro directly (never confused with bare Santiago)", async () => {
  const result = await resolveCommune("Santiago Centro", fakeCatalog(REAL_ROWS));
  assert.deepEqual(result, { status: "resolved", communeId: 86, canonicalName: "Santiago Centro", matchedVia: "direct" });
});

// --- aliases (section 12 / 19.B) ---

test("resolves Llay-Llay via the Llaillay alias", async () => {
  const result = await resolveCommune("Llay-Llay", fakeCatalog(REAL_ROWS));
  assert.deepEqual(result, { status: "resolved", communeId: 55, canonicalName: "Llaillay", matchedVia: "alias" });
});

test("resolves Marchihue via the Marchigüe alias", async () => {
  const result = await resolveCommune("Marchihue", fakeCatalog(REAL_ROWS));
  assert.deepEqual(result, { status: "resolved", communeId: 164, canonicalName: "Marchigüe", matchedVia: "alias" });
});

test("resolves San Vicente via the San Vicente de Tagua Tagua alias", async () => {
  const result = await resolveCommune("San Vicente", fakeCatalog(REAL_ROWS));
  assert.deepEqual(result, { status: "resolved", communeId: 151, canonicalName: "San Vicente de Tagua Tagua", matchedVia: "alias" });
});

test("a configured alias with no matching catalog entry is not_found, never a guess", async () => {
  const result = await resolveCommune("Llay-Llay", fakeCatalog([]));
  assert.deepEqual(result, { status: "not_found", input: "Llay-Llay" });
});

// --- ambiguous / insufficient (section 4.A, 19.C) ---

test("never auto-resolves bare Santiago, even if the catalog has a matching entry", async () => {
  const catalogWithSantiago = fakeCatalog([...REAL_ROWS, { communeId: 1, canonicalName: "Santiago" }]);
  const result = await resolveCommune("Santiago", catalogWithSantiago);
  assert.deepEqual(result, { status: "needs_clarification", input: "Santiago", reason: "city_or_conurbation_ambiguous" });
});

test("known-ambiguous terms never even query the catalog (hard override, not a fallback)", async () => {
  await resolveCommune("Santiago", throwingCatalog());
  await resolveCommune("Arica y Parinacota", throwingCatalog());
});

// --- invalid geographic level (section 4.B, 19.D) ---

test("never resolves a region name (Arica y Parinacota) to a commune", async () => {
  const result = await resolveCommune("Arica y Parinacota", fakeCatalog(REAL_ROWS));
  assert.deepEqual(result, { status: "needs_clarification", input: "Arica y Parinacota", reason: "region_level_not_commune" });
});

// --- not found (19.E) ---

test("unknown text resolves to not_found", async () => {
  const result = await resolveCommune("asdfgh", fakeCatalog(REAL_ROWS));
  assert.deepEqual(result, { status: "not_found", input: "asdfgh" });
});

// --- invalid input ---

test("empty input is invalid_input, never not_found", async () => {
  const result = await resolveCommune("   ", fakeCatalog(REAL_ROWS));
  assert.deepEqual(result, { status: "invalid_input", input: "   ", reason: "empty" });
});

// --- technical errors never become not_found (19.F) ---

test("a catalog outage surfaces as a typed error, never not_found", async () => {
  const result = await resolveCommune("Ñuñoa", failingCatalog({ ok: false, reason: "unavailable", detail: "connection refused" }));
  assert.deepEqual(result, { status: "error", input: "Ñuñoa", reason: "unavailable", detail: "connection refused" });
});

test("a timeout surfaces as reason=timeout, never not_found", async () => {
  const result = await resolveCommune("Ñuñoa", failingCatalog({ ok: false, reason: "timeout", detail: "query timed out" }));
  assert.equal(result.status, "error");
  assert.equal((result as { reason: string }).reason, "timeout");
});

test("missing configuration surfaces as configuration_unavailable, never not_found", async () => {
  const result = await resolveCommune("Ñuñoa", failingCatalog({ ok: false, reason: "configuration_unavailable", detail: "LOGISTICS_DB_ENABLED is not true" }));
  assert.equal(result.status, "error");
  assert.equal((result as { reason: string }).reason, "configuration_unavailable");
});

// --- catalog is the sole authority (19.G) ---

test("communeId always comes from the catalog port, never fabricated by the resolver", async () => {
  const oddIdCatalog = fakeCatalog([{ communeId: 987654, canonicalName: "Ñuñoa" }]);
  const result = await resolveCommune("Ñuñoa", oddIdCatalog);
  assert.equal(result.status, "resolved");
  assert.equal((result as { communeId: number }).communeId, 987654);
});

test("swapping the catalog changes the resolved id for the same input - no id is hardcoded in the resolver", async () => {
  const catalogA = fakeCatalog([{ communeId: 1, canonicalName: "Ñuñoa" }]);
  const catalogB = fakeCatalog([{ communeId: 2, canonicalName: "Ñuñoa" }]);
  const resultA = await resolveCommune("Ñuñoa", catalogA);
  const resultB = await resolveCommune("Ñuñoa", catalogB);
  assert.equal((resultA as { communeId: number }).communeId, 1);
  assert.equal((resultB as { communeId: number }).communeId, 2);
});

test("more than one catalog entry for the same normalized name fails closed", async () => {
  const duplicateCatalog = fakeCatalog([
    { communeId: 1, canonicalName: "Ñuñoa" },
    { communeId: 2, canonicalName: "Ñuñoa" }
  ]);
  const result = await resolveCommune("Ñuñoa", duplicateCatalog);
  assert.deepEqual(result, { status: "needs_clarification", input: "Ñuñoa", reason: "ambiguous_catalog_match" });
});
