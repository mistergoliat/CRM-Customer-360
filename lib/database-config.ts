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

  const rawUrl = clean(env[urlKey]);
  if (rawUrl) {
    const parsed = parseDatabaseUrl(rawUrl);
    if (env.NODE_ENV === "test" && parsed.database !== "crm_test") {
      throw new Error(`NODE_ENV=test requires crm_test, received ${parsed.database ?? "missing"}`);
    }
    return {
      ...parsed
    };
  }

  const host = clean(env[hostKey]) ?? "127.0.0.1";
  const port = parsePort(env[portKey], defaultPort);
  const database = clean(env[databaseKey]);
  const user = clean(env[userKey]);
  const password = clean(env[passwordKey]);

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
        host: clean(env.MIGRATION_DATABASE_HOST) ?? clean(env.DATABASE_HOST) ?? "127.0.0.1",
        port: parsePort(env.MIGRATION_DATABASE_PORT ?? env.DATABASE_PORT, 3306),
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
  const allowed = new Set(["crm_dev", "crm_test", "crm_legacy_fixture"]);
  if (!allowed.has(database)) {
    throw new Error(`Database not allowed for local reset: ${database}`);
  }
}
