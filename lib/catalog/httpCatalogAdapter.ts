/**
 * HTTP adapter for MS-pesaschile-catalog-service (real, read-only PrestaShop
 * catalog microservice - see its README for the authoritative contract).
 * Endpoints, headers and error codes below mirror that service's actual
 * Fastify routes and shared/contracts.ts schemas exactly, ported here (not
 * imported as a dependency) so this repo stays free of a cross-repo package.
 */
import {
  CATALOG_ADAPTER_CONTRACT_VERSION,
  type CatalogAttribute,
  type CatalogAvailabilityStatus,
  type CatalogPort,
  type CatalogPortError,
  type CatalogPortErrorCode,
  type CatalogPortResult,
  type CatalogProduct,
  type CatalogProductVariant,
  type CatalogRequestContext,
  type CatalogSearchResult,
  type CatalogSearchResultItem
} from "./types";

export type HttpCatalogAdapterConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
};

const DEFAULT_TIMEOUT_MS = 5000;

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

function sanitizeErrorMessage(message: string): string {
  // Defence in depth: the adapter never interpolates the API key into an
  // error, but strip anything header-shaped just in case a provider echoes
  // request context back in a message.
  return message
    .replace(/x-api-key['":\s]*[^\s,;"']+/gi, "x-api-key=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}

function catalogError(code: CatalogPortErrorCode, message: string, retryable: boolean, providerErrorCode?: string | null, correlationId?: string | null): CatalogPortError {
  return { code, message: sanitizeErrorMessage(message), retryable, providerErrorCode: providerErrorCode ?? null, correlationId: correlationId ?? null };
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
    default:
      if (httpStatus >= 500) return { code: "unavailable", retryable: true };
      if (httpStatus === 401 || httpStatus === 403) return { code: "unauthorized", retryable: false };
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
        discountApplied: asBoolean(pricing.discountApplied)
      }
    : null;

  const stock = isRecord(payload.stock) ? payload.stock : null;
  const availability = stock ? toAvailability(stock.available) : "unknown";
  const stockQuantity = stock ? asNumber(stock.physicalQuantity) : null;

  const freshness = isRecord(payload.freshness) ? payload.freshness : {};

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
    provenance: { source: "catalog_service_http", retrievedAt, cached: asBoolean(freshness.cached) }
  };
}

async function fetchJson(
  config: HttpCatalogAdapterConfig,
  path: string,
  context: CatalogRequestContext
): Promise<{ status: number; body: unknown } | { networkError: true }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "x-api-key": config.apiKey,
        "x-correlation-id": context.correlationId
      }
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
  parse: (payload: unknown, retrievedAt: string) => T | null
): Promise<CatalogPortResult<T>> {
  const result = await fetchJson(config, path, context);
  const retrievedAt = new Date().toISOString();

  if ("networkError" in result) {
    return { ok: false, error: catalogError("timeout", "Catalog service request timed out or the network failed.", true, null, context.correlationId) };
  }

  if (result.status >= 200 && result.status < 300) {
    const parsed = parse(result.body, retrievedAt);
    if (parsed === null) {
      return { ok: false, error: catalogError("invalid_response", "Catalog service returned an unexpected payload shape.", false, null, context.correlationId) };
    }
    return { ok: true, value: parsed };
  }

  const errorBody = isRecord(result.body) && isRecord(result.body.error) ? result.body.error : null;
  const providerErrorCode = errorBody ? asString(errorBody.code) ?? undefined : undefined;
  const message = errorBody ? asString(errorBody.message) ?? `HTTP ${result.status}` : `HTTP ${result.status}`;
  const mapped = mapProviderErrorCode(providerErrorCode, result.status);
  return { ok: false, error: catalogError(mapped.code, message, mapped.retryable, providerErrorCode ?? null, context.correlationId) };
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
    }
  };
}

export const HTTP_CATALOG_ADAPTER_CONTRACT_VERSION = CATALOG_ADAPTER_CONTRACT_VERSION;
