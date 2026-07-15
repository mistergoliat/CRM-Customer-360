/**
 * autonomous-followup-worker
 *
 * Polls crm_agent_actions for schedule_followup rows whose scheduled_for has
 * passed and re-enters them into the autonomous commercial cycle as a new
 * CommercialEvent — NOT by building the message inline.
 *
 * Cancellation rules (checked before re-entry):
 *   - customer replied since the follow-up was scheduled → cancel
 *   - opportunity status changed to terminal (won/lost/cancelled) → cancel
 *   - action already in executed/cancelled/failed state → skip
 *   - scheduled_for not yet reached → skip
 *
 * Each follow-up produces exactly one new inbound-shaped cycle run.
 * Idempotency: the action status is moved to 'executing' atomically before
 * calling the cycle, and to 'executed' or 'failed' afterward.
 *
 * Usage:
 *   npm run worker:followup
 *   npm run worker:followup -- --poll-ms=30000 --limit=10 --dry-run
 */

import path from "node:path";
import { loadLocalEnv, loadEnvFile, PROJECT_ROOT } from "./db-utils";

const DEFAULT_POLL_MS = 30000; // check every 30s — don't need sub-minute precision
const DEFAULT_LIMIT = 5;

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
// writes to process.env. Re-entering the autonomous cycle on each due
// follow-up requires the operator to explicitly enable the commercial
// pipeline (BRAIN_SALES_AGENT_ENABLED, BRAIN_COMMERCIAL_*, BRAIN_EXECUTION_
// GATE_ENABLED, BRAIN_OUTBOX_BRIDGE_ENABLED, etc.) in .env/.env.local
// themselves; an unset flag stays disabled, same as any other process.
async function loadRuntimeEnv() {
  await loadLocalEnv();
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env.local"), false);
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env"), false);
}

const AUTONOMOUS_CYCLE_STATUS_FLAGS = [
  "BRAIN_SALES_AGENT_ENABLED",
  "BRAIN_SALES_AGENT_DRY_RUN",
  "BRAIN_COMMERCIAL_SHADOW_ENABLED",
  "BRAIN_COMMERCIAL_RUNTIME_ENABLED",
  "BRAIN_COMMERCIAL_POLICY_ENABLED",
  "BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER",
  "BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED",
  "BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED",
  "BRAIN_AGENT_ACTION_QUEUE_ENABLED",
  "BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED",
  "BRAIN_EXECUTION_GATE_ENABLED",
  "BRAIN_OUTBOX_BRIDGE_ENABLED",
  "BRAIN_AUTONOMOUS_REPLY_ENABLED"
] as const;

/** Read-only startup summary so an operator can see what the re-entered cycle will actually do - never mutates process.env. */
function logAutonomousCycleStatus() {
  const summary = AUTONOMOUS_CYCLE_STATUS_FLAGS.map((key) => `${key}=${process.env[key]?.trim() || "(unset)"}`).join(" ");
  console.log(`[worker:followup] autonomous cycle config: ${summary}`);
}

let workerRunning = true;

async function runTick(options: { limit: number; dryRun: boolean }) {
  const { runFollowupTick } = await import("../lib/brain/commercial/followup/runFollowupTick");
  const result = await runFollowupTick({
    limit: options.limit,
    dryRun: options.dryRun,
    log: (message) => console.log(message)
  });
  if (result.cancelled.length > 0 || result.failed.length > 0) {
    console.log(`[worker:followup] tick summary executed=${result.executed.length} cancelled=${result.cancelled.length} failed=${result.failed.length}`);
  }
  return result.processed;
}

let poolClosed = false;

async function closeGracefully() {
  if (poolClosed) return;
  poolClosed = true;
  workerRunning = false;
  try {
    const { getPool } = await import("../lib/db");
    await getPool().end();
  } catch {
    // ignore
  }
}

async function main() {
  await loadRuntimeEnv();

  const pollMs = readIntArg("poll-ms", DEFAULT_POLL_MS);
  const limit = readIntArg("limit", DEFAULT_LIMIT);
  const dryRun = readBoolArg("dry-run", false);

  console.log(`[worker:followup] starting — pollMs=${pollMs} limit=${limit} dryRun=${dryRun}`);
  logAutonomousCycleStatus();

  process.on("SIGINT", () => void closeGracefully());
  process.on("SIGTERM", () => void closeGracefully());

  while (workerRunning) {
    try {
      const count = await runTick({ limit, dryRun });
      if (count > 0) console.log(`[worker:followup] processed ${count} follow-up(s)`);
    } catch (error) {
      console.error("[worker:followup] tick error:", error instanceof Error ? error.message : String(error));
    }

    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }

  await closeGracefully();
  console.log("[worker:followup] stopped");
}

main().catch((error) => {
  console.error("[worker:followup] fatal:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
