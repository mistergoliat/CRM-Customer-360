import type { MessageTransportResult, OutboxWorkerProcessResult } from "../../messaging/outbox-worker";
import type { AutonomousCommercialLoopReconciliation, AutonomousLoopStatus } from "./types";

function mapWorkerStatusToDeliveryStatus(status: OutboxWorkerProcessResult["status"] | null): string | null {
  if (status === null) return null;
  if (status === "delivered") return "delivered";
  if (status === "retry_scheduled") return "retry_scheduled";
  if (status === "dead_letter") return "dead_letter";
  if (status === "expired") return "expired";
  if (status === "invalid") return "invalid";
  if (status === "skipped") return "skipped";
  if (status === "failed") return "failed";
  return null;
}

function mapActionStatus(status: OutboxWorkerProcessResult["status"] | null, currentStatus: string | null): string | null {
  if (status === null) return currentStatus;
  if (status === "delivered") return "executed";
  if (status === "retry_scheduled") return "planned";
  if (status === "dead_letter" || status === "failed") return "failed";
  if (status === "expired") return "expired";
  if (status === "invalid" || status === "skipped") return currentStatus;
  return currentStatus;
}

export function reconcileDeliveryResult(input: {
  actionStatusBefore: string | null;
  workerResult: OutboxWorkerProcessResult | null;
  transportResult: MessageTransportResult | null;
}): AutonomousCommercialLoopReconciliation {
  const deliveryStatus = mapWorkerStatusToDeliveryStatus(input.workerResult?.status ?? null);
  const actionStatusAfter = mapActionStatus(input.workerResult?.status ?? null, input.actionStatusBefore);
  const providerMessageId = input.transportResult?.providerMessageId ?? input.workerResult?.transportResult?.providerMessageId ?? null;

  return {
    actionStatusBefore: input.actionStatusBefore,
    actionStatusAfter,
    deliveryStatus,
    providerMessageId,
    followUpRequired: false
  };
}
