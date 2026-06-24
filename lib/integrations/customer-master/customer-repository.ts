import { hasTable, queryRows, safeQueryRows } from "@/lib/db";
import { isDbWriteEnabled } from "@/lib/write-access";
import { normalizeMasterCustomerEmail, parseMasterCustomerPlatformOrigin } from "./mappers";
import type { MasterCustomerCreateInput, MasterCustomerListQuery, MasterCustomerRow } from "./types";

export type CustomerMasterRepositoryResult<T> = {
  ok: true;
  data: T;
  warnings: string[];
} | {
  ok: false;
  error: string;
  warnings: string[];
};

export async function listMasterCustomers(input: MasterCustomerListQuery): Promise<CustomerMasterRepositoryResult<{ items: MasterCustomerRow[]; total: number; page: number; pageSize: number }>> {
  const pageSize = Math.max(1, Math.min(Number(input.pageSize ?? 25), 100));
  const page = Math.max(1, Number(input.page ?? 1));
  const offset = (page - 1) * pageSize;
  const search = input.search?.trim() ?? "";
  const where: string[] = [];
  const params: unknown[] = [];

  if (search) {
    const term = `%${search.toLowerCase()}%`;
    where.push("(LOWER(firstname) LIKE ? OR LOWER(lastname) LIKE ? OR LOWER(email) LIKE ?)");
    params.push(term, term, term);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const countResult = await safeQueryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM master_customer ${whereSql}`, params);
  const rowsResult = await safeQueryRows<MasterCustomerRow>(
    `SELECT id, firstname, lastname, email, platform_origin FROM master_customer ${whereSql} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  if (!rowsResult.ok) {
    return { ok: false, error: rowsResult.error, warnings: [] };
  }

  return {
    ok: true,
    data: {
      items: rowsResult.rows,
      total: countResult.ok ? Number(countResult.rows[0]?.total ?? 0) : rowsResult.rows.length,
      page,
      pageSize
    },
    warnings: countResult.ok ? [] : [countResult.error]
  };
}

export async function getMasterCustomerById(id: string): Promise<CustomerMasterRepositoryResult<MasterCustomerRow | null>> {
  const rows = await safeQueryRows<MasterCustomerRow>("SELECT id, firstname, lastname, email, platform_origin FROM master_customer WHERE id = ? LIMIT 1", [id]);
  if (!rows.ok) {
    return { ok: false, error: rows.error, warnings: [] };
  }
  const row = rows.rows[0] ?? null;
  const platformOriginResult = row ? parseMasterCustomerPlatformOrigin(row.platform_origin) : null;
  const warnings = platformOriginResult?.warning ? [platformOriginResult.warning] : [];
  return { ok: true, data: row, warnings };
}

export async function findMasterCustomerByEmail(email: string): Promise<CustomerMasterRepositoryResult<MasterCustomerRow | null>> {
  const normalized = normalizeMasterCustomerEmail(email);
  const rows = await safeQueryRows<MasterCustomerRow>(
    "SELECT id, firstname, lastname, email, platform_origin FROM master_customer WHERE LOWER(TRIM(email)) = ? LIMIT 1",
    [normalized]
  );
  if (!rows.ok) {
    return { ok: false, error: rows.error, warnings: [] };
  }
  const row = rows.rows[0] ?? null;
  const platformOriginResult = row ? parseMasterCustomerPlatformOrigin(row.platform_origin) : null;
  const warnings = platformOriginResult?.warning ? [platformOriginResult.warning] : [];
  return { ok: true, data: row, warnings };
}

export async function createMasterCustomer(input: MasterCustomerCreateInput): Promise<CustomerMasterRepositoryResult<MasterCustomerRow>> {
  const writeEnabled = isDbWriteEnabled();
  if (!writeEnabled) {
    return { ok: false, error: "DB_WRITE_DISABLED", warnings: [] };
  }

  const hasMasterTable = await hasTable("master_customer");
  if (!hasMasterTable) {
    return { ok: false, error: "master_customer_unavailable", warnings: [] };
  }

  const email = normalizeMasterCustomerEmail(input.email);
  const duplicate = await findMasterCustomerByEmail(email);
  if (!duplicate.ok) {
    return duplicate;
  }
  if (duplicate.data) {
    return { ok: false, error: "customer_email_duplicate", warnings: [] };
  }

  try {
    await queryRows(
      "INSERT INTO master_customer (firstname, lastname, email, platform_origin) VALUES (?, ?, ?, ?)",
      [input.firstname.trim(), input.lastname.trim(), email, input.platformOrigin]
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("duplicate")) {
      return { ok: false, error: "customer_email_duplicate", warnings: [] };
    }
    return { ok: false, error: "customer_create_failed", warnings: [] };
  }

  const created = await findMasterCustomerByEmail(email);
  if (!created.ok || !created.data) {
    return { ok: false, error: "customer_create_failed", warnings: [] };
  }

  return { ok: true, data: created.data, warnings: created.warnings };
}
