/**
 * LOCAL BENCHMARK ENVIRONMENT GATE (P7.10 and any DB-backed local benchmark).
 *
 * Refuses to let a benchmark start unless the process is unambiguously pointed at the LOCAL
 * crm_test database, with every external side effect disabled. Prints only NODE_ENV, DB host,
 * DB port and DB name (never a password, token or API key value).
 *
 *   npx tsx scripts/p7-10-env-gate.ts            # env checks only (no DB connection)
 *   npx tsx scripts/p7-10-env-gate.ts --db       # + connects and proves SELECT DATABASE() = crm_test
 *
 * Exit code 0 = safe, 1 = ABORT.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLocalHost, resolveNamedDatabaseConnection } from "../lib/database-config";
import { loadEnvFile, PROJECT_ROOT } from "./db-utils";

export type EnvGateSummary = {
  nodeEnv: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  provider: { endpointHost: string | null; model: string | null; apiKeyConfigured: boolean };
  disabledFlags: string[];
  unsetIntegrations: string[];
};

/** Every one of these must be absent or "false": they can send messages, run workers or mutate an external system. */
export const MUST_BE_FALSE_FLAGS = [
  "BRAIN_META_SEND_ENABLED",
  "BRAIN_META_SEND_TEST_ENABLED",
  "BRAIN_OUTBOX_WORKER_ENABLED",
  "BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND",
  "BRAIN_MESSAGE_TRANSPORT_ENABLED",
  "BRAIN_WHATSAPP_TRANSPORT_ENABLED",
  "BRAIN_WHATSAPP_TYPING_INDICATOR_ENABLED",
  "BRAIN_PROCESS_INBOUND_ALLOW_OUTBOX_PLAN",
  "BRAIN_PERSIST_CANONICAL_OUTBOUND",
  "BRAIN_AUTONOMOUS_REPLY_ENABLED",
  "BRAIN_AUTONOMOUS_SANDBOX_ENABLED",
  "BRAIN_AGENT_ACTION_QUEUE_ENABLED",
  "BRAIN_EXECUTION_GATE_ENABLED",
  "BRAIN_OUTBOX_BRIDGE_ENABLED",
  "BRAIN_EXECUTOR_ENABLED",
  "BRAIN_EXECUTOR_ALLOW_REAL_SEND",
  "BRAIN_SALES_AGENT_RUNTIME_ENABLED",
  "BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED",
  "MARKETING_COPILOT_ENABLED",
  "CUSTOMER_PROFILE_ENABLED",
  "CUSTOMER_INTELLIGENCE_AUDIENCE_ENABLED",
  "LOGISTICS_DB_ENABLED"
] as const;

/** These must be empty/unset locally: a value means a real external endpoint or credential could be reached. */
export const MUST_BE_UNSET = ["META_ACCESS_TOKEN", "META_WHATSAPP_ACCESS_TOKEN", "BRAIN_WHATSAPP_ACCESS_TOKEN", "META_WHATSAPP_APP_SECRET", "META_PHONE_NUMBER_ID", "META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID", "DEFAULT_PHONE_NUMBER_ID", "BRAIN_WHATSAPP_PHONE_NUMBER_ID", "N8N_BASE_URL", "LOGISTICS_DB_HOST", "PRESTASHOP_DATABASE_HOST"] as const;

/** Any database host variable must be local (or empty). */
const DB_HOST_KEYS = ["DB_HOST", "DATABASE_HOST", "MIGRATION_DATABASE_HOST", "TEST_DATABASE_HOST", "LEGACY_DATABASE_HOST"] as const;
const DB_URL_KEYS = ["DB_URL", "DATABASE_URL", "MIGRATION_DATABASE_URL", "TEST_DATABASE_URL", "LEGACY_DATABASE_URL"] as const;
/** Substrings of hostnames that identify remote/production infrastructure. */
const REMOTE_HOST_PATTERNS = [/amazonaws\.com/i, /\brds\b/i, /ec2/i, /pesaschile\.cl/i, /\.internal$/i];

const clean = (value: string | undefined) => (value ?? "").trim();

export async function loadLocalBenchmarkEnv(): Promise<void> {
  // The project-local .env WINS over whatever the shell already exported (stale PM2/EC2 values must never leak in).
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env"), true);
}

function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Throws (with a message free of secrets) when the environment is not the safe local benchmark environment. */
export function assertLocalTestEnv(env: NodeJS.ProcessEnv = process.env): EnvGateSummary {
  const problems: string[] = [];

  const nodeEnv = clean(env.NODE_ENV);
  if (nodeEnv === "production") problems.push("NODE_ENV is production");
  else if (nodeEnv !== "test") problems.push(`NODE_ENV must be exactly "test" (got "${nodeEnv || "unset"}")`);

  let dbHost = "";
  let dbPort = 0;
  let dbName = "";
  try {
    const connection = resolveNamedDatabaseConnection("app", env);
    dbHost = connection.host;
    dbPort = connection.port;
    dbName = connection.database ?? "";
  } catch (error) {
    problems.push(`database configuration invalid: ${error instanceof Error ? error.message.replace(/password[^,;]*/gi, "password=<redacted>") : "unknown"}`);
  }
  if (dbName !== "crm_test") problems.push(`database name must be exactly "crm_test" (got "${dbName || "unresolved"}")`);
  if (dbHost && !isLocalHost(dbHost)) problems.push(`database host must be 127.0.0.1 or localhost (got "${dbHost}")`);

  for (const key of DB_HOST_KEYS) {
    const value = clean(env[key]);
    if (value && (!isLocalHost(value) || REMOTE_HOST_PATTERNS.some((pattern) => pattern.test(value)))) problems.push(`${key} is not local ("${value}")`);
  }
  for (const key of DB_URL_KEYS) {
    const value = clean(env[key]);
    if (!value) continue;
    const host = hostOfUrl(value);
    if (!isLocalHost(host) || REMOTE_HOST_PATTERNS.some((pattern) => pattern.test(host))) problems.push(`${key} points to a non-local host ("${host}")`);
  }

  const enabled = MUST_BE_FALSE_FLAGS.filter((key) => clean(env[key]).toLowerCase() === "true");
  for (const key of enabled) problems.push(`${key} must be false locally`);
  const setIntegrations = MUST_BE_UNSET.filter((key) => clean(env[key]).length > 0);
  for (const key of setIntegrations) problems.push(`${key} must be unset locally`);

  if (problems.length > 0) throw new Error(`LOCAL ENV GATE FAILED - ABORT:\n - ${problems.join("\n - ")}`);

  const endpoint = clean(env.BRAIN_MODEL_API_URL);
  return {
    nodeEnv,
    dbHost,
    dbPort,
    dbName,
    provider: { endpointHost: endpoint ? hostOfUrl(endpoint) : null, model: clean(env.BENCHMARK_LIVE_LLM_MODEL) || clean(env.BRAIN_MODEL_NAME) || null, apiKeyConfigured: clean(env.BRAIN_MODEL_API_KEY).length > 0 },
    disabledFlags: MUST_BE_FALSE_FLAGS.filter((key) => clean(env[key]).toLowerCase() !== "true"),
    unsetIntegrations: [...MUST_BE_UNSET]
  };
}

export function printGate(summary: EnvGateSummary): void {
  console.log("LOCAL ENV GATE: PASS");
  console.log(`  NODE_ENV      = ${summary.nodeEnv}`);
  console.log(`  DB host       = ${summary.dbHost}`);
  console.log(`  DB port       = ${summary.dbPort}`);
  console.log(`  DB name       = ${summary.dbName}`);
  console.log(`  side-effect flags forced off: ${summary.disabledFlags.length}/${MUST_BE_FALSE_FLAGS.length}; integrations unset: ${summary.unsetIntegrations.length}`);
  console.log(`  provider      = ${summary.provider.endpointHost ?? "(no endpoint)"} model=${summary.provider.model ?? "(none)"} apiKey=${summary.provider.apiKeyConfigured ? "configured" : "MISSING"}`);
}

/** Proves, on the live connection, that the pool is really talking to crm_test on a local host. Throws otherwise. */
export async function assertConnectedToCrmTest(): Promise<{ database: string }> {
  const { queryRows } = await import("../lib/db");
  const rows = await queryRows<{ db: string | null }>("SELECT DATABASE() AS db");
  const database = rows[0]?.db ?? null;
  if (database !== "crm_test") throw new Error(`LOCAL ENV GATE FAILED - ABORT: SELECT DATABASE() returned "${database ?? "NULL"}", expected "crm_test"`);
  return { database };
}

async function main() {
  const withDb = process.argv.includes("--db");
  try {
    await loadLocalBenchmarkEnv();
    const summary = assertLocalTestEnv();
    printGate(summary);
    if (withDb) {
      const { database } = await assertConnectedToCrmTest();
      console.log(`  SELECT DATABASE() = ${database}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (withDb) {
      const { resetPoolForTests } = await import("../lib/db");
      await resetPoolForTests();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
