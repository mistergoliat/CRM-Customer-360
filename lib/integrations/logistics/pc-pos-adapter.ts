import { sanitizeDbError } from "@/lib/db";
import { comparisonKey } from "@/lib/domains/commune-resolution/normalize";
import type { CommuneCatalogPort } from "@/lib/domains/commune-resolution/ports";
import type { CommuneCatalogEntry, CommuneCatalogFailureReason } from "@/lib/domains/commune-resolution/types";
import { getLogisticsQueryExecutor } from "./pool";
import type { LogisticsQueryExecutor } from "./queryExecutor";

// Read-only, read-only, read-only: this file issues exactly one SQL
// statement, a fixed SELECT with no params and no write verb anywhere in the
// module (T13C section 10). pc_pos.comuna is small (346 rows) and near-static
// reference data, so it is fetched whole and matched in application code
// (via the same comparisonKey() the domain uses for everything else) rather
// than pushed into a collation-dependent SQL WHERE clause - MariaDB's
// trailing-space-insensitive VARCHAR comparison already burned a naive SQL
// equality check once during the T13B audit.
const SELECT_COMUNAS_SQL = "SELECT id_comuna, comuna_name FROM comuna";

// ponytail: single-process, in-memory TTL cache, no cross-instance
// invalidation. Fine for reference data that changes essentially never;
// revisit with a real invalidation strategy only if pc_pos.comuna starts
// changing during a process lifetime.
const CACHE_TTL_MS = 5 * 60 * 1000;

type CatalogCache = { fetchedAt: number; entries: CommuneCatalogEntry[] };
let cache: CatalogCache | null = null;

function classifyError(error: unknown): CommuneCatalogFailureReason {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  if (code === "ETIMEDOUT" || code === "PROTOCOL_SEQUENCE_TIMEOUT") return "timeout";
  return "unavailable";
}

async function loadCatalog(executor: LogisticsQueryExecutor): Promise<CommuneCatalogEntry[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.entries;

  const rows = await executor.queryRows<{ id_comuna: number; comuna_name: string }>(SELECT_COMUNAS_SQL);
  const entries = rows.map((row) => ({ communeId: Number(row.id_comuna), canonicalName: String(row.comuna_name) }));
  cache = { fetchedAt: now, entries };
  return entries;
}

/**
 * Read-only CommuneCatalogPort implementation against pc_pos.comuna.
 * getExecutor defaults to the real pc_pos pool but accepts an override so
 * tests can fake the executor without any real DB connection.
 */
export function createPcPosCommuneCatalog(getExecutor: () => LogisticsQueryExecutor | null = getLogisticsQueryExecutor): CommuneCatalogPort {
  return {
    async findByNormalizedName(normalizedName) {
      const executor = getExecutor();
      if (!executor) {
        return { ok: false, reason: "configuration_unavailable", detail: "LOGISTICS_DB_ENABLED is not true" };
      }

      let entries: CommuneCatalogEntry[];
      try {
        entries = await loadCatalog(executor);
      } catch (error) {
        return { ok: false, reason: classifyError(error), detail: sanitizeDbError(error) };
      }

      const matches = entries.filter((entry) => comparisonKey(entry.canonicalName) === normalizedName);
      return { ok: true, entries: matches };
    }
  };
}

/** Test-only: clears the in-process catalog cache so a test can control exactly when a query happens. */
export function resetPcPosCommuneCatalogCacheForTests() {
  cache = null;
}
