import { loadCommercialCustomerContext } from "@/lib/brain/commercial/commercial-customer-context";
import type { CommercialCustomerContextResult } from "@/lib/brain/commercial/commercial-customer-context";
import type { CustomerProfilePurchasedProductContext } from "@/lib/brain/commercial/customer-profile-context";
import type { CapabilityExecutionOutcome, CapabilityGatewayContext, CapabilityGatewayDefinition } from "./types";

const CAPABILITY_GATEWAY_VERSION = "capability-gateway.v1" as const;

// SALES-AGENT-R2-ID-R2-A11, PARTE 7. Deliberately not the full
// CustomerCommercialHistoryContext (A10) - REPEAT_PURCHASE only ever needs
// "what did this customer previously buy", never the raw summary/RFM/order
// payload. historicalReference is always omitted: A10's projected
// CustomerProfilePurchasedProductContext never carries a SKU/reference field
// through from the wire response, so this never invents one.
export type RepeatPurchaseHistoryProduct = {
  historicalProductId: string;
  historicalName: string;
  quantity: number;
  lastPurchasedAt: string | null;
};

export type RepeatPurchaseHistoryResult =
  | { status: "AVAILABLE"; previousProducts: RepeatPurchaseHistoryProduct[] }
  | { status: "NO_PURCHASE_HISTORY"; previousProducts: [] };

function toRepeatPurchaseHistoryProduct(product: CustomerProfilePurchasedProductContext): RepeatPurchaseHistoryProduct {
  return {
    historicalProductId: String(product.productId),
    historicalName: product.name,
    quantity: product.totalQuantity,
    lastPurchasedAt: product.lastPurchasedAt
  };
}

function outcomeFromContextResult(result: CommercialCustomerContextResult): CapabilityExecutionOutcome<RepeatPurchaseHistoryResult> {
  if (result.status === "IDENTITY_INSUFFICIENT") {
    // Defensive only - buildCommercialWorkProjection.ts's commercialIdentityGate
    // already prevents a REPEAT_PURCHASE objective (and therefore this step)
    // from ever becoming READY below LEVEL_3. Never a fallback identity.
    return { status: "denied", data: null, errorCode: "identity_insufficient", retryable: false, evidence: [] };
  }
  if (result.status === "SYSTEM_UNAVAILABLE") {
    return result.retryable
      ? { status: "temporarily_blocked", data: null, errorCode: "customer_profile_unavailable", retryable: true, evidence: [] }
      : { status: "failed", data: null, errorCode: "customer_profile_unavailable", retryable: false, evidence: [] };
  }
  if (result.status === "PROFILE_NOT_FOUND") {
    // A business outcome, never a technical failure (A10 PARTE 9) - identity
    // is already LEVEL_3, Customer Profile simply has nothing for this
    // prestashopCustomerId. "completed" with an empty history, exactly like
    // NO_PURCHASE_HISTORY below.
    return {
      status: "completed",
      data: { status: "NO_PURCHASE_HISTORY", previousProducts: [] },
      errorCode: null,
      retryable: false,
      evidence: [{ source: "customer-profile", summary: "get_customer_purchase_history found no profile for this customer.", capturedAt: new Date().toISOString() }]
    };
  }

  const products = result.commercialHistory.purchasedProducts;
  if (products.length === 0) {
    return {
      status: "completed",
      data: { status: "NO_PURCHASE_HISTORY", previousProducts: [] },
      errorCode: null,
      retryable: false,
      evidence: [{ source: "customer-profile", summary: "get_customer_purchase_history found an available profile with no purchased products.", capturedAt: new Date().toISOString() }]
    };
  }

  const previousProducts = products.map(toRepeatPurchaseHistoryProduct);
  return {
    status: "completed",
    data: { status: "AVAILABLE", previousProducts },
    errorCode: null,
    retryable: false,
    evidence: [{ source: "customer-profile", summary: `get_customer_purchase_history found ${previousProducts.length} previously purchased product(s).`, capturedAt: new Date().toISOString() }]
  };
}

/**
 * SALES-AGENT-R2-ID-R2-A11. Read-only, system-controlled - never registered
 * in toolAliases.ts (the Sales Agent LLM never calls this directly; only
 * CommercialWork's executor dispatches it, via a REPEAT_PURCHASE objective's
 * LOAD_PURCHASE_HISTORY step). The single production caller of
 * loadCommercialCustomerContext (ID-R2-A10) other than the Agent Tool Loop's
 * own hidden-context loader - both share the exact same boundary, never a
 * second Customer Profile HTTP client.
 *
 * Identity comes exclusively from context.trustedCustomerSession.runtimeIdentity
 * - never a tool-request argument, never derived from opportunityId/
 * conversationId. commercialIdentityGate.ts already guarantees this step is
 * never READY below LEVEL_3_PRESTASHOP_LINKED; loadCommercialCustomerContext
 * re-gates defensively regardless (fail closed, never a second, weaker check).
 */
/**
 * `loadContext` defaults to the real A10 boundary - a test-only injection
 * seam, same dependency-injection pattern search_products' own
 * `getPort: () => CatalogPort | null` parameter already uses in this file.
 * Production callers (registry.ts) always call this with zero arguments.
 */
export function getCustomerPurchaseHistoryCapability(
  loadContext: typeof loadCommercialCustomerContext = loadCommercialCustomerContext
): CapabilityGatewayDefinition<Record<string, never>, RepeatPurchaseHistoryResult> {
  return {
    capability: "get_customer_purchase_history",
    version: CAPABILITY_GATEWAY_VERSION,
    description: "Reads this customer's previously purchased products via the Customer Profile service, gated on live LEVEL_3_PRESTASHOP_LINKED identity. Never reveals raw order/payment/PII data - only product name/quantity/last purchase date.",
    governance: { sideEffect: "read_only", authority: "autonomous", riskClass: "low" },
    maxRetries: 1,
    async checkAvailability() {
      return { status: "available", reason: null };
    },
    async execute(_input, context: CapabilityGatewayContext) {
      const runtimeIdentity = context.trustedCustomerSession?.runtimeIdentity ?? null;
      const result = await loadContext({
        runtimeIdentity,
        historyNeeds: ["REORDER"],
        requestId: context.requestId ?? context.correlationId
      });
      return outcomeFromContextResult(result);
    }
  };
}
