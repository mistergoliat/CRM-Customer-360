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
import { classifyConfirmation, classifyMissingFactKind, CONFIRMATION_CLASSIFIER_VERSION, type ConfirmationClass, type MissingFactKind } from "./confirmationClassifier";
import { SEMANTICS_CORPUS_VERSION, SEMANTICS_SCENARIOS, SPEECH_ACT_GROUPS, SPEECH_ACT_LABELS, scenarioById, toBenchmarkCase, type SpeechActGroup } from "./semanticsCorpus";
import { analyzeSemanticsRun, compareSemantics, computeSemanticsVariantMetrics, isSemanticsFailure, SEMANTICS_SIGNAL_RULE, SEMANTICS_THRESHOLDS, type SemanticsComparison, type SemanticsRunRecord, type SemanticsVariantMetrics } from "./semanticsAnalysis";
import { buildSemanticsSurface, S1_CONSEQUENCE_TEXT, S2_DO_NOT_USE_WHEN, S2_USE_WHEN, sha256Text, SEMANTICS_VARIANT_IDS, SEMANTICS_VARIANT_LABELS, semanticsContractHashes, semanticsContractRow, sha16, type SemanticsVariantId } from "./semanticsSurfaces";

/**
 * SALES-AGENT-R3-P7.10. Orchestration of the S0 / S1 / S2 mutation-semantics experiment. All
 * three variants run the SAME true autonomous harness of P7.8-R (runTrueHarnessCase: autonomous
 * prompt, own loop, executeGovernedCapability -> Gateway, identity, DRM state refresh, model
 * configuration, fixtures). R3 does not participate. The only variable is the model-facing
 * select_products prose (S1: consequence sentence; S2: S1 plus coherent useWhen/doNotUseWhen).
 */

export type SemanticsPlanEntry = { sequenceIndex: number; pairId: string; caseId: string; runOrdinal: number; variant: SemanticsVariantId; positionInGroup: number };

/** Scenarios interleaved round-robin across the six speech-act groups so no group is bunched in time. */
export function interleavedScenarioIds(scenarios: readonly (typeof SEMANTICS_SCENARIOS)[number][] = SEMANTICS_SCENARIOS): string[] {
  const groups = SPEECH_ACT_GROUPS.map((group) => scenarios.filter((scenario) => scenario.group === group).map((scenario) => scenario.caseId));
  const out: string[] = [];
  for (let index = 0; index < Math.max(...groups.map((group) => group.length)); index += 1) for (const group of groups) if (index < group.length) out.push(group[index]);
  return out;
}

/**
 * Deterministic and counterbalanced: the three variants of a (scenario, run) group run back to
 * back; the variant that goes first alternates with the group index. Outer loop = run ordinal,
 * so the 3 runs of a scenario are spread over the whole session. No randomness.
 */
export function buildSemanticsPlan(caseIds: readonly string[], runsPerScenario: number, variants: readonly SemanticsVariantId[] = SEMANTICS_VARIANT_IDS): SemanticsPlanEntry[] {
  const plan: SemanticsPlanEntry[] = [];
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
const S = `${B}/r3MutationSemantics`;
const TESTS = "tests/agent-loop/benchmark/r3MutationSemantics";
/** What must not change between the smoke and the batch (sha256 of the LF-normalised file). The model-facing contracts are frozen by content hash (see `contracts` in computeFreezeHashes). */
export const FREEZE_FILE_GROUPS: Record<string, string[]> = {
  autonomousPrompt: [`${B}/r3TrueAB/trueHarnessPrompt.ts`],
  autonomousLoop: [`${B}/r3TrueAB/trueHarnessLoop.ts`, `${B}/r3TrueAB/nativeToolClient.ts`],
  contractBuilders: [`${B}/r3TrueAB/toolSurface.ts`, `${S}/semanticsSurfaces.ts`, `${B}/r3CapabilityIsolation/isolationSurfaces.ts`, "lib/brain/commercial/capability-gateway/executeCapability.ts", "lib/brain/commercial/capability-gateway/selectProductsCapability.ts"],
  corpus: [`${S}/semanticsCorpus.ts`],
  classifier: [`${S}/confirmationClassifier.ts`, `${TESTS}/goldenConfirmations.json`],
  analyzer: [`${S}/semanticsAnalysis.ts`, `${B}/r3CapabilityIsolation/isolationAnalysis.ts`, `${B}/r3AutonomousAB/analysis.ts`, `${B}/r3CommercialE2E/metrics.ts`],
  fixtures: [`${B}/r3TrueAB/runTrueHarnessCase.ts`, `${B}/r3StableAgentV1/environment.ts`, `${B}/environment.ts`]
};

export const sha256File = (path: string): string => createHash("sha256").update(readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n")).digest("hex");

export function computeFreezeHashes(groups: Record<string, string[]> = FREEZE_FILE_GROUPS): Record<string, Record<string, string>> {
  return {
    ...Object.fromEntries(Object.entries(groups).map(([group, files]) => [group, Object.fromEntries(files.map((file) => [file, sha256File(file)]))])),
    contracts: semanticsContractHashes(),
    signal: { thresholds: sha256Text(JSON.stringify(SEMANTICS_THRESHOLDS)), rule: sha256Text(JSON.stringify(SEMANTICS_SIGNAL_RULE)) }
  };
}

export function diffFreeze(expected: Record<string, Record<string, string>>, actual: Record<string, Record<string, string>>): string[] {
  const changed: string[] = [];
  for (const [group, files] of Object.entries(expected)) for (const [file, hash] of Object.entries(files)) if (actual[group]?.[file] !== hash) changed.push(`${group}:${file}`);
  return changed;
}

export const corpusSha16 = (): string => sha16(JSON.stringify(SEMANTICS_SCENARIOS));

// ---- golden --------------------------------------------------------------------------------

export type GoldenConfirmationEntry = { id: string; source: string; reply: string | null; selectCompleted: boolean; label: ConfirmationClass; /** Only on MISSING_FACT_QUESTION entries: the hand-labelled sub-kind (residual taxonomy). */ missingKind?: MissingFactKind };
export const GOLDEN_CONFIRMATIONS_PATH = `${TESTS}/goldenConfirmations.json`;

export type GoldenReportEntry = GoldenConfirmationEntry & { predicted: ConfirmationClass; predictedMissingKind: MissingFactKind | null; match: boolean };

export function classifierGoldenReport(): { classifierVersion: string; classifierSha256: string; goldenSha256: string; entries: GoldenReportEntry[]; discrepancies: number } {
  const golden = JSON.parse(readFileSync(join(process.cwd(), GOLDEN_CONFIRMATIONS_PATH), "utf8")) as GoldenConfirmationEntry[];
  const entries = golden.map((entry) => {
    const predicted = classifyConfirmation({ reply: entry.reply, selectCompleted: entry.selectCompleted });
    const predictedMissingKind = entry.selectCompleted ? null : classifyMissingFactKind(entry.reply);
    const kindMatches = entry.label !== "MISSING_FACT_QUESTION" || predictedMissingKind === (entry.missingKind ?? null);
    return { ...entry, predicted, predictedMissingKind, match: predicted === entry.label && kindMatches };
  });
  return { classifierVersion: CONFIRMATION_CLASSIFIER_VERSION, classifierSha256: sha256File(`${S}/confirmationClassifier.ts`), goldenSha256: sha256File(GOLDEN_CONFIRMATIONS_PATH), entries, discrepancies: entries.filter((entry) => !entry.match).length };
}

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

export type SemanticsFailureRecord = { variant: SemanticsVariantId; caseId: string; speechAct: string; runOrdinal: number; category: string; confirmationClass: ConfirmationClass; terminalReason: string | null; toolSequence: string; detail: string | null };

export type SemanticsBundle = {
  manifest: Record<string, unknown> & { plan: SemanticsPlanEntry[] };
  runs: SemanticsRunRecord[];
  summary: Record<SemanticsVariantId, SemanticsVariantMetrics>;
  comparison: SemanticsComparison;
  failures: SemanticsFailureRecord[];
  classifierGolden: ReturnType<typeof classifierGoldenReport>;
};

export type RunSemanticsOptions = {
  mode: "offline" | "live";
  runsPerScenario: number;
  caseIds: readonly string[];
  variants?: readonly SemanticsVariantId[];
  onRunFinished?: (record: SemanticsRunRecord, total: number) => void;
};
export type RunSemanticsResult = { ok: true; bundle: SemanticsBundle } | { ok: false; reason: "environment_blocked"; environmentHealth: BenchmarkE2EEnvironmentHealth };

export async function runSemantics(options: RunSemanticsOptions): Promise<RunSemanticsResult> {
  const variants = options.variants ?? SEMANTICS_VARIANT_IDS;
  const corpus: BenchmarkE2ECase[] = options.caseIds.map((caseId) => toBenchmarkCase(scenarioById(caseId)));
  // Q scenarios are quote requests: declare the (locally BLOCKED) Quote Service honestly, exactly like P7.8-R / P7.9 did.
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
  const surfaces = Object.fromEntries(variants.map((variant) => [variant, buildSemanticsSurface(variant)]));
  const plan = buildSemanticsPlan(options.caseIds, options.runsPerScenario, variants);
  const batchId = `p710-${Date.now()}-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const systemPromptSha = sha16(buildTrueHarnessSystemPrompt(SALES_AGENT_CONFIGURATION_SAFE_DEFAULT));

  const records: SemanticsRunRecord[] = [];
  for (const entry of plan) {
    const testCase = corpus.find((candidate) => candidate.caseId === entry.caseId) as BenchmarkE2ECase;
    const scenario = scenarioById(entry.caseId);
    const surface = surfaces[entry.variant];
    const runConfig = { variant: entry.variant, ...shared, promptVersion: TRUE_HARNESS_PROMPT_VERSION, promptSha256: systemPromptSha, toolContractSha16: sha16(JSON.stringify(surface.tools)) };
    const identity = { pairId: entry.pairId, variant: entry.variant, caseId: entry.caseId, group: scenario.group, runOrdinal: entry.runOrdinal, sequenceIndex: entry.sequenceIndex };
    let record: SemanticsRunRecord;
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

  const summary = Object.fromEntries(variants.map((variant) => [variant, computeSemanticsVariantMetrics(variant, records)])) as Record<SemanticsVariantId, SemanticsVariantMetrics>;
  const comparison = compareSemantics(summary, records);
  const failures: SemanticsFailureRecord[] = records
    .flatMap((record) => analyzeSemanticsRun(record).map((turn) => ({ record, turn })))
    .filter(({ turn }) => isSemanticsFailure(turn.category))
    .map(({ record, turn }) => ({ variant: record.variant, caseId: turn.caseId, speechAct: SPEECH_ACT_LABELS[turn.group], runOrdinal: turn.runOrdinal, category: turn.category, confirmationClass: turn.confirmationClass, terminalReason: turn.terminalReason, toolSequence: turn.toolSequence, detail: record.harnessError }));
  const { gitSha, dirtyFileCount } = resolveGitInfo();
  const classifierGolden = classifierGoldenReport();

  return {
    ok: true,
    bundle: {
      manifest: {
        phase: "P7.10",
        gitSha,
        dirtyFileCount,
        startedAt,
        finishedAt: new Date().toISOString(),
        mode: options.mode,
        environmentHealth,
        sharedConfig: shared,
        benchmarkOverrides: listActiveBenchmarkE2EOverrides(),
        harness: { promptVersion: TRUE_HARNESS_PROMPT_VERSION, systemPromptSha16: systemPromptSha, note: "Same P7.8-R true autonomous harness for S0, S1 and S2 (runTrueHarnessCase); R3 does not participate; the only variable is the model-facing select_products prose (S1: consequence sentence; S2: S1 plus coherent useWhen/doNotUseWhen)." },
        freezeHashes: computeFreezeHashes(),
        contracts: { hashes: semanticsContractHashes(), rows: Object.fromEntries(variants.map((variant) => [variant, semanticsContractRow(variant)])), s1ConsequenceText: S1_CONSEQUENCE_TEXT, s2UseWhen: S2_USE_WHEN, s2DoNotUseWhen: S2_DO_NOT_USE_WHEN },
        classifier: { version: CONFIRMATION_CLASSIFIER_VERSION, sha256: classifierGolden.classifierSha256, goldenSha256: classifierGolden.goldenSha256, goldenEntries: classifierGolden.entries.length, goldenDiscrepancies: classifierGolden.discrepancies },
        corpus: { version: SEMANTICS_CORPUS_VERSION, sha16: corpusSha16(), scenarioCount: options.caseIds.length, caseIds: options.caseIds, bySpeechAct: Object.fromEntries(SPEECH_ACT_GROUPS.map((group: SpeechActGroup) => [SPEECH_ACT_LABELS[group], options.caseIds.filter((id) => scenarioById(id).group === group).length])) },
        variants: Object.fromEntries(variants.map((variant) => [variant, { label: SEMANTICS_VARIANT_LABELS[variant], toolContractSha16: sha16(JSON.stringify(surfaces[variant].tools)), stats: surfaces[variant].stats }])),
        thresholds: SEMANTICS_THRESHOLDS,
        runsPerScenario: options.runsPerScenario,
        notReproducibleInHarness: [
          "EC2_ONLY_CHANNEL_BEHAVIOR: webhook/HTTPS, settle delay, delivery/read events and the real outbox worker are outside every variant.",
          "Quote Service is BLOCKED locally: create_quote outcomes are not evidence about any variant (Q scenarios are scored on select_products / quote progression).",
          "Catalog fixture has two products (Classic 31, Pro 32); conversation memory across turns is an in-memory transcript (same as P7.8-R / P7.9).",
          "Two D scenarios keep the bare 'Pro' name (fixture flag bare_pro_name): the catalog stub made the model ask 'which Pro?' in P7.9; reported separately, never attributed to the tool semantics."
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

export type SemanticsArtifactFiles = Record<"manifest.json" | "runs.jsonl" | "summary.json" | "comparison.json" | "failures.json" | "classifier-golden.json", string>;

export function buildSemanticsArtifactFiles(bundle: SemanticsBundle): SemanticsArtifactFiles {
  return {
    "manifest.json": JSON.stringify(bundle.manifest, null, 2),
    "runs.jsonl": bundle.runs
      .map((run) => {
        const scenario = scenarioById(run.caseId);
        return JSON.stringify({ ...run, scenario: { speechAct: SPEECH_ACT_LABELS[scenario.group], group: scenario.group, expected: scenario.expected ?? null, productFromContext: scenario.productFromContext ?? false, initialSelection: scenario.seedSelection ?? [], fixtureFlags: scenario.fixtureFlags ?? [] }, turnAnalyses: analyzeSemanticsRun(run) });
      })
      .join("\n"),
    "summary.json": JSON.stringify(bundle.summary, null, 2),
    "comparison.json": JSON.stringify(bundle.comparison, null, 2),
    "failures.json": JSON.stringify(bundle.failures, null, 2),
    "classifier-golden.json": JSON.stringify(bundle.classifierGolden, null, 2)
  };
}
