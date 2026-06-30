import { createHash } from "node:crypto";
import { extractEmailCandidates, isExplicitCustomerConfirmation, getCustomerOnboardingDisplayName } from "@/lib/brain/commercial/customer-onboarding/context";

export { extractEmailCandidates, isExplicitCustomerConfirmation, getCustomerOnboardingDisplayName };

export function normalizeIso(value: string | Date | null | undefined) {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function stableLocalId(parts: Array<string | number | null | undefined>) {
  const hash = createHash("sha256");
  hash.update(parts.map((part) => (part === null || part === undefined ? "" : String(part))).join("|"));
  return hash.digest("hex").slice(0, 24);
}

export function localPublicId(prefix: string, parts: Array<string | number | null | undefined>) {
  return `${prefix}-${stableLocalId(parts)}`;
}

export function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function parseJsonArray<T = string>(value: unknown): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function pickText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}
