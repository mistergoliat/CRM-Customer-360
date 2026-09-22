import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT, SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT } from "../../../sales-agent-configuration";
import { checkEnvironmentHealth } from "../r3CommercialE2E/environmentHealthPrecheck";
import { applyBenchmarkE2EOverridesToLiveConfig, listActiveBenchmarkE2EOverrides, readBenchmarkE2EOverrides } from "../r3CommercialE2E/benchmarkOverrides";
import { resolveLiveBenchmarkProviderConfig, type LiveBenchmarkProviderConfig } from "../liveProvider";
import type { BenchmarkE2ECase, BenchmarkE2EEnvironmentHealth } from "../r3CommercialE2E/types";
import { runTrueHarnessCase } from "../r3TrueAB/runTrueHarnessCase";
import { createScriptedNativeModel } from "../r3TrueAB/scriptedNativeModel";
import { buildTrueHarnessSystemPrompt, TRUE_HARNESS_PROMPT_VERSION } from "../r3TrueAB/trueHarnessPrompt";
import { CONFIRMATION_CLASSIFIER_VERSION } from "../r3MutationSemantics/confirmationClassifier";
import { classifierGoldenReport, GOLDEN_CONFIRMATIONS_PATH, sha256File } from "../r3MutationSemantics/runSemantics";
import { semanticsContractHashes, sha16, sha256Text } from "../r3MutationSemantics/semanticsSurfaces";
import { REPLICATION_CORPUS_VERSION, REPLICATION_GROUP_LABELS, REPLICATION_GROUPS, REPLICATION_SCENARIOS, scenarioById, toBenchmarkCase, type ReplicationGroup } from "./corpus";
import { analyzeReplicationRun, compareReplication, isReplicationFailure, REPLICATION_THRESHOLDS, computeReplicationVariantMetrics, type ReplicationComparison, type ReplicationRunRecord, type ReplicationVariantMetrics } from "./analysis";
import { buildReplicationSurface, REPLICATION_VARIANT_IDS, REPLICATION_VARIANT_LABELS, type ReplicationVariantId } from "./surfaces";

/**
 * SALES-AGENT-R3-P7.11. Orchestration of the R0 (P7.10 S0) / R1 (P7.10 S1) independent
 * replication, on a NEW corpus, through the SAME true autonomous harness (runTrueHarnessCase):
 * autonomous prompt, own loop, executeGovernedCapability -> Gateway, identity, DRM state refresh,
 * model configuration, fixtures. R3 does not participate. S2 is not used.
 */

export type ReplicationPlanEntry = { sequenceIndex: number; pairId: string; caseId: string; runOrdinal: number; variant: ReplicationVariantId; positionInGroup: number };

/** Scenarios interleaved round-robin across the six groups so no group is bunched in time. */
export function interleavedScenarioIds(scenarios: readonly (typeof REPLICATION_SCENARIOS)[number][] = REPLICATION_SCENARIOS): string[] {
  const groups = REPLICATION_GROUPS.map((group) => scenarios.filter((scenario) => scenario.group === group).map((scenario) => scenario.caseId));
  const out: string[] = [];
  for (let index = 0; index < Math.max(...groups.map((group) => group.length)); index += 1) for (const group of groups) if (index < group.length) out.push(group[index]);
  return out;
}

/**
 * Deterministic and counterbalanced: R0/R1 of a (scenario, run) pair run back to back; which one
 * goes first alternates with the group index. Outer loop = run ordinal, so the 3 runs of a
 * scenario are spread over the whole session. No randomness, no run-all-R0-then-all-R1.
 */
export function buildReplicationPlan(caseIds: readonly string[], runsPerScenario: number, variants: readonly ReplicationVariantId[] = REPLICATION_VARIANT_IDS): ReplicationPlanEntry[] {
  const plan: ReplicationPlanEntry[] = [];
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
const S = `${B}/r3ConfirmationBoundary`;
/** What must not change between the smoke and the batch. R0/R1 are frozen through the P7.10 contract hashes directly (S0/S1): no separate R0/R1 prose exists to hash. */
export const REPLICATION_FREEZE_FILE_GROUPS: Record<string, string[]> = {
  autonomousPrompt: [`${B}/r3TrueAB/trueHarnessPrompt.ts`],
  autonomousLoop: [`${B}/r3TrueAB/trueHarnessLoop.ts`, `${B}/r3TrueAB/nativeToolClient.ts`],
  contractBuilders: [`${B}/r3TrueAB/toolSurface.ts`, `${B}/r3MutationSemantics/semanticsSurfaces.ts`, `${S}/surfaces.ts`, "lib/brain/commercial/capability-gateway/executeCapability.ts", "lib/brain/commercial/capability-gateway/selectProductsCapability.ts"],
  corpus: [`${S}/corpus.ts`],
  classifier: [`${B}/r3MutationSemantics/confirmationClassifier.ts`, GOLDEN_CONFIRMATIONS_PATH],
  analyzer: [`${S}/analysis.ts`, `${B}/r3AutonomousAB/analysis.ts`, `${B}/r3CommercialE2E/metrics.ts`],
  fixtures: [`${B}/r3TrueAB/runTrueHarnessCase.ts`, `${B}/r3StableAgentV1/environment.ts`, `${B}/environment.ts`]
};

export function computeFreezeHashes(groups: Record<string, string[]> = REPLICATION_FREEZE_FILE_GROUPS): Record<string, Record<string, string>> {
  return {
    ...Object.fromEntries(Object.entries(groups).map(([group, files]) => [group, Object.fromEntries(files.map((file) => [file, sha256File(file)]))])),
    contracts: { "S0:tools": semanticsContractHashes()["S0:tools"], "S0:select_products": semanticsContractHashes()["S0:select_products"], "S1:tools": semanticsContractHashes()["S1:tools"], "S1:select_products": semanticsContractHashes()["S1:select_products"] },
    signal: { thresholds: sha256Text(JSON.stringify(REPLICATION_THRESHOLDS)) }
  };
}

export function diffFreeze(expected: Record<string, Record<string, string>>, actual: Record<string, Record<string, string>>): string[] {
  const changed: string[] = [];
  for (const [group, files] of Object.entries(expected)) for (const [file, hash] of Object.entries(files)) if (actual[group]?.[file] !== hash) changed.push(`${group}:${file}`);
  return changed;
}

export const corpusSha16 = (): string => sha16(JSON.stringify(REPLICATION_SCENARIOS));

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

export type ReplicationFailureRecord = { variant: ReplicationVariantId; caseId: string; group: string; runOrdinal: number; category: string; terminalReason: string | null; toolSequence: string; detail: string | null };

export type ReplicationBundle = {
  manifest: Record<string, unknown> & { plan: ReplicationPlanEntry[] };
  runs: ReplicationRunRecord[];
  summary: Record<ReplicationVariantId, ReplicationVariantMetrics>;
  comparison: ReplicationComparison;
  failures: ReplicationFailureRecord[];
  classifierGolden: ReturnType<typeof classifierGoldenReport>;
};

export type RunReplicationOptions = {
  mode: "offline" | "live";
  runsPerScenario: number;
  caseIds: readonly string[];
  variants?: readonly ReplicationVariantId[];
  onRunFinished?: (record: ReplicationRunRecord, total: number) => void;
};
export type RunReplicationResult = { ok: true; bundle: ReplicationBundle } | { ok: false; reason: "environment_blocked"; environmentHealth: BenchmarkE2EEnvironmentHealth };

export async function runReplication(options: RunReplicationOptions): Promise<RunReplicationResult> {
  const variants = options.variants ?? REPLICATION_VARIANT_IDS;
  const corpus: BenchmarkE2ECase[] = options.caseIds.map((caseId) => toBenchmarkCase(scenarioById(caseId)));
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
  const surfaces = Object.fromEntries(variants.map((variant) => [variant, buildReplicationSurface(variant)]));
  const plan = buildReplicationPlan(options.caseIds, options.runsPerScenario, variants);
  const batchId = `p711-${Date.now()}-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const systemPromptSha = sha16(buildTrueHarnessSystemPrompt(SALES_AGENT_CONFIGURATION_SAFE_DEFAULT));

  const records: ReplicationRunRecord[] = [];
  for (const entry of plan) {
    const testCase = corpus.find((candidate) => candidate.caseId === entry.caseId) as BenchmarkE2ECase;
    const scenario = scenarioById(entry.caseId);
    const surface = surfaces[entry.variant];
    const runConfig = { variant: entry.variant, ...shared, promptVersion: TRUE_HARNESS_PROMPT_VERSION, promptSha256: systemPromptSha, toolContractSha16: sha16(JSON.stringify(surface.tools)) };
    const identity = { pairId: entry.pairId, variant: entry.variant, caseId: entry.caseId, group: scenario.group, runOrdinal: entry.runOrdinal, sequenceIndex: entry.sequenceIndex };
    let record: ReplicationRunRecord;
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

  const summary = Object.fromEntries(variants.map((variant) => [variant, computeReplicationVariantMetrics(variant, records)])) as Record<ReplicationVariantId, ReplicationVariantMetrics>;
  const comparison = compareReplication(summary.R0_CURRENT_SEMANTICS, summary.R1_CONSEQUENCE_STATEMENT);
  const failures: ReplicationFailureRecord[] = records
    .flatMap((record) => analyzeReplicationRun(record).map((turn) => ({ record, turn })))
    .filter(({ turn }) => isReplicationFailure(turn.category))
    .map(({ record, turn }) => ({ variant: record.variant, caseId: turn.caseId, group: REPLICATION_GROUP_LABELS[turn.group as ReplicationGroup], runOrdinal: turn.runOrdinal, category: turn.category, terminalReason: turn.terminalReason, toolSequence: turn.toolSequence, detail: record.harnessError }));
  const { gitSha, dirtyFileCount } = resolveGitInfo();
  const classifierGolden = classifierGoldenReport();

  return {
    ok: true,
    bundle: {
      manifest: {
        phase: "P7.11",
        gitSha,
        dirtyFileCount,
        startedAt,
        finishedAt: new Date().toISOString(),
        mode: options.mode,
        environmentHealth,
        sharedConfig: shared,
        benchmarkOverrides: listActiveBenchmarkE2EOverrides(),
        harness: { promptVersion: TRUE_HARNESS_PROMPT_VERSION, systemPromptSha16: systemPromptSha, note: "Same P7.8-R/P7.10 true autonomous harness for R0 and R1 (runTrueHarnessCase); R3 does not participate. R0/R1 are the P7.10 S0/S1 surfaces, imported unchanged (no S2)." },
        freezeHashes: computeFreezeHashes(),
        classifier: { version: CONFIRMATION_CLASSIFIER_VERSION, sha256: classifierGolden.classifierSha256, goldenSha256: classifierGolden.goldenSha256, goldenEntries: classifierGolden.entries.length, goldenDiscrepancies: classifierGolden.discrepancies },
        corpus: { version: REPLICATION_CORPUS_VERSION, sha16: corpusSha16(), scenarioCount: options.caseIds.length, caseIds: options.caseIds, byGroup: Object.fromEntries(REPLICATION_GROUPS.map((group) => [REPLICATION_GROUP_LABELS[group], options.caseIds.filter((id) => scenarioById(id).group === group).length])) },
        variants: Object.fromEntries(variants.map((variant) => [variant, { label: REPLICATION_VARIANT_LABELS[variant], toolContractSha16: sha16(JSON.stringify(surfaces[variant].tools)), stats: surfaces[variant].stats }])),
        thresholds: REPLICATION_THRESHOLDS,
        runsPerScenario: options.runsPerScenario,
        notReproducibleInHarness: [
          "EC2_ONLY_CHANNEL_BEHAVIOR: webhook/HTTPS, settle delay, delivery/read events and the real outbox worker are outside every variant.",
          "Quote Service is BLOCKED locally: create_quote outcomes are not evidence about either variant (D scenarios are scored on select_products / quote progression, per task section 37).",
          "Catalog fixture has two products (Classic 31, Pro 32); conversation memory across turns is an in-memory transcript (same as P7.8-R / P7.9 / P7.10)."
        ],
        plan
      },
      runs: records,
      summary,
      comparison,
      failures,
      classifierGolden
    }
  };
}

export type ReplicationArtifactFiles = Record<"manifest.json" | "runs.jsonl" | "summary.json" | "comparison.json" | "failures.json" | "classifier-golden.json", string>;

export function buildReplicationArtifactFiles(bundle: ReplicationBundle): ReplicationArtifactFiles {
  return {
    "manifest.json": JSON.stringify(bundle.manifest, null, 2),
    "runs.jsonl": bundle.runs
      .map((run) => {
        const scenario = scenarioById(run.caseId);
        return JSON.stringify({ ...run, scenario: { group: REPLICATION_GROUP_LABELS[scenario.group], groupLetter: scenario.group, expected: scenario.expected ?? null, initialSelection: scenario.seedSelection ?? [] }, turnAnalyses: analyzeReplicationRun(run) });
      })
      .join("\n"),
    "summary.json": JSON.stringify(bundle.summary, null, 2),
    "comparison.json": JSON.stringify(bundle.comparison, null, 2),
    "failures.json": JSON.stringify(bundle.failures, null, 2),
    "classifier-golden.json": JSON.stringify(bundle.classifierGolden, null, 2)
  };
}
