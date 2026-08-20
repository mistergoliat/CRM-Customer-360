import { normalizeWhatsAppRecipientDigits } from "@/lib/brain/messaging/whatsapp-transport/constants";

/**
 * Canonical, fail-closed reader for the autonomous runtime's productive
 * safety flags (ACS-R1-05-T06/T06.1, P1-5). A process reads this exactly
 * once at startup - it never writes to process.env, and never lets an
 * absent flag silently become "enabled". Unlike commercialCycleConfig.ts's
 * readEnvFlag (which falls back silently on a malformed value, correct for
 * feature flags), the flags read here gate real Meta sends and pilot
 * isolation during a controlled pilot, so a malformed value is a
 * configuration error, not a soft default.
 */

export class AutonomousRuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutonomousRuntimeConfigError";
  }
}

function readStrictBooleanFlagWithDefault(name: string, env: NodeJS.ProcessEnv, defaultValue: boolean): boolean {
  const raw = env[name];
  if (raw === undefined) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new AutonomousRuntimeConfigError(`${name} must be "true" or "false" (received ${JSON.stringify(raw)}).`);
}

function readStrictBooleanFlag(name: string, env: NodeJS.ProcessEnv): boolean {
  return readStrictBooleanFlagWithDefault(name, env, false);
}

/**
 * Same digit normalization used by the final defense before transport
 * (metaClient.ts's getAllowedRecipients) - an allowlist entry and an
 * inbound wa_id must compare equal regardless of "+"/spaces/dashes/parens
 * formatting differences between the two.
 */
function readWaIdAllowlist(name: string, env: NodeJS.ProcessEnv): string[] {
  const raw = env[name];
  if (!raw) return [];
  const normalized = raw
    .split(",")
    .map((item) => normalizeWhatsAppRecipientDigits(item))
    .filter((item): item is string => Boolean(item));
  return [...new Set(normalized)];
}

/** BRAIN_AUTONOMOUS_TEST_WA_IDS, digit-normalized and deduped. Empty means "no pilot restriction configured". */
export function loadAutonomousPilotAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  return readWaIdAllowlist("BRAIN_AUTONOMOUS_TEST_WA_IDS", env);
}

/**
 * SALES-AGENT-R2-A08.5. BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS, digit-normalized
 * and deduped - a dedicated allowlist for the CommercialWork (R2) production
 * routing gate, deliberately independent of BRAIN_AUTONOMOUS_TEST_WA_IDS (the
 * multi-intent pilot's own allowlist) so enabling one pilot never silently
 * enables the other. Empty means "nobody routed", same fail-closed semantics
 * shouldRouteToCommercialWork requires.
 */
export function loadCommercialWorkRuntimeAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  return readWaIdAllowlist("BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS", env);
}

/**
 * Whether waId is authorized to receive any autonomous side effect (LLM
 * call, action creation, follow-up claim, outbox claim, Meta send) during
 * the pilot. An empty allowlist means no restriction is configured (normal
 * pre-pilot/post-pilot behavior, preserved for every existing caller that
 * never sets BRAIN_AUTONOMOUS_TEST_WA_IDS). A non-empty allowlist is strict:
 * only a wa_id that normalizes to one of its entries is authorized.
 * Normalizes allowlist entries defensively too, so a caller that passes a
 * raw (non-loadAutonomousPilotAllowlist-sourced) array still compares
 * correctly against a digit-normalized waId.
 */
export function isWaIdAuthorizedForPilot(waId: string | null | undefined, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const normalized = normalizeWhatsAppRecipientDigits(waId ?? null);
  if (normalized === null) return false;
  const normalizedAllowlist = allowlist
    .map((entry) => normalizeWhatsAppRecipientDigits(entry))
    .filter((entry): entry is string => entry !== null);
  return normalizedAllowlist.includes(normalized);
}

export type OutboxWorkerRuntimeConfig = {
  outboxWorkerEnabled: boolean;
  metaSendEnabled: boolean;
  outboxWorkerAllowRealSend: boolean;
  autonomousTestWaIds: string[];
};

/** Reads BRAIN_OUTBOX_WORKER_ENABLED / BRAIN_META_SEND_ENABLED / BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND / BRAIN_AUTONOMOUS_TEST_WA_IDS once. Pass a snapshot env for tests. */
export function loadOutboxWorkerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): OutboxWorkerRuntimeConfig {
  return {
    outboxWorkerEnabled: readStrictBooleanFlag("BRAIN_OUTBOX_WORKER_ENABLED", env),
    metaSendEnabled: readStrictBooleanFlag("BRAIN_META_SEND_ENABLED", env),
    outboxWorkerAllowRealSend: readStrictBooleanFlag("BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND", env),
    autonomousTestWaIds: loadAutonomousPilotAllowlist(env)
  };
}

export function isOutboxRealSendAuthorized(config: OutboxWorkerRuntimeConfig): boolean {
  return config.outboxWorkerEnabled && config.metaSendEnabled && config.outboxWorkerAllowRealSend;
}

/**
 * Pilot invariant (ACS-R1-05-T06 section 6): real send authorized with an
 * empty allowlist is invalid configuration, not "send to everyone" - the
 * worker must refuse to start rather than silently widen its blast radius.
 */
export function assertOutboxWorkerRuntimeConfigIsSafe(config: OutboxWorkerRuntimeConfig): void {
  if (isOutboxRealSendAuthorized(config) && config.autonomousTestWaIds.length === 0) {
    throw new AutonomousRuntimeConfigError(
      "Real send is authorized (BRAIN_OUTBOX_WORKER_ENABLED=true, BRAIN_META_SEND_ENABLED=true, " +
        "BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND=true) but BRAIN_AUTONOMOUS_TEST_WA_IDS is empty. During the " +
        "controlled pilot this is invalid configuration, not an unrestricted send - refusing to start."
    );
  }
}

/**
 * The five structural gates that must move together for the follow-up
 * worker's re-entry into the autonomous cycle to be coherent end-to-end
 * (schedule_followup -> re-entry -> shadow/loop -> action queue ->
 * execution gate -> outbox). Mirrors the exact code-level gates in
 * runNativeAutonomousCycle.ts (isAutonomyCycleEnabled,
 * loopFlags.commercialOperationalLoopEnabled) and runCommercialExecutionBridge.ts
 * (actionQueueEnabled/executionGateEnabled/outboxBridgeEnabled).
 */
const FOLLOW_UP_WORKER_CHAIN_FLAGS = [
  "BRAIN_SALES_AGENT_ENABLED",
  "BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED",
  "BRAIN_AGENT_ACTION_QUEUE_ENABLED",
  "BRAIN_EXECUTION_GATE_ENABLED",
  "BRAIN_OUTBOX_BRIDGE_ENABLED"
] as const;

export type FollowUpWorkerRuntimeConfig = {
  flags: Record<(typeof FOLLOW_UP_WORKER_CHAIN_FLAGS)[number], boolean>;
  allEnabled: boolean;
  allDisabled: boolean;
};

/** Reads the follow-up worker's chain flags once. Pass a snapshot env for tests. */
export function loadFollowUpWorkerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): FollowUpWorkerRuntimeConfig {
  const flags = Object.fromEntries(
    FOLLOW_UP_WORKER_CHAIN_FLAGS.map((name) => [name, readStrictBooleanFlag(name, env)])
  ) as FollowUpWorkerRuntimeConfig["flags"];
  const values = Object.values(flags);
  return { flags, allEnabled: values.every(Boolean), allDisabled: values.every((value) => !value) };
}

/**
 * A follow-up worker re-entering the autonomous cycle with only SOME of its
 * chain flags set produces silent partial behavior (e.g. the LLM runs and a
 * decision is computed, but BRAIN_AGENT_ACTION_QUEUE_ENABLED=false means the
 * action never gets queued) - never a crash, so it is easy to miss during a
 * pilot. Refuse to start rather than run in that ambiguous state; running
 * fully disabled (a harmless no-op) is always allowed.
 */
export function assertFollowUpWorkerRuntimeConfigIsSafe(config: FollowUpWorkerRuntimeConfig): void {
  if (config.allEnabled || config.allDisabled) return;
  const summary = Object.entries(config.flags)
    .map(([name, value]) => `${name}=${value}`)
    .join(", ");
  throw new AutonomousRuntimeConfigError(
    `Follow-up worker configuration is partial - these flags must be either all "true" or all "false": ${summary}. ` +
      "A partial chain silently drops the follow-up somewhere between the LLM call and the outbox write - refusing to start."
  );
}

/**
 * SALES-AGENT-R2-A11, Part 2/3/30/31. A dedicated, fail-closed WHO-MAY-ACCESS
 * gate - deliberately distinct from loadAutonomousPilotAllowlist above (that
 * one governs the outbox worker's own real-send safety net, unchanged by
 * this task) and from the R2 routing allowlist (loadCommercialWorkRuntimeAllowlist,
 * which decides WHICH runtime a customer uses, never whether they may be
 * processed at all). Conflating any of these three is exactly what A11's own
 * architecture principle forbids.
 *
 * BRAIN_WHATSAPP_TEST_MODE_ENABLED defaults to true (unlike every other flag
 * in this file) - a fresh deployment with no A11 env configured must never
 * accidentally open the bot to the public. BRAIN_WHATSAPP_TEST_WA_IDS reuses
 * the same digit-normalization as the pilot allowlist.
 */
export type WhatsAppAccessGateConfig = { testModeEnabled: boolean; testWaIds: string[] };

export function loadWhatsAppAccessGateConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppAccessGateConfig {
  return {
    testModeEnabled: readStrictBooleanFlagWithDefault("BRAIN_WHATSAPP_TEST_MODE_ENABLED", env, true),
    testWaIds: readWaIdAllowlist("BRAIN_WHATSAPP_TEST_WA_IDS", env)
  };
}

/**
 * Part 30: TEST_MODE=true with an EMPTY allowlist is not "unrestricted" (the
 * opposite convention from isWaIdAuthorizedForPilot's empty-allowlist
 * handling above) - it blocks everyone. TEST_MODE=false always allows any
 * normalizable wa_id, regardless of the list's contents.
 */
export function isWaIdAllowedByAccessGate(waId: string | null | undefined, config: WhatsAppAccessGateConfig): boolean {
  // Public mode: any identified conversation may enter (Part 29 - "any valid
  // WhatsApp user"). Deliberately does NOT require waId to normalize to a
  // phone-number shape - that would reject any non-phone-shaped conversation
  // identifier, which is not what "public" means. Only a genuinely missing
  // identifier (nothing to reply to) is blocked either way.
  if (!config.testModeEnabled) return Boolean(waId && waId.trim());
  if (config.testWaIds.length === 0) return false;
  const normalized = normalizeWhatsAppRecipientDigits(waId ?? null);
  if (normalized === null) return false;
  return config.testWaIds.includes(normalized);
}

/**
 * SALES-AGENT-R2-A11, Part 4/5. The independent MAY-THE-BOT-RESPOND
 * killswitch - defaults to false, so a fresh deployment never autonomously
 * responds until an operator explicitly turns it on (Stage 0 -> Stage 1).
 * Gates system-originated autonomous actions only (LLM calls, capability
 * execution, autonomous follow-up sends, worker-triggered replies) - never
 * manual operator replies, handoff, or explicitly operator-generated outbox
 * actions, none of which route through this flag's call sites.
 */
export function loadAutonomousResponsesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readStrictBooleanFlagWithDefault("BRAIN_AUTONOMOUS_RESPONSES_ENABLED", env, false);
}

/** SALES-AGENT-R2-A11, Part 9/20. Both default false - inert unless explicitly enabled. */
export function loadCommercialWorkWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readStrictBooleanFlagWithDefault("BRAIN_COMMERCIAL_WORK_WORKER_ENABLED", env, false);
}

export function loadCommercialWorkFollowUpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readStrictBooleanFlagWithDefault("BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED", env, false);
}

export type AutonomousRuntimePreflightReport = {
  ok: boolean;
  pilotAllowlistCount: number;
  outboxWorker: {
    outboxWorkerEnabled: boolean;
    metaSendEnabled: boolean;
    outboxWorkerAllowRealSend: boolean;
    realSendAuthorized: boolean;
  };
  followUpWorker: {
    allEnabled: boolean;
    allDisabled: boolean;
  };
  errors: string[];
};

/**
 * Pure preflight check (ACS-R1-05-T06.1 section 5): reads and validates
 * configuration only - never starts a worker, never calls Meta, never
 * touches the database, never mutates env. The scripts/autonomous-runtime-
 * preflight.ts CLI is a thin wrapper around this (load env files, print,
 * set process.exitCode); this function is what tests exercise directly.
 */
export function buildAutonomousRuntimePreflightReport(env: NodeJS.ProcessEnv = process.env): AutonomousRuntimePreflightReport {
  let outbox: OutboxWorkerRuntimeConfig;
  let followUp: FollowUpWorkerRuntimeConfig;
  let pilotAllowlistCount: number;
  try {
    outbox = loadOutboxWorkerRuntimeConfig(env);
    followUp = loadFollowUpWorkerRuntimeConfig(env);
    pilotAllowlistCount = loadAutonomousPilotAllowlist(env).length;
  } catch (error) {
    const message = error instanceof AutonomousRuntimeConfigError ? error.message : error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      pilotAllowlistCount: 0,
      outboxWorker: { outboxWorkerEnabled: false, metaSendEnabled: false, outboxWorkerAllowRealSend: false, realSendAuthorized: false },
      followUpWorker: { allEnabled: false, allDisabled: false },
      errors: [message]
    };
  }

  const errors: string[] = [];
  for (const assertion of [() => assertOutboxWorkerRuntimeConfigIsSafe(outbox), () => assertFollowUpWorkerRuntimeConfigIsSafe(followUp)]) {
    try {
      assertion();
    } catch (error) {
      if (error instanceof AutonomousRuntimeConfigError) errors.push(error.message);
      else throw error;
    }
  }

  return {
    ok: errors.length === 0,
    pilotAllowlistCount,
    outboxWorker: {
      outboxWorkerEnabled: outbox.outboxWorkerEnabled,
      metaSendEnabled: outbox.metaSendEnabled,
      outboxWorkerAllowRealSend: outbox.outboxWorkerAllowRealSend,
      realSendAuthorized: isOutboxRealSendAuthorized(outbox)
    },
    followUpWorker: { allEnabled: followUp.allEnabled, allDisabled: followUp.allDisabled },
    errors
  };
}
