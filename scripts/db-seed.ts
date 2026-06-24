import { join } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectToTargetDatabase, fileExists, listSqlFiles, loadLocalEnv, runSqlFile } from "./db-utils";

type Target = "dev" | "test" | "legacy";

function parseTarget(argv: string[]): Target {
  const raw = argv.find((value) => value.startsWith("--database="));
  const target = raw ? raw.split("=", 2)[1] : "dev";
  if (target === "dev" || target === "test" || target === "legacy") return target;
  throw new Error(`Unsupported database target for seed: ${target}`);
}

async function seedTarget(target: Target) {
  const connection = await connectToTargetDatabase(target);
  try {
    if (target !== "legacy" && (await fileExists("database/fixtures/legacy-n8n-schema.sql"))) {
      await runSqlFile(connection, "database/fixtures/legacy-n8n-schema.sql");
    }

    if (target === "legacy") {
      if (await fileExists("database/fixtures/legacy-n8n-schema.sql")) {
        await runSqlFile(connection, "database/fixtures/legacy-n8n-schema.sql");
      }
      return;
    }

    const seedDir = `database/seeds/${target}`;
    const files = await listSqlFiles(seedDir);
    for (const file of files) {
      await runSqlFile(connection, join(seedDir, file));
    }
  } finally {
    await connection.end();
  }
}

export async function runSeeds(argv: string[] = process.argv.slice(2)) {
  await loadLocalEnv();
  const target = parseTarget(argv);
  await seedTarget(target);
  console.log(`Seed applied for ${target}`);
}

const isDirectRun = process.argv[1] ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) : false;

if (isDirectRun) {
  runSeeds().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
