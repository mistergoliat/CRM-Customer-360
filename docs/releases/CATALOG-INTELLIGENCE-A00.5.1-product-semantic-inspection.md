---
title: CATALOG-INTELLIGENCE-A00.5.1 - Product Semantic Inspection
doc_id: catalog-intelligence-a00.5.1-product-semantic-inspection
status: implemented
tags:
  - release
  - catalog
  - console
---

# CATALOG-INTELLIGENCE-A00.5.1 - Product Semantic Inspection

## Purpose

Show the product semantic facts published by `MS-pesaschile-catalog-service`'s active snapshot
(new `GET /v1/products/:productId/semantics`) inside the existing Catalog Console, as a read-only
inspection panel. This is an observability slice: the classifier, ontology, snapshot builder,
relationship engine, `commercialScore`, recommendation ranking, `customer-profile`, RFM, clustering,
CLV, and customer affinity are all untouched.

## Boundary

Unchanged: the browser only ever calls the CRM's own `GET /api/catalog/products/:productId/context`
route (`requireOperator`-gated), never Catalog Service directly, and never sees `x-api-key`. This
slice adds one more server-side call inside that existing route's backing service.

```text
Browser -> CRM API route (existing) -> lib/catalog/consoleService.ts
        -> CatalogPort.getProductSemantics (new, optional) -> Catalog Service HTTP
```

## Changes

- `lib/catalog/types.ts`: `CatalogProductSemantics` (trims each ontology tag to its `code` -
  `axis`/`confidence`/`ruleId` are upstream audit detail this console does not render) and a new
  **optional** `CatalogPort.getProductSemantics` method. Optional so every existing `CatalogPort`
  test double across the repo (shipping, quotes, capability gateway) keeps compiling unchanged -
  this stays an additive capability layered on the existing boundary, not a breaking interface
  change.
- `lib/catalog/httpCatalogAdapter.ts`: `getProductSemantics` calls
  `GET /v1/products/:productId/semantics`. A `404` maps to `ok: true, value: null` (product outside
  the classified universe), mirroring `getProductDetails`' own null-for-not-found convention -
  distinct from a real error. Any other non-2xx (in particular a `503` for an unloaded snapshot)
  falls through the adapter's existing generic `mapProviderErrorCode` HTTP-status fallback -
  `unavailable`, `retryable: true` - with no new error-code mapping needed.
- `lib/catalog/consoleService.ts`: `getCatalogConsoleProductContextWithLimit` now loads detail,
  recommendations, and semantics in parallel (`Promise.all`). A new `CatalogSemanticsBlock`
  (`available` / `not_available` / `error`) is exposed alongside `product` and `recommendations` on
  `CatalogProductContextResult`. Semantics is a degradable inspection branch: an error or missing
  snapshot never turns the whole context result into `{ ok: false }` - detail and recommendations
  render normally regardless of semantics' own status.
- `components/catalog/ProductSemantics.tsx` (new): "Semantica del producto" panel - estado, familia
  principal, familias secundarias, disciplinas, contextos de uso, plus ontology/classifier/snapshot
  metadata. Shows the exclusion reason and rule id when `classificationStatus ===
  "EXCLUDED_NON_PRODUCT"`. Renders a plain informational state (not an error) when the product has
  no published semantics yet.
- `components/catalog/CatalogConsole.tsx`: renders `<ProductSemantics>` between the existing
  `ProductDetail` and `RecommendationList` sections.
- No change to the CRM API route (`app/api/catalog/products/[productId]/context/route.ts`) - it
  already forwards whatever `getCatalogConsoleProductContextWithLimit` returns as JSON.

## Status behavior

`CLASSIFIED`, `PARTIALLY_CLASSIFIED`, `OTHER`, and `EXCLUDED_NON_PRODUCT` are all rendered as
`{ status: "available" }` - `OTHER` shows an empty primary family (`—`), not an error state, and
`EXCLUDED_NON_PRODUCT` additionally surfaces its exclusion reason/rule. Only a productId truly
outside the snapshot's source universe (upstream `404`) renders as `not_available`. An unloaded
snapshot (upstream `503`) renders as `error`, never a silent empty success.

## Tests

- `tests/catalog/httpCatalogAdapter.test.ts`: 5 new tests - tag-to-code trimming, `OTHER`,
  `EXCLUDED_NON_PRODUCT` exclusion provenance, `404` -> `ok:true value:null`, `503` -> retryable
  `unavailable`.
- `tests/catalog/consoleService.test.ts`: 3 new tests - available semantics alongside detail and
  recommendations, `not_available` for a product outside the classified universe, and semantics
  failure never failing the rest of the context.
- `tests/catalog/catalogConsoleUi.test.ts` / `tests/catalog/relatedRecommendationsCache.test.ts`:
  existing context fixtures updated with `semantics: { status: "not_available" }` (new required
  field on `CatalogProductContextResult`).
- All four touched files: 76/76 pass. `npm run typecheck`: clean.

## Explicitly out of scope

Bulk semantic browsing/filtering in the console, and any use of semantics in search ranking or
ProductIntent resolution.
