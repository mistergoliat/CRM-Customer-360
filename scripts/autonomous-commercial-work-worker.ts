/**
 * autonomous-commercial-work-worker
 *
 * SALES-AGENT-R2-A11, Part 8. Persistent process that drains due R2
 * CommercialWork steps (RETRY_SCHEDULED / stale-locked RUNNING) via
 * runCommercialWorkTick (A06). Designed to run as a background service or
 * via a process manager, same shape as worker:outbox/worker:followup.
 *
 * Every tick is inert unless BRAIN_COMMERCIAL_WORK_WORKER_ENABLED=true - the
 * process can be started safely at any time; it will simply poll and do
 * nothing until an operator explicitly enables it (runCommercialWorkTick's
 * own gate, not duplicated here). Per-candidate, the tick additionally
 * revalidates BRAIN_AUTONOMOUS_RESPONSES_ENABLED, the WhatsApp access gate,
 * current R2 routing eligibility, and (if configured) the activation
 * cutoff - fresh every tick, never assumed from when the step was created.
 *
 * Never calls Meta directly - a completed step's customer-visible follow-on
 * (if any) flows through the same canonical action-queue -> execution-gate
 * -> brain_message_outbox -> transport-worker path every other production
 * path uses (see executeCommercialWork -> Capability Gateway; this worker
 * never writes to the outbox itself).
 *
 * Usage:
 *   npm run worker:commercial-work
 *   npm run worker:commercial-work -- --batch-size=10 --poll-ms=10000 --dry-run
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnvFile, PROJECT_ROOT } from "./db-utils";
import {
  loadCommercialWorkWorkerEnabled,
  loadAutonomousResponsesEnabled,
  loadWhatsAppAccessGateConfig,
  loadCommercialWorkWorkerActivationCutoff
} from "../lib/brain/runtime/autonomousRuntimeConfig";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_POLL_MS = 10_000;
const DEFAULT_LOCK_SECONDS = 60;

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

async function loadRuntimeEnv() {
  // Production workers use the deployment environment as the authoritative
  // source, same discipline as worker:outbox/worker:followup.
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env"), true);
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

async function runTick(options: { batchSize: number; lockSeconds: number; dryRun: boolean; workerId: string }) {
  const { runCommercialWorkTick } = await import("../lib/brain/commercial/work/worker/commercialWorkWorker");
  if (options.dryRun) {
    const { selectDueCommercialWorkSteps } = await import("../lib/brain/commercial/work/worker/commercialWorkWorker");
    const due = await selectDueCommercialWorkSteps({ limit: options.batchSize, now: new Date() });
    if (due.length > 0) console.log(`[worker:commercial-work] DRY RUN — ${due.length} due step(s), would tick`);
    return 0;
  }
  const result = await runCommercialWorkTick({
    batchSize: options.batchSize,
    lockSeconds: options.lockSeconds,
    workerId: options.workerId
  });
  if (result.selected > 0 || result.skipped.length > 0) {
    console.log(
      `[worker:commercial-work] tick summary selected=${result.selected} claimed=${result.claimed} executed=${result.executed} ` +
        `completed=${result.completed} retryScheduled=${result.retryScheduled} failed=${result.failed} staleRecovered=${result.staleRecovered} ` +
        `skipped=${result.skipped.length} versionConflicts=${result.versionConflicts.length}`
    );
    for (const skip of result.skipped) {
      console.log(`[worker:commercial-work] skipped ${skip.workPublicId}/${skip.stepId}: ${skip.reason}`);
    }
  }
  return result.claimed;
}

async function main() {
  await loadRuntimeEnv();

  const workerEnabled = loadCommercialWorkWorkerEnabled();
  const autonomyEnabled = loadAutonomousResponsesEnabled();
  const accessGate = loadWhatsAppAccessGateConfig();
  const activationCutoff = loadCommercialWorkWorkerActivationCutoff();

  const batchSize = readIntArg("batch-size", DEFAULT_BATCH_SIZE);
  const pollMs = readIntArg("poll-ms", DEFAULT_POLL_MS);
  const lockSeconds = readIntArg("lock-seconds", DEFAULT_LOCK_SECONDS);
  const dryRun = readBoolArg("dry-run", false);
  const workerId = `commercial-work-worker-${randomUUID().slice(0, 8)}`;

  console.log(
    `[worker:commercial-work] starting workerId=${workerId} batchSize=${batchSize} pollMs=${pollMs} dryRun=${dryRun} ` +
      `BRAIN_COMMERCIAL_WORK_WORKER_ENABLED=${workerEnabled} BRAIN_AUTONOMOUS_RESPONSES_ENABLED=${autonomyEnabled} ` +
      `BRAIN_WHATSAPP_TEST_MODE_ENABLED=${accessGate.testModeEnabled} testWaIdCount=${accessGate.testWaIds.length} ` +
      `activationCutoff=${activationCutoff ?? "(none)"}`
  );
  if (!workerEnabled) {
    console.log("[worker:commercial-work] BRAIN_COMMERCIAL_WORK_WORKER_ENABLED is not true - every tick will be a complete no-op until it is set.");
  }
  if (accessGate.testModeEnabled && accessGate.testWaIds.length === 0) {
    console.log("[worker:commercial-work] WARNING: TEST_MODE is on with an empty allowlist - every candidate will be skipped (fail-closed, not an error).");
  }

  const { getPool } = await import("../lib/db");

  process.on("SIGINT", () => void closeGracefully(getPool()));
  process.on("SIGTERM", () => void closeGracefully(getPool()));

  while (workerRunning) {
    try {
      await runTick({ batchSize, lockSeconds, dryRun, workerId });
    } catch (error) {
      console.error("[worker:commercial-work] tick error:", error instanceof Error ? error.message : String(error));
    }

    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }

  await closeGracefully(getPool());
  console.log("[worker:commercial-work] stopped");
}

main().catch((error) => {
  console.error("[worker:commercial-work] fatal:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
