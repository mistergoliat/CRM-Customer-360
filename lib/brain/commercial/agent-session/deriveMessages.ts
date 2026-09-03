// SALES-AGENT-R3-V1.8-D3. Pure, deterministic derive-on-read projection over
// already-loaded session ingredients (loadPersistentSessionContext.ts's own
// output). No I/O anywhere in this file - no provider, no Capability
// Gateway, no commercial service, no Meta, no outbox (Section I of the task
// brief). Deliberately NOT wired into the real provider request path yet
// (buildAgentStepPromptPackage.ts is untouched) - see the D3 release doc's
// "shadow-only" verdict.
//
// Selected transcript/session merge strategy (Section B, confirmed against
// real code, not assumed): conversation_message is the sole canonical human
// transcript (inbound -> "user", outbound -> "assistant"); agent_session_events
// supplies only tool/activity evidence, correlated by occurredAt/seq, never a
// second copy of message text. The two are never merged into one array -
// deriveConversationMessages() (conversational history) and
// deriveToolActivityObservations() (structured, non-message context data,
// Section L) stay separate outputs of deriveMessages().

import type { AgentLoopProviderMessage } from "../agent-loop/agentLoopProviderTypes";
import type { AgentSessionEvent, AgentSessionEventType, AgentSessionToolActivity } from "./types";
import type { ConversationTranscriptMessage } from "./conversationTranscriptReader";
import { parseCompactedSessionPrefixContent, resolveValidCompactionCutoff } from "./compactedSessionPrefixContent";

/**
 * agent_sessions.compacted_prefix_json/compacted_through_seq (migration 034)
 * once both are structurally valid - see loadPersistentSessionContext.ts's
 * own extractCompactedPrefix for the validation this type assumes already
 * happened. D7 owns the real writer; D3 only reads and projects.
 */
export type PersistentSessionCompactedPrefix = {
  throughSeq: number;
  prefixJson: Record<string, unknown>;
};

export type DeriveConversationMessagesInput = {
  transcriptMessages: readonly ConversationTranscriptMessage[];
  compactedPrefix: PersistentSessionCompactedPrefix | null;
  /**
   * conversation_message.id (numeric, as string) of the message this turn is
   * already processing. The bounded transcript window already contains it
   * (it was persisted by processNativeWhatsAppInbound before R3 ever runs) -
   * without this, it would be emitted twice: once as history, once again as
   * the current turn's own input (Section K - the exact structural defect
   * V1.8-A found). null is a legitimate value (no real inboundMessageId this
   * turn) and excludes nothing.
   */
  currentInboundMessageId: string | null;
  /**
   * SALES-AGENT-R3-V1.8.1 (turn settling). Extra conversation_message ids
   * belonging to the SAME current turn as currentInboundMessageId - set only
   * when the inbound turn-settlement worker aggregated more than one raw
   * WhatsApp fragment into this turn. Excluded from history for exactly the
   * same reason currentInboundMessageId is: each one's text is already
   * folded into the current turn's own joined customerMessage, so leaving
   * it in the transcript window would emit it twice. null/undefined/empty
   * excludes nothing - zero behavior change for every caller that never
   * settles more than one fragment per turn (the delay=0 rollback path).
   */
  additionalExcludedMessageIds?: readonly string[] | null;
};

const HUMAN_TRANSCRIPT_DIRECTIONS = new Set(["inbound", "outbound"]);

function buildCompactedPrefixMessage(throughMessageId: number, summaryText: string): AgentLoopProviderMessage {
  return {
    role: "system",
    content: `[Compacted session history through message #${throughMessageId}] ${summaryText}`
  };
}

/**
 * Shared by deriveConversationMessages below and runSessionCompaction.ts (the
 * D7 writer) so both agree on exactly one inbound/outbound -> role/content
 * mapping. Never a direction other than inbound/outbound (conversation
 * control's own "system" timeline rows, lib/domains/conversations/control.ts,
 * are operational markers, not conversational turns) and never an empty body
 * (a system row with no text, or a legacy row with body=NULL).
 */
export function transcriptRowToProviderMessage(row: ConversationTranscriptMessage): AgentLoopProviderMessage | null {
  if (!HUMAN_TRANSCRIPT_DIRECTIONS.has(row.direction)) return null;
  if (!row.body || !row.body.trim()) return null;
  return { role: row.direction === "inbound" ? "user" : "assistant", content: row.body };
}

/**
 * "Historical slots only" (Section J) - the compacted prefix (if any)
 * followed by the bounded, ordered human transcript.
 *
 * D7: a valid compacted prefix (Section M, no-overlap/no-gap) also excludes
 * every transcript row already covered by it (row.id <= throughSeq) - never
 * applied when the stored content fails to parse (resolveValidCompactionCutoff
 * returns null), so a malformed prefix degrades to "no compaction" rather
 * than silently dropping history with nothing compensating it.
 */
export function deriveConversationMessages(input: DeriveConversationMessagesInput): AgentLoopProviderMessage[] {
  const messages: AgentLoopProviderMessage[] = [];
  const throughMessageId = resolveValidCompactionCutoff(input.compactedPrefix);
  if (throughMessageId !== null) {
    const content = parseCompactedSessionPrefixContent(input.compactedPrefix!.prefixJson)!;
    messages.push(buildCompactedPrefixMessage(throughMessageId, content.summaryText));
  }

  for (const row of input.transcriptMessages) {
    if (input.currentInboundMessageId !== null && row.id === input.currentInboundMessageId) continue;
    if (input.additionalExcludedMessageIds && input.additionalExcludedMessageIds.includes(row.id)) continue;
    if (throughMessageId !== null && Number(row.id) <= throughMessageId) continue;
    const mapped = transcriptRowToProviderMessage(row);
    if (mapped) messages.push(mapped);
  }
  return messages;
}

type ToolActivityClassification = { kind: AgentSessionToolActivity["kind"]; outcome: AgentSessionToolActivity["outcome"] };

/** Mirrors shadowRecorder.ts's own governance mapping (eventTypesForOutcome) - never a second, divergent classification of the same event types. */
const TOOL_ACTIVITY_EVENT_CLASSIFICATION: Partial<Record<AgentSessionEventType, ToolActivityClassification>> = {
  READ_TOOL_REQUESTED: { kind: "read", outcome: "requested" },
  READ_TOOL_COMPLETED: { kind: "read", outcome: "completed" },
  READ_TOOL_FAILED: { kind: "read", outcome: "failed" },
  COMMERCIAL_ACTION_REQUESTED: { kind: "action", outcome: "requested" },
  COMMERCIAL_ACTION_ACCEPTED: { kind: "action", outcome: "completed" },
  COMMERCIAL_ACTION_REJECTED: { kind: "action", outcome: "rejected" },
  COMMERCIAL_ACTION_COMPLETED: { kind: "action", outcome: "completed" },
  COMMERCIAL_ACTION_FAILED: { kind: "action", outcome: "failed" }
};

/**
 * Section L: reduced, structured tool-activity context only - never raw tool
 * result data, and never forced into a fake assistant/user message (the
 * provider contract's roles are for real conversational turns). Kept as a
 * separate array, not mixed into deriveConversationMessages' output -
 * exactly how it gets projected into the real prompt is a D4/D5 decision,
 * not this task's.
 *
 * Events at or before compactedPrefix.throughSeq are already summarized
 * there (Section Q) and are excluded here so they are never represented
 * twice.
 */
export function deriveToolActivityObservations(
  events: readonly AgentSessionEvent[],
  compactedPrefix: PersistentSessionCompactedPrefix | null
): AgentSessionToolActivity[] {
  const throughSeq = compactedPrefix?.throughSeq ?? null;
  const observations: AgentSessionToolActivity[] = [];
  for (const event of events) {
    if (throughSeq !== null && event.seq <= throughSeq) continue;
    const classification = TOOL_ACTIVITY_EVENT_CLASSIFICATION[event.eventType];
    if (!classification) continue;
    const tool = typeof event.payload.tool === "string" && event.payload.tool.trim() ? event.payload.tool.trim() : "unknown";
    observations.push({ tool, kind: classification.kind, outcome: classification.outcome, occurredAt: event.occurredAt });
  }
  return observations;
}

export type DeriveMessagesInput = DeriveConversationMessagesInput & {
  events: readonly AgentSessionEvent[];
};

export type DeriveMessagesResult = {
  historicalMessages: AgentLoopProviderMessage[];
  toolActivityObservations: AgentSessionToolActivity[];
};

/**
 * The one public entry point this task's brief names directly (Section
 * C/I/N/O). Composes the two slots above and nothing else - no system
 * instructions, no identity/config, no fresh authoritative context, no
 * current user message (Section J: those stay buildAgentStepPromptPackage.ts's
 * job, or a future assembleAgentProviderMessages()'s, never duplicated here).
 */
export function deriveMessages(input: DeriveMessagesInput): DeriveMessagesResult {
  return {
    historicalMessages: deriveConversationMessages(input),
    toolActivityObservations: deriveToolActivityObservations(input.events, input.compactedPrefix)
  };
}
