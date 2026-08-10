import { COMMUNE_ALIASES } from "./aliases";
import { KNOWN_AMBIGUOUS_TERMS } from "./knownAmbiguous";
import { comparisonKey, normalizeCommuneText } from "./normalize";
import type { CommuneCatalogPort } from "./ports";
import type { CommuneResolution, CommuneResolver } from "./types";

/**
 * Deterministic resolution pipeline (T13C section 14):
 * validate -> known-ambiguous override -> catalog exact/normalized match ->
 * alias indirection -> not_found. No fuzzy matching, no LLM involvement -
 * communeId always comes from `catalog`, never fabricated here.
 */
export async function resolveCommune(rawInput: string, catalog: CommuneCatalogPort): Promise<CommuneResolution> {
  if (normalizeCommuneText(rawInput).length === 0) {
    return { status: "invalid_input", input: rawInput, reason: "empty" };
  }

  const key = comparisonKey(rawInput);

  // Checked first, as a hard override: a coincidental catalog match must
  // never let "Santiago" or "Arica y Parinacota" slip through as resolved.
  const ambiguousReason = KNOWN_AMBIGUOUS_TERMS.get(key);
  if (ambiguousReason) {
    return { status: "needs_clarification", input: rawInput, reason: ambiguousReason };
  }

  const direct = await catalog.findByNormalizedName(key);
  if (!direct.ok) {
    return { status: "error", input: rawInput, reason: direct.reason, detail: direct.detail };
  }
  if (direct.entries.length === 1) {
    const [entry] = direct.entries;
    return { status: "resolved", communeId: entry.communeId, canonicalName: entry.canonicalName, matchedVia: "direct" };
  }
  if (direct.entries.length > 1) {
    return { status: "needs_clarification", input: rawInput, reason: "ambiguous_catalog_match" };
  }

  const aliasTargetKey = COMMUNE_ALIASES.get(key);
  if (aliasTargetKey) {
    const aliased = await catalog.findByNormalizedName(aliasTargetKey);
    if (!aliased.ok) {
      return { status: "error", input: rawInput, reason: aliased.reason, detail: aliased.detail };
    }
    if (aliased.entries.length === 1) {
      const [entry] = aliased.entries;
      return { status: "resolved", communeId: entry.communeId, canonicalName: entry.canonicalName, matchedVia: "alias" };
    }
    // A configured alias that does not resolve to exactly one catalog entry
    // is a data/config inconsistency, never a reason to guess.
    return { status: "not_found", input: rawInput };
  }

  return { status: "not_found", input: rawInput };
}

export function createCommuneResolver(catalog: CommuneCatalogPort): CommuneResolver {
  return { resolve: (input: string) => resolveCommune(input, catalog) };
}
