import { transitionConversationRequest } from "../conversation-request";
import type { AppliedRequestOperation } from "./persistRequestOperations";

export type ReducedRequestState = {
  requestId: string;
  fromStatus: string;
  toStatus: string;
  status: "transitioned" | "unchanged" | "conflict";
};

export type ReduceRequestsResult = {
  reduced: ReducedRequestState[];
  warnings: string[];
};

/**
 * Deterministic reduction after the turn's operations: a request the planner
 * just created or continued is actively being worked, so `detected` rows move
 * to `active` by CAS. Resolution NEVER happens here - only the Bloque 7
 * RequestDefinition reducer may resolve, from facts + events + artifacts.
 */
export async function reduceRequests(applied: readonly AppliedRequestOperation[]): Promise<ReduceRequestsResult> {
  const reduced: ReducedRequestState[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const operation of applied) {
    const request = operation.request;
    if (!request || !operation.requestId || seen.has(operation.requestId)) continue;
    seen.add(operation.requestId);
    if (operation.operation === "cancel" || operation.operation === "mention") continue;

    if (request.status === "detected") {
      const result = await transitionConversationRequest({ requestId: request.requestId, fromStatus: "detected", toStatus: "active" });
      if (result.ok) {
        reduced.push({ requestId: request.requestId, fromStatus: "detected", toStatus: "active", status: "transitioned" });
      } else if (result.status === "conflict") {
        reduced.push({ requestId: request.requestId, fromStatus: "detected", toStatus: "active", status: "conflict" });
      } else {
        warnings.push(`request_activation_failed:${request.requestId}:${result.warning}`);
      }
      continue;
    }

    // A customer message on a waiting_customer request means the wait is over.
    if (request.status === "waiting_customer" && (operation.operation === "continue" || operation.operation === "modify")) {
      const result = await transitionConversationRequest({ requestId: request.requestId, fromStatus: "waiting_customer", toStatus: "active" });
      if (result.ok) {
        reduced.push({ requestId: request.requestId, fromStatus: "waiting_customer", toStatus: "active", status: "transitioned" });
      }
      continue;
    }

    reduced.push({ requestId: request.requestId, fromStatus: request.status, toStatus: request.status, status: "unchanged" });
  }

  return { reduced, warnings };
}
