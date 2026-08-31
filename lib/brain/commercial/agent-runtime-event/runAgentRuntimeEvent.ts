// SALES-AGENT-R3-A05. The unified, runtime-neutral re-entry seam
// (docs/architecture/SALES-AGENT-R3-A00-target-architecture.md Phase 6
// "R3-A05", Phase 5's illustrative runAgentReentryCycle(event)). A future
// SalesAgentHarness consumes AgentRuntimeEvent directly through a function
// shaped exactly like this one - this task does not build the Harness, only
// the boundary it will call.
//
// This does NOT duplicate either runtime: CUSTOMER_MESSAGE maps 1:1 onto the
// existing, completely unchanged runNativeAutonomousCycle call (no new
// customer-message pipeline); FOLLOWUP_WAKE maps onto the new deterministic
// dispatcher (followup-wake/dispatchDraftedFollowUpMessage.ts). No branch
// ever fabricates the other's input shape.

import {
  dispatchDraftedFollowUpMessage,
  type DispatchDraftedFollowUpMessageResult
} from "../followup-wake/dispatchDraftedFollowUpMessage";
import type { AgentRuntimeEvent } from "./types";

/**
 * native-cycle is imported lazily (inside the CUSTOMER_MESSAGE branch below,
 * both for the type reference here and the real call at runtime), never at
 * module scope: native-cycle's own dependency graph
 * (runNativeAutonomousCycle -> work/runCommercialWorkInboundCycle ->
 * work/followup -> followup/runFollowupTick, the follow-up wake worker
 * itself) would otherwise create a circular import back into this module,
 * since runFollowupTick.ts imports runAgentRuntimeEvent for its
 * FOLLOWUP_WAKE dispatch. Mirrors the exact pattern runFollowupTick.ts
 * already uses for objectiveAwareFollowUp.ts, for the same reason. The
 * `typeof import(...)` form below is type-only - it never emits a runtime
 * import.
 */
type RunNativeAutonomousCycle = typeof import("../native-cycle").runNativeAutonomousCycle;
type NativeAutonomousCycleResult = import("../native-cycle").NativeAutonomousCycleResult;

/**
 * Fields a FOLLOWUP_WAKE dispatch needs that are deliberately NOT part of
 * FollowUpWakeEvent itself (that type stays a pure structural identifier,
 * per Phase 2's own explicit prohibition on fabricated/business content) -
 * the caller (runFollowupTick.ts) already has these from its own claim/
 * revalidation, and supplies them here rather than the seam re-deriving
 * them.
 */
export type FollowUpWakeDispatchContext = {
  waId: string;
  draftMessage: string | null;
  caseStatus: string | null;
  humanOwnerActive: boolean;
  aiEnabled: boolean;
};

export type RunAgentRuntimeEventDependencies = {
  /** Test/DI seam - defaults to the real runNativeAutonomousCycle. */
  customerMessageRunner?: RunNativeAutonomousCycle;
  /** Test/DI seam - defaults to the real dispatchDraftedFollowUpMessage. */
  followUpDispatcher?: typeof dispatchDraftedFollowUpMessage;
  /** Required when event.type === "FOLLOWUP_WAKE"; ignored for CUSTOMER_MESSAGE. */
  followUpDispatch?: FollowUpWakeDispatchContext;
};

export type AgentRuntimeEventResult =
  | { type: "CUSTOMER_MESSAGE"; result: NativeAutonomousCycleResult }
  | { type: "FOLLOWUP_WAKE"; result: DispatchDraftedFollowUpMessageResult };

export async function runAgentRuntimeEvent(
  event: AgentRuntimeEvent,
  dependencies: RunAgentRuntimeEventDependencies = {}
): Promise<AgentRuntimeEventResult> {
  if (event.type === "CUSTOMER_MESSAGE") {
    const runner = dependencies.customerMessageRunner ?? (await import("../native-cycle")).runNativeAutonomousCycle;
    const result = await runner({
      conversationId: event.conversationId,
      conversationPublicId: event.conversationPublicId,
      customerMasterId: event.customerMasterId,
      waId: event.waId,
      phoneNumberId: event.phoneNumberId,
      messageId: event.messageId,
      messageText: event.messageText,
      correlationId: event.correlationId,
      currentTime: event.currentTime
    });
    return { type: "CUSTOMER_MESSAGE", result };
  }

  if (!dependencies.followUpDispatch) {
    throw new Error("agent_runtime_event_followup_wake_missing_dispatch_context");
  }
  const dispatcher = dependencies.followUpDispatcher ?? dispatchDraftedFollowUpMessage;
  const result = await dispatcher({
    actionPublicId: event.actionPublicId,
    attemptNumber: event.attempt,
    opportunityId: event.opportunityId,
    conversationId: event.conversationId,
    waId: dependencies.followUpDispatch.waId,
    draftMessage: dependencies.followUpDispatch.draftMessage,
    caseStatus: dependencies.followUpDispatch.caseStatus,
    humanOwnerActive: dependencies.followUpDispatch.humanOwnerActive,
    aiEnabled: dependencies.followUpDispatch.aiEnabled,
    now: event.firedAt
  });
  return { type: "FOLLOWUP_WAKE", result };
}
