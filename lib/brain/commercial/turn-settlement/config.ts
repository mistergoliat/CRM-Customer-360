// SALES-AGENT-R3-V1.8.1. Read-only env config for inbound turn settling -
// never mutated, never read anywhere except here (same discipline as
// commercialCycleConfig.ts's own build*FeatureFlags functions).

export const DEFAULT_TURN_SETTLE_DELAY_MS = 0;
export const DEFAULT_TURN_SETTLE_MAX_MS = 5000;

/** A worker crash leaves a row PROCESSING forever unless a later tick reclaims it - long enough to cover real DeepSeek + tool-loop latency, short enough to recover quickly after a real crash (Section S). */
export const TURN_SETTLE_STALE_PROCESSING_LOCK_SECONDS = 120;

function readPositiveIntMs(value: string | undefined, fallback: number): number {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export type TurnSettlementConfig = {
  /** 0 = exact current (pre-V1.8.1) behavior: no pending-turn row is ever created, no aggregation, no extra wait (Section D, the rollback path). */
  settleDelayMs: number;
  /** Absolute ceiling on how long a pending turn may keep being extended by new fragments - always >= settleDelayMs in effect (see resolveEffectiveMaxSettleMs). */
  maxSettleMs: number;
};

/**
 * BRAIN_R3_INBOUND_TURN_SETTLE_MAX_MS below settleDelayMs would make the max
 * window meaningless (every turn would always hit the max before the quiet
 * window could ever fire) - clamped up to settleDelayMs rather than treated
 * as a misconfiguration, so a single explicit value at rollout, then a later
 * override of only the delay, cannot silently produce a max-only turn.
 */
export function loadTurnSettlementConfig(): TurnSettlementConfig {
  const settleDelayMs = readPositiveIntMs(process.env.BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS, DEFAULT_TURN_SETTLE_DELAY_MS);
  const configuredMaxMs = readPositiveIntMs(process.env.BRAIN_R3_INBOUND_TURN_SETTLE_MAX_MS, DEFAULT_TURN_SETTLE_MAX_MS);
  const maxSettleMs = Math.max(configuredMaxMs, settleDelayMs);
  return { settleDelayMs, maxSettleMs };
}

/** Independent of settleDelayMs by design (Section AA) - typing can be piloted or rolled back without touching the settle window, and vice versa. */
export function isTypingIndicatorEnabled(): boolean {
  return process.env.BRAIN_WHATSAPP_TYPING_INDICATOR_ENABLED?.trim() === "true";
}
