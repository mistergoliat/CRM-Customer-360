import assert from "node:assert/strict";
import test from "node:test";
import {
  AutonomousRuntimeConfigError,
  assertOutboxWorkerRuntimeConfigIsSafe,
  assertFollowUpWorkerRuntimeConfigIsSafe,
  isOutboxRealSendAuthorized,
  isWaIdAuthorizedForPilot,
  loadAutonomousPilotAllowlist,
  loadFollowUpWorkerRuntimeConfig,
  loadOutboxWorkerRuntimeConfig,
  buildAutonomousRuntimePreflightReport
} from "@/lib/brain/runtime/autonomousRuntimeConfig";

// ACS-R1-05-T06 (P1-5). Pure tests only - no DB, no real process.env
// mutation: every case passes its own env snapshot object.

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

test("[1] absent flags default to false, never true", () => {
  const config = loadOutboxWorkerRuntimeConfig(env({}));
  assert.equal(config.outboxWorkerEnabled, false);
  assert.equal(config.metaSendEnabled, false);
  assert.equal(config.outboxWorkerAllowRealSend, false);
  assert.deepEqual(config.autonomousTestWaIds, []);
});

test("[2] only the exact strings true/false are accepted, case/whitespace-insensitive", () => {
  const config = loadOutboxWorkerRuntimeConfig(
    env({
      BRAIN_OUTBOX_WORKER_ENABLED: " TRUE ",
      BRAIN_META_SEND_ENABLED: "False",
      BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND: "true"
    })
  );
  assert.equal(config.outboxWorkerEnabled, true);
  assert.equal(config.metaSendEnabled, false);
  assert.equal(config.outboxWorkerAllowRealSend, true);
});

test("[3] malformed values (1/yes/on/empty) throw a configuration error instead of silently defaulting", () => {
  for (const malformed of ["1", "yes", "on", "enabled", ""]) {
    assert.throws(
      () => loadOutboxWorkerRuntimeConfig(env({ BRAIN_META_SEND_ENABLED: malformed })),
      AutonomousRuntimeConfigError
    );
  }
});

test("[4] allowlist parses a trimmed, comma-separated list and drops empty entries", () => {
  const config = loadOutboxWorkerRuntimeConfig(env({ BRAIN_AUTONOMOUS_TEST_WA_IDS: " 56911111111 , 56922222222,, " }));
  assert.deepEqual(config.autonomousTestWaIds, ["56911111111", "56922222222"]);
});

test("[5] isOutboxRealSendAuthorized requires all three flags true", () => {
  assert.equal(
    isOutboxRealSendAuthorized(
      loadOutboxWorkerRuntimeConfig(env({ BRAIN_OUTBOX_WORKER_ENABLED: "true", BRAIN_META_SEND_ENABLED: "true" }))
    ),
    false
  );
  assert.equal(
    isOutboxRealSendAuthorized(
      loadOutboxWorkerRuntimeConfig(
        env({
          BRAIN_OUTBOX_WORKER_ENABLED: "true",
          BRAIN_META_SEND_ENABLED: "true",
          BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND: "true"
        })
      )
    ),
    true
  );
});

test("[6] real send authorized + empty allowlist -> refuses to start (pilot invariant)", () => {
  const config = loadOutboxWorkerRuntimeConfig(
    env({
      BRAIN_OUTBOX_WORKER_ENABLED: "true",
      BRAIN_META_SEND_ENABLED: "true",
      BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND: "true"
    })
  );
  assert.throws(() => assertOutboxWorkerRuntimeConfigIsSafe(config), AutonomousRuntimeConfigError);
});

test("[7] real send authorized + non-empty allowlist -> allowed to start", () => {
  const config = loadOutboxWorkerRuntimeConfig(
    env({
      BRAIN_OUTBOX_WORKER_ENABLED: "true",
      BRAIN_META_SEND_ENABLED: "true",
      BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND: "true",
      BRAIN_AUTONOMOUS_TEST_WA_IDS: "56911111111"
    })
  );
  assert.doesNotThrow(() => assertOutboxWorkerRuntimeConfigIsSafe(config));
});

test("[8] real send NOT authorized + empty allowlist -> allowed to start (dry-run / disabled worker)", () => {
  const config = loadOutboxWorkerRuntimeConfig(env({ BRAIN_META_SEND_ENABLED: "true" }));
  assert.doesNotThrow(() => assertOutboxWorkerRuntimeConfigIsSafe(config));
});

// ACS-R1-05-T06.1 additions below.

test("[9] loadAutonomousPilotAllowlist digit-normalizes entries and dedupes formatting variants of the same number", () => {
  const allowlist = loadAutonomousPilotAllowlist(env({ BRAIN_AUTONOMOUS_TEST_WA_IDS: "+56 9 1111 1111, 56911111111, (56) 9-2222-2222" }));
  assert.deepEqual(allowlist, ["56911111111", "56922222222"]);
});

test("[10] isWaIdAuthorizedForPilot: empty allowlist authorizes everyone (no regression for existing callers)", () => {
  assert.equal(isWaIdAuthorizedForPilot("56911111111", []), true);
  assert.equal(isWaIdAuthorizedForPilot(null, []), true);
});

test("[11] isWaIdAuthorizedForPilot: non-empty allowlist is strict and normalization-tolerant", () => {
  const allowlist = ["56911111111"];
  assert.equal(isWaIdAuthorizedForPilot("56911111111", allowlist), true);
  assert.equal(isWaIdAuthorizedForPilot("+56 9 1111 1111", allowlist), true);
  assert.equal(isWaIdAuthorizedForPilot("56922222222", allowlist), false);
  assert.equal(isWaIdAuthorizedForPilot(null, allowlist), false);
  assert.equal(isWaIdAuthorizedForPilot(undefined, allowlist), false);
});

test("[12] follow-up worker config: all chain flags false or all true is valid", () => {
  assert.doesNotThrow(() => assertFollowUpWorkerRuntimeConfigIsSafe(loadFollowUpWorkerRuntimeConfig(env({}))));
  assert.doesNotThrow(() =>
    assertFollowUpWorkerRuntimeConfigIsSafe(
      loadFollowUpWorkerRuntimeConfig(
        env({
          BRAIN_SALES_AGENT_ENABLED: "true",
          BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "true",
          BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
          BRAIN_EXECUTION_GATE_ENABLED: "true",
          BRAIN_OUTBOX_BRIDGE_ENABLED: "true"
        })
      )
    )
  );
});

test("[13] follow-up worker config: a partial chain (some flags true, some false) is invalid and refuses to start", () => {
  const config = loadFollowUpWorkerRuntimeConfig(
    env({
      BRAIN_SALES_AGENT_ENABLED: "true",
      BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "true",
      BRAIN_AGENT_ACTION_QUEUE_ENABLED: "false",
      BRAIN_EXECUTION_GATE_ENABLED: "true",
      BRAIN_OUTBOX_BRIDGE_ENABLED: "true"
    })
  );
  assert.throws(() => assertFollowUpWorkerRuntimeConfigIsSafe(config), AutonomousRuntimeConfigError);
});

test("[14] preflight report: valid configuration reports ok=true with zero errors", () => {
  const report = buildAutonomousRuntimePreflightReport(
    env({
      BRAIN_OUTBOX_WORKER_ENABLED: "true",
      BRAIN_META_SEND_ENABLED: "true",
      BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND: "true",
      BRAIN_AUTONOMOUS_TEST_WA_IDS: "56911111111"
    })
  );
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.equal(report.pilotAllowlistCount, 1);
  assert.equal(report.outboxWorker.realSendAuthorized, true);
});

test("[15] preflight report: invalid configuration (real send authorized, empty allowlist) reports ok=false with a non-empty error list", () => {
  const report = buildAutonomousRuntimePreflightReport(
    env({
      BRAIN_OUTBOX_WORKER_ENABLED: "true",
      BRAIN_META_SEND_ENABLED: "true",
      BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND: "true"
    })
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.length > 0);
});

test("[16] preflight report: a malformed boolean flag is reported as ok=false instead of throwing out of the function", () => {
  const report = buildAutonomousRuntimePreflightReport(env({ BRAIN_META_SEND_ENABLED: "yes" }));
  assert.equal(report.ok, false);
  assert.ok(report.errors.length > 0);
});
