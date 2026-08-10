import { comparisonKey } from "./normalize";

// Explicit, evidence-based aliases only (T13B section 3 / T13C section 3 and
// 12) - confirmed against real historical ps_address.city data, not guessed.
// Each alias maps to a canonical LOOKUP TEXT, never to a hardcoded
// id_comuna: the catalog (pc_pos.comuna) stays the sole authority for the id.
// Do not add an alias here without the same kind of evidence - this is a
// curated list, not a place to grow ad-hoc fuzzy coverage.
const ALIAS_ENTRIES: ReadonlyArray<{ from: string; canonicalLookupText: string }> = [
  { from: "LLAY-LLAY", canonicalLookupText: "Llaillay" },
  { from: "MARCHIHUE", canonicalLookupText: "Marchigüe" },
  { from: "SAN VICENTE", canonicalLookupText: "San Vicente de Tagua Tagua" }
];

/** normalized alias key -> normalized canonical lookup key. Both sides run through the same comparisonKey() used for catalog matching. */
export const COMMUNE_ALIASES: ReadonlyMap<string, string> = new Map(
  ALIAS_ENTRIES.map(({ from, canonicalLookupText }) => [comparisonKey(from), comparisonKey(canonicalLookupText)])
);
