// SALES-AGENT-R3-A01. Public barrel for the AgentSessionStore module.

export type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionEventType,
  AgentSessionStatus,
  AgentSessionSummary,
  AgentSessionToolActivity,
  AgentSessionToolActivityKind,
  AppendEventInput,
  AppendEventResult,
  EnsureSessionInput,
  LoadRecentEventsInput
} from "./types";
export { AGENT_SESSION_CONTRACT_NAME, AGENT_SESSION_EVENT_TYPES, AGENT_SESSION_SCHEMA_VERSION } from "./types";

export type { AgentSessionStore } from "./store";
export {
  AGENT_SESSION_DEFAULT_MAX_AGE_MS,
  AGENT_SESSION_DEFAULT_MAX_RECENT_EVENTS,
  AGENT_SESSION_HARD_MAX_RECENT_EVENTS
} from "./store";

export { AgentSessionForbiddenPayloadError, sanitizeAgentSessionPayload } from "./sanitizer";
export { projectAgentSessionSummary, SUMMARY_MAX_RECENT_TOOL_ACTIVITY } from "./summary";
export {
  buildAgentSessionEventId,
  buildAgentSessionId,
  buildAssistantMessageDedupeKey,
  buildToolEventDedupeKey,
  buildUserMessageDedupeKey
} from "./dedupe";

export { createMariaDbAgentSessionStore } from "./mariaDbAgentSessionStore";
export { createInMemoryAgentSessionBacking, createInMemoryAgentSessionStore, type InMemoryAgentSessionBacking } from "./inMemoryAgentSessionStore";

export {
  recordAgentToolLoopSessionShadowEvents,
  resetAgentSessionShadowStoreForTests,
  type RecordAgentToolLoopSessionShadowInput,
  type RecordAgentToolLoopSessionShadowResult
} from "./shadowRecorder";

export {
  loadRecentConversationTranscript,
  AGENT_SESSION_DEFAULT_MAX_TRANSCRIPT_MESSAGES,
  AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES,
  type ConversationTranscriptMessage
} from "./conversationTranscriptReader";

export {
  deriveMessages,
  deriveConversationMessages,
  deriveToolActivityObservations,
  type PersistentSessionCompactedPrefix,
  type DeriveConversationMessagesInput,
  type DeriveMessagesInput,
  type DeriveMessagesResult
} from "./deriveMessages";

export {
  loadPersistentSessionContext,
  type LoadPersistentSessionContextInput,
  type LoadPersistentSessionContextResult,
  type LoadPersistentSessionContextSuccess,
  type LoadPersistentSessionContextFailure
} from "./loadPersistentSessionContext";
