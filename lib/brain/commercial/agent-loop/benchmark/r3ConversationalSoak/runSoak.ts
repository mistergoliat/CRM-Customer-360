import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { checkEnvironmentHealth } from "../r3CommercialE2E/environmentHealthPrecheck";
import { applyBenchmarkE2EOverridesToLiveConfig, listActiveBenchmarkE2EOverrides, readBenchmarkE2EOverrides } from "../r3CommercialE2E/benchmarkOverrides";
import { resolveLiveBenchmarkProviderConfig, type LiveBenchmarkProviderConfig } from "../liveProvider";
import type { BenchmarkE2EDurableStateSnapshot, BenchmarkE2EEnvironmentHealth, BenchmarkE2ERunTrace } from "../r3CommercialE2E/types";
import { createScriptedNativeModel } from "../r3TrueAB/scriptedNativeModel";
import type { BenchmarkOfflineStep } from "../types";
import { TRUE_HARNESS_PROMPT_VERSION, buildTrueHarnessSystemPrompt } from "../r3TrueAB/trueHarnessPrompt";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT, SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT } from "../../../sales-agent-configuration";
import { buildOneShotFaultExecutor } from "./faultInjection";
import { checkCrossConversationIsolation, type InvariantCheck } from "./invariants";
import { createSoakSession, attachLiveModel, attachModel, runSoakTurn, summarizeSoakSession, teardownSoakSession, type SoakSession } from "./soakSession";
import { buildSoakSurface } from "./surface";
import { CONVERSATION_LABELS, STRESS_PLAN, type ConversationLabel, type PlannedTurn } from "./stressPlan";
import { analyzeConversation, computeBehavioralMetrics, computeOperationalMetrics, computeSafetyMetrics, deriveRobustnessSignal, type SoakTurnAnalysis } from "./analysis";
import { sha16 } from "../r3MutationSemantics/semanticsSurfaces";

/**
 * SALES-AGENT-R3-P7.12. Orchestrates the interleaved 3-conversation soak. Uses the frozen
 * `STRESS_PLAN` (already interleaved by `stressPlan.ts`), drives each turn through `soakSession.ts`
 * (the SAME P7.8-R/P7.10/P7.11 true autonomous harness, one turn at a time), checks invariants
 * after EVERY turn (section 25) and stops immediately on a HARD_FAILURE (section 2), preserving
 * whatever ran so far.
 */

export type RunSoakOptions = {
  mode: "offline" | "live";
  /** Caps the plan to its first N turns (smoke mode: section 37). Omit for the full frozen plan. */
  maxTurns?: number;
  /** Wall-clock safety ceiling; the soak stops (gracefully, not a HARD_FAILURE) once exceeded, even if the plan is not exhausted (section 2/38). */
  maxWallClockMs: number;
  /** Repeats the FROZEN plan back to back on the SAME persistent sessions (never a new/adapted turn - purely mechanical replay) when the single pass falls well short of the ~60-minute target (section 2/38). Default 1 (no repetition). */
  cycles?: number;
  onTurnFinished?: (info: { plan: PlannedTurn; analysis: SoakTurnAnalysis; elapsedMs: number; index: number; total: number }) => void;
};

export type RunSoakResult =
  | {
      ok: true;
      manifest: Record<string, unknown>;
      conversations: Record<ConversationLabel, { planned: PlannedTurn[]; turns: SoakTurnAnalysis[]; trace: BenchmarkE2ERunTrace }>;
      allTurns: SoakTurnAnalysis[];
      crossConversationLeak: boolean;
      isolationCheck: InvariantCheck;
      hardFailure: { conversation: ConversationLabel; sequenceIndex: number; checks: InvariantCheck[] } | null;
      wallClockMs: number;
      planExhausted: boolean;
    }
  | { ok: false; reason: "environment_blocked"; environmentHealth: BenchmarkE2EEnvironmentHealth };

type SoakOk = Extract<RunSoakResult, { ok: true }>;

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

export async function runSoak(options: RunSoakOptions): Promise<RunSoakResult> {
  const cycles = options.cycles ?? 1;
  const repeatedPlan = Array.from({ length: cycles }, () => STRESS_PLAN)
    .flat()
    .map((entry, index) => ({ ...entry, sequenceIndex: index }));
  const plan = options.maxTurns ? repeatedPlan.slice(0, options.maxTurns) : repeatedPlan;
  const environmentHealth = await checkEnvironmentHealth({ mode: options.mode, corpusRequiresQuote: true });
  if (environmentHealth.dependencies.some((dependency) => dependency.name === "mariadb" && dependency.status === "BLOCKED")) return { ok: false, reason: "environment_blocked", environmentHealth };

  let liveConfig: LiveBenchmarkProviderConfig | null = null;
  if (options.mode === "live") {
    const resolution = resolveLiveBenchmarkProviderConfig();
    if (resolution.ok) liveConfig = applyBenchmarkE2EOverridesToLiveConfig(resolution.config, readBenchmarkE2EOverrides());
    if (!liveConfig) throw new Error("live mode requested but the live provider is not configured (BENCHMARK_LIVE_LLM_ENABLED, BRAIN_MODEL_API_URL/KEY)");
  }

  const surface = buildSoakSurface();
  const timeoutMs = readBenchmarkE2EOverrides().modelTimeoutMs ?? SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT.timeoutMs;
  const batchId = `p712-${Date.now()}-${randomUUID()}`;

  const sessions: Record<ConversationLabel, SoakSession> = {} as Record<ConversationLabel, SoakSession>;
  for (const label of CONVERSATION_LABELS) {
    const session = await createSoakSession({ label, identityLevel: "LEVEL_2_MASTER_RESOLVED", benchmarkRunId: `${batchId}-${label}` });
    if (options.mode === "offline") {
      const offlineScript: BenchmarkOfflineStep[] = [{ kind: "respond", message: "ok" }];
      attachModel(session, createScriptedNativeModel(offlineScript));
    } else {
      attachLiveModel(session, liveConfig as NonNullable<typeof liveConfig>);
    }
    sessions[label] = session;
  }

  const isolationCheck = checkCrossConversationIsolation(CONVERSATION_LABELS.map((label) => ({ label, opportunityId: sessions[label].env.opportunityId, conversationId: sessions[label].env.conversationId, waId: sessions[label].env.waId })));
  const crossConversationLeak = !isolationCheck.ok;

  const perConversationPlanned: Record<ConversationLabel, PlannedTurn[]> = { A: [], B: [], C: [] };
  const perConversationAnalyses: Record<ConversationLabel, SoakTurnAnalysis[]> = { A: [], B: [], C: [] };
  const startedAt = Date.now();
  let hardFailure: SoakOk["hardFailure"] = null;
  let planExhausted = true;

  if (!crossConversationLeak) {
    for (let index = 0; index < plan.length; index += 1) {
      const entry = plan[index];
      if (Date.now() - startedAt > options.maxWallClockMs) {
        planExhausted = false;
        break;
      }
      const session = sessions[entry.conversation];
      const executeCapability = entry.fault ? buildOneShotFaultExecutor(entry.fault) : undefined;
      const turnTrace = await runSoakTurn(session, entry.message, { surface, timeoutMs, executeCapability });
      perConversationPlanned[entry.conversation].push(entry);
      const [analysis] = analyzeConversation([entry], [turnTrace]);
      perConversationAnalyses[entry.conversation].push(analysis);
      options.onTurnFinished?.({ plan: entry, analysis, elapsedMs: Date.now() - startedAt, index, total: plan.length });
      if (analysis.hardFailure) {
        hardFailure = { conversation: entry.conversation, sequenceIndex: entry.sequenceIndex, checks: analysis.invariants.filter((check) => !check.ok && check.hard) };
        planExhausted = false;
        break;
      }
    }
  } else {
    planExhausted = false;
  }

  for (const label of CONVERSATION_LABELS) await teardownSoakSession(sessions[label]);

  const conversations = {} as SoakOk["conversations"];
  const traces: BenchmarkE2ERunTrace[] = [];
  for (const label of CONVERSATION_LABELS) {
    const summary = summarizeSoakSession(sessions[label]);
    const trace: BenchmarkE2ERunTrace = {
      benchmarkRunId: `${batchId}-${label}`,
      caseId: label,
      runOrdinal: 0,
      executionMode: options.mode === "offline" ? "STUBBED" : "HYBRID",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      initialState: summary.initialState,
      turns: summary.turns,
      finalState: summary.finalState,
      outcome: { status: "PASS", expectationResults: {}, forbiddenViolations: [], failure: null }
    };
    (conversations as Record<ConversationLabel, unknown>)[label] = { planned: perConversationPlanned[label], turns: perConversationAnalyses[label], trace };
    traces.push(trace);
  }

  const allTurns: SoakTurnAnalysis[] = CONVERSATION_LABELS.flatMap((label) => perConversationAnalyses[label]);
  const wallClockMs = Date.now() - startedAt;
  const { gitSha, dirtyFileCount } = resolveGitInfo();

  const manifest = {
    phase: "P7.12",
    gitSha,
    dirtyFileCount,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    wallClockMs,
    mode: options.mode,
    environmentHealth,
    sharedConfig: {
      model: options.mode === "offline" ? "benchmark-offline-model" : (liveConfig?.model ?? null),
      temperature: options.mode === "offline" ? null : (liveConfig?.temperature ?? null),
      thinking: options.mode === "offline" ? null : (liveConfig?.thinking ?? null),
      timeoutMs,
      maxOutputTokens: options.mode === "offline" ? null : (liveConfig?.maxOutputTokens ?? null),
      maxModelRetries: options.mode === "offline" ? null : (liveConfig?.maxModelRetries ?? null)
    },
    benchmarkOverrides: listActiveBenchmarkE2EOverrides(),
    harness: { promptVersion: TRUE_HARNESS_PROMPT_VERSION, systemPromptSha16: sha16(buildTrueHarnessSystemPrompt(SALES_AGENT_CONFIGURATION_SAFE_DEFAULT)), note: "Same P7.8-R/P7.10/P7.11 true autonomous harness, driven one turn at a time (soakSession.ts) so 3 conversations interleave; R3 does not participate. Semantics fixed to S1 (P7.11 R1 = P7.10 S1)." },
    surfaceToolContractSha16: sha16(JSON.stringify(surface.tools)),
    plan: { total: plan.length, planned: STRESS_PLAN.length, cycles, byConversation: Object.fromEntries(CONVERSATION_LABELS.map((label) => [label, perConversationPlanned[label].length])) },
    planExhausted,
    hardFailure,
    crossConversationLeak,
    isolationCheck
  };

  return { ok: true, manifest, conversations, allTurns, crossConversationLeak, isolationCheck, hardFailure, wallClockMs, planExhausted };
}

export type SoakArtifactFiles = Record<"manifest.json" | "execution-plan.json" | "turns.jsonl" | "tool-calls.jsonl" | "gateway-events.jsonl" | "state-snapshots.jsonl" | "failures.jsonl" | "invariants.jsonl" | "provider-metrics.json" | "summary.json", string>;

export function buildSoakArtifactFiles(result: Extract<RunSoakResult, { ok: true }>): SoakArtifactFiles {
  const allTraces = CONVERSATION_LABELS.map((label) => result.conversations[label].trace);
  const safety = computeSafetyMetrics(result.allTurns, result.crossConversationLeak);
  const behavioral = computeBehavioralMetrics(result.allTurns);
  const operational = computeOperationalMetrics(allTraces);
  const robustness = deriveRobustnessSignal(result.allTurns, result.crossConversationLeak, result.hardFailure ? 1 : 0);

  const turnLines: string[] = [];
  const toolCallLines: string[] = [];
  const gatewayLines: string[] = [];
  const stateLines: string[] = [];
  const invariantLines: string[] = [];
  const failureLines: string[] = [];

  for (const label of CONVERSATION_LABELS) {
    const { planned, turns } = result.conversations[label];
    const trace = result.conversations[label].trace;
    for (let index = 0; index < turns.length; index += 1) {
      const analysis = turns[index];
      const raw = trace.turns[index];
      const plan = planned[index];
      turnLines.push(JSON.stringify({ conversation: label, sequenceIndex: plan.sequenceIndex, localIndex: plan.localIndex, message: plan.message, stressCategory: plan.stressCategory, expectedMutation: plan.expectedMutation, expectedFinalSelection: plan.expectedFinalSelection ?? null, allowClarification: plan.allowClarification, modelResponse: raw.response.finalMessage, terminalReason: raw.response.terminalReason, toolCallCount: analysis.toolCallCount, providerCallCount: analysis.providerCallCount, preState: raw.durableStateBeforeTurn, postState: raw.durableStateAfterTurn, matches: analysis.matches, expectationSource: analysis.expectationSource, confirmationClass: analysis.confirmationClass, integrityFailures: analysis.integrityFailures, hardFailure: analysis.hardFailure, providerMs: analysis.providerMs, inputTokens: analysis.inputTokens, outputTokens: analysis.outputTokens }));
      for (const invocation of raw.toolInvocations) {
        toolCallLines.push(JSON.stringify({ conversation: label, sequenceIndex: plan.sequenceIndex, stepIndex: invocation.stepIndex, capability: invocation.capability, toolObservation: invocation.toolObservation, gateway: invocation.gateway }));
        if (invocation.gateway) gatewayLines.push(JSON.stringify({ conversation: label, sequenceIndex: plan.sequenceIndex, capability: invocation.capability, gateway: invocation.gateway }));
      }
      stateLines.push(JSON.stringify({ conversation: label, sequenceIndex: plan.sequenceIndex, before: summarizeState(raw.durableStateBeforeTurn), after: summarizeState(raw.durableStateAfterTurn) }));
      for (const check of analysis.invariants) invariantLines.push(JSON.stringify({ conversation: label, sequenceIndex: plan.sequenceIndex, ...check }));
      for (const kind of analysis.integrityFailures) failureLines.push(JSON.stringify({ conversation: label, sequenceIndex: plan.sequenceIndex, stressCategory: plan.stressCategory, message: plan.message, kind, expected: analysis.expectedItems, actual: analysis.finalItems }));
    }
  }
  if (result.hardFailure) failureLines.push(JSON.stringify({ kind: "HARD_FAILURE", conversation: result.hardFailure.conversation, sequenceIndex: result.hardFailure.sequenceIndex, checks: result.hardFailure.checks }));

  return {
    "manifest.json": JSON.stringify(result.manifest, null, 2),
    "execution-plan.json": JSON.stringify(STRESS_PLAN, null, 2),
    "turns.jsonl": turnLines.join("\n"),
    "tool-calls.jsonl": toolCallLines.join("\n"),
    "gateway-events.jsonl": gatewayLines.join("\n"),
    "state-snapshots.jsonl": stateLines.join("\n"),
    "failures.jsonl": failureLines.join("\n"),
    "invariants.jsonl": invariantLines.join("\n"),
    "provider-metrics.json": JSON.stringify(operational, null, 2),
    "summary.json": JSON.stringify({ robustness, safety, behavioral, operational, wallClockMs: result.wallClockMs, planExhausted: result.planExhausted, totalTurns: result.allTurns.length }, null, 2)
  };
}

function summarizeState(state: BenchmarkE2EDurableStateSnapshot | null) {
  return state ? { selection: state.selection.items ?? [], destination: state.destination.present, quote: state.quote.present, workStatus: state.workStatus } : null;
}
