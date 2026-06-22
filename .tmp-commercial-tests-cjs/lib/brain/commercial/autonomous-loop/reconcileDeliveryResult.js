"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileDeliveryResult = reconcileDeliveryResult;
function mapWorkerStatusToDeliveryStatus(status) {
    if (status === null)
        return null;
    if (status === "delivered")
        return "delivered";
    if (status === "retry_scheduled")
        return "retry_scheduled";
    if (status === "dead_letter")
        return "dead_letter";
    if (status === "expired")
        return "expired";
    if (status === "invalid")
        return "invalid";
    if (status === "skipped")
        return "skipped";
    if (status === "failed")
        return "failed";
    return null;
}
function mapActionStatus(status, currentStatus) {
    if (status === null)
        return currentStatus;
    if (status === "delivered")
        return "executed";
    if (status === "retry_scheduled")
        return "planned";
    if (status === "dead_letter" || status === "failed")
        return "failed";
    if (status === "expired")
        return "expired";
    if (status === "invalid" || status === "skipped")
        return currentStatus;
    return currentStatus;
}
function reconcileDeliveryResult(input) {
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
