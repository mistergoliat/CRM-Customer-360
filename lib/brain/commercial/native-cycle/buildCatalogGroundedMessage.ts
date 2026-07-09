import { executeGovernedCapability } from "../capability-gateway/executeCapability";
import type { CapabilityGatewayContext, CapabilityGatewayResult } from "../capability-gateway/types";
import type { CatalogProduct, CatalogSearchResult, CatalogSearchResultItem } from "@/lib/catalog";
import { selectBestCatalogMatch } from "./rankCatalogSearchResults";
import type { CapabilityExecutionStageExecution } from "./runCapabilityExecutionStage";

export type CatalogGroundingResult = {
  executed: boolean;
  searchResult: CapabilityGatewayResult<CatalogSearchResult> | null;
  detailsResult: CapabilityGatewayResult<CatalogProduct | null> | null;
  /** Deterministic, evidence-backed reply text. Never set from invented data. */
  groundedMessage: string | null;
  warnings: string[];
};

const EMPTY_RESULT: CatalogGroundingResult = {
  executed: false,
  searchResult: null,
  detailsResult: null,
  groundedMessage: null,
  warnings: []
};

function formatItemLine(item: CatalogSearchResultItem): string {
  const availability = item.availability === "in_stock" ? "" : item.availability === "out_of_stock" ? " (sin stock ahora)" : "";
  return `${item.name}${item.variantLabel ? ` (${item.variantLabel})` : ""}${availability}`;
}

function buildMessageFromSearch(search: CapabilityGatewayResult<CatalogSearchResult>, details: CapabilityGatewayResult<CatalogProduct | null> | null): { message: string; warnings: string[] } {
  if (search.status === "invalid_arguments") {
    return { message: "Para poder buscar en el catálogo necesito que me cuentes qué producto o categoría estás buscando.", warnings: ["catalog_stage_invalid_arguments"] };
  }
  if (search.status === "denied") {
    return { message: "En este momento no puedo consultar el catálogo. Un miembro del equipo te va a ayudar con esto.", warnings: ["catalog_stage_denied"] };
  }
  if (search.status === "temporarily_blocked" || search.status === "failed") {
    return { message: "El catálogo no está respondiendo en este momento. Te aviso apenas pueda revisar disponibilidad real.", warnings: ["catalog_stage_unavailable"] };
  }

  const items = search.data?.items ?? [];
  if (items.length === 0) {
    return { message: `No encontré productos que calcen con "${search.data?.query ?? ""}" en este momento. ¿Puedes darme más detalle (uso, tamaño, presupuesto)?`, warnings: ["catalog_stage_no_results"] };
  }

  const top = items.slice(0, 3).map(formatItemLine);
  const detailProduct = details?.status === "completed" ? details.data : null;
  const priceLine =
    detailProduct?.price?.amount != null && detailProduct.price.currency
      ? ` El primero cuesta ${detailProduct.price.amount} ${detailProduct.price.currency}.`
      : "";

  return {
    message: `Encontré estas opciones reales en el catálogo: ${top.join(", ")}.${priceLine} ¿Quieres que te cuente más detalle de alguna?`,
    warnings: []
  };
}

/**
 * Catalog-specific projector (ACS-R1-01.1 objective 5: allowed to remain a
 * distinct piece even though the execution stage itself is generic).
 * Consumes whatever runCapabilityExecutionStage already executed, and - only
 * when a search_products execution exists - additionally calls
 * get_product_details for the single item a deterministic, audited ranker
 * selects (never blindly "the first result"; see rankCatalogSearchResults).
 * Never invents product, price or stock data.
 */
export async function buildCatalogGroundedMessage(
  executions: readonly CapabilityExecutionStageExecution[],
  gatewayContext: CapabilityGatewayContext
): Promise<CatalogGroundingResult> {
  const searchExecution = executions.find((execution) => execution.capability === "search_products");
  if (!searchExecution) return EMPTY_RESULT;

  const searchResult = searchExecution.result as CapabilityGatewayResult<CatalogSearchResult>;
  let detailsResult: CapabilityGatewayResult<CatalogProduct | null> | null = null;

  if (searchResult.status === "completed" && searchResult.data) {
    const best = selectBestCatalogMatch(searchResult.data.items);
    if (best) {
      detailsResult = (await executeGovernedCapability(
        "get_product_details",
        { productId: best.item.productId, combinationId: best.item.combinationId !== "0" ? best.item.combinationId : undefined },
        gatewayContext
      )) as CapabilityGatewayResult<CatalogProduct | null>;
    }
  }

  const { message, warnings } = buildMessageFromSearch(searchResult, detailsResult);

  return {
    executed: true,
    searchResult,
    detailsResult,
    groundedMessage: message,
    warnings
  };
}
