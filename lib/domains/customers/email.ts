import { normalizeEmail } from "@/lib/customer-identity/normalize";

const ARTIFICIAL_EMAIL_DOMAINS = new Set(["local.invalid"]);

function extractDomain(value: string) {
  const at = value.lastIndexOf("@");
  if (at < 0) return null;
  return value.slice(at + 1).trim().toLowerCase();
}

export function normalizeCustomerEmail(value: string | number | null | undefined) {
  return normalizeEmail(value);
}

export function isValidCustomerEmail(value: string | null | undefined) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isArtificialCustomerEmail(value: string | null | undefined) {
  if (typeof value !== "string") return false;
  const domain = extractDomain(value);
  if (!domain) return false;
  if (ARTIFICIAL_EMAIL_DOMAINS.has(domain)) return true;
  return domain.endsWith(".invalid");
}

export function isRealCustomerEmail(value: string | null | undefined) {
  return isValidCustomerEmail(value) && !isArtificialCustomerEmail(value);
}
