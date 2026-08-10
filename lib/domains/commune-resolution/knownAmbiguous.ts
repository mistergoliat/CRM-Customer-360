import { comparisonKey } from "./normalize";
import type { CommuneClarificationReason } from "./types";

// Hard policy overrides, checked BEFORE any catalog/alias lookup (T13C section
// 4 and 7) - these never auto-resolve even if the catalog happens to contain
// a coincidentally-matching entry. This is a curated, evidence-based
// blocklist (T13B: "Santiago" matched dozens of different real communes in
// legacy address data; "Arica y Parinacota" is a region, not a commune), not
// a general region/conurbation detector - do not extend it without the same
// kind of evidence.
const KNOWN_AMBIGUOUS_ENTRIES: ReadonlyArray<{ term: string; reason: CommuneClarificationReason }> = [
  { term: "Santiago", reason: "city_or_conurbation_ambiguous" },
  { term: "Arica y Parinacota", reason: "region_level_not_commune" }
];

export const KNOWN_AMBIGUOUS_TERMS: ReadonlyMap<string, CommuneClarificationReason> = new Map(
  KNOWN_AMBIGUOUS_ENTRIES.map(({ term, reason }) => [comparisonKey(term), reason])
);
