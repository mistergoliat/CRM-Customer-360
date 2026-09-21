import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { checkEnvironmentHealth } from "../r3CommercialE2E/environmentHealthPrecheck";
import { resolveBenchmarkE2EFlags, resolveBenchmarkE2ELoopConfiguration, runCommercialE2ECase } from "../r3CommercialE2E/runCommercialE2ECase";
import { applyBenchmarkE2EOverridesToLiveConfig, listActiveBenchmarkE2EOverrides, readBenchmarkE2EOverrides } from "../r3CommercialE2E/benchmarkOverrides";
import { resolveLiveBenchmarkProviderConfig, type LiveBenchmarkProviderConfig } from "../liveProvider";
import { SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT } from "../../../sales-agent-configuration";
import type { BenchmarkE2ECase, BenchmarkE2EEnvironmentHealth, BenchmarkE2EFlagsConfig } from "../r3CommercialE2E/types";
import { extractPromptStats, slimTrace } from "../r3AutonomousAB/runAutonomousAB";
import { P78_NEGATIVE_CONTROL_CASE_IDS } from "../r3AutonomousAB/abCorpus";
import { analyzeTrueRun, compareArms, computeTrueArmMetrics, TRUE_ARM_IDS, TRUE_SIGNAL_THRESHOLDS, type TrueArmId, type TrueArmMetrics, type TrueComparison, type TrueRunConfig, type TrueRunRecord, type TrueTurnAnalysis } from "./trueAnalysis";
import { buildCurrentToolSurface, buildThinToolSurface, type ToolSurface } from "./toolSurface";
import { runTrueHarnessCase } from "./runTrueHarnessCase";
import { createScriptedNativeModel } from "./scriptedNativeModel";
import { TRUE_HARNESS_PROMPT_VERSION } from "./trueHarnessPrompt";

/**
 * SALES-AGENT-R3-P7.8-R. Orchestration of the three-arm experiment. Arm A runs
 * the untouched R3 cycle (runCommercialE2ECase, no promptBuilder, P7.7 state);
 * arms B and C1 run the true autonomous harness. Everything else - cases,
 * fixtures, identity, model configuration, timeouts, ordering discipline - is
 * resolved once here and is identical for the three arms.
 */

export type TruePlanEntry = { sequenceIndex: number; pairId: string; caseId: string; runOrdinal: number; arm: TrueArmId; positionInTriple: number };

/**
 * Deterministic and counterbalanced: the three arms of a (case, run) triple
 * run back to back; the order rotates with the triple index (A,B,C1 / B,C1,A /
 * C1,A,B), so every arm leads a third of the triples. No randomness.
 */
export function buildTruePlan(caseIds: readonly string[], runsPerCase: number): TruePlanEntry[] {
  const plan: TruePlanEntry[] = [];
  let tripleIndex = 0;
  for (const caseId of caseIds) {
    for (let runOrdinal = 0; runOrdinal < runsPerCase; runOrdinal += 1) {
      const shift = tripleIndex % TRUE_ARM_IDS.length;
      const order = [...TRUE_ARM_IDS.slice(shift), ...TRUE_ARM_IDS.slice(0, shift)];
      order.forEach((arm, positionInTriple) => plan.push({ sequenceIndex: plan.length, pairId: `${caseId}-r${runOrdinal}`, caseId, runOrdinal, arm, positionInTriple }));
      tripleIndex += 1;
    }
  }
  return plan;
}

export const TRUE_AB_CORPUS_VERSION = "r3-p7-8r.v1" as const;

function resolveSharedConfig(mode: "offline" | "live", liveConfig: LiveBenchmarkProviderConfig | null) {
  const loop = resolveBenchmarkE2ELoopConfiguration();
  return {
    model: mode === "offline" ? "benchmark-offline-model" : (liveConfig?.model ?? null),
    temperature: mode === "offline" ? null : (liveConfig?.temperature ?? null),
    thinking: mode === "offline" ? null : (liveConfig?.thinking ?? null),
    timeoutMs: readBenchmarkE2EOverrides().modelTimeoutMs ?? SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT.timeoutMs,
    maxOutputTokens: mode === "offline" ? null : (liveConfig?.maxOutputTokens ?? null),
    maxModelRetries: mode === "offline" ? null : (liveConfig?.maxModelRetries ?? null),
    maxDecisions: loop.maxAgentStepsPerTurn,
    maxToolExecutions: loop.maxToolCallsPerTurn
  } as const;
}

const ARM_DESCRIPTIONS: Record<TrueArmId, { label: string; usesR3Loop: boolean; toolSurface: "current" | "thin"; promptVersion: string; eligibilityInfluencedCognition: boolean }> = {
  A_R3_CURRENT: { label: "R3 current: DRM + P6.3 view + hybrid prompt + runAgentToolLoop (AgentStep) + guards/checkpoints + Gateway + P4 + P5", usesR3Loop: true, toolSurface: "current", promptVersion: "hybrid-current@P7.7", eligibilityInfluencedCognition: true },
  B_PURE_CURRENT_TOOLS: { label: "True autonomous harness (native function calling, own loop) + CURRENT model-facing tool contract", usesR3Loop: false, toolSurface: "current", promptVersion: TRUE_HARNESS_PROMPT_VERSION, eligibilityInfluencedCognition: false },
  C1_PURE_THIN_TOOLS: { label: "Same harness as B + THIN model-facing tool contract for the 7 relevant capabilities (quantity still required)", usesR3Loop: false, toolSurface: "thin", promptVersion: TRUE_HARNESS_PROMPT_VERSION, eligibilityInfluencedCognition: false }
};

function buildRunConfig(arm: TrueArmId, shared: ReturnType<typeof resolveSharedConfig>, promptSha256: string | null): TrueRunConfig {
  const description = ARM_DESCRIPTIONS[arm];
  return { arm, ...shared, promptVersion: description.promptVersion, promptSha256, toolSurface: description.toolSurface, usesR3Loop: description.usesR3Loop, eligibilityInfluencedCognition: description.eligibilityInfluencedCognition };
}

function resolveGitInfo(): { gitSha: string | null; dirtyFileCount: number | null } {
  try {
    return {
      gitSha: execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim(),
      dirtyFileCount: execSync("git status --porcelain", { cwd: process.cwd() }).toString().split("\n").filter((line) => line.trim().length > 0).length
    };
  } catch {
    return { gitSha: null, dirtyFileCount: null };
  }
}

function countCodeLines(file: string): number | null {
  try {
    return readFileSync(new URL(file, import.meta.url), "utf8").split("\n").filter((line) => line.trim().length > 0 && !/^\s*(\/\/|\*|\/\*)/.test(line)).length;
  } catch {
    return null;
  }
}

export type TrueFailureRecord = Pick<TrueTurnAnalysis, "arm" | "caseId" | "runOrdinal" | "turnOrdinal" | "category" | "terminalReason" | "harnessLimitation" | "group"> & { toolSequence: string; detail: string | null };

export type TrueBundle = {
  manifest: Record<string, unknown> & { plan: TruePlanEntry[]; sharedConfig: ReturnType<typeof resolveSharedConfig>; runsPerCase: number };
  runs: TrueRunRecord[];
  summary: Record<TrueArmId, TrueArmMetrics>;
  failures: TrueFailureRecord[];
  comparison: TrueComparison & { complexity: Record<string, unknown>; toolSurfaces: Record<"current" | "thin", ToolSurface["stats"]> };
};

export type RunTrueABOptions = {
  mode: "offline" | "live";
  runsPerCase: number;
  corpus: readonly BenchmarkE2ECase[];
  onRunFinished?: (record: TrueRunRecord, total: number) => void;
};

export type RunTrueABResult = { ok: true; bundle: TrueBundle } | { ok: false; reason: "environment_blocked"; environmentHealth: BenchmarkE2EEnvironmentHealth };

export async function runTrueAB(options: RunTrueABOptions): Promise<RunTrueABResult> {
  const corpusRequiresQuote = options.corpus.some((testCase) => testCase.turns.some((turn) => turn.offlineScript.some((step) => step.kind === "use_tool" && (step.tool === "create_quote" || step.tool === "get_quote"))));
  const environmentHealth = await checkEnvironmentHealth({ mode: options.mode, corpusRequiresQuote });
  let liveConfig: LiveBenchmarkProviderConfig | null = null;
  if (options.mode === "live") {
    const resolution = resolveLiveBenchmarkProviderConfig();
    if (resolution.ok) liveConfig = applyBenchmarkE2EOverridesToLiveConfig(resolution.config, readBenchmarkE2EOverrides());
  }
  if (environmentHealth.dependencies.some((dependency) => dependency.name === "mariadb" && dependency.status === "BLOCKED")) return { ok: false, reason: "environment_blocked", environmentHealth };

  const baseFlags: BenchmarkE2EFlagsConfig = resolveBenchmarkE2EFlags();
  const shared = resolveSharedConfig(options.mode, liveConfig);
  const surfaces = { current: buildCurrentToolSurface(), thin: buildThinToolSurface() };
  const plan = buildTruePlan(options.corpus.map((testCase) => testCase.caseId), options.runsPerCase);
  const negativeIds = new Set<string>(P78_NEGATIVE_CONTROL_CASE_IDS);
  const batchId = `p78r-${Date.now()}-${randomUUID()}`;
  const startedAt = new Date().toISOString();

  const records: TrueRunRecord[] = [];
  for (const entry of plan) {
    const testCase = options.corpus.find((candidate) => candidate.caseId === entry.caseId) as BenchmarkE2ECase;
    const benchmarkRunId = `${batchId}-${entry.caseId}-${entry.arm}-run${entry.runOrdinal}`;
    const identity = { pairId: entry.pairId, arm: entry.arm, caseId: entry.caseId, runOrdinal: entry.runOrdinal, sequenceIndex: entry.sequenceIndex, isNegativeControl: negativeIds.has(entry.caseId) };
    let record: TrueRunRecord;
    try {
      if (entry.arm === "A_R3_CURRENT") {
        const trace = await runCommercialE2ECase(testCase, { mode: options.mode, liveConfig: liveConfig ?? undefined, runOrdinal: entry.runOrdinal, benchmarkRunId, flags: baseFlags });
        const { stats, sha256 } = extractPromptStats(trace);
        record = { ...identity, trace: slimTrace(trace), harnessError: null, runConfig: buildRunConfig(entry.arm, shared, sha256), promptStats: stats ? { systemPromptChars: stats.systemPromptChars, systemPromptApproxTokens: stats.systemPromptApproxTokens, policyLineCount: stats.policyLineCount, toolContractChars: stats.toolCatalogChars, providerCallCount: stats.providerCallCount } : null };
      } else {
        const surface = entry.arm === "B_PURE_CURRENT_TOOLS" ? surfaces.current : surfaces.thin;
        const result = await runTrueHarnessCase(testCase, {
          arm: entry.arm,
          surface,
          runOrdinal: entry.runOrdinal,
          benchmarkRunId,
          timeoutMs: shared.timeoutMs,
          liveConfig: liveConfig ?? undefined,
          callModel: options.mode === "offline" ? createScriptedNativeModel(testCase.turns.flatMap((turn) => turn.offlineScript)) : undefined
        });
        record = { ...identity, trace: result.trace, harnessError: null, runConfig: buildRunConfig(entry.arm, shared, result.promptSha256), promptStats: { ...result.promptStats, toolContractChars: result.toolContractChars } };
      }
    } catch (error) {
      record = { ...identity, trace: null, harnessError: error instanceof Error ? error.message.slice(0, 300) : "unknown_error", runConfig: buildRunConfig(entry.arm, shared, null), promptStats: null };
    }
    records.push(record);
    options.onRunFinished?.(record, plan.length);
  }

  const summary = Object.fromEntries(TRUE_ARM_IDS.map((arm) => [arm, computeTrueArmMetrics(arm, records)])) as Record<TrueArmId, TrueArmMetrics>;
  const comparison = compareArms(summary);
  const failures: TrueFailureRecord[] = records
    .flatMap((record) => analyzeTrueRun(record).map((analysis) => ({ record, analysis })))
    .filter(({ analysis }) => analysis.category !== "COMMIT_SUCCESS" && analysis.category !== "INFORMATIONAL_OK")
    .map(({ record, analysis }) => ({
      arm: analysis.arm,
      caseId: analysis.caseId,
      runOrdinal: analysis.runOrdinal,
      turnOrdinal: analysis.turnOrdinal,
      category: analysis.category,
      terminalReason: analysis.terminalReason,
      harnessLimitation: analysis.harnessLimitation,
      group: analysis.group,
      toolSequence: analysis.toolCalls.map((call) => `${call.capability}:${call.toolStatus}`).join(">") || "(none)",
      detail: record.harnessError
    }));

  const { gitSha, dirtyFileCount } = resolveGitInfo();
  return {
    ok: true,
    bundle: {
      manifest: {
        phase: "P7.8-R",
        gitSha,
        dirtyFileCount,
        corpusVersion: TRUE_AB_CORPUS_VERSION,
        startedAt,
        finishedAt: new Date().toISOString(),
        mode: options.mode,
        environmentHealth,
        sharedConfig: shared,
        baseFlags,
        arms: ARM_DESCRIPTIONS,
        toolSurfaces: { current: surfaces.current.stats, thin: surfaces.thin.stats },
        benchmarkOverrides: listActiveBenchmarkE2EOverrides(),
        notReproducibleInHarness: [
          "EC2_ONLY_CHANNEL_BEHAVIOR: webhook/HTTPS, settle delay, delivery/read events and the real outbox worker are outside every arm.",
          "Arm A writes the outbox row only when BRAIN_AUTONOMOUS_RESPONSES_ENABLED=true; arms B/C1 have no channel and never write it (not a compared metric).",
          "Quote Service is BLOCKED locally for every arm: create_quote outcomes are not evidence about any arm.",
          "Conversation memory across turns: A uses the persistent session; B/C1 use an in-memory transcript of user/assistant text (same information)."
        ],
        runsPerCase: options.runsPerCase,
        caseIds: options.corpus.map((testCase) => testCase.caseId),
        plan,
        signalThresholds: TRUE_SIGNAL_THRESHOLDS
      } as TrueBundle["manifest"],
      runs: records,
      summary,
      failures,
      comparison: {
        ...comparison,
        toolSurfaces: { current: surfaces.current.stats, thin: surfaces.thin.stats },
        complexity: {
          A: { systemPromptCharsMean: summary.A_R3_CURRENT.prompt.systemPromptCharsMean, policyLineCountMean: summary.A_R3_CURRENT.prompt.policyLineCountMean, toolContractCharsMean: summary.A_R3_CURRENT.prompt.toolContractCharsMean, cognitiveComponents: ["DRM projection", "P6.3 eligibility view", "hybrid prompt policy (buildAgentStepPromptPackage.ts)", "runAgentToolLoop (AgentStep protocol, gathering/finalization, open-turn checkpoint, evidence/duplicate/claim guards)", "P4 CommercialProposal", "P5 reconciliation"] },
          B: {
            systemPromptCharsMean: summary.B_PURE_CURRENT_TOOLS.prompt.systemPromptCharsMean,
            toolContractCharsMean: summary.B_PURE_CURRENT_TOOLS.prompt.toolContractCharsMean,
            autonomousHarnessCodeLines: { trueHarnessLoop: countCodeLines("./trueHarnessLoop.ts"), trueHarnessPrompt: countCodeLines("./trueHarnessPrompt.ts"), nativeToolClient: countCodeLines("./nativeToolClient.ts") },
            additionalComponents: ["native function-calling client", "own autonomous loop", "state renderer (DRM -> model-facing commercial state)"]
          },
          C1: { systemPromptCharsMean: summary.C1_PURE_THIN_TOOLS.prompt.systemPromptCharsMean, toolContractCharsMean: summary.C1_PURE_THIN_TOOLS.prompt.toolContractCharsMean, sameHarnessAsB: true, thinToolSurfaceCodeLines: countCodeLines("./toolSurface.ts") }
        }
      }
    }
  };
}

export type TrueArtifactFiles = { "manifest.json": string; "runs.jsonl": string; "summary.json": string; "failures.json": string; "comparison.json": string };

export function buildTrueArtifactFiles(bundle: TrueBundle): TrueArtifactFiles {
  return {
    "manifest.json": JSON.stringify(bundle.manifest, null, 2),
    "runs.jsonl": bundle.runs.map((run) => JSON.stringify({ ...run, turnAnalyses: analyzeTrueRun(run) })).join("\n"),
    "summary.json": JSON.stringify(bundle.summary, null, 2),
    "failures.json": JSON.stringify(bundle.failures, null, 2),
    "comparison.json": JSON.stringify(bundle.comparison, null, 2)
  };
}
