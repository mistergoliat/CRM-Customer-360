import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session/types";
import { resolveRuntimeOpportunity } from "../runtime-opportunity/resolveRuntimeOpportunity";

/**
 * SALES-AGENT-R3-V1.2. The one shared seam where a mutating tool call ensures
 * a durable opportunity anchor exists before a CommercialActionRequest is
 * built - never per capability, never inside the Capability Gateway, never
 * for a read-only tool (see runAgentToolLoop.ts's processUseToolStep, whose
 * READ_TOOL branch never calls this). An already-known opportunityId is
 * reused as-is (no DB round trip, no revalidation) - only a missing one
 * triggers resolveRuntimeOpportunity, which already owns active reuse,
 * terminal exclusion, creation, idempotency and concurrency (R3-V1.1).
 */

export type EnsureCommercialActionOpportunityInput = {
  conversationId: number | null;
  /** Already-known opportunityId for this turn, if any. */
  existingOpportunityId: number | null;
  trustedCustomerSession: NativeCustomerSessionExecutionContext | null | undefined;
  correlationId: string;
  currentTime: string;
};

export type EnsureCommercialActionOpportunityResult =
  | { ok: true; opportunityId: number; source: "existing" | "resolved" }
  | { ok: false; reason: string };

export async function ensureCommercialActionOpportunity(
  input: EnsureCommercialActionOpportunityInput
): Promise<EnsureCommercialActionOpportunityResult> {
  if (input.existingOpportunityId !== null) {
    return { ok: true, opportunityId: input.existingOpportunityId, source: "existing" };
  }

  if (input.conversationId === null) {
    // Required resolver input is not available - fail safely rather than
    // silently continuing with a null opportunityId (task brief Phase 6).
    return { ok: false, reason: "conversation_unavailable" };
  }

  const session = input.trustedCustomerSession ?? null;
  const waId = session?.trustedInbound.externalId ?? null;
  // ATL is WhatsApp-only today (TrustedInboundIdentity.channel is a literal
  // "whatsapp" type) - defaulting to "whatsapp" when no session is present
  // is accurate for this runtime, never a guess across a channel that does
  // not exist yet.
  const channel = session?.trustedInbound.channel ?? "whatsapp";

  let customerMasterId: number | null = null;
  if (session && session.masterCustomerIdentity.status === "resolved") {
    customerMasterId = Number(session.masterCustomerIdentity.masterCustomerId);
  }

  const resolution = await resolveRuntimeOpportunity({
    conversationId: input.conversationId,
    customerMasterId,
    waId,
    channel,
    correlationId: input.correlationId,
    currentTime: input.currentTime
  });

  if (resolution.status === "unavailable") {
    return { ok: false, reason: resolution.reason };
  }

  // "resolved" here means this seam itself had to call resolveRuntimeOpportunity
  // - whether that call found resolution.status "existing" or "created" a row
  // is an internal detail of R3-V1.1's resolver, not this seam's own contract.
  return { ok: true, opportunityId: resolution.opportunity.opportunityId, source: "resolved" };
}
