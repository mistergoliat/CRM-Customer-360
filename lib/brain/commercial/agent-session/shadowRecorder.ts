// SALES-AGENT-R3-A01. Derives AgentSessionStore events from an already-
// completed Agent Tool Loop turn - shadow/additive only (Phase 13 of the
// task brief). Never influences the turn's own model decisions, routing, or
// customer-visible response: every failure here degrades to a warning,
// never a thrown error into the production turn.
//
// SALES-AGENT-R3-V1.8-D2: two exported entry points now, not one -
// recordAgentToolLoopSessionShadowEvents (UNCHANGED contract/behavior,
// USER_MESSAGE_RECEIVED + tool events + ASSISTANT_MESSAGE_SENT, all written
// post-loop) remains exactly as-is for its one real caller,
// runNativeAgentToolLoopCycle.ts (the ATL/legacy runtime - explicitly out of
// this task's scope, never touched). recordAgentToolLoopToolActivityEvents
// is new: tool/activity events only, for salesAgentRuntime.ts (R3-native),
// which now owns USER_MESSAGE_RECEIVED (written pre-loop) and
// ASSISTANT_MESSAGE_SENT (written post-dispatch, in
// runSalesAgentRuntimeCycle.ts) at different, more precise boundaries - see
// docs/releases/SALES-AGENT-R3-V1.8-D2-PERSISTENT-SESSION-WRITE-SIDE-WIRING.md
// Section 2 ("one event, one clear writer"). Both entry points share the
// same internal tool-event-appending logic (appendToolActivityEvents) -
// never two independent implementations of the same governance/dedupe
// mapping.
//
// Content boundary unchanged: neither USER_MESSAGE_RECEIVED nor
// ASSISTANT_MESSAGE_SENT nor any tool event carries message text.
// conversation_message remains the sole canonical timeline (Phase 3 of the
// architecture doc) - this module only records that a turn/tool call
// happened, correlated by inboundMessageId, never a second copy of the
// conversation content.

import type { AgentToolLoopStepSummary, AgentToolLoopTerminalReason } from "../events/types";
import {
  buildAssistantMessageDedupeKey,
  buildToolEventDedupeKey,
  buildUserMessageDedupeKey
} from "./dedupe";
import { getDefaultAgentSessionStore, resetDefaultAgentSessionStoreForTests } from "./defaultStore";
import type { AgentSessionStore } from "./store";
import type { AgentSession, AgentSessionEventType } from "./types";

/**
 * Fixed, backend-owned classification mirroring each capability's own
 * `governance.sideEffect` (capability-gateway/*Capability.ts) - never
 * inferred from the model's tool choice. calculate_shipping is an external
 * call but read_only (no durable write), matching its own governance
 * declaration and the A00 architecture doc's Phase 1 audit table.
 */
const MUTATING_TOOLS = new Set(["set_shipping_destination", "select_products", "select_shipping_option", "create_quote"]);

function eventTypesForOutcome(
  kind: "read" | "action",
  governance: AgentToolLoopStepSummary["governance"],
  observationStatus: AgentToolLoopStepSummary["observationStatus"]
): AgentSessionEventType | null {
  if (governance && governance !== "authorized") {
    return kind === "action" ? "COMMERCIAL_ACTION_REJECTED" : "READ_TOOL_FAILED";
  }
  switch (observationStatus) {
    case "completed":
      return kind === "action" ? "COMMERCIAL_ACTION_COMPLETED" : "READ_TOOL_COMPLETED";
    case "failed":
      return kind === "action" ? "COMMERCIAL_ACTION_FAILED" : "READ_TOOL_FAILED";
    case "blocked":
      return kind === "action" ? "COMMERCIAL_ACTION_REJECTED" : "READ_TOOL_FAILED";
    case "skipped":
    case undefined:
      return null; // Nothing definitive happened yet - only the REQUESTED event is emitted for this step.
  }
}

type AppendToolActivityEventsInput = {
  session: AgentSession;
  conversationId: number;
  inboundMessageId: string;
  correlationId: string;
  stepsSummary: readonly AgentToolLoopStepSummary[];
  store: AgentSessionStore;
};

/**
 * Shared by both exported entry points below - the one real implementation
 * of "turn steps -> READ_TOOL_ / COMMERCIAL_ACTION_ events." Throws on the
 * first append failure; both callers already run inside their own try/catch.
 */
async function appendToolActivityEvents(input: AppendToolActivityEventsInput): Promise<number> {
  let eventsAppended = 0;
  for (const step of input.stepsSummary) {
    if (step.type !== "use_tool" || !step.tool) continue;
    const kind: "read" | "action" = MUTATING_TOOLS.has(step.tool) ? "action" : "read";
    const requestedType: AgentSessionEventType = kind === "action" ? "COMMERCIAL_ACTION_REQUESTED" : "READ_TOOL_REQUESTED";

    const requested = await input.store.appendEvent({
      sessionId: input.session.id,
      conversationId: input.conversationId,
      eventType: requestedType,
      correlationId: input.correlationId,
      dedupeKey: buildToolEventDedupeKey(input.session.id, input.inboundMessageId, step.stepIndex, step.tool, requestedType),
      payload: { tool: step.tool, phase: step.phase }
    });
    if (!requested.ok) throw new Error(requested.warning);
    if (requested.status === "created") eventsAppended += 1;

    const terminalType = eventTypesForOutcome(kind, step.governance, step.observationStatus);
    if (!terminalType) continue;

    const terminal = await input.store.appendEvent({
      sessionId: input.session.id,
      conversationId: input.conversationId,
      eventType: terminalType,
      correlationId: input.correlationId,
      causationId: requested.event?.eventId ?? null,
      dedupeKey: buildToolEventDedupeKey(input.session.id, input.inboundMessageId, step.stepIndex, step.tool, terminalType),
      payload: { tool: step.tool, phase: step.phase, governance: step.governance ?? null, observationStatus: step.observationStatus ?? null }
    });
    if (!terminal.ok) throw new Error(terminal.warning);
    if (terminal.status === "created") eventsAppended += 1;
  }
  return eventsAppended;
}

export type RecordAgentToolLoopSessionShadowInput = {
  conversationId: number;
  inboundMessageId: string;
  correlationId: string;
  terminalReason: AgentToolLoopTerminalReason;
  finalMessagePresent: boolean;
  handoffReasonPresent: boolean;
  stepsSummary: readonly AgentToolLoopStepSummary[];
  /** Test/DI seam - defaults to the real MariaDB-backed store. */
  store?: AgentSessionStore;
};

export type RecordAgentToolLoopSessionShadowResult = { ok: true; eventsAppended: number } | { ok: false; warning: string };

/** Test-only: force the shared default store to be re-created (e.g. after resetPoolForTests()). Delegates to the shared accessor both entry points below now use. */
export function resetAgentSessionShadowStoreForTests() {
  resetDefaultAgentSessionStoreForTests();
}

/**
 * UNCHANGED since SALES-AGENT-R3-A01 - USER_MESSAGE_RECEIVED + tool events +
 * ASSISTANT_MESSAGE_SENT, all written post-loop. The one real caller is
 * runNativeAgentToolLoopCycle.ts (the ATL/legacy runtime) - explicitly out
 * of V1.8-D2's scope (that task only rewires salesAgentRuntime.ts/
 * runSalesAgentRuntimeCycle.ts, the R3-native runtime). Never throws - every
 * failure path returns {ok:false, warning}. Callers still wrap this in their
 * own try/catch as defense in depth.
 */
export async function recordAgentToolLoopSessionShadowEvents(
  input: RecordAgentToolLoopSessionShadowInput
): Promise<RecordAgentToolLoopSessionShadowResult> {
  const store = input.store ?? getDefaultAgentSessionStore();

  try {
    const session = await store.ensureSession({ conversationId: input.conversationId });
    let eventsAppended = 0;

    const userMessageResult = await store.appendEvent({
      sessionId: session.id,
      conversationId: input.conversationId,
      eventType: "USER_MESSAGE_RECEIVED",
      correlationId: input.correlationId,
      dedupeKey: buildUserMessageDedupeKey(session.id, input.inboundMessageId),
      payload: { inboundMessageId: input.inboundMessageId }
    });
    if (userMessageResult.ok && userMessageResult.status === "created") eventsAppended += 1;
    if (!userMessageResult.ok) return { ok: false, warning: userMessageResult.warning };

    eventsAppended += await appendToolActivityEvents({
      session,
      conversationId: input.conversationId,
      inboundMessageId: input.inboundMessageId,
      correlationId: input.correlationId,
      stepsSummary: input.stepsSummary,
      store
    });

    const assistantOutcome = input.finalMessagePresent ? "message" : input.handoffReasonPresent ? "handoff" : "none";
    const assistantResult = await store.appendEvent({
      sessionId: session.id,
      conversationId: input.conversationId,
      eventType: "ASSISTANT_MESSAGE_SENT",
      correlationId: input.correlationId,
      dedupeKey: buildAssistantMessageDedupeKey(session.id, input.inboundMessageId),
      payload: { inboundMessageId: input.inboundMessageId, outcome: assistantOutcome, terminalReason: input.terminalReason }
    });
    if (!assistantResult.ok) return { ok: false, warning: assistantResult.warning };
    if (assistantResult.status === "created") eventsAppended += 1;

    return { ok: true, eventsAppended };
  } catch (error) {
    return { ok: false, warning: error instanceof Error ? error.message : String(error) };
  }
}

export type RecordAgentToolLoopToolActivityEventsInput = {
  conversationId: number;
  inboundMessageId: string;
  correlationId: string;
  stepsSummary: readonly AgentToolLoopStepSummary[];
  /** Test/DI seam - defaults to the real MariaDB-backed store. */
  store?: AgentSessionStore;
};

/**
 * SALES-AGENT-R3-V1.8-D2. Tool/activity events only - no USER_MESSAGE_RECEIVED
 * (salesAgentRuntime.ts now writes that pre-loop) and no ASSISTANT_MESSAGE_SENT
 * (runSalesAgentRuntimeCycle.ts now writes that post-dispatch, the boundary
 * that actually owns the terminal outcome). The R3-native counterpart to
 * recordAgentToolLoopSessionShadowEvents above - never a redesign of tool
 * history itself (same governance mapping, same dedupe keys, same sanitizer).
 */
export async function recordAgentToolLoopToolActivityEvents(
  input: RecordAgentToolLoopToolActivityEventsInput
): Promise<RecordAgentToolLoopSessionShadowResult> {
  const store = input.store ?? getDefaultAgentSessionStore();
  try {
    const session = await store.ensureSession({ conversationId: input.conversationId });
    const eventsAppended = await appendToolActivityEvents({
      session,
      conversationId: input.conversationId,
      inboundMessageId: input.inboundMessageId,
      correlationId: input.correlationId,
      stepsSummary: input.stepsSummary,
      store
    });
    return { ok: true, eventsAppended };
  } catch (error) {
    return { ok: false, warning: error instanceof Error ? error.message : String(error) };
  }
}
