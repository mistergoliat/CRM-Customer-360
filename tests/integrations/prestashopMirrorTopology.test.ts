import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { getPool } from "@/lib/db";
import { resolveNamedDatabaseConnection } from "@/lib/database-config";
import { PrestashopDbConfigurationError, readPrestashopDbConfig } from "@/lib/integrations/prestashop-mirror/config";
import { getPrestashopQueryExecutor, resetPrestashopPoolForTests, type PrestashopQueryExecutor } from "@/lib/integrations/prestashop-mirror/pool";
import { findPrestashopCustomerIdsByEmail, findPrestashopCustomerIdsByOrderReference } from "@/lib/integrations/prestashop-mirror/repository";

// Same file-level env hook every other real-DB test file in this repo uses
// (e.g. tests/domains/customerIdentity.test.ts) - there is no global dotenv
// loader for `npm run test`. PSDS11 below is the only test here that needs
// the real shared pool; local_mirror currently means main_management, same
// as the rest of the suite (database/fixtures/legacy-n8n-schema.sql).
Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

// ID-R2-A11.1 - topology tests. These make it impossible to silently regress
// back to the DEPLOYMENT_BLOCKER this task closes (production identity
// reads landing on main_management by accident). See
// docs/releases/SALES-AGENT-R2-ID-R2-A11.1-production-prestashop-read-source-wiring.md.

const MIRROR_DIR = join(__dirname, "../../lib/integrations/prestashop-mirror");

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test.after(async () => {
  await resetPrestashopPoolForTests();
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

// --- PSDS01/02: production topology ---

test("PSDS01: production_db mode builds a dedicated executor, distinct from the local mirror executor", () => {
  const dedicated = withEnv(
    {
      PRESTASHOP_IDENTITY_SOURCE: "production_db",
      PRESTASHOP_DATABASE_HOST: "pesas-productiva.invalid",
      PRESTASHOP_DATABASE_USER: "reader",
      PRESTASHOP_DATABASE_PASSWORD: "secret",
      PRESTASHOP_DATABASE_NAME: "pesas_productiva"
    },
    () => getPrestashopQueryExecutor()
  );
  const local = withEnv({ PRESTASHOP_IDENTITY_SOURCE: undefined }, () => getPrestashopQueryExecutor());

  assert.notEqual(dedicated, local);
});

test("PSDS02: production database name resolves to the configured source (e.g. pesas_productiva), never a hardcoded name", () => {
  const config = readPrestashopDbConfig({
    PRESTASHOP_IDENTITY_SOURCE: "production_db",
    PRESTASHOP_DATABASE_HOST: "pesas-productiva.invalid",
    PRESTASHOP_DATABASE_USER: "reader",
    PRESTASHOP_DATABASE_PASSWORD: "secret",
    PRESTASHOP_DATABASE_NAME: "pesas_productiva"
  });
  assert.deepEqual(config, {
    source: "production_db",
    host: "pesas-productiva.invalid",
    port: 3306,
    user: "reader",
    password: "secret",
    database: "pesas_productiva"
  });
});

// --- PSDS03: separate pools ---

test("PSDS03: the main CRM pool and a configured PrestaShop pool never resolve to the same database", () => {
  const env = {
    DATABASE_HOST: "crm-host",
    DATABASE_USER: "crm_app",
    DATABASE_PASSWORD: "x",
    DATABASE_NAME: "main_management",
    PRESTASHOP_IDENTITY_SOURCE: "production_db",
    PRESTASHOP_DATABASE_HOST: "prestashop-host",
    PRESTASHOP_DATABASE_USER: "reader",
    PRESTASHOP_DATABASE_PASSWORD: "y",
    PRESTASHOP_DATABASE_NAME: "pesas_productiva"
  };
  const appConnection = resolveNamedDatabaseConnection("app", env);
  const prestashopConfig = readPrestashopDbConfig(env);
  assert.equal(appConnection.database, "main_management");
  assert.ok(prestashopConfig.source === "production_db");
  assert.equal(prestashopConfig.database, "pesas_productiva");
  assert.notEqual(appConnection.database, prestashopConfig.database);
});

// --- PSDS04/05: candidate queries hit the PrestaShop executor ---

test("PSDS04: the email candidate query hits the injected PrestaShop executor against ps_customer", async () => {
  const calls: { table?: string; sql?: string } = {};
  const executor: PrestashopQueryExecutor = {
    async getColumns(tableName) {
      calls.table = tableName;
      return ["id_customer", "email"];
    },
    async safeQueryRows<T>(sql: string) {
      calls.sql = sql;
      return { ok: true as const, rows: [{ id_customer: 42 }] as unknown as T[] };
    }
  };
  const result = await findPrestashopCustomerIdsByEmail("camila@example.test", () => executor);
  assert.equal(calls.table, "ps_customer");
  assert.match(calls.sql ?? "", /FROM `ps_customer`/);
  assert.deepEqual(result, { ok: true, tableAvailable: true, prestashopCustomerIds: ["42"] });
});

test("PSDS05: the order-ownership query hits the injected PrestaShop executor against ps_orders", async () => {
  const calls: { table?: string; sql?: string } = {};
  const executor: PrestashopQueryExecutor = {
    async getColumns(tableName) {
      calls.table = tableName;
      return ["id_order", "reference", "id_customer"];
    },
    async safeQueryRows<T>(sql: string) {
      calls.sql = sql;
      return { ok: true as const, rows: [{ id_customer: 7 }] as unknown as T[] };
    }
  };
  const result = await findPrestashopCustomerIdsByOrderReference("REF-1001", () => executor);
  assert.equal(calls.table, "ps_orders");
  assert.match(calls.sql ?? "", /FROM `ps_orders`/);
  assert.deepEqual(result, { ok: true, tableAvailable: true, prestashopCustomerIds: ["7"] });
});

// --- PSDS06: master_customer never appears here ---

test("PSDS06: master_customer never appears anywhere in the PrestaShop mirror module", () => {
  for (const file of ["repository.ts", "pool.ts", "config.ts"]) {
    const source = readFileSync(join(MIRROR_DIR, file), "utf8");
    assert.equal(/master_customer/i.test(source), false, `${file} must never reference master_customer`);
  }
});

// --- PSDS07/08: fail closed, no silent fallback ---

test("PSDS07: missing PrestaShop production config fails closed (throws, never silently unavailable)", () => {
  assert.throws(() => readPrestashopDbConfig({ PRESTASHOP_IDENTITY_SOURCE: "production_db" }), PrestashopDbConfigurationError);
});

test("PSDS08: production_db never falls back to DATABASE_*/DB_* when incomplete", () => {
  assert.throws(
    () =>
      readPrestashopDbConfig({
        PRESTASHOP_IDENTITY_SOURCE: "production_db",
        DATABASE_HOST: "should-not-be-used",
        DATABASE_USER: "should-not-be-used",
        DATABASE_PASSWORD: "should-not-be-used",
        DATABASE_NAME: "main_management",
        DB_HOST: "should-not-be-used"
      }),
    PrestashopDbConfigurationError
  );
});

// --- PSDS09: DB unavailable != NOT_FOUND ---

test("PSDS09: a broken production_db configuration is reported as a technical failure, never as an empty/not-found result", async () => {
  const brokenExecutor = () => {
    throw new PrestashopDbConfigurationError("PRESTASHOP_DATABASE_HOST/... required");
  };
  const byEmail = await findPrestashopCustomerIdsByEmail("nadie@example.test", brokenExecutor);
  assert.equal(byEmail.ok, false);
  assert.match((byEmail as { error: string }).error, /prestashop_db_configuration_error/);

  const byOrder = await findPrestashopCustomerIdsByOrderReference("REF-1", () => {
    throw new Error("ECONNREFUSED");
  });
  assert.equal(byOrder.ok, false);
});

// --- PSDS10/11: dev mirror keeps working ---

test("PSDS10: with no PRESTASHOP_IDENTITY_SOURCE set, the source is the local mirror (unchanged default)", () => {
  assert.deepEqual(readPrestashopDbConfig({}), { source: "local_mirror" });
  assert.deepEqual(readPrestashopDbConfig({ PRESTASHOP_IDENTITY_SOURCE: "local_mirror" }), { source: "local_mirror" });
});

test("PSDS11: the local mirror executor reads the real ps_customer fixture from the shared app pool", async () => {
  const executor = withEnv({ PRESTASHOP_IDENTITY_SOURCE: undefined }, () => getPrestashopQueryExecutor());
  const columns = await executor.getColumns("ps_customer");
  assert.ok(columns.includes("id_customer"), "expected ps_customer.id_customer to exist in the local mirror fixture (main_management)");
});

// --- PSDS12: single semantic source for both readers ---

test("PSDS12: email and order-reference lookups default to the identical executor factory (no split sources)", () => {
  const source = readFileSync(join(MIRROR_DIR, "repository.ts"), "utf8");
  const matches = source.match(/=\s*getPrestashopQueryExecutor/g) ?? [];
  assert.equal(matches.length, 2, "both readers must default to getPrestashopQueryExecutor - never a bespoke second source");
});

// --- PSDS13: read-only ---

test("PSDS13: no write SQL exists anywhere in the PrestaShop mirror module", () => {
  for (const file of ["repository.ts", "pool.ts", "config.ts"]) {
    const source = readFileSync(join(MIRROR_DIR, file), "utf8");
    assert.equal(/\bINSERT\s+INTO|\bUPDATE\s+`|\bDELETE\s+FROM/i.test(source), false, `${file} must be read-only`);
  }
});
