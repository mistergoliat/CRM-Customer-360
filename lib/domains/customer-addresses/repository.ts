import { createHash, randomUUID } from "node:crypto";
import type { ResultSetHeader } from "mysql2/promise";
import { safeExecute, safeQueryRows, withTransaction } from "@/lib/db";
import type {
  AddressMutationResult,
  CreateCustomerAddressInput,
  CreateCustomerAddressResult,
  CustomerAddress,
  UpdateCustomerAddressInput
} from "./types";

export const CUSTOMER_ADDRESS_TABLE = "customer_addresses";

type DbLikeRow = Record<string, unknown>;

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asDateTimeIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return asText(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "bigint") return Number(value);
  return null;
}

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return false;
}

function rowToAddress(row: DbLikeRow): CustomerAddress {
  return {
    contractName: "CustomerAddress",
    schemaVersion: "1.0.0",
    addressId: asText(row.address_id) ?? "",
    customerId: asNumber(row.customer_id) ?? 0,
    createdByActionId: asText(row.created_by_action_id),
    addressLabel: asText(row.address_label),
    recipientName: asText(row.recipient_name),
    recipientPhone: asText(row.recipient_phone),
    streetName: asText(row.street_name) ?? "",
    streetNumber: asText(row.street_number) ?? "",
    unit: asText(row.unit),
    commune: asText(row.commune) ?? "",
    city: asText(row.city),
    region: asText(row.region) ?? "",
    postalCode: asText(row.postal_code),
    deliveryNotes: asText(row.delivery_notes),
    isDefault: asBool(row.is_default),
    isActive: asBool(row.is_active),
    createdAt: asDateTimeIso(row.created_at) ?? "",
    updatedAt: asDateTimeIso(row.updated_at) ?? ""
  };
}

export function buildNormalizedAddressHash(input: Pick<CreateCustomerAddressInput, "streetName" | "streetNumber" | "unit" | "commune" | "region">): string {
  const normalized = [input.streetName, input.streetNumber, input.unit ?? "", input.commune, input.region]
    .map((part) => part.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""))
    .join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

export async function getCustomerAddress(addressId: string): Promise<CustomerAddress | null> {
  const result = await safeQueryRows<DbLikeRow>(`SELECT * FROM \`${CUSTOMER_ADDRESS_TABLE}\` WHERE address_id = ? LIMIT 1`, [addressId]);
  if (!result.ok || !result.rows[0]) return null;
  return rowToAddress(result.rows[0]);
}

export async function listCustomerAddresses(customerId: number, options: { includeInactive?: boolean } = {}): Promise<CustomerAddress[]> {
  const activeFilter = options.includeInactive ? "" : " AND is_active = TRUE";
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${CUSTOMER_ADDRESS_TABLE}\` WHERE customer_id = ?${activeFilter} ORDER BY is_default DESC, updated_at DESC`,
    [customerId]
  );
  if (!result.ok) return [];
  return result.rows.map((row) => rowToAddress(row));
}

async function findAddressByActionId(createdByActionId: string): Promise<CustomerAddress | null> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${CUSTOMER_ADDRESS_TABLE}\` WHERE created_by_action_id = ? LIMIT 1`,
    [createdByActionId]
  );
  if (!result.ok || !result.rows[0]) return null;
  return rowToAddress(result.rows[0]);
}

/** Idempotent per agent action: a retry with the same created_by_action_id reuses the row. */
export async function createCustomerAddress(input: CreateCustomerAddressInput): Promise<CreateCustomerAddressResult> {
  if (input.createdByActionId) {
    const existing = await findAddressByActionId(input.createdByActionId);
    if (existing) return { ok: true, status: "duplicate", address: existing };
  }

  const addressId = `addr-${randomUUID()}`;
  const insert = await safeExecute(
    `INSERT ${input.createdByActionId ? "IGNORE " : ""}INTO \`${CUSTOMER_ADDRESS_TABLE}\` (
        address_id, customer_id, created_by_action_id, normalized_address_hash,
        address_label, recipient_name, recipient_phone,
        street_name, street_number, unit, commune, city, region, postal_code, delivery_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      addressId,
      input.customerId,
      input.createdByActionId ?? null,
      buildNormalizedAddressHash(input),
      input.addressLabel ?? null,
      input.recipientName ?? null,
      input.recipientPhone ?? null,
      input.streetName,
      input.streetNumber,
      input.unit ?? null,
      input.commune,
      input.city ?? null,
      input.region,
      input.postalCode ?? null,
      input.deliveryNotes ?? null
    ]
  );

  if (!insert.ok) return { ok: false, status: "error", address: null, warning: insert.error };

  if (insert.affectedRows <= 0 && input.createdByActionId) {
    const concurrent = await findAddressByActionId(input.createdByActionId);
    if (concurrent) return { ok: true, status: "duplicate", address: concurrent };
    return { ok: false, status: "error", address: null, warning: "customer_address_insert_failed" };
  }

  const created = await getCustomerAddress(addressId);
  if (!created) return { ok: false, status: "error", address: null, warning: "customer_address_reload_failed" };
  return { ok: true, status: "created", address: created };
}

/** Ownership + activity gate reused by every per-request operation. */
export async function validateCustomerAddressOwnership(customerId: number, addressId: string): Promise<AddressMutationResult> {
  const address = await getCustomerAddress(addressId);
  if (!address) return { ok: false, status: "not_found", address: null, warning: `Address ${addressId} does not exist.` };
  if (address.customerId !== customerId) {
    return { ok: false, status: "not_owner", address: null, warning: `Address ${addressId} does not belong to customer ${customerId}.` };
  }
  if (!address.isActive) return { ok: false, status: "inactive", address: null, warning: `Address ${addressId} is inactive.` };
  return { ok: true, address };
}

export async function updateCustomerAddress(customerId: number, addressId: string, patch: UpdateCustomerAddressInput): Promise<AddressMutationResult> {
  const owned = await validateCustomerAddressOwnership(customerId, addressId);
  if (!owned.ok) return owned;

  const fields: string[] = [];
  const params: unknown[] = [];
  const columnByKey: Record<string, string> = {
    addressLabel: "address_label",
    recipientName: "recipient_name",
    recipientPhone: "recipient_phone",
    streetName: "street_name",
    streetNumber: "street_number",
    unit: "unit",
    commune: "commune",
    city: "city",
    region: "region",
    postalCode: "postal_code",
    deliveryNotes: "delivery_notes"
  };
  for (const [key, column] of Object.entries(columnByKey)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value !== undefined) {
      fields.push(`${column} = ?`);
      params.push(value);
    }
  }
  if (fields.length === 0) return { ok: true, address: owned.address };

  const merged = { ...owned.address, ...patch };
  fields.push("normalized_address_hash = ?");
  params.push(
    buildNormalizedAddressHash({
      streetName: merged.streetName ?? owned.address.streetName,
      streetNumber: merged.streetNumber ?? owned.address.streetNumber,
      unit: merged.unit ?? owned.address.unit,
      commune: merged.commune ?? owned.address.commune,
      region: merged.region ?? owned.address.region
    })
  );

  const update = await safeExecute(
    `UPDATE \`${CUSTOMER_ADDRESS_TABLE}\` SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP(3) WHERE address_id = ?`,
    [...params, addressId]
  );
  if (!update.ok) return { ok: false, status: "error", address: null, warning: update.error };

  const reloaded = await getCustomerAddress(addressId);
  if (!reloaded) return { ok: false, status: "error", address: null, warning: "customer_address_reload_failed" };
  return { ok: true, address: reloaded };
}

export async function deactivateCustomerAddress(customerId: number, addressId: string): Promise<AddressMutationResult> {
  const owned = await validateCustomerAddressOwnership(customerId, addressId);
  if (!owned.ok) return owned;

  const update = await safeExecute(
    `UPDATE \`${CUSTOMER_ADDRESS_TABLE}\` SET is_active = FALSE, is_default = FALSE, updated_at = CURRENT_TIMESTAMP(3) WHERE address_id = ?`,
    [addressId]
  );
  if (!update.ok) return { ok: false, status: "error", address: null, warning: update.error };

  const reloaded = await getCustomerAddress(addressId);
  return reloaded ? { ok: true, address: reloaded } : { ok: false, status: "error", address: null, warning: "customer_address_reload_failed" };
}

/**
 * Transactional exclusivity: validates ownership, unmarks every default the
 * customer had, then marks the target. is_default only ever SUGGESTS an
 * address - it never authorizes its use for a request.
 */
export async function setDefaultCustomerAddress(customerId: number, addressId: string): Promise<AddressMutationResult> {
  const owned = await validateCustomerAddressOwnership(customerId, addressId);
  if (!owned.ok) return owned;

  try {
    await withTransaction(async (connection) => {
      await connection.execute<ResultSetHeader>(
        `UPDATE \`${CUSTOMER_ADDRESS_TABLE}\` SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP(3) WHERE customer_id = ? AND is_default = TRUE`,
        [customerId]
      );
      await connection.execute<ResultSetHeader>(
        `UPDATE \`${CUSTOMER_ADDRESS_TABLE}\` SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP(3) WHERE address_id = ? AND customer_id = ?`,
        [addressId, customerId]
      );
    });
  } catch (error) {
    return { ok: false, status: "error", address: null, warning: error instanceof Error ? error.message : String(error) };
  }

  const reloaded = await getCustomerAddress(addressId);
  return reloaded ? { ok: true, address: reloaded } : { ok: false, status: "error", address: null, warning: "customer_address_reload_failed" };
}
