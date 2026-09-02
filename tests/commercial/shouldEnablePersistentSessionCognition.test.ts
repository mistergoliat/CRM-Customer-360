import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { shouldEnablePersistentSessionCognition } from "@/lib/brain/commercial/config/commercialCycleConfig";

// SALES-AGENT-R3-V1.8-D6. D5's separate BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS
// allowlist is retired (commercialCycleConfig.ts's own comment): this
// function is now just BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED,
// default true, and it no longer takes a waId. Covers task brief Section S:
// [T9] owner-specific allowlist no longer required, [T10] rollback flag
// works.

const ENV_KEY = "BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED";
const savedEnv = process.env[ENV_KEY];

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

test("[D6-T9a] default (no env configured at all): persistent-session cognition is on, no allowlist needed", () => {
  delete process.env[ENV_KEY];
  assert.equal(shouldEnablePersistentSessionCognition(), true);
});

test("[D6-T9b] BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS is no longer read at all - setting it (with or without the flag) has zero effect", () => {
  const savedAllowlist = process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS;
  try {
    delete process.env[ENV_KEY];
    process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS = "";
    assert.equal(shouldEnablePersistentSessionCognition(), true, "still the default-true flag alone");

    process.env[ENV_KEY] = "true";
    process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS = "56900000000";
    assert.equal(shouldEnablePersistentSessionCognition(), true, "a populated allowlist changes nothing - retired");
  } finally {
    if (savedAllowlist === undefined) delete process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS;
    else process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS = savedAllowlist;
  }
});

test("[D6-T10] rollback: explicit \"false\" immediately disables persistent-session cognition, no allowlist change needed", () => {
  process.env[ENV_KEY] = "true";
  assert.equal(shouldEnablePersistentSessionCognition(), true);

  process.env[ENV_KEY] = "false";
  assert.equal(shouldEnablePersistentSessionCognition(), false, "rollback is the flag flip alone");
});

test("explicit \"true\" behaves the same as the unset default", () => {
  process.env[ENV_KEY] = "true";
  assert.equal(shouldEnablePersistentSessionCognition(), true);
});

test("a malformed value falls back to the default (true), same readEnvFlag discipline as every other flag in this module", () => {
  process.env[ENV_KEY] = "not-a-boolean";
  assert.equal(shouldEnablePersistentSessionCognition(), true);
});
