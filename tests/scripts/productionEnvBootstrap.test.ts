import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadProductionEnv } from "@/scripts/db-utils";

const TEST_ENV_KEYS = [
  "BRAIN_R3_AGENT_TURN_INPUT_SHADOW_ENABLED",
  "BRAIN_SALES_AGENT_RUNTIME_ENABLED",
  "BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS"
] as const;

test("loadProductionEnv loads the project .env and replaces stale PM2 values", async () => {
  const root = mkdtempSync(join(tmpdir(), "crm-production-env-"));
  const previous = Object.fromEntries(TEST_ENV_KEYS.map((key) => [key, process.env[key]]));

  try {
    writeFileSync(
      join(root, ".env"),
      [
        "BRAIN_R3_AGENT_TURN_INPUT_SHADOW_ENABLED=true",
        "BRAIN_SALES_AGENT_RUNTIME_ENABLED=false",
        "BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS=5000"
      ].join("\n"),
      "utf8"
    );

    process.env.BRAIN_R3_AGENT_TURN_INPUT_SHADOW_ENABLED = "false";
    process.env.BRAIN_SALES_AGENT_RUNTIME_ENABLED = "true";
    process.env.BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS = "0";

    await loadProductionEnv(root);

    assert.equal(process.env.BRAIN_R3_AGENT_TURN_INPUT_SHADOW_ENABLED, "true");
    assert.equal(process.env.BRAIN_SALES_AGENT_RUNTIME_ENABLED, "false");
    assert.equal(process.env.BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS, "5000");
  } finally {
    for (const key of TEST_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
