import { sanitizeDbError } from "@/lib/db";
import type { CarrierCoverageEntry, CarrierCoverageLookupResult, ShippingCoverageProvider } from "@/lib/domains/shipping-calculation";
import { getLogisticsQueryExecutor } from "./pool";
import type { LogisticsQueryExecutor } from "./queryExecutor";

// Read-only: two fixed SELECTs, one of them parameterized on a numeric
// comuna_id (safe - no collation concerns, unlike T13C's text matching).
// pc_pos.carriers (3 rows) is small, near-static reference data, cached the
// same way T13C caches pc_pos.comuna. pc_pos.carrier_coverage (1026 rows) is
// operational config a carrier/ops team could change, so it is queried live
// per commune, never cached (CRM-R1-T13E live audit, see release doc).
const SELECT_CARRIERS_SQL = "SELECT id, name, display_name, enabled FROM carriers";
const SELECT_COVERAGE_FOR_COMMUNE_SQL = "SELECT carrier_id, covered FROM carrier_coverage WHERE comuna_id = ?";

// ponytail: same single-process TTL cache as pc-pos-adapter.ts#loadCatalog -
// fine for a 3-row table that changes essentially never.
const CACHE_TTL_MS = 5 * 60 * 1000;

type CarrierRow = { id: number; name: string; display_name: string; enabled: number | boolean | null };
type CoverageRow = { carrier_id: number; covered: number | boolean | null };

type CarrierCache = { fetchedAt: number; rows: CarrierRow[] };
let cache: CarrierCache | null = null;

function classifyError(error: unknown): "unavailable" | "timeout" {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  if (code === "ETIMEDOUT" || code === "PROTOCOL_SEQUENCE_TIMEOUT") return "timeout";
  return "unavailable";
}

async function loadCarriers(executor: LogisticsQueryExecutor): Promise<CarrierRow[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  const rows = await executor.queryRows<CarrierRow>(SELECT_CARRIERS_SQL);
  cache = { fetchedAt: now, rows };
  return rows;
}

/**
 * Read-only ShippingCoverageProvider against pc_pos.carriers/carrier_coverage.
 * getExecutor defaults to the real pc_pos pool but accepts an override so
 * tests can fake it without a real DB connection - same pattern as
 * createPcPosCommuneCatalog (T13C).
 */
export function createPcPosShippingCoverageProvider(getExecutor: () => LogisticsQueryExecutor | null = getLogisticsQueryExecutor): ShippingCoverageProvider {
  return {
    async getCoverageForCommune(communeId): Promise<CarrierCoverageLookupResult> {
      const executor = getExecutor();
      if (!executor) {
        return { ok: false, reason: "configuration_unavailable", detail: "LOGISTICS_DB_ENABLED is not true" };
      }

      let carrierRows: CarrierRow[];
      let coverageRows: CoverageRow[];
      try {
        carrierRows = await loadCarriers(executor);
        coverageRows = await executor.queryRows<CoverageRow>(SELECT_COVERAGE_FOR_COMMUNE_SQL, [communeId]);
      } catch (error) {
        return { ok: false, reason: classifyError(error), detail: sanitizeDbError(error) };
      }

      const coverageByCarrierId = new Map(coverageRows.map((row) => [Number(row.carrier_id), row]));

      const carriers: CarrierCoverageEntry[] = carrierRows.map((row) => {
        const coverageRow = coverageByCarrierId.get(Number(row.id));
        const coverage = !coverageRow ? "unknown" : coverageRow.covered === null || coverageRow.covered === undefined ? "unknown" : Number(coverageRow.covered) === 1 ? "covered" : "not_covered";
        return {
          carrierId: Number(row.id),
          carrierKey: String(row.name),
          carrierName: String(row.display_name),
          enabled: Boolean(row.enabled),
          coverage
        };
      });

      return { ok: true, carriers };
    }
  };
}

/** Test-only: clears the in-process carriers cache so a test can control exactly when a query happens. */
export function resetPcPosShippingCoverageCacheForTests() {
  cache = null;
}
