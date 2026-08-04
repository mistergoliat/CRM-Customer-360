/**
 * HTTP client for MS-pesaschile-catalog-service's
 * POST /api/v2/recommendations/search-products (SearchProducts V2). Same
 * transport shape as lib/catalog/httpCatalogAdapter.ts and
 * lib/customer-profile/httpCustomerProfileAdapter.ts (fetch + AbortController,
 * exactly one physical HTTP call per invocation, no adapter-level retry).
 *
 * CP-R1-T10B5 scope: transport plumbing only. This client never resolves
 * identity, never recomputes score/rank/ownership, never generates
 * commercial text, and is not wired to the Sales Agent or the Agent Tool
 * Loop - see docs/releases/CP-R1-T10B5-crm-search-products-v2-client.md.
 */
import type {
  CatalogSearchProductsV2Client,
  SearchProductsV2Availability,
  SearchProductsV2AvailabilityStatus,
  SearchProductsV2ClientCallContext,
  SearchProductsV2ClientError,
  SearchProductsV2ClientErrorCode,
  SearchProductsV2ClientRequest,
  SearchProductsV2ClientResponse,
  SearchProductsV2ClientResult,
  SearchProductsV2CommercialReason,
  SearchProductsV2DegradationCode,
  SearchProductsV2Exclusion,
  SearchProductsV2Execution,
  SearchProductsV2ExecutionStages,
  SearchProductsV2Money,
  SearchProductsV2Ownership,
  SearchProductsV2Personalization,
  SearchProductsV2Pricing,
  SearchProductsV2ProductIdentity,
  SearchProductsV2ProductPublicLink,
  SearchProductsV2ProductSummary,
  SearchProductsV2Ranking,
  SearchProductsV2Reason,
  SearchProductsV2Recommendation,
  SearchProductsV2Relationship,
  SearchProductsV2RelationshipEvidence,
  SearchProductsV2Snapshot,
  SearchProductsV2Statistics,
  SearchProductsV2Stock,
  SearchProductsV2StockStatus,
  SearchProductsV2Warning
} from "./types";
import {
  SEARCH_PRODUCTS_V2_AFFINITY_CONFIDENCES,
  SEARCH_PRODUCTS_V2_AVAILABILITY_STATUSES,
  SEARCH_PRODUCTS_V2_COMMERCIAL_REASON_CODES,
  SEARCH_PRODUCTS_V2_DEGRADATION_CODES,
  SEARCH_PRODUCTS_V2_EXCLUSION_CODES,
  SEARCH_PRODUCTS_V2_PERSONALIZATION_REASONS,
  SEARCH_PRODUCTS_V2_PUBLIC_LINK_SCOPES,
  SEARCH_PRODUCTS_V2_PUBLIC_LINK_UNAVAILABLE_REASONS,
  SEARCH_PRODUCTS_V2_REASON_CODES,
  SEARCH_PRODUCTS_V2_REASON_SOURCES,
  SEARCH_PRODUCTS_V2_STOCK_STATUSES,
  SEARCH_PRODUCTS_V2_WARNING_CODES
} from "./types";

const SEARCH_PRODUCTS_V2_PATH = "/api/v2/recommendations/search-products";
const DEFAULT_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 30000;

export type HttpCatalogSearchProductsV2ClientConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
};

/**
 * Thrown at config-read/construction time only, when
 * CATALOG_SERVICE_BASE_URL / CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS are
 * present but structurally invalid - distinct from "not configured" (missing
 * entirely), which returns a fail-closed client instead. Never thrown at
 * request time.
 */
export class CatalogSearchProductsV2ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogSearchProductsV2ConfigurationError";
  }
}

function normalizeBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CatalogSearchProductsV2ConfigurationError("CATALOG_SERVICE_BASE_URL must be an absolute http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CatalogSearchProductsV2ConfigurationError("CATALOG_SERVICE_BASE_URL must use http or https.");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new CatalogSearchProductsV2ConfigurationError("CATALOG_SERVICE_BASE_URL must not contain embedded credentials.");
  }
  if (parsed.search !== "") {
    throw new CatalogSearchProductsV2ConfigurationError("CATALOG_SERVICE_BASE_URL must not contain a query string.");
  }
  if (parsed.hash !== "") {
    throw new CatalogSearchProductsV2ConfigurationError("CATALOG_SERVICE_BASE_URL must not contain a fragment.");
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

function readTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TIMEOUT_MS;
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_TIMEOUT_MS || String(parsed) !== trimmed) {
    throw new CatalogSearchProductsV2ConfigurationError(`CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS must be a positive integer up to ${MAX_TIMEOUT_MS}.`);
  }
  return parsed;
}

/**
 * Reuses CATALOG_SERVICE_BASE_URL / CATALOG_SERVICE_API_KEY (same
 * MS-pesaschile-catalog-service deployment already used by lib/catalog) -
 * never a second, duplicate pair of variables. Returns null when either is
 * absent ("not configured"); throws CatalogSearchProductsV2ConfigurationError
 * when a present value is structurally invalid.
 */
export function readHttpCatalogSearchProductsV2ClientConfig(): HttpCatalogSearchProductsV2ClientConfig | null {
  const baseUrl = process.env.CATALOG_SERVICE_BASE_URL?.trim();
  const apiKey = process.env.CATALOG_SERVICE_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey,
    timeoutMs: readTimeoutMs(process.env.CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS)
  };
}

// ---------------------------------------------------------------------------
// Generic parse helpers (same style as lib/catalog/httpCatalogAdapter.ts and
// lib/customer-profile/httpCustomerProfileAdapter.ts)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/**
 * Trims before checking, and returns the trimmed value - mirrors the real
 * contract's `z.string().trim().min(1)` transform (Zod trims before
 * validating and the trimmed value is what the schema actually produces).
 * A whitespace-only string is rejected, never accepted as non-empty.
 */
function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asZeroToOne(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function asBooleanStrict(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Requires the exact canonical `toISOString()` round-trip - mirrors the real
 * contract's `isoDateTimeSchema` (customer-affinity/contracts.ts#isIsoDateTime),
 * which is stricter than "Date.parse succeeds": a date-only string, a
 * non-UTC offset, or a different millisecond precision all parse fine via
 * `Date.parse` but are rejected by the real schema and must be rejected
 * here too. Never normalizes a non-canonical value - rejects it instead.
 */
function asIsoDateString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString() === value ? value : null;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

type OptionalStringField = { ok: true; value?: string } | { ok: false };

function optionalNonEmptyString(value: unknown): OptionalStringField {
  if (value === undefined) return { ok: true };
  const parsed = asNonEmptyString(value);
  return parsed !== null ? { ok: true, value: parsed } : { ok: false };
}

// ---------------------------------------------------------------------------
// Response parsing - mirrors services/src/application/recommendation/
// search-products-v2/contracts.ts exactly, field by field.
// ---------------------------------------------------------------------------

function parseProductIdentity(value: unknown): SearchProductsV2ProductIdentity | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["productId", "combinationId"])) return null;
  const productId = asNonEmptyString(value.productId);
  if (productId === null) return null;
  if (value.combinationId === undefined) return { productId };
  const combinationId = asNonEmptyString(value.combinationId);
  return combinationId === null ? null : { productId, combinationId };
}

function parseMoney(value: unknown): SearchProductsV2Money | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["amount", "currency"])) return null;
  const amount = asFiniteNumber(value.amount);
  const currency = asNonEmptyString(value.currency);
  return amount === null || amount < 0 || currency === null ? null : { amount, currency };
}

function parseStock(value: unknown): SearchProductsV2Stock | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["status", "quantity", "available"])) return null;
  const status = asEnum<SearchProductsV2StockStatus>(value.status, SEARCH_PRODUCTS_V2_STOCK_STATUSES);
  const available = asBooleanStrict(value.available);
  if (status === null || available === null) return null;
  if (value.quantity === undefined) return { status, available };
  const quantity = asNonNegativeInteger(value.quantity);
  return quantity === null ? null : { status, quantity, available };
}

function parseAvailability(value: unknown): SearchProductsV2Availability | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["status", "purchasable", "active", "availableForOrder", "stockQuantity", "stockKnown", "evaluatedAt"])) return null;
  const status = asEnum<SearchProductsV2AvailabilityStatus>(value.status, SEARCH_PRODUCTS_V2_AVAILABILITY_STATUSES);
  const purchasable = asBooleanStrict(value.purchasable);
  const active = asBooleanStrict(value.active);
  const availableForOrder = asBooleanStrict(value.availableForOrder);
  const stockKnown = asBooleanStrict(value.stockKnown);
  const evaluatedAt = asNonEmptyString(value.evaluatedAt);
  if (status === null || purchasable === null || active === null || availableForOrder === null || stockKnown === null || evaluatedAt === null) return null;
  let stockQuantity: number | null;
  if (value.stockQuantity === null) {
    stockQuantity = null;
  } else {
    const quantity = asNonNegativeInteger(value.stockQuantity);
    if (quantity === null) return null;
    stockQuantity = quantity;
  }
  return { status, purchasable, active, availableForOrder, stockQuantity, stockKnown, evaluatedAt };
}

function parsePricing(value: unknown): SearchProductsV2Pricing | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["baseGrossAmount", "finalGrossAmount", "currency", "taxIncluded", "taxRate", "discountApplied", "discountType", "discountValue", "specificPriceId", "evaluatedAt"])
  ) {
    return null;
  }
  const baseGrossAmount = asFiniteNumber(value.baseGrossAmount);
  const finalGrossAmount = asFiniteNumber(value.finalGrossAmount);
  const currency = asNonEmptyString(value.currency);
  const taxRate = asFiniteNumber(value.taxRate);
  const discountApplied = asBooleanStrict(value.discountApplied);
  const evaluatedAt = asNonEmptyString(value.evaluatedAt);
  if (
    baseGrossAmount === null ||
    baseGrossAmount < 0 ||
    finalGrossAmount === null ||
    finalGrossAmount < 0 ||
    currency === null ||
    value.taxIncluded !== true ||
    taxRate === null ||
    taxRate < 0 ||
    discountApplied === null ||
    evaluatedAt === null
  ) {
    return null;
  }

  let discountType: "percentage" | "amount" | null;
  if (value.discountType === null) {
    discountType = null;
  } else {
    const parsed = asEnum(value.discountType, ["percentage", "amount"] as const);
    if (parsed === null) return null;
    discountType = parsed;
  }

  let discountValue: number | null;
  if (value.discountValue === null) {
    discountValue = null;
  } else {
    const parsed = asFiniteNumber(value.discountValue);
    if (parsed === null || parsed < 0) return null;
    discountValue = parsed;
  }

  let specificPriceId: number | null;
  if (value.specificPriceId === null) {
    specificPriceId = null;
  } else {
    const parsed = asNonNegativeInteger(value.specificPriceId);
    if (parsed === null) return null;
    specificPriceId = parsed;
  }

  return { baseGrossAmount, finalGrossAmount, currency, taxIncluded: true, taxRate, discountApplied, discountType, discountValue, specificPriceId, evaluatedAt };
}

function parsePublicLink(value: unknown): SearchProductsV2ProductPublicLink | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["canonicalUrl", "scope", "available", "unavailableReason", "requiresVariantSelection", "variantAttributeLabels"])) return null;
  const scope = asEnum(value.scope, SEARCH_PRODUCTS_V2_PUBLIC_LINK_SCOPES);
  const available = asBooleanStrict(value.available);
  const requiresVariantSelection = asBooleanStrict(value.requiresVariantSelection);
  if (scope === null || available === null || requiresVariantSelection === null) return null;

  let canonicalUrl: string | null;
  if (value.canonicalUrl === null) {
    canonicalUrl = null;
  } else {
    const parsed = asNonEmptyString(value.canonicalUrl);
    if (parsed === null) return null;
    canonicalUrl = parsed;
  }
  if (available && canonicalUrl === null) return null;
  if (!available && canonicalUrl !== null) return null;

  if (!Array.isArray(value.variantAttributeLabels)) return null;
  const variantAttributeLabels: string[] = [];
  for (const label of value.variantAttributeLabels) {
    const parsed = asNonEmptyString(label);
    if (parsed === null) return null;
    variantAttributeLabels.push(parsed);
  }

  let unavailableReason: (typeof SEARCH_PRODUCTS_V2_PUBLIC_LINK_UNAVAILABLE_REASONS)[number] | undefined;
  if (value.unavailableReason !== undefined) {
    const parsed = asEnum(value.unavailableReason, SEARCH_PRODUCTS_V2_PUBLIC_LINK_UNAVAILABLE_REASONS);
    if (parsed === null) return null;
    unavailableReason = parsed;
  }
  if (!available && unavailableReason === undefined) return null;

  return {
    canonicalUrl,
    scope,
    available,
    ...(unavailableReason !== undefined ? { unavailableReason } : {}),
    requiresVariantSelection,
    variantAttributeLabels
  };
}

const PRODUCT_SUMMARY_KEYS = ["productId", "combinationId", "name", "reference", "description", "category", "active", "price", "stock", "availability", "pricing", "publicLink", "productUrl", "imageUrl"];

function parseProductSummary(value: unknown): SearchProductsV2ProductSummary | null {
  if (!isRecord(value) || !hasOnlyKeys(value, PRODUCT_SUMMARY_KEYS)) return null;
  const productId = asNonEmptyString(value.productId);
  const name = asNonEmptyString(value.name);
  const active = asBooleanStrict(value.active);
  if (productId === null || name === null || active === null || !("stock" in value)) return null;

  const stock = parseStock(value.stock);
  if (stock === null) return null;

  let price: SearchProductsV2Money | null;
  if (value.price === null) {
    price = null;
  } else {
    const parsed = parseMoney(value.price);
    if (parsed === null) return null;
    price = parsed;
  }

  const combinationId = optionalNonEmptyString(value.combinationId);
  const reference = optionalNonEmptyString(value.reference);
  const description = optionalNonEmptyString(value.description);
  const category = optionalNonEmptyString(value.category);
  const productUrl = optionalNonEmptyString(value.productUrl);
  const imageUrl = optionalNonEmptyString(value.imageUrl);
  if (!combinationId.ok || !reference.ok || !description.ok || !category.ok || !productUrl.ok || !imageUrl.ok) return null;

  let availability: SearchProductsV2Availability | undefined;
  if (value.availability !== undefined) {
    const parsed = parseAvailability(value.availability);
    if (parsed === null) return null;
    availability = parsed;
  }

  let pricing: SearchProductsV2Pricing | null | undefined;
  if (value.pricing !== undefined) {
    if (value.pricing === null) {
      pricing = null;
    } else {
      const parsed = parsePricing(value.pricing);
      if (parsed === null) return null;
      pricing = parsed;
    }
  }

  let publicLink: SearchProductsV2ProductPublicLink | undefined;
  if (value.publicLink !== undefined) {
    const parsed = parsePublicLink(value.publicLink);
    if (parsed === null) return null;
    publicLink = parsed;
  }

  return {
    productId,
    name,
    active,
    price,
    stock,
    ...(combinationId.value !== undefined ? { combinationId: combinationId.value } : {}),
    ...(reference.value !== undefined ? { reference: reference.value } : {}),
    ...(description.value !== undefined ? { description: description.value } : {}),
    ...(category.value !== undefined ? { category: category.value } : {}),
    ...(availability !== undefined ? { availability } : {}),
    ...(pricing !== undefined ? { pricing } : {}),
    ...(publicLink !== undefined ? { publicLink } : {}),
    ...(productUrl.value !== undefined ? { productUrl: productUrl.value } : {}),
    ...(imageUrl.value !== undefined ? { imageUrl: imageUrl.value } : {})
  };
}

function parseOwnership(value: unknown): SearchProductsV2Ownership | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["previouslyPurchased", "exactVariantPreviouslyPurchased", "totalOrderCount", "firstPurchasedAt", "lastPurchasedAt"])) return null;
  const previouslyPurchased = asBooleanStrict(value.previouslyPurchased);
  const exactVariantPreviouslyPurchased = asBooleanStrict(value.exactVariantPreviouslyPurchased);
  if (previouslyPurchased === null || exactVariantPreviouslyPurchased === null) return null;
  if (exactVariantPreviouslyPurchased && !previouslyPurchased) return null;

  let totalOrderCount: number | undefined;
  if (value.totalOrderCount !== undefined) {
    const parsed = asNonNegativeInteger(value.totalOrderCount);
    if (parsed === null) return null;
    totalOrderCount = parsed;
  }
  let firstPurchasedAt: string | undefined;
  if (value.firstPurchasedAt !== undefined) {
    const parsed = asIsoDateString(value.firstPurchasedAt);
    if (parsed === null) return null;
    firstPurchasedAt = parsed;
  }
  let lastPurchasedAt: string | undefined;
  if (value.lastPurchasedAt !== undefined) {
    const parsed = asIsoDateString(value.lastPurchasedAt);
    if (parsed === null) return null;
    lastPurchasedAt = parsed;
  }
  if (firstPurchasedAt !== undefined && lastPurchasedAt !== undefined && Date.parse(firstPurchasedAt) > Date.parse(lastPurchasedAt)) return null;

  return {
    previouslyPurchased,
    exactVariantPreviouslyPurchased,
    ...(totalOrderCount !== undefined ? { totalOrderCount } : {}),
    ...(firstPurchasedAt !== undefined ? { firstPurchasedAt } : {}),
    ...(lastPurchasedAt !== undefined ? { lastPurchasedAt } : {})
  };
}

function parseReason(value: unknown): SearchProductsV2Reason | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["code", "source"])) return null;
  const code = asEnum(value.code, SEARCH_PRODUCTS_V2_REASON_CODES);
  const source = asEnum(value.source, SEARCH_PRODUCTS_V2_REASON_SOURCES);
  return code === null || source === null ? null : { code, source };
}

function parseWarning(value: unknown): SearchProductsV2Warning | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["code", "product", "details"])) return null;
  const code = asEnum(value.code, SEARCH_PRODUCTS_V2_WARNING_CODES);
  if (code === null) return null;

  let product: SearchProductsV2ProductIdentity | undefined;
  if (value.product !== undefined) {
    const parsed = parseProductIdentity(value.product);
    if (parsed === null) return null;
    product = parsed;
  }

  let details: Record<string, unknown> | undefined;
  if (value.details !== undefined) {
    if (!isRecord(value.details)) return null;
    details = value.details;
  }

  return { code, ...(product !== undefined ? { product } : {}), ...(details !== undefined ? { details } : {}) };
}

function parseExclusion(value: unknown): SearchProductsV2Exclusion | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["product", "code"])) return null;
  const product = parseProductIdentity(value.product);
  const code = asEnum(value.code, SEARCH_PRODUCTS_V2_EXCLUSION_CODES);
  return product === null || code === null ? null : { product, code };
}

function parseRanking(value: unknown): SearchProductsV2Ranking | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["rank", "score"])) return null;
  const rank = asPositiveInteger(value.rank);
  const score = asZeroToOne(value.score);
  return rank === null || score === null ? null : { rank, score };
}

function parseRelationshipEvidence(value: unknown): SearchProductsV2RelationshipEvidence | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["jointCount", "support", "confidence", "lift"])) return null;
  const jointCount = asNonNegativeInteger(value.jointCount);
  const support = asFiniteNumber(value.support);
  const confidence = asZeroToOne(value.confidence);
  const lift = asFiniteNumber(value.lift);
  if (jointCount === null || support === null || support < 0 || confidence === null || lift === null || lift < 0) return null;
  return { jointCount, support, confidence, lift };
}

function parseRelationship(value: unknown): SearchProductsV2Relationship | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["type", "reliability", "evidence"])) return null;
  const type = asNonEmptyString(value.type);
  const reliability = asZeroToOne(value.reliability);
  if (type === null || reliability === null) return null;
  const evidence = parseRelationshipEvidence(value.evidence);
  return evidence === null ? null : { type, reliability, evidence };
}

function parseCommercialReason(value: unknown): SearchProductsV2CommercialReason | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["code", "label"])) return null;
  const code = asEnum(value.code, SEARCH_PRODUCTS_V2_COMMERCIAL_REASON_CODES);
  const label = asNonEmptyString(value.label);
  return code === null || label === null ? null : { code, label };
}

const RECOMMENDATION_KEYS = ["product", "rank", "score", "commercialScore", "affinityScore", "affinityConfidence", "ranking", "relationship", "commercialReason", "reasons", "warnings", "ownership"];

function parseRecommendation(value: unknown): SearchProductsV2Recommendation | null {
  if (!isRecord(value) || !hasOnlyKeys(value, RECOMMENDATION_KEYS)) return null;
  const product = parseProductSummary(value.product);
  const rank = asPositiveInteger(value.rank);
  const score = asZeroToOne(value.score);
  const commercialScore = asZeroToOne(value.commercialScore);
  const affinityScore = asZeroToOne(value.affinityScore);
  const affinityConfidence = asEnum(value.affinityConfidence, SEARCH_PRODUCTS_V2_AFFINITY_CONFIDENCES);
  if (product === null || rank === null || score === null || commercialScore === null || affinityScore === null || affinityConfidence === null) return null;

  const ranking = parseRanking(value.ranking);
  if (ranking === null) return null;
  const relationship = parseRelationship(value.relationship);
  if (relationship === null) return null;
  const commercialReason = parseCommercialReason(value.commercialReason);
  if (commercialReason === null) return null;

  if (!Array.isArray(value.reasons)) return null;
  const reasons: SearchProductsV2Reason[] = [];
  for (const entry of value.reasons) {
    const parsed = parseReason(entry);
    if (parsed === null) return null;
    reasons.push(parsed);
  }

  if (!Array.isArray(value.warnings)) return null;
  const warnings: SearchProductsV2Warning[] = [];
  for (const entry of value.warnings) {
    const parsed = parseWarning(entry);
    if (parsed === null) return null;
    warnings.push(parsed);
  }

  let ownership: SearchProductsV2Ownership | undefined;
  if (value.ownership !== undefined) {
    const parsed = parseOwnership(value.ownership);
    if (parsed === null) return null;
    ownership = parsed;
  }

  return { product, rank, score, commercialScore, affinityScore, affinityConfidence, ranking, relationship, commercialReason, reasons, warnings, ...(ownership !== undefined ? { ownership } : {}) };
}

function parsePersonalization(value: unknown): SearchProductsV2Personalization | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["applied", "reason", "customerId"])) return null;
  const applied = asBooleanStrict(value.applied);
  if (applied === null) return null;

  let reason: SearchProductsV2Personalization["reason"];
  if (value.reason !== undefined) {
    const parsed = asEnum(value.reason, SEARCH_PRODUCTS_V2_PERSONALIZATION_REASONS);
    if (parsed === null) return null;
    reason = parsed;
  }

  let customerId: string | undefined;
  if (value.customerId !== undefined) {
    const parsed = asNonEmptyString(value.customerId);
    if (parsed === null) return null;
    customerId = parsed;
  }

  return { applied, ...(reason !== undefined ? { reason } : {}), ...(customerId !== undefined ? { customerId } : {}) };
}

function parseSnapshot(value: unknown): SearchProductsV2Snapshot | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "modelVersion"])) return null;
  const id = asNonEmptyString(value.id);
  const modelVersion = asNonEmptyString(value.modelVersion);
  return id === null || modelVersion === null ? null : { id, modelVersion };
}

const STATISTICS_KEYS = ["commercialCandidates", "affinityCandidates", "personalizedRecommendations", "excludedRecommendations", "customerAffinityCalls", "personalizationCalls", "degradedStages", "warningsGenerated"];

function parseStatistics(value: unknown): SearchProductsV2Statistics | null {
  if (!isRecord(value) || !hasOnlyKeys(value, STATISTICS_KEYS)) return null;
  const commercialCandidates = asNonNegativeInteger(value.commercialCandidates);
  const affinityCandidates = asNonNegativeInteger(value.affinityCandidates);
  const personalizedRecommendations = asNonNegativeInteger(value.personalizedRecommendations);
  const excludedRecommendations = asNonNegativeInteger(value.excludedRecommendations);
  const degradedStages = asNonNegativeInteger(value.degradedStages);
  const warningsGenerated = asNonNegativeInteger(value.warningsGenerated);
  const customerAffinityCalls = value.customerAffinityCalls === 0 || value.customerAffinityCalls === 1 ? value.customerAffinityCalls : null;
  const personalizationCalls = value.personalizationCalls === 0 || value.personalizationCalls === 1 ? value.personalizationCalls : null;
  if (
    commercialCandidates === null ||
    affinityCandidates === null ||
    personalizedRecommendations === null ||
    excludedRecommendations === null ||
    degradedStages === null ||
    warningsGenerated === null ||
    customerAffinityCalls === null ||
    personalizationCalls === null
  ) {
    return null;
  }
  return { commercialCandidates, affinityCandidates, personalizedRecommendations, excludedRecommendations, customerAffinityCalls, personalizationCalls, degradedStages, warningsGenerated };
}

function parseExecutionStages(value: unknown): SearchProductsV2ExecutionStages | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["commercialRecommendation", "customerAffinity", "personalization"])) return null;
  const commercialRecommendation = asEnum(value.commercialRecommendation, ["completed", "failed"] as const);
  const customerAffinity = asEnum(value.customerAffinity, ["completed", "skipped", "degraded", "failed"] as const);
  const personalization = asEnum(value.personalization, ["completed", "skipped", "failed"] as const);
  if (commercialRecommendation === null || customerAffinity === null || personalization === null) return null;
  return { commercialRecommendation, customerAffinity, personalization };
}

function parseExecution(value: unknown): SearchProductsV2Execution | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["correlationId", "degraded", "degradationReasons", "stages"])) return null;
  const correlationId = asNonEmptyString(value.correlationId);
  const degraded = asBooleanStrict(value.degraded);
  if (correlationId === null || degraded === null) return null;

  if (!Array.isArray(value.degradationReasons)) return null;
  const degradationReasons: SearchProductsV2DegradationCode[] = [];
  for (const entry of value.degradationReasons) {
    const parsed = asEnum(entry, SEARCH_PRODUCTS_V2_DEGRADATION_CODES);
    if (parsed === null) return null;
    degradationReasons.push(parsed);
  }

  const stages = parseExecutionStages(value.stages);
  return stages === null ? null : { correlationId, degraded, degradationReasons, stages };
}

const RESULT_KEYS = ["query", "sourceProduct", "customer", "recommendations", "excluded", "personalization", "snapshot", "warnings", "statistics", "execution"];

function parseClientResponse(value: unknown): SearchProductsV2ClientResponse | null {
  if (!isRecord(value) || !hasOnlyKeys(value, RESULT_KEYS)) return null;

  let query: string | null;
  if (value.query === null) {
    query = null;
  } else {
    const parsed = asNonEmptyString(value.query);
    if (parsed === null) return null;
    query = parsed;
  }

  const sourceProduct = parseProductSummary(value.sourceProduct);
  if (sourceProduct === null) return null;

  let customer: { customerId: string } | undefined;
  if (value.customer !== undefined) {
    if (!isRecord(value.customer) || !hasOnlyKeys(value.customer, ["customerId"])) return null;
    const customerId = asNonEmptyString(value.customer.customerId);
    if (customerId === null) return null;
    customer = { customerId };
  }

  if (!Array.isArray(value.recommendations)) return null;
  const recommendations: SearchProductsV2Recommendation[] = [];
  for (const entry of value.recommendations) {
    const parsed = parseRecommendation(entry);
    if (parsed === null) return null;
    recommendations.push(parsed);
  }

  if (!Array.isArray(value.excluded)) return null;
  const excluded: SearchProductsV2Exclusion[] = [];
  for (const entry of value.excluded) {
    const parsed = parseExclusion(entry);
    if (parsed === null) return null;
    excluded.push(parsed);
  }

  const personalization = parsePersonalization(value.personalization);
  if (personalization === null) return null;

  const snapshot = parseSnapshot(value.snapshot);
  if (snapshot === null) return null;

  if (!Array.isArray(value.warnings)) return null;
  const warnings: SearchProductsV2Warning[] = [];
  for (const entry of value.warnings) {
    const parsed = parseWarning(entry);
    if (parsed === null) return null;
    warnings.push(parsed);
  }

  const statistics = parseStatistics(value.statistics);
  if (statistics === null) return null;

  const execution = parseExecution(value.execution);
  if (execution === null) return null;

  return { query, sourceProduct, ...(customer !== undefined ? { customer } : {}), recommendations, excluded, personalization, snapshot, warnings, statistics, execution };
}

// ---------------------------------------------------------------------------
// Request validation and serialization
// ---------------------------------------------------------------------------

function isValidProductIdentity(ref: SearchProductsV2ProductIdentity): boolean {
  if (typeof ref.productId !== "string" || ref.productId.trim().length === 0) return false;
  if (ref.combinationId !== undefined && (typeof ref.combinationId !== "string" || ref.combinationId.trim().length === 0)) return false;
  return true;
}

function identityKey(ref: SearchProductsV2ProductIdentity): string {
  return `${ref.productId}::${ref.combinationId ?? ""}`;
}

function hasDuplicateIdentities(refs: readonly SearchProductsV2ProductIdentity[]): boolean {
  const keys = refs.map(identityKey);
  return new Set(keys).size !== keys.length;
}

function hasOverlappingIdentities(a: readonly SearchProductsV2ProductIdentity[] | undefined, b: readonly SearchProductsV2ProductIdentity[] | undefined): boolean {
  if (!a || !b || a.length === 0 || b.length === 0) return false;
  const keys = new Set(a.map(identityKey));
  return b.some((ref) => keys.has(identityKey(ref)));
}

const SENTINEL_CUSTOMER_IDS = new Set(["0", "unknown"]);

function isSentinelCustomerId(value: string): boolean {
  return SENTINEL_CUSTOMER_IDS.has(value.trim().toLowerCase());
}

function invalidRequestError(message: string): SearchProductsV2ClientError {
  return { code: "invalid_request", message, retryable: false };
}

/**
 * Single normalization point for `query` (real contract: `z.string().trim().min(1).max(240)`
 * - the 240 bound applies after trim). Called once per request by `performSearch`
 * before both validation and serialization, so the value that is validated
 * is exactly the value that is sent - never validate one version and send another.
 */
function normalizeQuery(query: string | undefined): string | undefined {
  return query === undefined ? undefined : query.trim();
}

/**
 * Validated entirely before any network call - an invalid request never
 * reaches fetch. `request.query`, if present, must already be normalized
 * (trimmed) by the caller (`performSearch`) via `normalizeQuery`.
 */
function validateRequest(request: SearchProductsV2ClientRequest): SearchProductsV2ClientError | null {
  if (!isValidProductIdentity(request.sourceProduct)) {
    return invalidRequestError("sourceProduct must have a non-empty productId (and a non-empty combinationId, if present).");
  }
  if (request.query !== undefined && (request.query.length === 0 || request.query.length > 240)) {
    return invalidRequestError("query must be 1-240 characters.");
  }
  if (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 20)) {
    return invalidRequestError("limit must be an integer between 1 and 20.");
  }
  if (request.customer !== undefined) {
    const customerId = request.customer.customerId;
    if (typeof customerId !== "string" || customerId.trim().length === 0 || isSentinelCustomerId(customerId)) {
      return invalidRequestError("customer.customerId must be a non-empty, non-sentinel string.");
    }
  }
  if (request.filters?.inStockOnly !== undefined && typeof request.filters.inStockOnly !== "boolean") {
    return invalidRequestError("filters.inStockOnly must be a boolean.");
  }
  if (request.context === undefined) return null;

  const context = request.context;
  if (context.customerId !== undefined) {
    if (typeof context.customerId !== "string" || context.customerId.trim().length === 0) {
      return invalidRequestError("context.customerId must be a non-empty string.");
    }
    if (request.customer !== undefined && context.customerId !== request.customer.customerId) {
      return invalidRequestError("context.customerId must match customer.customerId when both are present.");
    }
  }
  if (context.intent !== undefined && (typeof context.intent !== "string" || context.intent.trim().length === 0)) {
    return invalidRequestError("context.intent must be a non-empty string.");
  }
  if (context.useCase !== undefined && (typeof context.useCase !== "string" || context.useCase.trim().length === 0)) {
    return invalidRequestError("context.useCase must be a non-empty string.");
  }
  if (context.budget !== undefined) {
    if (typeof context.budget.amount !== "number" || !Number.isFinite(context.budget.amount) || context.budget.amount < 0) {
      return invalidRequestError("context.budget.amount must be a finite, non-negative number.");
    }
    if (typeof context.budget.currency !== "string" || context.budget.currency.trim().length === 0) {
      return invalidRequestError("context.budget.currency must be a non-empty string.");
    }
  }
  const productReferenceFields: ReadonlyArray<readonly [string, readonly SearchProductsV2ProductIdentity[] | undefined]> = [
    ["preferredProducts", context.preferredProducts],
    ["excludedProducts", context.excludedProducts],
    ["explicitRepurchaseProducts", context.explicitRepurchaseProducts]
  ];
  for (const [field, refs] of productReferenceFields) {
    if (refs === undefined) continue;
    if (!refs.every(isValidProductIdentity)) return invalidRequestError(`${field} must contain valid product identities.`);
    if (hasDuplicateIdentities(refs)) return invalidRequestError(`${field} must not contain duplicate product identities.`);
  }
  if (hasOverlappingIdentities(context.excludedProducts, context.explicitRepurchaseProducts)) {
    return invalidRequestError("explicitRepurchaseProducts must not contain a product identity also present in excludedProducts.");
  }
  return null;
}

function identityToBody(ref: SearchProductsV2ProductIdentity): Record<string, unknown> {
  return { productId: ref.productId, ...(ref.combinationId !== undefined ? { combinationId: ref.combinationId } : {}) };
}

/** Explicit key-by-key allowlist - never spreads the caller's request object onto the body. */
function buildRequestBody(request: SearchProductsV2ClientRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { sourceProduct: identityToBody(request.sourceProduct) };
  if (request.query !== undefined) body.query = request.query;
  if (request.customer !== undefined) body.customer = { customerId: request.customer.customerId };

  if (request.context !== undefined) {
    const context: Record<string, unknown> = {};
    if (request.context.customerId !== undefined) context.customerId = request.context.customerId;
    if (request.context.intent !== undefined) context.intent = request.context.intent;
    if (request.context.useCase !== undefined) context.useCase = request.context.useCase;
    if (request.context.budget !== undefined) context.budget = { amount: request.context.budget.amount, currency: request.context.budget.currency };
    if (request.context.preferredProducts !== undefined) context.preferredProducts = request.context.preferredProducts.map(identityToBody);
    if (request.context.excludedProducts !== undefined) context.excludedProducts = request.context.excludedProducts.map(identityToBody);
    if (request.context.explicitRepurchaseProducts !== undefined) context.explicitRepurchaseProducts = request.context.explicitRepurchaseProducts.map(identityToBody);
    if (Object.keys(context).length > 0) body.context = context;
  }

  if (request.filters?.inStockOnly !== undefined) body.filters = { inStockOnly: request.filters.inStockOnly };
  if (request.limit !== undefined) body.limit = request.limit;
  return body;
}

// ---------------------------------------------------------------------------
// HTTP transport and error classification
// ---------------------------------------------------------------------------

function sanitizeErrorMessage(message: string): string {
  // Defence in depth: never interpolates the API key into an error, but
  // strips anything header-shaped in case an upstream body ever echoes
  // request context back in a message (same rule as httpCatalogAdapter.ts).
  return message.replace(/x-api-key['":\s]*[^\s,;"']+/gi, "x-api-key=[redacted]").replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}

function defaultRetryableForStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Maps the real service's two error body shapes (route-specific, always
 * carries `retryable`; app-level 401/429, never carries `retryable`) to one
 * closed local taxonomy. Never echoes the raw body - only the structured
 * `error.code` / `error.message` fields, sanitized.
 */
function classifyHttpError(status: number, body: unknown): SearchProductsV2ClientError {
  const errorBody = isRecord(body) && isRecord(body.error) ? body.error : null;
  const providerErrorCode = errorBody ? asNonEmptyString(errorBody.code) : null;
  const rawMessage = errorBody ? asNonEmptyString(errorBody.message) : null;
  const retryable = errorBody && typeof errorBody.retryable === "boolean" ? errorBody.retryable : defaultRetryableForStatus(status);

  let code: SearchProductsV2ClientErrorCode;
  if (status === 400) code = "invalid_request";
  else if (status === 401) code = "unauthorized";
  else if (status === 403) code = "forbidden";
  else if (status === 429) code = "rate_limited";
  else if (status >= 500) code = "catalog_service_error";
  else if (status === 404 || status === 409 || status === 422) code = "catalog_service_error";
  else code = "unexpected_http_status";

  const message = sanitizeErrorMessage(rawMessage ?? `Catalog service responded with HTTP ${status}.`);
  return { code, message, retryable, httpStatus: status, ...(providerErrorCode !== null ? { providerErrorCode } : {}) };
}

/**
 * Exactly one physical HTTP call per invocation - no adapter-level retry
 * loop, same rule already applied to the catalog and customer-profile HTTP
 * adapters. A new AbortController and RequestInit are built per call; the
 * internal timeout and an optional external signal are combined without
 * reusing state across invocations.
 */
async function performSearch(config: HttpCatalogSearchProductsV2ClientConfig, request: SearchProductsV2ClientRequest, callContext: SearchProductsV2ClientCallContext): Promise<SearchProductsV2ClientResult> {
  // Normalized once, here, before both validation and serialization - the
  // original `request` object passed by the caller is never mutated.
  const normalizedRequest: SearchProductsV2ClientRequest = { ...request, query: normalizeQuery(request.query) };

  const validationError = validateRequest(normalizedRequest);
  if (validationError !== null) return { ok: false, error: validationError };

  if (callContext.signal?.aborted) {
    return { ok: false, error: { code: "aborted", message: "Request was cancelled before it started.", retryable: false } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const onExternalAbort = () => controller.abort();
  callContext.signal?.addEventListener("abort", onExternalAbort);

  try {
    const response = await fetch(`${config.baseUrl}${SEARCH_PRODUCTS_V2_PATH}`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-api-key": config.apiKey,
        ...(callContext.correlationId ? { "x-correlation-id": callContext.correlationId } : {})
      },
      body: JSON.stringify(buildRequestBody(normalizedRequest))
    });

    const text = await response.text();
    let parsedBody: unknown = null;
    if (text) {
      try {
        parsedBody = JSON.parse(text);
      } catch {
        return { ok: false, error: { code: "invalid_response_body", message: "Catalog service returned invalid JSON.", retryable: false, httpStatus: response.status } };
      }
    }

    if (response.status < 200 || response.status >= 300) {
      return { ok: false, error: classifyHttpError(response.status, parsedBody) };
    }

    const parsed = parseClientResponse(parsedBody);
    if (parsed === null) {
      return {
        ok: false,
        error: { code: "invalid_response_schema", message: "Catalog service returned a response that does not match the expected SearchProducts V2 schema.", retryable: false, httpStatus: response.status }
      };
    }
    return { ok: true, value: parsed };
  } catch {
    if (controller.signal.aborted) {
      if (callContext.signal?.aborted) {
        return { ok: false, error: { code: "aborted", message: "Request was cancelled.", retryable: false } };
      }
      return { ok: false, error: { code: "timeout", message: "Catalog service request timed out.", retryable: true } };
    }
    return { ok: false, error: { code: "network_error", message: "Catalog service request failed due to a network error.", retryable: true } };
  } finally {
    clearTimeout(timer);
    callContext.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** Real HTTP client. `config` is read once by the caller so tests can point it at a local server per-test. */
export function createHttpCatalogSearchProductsV2Client(config: HttpCatalogSearchProductsV2ClientConfig): CatalogSearchProductsV2Client {
  return {
    searchProducts(request, context = {}) {
      return performSearch(config, request, context);
    }
  };
}

/** Fail-closed stand-in used when configuration is absent - never falls back to a local catalog read or invented data. */
function createUnavailableClient(): CatalogSearchProductsV2Client {
  return {
    async searchProducts() {
      return { ok: false, error: { code: "configuration_error", message: "Catalog service SearchProducts V2 client is not configured.", retryable: false } };
    }
  };
}

/**
 * Productive factory (CP-R1-T10B5). Returns the fail-closed client (not
 * null) when CATALOG_SERVICE_BASE_URL / CATALOG_SERVICE_API_KEY are absent,
 * so every call surfaces `configuration_error` instead of crashing. Throws
 * CatalogSearchProductsV2ConfigurationError when a present value is
 * structurally invalid (bootstrap-time failure, not a per-request result).
 * Not wired to the Sales Agent or the Agent Tool Loop - see
 * docs/releases/CP-R1-T10B5-crm-search-products-v2-client.md.
 */
export function createCatalogSearchProductsV2Client(): CatalogSearchProductsV2Client {
  const config = readHttpCatalogSearchProductsV2ClientConfig();
  if (config === null) return createUnavailableClient();
  return createHttpCatalogSearchProductsV2Client(config);
}
