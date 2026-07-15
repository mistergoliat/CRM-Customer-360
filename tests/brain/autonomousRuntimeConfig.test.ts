import assert from "node:assert/strict";
import test from "node:test";
import {
  AutonomousRuntimeConfigError,
  assertOutboxWorkerRuntimeConfigIsSafe,
  isOutboxRealSendAuthorized,
  loadOutboxWorkerRuntimeConfig
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
