import type { CatalogProduct } from "@/lib/catalog";

/**
 * ACS-R1-05-T06.2 (C6): deterministic budget-tier ranking over already
 * batch-hydrated candidates (never raw search results - those have no
 * price). Operates exclusively on successfully hydrated items with a known
 * effective price; never invents price, stock or attributes, never fixes
 * rigid percentages, never applies category-specific rules.
 */
export const CATALOG_BUDGET_TIERS = ["economy", "near_budget", "stretch"] as const;
export type CatalogBudgetTier = (typeof CATALOG_BUDGET_TIERS)[number];

export type CatalogBudgetCandidate = {
  /** "relevant" (no budget known) or "alternative" (third under-budget pick when nothing exceeds budget) are informational, not one of the three CATALOG_BUDGET_TIERS. */
  tier: CatalogBudgetTier | "relevant" | "alternative";
  product: CatalogProduct;
  effectiveUnitPrice: number;
  currency: string | null;
};

export type CatalogBudgetRankingResult = {
  /**
   * "relevance" - no budget known, ranked by match/availability only.
   * "all_under_budget" - every valid candidate is at or below budgetMax.
   * "all_over_budget" - every valid candidate exceeds budgetMax.
   * "mixed" - both under- and over-budget candidates exist.
   * "no_candidates" - no candidate had a usable price.
   */
  mode: "relevance" | "all_under_budget" | "all_over_budget" | "mixed" | "no_candidates";
  budgetMax: number | null;
  picks: CatalogBudgetCandidate[];
};

function productKey(product: CatalogProduct): string {
  return `${product.productId}:${product.selectedVariant?.variantId ?? "default"}`;
}

/**
 * ACS-R1-05-T06.2 (P2 correction, revised in the second correction pass,
 * section 12). Excludes null/undefined, NaN, Infinity (Number.isFinite),
 * negative amounts, AND zero. The prior pass kept zero as "technically
 * valid" per the catalog contract's unknown-never-zero rule (ADR-005), but
 * that rule only says a KNOWN price is never represented as zero - it does
 * not confirm the real Catalog Service ever emits `effectiveUnitPrice: 0`
 * for a genuinely sellable, priced item (no documented example does, and
 * PrestaShop-backed catalogs commonly show 0 for a product with no price
 * configured yet - a data gap, not a free item). For this MVP, T06.2 does
 * not implement free/special-priced products (that needs its own explicit
 * contract, out of scope here) - so a `0` is treated as unusable, exactly
 * like any other missing price, rather than being presented to a customer
 * as "0 CLP" / "the economical option".
 */
function hasUsablePrice(product: CatalogProduct): product is CatalogProduct & { price: { amount: number; currency: string | null } } {
  return product.price !== null && typeof product.price.amount === "number" && Number.isFinite(product.price.amount) && product.price.amount > 0;
}

function availabilityRank(product: CatalogProduct): number {
  return product.availability === "in_stock" ? 0 : product.availability === "unknown" ? 1 : 2;
}

/**
 * `candidates` must already be in relevance order (e.g. the order produced
 * by rankCatalogSearchResults / the search response) - this function never
 * re-derives match quality, it only reads price and availability on top of
 * that existing order.
 */
export function rankCatalogCandidatesByBudget(candidates: readonly CatalogProduct[], budgetMax: number | null): CatalogBudgetRankingResult {
  const priced = candidates.filter(hasUsablePrice);
  if (priced.length === 0) {
    return { mode: "no_candidates", budgetMax, picks: [] };
  }

  if (budgetMax === null) {
    const relevant = [...priced].sort((a, b) => availabilityRank(a) - availabilityRank(b));
    const picks: CatalogBudgetCandidate[] = [];
    const seen = new Set<string>();
    for (const product of relevant) {
      const key = productKey(product);
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push({ tier: "relevant", product, effectiveUnitPrice: product.price.amount, currency: product.price.currency });
      if (picks.length === 3) break;
    }
    return { mode: "relevance", budgetMax, picks };
  }

  const underBudget = [...priced].filter((product) => product.price.amount <= budgetMax).sort((a, b) => a.price.amount - b.price.amount);
  const overBudget = [...priced].filter((product) => product.price.amount > budgetMax).sort((a, b) => a.price.amount - b.price.amount);

  if (underBudget.length === 0) {
    const picks: CatalogBudgetCandidate[] = [];
    const seen = new Set<string>();
    for (const product of overBudget) {
      const key = productKey(product);
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push({ tier: "stretch", product, effectiveUnitPrice: product.price.amount, currency: product.price.currency });
      if (picks.length === 3) break;
    }
    return { mode: "all_over_budget", budgetMax, picks };
  }

  const seen = new Set<string>();
  const picks: CatalogBudgetCandidate[] = [];

  const economy = underBudget[0];
  seen.add(productKey(economy));
  picks.push({ tier: "economy", product: economy, effectiveUnitPrice: economy.price.amount, currency: economy.price.currency });

  const nearBudgetCandidate = underBudget
    .filter((product) => !seen.has(productKey(product)))
    .sort((a, b) => Math.abs(a.price.amount - budgetMax) - Math.abs(b.price.amount - budgetMax))[0];
  if (nearBudgetCandidate) {
    seen.add(productKey(nearBudgetCandidate));
    picks.push({ tier: "near_budget", product: nearBudgetCandidate, effectiveUnitPrice: nearBudgetCandidate.price.amount, currency: nearBudgetCandidate.price.currency });
  }

  if (overBudget.length > 0) {
    const stretchCandidate = overBudget.find((product) => !seen.has(productKey(product))) ?? overBudget[0];
    if (!seen.has(productKey(stretchCandidate))) {
      seen.add(productKey(stretchCandidate));
      picks.push({ tier: "stretch", product: stretchCandidate, effectiveUnitPrice: stretchCandidate.price.amount, currency: stretchCandidate.price.currency });
    }
    return { mode: "mixed", budgetMax, picks };
  }

  const alternative = underBudget
    .filter((product) => !seen.has(productKey(product)))
    .sort((a, b) => availabilityRank(a) - availabilityRank(b))[0];
  if (alternative) {
    seen.add(productKey(alternative));
    picks.push({ tier: "alternative", product: alternative, effectiveUnitPrice: alternative.price.amount, currency: alternative.price.currency });
  }

  return { mode: "all_under_budget", budgetMax, picks };
}
