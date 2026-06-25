import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RowDataPacket } from "mysql2/promise";
import { sanitizeDbError } from "../lib/db";
import { connectToTargetDatabase, getTargetDatabaseName, loadLocalEnv, resolveAppConnection } from "./db-utils";

const execFileAsync = promisify(execFile);

type Target = "dev" | "test" | "legacy";

function parseTarget(argv: string[]): Target {
  const raw = argv.find((value) => value.startsWith("--database="));
  const target = raw ? raw.split("=", 2)[1] : "dev";
  if (target === "dev" || target === "test" || target === "legacy") return target;
  throw new Error(`Unsupported database target for status: ${target}`);
}

async function inspectContainer() {
  try {
    const { stdout } = await execFileAsync("docker", [
      "inspect",
      "crm-customer-360-mariadb",
      "--format",
      "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}|{{.Config.Image}}"
    ]);
    const [state, health, image] = stdout.trim().split("|");
    return { state, health, image };
  } catch {
    return { state: "unavailable", health: "unknown", image: "unknown" };
  }
}

async function countMigrationFiles() {
  const migrationFiles = await readdir(path.resolve(process.cwd(), "migrations"));
  return migrationFiles.filter((file) => file.toLowerCase().endsWith(".sql")).length;
}

async function showStatus(target: Target) {
  const container = await inspectContainer();
  const appConnection = resolveAppConnection();

  console.log(`container state: ${container.state}`);
  console.log(`container health: ${container.health}`);
  console.log(`image: ${container.image}`);
  console.log(`database connection: ${appConnection.host}:${appConnection.port}/${getTargetDatabaseName(target)}`);

  let connection;
  try {
    connection = await connectToTargetDatabase(target);
  } catch (error) {
    const pending = await countMigrationFiles().catch(() => 0);
    console.log("database connection status: unavailable");
    console.log(`connection error: ${sanitizeDbError(error)}`);
    console.log("MariaDB version: unknown");
    console.log("selected database: unknown");
    console.log("applied migrations: 0");
    console.log(`pending migrations: ${pending}`);
    console.log("current user: unknown");
    console.log("write capability: unavailable");
    return;
  }

  try {
    const [versionRows] = await connection.query<RowDataPacket[]>("SELECT VERSION() AS version");
    const [databaseRows] = await connection.query<
      RowDataPacket[]
    >("SELECT DATABASE() AS selected_database, CURRENT_USER() AS db_current_user, USER() AS login_user, @@read_only AS read_only");
    const [migrationsRows] = await connection.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM schema_migrations");
    const applied = Number(migrationsRows[0]?.total ?? 0);
    const pending = (await countMigrationFiles()) - applied;
    const [grantRows] = await connection.query<RowDataPacket[]>("SHOW GRANTS");
    const grantText = grantRows.map((row) => Object.values(row).join(" ")).join(" ");
    const writeCapability = /INSERT/i.test(grantText) && /UPDATE/i.test(grantText) && /DELETE/i.test(grantText) ? "available" : "restricted";
    console.log(`MariaDB version: ${versionRows[0]?.version ?? "unknown"}`);
    console.log(`selected database: ${databaseRows[0]?.selected_database ?? "unknown"}`);
    console.log(`applied migrations: ${applied}`);
    console.log(`pending migrations: ${Math.max(0, pending)}`);
    console.log(`current user: ${databaseRows[0]?.db_current_user ?? "unknown"}`);
    console.log(`write capability: ${writeCapability}`);
  } finally {
    await connection.end();
  }
}

async function main() {
  await loadLocalEnv();
  const target = parseTarget(process.argv.slice(2));
  await showStatus(target);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
