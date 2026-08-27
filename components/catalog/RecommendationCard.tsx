"use client";

import { StatusChip } from "@/components/ui/StatusChip";
import type { CatalogConsoleRecommendation, CatalogProductContextResult } from "@/lib/catalog/consoleService";
import { ProductIdentity } from "./ProductIdentity";
import { RecommendationCommercialSummary } from "./RecommendationCommercialSummary";
import { RecommendationEvidence } from "./RecommendationEvidence";
import { RelatedRecommendations } from "./RelatedRecommendations";

type RecommendationCardProps = {
  recommendation: CatalogConsoleRecommendation;
  parentProductId: string;
  loadRelated: (productId: string, limit: number) => Promise<CatalogProductContextResult>;
};

export function RecommendationCard({ recommendation, parentProductId, loadRelated }: RecommendationCardProps) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-fixed text-label-bold text-primary">#{recommendation.rank}</span>
            <p className="line-clamp-2 text-body-lg font-bold text-on-surface">{recommendation.name}</p>
            <StatusChip label="Relacion directa" tone="blue" />
          </div>
          <div className="mt-2">
            <ProductIdentity product={recommendation} />
          </div>
          <p className="mt-3 text-body-md text-slate-700">{recommendation.commercialReason}</p>
          {recommendation.warnings.length > 0 ? <p className="mt-2 text-label-sm text-amber-700">Warnings producto: {recommendation.warnings.join(", ")}</p> : null}
        </div>
        <RecommendationCommercialSummary recommendation={recommendation} />
      </div>
      <RecommendationEvidence recommendation={recommendation} />
      <RelatedRecommendations recommendation={recommendation} parentProductId={parentProductId} loadRelated={loadRelated} />
    </article>
  );
}
