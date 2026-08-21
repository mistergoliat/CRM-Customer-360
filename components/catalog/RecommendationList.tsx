"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { StatusChip } from "@/components/ui/StatusChip";
import type { CatalogProductContextResult } from "@/lib/catalog/consoleService";
import { RECOMMENDATION_LIMIT_OPTIONS } from "@/lib/catalog/consoleLimits";
import { errorMessage } from "./catalogDisplay";
import { RecommendationCard } from "./RecommendationCard";

type RecommendationListProps = {
  context: Extract<CatalogProductContextResult, { ok: true }>;
  selectedLimit: number;
  refreshing: boolean;
  onLimitChange: (limit: number) => void;
  loadRelated: (productId: string, limit: number) => Promise<CatalogProductContextResult>;
};

export function RecommendationList({ context, selectedLimit, refreshing, onLimitChange, loadRelated }: RecommendationListProps) {
  const block = context.recommendations;

  return (
    <section className="hub-card p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-label-bold uppercase text-primary">Recomendaciones</p>
          <h2 className="mt-1 text-headline-md text-on-surface">Explorador de relaciones comerciales</h2>
          <p className="mt-2 text-body-sm text-slate-500">Nivel 1: relaciones directas con el producto seleccionado. Nivel 2: relaciones directas con cada recomendacion.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {block.status !== "error" && block.execution.degraded ? <StatusChip label="Respuesta parcial" tone="amber" /> : null}
          <label className="flex items-center gap-2 text-label-bold uppercase text-slate-500">
            Mostrar
            <select
              value={selectedLimit}
              disabled={refreshing}
              onChange={(event) => onLimitChange(Number(event.target.value))}
              className="rounded-full border border-slate-300 bg-white px-3 py-2 text-label-bold text-on-surface"
            >
              {RECOMMENDATION_LIMIT_OPTIONS.map((limit) => (
                <option key={limit} value={limit}>
                  {limit}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {refreshing ? <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-body-sm text-slate-600">Actualizando recomendaciones...</div> : null}

      {block.status === "error" ? (
        <div className="mt-4">
          <ErrorState title="Recomendaciones no disponibles" message={errorMessage(block.error)} />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-label-bold uppercase text-slate-500">Mostradas</p>
              <p className="mt-1 text-headline-sm text-on-surface">{block.shownCount}</p>
              <p className="text-label-sm text-slate-500">Disponibles en respuesta: {block.statistics.recommendationsReturned}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-label-bold uppercase text-slate-500">Candidatos comerciales</p>
              <p className="mt-1 text-headline-sm text-on-surface">{block.statistics.commercialCandidates}</p>
              <p className="text-label-sm text-slate-500">Campo confirmado por Catalog Service.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-label-bold uppercase text-slate-500">Truncadas por limite</p>
              <p className="mt-1 text-headline-sm text-on-surface">{block.truncatedByLimitCount}</p>
              <p className="text-label-sm text-slate-500">Solo codigo RESULT_LIMIT_TRUNCATION.</p>
            </div>
          </div>

          {block.status === "empty" ? (
            <EmptyState title="Sin recomendaciones" description="No hay recomendaciones comerciales disponibles para este producto." icon="inventory_2" />
          ) : (
            <div className="space-y-3">
              {block.items.map((recommendation) => (
                <RecommendationCard
                  key={`${recommendation.productId}-${recommendation.combinationId ?? recommendation.rank}`}
                  recommendation={recommendation}
                  parentProductId={context.product.productId}
                  loadRelated={loadRelated}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {block.status !== "error" && block.warnings.length > 0 ? <p className="mt-4 text-label-sm text-amber-700">Warnings: {block.warnings.join(", ")}</p> : null}
    </section>
  );
}
