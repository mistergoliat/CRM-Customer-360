import { runAgentToolLoop } from "../agent-loop/runAgentToolLoop";
import type { RunAgentToolLoopInput } from "../agent-loop/runAgentToolLoop";
import type { AgentLoopProvider } from "../agent-loop/agentLoopProviderTypes";
import type { AgentLoopResult, AgentLoopStepRecord, AgentLoopTerminalReason, PendingCatalogActionStep } from "../agent-loop/agentStepTypes";
import type { RecentCatalogContext } from "../agent-loop/recentCatalogContext";
import type { AgentRuntimeEvent } from "../agent-runtime-event/types";
import { resolveAgentCapabilityExposure } from "../agent-capability-exposure/types";
import { ensureCommercialActionOpportunity } from "../commercial-action-request/ensureCommercialActionOpportunity";
import type { EnsureCommercialActionOpportunityInput, EnsureCommercialActionOpportunityResult } from "../commercial-action-request/ensureCommercialActionOpportunity";
import { recordAgentToolLoopToolActivityEvents } from "../agent-session/shadowRecorder";
import { appendAgentSessionEventWithRetry } from "../agent-session/appendWithRetry";
import { buildUserMessageDedupeKey } from "../agent-session/dedupe";
import { getDefaultAgentSessionStore } from "../agent-session/defaultStore";
import type { AgentSessionStore } from "../agent-session/store";
import { runPersistentSessionShadowComparison } from "../agent-session/runPersistentSessionShadow";
import { extractLegacyRecentMessagesForShadow } from "../agent-session/persistentSessionShadowComparison";
import { resolvePersistentSessionCognitionContext, stripRecentMessagesForPersistentSessionContext } from "../agent-session/resolvePersistentSessionCognitionContext";
import { deriveConversationContinuityFromHistoricalMessages, deriveConversationContinuityFromLegacyContext } from "../agent-loop/conversationContinuity";
import { recordPersistentSessionCognitionAppliedEvent } from "../events/service";
import type { AgentToolLoopStepSummary } from "../events/types";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session/types";
import type { SalesAgentPromptConfiguration } from "../sales-agent-configuration";

// SALES-AGENT-R3-V1.3. The first provider-neutral boundary that consumes an
// AgentRuntimeEvent (R3-A05) and runs a real, dynamic model/tool loop to a
// final response - the exact seam runAgentRuntimeEvent.ts's own comment
// already reserved ("a future SalesAgentHarness consumes AgentRuntimeEvent
// directly through a function shaped exactly like this one"). Deliberately
// NOT wired into runAgentRuntimeEvent.ts in this task (Scope Guard: no
// WhatsApp routing change, no replacing the existing runtime) - see the
// release doc's "exact next task."
//
// Reuse, not reimplementation: every mechanic of the iterative loop (dynamic
// tool sequencing, budgets, evidence gates, provider error handling,
// finalization, per-tool-call AgentSession events) already exists in
// runAgentToolLoop.ts (ATL). This module's only job is the boundary around
// it: translate an AgentRuntimeEvent into ATL's own input contract, run it
// unmodified, and normalize the result into a stable, provider-neutral shape
// a future WhatsApp adapter/benchmark harness can consume without depending
// on AgentLoopResult's internal shape.

export type SalesAgentRuntimeInput = {
  event: AgentRuntimeEvent;
  /** Already-known opportunity anchor for this turn, if any - never re-derived here. A missing one is resolved/created lazily by the loop itself (R3-V1.1/V1.2), and only if a commercial action is actually attempted this turn. */
  opportunityId: number | null;
  provider: AgentLoopProvider | null;
  trustedCustomerSession?: NativeCustomerSessionExecutionContext | null;
  /** Already-sanitized, already-reduced context - never raw PII, never a full domain snapshot. Defaults to {}. */
  commercialContextSummary?: Record<string, unknown>;
  recentCatalogContext?: RecentCatalogContext | null;
  pendingCatalogAction?: PendingCatalogActionStep | null;
  identityConfiguration?: SalesAgentPromptConfiguration;
  maxDecisions?: number;
  maxToolExecutions?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal | null;
  /**
   * A human already owns this conversation, or AI is blocked from
   * responding - the runtime never invokes the model then (same invariant
   * runNativeAgentToolLoopCycle.ts's own skippedResult already enforces at
   * the production layer). Defaults to false/false: an isolated caller (a
   * test, a benchmark) with no such external signal always attempts the turn.
   */
  governance?: { humanOwnerActive?: boolean; aiBlocked?: boolean };
  /** Test/DI seam - defaults to the real, MariaDB-backed ensureCommercialActionOpportunity. */
  ensureOpportunity?: (input: EnsureCommercialActionOpportunityInput) => Promise<EnsureCommercialActionOpportunityResult>;
  /** Test/DI seam - defaults to the real, MariaDB-backed AgentSessionStore. */
  sessionStore?: AgentSessionStore;
  /**
   * SALES-AGENT-R3-V1.8-D4. Fail-closed, default false - reads the flag at
   * the call site (runNativeAutonomousCycle.ts, via
   * buildPersistentSessionShadowFeatureFlags), never inside this module, so
   * this runtime keeps its existing no-env-read discipline (every other
   * toggle here - governance, maxDecisions, timeoutMs - is threaded in the
   * same way) and a test can flip it without touching process.env. Shadow-
   * only: see runPersistentSessionShadow.ts's own failure-isolation
   * contract - this can only ever add a warning, never alter loopInput.
   */
  persistentSessionShadowEnabled?: boolean;
  /**
   * SALES-AGENT-R3-V1.8-D5/D6. Fail-closed, default true since D6 (the
   * normal R3 conversational-memory path) - resolved at the call site
   * (runNativeAutonomousCycle.ts, via shouldEnablePersistentSessionCognition)
   * exactly like persistentSessionShadowEnabled above, so this runtime never
   * reads process.env. Independent of persistentSessionShadowEnabled - see
   * resolvePersistentSessionCognitionContext.ts's own header for the
   * fallback-to-legacy contract this depends on. This one is a real input to
   * the turn: when true and the read succeeds, it changes
   * commercialContextSummary (recentMessages stripped) and
   * loopInput.persistentSessionHistoricalMessages. When false (D6's rollback
   * lever, BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED=false) or when the
   * read/derive fails, the turn takes the exact legacy path instead.
   */
  persistentSessionCognitionEnabled?: boolean;
  /**
   * SALES-AGENT-R3-V1.8.1. Set only by the turn-settlement worker, when
   * event.messageText already aggregates more than one raw WhatsApp fragment.
   * Threaded unchanged into resolvePersistentSessionCognitionContext so every
   * fragment id is excluded from historicalMessages - the anchor id
   * (event.messageId) is already excluded by the pre-existing single-id path.
   */
  additionalInboundMessageIds?: readonly string[] | null;
  /**
   * SALES-AGENT-R3-V1.8.1b-A (Objetivo A). Resolved by the caller from
   * BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED - never read from process.env
   * here, same discipline as persistentSessionCognitionEnabled above.
   */
  liveTurnAssimilationEnabled?: boolean;
  /** SALES-AGENT-R3-V1.8.1b-A. Threaded to runAgentToolLoop unchanged - see that type's own comment. */
  refreshCommercialContextSummary?: () => Promise<Record<string, unknown>>;
};

export const SALES_AGENT_RUNTIME_STATUSES = ["responded", "blocked", "failed", "handoff"] as const;
export type SalesAgentRuntimeStatus = (typeof SALES_AGENT_RUNTIME_STATUSES)[number];

export type SalesAgentRuntimeResult = {
  status: SalesAgentRuntimeStatus;
  /** The grounded, customer-facing text - present only when status is "responded". */
  responseText: string | null;
  /** Structured cause only - never free text or chain-of-thought. Null when status is "responded". */
  reason: string | null;
  modelSteps: number;
  toolCalls: number;
  readToolCalls: number;
  commercialActionCalls: number;
  /** Null on a pure read-only turn. Populated once any COMMERCIAL_ACTION tool call is attempted, whether it ultimately completed, was denied, or failed. */
  resolvedOpportunityId: number | null;
  /** A catalog action this response left open for the customer to resolve next turn (e.g. "quieres el link de alguno de estos?") - feed back verbatim as the next call's `pendingCatalogAction` input. The one cross-turn continuity primitive that lives entirely within this runtime's own boundary (unlike RecentCatalogContext, whose DB-backed correlation is coupled to runNativeAgentToolLoopCycle's own event recording - see the release doc's known limitations). */
  finalPendingCatalogAction: PendingCatalogActionStep | null;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  warnings: string[];
  /** SALES-AGENT-R3-V1.8.1b-A. Mirrors AgentLoopResult's own field - null whenever no anchor existed (e.g. no inboundMessageId this turn) or the loop never ran. */
  finalAssimilatedInboundMessageId: number | null;
  /** Mirrors AgentLoopResult's own field - every conversation_message id folded into this turn's customerMessage mid-run. */
  assimilatedInboundMessageIds: number[];
  /** Mirrors AgentLoopResult's own field - how many times tryAssimilate() actually found and folded in new inbound. */
  assimilationCycleCount: number;
  /** Mirrors AgentLoopResult's own field - how many respond/handoff/use_tool candidates were discarded as stale. */
  invalidatedCandidateCount: number;
};

/**
 * Mirrors runNativeAgentToolLoopCycle.ts#buildStepsSummary exactly, kept as
 * a local copy rather than a shared import so this module never pulls in
 * native-cycle's own production dependency graph (customer-profile-context,
 * sales-agent-configuration resolution, dispatch, ...) for an 8-line
 * mapping. Same no-cross-module-import discipline events/types.ts's own
 * comment already documents for this exact shape.
 */
function buildStepsSummary(steps: AgentLoopStepRecord[]): AgentToolLoopStepSummary[] {
  return steps.map((record) => ({
    stepIndex: record.stepIndex,
    type: record.step.type,
    phase: record.phase,
    tool: record.step.type === "use_tool" ? record.step.tool : undefined,
    governance: record.governance ?? undefined,
    observationStatus: record.observation?.status ?? undefined
  }));
}

/**
 * SALES-AGENT-R3-V1.8-D5/D6. Non-blocking observability, emitted whenever
 * persistent-session cognition is eligible this turn (`input.persistentSessionCognitionEnabled
 * === true` at the one caller below) - under D6 that is now every ordinary
 * R3 turn (BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED defaults true), not
 * just D5's owner-only pilot, so this is the per-turn
 * persistent-vs-legacy-fallback signal Section P asks for: `active` doubles
 * as sessionCognitionMode (true=persistent_session, false=legacy_fallback),
 * `fallbackReason`/`historyMessageCount` unchanged. Turns where the flag
 * itself is off (the global rollback) write no event at all - that state is
 * already visible from the env var, not from a per-turn row. A write
 * failure here never blocks the turn, same idiom as every other event write
 * in this file - only ever adds a warning.
 */
async function recordPersistentSessionCognitionAppliedDiagnostic(input: {
  conversationId: number;
  inboundMessageId: string;
  correlationId: string;
  active: boolean;
  fallbackReason: string | null;
  historyMessageCount: number;
}): Promise<{ ok: true } | { ok: false; warning: string }> {
  try {
    await recordPersistentSessionCognitionAppliedEvent({
      inboundMessageId: input.inboundMessageId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      active: input.active,
      fallbackReason: input.fallbackReason,
      historyMessageCount: input.historyMessageCount
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return { ok: false, warning: `persistent_session_cognition_applied_event_write_failed:${message}` };
  }
}

/**
 * SALES-AGENT-R3-V1.8-D2. Durable turn-start marker, written BEFORE
 * runAgentToolLoop invokes the provider - not after, as the pre-D2 shadow
 * recorder did. RETRY_THEN_DEGRADE (V1.8-D0 section 12): one short bounded
 * retry, then a warning, never a blocked turn. Reference-only payload
 * (`{inboundMessageId}`) - conversation_message already owns the actual
 * text, unchanged by this task.
 */
async function recordUserMessageReceivedEvent(input: {
  conversationId: number;
  inboundMessageId: string;
  correlationId: string;
  store?: AgentSessionStore;
}): Promise<{ ok: true } | { ok: false; warning: string }> {
  const store = input.store ?? getDefaultAgentSessionStore();
  try {
    const session = await store.ensureSession({ conversationId: input.conversationId });
    const result = await appendAgentSessionEventWithRetry(store, {
      sessionId: session.id,
      conversationId: input.conversationId,
      eventType: "USER_MESSAGE_RECEIVED",
      correlationId: input.correlationId,
      dedupeKey: buildUserMessageDedupeKey(session.id, input.inboundMessageId),
      payload: { inboundMessageId: input.inboundMessageId }
    });
    if (result.status === "degraded" || result.status === "invalid") return { ok: false, warning: result.warning };
    return { ok: true };
  } catch (error) {
    return { ok: false, warning: error instanceof Error ? error.message : String(error) };
  }
}

function blockedResult(reason: string, opportunityId: number | null): SalesAgentRuntimeResult {
  return {
    status: "blocked",
    responseText: null,
    reason,
    modelSteps: 0,
    toolCalls: 0,
    readToolCalls: 0,
    commercialActionCalls: 0,
    resolvedOpportunityId: opportunityId,
    finalPendingCatalogAction: null,
    durationMs: 0,
    inputTokens: null,
    outputTokens: null,
    warnings: [],
    finalAssimilatedInboundMessageId: null,
    assimilatedInboundMessageIds: [],
    assimilationCycleCount: 0,
    invalidatedCandidateCount: 0
  };
}

function failedResult(reason: string, opportunityId: number | null): SalesAgentRuntimeResult {
  return {
    status: "failed",
    responseText: null,
    reason,
    modelSteps: 0,
    toolCalls: 0,
    readToolCalls: 0,
    commercialActionCalls: 0,
    resolvedOpportunityId: opportunityId,
    finalPendingCatalogAction: null,
    durationMs: 0,
    inputTokens: null,
    outputTokens: null,
    warnings: [],
    finalAssimilatedInboundMessageId: null,
    assimilatedInboundMessageIds: [],
    assimilationCycleCount: 0,
    invalidatedCandidateCount: 0
  };
}

const TERMINAL_REASON_TO_STATUS: Record<AgentLoopTerminalReason, SalesAgentRuntimeStatus> = {
  responded: "responded",
  handoff: "handoff",
  max_steps_exceeded: "failed",
  invalid_output: "failed",
  provider_unavailable: "failed",
  timeout: "failed"
};

export async function runSalesAgentRuntime(input: SalesAgentRuntimeInput): Promise<SalesAgentRuntimeResult> {
  // A4 invariant (matches runNativeAgentToolLoopCycle.ts's own skippedResult):
  // a human-owned or AI-blocked conversation never reaches the model.
  if (input.governance?.humanOwnerActive) return blockedResult("human_owner_active", input.opportunityId);
  if (input.governance?.aiBlocked) return blockedResult("ai_blocked", input.opportunityId);

  // R3-A05's own two variants are structurally distinct on purpose
  // (FollowUpWakeEvent carries no model-facing message text at all, and
  // already has its own deterministic dispatcher -
  // followup-wake/dispatchDraftedFollowUpMessage.ts). This runtime's
  // PRIMARY GOAL is the iterative reasoning loop a real customer message
  // needs; a FOLLOWUP_WAKE event is a contract error here, never silently
  // reinterpreted as one.
  if (input.event.type !== "CUSTOMER_MESSAGE") {
    return failedResult("unsupported_event_type", input.opportunityId);
  }

  const event = input.event;
  const startedAt = Date.now();
  const inboundMessageId = event.messageId !== null && event.messageId !== undefined ? String(event.messageId) : null;

  // SALES-AGENT-R3-V1.2's own injection seam, reused (never reimplemented)
  // to observe the exact opportunityId a COMMERCIAL_ACTION tool call
  // resolves/creates this turn. AgentLoopResult does not expose it today -
  // a documented gap (docs/releases/SALES-AGENT-R3-V1.2-lazy-opportunity-wiring.md
  // Phase 10) this task now has a real, demonstrated need to close, without
  // touching ATL's own ~6 terminal return points. Stays input.opportunityId
  // (often null) whenever the loop never attempts a COMMERCIAL_ACTION tool -
  // ensureOpportunity is only ever called from that one branch inside
  // processUseToolStep.
  let resolvedOpportunityId: number | null = input.opportunityId;
  const providedEnsureOpportunity = input.ensureOpportunity ?? ensureCommercialActionOpportunity;
  const ensureOpportunity = async (ensureInput: EnsureCommercialActionOpportunityInput) => {
    const result = await providedEnsureOpportunity(ensureInput);
    if (result.ok) resolvedOpportunityId = result.opportunityId;
    return result;
  };

  const preLoopWarnings: string[] = [];

  // SALES-AGENT-R3-V1.8-D5. Resolved BEFORE loopInput is built, unlike D4's
  // shadow (after loopInput, discard-only) - a successful read changes two
  // of loopInput's own fields below (commercialContextSummary/
  // persistentSessionHistoricalMessages). `active: false` (not eligible, or
  // a degraded/failed read) always falls back to the exact legacy shape -
  // no partial persistent prompt, never fail-closed (task brief Section H).
  const persistentSessionCognition = await resolvePersistentSessionCognitionContext({
    enabled: input.persistentSessionCognitionEnabled === true,
    conversationId: event.conversationId,
    inboundMessageId,
    additionalInboundMessageIds: input.additionalInboundMessageIds,
    store: input.sessionStore
  });
  if (persistentSessionCognition.fallbackWarning) preLoopWarnings.push(persistentSessionCognition.fallbackWarning);

  // SALES-AGENT-R3-V1.8.1b (Objetivo C). Purely descriptive, derived fresh
  // this turn from whichever history source is actually active - never a
  // second read, never persisted. See conversationContinuity.ts's own header
  // for why no special compaction case is needed.
  const conversationContinuity = persistentSessionCognition.active
    ? deriveConversationContinuityFromHistoricalMessages(persistentSessionCognition.historicalMessages)
    : deriveConversationContinuityFromLegacyContext(input.commercialContextSummary ?? {});

  // D6 Section P observability - every turn where cognition is eligible
  // (the normal case since D6's default-true flag), never when the global
  // rollback flag is off.
  if (input.persistentSessionCognitionEnabled === true && inboundMessageId) {
    const diagnosticResult = await recordPersistentSessionCognitionAppliedDiagnostic({
      conversationId: event.conversationId,
      inboundMessageId,
      correlationId: event.correlationId,
      active: persistentSessionCognition.active,
      fallbackReason: persistentSessionCognition.active ? null : persistentSessionCognition.fallbackWarning,
      historyMessageCount: persistentSessionCognition.active ? persistentSessionCognition.historicalMessages.length : 0
    });
    if (!diagnosticResult.ok) preLoopWarnings.push(diagnosticResult.warning);
  }

  const loopInput: RunAgentToolLoopInput = {
    correlationId: event.correlationId,
    conversationId: event.conversationId,
    opportunityId: input.opportunityId,
    currentTime: event.currentTime,
    customerMessage: event.messageText,
    inboundMessageId,
    // Task brief Section B: never send both persistent history and legacy
    // recentMessages for the same turn - stripped only when the persistent
    // path is actually active this turn.
    commercialContextSummary: persistentSessionCognition.active
      ? stripRecentMessagesForPersistentSessionContext(input.commercialContextSummary ?? {})
      : (input.commercialContextSummary ?? {}),
    recentCatalogContext: input.recentCatalogContext ?? null,
    pendingCatalogAction: input.pendingCatalogAction ?? null,
    provider: input.provider,
    trustedCustomerSession: input.trustedCustomerSession,
    abortSignal: input.abortSignal,
    identityConfiguration: input.identityConfiguration,
    maxDecisions: input.maxDecisions,
    maxToolExecutions: input.maxToolExecutions,
    timeoutMs: input.timeoutMs,
    ensureOpportunity,
    persistentSessionHistoricalMessages: persistentSessionCognition.active ? persistentSessionCognition.historicalMessages : null,
    conversationContinuity,
    liveTurnAssimilationEnabled: input.liveTurnAssimilationEnabled,
    refreshCommercialContextSummary: input.refreshCommercialContextSummary
  };

  // SALES-AGENT-R3-V1.8-D2. Durable BEFORE cognition starts - see
  // recordUserMessageReceivedEvent's own comment. Skipped, not faked, when
  // no real inboundMessageId exists (same condition the post-loop shadow
  // write below already used for this reason).
  if (inboundMessageId) {
    const userMessageResult = await recordUserMessageReceivedEvent({
      conversationId: event.conversationId,
      inboundMessageId,
      correlationId: event.correlationId,
      store: input.sessionStore
    });
    if (!userMessageResult.ok) preLoopWarnings.push(`agent_session_user_message_event_write_failed:${userMessageResult.warning}`);
  } else {
    preLoopWarnings.push("agent_session_user_message_skipped_no_inbound_message_id");
  }

  // SALES-AGENT-R3-V1.8-D4. Shadow-only, after loopInput is already fully
  // built and closed over above - this call can only ever push a warning
  // onto preLoopWarnings, never touch loopInput itself. See
  // runPersistentSessionShadow.ts's own header comment for the full
  // failure-isolation contract this depends on.
  if (input.persistentSessionShadowEnabled && inboundMessageId) {
    const shadowResult = await runPersistentSessionShadowComparison({
      conversationId: event.conversationId,
      inboundMessageId,
      correlationId: event.correlationId,
      legacyRecentMessages: extractLegacyRecentMessagesForShadow(input.commercialContextSummary ?? {}),
      store: input.sessionStore
    });
    if (shadowResult.warning) preLoopWarnings.push(shadowResult.warning);
  }

  const loop: AgentLoopResult = await runAgentToolLoop(loopInput);
  const durationMs = Date.now() - startedAt;

  let toolCalls = 0;
  let readToolCalls = 0;
  let commercialActionCalls = 0;
  for (const record of loop.steps) {
    if (record.step.type !== "use_tool") continue;
    toolCalls += 1;
    const exposure = resolveAgentCapabilityExposure(record.step.tool);
    if (exposure === "READ_TOOL") readToolCalls += 1;
    else if (exposure === "COMMERCIAL_ACTION") commercialActionCalls += 1;
  }

  // LLM-R1-T02's own per-call token accounting, rolled up here the same way
  // buildLlmMetrics does - null (never a fabricated 0) whenever no call this
  // turn reported a usable value.
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  for (const call of loop.llmCalls) {
    if (call.inputTokens !== null) inputTokens = (inputTokens ?? 0) + call.inputTokens;
    if (call.outputTokens !== null) outputTokens = (outputTokens ?? 0) + call.outputTokens;
  }

  // Phase 8 session integration: reuses A01's own shadow mechanism verbatim
  // (never a second event-recording path) for the turn-level
  // USER_MESSAGE_RECEIVED/tool-summary/ASSISTANT_MESSAGE_SENT events. Every
  // individual tool/action request+result is already recorded independently,
  // for free, inside executeReadTool/executeCommercialActionRequest (called
  // by ATL itself) - this call only adds the turn-level envelope. Skipped,
  // not faked, when no real inboundMessageId exists to correlate against.
  const warnings = [...preLoopWarnings, ...loop.warnings];
  if (inboundMessageId) {
    const shadowResult = await recordAgentToolLoopToolActivityEvents({
      conversationId: event.conversationId,
      inboundMessageId,
      correlationId: event.correlationId,
      stepsSummary: buildStepsSummary(loop.steps),
      store: input.sessionStore
    });
    if (!shadowResult.ok) warnings.push(`agent_session_shadow_event_write_failed:${shadowResult.warning}`);
  } else {
    warnings.push("agent_session_shadow_skipped_no_inbound_message_id");
  }

  const status = TERMINAL_REASON_TO_STATUS[loop.terminalReason];
  const reason =
    status === "responded"
      ? null
      : loop.terminalReason === "handoff"
        ? loop.handoffReason
        : (loop.providerFailure?.normalizedReason ?? loop.terminalReason);

  return {
    status,
    responseText: status === "responded" ? loop.finalMessage : null,
    reason,
    modelSteps: loop.steps.length,
    toolCalls,
    readToolCalls,
    commercialActionCalls,
    resolvedOpportunityId,
    finalPendingCatalogAction: loop.finalPendingCatalogAction ?? null,
    durationMs,
    inputTokens,
    outputTokens,
    warnings,
    finalAssimilatedInboundMessageId: loop.finalAssimilatedInboundMessageId ?? null,
    assimilatedInboundMessageIds: loop.assimilatedInboundMessageIds ?? [],
    assimilationCycleCount: loop.assimilationCycleCount ?? 0,
    invalidatedCandidateCount: loop.invalidatedCandidateCount ?? 0
  };
}
