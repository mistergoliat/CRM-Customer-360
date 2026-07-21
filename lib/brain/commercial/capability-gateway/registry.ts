import { createCatalogPort } from "@/lib/catalog";
import type { CatalogBatchItemInput, CatalogBatchResult, CatalogPort, CatalogProduct, CatalogSearchResult } from "@/lib/catalog";
import type { CapabilityGatewayContext, CapabilityGatewayDefinition, CapabilityGovernanceMetadata } from "./types";
import { CUSTOMER_IDENTITY_CAPABILITY_DEFINITIONS } from "./customerIdentityCapabilities";
import { companyKnowledgeCapability } from "./companyKnowledgeCapability";

const CAPABILITY_GATEWAY_VERSION = "capability-gateway.v1" as const;

function asQueryText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function asProductId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function catalogUnavailable(port: CatalogPort | null): port is null {
  return port === null;
}

function searchProductsCapability(getPort: () => CatalogPort | null): CapabilityGatewayDefinition<{ query: string; limit?: number }, CatalogSearchResult> {
  return {
    capability: "search_products",
    version: CAPABILITY_GATEWAY_VERSION,
    description: "Search the real product catalog by free text via the catalog microservice.",
    governance: { sideEffect: "read_only", authority: "autonomous", riskClass: "low" },
    maxRetries: 1,
    async checkAvailability() {
      if (catalogUnavailable(getPort())) {
        return { status: "unavailable", reason: "catalog_service_not_configured" };
      }
      return { status: "available", reason: null };
    },
    async execute(input, context: CapabilityGatewayContext) {
      const port = getPort();
      if (catalogUnavailable(port)) {
        return { status: "temporarily_blocked", data: null, errorCode: "catalog_service_not_configured", retryable: true, evidence: [] };
      }
      const query = asQueryText(input.query);
      if (!query) {
        return { status: "invalid_arguments", data: null, errorCode: "query_required", retryable: false, evidence: [] };
      }

      const result = await port.searchProducts({ query, limit: input.limit ?? 5 }, { correlationId: context.correlationId });
      if (!result.ok) {
        return mapCatalogErrorToOutcome(result.error);
      }

      return {
        status: "completed",
        data: result.value,
        errorCode: null,
        retryable: false,
        evidence: [
          {
            source: result.value.provenance.source,
            summary: `search_products returned ${result.value.items.length} item(s) for "${result.value.query}".`,
            capturedAt: result.value.provenance.retrievedAt
          }
        ]
      };
    }
  };
}

function getProductDetailsCapability(getPort: () => CatalogPort | null): CapabilityGatewayDefinition<{ productId: string; combinationId?: string }, CatalogProduct | null> {
  return {
    capability: "get_product_details",
    version: CAPABILITY_GATEWAY_VERSION,
    description: "Read verified details (price, stock, variants) for one product via the catalog microservice.",
    governance: { sideEffect: "read_only", authority: "autonomous", riskClass: "low" },
    maxRetries: 1,
    async checkAvailability() {
      if (catalogUnavailable(getPort())) {
        return { status: "unavailable", reason: "catalog_service_not_configured" };
      }
      return { status: "available", reason: null };
    },
    async execute(input, context: CapabilityGatewayContext) {
      const port = getPort();
      if (catalogUnavailable(port)) {
        return { status: "temporarily_blocked", data: null, errorCode: "catalog_service_not_configured", retryable: true, evidence: [] };
      }
      const productId = asProductId(input.productId);
      if (!productId) {
        return { status: "invalid_arguments", data: null, errorCode: "productId_required", retryable: false, evidence: [] };
      }

      const result = await port.getProductDetails({ productId, combinationId: input.combinationId }, { correlationId: context.correlationId });
      if (!result.ok) {
        return mapCatalogErrorToOutcome(result.error);
      }

      return {
        status: "completed",
        data: result.value,
        errorCode: result.value ? null : "product_not_found",
        retryable: false,
        evidence: result.value
          ? [{ source: result.value.provenance.source, summary: `get_product_details resolved product ${result.value.productId}.`, capturedAt: result.value.provenance.retrievedAt }]
          : []
      };
    }
  };
}

function asBatchItems(value: unknown): CatalogBatchItemInput[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items: CatalogBatchItemInput[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const record = entry as Record<string, unknown>;
    const productId = asProductId(record.productId);
    if (!productId) return null;
    items.push({
      productId,
      ...(typeof record.combinationId === "string" || typeof record.combinationId === "number" ? { combinationId: String(record.combinationId) } : {}),
      ...(typeof record.quantity === "number" && Number.isFinite(record.quantity) ? { quantity: record.quantity } : {})
    });
  }
  return items;
}

/**
 * ACS-R1-05-T06.2: batch hydration for search candidates. Internal
 * enrichment capability, deliberately NOT aliased in toolAliases.ts - the
 * Sales Agent never requests it directly (C5 of the task contract: one
 * search intent from the model, the infra runs search -> batch
 * automatically). Registered here so it goes through the same governed
 * execution, retry and crm_capability_executions audit trail as every other
 * capability, exactly like get_product_details is already called directly
 * from buildCatalogGroundedMessage.ts today.
 */
function batchGetProductsCapability(getPort: () => CatalogPort | null): CapabilityGatewayDefinition<{ items: unknown }, CatalogBatchResult> {
  return {
    capability: "batch_get_products",
    version: CAPABILITY_GATEWAY_VERSION,
    description: "Hydrate up to 20 search candidates (price, stock, variants) in one call via the catalog microservice.",
    governance: { sideEffect: "read_only", authority: "autonomous", riskClass: "low" },
    maxRetries: 1,
    async checkAvailability() {
      if (catalogUnavailable(getPort())) {
        return { status: "unavailable", reason: "catalog_service_not_configured" };
      }
      return { status: "available", reason: null };
    },
    async execute(input, context: CapabilityGatewayContext) {
      const port = getPort();
      if (catalogUnavailable(port)) {
        return { status: "temporarily_blocked", data: null, errorCode: "catalog_service_not_configured", retryable: true, evidence: [] };
      }
      const items = asBatchItems(input.items);
      if (!items) {
        return { status: "invalid_arguments", data: null, errorCode: "items_required", retryable: false, evidence: [] };
      }

      const result = await port.batchGetProducts({ items }, { correlationId: context.correlationId });
      if (!result.ok) {
        return mapCatalogErrorToOutcome(result.error);
      }

      return {
        status: "completed",
        data: result.value,
        errorCode: null,
        retryable: false,
        evidence: [
          {
            source: result.value.provenance.source,
            summary: `batch_get_products hydrated ${result.value.items.filter((item) => item.ok).length}/${result.value.items.length} item(s).`,
            capturedAt: result.value.provenance.retrievedAt
          }
        ]
      };
    }
  };
}

function mapCatalogErrorToOutcome(error: { code: string; message: string; retryable: boolean }) {
  const evidence = [{ source: "catalog_service_http", summary: error.message, capturedAt: new Date().toISOString() }];
  switch (error.code) {
    case "invalid_input":
      return { status: "invalid_arguments" as const, data: null, errorCode: error.code, retryable: false, evidence };
    case "unauthorized":
      return { status: "denied" as const, data: null, errorCode: error.code, retryable: false, evidence };
    case "rate_limited":
    case "unavailable":
    case "timeout":
      return { status: "temporarily_blocked" as const, data: null, errorCode: error.code, retryable: true, evidence };
    case "not_found":
      return { status: "completed" as const, data: null, errorCode: "not_found", retryable: false, evidence };
    default:
      return { status: "failed" as const, data: null, errorCode: error.code, retryable: false, evidence };
  }
}

let cachedPort: CatalogPort | null | undefined;
function getSharedCatalogPort(): CatalogPort | null {
  if (cachedPort === undefined) cachedPort = createCatalogPort();
  return cachedPort;
}

/** Test-only: force the registry to re-read env / re-create the catalog port. */
export function resetCapabilityGatewayCatalogPortForTests() {
  cachedPort = undefined;
}

export const CAPABILITY_GATEWAY_REGISTRY: readonly CapabilityGatewayDefinition[] = [
  searchProductsCapability(getSharedCatalogPort) as CapabilityGatewayDefinition,
  getProductDetailsCapability(getSharedCatalogPort) as CapabilityGatewayDefinition,
  batchGetProductsCapability(getSharedCatalogPort) as CapabilityGatewayDefinition,
  // ACS-R1-05.1-T02.1. Lexical fixture search, no external service - see
  // companyKnowledgeCapability.ts. Non-productive fixture content until the
  // business supplies verified copy (companyKnowledgeFixtures.ts).
  companyKnowledgeCapability() as CapabilityGatewayDefinition,
  // ACS-R1-04-T06. record_customer_interest is deliberately not registered:
  // no operational persistence exists yet (docs/CAPABILITY_MATRIX.md).
  ...CUSTOMER_IDENTITY_CAPABILITY_DEFINITIONS
];

const CAPABILITIES_BY_NAME = new Map(CAPABILITY_GATEWAY_REGISTRY.map((definition) => [definition.capability, definition]));

export function resolveCapabilityGatewayDefinition(capability: string): CapabilityGatewayDefinition | null {
  return CAPABILITIES_BY_NAME.get(capability) ?? null;
}

/**
 * Static governance facts only (no execute/checkAvailability) - safe for
 * synchronous, side-effect-free consumers like the policy engine. Reads
 * straight off CAPABILITY_GATEWAY_REGISTRY, the single source of truth.
 */
export function resolveCapabilityGovernance(capability: string): CapabilityGovernanceMetadata | null {
  return CAPABILITIES_BY_NAME.get(capability)?.governance ?? null;
}
