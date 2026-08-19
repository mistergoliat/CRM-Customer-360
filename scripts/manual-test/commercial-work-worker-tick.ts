/**
 * SALES-AGENT-R2-A08.5, Parts 18/28. One-shot manual invocation of the A06
 * CommercialWork retry worker tick (runCommercialWorkTick). Dev/manual use
 * only - never added to any cron/pm2/startup config. Production worker
 * activation stays NO; this script exists solely so a due WAITING_SYSTEM/
 * RETRY_SCHEDULED step can be advanced on demand during controlled
 * validation, exactly as a real restarted worker process would.
 *
 * Usage:
 *   npx tsx scripts/manual-test/commercial-work-worker-tick.ts [--work=<publicId>[,<publicId>...]] [--batch-size=5]
 */
import path from "node:path";
import { loadLocalEnv, loadEnvFile, PROJECT_ROOT } from "../db-utils";

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

async function main() {
  await loadLocalEnv();
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env.local"), false);
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env"), false);
  Object.assign(process.env, { DB_WRITE_ENABLED: "true" });

  const { runCommercialWorkTick } = await import("../../lib/brain/commercial/work");
  const { getPool } = await import("../../lib/db");

  const workPublicIds = readArg("work")?.split(",").map((value) => value.trim());
  const batchSize = Number.parseInt(readArg("batch-size") ?? "5", 10);

  console.log(`[commercial-work-worker-tick] starting (batchSize=${batchSize}${workPublicIds ? `, restricted to ${workPublicIds.join(",")}` : ""})`);
  const result = await runCommercialWorkTick({
    now: new Date(),
    workPublicIds,
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : undefined
  });
  console.log(JSON.stringify(result, null, 2));

  await getPool().end();
}

main().catch((error) => {
  console.error("[commercial-work-worker-tick] fatal:", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
