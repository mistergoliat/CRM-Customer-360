/**
 * HTTP adapter for MS-pesaschile-customer-profile (real, read-only
 * historical-purchase microservice). Routes, status mapping and payload
 * shapes below mirror that service's actual Express routes
 * (src/http/routes/index.ts) and domain contracts
 * (src/domain/customer-purchased-products/contracts.ts,
 * src/domain/customer-purchase-behavior/contracts.ts) exactly, ported here
 * (not imported as a dependency) so this repo stays free of a cross-repo
 * package.
 *
 * CP-R1-T10B1 scope: plumbing only. This adapter never resolves identity,
 * never searches by email, never queries PrestaShop directly, never
 * computes behavior/RFM, and never recommends products - it transports and
 * validates the two read-only HTTP contracts below.
 */
import type {
  CustomerProfileLookupResult,
  CustomerProfilePort,
  CustomerProfileRequestContext,
  GetPurchaseBehaviorData,
  GetPurchaseBehaviorInput,
  GetPurchasedProductsData,
  GetPurchasedProductsInput,
  PurchaseBehaviorConcentration,
  PurchaseBehaviorProduct,
  PurchaseBehaviorSummary,
  PurchaseBehaviorVariant,
  PurchasedProductItem,
  PurchasedProductsPagination
} from "./types";

export type HttpCustomerProfileAdapterConfig = {
  baseUrl: string;
  /**
   * The real service (src/app.ts) does not enforce an x-api-key middleware
   * today - sent only when configured, never required to build a config
   * (unlike catalog-service / customer-service, which do enforce one).
   */
  apiKey: string | null;
  timeoutMs: number;
};

const DEFAULT_TIMEOUT_MS = 5000;

export function readHttpCustomerProfileAdapterConfig(): HttpCustomerProfileAdapterConfig | null {
  const baseUrl = process.env.CUSTOMER_PROFILE_SERVICE_BASE_URL?.trim();
  if (!baseUrl) return null;
  const apiKey = process.env.CUSTOMER_PROFILE_SERVICE_API_KEY?.trim();
  const timeoutMs = Number.parseInt(process.env.CUSTOMER_PROFILE_SERVICE_TIMEOUT_MS?.trim() ?? "", 10);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey: apiKey ? apiKey : null,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  };
}

// Mirrors the real route's own bound exactly (src/http/routes/index.ts,
// masterCustomerId: z.string().trim().min(1).max(20).regex(/^[0-9]+$/)) -
// deliberately not trimmed here, so leading/trailing whitespace is rejected
// rather than silently normalized.
const MASTER_CUSTOMER_ID_PATTERN = /^[0-9]{1,20}$/;

function isValidMasterCustomerId(value: string): boolean {
  return MASTER_CUSTOMER_ID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function asBooleanStrict(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Amounts and shares are decimal strings per the real contract - never coerced to number. */
const DECIMAL_STRING_PATTERN = /^\d+(\.\d+)?$/;

function asDecimalString(value: unknown): string | null {
  return typeof value === "string" && DECIMAL_STRING_PATTERN.test(value) ? value : null;
}

function asIsoDateString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** value.productReference is nullable in the real contract, distinct from "field absent/wrong type". */
function asNullableString(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  const text = asString(value);
  return text !== null ? { ok: true, value: text } : { ok: false };
}

function parsePurchasedProductItem(value: unknown): PurchasedProductItem | null {
  if (!isRecord(value)) return null;
  const productId = asNonNegativeInteger(value.productId);
  const productAttributeId = asNonNegativeInteger(value.productAttributeId);
  const productName = asString(value.productName);
  const productReference = asNullableString(value.productReference);
  const totalQuantityPurchased = asNonNegativeInteger(value.totalQuantityPurchased);
  const orderCount = asNonNegativeInteger(value.orderCount);
  const firstPurchasedAt = asIsoDateString(value.firstPurchasedAt);
  const lastPurchasedAt = asIsoDateString(value.lastPurchasedAt);
  const totalSpentTaxIncl = asDecimalString(value.totalSpentTaxIncl);
  const catalogStatus = value.catalogStatus === "linked" || value.catalogStatus === "deleted_or_unavailable" ? value.catalogStatus : null;

  if (
    productId === null ||
    productAttributeId === null ||
    productName === null ||
    !productReference.ok ||
    totalQuantityPurchased === null ||
    orderCount === null ||
    firstPurchasedAt === null ||
    lastPurchasedAt === null ||
    totalSpentTaxIncl === null ||
    catalogStatus === null
  ) {
    return null;
  }

  return {
    productId,
    productAttributeId,
    productName,
    productReference: productReference.value,
    totalQuantityPurchased,
    orderCount,
    firstPurchasedAt,
    lastPurchasedAt,
    totalSpentTaxIncl,
    catalogStatus
  };
}

function parsePagination(value: unknown): PurchasedProductsPagination | null {
  if (!isRecord(value)) return null;
  const limit = asNonNegativeInteger(value.limit);
  const offset = asNonNegativeInteger(value.offset);
  const returned = asNonNegativeInteger(value.returned);
  const hasMore = asBooleanStrict(value.hasMore);
  if (limit === null || offset === null || returned === null || hasMore === null) return null;
  return { limit, offset, returned, hasMore };
}

function parsePurchasedProductsData(payload: unknown): GetPurchasedProductsData | null {
  if (!isRecord(payload) || !Array.isArray(payload.products)) return null;
  const products: PurchasedProductItem[] = [];
  for (const entry of payload.products) {
    const item = parsePurchasedProductItem(entry);
    if (item === null) return null;
    products.push(item);
  }
  const pagination = parsePagination(payload.pagination);
  if (pagination === null) return null;
  return { products, pagination };
}

function parseConcentration(value: unknown): PurchaseBehaviorConcentration | null {
  if (!isRecord(value)) return null;
  const top1Share = asDecimalString(value.top1Share);
  const top3Share = asDecimalString(value.top3Share);
  const hhi = asDecimalString(value.hhi);
  const effectiveDiversity = asDecimalString(value.effectiveDiversity);
  if (top1Share === null || top3Share === null || hhi === null || effectiveDiversity === null) return null;
  return { top1Share, top3Share, hhi, effectiveDiversity };
}

function parseSummary(value: unknown): PurchaseBehaviorSummary | null {
  if (!isRecord(value)) return null;
  const validOrderCount = asNonNegativeInteger(value.validOrderCount);
  const distinctProductCount = asNonNegativeInteger(value.distinctProductCount);
  const distinctVariantCount = asNonNegativeInteger(value.distinctVariantCount);
  const repeatedProductCount = asNonNegativeInteger(value.repeatedProductCount);
  const repeatedVariantCount = asNonNegativeInteger(value.repeatedVariantCount);
  const repeatProductRate = asDecimalString(value.repeatProductRate);
  const repeatVariantRate = asDecimalString(value.repeatVariantRate);
  const repeatedVariantSpendShare = asDecimalString(value.repeatedVariantSpendShare);
  const productSpendConcentration = parseConcentration(value.productSpendConcentration);
  const variantSpendConcentration = parseConcentration(value.variantSpendConcentration);

  if (
    validOrderCount === null ||
    distinctProductCount === null ||
    distinctVariantCount === null ||
    repeatedProductCount === null ||
    repeatedVariantCount === null ||
    repeatProductRate === null ||
    repeatVariantRate === null ||
    repeatedVariantSpendShare === null ||
    productSpendConcentration === null ||
    variantSpendConcentration === null
  ) {
    return null;
  }

  return {
    validOrderCount,
    distinctProductCount,
    distinctVariantCount,
    repeatedProductCount,
    repeatedVariantCount,
    repeatProductRate,
    repeatVariantRate,
    repeatedVariantSpendShare,
    productSpendConcentration,
    variantSpendConcentration
  };
}

function parseBehaviorProduct(value: unknown): PurchaseBehaviorProduct | null {
  if (!isRecord(value)) return null;
  const productId = asNonNegativeInteger(value.productId);
  const latestObservedProductName = asString(value.latestObservedProductName);
  const latestObservedProductReference = asNullableString(value.latestObservedProductReference);
  const variantCountPurchased = asNonNegativeInteger(value.variantCountPurchased);
  const repeatedVariantCount = asNonNegativeInteger(value.repeatedVariantCount);
  const orderCount = asNonNegativeInteger(value.orderCount);
  const totalQuantityPurchased = asNonNegativeInteger(value.totalQuantityPurchased);
  const totalSpentTaxIncl = asDecimalString(value.totalSpentTaxIncl);
  const spendShare = asDecimalString(value.spendShare);
  const orderShare = asDecimalString(value.orderShare);
  const quantityShare = asDecimalString(value.quantityShare);
  const firstPurchasedAt = asIsoDateString(value.firstPurchasedAt);
  const lastPurchasedAt = asIsoDateString(value.lastPurchasedAt);
  const daysSinceLastPurchase = asNonNegativeInteger(value.daysSinceLastPurchase);
  const isRepeated = asBooleanStrict(value.isRepeated);

  if (
    productId === null ||
    latestObservedProductName === null ||
    !latestObservedProductReference.ok ||
    variantCountPurchased === null ||
    repeatedVariantCount === null ||
    orderCount === null ||
    totalQuantityPurchased === null ||
    totalSpentTaxIncl === null ||
    spendShare === null ||
    orderShare === null ||
    quantityShare === null ||
    firstPurchasedAt === null ||
    lastPurchasedAt === null ||
    daysSinceLastPurchase === null ||
    isRepeated === null
  ) {
    return null;
  }

  return {
    productId,
    latestObservedProductName,
    latestObservedProductReference: latestObservedProductReference.value,
    variantCountPurchased,
    repeatedVariantCount,
    orderCount,
    totalQuantityPurchased,
    totalSpentTaxIncl,
    spendShare,
    orderShare,
    quantityShare,
    firstPurchasedAt,
    lastPurchasedAt,
    daysSinceLastPurchase,
    isRepeated
  };
}

function parseBehaviorVariant(value: unknown): PurchaseBehaviorVariant | null {
  if (!isRecord(value)) return null;
  const productId = asNonNegativeInteger(value.productId);
  const productAttributeId = asNonNegativeInteger(value.productAttributeId);
  const productName = asString(value.productName);
  const productReference = asNullableString(value.productReference);
  const orderCount = asNonNegativeInteger(value.orderCount);
  const totalQuantityPurchased = asNonNegativeInteger(value.totalQuantityPurchased);
  const totalSpentTaxIncl = asDecimalString(value.totalSpentTaxIncl);
  const spendShare = asDecimalString(value.spendShare);
  const orderShare = asDecimalString(value.orderShare);
  const quantityShare = asDecimalString(value.quantityShare);
  const firstPurchasedAt = asIsoDateString(value.firstPurchasedAt);
  const lastPurchasedAt = asIsoDateString(value.lastPurchasedAt);
  const daysSinceLastPurchase = asNonNegativeInteger(value.daysSinceLastPurchase);
  const isRepeated = asBooleanStrict(value.isRepeated);

  if (
    productId === null ||
    productAttributeId === null ||
    productName === null ||
    !productReference.ok ||
    orderCount === null ||
    totalQuantityPurchased === null ||
    totalSpentTaxIncl === null ||
    spendShare === null ||
    orderShare === null ||
    quantityShare === null ||
    firstPurchasedAt === null ||
    lastPurchasedAt === null ||
    daysSinceLastPurchase === null ||
    isRepeated === null
  ) {
    return null;
  }

  return {
    productId,
    productAttributeId,
    productName,
    productReference: productReference.value,
    orderCount,
    totalQuantityPurchased,
    totalSpentTaxIncl,
    spendShare,
    orderShare,
    quantityShare,
    firstPurchasedAt,
    lastPurchasedAt,
    daysSinceLastPurchase,
    isRepeated
  };
}

function parsePurchaseBehaviorData(payload: unknown): GetPurchaseBehaviorData | null {
  if (!isRecord(payload) || payload.currencyIsoCode !== "CLP") return null;
  const calculatedAt = asIsoDateString(payload.calculatedAt);
  if (calculatedAt === null) return null;
  const summary = parseSummary(payload.summary);
  if (summary === null) return null;
  if (!Array.isArray(payload.topProducts) || !Array.isArray(payload.topVariants)) return null;

  const topProducts: PurchaseBehaviorProduct[] = [];
  for (const entry of payload.topProducts) {
    const item = parseBehaviorProduct(entry);
    if (item === null) return null;
    topProducts.push(item);
  }

  const topVariants: PurchaseBehaviorVariant[] = [];
  for (const entry of payload.topVariants) {
    const item = parseBehaviorVariant(entry);
    if (item === null) return null;
    topVariants.push(item);
  }

  return { currencyIsoCode: "CLP", calculatedAt, summary, topProducts, topVariants };
}

type RawFetchResult = { status: number; body: unknown } | { networkError: true };

async function fetchJson(config: HttpCustomerProfileAdapterConfig, path: string, context: CustomerProfileRequestContext): Promise<RawFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-correlation-id": context.correlationId
    };
    if (config.apiKey) headers["x-api-key"] = config.apiKey;
    const response = await fetch(`${config.baseUrl}${path}`, { method: "GET", signal: controller.signal, headers });
    const text = await response.text();
    if (!text) return { status: response.status, body: null };
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      return { status: response.status, body: null };
    }
  } catch {
    return { networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exactly one physical HTTP call per invocation - retry ownership belongs to
 * a future Capability Gateway / orchestrator, same rule already applied to
 * the catalog and customer-service HTTP adapters. Maps the real service's
 * 200/404/503/400/401/403/429/5xx contract (src/http/routes/index.ts)
 * verbatim - never invents a status this task's discriminated result does
 * not cover.
 */
async function performLookup<T>(
  config: HttpCustomerProfileAdapterConfig,
  path: string,
  context: CustomerProfileRequestContext,
  parseData: (payload: unknown) => T | null
): Promise<CustomerProfileLookupResult<T>> {
  const result = await fetchJson(config, path, context);

  if ("networkError" in result) {
    return { status: "failed", code: "timeout", retryable: true };
  }

  if (result.status === 200) {
    const data = parseData(result.body);
    if (data === null) return { status: "failed", code: "invalid_response", retryable: false };
    return { status: "available", data };
  }

  if (result.status === 404) {
    const bodyStatus = isRecord(result.body) ? asString(result.body.status) : null;
    if (bodyStatus === "customer_not_found") return { status: "customer_not_found" };
    if (bodyStatus === "customer_not_linked") return { status: "customer_not_linked" };
    return { status: "failed", code: "invalid_response", retryable: false };
  }

  if (result.status === 503) {
    const bodyStatus = isRecord(result.body) ? asString(result.body.status) : null;
    if (bodyStatus === "degraded") {
      const reasonRaw = isRecord(result.body) ? asString(result.body.reason) : null;
      const reason = reasonRaw === "prestashop_unavailable" || reasonRaw === "prestashop_timeout" ? reasonRaw : "unknown";
      return { status: "degraded", reason, retryable: true };
    }
    return { status: "failed", code: "upstream_error", retryable: true };
  }

  if (result.status === 400) return { status: "failed", code: "invalid_request", retryable: false };
  if (result.status === 401 || result.status === 403) return { status: "failed", code: "authentication_error", retryable: false };
  if (result.status === 429) return { status: "failed", code: "rate_limited", retryable: true };
  if (result.status >= 500) return { status: "failed", code: "upstream_error", retryable: true };

  return { status: "failed", code: "upstream_error", retryable: false };
}

/** Real HTTP adapter. `config` is read once by the caller so tests can point it at a local server per-test. */
export function createHttpCustomerProfileAdapter(config: HttpCustomerProfileAdapterConfig): CustomerProfilePort {
  return {
    async getPurchasedProducts(input: GetPurchasedProductsInput, context: CustomerProfileRequestContext) {
      if (!isValidMasterCustomerId(input.masterCustomerId)) {
        return { status: "failed", code: "invalid_request", retryable: false };
      }
      const params = new URLSearchParams();
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.offset !== undefined) params.set("offset", String(input.offset));
      const query = params.toString();
      const path = `/v1/customers/${encodeURIComponent(input.masterCustomerId)}/purchased-products${query ? `?${query}` : ""}`;
      return performLookup(config, path, context, parsePurchasedProductsData);
    },

    async getPurchaseBehavior(input: GetPurchaseBehaviorInput, context: CustomerProfileRequestContext) {
      if (!isValidMasterCustomerId(input.masterCustomerId)) {
        return { status: "failed", code: "invalid_request", retryable: false };
      }
      const params = new URLSearchParams();
      if (input.topProducts !== undefined) params.set("topProducts", String(input.topProducts));
      if (input.topVariants !== undefined) params.set("topVariants", String(input.topVariants));
      const query = params.toString();
      const path = `/v1/customers/${encodeURIComponent(input.masterCustomerId)}/purchase-behavior${query ? `?${query}` : ""}`;
      return performLookup(config, path, context, parsePurchaseBehaviorData);
    }
  };
}

/** Fail-closed stand-in used when configuration is absent - never falls back to local SQL. */
function createUnavailableCustomerProfilePort(): CustomerProfilePort {
  const unavailable = async () => ({ status: "failed" as const, code: "unavailable" as const, retryable: false });
  return {
    getPurchasedProducts: unavailable,
    getPurchaseBehavior: unavailable
  };
}

/**
 * Productive CustomerProfilePort factory. Returns the fail-closed port (not
 * null) when CUSTOMER_PROFILE_SERVICE_BASE_URL is not configured, so every
 * call surfaces `unavailable` instead of crashing or being mistaken for a
 * resolved lookup. Never falls back to local SQL or another route to
 * Customer Profile.
 */
export function createCustomerProfilePort(): CustomerProfilePort {
  const config = readHttpCustomerProfileAdapterConfig();
  if (!config) return createUnavailableCustomerProfilePort();
  return createHttpCustomerProfileAdapter(config);
}
