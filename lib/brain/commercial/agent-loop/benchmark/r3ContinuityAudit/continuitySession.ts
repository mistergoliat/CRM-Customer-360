import { randomUUID } from "node:crypto";
import { runSalesAgentRuntimeCycle } from "../../../sales-agent-runtime";
import { loadRecentCatalogContext } from "../../recentCatalogContext";
import { loadPendingCatalogAction } from "../../pendingCatalogAction";
import { setupR3BenchmarkEnvironment } from "../r3StableAgentV1/environment";
import type { R3BenchmarkEnvironment } from "../r3StableAgentV1/environment";
import { createInstrumentedProvider } from "../instrumentedProvider";
import { createLiveBenchmarkProvider } from "../liveProvider";
import type { LiveBenchmarkProviderConfig } from "../liveProvider";
import type { BenchmarkProviderCallRecord } from "../types";
import {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT
} from "../../../sales-agent-configuration";
import type { ResolvedSalesAgentConfiguration } from "../../../sales-agent-configuration";
import type { CommercialContextSnapshot } from "../../../context/buildNativeCommercialContext";
import { getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import { getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { getActiveSelectedShippingOptionForOpportunity } from "@/lib/domains/selected-shipping-option";
import { getActiveCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";
import { buildBaseSnapshot, resolveBenchmarkE2ELoopConfiguration } from "../r3CommercialE2E/runCommercialE2ECase";
import { readBenchmarkE2EOverrides } from "../r3CommercialE2E/benchmarkOverrides";
import { loadCommercialEventRowsForInboundMessage, loadOutboxRowById } from "../r3CommercialE2E/eventRows";
import { fetchDurableStateSnapshot } from "../r3CommercialE2E/durableStateSnapshot";
import { buildTurnTrace } from "../r3CommercialE2E/buildTurnTrace";
import { buildLevel2MasterResolvedSession } from "../r3CommercialE2E/identitySessionFixtures";
import type { BenchmarkE2EDurableStateSnapshot, BenchmarkE2EFlagsConfig } from "../r3CommercialE2E/types";
import { classifyConfirmation, classifyMissingFactKind } from "../r3MutationSemantics/confirmationClassifier";
import { createMariaDbAgentSessionStore } from "../../../agent-session/mariaDbAgentSessionStore";
import {
  loadPersistentSessionContext,
  resolveValidCompactionCutoff,
  shouldTriggerSessionCompaction,
  SESSION_COMPACTION_DEFAULT_MAX_RAW_MESSAGES,
  SESSION_COMPACTION_DEFAULT_TARGET_RECENT_MESSAGES,
  AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES
} from "../../../agent-session";
import { checkContinuityFalseSuccessClaim } from "./falseSuccessDetector";
import { appendConversationMessage } from "@/lib/brain/local-ai-sdr/repository";
import { queryRows } from "@/lib/db";
import type {
  ContinuityCompactionEligibilityTrace,
  ContinuityConversationLabel,
  ContinuityFactKey,
  ContinuityInvalidJsonBucket,
  ContinuityPlannedTurn,
  ContinuityProviderCallOutcome,
  ContinuitySessionSnapshot,
  ContinuityTurnTrace,
  ContinuityToolCallTrace
} from "./types";
import { CONTINUITY_CONVERSATION_PERSONAS } from "./types";

/**
 * P7.13-A section 8-13. Benchmark-only mirror of runSessionCompaction.ts's own
 * eligibility read - never a second compaction attempt, purely a read (same
 * lock-guarded loadPersistentSessionContext production already uses, GET_LOCK
 * acquired/released inside that single call). Called before AND after
 * runSalesAgentRuntimeCycle so compactedThroughSeqBefore/After bracket
 * whatever the real compaction call inside the cycle did.
 */
async function readCompactionEligibility(conversationId: number, maxRawMessages: number): Promise<{
  sessionId: string | null;
  compactedThroughSeq: number | null;
  rawMessageCount: number;
  uncompactedMessageCount: number;
  compactionEligible: boolean;
}> {
  const context = await loadPersistentSessionContext({ conversationId, maxTranscriptMessages: AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES });
  if (!context.ok || !context.session) {
    return { sessionId: null, compactedThroughSeq: null, rawMessageCount: 0, uncompactedMessageCount: 0, compactionEligible: false };
  }
  const cutoff = resolveValidCompactionCutoff(context.compactedPrefix);
  const uncompacted = cutoff === null ? context.transcriptMessages : context.transcriptMessages.filter((row) => Number(row.id) > cutoff);
  return {
    sessionId: context.session.id,
    compactedThroughSeq: context.session.compactedThroughSeq,
    rawMessageCount: context.transcriptMessages.length,
    uncompactedMessageCount: uncompacted.length,
    compactionEligible: shouldTriggerSessionCompaction(uncompacted.length, maxRawMessages)
  };
}

/**
 * P7.13-A section 14-17. finishReason is the only per-call signal available
 * without touching httpAgentLoopProvider.ts's deliberately-sanitized failure
 * classification (see types.ts's own comment on ContinuityProviderCallOutcome) -
 * "length" is a real, provider-reported signal that generation was cut off by
 * maxOutputTokens before completing, which is the one invalid_model_json cause
 * this repo's instrumentation can actually distinguish today.
 */
function classifyInvalidJsonBucket(call: BenchmarkProviderCallRecord): ContinuityInvalidJsonBucket {
  if (call.errorCode !== "invalid_model_json") return "NOT_APPLICABLE";
  if (call.finishReason === "length") return "TRUNCATED_JSON";
  if (call.outputTokens === 0) return "EMPTY_RESPONSE";
  return "UNKNOWN_NON_TRUNCATED";
}

const FINALIZATION_PHASE_MARKER = "no more tools are available";

function detectCallPhase(call: BenchmarkProviderCallRecord): "gathering" | "finalization" | "unknown" {
  const systemMessage = call.requestMessages?.find((message) => message.role === "system");
  if (typeof systemMessage?.content !== "string") return "unknown";
  return systemMessage.content.includes(FINALIZATION_PHASE_MARKER) ? "finalization" : "gathering";
}

function buildProviderCallOutcomes(
  turnIndex: number,
  conversation: ContinuityConversationLabel,
  calls: readonly BenchmarkProviderCallRecord[]
): ContinuityProviderCallOutcome[] {
  return calls.map((call, callIndex) => ({
    turnIndex,
    conversation,
    callIndex,
    phase: detectCallPhase(call),
    outcome: call.outcome,
    errorCode: call.errorCode,
    finishReason: call.finishReason,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    invalidJsonBucket: classifyInvalidJsonBucket(call)
  }));
}

/**
 * P7.13. Turn-by-turn wrapper around the SAME per-turn body
 * r3CommercialE2E/runCommercialE2ECase.ts runs internally (setup once, loop
 * testCase.turns) - here split into create/runOneTurn/teardown so five
 * conversations can be driven interleaved (never one fully before another
 * starts), same discipline r3ConversationalSoak/soakSession.ts already
 * established for the P7.9-P7.12 native harness. Every real dependency
 * (MariaDB, CommercialWork, Capability Gateway, AgentSession/compaction,
 * outbox) is production code against a real local database - only the
 * reasoning provider and Catalog/Carrier/commune fakes setupR3BenchmarkEnvironment
 * already establishes are not the real thing.
 */

const agentSessionStore = createMariaDbAgentSessionStore();

export type ContinuityConversationSession = {
  label: ContinuityConversationLabel;
  persona: string;
  env: R3BenchmarkEnvironment;
  /**
   * The REAL conversation.public_id (a UUID) - NOT the synthetic
   * `conv-benchmark-${conversationId}` placeholder r3CommercialE2E's
   * buildBaseSnapshot() uses for the in-memory snapshot only.
   * appendConversationMessage() does a real `WHERE public_id = ?` lookup, so
   * using the placeholder there silently no-ops with conversation_not_found -
   * exactly the P7.13 finding that motivated this fix (see readiness report).
   */
  conversationPublicId: string;
  benchmarkRunId: string;
  snapshot: CommercialContextSnapshot;
  resolvedConfiguration: ResolvedSalesAgentConfiguration;
  flags: BenchmarkE2EFlagsConfig;
  providerCalls: BenchmarkProviderCallRecord[];
  priorDurableState: BenchmarkE2EDurableStateSnapshot;
  turnOrdinal: number;
  compactionCount: number;
  lastCompactedThroughSeq: number | null;
  greetedOnce: boolean;
};

function buildResolvedConfiguration(liveConfig: LiveBenchmarkProviderConfig): ResolvedSalesAgentConfiguration {
  const overrides = readBenchmarkE2EOverrides();
  return {
    source: "safe_default",
    scopeKey: SALES_AGENT_CONFIGURATION_SCOPE,
    recordId: null,
    version: null,
    configurationHash: null,
    configuration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    effectiveModelConfiguration: {
      ...SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
      model: liveConfig.model,
      temperature: liveConfig.temperature,
      ...(overrides.modelTimeoutMs !== undefined ? { timeoutMs: overrides.modelTimeoutMs } : {}),
      ...(liveConfig.maxOutputTokens !== undefined ? { maxOutputTokens: liveConfig.maxOutputTokens } : {}),
      maxModelRetries: liveConfig.maxModelRetries
    },
    effectiveLoopConfiguration: resolveBenchmarkE2ELoopConfiguration(),
    effectiveFollowUpConfiguration: SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT
  };
}

async function refreshSnapshotFacts(snapshot: CommercialContextSnapshot, opportunityId: number): Promise<void> {
  snapshot.shippingDestination = await getActiveShippingDestinationForOpportunity(opportunityId);
  snapshot.commercialLineItems = await getActiveCommercialLineItemsForOpportunity(opportunityId);
}

async function readSourceFacts(opportunityId: number): Promise<Record<ContinuityFactKey, unknown>> {
  const [selection, destination, shipping, quote] = await Promise.all([
    getActiveCommercialLineItemsForOpportunity(opportunityId),
    getActiveShippingDestinationForOpportunity(opportunityId),
    getActiveSelectedShippingOptionForOpportunity(opportunityId),
    getActiveCreatedQuoteForOpportunity(opportunityId)
  ]);
  return { selection, destination, shipping, quote, objective: null };
}

async function readSessionSnapshot(conversationId: number): Promise<ContinuitySessionSnapshot> {
  const session = await agentSessionStore.loadSessionForConversation(conversationId);
  if (!session) return { sessionId: null, status: null, compactedThroughSeq: null, compactedPrefixTextLength: null, compactedPrefixText: null };
  const summaryText = typeof session.compactedPrefixJson?.summaryText === "string" ? session.compactedPrefixJson.summaryText : null;
  return {
    sessionId: session.id,
    status: session.status,
    compactedThroughSeq: session.compactedThroughSeq,
    compactedPrefixTextLength: summaryText ? summaryText.length : null,
    compactedPrefixText: summaryText
  };
}

function matchesGreeting(text: string | null): boolean {
  if (!text) return false;
  return /^\s*(¡?hola|buen[oa]s\s+(d[ií]as|tardes|noches)|¿?c[oó]mo\s+est[aá]s)/i.test(text);
}

export async function createContinuitySession(input: {
  label: ContinuityConversationLabel;
  benchmarkRunId: string;
  flags: BenchmarkE2EFlagsConfig;
  liveConfig: LiveBenchmarkProviderConfig;
}): Promise<ContinuityConversationSession> {
  const env = await setupR3BenchmarkEnvironment();
  const seedTime = new Date().toISOString();
  const snapshot = buildBaseSnapshot({ conversationId: env.conversationId, waId: env.waId, opportunityId: env.opportunityId, masterCustomerId: env.masterCustomerId, currentTime: seedTime });
  await refreshSnapshotFacts(snapshot, env.opportunityId);
  const initialState = await fetchDurableStateSnapshot({
    conversationId: env.conversationId,
    opportunityId: env.opportunityId,
    correlationId: `${input.benchmarkRunId}-${input.label}-initial-${randomUUID()}`,
    snapshot,
    trustedCustomerSession: buildLevel2MasterResolvedSession({ conversationId: env.conversationId, waId: env.waId, messageId: `${input.benchmarkRunId}-${input.label}-identity`, currentTime: seedTime, masterCustomerId: env.masterCustomerId }),
    currentTime: seedTime
  });

  const conversationPublicIdRows = await queryRows<{ public_id: string }>("SELECT public_id FROM conversation WHERE id = ? LIMIT 1", [env.conversationId]);
  const conversationPublicId = conversationPublicIdRows[0]?.public_id;
  if (!conversationPublicId) throw new Error(`P7.13 harness: no conversation row found for id=${env.conversationId}`);

  return {
    label: input.label,
    persona: CONTINUITY_CONVERSATION_PERSONAS[input.label],
    env,
    conversationPublicId,
    benchmarkRunId: input.benchmarkRunId,
    snapshot,
    resolvedConfiguration: buildResolvedConfiguration(input.liveConfig),
    flags: input.flags,
    providerCalls: [],
    priorDurableState: initialState,
    turnOrdinal: 0,
    compactionCount: 0,
    lastCompactedThroughSeq: null,
    greetedOnce: false
  };
}

export async function runContinuityTurn(
  session: ContinuityConversationSession,
  plannedTurn: ContinuityPlannedTurn,
  globalTurnIndex: number,
  liveConfig: LiveBenchmarkProviderConfig
): Promise<ContinuityTurnTrace> {
  const inboundMessageId = `${session.benchmarkRunId}-${session.label}-turn${session.turnOrdinal}`;
  const correlationId = `${inboundMessageId}-${randomUUID()}`;
  const currentTime = new Date().toISOString();

  await refreshSnapshotFacts(session.snapshot, session.env.opportunityId);
  const trustedCustomerSession = buildLevel2MasterResolvedSession({
    conversationId: session.env.conversationId,
    waId: session.env.waId,
    messageId: inboundMessageId,
    currentTime,
    masterCustomerId: session.env.masterCustomerId
  });

  const durableFactsBefore = await readSourceFacts(session.env.opportunityId);
  const sessionBefore = await readSessionSnapshot(session.env.conversationId);

  const recentCatalogContextResult = await loadRecentCatalogContext({ conversationId: session.env.conversationId, currentTime });
  const pendingCatalogActionResult = await loadPendingCatalogAction({ conversationId: session.env.conversationId });

  // P7.13 finding: runSalesAgentRuntimeCycle never writes conversation_message itself -
  // that is processNativeWhatsAppInbound's job (the real webhook), which this harness
  // (like r3CommercialE2E before it) never calls. Without this write,
  // deriveConversationMessages()/session compaction have nothing to read and
  // persistentSessionHistoricalMessages is always empty, no matter how long the
  // conversation runs - see docs/audits/r3-p7-13-continuity-vulnerability-degradation.md
  // readiness report. Mirrors native-whatsapp/service.ts's own appendConversationMessage
  // call verbatim (provider/senderType), never a new write path.
  const inboundWrite = await appendConversationMessage({
    conversationPublicId: session.conversationPublicId,
    provider: "meta",
    providerMessageId: inboundMessageId,
    direction: "inbound",
    senderType: "customer",
    body: plannedTurn.message,
    status: "received",
    occurredAt: currentTime
  });
  if (!inboundWrite.ok) throw new Error(`P7.13 harness: failed to write inbound conversation_message (${inboundWrite.error}) for ${session.label} turn ${session.turnOrdinal}`);

  const innerProvider = createLiveBenchmarkProvider(liveConfig);
  const providerCallsBefore = session.providerCalls.length;
  const provider = createInstrumentedProvider(innerProvider, `${session.benchmarkRunId}-${session.label}`, session.turnOrdinal, session.providerCalls);

  const cycleResult = await runSalesAgentRuntimeCycle({
    conversationId: session.env.conversationId,
    conversationPublicId: `conv-benchmark-${session.env.conversationId}`,
    customerMasterId: session.env.masterCustomerId,
    waId: session.env.waId,
    phoneNumberId: "benchmark-phone",
    messageId: inboundMessageId,
    inboundMessageId,
    correlationId,
    currentTime,
    customerMessage: plannedTurn.message,
    snapshot: session.snapshot,
    provider,
    trustedCustomerSession,
    recentCatalogContext: recentCatalogContextResult.context,
    pendingCatalogAction: pendingCatalogActionResult.pendingCatalogAction,
    resolvedSalesAgentConfiguration: session.resolvedConfiguration,
    agentTurnInputShadowEnabled: session.flags.agentTurnInputShadowEnabled,
    commercialWorkKernelEnabled: session.flags.commercialWorkKernelEnabled,
    commercialProposalShadowEnabled: session.flags.commercialProposalShadowEnabled,
    commercialObjectiveReconciliationEnabled: session.flags.commercialObjectiveReconciliationEnabled,
    capabilityEligibilityShadowEnabled: session.flags.capabilityEligibilityShadowEnabled,
    capabilityEligibilityInputEnabled: session.flags.capabilityEligibilityInputEnabled,
    openTurnExecutionEnabled: session.flags.openTurnExecutionEnabled,
    harnessAlignedMessageModelEnabled: session.flags.harnessAlignedMessageModelEnabled,
    persistentSessionCognitionEnabled: session.flags.persistentSessionCognitionEnabled,
    sessionCompactionEnabled: session.flags.sessionCompactionEnabled,
    liveTurnAssimilationEnabled: session.flags.liveTurnAssimilationEnabled
  });

  // P7.13-A. Read right here - after the cycle (so production's own
  // runSessionCompactionIfEligible call inside it has already run) and
  // before the harness's own outbound append below (so this mirrors exactly
  // the DB state production's own check saw, never a state the harness
  // itself mutated afterward).
  const compactionEligibility = await readCompactionEligibility(session.env.conversationId, SESSION_COMPACTION_DEFAULT_MAX_RAW_MESSAGES);

  if (cycleResult.runtime.responseText) {
    await appendConversationMessage({
      conversationPublicId: session.conversationPublicId,
      provider: "meta",
      providerMessageId: `${inboundMessageId}-reply`,
      direction: "outbound",
      senderType: "ai_sdr",
      body: cycleResult.runtime.responseText,
      status: "sent",
      occurredAt: new Date().toISOString()
    });
  }

  const eventRows = await loadCommercialEventRowsForInboundMessage(inboundMessageId);
  const outboxRow = cycleResult.dispatch.outboxId !== null ? await loadOutboxRowById(cycleResult.dispatch.outboxId) : null;
  await refreshSnapshotFacts(session.snapshot, session.env.opportunityId);

  const durableStateAfterTurn = await fetchDurableStateSnapshot({
    conversationId: session.env.conversationId,
    opportunityId: session.env.opportunityId,
    correlationId: `${correlationId}-after`,
    snapshot: session.snapshot,
    trustedCustomerSession,
    currentTime: new Date().toISOString()
  });
  const durableFactsAfter = await readSourceFacts(session.env.opportunityId);
  const sessionAfter = await readSessionSnapshot(session.env.conversationId);

  const terminalReasonForTrace =
    cycleResult.runtime.status === "responded" ? "responded" : cycleResult.runtime.status === "handoff" ? "handoff" : "provider_unavailable";

  const baseTrace = buildTurnTrace({
    turnOrdinal: session.turnOrdinal,
    inboundMessageId,
    correlationId,
    customerMessage: plannedTurn.message,
    eventRows,
    runtimeStatus: cycleResult.runtime.status,
    terminalReason: terminalReasonForTrace,
    finalMessage: cycleResult.runtime.responseText,
    handoffReason: cycleResult.runtime.status === "handoff" ? cycleResult.runtime.reason : null,
    toolExecutionCount: cycleResult.runtime.toolCalls,
    runtimeWarnings: cycleResult.runtime.warnings,
    outboxAttempted: cycleResult.dispatch.attempted,
    outboxWritten: cycleResult.dispatch.outboxWritten,
    outboxId: cycleResult.dispatch.outboxId,
    outboxRow,
    durableStateBeforeTurn: session.priorDurableState,
    durableStateAfterTurn,
    providerCalls: session.providerCalls.slice(providerCallsBefore)
  });

  const toolCalls: ContinuityToolCallTrace[] = baseTrace.toolInvocations.map((invocation) => ({
    capability: invocation.capability,
    status: invocation.toolObservation.status,
    errorCode: invocation.toolObservation.errorCode
  }));
  const selectCompleted = toolCalls.some((call) => call.capability === "select_products" && call.status === "completed");

  const compactionHappenedThisTurn = sessionBefore.compactedThroughSeq !== sessionAfter.compactedThroughSeq && sessionAfter.compactedThroughSeq !== null;
  if (compactionHappenedThisTurn) session.compactionCount += 1;

  const finalMessage = cycleResult.runtime.responseText;
  const regreeted = matchesGreeting(finalMessage) && session.greetedOnce && plannedTurn.localIndex > 0;
  if (matchesGreeting(finalMessage)) session.greetedOnce = true;

  const turnProviderCalls = session.providerCalls.slice(providerCallsBefore);

  const compactionEligibilityTrace: ContinuityCompactionEligibilityTrace = {
    turnIndex: globalTurnIndex,
    conversation: session.label,
    localTurn: plannedTurn.localIndex,
    sessionId: compactionEligibility.sessionId,
    rawMessageCount: compactionEligibility.rawMessageCount,
    uncompactedMessageCount: compactionEligibility.uncompactedMessageCount,
    compactedThroughSeqBefore: sessionBefore.compactedThroughSeq,
    compactedThroughSeqAfter: compactionEligibility.compactedThroughSeq,
    targetRecentMessages: SESSION_COMPACTION_DEFAULT_TARGET_RECENT_MESSAGES,
    maxRawMessages: SESSION_COMPACTION_DEFAULT_MAX_RAW_MESSAGES,
    sessionCompactionEnabled: session.flags.sessionCompactionEnabled === true,
    persistentSessionCognitionEnabled: session.flags.persistentSessionCognitionEnabled === true,
    compactionEligible: compactionEligibility.compactionEligible,
    compactionSucceeded: sessionBefore.compactedThroughSeq !== compactionEligibility.compactedThroughSeq && compactionEligibility.compactedThroughSeq !== null,
    compactionSkippedReason: cycleResult.runtime.warnings.find((warning) => warning.startsWith("session_compaction_failed:")) ?? null
  };

  const turnTrace: ContinuityTurnTrace = {
    turnIndex: globalTurnIndex,
    conversation: session.label,
    localIndex: plannedTurn.localIndex,
    compactionGenerationBefore: session.compactionCount - (compactionHappenedThisTurn ? 1 : 0),
    probe: plannedTurn.probe,
    category: plannedTurn.category,
    customerMessage: plannedTurn.message,
    durableFactsBefore,
    sessionBefore,
    modelResponse: finalMessage,
    terminalReason: cycleResult.runtime.status,
    handoffReason: cycleResult.runtime.status === "handoff" ? cycleResult.runtime.reason : null,
    runtimeReason: cycleResult.runtime.reason,
    runtimeWarnings: cycleResult.runtime.warnings,
    toolCalls,
    eligibleCapabilityNames: baseTrace.eligibilityShadow?.eligibleCapabilityNames ?? null,
    durableFactsAfter,
    sessionAfter,
    compactionHappenedThisTurn,
    confirmationClass: classifyConfirmation({ reply: finalMessage, selectCompleted }),
    missingFactKind: classifyMissingFactKind(finalMessage),
    falseSuccessClaim: checkContinuityFalseSuccessClaim({ finalMessage, terminalReason: cycleResult.runtime.status, selectCompleted }).unbacked,
    regreeted,
    invariantChecks: [],
    providerCalls: turnProviderCalls,
    durableStateAfterTurn,
    compactionEligibility: compactionEligibilityTrace,
    providerCallOutcomes: buildProviderCallOutcomes(globalTurnIndex, session.label, turnProviderCalls)
  };

  session.priorDurableState = durableStateAfterTurn;
  session.turnOrdinal += 1;
  return turnTrace;
}

export async function teardownContinuitySession(session: ContinuityConversationSession): Promise<void> {
  await session.env.teardown();
}
