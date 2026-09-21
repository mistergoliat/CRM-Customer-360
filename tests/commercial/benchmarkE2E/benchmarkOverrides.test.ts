import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBenchmarkE2EOverridesToLiveConfig,
  listActiveBenchmarkE2EOverrides,
  readBenchmarkE2EOverrides
} from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/benchmarkOverrides";

// SALES-AGENT-R3-P7.6-B. Pure unit tests - no DB, no HTTP, no LLM.

test("P7.6-B: with no BENCHMARK_E2E_* variable every override is undefined (harness defaults untouched)", () => {
  assert.deepEqual(Object.values(readBenchmarkE2EOverrides({})).filter((value) => value !== undefined), []);
  assert.deepEqual(listActiveBenchmarkE2EOverrides({ NODE_ENV: "test", BRAIN_R3_OPEN_TURN_EXECUTION_ENABLED: "true" }), {});
});

test("P7.6-B: only literal true/false, positive integers and enabled/disabled are honored; anything else is unset", () => {
  const parsed = readBenchmarkE2EOverrides({
    BENCHMARK_E2E_OPEN_TURN_ENABLED: "true",
    BENCHMARK_E2E_HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED: "yes",
    BENCHMARK_E2E_SESSION_COMPACTION_ENABLED: "FALSE",
    BENCHMARK_E2E_MODEL_TIMEOUT_MS: "60000",
    BENCHMARK_E2E_MAX_OUTPUT_TOKENS: "0",
    BENCHMARK_E2E_MAX_MODEL_RETRIES: "0",
    BENCHMARK_E2E_THINKING: "Disabled"
  });
  assert.equal(parsed.openTurnEnabled, true);
  assert.equal(parsed.harnessAlignedMessageModelEnabled, undefined);
  assert.equal(parsed.sessionCompactionEnabled, false);
  assert.equal(parsed.modelTimeoutMs, 60000);
  assert.equal(parsed.maxOutputTokens, undefined);
  assert.equal(parsed.maxModelRetries, 0);
  assert.equal(parsed.thinking, "disabled");
});

test("P7.6-B: overrides are applied to the live provider config only where set, and listed for the manifest", () => {
  const base = { endpoint: "e", apiKey: "k", model: "m", temperature: 0, maxModelRetries: 0 };
  const applied = applyBenchmarkE2EOverridesToLiveConfig(base, readBenchmarkE2EOverrides({ BENCHMARK_E2E_MAX_OUTPUT_TOKENS: "4000", BENCHMARK_E2E_THINKING: "disabled" }));
  assert.equal(applied.maxOutputTokens, 4000);
  assert.equal(applied.thinking, "disabled");
  assert.equal(applied.maxModelRetries, 0);
  assert.deepEqual(listActiveBenchmarkE2EOverrides({ BENCHMARK_E2E_THINKING: "disabled", BENCHMARK_E2E_MAX_OUTPUT_TOKENS: "4000" }), {
    BENCHMARK_E2E_MAX_OUTPUT_TOKENS: "4000",
    BENCHMARK_E2E_THINKING: "disabled"
  });
});
