---
title: CP-R1-T10B7 - Catalog Recommendation Capability
doc_id: cp-r1-t10b7-catalog-recommendation-capability
status: implemented_not_wired
tags:
  - release
  - catalog
  - recommendations
  - capability
---

# CP-R1-T10B7 - Catalog Recommendation Capability

Branch: `feat/cp-r1-t10b7-catalog-recommendation-capability`, base `develop`
(contains the CP-R1-T10B6 merge, PR #78 / `135a020`). No commit, push or PR
was made for this task.

## Purpose

Build the single CRM orchestration point for product recommendations: an
internal application capability that connects
`CustomerRecommendationContext` (CP-R1-T10B2) -> `buildSearchProductsV2Request`
(CP-R1-T10B6) -> `CatalogSearchProductsV2Client` (CP-R1-T10B5) -> a
structured, stable result for a future Agent Loop integration
(`CP-R1-T10B8`). Does not select a candidate, does not call
`get_product_details`, does not persist, does not register a public tool.

## Architecture

- **T10B2** (`CustomerRecommendationContext`): read-only input, never
  modified.
- **T10B6** (`buildSearchProductsV2Request`): reused as-is for request
  construction, identity/source-product resolution, and skip
  classification - never re-implemented.
- **T10B5** (`CatalogSearchProductsV2Client`): reused as-is (injected) for
  the HTTP call, response parsing, and error classification - never
  duplicated.
- **This task**: glue only - calls the mapper, and if `ready`, calls the
  client; classifies the outcome into `completed` / `skipped` / `failed`;
  adds no business logic of its own (no ranking, no ownership
  recomputation, no candidate selection).

```
CatalogRecommendationCapabilityInput
  -> buildSearchProductsV2Request (T10B6)
     -> status "skipped"  -> { status: "skipped", reason }         (no HTTP call)
     -> status "ready"    -> CatalogSearchProductsV2Client.searchProducts (T10B5)
                              -> ok: false -> { status: "failed", error }
                              -> ok: true  -> { status: "completed", ... }
```

### Separation: internal capability vs. model-facing tool adapter

This repo already has a formal separation between:

- **Internal application capability** (this task): a DI factory returning
  `{ execute(input) }`, no `inputSchema`, not registered anywhere the Agent
  Tool Loop consults.
- **Model-facing tool adapter** (`CapabilityGatewayDefinition`,
  `lib/brain/commercial/capability-gateway/registry.ts` +
  `toolAliases.ts`): carries `inputSchema`, is registered in
  `CAPABILITY_GATEWAY_REGISTRY`, and is aliased to an LLM tool name so the
  Agent Tool Loop can offer it to the model.

Per the task's explicit instruction ("si existe esa separacion, implementar
solo la capability interna"), this task implements only the first layer.
Nothing was added to `CAPABILITY_GATEWAY_REGISTRY` or `toolAliases.ts` -
that remains explicit, undecided work for `CP-R1-T10B8`.

Note: `lib/brain/commercial/capabilities/` already hosts an unrelated
system (`CapabilityDefinition`/`registry.ts`/`executeReadCapability.ts` for
the multi-request runtime's read capabilities). This task's new
`catalog-recommendation/` subfolder is not exported from that directory's
own `index.ts` and defines its own, unrelated types - no name collision, no
accidental coupling.

## Auditoria previa

Read directly, no name/route assumed without confirmation:

- `lib/catalog/search-products-v2/types.ts` /
  `httpCatalogSearchProductsV2Client.ts` /
  `index.ts` (T10B5) - confirmed `CatalogSearchProductsV2Client.searchProducts(request, context?)`
  signature, the full `SearchProductsV2ClientErrorCode` union (12 values),
  that `SOURCE_PRODUCT_NOT_FOUND`/`SOURCE_PRODUCT_INACTIVE` are not separate
  codes but `providerErrorCode` values under `catalog_service_error`
  (HTTP 404/409/422), and that the client already handles a pre-aborted
  signal, its own internal timeout, and exactly one physical `fetch` per
  call.
- `lib/brain/commercial/recommendation-context/searchProductsV2RequestTypes.ts` /
  `buildSearchProductsV2Request.ts` / `index.ts` (T10B6) - confirmed
  `BuildSearchProductsV2RequestInput`'s exact field set (reused verbatim as
  this task's own input, plus `signal`), the 10 `skipped` reasons, and the
  `ready` result's `request`/`callContext`/`metadata` shape.
- `lib/brain/commercial/recommendation-context/types.ts` /
  `buildCustomerRecommendationContext.ts` (T10B2) - confirmed
  `CustomerRecommendationContext` is read-only input to T10B6, never touched
  here directly.
- `lib/brain/commercial/capability-gateway/types.ts` / `registry.ts` /
  `executeCapability.ts` / `toolAliases.ts` - confirmed the
  `CapabilityGatewayDefinition` contract (`inputSchema`, `checkAvailability`,
  `execute`, governance metadata), that it is the layer registered in
  `CAPABILITY_GATEWAY_REGISTRY` and aliased for the Agent Tool Loop, and
  that no capability in this repo logs directly inside its own `execute()`
  (confirmed no `logger`/`console.log` usage anywhere under
  `lib/brain/commercial/capability-gateway/` or
  `lib/brain/commercial/capabilities/`).
- `lib/brain/commercial/capabilities/types.ts` / `registry.ts` /
  `executeReadCapability.ts` / `index.ts` - confirmed this is an unrelated
  system (`CapabilityDefinition`, multi-request runtime read capabilities:
  `search_products`, `get_product_information`, etc.) with its own
  `CapabilityExecutionResult` shape - never conflated with this task's own
  types.
- `lib/brain/commercial/agent-loop/recentCatalogContext.ts` /
  `pendingCatalogAction.ts` / `buildToolObservation.ts` /
  `runAgentToolLoop.ts` / `runNativeAgentToolLoopCycle.ts` - confirmed both
  read from `crm_capability_executions`/`commercial_event` rows produced by
  the Capability Gateway's own persistence (`executeCapability.ts`), not by
  any capability's own code - this task never touches either mechanism
  directly, matching the task's explicit prohibition.
- `createCatalogSearchProductsV2Client()` / `createCatalogPort()` -
  confirmed neither is called anywhere in the runtime yet (grepped the
  whole `lib/` tree) - T10B5's client remains on-demand/env-driven with no
  composition root wiring it in, confirming the same pattern is appropriate
  here (see "Bootstrap" below).
- `tests/catalog/search-products-v2/httpCatalogSearchProductsV2Client.test.ts`
  and `tests/recommendation-context/buildSearchProductsV2RequestT10B5Compatibility.test.ts` -
  confirmed the existing `node:http`-server-based integration test
  precedent this task's own integration suite follows.

Grepped for `Capability`, `CatalogSearchProductsV2Client`,
`buildSearchProductsV2Request`, `CustomerRecommendationContext`,
`RecommendationCapability`, `recommendations`, `searchProducts`,
`correlationId`, `retryable`, `execution.degraded`, `recentCatalogContext`,
`pendingCatalogAction`, `get_product_details`, `tool observation`,
`bootstrap` - zero matches outside this task's own new files, confirming no
accidental wiring existed before this task and none was introduced beyond
what is documented here.

## Capability input

`CatalogRecommendationCapabilityInput`
(`lib/brain/commercial/capabilities/catalog-recommendation/types.ts`):

```ts
type CatalogRecommendationCapabilityInput = BuildSearchProductsV2RequestInput & {
  signal?: AbortSignal;
};
```

Reuses T10B6's own input type verbatim (no duplicated fields) and adds only
`signal` - transport/cancellation, deliberately kept out of
`buildSearchProductsV2Request` and forwarded only to the T10B5 client.

## Capability result

```ts
type CatalogRecommendationCapabilityResult =
  | {
      status: "completed";
      customerMode: "identified" | "generic";
      recommendations: readonly SearchProductsV2Recommendation[];
      excluded: readonly SearchProductsV2Exclusion[];
      warnings: readonly SearchProductsV2Warning[];
      personalization: SearchProductsV2Personalization;
      execution: SearchProductsV2Execution;
      statistics: SearchProductsV2Statistics;
      snapshot: SearchProductsV2Snapshot;
      metadata: {
        explicitRepurchaseApplied: boolean;
        excludedProductCount: number;
        recommendationCount: number;
        degraded: boolean;
      };
    }
  | { status: "skipped"; reason: BuildSearchProductsV2RequestSkipReason }
  | { status: "failed"; error: CatalogRecommendationCapabilityError };
```

No `completed_degraded` state: `execution.degraded` (and its convenience
mirror `metadata.degraded`) is the single source of truth for a
degraded-but-successful result, per the task's own stated preference.

## Mapper skipped

`buildSearchProductsV2Request`'s `status: "skipped"` result short-circuits
before any client call: `{ status: "skipped", reason }`, `reason` reused
verbatim from T10B6's own `BuildSearchProductsV2RequestSkipReason` (never
redefined). Verified for all 10 reasons
(`source_product_missing`/`source_product_invalid`/`source_product_mismatch`/
`invalid_customer_identity`/`customer_identity_mismatch`/
`contradictory_product_context`/`invalid_excluded_product`/`invalid_query`/
`invalid_correlation_id`/`invalid_limit`) by 10 dedicated unit tests, each
asserting the fake client's call count is `0`.

## Catalog client invocation

```ts
deps.catalogSearchProductsV2Client.searchProducts(buildResult.request, {
  correlationId: buildResult.callContext.correlationId,
  signal: input.signal
});
```

No manual revalidation of the request, no mutation, no second
`customerId`/`correlationId` injection, no capability-owned
`AbortController`, no retry loop - T10B5 already owns timeout, cancellation
and the one-fetch-per-call rule.

## Completed

Verified by dedicated tests: the exact T10B6-built request reaches the
client; `callContext` carries only `correlationId` (never the body); the
external `signal` is forwarded unchanged; `recommendations`/`excluded`/
`warnings`/`personalization`/`execution`/`statistics`/`snapshot` are
returned exactly as the client produced them (order, `ownership` presence/
absence, `reasons`, product identity all preserved, never recomputed,
reordered, filtered or deduplicated).

## Generic mode

No `masterCustomerId` (neither top-level nor inside
`recommendationContext`) -> T10B6 builds a request with no `customer`/
`context.customerId` -> `customerMode: "generic"`. Verified the request sent
to the (fake, and separately the real local-server) client omits both
fields.

## Identified mode

`masterCustomerId` present and valid -> `customerMode: "identified"`, taken
exclusively from `buildResult.metadata.customerMode` (T10B6) - never
re-derived from `response.personalization.customerId`. Verified a case
where `customerMode: "identified"` coexists with
`personalization: { applied: false, reason: "no_customer_history" }` -
never forced into artificial consistency.

## Empty result

`recommendations: []` from the client -> `status: "completed"`,
`metadata.recommendationCount: 0` - never `skipped`/`failed`, never a
generic fallback. `excluded`/`warnings`/`personalization`/`execution`/
`statistics`/`snapshot` preserved as returned.

## Degraded result

HTTP 200 with `execution.degraded: true` -> `status: "completed"`,
`metadata.degraded: true`, `recommendations`/`execution.degradationReasons`
preserved - never reclassified as `failed`/`timeout`/`network_error`, never
retried.

## Ownership

`SearchProductsV2Ownership` (per-recommendation, optional) is passed through
verbatim: present stays present, absent stays absent - never fabricated as
`false`, never used to reorder recommendations or to activate
`explicitRepurchaseApplied` on its own. Verified with one recommendation
carrying `ownership` and a sibling without it in the same response.

## Error taxonomy

`CatalogRecommendationCapabilityError` is exactly `SearchProductsV2ClientError`
(T10B5), reused without redefinition - all 12 codes
(`configuration_error`, `invalid_request`, `timeout`, `aborted`,
`network_error`, `unauthorized`, `forbidden`, `rate_limited`,
`catalog_service_error`, `invalid_response_body`, `invalid_response_schema`,
`unexpected_http_status`) covered by dedicated unit tests preserving
`code`/`retryable`/`httpStatus`/`message`. `SOURCE_PRODUCT_NOT_FOUND`
(HTTP 404) and `SOURCE_PRODUCT_INACTIVE` (HTTP 409) are not separate `code`
values - they surface as `code: "catalog_service_error"` with
`providerErrorCode` carrying the remote code, exactly as T10B5 classifies
them; verified both by dedicated unit tests (fake client) and by dedicated
integration tests (real client + real local server returning the real error
body shape).

## Correlation

`callContext.correlationId` (from T10B6) is the only correlation id
delivered to the client, mapped by T10B5 into the `x-correlation-id` header
- never placed in the request body. Verified end-to-end against a real
local server: the header carries the value, the body never contains it.

## Cancellation

An already-aborted `signal` is forwarded to T10B5 as-is; T10B5's own
pre-flight check (`callContext.signal?.aborted`) returns `code: "aborted"`
before any `fetch` - this capability adds no `AbortController` of its own
and does not pre-empt or duplicate that check. `timeout` (T10B5's own
internal timeout) and `aborted` (external signal) are verified as distinct,
never reclassified into each other. The client is invoked at most once per
`execute()` call in every cancellation scenario tested.

## Concurrency

Zero mutable state on the returned capability object - every call to
`execute()` only touches its own local variables. Verified with two
concurrent `execute()` calls (different `correlationId`, different fake
server responses, one artificially delayed): each call's result matches its
own input, with no cross-contamination. Also verified (closure-audit minor
fix) with two concurrent `execute()` calls each given its own
`AbortController`: the recorded call context for call A carries `===`
`controllerA.signal` and never `controllerB.signal`, and vice versa - the
two signals are never swapped, merged, or dropped.

## Immutability

The capability never mutates `input` (verified with a frozen input object)
and never mutates `recommendationContext` (delegated to T10B6, already
proven pure).

**The capability does not deep-clone the response and provides no
independent isolation guarantee of its own.** `recommendations`/`excluded`/
`warnings`/`personalization`/`execution`/`statistics`/`snapshot` are
assigned straight through from `clientResult.value` - the same object/array
references the injected `CatalogSearchProductsV2Client` returned. Any
runtime isolation between separate `execute()` calls is **entirely
delegated to, and dependent on, whatever client is injected**:

- The real, productive path (T10B5's `HttpCatalogSearchProductsV2Client`)
  happens to provide that isolation as a side effect of its own contract -
  it parses each HTTP response into a brand-new object graph per call
  (`JSON.parse`-based parsing, never a shared/cached reference) - so two
  calls against the real client never alias each other in practice.
- This is a property of T10B5, not of this capability. Any injected client
  or test double - including future doubles written for `CP-R1-T10B8` - must
  independently uphold the same "fresh object graph per call" contract for
  that isolation to hold. A double that reuses/returns the same object or
  array reference across calls will cause this capability's results to
  alias that shared reference, and mutating one call's output will silently
  mutate the other call's (already-returned) output and the shared source
  object.
- Confirmed empirically (ad-hoc probe, not part of this repo): a fake
  client returning the identical `recommendations` array reference on two
  `execute()` calls produces two capability results whose `recommendations`
  are `===` the same array and the same source fixture; pushing into one
  mutates all three.

The `readonly SearchProductsV2Recommendation[]` (etc.) types on the result
are **TypeScript compile-time annotations only** - nothing here is
`Object.freeze`d or runtime-immutable. `readonly` prevents accidental
reassignment through the typed reference at compile time; it does not
prevent mutation via an aliased, untyped, or `as`-cast reference, and it
does not prevent the client itself from mutating the object after handing
it to the capability.

**No deep clone was added in this task.** Given the real T10B5 client
already provides fresh-object isolation, and no other injected client
exists yet, cloning here would be unrequested defensive copying with no
current caller that needs it (per this repo's own minimal-implementation
convention). If `CP-R1-T10B8` introduces a client/double that cannot
guarantee fresh objects per call, that is the point to add cloning -
either in that double, or, if genuinely needed by multiple callers, in this
capability - not preemptively here.

## Bootstrap

`createCatalogRecommendationCapability(deps)` is a pure DI factory - no
global mutable client instance, no HTTP client constructed per execution,
no `process.env` read directly.
`createProductionCatalogRecommendationCapability()` is exported as a
formal, documented convenience factory that reuses T10B5's own
`createCatalogSearchProductsV2Client()` (itself on-demand/env-driven, no
eager `fetch`) - it is **not called anywhere** in this task (no composition
root exists in this repo that would make wiring it in meaningful yet, same
conclusion T10B5 itself already reached). Left for `CP-R1-T10B8` to call
explicitly - a documented decision, not a silent/incomplete wiring.

## T10B5 integration

The `CatalogSearchProductsV2Client` is always injected
(`CreateCatalogRecommendationCapabilityDeps.catalogSearchProductsV2Client`).
Verified against the real client (not a re-implementation) via 11
integration tests using a local `node:http` server: identified mode,
generic mode, exclusions, explicit repurchase, empty result, HTTP 200
degraded, HTTP 404 `SOURCE_PRODUCT_NOT_FOUND`, HTTP 503, timeout (server
never responds), correlation header, and skipped-never-reaches-server.

## T10B6 integration

`buildSearchProductsV2Request` is called exactly once per `execute()`,
unmodified, with the full business-relevant subset of the capability's own
input (everything except `signal`).

## T10B8 output contract

- **`completed`**: zero or more candidates; safe to continue to
  presentation/tool logic; `metadata.degraded` may be `true` or `false`.
- **`skipped`**: no HTTP call was made; the caller must resolve context
  (identity/source product/exclusions/etc.) before retrying; `reason` is
  commercial/structural, never a technical failure.
- **`failed`**: a technical or HTTP error occurred; no recommendation is
  trustworthy; `error.retryable` indicates a possible retry policy, but this
  capability never retries on its own.

None of these three states is ever converted to natural-language text by
this task.

## recentCatalogContext compatibility

Not read, not written. `CP-R1-T10B8` will decide whether/how a `completed`
result feeds `recentCatalogContext` - current interaction/product limits
(`RECENT_CATALOG_CONTEXT_MAX_INTERACTIONS`/`RECENT_CATALOG_CONTEXT_MAX_PRODUCTS`)
are untouched.

## pendingCatalogAction compatibility

Not read, not written. `CP-R1-T10B8` will decide when a `completed` result
leaves a pending action, which candidate needs `get_product_details`, and
when it is consumed/renewed.

## Security

Verified by code inspection and by the error-taxonomy tests: no log
statement was added by this task (this repo's other capabilities do not log
directly inside their own `execute()` either - see "Auditoria previa" -
so this task does not introduce an isolated logger just for itself); no
error path includes `masterCustomerId`, `customerId`, `query`, `productId`/
`combinationId`, request/response bodies, API keys, headers, or a stack
trace - `CatalogRecommendationCapabilityError.message` is always the
already-sanitized message T10B5 produces. Successful results can and do
contain product IDs and catalog data (name, price, stock) - contractual
domain data, not a leak.

## Unit tests

`tests/catalog-recommendation/catalogRecommendationCapability.test.ts` - 37
tests: 10 skipped-reason cases (no client call each); completed (generic,
identified, exact-request/signal/correlationId, order+ownership
preservation); empty result; degraded result; all 12 T10B5 error codes;
`SOURCE_PRODUCT_NOT_FOUND`/`SOURCE_PRODUCT_INACTIVE` under
`catalog_service_error`; no-fallback-on-failure; cancellation (aborted
forwarded, timeout never reclassified as aborted); concurrency (2 parallel
calls, distinct correlation ids, no cross-contamination; **plus** 2 parallel
calls with two distinct `AbortController`s, asserting each call's recorded
call context carries `===` its own controller's `signal` and not the
other's); immutability (mutating one result never affects a later call;
frozen input never throws).

## Integration tests

`tests/catalog-recommendation/catalogRecommendationCapabilityIntegration.test.ts` -
11 tests, real `buildSearchProductsV2Request` + real
`createHttpCatalogSearchProductsV2Client` + local `node:http` server (no
mocked `fetch`, no productive Catalog Service call): identified mode,
generic mode, exclusions, explicit repurchase, empty result, HTTP 200
degraded, HTTP 404 source-not-found, HTTP 503, timeout, correlation header,
skipped-never-reaches-server.

Both suites run twice consecutively - 48/48 passing both times, no
flakiness observed, 0 `only`/`skip`/`todo`. (One transient failure was
observed and fixed during development: the very first `fetch()` call in a
fresh process can exceed a 500ms client timeout purely from `undici`'s lazy
initialization, unrelated to server latency or to this capability's logic -
the integration suite's default `timeoutMs` was raised to 2000ms to remove
that flake; the dedicated timeout-scenario test still uses an explicit
short `timeoutMs: 100` override.)

## Regression suites

`tests/catalog-recommendation/*.test.ts` +
`tests/recommendation-context/*.test.ts` (T10B6 + T10B2) +
`tests/catalog/search-products-v2/*.test.ts` (T10B5) run together: 308/308
passing, 0 failures.

## Full-suite baseline

`npm test` (full suite, `tests/**/*.test.ts`) run repeatedly across the
implementation and the closure-audit passes of this task: 3x on this
branch and 3x on a clean `develop` worktree (`git worktree add`,
`node_modules` junctioned from the main checkout, same dependencies) during
the closure audit, plus one further run on this branch after the minor
fixes below, for a rigorous, identifier-level comparison across multiple
runs - not just a single count.

| | develop (baseline) | this branch (after minor fixes) |
|---|---|---|
| tests | 2229 | 2277 |
| pass | 1756 (clean run) / 1755 (one extra flake) | 1804 |
| fail | 473 (clean run) / 474 (one extra flake) | 473 |

`2229 + 48 = 2277` and `1756 + 48 = 1804` exact against `develop`'s own
**clean** baseline (this task added exactly 48 new tests: 37 unit + 11
integration - the minor-fixes pass added 1 more unit test, up from 47/36).
The `file:line:col` identifiers of every failing test were extracted from
every run (`test at ...` lines, deduplicated) and diffed. Across 3 `develop`
runs during the closure audit, the fail count fluctuated between 473
(clean) and 474 (one extra, ambient flake) - and the extra flake was **not
always the same test**: run 1 flaked on
`tests\catalog\httpCatalogAdapter.test.ts:2:2742`
("searchProducts maps a successful response into the domain shape"), run 2
flaked on `tests\catalog\search-products-v2\httpCatalogSearchProductsV2Client.test.ts:2:34645`
(T10B5's own suite) instead, run 3 was clean. Neither file is touched,
imported, or exercised by any T10B7 file. Both flakes share the same
signature: a plain assertion failure (no `ECONNREFUSED`), an unusually long
duration for that specific test run, and a default client `timeoutMs` of
500ms - the same class of cold-start/resource-contention flake this task's
own integration suite independently diagnosed and mitigated (see
"Integration tests" above, `timeoutMs` raised to 2000ms). This is
environmental, ambient full-suite flakiness pre-dating this task, not a
regression: this branch's own full-suite runs were clean (473, matching
`develop`'s own clean baseline) in every run performed across the
implementation and both audit passes of this task. Every other failure on
every run is the same pre-existing `ECONNREFUSED 127.0.0.1:3306` (no local
MariaDB in this environment) or `AssertionError` DB-dependent failure,
confirmed by exact identifier match, not by count alone.

## Typecheck

`npx tsc --noEmit` - clean.

## Lint

`npm run lint` - 0 errors, 34 pre-existing warnings in unrelated files
(identical set to the develop baseline documented in
`docs/releases/CP-R1-T10B6-identity-recommendation-context-wiring.md`).

## Build

`npm run build` - clean.

## Documentation

- `docs/integrations/catalog-recommendation-capability.md` - relations,
  scope, internal-capability-vs-tool-adapter separation, input/result
  contracts, mapper-skipped/completed/empty/degraded behavior, ownership,
  catalog client invocation, cancellation, concurrency, error taxonomy,
  security, T10B5/T10B6 integration, production factory, compatibility,
  explicitly-out-of-scope.
- This document - includes an expanded "Immutability" section (closure-audit
  minor fix) that explicitly disclaims deep-clone/self-contained isolation.

## Risks

- No wiring exists yet from the real native WhatsApp turn (resolved
  identity, source product, correlation id) into this capability's input -
  that translation, along with the decision of whether/how to register a
  model-facing tool adapter, is explicitly `CP-R1-T10B8`'s job.
- `createProductionCatalogRecommendationCapability()` is exported but
  uncalled - intentional per this task's scope and T10B5's own precedent
  (documented above, not a silent gap). It also does not memoize its
  client/capability instance across calls - harmless today (nothing calls
  it), but `CP-R1-T10B8` should construct it once in a composition root,
  not per turn (see "Production factory" in the integration doc).
- Runtime isolation between concurrent `execute()` calls is entirely
  delegated to whatever `CatalogSearchProductsV2Client` is injected (see
  "Immutability" above) - this capability performs no defensive cloning of
  its own. A future test double for `CP-R1-T10B8` that reuses object/array
  references across calls would silently break that isolation; this is a
  documented contract for callers to honor, not something this task
  enforces at the type level.
- Ambient, environmental full-suite timing flakiness pre-dates this task
  and was neither introduced nor fixed by it (see "Full-suite baseline"):
  across repeated runs, one extra HTTP-timing-sensitive test intermittently
  fails on a clean `develop` checkout, rotating between
  `httpCatalogAdapter.test.ts` and `httpCatalogSearchProductsV2Client.test.ts`
  (T10B5's own suite) - neither file was ever touched by this task.
  Flagged here for visibility, not addressed (out of scope).

## Next task

`CP-R1-T10B8` - Sales Agent Tool Loop Integration.

## Confirmaciones

- No commit fue hecho.
- No push fue hecho.
- No PR fue creado.
- No se registro una tool publica del modelo.
- No se modifico el Agent Loop.
- No se modificaron prompts.
- No se llamo `get_product_details`.
- No se persistieron recomendaciones.
- No se modifico `recentCatalogContext`.
- No se modifico `pendingCatalogAction`.
- No se implementaron retries.
- No se modifico Catalog Service.
- No se modifico Customer Profile.
- No se implemento la normalizacion "20 kg" -> "20kg".
- No se implemento RFM ni clustering.
