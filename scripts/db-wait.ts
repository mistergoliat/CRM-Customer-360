import { setTimeout as delay } from "node:timers/promises";
import type { RowDataPacket } from "mysql2/promise";
import { connectToTargetDatabase, getTargetDatabaseName, loadLocalEnv } from "./db-utils";

type Target = "dev" | "test" | "legacy";

function parseTarget(argv: string[]): Target {
  const raw = argv.find((value) => value.startsWith("--database="));
  const target = raw ? raw.split("=", 2)[1] : "dev";
  if (target === "dev" || target === "test" || target === "legacy") return target;
  throw new Error(`Unsupported database target for wait: ${target}`);
}

function parseTimeout(argv: string[]) {
  const raw = argv.find((value) => value.startsWith("--timeout-ms="));
  const timeout = raw ? Number(raw.split("=", 2)[1]) : 60000;
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 60000;
}

async function waitForDatabase(target: Target, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  const dbName = getTargetDatabaseName(target);
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const connection = await connectToTargetDatabase(target);
      try {
        await connection.query("SELECT 1");
        const [rows] = await connection.query<RowDataPacket[]>("SELECT DATABASE() AS database_name");
        if (rows[0]?.database_name === dbName) {
          return;
        }
      } finally {
        await connection.end();
      }
    } catch (error) {
      lastError = error;
    }

    await delay(1000);
  }

  throw new Error(`MariaDB did not become ready within ${timeoutMs}ms${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ""}`);
}

async function main() {
  await loadLocalEnv();
  const target = parseTarget(process.argv.slice(2));
  const timeoutMs = parseTimeout(process.argv.slice(2));
  await waitForDatabase(target, timeoutMs);
  console.log(`MariaDB ready for ${target}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
