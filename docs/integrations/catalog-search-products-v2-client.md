---
title: Catalog Service SearchProducts V2 - CRM HTTP client
doc_id: integration-catalog-search-products-v2-client
status: implemented_not_wired
tags:
  - integration
  - catalog
  - recommendations
---
# Catalog Service SearchProducts V2 - CRM HTTP client

## Relaciones

- Implementa: `lib/catalog/search-products-v2/httpCatalogSearchProductsV2Client.ts`
- Contrato fuente (real, no importado): `MS-Stock/services/src/application/recommendation/search-products-v2/contracts.ts`
  in the local checkout of `MS-pesaschile-catalog-service` (`C:\Users\Goli\Pesas Chile\MS\MS-Stock\services`).
  Note: `C:\Users\Goli\Pesas Chile\MS\MS-Stock\catalog-service-mvp` is a separate,
  unrelated stub with no recommendations feature - do not confuse the two.
- Task: `CP-R1-T10B5` - see `docs/releases/CP-R1-T10B5-crm-search-products-v2-client.md`.
- Reemplaza: none. Coexists with `lib/catalog/httpCatalogAdapter.ts` (`CatalogPort` -
  search/details/batch/explore), unchanged.

## Alcance

Transport client only, for `POST /api/v2/recommendations/search-products`. Never
resolves identity (`customerId` is an opaque string, not `masterCustomerId`),
never recomputes score/rank/ownership, never generates commercial text, and is
not wired to any caller yet (Sales Agent, Agent Tool Loop, Capability
Gateway).

## Endpoint

`POST /api/v2/recommendations/search-products` on the same
`MS-pesaschile-catalog-service` deployment `lib/catalog/` already talks to.

## Autenticacion

Header `x-api-key: <CATALOG_SERVICE_API_KEY>` on every request - the real
route requires it (confirmed: `app.ts`'s global `preHandler` hook, not
exempted for this route; `401 UNAUTHORIZED` without it). Reuses the existing
`CATALOG_SERVICE_BASE_URL` / `CATALOG_SERVICE_API_KEY` pair - no second,
duplicate variable pair was created.

## Timeout

`CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS` (default `3000`, integer, `1..30000`).
A timeout aborts the request via `AbortController` and is reported as
`{ code: "timeout", retryable: true }` - never an uncaught exception. The
same `AbortController`/timer covers the entire lifecycle - connection,
headers, and body streaming - not just the initial `fetch()` call: a
response whose headers (and even part of the body) arrive immediately but
whose remaining body bytes stall past the timeout is aborted mid-read and
classified as `timeout`, never `invalid_response_body`/`network_error`.
Verified by a dedicated test that writes headers plus half the JSON body
immediately and withholds the rest past `timeoutMs`.

## Ownership del retry

Exactly one physical HTTP call per `searchProducts` invocation - no
adapter-level retry loop, same rule as `lib/catalog/httpCatalogAdapter.ts` and
`lib/customer-profile/httpCustomerProfileAdapter.ts`. Retry ownership belongs
to a future Capability Gateway / orchestrator.

## Field mapping (Catalog Service -> local CRM contract)

| Campo Catalog Service | Campo local CRM | Validacion | Observaciones |
|---|---|---|---|
| `sourceProduct.productId` (string) | `SearchProductsV2ProductIdentity.productId` | non-empty string, never `Number()` | required |
| `sourceProduct.combinationId` (string, optional) | `SearchProductsV2ProductIdentity.combinationId` | non-empty string if present | never mixed with `productAttributeId` (Customer Profile's field) |
| `query` (string, optional) | `SearchProductsV2ClientRequest.query` | trimmed once, then length 1-240 checked on the trimmed value | compatibility metadata only, never resolves `sourceProduct`; trimmed before both validation and serialization from a single normalization point (`normalizeQuery`) - never validates one version and sends another |
| `customer.customerId` (string, optional) | `SearchProductsV2ClientRequest.customer.customerId` | non-empty, not `"0"`/`"unknown"` (case-insensitive) | opaque string in T10B5 - becomes `masterCustomerId` in T10B6 |
| `context.customerId` | same | non-empty; must equal `customer.customerId` if both present | rejected client-side before any network call |
| `context.intent` / `context.useCase` | same | non-empty string | free text |
| `context.budget` | `SearchProductsV2RequestContext.budget` | `amount` finite >=0, `currency` non-empty | |
| `context.preferredProducts` / `excludedProducts` / `explicitRepurchaseProducts` | same names | valid identities, unique per array; `explicitRepurchaseProducts` must not overlap `excludedProducts` | never derived from ownership/history by this client |
| `filters.inStockOnly` | `SearchProductsV2Filters.inStockOnly` | boolean | |
| `filters.productIds` | **not exposed** | - | schema-legal upstream but rejected at runtime (`INVALID_REQUEST`) - never sent |
| `limit` | `SearchProductsV2ClientRequest.limit` | integer 1-20 | server defaults to 5 when omitted |
| `recommendations[].product` | `SearchProductsV2Recommendation.product` | full `SearchProductsV2ProductSummary` | same shape as `sourceProduct` |
| `recommendations[].rank` / `.score` / `.ranking` | same | `rank` positive integer, `score` finite 0-1 | duplicated at top level and inside `ranking` by the real contract - both preserved, never collapsed |
| `recommendations[].ownership` | `SearchProductsV2Recommendation.ownership` (optional) | boolean/int fields; `firstPurchasedAt`/`lastPurchasedAt` must be the **canonical** ISO-8601 string (`new Date(Date.parse(value)).toISOString() === value` - rejects a date-only string, a missing-milliseconds string, or a non-UTC offset, even though `Date.parse` accepts all of those); `exactVariantPreviouslyPurchased=>previouslyPurchased`; `firstPurchasedAt<=lastPurchasedAt` | genuinely optional - never fabricated as `previouslyPurchased:false` when absent |
| `recommendations[].reasons[]` | `SearchProductsV2Reason[]` | closed 12-value `code` enum, closed 4-value `source` enum | |
| `warnings[]` (top-level and per-recommendation) | `SearchProductsV2Warning[]` | closed 17-value `code` enum; `product` present = scoped, absent = global | same shape used in both places, never split into two arrays |
| `excluded[]` | `SearchProductsV2Exclusion[]` | closed 7-value `code` enum | no `ownership` on this shape ever |
| `personalization` | `SearchProductsV2Personalization` | `applied` boolean; `reason` closed 5-value enum, optional; `customerId` optional | `applied:true` never coexists with `reason` |
| `snapshot.id` / `.modelVersion` | `SearchProductsV2Snapshot` | non-empty strings | real field names, not `snapshotId`/`version` |
| `statistics` | `SearchProductsV2Statistics` | non-negative integers; `customerAffinityCalls`/`personalizationCalls` in `{0,1}` | |
| `execution.degraded` / `.degradationReasons` / `.stages` | `SearchProductsV2Execution` | `degradationReasons` closed 2-value enum; `stages` 3 closed enums | `degraded:true` with HTTP 200 is a **successful** client result, never an error |

## Normalization (response strings)

Every non-empty-string field in the response (`name`, `productId`,
`reference`, `snapshot.id`, `commercialReason.label`, etc., at every nesting
level) is trimmed before being checked for emptiness and before being
returned, mirroring the real contract's `z.string().trim().min(1)`
transform. A whitespace-only string (`"   "`) is rejected as
`invalid_response_schema`, never accepted as valid; a string with only
peripheral whitespace (`"  Banca ajustable  "`) is returned trimmed
(`"Banca ajustable"`), reflecting what the real, self-validated contract
actually produces. This was a real gap prior to this correction (the parser
previously accepted a whitespace-only string as non-empty and returned
values verbatim, without a trim) - closed here for every field that uses the
shared `asNonEmptyString` helper, not case by case.

## Codigos HTTP -> outcome

| HTTP | Real provider `error.code` (examples) | Local `code` | `retryable` default when body lacks it |
|---|---|---|---|
| 200 | - | success (`ok:true`), including `execution.degraded=true` | - |
| 400 | `INVALID_REQUEST` | `invalid_request` | `false` |
| 401 | `UNAUTHORIZED` (app-level, no `retryable` field) | `unauthorized` | `false` |
| 403 | (not observed upstream; handled defensively) | `forbidden` | `false` |
| 404 | `SOURCE_PRODUCT_NOT_FOUND` | `catalog_service_error` | `false` |
| 409 | `CUSTOMER_MISMATCH` / `SOURCE_PRODUCT_INACTIVE` | `catalog_service_error` | `false` |
| 422 | `INVALID_COMMERCIAL_RESULT` / `INVALID_AFFINITY_RESULT` / `INVALID_PERSONALIZATION_RESULT` / `UPSTREAM_CONTRACT_MISMATCH` | `catalog_service_error` | `false` |
| 429 | `RATE_LIMITED` (app-level, no `retryable` field) | `rate_limited` | `true` |
| 500 | `INTERNAL_CONFIGURATION_ERROR` / `INTERNAL_ERROR` | `catalog_service_error` | `true` |
| 502/503/504 | `COMMERCIAL_RECOMMENDATION_UNAVAILABLE` (also used when the service itself is unconfigured) | `catalog_service_error` | `true` |
| any other | - | `unexpected_http_status` | `false` |
| invalid JSON body | - | `invalid_response_body` | `false` |
| body does not match the local strict schema | - | `invalid_response_schema` | `false` |
| followed redirect / network failure | - | `network_error` | `true` |
| internal timeout | - | `timeout` | `true` |
| external `AbortSignal` fired | - | `aborted` | `false` |
| not configured (`CATALOG_SERVICE_BASE_URL`/`CATALOG_SERVICE_API_KEY` absent) | - | `configuration_error` | `false` |

Two real error body shapes exist upstream: the route-specific shape (400/404/
409/422/500/503, always carries `retryable`) and the app-level generic shape
(401/429, never carries `retryable`). The client honors `body.error.retryable`
when it is a boolean and otherwise falls back to a status-based default
(`429`/`5xx` => `true`).

## Seguridad

Errors never include the raw response body, request body, `customerId`,
headers, or stack - only the structured `error.code` / `error.message`
fields from the provider's own error envelope, with an `x-api-key`/`Bearer`
redaction pass applied defensively (same rule as
`lib/catalog/httpCatalogAdapter.ts#sanitizeErrorMessage`).
