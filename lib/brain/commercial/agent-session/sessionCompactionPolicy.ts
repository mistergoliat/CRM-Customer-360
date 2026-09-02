// SALES-AGENT-R3-V1.8-D7. Pure decision logic for session compaction - no
// I/O anywhere in this file (mirrors deriveMessages.ts's own "pure,
// deterministic" discipline). Two independent decisions, deliberately kept
// separate: shouldTriggerSessionCompaction (should we compact at all this
// turn) and splitForCompaction (given a raw, ordered window, which messages
// move into the compacted range vs. stay as the recent raw tail).

/** Task brief Section D: "raw historical message count exceeds threshold." One condition, no arbitrary second heuristic. */
export function shouldTriggerSessionCompaction(uncompactedMessageCount: number, maxRawMessages: number): boolean {
  return uncompactedMessageCount > maxRawMessages;
}

export type SessionCompactionSplit<T> = {
  /** Oldest-first, the messages this compaction round should fold into the summary. Empty when there is nothing beyond the recent tail. */
  toCompact: T[];
  /** The messages that remain provider-native raw history after this round. */
  recentTail: T[];
};

/**
 * `messages` must already be ordered ascending (oldest first) - the same
 * order loadRecentConversationTranscript already returns. Keeps the last
 * `targetRecentMessages` as the raw tail; everything older is a candidate
 * for compaction (task brief Section E's own worked example).
 */
export function splitForCompaction<T>(messages: readonly T[], targetRecentMessages: number): SessionCompactionSplit<T> {
  if (messages.length <= targetRecentMessages) {
    return { toCompact: [], recentTail: [...messages] };
  }
  const splitIndex = messages.length - targetRecentMessages;
  return { toCompact: messages.slice(0, splitIndex), recentTail: messages.slice(splitIndex) };
}

/**
 * Safety ceiling so a misconfigured BRAIN_R3_SESSION_COMPACTION_MAX_RAW_MESSAGES
 * can never exceed AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES
 * (conversationTranscriptReader.ts) closely enough to reopen the no-gap
 * invariant loadPersistentSessionContext.ts relies on (it widens its own
 * read window to that same hard cap once a compacted prefix exists - see
 * that file's own comment). Leaves headroom for one turn's worth of
 * overshoot between compaction runs.
 */
export const SESSION_COMPACTION_MAX_RAW_MESSAGES_CEILING = 80;

export const SESSION_COMPACTION_DEFAULT_MAX_RAW_MESSAGES = 40;
export const SESSION_COMPACTION_DEFAULT_TARGET_RECENT_MESSAGES = 20;
