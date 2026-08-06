import type { CustomerHistoryCommercialSignal } from "./commercial-signals";

/**
 * CP-R1-T12D (spec section 7). Deterministic, pure guidance flags only -
 * never generates the final customer-facing text (that stays the model's
 * job, same discipline as every other prompt-rule module in this codebase).
 * `preserveCatalogOrdering`/`autoExcludePurchasedProducts`/
 * `inferCustomerSegment`/`inferPurchasingPower` are literal-typed so nothing
 * downstream can silently accept a different value at compile time.
 */
export type CustomerHistoryCommercialGuidance = {
  readonly acknowledgeHistory: boolean;
  readonly mentionPreviousPurchase: boolean;
  readonly askReorderClarification: boolean;
  readonly explainComplementRelationship: boolean;
  readonly avoidRedundantRecommendation: boolean;
  readonly preserveCatalogOrdering: true;
  readonly autoExcludePurchasedProducts: false;
  readonly inferCustomerSegment: false;
  readonly inferPurchasingPower: false;
  readonly allowedStatements: readonly string[];
  readonly prohibitedStatements: readonly string[];
  readonly reasonCodes: readonly string[];
};

const ALLOWED_STATEMENTS = [
  "Acknowledge a previously purchased product only when it is relevant to the current request.",
  "Offer reorder, replacement, additional unit, or expansion as possibilities when a purchased product is recommended again.",
  "Explain a complementary relationship only when Catalog evidence supports it.",
  "Continue with the current request and Catalog evidence when history is unavailable."
] as const;

const PROHIBITED_STATEMENTS = [
  "Do not mention purchase history merely to show it is available.",
  "Do not exclude a recommended product because it was purchased before.",
  "Do not assume the customer no longer needs a previously purchased product.",
  "Do not infer RFM segment, VIP status, purchasing power, lifetime value, price sensitivity, loyalty, or churn risk.",
  "Do not invent product compatibility without Catalog evidence.",
  "Do not claim the customer has no purchase history when it is merely unavailable."
] as const;

/**
 * CP-R1-T12D. Pure function of the (already relevance-filtered) signal set -
 * never reads env, never touches the DB, never mutates `signals`.
 */
export function buildCustomerHistoryCommercialGuidance(signals: readonly CustomerHistoryCommercialSignal[]): CustomerHistoryCommercialGuidance {
  const types = new Set(signals.map((signal) => signal.type));
  const reasonCodes: string[] = [];

  const mentionPreviousPurchase = types.has("PRODUCT_PREVIOUSLY_PURCHASED") || types.has("VARIANT_PREVIOUSLY_PURCHASED");
  if (mentionPreviousPurchase) reasonCodes.push("PRODUCT_OR_VARIANT_MATCH");

  const askReorderClarification = types.has("POSSIBLE_REORDER");
  if (askReorderClarification) reasonCodes.push("POSSIBLE_REORDER_HYPOTHESIS");

  const explainComplementRelationship = types.has("POSSIBLE_COMPLEMENT");
  if (explainComplementRelationship) reasonCodes.push("CATALOG_BACKED_COMPLEMENT");

  if (types.has("HISTORY_UNAVAILABLE")) reasonCodes.push("HISTORY_UNAVAILABLE_FAIL_OPEN");
  if (types.has("RECENT_PURCHASE_RELEVANT")) reasonCodes.push("RECENT_PURCHASE_WITHIN_WINDOW");

  const acknowledgeHistory = mentionPreviousPurchase || askReorderClarification || explainComplementRelationship;

  return {
    acknowledgeHistory,
    mentionPreviousPurchase,
    askReorderClarification,
    explainComplementRelationship,
    avoidRedundantRecommendation: !acknowledgeHistory,
    preserveCatalogOrdering: true,
    autoExcludePurchasedProducts: false,
    inferCustomerSegment: false,
    inferPurchasingPower: false,
    allowedStatements: ALLOWED_STATEMENTS,
    prohibitedStatements: PROHIBITED_STATEMENTS,
    reasonCodes
  };
}
