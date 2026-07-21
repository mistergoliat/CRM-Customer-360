import type { CapabilityGatewayResult } from "../capability-gateway/types";
import type { CatalogProduct, CatalogSearchResult } from "@/lib/catalog";
import type { CompanyKnowledgeSearchResult } from "../capability-gateway/companyKnowledgeCapability";
import type { ToolObservation } from "./agentStepTypes";

const MAX_SEARCH_ITEMS = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectSearchProducts(data: unknown) {
  if (!isRecord(data)) return { items: [] };
  const result = data as CatalogSearchResult;
  return {
    query: result.query,
    items: (result.items ?? []).slice(0, MAX_SEARCH_ITEMS).map((item) => ({
      productId: item.productId,
      name: item.name,
      availability: item.availability,
      stockQuantity: item.stockQuantity
    }))
  };
}

function projectProductDetails(data: unknown) {
  if (!isRecord(data)) return null;
  const product = data as CatalogProduct;
  return {
    productId: product.productId,
    name: product.name,
    shortDescription: product.shortDescription,
    price: product.price ? { amount: product.price.amount, currency: product.price.currency } : null,
    availability: product.availability,
    stockQuantity: product.stockQuantity
  };
}

function projectCompanyKnowledge(data: unknown) {
  if (!isRecord(data)) return { entries: [] };
  const result = data as CompanyKnowledgeSearchResult;
  return {
    query: result.query,
    entries: (result.entries ?? []).map((entry) => ({
      topic: entry.topic,
      answer: entry.answer,
      source: entry.source
    }))
  };
}

/**
 * Projects a real CapabilityGatewayResult into the bounded, structured
 * ToolObservation the loop feeds back to the model. Never the raw gateway
 * result: no credentials, no full internal payload, no raw error message, no
 * SQL, no data the observation schema does not name explicitly.
 */
export function buildToolObservation(tool: string, result: CapabilityGatewayResult): ToolObservation {
  if (result.status === "completed") {
    const data =
      tool === "search_products"
        ? projectSearchProducts(result.data)
        : tool === "get_product_details"
          ? projectProductDetails(result.data)
          : tool === "search_company_knowledge"
            ? projectCompanyKnowledge(result.data)
            : null;
    return { tool, status: "completed", data };
  }

  if (result.status === "denied" || result.status === "requires_approval" || result.status === "invalid_arguments") {
    return { tool, status: "blocked", errorCode: result.errorCode ?? result.status };
  }

  return { tool, status: "failed", errorCode: result.errorCode ?? "capability_execution_failed" };
}
