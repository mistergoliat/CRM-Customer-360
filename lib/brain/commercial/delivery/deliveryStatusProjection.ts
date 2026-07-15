// Single source of truth for the monotonic delivery-status ranking used to
// project a Meta status event onto conversation_message, brain_message_outbox
// and crm_opportunities (ACS-R1-05-T04 section 8, ACS-R1-05-T04.1 P1-3). Do
// not duplicate this comparison anywhere else - the opportunity projection's
// SQL WHERE clause (native-whatsapp/service.ts) mirrors this exact rank
// table via an equivalent CASE expression, so a change here must be mirrored
// there too.

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

// A strict total order: read > delivered > failed > sent. `failed` sits
// below `delivered`/`read` (so it can never degrade them - ACS-R1-05-T04.1
// rule 4) but above `sent` (so a late, legitimate delivered/read can still
// correct an earlier transient failure - the concurrency case the same rule
// requires: "failed" and "delivered" racing from "sent" must always settle
// on "delivered", regardless of which one's write physically lands first).
const DELIVERY_STATUS_RANK: Record<DeliveryStatus, number> = {
  sent: 1,
  failed: 2,
  delivered: 3,
  read: 4
};

/**
 * Whether `nextStatus` may overwrite `currentStatus` for the same message.
 * A rank comparison: null/unrecognized current status always allows the
 * first real status to land; otherwise `nextStatus` must strictly outrank
 * `currentStatus`.
 */
export function shouldProjectDeliveryStatus(currentStatus: string | null, nextStatus: DeliveryStatus): boolean {
  const current = currentStatus?.toLowerCase().trim() ?? null;
  if (!current) return true;
  const currentRank = DELIVERY_STATUS_RANK[current as DeliveryStatus];
  if (currentRank === undefined) return true;
  return DELIVERY_STATUS_RANK[nextStatus] > currentRank;
}
