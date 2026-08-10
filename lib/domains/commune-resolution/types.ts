// Canonical commune resolution (CRM-R1-T13C). See docs/audits/CRM-R1-T13B-*
// for the evidence this is built on: `pc_pos.comuna` is the canonical
// logistics commune catalog - CRM does not own it, only reads it.

export type CommuneCatalogEntry = {
  communeId: number;
  canonicalName: string;
};

export type CommuneCatalogFailureReason = "unavailable" | "timeout" | "malformed_response" | "configuration_unavailable";

export type CommuneCatalogLookupResult =
  | { ok: true; entries: CommuneCatalogEntry[] }
  | { ok: false; reason: CommuneCatalogFailureReason; detail: string };

export type CommuneResolutionMatchedVia = "direct" | "alias";

export type CommuneClarificationReason =
  // "Santiago" alone matched dozens of different real communes in legacy
  // address data (T13B, section 8.E) - never a single one, so it is never
  // resolved automatically, regardless of what the catalog happens to contain.
  | "city_or_conurbation_ambiguous"
  // "Arica y Parinacota" is a region name, not a commune - resolving it to
  // any single commune would be inventing a destination.
  | "region_level_not_commune"
  // Defensive: the catalog itself returned more than one entry for the same
  // normalized name. Never seen in real pc_pos.comuna data (346 distinct
  // names after normalization), but resolution must not guess if it happens.
  | "ambiguous_catalog_match";

export type CommuneResolution =
  | { status: "resolved"; communeId: number; canonicalName: string; matchedVia: CommuneResolutionMatchedVia }
  | { status: "needs_clarification"; input: string; reason: CommuneClarificationReason }
  | { status: "not_found"; input: string }
  | { status: "invalid_input"; input: string; reason: "empty" }
  | { status: "error"; input: string; reason: CommuneCatalogFailureReason; detail: string };

/** Public boundary a caller (agent loop, capability, etc.) resolves communes through. Never exposes SQL, pc_pos, or credentials. */
export interface CommuneResolver {
  resolve(input: string): Promise<CommuneResolution>;
}
