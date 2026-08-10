import assert from "node:assert/strict";
import test from "node:test";
import { LogisticsDbConfigurationError, readLogisticsDbConfig } from "@/lib/integrations/logistics/config";
import { createPcPosCommuneCatalog, resetPcPosCommuneCatalogCacheForTests } from "@/lib/integrations/logistics/pc-pos-adapter";
import type { LogisticsQueryExecutor } from "@/lib/integrations/logistics/queryExecutor";

// --- config ---

test("readLogisticsDbConfig is disabled by default", () => {
  assert.deepEqual(readLogisticsDbConfig({}), { enabled: false });
});

test("readLogisticsDbConfig never falls back to DATABASE_*/DB_* when enabled", () => {
  assert.throws(
    () =>
      readLogisticsDbConfig({
        LOGISTICS_DB_ENABLED: "true",
        DATABASE_HOST: "should-not-be-used",
        DATABASE_USER: "should-not-be-used",
        DATABASE_PASSWORD: "should-not-be-used",
        DATABASE_NAME: "should-not-be-used",
        DB_HOST: "should-not-be-used"
      }),
    LogisticsDbConfigurationError
  );
});

test("readLogisticsDbConfig requires host/user/password/database when enabled", () => {
  const full = {
    LOGISTICS_DB_ENABLED: "true",
    LOGISTICS_DB_HOST: "logistics.example.internal",
    LOGISTICS_DB_USER: "reader",
    LOGISTICS_DB_PASSWORD: "secret",
    LOGISTICS_DB_NAME: "pc_pos"
  };
  assert.deepEqual(readLogisticsDbConfig(full), {
    enabled: true,
    host: "logistics.example.internal",
    port: 3306,
    user: "reader",
    password: "secret",
    database: "pc_pos"
  });

  for (const missingKey of ["LOGISTICS_DB_HOST", "LOGISTICS_DB_USER", "LOGISTICS_DB_PASSWORD", "LOGISTICS_DB_NAME"] as const) {
    const partial = { ...full, [missingKey]: undefined };
    assert.throws(() => readLogisticsDbConfig(partial), LogisticsDbConfigurationError);
  }
});

// --- adapter (fake executor, no real DB - see T13C section 19) ---

function fakeExecutor(rows: Array<{ id_comuna: number; comuna_name: string }>): LogisticsQueryExecutor {
  return { async queryRows() { return rows as never[]; } };
}

test.beforeEach(() => {
  resetPcPosCommuneCatalogCacheForTests();
});

test("returns configuration_unavailable when the executor is unavailable (LOGISTICS_DB_ENABLED=false)", async () => {
  const catalog = createPcPosCommuneCatalog(() => null);
  const result = await catalog.findByNormalizedName("nunoa");
  assert.deepEqual(result, { ok: false, reason: "configuration_unavailable", detail: "LOGISTICS_DB_ENABLED is not true" });
});

test("maps pc_pos.comuna rows and matches case/accent-insensitively via the shared comparisonKey", async () => {
  const catalog = createPcPosCommuneCatalog(() => fakeExecutor([{ id_comuna: 99, comuna_name: "Ñuñoa" }]));
  const result = await catalog.findByNormalizedName("nunoa");
  assert.deepEqual(result, { ok: true, entries: [{ communeId: 99, canonicalName: "Ñuñoa" }] });
});

test("returns an empty match list (not an error) when nothing matches", async () => {
  const catalog = createPcPosCommuneCatalog(() => fakeExecutor([{ id_comuna: 99, comuna_name: "Ñuñoa" }]));
  const result = await catalog.findByNormalizedName("nowhere");
  assert.deepEqual(result, { ok: true, entries: [] });
});

test("caches the catalog: two lookups within the TTL only query once", async () => {
  let calls = 0;
  const executor: LogisticsQueryExecutor = {
    async queryRows() {
      calls += 1;
      return [{ id_comuna: 99, comuna_name: "Ñuñoa" }] as never[];
    }
  };
  const catalog = createPcPosCommuneCatalog(() => executor);
  await catalog.findByNormalizedName("nunoa");
  await catalog.findByNormalizedName("nunoa");
  assert.equal(calls, 1);
});

test("classifies a connection failure as unavailable, never throws out of the port", async () => {
  const executor: LogisticsQueryExecutor = {
    async queryRows() {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:3306") as NodeJS.ErrnoException;
      error.code = "ECONNREFUSED";
      throw error;
    }
  };
  const catalog = createPcPosCommuneCatalog(() => executor);
  const result = await catalog.findByNormalizedName("nunoa");
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, "unavailable");
});

test("classifies a timeout distinctly from a generic outage", async () => {
  const executor: LogisticsQueryExecutor = {
    async queryRows() {
      const error = new Error("query timed out") as NodeJS.ErrnoException;
      error.code = "ETIMEDOUT";
      throw error;
    }
  };
  const catalog = createPcPosCommuneCatalog(() => executor);
  const result = await catalog.findByNormalizedName("nunoa");
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, "timeout");
});

test("never leaks a credential from a raw driver error into detail", async () => {
  const executor: LogisticsQueryExecutor = {
    async queryRows() {
      throw new Error("connection failed: mysql://reader:s3cr3t@logistics.example.internal:3306/pc_pos");
    }
  };
  const catalog = createPcPosCommuneCatalog(() => executor);
  const result = await catalog.findByNormalizedName("nunoa");
  assert.equal(result.ok, false);
  const detail = (result as { detail: string }).detail;
  assert.ok(!detail.includes("s3cr3t"), `detail leaked a credential: ${detail}`);
});
