import mysql, { type Pool } from "mysql2/promise";
import { readLogisticsDbConfig } from "./config";
import type { LogisticsQueryExecutor } from "./queryExecutor";

// Module-level singleton, same shape as lib/db.ts#getPool - but its own pool,
// on its own connection surface, never the app's main DATABASE_* pool
// (T13C section 9). Never created at import time: only the first real call
// to getLogisticsQueryExecutor() (itself only called from within
// pc-pos-adapter.ts#findByNormalizedName) can create it.
let pool: Pool | null = null;

function getPool(host: string, port: number, user: string, password: string, database: string): Pool {
  if (!pool) {
    // connectionLimit kept small: this is a small reference table read
    // occasionally, not a high-throughput path.
    pool = mysql.createPool({ host, port, user, password, database, connectionLimit: 3, timezone: "Z" });
  }
  return pool;
}

/** Returns null when LOGISTICS_DB_ENABLED is not "true" - callers must treat that as configuration_unavailable, never as not_found. */
export function getLogisticsQueryExecutor(): LogisticsQueryExecutor | null {
  const config = readLogisticsDbConfig();
  if (!config.enabled) return null;

  const connectionPool = getPool(config.host, config.port, config.user, config.password, config.database);
  return {
    async queryRows(sql) {
      const [rows] = await connectionPool.query(sql);
      return rows as never[];
    }
  };
}

/** Test-only: forces the next getLogisticsQueryExecutor() call to open a fresh pool. */
export async function resetLogisticsPoolForTests() {
  const current = pool;
  pool = null;
  if (current) {
    try {
      await current.end();
    } catch {
      // ignore teardown failures - the pool is being discarded either way
    }
  }
}
