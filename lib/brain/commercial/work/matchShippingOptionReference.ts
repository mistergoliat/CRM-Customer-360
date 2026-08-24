/**
 * SALES-AGENT-R2-A11.4. Deterministic, no LLM call - resolves a customer's
 * raw shipping-option reference ("la segunda" / "Chilexpress" / "la mas
 * barata") against the real options[] a calculate_shipping execution
 * returned this conversation. Never invents an option: every returned index
 * is a real position in the input array, and an unresolved/ambiguous
 * reference is reported as such rather than guessed.
 *
 * The matchKind on a resolved result is not cosmetic - buildCommercialWorkProjection.ts's
 * applyObjectiveState uses it to decide whether the match is safe to trust
 * after a recalculation (position-based references only mean something
 * relative to the exact list they were given against; carrier/cheapest
 * references resolve by what the option IS, so they stay valid across a
 * refresh).
 */

export type ShippingOptionCandidate = {
  index: number;
  carrierName: string;
  serviceType: string;
  totalCost: number;
  estimatedDelivery: string;
};

export type ShippingOptionMatchResult =
  | { status: "resolved"; index: number; matchKind: "position" | "carrier" | "cheapest" }
  | { status: "ambiguous"; candidates: ShippingOptionCandidate[] }
  | { status: "missing" };

/** Diacritic combining marks (Unicode block 0x0300-0x036F) stripped by code point, matching requirementResolver.ts's convention - keeps this ASCII-only source file free of embedded combining characters. */
const COMBINING_MARK_RANGE_START = 0x0300;
const COMBINING_MARK_RANGE_END = 0x036f;

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code < COMBINING_MARK_RANGE_START || code > COMBINING_MARK_RANGE_END;
    })
    .join("")
    .toLowerCase()
    .trim();
}

const ORDINAL_WORDS: Record<string, number> = {
  primera: 0,
  primero: 0,
  segunda: 1,
  segundo: 1,
  tercera: 2,
  tercero: 2,
  cuarta: 3,
  cuarto: 3,
  quinta: 4,
  quinto: 4
};

/** Matches "opcion 2" / "numero 2" / "la 2" (1-indexed in customer language) -> index 1. */
const NUMBERED_REFERENCE_PATTERN = /\b(?:opcion|numero|la|el)\s*(\d+)\b/;

function matchPosition(normalizedRef: string): number | null {
  for (const [word, index] of Object.entries(ORDINAL_WORDS)) {
    if (normalizedRef.includes(word)) return index;
  }
  const numbered = normalizedRef.match(NUMBERED_REFERENCE_PATTERN);
  if (numbered) {
    const value = Number.parseInt(numbered[1], 10);
    if (Number.isInteger(value) && value >= 1) return value - 1;
  }
  return null;
}

const CHEAPEST_KEYWORDS = ["mas barata", "mas economica", "la barata", "el mas barato", "lo mas barato", "mas barato"];

function isCheapestReference(normalizedRef: string): boolean {
  return CHEAPEST_KEYWORDS.some((keyword) => normalizedRef.includes(keyword));
}

function matchCarrier(normalizedRef: string, options: readonly ShippingOptionCandidate[]): ShippingOptionCandidate[] {
  const byCarrier = options.filter((option) => {
    const carrier = normalizeText(option.carrierName);
    return carrier.length > 0 && (normalizedRef.includes(carrier) || carrier.includes(normalizedRef));
  });
  if (byCarrier.length <= 1) return byCarrier;
  // Narrow further by any serviceType words also present in the reference
  // text (e.g. "Chilexpress Express" vs "Chilexpress Normal") before
  // declaring ambiguous. Whole-token comparison, never substring - a bare
  // carrier name can itself contain a service-type word as a substring
  // (e.g. "Chilexpress" contains "express"), which would otherwise falsely
  // narrow to one option when the customer never named a service level at
  // all.
  const refTokens = normalizedRef.split(/\s+/).filter(Boolean);
  const byService = byCarrier.filter((option) => {
    const serviceTokens = normalizeText(option.serviceType).split(/\s+/).filter(Boolean);
    return serviceTokens.length > 0 && serviceTokens.every((token) => refTokens.includes(token));
  });
  return byService.length > 0 ? byService : byCarrier;
}

export function matchShippingOptionReference(reference: string | undefined, options: readonly ShippingOptionCandidate[]): ShippingOptionMatchResult {
  if (!reference || options.length === 0) return { status: "missing" };
  const normalizedRef = normalizeText(reference);
  if (!normalizedRef) return { status: "missing" };

  if (isCheapestReference(normalizedRef)) {
    const cheapest = options.reduce((min, option) => (option.totalCost < min.totalCost ? option : min), options[0]);
    return { status: "resolved", index: cheapest.index, matchKind: "cheapest" };
  }

  const carrierMatches = matchCarrier(normalizedRef, options);
  if (carrierMatches.length === 1) return { status: "resolved", index: carrierMatches[0].index, matchKind: "carrier" };
  if (carrierMatches.length > 1) return { status: "ambiguous", candidates: carrierMatches };

  const position = matchPosition(normalizedRef);
  if (position !== null) {
    const option = options.find((item) => item.index === position);
    return option ? { status: "resolved", index: option.index, matchKind: "position" } : { status: "missing" };
  }

  return { status: "missing" };
}
