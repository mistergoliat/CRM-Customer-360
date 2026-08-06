import { redactErrorMessage } from "@/lib/brain/commercial/redactErrorMessage";
import {
  parseCustomerCommercialSummaryResponse,
  parseCustomerOrderStatusResponse,
  parseCustomerProfileReadinessResponse,
  parseCustomerProfileResponse,
  parseCustomerPurchasedProductsResponse,
  parseCustomerPurchaseBehaviorResponse,
  validateCustomerId,
  validateOrderReference,
  validatePurchaseBehaviorTopProducts,
  validatePurchaseBehaviorTopVariants,
  validatePurchasedProductsLimit,
  validatePurchasedProductsOffset
} from "./schemas";
import type {
  CustomerCommercialSummaryResponse,
  CustomerCommercialSummaryResult,
  CustomerProfileClient,
  CustomerProfileClientConfig,
  CustomerProfileClientResult,
  CustomerProfileContractErrorReason,
  CustomerProfileNotFoundReason,
  CustomerProfileResponse,
  CustomerProfileReadinessResult,
  CustomerProfileResult,
  CustomerProfileUnavailableReason,
  CustomerPurchasedProductsResponse,
  CustomerPurchasedProductsResult,
  CustomerPurchaseBehaviorResponse,
  CustomerPurchaseBehaviorResult,
  CustomerOrderStatusResponse,
  CustomerOrderStatusResult,
  GetCommercialSummaryInput,
  GetCustomerOrderStatusInput,
  GetCustomerProfileInput,
  GetPurchaseBehaviorInput,
  GetPurchasedProductsInput
} from "./types";

const DEFAULT_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 30000;
const SERVICE_HEADER_NAME = "x-service-name";
const SERVICE_HEADER_VALUE = "crm-customer-360";

export class CustomerProfileClientConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerProfileClientConfigurationError";
  }
}

type CustomerProfileOperation =
  | "profile"
  | "commercial-summary"
  | "purchased-products"
  | "purchase-behavior"
  | "order-status"
  | "readiness";

type Observation = {
  operation: CustomerProfileOperation;
  requestId: string | null;
  customerId: number | null;
  referencePresent: boolean;
  status: string;
  reason: string | null;
  httpStatus: number | null;
  durationMs: number;
  contractVersion: string | null;
  identitySource: string | null;
};

type JsonReadResult = { kind: "json"; body: unknown } | { kind: "empty" } | { kind: "invalid_json" };

type HttpResponseResult = {
  status: number;
  body: JsonReadResult;
};

function readEnabledFlag(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new CustomerProfileClientConfigurationError('CUSTOMER_PROFILE_ENABLED must be "true" or "false".');
}

function normalizeBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CustomerProfileClientConfigurationError("CUSTOMER_PROFILE_BASE_URL must be an absolute http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CustomerProfileClientConfigurationError("CUSTOMER_PROFILE_BASE_URL must use http or https.");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new CustomerProfileClientConfigurationError("CUSTOMER_PROFILE_BASE_URL must not contain embedded credentials.");
  }
  if (parsed.search !== "") {
    throw new CustomerProfileClientConfigurationError("CUSTOMER_PROFILE_BASE_URL must not contain a query string.");
  }
  if (parsed.hash !== "") {
    throw new CustomerProfileClientConfigurationError("CUSTOMER_PROFILE_BASE_URL must not contain a fragment.");
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

function readTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TIMEOUT_MS;
  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_TIMEOUT_MS || String(parsed) !== trimmed) {
    throw new CustomerProfileClientConfigurationError(`CUSTOMER_PROFILE_TIMEOUT_MS must be a positive integer up to ${MAX_TIMEOUT_MS}.`);
  }
  return parsed;
}

export function readCustomerProfileClientConfig(env: NodeJS.ProcessEnv = process.env): CustomerProfileClientConfig {
  const enabled = readEnabledFlag(env.CUSTOMER_PROFILE_ENABLED);
  const timeoutMs = readTimeoutMs(env.CUSTOMER_PROFILE_TIMEOUT_MS);
  const authToken = env.CUSTOMER_PROFILE_AUTH_TOKEN?.trim() || null;
  const baseUrlRaw = env.CUSTOMER_PROFILE_BASE_URL?.trim();

  if (!enabled) {
    return { enabled: false, baseUrl: baseUrlRaw ? normalizeBaseUrl(baseUrlRaw) : null, timeoutMs, authToken };
  }
  if (!baseUrlRaw) {
    throw new CustomerProfileClientConfigurationError("CUSTOMER_PROFILE_BASE_URL is required when CUSTOMER_PROFILE_ENABLED=true.");
  }
  return { enabled: true, baseUrl: normalizeBaseUrl(baseUrlRaw), timeoutMs, authToken };
}

function unavailableResult(reason: CustomerProfileUnavailableReason, retryable: boolean) {
  return { status: "UNAVAILABLE" as const, reason, retryable };
}

function contractError(reason: CustomerProfileContractErrorReason) {
  return { status: "CONTRACT_ERROR" as const, reason };
}

function invalidRequest(reason: "INVALID_CUSTOMER_ID" | "INVALID_LIMIT" | "INVALID_OFFSET" | "INVALID_TOP_PRODUCTS" | "INVALID_TOP_VARIANTS" | "INVALID_ORDER_REFERENCE") {
  return { status: "INVALID_REQUEST" as const, reason };
}

function buildUrl(baseUrl: string, path: string, query?: URLSearchParams): URL {
  const url = new URL(path.replace(/^\//, ""), `${baseUrl}/`);
  if (query && [...query.keys()].length > 0) {
    url.search = query.toString();
  }
  return url;
}

async function readJsonBody(response: Response): Promise<JsonReadResult> {
  const text = await response.text();
  if (!text) return { kind: "empty" };
  try {
    return { kind: "json", body: JSON.parse(text) };
  } catch {
    return { kind: "invalid_json" };
  }
}

function logObservation(observation: Observation): void {
  console.info({
    event: "customer_profile_client_request",
    service: "customer-profile",
    operation: observation.operation,
    requestId: observation.requestId,
    customerId: observation.customerId,
    referencePresent: observation.referencePresent,
    status: observation.status,
    reason: observation.reason,
    httpStatus: observation.httpStatus,
    durationMs: observation.durationMs,
    contractVersion: observation.contractVersion,
    identitySource: observation.identitySource
  });
}

function mapUnavailableReasonFrom503(body: unknown): CustomerProfileUnavailableReason {
  if (typeof body !== "object" || body === null) return "CUSTOMER_PROFILE_UNAVAILABLE";
  const reason = "reason" in body ? body.reason : null;
  if (reason === "prestashop_unavailable") return "PRESTASHOP_UNAVAILABLE";
  if (reason === "prestashop_schema_incompatible") return "PRESTASHOP_SCHEMA_INCOMPATIBLE";
  if (reason === "customer_profile_unavailable") return "CUSTOMER_PROFILE_UNAVAILABLE";
  return "CUSTOMER_PROFILE_UNAVAILABLE";
}

function mapContractFailure(reason: CustomerProfileContractErrorReason | "INVALID_RESPONSE") {
  return contractError(reason);
}

function finalizeWithObservation<T extends { status: string }>(
  observation: Omit<Observation, "status" | "reason" | "contractVersion" | "identitySource">,
  result: T
): T {
  const base = {
    ...observation,
    status: result.status,
    reason: "reason" in result && typeof result.reason === "string" ? result.reason : null,
    contractVersion:
      result.status === "AVAILABLE" && "metadata" in result && typeof result.metadata === "object" && result.metadata !== null && "contractVersion" in result.metadata
        ? String(result.metadata.contractVersion)
        : null,
    identitySource:
      result.status === "AVAILABLE" && "metadata" in result && typeof result.metadata === "object" && result.metadata !== null && "identitySource" in result.metadata
        ? String(result.metadata.identitySource)
        : null
  };
  logObservation(base);
  return result;
}

async function fetchOnce(config: CustomerProfileClientConfig, url: URL, requestId?: string): Promise<HttpResponseResult | { kind: "timeout" } | { kind: "network_error" }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        [SERVICE_HEADER_NAME]: SERVICE_HEADER_VALUE,
        ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
        ...(requestId ? { "x-request-id": requestId } : {})
      }
    });
    return { status: response.status, body: await readJsonBody(response) };
  } catch (error) {
    if (controller.signal.aborted) return { kind: "timeout" };
    const redacted = redactErrorMessage(error);
    if (redacted.length > 0) {
      void redacted;
    }
    return { kind: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

function classifyInvalidBody(status: number) {
  if (status >= 500 || status === 429 || status === 408 || status === 503) return unavailableResult("CUSTOMER_PROFILE_UNAVAILABLE", true);
  return unavailableResult("CUSTOMER_PROFILE_UNAVAILABLE", false);
}

function createDisabledCustomerProfileClient(): CustomerProfileClient {
  const disabled = async () => unavailableResult("CUSTOMER_PROFILE_DISABLED", false);
  return {
    getProfile: disabled,
    getCommercialSummary: disabled,
    getPurchasedProducts: disabled,
    getPurchaseBehavior: disabled,
    getOrderStatus: disabled,
    checkReadiness: disabled
  };
}

async function requestCustomerEndpoint<TAvailable extends { provenance: { contractVersion: string; customerIdentity: { source: string }; generatedAt: string } }, TNotFound extends CustomerProfileNotFoundReason>(
  config: CustomerProfileClientConfig,
  input: {
    operation: CustomerProfileOperation;
    customerId: number;
    requestId?: string;
    path: string;
    query?: URLSearchParams;
    referencePresent?: boolean;
  },
  parseAvailable: (body: unknown, requestedCustomerId: number) => { ok: true; value: TAvailable } | { ok: false; reason: "INVALID_RESPONSE" | "CONTRACT_VERSION_UNSUPPORTED" | "PROVENANCE_MISMATCH" },
  parseNotFoundReason: (body: unknown) => TNotFound | null,
  serverInvalidReason: "INVALID_CUSTOMER_ID" | "INVALID_LIMIT" | "INVALID_OFFSET" | "INVALID_TOP_PRODUCTS" | "INVALID_TOP_VARIANTS" | "INVALID_ORDER_REFERENCE"
): Promise<CustomerProfileClientResult<TAvailable, TNotFound>> {
  const startedAt = Date.now();
  const response = await fetchOnce(config, buildUrl(config.baseUrl as string, input.path, input.query), input.requestId);
  const observationBase = {
    operation: input.operation,
    requestId: input.requestId ?? null,
    customerId: input.customerId,
    referencePresent: Boolean(input.referencePresent),
    httpStatus: "status" in response ? response.status : null,
    durationMs: Date.now() - startedAt
  };

  if ("kind" in response) {
    if (response.kind === "timeout") {
      return finalizeWithObservation(observationBase, unavailableResult("CUSTOMER_PROFILE_TIMEOUT", true));
    }
    return finalizeWithObservation(observationBase, unavailableResult("CUSTOMER_PROFILE_UNAVAILABLE", true));
  }

  if (response.status >= 200 && response.status < 300) {
    if (response.body.kind !== "json") {
      return finalizeWithObservation(observationBase, unavailableResult("CUSTOMER_PROFILE_UNAVAILABLE", true));
    }
    const parsed = parseAvailable(response.body.body, input.customerId);
    if (!parsed.ok) {
      return finalizeWithObservation(observationBase, mapContractFailure(parsed.reason));
    }
    const metadata = {
      requestedCustomerId: input.customerId,
      contractVersion: parsed.value.provenance.contractVersion,
      identitySource: parsed.value.provenance.customerIdentity.source,
      generatedAt: parsed.value.provenance.generatedAt,
      durationMs: Date.now() - startedAt
    };
    return finalizeWithObservation(observationBase, { status: "AVAILABLE" as const, data: parsed.value as TAvailable, metadata });
  }

  if (response.status === 400) {
    return finalizeWithObservation(observationBase, invalidRequest(serverInvalidReason));
  }
  if (response.status === 404) {
    if (response.body.kind !== "json") {
      return finalizeWithObservation(observationBase, classifyInvalidBody(response.status));
    }
    const reason = parseNotFoundReason(response.body.body);
    if (reason === null) {
      return finalizeWithObservation(observationBase, classifyInvalidBody(response.status));
    }
    return finalizeWithObservation(observationBase, { status: "NOT_FOUND" as const, reason });
  }
  if (response.status === 408) {
    return finalizeWithObservation(observationBase, unavailableResult("CUSTOMER_PROFILE_TIMEOUT", true));
  }
  if (response.status === 429) {
    return finalizeWithObservation(observationBase, unavailableResult("CUSTOMER_PROFILE_UNAVAILABLE", true));
  }
  if (response.status === 502 || response.status === 504 || response.status === 500) {
    return finalizeWithObservation(observationBase, unavailableResult("CUSTOMER_PROFILE_UNAVAILABLE", true));
  }
  if (response.status === 503) {
    const reason = response.body.kind === "json" ? mapUnavailableReasonFrom503(response.body.body) : "CUSTOMER_PROFILE_UNAVAILABLE";
    return finalizeWithObservation(observationBase, unavailableResult(reason, true));
  }
  return finalizeWithObservation(observationBase, unavailableResult("CUSTOMER_PROFILE_UNAVAILABLE", response.status >= 500));
}

function parseCustomerNotFound(body: unknown): "CUSTOMER_NOT_FOUND" | null {
  return typeof body === "object" && body !== null && "status" in body && body.status === "customer_not_found" ? "CUSTOMER_NOT_FOUND" : null;
}

function parseOrderStatusNotFound(body: unknown): "CUSTOMER_NOT_FOUND" | "ORDER_NOT_FOUND" | null {
  if (typeof body !== "object" || body === null || !("status" in body)) return null;
  if (body.status === "customer_not_found") return "CUSTOMER_NOT_FOUND";
  if (body.status === "order_not_found") return "ORDER_NOT_FOUND";
  return null;
}

export function createHttpCustomerProfileClient(config: CustomerProfileClientConfig): CustomerProfileClient {
  if (!config.enabled || config.baseUrl === null) {
    return createDisabledCustomerProfileClient();
  }

  return {
    async getProfile(input: GetCustomerProfileInput): Promise<CustomerProfileResult> {
      if (!validateCustomerId(input.customerId)) return invalidRequest("INVALID_CUSTOMER_ID");
      return requestCustomerEndpoint<CustomerProfileResponse, "CUSTOMER_NOT_FOUND">(
        config,
        { operation: "profile", customerId: input.customerId, requestId: input.requestId, path: `v1/customers/${encodeURIComponent(String(input.customerId))}/profile` },
        parseCustomerProfileResponse,
        parseCustomerNotFound,
        "INVALID_CUSTOMER_ID"
      );
    },

    async getCommercialSummary(input: GetCommercialSummaryInput): Promise<CustomerCommercialSummaryResult> {
      if (!validateCustomerId(input.customerId)) return invalidRequest("INVALID_CUSTOMER_ID");
      return requestCustomerEndpoint<CustomerCommercialSummaryResponse, "CUSTOMER_NOT_FOUND">(
        config,
        { operation: "commercial-summary", customerId: input.customerId, requestId: input.requestId, path: `v1/customers/${encodeURIComponent(String(input.customerId))}/commercial-summary` },
        parseCustomerCommercialSummaryResponse,
        parseCustomerNotFound,
        "INVALID_CUSTOMER_ID"
      );
    },

    async getPurchasedProducts(input: GetPurchasedProductsInput): Promise<CustomerPurchasedProductsResult> {
      if (!validateCustomerId(input.customerId)) return invalidRequest("INVALID_CUSTOMER_ID");
      const limit = input.limit ?? 20;
      const offset = input.offset ?? 0;
      if (!validatePurchasedProductsLimit(limit)) return invalidRequest("INVALID_LIMIT");
      if (!validatePurchasedProductsOffset(offset)) return invalidRequest("INVALID_OFFSET");
      const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      return requestCustomerEndpoint<CustomerPurchasedProductsResponse, "CUSTOMER_NOT_FOUND">(
        config,
        { operation: "purchased-products", customerId: input.customerId, requestId: input.requestId, path: `v1/customers/${encodeURIComponent(String(input.customerId))}/purchased-products`, query },
        parseCustomerPurchasedProductsResponse,
        parseCustomerNotFound,
        "INVALID_LIMIT"
      );
    },

    async getPurchaseBehavior(input: GetPurchaseBehaviorInput): Promise<CustomerPurchaseBehaviorResult> {
      if (!validateCustomerId(input.customerId)) return invalidRequest("INVALID_CUSTOMER_ID");
      const topProducts = input.topProducts ?? 5;
      const topVariants = input.topVariants ?? 5;
      if (!validatePurchaseBehaviorTopProducts(topProducts)) return invalidRequest("INVALID_TOP_PRODUCTS");
      if (!validatePurchaseBehaviorTopVariants(topVariants)) return invalidRequest("INVALID_TOP_VARIANTS");
      const query = new URLSearchParams({ topProducts: String(topProducts), topVariants: String(topVariants) });
      return requestCustomerEndpoint<CustomerPurchaseBehaviorResponse, "CUSTOMER_NOT_FOUND">(
        config,
        { operation: "purchase-behavior", customerId: input.customerId, requestId: input.requestId, path: `v1/customers/${encodeURIComponent(String(input.customerId))}/purchase-behavior`, query },
        parseCustomerPurchaseBehaviorResponse,
        parseCustomerNotFound,
        "INVALID_TOP_PRODUCTS"
      );
    },

    async getOrderStatus(input: GetCustomerOrderStatusInput): Promise<CustomerOrderStatusResult> {
      if (!validateCustomerId(input.customerId)) return invalidRequest("INVALID_CUSTOMER_ID");
      if (!validateOrderReference(input.orderReference)) return invalidRequest("INVALID_ORDER_REFERENCE");
      return requestCustomerEndpoint<CustomerOrderStatusResponse, "CUSTOMER_NOT_FOUND" | "ORDER_NOT_FOUND">(
        config,
        {
          operation: "order-status",
          customerId: input.customerId,
          requestId: input.requestId,
          path: `v1/customers/${encodeURIComponent(String(input.customerId))}/orders/${encodeURIComponent(input.orderReference)}/status`,
          referencePresent: true
        },
        parseCustomerOrderStatusResponse,
        parseOrderStatusNotFound,
        "INVALID_ORDER_REFERENCE"
      );
    },

    async checkReadiness(input = {}): Promise<CustomerProfileReadinessResult> {
      const startedAt = Date.now();
      const response = await fetchOnce(config, buildUrl(config.baseUrl as string, "health/ready"), input.requestId);
      const observationBase = {
        operation: "readiness" as const,
        requestId: input.requestId ?? null,
        customerId: null,
        referencePresent: false,
        httpStatus: "status" in response ? response.status : null,
        durationMs: Date.now() - startedAt
      };

      if ("kind" in response) {
        if (response.kind === "timeout") {
          return finalizeWithObservation<CustomerProfileReadinessResult>(observationBase, unavailableResult("CUSTOMER_PROFILE_TIMEOUT", true));
        }
        return finalizeWithObservation<CustomerProfileReadinessResult>(observationBase, unavailableResult("CUSTOMER_PROFILE_UNAVAILABLE", true));
      }

      if (response.status >= 200 && response.status < 300) {
        if (response.body.kind !== "json") {
          return finalizeWithObservation<CustomerProfileReadinessResult>(observationBase, unavailableResult("CUSTOMER_PROFILE_UNAVAILABLE", true));
        }
        const parsed = parseCustomerProfileReadinessResponse(response.body.body);
        if (!parsed.ok) {
          return finalizeWithObservation<CustomerProfileReadinessResult>(observationBase, mapContractFailure(parsed.reason));
        }
        return finalizeWithObservation<CustomerProfileReadinessResult>(observationBase, {
          status: "AVAILABLE",
          data: parsed.value,
          metadata: {
            contractVersion: parsed.value.contractVersion,
            identitySource: parsed.value.customerIdentitySource,
            durationMs: Date.now() - startedAt
          }
        });
      }

      if (response.status === 503) {
        if (response.body.kind !== "json") {
          return finalizeWithObservation<CustomerProfileReadinessResult>(observationBase, unavailableResult("CUSTOMER_PROFILE_UNAVAILABLE", true));
        }
        const parsed = parseCustomerProfileReadinessResponse(response.body.body);
        if (!parsed.ok) {
          return finalizeWithObservation<CustomerProfileReadinessResult>(observationBase, mapContractFailure(parsed.reason));
        }
        return finalizeWithObservation<CustomerProfileReadinessResult>(
          observationBase,
          unavailableResult(
            parsed.value.status === "not_ready" && parsed.value.reason === "prestashop_schema_incompatible"
              ? "PRESTASHOP_SCHEMA_INCOMPATIBLE"
              : "PRESTASHOP_UNAVAILABLE",
            true
          )
        );
      }

      if (response.status === 408) {
        return finalizeWithObservation<CustomerProfileReadinessResult>(observationBase, unavailableResult("CUSTOMER_PROFILE_TIMEOUT", true));
      }
      if (response.status === 429 || response.status >= 500) {
        return finalizeWithObservation<CustomerProfileReadinessResult>(observationBase, unavailableResult("CUSTOMER_PROFILE_UNAVAILABLE", true));
      }
      return finalizeWithObservation<CustomerProfileReadinessResult>(observationBase, unavailableResult("CUSTOMER_PROFILE_UNAVAILABLE", false));
    }
  };
}

export function createCustomerProfileClient(env: NodeJS.ProcessEnv = process.env): CustomerProfileClient {
  const config = readCustomerProfileClientConfig(env);
  return config.enabled ? createHttpCustomerProfileClient(config) : createDisabledCustomerProfileClient();
}

let cachedClient: CustomerProfileClient | undefined;

export function getSharedCustomerProfileClient(): CustomerProfileClient {
  if (!cachedClient) {
    cachedClient = createCustomerProfileClient();
  }
  return cachedClient;
}

export function resetSharedCustomerProfileClientForTests() {
  cachedClient = undefined;
}
