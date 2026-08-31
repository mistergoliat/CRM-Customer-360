import { buildReadToolRequestDedupeKey } from "../agent-session/dedupe";
import { createMariaDbAgentSessionStore } from "../agent-session/mariaDbAgentSessionStore";
import type { AgentSessionStore } from "../agent-session/store";
import type { AgentSessionEventType } from "../agent-session/types";
import type { ReadToolRequest, ReadToolResultStatus } from "./types";

// SALES-AGENT-R3-A04, Phase 13. Mirrors commercial-action-request/sessionEvents.ts
// exactly: shadow/additive only - a session-recording failure never blocks or
// fails a real read. Emits R3-A01's own reserved READ_TOOL_REQUESTED/
// READ_TOOL_COMPLETED/READ_TOOL_FAILED vocabulary (agent-session/types.ts),
// live for the first time. The session observes that a read happened; it
// never stores the read's own data (no product/price/stock payload here -
// only tool name/status/errorCode, same discipline as the COMMERCIAL_ACTION_*
// events).

let defaultStore: AgentSessionStore | null = null;
function getDefaultStore(): AgentSessionStore {
  if (!defaultStore) defaultStore = createMariaDbAgentSessionStore();
  return defaultStore;
}

/** Test-only: force the module to re-create its default store (e.g. after resetPoolForTests()). */
export function resetReadToolRequestSessionStoreForTests() {
  defaultStore = null;
}

async function appendReadToolEvent(
  store: AgentSessionStore | undefined,
  request: ReadToolRequest,
  eventType: AgentSessionEventType,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const effectiveStore = store ?? getDefaultStore();
    const session = await effectiveStore.ensureSession({ conversationId: request.conversationId });
    await effectiveStore.appendEvent({
      sessionId: session.id,
      conversationId: request.conversationId,
      eventType,
      correlationId: request.correlationId,
      causationId: request.causationId,
      dedupeKey: buildReadToolRequestDedupeKey(session.id, request.requestId, eventType),
      payload
    });
  } catch {
    // Shadow/additive only - never blocks or fails the real read.
  }
}

export async function recordReadToolRequested(request: ReadToolRequest, store?: AgentSessionStore): Promise<void> {
  await appendReadToolEvent(store, request, "READ_TOOL_REQUESTED", { tool: request.tool, opportunityId: request.opportunityId });
}

export async function recordReadToolCompleted(request: ReadToolRequest, status: ReadToolResultStatus, errorCode: string | null, store?: AgentSessionStore): Promise<void> {
  const eventType: AgentSessionEventType = status === "COMPLETED" ? "READ_TOOL_COMPLETED" : "READ_TOOL_FAILED";
  await appendReadToolEvent(store, request, eventType, { tool: request.tool, resultStatus: status, stableErrorCode: errorCode });
}
