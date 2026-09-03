/**
 * autonomous-turn-settle-worker
 *
 * Polls crm_inbound_turn_settlements for PENDING rows whose settle_after has
 * passed (quiet window or max window closed) and for PROCESSING rows
 * abandoned by a crashed worker, executes exactly one R3 cognition cycle per
 * settled turn (aggregating every WhatsApp fragment the turn collected), and
 * writes a terminal COMPLETED/SUPERSEDED status. See
 * docs/releases/SALES-AGENT-R3-V1.8.1-CONVERSATIONAL-TURN-SETTLING.md.
 *
 * Only relevant when BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS > 0 - at the
 * default (0) the webhook itself runs cognition synchronously and this
 * worker has nothing to poll (selectDuePendingTurns/selectStaleProcessingTurns
 * always return empty, since no PENDING row is ever created at delay=0).
 *
 * Usage:
 *   npm run worker:turn-settle
 *   npm run worker:turn-settle -- --poll-ms=1000 --limit=20
 */

import path from "node:path";
import { loadEnvFile, PROJECT_ROOT } from "./db-utils";

const DEFAULT_POLL_MS = 1000; // settle windows are seconds-scale, unlike the 30s follow-up worker
const DEFAULT_LIMIT = 20;

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

async function loadRuntimeEnv() {
  // Same convention as worker:followup/worker:outbox/worker:commercial-work -
  // the deployment environment (.env) is authoritative for a production
  // worker process, never infra/.env's local-Docker DB_* values.
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env"), true);
}

let workerRunning = true;

async function runTick(limit: number) {
  const { runTurnSettleTick } = await import("../lib/brain/commercial/turn-settlement");
  const result = await runTurnSettleTick({ limit });
  if (result.processed > 0) {
    console.log(
      `[worker:turn-settle] tick summary processed=${result.processed} settled=${result.settled} superseded=${result.superseded} reclaimed=${result.reclaimed} failed=${result.failed}`
    );
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

  const { loadTurnSettlementConfig } = await import("../lib/brain/commercial/turn-settlement");
  const config = loadTurnSettlementConfig();
  console.log(
    `[worker:turn-settle] starting — pollMs=${pollMs} limit=${limit} settleDelayMs=${config.settleDelayMs} maxSettleMs=${config.maxSettleMs}`
  );
  if (config.settleDelayMs <= 0) {
    console.log("[worker:turn-settle] BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS=0 - no pending turns will ever be created; this worker will idle.");
  }

  process.on("SIGINT", () => void closeGracefully());
  process.on("SIGTERM", () => void closeGracefully());

  while (workerRunning) {
    try {
      await runTick(limit);
    } catch (error) {
      console.error("[worker:turn-settle] tick error:", error instanceof Error ? error.message : String(error));
    }

    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }

  await closeGracefully();
  console.log("[worker:turn-settle] stopped");
}

main().catch((error) => {
  console.error("[worker:turn-settle] fatal:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
