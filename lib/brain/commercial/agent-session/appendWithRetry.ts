// SALES-AGENT-R3-V1.8-D2. RETRY_THEN_DEGRADE for AgentSessionStore.appendEvent
// (V1.8-D0's own selected failure semantics, section 12). Every D2 call site
// that appends a session event pre-loop (USER_MESSAGE_RECEIVED) or
// post-dispatch (ASSISTANT_MESSAGE_SENT) goes through this one small helper
// instead of duplicating a retry loop three times. Not a general retry
// framework: one bounded retry, one fixed delay, nothing configurable beyond
// that - matching this codebase's own existing small retry precedents
// (agent-loop/providers/httpAgentLoopProvider.ts's RETRY_BASE_DELAY_MS,
// work/sequencing.ts's `25 * attempt` backoff), never a new abstraction.

import type { AgentSessionEvent, AppendEventInput } from "./types";
import type { AgentSessionStore } from "./store";

/** Small and fixed - this guards a single DB round-trip, not a network call with its own backoff curve. */
export const AGENT_SESSION_APPEND_RETRY_DELAY_MS = 50;

/**
 * Layer-1/layer-2 sanitizer rejections (agent-session/sanitizer.ts) always
 * throw AgentSessionForbiddenPayloadError, whose message is always prefixed
 * `agent_session_forbidden_payload:` (sanitizer.ts:30) - the one stable,
 * already-existing signal this helper needs to tell "the payload itself is
 * invalid, retrying changes nothing" apart from "the store had a transient
 * problem, retrying might help." No change to AppendEventResult's type was
 * needed to make this distinction (V1.8-D0/V1.8-D1's own instruction: only
 * extend the result contract if it genuinely cannot distinguish the two).
 */
function isInvalidPayloadWarning(warning: string): boolean {
  return warning.startsWith("agent_session_forbidden_payload:");
}

export type AppendAgentSessionEventWithRetryResult =
  | { status: "created"; event: AgentSessionEvent }
  | { status: "duplicate"; event: AgentSessionEvent }
  /** Both attempts failed with a transient/store-level error - the caller must warn and continue the turn, never fail closed (V1.8-D0 section 12). */
  | { status: "degraded"; warning: string }
  /** The payload itself was rejected (sanitizer/programmer-contract failure) - never retried, since a second identical attempt would fail identically. */
  | { status: "invalid"; warning: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One append attempt, one short bounded retry on a transient failure, then
 * degrade. Never throws - every outcome is a typed result the caller
 * branches on, mirroring every other governed-skip/failure contract in this
 * codebase (dispatchGovernedSalesAgentMessage.ts, etc.).
 */
export async function appendAgentSessionEventWithRetry(
  store: AgentSessionStore,
  input: AppendEventInput
): Promise<AppendAgentSessionEventWithRetryResult> {
  const first = await store.appendEvent(input);
  if (first.ok) return { status: first.status, event: first.event };
  if (isInvalidPayloadWarning(first.warning)) return { status: "invalid", warning: first.warning };

  await sleep(AGENT_SESSION_APPEND_RETRY_DELAY_MS);

  const second = await store.appendEvent(input);
  if (second.ok) return { status: second.status, event: second.event };
  if (isInvalidPayloadWarning(second.warning)) return { status: "invalid", warning: second.warning };

  return { status: "degraded", warning: second.warning };
}
