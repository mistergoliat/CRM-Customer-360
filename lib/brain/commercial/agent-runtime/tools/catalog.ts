import type { SalesConsultativeProductRepository, SalesNeedProfile } from "../../sales-consultative/types";
import type { AgentToolDefinition, AgentToolResult } from "./types";

/**
 * Catalog tools wrap the already-integrated SalesConsultativeProductRepository
 * (lib/brain/commercial/sales-consultative/catalogRepository.ts), not a direct
 * SQL/PrestaShop dependency. This is the boundary ADR-005 mandates
 * (CatalogService) wired in at the repository's own consumer seam:
 * `lib/catalog`'s CatalogService adapters are not yet integrated on this
 * branch (AC-CATALOG is changes_requested, not merged) -- when they land,
 * only the repository implementation passed in here needs to change, not
 * these tool definitions.
 */
function minimalNeedProfile(currentTime: string): SalesNeedProfile {
  return {
    useCase: null,
    customerType: null,
    goals: [],
    requiredFeatures: [],
    preferredFeatures: [],
    budgetMin: null,
    budgetMax: null,
    availableSpace: null,
    location: null,
    deliveryDeadline: null,
    experienceLevel: null,
    purchaseUrgency: null,
    decisionReadiness: null,
    missingInformation: [],
    lastUpdatedAt: currentTime
  };
}

function productSummary(product: { id: string; name: string; reference: string | null; price: number | null; currency: string; stockQuantity: number | null; category: string | null; manufacturer: string | null; description: string | null }) {
  return {
    id: product.id,
    name: product.name,
    reference: product.reference,
    price: product.price,
    currency: product.currency,
    stockQuantity: product.stockQuantity,
    category: product.category,
    manufacturer: product.manufacturer,
    description: product.description
  };
}

export function createCatalogTools(repository: SalesConsultativeProductRepository): AgentToolDefinition[] {
  const searchProducts: AgentToolDefinition = {
    name: "search_products",
    version: "1.0",
    description: "Search the real product catalog by free text. Returns real products with real price/stock when available.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
    outputSchema: { type: "object", properties: { items: { type: "array" } } },
    authorizationLevel: "none",
    sideEffectLevel: "read",
    idempotent: true,
    timeoutMs: 8000,
    sourceOfTruth: "crm_catalog_repository",
    errorContract: ["catalog_unavailable"],
    async execute(input, context): Promise<AgentToolResult> {
      try {
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!query) {
          return { ok: false, output: null, warnings: [], error: "missing_query", sourceOfTruth: "crm_catalog_repository" };
        }
        const limit = typeof input.limit === "number" && Number.isFinite(input.limit) ? Math.max(1, Math.min(10, input.limit)) : 6;
        const results = await repository.searchProducts({ query, limit, profile: minimalNeedProfile(context.currentTime) });
        return {
          ok: true,
          output: { items: results.map((product) => productSummary(product)) },
          warnings: results.length === 0 ? ["no_products_found"] : [],
          error: null,
          sourceOfTruth: "crm_catalog_repository"
        };
      } catch (error) {
        return { ok: false, output: null, warnings: [], error: error instanceof Error ? error.message : "catalog_search_failed", sourceOfTruth: "crm_catalog_repository" };
      }
    }
  };

  const getProductDetail: AgentToolDefinition = {
    name: "get_product_detail",
    version: "1.0",
    description: "Get full real detail for one product: price, stock, dimensions, compatibility tags. Never invent these values; always call this tool first.",
    inputSchema: { type: "object", properties: { productId: { type: "string" } }, required: ["productId"] },
    outputSchema: { type: "object" },
    authorizationLevel: "none",
    sideEffectLevel: "read",
    idempotent: true,
    timeoutMs: 8000,
    sourceOfTruth: "crm_catalog_repository",
    errorContract: ["product_not_found", "catalog_unavailable"],
    async execute(input): Promise<AgentToolResult> {
      try {
        const productId = typeof input.productId === "string" ? input.productId.trim() : "";
        if (!productId) {
          return { ok: false, output: null, warnings: [], error: "missing_product_id", sourceOfTruth: "crm_catalog_repository" };
        }
        const product = await repository.getProductDetails(productId);
        if (!product) {
          return { ok: false, output: null, warnings: [], error: "product_not_found", sourceOfTruth: "crm_catalog_repository" };
        }
        return {
          ok: true,
          output: {
            ...productSummary(product),
            dimensions: product.dimensions,
            compatibility: product.compatibility,
            features: product.features
          },
          warnings: [],
          error: null,
          sourceOfTruth: "crm_catalog_repository"
        };
      } catch (error) {
        return { ok: false, output: null, warnings: [], error: error instanceof Error ? error.message : "catalog_detail_failed", sourceOfTruth: "crm_catalog_repository" };
      }
    }
  };

  const getRelatedProducts: AgentToolDefinition = {
    name: "get_related_products",
    version: "1.0",
    description: "Get real alternative/related products for comparisons, upsell, or cross-sell.",
    inputSchema: { type: "object", properties: { productId: { type: "string" } }, required: ["productId"] },
    outputSchema: { type: "object", properties: { items: { type: "array" } } },
    authorizationLevel: "none",
    sideEffectLevel: "read",
    idempotent: true,
    timeoutMs: 8000,
    sourceOfTruth: "crm_catalog_repository",
    errorContract: ["catalog_unavailable"],
    async execute(input): Promise<AgentToolResult> {
      try {
        const productId = typeof input.productId === "string" ? input.productId.trim() : "";
        if (!productId) {
          return { ok: false, output: null, warnings: [], error: "missing_product_id", sourceOfTruth: "crm_catalog_repository" };
        }
        const related = await repository.getRelatedProducts(productId);
        return { ok: true, output: { items: related.map((product) => productSummary(product)) }, warnings: [], error: null, sourceOfTruth: "crm_catalog_repository" };
      } catch (error) {
        return { ok: false, output: null, warnings: [], error: error instanceof Error ? error.message : "catalog_related_failed", sourceOfTruth: "crm_catalog_repository" };
      }
    }
  };

  return [searchProducts, getProductDetail, getRelatedProducts];
}
