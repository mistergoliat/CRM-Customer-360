import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RowDataPacket } from "mysql2/promise";
import { connectAsRoot, connectToTargetDatabase, getTargetDatabaseName, listSqlFiles, loadLocalEnv } from "./db-utils";
import { validateMigrationManifest } from "./migration-manifest";

type Target = "dev" | "test";

function parseTarget(argv: string[]): Target {
  const raw = argv.find((value) => value.startsWith("--database="));
  const target = raw ? raw.split("=", 2)[1] : "dev";
  if (target === "dev" || target === "test") return target;
  throw new Error(`Unsupported database target for migrations: ${target}`);
}

function checksum(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function ensureSchemaMigrationsTable(connection: Awaited<ReturnType<typeof connectToTargetDatabase>>) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(32) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      execution_ms INT UNSIGNED NOT NULL,
      PRIMARY KEY (filename),
      UNIQUE KEY uq_schema_migrations_version (version),
      KEY idx_schema_migrations_applied_at (applied_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function runMigrations(argv: string[] = process.argv.slice(2)) {
  await loadLocalEnv();
  const target = parseTarget(argv);
  const database = getTargetDatabaseName(target);

  // Validate the manifest before touching any database - a duplicate version
  // must never partially apply DDL before failing (ACS-R1-04-T06.2).
  const migrations = await listSqlFiles("migrations");
  validateMigrationManifest(migrations);

  const rootConnection = await connectAsRoot();
  try {
    await rootConnection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await rootConnection.end();
  }

  const connection = await connectToTargetDatabase(target);
  try {
    await ensureSchemaMigrationsTable(connection);
    const [appliedRows] = await connection.query<RowDataPacket[]>(
      "SELECT version, filename, checksum FROM schema_migrations ORDER BY filename ASC"
    );
    const applied = new Map(appliedRows.map((row) => [row.filename, row]));
    let appliedCount = 0;

    for (const filename of migrations) {
      const filePath = `migrations/${filename}`;
      const sql = await runSqlFileText(filePath);
      const digest = checksum(sql);
      const version = filename.match(/^(\d+)/)?.[1] ?? filename;
      const existing = applied.get(filename);
      if (existing) {
        if (existing.checksum !== digest) {
          throw new Error(`Migration checksum mismatch for ${filename}`);
        }
        console.log(`[skip] ${filename}`);
        continue;
      }

      const startedAt = Date.now();
      console.log(`[run ] ${filename}`);
      await connection.query(sql);
      const executionMs = Date.now() - startedAt;
      await connection.query(
        "INSERT INTO schema_migrations (version, filename, checksum, applied_at, execution_ms) VALUES (?, ?, ?, NOW(), ?)",
        [version, filename, digest, executionMs]
      );
      appliedCount += 1;
      console.log(`[done] ${filename} (${executionMs}ms)`);
    }

    const pendingCount = Math.max(0, migrations.length - appliedRows.length - appliedCount);
    console.log(`Applied: ${appliedCount}`);
    console.log(`Pending: ${pendingCount}`);
  } finally {
    await connection.end();
  }
}

async function runSqlFileText(relativePath: string) {
  const sql = await readFile(path.resolve(process.cwd(), relativePath), "utf8");
  return sql;
}

const isDirectRun = process.argv[1] ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) : false;

if (isDirectRun) {
  runMigrations().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
