import { randomUUID } from "node:crypto";
import { getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import { getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT } from "../../../sales-agent-configuration";
import { ensureCommercialWorkCase } from "../../../work/ensureCommercialWorkCase";
import { buildR3AgentTurnInputShadowDomainReadModel } from "../../../agent-turn-input/buildR3AgentTurnInputShadowDomainReadModel";
import type { CommercialDomainReadModel } from "../../../domain-read-model";
import type { CapabilityGatewayContext } from "../../../capability-gateway/types";
import type { AgentLoopTerminalReason } from "../../agentStepTypes";
import { checkUnbackedCommercialMutationClaim } from "../../commercialMutationClaims";
import { loadRecentCatalogContext } from "../../recentCatalogContext";
import { setupR3BenchmarkEnvironment } from "../r3StableAgentV1/environment";
import { buildLevel0AnonymousSession, buildLevel2MasterResolvedSession } from "../r3CommercialE2E/identitySessionFixtures";
import { mapDomainReadModelToDurableStateSnapshot } from "../r3CommercialE2E/durableStateSnapshot";
import { buildBaseSnapshot } from "../r3CommercialE2E/runCommercialE2ECase";
import { scoreCase, caseOutcomePassed } from "../r3CommercialE2E/scoreCase";
import type { BenchmarkE2ECase, BenchmarkE2EDurableStateSnapshot, BenchmarkE2ERunTrace, BenchmarkE2ETurnTrace } from "../r3CommercialE2E/types";
import type { BenchmarkProviderCallRecord } from "../types";
import type { AbPromptStats } from "../r3AutonomousAB/analysis";
import { computePromptStats } from "../r3AutonomousAB/analysis";
import { createNativeToolCaller, type NativeChatMessage, type NativeModelCaller } from "./nativeToolClient";
import type { ToolSurface } from "./toolSurface";
import { runTrueHarnessTurn, type TrueHarnessResult, type TrueHarnessTerminalReason } from "./trueHarnessLoop";
import { buildTrueHarnessRuntimeContextMessage, buildTrueHarnessSystemPrompt, hashPrompt } from "./trueHarnessPrompt";

/**
 * SALES-AGENT-R3-P7.8-R. Runs one benchmark case through the TRUE autonomous
 * harness (variants B / C1). Same environment, identity fixture, kernel
 * bootstrap (CommercialWork), catalog/carrier stubs and durable-state
 * semantics as runCommercialE2ECase (variant A); the cognitive path is
 * trueHarnessLoop.ts instead of runSalesAgentRuntimeCycle/runAgentToolLoop.
 * Produces the same BenchmarkE2ERunTrace shape so the shared analysis applies.
 *
 * Conversation memory across the turns of one case is an in-memory transcript
 * (user text + assistant final text), carrying the same information A's
 * persistent session carries. Nothing is written to the outbox (no channel).
 */

const TERMINAL_REASON_MAP: Record<TrueHarnessTerminalReason, AgentLoopTerminalReason> = {
  responded: "responded",
  timeout: "timeout",
  provider_unavailable: "provider_unavailable",
  invalid_output: "invalid_output",
  emergency_limit_exceeded: "emergency_limit_exceeded"
};

export type TrueHarnessCommercialState = {
  selection: { productId: string; quantity: number }[];
  shippingDestination: string | null;
  shipping: string;
  quote: { status: string | null } | null;
  customerIdentityLevel: string | null;
};

/** Model-facing canonical commercial state, rendered from the same DRM the R3 shadow builds - read-only, no product copy beyond ids/quantities. */
export function renderCommercialState(drm: CommercialDomainReadModel): TrueHarnessCommercialState {
  return {
    selection: drm.cart.factId !== null ? drm.cart.items.map((item) => ({ productId: item.productId, quantity: item.quantity })) : [],
    shippingDestination: drm.destination?.canonicalName ?? null,
    shipping: drm.shipping.state,
    quote: drm.quote ? { status: drm.quote.status ?? null } : null,
    customerIdentityLevel: drm.customer.identityLevel
  };
}

export type RunTrueHarnessCaseOptions = {
  arm: "B_PURE_CURRENT_TOOLS" | "C1_PURE_THIN_TOOLS";
  surface: ToolSurface;
  runOrdinal: number;
  benchmarkRunId: string;
  timeoutMs: number;
  /** Live provider config (endpoint/key/model/...). Ignored when `callModel` is given. */
  liveConfig?: { endpoint: string; apiKey: string; model: string; temperature: number; maxOutputTokens?: number; maxModelRetries: number; thinking?: "enabled" | "disabled" };
  /** Test seam: a scripted model. Absent in a real run. */
  callModel?: NativeModelCaller;
};

export type RunTrueHarnessCaseResult = { trace: BenchmarkE2ERunTrace; promptStats: AbPromptStats; promptSha256: string; toolContractChars: number };

export async function runTrueHarnessCase(testCase: BenchmarkE2ECase, options: RunTrueHarnessCaseOptions): Promise<RunTrueHarnessCaseResult> {
  const startedAt = new Date().toISOString();
  const env = await setupR3BenchmarkEnvironment();
  const turns: BenchmarkE2ETurnTrace[] = [];
  const callModel = options.callModel ?? createNativeToolCaller(options.liveConfig as NonNullable<RunTrueHarnessCaseOptions["liveConfig"]>);
  const systemPrompt = buildTrueHarnessSystemPrompt(SALES_AGENT_CONFIGURATION_SAFE_DEFAULT);
  let totalModelCalls = 0;

  try {
    if (testCase.setup) await testCase.setup({ opportunityId: env.opportunityId, conversationId: env.conversationId });

    const identitySeedTime = new Date().toISOString();
    const trustedCustomerSession =
      testCase.identityLevel === "LEVEL_2_MASTER_RESOLVED"
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
    let priorState: BenchmarkE2EDurableStateSnapshot = initialState;
    const history: NativeChatMessage[] = [];

    for (let turnOrdinal = 0; turnOrdinal < testCase.turns.length; turnOrdinal += 1) {
      const customerMessage = testCase.turns[turnOrdinal].customerMessage;
      const inboundMessageId = `${options.benchmarkRunId}-turn${turnOrdinal}`;
      const correlationId = `${options.benchmarkRunId}-turn${turnOrdinal}-${randomUUID()}`;
      const currentTime = new Date().toISOString();

      // Same CommercialWork bootstrap the R3 cycle runs (P3.5): identical initial work semantics for A, B and C1.
      const kernel = await ensureCommercialWorkCase({
        conversationId: env.conversationId,
        opportunityId: env.opportunityId,
        conversation: { id: env.conversationId, humanOwnerActive: false, aiEnabled: true, status: "open" },
        opportunity: { id: env.opportunityId, status: "open" },
        correlationId,
        now: currentTime
      }).catch(() => null);
      const work = kernel && kernel.result !== "FAILED" ? kernel.work : null;

      const startDrm = await readDrm(`${correlationId}-start`);
      const recentCatalogContext = (await loadRecentCatalogContext({ conversationId: env.conversationId, currentTime })).context;

      let latestDrm: CommercialDomainReadModel = startDrm;
      const gatewayContext: CapabilityGatewayContext = {
        correlationId,
        conversationId: env.conversationId,
        opportunityId: env.opportunityId,
        trustedCustomerSession,
        workId: work?.publicId ?? null,
        workVersion: work?.version ?? null,
        objectiveId: null,
        objectiveType: null
      };

      const messages: NativeChatMessage[] = [
        { role: "system", content: systemPrompt },
        buildTrueHarnessRuntimeContextMessage({ currentTime, commercialState: renderCommercialState(startDrm), recentCatalogContext }),
        ...history,
        { role: "user", content: customerMessage }
      ];

      const result: TrueHarnessResult = await runTrueHarnessTurn({
        messages,
        surface: options.surface,
        gatewayContext,
        recentCatalogContext,
        deadlineMs: Date.now() + options.timeoutMs,
        deps: {
          callModel,
          refreshState: async () => {
            latestDrm = await readDrm(`${correlationId}-refresh`);
            return renderCommercialState(latestDrm);
          }
        }
      });
      totalModelCalls += result.modelCalls.length;

      const afterDrm = await readDrm(`${correlationId}-after`);
      const durableStateAfterTurn = mapDomainReadModelToDurableStateSnapshot(afterDrm, new Date().toISOString());

      // Measurement only (never applied to the customer message): the same claim detector the R3 loop uses, so the
      // ungrounded-mutation-claim metric is comparable. The detector needs the loop's step shape - built here, in the
      // measurement layer, from the harness's own tool records.
      const claimCheck = checkUnbackedCommercialMutationClaim({
        terminalReason: result.terminalReason === "responded" ? "responded" : "timeout",
        finalMessage: result.finalMessage,
        steps: result.toolCalls.map((call) => ({ step: { type: "use_tool", tool: call.toolName }, observation: { status: call.observationStatus } })) as never
      });
      const runtimeWarnings = [
        ...result.warnings.map((warning) => (warning.startsWith("true_harness_provider_error:") ? `agent_loop_provider_error:${warning.split(":")[1]}` : warning)),
        ...(claimCheck.unbacked ? [`agent_loop_mutation_claim_blocked:${claimCheck.matchedPattern ?? "unknown"}`] : [])
      ];

      const providerCalls: BenchmarkProviderCallRecord[] = result.modelCalls.map((call) => ({
        caseId: testCase.caseId,
        runIndex: options.runOrdinal,
        callIndex: call.callIndex,
        elapsedMs: call.elapsedMs,
        outcome: call.outcome === "success" ? "success" : call.outcome === "timeout" ? "provider_timeout" : call.outcome === "http_error" ? "unknown_provider_error" : call.outcome,
        errorCode: call.outcome === "success" ? null : call.outcome,
        finishReason: call.finishReason,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        reasoningTokens: call.reasoningTokens,
        providerRequestId: null,
        model: options.liveConfig?.model ?? null
      }));

      turns.push({
        turnOrdinal,
        inboundMessageId,
        correlationId,
        customerMessage,
        durableStateBeforeTurn: priorState,
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
      });
      priorState = durableStateAfterTurn;

      history.push({ role: "user", content: customerMessage });
      if (result.finalMessage) history.push({ role: "assistant", content: result.finalMessage });
    }

    const finalState = turns[turns.length - 1]?.durableStateAfterTurn ?? initialState;
    const scored = scoreCase(testCase, turns, finalState);
    const passed = caseOutcomePassed(scored);
    return {
      trace: {
        benchmarkRunId: options.benchmarkRunId,
        caseId: testCase.caseId,
        runOrdinal: options.runOrdinal,
        executionMode: options.callModel ? "STUBBED" : "HYBRID",
        startedAt,
        finishedAt: new Date().toISOString(),
        initialState,
        turns,
        finalState,
        outcome: { status: passed ? "PASS" : "FAIL", expectationResults: scored.expectationResults, forbiddenViolations: scored.forbiddenViolations, failure: null }
      },
      promptStats: computePromptStats(systemPrompt, totalModelCalls),
      promptSha256: hashPrompt(systemPrompt),
      toolContractChars: options.surface.stats.totalChars
    };
  } finally {
    await env.teardown();
  }
}
