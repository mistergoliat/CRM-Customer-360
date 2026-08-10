import assert from "node:assert/strict";
import test from "node:test";
import { createPcPosShippingCoverageProvider, resetPcPosShippingCoverageCacheForTests } from "@/lib/integrations/logistics/shipping-coverage-adapter";
import type { LogisticsQueryExecutor } from "@/lib/integrations/logistics/queryExecutor";

const CARRIER_ROWS = [
  { id: 1, name: "starken", display_name: "Starken", enabled: 1 },
  { id: 2, name: "blueexpress", display_name: "Blue Express", enabled: 1 },
  { id: 3, name: "despacho directo", display_name: "Pesas Chile", enabled: 1 }
];

function fakeExecutor(coverageRows: Array<{ carrier_id: number; covered: number | null }>, carrierRows: typeof CARRIER_ROWS = CARRIER_ROWS): LogisticsQueryExecutor {
  return {
    async queryRows(sql: string, params?: readonly unknown[]) {
      if (sql.includes("FROM carriers")) return carrierRows as never[];
      if (sql.includes("FROM carrier_coverage")) {
        assert.ok(params && params.length === 1, "coverage query must be parameterized by comuna_id");
        return coverageRows as never[];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
}

test.beforeEach(() => {
  resetPcPosShippingCoverageCacheForTests();
});

test("returns configuration_unavailable when the executor is unavailable (LOGISTICS_DB_ENABLED=false)", async () => {
  const provider = createPcPosShippingCoverageProvider(() => null);
  const result = await provider.getCoverageForCommune(99);
  assert.deepEqual(result, { ok: false, reason: "configuration_unavailable", detail: "LOGISTICS_DB_ENABLED is not true" });
});

test("real-shape example (Nunoa, id 99): Blue Express covered, Starken explicitly not covered, Pesas Chile covered", async () => {
  const executor = fakeExecutor([
    { carrier_id: 2, covered: 1 },
    { carrier_id: 1, covered: 0 },
    { carrier_id: 3, covered: 1 }
  ]);
  const provider = createPcPosShippingCoverageProvider(() => executor);
  const result = await provider.getCoverageForCommune(99);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const byKey = new Map(result.carriers.map((c) => [c.carrierKey, c]));
  assert.equal(byKey.get("blueexpress")?.coverage, "covered");
  assert.equal(byKey.get("starken")?.coverage, "not_covered");
  assert.equal(byKey.get("despacho directo")?.coverage, "covered");
});

test("a carrier with no coverage row at all for this commune is 'unknown', never silently 'not_covered'", async () => {
  // Starken has no row for this commune (e.g. an unconfigured remote area) -
  // only Blue Express and Pesas Chile have rows.
  const executor = fakeExecutor([
    { carrier_id: 2, covered: 1 },
    { carrier_id: 3, covered: 0 }
  ]);
  const provider = createPcPosShippingCoverageProvider(() => executor);
  const result = await provider.getCoverageForCommune(345);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const byKey = new Map(result.carriers.map((c) => [c.carrierKey, c]));
  assert.equal(byKey.get("starken")?.coverage, "unknown");
  assert.equal(byKey.get("blueexpress")?.coverage, "covered");
  assert.equal(byKey.get("despacho directo")?.coverage, "not_covered");
});

test("a disabled carrier is reported enabled:false - filtering out disabled carriers is the domain's job, not the adapter's", async () => {
  const carrierRows = [{ id: 1, name: "starken", display_name: "Starken", enabled: 0 }];
  const executor = fakeExecutor([{ carrier_id: 1, covered: 1 }], carrierRows);
  const provider = createPcPosShippingCoverageProvider(() => executor);
  const result = await provider.getCoverageForCommune(99);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.carriers[0].enabled, false);
});

test("caches pc_pos.carriers across two lookups (only queried once) but always re-queries carrier_coverage per commune", async () => {
  let carrierQueries = 0;
  let coverageQueries = 0;
  const executor: LogisticsQueryExecutor = {
    async queryRows(sql: string) {
      if (sql.includes("FROM carriers")) {
        carrierQueries += 1;
        return CARRIER_ROWS as never[];
      }
      coverageQueries += 1;
      return [{ carrier_id: 1, covered: 1 }] as never[];
    }
  };
  const provider = createPcPosShippingCoverageProvider(() => executor);
  await provider.getCoverageForCommune(99);
  await provider.getCoverageForCommune(105);
  assert.equal(carrierQueries, 1);
  assert.equal(coverageQueries, 2);
});

test("classifies a connection failure as unavailable, never throws out of the port", async () => {
  const executor: LogisticsQueryExecutor = {
    async queryRows() {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:3306") as NodeJS.ErrnoException;
      error.code = "ECONNREFUSED";
      throw error;
    }
  };
  const provider = createPcPosShippingCoverageProvider(() => executor);
  const result = await provider.getCoverageForCommune(99);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "unavailable");
});

test("classifies a timeout distinctly from a generic outage", async () => {
  const executor: LogisticsQueryExecutor = {
    async queryRows() {
      const error = new Error("query timed out") as NodeJS.ErrnoException;
      error.code = "ETIMEDOUT";
      throw error;
    }
  };
  const provider = createPcPosShippingCoverageProvider(() => executor);
  const result = await provider.getCoverageForCommune(99);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "timeout");
});

test("never leaks a credential from a raw driver error into detail", async () => {
  const executor: LogisticsQueryExecutor = {
    async queryRows() {
      throw new Error("connection failed: mysql://reader:s3cr3t@logistics.example.internal:3306/pc_pos");
    }
  };
  const provider = createPcPosShippingCoverageProvider(() => executor);
  const result = await provider.getCoverageForCommune(99);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(!result.detail.includes("s3cr3t"), `detail leaked a credential: ${result.detail}`);
});
