import { runAgentToolLoop } from "../agent-loop/runAgentToolLoop";
import type { RunAgentToolLoopInput } from "../agent-loop/runAgentToolLoop";
import type { AgentLoopProvider } from "../agent-loop/agentLoopProviderTypes";
import type { AgentLoopResult, AgentLoopStepRecord, AgentLoopTerminalReason, PendingCatalogActionStep } from "../agent-loop/agentStepTypes";
import type { RecentCatalogContext } from "../agent-loop/recentCatalogContext";
import type { AgentRuntimeEvent } from "../agent-runtime-event/types";
import { resolveAgentCapabilityExposure } from "../agent-capability-exposure/types";
import { ensureCommercialActionOpportunity } from "../commercial-action-request/ensureCommercialActionOpportunity";
import type { EnsureCommercialActionOpportunityInput, EnsureCommercialActionOpportunityResult } from "../commercial-action-request/ensureCommercialActionOpportunity";
import { recordAgentToolLoopSessionShadowEvents } from "../agent-session/shadowRecorder";
import type { AgentSessionStore } from "../agent-session/store";
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
    warnings: []
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
    warnings: []
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

  const loopInput: RunAgentToolLoopInput = {
    correlationId: event.correlationId,
    conversationId: event.conversationId,
    opportunityId: input.opportunityId,
    currentTime: event.currentTime,
    customerMessage: event.messageText,
    inboundMessageId,
    commercialContextSummary: input.commercialContextSummary ?? {},
    recentCatalogContext: input.recentCatalogContext ?? null,
    pendingCatalogAction: input.pendingCatalogAction ?? null,
    provider: input.provider,
    trustedCustomerSession: input.trustedCustomerSession,
    abortSignal: input.abortSignal,
    identityConfiguration: input.identityConfiguration,
    maxDecisions: input.maxDecisions,
    maxToolExecutions: input.maxToolExecutions,
    timeoutMs: input.timeoutMs,
    ensureOpportunity
  };

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
  const warnings = [...loop.warnings];
  if (inboundMessageId) {
    const shadowResult = await recordAgentToolLoopSessionShadowEvents({
      conversationId: event.conversationId,
      inboundMessageId,
      correlationId: event.correlationId,
      terminalReason: loop.terminalReason,
      finalMessagePresent: loop.finalMessage !== null,
      handoffReasonPresent: loop.handoffReason !== null,
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
    warnings
  };
}
