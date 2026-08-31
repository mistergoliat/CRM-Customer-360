// SALES-AGENT-R3-A01. Derives AgentSessionStore events from an already-
// completed Agent Tool Loop turn - shadow/additive only (Phase 13 of the
// task brief). Never influences the turn's own model decisions, routing, or
// customer-visible response: it runs strictly after runAgentToolLoop() and
// dispatchAgentLoopResponse() have already produced their real outcome, and
// every failure here degrades to a warning, never a thrown error into the
// production turn.
//
// Content boundary: neither USER_MESSAGE_RECEIVED nor ASSISTANT_MESSAGE_SENT
// carries message text. conversation_message remains the sole canonical
// timeline (Phase 3 of the architecture doc) - this module only records that
// a turn happened and what tools/actions it touched, correlated by
// inboundMessageId, never a second copy of the conversation content.

import type { AgentToolLoopStepSummary, AgentToolLoopTerminalReason } from "../events/types";
import {
  buildAssistantMessageDedupeKey,
  buildToolEventDedupeKey,
  buildUserMessageDedupeKey
} from "./dedupe";
import { createMariaDbAgentSessionStore } from "./mariaDbAgentSessionStore";
import type { AgentSessionStore } from "./store";
import type { AgentSessionEventType } from "./types";

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

let defaultStore: AgentSessionStore | null = null;
function getDefaultStore(): AgentSessionStore {
  if (!defaultStore) defaultStore = createMariaDbAgentSessionStore();
  return defaultStore;
}

/** Test-only: force the module to re-create its default store (e.g. after resetPoolForTests()). */
export function resetAgentSessionShadowStoreForTests() {
  defaultStore = null;
}

/**
 * Never throws - every failure path returns {ok:false, warning}. Callers
 * (runNativeAgentToolLoopCycle.ts) still wrap this in their own try/catch as
 * defense in depth, matching the exact pattern already used for
 * recordAgentToolLoopCompletedCommercialEvent immediately above it.
 */
export async function recordAgentToolLoopSessionShadowEvents(
  input: RecordAgentToolLoopSessionShadowInput
): Promise<RecordAgentToolLoopSessionShadowResult> {
  const store = input.store ?? getDefaultStore();

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

    for (const step of input.stepsSummary) {
      if (step.type !== "use_tool" || !step.tool) continue;
      const kind: "read" | "action" = MUTATING_TOOLS.has(step.tool) ? "action" : "read";
      const requestedType: AgentSessionEventType = kind === "action" ? "COMMERCIAL_ACTION_REQUESTED" : "READ_TOOL_REQUESTED";

      const requested = await store.appendEvent({
        sessionId: session.id,
        conversationId: input.conversationId,
        eventType: requestedType,
        correlationId: input.correlationId,
        dedupeKey: buildToolEventDedupeKey(session.id, input.inboundMessageId, step.stepIndex, step.tool, requestedType),
        payload: { tool: step.tool, phase: step.phase }
      });
      if (!requested.ok) return { ok: false, warning: requested.warning };
      if (requested.status === "created") eventsAppended += 1;

      const terminalType = eventTypesForOutcome(kind, step.governance, step.observationStatus);
      if (!terminalType) continue;

      const terminal = await store.appendEvent({
        sessionId: session.id,
        conversationId: input.conversationId,
        eventType: terminalType,
        correlationId: input.correlationId,
        causationId: requested.event?.eventId ?? null,
        dedupeKey: buildToolEventDedupeKey(session.id, input.inboundMessageId, step.stepIndex, step.tool, terminalType),
        payload: { tool: step.tool, phase: step.phase, governance: step.governance ?? null, observationStatus: step.observationStatus ?? null }
      });
      if (!terminal.ok) return { ok: false, warning: terminal.warning };
      if (terminal.status === "created") eventsAppended += 1;
    }

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
