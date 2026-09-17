import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { checkEnvironmentHealth } from "./environmentHealthPrecheck";
import { resolveBenchmarkE2EFlags, runCommercialE2ECase } from "./runCommercialE2ECase";
import { resolveLiveBenchmarkProviderConfig, type LiveBenchmarkProviderConfig } from "../liveProvider";
import { computeBenchmarkE2ESummaryMetrics } from "./metrics";
import { SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT, SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT } from "../../../sales-agent-configuration";
import type { BenchmarkE2EArtifactBundle, BenchmarkE2ECase, BenchmarkE2EFailure, BenchmarkE2EModelConfig, BenchmarkE2ERunTrace } from "./types";

/**
 * SALES-AGENT-R3-P7.4. This is the INSTRUMENT, not a measurement run - "P7.4
 * valida el instrumento de medición" (Section "DESPUÉS DE P7.4"). Running
 * this function against the real 15-case corpus with runsPerCase=3 IS the
 * 45-run capability the task asks P7.4 to support; actually launching that
 * batch and drawing conclusions from its results is P7.5's job, not this
 * one's - nothing here is required to make all 45 runs pass.
 */

function resolveGitSha(): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
  } catch {
    return null;
  }
}

function buildModelConfig(mode: "offline" | "live", liveConfig: LiveBenchmarkProviderConfig | null): BenchmarkE2EModelConfig {
  return {
    mode,
    provider: mode === "offline" ? "benchmark-offline-scripted-provider" : "http-agent-loop-provider",
    model: mode === "offline" ? "benchmark-offline-model" : (liveConfig?.model ?? null),
    temperature: mode === "offline" ? null : (liveConfig?.temperature ?? null),
    maxOutputTokens: mode === "offline" ? null : (liveConfig?.maxOutputTokens ?? null),
    maxDecisions: SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT.maxAgentStepsPerTurn,
    maxToolExecutions: SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT.maxToolCallsPerTurn,
    timeoutMs: SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT.timeoutMs
  };
}

export type RunCommercialE2ECorpusOptions = {
  mode: "offline" | "live";
  runsPerCase: number;
  corpus: readonly BenchmarkE2ECase[];
  corpusVersion: string;
};

export type RunCommercialE2ECorpusResult =
  | { ok: true; bundle: BenchmarkE2EArtifactBundle }
  | { ok: false; reason: "environment_blocked"; environmentHealth: BenchmarkE2EArtifactBundle["manifest"]["environmentHealth"] };

export async function runCommercialE2ECorpus(options: RunCommercialE2ECorpusOptions): Promise<RunCommercialE2ECorpusResult> {
  const corpusRequiresQuote = options.corpus.some((testCase) => testCase.turns.some((turn) => turn.offlineScript.some((step) => step.kind === "use_tool" && (step.tool === "create_quote" || step.tool === "get_quote"))));
  const environmentHealth = await checkEnvironmentHealth({ mode: options.mode, corpusRequiresQuote });

  let liveConfig: LiveBenchmarkProviderConfig | null = null;
  if (options.mode === "live") {
    const resolution = resolveLiveBenchmarkProviderConfig();
    if (resolution.ok) liveConfig = resolution.config;
  }

  // Section "ENVIRONMENT HEALTH PRECHECK": "Si dependencia requerida está
  // BLOCKED: no ejecutar/contabilizar el caso como model failure." MariaDB
  // BLOCKED makes the WHOLE batch unrunnable (every case needs it) - the
  // caller gets environmentHealth back to report ENVIRONMENT_BLOCKED without
  // a single case being scored as a model failure. A narrower BLOCKED
  // (only quoteService, only providerEndpoint) still allows the batch to run -
  // the affected individual cases surface their own DEPENDENCY_FAILURE
  // per-run instead (classifyFailure.ts).
  const mariaDbBlocked = environmentHealth.dependencies.some((dependency) => dependency.name === "mariadb" && dependency.status === "BLOCKED");
  if (mariaDbBlocked) return { ok: false, reason: "environment_blocked", environmentHealth };

  const flags = resolveBenchmarkE2EFlags();
  const benchmarkBatchId = `r3-e2e-${Date.now()}-${randomUUID()}`;
  const startedAt = new Date().toISOString();

  const runs: BenchmarkE2ERunTrace[] = [];
  for (const testCase of options.corpus) {
    for (let runOrdinal = 0; runOrdinal < options.runsPerCase; runOrdinal += 1) {
      const benchmarkRunId = `${benchmarkBatchId}-${testCase.caseId}-run${runOrdinal}`;
      const trace = await runCommercialE2ECase(testCase, {
        mode: options.mode,
        liveConfig: liveConfig ?? undefined,
        runOrdinal,
        benchmarkRunId,
        flags
      });
      runs.push(trace);
    }
  }

  const failures: BenchmarkE2EFailure[] = runs.filter((run) => run.outcome.failure !== null).map((run) => run.outcome.failure as BenchmarkE2EFailure);
  const summary = computeBenchmarkE2ESummaryMetrics(runs);
  const modelConfig = buildModelConfig(options.mode, liveConfig);

  return {
    ok: true,
    bundle: {
      manifest: {
        gitSha: resolveGitSha(),
        corpusVersion: options.corpusVersion,
        startedAt,
        environmentHealth,
        modelConfig,
        flags,
        runsPerCase: options.runsPerCase,
        caseCount: options.corpus.length
      },
      runs,
      summary,
      failures
    }
  };
}
