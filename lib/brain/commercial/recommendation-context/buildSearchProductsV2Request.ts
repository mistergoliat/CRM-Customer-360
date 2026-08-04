/**
 * CP-R1-T10B6: pure mapper from an already-resolved identity/source product
 * + CustomerRecommendationContext (CP-R1-T10B2) to a
 * SearchProductsV2ClientRequest (CP-R1-T10B5). No fetch, no SQL, no IO, no
 * Date.now, no random, no env, no logs, no input mutation. Does not call
 * Catalog Service, does not register a capability, does not touch the
 * Agent Loop - see
 * docs/releases/CP-R1-T10B6-identity-recommendation-context-wiring.md.
 */
import type { SearchProductsV2ClientRequest, SearchProductsV2ProductIdentity } from "../../../catalog/search-products-v2/types";
import type { BuildSearchProductsV2RequestInput, BuildSearchProductsV2RequestResult, BuildSearchProductsV2RequestSkipReason } from "./searchProductsV2RequestTypes";
import type { ProductReference } from "./types";

const MASTER_CUSTOMER_ID_PATTERN = /^[0-9]{1,20}$/;
const ALL_ZEROS_PATTERN = /^0+$/;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_QUERY_LENGTH = 240;
const MAX_CORRELATION_ID_LENGTH = 128;
const MAX_LIMIT = 20;

function skipped(reason: BuildSearchProductsV2RequestSkipReason): BuildSearchProductsV2RequestResult {
  return { status: "skipped", reason };
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

/**
 * Single conversion point for every product identity in this mapper
 * (source product, each exclusion, the repurchase entry) - never
 * duplicated inline elsewhere, per this task's explicit requirement.
 * `combinationId === 0` (Customer Profile's own "base product, no variant"
 * convention - the same field is called `productAttributeId` there, see
 * CP-R1-T10B2's `CustomerPurchasedProductEvidence`) is normalized to
 * "omit", exactly like `undefined`/`null` - it must never be sent to
 * Catalog Service as the literal string `"0"`, which would not represent
 * the base product and is never a real combination id.
 */
export function toSearchProductsV2ProductIdentity(ref: ProductReference): SearchProductsV2ProductIdentity | null {
  if (!isFiniteInteger(ref.productId) || ref.productId <= 0) return null;
  const productId = String(ref.productId);
  if (ref.combinationId === undefined || ref.combinationId === null) return { productId };
  if (!isFiniteInteger(ref.combinationId) || ref.combinationId < 0) return null;
  if (ref.combinationId === 0) return { productId };
  return { productId, combinationId: String(ref.combinationId) };
}

/** Product base (`{productId}`) and a specific variant (`{productId, combinationId}`) are distinct identities - never collapsed. */
function identityKey(identity: SearchProductsV2ProductIdentity): string {
  return `${identity.productId}::${identity.combinationId ?? ""}`;
}

type NormalizedOptionalString = { ok: true; value: string | undefined } | { ok: false };

function normalizeQuery(query: string | null | undefined): NormalizedOptionalString {
  if (query === null || query === undefined) return { ok: true, value: undefined };
  const trimmed = query.trim();
  if (trimmed.length === 0) return { ok: true, value: undefined };
  if (trimmed.length > MAX_QUERY_LENGTH) return { ok: false };
  return { ok: true, value: trimmed };
}

function normalizeCorrelationId(correlationId: string | null | undefined): NormalizedOptionalString {
  if (correlationId === null || correlationId === undefined) return { ok: true, value: undefined };
  const trimmed = correlationId.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CORRELATION_ID_LENGTH || !CORRELATION_ID_PATTERN.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

function normalizeMasterCustomerId(value: string | null | undefined): NormalizedOptionalString {
  if (value === null || value === undefined) return { ok: true, value: undefined };
  const trimmed = value.trim();
  if (!MASTER_CUSTOMER_ID_PATTERN.test(trimmed) || ALL_ZEROS_PATTERN.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
}

/**
 * Converts, validates and deduplicates a list of raw exclusions, preserving
 * first-appearance order. Deduplication runs on the CONVERTED identity, so
 * `{productId:5, combinationId:0}` and `{productId:5}` collapse into the
 * same entry (both mean "the base product"). Returns null (fail-closed) if
 * any entry is structurally invalid: sending a partial exclusion list
 * silently would change commercial intent - see section 15 of the task
 * brief for this explicit preference.
 */
function normalizeExcludedProducts(refs: readonly ProductReference[]): SearchProductsV2ProductIdentity[] | null {
  const result: SearchProductsV2ProductIdentity[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const identity = toSearchProductsV2ProductIdentity(ref);
    if (identity === null) return null;
    const key = identityKey(identity);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(identity);
  }
  return result;
}

function normalizeLimit(limit: number | undefined): { ok: true; value: number | undefined } | { ok: false } {
  if (limit === undefined) return { ok: true, value: undefined };
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { ok: false };
  return { ok: true, value: limit };
}

type CustomerIdentityResolution = { ok: true; value: string | undefined } | { ok: false; reason: "invalid_customer_identity" | "customer_identity_mismatch" };

/**
 * `masterCustomerId` can be supplied both as a top-level input field and
 * inside `recommendationContext` (a required field there). The two are
 * compatible only when they represent the same identity after
 * normalization:
 * - neither present -> generic mode (`undefined`);
 * - only one present -> used as-is (validated);
 * - both present -> each normalized independently first; a normalization
 *   failure on either side is `invalid_customer_identity` (checked before
 *   comparison); two different, both-valid normalized values is
 *   `customer_identity_mismatch` - neither is silently preferred.
 */
function resolveCustomerIdentity(input: BuildSearchProductsV2RequestInput): CustomerIdentityResolution {
  const contextValue = input.recommendationContext != null ? input.recommendationContext.masterCustomerId : undefined;
  const topValue = input.masterCustomerId ?? undefined;

  if (contextValue === undefined && topValue === undefined) return { ok: true, value: undefined };

  if (contextValue !== undefined && topValue !== undefined) {
    const contextNormalized = normalizeMasterCustomerId(contextValue);
    const topNormalized = normalizeMasterCustomerId(topValue);
    if (!contextNormalized.ok || !topNormalized.ok) return { ok: false, reason: "invalid_customer_identity" };
    if (contextNormalized.value !== topNormalized.value) return { ok: false, reason: "customer_identity_mismatch" };
    return { ok: true, value: contextNormalized.value };
  }

  const normalized = normalizeMasterCustomerId(contextValue ?? topValue);
  if (!normalized.ok) return { ok: false, reason: "invalid_customer_identity" };
  return { ok: true, value: normalized.value };
}

type SourceProductResolution = { ok: true; value: SearchProductsV2ProductIdentity | null } | { ok: false; reason: "source_product_invalid" | "source_product_mismatch" };

/**
 * Same duplicated-source compatibility rule as `resolveCustomerIdentity`,
 * applied to the source product: compared by exact runtime identity after
 * conversion via `toSearchProductsV2ProductIdentity` (so `combinationId: 0`
 * on either side is already normalized to "the base product" before the
 * comparison - a base and its own variant are always distinct, per that
 * helper's own rules).
 */
function resolveSourceProductIdentity(input: BuildSearchProductsV2RequestInput): SourceProductResolution {
  const contextRef: ProductReference | null = input.recommendationContext != null ? input.recommendationContext.recommendationIntent.sourceProduct : null;
  const topRef: ProductReference | null = input.sourceProduct ?? null;

  if (contextRef === null && topRef === null) return { ok: true, value: null };

  if (contextRef !== null && topRef !== null) {
    const contextIdentity = toSearchProductsV2ProductIdentity(contextRef);
    const topIdentity = toSearchProductsV2ProductIdentity(topRef);
    if (contextIdentity === null || topIdentity === null) return { ok: false, reason: "source_product_invalid" };
    if (identityKey(contextIdentity) !== identityKey(topIdentity)) return { ok: false, reason: "source_product_mismatch" };
    return { ok: true, value: contextIdentity };
  }

  const identity = toSearchProductsV2ProductIdentity((contextRef ?? topRef) as ProductReference);
  if (identity === null) return { ok: false, reason: "source_product_invalid" };
  return { ok: true, value: identity };
}

/**
 * Deterministic validation order (documented explicitly, see the release
 * doc's "Validation order"): (1-2) customer identity + mismatch, (3-4)
 * source product + mismatch, (5) query, (6) correlation id, (7) limit/
 * filters, (8) exclusions, (9) exclusion-vs-repurchase contradiction, (10)
 * build the request. `explicitExcludedProducts` is the one duplicated field
 * NOT subject to the mismatch rule above: both the context's list and the
 * top-level list are legitimate, independent sources and are merged (task
 * brief section 15), never compared for disagreement.
 */
export function buildSearchProductsV2Request(input: BuildSearchProductsV2RequestInput): BuildSearchProductsV2RequestResult {
  const customerResolution = resolveCustomerIdentity(input);
  if (!customerResolution.ok) return skipped(customerResolution.reason);
  const masterCustomerId = customerResolution.value;

  const sourceResolution = resolveSourceProductIdentity(input);
  if (!sourceResolution.ok) return skipped(sourceResolution.reason);
  if (sourceResolution.value === null) return skipped("source_product_missing");
  const sourceProductIdentity = sourceResolution.value;

  const normalizedQuery = normalizeQuery(input.query);
  if (!normalizedQuery.ok) return skipped("invalid_query");

  const normalizedCorrelationId = normalizeCorrelationId(input.correlationId);
  if (!normalizedCorrelationId.ok) return skipped("invalid_correlation_id");

  const normalizedLimit = normalizeLimit(input.limit);
  if (!normalizedLimit.ok) return skipped("invalid_limit");

  const rawExclusions = [...(input.recommendationContext?.recommendationIntent.explicitExcludedProducts ?? []), ...(input.explicitExcludedProducts ?? [])];
  const excludedProducts = normalizeExcludedProducts(rawExclusions);
  if (excludedProducts === null) return skipped("invalid_excluded_product");

  // v1-frozen rule: explicit repurchase only ever targets the exact source
  // product - never derived from ownership, matchingPurchases, or repeat
  // purchase behavior.
  const explicitRepurchaseRequested = input.recommendationContext?.recommendationIntent.explicitRepurchaseRequested ?? false;
  const explicitRepurchaseProducts = explicitRepurchaseRequested ? [sourceProductIdentity] : [];

  // Contradiction: the source product (the repurchase target) is also in
  // the exclusion list. Evaluated by exact runtime identity - a variant
  // exclusion never contradicts a base-product repurchase, or vice versa.
  if (explicitRepurchaseRequested && excludedProducts.some((excluded) => identityKey(excluded) === identityKey(sourceProductIdentity))) {
    return skipped("contradictory_product_context");
  }

  const context: SearchProductsV2ClientRequest["context"] =
    masterCustomerId !== undefined || excludedProducts.length > 0 || explicitRepurchaseProducts.length > 0
      ? {
          ...(masterCustomerId !== undefined ? { customerId: masterCustomerId } : {}),
          ...(excludedProducts.length > 0 ? { excludedProducts } : {}),
          ...(explicitRepurchaseProducts.length > 0 ? { explicitRepurchaseProducts } : {})
        }
      : undefined;

  const request: SearchProductsV2ClientRequest = {
    sourceProduct: sourceProductIdentity,
    ...(normalizedQuery.value !== undefined ? { query: normalizedQuery.value } : {}),
    ...(masterCustomerId !== undefined ? { customer: { customerId: masterCustomerId } } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(input.inStockOnly !== undefined ? { filters: { inStockOnly: input.inStockOnly } } : {}),
    ...(normalizedLimit.value !== undefined ? { limit: normalizedLimit.value } : {})
  };

  return {
    status: "ready",
    request,
    callContext: normalizedCorrelationId.value !== undefined ? { correlationId: normalizedCorrelationId.value } : {},
    metadata: {
      customerMode: masterCustomerId !== undefined ? "identified" : "generic",
      explicitRepurchaseApplied: explicitRepurchaseProducts.length > 0,
      excludedProductCount: excludedProducts.length
    }
  };
}
