// PrestaShop identity read source topology (ID-R2-A11.1). Two named,
// explicit sources - never inferred from database name or NODE_ENV (PARTE
// 6 of the task spec):
//
// - "local_mirror" (default, unset): reuses the app's shared DATABASE_*
//   pool exactly as before this task - dev/test fixtures for ps_customer/
//   ps_orders (database/fixtures/legacy-n8n-schema.sql) keep working
//   unchanged, and so does today's de-facto production wiring.
// - "production_db": a dedicated, independent connection with its own
//   PRESTASHOP_DATABASE_* credentials (same pattern as
//   lib/integrations/logistics/config.ts) so a real deployment can point at
//   `pesas_productiva` without ever touching main_management's ps_customer/
//   ps_orders mirror tables.
//
// Switching source requires an explicit PRESTASHOP_IDENTITY_SOURCE=
// production_db - there is no automatic promotion by environment, and
// production_db never falls back to DATABASE_*/DB_* when incomplete.

export type PrestashopDbEnvShape = Record<string, string | undefined>;

export type PrestashopDbConfig =
  | { source: "local_mirror" }
  | { source: "production_db"; host: string; port: number; user: string; password: string; database: string };

export class PrestashopDbConfigurationError extends Error {}

function readRequired(env: PrestashopDbEnvShape, key: string): string | null {
  const value = env[key];
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function readPrestashopDbConfig(env: PrestashopDbEnvShape = process.env): PrestashopDbConfig {
  const rawSource = (env.PRESTASHOP_IDENTITY_SOURCE ?? "").trim();
  if (rawSource === "" || rawSource === "local_mirror") return { source: "local_mirror" };

  if (rawSource !== "production_db") {
    throw new PrestashopDbConfigurationError(
      `Unknown PRESTASHOP_IDENTITY_SOURCE "${rawSource}" - expected "local_mirror" or "production_db".`
    );
  }

  const host = readRequired(env, "PRESTASHOP_DATABASE_HOST");
  const user = readRequired(env, "PRESTASHOP_DATABASE_USER");
  const password = readRequired(env, "PRESTASHOP_DATABASE_PASSWORD");
  const database = readRequired(env, "PRESTASHOP_DATABASE_NAME");
  const portRaw = readRequired(env, "PRESTASHOP_DATABASE_PORT");
  const port = portRaw ? Number(portRaw) : 3306;

  if (!host || !user || !password || !database || !Number.isInteger(port) || port <= 0) {
    throw new PrestashopDbConfigurationError(
      "PRESTASHOP_DATABASE_HOST/PRESTASHOP_DATABASE_USER/PRESTASHOP_DATABASE_PASSWORD/PRESTASHOP_DATABASE_NAME are required when PRESTASHOP_IDENTITY_SOURCE=production_db."
    );
  }

  return { source: "production_db", host, port, user, password, database };
}
