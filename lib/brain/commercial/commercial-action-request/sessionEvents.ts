import { buildCommercialActionRequestDedupeKey } from "../agent-session/dedupe";
import { createMariaDbAgentSessionStore } from "../agent-session/mariaDbAgentSessionStore";
import type { AgentSessionStore } from "../agent-session/store";
import type { AgentSessionEventType } from "../agent-session/types";
import type { CapabilityGatewayResult } from "../capability-gateway/types";
import type { CommercialActionRequest, CommercialActionResultStatus } from "./types";

// SALES-AGENT-R3-A03, Phase 8. Integrates with R3-A01's AgentSessionStore -
// shadow/additive only, exactly like agent-session/shadowRecorder.ts: a
// session-recording failure never blocks or fails a real commercial action
// request. The session OBSERVES outcomes; it never becomes business truth
// (no product/price/stock/selection is stored here - only that a request of
// a given actionType happened and what outcome it reached).

let defaultStore: AgentSessionStore | null = null;
function getDefaultStore(): AgentSessionStore {
  if (!defaultStore) defaultStore = createMariaDbAgentSessionStore();
  return defaultStore;
}

/** Test-only: force the module to re-create its default store (e.g. after resetPoolForTests()). */
export function resetCommercialActionRequestSessionStoreForTests() {
  defaultStore = null;
}

async function appendCommercialActionEvent(
  store: AgentSessionStore | undefined,
  request: CommercialActionRequest,
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
      dedupeKey: buildCommercialActionRequestDedupeKey(session.id, request.requestId, eventType),
      payload
    });
  } catch {
    // Shadow/additive only - never blocks or fails the real request.
  }
}

export async function recordCommercialActionRequested(request: CommercialActionRequest, store?: AgentSessionStore): Promise<void> {
  await appendCommercialActionEvent(store, request, "COMMERCIAL_ACTION_REQUESTED", { actionType: request.actionType, opportunityId: request.opportunityId });
}

export async function recordCommercialActionAccepted(request: CommercialActionRequest, capability: string, store?: AgentSessionStore): Promise<void> {
  await appendCommercialActionEvent(store, request, "COMMERCIAL_ACTION_ACCEPTED", { actionType: request.actionType, capability });
}

export async function recordCommercialActionRejected(request: CommercialActionRequest, capability: string | null, reason: string, store?: AgentSessionStore): Promise<void> {
  await appendCommercialActionEvent(store, request, "COMMERCIAL_ACTION_REJECTED", { actionType: request.actionType, capability, reason });
}

export async function recordCommercialActionTerminal(
  request: CommercialActionRequest,
  capability: string,
  status: CommercialActionResultStatus,
  gatewayResult: CapabilityGatewayResult,
  store?: AgentSessionStore
): Promise<void> {
  // Phase 8's event vocabulary only distinguishes COMPLETED/FAILED at the
  // execution-complete stage (AGENT_SESSION_EVENT_TYPES has no third option
  // here) - every non-COMPLETED outcome that reached real execution
  // (RETRYABLE/BLOCKED/REQUIRES_CUSTOMER_INPUT/REQUIRES_REVIEW/a late DENIED)
  // is still an execution that did not complete successfully, so it maps to
  // FAILED, never a fabricated COMPLETED.
  const eventType: AgentSessionEventType = status === "COMPLETED" ? "COMMERCIAL_ACTION_COMPLETED" : "COMMERCIAL_ACTION_FAILED";
  await appendCommercialActionEvent(store, request, eventType, {
    actionType: request.actionType,
    capability,
    resultStatus: status,
    gatewayStatus: gatewayResult.status,
    stableErrorCode: gatewayResult.errorCode,
    retryable: gatewayResult.retryable
  });
}
