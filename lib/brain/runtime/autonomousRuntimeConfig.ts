/**
 * Canonical, fail-closed reader for the autonomous runtime's productive
 * safety flags (ACS-R1-05-T06, P1-5). A process reads this exactly once at
 * startup - it never writes to process.env, and never lets an absent flag
 * silently become "enabled". Unlike commercialCycleConfig.ts's readEnvFlag
 * (which falls back silently on a malformed value, correct for feature
 * flags), the flags read here gate real Meta sends during a controlled
 * pilot, so a malformed value is a configuration error, not a soft default.
 */

export class AutonomousRuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutonomousRuntimeConfigError";
  }
}

function readStrictBooleanFlag(name: string, env: NodeJS.ProcessEnv): boolean {
  const raw = env[name];
  if (raw === undefined) return false;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new AutonomousRuntimeConfigError(`${name} must be "true" or "false" (received ${JSON.stringify(raw)}).`);
}

function readWaIdAllowlist(name: string, env: NodeJS.ProcessEnv): string[] {
  const raw = env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
    autonomousTestWaIds: readWaIdAllowlist("BRAIN_AUTONOMOUS_TEST_WA_IDS", env)
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
