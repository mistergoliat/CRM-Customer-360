import type { LiveBenchmarkProviderConfig } from "../liveProvider";

/**
 * SALES-AGENT-R3-P7.6-B. Explicit, off-by-default levers that let the harness
 * reproduce the cognitive/temporal runtime configuration of a deployment
 * (e.g. EC2) for one experiment without touching .env or any production
 * default. Unset means the harness's existing behavior, unchanged. Only
 * literal "true"/"false" (booleans), positive integers, and
 * "enabled"/"disabled" (thinking) are honored - anything else is treated as
 * unset, never guessed.
 *
 * Channel behavior (webhook/HTTPS/Meta signature, turn-settle delay,
 * delivery/read events, the real outbox worker) is deliberately NOT a lever:
 * the harness enters at runSalesAgentRuntimeCycle, so simulating it here
 * would be a sleep pretending to be parity.
 */
export type BenchmarkE2EOverrides = {
  openTurnEnabled?: boolean;
  harnessAlignedMessageModelEnabled?: boolean;
  liveTurnAssimilationEnabled?: boolean;
  sessionCompactionEnabled?: boolean;
  modelTimeoutMs?: number;
  maxOutputTokens?: number;
  maxModelRetries?: number;
  thinking?: "enabled" | "disabled";
};

function readBool(value: string | undefined): boolean | undefined {
  const text = value?.trim().toLowerCase();
  return text === "true" ? true : text === "false" ? false : undefined;
}

function readInt(value: string | undefined, min: number): number | undefined {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isInteger(parsed) && parsed >= min ? parsed : undefined;
}

export function readBenchmarkE2EOverrides(env: Record<string, string | undefined> = process.env): BenchmarkE2EOverrides {
  const thinking = env.BENCHMARK_E2E_THINKING?.trim().toLowerCase();
  return {
    openTurnEnabled: readBool(env.BENCHMARK_E2E_OPEN_TURN_ENABLED),
    harnessAlignedMessageModelEnabled: readBool(env.BENCHMARK_E2E_HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED),
    liveTurnAssimilationEnabled: readBool(env.BENCHMARK_E2E_LIVE_TURN_ASSIMILATION_ENABLED),
    sessionCompactionEnabled: readBool(env.BENCHMARK_E2E_SESSION_COMPACTION_ENABLED),
    modelTimeoutMs: readInt(env.BENCHMARK_E2E_MODEL_TIMEOUT_MS, 1),
    maxOutputTokens: readInt(env.BENCHMARK_E2E_MAX_OUTPUT_TOKENS, 1),
    maxModelRetries: readInt(env.BENCHMARK_E2E_MAX_MODEL_RETRIES, 0),
    thinking: thinking === "enabled" || thinking === "disabled" ? thinking : undefined
  };
}

/** Every BENCHMARK_E2E_* variable in effect (non-secret by construction), recorded in the manifest so a run states exactly what was overridden. */
export function listActiveBenchmarkE2EOverrides(env: Record<string, string | undefined> = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .filter((entry): entry is [string, string] => entry[0].startsWith("BENCHMARK_E2E_") && typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([key, value]) => [key, value.trim()])
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

export function applyBenchmarkE2EOverridesToLiveConfig(config: LiveBenchmarkProviderConfig, overrides: BenchmarkE2EOverrides): LiveBenchmarkProviderConfig {
  return {
    ...config,
    ...(overrides.maxOutputTokens !== undefined ? { maxOutputTokens: overrides.maxOutputTokens } : {}),
    ...(overrides.maxModelRetries !== undefined ? { maxModelRetries: overrides.maxModelRetries } : {}),
    ...(overrides.thinking !== undefined ? { thinking: overrides.thinking } : {})
  };
}
