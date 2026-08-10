// pc_pos is a genuinely separate system from the CRM's own DATABASE_* target
// (T13C section 9) - even though both may live on the same RDS host today,
// this config never falls back to DATABASE_*/DB_* values. Mirrors the
// enabled-flag pattern of lib/integrations/customer-profile/http-client.ts.

export type LogisticsDbEnvShape = Record<string, string | undefined>;

export type LogisticsDbConfig =
  | { enabled: false }
  | { enabled: true; host: string; port: number; user: string; password: string; database: string };

export class LogisticsDbConfigurationError extends Error {}

function readEnabledFlag(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === "true";
}

function readRequired(env: LogisticsDbEnvShape, key: string): string | null {
  const value = env[key];
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export function readLogisticsDbConfig(env: LogisticsDbEnvShape = process.env): LogisticsDbConfig {
  if (!readEnabledFlag(env.LOGISTICS_DB_ENABLED)) {
    return { enabled: false };
  }

  const host = readRequired(env, "LOGISTICS_DB_HOST");
  const user = readRequired(env, "LOGISTICS_DB_USER");
  const password = readRequired(env, "LOGISTICS_DB_PASSWORD");
  const database = readRequired(env, "LOGISTICS_DB_NAME");
  const portRaw = readRequired(env, "LOGISTICS_DB_PORT");
  const port = portRaw ? Number(portRaw) : 3306;

  if (!host || !user || !password || !database || !Number.isInteger(port) || port <= 0) {
    throw new LogisticsDbConfigurationError(
      "LOGISTICS_DB_HOST/LOGISTICS_DB_USER/LOGISTICS_DB_PASSWORD/LOGISTICS_DB_NAME are required when LOGISTICS_DB_ENABLED=true."
    );
  }

  return { enabled: true, host, port, user, password, database };
}
