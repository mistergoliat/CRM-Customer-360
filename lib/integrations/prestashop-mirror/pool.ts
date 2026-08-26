import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { getColumns as getSharedColumns, safeQueryRows as safeQueryRowsShared, sanitizeDbError } from "@/lib/db";
import { readPrestashopDbConfig, type PrestashopDbConfig } from "./config";

export type SafeQueryResult<T> = { ok: true; rows: T[] } | { ok: false; rows: T[]; error: string };

export type PrestashopQueryExecutor = {
  getColumns(tableName: string): Promise<string[]>;
  safeQueryRows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SafeQueryResult<T>>;
};

type ProductionDbConfig = Extract<PrestashopDbConfig, { source: "production_db" }>;

// Own pool, own connection surface, never the app's main DATABASE_* pool -
// same isolation as lib/integrations/logistics/pool.ts. Small
// connectionLimit: identity candidate lookups are occasional reads, not a
// high-throughput path.
let dedicatedPool: Pool | null = null;
const dedicatedColumnCache = new Map<string, string[]>();

function getDedicatedPool(config: ProductionDbConfig): Pool {
  if (!dedicatedPool) {
    dedicatedPool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: 3,
      timezone: "Z"
    });
  }
  return dedicatedPool;
}

function createDedicatedExecutor(config: ProductionDbConfig): PrestashopQueryExecutor {
  const pool = getDedicatedPool(config);
  return {
    async getColumns(tableName) {
      if (dedicatedColumnCache.has(tableName)) return dedicatedColumnCache.get(tableName)!;
      try {
        const [rows] = await pool.query<RowDataPacket[]>(`DESCRIBE \`${tableName}\``);
        const columns = rows.map((row) => row.Field as string);
        dedicatedColumnCache.set(tableName, columns);
        return columns;
      } catch {
        dedicatedColumnCache.set(tableName, []);
        return [];
      }
    },
    async safeQueryRows<T>(sql: string, params: unknown[] = []) {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(sql, params as Parameters<Pool["execute"]>[1]);
        return { ok: true as const, rows: rows as T[] };
      } catch (error) {
        return { ok: false as const, rows: [] as T[], error: sanitizeDbError(error) };
      }
    }
  };
}

const localMirrorExecutor: PrestashopQueryExecutor = {
  getColumns: getSharedColumns,
  safeQueryRows: safeQueryRowsShared
};

/**
 * Resolves which physical connection backs PrestaShop identity reads
 * (ID-R2-A11.1). Throws PrestashopDbConfigurationError when
 * PRESTASHOP_IDENTITY_SOURCE=production_db is set but incomplete/invalid -
 * callers must treat that as a technical failure, never as "customer not
 * found".
 */
export function getPrestashopQueryExecutor(): PrestashopQueryExecutor {
  const config = readPrestashopDbConfig();
  return config.source === "production_db" ? createDedicatedExecutor(config) : localMirrorExecutor;
}

/** Test-only: forces the next production_db call to open a fresh pool and clears its column cache. */
export async function resetPrestashopPoolForTests() {
  const current = dedicatedPool;
  dedicatedPool = null;
  dedicatedColumnCache.clear();
  if (current) {
    try {
      await current.end();
    } catch {
      // ignore teardown failures - the pool is being discarded either way
    }
  }
}
