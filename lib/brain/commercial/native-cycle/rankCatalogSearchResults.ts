import type { CatalogAvailabilityStatus, CatalogSearchResultItem } from "@/lib/catalog";

/**
 * Deterministic, audited product selection (ACS-R1-01.1 objective 6). The
 * gateway never picks "the first search result" implicitly - every
 * selection is explainable by these two ranking rules, in this order:
 * match quality (how the search matched the query), then availability.
 * Ties keep the search API's own original order (stable sort).
 */
const MATCH_TYPE_RANK: Record<CatalogSearchResultItem["matchType"], number> = {
  exact_sku: 0,
  exact_name: 1,
  partial_name: 2,
  description: 3
};

const AVAILABILITY_RANK: Record<CatalogAvailabilityStatus, number> = {
  in_stock: 0,
  unknown: 1,
  out_of_stock: 2
};

export type CatalogRankingReason = {
  productId: string;
  combinationId: string;
  rank: number;
  matchType: CatalogSearchResultItem["matchType"];
  availability: CatalogAvailabilityStatus;
  rule: "catalog-ranker.v1";
};

export function rankCatalogSearchResults(items: readonly CatalogSearchResultItem[]): { ranked: CatalogSearchResultItem[]; reasons: CatalogRankingReason[] } {
  const indexed = items.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    const matchDiff = MATCH_TYPE_RANK[a.item.matchType] - MATCH_TYPE_RANK[b.item.matchType];
    if (matchDiff !== 0) return matchDiff;
    const availabilityDiff = AVAILABILITY_RANK[a.item.availability] - AVAILABILITY_RANK[b.item.availability];
    if (availabilityDiff !== 0) return availabilityDiff;
    return a.index - b.index;
  });

  const ranked = indexed.map((entry) => entry.item);
  const reasons = ranked.map((item, rank) => ({
    productId: item.productId,
    combinationId: item.combinationId,
    rank,
    matchType: item.matchType,
    availability: item.availability,
    rule: "catalog-ranker.v1" as const
  }));

  return { ranked, reasons };
}

export function selectBestCatalogMatch(items: readonly CatalogSearchResultItem[]): { item: CatalogSearchResultItem; reason: CatalogRankingReason } | null {
  const { ranked, reasons } = rankCatalogSearchResults(items);
  if (ranked.length === 0) return null;
  return { item: ranked[0], reason: reasons[0] };
}
