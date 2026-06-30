import { normalizeEmail } from "@/lib/customer-identity/normalize";
import type { CustomerSourceObservation } from "@/lib/customer-identity/types";
import { normalizePlatformOrigin, type PlatformOrigin } from "@/lib/domains/customers/platform-origin";
import type { MasterCustomerRow } from "./types";

export function normalizeMasterCustomerEmail(value: string) {
  return normalizeEmail(value) ?? value.trim().toLowerCase();
}

export function mapMasterCustomerRow(row: MasterCustomerRow) {
  const { platformOrigin, warning } = parseMasterCustomerPlatformOrigin(row.platform_origin);
  return {
    customer: {
      id: String(row.id),
      firstname: row.firstname,
      lastname: row.lastname,
      email: normalizeMasterCustomerEmail(row.email),
      platformOrigin
    },
    warnings: warning ? [warning] : []
  };
}

export function parseMasterCustomerPlatformOrigin(value: string | null | undefined): {
  platformOrigin: PlatformOrigin;
  warning: string | null;
} {
  if (value === null || value === undefined) {
    return { platformOrigin: "unknown", warning: null };
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return { platformOrigin: "unknown", warning: null };
  }

  const platformOrigin = normalizePlatformOrigin(normalized);
  if (platformOrigin !== normalized) {
    return { platformOrigin, warning: `invalid_platform_origin:${normalized}` };
  }

  return { platformOrigin, warning: null };
}

export function mapMasterCustomerObservation(row: MasterCustomerRow, matchedBy: "id" | "email"): CustomerSourceObservation {
  const identityValue = matchedBy === "id" ? String(row.id) : normalizeMasterCustomerEmail(row.email);
  const { platformOrigin } = parseMasterCustomerPlatformOrigin(row.platform_origin);
  return {
    source: "mariadb",
    table: "master_customer",
    sourceRecordId: row.id,
    matchedBy,
    identityType: matchedBy === "id" ? "customer_master_id" : "email",
    identityValue,
    confidence: "high",
    customerKey: `customer_master:${row.id}`,
    notes: ["Canonical master_customer row matched."],
    timelineSeed: null,
    sourceMetadata: {
      platform_origin: platformOrigin
    }
  };
}
