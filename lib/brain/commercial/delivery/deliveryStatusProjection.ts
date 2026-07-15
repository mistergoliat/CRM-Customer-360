// Single source of truth for the monotonic delivery-status ranking used to
// project a Meta status event onto conversation_message, brain_message_outbox
// and crm_opportunities (ACS-R1-05-T04 section 8). Do not duplicate this
// comparison anywhere else.

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

/**
 * Whether `nextStatus` may overwrite `currentStatus` for the same message.
 * `read` and `delivered` never regress; `failed` never overrides a status
 * that already reached `delivered`/`read`.
 */
export function shouldProjectDeliveryStatus(currentStatus: string | null, nextStatus: DeliveryStatus): boolean {
  const current = currentStatus?.toLowerCase().trim() ?? null;
  if (!current) return true;
  if (current === nextStatus) return false;
  if (current === "read") return false;
  if (current === "delivered") return nextStatus === "read";
  if (current === "sent") return nextStatus === "delivered" || nextStatus === "read" || nextStatus === "failed";
  if (current === "failed") return false;
  return true;
}
