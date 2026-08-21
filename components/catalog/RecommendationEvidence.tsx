import type { CatalogConsoleRecommendation } from "@/lib/catalog/consoleService";
import { formatMultiplier, formatPercent } from "./catalogDisplay";

const METRIC_HELP = [
  ["Joint count", "Cantidad historica observada de compras conjuntas para esta relacion."],
  ["Confidence", "Proporcion de ocurrencias del producto origen que tambien incluyeron este producto."],
  ["Lift", "Multiplicador de asociacion contra la ocurrencia esperada de base."],
  ["Support", "Peso relativo de la relacion dentro del snapshot de recomendaciones."],
  ["Reliability", "Senal de confiabilidad entregada por el motor; se muestra sin recalcularla."],
  ["Commercial score", "Score comercial entregado por Catalog Service; no se recalcula en el CRM."],
  ["Final score", "Score/ranking final entregado por Catalog Service; no se recalcula en el CRM."]
] as const;

export function RecommendationEvidence({ recommendation }: { recommendation: CatalogConsoleRecommendation }) {
  const evidence = recommendation.relationship.evidence;

  return (
    <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer text-label-bold uppercase text-slate-500">Evidencia avanzada</summary>
      <div className="mt-3 grid gap-2 text-label-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-4">
        <span>Joint count: {evidence.jointCount}</span>
        <span>Confidence: {formatPercent(evidence.confidence)}</span>
        <span>Lift: {formatMultiplier(evidence.lift)}</span>
        <span>Support: {formatPercent(evidence.support)}</span>
        <span>Reliability: {formatPercent(evidence.reliability)}</span>
        <span>Commercial score: {formatPercent(recommendation.commercialScore)}</span>
        <span>Final score: {formatPercent(recommendation.score)}</span>
        <span>Affinity: {formatPercent(recommendation.affinityScore)} ({recommendation.affinityConfidence})</span>
      </div>
      <details className="mt-3 rounded-md border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-label-bold text-slate-500">Definiciones de metricas</summary>
        <dl className="mt-3 grid gap-2 text-label-sm text-slate-600 md:grid-cols-2">
          {METRIC_HELP.map(([label, description]) => (
            <div key={label}>
              <dt className="font-bold text-slate-700">{label}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </details>
    </details>
  );
}
