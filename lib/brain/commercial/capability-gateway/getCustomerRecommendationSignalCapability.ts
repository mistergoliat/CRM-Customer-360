import { loadCommercialCustomerContext } from "@/lib/brain/commercial/commercial-customer-context";
import type { CommercialCustomerContextResult } from "@/lib/brain/commercial/commercial-customer-context";
import type { CustomerProfilePurchaseBehaviorTopProductContext } from "@/lib/brain/commercial/customer-profile-context";
import type { CapabilityExecutionOutcome, CapabilityGatewayContext, CapabilityGatewayDefinition } from "./types";

const CAPABILITY_GATEWAY_VERSION = "capability-gateway.v1" as const;

// SALES-AGENT-R2-ID-R2-A12, Decision 6/8. Deliberately not the full
// CustomerCommercialHistoryContext (A10) - CUSTOMER_AWARE_RECOMMENDATION
// only ever needs "what to search for" and, optionally, a coarse RFM
// segment - never the raw summary/order payload. No productId field
// anywhere in this result: nothing here can ever be mistaken for a current
// catalog id downstream (recommendationCandidates always comes from a real
// search_products/T12 execution instead).
export type RecommendationSignalResult = { status: "AVAILABLE"; queryText: string; rfmSegmentLabel?: string } | { status: "NO_SIGNAL" };

/**
 * SALES-AGENT-R2-ID-R2-A12, Decision 4a. `topProducts` has no documented or
 * enforced order (checked lib/integrations/customer-profile/http-client.ts -
 * the client parses the wire array verbatim, no sort is ever applied; CP-R1
 * docs explicitly treat it as "evidence only"). This is a "historical signal
 * selection heuristic," never a claim about customer preference: purchased
 * in the most distinct orders, then the highest cumulative quantity, then
 * the most recent. Isolated into its own pure function (never inlined into
 * execute()) so the heuristic can change without touching the capability's
 * CP/Gateway contract. Returns null when there is nothing to select.
 */
export function selectRecommendationHistoricalSignal(topProducts: readonly CustomerProfilePurchaseBehaviorTopProductContext[]): CustomerProfilePurchaseBehaviorTopProductContext | null {
  if (topProducts.length === 0) return null;
  const sorted = [...topProducts].sort((a, b) => {
    if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
    if (b.totalQuantityPurchased !== a.totalQuantityPurchased) return b.totalQuantityPurchased - a.totalQuantityPurchased;
    const left = a.lastPurchasedAt ? new Date(a.lastPurchasedAt).getTime() : 0;
    const right = b.lastPurchasedAt ? new Date(b.lastPurchasedAt).getTime() : 0;
    return right - left;
  });
  return sorted[0];
}

function outcomeFromContextResult(result: CommercialCustomerContextResult): CapabilityExecutionOutcome<RecommendationSignalResult> {
  if (result.status === "IDENTITY_INSUFFICIENT") {
    // Defensive only - buildCommercialWorkProjection.ts's commercialIdentityGate
    // already prevents a CUSTOMER_AWARE_RECOMMENDATION objective (and
    // therefore this step) from ever becoming READY below LEVEL_3. Never a
    // fallback identity.
    return { status: "denied", data: null, errorCode: "identity_insufficient", retryable: false, evidence: [] };
  }
  // SALES-AGENT-R2-ID-R2-A12, Decision 5. Unlike get_customer_purchase_history,
  // a Customer Profile failure here is NEVER a technical failure - "repeat
  // purchase" has no sensible generic substitute, but "recommend something"
  // degrades cleanly to a generic Catalog search. SYSTEM_UNAVAILABLE (either
  // retryable value) and PROFILE_NOT_FOUND both collapse to the same
  // NO_SIGNAL/completed business outcome so the objective proceeds instead
  // of blocking the conversation for lost personalization.
  if (result.status === "SYSTEM_UNAVAILABLE") {
    return {
      status: "completed",
      data: { status: "NO_SIGNAL" },
      errorCode: null,
      retryable: false,
      evidence: [{ source: "customer-profile", summary: "get_customer_recommendation_signal degraded to NO_SIGNAL: Customer Profile unavailable.", capturedAt: new Date().toISOString() }]
    };
  }
  if (result.status === "PROFILE_NOT_FOUND") {
    return {
      status: "completed",
      data: { status: "NO_SIGNAL" },
      errorCode: null,
      retryable: false,
      evidence: [{ source: "customer-profile", summary: "get_customer_recommendation_signal found no profile for this customer.", capturedAt: new Date().toISOString() }]
    };
  }

  const topProducts = result.commercialHistory.purchaseBehavior?.topProducts ?? [];
  const selected = selectRecommendationHistoricalSignal(topProducts);
  if (!selected) {
    return {
      status: "completed",
      data: { status: "NO_SIGNAL" },
      errorCode: null,
      retryable: false,
      evidence: [{ source: "customer-profile", summary: "get_customer_recommendation_signal found an available profile with no purchase behavior signal.", capturedAt: new Date().toISOString() }]
    };
  }

  const rfm = result.commercialHistory.customerRfm;
  const rfmSegmentLabel = rfm && rfm.status === "AVAILABLE" && rfm.segment.code ? rfm.segment.code : undefined;
  return {
    status: "completed",
    data: { status: "AVAILABLE", queryText: selected.name, ...(rfmSegmentLabel ? { rfmSegmentLabel } : {}) },
    errorCode: null,
    retryable: false,
    evidence: [{ source: "customer-profile", summary: "get_customer_recommendation_signal found a historical signal.", capturedAt: new Date().toISOString() }]
  };
}

/**
 * SALES-AGENT-R2-ID-R2-A12. Read-only, system-controlled - never registered
 * in toolAliases.ts (the Sales Agent LLM never calls this directly; only
 * CommercialWork's executor dispatches it, via a CUSTOMER_AWARE_RECOMMENDATION
 * objective's LOAD_RECOMMENDATION_SIGNAL step). Shares the exact same A10
 * boundary as get_customer_purchase_history - never a second Customer
 * Profile HTTP client.
 *
 * Identity comes exclusively from context.trustedCustomerSession.runtimeIdentity
 * - never a tool-request argument. commercialIdentityGate.ts already
 * guarantees this step is never READY below LEVEL_3_PRESTASHOP_LINKED;
 * loadCommercialCustomerContext re-gates defensively regardless (fail
 * closed, never a second, weaker check).
 */
export function getCustomerRecommendationSignalCapability(
  loadContext: typeof loadCommercialCustomerContext = loadCommercialCustomerContext
): CapabilityGatewayDefinition<Record<string, never>, RecommendationSignalResult> {
  return {
    capability: "get_customer_recommendation_signal",
    version: CAPABILITY_GATEWAY_VERSION,
    description: "Reads a deterministic historical recommendation signal (what this customer usually buys) via the Customer Profile service, gated on live LEVEL_3_PRESTASHOP_LINKED identity. Degrades to NO_SIGNAL - never blocks - when history is absent or Customer Profile is unavailable. Never reveals raw order/payment/PII data or a coarse RFM segment beyond a single label.",
    governance: { sideEffect: "read_only", authority: "autonomous", riskClass: "low" },
    maxRetries: 1,
    async checkAvailability() {
      return { status: "available", reason: null };
    },
    async execute(_input, context: CapabilityGatewayContext) {
      const runtimeIdentity = context.trustedCustomerSession?.runtimeIdentity ?? null;
      const result = await loadContext({
        runtimeIdentity,
        historyNeeds: ["PRODUCT_RECOMMENDATION"],
        requestId: context.requestId ?? context.correlationId
      });
      return outcomeFromContextResult(result);
    }
  };
}
