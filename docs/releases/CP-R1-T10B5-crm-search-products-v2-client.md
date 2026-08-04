---
title: CP-R1-T10B5 - CRM SearchProducts V2 Client
doc_id: cp-r1-t10b5-crm-search-products-v2-client
status: implemented_not_wired
tags:
  - release
  - catalog
  - recommendations
  - integration
---

# CP-R1-T10B5 - CRM SearchProducts V2 Client

Branch: `feat/cp-r1-t10b5-search-products-v2-client`, base `develop` (contains
the CP-R1-T10B2 merge, PR #76 / `940506e`). No commit, push or PR was made for
this task.

Task numbering note: `CP-R1-T10B2`'s "Next task" pointed to a task named
"SearchProducts V2 CRM Client and Identity Context Wiring". This task
(`T10B5`) implements only the HTTP client half of that; identity wiring is
explicitly deferred to `CP-R1-T10B6` (see "Fuera de alcance" below). The gap
in numbering (`T10B3`/`T10B4`) belongs to `MS-pesaschile-catalog-service`
itself - that repo's `docs/releases/` contains `CP-R1-T10B3B`, `T10B3C`,
`T10B4A`, `T10B4B` (explicit-repurchase support, ownership propagation, and
related service-side work), confirmed by reading that repo directly. Nothing
in that numbering was invented here.

**Post-audit correction (same branch, still no commit):** a closure audit of
this task found three Minor findings, all closed here: (1) `query`'s
240-char bound was checked against the raw, un-trimmed string while the real
contract's `.trim().max(240)` applies the bound after trim - normalized into
a single `normalizeQuery()` call now shared by validation and serialization;
(2) the manual parser's `asNonEmptyString`/`asIsoDateString` helpers were
measurably more permissive than the real Zod contract (accepted
whitespace-only strings and any `Date.parse`-able date, where the real
schema trims first and requires the canonical `toISOString()` round-trip) -
both hardened to match exactly; (3) the timeout mechanism's coverage of a
stalled body read (as opposed to a stalled response start) was correct by
code review and by an ad-hoc verification script during the audit, but had
no dedicated automated test - added. See "Query normalization", "Response
string and ISO-date parsing", and "Timeout and cancellation" below for the
corrected behavior; the previous, looser behavior is not carried forward as
current documentation anywhere in this file.

## Objective

Build a defensive, typed HTTP client so the CRM can invoke Catalog Service's
`POST /api/v2/recommendations/search-products` (SearchProducts V2) and
preserve the full structured response - recommendations, score/rank,
reasons, ownership, warnings, personalization metadata, execution metadata,
and degraded state - for later tasks. Transport plumbing only: no identity
resolution, no capability, no Agent Loop wiring, no Sales Agent connection.

## Architecture

- **Customer Profile** (`lib/customer-profile`, CP-R1-T10B1) supplies
  historical purchase facts for an already-resolved `masterCustomerId`.
  CRM never queries it directly for recommendations.
- **Catalog Service / SearchProducts V2** (this task) generates
  recommendations, consults Customer Profile internally, applies commercial
  rules, and attaches neutral ownership. Remains the source of truth for
  score, rank, ownership and commercial reasons - this client never
  recomputes any of them.
- **CRM** is a consumer: will later send `masterCustomerId` and commercial
  context (`CP-R1-T10B6`), never recalculates score/ownership, never
  interprets history directly.
- **Sales Agent** will use the structured response later (`CP-R1-T10B7`/
  `T10B8`) - not touched by this task.

## Auditoria previa

Read directly, no name/route assumed from the task brief without
confirmation:

- `lib/catalog/httpCatalogAdapter.ts` / `types.ts` / `index.ts` - existing
  `CatalogPort` HTTP adapter to the same microservice (search/details/batch/
  explore). Config pattern (`CATALOG_SERVICE_BASE_URL`/`_API_KEY`/
  `_TIMEOUT_MS`, `readHttpCatalogAdapterConfig` returns `null` when
  unconfigured), fetch/AbortController transport shape, hand-rolled
  defensive parsing (`isRecord`/`asString`/`asNumber`...), and error taxonomy
  reused directly.
- `lib/customer-profile/httpCustomerProfileAdapter.ts` / `types.ts` /
  `index.ts` (CP-R1-T10B1) - closest sibling: same transport shape, plus the
  fail-closed-port-instead-of-null factory pattern
  (`createCustomerProfilePort` never returns `null`), reused here for
  `createCatalogSearchProductsV2Client`.
- `lib/brain/commercial/recommendation-context/types.ts` (CP-R1-T10B2) -
  `CustomerRecommendationContext`, `ProductReference` (`productId: number`).
  Not modified. See "CustomerRecommendationContext gaps" below for the
  mismatch this creates.
- `lib/brain/commercial/agent-loop/recentCatalogContext.ts`,
  `lib/brain/commercial/agent-loop/buildToolObservation.ts`,
  `lib/brain/commercial/capability-gateway/registry.ts`,
  `lib/brain/commercial/capabilities/registry.ts` - confirmed none of these
  reference SearchProducts V2 yet; `createCatalogPort()` is the only wired
  catalog factory today (`registry.ts:403`), unchanged by this task.
- `.env.example` - confirmed `CATALOG_SERVICE_BASE_URL`/`_API_KEY`/
  `_TIMEOUT_MS` already exist (Capability Gateway v1 / ACS-R1-01) - reused,
  no duplicate pair created.
- `tests/catalog/httpCatalogAdapter.test.ts`,
  `tests/customer-profile/httpCustomerProfileAdapter.test.ts` - real local
  `node:http` server + `node:test` harness pattern, no mocked `fetch`; test
  section layout (Configuration / Identity / happy-path / errors / Security)
  reused directly.
- Confirmed no Zod (or any schema-validation library) is a dependency of
  this repo (`package.json` has no `zod` entry) and neither sibling adapter
  uses one - both hand-roll defensive parsing. The task brief asked for
  "Zod schemas, strict" repeatedly; per the repo's own real convention (and
  `AGENTS.md`'s "no side effects no autorizados" / avoid new dependencies
  without an explicit need), this client uses the same hand-rolled,
  `hasOnlyKeys`-based strict parsing as its two siblings instead of adding a
  new dependency. "Strict" (unknown top-level fields rejected) is honored
  functionally, just not via Zod - see "Tests" below.

## Contrato fuente (Catalog Service)

Audited directly from the real, currently-fused source in
`C:\Users\Goli\Pesas Chile\MS\MS-Stock\services` (repo `@ms-stock/catalog-service`
v1.0.0) - **not** `MS-Stock\catalog-service-mvp`, a separate, unrelated stub
with no recommendations feature at all (confirmed empty of any
`recommendations`/`search-products` route). Files read directly:

- `src/interfaces/http/routes/searchProductsV2Route.ts` (route registration,
  JSON-schema-level request/response/error shapes, auth requirement)
- `src/interfaces/http/controllers/searchProductsV2Controller.ts`
  (`mapSearchProductsV2ErrorToHttp` - exact error-code -> HTTP-status table)
- `src/application/recommendation/search-products-v2/contracts.ts` (the real
  Zod request/response schemas - source of truth for every local type in
  this task)
- `src/application/recommendation/search-products-v2/errors.ts`
  (`SearchProductsV2ErrorCode` closed union)
- `src/domain/recommendation/customer-affinity/contracts.ts`
  (`productOwnershipEvidenceSchema`, `customerAffinityCustomerReferenceSchema`,
  `customerAffinityConfidenceSchema`)
- `src/domain/recommendation/relationship-engine/contracts.ts`
  (`productRelationshipProductReferenceSchema` - `{ productId: string;
  combinationId?: string }`, both non-empty strings, **never numbers**)
- `src/interfaces/http/app.ts` (global auth `preHandler` hook, global
  error handler for 401/429, global rate limiter)

An unrelated, never-wired-to-HTTP "historical offline" contract also exists
in that repo (`src/domain/recommendation/contracts.ts`,
`SearchProductsInput`/`SearchProductsResult`) - explicitly not the transport
contract per that repo's own docs; ignored here.

Full field-by-field mapping table (Catalog Service field -> local CRM field
-> validation -> observations):
`docs/integrations/catalog-search-products-v2-client.md`.

## Cliente HTTP

New module `lib/catalog/search-products-v2/` (`types.ts`,
`httpCatalogSearchProductsV2Client.ts`, `index.ts`), nested under
`lib/catalog/` because it targets the same `MS-pesaschile-catalog-service`
deployment as `lib/catalog/httpCatalogAdapter.ts`, but kept in its own
subfolder/contract (`CatalogSearchProductsV2Client`, not `CatalogPort` -
structurally unrelated response shapes, never mixed).

```ts
type CatalogSearchProductsV2Client = {
  searchProducts(
    request: SearchProductsV2ClientRequest,
    context?: { correlationId?: string; signal?: AbortSignal }
  ): Promise<SearchProductsV2ClientResult>;
};
```

`createHttpCatalogSearchProductsV2Client(config)` builds the real
implementation; `createCatalogSearchProductsV2Client()` is the productive
factory (reads env, single construction path, no fetch at construction
time) - available for `CP-R1-T10B6` to import, not wired to any caller yet.

## Request contract

`SearchProductsV2ClientRequest` mirrors `searchProductsV2RequestSchema`
exactly: `query?`, `sourceProduct` (required `{productId; combinationId?}`,
both strings), `customer?.customerId`, `context?` (`customerId`, `intent`,
`useCase`, `budget`, `preferredProducts`/`excludedProducts`/
`explicitRepurchaseProducts` - all `ProductIdentity[]`), `filters?.inStockOnly`,
`limit?`. `filters.productIds` is deliberately not exposed - schema-legal
upstream but rejected at runtime (`INVALID_REQUEST`, "productIds filter is
not supported by SearchProducts V2 V1"); never sent.

`validateRequest()` runs entirely client-side, before any network call:
non-empty product identities, `query` 1-240 chars (post-normalization, see
below), `limit` integer 1-20, `customer.customerId` non-empty and not a
sentinel (`"0"`/`"unknown"`, matching the real service's own rejection
rule), `context.customerId` must equal `customer.customerId` when both are
present, product-reference arrays valid/unique, and
`explicitRepurchaseProducts` must not overlap `excludedProducts` - all real
`superRefine` rules from the service's own schema, replicated client-side to
fail fast without a wasted network call. `buildRequestBody()` is an explicit
key-by-key allowlist - it never spreads the caller's request object onto the
body, so an unsupported field (like a caller-smuggled `filters.productIds`)
can never reach the wire (tested).

### Query normalization

The real contract validates `query` as `z.string().trim().min(1).max(240)` -
the 240-character bound applies **after** trim, not before. `performSearch()`
calls a single `normalizeQuery(request.query)` helper exactly once, before
both `validateRequest()` and `buildRequestBody()` run, on a shallow copy of
the request (`{ ...request, query: normalizeQuery(request.query) }` - the
caller's original `request` object is never mutated, verified by the
existing immutability test). This guarantees the value that is validated is
byte-identical to the value that is sent - there is no code path where a
different, un-normalized `query` could be serialized. Concretely:
`"  barra olimpica  "` is validated and sent as `"barra olimpica"`;
`"   "` (whitespace-only) is rejected as `invalid_request` with zero network
calls; a raw string longer than 240 characters whose *trimmed* length is
`<=240` is accepted (previously it would have been incorrectly rejected);
a string whose trimmed length exceeds 240 is still rejected; `query`
left `undefined` is omitted from the body entirely (never sent as `""`).
All five cases covered by dedicated tests. Case, accents, units, and
internal whitespace (e.g. `"20 kg"` -> `"20kg"`) are never touched here -
that normalization belongs to Catalog Service, not this client.

## Response contract

`SearchProductsV2ClientResponse` mirrors `searchProductsV2ResultSchema`
field-by-field: `query`, `sourceProduct` (`SearchProductsV2ProductSummary`),
`customer?`, `recommendations[]`, `excluded[]`, `personalization`,
`snapshot`, `warnings[]`, `statistics`, `execution`. Every nested type
(`SearchProductsV2Recommendation`, `Ownership`, `Warning`, `Exclusion`,
`Personalization`, `Execution`, `ExecutionStages`, `ProductSummary`,
`Stock`, `Availability`, `Pricing`, `ProductPublicLink`, `Ranking`,
`Relationship`, `RelationshipEvidence`, `CommercialReason`, `Reason`,
`Snapshot`, `Statistics`) is ported 1:1 in `types.ts`, including every real
closed enum (reason codes: 12 values; warning codes: 17 values; exclusion
codes: 7; personalization reasons: 5; degradation reasons: 2; affinity
confidence: 4; stock/availability statuses).

Parsing (`httpCatalogSearchProductsV2Client.ts`) is strict at every object
level via a shared `hasOnlyKeys()` check (an unknown field at any nesting
level rejects the whole response as `invalid_response_schema`) - functionally
equivalent to the real service's own `.strict()` Zod objects, without adding
Zod as a dependency. Numeric/cross-field invariants enforced: `rank`
positive integer, `score`/`affinityScore`/`commercialScore`/relationship
`confidence`/`reliability` finite `0..1`, ownership
`exactVariantPreviouslyPurchased=true` requires `previouslyPurchased=true`,
and `firstPurchasedAt <= lastPurchasedAt` when both are present (all
verified by dedicated tests). A payload that parses partially (e.g. a
missing required field, or one bad recommendation in an otherwise-valid
array) is never accepted as a partial success - the whole response is
rejected as `invalid_response_schema`.

### Response string and ISO-date parsing

Two parsing helpers were hardened by the post-audit correction described
above, applied consistently everywhere they are used (not case by case):

- **`asNonEmptyString`** (used for `name`, `productId`, `reference`,
  `snapshot.id`/`.modelVersion`, `commercialReason.label`,
  `relationship.type`, and every other non-empty-string field, at every
  nesting level): now trims the value first, mirroring the real contract's
  `z.string().trim().min(1)` transform, and returns the *trimmed* value. A
  whitespace-only string (`"   "`) is rejected as `invalid_response_schema`
  - previously it was incorrectly accepted as a valid non-empty string. A
  string with peripheral whitespace (`"  Banca ajustable  "`) is returned
  trimmed (`"Banca ajustable"`), reflecting what the real, self-validated
  contract actually produces on the wire.
- **`asIsoDateString`** (used only for `ownership.firstPurchasedAt`/
  `.lastPurchasedAt`): now requires the exact canonical round-trip
  `new Date(Date.parse(value)).toISOString() === value`, mirroring the real
  contract's `isoDateTimeSchema`
  (`customer-affinity/contracts.ts#isIsoDateTime`). Previously it only
  required `Date.parse(value)` to succeed, which is strictly weaker: a
  date-only string (`"2025-01-01"`), a timestamp missing milliseconds
  (`"2025-01-01T00:00:00Z"`), and a timestamp with a non-UTC offset
  (`"2025-01-01T00:00:00.000+00:00"`) all parse successfully via
  `Date.parse` but are now correctly rejected, matching the real schema.
  `firstPurchasedAt <= lastPurchasedAt` is still checked, and both values
  pass through this stricter canonical check first - a non-canonical date
  never reaches the ordering comparison.

Both gaps were unreachable against the real, well-behaved service (which
self-validates its own output against these exact schemas before responding
- see `defaultSearchProductsV2Service.ts:589`), but weakened this client's
defense-in-depth against a future upstream regression and contradicted this
document's own "mirrors ... exactly" claim. Closed here, not deferred to
`CP-R1-T10B6`.

## Ownership

`SearchProductsV2Ownership` is genuinely optional on
`recommendations[]` (never on `sourceProduct` or `excluded[]` - those shapes
carry no `ownership` field in the real contract at all). Never fabricated as
`{previouslyPurchased: false}` when the field is simply absent from the
payload; never derived from `score`/`rank`/`reasons`. Verified by dedicated
tests: present with exact-variant purchase, absent (field genuinely missing
from the parsed object, checked via `"ownership" in value`), and the two
real cross-field rejections (`exactVariant` without `previouslyPurchased`;
`firstPurchasedAt` after `lastPurchasedAt`).

## Personalization

`SearchProductsV2Personalization.reason` is the real, complete 5-value enum
(`customer_not_provided`, `customer_affinity_unavailable`,
`customer_reference_not_found`, `customer_history_not_linked`,
`no_customer_history`) - every value covered by a dedicated test.
`applied: true` never coexists with `reason` in the real contract; this
client does not enforce that as a rejection rule (the real service already
guarantees it server-side; enforcing it again client-side would be
over-restrictive per "no ser mas restrictivo que el contrato real sin razon
documentada").

## Warnings

Same `SearchProductsV2Warning` shape used both at the result's top-level
`warnings[]` (global, when `product` is absent) and inside each
`recommendations[].warnings[]` (product-scoped, `product` always present in
practice) - never split into two different arrays or types. All 17 real
warning codes ported verbatim; `RESULTS_TRUNCATED` is preserved in the enum
even though the real service has no confirmed emission site today (reserved,
documented as such in `types.ts`).

## Execution degradation

`execution.degraded=true` returned inside a valid HTTP 200 body is mapped to
`{ ok: true, value: ... }` - a successful client result, never an error
(dedicated test: `execution.degraded=true from a valid HTTP 200 is returned
as a success, never an error`). Only the real 2-value
`degradationReasons` enum (`CUSTOMER_AFFINITY_RETRYABLE_FAILURE`,
`CUSTOMER_AFFINITY_PROVIDER_RESPONSE_INVALID`) is accepted -
`CUSTOMER_HISTORY_NOT_LINKED`/`CUSTOMER_REFERENCE_NOT_FOUND` are warning/
personalization-reason values only, confirmed against the real service to
never set `degraded=true` (contractual test covers this distinction
directly).

## Configuration

Reuses `CATALOG_SERVICE_BASE_URL`/`CATALOG_SERVICE_API_KEY` (no duplicate
pair). Adds `CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS` (default `3000`, must be
a positive integer up to `30000`).
`readHttpCatalogSearchProductsV2ClientConfig()` returns `null` when the base
URL or API key is absent ("not configured" - `createCatalogSearchProductsV2Client()`
then returns a fail-closed client, never `null`, matching CP-R1-T10B1's
pattern). A **present but structurally invalid** base URL (relative, wrong
protocol, embedded credentials, query string, or fragment) or an invalid
explicit timeout (non-integer, `<=0`, or `>30000`) throws
`CatalogSearchProductsV2ConfigurationError` at config-read/construction time
- a deliberate, explicit deviation from the two sibling adapters, which
silently fall back to their default timeout on an invalid value. This task's
brief explicitly required "la configuracion invalida debe fallar en arranque
o construccion de dependencias" for both the base URL and the timeout;
sibling defaults for other clients were left untouched.

## Bootstrap

`createCatalogSearchProductsV2Client()` is the single productive
construction path: reads config once, returns either the real HTTP client or
the fail-closed stand-in - never a singleton, service locator, or per-message
instance, and never performs a fetch at construction time (tested).
Available as a named export from `lib/catalog/search-products-v2/index.ts`
for `CP-R1-T10B6` to wire; not imported by any other module in this task
(`lib/catalog/httpCatalogAdapter.ts`, `createCatalogPort`, and the
Capability Gateway registry are all unchanged).

## Timeout and cancellation

`fetch` + `AbortController`, one new controller per call. The internal
timeout timer and an optional external `AbortSignal` both call
`controller.abort()`; on catch, the client distinguishes external
cancellation (`callContext.signal?.aborted`) from internal timeout by
checking which signal is actually aborted, so `aborted` and `timeout` are
never confused (dedicated test). An already-aborted external signal
short-circuits before `fetch` is ever called (`requestCount` stays `0`,
tested). The timer is always cleared and the external abort listener is
always removed in a `finally` block, and a client instance that just timed
out remains usable for a subsequent call (tested). No retries.

The same `controller.signal` passed to `fetch()` also governs the body read
(`response.text()`), so the timeout covers the full lifecycle - connection,
headers, and body streaming - not just the time to first byte. Added by the
post-audit correction: a dedicated test whose server writes HTTP 200 headers
plus half of the JSON body immediately, then withholds the remaining bytes
for 450ms against a 100ms client timeout - the client aborts mid-body-read
and the result is `{ code: "timeout", retryable: true }`, never
`invalid_response_body`/`network_error`/`invalid_response_schema`, in a
single physical request (`requestCount === 1`). Prior to this correction the
underlying mechanism was already correct (confirmed during the audit with an
ad-hoc, non-committed verification script), but no automated test in this
suite exercised a stalled body distinctly from a stalled response start -
every existing timeout test delayed the entire response via one `setTimeout`
before writing anything. That gap is closed now.

## HTTP errors

Full status table, including the two real upstream error-body shapes
(route-specific, always carries `retryable`; app-level 401/429, never does)
and the exact `error.code` -> HTTP-status mapping read directly from
`mapSearchProductsV2ErrorToHttp`: `docs/integrations/catalog-search-products-v2-client.md#codigos-http---outcome`.
`404` (`SOURCE_PRODUCT_NOT_FOUND`) is never treated as "no recommendations" -
it maps to `catalog_service_error`, non-retryable, same as `409`/`422`. A
followed-redirect attempt (`redirect: "error"`) and a genuine network failure
both map to `network_error`, retryable.

## Logging and security

This module does not log - same as `lib/customer-profile/httpCustomerProfileAdapter.ts`,
which does not log either, for consistency; logging (if any) is a future
caller/orchestrator concern. Errors never carry the raw request/response
body, `customerId`, headers, or stack - only the provider's own structured
`error.code`/`error.message`, with an `x-api-key`/`Bearer` redaction pass
applied defensively. Verified by dedicated tests: a 500 body containing a
fake internal hostname, a stack trace, and the configured API key never
appear in the serialized result; a `customerId` sent in the request never
appears in an error result; an `x-api-key`-shaped string embedded in an
upstream error message is redacted.

## CustomerRecommendationContext gaps (for CP-R1-T10B6)

Audited `lib/brain/commercial/recommendation-context/types.ts`
(`CP-R1-T10B2`) directly - not modified by this task. Gaps identified for the
future mapper (`CustomerRecommendationContext` -> `SearchProductsV2ClientRequest`):

- **Product identity type mismatch**: `CustomerRecommendationContext`'s
  `ProductReference` uses `{ productId: number; combinationId?: number }`;
  this client's `SearchProductsV2ProductIdentity` uses
  `{ productId: string; combinationId?: string }` (the real Catalog Service
  contract requires strings). `T10B6` must `String()`-convert every
  `productId`/`combinationId` when mapping `sourceProductHistory`,
  `explicitExclusionHistory`, `recommendationIntent.sourceProduct`, and
  `recommendationIntent.explicitExcludedProducts` into the request.
- **No `customerId`/`masterCustomerId` bridge**:
  `CustomerRecommendationContext.masterCustomerId` maps directly to this
  client's `request.customer.customerId` (and, per the real contract's
  `superRefine`, must also be set as `request.context.customerId` if
  `context` is otherwise populated) - `T10B6`'s job, not done here.
  `T10B5`'s `customerId` remains a fully opaque string; it does not become
  `masterCustomerId` until `T10B6`.
- **`explicitRepurchaseRequested` is a boolean flag, not a product list**:
  `CustomerRecommendationContext.recommendationIntent.explicitRepurchaseRequested`
  is a single boolean (T10B2 never attached it to a specific product); the
  real request field `context.explicitRepurchaseProducts` is a *list of
  product identities*. `T10B6` needs a rule for which product(s) that
  boolean should apply to (most likely `sourceProduct` itself) - not decided
  by this task.
- **`preferredProducts` has no source in `CustomerRecommendationContext`**:
  T10B2 never modeled a "preferred products" concept (only source product,
  exclusions, and purchase/repeat-behavior evidence). `T10B6` will need a
  new decision for what (if anything) populates `context.preferredProducts`
  - possibly derived from `purchaseHistory.repeatedProducts`, but that is a
  product decision, not assumed here.
- **`query` has no source either**: `CustomerRecommendationContext` carries
  no free-text search string. `T10B6`/the future Sales Agent capability will
  need to decide whether/how to populate the optional `query` field (likely
  from the conversation, not from this context object).

## Compatibilidad

Confirmed unchanged: the Agent Tool Loop (`buildAgentStepPromptPackage.ts`,
`recentCatalogContext.ts`, `pendingCatalogAction`), the Capability Gateway
registry and `AGENT_LOOP_TOOL_POOL`, `lib/catalog/httpCatalogAdapter.ts` /
`CatalogPort` / `createCatalogPort`, `lib/customer-profile/**`,
`lib/brain/commercial/recommendation-context/**`, `master_customer`, auth,
cases, chats, dashboard, and every existing API route. No automatic call to
the real endpoint executes anywhere in this task - the client is exercised
only by its own tests, against a local `node:http` server. No other
repository (`MS-pesaschile-catalog-service`, `MS-pesaschile-customer-profile`)
was modified - both were only read, for contract auditing.

## Tests

`tests/catalog/search-products-v2/httpCatalogSearchProductsV2Client.test.ts`,
against a real local `node:http` server (never a mocked `fetch`), same
pattern as `tests/catalog/httpCatalogAdapter.test.ts` /
`tests/customer-profile/httpCustomerProfileAdapter.test.ts`. 81 tests (64
from the original implementation + 17 added by the post-audit correction),
covering:

- **Configuration**: base URL absent/api key absent/both absent -> `null`;
  trailing-slash normalization; default and configured timeout; relative
  URL, non-http(s) protocol, embedded credentials, query string, fragment,
  non-integer timeout, zero/negative timeout, and over-the-maximum timeout
  all throw `CatalogSearchProductsV2ConfigurationError`.
- **Bootstrap**: fail-closed client when unconfigured (zero fetch calls);
  real client built when configured, with zero fetch calls at construction
  time.
- **Request**: correct method/path/headers/body; `productId`/`combinationId`
  preserved as strings (including a leading-zero string, proving no `Number`
  coercion); full explicit-allowlist body for `customer`/`context`/
  `filters`/`limit`; `filters.productIds` never sent even when force-cast
  onto the input; request object and its arrays never mutated (`JSON.stringify`
  snapshot compared before/after, array reference and length checked); 11
  invalid-request cases rejected with zero network calls.
- **Response**: full valid mapping; ownership present (exact variant) and
  absent (never fabricated); both ownership cross-field rejections; global
  vs. per-product warnings; `personalization.applied=true`; all 5
  `personalization.reason` values; `execution.degraded=false` and `=true`
  (both as success); unknown top-level field rejected (strict); missing
  required field rejected.
- **HTTP errors**: 400/401/403/404/409/422/429/500/502/503/504 each mapped
  to the documented local code/retryable/httpStatus; both real error-body
  shapes (with and without `retryable`) tolerated; invalid JSON body;
  followed redirect rejected; no retry (`requestCount` stays `1`).
- **Timeout and cancellation**: slow response past timeout maps to
  `timeout`/retryable; a client that just timed out is still usable for a
  following call; an already-aborted external signal short-circuits with
  zero network calls; an external abort during an in-flight request maps to
  `aborted`, never `timeout`.
- **Security**: secret API key / internal hostname / stack trace never
  leaked from a 500 body; `customerId` never leaked into an error result; an
  `x-api-key`-shaped string embedded in an error message is redacted.
- **Contractual fixtures** (real SearchProducts V2 scenarios): normal
  commercial recommendation; no customer history
  (`NO_CUSTOMER_HISTORY`/`no_customer_history`); customer not linked
  (`CUSTOMER_HISTORY_NOT_LINKED`, confirmed never degraded); customer
  reference not found (`CUSTOMER_REFERENCE_NOT_FOUND`, confirmed never
  degraded, confirmed no `ownership` on any recommendation); upstream
  technical degradation (`execution.degraded=true`,
  `CUSTOMER_AFFINITY_UNAVAILABLE`) returned as a success.
- **Query normalization** (5 tests, added): trims before validating and
  serializing; whitespace-only rejected with zero network calls; raw length
  `>240` but trimmed `<=240` accepted; trimmed length `>240` rejected;
  `undefined` omits the field entirely from the body.
- **Response string and ISO-date parsing** (11 tests, added): peripheral
  whitespace on a top-level string normalized to the trimmed value;
  whitespace-only top-level string rejected; whitespace-only string nested
  two levels deep (`recommendations[].relationship.type`) rejected; a
  canonical ISO timestamp accepted; each of a date-only string, a
  missing-milliseconds timestamp, a UTC-offset timestamp, a `-03:00`-offset
  timestamp, a non-date string, and an empty string rejected as
  `invalid_response_schema` (parameterized, one test per value); a `null`
  ownership timestamp rejected.
- **Timeout during a stalled body read** (1 test, added): headers plus half
  the JSON body written immediately, remaining bytes withheld past
  `timeoutMs` - result is exactly `timeout`/retryable, one physical request,
  and the client returns well before the withheld tail is ever flushed.

Run twice consecutively (per this repo's documented full-suite flakiness
history) - 81/81 passing both times, no flakiness observed, 0 `only`/`skip`/
`todo`.

## Suite completa

- `npx tsc --noEmit` - clean.
- `npm run lint` - clean for every file this task touched
  (`lib/catalog/search-products-v2/**`, this test file); 34 pre-existing
  warnings remain in unrelated files elsewhere in the repo.
- `npm run build` - clean.
- `npm test` (full suite, `tests/**/*.test.ts`, 2108 tests after the
  post-audit correction) run as evidence only, per this repo's pre-existing
  full-suite flakiness: 1635 pass, 473 fail. The 473 failures are the exact
  same pre-existing count documented by `CP-R1-T10B2` (1554 pass/473 fail
  there) and by the pre-correction state of this task (1618 pass/473 fail) -
  the pass count increased by exactly the 17 new tests added by this
  correction (`1618 + 17 = 1635`). Verified rigorously, not just by count:
  the 473 failing tests' exact `file:line:col` identifiers were diffed
  against a clean `develop` worktree baseline captured during the closure
  audit - zero differences, and the `ECONNREFUSED`/`ERR_ASSERTION`/
  `TypeError` distribution (606/390/8) is identical too. All 473 are
  pre-existing DB-dependent tests (`connect ECONNREFUSED 127.0.0.1:3306`)
  requiring a local MariaDB instance not running in this environment -
  unrelated to this change.
- `git status --short --branch` / `git diff --stat develop` /
  `git diff --name-status develop` / `git ls-files --others --exclude-standard`
  confirm the change set is limited to `lib/catalog/search-products-v2/**`,
  `tests/catalog/search-products-v2/**`, `.env.example`, and the two
  documents listed under "Documentation" - no auth, cases, chats, dashboard,
  API route, schema, Capability Gateway, or Agent Tool Loop file was
  touched.

## Documentation

- `.env.example` - `CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS` added next to the
  existing `CATALOG_SERVICE_*` block, with a comment documenting reuse and
  fail-closed behavior.
- `docs/integrations/catalog-search-products-v2-client.md` - full field
  mapping table and HTTP-status -> outcome table.
- This document.

## Fuera de alcance

Not implemented in this task (all confirmed untouched): `masterCustomerId`
resolution, any query against `master_customer`, a
`CustomerRecommendationContext` -> request mapper/builder, a capability, a
tool schema, Agent Tool Loop wiring, prompts, commercial/presentation text,
persistence of recommendations, `recentCatalogContext`, `pendingCatalogAction`,
any automatic call to the real endpoint, retries, caching, a circuit
breaker, speculative authentication, RFM, clustering, segmentation, and any
change to Catalog Service or Customer Profile.

## Riesgos y deuda

- The local response schema was built directly from the real service's own
  Zod contracts (ground truth, since the service self-validates its own
  output against them before responding) rather than from live HTTP
  samples - if that contract changes upstream without a corresponding CRM
  task, this client will start rejecting real responses as
  `invalid_response_schema` (fail-closed, not a silent data-quality issue,
  but still a coordination risk worth flagging).
- `403 forbidden` is mapped defensively but has no confirmed real emission
  site on this route today (only `401` is confirmed) - kept for parity with
  the task's requested taxonomy and in case an authorization layer is added
  later.
- No smoke test against a real, deployed Catalog Service was run (task
  scope: local `node:http` server only, per "Fuera de alcance": no
  automatic call to the real endpoint).

## Proxima tarea

`CP-R1-T10B6` - Identity and Recommendation Context Wiring.

## Confirmaciones

- No commit fue hecho.
- No push fue hecho.
- No PR fue creado.
- `masterCustomerId` no fue resuelto; `master_customer` no fue consultado.
- El Sales Agent no fue conectado.
- Ninguna capability fue creada.
- `MS-pesaschile-catalog-service` y `MS-pesaschile-customer-profile` no
  fueron modificados (solo leidos, para auditoria de contrato).
- No se implementaron retries.
- No se implemento RFM ni clustering.
