import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { resolveNamedDatabaseConnection } from "./database-config";

type QueryResult<T> =
  | { ok: true; rows: T[]; warning?: string }
  | { ok: false; rows: T[]; error: string };

let pool: Pool | null = null;
const columnCache = new Map<string, string[]>();

export type DbRow = Record<string, unknown>;

export function getPool() {
  if (!pool) {
    const connection = resolveNamedDatabaseConnection("app");
    if (connection.url) {
      pool = mysql.createPool(connection.url);
    } else {
      throw new Error("DATABASE_URL o variables DATABASE_* no configuradas");
    }
  }

  return pool;
}

export async function withConnection<T>(fn: (connection: PoolConnection) => Promise<T>) {
  const connection = await getPool().getConnection();
  try {
    return await fn(connection);
  } finally {
    connection.release();
  }
}

export async function queryRows<T = DbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await getPool().execute<RowDataPacket[]>(sql, params as Parameters<Pool["execute"]>[1]);
  return rows as T[];
}

export async function safeQueryRows<T = DbRow>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
  try {
    const rows = await queryRows<T>(sql, params);
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, rows: [], error: sanitizeDbError(error) };
  }
}

export async function safeScalar(sql: string, params: unknown[] = []) {
  const result = await safeQueryRows(sql, params);
  if (!result.ok) return { ok: false as const, value: 0, error: result.error };
  const first = result.rows[0] ?? {};
  const value = Object.values(first)[0] ?? 0;
  return { ok: true as const, value };
}

export async function getColumns(tableName: string): Promise<string[]> {
  if (columnCache.has(tableName)) return columnCache.get(tableName)!;

  try {
    const rows = await queryRows<{ Field: string }>(`DESCRIBE \`${tableName}\``);
    const columns = rows.map((row) => row.Field);
    columnCache.set(tableName, columns);
    return columns;
  } catch {
    columnCache.set(tableName, []);
    return [];
  }
}

export async function hasTable(tableName: string) {
  const columns = await getColumns(tableName);
  return columns.length > 0;
}

export async function pickExistingColumns(tableName: string, candidates: string[]) {
  const columns = await getColumns(tableName);
  const set = new Set(columns);
  return candidates.filter((candidate) => set.has(candidate));
}

export function hasColumn(columns: string[], candidate: string) {
  return columns.includes(candidate);
}

export function chileNowSql() {
  return "CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00')";
}

export async function updateExistingColumns(
  tableName: string,
  whereColumnCandidates: string[],
  whereValue: unknown,
  values: Record<string, unknown>
) {
  const columns = await getColumns(tableName);
  const whereColumn = whereColumnCandidates.find((candidate) => columns.includes(candidate));
  if (!whereColumn) return { ok: false as const, warning: `Sin columna WHERE compatible en ${tableName}` };

  const assignments: string[] = [];
  const params: unknown[] = [];

  for (const [column, value] of Object.entries(values)) {
    if (!columns.includes(column)) continue;
    if (value === "__CHILE_NOW__") {
      assignments.push(`\`${column}\` = ${chileNowSql()}`);
    } else {
      assignments.push(`\`${column}\` = ?`);
      params.push(value);
    }
  }

  if (assignments.length === 0) {
    return { ok: false as const, warning: `Sin columnas actualizables en ${tableName}` };
  }

  params.push(whereValue);
  await queryRows(`UPDATE \`${tableName}\` SET ${assignments.join(", ")} WHERE \`${whereColumn}\` = ?`, params);
  return { ok: true as const, updatedColumns: assignments.length };
}

export async function insertExistingColumns(tableName: string, values: Record<string, unknown>, requiredAny: string[] = []) {
  const columns = await getColumns(tableName);
  if (columns.length === 0) return { ok: false as const, warning: `Tabla ${tableName} no disponible` };

  if (requiredAny.length > 0 && !requiredAny.some((column) => columns.includes(column))) {
    return { ok: false as const, warning: `Tabla ${tableName} no contiene columnas mínimas requeridas` };
  }

  const insertColumns: string[] = [];
  const placeholders: string[] = [];
  const params: unknown[] = [];

  for (const [column, value] of Object.entries(values)) {
    if (!columns.includes(column)) continue;
    insertColumns.push(`\`${column}\``);
    if (value === "__CHILE_NOW__") {
      placeholders.push(chileNowSql());
    } else {
      placeholders.push("?");
      params.push(value);
    }
  }

  if (insertColumns.length === 0) {
    return { ok: false as const, warning: `Sin columnas insertables en ${tableName}` };
  }

  await queryRows(`INSERT INTO \`${tableName}\` (${insertColumns.join(", ")}) VALUES (${placeholders.join(", ")})`, params);
  return { ok: true as const, insertedColumns: insertColumns.length };
}

export function sanitizeDbError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/mysql:\/\/[^@\s]+@/gi, "mysql://<redacted>@")
    .replace(/password=[^&\s]+/gi, "password=<redacted>");
}
