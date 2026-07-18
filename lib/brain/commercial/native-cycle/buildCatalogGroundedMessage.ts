import { executeGovernedCapability } from "../capability-gateway/executeCapability";
import type { CapabilityGatewayContext, CapabilityGatewayResult } from "../capability-gateway/types";
import type { CatalogBatchResult, CatalogProduct, CatalogSearchResult } from "@/lib/catalog";
import { rankCatalogSearchResults } from "./rankCatalogSearchResults";
import { rankCatalogCandidatesByBudget, type CatalogBudgetCandidate, type CatalogBudgetRankingResult } from "./rankCatalogCandidatesByBudget";
import type { CapabilityExecutionStageExecution } from "./runCapabilityExecutionStage";

/** Real service contract cap (POST /v1/products/batch): also the max we ever hydrate per search. */
const CATALOG_GROUNDING_MAX_CANDIDATES = 10;

export type CommercialNeedForGrounding = {
  budgetMax: number | null;
  usage: string | null;
};

export type CatalogGroundingResult = {
  executed: boolean;
  searchResult: CapabilityGatewayResult<CatalogSearchResult> | null;
  batchResult: CapabilityGatewayResult<CatalogBatchResult> | null;
  ranking: CatalogBudgetRankingResult | null;
  /** Deterministic, evidence-backed reply text. Never set from invented data. */
  groundedMessage: string | null;
  warnings: string[];
};

const EMPTY_RESULT: CatalogGroundingResult = {
  executed: false,
  searchResult: null,
  batchResult: null,
  ranking: null,
  groundedMessage: null,
  warnings: []
};

function formatMoney(amount: number, currency: string | null): string {
  return currency ? `${amount.toLocaleString("es-CL")} ${currency}` : amount.toLocaleString("es-CL");
}

function formatCandidateName(product: CatalogProduct): string {
  return `${product.name}${product.selectedVariant?.label ? ` (${product.selectedVariant.label})` : ""}`;
}

function stockNote(product: CatalogProduct): string {
  return product.availability === "out_of_stock" ? " (sin stock ahora)" : "";
}

function buildUsageIntro(need: CommercialNeedForGrounding | null): string {
  return need?.usage ? `Para tu uso (${need.usage}), estas son las opciones reales que encontré: ` : "Estas son las opciones reales que encontré: ";
}

function formatPick(pick: CatalogBudgetCandidate, label: string, reason: string): string {
  return `${label}: ${formatCandidateName(pick.product)} - ${formatMoney(pick.effectiveUnitPrice, pick.currency)}${stockNote(pick.product)}. ${reason}`;
}

function buildMessageFromRanking(ranking: CatalogBudgetRankingResult, need: CommercialNeedForGrounding | null): string {
  const intro = buildUsageIntro(need);
  const lines: string[] = [];

  if (ranking.mode === "relevance") {
    for (const pick of ranking.picks) {
      lines.push(`${formatCandidateName(pick.product)} - ${formatMoney(pick.effectiveUnitPrice, pick.currency)}${stockNote(pick.product)}`);
    }
    return `${intro}${lines.join("; ")}. ¿Tienes un presupuesto máximo? Así te puedo comparar mejor las alternativas.`;
  }

  if (ranking.mode === "all_over_budget") {
    for (const pick of ranking.picks) {
      lines.push(`${formatCandidateName(pick.product)} - ${formatMoney(pick.effectiveUnitPrice, pick.currency)}${stockNote(pick.product)}`);
    }
    const budgetText = ranking.budgetMax !== null ? ` sobre tu presupuesto de ${formatMoney(ranking.budgetMax, ranking.picks[0]?.currency ?? null)}` : "";
    return `Las alternativas más cercanas que encontré están${budgetText}: ${lines.join("; ")}. ¿Quieres que revise si hay otra opción o prefieres ajustar el presupuesto?`;
  }

  for (const pick of ranking.picks) {
    if (pick.tier === "economy") {
      lines.push(formatPick(pick, "Opción económica", "Menor inversión para comenzar."));
    } else if (pick.tier === "near_budget") {
      lines.push(formatPick(pick, "Opción cercana a tu presupuesto", "Mejor equilibrio dentro del rango que me indicaste."));
    } else if (pick.tier === "stretch") {
      lines.push(formatPick(pick, "Opción superior", "Excede tu presupuesto, pero agrega características verificadas en el catálogo."));
    } else {
      lines.push(formatPick(pick, "Otra alternativa", "Se mantiene dentro de tu presupuesto."));
    }
  }

  return `${intro}${lines.join(" ")} ¿Quieres que comparemos alguna en detalle o avanzamos con una cotización?`;
}

function buildStageMessage(search: CapabilityGatewayResult<CatalogSearchResult>): { message: string; warnings: string[] } | null {
  if (search.status === "invalid_arguments") {
    return { message: "Para poder buscar en el catálogo necesito que me cuentes qué producto o categoría estás buscando.", warnings: ["catalog_stage_invalid_arguments"] };
  }
  if (search.status === "denied") {
    return { message: "En este momento no puedo consultar el catálogo. Un miembro del equipo te va a ayudar con esto.", warnings: ["catalog_stage_denied"] };
  }
  if (search.status === "temporarily_blocked" || search.status === "failed") {
    return { message: "El catálogo no está respondiendo en este momento. Te aviso apenas pueda revisar disponibilidad real.", warnings: ["catalog_stage_unavailable"] };
  }
  return null;
}

/**
 * Catalog-specific projector (ACS-R1-01.1 objective 5; extended by
 * ACS-R1-05-T06.2). Consumes whatever runCapabilityExecutionStage already
 * executed and, when a search_products execution exists, runs the automatic
 * enrichment pipeline: batch-hydrate every search candidate in ONE call
 * (never per-item, never a second LLM tool request), rank the hydrated
 * candidates by budget tier, and compose a grounded message that names only
 * successfully hydrated products (C7/C8). Never invents product, price or
 * stock data.
 */
export async function buildCatalogGroundedMessage(
  executions: readonly CapabilityExecutionStageExecution[],
  gatewayContext: CapabilityGatewayContext,
  commercialNeed: CommercialNeedForGrounding | null = null
): Promise<CatalogGroundingResult> {
  const searchExecution = executions.find((execution) => execution.capability === "search_products");
  if (!searchExecution) return EMPTY_RESULT;

  const searchResult = searchExecution.result as CapabilityGatewayResult<CatalogSearchResult>;

  const stageMessage = buildStageMessage(searchResult);
  if (stageMessage) {
    return { executed: true, searchResult, batchResult: null, ranking: null, groundedMessage: stageMessage.message, warnings: stageMessage.warnings };
  }

  const items = searchResult.data?.items ?? [];
  if (items.length === 0) {
    return {
      executed: true,
      searchResult,
      batchResult: null,
      ranking: null,
      groundedMessage: `No encontré productos que calcen con "${searchResult.data?.query ?? ""}" en este momento. ¿Puedes darme más detalle (uso, tamaño, presupuesto)?`,
      warnings: ["catalog_stage_no_results"]
    };
  }

  const { ranked } = rankCatalogSearchResults(items);
  const candidates = ranked.slice(0, CATALOG_GROUNDING_MAX_CANDIDATES);

  const batchResult = (await executeGovernedCapability(
    "batch_get_products",
    { items: candidates.map((item) => ({ productId: item.productId, combinationId: item.combinationId !== "0" ? item.combinationId : undefined })) },
    gatewayContext
  )) as CapabilityGatewayResult<CatalogBatchResult>;

  if (batchResult.status !== "completed" || !batchResult.data) {
    return {
      executed: true,
      searchResult,
      batchResult,
      ranking: null,
      groundedMessage: "Encontré opciones en el catálogo, pero no pude confirmar precio y stock reales en este momento. Mantengo tu búsqueda para retomarla apenas pueda verificar los datos.",
      warnings: ["catalog_batch_unavailable"]
    };
  }

  const hydrated = batchResult.data.items.filter((item): item is Extract<typeof item, { ok: true }> => item.ok).map((item) => item.product);
  const failedCount = batchResult.data.items.length - hydrated.length;
  const ranking = rankCatalogCandidatesByBudget(hydrated, commercialNeed?.budgetMax ?? null);

  if (ranking.mode === "no_candidates") {
    return {
      executed: true,
      searchResult,
      batchResult,
      ranking,
      groundedMessage: "Encontré productos que podrían servirte, pero no logré confirmar el precio actual de ninguno. Te aviso apenas pueda verificarlo.",
      warnings: ["catalog_ranking_no_priced_candidates"]
    };
  }

  return {
    executed: true,
    searchResult,
    batchResult,
    ranking,
    groundedMessage: buildMessageFromRanking(ranking, commercialNeed),
    warnings: failedCount > 0 ? ["catalog_batch_partial"] : []
  };
}
