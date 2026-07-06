import type { ConversationRequest } from "../conversation-request";
import { getActiveRequestFact } from "../request-facts";
import { resolveRequestDefinition } from "../request-definitions";
import { escalateRequest, findOpenEscalationForRequest } from "../request-escalations";
import { executeReadCapabilityForRequest } from "../capabilities";
import { deferRequestAction } from "./deferredActions";

export type ExecuteRequestTurnOutcome =
  | "not_active"
  | "no_execution_strategy"
  | "already_escalated"
  | "escalated"
  | "escalation_failed"
  | "no_input_available"
  | "resolved"
  | "deferred"
  | "skipped_invalid_input";

export type ExecuteRequestTurnResult = {
  requestId: string;
  attempted: boolean;
  outcome: ExecuteRequestTurnOutcome;
  warning: string | null;
};

/**
 * The AIPlan -> CapabilityEvaluation -> CommercialAction step (ADR-006) for
 * the two auto-execution strategies declared on RequestDefinition. Runs only
 * for requests that are `active` right now (already past the missing-facts
 * gate) - waiting/resolved/cancelled requests are never touched here.
 *
 * Both strategies emit their own trail (escalation event / capability event /
 * deferred action); the caller is expected to re-run the definition reducer
 * afterward so a freshly emitted resolution event takes effect the same turn.
 */
export async function executeRequestTurn(input: {
  request: ConversationRequest;
  messageText: string;
  turnPlanId: string;
}): Promise<ExecuteRequestTurnResult> {
  const { request, turnPlanId } = input;
  if (request.status !== "active") {
    return { requestId: request.requestId, attempted: false, outcome: "not_active", warning: null };
  }

  const definition = resolveRequestDefinition(request.intentType);

  if (definition.autoEscalate) {
    const existing = await findOpenEscalationForRequest(request.requestId);
    if (existing) {
      return { requestId: request.requestId, attempted: false, outcome: "already_escalated", warning: null };
    }
    const result = await escalateRequest({
      requestId: request.requestId,
      category: definition.autoEscalate.category,
      mode: definition.autoEscalate.mode,
      reason: definition.autoEscalate.reason,
      createdBy: "planner",
      sourceId: turnPlanId
    });
    if (!result.ok) {
      return { requestId: request.requestId, attempted: true, outcome: "escalation_failed", warning: result.warning };
    }
    return { requestId: request.requestId, attempted: true, outcome: "escalated", warning: null };
  }

  if (definition.primaryCapability) {
    const strategy = definition.primaryCapability;
    const fact = strategy.factKey ? await getActiveRequestFact(request.requestId, strategy.factKey) : null;
    const rawValue = fact?.value ?? (strategy.fallbackToMessageText ? input.messageText : null);
    const value = typeof rawValue === "string" ? rawValue.trim() : rawValue !== null && rawValue !== undefined ? String(rawValue) : "";

    if (!value) {
      return { requestId: request.requestId, attempted: false, outcome: "no_input_available", warning: null };
    }

    const capabilityInput = strategy.inputField === "query" ? { query: value } : { orderIdentifier: value };
    const result = await executeReadCapabilityForRequest({
      capability: strategy.capability,
      input: capabilityInput,
      requestId: request.requestId,
      sourceId: turnPlanId,
      // A found-or-not-found answer both resolve the request; only an
      // unreachable/broken capability defers instead.
      emitEvent: true
    });

    if (result.status === "succeeded") {
      return { requestId: request.requestId, attempted: true, outcome: "resolved", warning: result.warning };
    }
    if (result.status === "unavailable" || result.status === "failed") {
      const deferred = await deferRequestAction({
        requestId: request.requestId,
        turnPlanId,
        actionType: strategy.capability,
        reason: result.warning ?? result.status
      });
      if (!deferred.ok) {
        return { requestId: request.requestId, attempted: true, outcome: "deferred", warning: deferred.warning };
      }
      return { requestId: request.requestId, attempted: true, outcome: "deferred", warning: null };
    }
    // invalid_input: nothing usable was actually available - not an attempt.
    return { requestId: request.requestId, attempted: false, outcome: "skipped_invalid_input", warning: result.warning };
  }

  return { requestId: request.requestId, attempted: false, outcome: "no_execution_strategy", warning: null };
}
