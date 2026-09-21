import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT, SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT } from "../../../sales-agent-configuration";
import { checkEnvironmentHealth } from "../r3CommercialE2E/environmentHealthPrecheck";
import { applyBenchmarkE2EOverridesToLiveConfig, listActiveBenchmarkE2EOverrides, readBenchmarkE2EOverrides } from "../r3CommercialE2E/benchmarkOverrides";
import { resolveLiveBenchmarkProviderConfig, type LiveBenchmarkProviderConfig } from "../liveProvider";
import type { BenchmarkE2ECase, BenchmarkE2EEnvironmentHealth } from "../r3CommercialE2E/types";
import { runTrueHarnessCase } from "../r3TrueAB/runTrueHarnessCase";
import { createScriptedNativeModel } from "../r3TrueAB/scriptedNativeModel";
import { buildTrueHarnessSystemPrompt, TRUE_HARNESS_PROMPT_VERSION } from "../r3TrueAB/trueHarnessPrompt";
import { ISOLATION_CORPUS_VERSION, ISOLATION_SCENARIOS, scenarioById, toBenchmarkCase, type IsolationScenario } from "./isolationCorpus";
import { analyzeIsolationRun, compareIsolation, computeIsolationVariantMetrics, ISOLATION_THRESHOLDS, type IsolationComparison, type IsolationRunRecord, type IsolationVariantMetrics } from "./isolationAnalysis";
import { buildIsolationSurface, contractBreakdown, ISOLATION_VARIANT_IDS, sha16, VARIANT_LABELS, VARIANT_TOGGLES, type IsolationVariantId } from "./isolationSurfaces";
import { REPLY_DETECTOR_VERSION } from "./replyClassifier";

/**
 * SALES-AGENT-R3-P7.9. Orchestration of the 7-variant capability-contract isolation.
 * Every variant runs the SAME true autonomous harness of P7.8-R (runTrueHarnessCase:
 * autonomous prompt, own loop, Gateway, identity, DRM state refresh, model
 * configuration, fixtures). The only variable is the model-facing tool contract.
 */

export type IsolationPlanEntry = { sequenceIndex: number; pairId: string; caseId: string; runOrdinal: number; variant: IsolationVariantId; positionInGroup: number };

/** Scenarios interleaved across the three groups (M, K, I round-robin) so no group is bunched in time. */
export function interleavedScenarioIds(scenarios: readonly IsolationScenario[] = ISOLATION_SCENARIOS): string[] {
  const groups = (["Q-", "Q+", "NEG"] as const).map((group) => scenarios.filter((scenario) => scenario.group === group).map((scenario) => scenario.caseId));
  const out: string[] = [];
  for (let index = 0; index < Math.max(...groups.map((group) => group.length)); index += 1) for (const group of groups) if (index < group.length) out.push(group[index]);
  return out;
}

/**
 * Deterministic and counterbalanced: the 7 variants of a (scenario, run) group run
 * back to back; the starting variant rotates with the group index, so every variant
 * leads (and follows every other) about equally. Outer loop = run ordinal, so the 3
 * runs of a scenario are spread over the whole session. No randomness.
 */
export function buildIsolationPlan(caseIds: readonly string[], runsPerScenario: number, variants: readonly IsolationVariantId[] = ISOLATION_VARIANT_IDS): IsolationPlanEntry[] {
  const plan: IsolationPlanEntry[] = [];
  let groupIndex = 0;
  for (let runOrdinal = 0; runOrdinal < runsPerScenario; runOrdinal += 1) {
    for (const caseId of caseIds) {
      const shift = groupIndex % variants.length;
      [...variants.slice(shift), ...variants.slice(0, shift)].forEach((variant, positionInGroup) => plan.push({ sequenceIndex: plan.length, pairId: `${caseId}-r${runOrdinal}`, caseId, runOrdinal, variant, positionInGroup }));
      groupIndex += 1;
    }
  }
  return plan;
}

// ---- freeze ---------------------------------------------------------------------------

const B = "lib/brain/commercial/agent-loop/benchmark";
/** What must not change between the smoke and the batch (sha256 of the LF-normalised file). */
export const FREEZE_FILE_GROUPS: Record<string, string[]> = {
  autonomousPrompt: [`${B}/r3TrueAB/trueHarnessPrompt.ts`],
  autonomousLoop: [`${B}/r3TrueAB/trueHarnessLoop.ts`, `${B}/r3TrueAB/nativeToolClient.ts`],
  gatewayAdapter: [`${B}/r3TrueAB/toolSurface.ts`, `${B}/r3CapabilityIsolation/isolationSurfaces.ts`, "lib/brain/commercial/capability-gateway/executeCapability.ts"],
  corpus: [`${B}/r3CapabilityIsolation/isolationCorpus.ts`],
  analyzer: [`${B}/r3CapabilityIsolation/isolationAnalysis.ts`, `${B}/r3CapabilityIsolation/replyClassifier.ts`, `${B}/r3AutonomousAB/analysis.ts`, `${B}/r3CommercialE2E/metrics.ts`],
  initialFixtureBuilder: [`${B}/r3TrueAB/runTrueHarnessCase.ts`, `${B}/r3StableAgentV1/environment.ts`, `${B}/environment.ts`],
  detector: [`${B}/r3CapabilityIsolation/replyClassifier.ts`, "tests/agent-loop/benchmark/r3CapabilityIsolation/goldenReplies.json"]
};

export const sha256File = (path: string): string => createHash("sha256").update(readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n")).digest("hex");

export function computeFreezeHashes(groups: Record<string, string[]> = FREEZE_FILE_GROUPS): Record<string, Record<string, string>> {
  return Object.fromEntries(Object.entries(groups).map(([group, files]) => [group, Object.fromEntries(files.map((file) => [file, sha256File(file)]))]));
}

export function diffFreeze(expected: Record<string, Record<string, string>>, actual: Record<string, Record<string, string>>): string[] {
  const changed: string[] = [];
  for (const [group, files] of Object.entries(expected)) for (const [file, hash] of Object.entries(files)) if (actual[group]?.[file] !== hash) changed.push(`${group}:${file}`);
  return changed;
}

export const corpusSha16 = (): string => sha16(JSON.stringify(ISOLATION_SCENARIOS));

// ---- run --------------------------------------------------------------------------------

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

export type IsolationFailureRecord = { variant: IsolationVariantId; caseId: string; runOrdinal: number; group: string; category: string; replyClass: string; qPlusFailureMode: string | null; terminalReason: string | null; toolSequence: string; detail: string | null };

export type IsolationBundle = {
  manifest: Record<string, unknown> & { plan: IsolationPlanEntry[] };
  runs: IsolationRunRecord[];
  summary: Record<IsolationVariantId, IsolationVariantMetrics>;
  comparison: IsolationComparison;
  failures: IsolationFailureRecord[];
  contractMatrix: Record<string, unknown>;
};

export type RunIsolationOptions = {
  mode: "offline" | "live";
  runsPerScenario: number;
  caseIds: readonly string[];
  variants?: readonly IsolationVariantId[];
  onRunFinished?: (record: IsolationRunRecord, total: number) => void;
};
export type RunIsolationResult = { ok: true; bundle: IsolationBundle } | { ok: false; reason: "environment_blocked"; environmentHealth: BenchmarkE2EEnvironmentHealth };

export async function runIsolation(options: RunIsolationOptions): Promise<RunIsolationResult> {
  const variants = options.variants ?? ISOLATION_VARIANT_IDS;
  const corpus: BenchmarkE2ECase[] = options.caseIds.map((caseId) => toBenchmarkCase(scenarioById(caseId)));
  // M05/K12 are quote requests: declare the (locally BLOCKED) Quote Service honestly, exactly like P7.8-R did for its quote cases.
  const corpusRequiresQuote = options.caseIds.some((caseId) => scenarioById(caseId).turns.some((turn) => /cot[ií]z/i.test(turn)));
  const environmentHealth = await checkEnvironmentHealth({ mode: options.mode, corpusRequiresQuote });
  let liveConfig: LiveBenchmarkProviderConfig | null = null;
  if (options.mode === "live") {
    const resolution = resolveLiveBenchmarkProviderConfig();
    if (resolution.ok) liveConfig = applyBenchmarkE2EOverridesToLiveConfig(resolution.config, readBenchmarkE2EOverrides());
  }
  if (environmentHealth.dependencies.some((dependency) => dependency.name === "mariadb" && dependency.status === "BLOCKED")) return { ok: false, reason: "environment_blocked", environmentHealth };
  if (options.mode === "live" && liveConfig === null) throw new Error("live mode requested but the live provider is not configured (BENCHMARK_LIVE_LLM_ENABLED, BRAIN_MODEL_API_URL/KEY)");

  const shared = {
    model: options.mode === "offline" ? "benchmark-offline-model" : (liveConfig?.model ?? null),
    temperature: options.mode === "offline" ? null : (liveConfig?.temperature ?? null),
    thinking: options.mode === "offline" ? null : (liveConfig?.thinking ?? null),
    timeoutMs: readBenchmarkE2EOverrides().modelTimeoutMs ?? SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT.timeoutMs,
    maxOutputTokens: options.mode === "offline" ? null : (liveConfig?.maxOutputTokens ?? null),
    maxModelRetries: options.mode === "offline" ? null : (liveConfig?.maxModelRetries ?? null)
  } as const;
  const surfaces = Object.fromEntries(variants.map((variant) => [variant, buildIsolationSurface(variant)]));
  const plan = buildIsolationPlan(options.caseIds, options.runsPerScenario, variants);
  const batchId = `p79-${Date.now()}-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const systemPromptSha = sha16(buildTrueHarnessSystemPrompt(SALES_AGENT_CONFIGURATION_SAFE_DEFAULT));

  const records: IsolationRunRecord[] = [];
  for (const entry of plan) {
    const testCase = corpus.find((candidate) => candidate.caseId === entry.caseId) as BenchmarkE2ECase;
    const scenario = scenarioById(entry.caseId);
    const surface = surfaces[entry.variant];
    const runConfig = { variant: entry.variant, ...shared, promptVersion: TRUE_HARNESS_PROMPT_VERSION, promptSha256: systemPromptSha, toolContractSha16: sha16(JSON.stringify(surface.tools)) };
    const identity = { pairId: entry.pairId, variant: entry.variant, caseId: entry.caseId, group: scenario.group, runOrdinal: entry.runOrdinal, sequenceIndex: entry.sequenceIndex };
    let record: IsolationRunRecord;
    try {
      const result = await runTrueHarnessCase(testCase, {
        arm: entry.variant,
        surface,
        runOrdinal: entry.runOrdinal,
        benchmarkRunId: `${batchId}-${entry.caseId}-${entry.variant}-run${entry.runOrdinal}`,
        timeoutMs: shared.timeoutMs,
        liveConfig: liveConfig ?? undefined,
        callModel: options.mode === "offline" ? createScriptedNativeModel(testCase.turns.flatMap((turn) => turn.offlineScript)) : undefined
      });
      record = { ...identity, trace: result.trace, harnessError: null, runConfig: { ...runConfig, promptSha256: result.promptSha256 }, promptStats: { systemPromptChars: result.promptStats.systemPromptChars, systemPromptApproxTokens: result.promptStats.systemPromptApproxTokens, toolContractChars: result.toolContractChars, providerCallCount: result.promptStats.providerCallCount } };
    } catch (error) {
      record = { ...identity, trace: null, harnessError: error instanceof Error ? error.message.slice(0, 300) : "unknown_error", runConfig, promptStats: null };
    }
    records.push(record);
    options.onRunFinished?.(record, plan.length);
  }

  const summary = Object.fromEntries(variants.map((variant) => [variant, computeIsolationVariantMetrics(variant, records)])) as Record<IsolationVariantId, IsolationVariantMetrics>;
  const comparison = compareIsolation(summary);
  const failures: IsolationFailureRecord[] = records
    .flatMap((record) => analyzeIsolationRun(record).map((turn) => ({ record, turn })))
    .filter(({ turn }) => (turn.scenarioGroup === "NEG" ? turn.mutationRequested.length > 0 : !turn.progressFixed))
    .map(({ record, turn }) => ({ variant: record.variant, caseId: turn.caseId, runOrdinal: turn.runOrdinal, group: turn.scenarioGroup, category: turn.category, replyClass: turn.replyClass, qPlusFailureMode: turn.qPlusFailureMode, terminalReason: turn.terminalReason, toolSequence: turn.toolSequence, detail: record.harnessError }));
  const { gitSha, dirtyFileCount } = resolveGitInfo();
  const contractMatrix = { note: "Rendered size per variant and per in-scope tool (chars; approxTokens = chars/4). Component chars are the rendered text each component contributes.", variants: Object.fromEntries(variants.map((variant) => [variant, contractBreakdown(variant)])) };

  return {
    ok: true,
    bundle: {
      manifest: {
        phase: "P7.9",
        gitSha,
        dirtyFileCount,
        startedAt,
        finishedAt: new Date().toISOString(),
        mode: options.mode,
        environmentHealth,
        sharedConfig: shared,
        benchmarkOverrides: listActiveBenchmarkE2EOverrides(),
        harness: { promptVersion: TRUE_HARNESS_PROMPT_VERSION, systemPromptSha16: systemPromptSha, note: "Same P7.8-R true autonomous harness for every variant (runTrueHarnessCase); the only variable is the model-facing tool contract." },
        freezeHashes: computeFreezeHashes(),
        detector: { version: REPLY_DETECTOR_VERSION, sha256: sha256File(`${B}/r3CapabilityIsolation/replyClassifier.ts`), goldenSha256: sha256File("tests/agent-loop/benchmark/r3CapabilityIsolation/goldenReplies.json") },
        corpus: { version: ISOLATION_CORPUS_VERSION, sha16: corpusSha16(), scenarioCount: options.caseIds.length, caseIds: options.caseIds },
        variants: Object.fromEntries(variants.map((variant) => [variant, { label: VARIANT_LABELS[variant], toggles: variant === "B6_FULL_THIN" ? "P7.8-R C1 (buildThinToolSurface)" : VARIANT_TOGGLES[variant as Exclude<IsolationVariantId, "B6_FULL_THIN">], toolContractSha16: sha16(JSON.stringify(surfaces[variant].tools)), stats: surfaces[variant].stats }])),
        thresholds: ISOLATION_THRESHOLDS,
        runsPerScenario: options.runsPerScenario,
        notReproducibleInHarness: [
          "EC2_ONLY_CHANNEL_BEHAVIOR: webhook/HTTPS, settle delay, delivery/read events and the real outbox worker are outside every variant.",
          "Quote Service is BLOCKED locally: create_quote outcomes are not evidence about any variant.",
          "Catalog fixture has two products (Classic 31, Pro 32); conversation memory across turns is an in-memory transcript (same as P7.8-R B/C1)."
        ],
        plan
      },
      runs: records,
      summary,
      comparison,
      failures,
      contractMatrix
    }
  };
}

export type IsolationArtifactFiles = Record<"manifest.json" | "runs.jsonl" | "summary.json" | "comparison.json" | "failures.json" | "contract-matrix.json", string>;

export function buildIsolationArtifactFiles(bundle: IsolationBundle): IsolationArtifactFiles {
  return {
    "manifest.json": JSON.stringify(bundle.manifest, null, 2),
    "runs.jsonl": bundle.runs.map((run) => JSON.stringify({ ...run, turnAnalyses: analyzeIsolationRun(run) })).join("\n"),
    "summary.json": JSON.stringify(bundle.summary, null, 2),
    "comparison.json": JSON.stringify(bundle.comparison, null, 2),
    "failures.json": JSON.stringify(bundle.failures, null, 2),
    "contract-matrix.json": JSON.stringify(bundle.contractMatrix, null, 2)
  };
}
