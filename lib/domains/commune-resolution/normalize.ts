// Deterministic normalization only - no fuzzy matching (T13C section 13).

// ASCII hyphen-minus plus the common Unicode dash variants (hyphen, non-breaking
// hyphen, figure dash, en dash, em dash, horizontal bar): U+002D, U+2010-U+2015.
const DASH_VARIANTS = /[-‐-―]+/g;
// Combining diacritical marks left behind by NFD decomposition (e.g. the tilde
// in "Ñ" after "Ñ" is decomposed) - same range already used by
// lib/domains/customer-addresses/repository.ts#buildNormalizedAddressHash.
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Trims, collapses dash variants to spaces, collapses whitespace. Preserves case and accents - safe to use for a display value. */
export function normalizeCommuneText(raw: string): string {
  return raw
    .normalize("NFC")
    .trim()
    .replace(DASH_VARIANTS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Comparison-only key: lowercase, accent-folded. Never use this as a display value - canonicalName always comes from the catalog. */
export function comparisonKey(raw: string): string {
  return normalizeCommuneText(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/\s+/g, " ")
    .trim();
}
