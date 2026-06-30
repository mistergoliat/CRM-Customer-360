export type DatabaseConnectionDetails = {
  host: string;
  port: number;
  database: string | null;
  user: string | null;
  password: string | null;
  url: string | null;
};

export type DatabaseEnvShape = Record<string, string | undefined>;

function parsePort(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clean(value: string | undefined | null) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function resolveWithAlias(env: DatabaseEnvShape, key: string, aliases: string[] = []) {
  const candidates = [...aliases, key];
  for (const candidate of candidates) {
    const value = clean(env[candidate]);
    if (value) return value;
  }
  return null;
}

export function parseDatabaseUrl(url: string) {
  const parsed = new URL(url);
  const database = clean(parsed.pathname.replace(/^\/+/, ""));
  return {
    url,
    host: clean(parsed.hostname) ?? "127.0.0.1",
    port: parsePort(parsed.port || undefined, 3306),
    database,
    user: clean(decodeURIComponent(parsed.username)),
    password: clean(decodeURIComponent(parsed.password))
  };
}

export function buildDatabaseUrl(input: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}) {
  const username = encodeURIComponent(input.user);
  const password = encodeURIComponent(input.password);
  return `mysql://${username}:${password}@${input.host}:${input.port}/${input.database}`;
}

export function resolveDatabaseConnectionFromEnv(
  env: DatabaseEnvShape = process.env,
  options: {
    urlKey?: string;
    hostKey?: string;
    portKey?: string;
    databaseKey?: string;
    userKey?: string;
    passwordKey?: string;
    defaultPort?: number;
    requireDatabase?: boolean;
  } = {}
): DatabaseConnectionDetails {
  const urlKey = options.urlKey ?? "DATABASE_URL";
  const hostKey = options.hostKey ?? "DATABASE_HOST";
  const portKey = options.portKey ?? "DATABASE_PORT";
  const databaseKey = options.databaseKey ?? "DATABASE_NAME";
  const userKey = options.userKey ?? "DATABASE_USER";
  const passwordKey = options.passwordKey ?? "DATABASE_PASSWORD";
  const defaultPort = options.defaultPort ?? 3306;
  const requireDatabase = options.requireDatabase ?? true;
  const aliasMap = new Map<string, string[]>([
    ["DATABASE_URL", ["DB_URL"]],
    ["DATABASE_HOST", ["DB_HOST"]],
    ["DATABASE_PORT", ["DB_PORT"]],
    ["DATABASE_NAME", ["DB_NAME"]],
    ["DATABASE_USER", ["DB_USER"]],
    ["DATABASE_PASSWORD", ["DB_PASSWORD"]],
    ["MIGRATION_DATABASE_URL", ["DB_URL"]],
    ["MIGRATION_DATABASE_HOST", ["DB_HOST"]],
    ["MIGRATION_DATABASE_PORT", ["DB_PORT"]],
    ["MIGRATION_DATABASE_NAME", ["DB_NAME"]],
    ["MIGRATION_DATABASE_USER", ["DB_USER"]],
    ["MIGRATION_DATABASE_PASSWORD", ["DB_PASSWORD"]],
    ["TEST_DATABASE_URL", ["DB_URL"]],
    ["TEST_DATABASE_HOST", ["DB_HOST"]],
    ["TEST_DATABASE_PORT", ["DB_PORT"]],
    ["TEST_DATABASE_NAME", ["DB_NAME"]],
    ["TEST_DATABASE_USER", ["DB_USER"]],
    ["TEST_DATABASE_PASSWORD", ["DB_PASSWORD"]],
    ["LEGACY_DATABASE_URL", ["DB_URL"]],
    ["LEGACY_DATABASE_HOST", ["DB_HOST"]],
    ["LEGACY_DATABASE_PORT", ["DB_PORT"]],
    ["LEGACY_DATABASE_NAME", ["DB_NAME"]],
    ["LEGACY_DATABASE_USER", ["DB_USER"]],
    ["LEGACY_DATABASE_PASSWORD", ["DB_PASSWORD"]]
  ]);

  const urlAliases = aliasMap.get(urlKey) ?? [];
  const hostAliases = aliasMap.get(hostKey) ?? [];
  const portAliases = aliasMap.get(portKey) ?? [];
  const databaseAliases = aliasMap.get(databaseKey) ?? [];
  const userAliases = aliasMap.get(userKey) ?? [];
  const passwordAliases = aliasMap.get(passwordKey) ?? [];
  const hasLocalDbOverride = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"].some((key) => clean(env[key]));

  const rawAliasUrl = clean(env.DB_URL);
  if (rawAliasUrl) {
    const parsed = parseDatabaseUrl(rawAliasUrl);
    if (env.NODE_ENV === "test" && parsed.database !== "crm_test") {
      throw new Error(`NODE_ENV=test requires crm_test, received ${parsed.database ?? "missing"}`);
    }
    return {
      ...parsed
    };
  }

  const rawUrl = !hasLocalDbOverride ? resolveWithAlias(env, urlKey, urlAliases) : null;
  if (rawUrl) {
    const parsed = parseDatabaseUrl(rawUrl);
    if (env.NODE_ENV === "test" && parsed.database !== "crm_test") {
      throw new Error(`NODE_ENV=test requires crm_test, received ${parsed.database ?? "missing"}`);
    }
    return {
      ...parsed
    };
  }

  const host = resolveWithAlias(env, hostKey, hostAliases) ?? clean(env.DB_HOST) ?? "127.0.0.1";
  const port = parsePort(resolveWithAlias(env, portKey, portAliases) ?? env.DB_PORT, defaultPort);
  const database = resolveWithAlias(env, databaseKey, databaseAliases) ?? clean(env.DB_NAME);
  const user = resolveWithAlias(env, userKey, userAliases) ?? clean(env.DB_USER);
  const password = resolveWithAlias(env, passwordKey, passwordAliases) ?? clean(env.DB_PASSWORD);

  if (requireDatabase && !database) {
    throw new Error(`Missing ${databaseKey}`);
  }
  if (!user) {
    throw new Error(`Missing ${userKey}`);
  }
  if (!password) {
    throw new Error(`Missing ${passwordKey}`);
  }
  if (env.NODE_ENV === "test" && database !== "crm_test") {
    throw new Error(`NODE_ENV=test requires crm_test, received ${database ?? "missing"}`);
  }

  return {
    host,
    port,
    database,
    user,
    password,
    url: database && user && password ? buildDatabaseUrl({ host, port, database, user, password }) : null
  };
}

export function resolveNamedDatabaseConnection(
  target: "app" | "migration" | "test" | "legacy" | "root",
  env: DatabaseEnvShape = process.env
): DatabaseConnectionDetails {
  switch (target) {
    case "migration":
      return resolveDatabaseConnectionFromEnv(env, {
        hostKey: "MIGRATION_DATABASE_HOST",
        portKey: "MIGRATION_DATABASE_PORT",
        databaseKey: "MIGRATION_DATABASE_NAME",
        userKey: "MIGRATION_DATABASE_USER",
        passwordKey: "MIGRATION_DATABASE_PASSWORD",
        urlKey: "MIGRATION_DATABASE_URL"
      });
    case "test":
      return resolveDatabaseConnectionFromEnv(env, {
        hostKey: "TEST_DATABASE_HOST",
        portKey: "TEST_DATABASE_PORT",
        databaseKey: "TEST_DATABASE_NAME",
        userKey: "TEST_DATABASE_USER",
        passwordKey: "TEST_DATABASE_PASSWORD",
        urlKey: "TEST_DATABASE_URL"
      });
    case "legacy":
      return resolveDatabaseConnectionFromEnv(env, {
        hostKey: "LEGACY_DATABASE_HOST",
        portKey: "LEGACY_DATABASE_PORT",
        databaseKey: "LEGACY_DATABASE_NAME",
        userKey: "LEGACY_DATABASE_USER",
        passwordKey: "LEGACY_DATABASE_PASSWORD",
        urlKey: "LEGACY_DATABASE_URL"
      });
    case "root":
      return {
        host: clean(env.MIGRATION_DATABASE_HOST) ?? clean(env.DATABASE_HOST) ?? clean(env.DB_HOST) ?? "127.0.0.1",
        port: parsePort(env.MIGRATION_DATABASE_PORT ?? env.DATABASE_PORT ?? env.DB_PORT, 3306),
        database: null,
        user: "root",
        password: clean(env.MARIADB_ROOT_PASSWORD),
        url: null
      };
    case "app":
    default:
      return resolveDatabaseConnectionFromEnv(env, {
        hostKey: "DATABASE_HOST",
        portKey: "DATABASE_PORT",
        databaseKey: "DATABASE_NAME",
        userKey: "DATABASE_USER",
        passwordKey: "DATABASE_PASSWORD",
        urlKey: "DATABASE_URL"
      });
  }
}

export function isLocalHost(host: string) {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost";
}

export function assertAllowedLocalDatabaseName(database: string) {
  const allowed = new Set(["main_management", "crm_dev", "crm_test", "crm_legacy_fixture"]);
  if (!allowed.has(database)) {
    throw new Error(`Database not allowed for local reset: ${database}`);
  }
}
