import type { DeriveCustomerHistoryNeedsInput, CustomerHistoryNeed } from "./types";

const PRODUCT_RECOMMENDATION_STAGES = new Set(["recommendation", "objection_handling", "purchase_intent", "checkout_support"]);
const PRODUCT_RECOMMENDATION_ACTIONS = new Set(["recommend_product", "recommend_alternative", "offer_bundle", "provide_price", "check_shipping", "prepare_quote"]);
const PRODUCT_RECOMMENDATION_INTENTS = ["product", "recommend", "quote", "purchase"];

function includesRecommendationIntent(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return PRODUCT_RECOMMENDATION_INTENTS.some((token) => normalized.includes(token));
}

export function deriveCustomerHistoryNeeds(input: DeriveCustomerHistoryNeedsInput): CustomerHistoryNeed[] {
  const needs = new Set<CustomerHistoryNeed>();

  if (input.pendingCatalogAction) {
    needs.add("CATALOG_RESULT_REQUIRES_HISTORY_CHECK");
  }
  if ((input.recentCatalogContext?.interactions.length ?? 0) > 0) {
    needs.add("CATALOG_RESULT_REQUIRES_HISTORY_CHECK");
  }

  const opportunityStage = input.snapshot.opportunity?.stage ?? null;
  if (typeof opportunityStage === "string" && PRODUCT_RECOMMENDATION_STAGES.has(opportunityStage)) {
    needs.add("PRODUCT_RECOMMENDATION");
  }

  const nextActionType = input.snapshot.opportunity?.nextActionType ?? null;
  if (typeof nextActionType === "string" && PRODUCT_RECOMMENDATION_ACTIONS.has(nextActionType)) {
    needs.add(nextActionType === "offer_bundle" ? "CROSS_SELL" : "PRODUCT_RECOMMENDATION");
  }

  if (includesRecommendationIntent(input.snapshot.opportunity?.primaryIntent)) {
    needs.add("PRODUCT_SEARCH");
  }

  const signals = input.snapshot.opportunity?.signals ?? [];
  if (signals.some((signal) => includesRecommendationIntent(signal))) {
    needs.add("PRODUCT_SEARCH");
  }

  if (input.snapshot.needProfile && (input.snapshot.needProfile.useCase || input.snapshot.needProfile.requiredFeatures.length > 0 || input.snapshot.needProfile.budgetMax !== null)) {
    needs.add("PRODUCT_SEARCH");
  }

  return [...needs];
}
