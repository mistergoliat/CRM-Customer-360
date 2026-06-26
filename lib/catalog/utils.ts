import type {
  CatalogConfidence,
  CatalogFreshness,
  CatalogSource,
  Provenance,
  UnknownCatalogValue
} from "./types";

export const CATALOG_FRESHNESS_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 30;

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string) {
  return [...new Set(
    normalizeText(value)
      .split(/[^a-z0-9]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
  )];
}

export function stableId(parts: string[]) {
  let hash = 0;
  const value = parts.join("|");
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function parseIsoDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function freshnessFor(retrievedAt: string, effectiveAt: string): CatalogFreshness {
  const retrieved = parseIsoDate(retrievedAt);
  const effective = parseIsoDate(effectiveAt);
  if (!retrieved || !effective) return "unknown";
  return effective.getTime() - retrieved.getTime() > CATALOG_FRESHNESS_THRESHOLD_MS ? "stale" : "fresh";
}

export function makeProvenance(input: {
  source: CatalogSource | string;
  retrievedAt: string;
  freshness?: CatalogFreshness;
  confidence?: CatalogConfidence;
  tenant?: string | null;
  shop?: string | null;
  locale?: string | null;
  currency?: string | null;
}): Provenance {
  return {
    source: input.source,
    retrievedAt: input.retrievedAt,
    freshness: input.freshness ?? "unknown",
    confidence: input.confidence ?? "unknown",
    tenant: input.tenant ?? null,
    shop: input.shop ?? null,
    locale: input.locale ?? null,
    currency: input.currency ?? null
  };
}

export function makeUnknownCatalogValue(reason: string, provenance: Provenance): UnknownCatalogValue {
  return {
    kind: "unknown",
    reason,
    provenance
  };
}

export function isUnknownCatalogValue(value: unknown): value is UnknownCatalogValue {
  return Boolean(value && typeof value === "object" && (value as { kind?: string }).kind === "unknown");
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

