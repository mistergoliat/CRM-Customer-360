import { randomUUID } from "node:crypto";
import { runSalesAgentRuntimeCycle } from "../../../sales-agent-runtime";
import type { AgentLoopTerminalReason } from "../../agentStepTypes";
import { loadRecentCatalogContext } from "../../recentCatalogContext";
import { loadPendingCatalogAction } from "../../pendingCatalogAction";
import { setupR3BenchmarkEnvironment } from "../r3StableAgentV1/environment";
import { createOfflineScriptedProvider } from "../offlineProvider";
import { createInstrumentedProvider } from "../instrumentedProvider";
import { createLiveBenchmarkProvider, type LiveBenchmarkProviderConfig } from "../liveProvider";
import type { BenchmarkProviderCallRecord } from "../types";
import {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
  type ResolvedSalesAgentConfiguration
} from "../../../sales-agent-configuration";
import {
  buildSessionCompactionFeatureFlags,
  shouldEnableHarnessAlignedMessageModel,
  shouldEnableOpenTurnExecution,
  shouldEnablePersistentSessionCognition
} from "../../../config/commercialCycleConfig";
import type { CommercialContextSnapshot } from "../../../context/buildNativeCommercialContext";
import { getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import { getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { readBenchmarkE2EOverrides } from "./benchmarkOverrides";
import { loadCommercialEventRowsForInboundMessage, loadOutboxRowById } from "./eventRows";
import { fetchDurableStateSnapshot } from "./durableStateSnapshot";
import { buildTurnTrace } from "./buildTurnTrace";
import { scoreCase, caseOutcomePassed } from "./scoreCase";
import { classifyFailure } from "./failureClassification";
import { buildLevel0AnonymousSession, buildLevel2MasterResolvedSession } from "./identitySessionFixtures";
import type { BenchmarkE2ECase, BenchmarkE2EFlagsConfig, BenchmarkE2ERunTrace, BenchmarkE2ETurnTrace } from "./types";

/**
 * SALES-AGENT-R3-P7.4. Mirrors salesAgentRuntime.ts's own private
 * mapToAgentLoopTerminalReason table verbatim (that function is not
 * exported - SalesAgentRuntimeCycleResult never surfaces the adapted `loop`
 * object it builds internally, only `runtime`/`dispatch`). A tiny, table-
 * driven, 6-entry pure function - if that production table ever grows, this
 * one needs the same one-line addition, an accepted and documented risk for
 * a benchmark reading one layer above the return contract, never a second
 * implementation of the loop itself.
 */
const FAILURE_REASON_TO_TERMINAL_REASON: Record<string, AgentLoopTerminalReason> = {
  timeout: "timeout",
  invalid_output: "invalid_output",
  max_steps_exceeded: "max_steps_exceeded",
  cancelled: "cancelled",
  no_progress: "no_progress",
  emergency_limit_exceeded: "emergency_limit_exceeded"
};

function mapRuntimeStatusToTerminalReason(status: string, reason: string | null): AgentLoopTerminalReason {
  if (status === "responded") return "responded";
  if (status === "handoff") return "handoff";
  return FAILURE_REASON_TO_TERMINAL_REASON[reason ?? ""] ?? "provider_unavailable";
}

function buildOpportunitySnapshot(input: { opportunityId: number; conversationId: number; waId: string; masterCustomerId: number; currentTime: string }): NonNullable<CommercialContextSnapshot["opportunity"]> {
  return {
    id: input.opportunityId,
    opportunityKey: `benchmark-e2e-${input.opportunityId}`,
    status: "open",
    stage: null,
    primaryIntent: "sales",
    currentSummary: null,
    nextActionType: null,
    nextActionDueAt: null,
    waitingFor: null,
    humanOwnerActive: false,
    aiBlocked: false,
    customerCandidateId: null,
    customerMasterId: input.masterCustomerId,
    leadId: null,
    conversationCaseId: input.conversationId,
    waId: input.waId,
    requirements: [],
    missingRequirements: [],
    productInterests: [],
    objections: [],
    signals: [],
    version: 1,
    lastActivityAt: input.currentTime,
    closedAt: null
  };
}

function buildBaseSnapshot(input: { conversationId: number; waId: string; opportunityId: number; masterCustomerId: number; currentTime: string }): CommercialContextSnapshot {
  return {
    contractName: "CommercialContext",
    schemaVersion: "1.0",
    status: "success",
    completeness: "minimal",
    customer: null,
    conversation: {
      id: String(input.conversationId),
      publicId: `conv-benchmark-${input.conversationId}`,
      channel: "whatsapp",
      provider: "meta",
      externalContactId: input.waId,
      status: "open",
      aiEnabled: true,
      humanOwnerActive: false,
      lastMessageAt: null
    },
    recentMessages: [],
    opportunity: buildOpportunitySnapshot(input),
    needProfile: null,
    actions: [],
    signals: {
      hasCustomer: false,
      hasOpportunity: true,
      hasNeedProfile: false,
      hasRecentMessages: false,
      humanOwnerActive: false,
      aiBlocked: false,
      staleContext: false,
      identityConflict: false
    },
    identityConflict: null,
    shippingDestination: null,
    commercialLineItems: null,
    availableCapabilities: [],
    warnings: [],
    customer360: null,
    customer360State: "not_requested",
    customerSession: null,
    metadata: { source: "native_mariadb", conversationPublicId: `conv-benchmark-${input.conversationId}`, currentTime: input.currentTime }
  };
}

/**
 * P7.6 diagnostic lever. Unset reproduces the P7.5 baseline exactly
 * (SAFE_DEFAULT 3 decisions / 2 tool executions); a positive integer changes
 * ONLY maxToolCallsPerTurn, one dimension at a time. Not a tuning proposal.
 */
export function resolveBenchmarkE2ELoopConfiguration() {
  const override = Number.parseInt(process.env.BENCHMARK_E2E_MAX_TOOL_CALLS ?? "", 10);
  return Number.isInteger(override) && override > 0
    ? { ...SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT, maxToolCallsPerTurn: override }
    : SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT;
}

/** P7.6-B. Same discipline as the levers above: unset -> nothing added, the P7.5 baseline is byte-identical. */
function benchmarkModelConfigurationOverrides(): Partial<ResolvedSalesAgentConfiguration["effectiveModelConfiguration"]> {
  const o = readBenchmarkE2EOverrides();
  return {
    ...(o.modelTimeoutMs !== undefined ? { timeoutMs: o.modelTimeoutMs } : {}),
    ...(o.maxOutputTokens !== undefined ? { maxOutputTokens: o.maxOutputTokens } : {}),
    ...(o.maxModelRetries !== undefined ? { maxModelRetries: o.maxModelRetries } : {})
  };
}

function buildResolvedConfiguration(overrides: Partial<ResolvedSalesAgentConfiguration["effectiveModelConfiguration"]> = {}): ResolvedSalesAgentConfiguration {
  return {
    source: "safe_default",
    scopeKey: SALES_AGENT_CONFIGURATION_SCOPE,
    recordId: null,
    version: null,
    configurationHash: null,
    configuration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    effectiveModelConfiguration: { ...SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT, ...overrides, ...benchmarkModelConfigurationOverrides() },
    effectiveLoopConfiguration: resolveBenchmarkE2ELoopConfiguration(),
    effectiveFollowUpConfiguration: SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT
  };
}

/** Resolved once per corpus run, reused for every case/turn - Section "FEATURE FLAGS": "no asumir valores... reportar configuración exacta". */
export function resolveBenchmarkE2EFlags(): BenchmarkE2EFlagsConfig {
  const sessionCompaction = buildSessionCompactionFeatureFlags();
  const persistentSessionCognitionEnabled = shouldEnablePersistentSessionCognition();
  const overrides = readBenchmarkE2EOverrides();
  return {
    agentTurnInputShadowEnabled: true,
    commercialWorkKernelEnabled: true,
    commercialProposalShadowEnabled: true,
    commercialObjectiveReconciliationEnabled: true,
    capabilityEligibilityShadowEnabled: true,
    // P7.6 diagnostic lever: only the literal "false" turns the P6.3 view off; unset keeps the P7.5 baseline (true).
    capabilityEligibilityInputEnabled: process.env.BENCHMARK_E2E_ELIGIBILITY_INPUT_ENABLED?.trim().toLowerCase() !== "false",
    openTurnExecutionEnabled: overrides.openTurnEnabled ?? shouldEnableOpenTurnExecution(),
    harnessAlignedMessageModelEnabled: overrides.harnessAlignedMessageModelEnabled ?? shouldEnableHarnessAlignedMessageModel(),
    persistentSessionCognitionEnabled,
    sessionCompactionEnabled: (overrides.sessionCompactionEnabled ?? sessionCompaction.sessionCompactionEnabled) && persistentSessionCognitionEnabled,
    liveTurnAssimilationEnabled: overrides.liveTurnAssimilationEnabled ?? false,
    legacyCommercialWorkRuntimeReachable: false
  };
}

export type RunCommercialE2ECaseOptions = {
  mode: "offline" | "live";
  liveConfig?: LiveBenchmarkProviderConfig;
  runOrdinal: number;
  benchmarkRunId: string;
  flags: BenchmarkE2EFlagsConfig;
  /** P7.8 A/B. Swaps only the cognitive prompt layer (see runAgentToolLoop's promptBuilder); absent = the hybrid production builder. */
  promptBuilder?: Parameters<typeof runSalesAgentRuntimeCycle>[0]["promptBuilder"];
};

/**
 * SALES-AGENT-R3-P7.4. Runs one case, one time, through the REAL native R3
 * cycle (runSalesAgentRuntimeCycle - kernel, DRM/eligibility, provider/
 * Agent Tool Loop/Gateway, P4 proposal, P5 reconciliation, terminal
 * dispatch/outbox), never a simplified stand-in. Only the reasoning provider
 * (offline scripted or live) and the Catalog/Carrier/commune fakes
 * setupR3BenchmarkEnvironment already establishes are not the real thing -
 * everything else (MariaDB, CommercialWork, Capability Gateway, identity
 * gate, P4/P5/P7 telemetry, outbox) is production code against a real local
 * database.
 */
export async function runCommercialE2ECase(testCase: BenchmarkE2ECase, options: RunCommercialE2ECaseOptions): Promise<BenchmarkE2ERunTrace> {
  const startedAt = new Date().toISOString();
  const env = await setupR3BenchmarkEnvironment();
  const providerCalls: BenchmarkProviderCallRecord[] = [];
  const turns: BenchmarkE2ETurnTrace[] = [];

  try {
    if (testCase.setup) await testCase.setup({ opportunityId: env.opportunityId, conversationId: env.conversationId });

    const flattenedScript = testCase.turns.flatMap((turn) => turn.offlineScript);
    const innerProvider = options.mode === "offline" ? createOfflineScriptedProvider(flattenedScript) : createLiveBenchmarkProvider(options.liveConfig!);
    const provider = createInstrumentedProvider(innerProvider, testCase.caseId, options.runOrdinal, providerCalls);

    const resolvedConfiguration = buildResolvedConfiguration(options.mode === "live" && options.liveConfig ? { model: options.liveConfig.model, temperature: options.liveConfig.temperature } : {});

    const identitySeedTime = new Date().toISOString();
    const trustedCustomerSession =
      testCase.identityLevel === "LEVEL_2_MASTER_RESOLVED"
        ? buildLevel2MasterResolvedSession({ conversationId: env.conversationId, waId: env.waId, messageId: `${options.benchmarkRunId}-identity`, currentTime: identitySeedTime, masterCustomerId: env.masterCustomerId })
        : buildLevel0AnonymousSession({ conversationId: env.conversationId, waId: env.waId, messageId: `${options.benchmarkRunId}-identity`, currentTime: identitySeedTime });

    const snapshot = buildBaseSnapshot({ conversationId: env.conversationId, waId: env.waId, opportunityId: env.opportunityId, masterCustomerId: env.masterCustomerId, currentTime: identitySeedTime });

    // The DRM reads cart/destination straight off this snapshot, so it must be
    // refreshed before EVERY capture (initial, per-turn start, per-turn end);
    // otherwise a mutation made during a turn is invisible in its own
    // durableStateAfterTurn (P7.6: 100% of completed mutations were persisted
    // in the DB while the after-turn snapshot reported them absent).
    const refreshSnapshotFacts = async () => {
      snapshot.shippingDestination = await getActiveShippingDestinationForOpportunity(env.opportunityId);
      snapshot.commercialLineItems = await getActiveCommercialLineItemsForOpportunity(env.opportunityId);
    };

    await refreshSnapshotFacts();
    const initialState = await fetchDurableStateSnapshot({
      conversationId: env.conversationId,
      opportunityId: env.opportunityId,
      correlationId: `${options.benchmarkRunId}-initial-${randomUUID()}`,
      snapshot,
      trustedCustomerSession,
      currentTime: identitySeedTime
    });

    let priorState = initialState;
    for (let turnOrdinal = 0; turnOrdinal < testCase.turns.length; turnOrdinal += 1) {
      const turnScript = testCase.turns[turnOrdinal];
      const inboundMessageId = `${options.benchmarkRunId}-turn${turnOrdinal}`;
      const correlationId = `${options.benchmarkRunId}-turn${turnOrdinal}-${randomUUID()}`;
      const currentTime = new Date().toISOString();

      // HARNESS_FAILURE fix (P7.5 smoke, case E08): buildBaseSnapshot() below
      // never populates these two fields, unlike the real per-message context
      // builder (buildNativeCommercialContext.ts, which reads both live every
      // turn) - a setup()-seeded or same-run selection/destination was
      // invisible to P2/P6.3 cognition, never a model reasoning gap.
      await refreshSnapshotFacts();

      const recentCatalogContextResult = await loadRecentCatalogContext({ conversationId: env.conversationId, currentTime });
      const pendingCatalogActionResult = await loadPendingCatalogAction({ conversationId: env.conversationId });

      const providerCallsBefore = providerCalls.length;
      const cycleResult = await runSalesAgentRuntimeCycle({
        conversationId: env.conversationId,
        conversationPublicId: `conv-benchmark-${env.conversationId}`,
        customerMasterId: env.masterCustomerId,
        waId: env.waId,
        phoneNumberId: "benchmark-phone",
        messageId: inboundMessageId,
        inboundMessageId,
        correlationId,
        currentTime,
        customerMessage: turnScript.customerMessage,
        snapshot,
        provider,
        trustedCustomerSession,
        recentCatalogContext: recentCatalogContextResult.context,
        pendingCatalogAction: pendingCatalogActionResult.pendingCatalogAction,
        resolvedSalesAgentConfiguration: resolvedConfiguration,
        agentTurnInputShadowEnabled: options.flags.agentTurnInputShadowEnabled,
        commercialWorkKernelEnabled: options.flags.commercialWorkKernelEnabled,
        commercialProposalShadowEnabled: options.flags.commercialProposalShadowEnabled,
        ...(options.promptBuilder ? { promptBuilder: options.promptBuilder } : {}),
        commercialObjectiveReconciliationEnabled: options.flags.commercialObjectiveReconciliationEnabled,
        capabilityEligibilityShadowEnabled: options.flags.capabilityEligibilityShadowEnabled,
        capabilityEligibilityInputEnabled: options.flags.capabilityEligibilityInputEnabled,
        openTurnExecutionEnabled: options.flags.openTurnExecutionEnabled,
        harnessAlignedMessageModelEnabled: options.flags.harnessAlignedMessageModelEnabled,
        persistentSessionCognitionEnabled: options.flags.persistentSessionCognitionEnabled,
        sessionCompactionEnabled: options.flags.sessionCompactionEnabled,
        liveTurnAssimilationEnabled: options.flags.liveTurnAssimilationEnabled
      });

      const eventRows = await loadCommercialEventRowsForInboundMessage(inboundMessageId);
      const outboxRow = cycleResult.dispatch.outboxId !== null ? await loadOutboxRowById(cycleResult.dispatch.outboxId) : null;
      await refreshSnapshotFacts();
      const durableStateAfterTurn = await fetchDurableStateSnapshot({
        conversationId: env.conversationId,
        opportunityId: env.opportunityId,
        correlationId: `${correlationId}-after`,
        snapshot,
        trustedCustomerSession,
        currentTime: new Date().toISOString()
      });

      turns.push(
        buildTurnTrace({
          turnOrdinal,
          inboundMessageId,
          correlationId,
          customerMessage: turnScript.customerMessage,
          eventRows,
          runtimeStatus: cycleResult.runtime.status,
          terminalReason: mapRuntimeStatusToTerminalReason(cycleResult.runtime.status, cycleResult.runtime.reason),
          finalMessage: cycleResult.runtime.responseText,
          handoffReason: cycleResult.runtime.status === "handoff" ? cycleResult.runtime.reason : null,
          toolExecutionCount: cycleResult.runtime.toolCalls,
          runtimeWarnings: cycleResult.runtime.warnings,
          outboxAttempted: cycleResult.dispatch.attempted,
          outboxWritten: cycleResult.dispatch.outboxWritten,
          outboxId: cycleResult.dispatch.outboxId,
          outboxRow,
          durableStateBeforeTurn: priorState,
          durableStateAfterTurn,
          providerCalls: providerCalls.slice(providerCallsBefore)
        })
      );
      priorState = durableStateAfterTurn;
    }

    const finalState = turns[turns.length - 1]?.durableStateAfterTurn ?? initialState;
    const scored = scoreCase(testCase, turns, finalState);
    const passed = caseOutcomePassed(scored);
    const failure = passed
      ? null
      : { caseId: testCase.caseId, runOrdinal: options.runOrdinal, ...classifyFailure(testCase, turns, scored) };

    return {
      benchmarkRunId: options.benchmarkRunId,
      caseId: testCase.caseId,
      runOrdinal: options.runOrdinal,
      executionMode: options.mode === "live" ? "HYBRID" : "STUBBED",
      startedAt,
      finishedAt: new Date().toISOString(),
      initialState,
      turns,
      finalState,
      outcome: { status: passed ? "PASS" : "FAIL", expectationResults: scored.expectationResults, forbiddenViolations: scored.forbiddenViolations, failure }
    };
  } finally {
    await env.teardown();
  }
}
