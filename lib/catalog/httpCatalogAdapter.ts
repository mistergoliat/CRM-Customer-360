/**
 * HTTP adapter for MS-pesaschile-catalog-service (real, read-only PrestaShop
 * catalog microservice - see its README for the authoritative contract).
 * Endpoints, headers and error codes below mirror that service's actual
 * Fastify routes and shared/contracts.ts schemas exactly, ported here (not
 * imported as a dependency) so this repo stays free of a cross-repo package.
 */
import {
  CATALOG_ADAPTER_CONTRACT_VERSION,
  CATALOG_EXPLORE_AVAILABILITY_FILTERS,
  CATALOG_EXPLORE_CLASSIFICATION_SOURCES,
  CATALOG_EXPLORE_SORT_DIRECTIONS,
  CATALOG_EXPLORE_SORT_FIELDS,
  CATALOG_EXPLORE_STOCK_SCOPES,
  CATALOG_SEMANTIC_DISCOVERY_AXES,
  CATALOG_PRODUCT_SEMANTICS_ONTOLOGY_VERSION,
  CATALOG_PRODUCT_SEMANTICS_SCHEMA_VERSION,
  CATALOG_SEMANTIC_DISCOVERY_SCHEMA_VERSION,
  CATALOG_SEMANTIC_DISCOVERY_PRODUCT_AXES,
  CATALOG_TRAINING_SEMANTICS_REGISTRY_VERSION,
  CATALOG_TRAINING_SEMANTICS_SCHEMA_VERSION,
  type CatalogAttribute,
  type CatalogAvailabilityStatus,
  type CatalogBatchItemInput,
  type CatalogBatchItemResult,
  type CatalogBatchResult,
  type CatalogExploreAvailabilityFilter,
  type CatalogExploreClassificationSource,
  type CatalogExploreInput,
  type CatalogExploreItem,
  type CatalogExploreResult,
  type CatalogExploreScope,
  type CatalogExploreSort,
  type CatalogExploreSortDirection,
  type CatalogExploreSortField,
  type CatalogExploreStockScope,
  type CatalogPort,
  type CatalogPortError,
  type CatalogPortErrorCode,
  type CatalogPortResult,
  type CatalogProduct,
  type CatalogProductSemantics,
  type CatalogProductSemanticsExclusion,
  type CatalogProductSemanticsRegistry,
  type CatalogProductVariant,
  type CatalogRequestContext,
  type CatalogSearchResult,
  type CatalogSearchResultItem,
  type CatalogSemanticDiscoveryAxis,
  type CatalogSemanticDiscoveryEvidence,
  type CatalogSemanticDiscoveryInput,
  type CatalogSemanticDiscoveryLineage,
  type CatalogSemanticDiscoveryMatchedRequirement,
  type CatalogSemanticDiscoveryProductTag,
  type CatalogSemanticDiscoveryProductAxis,
  type CatalogSemanticDiscoveryProductFact,
  type CatalogSemanticDiscoverySemanticAssignment,
  type CatalogSemanticDiscoveryExerciseCapabilityAssignment,
  type CatalogSemanticDiscoveryResult,
  type CatalogSemanticDiscoveryResultItem,
  type CatalogSemanticDiscoveryTrainingFact,
  type CatalogSemanticRegistryValue,
  type CatalogTrainingSemanticExerciseCapability,
  type CatalogTrainingSemanticExerciseDerivedRelation,
  type CatalogTrainingSemanticFamilyTrainingFunctionDerivation,
  type CatalogTrainingSemanticFunction,
  type CatalogTrainingSemanticBoundaries,
  type CatalogTrainingSemanticsRegistry,
  type ProductIntentCandidate,
  type ProductIntentCandidateProduct,
  type ProductIntentClarification,
  type ProductIntentClarificationDimension,
  type ProductIntentClarificationOption,
  type ProductIntentPrice,
  type ProductIntentReference,
  type ProductIntentResolutionResult,
  type ProductIntentResolutionStatus,
  type ProductIntentStock,
  type ProductIntentStockStatus,
  type ProductIntentWarning,
  type ProductPublicLink,
  type ProductSemanticClassificationStatus,
  PRODUCT_INTENT_CLARIFICATION_DIMENSIONS,
  PRODUCT_INTENT_RESOLUTION_STATUSES,
  PRODUCT_INTENT_STOCK_STATUSES,
  PRODUCT_SEMANTIC_CLASSIFICATION_STATUSES
} from "./types";

/** Real service contract (POST /v1/products/batch): max 20 items per call. */
export const CATALOG_BATCH_MAX_ITEMS = 20;

export type HttpCatalogAdapterConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
};

const DEFAULT_TIMEOUT_MS = 5000;
const PUBLIC_LINK_SCOPES = ["exact_product", "parent_product"] as const;
const PUBLIC_LINK_UNAVAILABLE_REASONS = ["missing_link_rewrite", "invalid_product_id", "invalid_base_url"] as const;

export function readHttpCatalogAdapterConfig(): HttpCatalogAdapterConfig | null {
  const baseUrl = process.env.CATALOG_SERVICE_BASE_URL?.trim();
  const apiKey = process.env.CATALOG_SERVICE_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  const timeoutMs = Number.parseInt(process.env.CATALOG_SERVICE_TIMEOUT_MS?.trim() ?? "", 10);
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parsePublicLinkLabels(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const labels: string[] = [];
  for (const label of value) {
    if (typeof label !== "string") return null;
    labels.push(label);
  }
  return labels;
}

function parsePublicLink(value: unknown): ProductPublicLink | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;

  const canonicalUrl = value.canonicalUrl;
  if (canonicalUrl !== null && typeof canonicalUrl !== "string") return undefined;
  if (canonicalUrl !== null) {
    try {
      const parsed = new URL(canonicalUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    } catch {
      return undefined;
    }
  }

  const scope = asString(value.scope);
  if (!(PUBLIC_LINK_SCOPES as readonly string[]).includes(scope ?? "")) return undefined;

  if (typeof value.available !== "boolean") return undefined;
  if (value.available === true && canonicalUrl === null) return undefined;
  if (typeof value.requiresVariantSelection !== "boolean") return undefined;

  const variantAttributeLabels = parsePublicLinkLabels(value.variantAttributeLabels);
  if (variantAttributeLabels === null) return undefined;

  const unavailableReason = asString(value.unavailableReason);
  if (value.unavailableReason !== undefined && !(PUBLIC_LINK_UNAVAILABLE_REASONS as readonly string[]).includes(unavailableReason ?? "")) {
    return undefined;
  }

  return {
    canonicalUrl,
    scope: scope as ProductPublicLink["scope"],
    available: value.available,
    ...(unavailableReason !== null ? { unavailableReason: unavailableReason as ProductPublicLink["unavailableReason"] } : {}),
    requiresVariantSelection: value.requiresVariantSelection,
    variantAttributeLabels
  };
}

function sanitizeErrorMessage(message: string, secret?: string): string {
  // Defence in depth: the adapter never interpolates the API key into an
  // error, but strip anything header-shaped just in case a provider echoes
  // request context back in a message.
  const withoutConfiguredSecret = secret && secret.length > 0 ? message.split(secret).join("[redacted]") : message;
  return withoutConfiguredSecret
    .replace(/x-api-key['":\s]*[^\s,;"']+/gi, "x-api-key=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}

function catalogError(code: CatalogPortErrorCode, message: string, retryable: boolean, providerErrorCode?: string | null, correlationId?: string | null, secret?: string): CatalogPortError {
  return { code, message: sanitizeErrorMessage(message, secret), retryable, providerErrorCode: providerErrorCode === undefined || providerErrorCode === null ? null : sanitizeErrorMessage(providerErrorCode, secret), correlationId: correlationId ?? null };
}

function mapProviderErrorCode(providerCode: string | undefined, httpStatus: number): { code: CatalogPortErrorCode; retryable: boolean } {
  switch (providerCode) {
    case "INVALID_INPUT":
      return { code: "invalid_input", retryable: false };
    case "UNAUTHORIZED":
      return { code: "unauthorized", retryable: false };
    case "RATE_LIMITED":
      return { code: "rate_limited", retryable: true };
    case "PRODUCT_NOT_FOUND":
    case "COMBINATION_NOT_FOUND":
      return { code: "not_found", retryable: false };
    case "AMBIGUOUS_PRODUCT":
      return { code: "invalid_input", retryable: false };
    case "PRICE_UNAVAILABLE":
    case "STOCK_UNAVAILABLE":
    case "DATABASE_UNAVAILABLE":
    case "CATALOG_QUERY_FAILED":
    case "INTERNAL_ERROR":
      return { code: "unavailable", retryable: true };
    // POST /v1/products/explore uses its own lower_snake error vocabulary
    // (confirmed by probing the real service - never seen documented in a
    // schema), distinct from the UPPER_SNAKE codes above used by
    // search/details/batch. Without these, a 400 from a bad model-supplied
    // sort/limit/price range fell through to the generic `invalid_response`
    // branch below (wrong: that code means "unexpected payload shape", not
    // "request rejected"), which the gateway then treats as a hard `failed`
    // instead of a replannable `invalid_arguments`.
    case "invalid_limit":
    case "invalid_sort":
    case "invalid_request":
      return { code: "invalid_input", retryable: false };
    // POST /api/v2/catalog/resolve-product-intent (T12) uses its own
    // UPPER_SNAKE vocabulary, distinct from both the codes above and from
    // the legacy search/details/batch ones (confirmed against
    // MS-pesaschile-catalog-service's ProductIntentResolutionError/
    // resolveProductIntentController.ts). INVALID_REQUEST is a 400 (bad
    // input), INVALID_CATALOG_RESULT is a 422 (T12 could not map its own
    // retrieval into the public contract - a provider defect, not a client
    // one), CATALOG_SEARCH_UNAVAILABLE is a 503. INTERNAL_ERROR already
    // falls into the shared "unavailable"/retryable case below.
    case "INVALID_REQUEST":
      return { code: "invalid_input", retryable: false };
    case "INVALID_CATALOG_RESULT":
      return { code: "invalid_response", retryable: false };
    case "CATALOG_SEARCH_UNAVAILABLE":
      return { code: "unavailable", retryable: true };
    // POST /v1/products/semantic-discovery/query and the GET .../registry
    // endpoints (SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4) use their own
    // UPPER_SNAKE vocabulary, confirmed against MS-pesaschile-catalog-service's
    // src/shared/errors.ts. *_SNAPSHOT_MISMATCH occurs when an explicitly
    // supplied `expectedSnapshots` pin is stale; it is mapped defensively as
    // retryable so the caller can refresh its authority before retrying.
    case "INVALID_SEMANTIC_DISCOVERY_REQUEST":
      return { code: "invalid_input", retryable: false };
    case "PRODUCT_SEMANTICS_UNAVAILABLE":
    case "TRAINING_SEMANTICS_UNAVAILABLE":
    case "PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH":
    case "TRAINING_SEMANTIC_SNAPSHOT_MISMATCH":
      return { code: "unavailable", retryable: true };
    default:
      if (httpStatus >= 500) return { code: "unavailable", retryable: true };
      if (httpStatus === 401 || httpStatus === 403) return { code: "unauthorized", retryable: false };
      if (httpStatus === 400) return { code: "invalid_input", retryable: false };
      if (httpStatus === 409) return { code: "unavailable", retryable: true };
      if (httpStatus === 404) return { code: "not_found", retryable: false };
      if (httpStatus === 429) return { code: "rate_limited", retryable: true };
      return { code: "invalid_response", retryable: false };
  }
}

function toAvailability(available: unknown): CatalogAvailabilityStatus {
  if (typeof available !== "boolean") return "unknown";
  return available ? "in_stock" : "out_of_stock";
}

function parseAttributes(value: unknown): CatalogAttribute[] {
  if (!Array.isArray(value)) return [];
  const attributes: CatalogAttribute[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const group = asString(entry.group);
    const attrValue = asString(entry.value);
    if (group !== null && attrValue !== null) attributes.push({ group, value: attrValue });
  }
  return attributes;
}

function parseVariant(value: unknown, isDefault: boolean): CatalogProductVariant | null {
  if (!isRecord(value)) return null;
  const combinationId = asNumber(value.combinationId);
  if (combinationId === null) return null;
  return {
    variantId: String(combinationId),
    sku: asString(value.sku),
    label: asString(value.label),
    attributes: parseAttributes(value.attributes),
    priceImpact: asNumber(value.impactPrice),
    stockQuantity: asNumber(value.physicalQuantity),
    availability: toAvailability(value.available),
    isDefault
  };
}

function parseSearchItem(value: unknown): CatalogSearchResultItem | null {
  if (!isRecord(value)) return null;
  const productId = asNumber(value.productId);
  const combinationId = asNumber(value.combinationId);
  const name = asString(value.name);
  const matchType = asString(value.matchType);
  if (productId === null || combinationId === null || name === null) return null;
  const validMatchTypes = ["exact_sku", "exact_name", "partial_name", "description"] as const;
  const normalizedMatchType = (validMatchTypes as readonly string[]).includes(matchType ?? "")
    ? (matchType as CatalogSearchResultItem["matchType"])
    : "description";
  return {
    productId: String(productId),
    combinationId: String(combinationId),
    sku: asString(value.sku),
    name,
    variantLabel: asString(value.variantLabel),
    shortDescription: asString(value.shortDescription),
    stockQuantity: asNumber(value.physicalQuantity),
    availability: toAvailability(value.available),
    matchType: normalizedMatchType
  };
}

function parseSearchResponse(payload: unknown, retrievedAt: string): CatalogSearchResult | null {
  if (!isRecord(payload)) return null;
  const query = asString(payload.query);
  if (query === null || !Array.isArray(payload.items)) return null;
  const items = payload.items.map(parseSearchItem).filter((item): item is CatalogSearchResultItem => item !== null);
  const freshness = isRecord(payload.freshness) ? payload.freshness : {};
  return {
    query,
    items,
    provenance: { source: "catalog_service_http", retrievedAt, cached: asBoolean(freshness.cached) }
  };
}

function parseProductResponse(payload: unknown, retrievedAt: string): CatalogProduct | null {
  if (!isRecord(payload) || !isRecord(payload.product)) return null;
  const product = payload.product;
  const productId = asNumber(product.productId);
  const name = asString(product.name);
  if (productId === null || name === null) return null;

  const variants = Array.isArray(payload.variants)
    ? payload.variants
        .map((entry) => (isRecord(entry) ? parseVariant(entry, asBoolean(entry.isDefault)) : null))
        .filter((variant): variant is CatalogProductVariant => variant !== null)
    : [];
  const selectedVariant = isRecord(payload.selectedVariant) ? parseVariant(payload.selectedVariant, true) : null;

  const pricing = isRecord(payload.pricing) ? payload.pricing : null;
  const price = pricing
    ? {
        amount: asNumber(pricing.effectiveUnitPrice),
        currency: asString(pricing.currency),
        taxIncluded: typeof pricing.taxIncluded === "boolean" ? pricing.taxIncluded : null,
        // SALES-AGENT-R1-T1.1: additive V1 field (CAT-side migration, sole
        // configured-rate source) - never defaulted/inferred when absent.
        taxRate: asNumber(pricing.taxRate),
        discountApplied: asBoolean(pricing.discountApplied)
      }
    : null;

  const stock = isRecord(payload.stock) ? payload.stock : null;
  const availability = stock ? toAvailability(stock.available) : "unknown";
  const stockQuantity = stock ? asNumber(stock.physicalQuantity) : null;

  const freshness = isRecord(payload.freshness) ? payload.freshness : {};
  const publicLink = parsePublicLink(payload.publicLink);
  // CRM-R1-T13E: sibling of pricing/stock on the payload, not nested under
  // `product` - matches MS-Stock/services CAT-R1-T13B contract exactly.
  const weightKg = asNumber(payload.weightKg);

  return {
    productId: String(productId),
    name,
    sku: asString(product.sku),
    shortDescription: asString(product.shortDescription),
    longDescription: asString(product.longDescription),
    active: asBoolean(product.active, true),
    selectedVariant,
    variants,
    price,
    availability,
    stockQuantity,
    weightKg,
    ...(publicLink !== undefined ? { publicLink } : {}),
    provenance: { source: "catalog_service_http", retrievedAt, cached: asBoolean(freshness.cached) }
  };
}

function parseBatchItemInput(value: unknown): CatalogBatchItemInput | null {
  if (!isRecord(value)) return null;
  const productId = asNumber(value.productId);
  if (productId === null) return null;
  const combinationId = asNumber(value.combinationId);
  const quantity = asNumber(value.quantity);
  return {
    productId: String(productId),
    ...(combinationId !== null ? { combinationId: String(combinationId) } : {}),
    ...(quantity !== null ? { quantity } : {})
  };
}

function parseBatchItem(value: unknown, retrievedAt: string): CatalogBatchItemResult | null {
  if (!isRecord(value)) return null;
  const input = parseBatchItemInput(value.input);
  if (input === null) return null;

  if (value.ok === true) {
    const product = parseProductResponse(value.product, retrievedAt);
    if (product === null) return null;
    return { ok: true, input, product };
  }

  if (value.ok === false) {
    const errorBody = isRecord(value.error) ? value.error : null;
    const providerErrorCode = errorBody ? asString(errorBody.code) ?? undefined : undefined;
    const message = errorBody ? asString(errorBody.message) ?? "Batch item failed." : "Batch item failed.";
    const mapped = mapProviderErrorCode(providerErrorCode, 200);
    return {
      ok: false,
      input,
      error: catalogError(mapped.code, message, mapped.retryable, providerErrorCode ?? null, errorBody ? asString(errorBody.correlationId) : null)
    };
  }

  return null;
}

function parseBatchResponse(payload: unknown, retrievedAt: string): CatalogBatchResult | null {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return null;
  const items = payload.items.map((entry) => parseBatchItem(entry, retrievedAt)).filter((item): item is CatalogBatchItemResult => item !== null);
  if (items.length !== payload.items.length) return null;
  return {
    items,
    provenance: { source: "catalog_service_http", retrievedAt, cached: false }
  };
}

/**
 * Explicit key-by-key allowlist - never spreads the caller's input object
 * onto the request body. This is the closed schema the capability layer
 * relies on: even if a caller's CatalogExploreInput somehow carried an extra
 * property, it would never reach the real service (which itself tolerates
 * unknown fields silently - see ACS-R1-05.1-T02.6 audit).
 */
function buildExploreRequestBody(input: CatalogExploreInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    sort: { by: input.sort.by, direction: input.sort.direction },
    limit: input.limit
  };
  if (input.query !== undefined) body.query = input.query;
  if (input.categoryId !== undefined) body.categoryId = input.categoryId;
  if (input.categorySlug !== undefined) body.categorySlug = input.categorySlug;
  if (input.productType !== undefined) body.productType = input.productType;
  if (input.availability !== undefined) body.availability = input.availability;
  if (input.price !== undefined) {
    const price: Record<string, unknown> = {};
    if (input.price.min !== undefined) price.min = input.price.min;
    if (input.price.max !== undefined) price.max = input.price.max;
    if (Object.keys(price).length > 0) body.price = price;
  }
  return body;
}

function parseExploreSort(value: unknown): CatalogExploreSort | null {
  if (!isRecord(value)) return null;
  const by = asString(value.by);
  const direction = asString(value.direction);
  if (by === null || !(CATALOG_EXPLORE_SORT_FIELDS as readonly string[]).includes(by)) return null;
  if (direction === null || !(CATALOG_EXPLORE_SORT_DIRECTIONS as readonly string[]).includes(direction)) return null;
  return { by: by as CatalogExploreSortField, direction: direction as CatalogExploreSortDirection };
}

function parseExploreScope(value: unknown): CatalogExploreScope | null {
  if (!isRecord(value)) return null;
  const availability = asString(value.availability);
  if (availability === null || !(CATALOG_EXPLORE_AVAILABILITY_FILTERS as readonly string[]).includes(availability)) return null;
  const query = asString(value.query);
  const categoryId = asString(value.categoryId);
  const categorySlug = asString(value.categorySlug);
  const productType = asString(value.productType);
  return {
    ...(query !== null ? { query } : {}),
    ...(categoryId !== null ? { categoryId } : {}),
    ...(categorySlug !== null ? { categorySlug } : {}),
    ...(productType !== null ? { productType } : {}),
    availability: availability as CatalogExploreAvailabilityFilter
  };
}

function parseExploreItem(value: unknown): CatalogExploreItem | null {
  if (!isRecord(value)) return null;
  // Unlike search/details/batch, the explore endpoint's own contract already
  // sends productId as a string (confirmed against
  // mistergoliat/MS-pesaschile-catalog-service main@147794b/feature@efc2f7e) -
  // never re-coerced through asNumber.
  const productId = asString(value.productId);
  const name = asString(value.name);
  const currency = asString(value.currency);
  const availability = asString(value.availability);
  const stockScope = asString(value.stockScope);
  if (productId === null || name === null || currency === null || availability === null) return null;
  if (stockScope === null || !(CATALOG_EXPLORE_STOCK_SCOPES as readonly string[]).includes(stockScope)) return null;
  return {
    productId,
    name,
    price: asNumber(value.price),
    currency,
    stockQuantity: asNumber(value.stockQuantity),
    stockScope: stockScope as CatalogExploreStockScope,
    availability
  };
}

function parseExploreResponse(payload: unknown, retrievedAt: string): CatalogExploreResult | null {
  if (!isRecord(payload) || !Array.isArray(payload.products)) return null;
  const scope = parseExploreScope(payload.scope);
  const sort = parseExploreSort(payload.sort);
  const totalMatched = asNumber(payload.totalMatched);
  if (scope === null || sort === null || totalMatched === null || typeof payload.exhaustiveForScope !== "boolean") return null;

  const items = payload.products.map(parseExploreItem).filter((item): item is CatalogExploreItem => item !== null);
  if (items.length !== payload.products.length) return null;

  const classificationSource = asString(payload.classificationSource);
  const validClassificationSource =
    classificationSource !== null && (CATALOG_EXPLORE_CLASSIFICATION_SOURCES as readonly string[]).includes(classificationSource)
      ? (classificationSource as CatalogExploreClassificationSource)
      : null;

  return {
    scope,
    sort,
    totalMatched,
    exhaustiveForScope: payload.exhaustiveForScope,
    ...(validClassificationSource !== null ? { classificationSource: validClassificationSource } : {}),
    items,
    provenance: { source: "catalog_service_http", retrievedAt, cached: false }
  };
}

function parseProductIntentReference(value: unknown): ProductIntentReference | null {
  if (!isRecord(value)) return null;
  const productId = asString(value.productId);
  if (productId === null) return null;
  const combinationId = asString(value.combinationId);
  return { productId, ...(combinationId !== null ? { combinationId } : {}) };
}

function parseProductIntentPrice(value: unknown): ProductIntentPrice | null {
  if (!isRecord(value)) return null;
  const amount = asNumber(value.amount);
  const currency = asString(value.currency);
  if (amount === null || currency === null) return null;
  return { amount, currency };
}

function parseProductIntentStock(value: unknown): ProductIntentStock | null {
  if (!isRecord(value)) return null;
  const status = asString(value.status);
  if (status === null || !(PRODUCT_INTENT_STOCK_STATUSES as readonly string[]).includes(status)) return null;
  if (typeof value.available !== "boolean") return null;
  const quantity = asNumber(value.quantity);
  return { status: status as ProductIntentStockStatus, available: value.available, ...(quantity !== null ? { quantity } : {}) };
}

function parseProductIntentCandidateProduct(value: unknown): ProductIntentCandidateProduct | null {
  if (!isRecord(value)) return null;
  const productId = asString(value.productId);
  const name = asString(value.name);
  const stock = parseProductIntentStock(value.stock);
  if (productId === null || name === null || stock === null) return null;
  const combinationId = asString(value.combinationId);
  const reference = asString(value.reference);
  const description = asString(value.description);
  // price is nullable at the source (contracts.ts: productIntentPriceSchema.nullable()) -
  // distinct from "absent" elsewhere, so an explicit null is preserved, never coerced away.
  const price = value.price === null ? null : parseProductIntentPrice(value.price);
  if (value.price !== null && value.price !== undefined && price === null) return null;
  const publicLink = parsePublicLink(value.publicLink);
  return {
    productId,
    ...(combinationId !== null ? { combinationId } : {}),
    name,
    ...(reference !== null ? { reference } : {}),
    ...(description !== null ? { description } : {}),
    price,
    stock,
    ...(publicLink !== undefined ? { publicLink } : {})
  };
}

function parseProductIntentReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseProductIntentCandidate(value: unknown): ProductIntentCandidate | null {
  if (!isRecord(value)) return null;
  const product = parseProductIntentCandidateProduct(value.product);
  const match = isRecord(value.match) ? value.match : null;
  if (product === null || match === null) return null;
  const rank = asNumber(match.rank);
  const score = asNumber(match.score);
  if (rank === null || score === null) return null;
  return { product, rank, score, reasons: parseProductIntentReasons(match.reasons) };
}

function parseProductIntentClarificationOption(value: unknown): ProductIntentClarificationOption | null {
  if (!isRecord(value)) return null;
  const optionValue = asString(value.value);
  const label = asString(value.label);
  if (optionValue === null || label === null || !Array.isArray(value.productIds)) return null;
  const productIds = value.productIds.filter((entry): entry is string => typeof entry === "string");
  if (productIds.length !== value.productIds.length) return null;
  return { value: optionValue, label, productIds };
}

function parseProductIntentClarification(value: unknown): ProductIntentClarification | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const dimension = asString(value.dimension);
  if (dimension === null || !(PRODUCT_INTENT_CLARIFICATION_DIMENSIONS as readonly string[]).includes(dimension)) return undefined;
  if (!Array.isArray(value.options)) return undefined;
  const options = value.options.map(parseProductIntentClarificationOption).filter((option): option is ProductIntentClarificationOption => option !== null);
  if (options.length !== value.options.length) return undefined;
  return { dimension: dimension as ProductIntentClarificationDimension, options };
}

function parseProductIntentWarning(value: unknown): ProductIntentWarning | null {
  if (!isRecord(value)) return null;
  const code = asString(value.code);
  if (code === null) return null;
  const details = isRecord(value.details) ? value.details : undefined;
  return { code, ...(details !== undefined ? { details } : {}) };
}

function parseProductIntentResponse(payload: unknown, retrievedAt: string): ProductIntentResolutionResult | null {
  if (!isRecord(payload)) return null;
  const query = isRecord(payload.query) ? payload.query : null;
  const original = query ? asString(query.original) : null;
  const normalized = query ? asString(query.normalized) : null;
  if (original === null || normalized === null) return null;

  const resolutionRaw = isRecord(payload.resolution) ? payload.resolution : null;
  const status = resolutionRaw ? asString(resolutionRaw.status) : null;
  const confidence = resolutionRaw ? asNumber(resolutionRaw.confidence) : null;
  if (status === null || !(PRODUCT_INTENT_RESOLUTION_STATUSES as readonly string[]).includes(status) || confidence === null) return null;
  const sourceProduct = resolutionRaw && resolutionRaw.sourceProduct !== undefined ? parseProductIntentReference(resolutionRaw.sourceProduct) : null;
  // Contract invariant (contracts.ts's resolveProductIntentResultSchema
  // superRefine): "resolved" always carries sourceProduct, no other status
  // ever does. A violation here means T12 broke its own contract - treated
  // as an unparseable response (never guessed) so the caller gets
  // invalid_response/failed instead of silently proceeding without evidence.
  if (status === "resolved" && sourceProduct === null) return null;

  if (!Array.isArray(payload.candidates)) return null;
  const candidates = payload.candidates.map(parseProductIntentCandidate).filter((candidate): candidate is ProductIntentCandidate => candidate !== null);
  if (candidates.length !== payload.candidates.length) return null;

  const clarification = parseProductIntentClarification(payload.clarification);
  if (status === "clarification_required" && clarification === undefined) return null;

  const statistics = isRecord(payload.statistics) ? payload.statistics : null;
  const retrieved = statistics ? asNumber(statistics.retrieved) : null;
  const eligible = statistics ? asNumber(statistics.eligible) : null;
  const returned = statistics ? asNumber(statistics.returned) : null;
  if (retrieved === null || eligible === null || returned === null) return null;

  if (!Array.isArray(payload.warnings)) return null;
  const warnings = payload.warnings.map(parseProductIntentWarning).filter((warning): warning is ProductIntentWarning => warning !== null);
  if (warnings.length !== payload.warnings.length) return null;

  return {
    query: { original, normalized },
    resolution: { status: status as ProductIntentResolutionStatus, confidence, ...(sourceProduct !== null ? { sourceProduct } : {}) },
    candidates,
    ...(clarification !== undefined ? { clarification } : {}),
    statistics: { retrieved, eligible, returned },
    warnings,
    provenance: { source: "catalog_service_http", retrievedAt, cached: false }
  };
}

/** Reads only `code` off an ontology tag object - axis/confidence/ruleId are upstream audit detail this console does not render. */
function parseOntologyTagCode(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return asString(value.code);
}

function parseOntologyTagCodes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const codes: string[] = [];
  for (const entry of value) {
    const code = parseOntologyTagCode(entry);
    if (code === null) return null;
    codes.push(code);
  }
  return codes;
}

function parseSemanticsExclusion(value: unknown): CatalogProductSemanticsExclusion | null {
  if (!isRecord(value)) return null;
  const ruleId = asString(value.ruleId);
  const reason = asString(value.reason);
  if (ruleId === null || reason === null) return null;
  return { ruleId, reason };
}

function parseProductSemanticsResponse(payload: unknown, retrievedAt: string): CatalogProductSemantics | null {
  if (!isRecord(payload)) return null;
  const productId = asNumber(payload.productId);
  const classificationStatus = asString(payload.classificationStatus);
  if (productId === null || classificationStatus === null) return null;
  if (!(PRODUCT_SEMANTIC_CLASSIFICATION_STATUSES as readonly string[]).includes(classificationStatus)) return null;

  const primaryProductFamily = payload.primaryProductFamily === null ? null : parseOntologyTagCode(payload.primaryProductFamily);
  if (payload.primaryProductFamily !== null && primaryProductFamily === null) return null;

  const secondaryProductFamilies = parseOntologyTagCodes(payload.secondaryProductFamilies);
  const disciplines = parseOntologyTagCodes(payload.disciplines);
  const useContexts = parseOntologyTagCodes(payload.useContexts);
  if (secondaryProductFamilies === null || disciplines === null || useContexts === null) return null;

  const ontologyVersion = asString(payload.ontologyVersion);
  const classifierVersion = asString(payload.classifierVersion);
  const snapshotId = asString(payload.snapshotId);
  if (ontologyVersion === null || classifierVersion === null || snapshotId === null) return null;

  const provenance = isRecord(payload.provenance) ? payload.provenance : null;
  const exclusion = provenance ? parseSemanticsExclusion(provenance.exclusion) : null;

  return {
    productId: String(productId),
    classificationStatus: classificationStatus as ProductSemanticClassificationStatus,
    primaryProductFamily,
    secondaryProductFamilies,
    disciplines,
    useContexts,
    ontologyVersion,
    classifierVersion,
    snapshotId,
    exclusion,
    provenance: { source: "catalog_service_http", retrievedAt, cached: false }
  };
}

const SEMANTIC_DISCOVERY_AXIS_SET: ReadonlySet<string> = new Set(CATALOG_SEMANTIC_DISCOVERY_AXES);
const SEMANTIC_DISCOVERY_PRODUCT_AXIS_SET: ReadonlySet<string> = new Set(CATALOG_SEMANTIC_DISCOVERY_PRODUCT_AXES);
const SEMANTIC_DISCOVERY_SOURCE_SET: ReadonlySet<string> = new Set(["PRODUCT_SEMANTICS", "TRAINING_SEMANTICS"]);

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    items.push(entry);
  }
  return items;
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function parseSemanticDiscoveryRequirement(value: unknown): CatalogSemanticDiscoveryInput["requirements"][number] | null {
  if (!isRecord(value)) return null;
  const axis = parseSemanticDiscoveryAxis(value.axis);
  const codes = asStringArray(value.codes);
  if (axis === null || codes === null || codes.length === 0 || codes.length > 24) return null;
  if (codes.some((code) => code.trim().length === 0)) return null;
  if (value.mode !== undefined && value.mode !== "required" && value.mode !== "preferred") return null;
  if (value.match !== undefined && value.match !== "any" && value.match !== "all") return null;
  if (value.mode === undefined || value.match === undefined) return null;
  return {
    axis,
    codes,
    mode: value.mode,
    match: value.match
  };
}

function parseSemanticDiscoveryAxis(value: unknown): CatalogSemanticDiscoveryAxis | null {
  return typeof value === "string" && SEMANTIC_DISCOVERY_AXIS_SET.has(value) ? (value as CatalogSemanticDiscoveryAxis) : null;
}

function parseSemanticDiscoveryMatchedRequirement(value: unknown): CatalogSemanticDiscoveryMatchedRequirement | null {
  if (!isRecord(value)) return null;
  const axis = parseSemanticDiscoveryAxis(value.axis);
  const requestedCodes = asStringArray(value.requestedCodes);
  const matchedCodes = asStringArray(value.matchedCodes);
  const source = typeof value.source === "string" && SEMANTIC_DISCOVERY_SOURCE_SET.has(value.source) ? value.source : null;
  const mode = value.mode;
  const match = value.match;
  if (axis === null || requestedCodes === null || matchedCodes === null || source === null) return null;
  if (mode !== "required" && mode !== "preferred") return null;
  if (match !== "any" && match !== "all") return null;
  const relationTypes = value.relationTypes === undefined ? undefined : asStringArray(value.relationTypes);
  const confidenceLevels = value.confidenceLevels === undefined ? undefined : asStringArray(value.confidenceLevels);
  const reason = value.reason === undefined ? undefined : asString(value.reason);
  if (relationTypes === null || confidenceLevels === null || reason === null) return null;
  return {
    axis,
    requestedCodes,
    matchedCodes,
    source: source as CatalogSemanticDiscoveryMatchedRequirement["source"],
    mode,
    match,
    ...(relationTypes !== undefined ? { relationTypes } : {}),
    ...(confidenceLevels !== undefined ? { confidenceLevels } : {}),
    ...(reason !== undefined ? { reason } : {})
  };
}

/** Retains the stable code/confidence pair while excluding uncontracted classifier internals. */
function parseSemanticTags(value: unknown): CatalogSemanticDiscoveryProductTag[] | null {
  if (!Array.isArray(value)) return null;
  const tags: CatalogSemanticDiscoveryProductTag[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const code = asString(entry.code);
    const confidence = asString(entry.confidence);
    if (code === null || code.trim().length === 0 || confidence === null || confidence.trim().length === 0) return null;
    tags.push({ code, confidence });
  }
  return tags;
}

function parseSemanticDiscoveryEvidence(value: unknown): CatalogSemanticDiscoveryEvidence[] | null {
  if (!Array.isArray(value)) return null;
  const evidence: CatalogSemanticDiscoveryEvidence[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const kind = asString(entry.kind);
    if (kind === null || kind.trim().length === 0) return null;
    const parsed: CatalogSemanticDiscoveryEvidence = { kind };
    for (const key of ["sourceId", "matchedText", "ruleId", "note"] as const) {
      if (entry[key] !== undefined) {
        const valueForKey = asString(entry[key]);
        if (valueForKey === null) return null;
        parsed[key] = valueForKey;
      }
    }
    evidence.push(parsed);
  }
  return evidence;
}

function parseSemanticDiscoveryAssignment(value: unknown, exerciseCapability: boolean): CatalogSemanticDiscoverySemanticAssignment | CatalogSemanticDiscoveryExerciseCapabilityAssignment | null {
  if (!isRecord(value)) return null;
  const code = asString(value.code);
  const relationType = asString(value.relationType);
  if (code === null || code.trim().length === 0 || relationType === null || relationType.trim().length === 0) return null;
  const classificationConfidence = value.classificationConfidence === undefined ? undefined : asString(value.classificationConfidence);
  const evidence = value.evidence === undefined ? undefined : parseSemanticDiscoveryEvidence(value.evidence);
  if (evidence === null || (exerciseCapability && (classificationConfidence === null || classificationConfidence === undefined || classificationConfidence.trim().length === 0))) return null;
  return {
    code,
    relationType,
    ...(evidence !== undefined ? { evidence } : {}),
    ...(exerciseCapability ? { classificationConfidence } : {})
  };
}

function parseSemanticDiscoveryProductFact(value: unknown): CatalogSemanticDiscoveryProductFact | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const productId = asNumber(value.productId);
  const classificationStatus = asString(value.classificationStatus);
  if (productId === null || !Number.isInteger(productId) || productId < 1 || classificationStatus === null || classificationStatus.trim().length === 0) return null;
  const primaryProductFamilyRaw = value.primaryProductFamily;
  const primaryProductFamily = primaryProductFamilyRaw === null ? null : parseSemanticTags([primaryProductFamilyRaw])?.[0] ?? null;
  if (primaryProductFamilyRaw !== null && primaryProductFamily === null) return null;
  const secondaryProductFamilies = parseSemanticTags(value.secondaryProductFamilies);
  const disciplines = parseSemanticTags(value.disciplines);
  const useContexts = parseSemanticTags(value.useContexts);
  if (secondaryProductFamilies === null || disciplines === null || useContexts === null) return null;
  const ontologyVersion = asString(value.ontologyVersion);
  const ontologyHash = asString(value.ontologyHash);
  const classifierVersion = asString(value.classifierVersion);
  if (ontologyVersion === null || ontologyVersion.trim().length === 0 || ontologyHash === null || !isSha256Hex(ontologyHash) || classifierVersion === null || classifierVersion.trim().length === 0) return null;
  return { productId: String(productId), classificationStatus, primaryProductFamily, secondaryProductFamilies, disciplines, useContexts, ontologyVersion, ontologyHash, classifierVersion };
}

function parseSemanticDiscoveryTrainingFact(value: unknown): CatalogSemanticDiscoveryTrainingFact | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const productId = asNumber(value.productId);
  const resolutionState = asString(value.resolutionState);
  const coverageStatus = asString(value.coverageStatus);
  if (productId === null || !Number.isInteger(productId) || productId < 1 || resolutionState === null || resolutionState.trim().length === 0 || coverageStatus === null || coverageStatus.trim().length === 0) return null;
  if (!Array.isArray(value.exerciseCapabilities) || !Array.isArray(value.trainingFunctions)) return null;
  const exerciseCapabilities = value.exerciseCapabilities.map((entry) => parseSemanticDiscoveryAssignment(entry, true));
  const trainingFunctions = value.trainingFunctions.map((entry) => parseSemanticDiscoveryAssignment(entry, false));
  if (exerciseCapabilities.some((entry) => entry === null) || trainingFunctions.some((entry) => entry === null)) return null;
  const derived = isRecord(value.derived) ? value.derived : null;
  const bodyRegions = derived ? asStringArray(derived.bodyRegions) : null;
  const primaryMuscleGroups = derived ? asStringArray(derived.primaryMuscleGroups) : null;
  const secondaryMuscleGroups = derived ? asStringArray(derived.secondaryMuscleGroups) : null;
  const trainingPatterns = derived ? asStringArray(derived.trainingPatterns) : null;
  if (bodyRegions === null || primaryMuscleGroups === null || secondaryMuscleGroups === null || trainingPatterns === null) return null;
  return { productId: String(productId), resolutionState, coverageStatus, exerciseCapabilities: exerciseCapabilities as CatalogSemanticDiscoveryExerciseCapabilityAssignment[], trainingFunctions: trainingFunctions as CatalogSemanticDiscoverySemanticAssignment[], bodyRegions, primaryMuscleGroups, secondaryMuscleGroups, trainingPatterns };
}

function parseSemanticDiscoveryResultItem(value: unknown): CatalogSemanticDiscoveryResultItem | null {
  if (!isRecord(value)) return null;
  const productId = asNumber(value.productId);
  if (productId === null || !Number.isInteger(productId) || productId < 1 || !Array.isArray(value.matchedRequirements)) return null;
  const matchedRequirements = value.matchedRequirements.map(parseSemanticDiscoveryMatchedRequirement);
  if (matchedRequirements.some((entry) => entry === null)) return null;
  if (!("productSemantics" in value) || !("trainingSemantics" in value)) return null;
  if (value.productSemantics !== null && !isRecord(value.productSemantics)) return null;
  if (value.trainingSemantics !== null && !isRecord(value.trainingSemantics)) return null;
  const productSemantics = value.productSemantics === null ? null : parseSemanticDiscoveryProductFact(value.productSemantics);
  if (value.productSemantics !== null && productSemantics === null) return null;
  const trainingSemantics = value.trainingSemantics === null ? null : parseSemanticDiscoveryTrainingFact(value.trainingSemantics);
  if (value.trainingSemantics !== null && trainingSemantics === null) return null;
  return {
    productId: String(productId),
    matchedRequirements: matchedRequirements as CatalogSemanticDiscoveryMatchedRequirement[],
    productSemantics,
    trainingSemantics
  };
}

function parseSemanticDiscoveryLineage(value: unknown): CatalogSemanticDiscoveryLineage | null {
  if (!isRecord(value)) return null;
  const productSemanticsRaw = value.productSemantics;
  const trainingSemanticsRaw = value.trainingSemantics;
  if (!("productSemantics" in value) || !("trainingSemantics" in value)) return null;
  let productSemantics: CatalogSemanticDiscoveryLineage["productSemantics"] = null;
  if (productSemanticsRaw !== null) {
    if (!isRecord(productSemanticsRaw)) return null;
    const snapshotId = asString(productSemanticsRaw.snapshotId);
    const semanticChecksum = asString(productSemanticsRaw.semanticChecksum);
    const ontologyVersion = asString(productSemanticsRaw.ontologyVersion);
    const ontologyHash = asString(productSemanticsRaw.ontologyHash);
    const classifierVersion = asString(productSemanticsRaw.classifierVersion);
    if (snapshotId === null || semanticChecksum === null || !isSha256Hex(semanticChecksum) || ontologyVersion === null || ontologyVersion.trim().length === 0 || ontologyHash === null || !isSha256Hex(ontologyHash) || classifierVersion === null || classifierVersion.trim().length === 0) return null;
    productSemantics = { snapshotId, semanticChecksum, ontologyVersion, ontologyHash, classifierVersion };
  }
  let trainingSemantics: CatalogSemanticDiscoveryLineage["trainingSemantics"] = null;
  if (trainingSemanticsRaw !== null) {
    if (!isRecord(trainingSemanticsRaw)) return null;
    const snapshotId = asString(trainingSemanticsRaw.snapshotId);
    const semanticChecksum = asString(trainingSemanticsRaw.semanticChecksum);
    const registryVersion = asString(trainingSemanticsRaw.registryVersion);
    const registryHash = asString(trainingSemanticsRaw.registryHash);
    const classifierVersion = asString(trainingSemanticsRaw.classifierVersion);
    const rulesHash = asString(trainingSemanticsRaw.rulesHash);
    if (snapshotId === null || semanticChecksum === null || !isSha256Hex(semanticChecksum) || registryVersion === null || registryVersion.trim().length === 0 || registryHash === null || !isSha256Hex(registryHash) || classifierVersion === null || classifierVersion.trim().length === 0 || rulesHash === null || !isSha256Hex(rulesHash)) return null;
    trainingSemantics = { snapshotId, semanticChecksum, registryVersion, registryHash, classifierVersion, rulesHash };
  }
  return { productSemantics, trainingSemantics };
}

function parseSemanticDiscoveryResponse(payload: unknown, retrievedAt: string): CatalogSemanticDiscoveryResult | null {
  if (!isRecord(payload) || payload.schemaVersion !== CATALOG_SEMANTIC_DISCOVERY_SCHEMA_VERSION || !Array.isArray(payload.results)) return null;
  const lineage = parseSemanticDiscoveryLineage(payload.lineage);
  const totalMatches = asNumber(payload.totalMatches);
  if (lineage === null || totalMatches === null || !Number.isInteger(totalMatches) || totalMatches < 0 || typeof payload.truncated !== "boolean") return null;
  if (!isRecord(payload.query) || !Array.isArray(payload.query.requirements) || !isRecord(payload.query.options)) return null;
  const queryRequirements = payload.query.requirements.map(parseSemanticDiscoveryRequirement);
  const queryLimit = asNumber(payload.query.options.limit);
  if (queryRequirements.some((entry) => entry === null) || queryLimit === null || !Number.isInteger(queryLimit) || queryLimit < 1 || queryLimit > 100) return null;
  const results = payload.results.map(parseSemanticDiscoveryResultItem);
  if (results.some((entry) => entry === null)) return null;
  return {
    schemaVersion: CATALOG_SEMANTIC_DISCOVERY_SCHEMA_VERSION,
    query: { requirements: queryRequirements as CatalogSemanticDiscoveryResult["query"]["requirements"], options: { limit: queryLimit } },
    results: results as CatalogSemanticDiscoveryResultItem[],
    totalMatches,
    truncated: payload.truncated,
    lineage,
    provenance: { source: "catalog_service_http", retrievedAt, cached: false }
  };
}

function parseProductRegistryValue(value: unknown): CatalogSemanticRegistryValue | null {
  if (!isRecord(value)) return null;
  const code = asString(value.code);
  const label = asString(value.labelEs);
  const description = asString(value.definition);
  const status = asString(value.status);
  if (code === null || code.trim().length === 0 || label === null || description === null || status === null || (status !== "ACTIVE" && status !== "RESIDUAL") || typeof value.residual !== "boolean") return null;
  return { code, labelEs: label, definition: description, status, residual: value.residual };
}

function parseProductSemanticsRegistryResponse(payload: unknown): CatalogProductSemanticsRegistry | null {
  if (!isRecord(payload) || payload.schemaVersion !== CATALOG_PRODUCT_SEMANTICS_SCHEMA_VERSION || payload.status !== "PUBLISHED" || !Array.isArray(payload.axes)) return null;
  const ontologyVersion = asString(payload.ontologyVersion);
  const ontologyHash = asString(payload.ontologyHash);
  if (ontologyVersion !== CATALOG_PRODUCT_SEMANTICS_ONTOLOGY_VERSION || ontologyHash === null || !isSha256Hex(ontologyHash) || payload.axes.length !== CATALOG_SEMANTIC_DISCOVERY_PRODUCT_AXES.length) return null;

  const axes: CatalogProductSemanticsRegistry["axes"] = [];
  const seenAxes = new Set<string>();
  for (const entry of payload.axes) {
    if (!isRecord(entry)) return null;
    const axis = asString(entry.axis);
    if (axis === null || !SEMANTIC_DISCOVERY_PRODUCT_AXIS_SET.has(axis) || !Array.isArray(entry.values)) return null;
    if (seenAxes.has(axis)) return null;
    seenAxes.add(axis);
    const values = entry.values.map(parseProductRegistryValue);
    if (values.some((value) => value === null)) return null;
    axes.push({ axis: axis as CatalogSemanticDiscoveryProductAxis, values: values as CatalogSemanticRegistryValue[] });
  }
  if (seenAxes.size !== CATALOG_SEMANTIC_DISCOVERY_PRODUCT_AXES.length) return null;
  return { schemaVersion: CATALOG_PRODUCT_SEMANTICS_SCHEMA_VERSION, ontologyVersion, ontologyHash, status: "PUBLISHED", axes };
}

function parseTrainingRegistryDefinition(value: unknown, exerciseCapability: boolean): CatalogTrainingSemanticExerciseCapability | CatalogTrainingSemanticFunction | null {
  if (!isRecord(value)) return null;
  const code = asString(value.code);
  const canonicalName = asString(value.canonicalName);
  const description = asString(value.description);
  const status = asString(value.status);
  if (code === null || code.trim().length === 0 || canonicalName === null || description === null || status === null || status.trim().length === 0) return null;
  if (exerciseCapability) {
    const derivedBodyRegions = asStringArray(value.derivedBodyRegions);
    const primaryMuscleGroups = asStringArray(value.primaryMuscleGroups);
    const secondaryMuscleGroups = asStringArray(value.secondaryMuscleGroups);
    const trainingPatterns = asStringArray(value.trainingPatterns);
    if (derivedBodyRegions === null || primaryMuscleGroups === null || secondaryMuscleGroups === null || trainingPatterns === null) return null;
    return { code, canonicalName, description, status, derivedBodyRegions, primaryMuscleGroups, secondaryMuscleGroups, trainingPatterns };
  }
  const allowedRelationTypes = asStringArray(value.allowedRelationTypes);
  const allowedEvidenceKinds = asStringArray(value.allowedEvidenceKinds);
  if (allowedRelationTypes === null || allowedEvidenceKinds === null) return null;
  return { code, canonicalName, description, status, allowedRelationTypes, allowedEvidenceKinds };
}

function parseTrainingDerivedRelation(value: unknown): CatalogTrainingSemanticExerciseDerivedRelation | null {
  if (!isRecord(value)) return null;
  const capabilityCode = asString(value.capabilityCode);
  const bodyRegions = asStringArray(value.bodyRegions);
  const primaryMuscleGroups = asStringArray(value.primaryMuscleGroups);
  const secondaryMuscleGroups = asStringArray(value.secondaryMuscleGroups);
  const trainingPatterns = asStringArray(value.trainingPatterns);
  if (capabilityCode === null || capabilityCode.trim().length === 0 || bodyRegions === null || primaryMuscleGroups === null || secondaryMuscleGroups === null || trainingPatterns === null) return null;
  return { capabilityCode, bodyRegions, primaryMuscleGroups, secondaryMuscleGroups, trainingPatterns };
}

function parseTrainingFamilyDerivation(value: unknown): CatalogTrainingSemanticFamilyTrainingFunctionDerivation | null {
  if (!isRecord(value)) return null;
  const productFamily = asString(value.productFamily);
  const trainingFunctionCode = asString(value.trainingFunctionCode);
  const relationType = asString(value.relationType);
  const evidenceKind = asString(value.evidenceKind);
  const status = asString(value.status);
  const rationale = asString(value.rationale);
  if (productFamily === null || trainingFunctionCode === null || relationType === null || evidenceKind === null || status === null || rationale === null) return null;
  return { productFamily, trainingFunctionCode, relationType, evidenceKind, status, rationale };
}

function parseTrainingSemanticBoundaries(value: unknown): CatalogTrainingSemanticBoundaries | null {
  if (!isRecord(value)) return null;
  const exerciseCapability = asString(value.exerciseCapability);
  const trainingFunction = asString(value.trainingFunction);
  const deadlift = isRecord(value.deadlift) ? value.deadlift : null;
  const squat = isRecord(value.squat) ? value.squat : null;
  if (exerciseCapability === null || trainingFunction === null || deadlift === null || squat === null) return null;
  const dedicatedMachine = asString(deadlift.dedicatedMachine);
  const deadliftJack = asString(deadlift.deadliftJack);
  const barbell = asString(deadlift.barbell);
  const forbiddenGenericCode = asString(squat.forbiddenGenericCode);
  const explicitCapabilities = asStringArray(squat.explicitCapabilities);
  const genericEquipmentPolicy = asString(squat.genericEquipmentPolicy);
  if (dedicatedMachine === null || deadliftJack === null || barbell === null || typeof deadlift.familyDerived !== "boolean" || forbiddenGenericCode === null || explicitCapabilities === null || genericEquipmentPolicy === null) return null;
  return {
    exerciseCapability,
    trainingFunction,
    deadlift: { dedicatedMachine, deadliftJack, barbell, familyDerived: deadlift.familyDerived },
    squat: { forbiddenGenericCode, explicitCapabilities, genericEquipmentPolicy }
  };
}

function parseTrainingSemanticsRegistryResponse(payload: unknown): CatalogTrainingSemanticsRegistry | null {
  if (!isRecord(payload) || payload.schemaVersion !== CATALOG_TRAINING_SEMANTICS_SCHEMA_VERSION || payload.registryVersion !== CATALOG_TRAINING_SEMANTICS_REGISTRY_VERSION || payload.status !== "PUBLISHED") return null;
  const registryVersion = asString(payload.registryVersion);
  const registryHash = asString(payload.registryHash);
  if (registryVersion === null || registryHash === null || !isSha256Hex(registryHash)) return null;
  if (!Array.isArray(payload.exerciseCapabilities) || !Array.isArray(payload.trainingFunctions) || !Array.isArray(payload.exerciseDerivedRelations) || !Array.isArray(payload.familyTrainingFunctionDerivations)) return null;
  const exerciseCapabilities = payload.exerciseCapabilities.map((entry) => parseTrainingRegistryDefinition(entry, true));
  const trainingFunctions = payload.trainingFunctions.map((entry) => parseTrainingRegistryDefinition(entry, false));
  const exerciseDerivedRelations = payload.exerciseDerivedRelations.map(parseTrainingDerivedRelation);
  const familyTrainingFunctionDerivations = payload.familyTrainingFunctionDerivations.map(parseTrainingFamilyDerivation);
  if (exerciseCapabilities.some((entry) => entry === null) || trainingFunctions.some((entry) => entry === null) || exerciseDerivedRelations.some((entry) => entry === null) || familyTrainingFunctionDerivations.some((entry) => entry === null)) return null;
  const bodyRegions = asStringArray(payload.bodyRegions);
  const muscleGroups = asStringArray(payload.muscleGroups);
  const trainingPatterns = asStringArray(payload.trainingPatterns);
  if (bodyRegions === null || muscleGroups === null || trainingPatterns === null) return null;
  const semanticBoundaries = parseTrainingSemanticBoundaries(payload.semanticBoundaries);
  if (semanticBoundaries === null) return null;
  return {
    schemaVersion: CATALOG_TRAINING_SEMANTICS_SCHEMA_VERSION,
    registryVersion,
    registryHash,
    status: "PUBLISHED",
    exerciseCapabilities: exerciseCapabilities as CatalogTrainingSemanticExerciseCapability[],
    trainingFunctions: trainingFunctions as CatalogTrainingSemanticFunction[],
    bodyRegions,
    muscleGroups,
    trainingPatterns,
    exerciseDerivedRelations: exerciseDerivedRelations as CatalogTrainingSemanticExerciseDerivedRelation[],
    familyTrainingFunctionDerivations: familyTrainingFunctionDerivations as CatalogTrainingSemanticFamilyTrainingFunctionDerivation[],
    semanticBoundaries
  };
}

async function fetchJson(
  config: HttpCatalogAdapterConfig,
  path: string,
  context: CatalogRequestContext,
  init?: { method: "POST"; body: unknown }
): Promise<{ status: number; body: unknown } | { networkError: true }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      signal: controller.signal,
      headers: {
        "x-api-key": config.apiKey,
        "x-correlation-id": context.correlationId,
        ...(init ? { "content-type": "application/json" } : {})
      },
      ...(init ? { body: JSON.stringify(init.body) } : {})
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return { status: response.status, body: null };
      }
    }
    return { status: response.status, body };
  } catch {
    return { networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exactly one physical HTTP call per invocation. Retrying belongs solely to
 * the Capability Gateway (executeGovernedCapability's bounded, audited
 * retry) - an adapter-level retry loop on top of that would silently double
 * (or worse) the number of real calls made per governed retry attempt.
 */
async function requestOnce<T>(
  config: HttpCatalogAdapterConfig,
  path: string,
  context: CatalogRequestContext,
  parse: (payload: unknown, retrievedAt: string) => T | null,
  init?: { method: "POST"; body: unknown }
): Promise<CatalogPortResult<T>> {
  const result = await fetchJson(config, path, context, init);
  const retrievedAt = new Date().toISOString();

  if ("networkError" in result) {
    return { ok: false, error: catalogError("timeout", "Catalog service request timed out or the network failed.", true, null, context.correlationId, config.apiKey) };
  }

  if (result.status >= 200 && result.status < 300) {
    const parsed = parse(result.body, retrievedAt);
    if (parsed === null) {
      return { ok: false, error: catalogError("invalid_response", "Catalog service returned an unexpected payload shape.", false, null, context.correlationId, config.apiKey) };
    }
    return { ok: true, value: parsed };
  }

  const errorBody = isRecord(result.body) && isRecord(result.body.error) ? result.body.error : null;
  const providerErrorCode = errorBody ? asString(errorBody.code) ?? undefined : undefined;
  const message = errorBody ? asString(errorBody.message) ?? `HTTP ${result.status}` : `HTTP ${result.status}`;
  const mapped = mapProviderErrorCode(providerErrorCode, result.status);
  return { ok: false, error: catalogError(mapped.code, message, mapped.retryable, providerErrorCode ?? null, context.correlationId, config.apiKey) };
}

/**
 * Real HTTP adapter. `config` is read once by the caller (createCatalogPort)
 * so tests can point it at a local mock server per-test.
 */
export function createHttpCatalogAdapter(config: HttpCatalogAdapterConfig): CatalogPort {
  return {
    async searchProducts(input, context) {
      const query = input.query.trim();
      const params = new URLSearchParams({ q: query });
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.includeOutOfStock !== undefined) params.set("includeOutOfStock", String(input.includeOutOfStock));
      return requestOnce(config, `/v1/products/search?${params.toString()}`, context, parseSearchResponse);
    },
    async getProductDetails(input, context) {
      const params = new URLSearchParams();
      if (input.combinationId !== undefined) params.set("combinationId", input.combinationId);
      const query = params.toString();
      const result = await requestOnce(config, `/v1/products/${input.productId}${query ? `?${query}` : ""}`, context, parseProductResponse);
      if (!result.ok && result.error.code === "not_found") {
        return { ok: true, value: null };
      }
      return result;
    },
    async batchGetProducts(input, context) {
      if (input.items.length === 0) {
        return { ok: true, value: { items: [], provenance: { source: "catalog_service_http", retrievedAt: new Date().toISOString(), cached: false } } };
      }
      const items = input.items.slice(0, CATALOG_BATCH_MAX_ITEMS).map((item) => ({
        productId: Number(item.productId),
        ...(item.combinationId !== undefined ? { combinationId: Number(item.combinationId) } : {}),
        ...(item.quantity !== undefined ? { quantity: item.quantity } : {})
      }));
      return requestOnce(config, "/v1/products/batch", context, parseBatchResponse, { method: "POST", body: { items } });
    },
    async exploreCatalog(input, context) {
      return requestOnce(config, "/v1/products/explore", context, parseExploreResponse, { method: "POST", body: buildExploreRequestBody(input) });
    },
    async resolveProductIntent(input, context) {
      const query = input.query.trim();
      const body: Record<string, unknown> = { query };
      if (input.limit !== undefined) body.limit = input.limit;
      if (input.inStockOnly !== undefined) body.filters = { inStockOnly: input.inStockOnly };
      return requestOnce(config, "/api/v2/catalog/resolve-product-intent", context, parseProductIntentResponse, { method: "POST", body });
    },
    async getProductSemantics(input, context) {
      const result = await requestOnce(config, `/v1/products/${input.productId}/semantics`, context, parseProductSemanticsResponse);
      if (!result.ok && result.error.code === "not_found") {
        return { ok: true, value: null };
      }
      return result;
    },
    async querySemanticDiscovery(input: CatalogSemanticDiscoveryInput, context) {
      const body: Record<string, unknown> = {
        schemaVersion: input.schemaVersion ?? CATALOG_SEMANTIC_DISCOVERY_SCHEMA_VERSION,
        requirements: input.requirements.map((requirement) => ({
          axis: requirement.axis,
          codes: requirement.codes,
          mode: requirement.mode,
          match: requirement.match
        })),
        options: input.limit !== undefined ? { limit: input.limit } : {}
      };
      if (input.expectedSnapshots !== undefined) body.expectedSnapshots = input.expectedSnapshots;
      return requestOnce(config, "/v1/products/semantic-discovery/query", context, parseSemanticDiscoveryResponse, { method: "POST", body });
    },
    async getProductSemanticsRegistry(context) {
      return requestOnce(config, "/v1/products/semantics/registry", context, parseProductSemanticsRegistryResponse);
    },
    async getTrainingSemanticsRegistry(context) {
      return requestOnce(config, "/v1/products/training-semantics/registry", context, parseTrainingSemanticsRegistryResponse);
    }
  };
}

export const HTTP_CATALOG_ADAPTER_CONTRACT_VERSION = CATALOG_ADAPTER_CONTRACT_VERSION;
