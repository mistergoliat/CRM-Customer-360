/**
 * Business outcomes normally arrive in successful response bodies.
 * Non-2xx responses may represent validation, identity conflicts,
 * throttling, upstream unavailability, or malformed responses according
 * to the explicit HTTP-to-domain mapping below.
 *
 * This adapter performs exactly one physical request per invocation.
 * Retry ownership belongs exclusively to the Capability Gateway.
 */
import type { CustomerServicePort } from "@/lib/domains/customer-service/ports";
import type { CreateCustomerInput, CreateCustomerResult, LinkExternalIdentityInput, LinkExternalIdentityResult, ResolveCustomerInput, ResolveCustomerResult } from "@/lib/domains/customer-service/types";

export type HttpCustomerServiceAdapterConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
};

const DEFAULT_TIMEOUT_MS = 5000;

export function readHttpCustomerServiceAdapterConfig(): HttpCustomerServiceAdapterConfig | null {
  const baseUrl = process.env.CUSTOMER_SERVICE_BASE_URL?.trim();
  const apiKey = process.env.CUSTOMER_SERVICE_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  const timeoutMs = Number.parseInt(process.env.CUSTOMER_SERVICE_TIMEOUT_MS?.trim() ?? "", 10);
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
  return typeof value === "string" && value.trim() ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Defence in depth: strip anything header/PII-shaped before it can reach a
 * returned result, in case an upstream error accidentally echoes request
 * context or customer data back (contract section 8 / task section 7).
 */
function sanitize(value: string): string {
  return value
    .replace(/x-api-key['":\s]*[^\s,;"']+/gi, "x-api-key=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[redacted-email]")
    .replace(/\+?\d[\d\s-]{7,}\d/g, "[redacted-phone]");
}

function errorEnvelope(body: unknown): Record<string, unknown> | null {
  if (isRecord(body) && isRecord(body.error)) return body.error;
  return null;
}

// ACS-R1-04-T08.1. customerMasterId must be the canonical identifier
// compatible with master_customer.id (BIGINT UNSIGNED AUTO_INCREMENT) - a
// positive integer string. Anything else (missing, empty, non-numeric,
// leading zero/sign) is rejected here, fail-closed, before it ever reaches
// the onboarding/session layer - never converted to no_match.
const CUSTOMER_MASTER_ID_PATTERN = /^[1-9]\d*$/;

function asCustomerMasterId(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  const trimmed = text.trim();
  return CUSTOMER_MASTER_ID_PATTERN.test(trimmed) ? trimmed : null;
}

function fieldsFrom(errorBody: Record<string, unknown> | null): string[] {
  return asStringArray(errorBody?.fields);
}

function conflictCodeFrom(errorBody: Record<string, unknown> | null): string {
  const raw = (errorBody && (asString(errorBody.conflictCode) ?? asString(errorBody.code))) ?? "conflict";
  return sanitize(raw);
}

function codeFrom(errorBody: Record<string, unknown> | null): string {
  const raw = (errorBody && asString(errorBody.code)) ?? "customer_service_error";
  return sanitize(raw);
}

type HttpFailureClass = "invalid_input" | "conflict" | "temporarily_unavailable" | "failed";

/** Maps the HTTP status code per docs/integrations/customer-service-http-contract.md. */
function classifyHttpFailure(status: number): HttpFailureClass {
  if (status === 400 || status === 422) return "invalid_input";
  if (status === 409) return "conflict";
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) return "temporarily_unavailable";
  return "failed";
}

type MutationHttpFailure =
  | { status: "invalid_input"; fields: string[] }
  | { status: "conflict"; conflictCode: string }
  | { status: "temporarily_unavailable"; retryable: boolean }
  | { status: "failed"; code: string; retryable: boolean };

function mapMutationHttpError(status: number, errorBody: Record<string, unknown> | null): MutationHttpFailure {
  const failureClass = classifyHttpFailure(status);
  if (failureClass === "invalid_input") return { status: "invalid_input", fields: fieldsFrom(errorBody) };
  if (failureClass === "conflict") return { status: "conflict", conflictCode: conflictCodeFrom(errorBody) };
  if (failureClass === "temporarily_unavailable") return { status: "temporarily_unavailable", retryable: true };
  return { status: "failed", code: codeFrom(errorBody), retryable: false };
}

/**
 * resolve_customer has no `failed` outcome (contract section 1: only
 * resolved/no_match/conflict/invalid_input/temporarily_unavailable) - an
 * otherwise-unclassified 5xx folds into temporarily_unavailable rather than
 * inventing a sixth status.
 */
function mapResolveHttpError(status: number, errorBody: Record<string, unknown> | null): ResolveCustomerResult {
  const failureClass = classifyHttpFailure(status);
  if (failureClass === "invalid_input") return { status: "invalid_input", fields: fieldsFrom(errorBody) };
  if (failureClass === "conflict") return { status: "conflict", conflictCode: conflictCodeFrom(errorBody) };
  return { status: "temporarily_unavailable", retryable: failureClass === "temporarily_unavailable" };
}

// ACS-R1-04-T08.1. A 2xx body is rejected (returns null, which every caller
// below already folds into a safe failure - never no_match) when: the
// declared success status has no customerMasterId at all, the id is present
// but malformed (see CUSTOMER_MASTER_ID_PATTERN), or the body simultaneously
// carries an error envelope alongside a success status (incompatible
// fields - a genuinely successful response never does this).
function hasConflictingErrorEnvelope(body: Record<string, unknown>): boolean {
  return isRecord(body.error);
}

function parseResolveSuccess(body: unknown): ResolveCustomerResult | null {
  if (!isRecord(body)) return null;
  if (hasConflictingErrorEnvelope(body)) return null;
  const status = asString(body.status);
  if (status === "resolved") {
    const customerMasterId = asCustomerMasterId(body.customerMasterId);
    return customerMasterId ? { status: "resolved", customerMasterId } : null;
  }
  if (status === "no_match") return { status: "no_match" };
  if (status === "conflict") return { status: "conflict", conflictCode: asString(body.conflictCode) ?? "conflict" };
  return null;
}

function parseCreateSuccess(body: unknown): CreateCustomerResult | null {
  if (!isRecord(body)) return null;
  if (hasConflictingErrorEnvelope(body)) return null;
  const status = asString(body.status);
  if (status === "created" || status === "matched_existing") {
    const customerMasterId = asCustomerMasterId(body.customerMasterId);
    return customerMasterId ? { status, customerMasterId } : null;
  }
  if (status === "missing_information") return { status: "missing_information", requiredFields: asStringArray(body.requiredFields) };
  if (status === "denied") return { status: "denied", reason: sanitize(asString(body.reason) ?? "denied") };
  return null;
}

function parseLinkSuccess(body: unknown): LinkExternalIdentityResult | null {
  if (!isRecord(body)) return null;
  if (hasConflictingErrorEnvelope(body)) return null;
  const status = asString(body.status);
  if (status === "completed" || status === "already_linked") {
    const customerMasterId = asCustomerMasterId(body.customerMasterId);
    const externalIdentityId = asString(body.externalIdentityId);
    return customerMasterId && externalIdentityId ? { status, customerMasterId, externalIdentityId } : null;
  }
  if (status === "denied") return { status: "denied", reason: sanitize(asString(body.reason) ?? "denied") };
  return null;
}

async function postJson(
  config: HttpCustomerServiceAdapterConfig,
  path: string,
  payload: unknown,
  idempotencyKey?: string
): Promise<{ status: number; body: unknown } | { networkError: true }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": config.apiKey };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = await fetch(`${config.baseUrl}${path}`, { method: "POST", signal: controller.signal, headers, body: JSON.stringify(payload) });
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
 * Exactly one physical HTTP call per invocation - the Capability Gateway is
 * the only owner of retry (task section 7 / ADR-006), same rule already
 * applied to the catalog HTTP adapter.
 */
export function createHttpCustomerServiceAdapter(config: HttpCustomerServiceAdapterConfig): CustomerServicePort {
  return {
    async resolveCustomer(input: ResolveCustomerInput): Promise<ResolveCustomerResult> {
      const outcome = await postJson(config, "/v1/customers/resolve", {
        channel: input.channel,
        externalId: input.externalId,
        phoneNumber: input.phoneNumber ?? null,
        email: input.email ?? null
      });
      if ("networkError" in outcome) return { status: "temporarily_unavailable", retryable: true };
      if (outcome.status >= 200 && outcome.status < 300) {
        return parseResolveSuccess(outcome.body) ?? { status: "temporarily_unavailable", retryable: false };
      }
      return mapResolveHttpError(outcome.status, errorEnvelope(outcome.body));
    },

    async createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
      const outcome = await postJson(
        config,
        "/v1/customers",
        {
          firstName: input.firstName,
          lastName: input.lastName ?? null,
          email: input.email,
          phoneNumber: input.phoneNumber,
          origin: input.origin,
          commercialPurpose: input.commercialPurpose,
          consent: input.consent
        },
        input.idempotencyKey
      );
      if ("networkError" in outcome) return { status: "temporarily_unavailable", retryable: true };
      if (outcome.status >= 200 && outcome.status < 300) {
        return parseCreateSuccess(outcome.body) ?? { status: "failed", code: "invalid_response", retryable: false };
      }
      return mapMutationHttpError(outcome.status, errorEnvelope(outcome.body));
    },

    async linkExternalIdentity(input: LinkExternalIdentityInput): Promise<LinkExternalIdentityResult> {
      const outcome = await postJson(
        config,
        `/v1/customers/${encodeURIComponent(input.customerId)}/external-identities`,
        { externalIdentity: input.externalIdentity, consent: input.consent },
        input.idempotencyKey
      );
      if ("networkError" in outcome) return { status: "temporarily_unavailable", retryable: true };
      if (outcome.status >= 200 && outcome.status < 300) {
        return parseLinkSuccess(outcome.body) ?? { status: "failed", code: "invalid_response", retryable: false };
      }
      return mapMutationHttpError(outcome.status, errorEnvelope(outcome.body));
    }
  };
}

/** Fail-closed stand-in used when configuration is absent - never treated as no_match (task section 7). */
function createUnavailableCustomerServicePort(): CustomerServicePort {
  const unavailable = async () => ({ status: "temporarily_unavailable" as const, retryable: true });
  return {
    resolveCustomer: unavailable,
    createCustomer: unavailable,
    linkExternalIdentity: unavailable
  };
}

/**
 * Productive CustomerServicePort factory. Returns the fail-closed port (not
 * null) when CUSTOMER_SERVICE_BASE_URL / CUSTOMER_SERVICE_API_KEY are not
 * configured, so every call surfaces `temporarily_unavailable` instead of
 * crashing or being mistaken for a resolved/no_match answer. Never falls
 * back to master_customer, PrestaShop, SAP, POS or customer_external_identity.
 */
export function createCustomerServicePort(): CustomerServicePort {
  const config = readHttpCustomerServiceAdapterConfig();
  if (!config) return createUnavailableCustomerServicePort();
  return createHttpCustomerServiceAdapter(config);
}
