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

import { loadProductionEnv } from "./db-utils";

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

let workerRunning = true;

// The turn-settlement barrel (lib/brain/commercial/turn-settlement/index.ts)
// only ever declares named exports - its static type has no `default`.
// At runtime, dynamic `import()` of a CJS-compiled module can still come
// back either as that flat named-exports object OR wrapped as
// `{ default: <that same object> }`, depending on the exact ESM/CJS interop
// path the running environment takes (observed divergence: local tsx vs.
// EC2). Both shapes must keep working - this type only teaches TypeScript
// about the shape runtime already tolerates; it changes no behavior.
type TurnSettlementModule = typeof import("../lib/brain/commercial/turn-settlement");
type TurnSettlementModuleInterop = TurnSettlementModule | { default: TurnSettlementModule };

function hasWrappedDefault(value: TurnSettlementModuleInterop): value is { default: TurnSettlementModule } {
  const candidate = (value as { default?: unknown }).default;
  return Boolean(candidate) && typeof candidate === "object";
}

async function loadTurnSettlementModule(): Promise<TurnSettlementModule> {
  const imported = (await import("../lib/brain/commercial/turn-settlement")) as TurnSettlementModuleInterop;
  return hasWrappedDefault(imported) ? imported.default : imported;
}

async function runTick(limit: number) {
  const turnSettlement = await loadTurnSettlementModule();
  const result = await turnSettlement.runTurnSettleTick({ limit });

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
  await loadProductionEnv();

  const pollMs = readIntArg("poll-ms", DEFAULT_POLL_MS);
  const limit = readIntArg("limit", DEFAULT_LIMIT);

  const turnSettlement = await loadTurnSettlementModule();
  const config = turnSettlement.loadTurnSettlementConfig();
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
