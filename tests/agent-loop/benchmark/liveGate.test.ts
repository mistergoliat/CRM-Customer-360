import assert from "node:assert/strict";
import test from "node:test";
import { isLiveBenchmarkEnabled, resolveLiveBenchmarkProviderConfig } from "@/lib/brain/commercial/agent-loop/benchmark/liveProvider";

/**
 * LLM-R1-T05, Part D. These tests never make a real network call - they only
 * exercise the gate logic itself, with fully synthetic env objects (never
 * process.env), so a real BRAIN_MODEL_API_KEY present in the developer's
 * shell can never cause a live call to slip into the automated suite.
 */
function fakeEnv(overrides: Partial<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...overrides };
}

test("[T05] live benchmark is disabled by default (empty env)", () => {
  assert.equal(isLiveBenchmarkEnabled(fakeEnv()), false);
  const resolution = resolveLiveBenchmarkProviderConfig(fakeEnv());
  assert.deepEqual(resolution, { ok: false, reason: "live_benchmark_disabled" });
});

test("[T05] presence of an API key alone never enables live mode", () => {
  const env = fakeEnv({ BRAIN_MODEL_API_URL: "https://example.invalid", BRAIN_MODEL_API_KEY: "sk-test", BRAIN_MODEL_NAME: "deepseek-v4-flash" });
  assert.equal(isLiveBenchmarkEnabled(env), false);
  const resolution = resolveLiveBenchmarkProviderConfig(env);
  assert.deepEqual(resolution, { ok: false, reason: "live_benchmark_disabled" });
});

test("[T05] BENCHMARK_LIVE_LLM_ENABLED must be exactly \"true\" (case-insensitive, trimmed) - any other value stays disabled", () => {
  for (const value of ["false", "1", "yes", "", "  "]) {
    assert.equal(isLiveBenchmarkEnabled(fakeEnv({ BENCHMARK_LIVE_LLM_ENABLED: value })), false);
  }
  assert.equal(isLiveBenchmarkEnabled(fakeEnv({ BENCHMARK_LIVE_LLM_ENABLED: "true" })), true);
  assert.equal(isLiveBenchmarkEnabled(fakeEnv({ BENCHMARK_LIVE_LLM_ENABLED: " TRUE " })), true);
});

test("[T05] enabled but missing endpoint/apiKey is rejected", () => {
  const resolution = resolveLiveBenchmarkProviderConfig(fakeEnv({ BENCHMARK_LIVE_LLM_ENABLED: "true" }));
  assert.deepEqual(resolution, { ok: false, reason: "missing_endpoint_or_api_key" });
});

test("[T05] enabled with endpoint/apiKey but no resolvable model is rejected", () => {
  const resolution = resolveLiveBenchmarkProviderConfig(fakeEnv({ BENCHMARK_LIVE_LLM_ENABLED: "true", BRAIN_MODEL_API_URL: "https://example.invalid", BRAIN_MODEL_API_KEY: "sk-test" }));
  assert.deepEqual(resolution, { ok: false, reason: "missing_model" });
});

test("[T05] fully configured env resolves ok:true, preferring BENCHMARK_LIVE_LLM_MODEL over BRAIN_MODEL_NAME", () => {
  const resolution = resolveLiveBenchmarkProviderConfig(fakeEnv({
    BENCHMARK_LIVE_LLM_ENABLED: "true",
    BRAIN_MODEL_API_URL: "https://example.invalid",
    BRAIN_MODEL_API_KEY: "sk-test",
    BRAIN_MODEL_NAME: "deepseek-v4-flash",
    BENCHMARK_LIVE_LLM_MODEL: "candidate-model-b"
  }));
  assert.equal(resolution.ok, true);
  if (resolution.ok) {
    assert.equal(resolution.config.model, "candidate-model-b");
    assert.equal(resolution.config.endpoint, "https://example.invalid");
    assert.equal(resolution.config.apiKey, "sk-test");
    assert.equal(resolution.config.temperature, 0);
    assert.equal(resolution.config.maxModelRetries, 0);
  }
});

test("[T05] falls back to BRAIN_MODEL_NAME and honors explicit temperature/maxOutputTokens/maxModelRetries overrides", () => {
  const resolution = resolveLiveBenchmarkProviderConfig(fakeEnv({
    BENCHMARK_LIVE_LLM_ENABLED: "true",
    BRAIN_MODEL_API_URL: "https://example.invalid",
    BRAIN_MODEL_API_KEY: "sk-test",
    BRAIN_MODEL_NAME: "deepseek-v4-flash",
    BENCHMARK_LIVE_LLM_TEMPERATURE: "0.2",
    BENCHMARK_LIVE_LLM_MAX_OUTPUT_TOKENS: "512",
    BENCHMARK_LIVE_LLM_MAX_MODEL_RETRIES: "2"
  }));
  assert.equal(resolution.ok, true);
  if (resolution.ok) {
    assert.equal(resolution.config.model, "deepseek-v4-flash");
    assert.equal(resolution.config.temperature, 0.2);
    assert.equal(resolution.config.maxOutputTokens, 512);
    assert.equal(resolution.config.maxModelRetries, 2);
  }
});

// --- LLM-R1-T08B: thinking A/B lever, same strict-literal gate discipline as BENCHMARK_LIVE_LLM_ENABLED above ---

test("[T08B] no BENCHMARK_LIVE_LLM_THINKING set - config.thinking stays undefined (reproduces pre-T08B/production behavior)", () => {
  const resolution = resolveLiveBenchmarkProviderConfig(fakeEnv({
    BENCHMARK_LIVE_LLM_ENABLED: "true",
    BRAIN_MODEL_API_URL: "https://example.invalid",
    BRAIN_MODEL_API_KEY: "sk-test",
    BRAIN_MODEL_NAME: "deepseek-v4-flash"
  }));
  assert.equal(resolution.ok, true);
  if (resolution.ok) assert.equal(resolution.config.thinking, undefined);
});

test("[T08B] BENCHMARK_LIVE_LLM_THINKING=enabled resolves config.thinking=\"enabled\" (Configuration A)", () => {
  const resolution = resolveLiveBenchmarkProviderConfig(fakeEnv({
    BENCHMARK_LIVE_LLM_ENABLED: "true",
    BRAIN_MODEL_API_URL: "https://example.invalid",
    BRAIN_MODEL_API_KEY: "sk-test",
    BRAIN_MODEL_NAME: "deepseek-v4-flash",
    BENCHMARK_LIVE_LLM_THINKING: "enabled"
  }));
  assert.equal(resolution.ok, true);
  if (resolution.ok) assert.equal(resolution.config.thinking, "enabled");
});

test("[T08B] BENCHMARK_LIVE_LLM_THINKING=disabled (any case, trimmed) resolves config.thinking=\"disabled\" (Configuration B)", () => {
  const resolution = resolveLiveBenchmarkProviderConfig(fakeEnv({
    BENCHMARK_LIVE_LLM_ENABLED: "true",
    BRAIN_MODEL_API_URL: "https://example.invalid",
    BRAIN_MODEL_API_KEY: "sk-test",
    BRAIN_MODEL_NAME: "deepseek-v4-flash",
    BENCHMARK_LIVE_LLM_THINKING: " DISABLED "
  }));
  assert.equal(resolution.ok, true);
  if (resolution.ok) assert.equal(resolution.config.thinking, "disabled");
});

test("[T08B] an unrecognized BENCHMARK_LIVE_LLM_THINKING value is never guessed/defaulted - treated as absent", () => {
  const resolution = resolveLiveBenchmarkProviderConfig(fakeEnv({
    BENCHMARK_LIVE_LLM_ENABLED: "true",
    BRAIN_MODEL_API_URL: "https://example.invalid",
    BRAIN_MODEL_API_KEY: "sk-test",
    BRAIN_MODEL_NAME: "deepseek-v4-flash",
    BENCHMARK_LIVE_LLM_THINKING: "banana"
  }));
  assert.equal(resolution.ok, true);
  if (resolution.ok) assert.equal(resolution.config.thinking, undefined);
});
