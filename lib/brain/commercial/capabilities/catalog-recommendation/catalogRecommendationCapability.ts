/**
 * CP-R1-T10B7: the capability itself. No fetch of its own, no SQL, no
 * Date.now, no random, no env, no logs (this repo's other commercial
 * capabilities do not log directly either - see
 * lib/brain/commercial/capabilities/executeReadCapability.ts,
 * lib/brain/commercial/capability-gateway/executeCapability.ts - so this task
 * does not introduce an isolated logger just for itself). Delegates request
 * construction to buildSearchProductsV2Request (CP-R1-T10B6, reused as-is,
 * never re-implemented) and the HTTP call to an injected
 * CatalogSearchProductsV2Client (CP-R1-T10B5) - see
 * docs/releases/CP-R1-T10B7-catalog-recommendation-capability.md.
 */
import { createCatalogSearchProductsV2Client } from "../../../../catalog/search-products-v2/httpCatalogSearchProductsV2Client";
import { buildSearchProductsV2Request } from "../../recommendation-context/buildSearchProductsV2Request";
import type { CatalogRecommendationCapability, CatalogRecommendationCapabilityInput, CatalogRecommendationCapabilityResult, CreateCatalogRecommendationCapabilityDeps } from "./types";

/**
 * DI factory - no global mutable client instance, no HTTP client created per
 * execution. Callers (T10B8 and later) own the CatalogSearchProductsV2Client
 * instance and its lifecycle.
 */
export function createCatalogRecommendationCapability(deps: CreateCatalogRecommendationCapabilityDeps): CatalogRecommendationCapability {
  return {
    async execute(input: CatalogRecommendationCapabilityInput): Promise<CatalogRecommendationCapabilityResult> {
      const buildResult = buildSearchProductsV2Request(input);
      if (buildResult.status === "skipped") {
        return { status: "skipped", reason: buildResult.reason };
      }

      const clientResult = await deps.catalogSearchProductsV2Client.searchProducts(buildResult.request, {
        correlationId: buildResult.callContext.correlationId,
        signal: input.signal
      });

      if (!clientResult.ok) {
        return { status: "failed", error: clientResult.error };
      }

      const response = clientResult.value;
      return {
        status: "completed",
        customerMode: buildResult.metadata.customerMode,
        recommendations: response.recommendations,
        excluded: response.excluded,
        warnings: response.warnings,
        personalization: response.personalization,
        execution: response.execution,
        statistics: response.statistics,
        snapshot: response.snapshot,
        metadata: {
          explicitRepurchaseApplied: buildResult.metadata.explicitRepurchaseApplied,
          excludedProductCount: buildResult.metadata.excludedProductCount,
          recommendationCount: response.recommendations.length,
          degraded: response.execution.degraded
        }
      };
    }
  };
}

/**
 * Productive factory (CP-R1-T10B7). Reuses T10B5's own on-demand,
 * env-driven factory - never a second, duplicated configuration path, never
 * called at module load / bootstrap. Not wired to any runtime caller by this
 * task: T10B5's client itself is still only constructed on demand and this
 * repo has no composition root that would make wiring it here meaningful -
 * left as a formal, exported factory for CP-R1-T10B8 to call, per this
 * task's explicit "no wiring incompleto" rule (documented, not silent).
 */
export function createProductionCatalogRecommendationCapability(): CatalogRecommendationCapability {
  return createCatalogRecommendationCapability({ catalogSearchProductsV2Client: createCatalogSearchProductsV2Client() });
}
