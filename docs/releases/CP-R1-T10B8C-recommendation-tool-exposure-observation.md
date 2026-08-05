---
title: CP-R1-T10B8C - Recommendation Tool Exposure and Observation
doc_id: cp-r1-t10b8c-recommendation-tool-exposure-observation
status: implemented_exposed_not_activated
tags:
  - release
  - catalog
  - recommendations
  - agent-tool-loop
---

# CP-R1-T10B8C - Recommendation Tool Exposure and Observation

Branch: `feat/cp-r1-t10b8c-recommendation-tool-exposure-observation`, base
`develop` (contains the CP-R1-T10B8B merge, PR #81 / `992d106`). No commit,
push or PR was made for this task.

## Correction (audit minor fixes)

The closure audit for this task returned `ACCEPT_WITH_MINOR_FIXES` with 5
Minor findings, no Major. All 5 are fixed in this pass, in the same worktree
and branch, still no commit/push/PR:

1. `buildToolObservation.ts`'s internal `RecommendCatalogProductsSkippedData.reason`
   now imports `BuildSearchProductsV2RequestSkipReason` (T10B6) instead of a
   generic `string` - an invented reason now fails at compile time (verified
   live: a temporary invalid literal produced a real `tsc` error naming all
   10 real values, then reverted before this pass ended).
2. `SOURCE_PRODUCT_INACTIVE` (HTTP 409) now has dedicated unit and
   integration coverage, mirroring the existing `SOURCE_PRODUCT_NOT_FOUND`
   (404) tests.
3. `buildStepsSummary` (`runNativeAgentToolLoopCycle.ts`) is now exported
   (pure function, zero behavior change) so a DB-free test can exercise the
   real `recommend_catalog_products` skip -> step summary ->
   `normalizeAgentToolLoopCompletedCommercialEvent` chain, plus a regression
   test confirming completed/failed/blocked/skipped all normalize side by
   side without throwing.
4. Both docs now state explicitly that `BRAIN_AGENT_TOOL_LOOP_ENABLED=false`
   (the audited default) mitigates the continuity gap today, and what must
   exist before that flag can flip to `true` in production.
5. Both docs now state explicitly that the reused T10B8B schema does not
   enforce `integer`/`minimum` on `productId`/`combinationId`, why that is
   safe today (the real runtime parser/T10B6 reject invalid values as a safe
   `skipped`), and the cross-task procedure required if a future task
   tightens it.

## Estado Git

The starting working tree (the repository's primary checkout) was
contaminated with uncommitted files from a concurrent, unrelated task
(`CP-R1-T12B - Sales Agent Customer Profile HTTP Client`: modified
`.env.example`/`lib/brain/commercial/capabilities/index.ts`, untracked
`docs/releases/CP-R1-T12B-*.md`, `lib/brain/commercial/capabilities/customer-profile/`,
`lib/integrations/customer-profile/`, `tests/customer-profile-client/`) -
exactly the contamination the task instructions warned about. Per section 33,
nothing was reset, stashed, or deleted; instead a clean separate `git
worktree` was created from `develop` (`992d106`) at
`../CRM-Customer-360-t10b8c` on branch
`feat/cp-r1-t10b8c-recommendation-tool-exposure-observation`, confirmed clean
(`git status --short` empty) before any implementation began. All work below
happened in that worktree; the primary checkout was never touched.

## Archivos modificados

Production code (5 files):

- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` - `recommend_catalog_products`
  added as the 5th entry of `AGENT_LOOP_TOOL_POOL`.
- `lib/brain/commercial/agent-loop/agentStepTypes.ts` - `"skipped"` added to
  `TOOL_OBSERVATION_STATUSES`; `ToolObservation` gained `reason?`,
  `retryable?`, `providerErrorCode?` (all exclusive to
  `recommend_catalog_products`).
- `lib/brain/commercial/agent-loop/buildToolObservation.ts` - two new
  projection functions (`projectRecommendCatalogProductsCompleted`/`...Failed`)
  wired in before the shared per-tool switch; every other tool's projection
  is byte-for-byte unchanged. **Audit fix #1**: `RecommendCatalogProductsSkippedData.reason`
  now imports `BuildSearchProductsV2RequestSkipReason` (T10B6) instead of a
  generic `string`.
- `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts` -
  **audit fix #3**: `buildStepsSummary` changed from a private function to
  `export function buildStepsSummary` (pure, zero behavior change) so a
  DB-free test can exercise the real step-summary path.
- `lib/brain/commercial/capability-gateway/catalogRecommendationGatewayAdapter.ts` -
  **single field changed**: the `description` string on
  `recommendCatalogProductsCapability()`. See "Risks" for why this narrow
  T10B8B touch was necessary and deliberate, not silent.
- `lib/brain/commercial/events/types.ts` - `AgentToolLoopStepSummary.observationStatus`
  gained `"skipped"` (mirror-union fix required by the `TOOL_OBSERVATION_STATUSES`
  change above; `npx tsc --noEmit` caught this as a real compile error before
  any test ran).

Tests (6 files):

- `tests/agent-loop/recommendCatalogProductsToolExposure.test.ts` (31
  tests, +1 from the audit fix pass) - pool, description, schema, and
  `buildToolObservation` unit coverage
  (completed/empty/degraded/skipped/failed/generic/immutability/concurrency).
  **Audit fix #2**: added a dedicated `SOURCE_PRODUCT_INACTIVE` (HTTP 409)
  unit test alongside the pre-existing `SOURCE_PRODUCT_NOT_FOUND` one.
- `tests/agent-loop/recommendCatalogProductsAgentLoopIntegration.test.ts`
  (12 tests, +1) - real `runAgentToolLoop` -> real Gateway -> real T10B7/T10B6/T10B5
  chain -> local HTTP server, no mocked `fetch`, no MariaDB. **Audit fix
  #2**: added test 8b, a real HTTP 409 `SOURCE_PRODUCT_INACTIVE` case,
  exactly one HTTP call, no retry.
- `tests/agent-loop/recommendCatalogProductsSkippedEventPersistence.test.ts`
  (new, 2 tests) - **audit fix #3**: the real
  `recommend_catalog_products` skip -> `buildToolObservation` ->
  `buildStepsSummary` -> `normalizeAgentToolLoopCompletedCommercialEvent`
  chain, plus a regression test confirming completed/failed/blocked/skipped
  all normalize side by side. No DB (`normalizeAgentToolLoopCompletedCommercialEvent`
  is pure - `recordAgentToolLoopCompletedCommercialEvent`, the DB-writing
  wrapper, is never called).
- `tests/commercial/catalogRecommendationGatewayAdapter.test.ts` - 3
  assertions updated (pool/description exclusion flipped to inclusion, names
  updated to say CP-R1-T10B8C); no other test touched.
- `tests/commercial/catalogRecommendationGatewayAdapterIntegration.test.ts` -
  1 assertion updated (same flip).
- `tests/agent-loop/runAgentToolLoop.test.ts` - 1 assertion updated (pool
  freeze test now expects 5 tools, `recommend_catalog_products` included).

Docs (2 files, this task's own required deliverables):

- `docs/integrations/recommend-catalog-products-agent-tool.md` - **audit
  fixes #4/#5**: new "Mitigacion actual: Agent Tool Loop apagado por flag"
  subsection and new "Gap de formato conocido" subsection.
- `docs/releases/CP-R1-T10B8C-recommendation-tool-exposure-observation.md`
  (this file) - same two additions, plus this "Correction" section and
  updated file/test counts.

`docs/ACTIVE_RELEASE.md` and `docs/CAPABILITY_MATRIX.md` were **not**
touched, matching the established precedent of every prior `CP-R1-T10B*`
task in this repository (`CP-R1-T10B7`, `CP-R1-T10B8A`, `CP-R1-T10B8B` -
confirmed via `git show --stat` on their merge commits: none of the three
touched either file). Those two documents track the unrelated `ACS-R1-*`
release line; this task's spec (section 31) lists exactly the two docs above
as required, not either of those.

## Auditoría previa

Read in full before any edit, per section 3: `runAgentToolLoop.ts`
(`AGENT_LOOP_TOOL_POOL`, `buildToolDescriptions`, `processUseToolStep`, both
loop phases), `agentStepTypes.ts` (`ToolObservation`/`ToolObservationStatus`),
`buildToolObservation.ts` (all four existing projections), `buildAgentStepPromptPackage.ts`
(`renderToolLine` - confirms `description`+`inputSchema` are read straight
off `CapabilityGatewayDefinition`, the single canonical source),
`executeCapability.ts` (`executeGovernedCapability`'s full orchestration,
including `requestSummary`/`responseSummary` persistence defaults),
`registry.ts` (registration order, `recommend_catalog_products` already
last), `catalogRecommendationGatewayAdapter.ts` (T10B8B, in full - input
schema, parser, `mapCatalogRecommendationResultToOutcome`'s three branches),
`catalog-recommendation/types.ts` and `catalog-recommendation/catalogRecommendationCapability.ts`
(T10B7 - confirmed `metadata.recommendationCount = response.recommendations.length`,
the real total before any truncation), `search-products-v2/types.ts` (T10B5 -
full `SearchProductsV2Recommendation`/`Warning`/`Personalization`/`Execution`
shapes), `searchProductsV2RequestTypes.ts` (T10B6 - confirmed the 10 real
skip reasons), and the existing test files for `search_products`/`get_product_details`/`explore_catalog`/`search_company_knowledge`
(`buildToolObservation.test.ts`) plus the full `catalogRecommendationGatewayAdapter(Integration).test.ts`
suites to learn the fixture conventions reused in the new tests.

## Agent Tool Loop architecture

No architectural change. `processUseToolStep` still routes every `use_tool`
step through `executeGovernedCapability`, unchanged; `buildToolObservation`
is still the single place that turns a `CapabilityGatewayResult` into a
`ToolObservation`. The only change to the loop itself is the pool array
gaining one entry.

## Tool name

`recommend_catalog_products`, 5th entry of `AGENT_LOOP_TOOL_POOL`
(`["search_products", "get_product_details", "search_company_knowledge",
"explore_catalog", "recommend_catalog_products"]`). No alias
(`recommendCatalogProducts`), no change to `toolAliases.ts`/`BrainToolName`/`SalesAgentToolName`,
no change to the legacy `sales-consultative` pipeline.

## Tool pool

Verified by test: exactly 5 tools, no duplicates, all 4 prior tools intact,
`buildToolDescriptions()` returns exactly 5 entries with `recommend_catalog_products`'s
`inputSchema` identical (`===`) to the exported
`RECOMMEND_CATALOG_PRODUCTS_INPUT_SCHEMA` constant - single canonical source,
confirmed.

## Tool description

New model-facing text (full text in the integrations doc) replacing
T10B8B's internal placeholder (`"Internal: ... via SearchProducts V2. Not
yet exposed to the model."`). Covers every required semantic point from
spec section 5 (recommends related products for an already-identified
source; requires `sourceProduct.productId`/optional `combinationId`; not a
free-text search; use after `search_products`/`get_product_details`; works
without an identified customer; `explicitRepurchaseRequested` only for
current repurchase intent; `excludedProducts` are current exclusions; result
is candidates, not confirmed facts; `get_product_details` before presenting
price/stock/link) and mentions none of the prohibited internals
(`masterCustomerId`, Customer Profile, microservice names, endpoints, API
keys, Gateway details, retries) - verified by test.

## Model-visible schema

Reused unchanged: `RECOMMEND_CATALOG_PRODUCTS_INPUT_SCHEMA` (T10B8B). Not
redefined for the Agent Loop - the same object reference is what
`buildToolDescriptions()` now returns. `additionalProperties: false`,
`sourceProduct` required, no internal field declared.

## Runtime validation compatibility

Verified: every field the schema declares is one `parseRecommendCatalogProductsInput`
(T10B8B) actually parses, and every field that parser accepts is declared in
the schema - no orphan on either side. `combinationId: 0` is accepted by
both (the schema has no `minimum`; the real parser/T10B6 normalize it to
"base product", never reject it) - this task did not tighten the schema with
a `minimum`, since the spec's own instruction is "no aceptar
`combinationId=0` si el parser real lo rechaza", and the real parser does
not reject it.

**Known, documented gap** (audit fix #5): the schema declares `productId`/`combinationId`
as `{type:"number"}` - no `type:"integer"`, no `minimum:1` - even though the
model-facing spec asked for "integer positivo". This is not a silent gap:
see "Gap de formato conocido" in the integrations doc for the full
rationale (the real defense is `parseRecommendCatalogProductsInput` +
T10B6, which reject non-integer/non-positive values as a safe `skipped`,
verified end-to-end) and the required cross-task procedure if a future task
tightens the schema (`type:"integer", minimum:1`, repeat the full T10B8B
suite, confirm exact schema/parser compatibility, never a discrepancy
between them). Not fixed in this pass - it is a T10B8B contract, out of
scope per section 32 without an explicit cross-task decision.

## Gateway execution

Unchanged path: `processUseToolStep` -> `executeGovernedCapability("recommend_catalog_products", input, context)`.
No parallel handler, no direct call to `CatalogRecommendationCapability`/T10B6/T10B5/`fetch`,
no retry added on top of the Gateway's own `maxRetries=0` - verified by
integration test 12 (exactly one HTTP request reaches the local server even
on a `503 retryable=true` response).

## Completed observation

`buildToolObservation` gains `projectRecommendCatalogProductsCompleted`,
invoked only when `tool === "recommend_catalog_products" && result.status === "completed"`,
before the shared switch. Projects `customerMode`, `degraded`,
`recommendationCount` (real total, `metadata.recommendationCount`),
`recommendations` (capped at 5, order preserved, `reasons` capped at 5 per
candidate, `ownership` passed through verbatim only when present),
`warnings` (capped at 10), `personalization` (`applied`+`reason`) - all
nested under `data`, matching the `{tool, status, data}` envelope every
other tool in this file already uses (the spec's "forma conceptual" is
adapted to that existing convention, documented explicitly in the
integrations doc rather than left as a silent deviation).

## Empty observation

`recommendations: []` -> `status: "completed"`, `data.recommendations: []`,
`data.recommendationCount: 0`. No special-case branch was needed - this is
the natural fallout of the generic projection when the real array is empty.
Verified by both unit and integration tests.

## Degraded observation

`execution.degraded: true` -> `data.degraded: true`, `status` stays
`"completed"`, candidates and warnings preserved, no `degradationReasons`
(provider internals) exposed.

## Skipped observation

New status `"skipped"` added to `TOOL_OBSERVATION_STATUSES`, exclusive to
this tool. Detected by inspecting `result.data.status === "skipped"` (the
Gateway's own `CapabilityGatewayResult.status` stays `"completed"` for a
T10B6-level skip, per T10B8B's documented mapping) **before** the shared
switch runs, so a skip can never collapse into `{status:"completed",
recommendations:[]}`. `reason` is typed as the real, imported
`BuildSearchProductsV2RequestSkipReason` (T10B6) - not a manually re-listed
union, not a generic `string` (audit fix #1: an earlier pass had used a bare
`string`; a made-up reason now fails `tsc` at compile time, verified live
with a temporary invalid literal that produced a real compiler error naming
all 10 values, then reverted) - and verified round-tripping unchanged at
runtime for all 10 real values. Never marked retryable, never a handoff.

## Failed observation

`{tool, status:"failed", errorCode, retryable, providerErrorCode?}`. Reuses
the `errorCode` field already established by every other tool's failed/blocked
observation (instead of introducing a second field literally named `code`,
which the spec's conceptual sketch used but which would have broken naming
consistency across the file for no functional gain). `retryable` comes from
`CapabilityGatewayResult.retryable` (already correct at the Gateway level,
no digging into `data` needed). `providerErrorCode` comes from `result.data`
only when present (`SOURCE_PRODUCT_NOT_FOUND`/`SOURCE_PRODUCT_INACTIVE`
cases - **both now have dedicated unit and integration coverage**, audit fix
#2; the earlier pass only tested `SOURCE_PRODUCT_NOT_FOUND`). Never
`message`, `sourceProduct`, `query`, `excludedProducts`, `httpStatus` (no
precedent for that field on any existing `ToolObservation` in this repo),
headers, API key, or stack - verified by test, including one that
deliberately puts sensitive-looking fields on the raw `data` payload and
asserts they never reach the serialized observation.

## Ownership

Passed through verbatim (`previouslyPurchased`, `exactVariantPreviouslyPurchased`,
`totalOrderCount?`, `lastPurchasedAt?`) only when the upstream recommendation
carries it; omitted (never fabricated `previouslyPurchased: false`) when
absent. `firstPurchasedAt` is not projected (not part of the spec's
conceptual shape). Never changes `rank`, never becomes an exclusion, never
activates repurchase on its own.

## Personalization

`{applied, reason?}` passed through; `customerId` (present on the real
`SearchProductsV2Personalization` type) is never projected. `customerMode`
comes exclusively from the real result, never inferred from `personalization`.

## Generic mode

`identity_unresolved` (T10B8A) never blocks and never produces a handoff -
verified end-to-end through the real loop (integration test 9): the request
still reaches the local server, `customer` is absent from the sent body, and
the observation reports `customerMode: "generic"`.

## Payload limits

5 recommendations, 5 reasons per recommendation, 10 top-level warnings - all
verified by dedicated tests with 7/8/12-element fixtures respectively.
`recommendationCount` always preserves the real total. No `truncated` flag
was added (no precedent for that field anywhere in this file's existing
projections, and `recommendationCount` already signals truncation when it
exceeds `recommendations.length`).

## Persistence

No new table, column, `commercial_event`, cache, `recentCatalogContext`,
`pendingCatalogAction`, or outbox row. `crm_capability_executions` already
excluded `masterCustomerId`/`customerId`/headers/API key from this
capability's `request_summary_json`/`response_summary_json` since T10B8B -
unchanged. The one necessary addition:
`AgentToolLoopStepSummary.observationStatus` (`events/types.ts`, the local
literal-union mirror `agent_tool_loop_completed` persists) gained
`"skipped"` - without it, a real `recommend_catalog_products` skip would
have failed `npx tsc --noEmit` (confirmed: this was the only compile error
produced by adding `"skipped"` to `ToolObservationStatus`, across the entire
repository).

**Audit fix #3**: `buildStepsSummary` (`runNativeAgentToolLoopCycle.ts`) was
a private function with no test reaching it directly - the type-level fix
above was correct but unverified end-to-end. It is now `export`ed (pure,
zero behavior change) so a DB-free test exercises the real chain
`recommend_catalog_products` skip -> `buildToolObservation` ->
`buildStepsSummary` -> `normalizeAgentToolLoopCompletedCommercialEvent` (the
real, pure normalizer this task's `agent_tool_loop_completed` payload
already went through - `recordAgentToolLoopCompletedCommercialEvent`, the
DB-writing wrapper around it, is never called by this test). A second,
synthetic test confirms `completed`/`failed`/`blocked`/`skipped` all
normalize side by side without throwing and stay preserved distinctly -
byte-for-byte regression coverage for the three pre-existing statuses plus
the new one. See "Event tests" below.

## Security

Verified by test: the model-visible schema never declares an identity
field; the description never names a microservice, endpoint, or the
Gateway; no observation branch (completed/empty/degraded/skipped/failed)
ever includes `masterCustomerId`, `trustedCustomerSession`, an API key,
headers, or a raw request/response body; the failed observation never
leaks `message` even when the fixture data carries an obviously sensitive
string. No `JSON.stringify(context)`, no query/product-id logging added.

## Inmutability

`buildToolObservation` never mutates its `CapabilityGatewayResult` input or
its nested `recommendations`/`warnings` arrays - every array is projected
via `.slice().map()` (new arrays), every object via a fresh literal.
Verified by a dedicated test: a deep-cloned snapshot of the input fixture
stays byte-for-byte equal after `buildToolObservation` runs, and mutating a
field on the *returned* observation never reaches back into the original
fixture's nested `recommendation.product.name`.

## Concurrency

Verified by test: two `buildToolObservation` calls (one `identified`
completed, one `failed`) interleaved back-to-back never cross-contaminate
`customerMode`, recommendations, or error codes, and two calls with the
*same* input never share a `data` object reference (`notEqual` on the two
returned `.data` values) - no static/module-level mutable state inside the
new projection functions.

## Unit tests

`tests/agent-loop/recommendCatalogProductsToolExposure.test.ts` - 31 tests
(+1, audit fix #2), 0 HTTP, 0 DB: pool (visibility, count, no duplicate, no
legacy alias), description (present, safe), schema (identity,
`additionalProperties`, required fields, no internal field,
`sourceProduct`/`excludedProducts` shape), completed (single/multiple
candidates, order, limit, `recommendationCount`, reasons cap, warnings cap +
product-scoped warning, ownership present/absent, personalization
applied/reason, `customerMode`), empty, degraded, skipped (exact reason, all
10 reasons), failed (`errorCode`/`retryable`/`providerErrorCode` for both
`SOURCE_PRODUCT_NOT_FOUND` and, new, `SOURCE_PRODUCT_INACTIVE`; no leak),
generic mode, immutability, concurrency.

## Agent Loop integration tests

`tests/agent-loop/recommendCatalogProductsAgentLoopIntegration.test.ts` - 12
tests (+1, audit fix #2), real `runAgentToolLoop` against a real local
`node:http` server (no mocked `fetch`, no MariaDB dependency -
`crm_capability_executions` writes go through the same real,
silently-degrading `safeExecute` path every other tool in
`runAgentToolLoop.test.ts` already relies on): description/schema reach the
model; a `use_tool` request reaches the real Gateway/T10B7/T10B6/T10B5 chain
and returns a completed observation with the real HTTP body forwarded;
empty; degraded; skipped (zero HTTP calls); failed (real 404
`SOURCE_PRODUCT_NOT_FOUND` and, new, real 409 `SOURCE_PRODUCT_INACTIVE`,
both exactly one HTTP call, no retry); `identity_unresolved` runs generic,
never blocks; the model's second decision receives this turn's own
observation in `priorStepsThisTurn`; exactly one HTTP call on a `503
retryable=true` response (no extra retry); the pool still advertises all 4
prior tools; `finalPendingCatalogAction` stays `null` (this tool never
touches pending catalog action continuity).

## Event tests

`tests/agent-loop/recommendCatalogProductsSkippedEventPersistence.test.ts`
(new, 2 tests, audit fix #3) - pure, no DB, no fetch:

1. Real chain: a genuinely invalid `sourceProduct` runs through the real
   `runAgentToolLoop` (local HTTP server never called), producing a real
   `skipped`/`source_product_invalid` `ToolObservation`. The real
   (now-exported) `buildStepsSummary` maps it to
   `{tool:"recommend_catalog_products", observationStatus:"skipped"}` -
   confirmed `"reason"` is never a field on `AgentToolLoopStepSummary`
   (bounded structural summary by design, never observation data - the exact
   reason stays preserved one layer up, on the `ToolObservation` itself,
   asserted separately). The real `normalizeAgentToolLoopCompletedCommercialEvent`
   (pure - the DB-writing `recordAgentToolLoopCompletedCommercialEvent`
   wrapper is never called) accepts the resulting `stepsSummary` without
   throwing and preserves `observationStatus:"skipped"` in the persisted
   payload shape unchanged - never silently converted to `completed` or
   `failed`.
2. Regression: a synthetic `AgentLoopResult` with one step each of
   `completed`/`failed`/`blocked`/`skipped` (covering every tool in
   `AGENT_LOOP_TOOL_POOL` that can produce each status) round-trips through
   `buildStepsSummary` and `normalizeAgentToolLoopCompletedCommercialEvent`
   together, in one payload, with zero throw and every status preserved
   distinctly, per-tool - proof the new status introduces no
   cross-contamination with the three pre-existing ones.

## Regression suites

Directed re-run, all green, 0 new failures: `catalogRecommendationGatewayAdapter.test.ts`
(T10B8B unit, 44 tests incl. the 3 updated pool/description assertions),
`catalogRecommendationGatewayAdapterIntegration.test.ts` (T10B8B
integration, 20 tests incl. the 1 updated pool assertion),
`buildToolObservation.test.ts` (existing 4-tool projections, byte-for-byte
unchanged, 12 tests), `runAgentToolLoop.test.ts` (agent loop, 64+ tests
incl. the 1 updated pool-freeze assertion),
`buildSearchProductsV2Request.test.ts` (T10B6, 170 tests). Combined run:
310/310 pass (`customerSession.test.ts`, T10B8A, requires `DATABASE_NAME`
and is excluded from this DB-free directed run - not part of this task).

## Full-suite baseline

`npm test` (full suite, `tests/**/*.test.ts`) on this branch vs. the
`develop` baseline already documented in
`docs/releases/CP-R1-T10B8B-catalog-recommendation-gateway-adapter.md`
(`992d106`, the exact commit this branch was created from):

| | develop (baseline, T10B8B doc) | this branch |
|---|---|---|
| tests | 2461 | 2502 |
| pass | 1988 | 2029 |
| fail | 473 | 473 |

`2461 + 41 = 2502` and `1988 + 41 = 2029` exact - this task added exactly 41
new tests (30 unit + 11 integration, both new files) and every one of them
passes (41/41, 0 new fails). The fail count is byte-for-byte identical
between `develop` and this branch: 473 = 473 - the same MariaDB-dependent
failures (`ECONNREFUSED 127.0.0.1:3306`, no local database in this
environment), confirmed by grepping the full failure list for
`recommend_catalog_products`/`T10B8C`/`recommendCatalogProducts`
(case-sensitive, to exclude an incidental match against this worktree's own
directory name `CRM-Customer-360-t10b8c`): zero matches. No test was
skipped or removed to produce this result.

## Typecheck

`npx tsc --noEmit` - clean. One real error surfaced during this task (before
any test ran): `runNativeAgentToolLoopCycle.ts`'s `buildStepsSummary` no
longer satisfied `AgentToolLoopStepSummary` once `"skipped"` was added to
`ToolObservationStatus` - fixed by mirroring the new value onto
`AgentToolLoopStepSummary.observationStatus` (see "Persistence" above).

## Lint

`npm run lint` - 0 errors, 34 pre-existing warnings in files this task never
touched (identical set already documented in the T10B8B/T10B7 release
docs).

## Build

`npm run build` - clean.

## Documentation

- `docs/integrations/recommend-catalog-products-agent-tool.md` - purpose,
  existing layers, tool name, model-visible input/omitted internals,
  description, Gateway execution, all five observation shapes, ownership,
  personalization, generic mode, payload limits, security, persistence,
  Agent Loop visibility, known continuity gap (now with a "Mitigacion
  actual: Agent Tool Loop apagado por flag" subsection, audit fix #4),
  model-visible schema gap (new "Gap de formato conocido" subsection, audit
  fix #5), explicitly out of scope, next task.
- This document - adds "Correction (audit minor fixes)", the feature-flag
  mitigation paragraph under "Known continuity gap", the schema-gap
  paragraph under "Runtime validation compatibility", and "Event tests".

## Known continuity gap

`sourceProduct` is not yet validated against `recentCatalogContext`: the
model can send a syntactically valid `productId` that was never actually
observed this turn, and the Gateway will process it exactly as any other
input (business validity - existence, active state - is T10B6/the real
service's job, unchanged by this task). No automatic continuity to
`get_product_details` exists yet - the model must decide on its own to call
it before presenting price/stock/a link for a recommended product. Both
gaps are deliberate and explicitly deferred to `CP-R1-T10B8D`, per spec
sections 7/21/22 - no partial/improvised validation was added.

**Feature-flag mitigation (audit fix #4)**: `BRAIN_AGENT_TOOL_LOOP_ENABLED=false`
is the audited default (`.env.example`, `commercialCycleConfig.ts#buildAgentToolLoopFeatureFlags`).
While that flag stays `false`, `runNativeAgentToolLoopCycle` - and therefore
`recommend_catalog_products` - never runs in the active runtime
(`runNativeAutonomousCycle.ts` gates the whole branch on
`agentToolLoopEnabled` before entering it). This mitigates the gap above
today: there is no live production path today by which an unobserved
`sourceProduct` or a recommendation without `pendingCatalogAction`
continuity reaches a real customer. The mitigation is a binary kill switch
for the entire loop, not a validation - it does **not** replace
`CP-R1-T10B8D`. Before flipping this flag to `true` in production, all of
the following must exist: `sourceProduct` validated against observed
evidence, `recentCatalogContext` fed by this tool's recommendations,
`pendingCatalogAction` for recommendation continuity, and continuity to
`get_product_details` before presenting price/stock/a link.

## Risks

- **Single narrow touch to the T10B8B file** (`catalogRecommendationGatewayAdapter.ts`,
  `description` string only, no logic/schema/behavior change). The task's
  own scope rules (section 32) restrict T10B8B edits to "real blocking
  defects, stop and report, never silently fix". This was not treated as a
  silent contract correction: T10B8B's own code comment on that exact field
  read `"...Not yet exposed to the model."`, and this task's explicit
  mandate (spec section 5) is to author that description now that the
  capability is exposed - the field was a placeholder deliberately deferred
  to this task, not an accepted contract being reopened. Reported here
  explicitly, not silently applied. No other line in the T10B8B file
  changed (verified: `git diff develop -- lib/brain/commercial/capability-gateway/catalogRecommendationGatewayAdapter.ts`
  is a single-hunk diff touching only the `description` value and its
  preceding comment).
- `AgentToolLoopStepSummary.observationStatus` (`events/types.ts`) gaining
  `"skipped"` is an additive, backward-compatible union widening - every
  existing consumer that only expects `"completed" | "failed" | "blocked"`
  is unaffected (optional field, no exhaustive switch over it exists
  anywhere in the codebase - confirmed by grep). Now verified end-to-end,
  not just at the type level (audit fix #3, see "Event tests").
- `buildStepsSummary` (`runNativeAgentToolLoopCycle.ts`) changed from a
  private function to `export`ed - a pure function, zero behavior change,
  same minimal-surface rationale already used elsewhere in this module for
  testability (e.g. `toSearchProductsV2ProductIdentity` in T10B6). No other
  symbol in that file was exported.
- No `AbortSignal`/cancellation change - unchanged from T10B8B, still bounded
  only by T10B5's own internal timeout.

## Next task

`CP-R1-T10B8D` - Source Product Evidence and Recommendation Continuity.

## Confirmaciones

- No commit was made.
- No push was made.
- No PR was created.
- Work happened in a clean, separate worktree - the contaminated primary
  checkout (CP-R1-T12B files) was never touched, reset, stashed, or included.
- No T12B file was included in this branch's diff (verified: `git diff --name-status develop`
  contains only the files listed in "Archivos modificados" above).
- The legacy pipeline (`toolAliases.ts`, `BrainToolName`, `SalesAgentToolName`,
  the `sales-consultative` engine) was not modified.
- `recentCatalogContext.ts` was not modified.
- `pendingCatalogAction.ts` was not modified.
- `get_product_details` is not called automatically by `recommend_catalog_products`
  or by anything this task added.
- `sourceProduct` is not validated against observed evidence yet (documented
  gap, deferred to `CP-R1-T10B8D`).
- No full commercial prompt/policy was added - only the minimal tool
  description required to expose the tool (spec section 23).
- `identity_unresolved` is never blocked - verified end-to-end.
- No `masterCustomerId` is exposed anywhere in the schema, description, or
  any observation branch - verified by test.
- Customer Profile is never called directly by anything this task added.
- T10B5, T10B6, T10B7, T10B8A were not modified. T10B8B was modified in
  exactly one field (`description` string), documented above under "Risks".
