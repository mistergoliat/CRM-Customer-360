import { getColumns, safeQueryRows } from "@/lib/db";

// Read-only candidate discovery over the ps_customer/ps_orders mirror tables
// reachable through the same MariaDB pool as customer_external_identity (see
// database/fixtures/legacy-n8n-schema.sql for the schema this targets: no
// separate PrestaShop connection exists anywhere in this codebase). These
// tables are optional in a given environment - a missing table is evidence
// unavailable, not a technical failure (getColumns already returns [] for
// both "table doesn't exist" and "DESCRIBE failed", so this module cannot
// tell those apart and deliberately treats both as "no evidence" rather than
// SYSTEM_FAILURE; a real connectivity outage is already caught upstream by
// the wa_id/phone lookups against customer_external_identity, which always
// run first). Static columns only, validated against the real fixture - no
// dynamic getColumns-driven SQL building like the legacy resolver.
//
// ID-R2-A02: adapted from lib/customer-identity/sourceReaders.ts
// (readPrestashopCustomerCandidate/readPrestashopOrderCandidate) as narrow,
// purpose-built readers - never imports the legacy module itself.

const CUSTOMER_TABLE = "ps_customer";
const ORDERS_TABLE = "ps_orders";
const ORDER_REFERENCE_COLUMNS = ["id_order", "reference", "order_reference", "invoice_number"];

export type PrestashopCandidateLookup =
  | { ok: true; tableAvailable: boolean; prestashopCustomerIds: string[] }
  | { ok: false; error: string };

function asPrestashopId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function distinctIds(rows: { id_customer: unknown }[]): string[] {
  const ids = rows.map((row) => asPrestashopId(row.id_customer)).filter((id): id is string => id !== null);
  return Array.from(new Set(ids));
}

/** Candidate discovery only - a match here is not proof the interlocutor controls the account. */
export async function findPrestashopCustomerIdsByEmail(normalizedEmail: string): Promise<PrestashopCandidateLookup> {
  const columns = await getColumns(CUSTOMER_TABLE);
  if (columns.length === 0) return { ok: true, tableAvailable: false, prestashopCustomerIds: [] };

  const result = await safeQueryRows<{ id_customer: unknown }>(
    `SELECT DISTINCT id_customer FROM \`${CUSTOMER_TABLE}\` WHERE LOWER(email) = ? AND id_customer IS NOT NULL`,
    [normalizedEmail]
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, tableAvailable: true, prestashopCustomerIds: distinctIds(result.rows) };
}

/** Transactional evidence only - ownership is not validated here (ID-R2-A04). */
export async function findPrestashopCustomerIdsByOrderReference(orderReference: string): Promise<PrestashopCandidateLookup> {
  const columns = await getColumns(ORDERS_TABLE);
  if (columns.length === 0) return { ok: true, tableAvailable: false, prestashopCustomerIds: [] };

  const matchableColumns = ORDER_REFERENCE_COLUMNS.filter((column) => columns.includes(column));
  if (matchableColumns.length === 0) return { ok: true, tableAvailable: false, prestashopCustomerIds: [] };

  const clause = matchableColumns.map((column) => `\`${column}\` = ?`).join(" OR ");
  const result = await safeQueryRows<{ id_customer: unknown }>(
    `SELECT DISTINCT id_customer FROM \`${ORDERS_TABLE}\` WHERE (${clause}) AND id_customer IS NOT NULL`,
    matchableColumns.map(() => orderReference)
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, tableAvailable: true, prestashopCustomerIds: distinctIds(result.rows) };
}
