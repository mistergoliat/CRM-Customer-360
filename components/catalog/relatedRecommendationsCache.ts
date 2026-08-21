import type { CatalogProductContextResult } from "@/lib/catalog/consoleService";

export const CATALOG_RELATED_MAX_DEPTH = 2;

export type RelatedRecommendationsFetcher = (productId: string, limit: number) => Promise<CatalogProductContextResult>;

export type RelatedRecommendationsCache = {
  load(productId: string, limit: number): Promise<CatalogProductContextResult>;
  clear(): void;
  size(): number;
};

function cacheKey(productId: string, limit: number): string {
  return `${productId}:${limit}`;
}

export function createRelatedRecommendationsCache(fetcher: RelatedRecommendationsFetcher): RelatedRecommendationsCache {
  const cache = new Map<string, CatalogProductContextResult>();

  return {
    async load(productId, limit) {
      const key = cacheKey(productId, limit);
      const cached = cache.get(key);
      if (cached) return cached;

      const result = await fetcher(productId, limit);
      if (result.ok) cache.set(key, result);
      return result;
    },
    clear() {
      cache.clear();
    },
    size() {
      return cache.size;
    }
  };
}
