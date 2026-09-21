import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { checkEnvironmentHealth } from "../r3CommercialE2E/environmentHealthPrecheck";
import { resolveBenchmarkE2EFlags, resolveBenchmarkE2ELoopConfiguration, runCommercialE2ECase } from "../r3CommercialE2E/runCommercialE2ECase";
import { applyBenchmarkE2EOverridesToLiveConfig, listActiveBenchmarkE2EOverrides, readBenchmarkE2EOverrides } from "../r3CommercialE2E/benchmarkOverrides";
import { resolveLiveBenchmarkProviderConfig, type LiveBenchmarkProviderConfig } from "../liveProvider";
import { SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT } from "../../../sales-agent-configuration";
import type { BenchmarkE2ECase, BenchmarkE2EEnvironmentHealth, BenchmarkE2EFlagsConfig, BenchmarkE2ERunTrace } from "../r3CommercialE2E/types";
import { P78_NEGATIVE_CONTROL_CASE_IDS } from "./abCorpus";
import { analyzeRun, compareVariants, computePromptStats, computeVariantMetrics, P78_SIGNAL_THRESHOLDS, type AbPromptStats, type AbRunConfig, type AbRunRecord, type P78Comparison, type P78TurnAnalysis, type P78VariantMetrics } from "./analysis";
import { hashPromptText } from "./autonomousPrompt";
import { AB_VARIANT_IDS, AB_VARIANTS, diffVariantFlags, resolveVariantFlags, type AbVariantId } from "./variants";

/**
 * SALES-AGENT-R3-P7.8 (Autonomous Harness A/B). Orchestration only: builds a
 * deterministic, interleaved plan and runs every entry through the SAME
 * runCommercialE2ECase (the real R3 cycle: kernel, DRM, loop, Gateway, MariaDB
 * crm_test, outbox). The only per-variant inputs are `flags` (three cognitive
 * switches) and `promptBuilder` (see variants.ts); the case object, fixtures,
 * identity, provider config, timeouts and budgets come from one shared place.
 */

export type AbPlanEntry = { sequenceIndex: number; pairId: string; caseId: string; runOrdinal: number; variant: AbVariantId; firstInPair: boolean };

/**
 * Deterministic and counterbalanced: each (case, run) pair runs A and B back
 * to back (so provider drift affects both alike), and which variant goes first
 * alternates with the pair index (even pairs A-first, odd pairs B-first). No
 * randomness anywhere.
 */
export function buildAbPlan(caseIds: readonly string[], runsPerCase: number): AbPlanEntry[] {
  const plan: AbPlanEntry[] = [];
  let pairIndex = 0;
  for (const caseId of caseIds) {
    for (let runOrdinal = 0; runOrdinal < runsPerCase; runOrdinal += 1) {
      const order: AbVariantId[] = pairIndex % 2 === 0 ? ["A_HYBRID", "B_AUTONOMOUS"] : ["B_AUTONOMOUS", "A_HYBRID"];
      order.forEach((variant, position) => plan.push({ sequenceIndex: plan.length, pairId: `${caseId}-r${runOrdinal}`, caseId, runOrdinal, variant, firstInPair: position === 0 }));
      pairIndex += 1;
    }
  }
  return plan;
}

/** Shared by both variants: everything the provider/loop is configured with, resolved once. */
function buildSharedRunConfig(mode: "offline" | "live", liveConfig: LiveBenchmarkProviderConfig | null) {
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

export function buildAbRunConfig(variant: AbVariantId, shared: ReturnType<typeof buildSharedRunConfig>, baseFlags: BenchmarkE2EFlagsConfig, promptSha256: string | null): AbRunConfig {
  const definition = AB_VARIANTS[variant];
  return {
    variant,
    ...shared,
    promptVersion: definition.promptVersion,
    promptSha256,
    eligibilityInfluencedCognition: definition.cognition.eligibilityInfluencedCognition,
    flags: resolveVariantFlags(baseFlags, variant)
  };
}

/** Drops the raw request messages (customer text + commercial context: PII-adjacent and huge) after prompt stats were taken from them. */
export function slimTrace(trace: BenchmarkE2ERunTrace): BenchmarkE2ERunTrace {
  return {
    ...trace,
    turns: trace.turns.map((turn) => ({
      ...turn,
      providerCalls: turn.providerCalls.map((call) => {
        const slim = { ...call };
        delete slim.requestMessages;
        return slim;
      })
    }))
  };
}

export function extractPromptStats(trace: BenchmarkE2ERunTrace): { stats: AbPromptStats | null; sha256: string | null } {
  const calls = trace.turns.flatMap((turn) => turn.providerCalls);
  const firstSystem = calls.find((call) => call.requestMessages?.some((message) => message.role === "system"))?.requestMessages?.find((message) => message.role === "system");
  if (!firstSystem) return { stats: null, sha256: null };
  return { stats: computePromptStats(firstSystem.content, calls.length), sha256: hashPromptText(firstSystem.content) };
}

function resolveGitInfo(): { gitSha: string | null; dirtyFileCount: number | null } {
  try {
    const gitSha = execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
    const dirtyFileCount = execSync("git status --porcelain", { cwd: process.cwd() }).toString().split("\n").filter((line) => line.trim().length > 0).length;
    return { gitSha, dirtyFileCount };
  } catch {
    return { gitSha: null, dirtyFileCount: null };
  }
}

function countCodeLines(relativeUrl: string): number | null {
  try {
    const text = readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
    return text.split("\n").filter((line) => line.trim().length > 0 && !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*")).length;
  } catch {
    return null;
  }
}

export type AbFailureRecord = Pick<P78TurnAnalysis, "variant" | "caseId" | "runOrdinal" | "turnOrdinal" | "category" | "terminalReason" | "harnessLimitation"> & { toolSequence: string; detail: string | null };

export type AbBundle = {
  manifest: {
    phase: "P7.8";
    gitSha: string | null;
    dirtyFileCount: number | null;
    corpusVersion: string;
    startedAt: string;
    finishedAt: string;
    mode: "offline" | "live";
    environmentHealth: BenchmarkE2EEnvironmentHealth;
    sharedConfig: ReturnType<typeof buildSharedRunConfig>;
    baseFlags: BenchmarkE2EFlagsConfig;
    variants: Record<AbVariantId, { label: string; promptVersion: string; effectiveFlags: BenchmarkE2EFlagsConfig; cognition: (typeof AB_VARIANTS)[AbVariantId]["cognition"] }>;
    flagDifferencesBetweenVariants: string[];
    sharedInfrastructure: string[];
    benchmarkOverrides: Record<string, string>;
    notReproducibleInHarness: string[];
    runsPerCase: number;
    primaryCaseIds: string[];
    negativeControlCaseIds: string[];
    plan: AbPlanEntry[];
    signalThresholds: typeof P78_SIGNAL_THRESHOLDS;
  };
  runs: AbRunRecord[];
  summary: Record<AbVariantId, P78VariantMetrics>;
  failures: AbFailureRecord[];
  comparison: P78Comparison & {
    complexity: {
      A: { policyLineCountMean: number | null; systemPromptCharsMean: number | null; cognitiveComponentsInCriticalPath: string[] };
      B: { policyLineCountMean: number | null; systemPromptCharsMean: number | null; autonomousSpecificCodeLines: { autonomousPrompt: number | null; variants: number | null }; additionalRuntimeComponents: string[]; cognitiveComponentsInCriticalPath: string[] };
    };
  };
};

const SHARED_INFRASTRUCTURE = [
  "runSalesAgentRuntimeCycle -> runSalesAgentRuntime -> runAgentToolLoop (same loop, open-turn checkpoint, evidence gate, duplicate guard, mutation-claim guard)",
  "Capability Gateway (registry, identity gate, availability, execution) and all tool implementations/schemas (buildToolDescriptions + renderToolLine)",
  "CommercialWork kernel (P3.5) and durable state (MariaDB crm_test), request facts, outbox",
  "Catalog/Carrier/commune local stubs, trusted identity fixture, persistent session cognition, harness-aligned message model, same provider (DeepSeek), timeouts, retries, token budget",
  "Same case objects, fixtures and per-run isolated opportunity/conversation (setupR3BenchmarkEnvironment)"
];

const A_CRITICAL_PATH_COMPONENTS = [
  "DomainReadModel projection (P0/P2) feeding the P6.3 view",
  "CapabilityEligibility P6.3 view rendered to the model (eligibilityInfluencedCognition=true)",
  "CommercialProposal P4 contract requested from the model on terminal steps",
  "Objective reconciliation P5 (proposal -> durable objective)",
  "Hybrid prompt policy blocks (closing rule, select_products rules, commercial behavior policy, capability selection policy, per-tool rule blocks, stock/link/history/RFM rules)",
  "Persistent session + harness-aligned message projection + open-turn checkpoint"
];

const B_CRITICAL_PATH_COMPONENTS = ["Minimal autonomous prompt (autonomousPrompt.ts)", "Persistent session + harness-aligned message projection + open-turn checkpoint (shared with A)"];

export type RunAutonomousABOptions = {
  mode: "offline" | "live";
  runsPerCase: number;
  corpus: readonly BenchmarkE2ECase[];
  corpusVersion: string;
  /** Test seam: called after each run finishes (progress reporting in the CLI). */
  onRunFinished?: (record: AbRunRecord, total: number) => void;
};

export type RunAutonomousABResult = { ok: true; bundle: AbBundle } | { ok: false; reason: "environment_blocked"; environmentHealth: BenchmarkE2EEnvironmentHealth };

export async function runAutonomousAB(options: RunAutonomousABOptions): Promise<RunAutonomousABResult> {
  const corpusRequiresQuote = options.corpus.some((testCase) => testCase.turns.some((turn) => turn.offlineScript.some((step) => step.kind === "use_tool" && (step.tool === "create_quote" || step.tool === "get_quote"))));
  const environmentHealth = await checkEnvironmentHealth({ mode: options.mode, corpusRequiresQuote });

  let liveConfig: LiveBenchmarkProviderConfig | null = null;
  if (options.mode === "live") {
    const resolution = resolveLiveBenchmarkProviderConfig();
    if (resolution.ok) liveConfig = applyBenchmarkE2EOverridesToLiveConfig(resolution.config, readBenchmarkE2EOverrides());
  }
  if (environmentHealth.dependencies.some((dependency) => dependency.name === "mariadb" && dependency.status === "BLOCKED")) {
    return { ok: false, reason: "environment_blocked", environmentHealth };
  }

  const baseFlags = resolveBenchmarkE2EFlags();
  const sharedConfig = buildSharedRunConfig(options.mode, liveConfig);
  const plan = buildAbPlan(options.corpus.map((testCase) => testCase.caseId), options.runsPerCase);
  const negativeIds = new Set<string>(P78_NEGATIVE_CONTROL_CASE_IDS);
  const batchId = `p78-ab-${Date.now()}-${randomUUID()}`;
  const startedAt = new Date().toISOString();

  const records: AbRunRecord[] = [];
  for (const entry of plan) {
    const testCase = options.corpus.find((candidate) => candidate.caseId === entry.caseId) as BenchmarkE2ECase;
    const variant = AB_VARIANTS[entry.variant];
    const flags = resolveVariantFlags(baseFlags, entry.variant);
    const benchmarkRunId = `${batchId}-${entry.caseId}-${entry.variant}-run${entry.runOrdinal}`;

    let record: AbRunRecord;
    try {
      const trace = await runCommercialE2ECase(testCase, { mode: options.mode, liveConfig: liveConfig ?? undefined, runOrdinal: entry.runOrdinal, benchmarkRunId, flags, promptBuilder: variant.promptBuilder });
      const { stats, sha256 } = extractPromptStats(trace);
      record = {
        pairId: entry.pairId,
        variant: entry.variant,
        caseId: entry.caseId,
        runOrdinal: entry.runOrdinal,
        sequenceIndex: entry.sequenceIndex,
        firstInPair: entry.firstInPair,
        isNegativeControl: negativeIds.has(entry.caseId),
        trace: slimTrace(trace),
        harnessError: null,
        runConfig: buildAbRunConfig(entry.variant, sharedConfig, baseFlags, sha256),
        promptStats: stats
      };
    } catch (error) {
      record = {
        pairId: entry.pairId,
        variant: entry.variant,
        caseId: entry.caseId,
        runOrdinal: entry.runOrdinal,
        sequenceIndex: entry.sequenceIndex,
        firstInPair: entry.firstInPair,
        isNegativeControl: negativeIds.has(entry.caseId),
        trace: null,
        harnessError: error instanceof Error ? error.message.slice(0, 300) : "unknown_error",
        runConfig: buildAbRunConfig(entry.variant, sharedConfig, baseFlags, null),
        promptStats: null
      };
    }
    records.push(record);
    options.onRunFinished?.(record, plan.length);
  }

  const summary = { A_HYBRID: computeVariantMetrics("A_HYBRID", records), B_AUTONOMOUS: computeVariantMetrics("B_AUTONOMOUS", records) };
  const comparison = compareVariants(summary.A_HYBRID, summary.B_AUTONOMOUS);

  const failures: AbFailureRecord[] = records
    .flatMap((record) => analyzeRun(record).map((analysis) => ({ record, analysis })))
    .filter(({ analysis }) => analysis.category !== "COMMIT_SUCCESS" && analysis.category !== "INFORMATIONAL_OK")
    .map(({ record, analysis }) => ({
      variant: analysis.variant,
      caseId: analysis.caseId,
      runOrdinal: analysis.runOrdinal,
      turnOrdinal: analysis.turnOrdinal,
      category: analysis.category,
      terminalReason: analysis.terminalReason,
      harnessLimitation: analysis.harnessLimitation,
      toolSequence: analysis.toolCalls.map((call) => `${call.capability}:${call.toolStatus}`).join(">") || "(none)",
      detail: record.harnessError
    }));

  const { gitSha, dirtyFileCount } = resolveGitInfo();
  return {
    ok: true,
    bundle: {
      manifest: {
        phase: "P7.8",
        gitSha,
        dirtyFileCount,
        corpusVersion: options.corpusVersion,
        startedAt,
        finishedAt: new Date().toISOString(),
        mode: options.mode,
        environmentHealth,
        sharedConfig,
        baseFlags,
        variants: Object.fromEntries(AB_VARIANT_IDS.map((id) => [id, { label: AB_VARIANTS[id].label, promptVersion: AB_VARIANTS[id].promptVersion, effectiveFlags: resolveVariantFlags(baseFlags, id), cognition: AB_VARIANTS[id].cognition }])) as AbBundle["manifest"]["variants"],
        flagDifferencesBetweenVariants: diffVariantFlags(baseFlags),
        sharedInfrastructure: SHARED_INFRASTRUCTURE,
        benchmarkOverrides: listActiveBenchmarkE2EOverrides(),
        notReproducibleInHarness: [
          "EC2_ONLY_CHANNEL_BEHAVIOR: Meta webhook/HTTPS, turn-settlement delay, delivery/read events and the real outbox worker are outside runSalesAgentRuntimeCycle (identical for A and B).",
          "NOT_REPRODUCIBLE_IN_HARNESS: live_turn_assimilation - flag passed but inert for BOTH variants (anchor is Number(inboundMessageId); harness ids are text). No fake numeric ids were introduced.",
          "Quote Service is BLOCKED locally for both variants: create_quote outcomes are not evidence about either variant."
        ],
        runsPerCase: options.runsPerCase,
        primaryCaseIds: options.corpus.filter((testCase) => !negativeIds.has(testCase.caseId)).map((testCase) => testCase.caseId),
        negativeControlCaseIds: options.corpus.filter((testCase) => negativeIds.has(testCase.caseId)).map((testCase) => testCase.caseId),
        plan,
        signalThresholds: P78_SIGNAL_THRESHOLDS
      },
      runs: records,
      summary,
      failures,
      comparison: {
        ...comparison,
        complexity: {
          A: { policyLineCountMean: summary.A_HYBRID.prompt.policyLineCountMean, systemPromptCharsMean: summary.A_HYBRID.prompt.systemPromptCharsMean, cognitiveComponentsInCriticalPath: A_CRITICAL_PATH_COMPONENTS },
          B: {
            policyLineCountMean: summary.B_AUTONOMOUS.prompt.policyLineCountMean,
            systemPromptCharsMean: summary.B_AUTONOMOUS.prompt.systemPromptCharsMean,
            autonomousSpecificCodeLines: { autonomousPrompt: countCodeLines("./autonomousPrompt.ts"), variants: countCodeLines("./variants.ts") },
            additionalRuntimeComponents: ["RunAgentToolLoopInput.promptBuilder seam (3 optional pass-through fields, absent in production)", "one prompt-builder module; no new gateway, planner or state"],
            cognitiveComponentsInCriticalPath: B_CRITICAL_PATH_COMPONENTS
          }
        }
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Artifacts (pure serialization; the CLI owns the fs writes)
// ---------------------------------------------------------------------------

export type AbArtifactFiles = { "manifest.json": string; "runs.jsonl": string; "summary.json": string; "failures.json": string; "comparison.json": string };

export function buildAbArtifactFiles(bundle: AbBundle): AbArtifactFiles {
  return {
    "manifest.json": JSON.stringify(bundle.manifest, null, 2),
    "runs.jsonl": bundle.runs.map((run) => JSON.stringify({ ...run, turnAnalyses: analyzeRun(run) })).join("\n"),
    "summary.json": JSON.stringify(bundle.summary, null, 2),
    "failures.json": JSON.stringify(bundle.failures, null, 2),
    "comparison.json": JSON.stringify(bundle.comparison, null, 2)
  };
}
