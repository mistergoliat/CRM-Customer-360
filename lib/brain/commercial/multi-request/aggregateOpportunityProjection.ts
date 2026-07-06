import type { ConversationRequest } from "../conversation-request";

export type OpportunityProjectionPlan = {
  opportunityId: number;
  turnPlanId: string;
  requestIds: string[];
  /** Requests still open for this opportunity anywhere in the conversation. */
  hasOpenRequests: boolean;
};

/**
 * Pure aggregation: several requests may point at the same opportunity, but a
 * turn produces AT MOST ONE projected transition per (opportunityId,
 * turnPlanId). The opportunity is a commercial projection, never the
 * lifecycle of each request - the actual write stays with the operational
 * loop's CAS persistence, which consumes this aggregate.
 */
export function aggregateOpportunityProjection(
  requests: readonly ConversationRequest[],
  turnPlanId: string
): OpportunityProjectionPlan[] {
  const byOpportunity = new Map<number, ConversationRequest[]>();
  for (const request of requests) {
    if (request.opportunityId === null) continue;
    const bucket = byOpportunity.get(request.opportunityId) ?? [];
    bucket.push(request);
    byOpportunity.set(request.opportunityId, bucket);
  }

  return [...byOpportunity.entries()].map(([opportunityId, bucket]) => ({
    opportunityId,
    turnPlanId,
    requestIds: bucket.map((request) => request.requestId),
    hasOpenRequests: bucket.some((request) => request.status !== "resolved" && request.status !== "cancelled" && request.status !== "unresolvable")
  }));
}
