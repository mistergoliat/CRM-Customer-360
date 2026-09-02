// SALES-AGENT-R3-V1.8-D7. The real shape of agent_sessions.compacted_prefix_json
// (migration 034, D1) - D1/D3 deliberately left this a free-form
// Record<string, unknown> and only validated its outer structural shape
// (object vs. not); D7 is the first real writer, so this module defines and
// owns the actual content contract. Shared by the reader (deriveMessages.ts)
// and the writer (runSessionCompaction.ts) so both agree on one shape.
//
// Domain note (D7 finding, not a schema change): agent_sessions.compacted_through_seq
// (migration 034) was speculatively documented at D1 as an agent_session_events.seq
// boundary (see types.ts's own AgentSessionCompactedPayload comment) - written
// before D3 confirmed conversation_message is the sole canonical transcript
// (agent_session_events supplies tool-activity evidence only). D7 populates
// compactedThroughSeq with a conversation_message.id cutoff instead - the
// actual unit compaction operates on. This is safe, not a redesign: the
// column has never been populated in production, and its other reader
// (deriveToolActivityObservations in deriveMessages.ts) produces output with
// zero real prompt consumer today (confirmed against buildAgentStepPromptPackage.ts) -
// so this domain clarification changes no observable behavior. See that
// function's own comment for the same note from the other side.

export const COMPACTED_SESSION_PREFIX_SCHEMA_VERSION = 1 as const;

export type CompactedSessionPrefixContent = {
  schemaVersion: typeof COMPACTED_SESSION_PREFIX_SCHEMA_VERSION;
  /**
   * Historical conversational evidence only (task brief Section B/G) - what
   * happened, never what to do next. Never currentIntent/nextStep/stage/
   * allowedTools, never chain-of-thought, never a raw tool dump.
   */
  summaryText: string;
};

export function buildCompactedSessionPrefixContent(summaryText: string): CompactedSessionPrefixContent {
  return { schemaVersion: COMPACTED_SESSION_PREFIX_SCHEMA_VERSION, summaryText };
}

/**
 * Structural validation only, mirroring loadPersistentSessionContext.ts's own
 * "warn/degrade, never crash" discipline for the outer compactedThroughSeq/
 * compactedPrefixJson pair. A missing/malformed field here degrades ONLY the
 * compaction slot for the caller - never a thrown exception.
 */
export function parseCompactedSessionPrefixContent(prefixJson: Record<string, unknown>): CompactedSessionPrefixContent | null {
  if (prefixJson.schemaVersion !== COMPACTED_SESSION_PREFIX_SCHEMA_VERSION) return null;
  if (typeof prefixJson.summaryText !== "string" || !prefixJson.summaryText.trim()) return null;
  return { schemaVersion: COMPACTED_SESSION_PREFIX_SCHEMA_VERSION, summaryText: prefixJson.summaryText };
}

/**
 * The one place both the reader (deriveMessages.ts) and the writer
 * (runSessionCompaction.ts) decide "does a usable compacted prefix exist,
 * and where does it cut off." Returns null whenever there is nothing to
 * exclude/build on - either no compaction ever ran, or its stored content is
 * malformed (Section T's "malformed existing compacted metadata" case) - so
 * a caller never filters transcript rows against a cutoff it could not also
 * render a summary for (that would silently drop history with nothing
 * compensating it).
 */
export function resolveValidCompactionCutoff(
  compactedPrefix: { throughSeq: number; prefixJson: Record<string, unknown> } | null
): number | null {
  if (!compactedPrefix) return null;
  const content = parseCompactedSessionPrefixContent(compactedPrefix.prefixJson);
  return content ? compactedPrefix.throughSeq : null;
}
