import { queryRows, safeQueryRows } from "@/lib/db";
import type { CustomerExternalIdentityInput, CustomerExternalIdentityRow } from "./types";

const TABLE = "customer_external_identity";

function asText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toRow(row: Record<string, unknown>): CustomerExternalIdentityRow {
  return {
    id: asNumber(row.id) ?? 0,
    customer_id: asNumber(row.customer_id) ?? 0,
    provider: asText(row.provider) ?? "",
    identity_type: asText(row.identity_type) ?? "",
    external_id: asText(row.external_id) ?? "",
    normalized_value: asText(row.normalized_value) ?? "",
    is_verified: row.is_verified as number | string,
    created_at: asText(row.created_at) ?? "",
    updated_at: asText(row.updated_at) ?? ""
  };
}

export async function findExternalIdentityByProviderExternalId(provider: string, externalId: string) {
  const rows = await safeQueryRows<Record<string, unknown>>(
    `SELECT * FROM \`${TABLE}\` WHERE provider = ? AND external_id = ? LIMIT 1`,
    [provider, externalId]
  );
  if (!rows.ok) return { ok: false as const, error: rows.error, row: null as CustomerExternalIdentityRow | null };
  return { ok: true as const, error: null, row: rows.rows[0] ? toRow(rows.rows[0]) : null };
}

export async function findDistinctCustomersByNormalizedValue(provider: string, normalizedValue: string) {
  const rows = await safeQueryRows<{ customer_id: number }>(
    `SELECT DISTINCT customer_id FROM \`${TABLE}\` WHERE provider = ? AND normalized_value = ?`,
    [provider, normalizedValue]
  );
  if (!rows.ok) return { ok: false as const, error: rows.error, customerIds: [] as number[] };
  const customerIds = rows.rows
    .map((row) => asNumber(row.customer_id))
    .filter((id): id is number => id !== null);
  return { ok: true as const, error: null, customerIds };
}

/**
 * Provider-agnostic phone lookup: a customer's phone can be on file through
 * any channel (whatsapp, hub_operator, import, ...), not only the one the
 * current inbound arrived on. Used to recognize historical customers who
 * message from a wa_id that was never linked before.
 */
export async function findDistinctCustomersByNormalizedValueAcrossProviders(normalizedValue: string) {
  const rows = await safeQueryRows<{ customer_id: number }>(
    `SELECT DISTINCT customer_id FROM \`${TABLE}\` WHERE normalized_value = ?`,
    [normalizedValue]
  );
  if (!rows.ok) return { ok: false as const, error: rows.error, customerIds: [] as number[] };
  const customerIds = rows.rows
    .map((row) => asNumber(row.customer_id))
    .filter((id): id is number => id !== null);
  return { ok: true as const, error: null, customerIds };
}

export async function findExternalIdentityByNormalizedValue(provider: string, normalizedValue: string) {
  const rows = await safeQueryRows<Record<string, unknown>>(
    `SELECT * FROM \`${TABLE}\` WHERE provider = ? AND normalized_value = ? ORDER BY is_verified DESC, updated_at DESC LIMIT 1`,
    [provider, normalizedValue]
  );
  if (!rows.ok) return { ok: false as const, error: rows.error, row: null as CustomerExternalIdentityRow | null };
  return { ok: true as const, error: null, row: rows.rows[0] ? toRow(rows.rows[0]) : null };
}

export async function upsertExternalIdentity(input: CustomerExternalIdentityInput) {
  await queryRows(
    `
      INSERT INTO \`${TABLE}\` (
        customer_id,
        provider,
        identity_type,
        external_id,
        normalized_value,
        is_verified,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE
        customer_id = VALUES(customer_id),
        identity_type = VALUES(identity_type),
        normalized_value = VALUES(normalized_value),
        is_verified = VALUES(is_verified),
        updated_at = VALUES(updated_at)
    `,
    [
      input.customerId,
      input.provider,
      input.identityType,
      input.externalId,
      input.normalizedValue,
      input.isVerified ? 1 : 0
    ]
  );

  const loaded = await findExternalIdentityByProviderExternalId(input.provider, input.externalId);
  return loaded;
}
