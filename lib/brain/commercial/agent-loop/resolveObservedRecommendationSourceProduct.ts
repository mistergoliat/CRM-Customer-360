import type { RecentCatalogContext } from "./recentCatalogContext";
import type { ToolObservation } from "./agentStepTypes";
import { RECOMMENDATION_SOURCE_PRODUCT_BLOCKED_REASONS, type RecommendationSourceProductBlockedReason } from "./agentStepTypes";

export type ObservedCatalogProductEvidence = { productId: string; combinationId?: string };

export type RequestedRecommendationSourceProduct = { productId?: unknown; combinationId?: unknown };

export type ResolveObservedRecommendationSourceProductInput = {
  requestedSourceProduct: RequestedRecommendationSourceProduct | null | undefined;
  /** Cross-turn evidence (DB reconstruction) - null/undefined when unavailable, never mutated. */
  recentCatalogContext?: RecentCatalogContext | null;
  /** This turn's own prior tool observations only - never cross-turn state. */
  toolObservations?: Array<ToolObservation | null | undefined>;
};

export type ResolveObservedRecommendationSourceProductResult =
  | { status: "resolved"; product: ObservedCatalogProductEvidence }
  | { status: "blocked"; reason: RecommendationSourceProductBlockedReason };

/**
 * CP-R1-T10B8D (spec section 6, "Fuente de evidencia"). recommend_catalog_products
 * itself is deliberately excluded: its own candidates never authorize another
 * recommend_catalog_products call (no recursive recommend -> recommend -> recommend
 * chains without an explicit, separately-justified decision - none exists yet).
 */
const OBSERVED_EVIDENCE_SOURCE_TOOLS = new Set(["search_products", "get_product_details", "explore_catalog"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Safe, lossless number->string normalization only - never parseFloat/Number() on an arbitrary string, never a decimal/NaN/Infinity. */
function asFiniteNumberString(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function collectHistoricalEvidence(recentCatalogContext: RecentCatalogContext | null | undefined): ObservedCatalogProductEvidence[] {
  const evidence: ObservedCatalogProductEvidence[] = [];
  for (const interaction of recentCatalogContext?.interactions ?? []) {
    if (!OBSERVED_EVIDENCE_SOURCE_TOOLS.has(interaction.sourceTool)) continue;
    for (const product of interaction.products ?? []) {
      evidence.push({ productId: product.productId, ...(product.combinationId !== undefined ? { combinationId: product.combinationId } : {}) });
    }
  }
  return evidence;
}

/**
 * Live, this-turn evidence only, read from the same bounded ToolObservation
 * projections buildToolObservation.ts already sends the model - never the raw
 * gateway payload. search_products/explore_catalog observations never carry
 * combinationId (see projectSearchProducts/projectExploreCatalog), so
 * same-turn live evidence is always productId-only; a combinationId-specific
 * sourceProduct can still resolve via recentCatalogContext, which does carry
 * combinationId for search_products history (sourced from the unprojected
 * response_summary_json).
 */
function collectLiveEvidence(toolObservations: Array<ToolObservation | null | undefined> | undefined): ObservedCatalogProductEvidence[] {
  const evidence: ObservedCatalogProductEvidence[] = [];
  for (const observation of toolObservations ?? []) {
    if (!observation || observation.status !== "completed" || !OBSERVED_EVIDENCE_SOURCE_TOOLS.has(observation.tool)) continue;
    const data = observation.data;
    if (!isRecord(data)) continue;

    if (observation.tool === "search_products" && Array.isArray(data.items)) {
      for (const item of data.items) {
        if (isRecord(item) && typeof item.productId === "string") evidence.push({ productId: item.productId });
      }
      continue;
    }
    if (observation.tool === "explore_catalog" && Array.isArray(data.products)) {
      for (const product of data.products) {
        if (isRecord(product) && typeof product.productId === "string") evidence.push({ productId: product.productId });
      }
      continue;
    }
    if (observation.tool === "get_product_details" && typeof data.productId === "string") {
      evidence.push({ productId: data.productId });
    }
  }
  return evidence;
}

/**
 * Validates that recommend_catalog_products' sourceProduct cites a product
 * this conversation actually observed - not merely a syntactically valid
 * number. Runs before the Gateway is ever called (runAgentToolLoop.ts); the
 * Gateway/T10B7/T10B6/T10B5 chain is never touched when this resolves to
 * "blocked" (spec section 7 - "No llamar T10B8B/T10B7/T10B5 cuando la
 * evidencia falla").
 */
export function resolveObservedRecommendationSourceProduct(
  input: ResolveObservedRecommendationSourceProductInput
): ResolveObservedRecommendationSourceProductResult {
  const requestedProductId = asFiniteNumberString(input.requestedSourceProduct?.productId);
  if (!requestedProductId) return { status: "blocked", reason: RECOMMENDATION_SOURCE_PRODUCT_BLOCKED_REASONS[0] };
  const requestedCombinationId = asFiniteNumberString(input.requestedSourceProduct?.combinationId);

  const noEvidenceSourcesProvided = input.recentCatalogContext == null && (input.toolObservations?.length ?? 0) === 0;
  const evidence = [...collectHistoricalEvidence(input.recentCatalogContext), ...collectLiveEvidence(input.toolObservations)];

  if (evidence.length === 0 && noEvidenceSourcesProvided) {
    return { status: "blocked", reason: "recent_catalog_context_unavailable" };
  }

  const productMatches = evidence.filter((entry) => entry.productId === requestedProductId);
  if (productMatches.length === 0) return { status: "blocked", reason: "source_product_not_observed" };

  if (requestedCombinationId !== undefined) {
    const variantMatch = productMatches.find((entry) => entry.combinationId === requestedCombinationId);
    if (!variantMatch) return { status: "blocked", reason: "source_product_variant_not_observed" };
    return { status: "resolved", product: { productId: requestedProductId, combinationId: requestedCombinationId } };
  }

  // No combinationId requested: any matching productId is enough, unless the
  // observed evidence itself is ambiguous between more than one distinct
  // variant - the model must disambiguate rather than have one silently
  // chosen for it (spec section 6, "multiples variantes ambiguas").
  const distinctCombinationIds = new Set(productMatches.map((entry) => entry.combinationId).filter((value): value is string => value !== undefined));
  if (distinctCombinationIds.size > 1) return { status: "blocked", reason: "source_product_variant_not_observed" };

  const [onlyCombinationId] = distinctCombinationIds;
  return { status: "resolved", product: { productId: requestedProductId, ...(onlyCombinationId !== undefined ? { combinationId: onlyCombinationId } : {}) } };
}
