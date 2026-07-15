/**
 * autonomous-outbox-worker
 *
 * Persistent process that drains brain_message_outbox in polling loops.
 * Designed to be run as a background service or via a process manager.
 *
 * Per-worker locking (via brain_message_outbox.locked_at + lock_seconds)
 * ensures multiple instances can run concurrently without double-sending.
 *
 * Flow per batch:
 *   planned row → locked (atomic SQL UPDATE)
 *               → sendMetaWhatsAppTextMessage (real Meta API)
 *               → sent / failed
 *               → crm_action_executions row written
 *               → crm_action_outcomes row written
 *               → crm_agent_actions status updated
 *
 * Usage:
 *   npm run worker:outbox
 *   npm run worker:outbox -- --batch-size=5 --poll-ms=3000 --dry-run
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadLocalEnv, loadEnvFile, PROJECT_ROOT } from "./db-utils";
import { loadOutboxWorkerRuntimeConfig, assertOutboxWorkerRuntimeConfigIsSafe } from "../lib/brain/runtime/autonomousRuntimeConfig";

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_POLL_MS = 4000;
const DEFAULT_LOCK_SECONDS = 90;
const DEFAULT_ALLOWED_WA_IDS: string[] = [];

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((v) => v.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

function readIntArg(name: string, fallback: number): number {
  const raw = readArg(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolArg(name: string, fallback = false): boolean {
  const raw = readArg(name) ?? (process.argv.includes(`--${name}`) ? "true" : null);
  if (raw === null) return fallback;
  return raw.toLowerCase() !== "false" && raw !== "0";
}

// ACS-R1-05-T06 (P1-5): this worker only reads configuration - it never
// writes to process.env, and an absent flag stays disabled. Real Meta send
// requires the operator to explicitly set BRAIN_META_SEND_ENABLED (and,
// per the pilot contract below, BRAIN_OUTBOX_WORKER_ENABLED/
// BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND + a non-empty allowlist) in
// .env/.env.local themselves.
async function loadRuntimeEnv() {
  await loadLocalEnv();
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env.local"), false);
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env"), false);
}

let workerRunning = true;
let poolClosed = false;

async function closeGracefully(pool: { end(): Promise<void> }) {
  if (poolClosed) return;
  poolClosed = true;
  workerRunning = false;
  try {
    await pool.end();
  } catch {
    // ignore
  }
}

/**
 * One polling tick — delegates to the shared runOutboxTick (lib), which owns
 * locking, ownership re-validation, window checks, retry/backoff and the
 * execution/outcome bookkeeping.
 */
async function runTick(options: {
  batchSize: number;
  lockSeconds: number;
  dryRun: boolean;
  allowedWaIds: string[];
  workerId: string;
}) {
  const { runOutboxTick } = await import("../lib/brain/messaging/autonomousOutboxTick");
  const result = await runOutboxTick({
    batchSize: options.batchSize,
    lockSeconds: options.lockSeconds,
    dryRun: options.dryRun,
    allowedWaIds: options.allowedWaIds,
    workerId: options.workerId,
    log: (message) => console.log(message)
  });
  if (result.retried > 0 || result.failed > 0 || result.cancelled > 0) {
    console.log(`[worker:outbox] tick summary sent=${result.sent} retried=${result.retried} failed=${result.failed} cancelled=${result.cancelled}`);
  }
  return result.processed;
}

async function main() {
  await loadRuntimeEnv();

  // Fail closed at startup, not per-message: real send authorized with an
  // empty allowlist is invalid pilot configuration, never "send to everyone".
  const runtimeConfig = loadOutboxWorkerRuntimeConfig();
  assertOutboxWorkerRuntimeConfigIsSafe(runtimeConfig);

  const batchSize = readIntArg("batch-size", DEFAULT_BATCH_SIZE);
  const pollMs = readIntArg("poll-ms", DEFAULT_POLL_MS);
  const lockSeconds = readIntArg("lock-seconds", DEFAULT_LOCK_SECONDS);
  const dryRun = readBoolArg("dry-run", false);
  const allowedWaIds = runtimeConfig.autonomousTestWaIds;
  const workerId = `outbox-worker-${randomUUID().slice(0, 8)}`;

  console.log(
    `[worker:outbox] starting workerId=${workerId} batchSize=${batchSize} pollMs=${pollMs} dryRun=${dryRun} ` +
      `outboxWorkerEnabled=${runtimeConfig.outboxWorkerEnabled} metaSendEnabled=${runtimeConfig.metaSendEnabled} ` +
      `allowRealSend=${runtimeConfig.outboxWorkerAllowRealSend}`
  );
  if (allowedWaIds.length > 0) {
    console.log(`[worker:outbox] allowlist: ${allowedWaIds.join(", ")}`);
  } else {
    console.log("[worker:outbox] WARNING: no BRAIN_AUTONOMOUS_TEST_WA_IDS set — will send to any wa_id in the outbox");
  }

  const { getPool } = await import("../lib/db");

  process.on("SIGINT", () => void closeGracefully(getPool()));
  process.on("SIGTERM", () => void closeGracefully(getPool()));

  while (workerRunning) {
    try {
      const count = await runTick({ batchSize, lockSeconds, dryRun, allowedWaIds, workerId });
      if (count > 0) console.log(`[worker:outbox] processed ${count} message(s)`);
    } catch (error) {
      console.error("[worker:outbox] tick error:", error instanceof Error ? error.message : String(error));
    }

    // Simple sleep between polls — avoids busy-wait without needing a scheduler
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }

  await closeGracefully(getPool());
  console.log(`[worker:outbox] stopped`);
}

main().catch((error) => {
  console.error("[worker:outbox] fatal:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
