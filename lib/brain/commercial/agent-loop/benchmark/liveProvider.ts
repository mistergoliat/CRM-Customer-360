import { createHttpAgentLoopProvider } from "../providers/httpAgentLoopProvider";
import type { AgentLoopProvider } from "../agentLoopProviderTypes";

const LIVE_LLM_GATE_ENV_VAR = "BENCHMARK_LIVE_LLM_ENABLED";

/**
 * LLM-R1-T05. Explicit, off-by-default gate for the only external network
 * call this benchmark harness is ever allowed to make (the LLM provider
 * itself - Catalog/Carrier/WhatsApp/outbox/production DB stay isolated
 * regardless of this flag, see environment.ts). Absent or anything other
 * than the literal string "true" means disabled - never inferred from the
 * mere presence of an API key.
 */
export function isLiveBenchmarkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LIVE_LLM_GATE_ENV_VAR]?.trim().toLowerCase() === "true";
}

export type LiveBenchmarkProviderConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens?: number;
  maxModelRetries: number;
};

export type LiveBenchmarkConfigResolution =
  | { ok: true; config: LiveBenchmarkProviderConfig }
  | { ok: false; reason: "live_benchmark_disabled" | "missing_endpoint_or_api_key" | "missing_model" };

/**
 * Reads exactly what LLM-R1-T05's live comparison needs, never anything
 * beyond the LLM provider itself - Catalog/Carrier/WhatsApp/DB env vars are
 * never read here. Reuses BRAIN_MODEL_API_URL/BRAIN_MODEL_API_KEY (the same
 * production config keys httpAgentLoopProvider.ts already falls back to) so
 * an operator does not need a second, benchmark-only secret - the API key
 * itself is read once, passed straight into createHttpAgentLoopProvider,
 * and never written to a variable that outlives this call, never logged,
 * never persisted (LLM-R1-T05's explicit "No guardar API key").
 *
 * temperature/maxModelRetries default to the same SAFE_DEFAULT values the
 * production resolver uses (sales-agent-configuration/defaults.ts) so a
 * benchmark run's model config matches production unless the operator
 * explicitly overrides it via BENCHMARK_LIVE_LLM_* - never silently
 * different from what customers actually experience.
 */
export function resolveLiveBenchmarkProviderConfig(env: NodeJS.ProcessEnv = process.env): LiveBenchmarkConfigResolution {
  if (!isLiveBenchmarkEnabled(env)) return { ok: false, reason: "live_benchmark_disabled" };

  const endpoint = env.BRAIN_MODEL_API_URL?.trim();
  const apiKey = env.BRAIN_MODEL_API_KEY?.trim();
  if (!endpoint || !apiKey) return { ok: false, reason: "missing_endpoint_or_api_key" };

  const model = env.BENCHMARK_LIVE_LLM_MODEL?.trim() || env.BRAIN_MODEL_NAME?.trim();
  if (!model) return { ok: false, reason: "missing_model" };

  const temperature = Number.parseFloat(env.BENCHMARK_LIVE_LLM_TEMPERATURE?.trim() ?? "");
  const maxOutputTokensRaw = Number.parseInt(env.BENCHMARK_LIVE_LLM_MAX_OUTPUT_TOKENS?.trim() ?? "", 10);
  const maxModelRetries = Number.parseInt(env.BENCHMARK_LIVE_LLM_MAX_MODEL_RETRIES?.trim() ?? "", 10);

  return {
    ok: true,
    config: {
      endpoint,
      apiKey,
      model,
      temperature: Number.isFinite(temperature) ? temperature : 0,
      ...(Number.isFinite(maxOutputTokensRaw) && maxOutputTokensRaw > 0 ? { maxOutputTokens: maxOutputTokensRaw } : {}),
      maxModelRetries: Number.isFinite(maxModelRetries) && maxModelRetries >= 0 ? maxModelRetries : 0
    }
  };
}

/** Never called unless resolveLiveBenchmarkProviderConfig() already returned ok:true - see runCorpus.ts's mode gate. */
export function createLiveBenchmarkProvider(config: LiveBenchmarkProviderConfig): AgentLoopProvider {
  return createHttpAgentLoopProvider({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    maxModelRetries: config.maxModelRetries
  });
}
