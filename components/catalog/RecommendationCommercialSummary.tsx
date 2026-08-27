import type { CatalogConsoleRecommendation } from "@/lib/catalog/consoleService";
import { formatMoney, formatPercent, formatStock } from "./catalogDisplay";
import { CommercialScoreDonut } from "./CommercialScoreDonut";

type RecommendationCommercialSummaryProps = {
  recommendation: CatalogConsoleRecommendation;
  compact?: boolean;
};

export function RecommendationCommercialSummary({ recommendation, compact = false }: RecommendationCommercialSummaryProps) {
  return (
    <div className="grid min-w-[240px] gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-label-sm text-slate-600 sm:grid-cols-2">
      <div>
        <p className="text-label-bold uppercase text-slate-500">Precio</p>
        <p className={compact ? "mt-1 text-body-sm font-bold text-on-surface" : "mt-1 text-body-md font-bold text-on-surface"}>{formatMoney(recommendation.price)}</p>
      </div>
      <div>
        <p className="text-label-bold uppercase text-slate-500">Stock</p>
        <p className={compact ? "mt-1 text-body-sm font-bold text-on-surface" : "mt-1 text-body-md font-bold text-on-surface"}>{formatStock(recommendation)}</p>
      </div>
      <CommercialScoreDonut value={recommendation.commercialScore} />
      <div>
        <p className="text-label-bold uppercase text-slate-500">Final</p>
        <p className={compact ? "mt-1 text-body-sm font-bold text-on-surface" : "mt-1 text-body-md font-bold text-on-surface"}>{formatPercent(recommendation.score)}</p>
        <p className="mt-1 text-label-sm text-slate-500">Puntaje final de ranking.</p>
      </div>
    </div>
  );
}
