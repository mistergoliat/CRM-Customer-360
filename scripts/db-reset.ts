import { connectAsRoot, dropDatabase, ensureDatabaseExists, getTargetDatabaseName, loadLocalEnv, runSqlFile } from "./db-utils";
import { runMigrations } from "./db-migrate";
import { runSeeds } from "./db-seed";

type Target = "dev" | "test" | "legacy";

function parseTarget(argv: string[]): Target {
  const raw = argv.find((value) => value.startsWith("--database="));
  const target = raw ? raw.split("=", 2)[1] : "dev";
  if (target === "dev" || target === "test" || target === "legacy") return target;
  throw new Error(`Unsupported database target for reset: ${target}`);
}

async function resetTarget(target: Target) {
  const database = getTargetDatabaseName(target);
  const root = await connectAsRoot();
  try {
    await dropDatabase(root, database);
    await ensureDatabaseExists(root, database);
    if (target === "legacy") {
      await root.query(`USE \`${database}\``);
      await runSqlFile(root, "database/fixtures/legacy-n8n-schema.sql");
    }
  } finally {
    await root.end();
  }
}

async function main() {
  await loadLocalEnv();
  const target = parseTarget(process.argv.slice(2));
  await resetTarget(target);

  if (target === "dev" || target === "test") {
    await runMigrations([`--database=${target}`]);
    await runSeeds([`--database=${target}`]);
  }

  console.log(`Reset completed for ${target}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
