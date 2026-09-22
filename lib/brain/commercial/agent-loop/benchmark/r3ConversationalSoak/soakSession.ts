import { randomUUID } from "node:crypto";
import { getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import { getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT } from "../../../sales-agent-configuration";
import { ensureCommercialWorkCase } from "../../../work/ensureCommercialWorkCase";
import { buildR3AgentTurnInputShadowDomainReadModel } from "../../../agent-turn-input/buildR3AgentTurnInputShadowDomainReadModel";
import type { CommercialDomainReadModel } from "../../../domain-read-model";
import type { CapabilityGatewayContext, CapabilityGatewayResult } from "../../../capability-gateway/types";
import type { AgentLoopTerminalReason } from "../../agentStepTypes";
import { checkUnbackedCommercialMutationClaim } from "../../commercialMutationClaims";
import { loadRecentCatalogContext } from "../../recentCatalogContext";
import { setupR3BenchmarkEnvironment } from "../r3StableAgentV1/environment";
import { buildLevel0AnonymousSession, buildLevel2MasterResolvedSession } from "../r3CommercialE2E/identitySessionFixtures";
import { mapDomainReadModelToDurableStateSnapshot } from "../r3CommercialE2E/durableStateSnapshot";
import { buildBaseSnapshot } from "../r3CommercialE2E/runCommercialE2ECase";
import type { BenchmarkE2EDurableStateSnapshot, BenchmarkE2ETurnTrace } from "../r3CommercialE2E/types";
import type { BenchmarkProviderCallRecord } from "../types";
import { computePromptStats, type AbPromptStats } from "../r3AutonomousAB/analysis";
import { createNativeToolCaller, type NativeChatMessage, type NativeModelCaller } from "../r3TrueAB/nativeToolClient";
import type { ToolSurface } from "../r3TrueAB/toolSurface";
import { renderCommercialState } from "../r3TrueAB/runTrueHarnessCase";
import { runTrueHarnessTurn, type TrueHarnessResult } from "../r3TrueAB/trueHarnessLoop";
import { buildTrueHarnessRuntimeContextMessage, buildTrueHarnessSystemPrompt, hashPrompt } from "../r3TrueAB/trueHarnessPrompt";
import { seedBenchmarkSelection } from "../environment";

/**
 * SALES-AGENT-R3-P7.12. Turn-level driver of the SAME P7.8-R/P7.10/P7.11 true autonomous harness
 * (runTrueHarnessTurn -> executeGovernedCapability -> Gateway -> DRM refresh), split into
 * create/run-one-turn/teardown so THREE independent conversations can be interleaved at the turn
 * level (P7.10/P7.11's `runTrueHarnessCase` processes every turn of one case in a single call and
 * tears the environment down immediately after - it cannot pause between turns for another
 * conversation to run). No existing P7.8-R/P7.10/P7.11 file is modified; this reuses their exact
 * exported building blocks (`renderCommercialState`, `runTrueHarnessTurn`, `setupR3BenchmarkEnvironment`,
 * identity session fixtures, DRM mapping) under a different orchestration shape.
 */

export type SoakExecuteCapability = (capability: string, input: Record<string, unknown>, context: CapabilityGatewayContext) => Promise<CapabilityGatewayResult>;

export type SoakSession = {
  label: string;
  env: Awaited<ReturnType<typeof setupR3BenchmarkEnvironment>>;
  systemPrompt: string;
  callModel: NativeModelCaller;
  trustedCustomerSession: ReturnType<typeof buildLevel0AnonymousSession>;
  snapshot: ReturnType<typeof buildBaseSnapshot>;
  readDrm: (correlationId: string) => Promise<CommercialDomainReadModel>;
  priorState: BenchmarkE2EDurableStateSnapshot;
  initialState: BenchmarkE2EDurableStateSnapshot;
  history: NativeChatMessage[];
  turnOrdinal: number;
  turns: BenchmarkE2ETurnTrace[];
  benchmarkRunId: string;
  totalModelCalls: number;
};

export type CreateSoakSessionOptions = {
  label: string;
  identityLevel: "LEVEL_0_ANONYMOUS" | "LEVEL_2_MASTER_RESOLVED";
  benchmarkRunId: string;
  /** Durable selection seeded before turn 0 (used by REPLACEMENT/CORRECTION stress tracks that need a pre-existing line). */
  seedSelection?: { productId: string; quantity: number }[];
};

export async function createSoakSession(options: CreateSoakSessionOptions): Promise<SoakSession> {
  const env = await setupR3BenchmarkEnvironment();
  if (options.seedSelection) await seedBenchmarkSelection(env.opportunityId, options.seedSelection);

  const identitySeedTime = new Date().toISOString();
  const trustedCustomerSession =
    options.identityLevel === "LEVEL_2_MASTER_RESOLVED"
      ? buildLevel2MasterResolvedSession({ conversationId: env.conversationId, waId: env.waId, messageId: `${options.benchmarkRunId}-identity`, currentTime: identitySeedTime, masterCustomerId: env.masterCustomerId })
      : buildLevel0AnonymousSession({ conversationId: env.conversationId, waId: env.waId, messageId: `${options.benchmarkRunId}-identity`, currentTime: identitySeedTime });
  const snapshot = buildBaseSnapshot({ conversationId: env.conversationId, waId: env.waId, opportunityId: env.opportunityId, masterCustomerId: env.masterCustomerId, currentTime: identitySeedTime });

  const readDrm = async (correlationId: string): Promise<CommercialDomainReadModel> => {
    snapshot.shippingDestination = await getActiveShippingDestinationForOpportunity(env.opportunityId);
    snapshot.commercialLineItems = await getActiveCommercialLineItemsForOpportunity(env.opportunityId);
    return buildR3AgentTurnInputShadowDomainReadModel({ conversationId: env.conversationId, opportunityId: env.opportunityId, correlationId, snapshot, trustedCustomerSession, metrics: { dbReads: 0, httpReads: 0 } });
  };

  const initialDrm = await readDrm(`${options.benchmarkRunId}-initial-${randomUUID()}`);
  const initialState = mapDomainReadModelToDurableStateSnapshot(initialDrm, identitySeedTime);
  const systemPrompt = buildTrueHarnessSystemPrompt(SALES_AGENT_CONFIGURATION_SAFE_DEFAULT);

  return {
    label: options.label,
    env,
    systemPrompt,
    callModel: null as unknown as NativeModelCaller, // set by attachModel (live config not known at construction time in tests)
    trustedCustomerSession,
    snapshot,
    readDrm,
    priorState: initialState,
    initialState,
    history: [],
    turnOrdinal: 0,
    turns: [],
    benchmarkRunId: options.benchmarkRunId,
    totalModelCalls: 0
  };
}

export function attachModel(session: SoakSession, callModel: NativeModelCaller): void {
  session.callModel = callModel;
}

export function attachLiveModel(session: SoakSession, liveConfig: NonNullable<Parameters<typeof createNativeToolCaller>[0]>): void {
  session.callModel = createNativeToolCaller(liveConfig);
}

export type RunSoakTurnOptions = {
  surface: ToolSurface;
  timeoutMs: number;
  /** Fault-injection seam (P7.12 section 23): defaults to the real Gateway (`executeGovernedCapability`) inside runTrueHarnessTurn. */
  executeCapability?: SoakExecuteCapability;
};

/** Runs exactly ONE turn (the customer message) of an already-created session, mirroring runTrueHarnessCase's per-turn body. Mutates and returns the session's own turn trace. */
export async function runSoakTurn(session: SoakSession, customerMessage: string, options: RunSoakTurnOptions): Promise<BenchmarkE2ETurnTrace> {
  const turnOrdinal = session.turnOrdinal;
  const inboundMessageId = `${session.benchmarkRunId}-turn${turnOrdinal}`;
  const correlationId = `${session.benchmarkRunId}-turn${turnOrdinal}-${randomUUID()}`;
  const currentTime = new Date().toISOString();

  const kernel = await ensureCommercialWorkCase({
    conversationId: session.env.conversationId,
    opportunityId: session.env.opportunityId,
    conversation: { id: session.env.conversationId, humanOwnerActive: false, aiEnabled: true, status: "open" },
    opportunity: { id: session.env.opportunityId, status: "open" },
    correlationId,
    now: currentTime
  }).catch(() => null);
  const work = kernel && kernel.result !== "FAILED" ? kernel.work : null;

  const startDrm = await session.readDrm(`${correlationId}-start`);
  const recentCatalogContext = (await loadRecentCatalogContext({ conversationId: session.env.conversationId, currentTime })).context;

  let latestDrm: CommercialDomainReadModel = startDrm;
  const gatewayContext: CapabilityGatewayContext = {
    correlationId,
    conversationId: session.env.conversationId,
    opportunityId: session.env.opportunityId,
    trustedCustomerSession: session.trustedCustomerSession,
    workId: work?.publicId ?? null,
    workVersion: work?.version ?? null,
    objectiveId: null,
    objectiveType: null
  };

  const messages: NativeChatMessage[] = [
    { role: "system", content: session.systemPrompt },
    buildTrueHarnessRuntimeContextMessage({ currentTime, commercialState: renderCommercialState(startDrm), recentCatalogContext }),
    ...session.history,
    { role: "user", content: customerMessage }
  ];

  const result: TrueHarnessResult = await runTrueHarnessTurn({
    messages,
    surface: options.surface,
    gatewayContext,
    recentCatalogContext,
    deadlineMs: Date.now() + options.timeoutMs,
    deps: {
      callModel: session.callModel,
      executeCapability: options.executeCapability,
      refreshState: async () => {
        latestDrm = await session.readDrm(`${correlationId}-refresh`);
        return renderCommercialState(latestDrm);
      }
    }
  });
  session.totalModelCalls += result.modelCalls.length;

  const afterDrm = await session.readDrm(`${correlationId}-after`);
  const durableStateAfterTurn = mapDomainReadModelToDurableStateSnapshot(afterDrm, new Date().toISOString());

  const claimCheck = checkUnbackedCommercialMutationClaim({
    terminalReason: result.terminalReason === "responded" ? "responded" : "timeout",
    finalMessage: result.finalMessage,
    steps: result.toolCalls.map((call) => ({ step: { type: "use_tool", tool: call.toolName }, observation: { status: call.observationStatus } })) as never
  });
  const runtimeWarnings = [
    ...result.warnings.map((warning) => (warning.startsWith("true_harness_provider_error:") ? `agent_loop_provider_error:${warning.split(":")[1]}` : warning)),
    ...(claimCheck.unbacked ? [`agent_loop_mutation_claim_blocked:${claimCheck.matchedPattern ?? "unknown"}`] : [])
  ];

  const TERMINAL_REASON_MAP: Record<TrueHarnessResult["terminalReason"], AgentLoopTerminalReason> = {
    responded: "responded",
    timeout: "timeout",
    provider_unavailable: "provider_unavailable",
    invalid_output: "invalid_output",
    emergency_limit_exceeded: "emergency_limit_exceeded"
  };

  const providerCalls: BenchmarkProviderCallRecord[] = result.modelCalls.map((call) => ({
    caseId: session.label,
    runIndex: 0,
    callIndex: call.callIndex,
    elapsedMs: call.elapsedMs,
    outcome: call.outcome === "success" ? "success" : call.outcome === "timeout" ? "provider_timeout" : call.outcome === "http_error" ? "unknown_provider_error" : call.outcome,
    errorCode: call.outcome === "success" ? null : call.outcome,
    finishReason: call.finishReason,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    reasoningTokens: call.reasoningTokens,
    providerRequestId: null,
    model: null
  }));

  const turnTrace: BenchmarkE2ETurnTrace = {
    turnOrdinal,
    inboundMessageId,
    correlationId,
    customerMessage,
    durableStateBeforeTurn: session.priorState,
    kernel: kernel ? { workId: work?.publicId ?? null, workVersion: work?.version ?? null, result: kernel.result === "FAILED" ? "FAILED" : kernel.result } : null,
    toolInvocations: result.toolCalls.map((call) => ({
      stepIndex: call.stepIndex,
      capability: call.toolName,
      workId: work?.publicId ?? null,
      workVersion: work?.version ?? null,
      objectiveId: null,
      objectiveType: null,
      eligibilityAtTurnStart: null,
      gateway: call.gatewayStatus === null ? null : { status: call.gatewayStatus, errorCode: call.gatewayErrorCode, retryable: call.gatewayRetryable },
      toolObservation: { status: call.observationStatus, errorCode: call.observationErrorCode, retryable: call.observationRetryable },
      inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] }
    })),
    proposal: null,
    objectiveReconciliation: { decided: null, reconciled: null },
    eligibilityShadow: null,
    response: { status: result.terminalReason === "responded" ? "responded" : "failed", terminalReason: TERMINAL_REASON_MAP[result.terminalReason], finalMessage: result.finalMessage, handoffReason: null, toolExecutionCount: result.toolCalls.length },
    runtimeWarnings,
    outbox: { attempted: false, outboxWritten: false, outboxId: null, status: null, messageTextPresent: result.finalMessage !== null },
    durableStateAfterTurn,
    providerCalls
  };

  session.turns.push(turnTrace);
  session.priorState = durableStateAfterTurn;
  session.turnOrdinal += 1;
  session.history.push({ role: "user", content: customerMessage });
  if (result.finalMessage) session.history.push({ role: "assistant", content: result.finalMessage });

  return turnTrace;
}

export type SoakSessionSummary = { label: string; turns: BenchmarkE2ETurnTrace[]; initialState: BenchmarkE2EDurableStateSnapshot; finalState: BenchmarkE2EDurableStateSnapshot; promptStats: AbPromptStats; promptSha256: string };

export function summarizeSoakSession(session: SoakSession): SoakSessionSummary {
  return {
    label: session.label,
    turns: session.turns,
    initialState: session.initialState,
    finalState: session.turns[session.turns.length - 1]?.durableStateAfterTurn ?? session.initialState,
    promptStats: computePromptStats(session.systemPrompt, session.totalModelCalls),
    promptSha256: hashPrompt(session.systemPrompt)
  };
}

export async function teardownSoakSession(session: SoakSession): Promise<void> {
  await session.env.teardown();
}
