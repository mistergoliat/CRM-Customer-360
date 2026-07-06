import { appendRequestEvent, listRequestEvents, transitionConversationRequest } from "../conversation-request";
import type { ConversationRequest, ConversationRequestStatus, RequestEvent } from "../conversation-request";
import { listActiveRequestFacts } from "../request-facts";
import type { RequestFact } from "../request-facts";
import { resolveRequestDefinition } from "./definitions";
import type { RequestDefinition } from "./types";

export type RequestReductionDecision = {
  requestId: string;
  desiredStatus: ConversationRequestStatus | null;
  resolutionType: string | null;
  triggerEventId: string | null;
  reasons: string[];
};

/**
 * Pure decision: definition + observed events + active facts -> next status.
 * Nothing else - certainly not model output - can resolve a request. Priority:
 * escalation beats resolution beats waiting-for-facts.
 */
export function evaluateRequestReduction(input: {
  request: ConversationRequest;
  definition?: RequestDefinition;
  events: readonly RequestEvent[];
  activeFacts: readonly RequestFact[];
}): RequestReductionDecision {
  const definition = input.definition ?? resolveRequestDefinition(input.request.intentType);
  const status = input.request.status;
  const none: RequestReductionDecision = {
    requestId: input.request.requestId,
    desiredStatus: null,
    resolutionType: null,
    triggerEventId: null,
    reasons: []
  };

  if (status === "cancelled" || status === "resolved" || status === "unresolvable") return none;

  for (const condition of definition.escalationConditions) {
    const trigger = input.events.find((event) => event.eventType === condition.eventType);
    if (trigger && status !== "waiting_human") {
      return {
        requestId: input.request.requestId,
        desiredStatus: "waiting_human",
        resolutionType: null,
        triggerEventId: trigger.requestEventId,
        reasons: [`escalation_event:${condition.eventType}`]
      };
    }
  }

  for (const condition of definition.resolutionConditions) {
    const trigger = input.events.find((event) => event.eventType === condition.eventType);
    if (trigger) {
      return {
        requestId: input.request.requestId,
        desiredStatus: "resolved",
        resolutionType: condition.resolutionType,
        triggerEventId: trigger.requestEventId,
        reasons: [`resolution_event:${condition.eventType}`]
      };
    }
  }

  if (status === "active" && definition.requiredFacts.length > 0) {
    const activeKeys = new Set(input.activeFacts.map((fact) => fact.factKey));
    const missing = definition.requiredFacts.filter((key) => !activeKeys.has(key));
    if (missing.length > 0) {
      return {
        requestId: input.request.requestId,
        desiredStatus: "waiting_customer",
        resolutionType: null,
        triggerEventId: null,
        reasons: missing.map((key) => `missing_required_fact:${key}`)
      };
    }
  }

  return none;
}

export type ApplyRequestReductionResult = {
  decision: RequestReductionDecision;
  applied: boolean;
  warning: string | null;
};

/** Loads trail + facts, decides, and applies the CAS transition + audit event. */
export async function applyRequestReduction(request: ConversationRequest): Promise<ApplyRequestReductionResult> {
  const [events, activeFacts] = await Promise.all([
    listRequestEvents(request.requestId),
    listActiveRequestFacts(request.requestId)
  ]);
  const decision = evaluateRequestReduction({ request, events, activeFacts });

  if (!decision.desiredStatus || decision.desiredStatus === request.status) {
    return { decision, applied: false, warning: null };
  }

  const transition = await transitionConversationRequest({
    requestId: request.requestId,
    fromStatus: request.status,
    toStatus: decision.desiredStatus,
    resolution: decision.resolutionType ? { type: decision.resolutionType, entityType: null, entityId: null } : null
  });

  if (!transition.ok) {
    // A concurrent worker got there first - the reduction is deterministic, so
    // whatever it applied is the same outcome; conflicts are not failures.
    return { decision, applied: false, warning: transition.status === "conflict" ? null : transition.warning };
  }

  const eventType = decision.desiredStatus === "resolved" ? "request_resolved" : decision.desiredStatus === "waiting_human" ? "waiting_human" : "waiting_customer";
  await appendRequestEvent({
    dedupeKey: `request:${request.requestId}:reduction:${decision.desiredStatus}:${decision.triggerEventId ?? decision.reasons.join("|")}`,
    requestId: request.requestId,
    eventType,
    sourceType: "system",
    sourceId: decision.triggerEventId,
    payload: { reasons: decision.reasons, resolutionType: decision.resolutionType },
    occurredAt: new Date().toISOString()
  });

  return { decision, applied: true, warning: null };
}
