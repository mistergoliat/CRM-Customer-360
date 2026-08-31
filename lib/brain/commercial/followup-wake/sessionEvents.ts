// SALES-AGENT-R3-A05. Records a fired follow-up wake into AgentSessionStore -
// shadow/additive only, exactly like agent-session/shadowRecorder.ts and
// commercial-action-request/sessionEvents.ts: a session-recording failure
// never blocks or fails the real follow-up tick. The session OBSERVES that
// the system woke up and what it decided; crm_agent_actions remains the sole
// authoritative store for the follow-up's own lifecycle (status, attempts,
// cancel/failure reason) - this module never writes there.

import { buildFollowUpWakeDedupeKey } from "../agent-session/dedupe";
import { createMariaDbAgentSessionStore } from "../agent-session/mariaDbAgentSessionStore";
import type { AgentSessionStore } from "../agent-session/store";
import type { FollowUpWakeDisposition, FollowUpWakeEvent } from "./types";

let defaultStore: AgentSessionStore | null = null;
function getDefaultStore(): AgentSessionStore {
  if (!defaultStore) defaultStore = createMariaDbAgentSessionStore();
  return defaultStore;
}

/** Test-only: force the module to re-create its default store (e.g. after resetPoolForTests()). */
export function resetFollowUpWakeSessionStoreForTests() {
  defaultStore = null;
}

/**
 * One FOLLOWUP_WAKE event per (session, wakeId) - the payload carries the
 * final disposition, never a separate "fired" event followed by a second
 * "outcome" event: AppendEventInput has no update, and a wake's own
 * dedupeKey is keyed on (actionPublicId, attempt), so recording once with
 * the fully-resolved disposition is both simpler and correct (mirrors
 * ASSISTANT_MESSAGE_SENT's own `outcome` field, agent-session/
 * shadowRecorder.ts).
 *
 * Payload is deliberately structural only - action id, opportunity id, wake
 * reason, attempt, timestamps, disposition status/reason. Never customer
 * text, never a raw prompt, never PII. wa_id/phone/email are never read by
 * this module at all, so there is nothing to leak.
 */
export async function recordFollowUpWake(
  event: FollowUpWakeEvent,
  disposition: FollowUpWakeDisposition,
  store?: AgentSessionStore
): Promise<{ ok: true } | { ok: false; warning: string }> {
  try {
    const effectiveStore = store ?? getDefaultStore();
    const session = await effectiveStore.ensureSession({ conversationId: event.conversationId });
    const result = await effectiveStore.appendEvent({
      sessionId: session.id,
      conversationId: event.conversationId,
      eventType: "FOLLOWUP_WAKE",
      correlationId: event.correlationId,
      causationId: event.causationId,
      dedupeKey: buildFollowUpWakeDedupeKey(session.id, event.wakeId, "FOLLOWUP_WAKE"),
      occurredAt: event.firedAt,
      payload: {
        actionPublicId: event.actionPublicId,
        opportunityId: event.opportunityId,
        attempt: event.attempt,
        wakeReason: event.reason,
        scheduledFor: event.scheduledFor,
        firedAt: event.firedAt,
        disposition: disposition.status,
        ...("reason" in disposition ? { dispositionReason: disposition.reason } : {}),
        ...("scheduledFor" in disposition ? { rescheduledFor: disposition.scheduledFor } : {})
      }
    });
    if (!result.ok) return { ok: false, warning: result.warning };
    return { ok: true };
  } catch (error) {
    return { ok: false, warning: error instanceof Error ? error.message : String(error) };
  }
}
