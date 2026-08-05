/**
 * CP-R1-T10B8B: Capability Gateway adapter for catalog recommendations.
 * Wires CatalogRecommendationCapability (CP-R1-T10B7, itself
 * buildSearchProductsV2Request T10B6 -> CatalogSearchProductsV2Client T10B5)
 * behind a CapabilityGatewayDefinition, registered internally
 * (CAPABILITY_GATEWAY_REGISTRY) but not yet exposed to the Agent Tool Loop -
 * see docs/releases/CP-R1-T10B8B-catalog-recommendation-gateway-adapter.md.
 *
 * Identity is read exclusively from
 * context.trustedCustomerSession?.masterCustomerIdentity (CP-R1-T10B8A):
 * "resolved" forwards masterCustomerId, anything else (including an absent
 * session) runs the capability in generic mode - never blocked, never
 * unavailable, never a handoff, never treated as a technical error.
 */
import { createProductionCatalogRecommendationCapability } from "../capabilities/catalog-recommendation/catalogRecommendationCapability";
import type { CatalogRecommendationCapability, CatalogRecommendationCapabilityResult } from "../capabilities/catalog-recommendation/types";
import type { ProductReference } from "../recommendation-context/types";
import { readHttpCatalogSearchProductsV2ClientConfig } from "@/lib/catalog/search-products-v2/httpCatalogSearchProductsV2Client";
import type { CapabilityExecutionOutcome, CapabilityGatewayContext, CapabilityGatewayDefinition } from "./types";

const CAPABILITY_GATEWAY_VERSION = "capability-gateway.v1" as const;

/**
 * Caller-facing input. Deliberately excludes masterCustomerId/customerId/
 * customerMode/recommendationContext/correlationId/signal - those are
 * runtime-owned (identity from trustedCustomerSession, correlation from
 * CapabilityGatewayContext, no AbortSignal exists on the Gateway context to
 * forward). `explicitRepurchaseRequested` IS forwarded to T10B7 (correction,
 * CP-R1-T10B8B review): T10B6 now accepts it as a top-level field on
 * `BuildSearchProductsV2RequestInput` (merged with the
 * recommendationContext-nested signal via OR, same shape as
 * `explicitExcludedProducts`) - see
 * lib/brain/commercial/recommendation-context/searchProductsV2RequestTypes.ts.
 * No `recommendationContext`/`CustomerRecommendationContext` is ever built
 * here (still explicitly out of scope), and no `masterCustomerId` is
 * required for this signal to apply in generic mode.
 */
export type RecommendCatalogProductsGatewayInput = {
  sourceProduct: ProductReference;
  query?: string;
  explicitRepurchaseRequested?: boolean;
  excludedProducts?: readonly ProductReference[];
  limit?: number;
  inStockOnly?: boolean;
};

/**
 * ACS-R1-05.1-T02.6.1-style contract: a JSON Schema (draft-07 subset) is
 * attached to `inputSchema` for structural documentation and future
 * agent-facing reuse, even though this capability is not yet in
 * AGENT_LOOP_TOOL_POOL and buildToolDescriptions() never reads it while that
 * remains true (confirmed: that function only iterates AGENT_LOOP_TOOL_POOL).
 * `execute()`'s own strict parser below remains the real runtime validator -
 * the Gateway itself never consults `inputSchema` to gate `execute()` (see
 * executeCapability.ts: no schema-validation step exists there for any
 * capability); this schema does not change that.
 */
export const RECOMMEND_CATALOG_PRODUCTS_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sourceProduct"],
  properties: {
    sourceProduct: {
      type: "object",
      additionalProperties: false,
      required: ["productId"],
      properties: {
        productId: { type: "number" },
        combinationId: { type: "number" }
      }
    },
    query: { type: "string" },
    explicitRepurchaseRequested: { type: "boolean" },
    excludedProducts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["productId"],
        properties: {
          productId: { type: "number" },
          combinationId: { type: "number" }
        }
      }
    },
    limit: { type: "integer", minimum: 1 },
    inStockOnly: { type: "boolean" }
  }
} as const;

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Structural parse only (shape/type) - business validity (positivity, base-product combinationId===0, etc.) is T10B6's job, never duplicated here. */
function asProductReference(value: unknown): ProductReference | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "productId" && key !== "combinationId") return null;
  }
  const productId = asFiniteNumber(record.productId);
  if (productId === null) return null;
  if (record.combinationId === undefined || record.combinationId === null) return { productId };
  const combinationId = asFiniteNumber(record.combinationId);
  if (combinationId === null) return null;
  return { productId, combinationId };
}

const ALLOWED_TOP_LEVEL_KEYS = new Set(["sourceProduct", "query", "explicitRepurchaseRequested", "excludedProducts", "limit", "inStockOnly"]);

type ParsedRecommendCatalogProductsInput = {
  sourceProduct: ProductReference;
  query?: string;
  explicitRepurchaseRequested?: boolean;
  excludedProducts?: ProductReference[];
  limit?: number;
  inStockOnly?: boolean;
};

type ParseInputResult = { ok: true; value: ParsedRecommendCatalogProductsInput } | { ok: false; errorCode: string };

function parseRecommendCatalogProductsInput(input: Record<string, unknown>): ParseInputResult {
  for (const key of Object.keys(input)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) return { ok: false, errorCode: "unsupported_field" };
  }

  const sourceProduct = asProductReference(input.sourceProduct);
  if (!sourceProduct) return { ok: false, errorCode: "source_product_required" };

  if (input.query !== undefined && input.query !== null && typeof input.query !== "string") {
    return { ok: false, errorCode: "invalid_query_type" };
  }
  if (input.explicitRepurchaseRequested !== undefined && typeof input.explicitRepurchaseRequested !== "boolean") {
    return { ok: false, errorCode: "invalid_explicit_repurchase_requested_type" };
  }
  if (input.limit !== undefined && typeof input.limit !== "number") {
    return { ok: false, errorCode: "invalid_limit_type" };
  }
  if (input.inStockOnly !== undefined && typeof input.inStockOnly !== "boolean") {
    return { ok: false, errorCode: "invalid_in_stock_only_type" };
  }

  let excludedProducts: ProductReference[] | undefined;
  if (input.excludedProducts !== undefined) {
    if (!Array.isArray(input.excludedProducts)) return { ok: false, errorCode: "invalid_excluded_products_type" };
    const parsed: ProductReference[] = [];
    for (const entry of input.excludedProducts) {
      const ref = asProductReference(entry);
      if (!ref) return { ok: false, errorCode: "invalid_excluded_product_entry" };
      parsed.push(ref);
    }
    excludedProducts = parsed;
  }

  return {
    ok: true,
    value: {
      sourceProduct,
      ...(typeof input.query === "string" ? { query: input.query } : {}),
      ...(typeof input.explicitRepurchaseRequested === "boolean" ? { explicitRepurchaseRequested: input.explicitRepurchaseRequested } : {}),
      ...(excludedProducts !== undefined ? { excludedProducts } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
      ...(typeof input.inStockOnly === "boolean" ? { inStockOnly: input.inStockOnly } : {})
    }
  };
}

/**
 * completed -> completed; skipped -> completed with a {status:"skipped",
 * reason} payload (never retryable, never a second call, reason preserved
 * verbatim - the Gateway's real CapabilityGatewayExecutionStatus union has
 * no "blocked" member, and this reuses the generic `data` field the
 * contract already supports, per the task's own stated preference); failed
 * -> failed, preserving code/retryable/httpStatus/providerErrorCode/message
 * (already-sanitized by T10B5) - never masterCustomerId, query,
 * sourceProduct, excludedProducts, request/response bodies, headers, or a
 * stack trace.
 */
function mapCatalogRecommendationResultToOutcome(result: CatalogRecommendationCapabilityResult): CapabilityExecutionOutcome {
  if (result.status === "completed") {
    return {
      status: "completed",
      data: {
        status: "completed",
        customerMode: result.customerMode,
        recommendations: result.recommendations,
        excluded: result.excluded,
        warnings: result.warnings,
        personalization: result.personalization,
        execution: result.execution,
        statistics: result.statistics,
        snapshot: result.snapshot,
        metadata: result.metadata
      },
      errorCode: null,
      retryable: false,
      evidence: [
        {
          source: "catalog_recommendation_capability",
          summary: `recommend_catalog_products returned ${result.recommendations.length} recommendation(s) (customerMode=${result.customerMode}).`,
          capturedAt: new Date().toISOString()
        }
      ]
    };
  }

  if (result.status === "skipped") {
    return {
      status: "completed",
      data: { status: "skipped", reason: result.reason },
      errorCode: null,
      retryable: false,
      evidence: []
    };
  }

  const error = result.error;
  return {
    status: "failed",
    data: {
      status: "failed",
      code: error.code,
      retryable: error.retryable,
      message: error.message,
      ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
      ...(error.providerErrorCode !== undefined ? { providerErrorCode: error.providerErrorCode } : {})
    },
    errorCode: error.code,
    retryable: error.retryable,
    evidence: [{ source: "catalog_search_products_v2", summary: error.message, capturedAt: new Date().toISOString() }]
  };
}

/**
 * DI factory (same style as searchProductsCapability(getPort) in
 * registry.ts) - takes an injected getter so unit tests can supply a fake
 * CatalogRecommendationCapability without any HTTP. Not registered under
 * AGENT_LOOP_TOOL_POOL by this task - see the release doc.
 */
export function recommendCatalogProductsCapability(getCapability: () => CatalogRecommendationCapability): CapabilityGatewayDefinition {
  return {
    capability: "recommend_catalog_products",
    version: CAPABILITY_GATEWAY_VERSION,
    description: "Internal: request catalog product recommendations for a known source product via SearchProducts V2. Not yet exposed to the model.",
    governance: { sideEffect: "read_only", authority: "autonomous", riskClass: "low" },
    inputSchema: RECOMMEND_CATALOG_PRODUCTS_INPUT_SCHEMA,
    // Preference per task section 14: avoid duplicated recommendation calls;
    // T10B5 makes exactly one physical HTTP call per invocation and owns no
    // retry of its own, T10B7 does not retry either.
    maxRetries: 0,
    async checkAvailability() {
      try {
        const config = readHttpCatalogSearchProductsV2ClientConfig();
        if (config === null) return { status: "unavailable", reason: "catalog_search_products_v2_not_configured" };
        return { status: "available", reason: null };
      } catch {
        return { status: "unavailable", reason: "catalog_search_products_v2_not_configured" };
      }
    },
    async execute(input, context: CapabilityGatewayContext) {
      const parsed = parseRecommendCatalogProductsInput(input);
      if (!parsed.ok) {
        return { status: "invalid_arguments", data: null, errorCode: parsed.errorCode, retryable: false, evidence: [] };
      }

      const resolution = context.trustedCustomerSession?.masterCustomerIdentity;
      const masterCustomerId = resolution?.status === "resolved" ? resolution.masterCustomerId : undefined;

      const result = await getCapability().execute({
        ...(masterCustomerId !== undefined ? { masterCustomerId } : {}),
        sourceProduct: parsed.value.sourceProduct,
        ...(parsed.value.query !== undefined ? { query: parsed.value.query } : {}),
        ...(parsed.value.explicitRepurchaseRequested !== undefined ? { explicitRepurchaseRequested: parsed.value.explicitRepurchaseRequested } : {}),
        ...(parsed.value.excludedProducts !== undefined ? { explicitExcludedProducts: parsed.value.excludedProducts } : {}),
        correlationId: context.correlationId,
        ...(parsed.value.limit !== undefined ? { limit: parsed.value.limit } : {}),
        ...(parsed.value.inStockOnly !== undefined ? { inStockOnly: parsed.value.inStockOnly } : {})
      });

      return mapCatalogRecommendationResultToOutcome(result);
    }
  };
}

let cachedCapability: CatalogRecommendationCapability | undefined;

/** Lazy module-level singleton (same pattern as getSharedCatalogPort in registry.ts) - constructed once, no fetch at construction, fail-closed via T10B5's own unavailable client when unconfigured. */
export function getSharedCatalogRecommendationCapability(): CatalogRecommendationCapability {
  if (!cachedCapability) cachedCapability = createProductionCatalogRecommendationCapability();
  return cachedCapability;
}

/** Test-only: force re-construction (e.g. after changing CATALOG_SERVICE_* env vars or injecting a fake). */
export function resetCatalogRecommendationCapabilityForTests() {
  cachedCapability = undefined;
}
