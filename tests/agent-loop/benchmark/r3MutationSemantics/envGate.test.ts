import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalTestEnv, MUST_BE_FALSE_FLAGS } from "@/scripts/p7-10-env-gate";

/**
 * Local benchmark environment gate: the safe environment passes, and every way of pointing at
 * production / a non-crm_test database / a remote host / a side-effecting integration aborts.
 * Pure (fake env objects), never touches process.env or a database.
 */
const SAFE: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "local-only",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "crm_test",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "local-only",
  BRAIN_MODEL_API_URL: "https://api.deepseek.com/chat/completions",
  BRAIN_MODEL_NAME: "deepseek-v4-flash",
  BRAIN_MODEL_API_KEY: "sk-not-a-real-key",
  BRAIN_META_SEND_ENABLED: "false",
  BRAIN_OUTBOX_WORKER_ENABLED: "false"
};
const withEnv = (overrides: Record<string, string>): NodeJS.ProcessEnv => ({ ...SAFE, ...overrides });
const aborts = (env: NodeJS.ProcessEnv, pattern: RegExp) => assert.throws(() => assertLocalTestEnv(env), pattern);

test("env gate: the safe local environment passes and reports only NODE_ENV, host, port, db name and provider presence (never a secret value)", () => {
  const summary = assertLocalTestEnv(SAFE);
  assert.deepEqual([summary.nodeEnv, summary.dbHost, summary.dbPort, summary.dbName], ["test", "127.0.0.1", 3306, "crm_test"]);
  assert.deepEqual(summary.provider, { endpointHost: "api.deepseek.com", model: "deepseek-v4-flash", apiKeyConfigured: true });
  assert.equal(JSON.stringify(summary).includes("local-only"), false, "no password in the summary");
  assert.equal(JSON.stringify(summary).includes("sk-not-a-real-key"), false, "no API key in the summary");
});

test("env gate: aborts on NODE_ENV=production or anything other than test", () => {
  aborts(withEnv({ NODE_ENV: "production" }), /NODE_ENV is production/);
  aborts(withEnv({ NODE_ENV: "development" }), /NODE_ENV must be exactly "test"/);
  const unset: Record<string, string | undefined> = { ...SAFE };
  delete unset.NODE_ENV;
  aborts(unset as NodeJS.ProcessEnv,/NODE_ENV must be exactly "test" \(got "unset"\)/);
});

test("env gate: aborts unless the database name is exactly crm_test (dev, legacy, production names, near-misses)", () => {
  for (const name of ["main_management", "crm_dev", "crm_legacy_fixture", "pesas_productiva", "crm_test2", "CRM_TEST"]) aborts(withEnv({ DB_NAME: name, DATABASE_NAME: name }), /crm_test/);
});

test("env gate: aborts on a non-local database host, on any host variable that is not local, and on a remote URL", () => {
  aborts(withEnv({ DB_HOST: "db.example.amazonaws.com", DATABASE_HOST: "db.example.amazonaws.com" }), /database host must be 127\.0\.0\.1 or localhost/);
  aborts(withEnv({ MIGRATION_DATABASE_HOST: "10.0.0.5" }), /MIGRATION_DATABASE_HOST is not local/);
  aborts(withEnv({ TEST_DATABASE_HOST: "rds.internal" }), /TEST_DATABASE_HOST is not local/);
  aborts(withEnv({ DB_URL: "mysql://u:p@prod.pesaschile.cl:3306/crm_test" }), /DB_URL points to a non-local host/);
  assertLocalTestEnv(withEnv({ DB_HOST: "localhost", DATABASE_HOST: "localhost" }));
});

test("env gate: aborts when a database URL/name resolves outside crm_test even if NODE_ENV=test (delegates to the repo's own database-config guard)", () => {
  aborts(withEnv({ DB_URL: "mysql://u:p@127.0.0.1:3306/main_management" }), /crm_test/);
});

test("env gate: aborts when any message-sending, worker or external integration flag is true", () => {
  assert.ok(MUST_BE_FALSE_FLAGS.length >= 20);
  for (const flag of MUST_BE_FALSE_FLAGS) aborts(withEnv({ [flag]: "true" }), new RegExp(`${flag} must be false locally`));
  aborts(withEnv({ BRAIN_META_SEND_ENABLED: "TRUE" }), /BRAIN_META_SEND_ENABLED must be false locally/);
});

test("env gate: aborts when a Meta/WhatsApp credential, phone id or n8n URL is set locally", () => {
  for (const key of ["META_ACCESS_TOKEN", "META_WHATSAPP_ACCESS_TOKEN", "BRAIN_WHATSAPP_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "DEFAULT_PHONE_NUMBER_ID", "N8N_BASE_URL", "LOGISTICS_DB_HOST", "PRESTASHOP_DATABASE_HOST"]) aborts(withEnv({ [key]: "something" }), new RegExp(`${key} must be unset locally`));
});

test("env gate: an error message never contains a password", () => {
  try {
    assertLocalTestEnv(withEnv({ DB_NAME: "main_management", DATABASE_NAME: "main_management", DB_PASSWORD: "super-secret-pw", DATABASE_PASSWORD: "super-secret-pw" }));
    assert.fail("must abort");
  } catch (error) {
    assert.equal(String((error as Error).message).includes("super-secret-pw"), false);
  }
});
