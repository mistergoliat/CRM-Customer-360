import { createHash } from "node:crypto";
import {
  appendRequestEvent,
  createConversationRequest,
  linkMessageToRequest,
  loadConversationRequest,
  transitionConversationRequest
} from "../conversation-request";
import type { ConversationRequest } from "../conversation-request";
import type { RequestOperation, TurnPlanRecord } from "./turnPlanTypes";

/** creation_key = sha256(turnPlanId + detectionId): stable across retries of the same turn. */
export function buildRequestCreationKey(turnPlanId: string, detectionId: string): string {
  return createHash("sha256").update(`${turnPlanId}:${detectionId}`).digest("hex");
}

export type AppliedRequestOperation = {
  detectionId: string;
  operation: RequestOperation["operation"];
  requestId: string | null;
  status: "applied" | "duplicate" | "skipped" | "failed";
  warning: string | null;
  request: ConversationRequest | null;
};

export type PersistRequestOperationsResult = {
  applied: AppliedRequestOperation[];
  /** detectionId -> real requestId, for resolving `detection:` placeholders. */
  requestIdsByDetection: Record<string, string>;
  warnings: string[];
};

/**
 * Applies the plan's request operations against the tracking tables. Every
 * write is idempotent (creation_key, event dedupe_key, link unique triple),
 * so re-running the same persisted plan converges to the same rows.
 */
export async function persistRequestOperations(record: TurnPlanRecord): Promise<PersistRequestOperationsResult> {
  const applied: AppliedRequestOperation[] = [];
  const requestIdsByDetection: Record<string, string> = {};
  const warnings: string[] = [];
  const occurredAt = new Date().toISOString();

  for (const operation of record.plan.requestOperations) {
    if (operation.operation === "create") {
      const created = await createConversationRequest({
        creationKey: buildRequestCreationKey(record.turnPlanId, operation.detectionId),
        conversationId: record.conversationId,
        intentType: operation.intentType,
        intentDomain: operation.intentDomain,
        createdFromMessageId: record.inboundMessageId
      });

      if (!created.ok) {
        warnings.push(`request_create_failed:${operation.detectionId}:${created.warning}`);
        applied.push({ detectionId: operation.detectionId, operation: "create", requestId: null, status: "failed", warning: created.warning, request: null });
        continue;
      }

      const request = created.request;
      requestIdsByDetection[operation.detectionId] = request.requestId;
      await appendRequestEvent({
        dedupeKey: `request:${request.requestId}:turn:${record.turnPlanId}:request_created`,
        requestId: request.requestId,
        eventType: "request_created",
        sourceType: "planner",
        sourceId: record.turnPlanId,
        payload: { intentType: operation.intentType, strategy: operation.strategy, reasonCode: operation.reasonCode },
        occurredAt
      });
      await linkMessageToRequest({
        requestId: request.requestId,
        messageId: record.inboundMessageId,
        relationType: "created",
        confidence: operation.confidence,
        linkedBy: "planner"
      });
      applied.push({
        detectionId: operation.detectionId,
        operation: "create",
        requestId: request.requestId,
        status: created.status === "created" ? "applied" : "duplicate",
        warning: null,
        request
      });
      continue;
    }

    const requestId = operation.requestId;
    if (!requestId) {
      applied.push({ detectionId: operation.detectionId, operation: operation.operation, requestId: null, status: "skipped", warning: "operation_missing_request_id", request: null });
      continue;
    }

    const request = await loadConversationRequest(requestId);
    if (!request) {
      warnings.push(`request_not_found:${requestId}`);
      applied.push({ detectionId: operation.detectionId, operation: operation.operation, requestId, status: "failed", warning: "request_not_found", request: null });
      continue;
    }
    requestIdsByDetection[operation.detectionId] = requestId;

    if (operation.operation === "reopen") {
      if (request.status === "resolved" || request.status === "unresolvable") {
        const reopened = await transitionConversationRequest({ requestId, fromStatus: request.status, toStatus: "active" });
        if (!reopened.ok && reopened.status !== "conflict") {
          warnings.push(`request_reopen_failed:${requestId}:${reopened.warning}`);
        }
        await appendRequestEvent({
          dedupeKey: `request:${requestId}:turn:${record.turnPlanId}:request_reopened`,
          requestId,
          eventType: "request_reopened",
          sourceType: "planner",
          sourceId: record.turnPlanId,
          payload: { reasonCode: operation.reasonCode },
          occurredAt
        });
      }
      await linkMessageToRequest({ requestId, messageId: record.inboundMessageId, relationType: "reopened", confidence: operation.confidence, linkedBy: "planner" });
      applied.push({ detectionId: operation.detectionId, operation: "reopen", requestId, status: "applied", warning: null, request: await loadConversationRequest(requestId) });
      continue;
    }

    if (operation.operation === "cancel") {
      if (request.status !== "cancelled") {
        const cancelled = await transitionConversationRequest({ requestId, fromStatus: request.status, toStatus: "cancelled" });
        if (!cancelled.ok && cancelled.status !== "conflict") {
          warnings.push(`request_cancel_failed:${requestId}:${cancelled.warning}`);
        }
        await appendRequestEvent({
          dedupeKey: `request:${requestId}:turn:${record.turnPlanId}:request_cancelled`,
          requestId,
          eventType: "request_cancelled",
          sourceType: "planner",
          sourceId: record.turnPlanId,
          payload: { reasonCode: operation.reasonCode },
          occurredAt
        });
      }
      await linkMessageToRequest({ requestId, messageId: record.inboundMessageId, relationType: "cancelled", confidence: operation.confidence, linkedBy: "planner" });
      applied.push({ detectionId: operation.detectionId, operation: "cancel", requestId, status: "applied", warning: null, request: await loadConversationRequest(requestId) });
      continue;
    }

    // continue | modify | mention: the request stays as-is; the link records
    // how this message relates to it and message_linked keeps the event trail.
    const relationType = operation.operation === "continue" ? "continued" : operation.operation === "modify" ? "modified" : "mentioned";
    await linkMessageToRequest({ requestId, messageId: record.inboundMessageId, relationType, confidence: operation.confidence, linkedBy: "planner" });
    await appendRequestEvent({
      dedupeKey: `request:${requestId}:message:${record.inboundMessageId}:message_linked`,
      requestId,
      eventType: "message_linked",
      sourceType: "planner",
      sourceId: record.turnPlanId,
      payload: { relationType, reasonCode: operation.reasonCode },
      occurredAt
    });
    applied.push({ detectionId: operation.detectionId, operation: operation.operation, requestId, status: "applied", warning: null, request });
  }

  return { applied, requestIdsByDetection, warnings };
}
