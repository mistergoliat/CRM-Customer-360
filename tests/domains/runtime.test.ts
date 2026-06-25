import assert from "node:assert/strict";
import test from "node:test";
import { resolveDatabaseConnectionFromEnv } from "../../lib/database-config";
import { createModuleRuntimeStatus, type ModuleRuntimeStatus } from "../../lib/domains/runtime/module-status";
import { getConfiguredModuleModes, parseModuleDataMode } from "../../lib/domains/runtime/data-source-status";
import { sanitizeDbError } from "../../lib/db";

test("module data modes respect valid and invalid values", () => {
  assert.equal(parseModuleDataMode("real", "fixture"), "real");
  assert.equal(parseModuleDataMode("partial", "fixture"), "partial");
  assert.equal(parseModuleDataMode("unknown", "fixture"), "fixture");
});

test("configured modes read from env centrally", () => {
  const previous = process.env.CUSTOMERS_DATA_MODE;
  process.env.CUSTOMERS_DATA_MODE = "real";
  const modes = getConfiguredModuleModes(process.env);
  assert.equal(modes.customers, "real");
  if (previous === undefined) {
    delete process.env.CUSTOMERS_DATA_MODE;
  } else {
    process.env.CUSTOMERS_DATA_MODE = previous;
  }
});

test("module runtime status fills default timestamp and available flag", () => {
  const status: ModuleRuntimeStatus = createModuleRuntimeStatus({
    module: "customers",
    mode: "real",
    available: true,
    source: "master_customer"
  });

  assert.equal(status.module, "customers");
  assert.equal(status.available, true);
  assert.equal(status.source, "master_customer");
  assert.equal(typeof status.checkedAt, "string");
});

test("db error sanitization redacts credentials", () => {
  const sanitized = sanitizeDbError("mysql://user:secret@host/db?password=secret");
  assert.doesNotMatch(sanitized, /secret/);
});

test("test environment rejects non-crm_test database targets", () => {
  assert.throws(
    () =>
      resolveDatabaseConnectionFromEnv(
        {
          NODE_ENV: "test",
          DATABASE_NAME: "crm_dev",
          DATABASE_USER: "crm_app",
          DATABASE_PASSWORD: "change_me"
        },
        {
          databaseKey: "DATABASE_NAME",
          userKey: "DATABASE_USER",
          passwordKey: "DATABASE_PASSWORD"
        }
      ),
    /NODE_ENV=test requires crm_test/
  );
});

test("db aliases resolve main_management local development config", () => {
  const connection = resolveDatabaseConnectionFromEnv({
    DB_HOST: "127.0.0.1",
    DB_PORT: "3306",
    DB_NAME: "main_management",
    DB_USER: "crm_app",
    DB_PASSWORD: "una_clave_local"
  });

  assert.equal(connection.host, "127.0.0.1");
  assert.equal(connection.port, 3306);
  assert.equal(connection.database, "main_management");
  assert.equal(connection.user, "crm_app");
  assert.equal(connection.password, "una_clave_local");
});

test("local db aliases override remote DATABASE_URL", () => {
  const connection = resolveDatabaseConnectionFromEnv({
    DATABASE_URL: "mysql://remote_user:remote_pass@remote.example.com:3306/remote_db",
    DB_HOST: "127.0.0.1",
    DB_PORT: "3306",
    DB_NAME: "main_management",
    DB_USER: "crm_app",
    DB_PASSWORD: "una_clave_local"
  });

  assert.equal(connection.host, "127.0.0.1");
  assert.equal(connection.database, "main_management");
  assert.equal(connection.user, "crm_app");
});
