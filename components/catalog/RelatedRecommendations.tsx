"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Icon } from "@/components/ui/Icon";
import { StatusChip } from "@/components/ui/StatusChip";
import type { CatalogConsoleRecommendation, CatalogProductContextResult } from "@/lib/catalog/consoleService";
import { formatMoney, formatStock, formatPercent, errorMessage } from "./catalogDisplay";
import { ProductIdentity } from "./ProductIdentity";
import { RecommendationEvidence } from "./RecommendationEvidence";

const SECONDARY_RECOMMENDATION_LIMIT = 5;

type RelatedRecommendationsProps = {
  recommendation: CatalogConsoleRecommendation;
  parentProductId: string;
  loadRelated: (productId: string, limit: number) => Promise<CatalogProductContextResult>;
};

export function RelatedRecommendations({ recommendation, parentProductId, loadRelated }: RelatedRecommendationsProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CatalogProductContextResult | null>(null);

  async function loadBranch() {
    setLoading(true);
    try {
      setResult(await loadRelated(recommendation.productId, SECONDARY_RECOMMENDATION_LIMIT));
    } catch {
      setResult({ ok: false, error: { code: "catalog_unavailable", message: "Related recommendations request failed.", retryable: true } });
    } finally {
      setLoading(false);
    }
  }

  async function toggleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && result === null && !loading) await loadBranch();
  }

  const block = result?.ok ? result.recommendations : null;

  return (
    <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
      <button type="button" onClick={toggleOpen} className="flex w-full items-center justify-between gap-3 text-left text-label-bold uppercase text-primary">
        <span>Relacionados con este producto</span>
        <span className="flex items-center gap-2 text-slate-500">
          <span>{SECONDARY_RECOMMENDATION_LIMIT} max.</span>
          <Icon name={open ? "expand_less" : "expand_more"} />
        </span>
      </button>

      {open ? (
        <div className="mt-3">
          <p className="text-label-sm text-slate-500">Relacion con {recommendation.name}. No se infiere transitividad con el producto padre.</p>
          {loading ? <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-body-sm text-slate-600">Cargando rama secundaria...</div> : null}
          {!loading && result?.ok === false ? (
            <div className="mt-3 space-y-3">
              <ErrorState title="Rama no disponible" message={errorMessage(result.error)} />
              {result.error.retryable ? (
                <button type="button" onClick={loadBranch} className="rounded-full border border-primary px-3 py-2 text-label-bold uppercase text-primary">
                  Reintentar
                </button>
              ) : null}
            </div>
          ) : null}
          {!loading && block?.status === "error" ? (
            <div className="mt-3 space-y-3">
              <ErrorState title="Relacionados no disponibles" message={errorMessage(block.error)} />
              {block.error.retryable ? (
                <button type="button" onClick={loadBranch} className="rounded-full border border-primary px-3 py-2 text-label-bold uppercase text-primary">
                  Reintentar
                </button>
              ) : null}
            </div>
          ) : null}
          {!loading && block?.status === "empty" ? (
            <div className="mt-3">
              <EmptyState title="Sin relacionados secundarios" description="Catalog Service no retorno recomendaciones para esta rama." icon="account_tree" />
            </div>
          ) : null}
          {!loading && block?.status === "available" ? (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-label-sm text-slate-600">
                <StatusChip label={`${block.shownCount} mostradas`} tone="gray" />
                {block.truncatedByLimitCount > 0 ? <StatusChip label={`${block.truncatedByLimitCount} truncadas por limite`} tone="amber" /> : null}
              </div>
              {block.items.map((item) => (
                <article key={`${recommendation.productId}-${item.productId}-${item.combinationId ?? item.rank}`} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-label-bold text-slate-700">#{item.rank}</span>
                        <p className="line-clamp-2 text-body-md font-bold text-on-surface">{item.name}</p>
                        {item.productId === parentProductId ? <StatusChip label="Producto padre" tone="amber" /> : null}
                      </div>
                      <ProductIdentity product={item} />
                      <p className="mt-2 text-body-sm text-slate-700">Relacion con {recommendation.name}: {item.commercialReason}</p>
                    </div>
                    <div className="grid min-w-[190px] gap-1 text-label-sm text-slate-600">
                      <span>{formatMoney(item.price)}</span>
                      <span>{formatStock(item)}</span>
                      <span>Final {formatPercent(item.score)}</span>
                    </div>
                  </div>
                  <RecommendationEvidence recommendation={item} />
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
