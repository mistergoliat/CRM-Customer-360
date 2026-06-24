import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import mysql, { type Connection } from "mysql2/promise";
import {
  assertAllowedLocalDatabaseName,
  isLocalHost,
  resolveNamedDatabaseConnection,
  type DatabaseConnectionDetails
} from "../lib/database-config";

export type DatabaseTarget = "dev" | "test" | "legacy";

export const PROJECT_ROOT = process.cwd();

export async function loadEnvFile(filePath: string, overwrite = false) {
  try {
    const raw = await readFile(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const key = match[1];
      let value = match[2] ?? "";
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (overwrite || process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  } catch {
    return;
  }
}

export async function loadLocalEnv() {
  await loadEnvFile(path.resolve(PROJECT_ROOT, "infra/.env"), true);
}

export function getTargetDatabaseName(target: DatabaseTarget) {
  switch (target) {
    case "test":
      return "crm_test";
    case "legacy":
      return "crm_legacy_fixture";
    case "dev":
    default:
      return "crm_dev";
  }
}

export function assertSafeLocalTarget(target: DatabaseTarget, host: string, database: string) {
  if (!isLocalHost(host)) {
    throw new Error(`Refusing to operate on non-local host: ${host}`);
  }
  assertAllowedLocalDatabaseName(database);
  if (target === "legacy" && database !== "crm_legacy_fixture") {
    throw new Error(`Legacy reset must target crm_legacy_fixture, received ${database}`);
  }
}

export function resolveAppConnection(env: NodeJS.ProcessEnv = process.env) {
  return resolveNamedDatabaseConnection("app", env);
}

export function resolveMigrationConnection(database: string, env: NodeJS.ProcessEnv = process.env) {
  const base = resolveNamedDatabaseConnection("migration", env);
  return { ...base, database };
}

export function resolveRootConnection(env: NodeJS.ProcessEnv = process.env) {
  return resolveNamedDatabaseConnection("root", env);
}

export async function createConnection(details: DatabaseConnectionDetails, multipleStatements = true) {
  if (!details.password) {
    throw new Error(`Missing password for ${details.user ?? "connection"}`);
  }

  const connection = await mysql.createConnection({
    host: details.host,
    port: details.port,
    user: details.user ?? undefined,
    password: details.password,
    database: details.database ?? undefined,
    multipleStatements
  });

  return connection;
}

export async function connectToTargetDatabase(target: DatabaseTarget, env: NodeJS.ProcessEnv = process.env) {
  const database = getTargetDatabaseName(target);
  const connection = resolveMigrationConnection(database, env);
  assertSafeLocalTarget(target, connection.host, database);
  return createConnection(connection, true);
}

export async function connectAsRoot(env: NodeJS.ProcessEnv = process.env) {
  const connection = resolveRootConnection(env);
  if (!connection.password) {
    throw new Error("Missing MARIADB_ROOT_PASSWORD");
  }
  if (!isLocalHost(connection.host)) {
    throw new Error(`Refusing to use root on non-local host: ${connection.host}`);
  }
  return createConnection(connection, true);
}

export async function readSqlFile(relativePath: string) {
  return readFile(path.resolve(PROJECT_ROOT, relativePath), "utf8");
}

export async function listSqlFiles(relativeDir: string) {
  const absoluteDir = path.resolve(PROJECT_ROOT, relativeDir);
  const entries = await readdir(absoluteDir);
  return entries.filter((file) => file.toLowerCase().endsWith(".sql")).sort((left, right) => left.localeCompare(right));
}

export async function runSqlFile(connection: Connection, relativePath: string) {
  const sql = await readSqlFile(relativePath);
  await connection.query(sql);
}

export async function fileExists(relativePath: string) {
  try {
    await stat(path.resolve(PROJECT_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function ensureDatabaseExists(connection: Connection, database: string) {
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
}

export async function dropDatabase(connection: Connection, database: string) {
  await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
}

