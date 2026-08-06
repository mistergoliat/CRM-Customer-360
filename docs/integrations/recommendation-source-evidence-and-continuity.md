---
title: Recommendation source product evidence and continuity
doc_id: integration-recommendation-source-evidence-and-continuity
status: implemented_not_activated
tags:
  - integration
  - catalog
  - recommendations
  - agent-tool-loop
---
# Recommendation source product evidence and continuity

## Purpose

Closes the two gaps CP-R1-T10B8C deliberately left open (see its own
"Known continuity gap" section): `recommend_catalog_products.sourceProduct`
was never checked against anything the conversation actually observed, and a
recommended candidate never became reusable evidence for a later
`get_product_details` or `send_product_link` continuity. Task:
`CP-R1-T10B8D` - see
`docs/releases/CP-R1-T10B8D-source-product-evidence-recommendation-continuity.md`.

**Correction pass**: the first implementation of this task shipped source
product evidence and `send_product_link` continuity, but deliberately left
`get_product_details` unguarded (documented at the time as "explicitly out
of scope", see the release doc's "Correction" section for the full
rationale reversal). A follow-up correction closed that second half: a
completed recommendation now also gates and drives `get_product_details`
continuity directly, without touching `get_product_details`'s pre-existing,
unconditioned authorization when no recommendation continuity is open. This
document now describes the corrected, complete behavior.

## Existing gap

Before this task: `recommend_catalog_products` accepted any syntactically
valid `sourceProduct.productId` (a finite number) and forwarded it straight
to the Gateway/T10B7/T10B6/T10B5 chain - a real HTTP call to the Catalog
Service - regardless of whether that product had ever been mentioned in the
conversation. Its own candidates never appeared in `recentCatalogContext` or
in the evidence pool `pendingCatalogAction` sanitization already used
(`collectAllowedProductIds`, `pendingCatalogAction.ts`), so a model that
tried to offer a recommended candidate for `send_product_link` continuity
had that candidate silently stripped by the existing sanitizer.

## Source product evidence

New pure function `resolveObservedRecommendationSourceProduct`
(`lib/brain/commercial/agent-loop/resolveObservedRecommendationSourceProduct.ts`),
called from `processUseToolStep` (`runAgentToolLoop.ts`) immediately after
the existing dedup/registry checks and before `executeGovernedCapability` is
ever invoked for `recommend_catalog_products`:

```ts
resolveObservedRecommendationSourceProduct({
  requestedSourceProduct,      // { productId, combinationId? } as sent by the model
  recentCatalogContext,        // cross-turn (DB reconstruction)
  toolObservations             // this turn's own prior steps only
}) => { status: "resolved"; product } | { status: "blocked"; reason }
```

Evidence is the union of two sources, both already established elsewhere in
this file:

- **Historical** - `recentCatalogContext.interactions[]`, exactly the same
  structure `pendingCatalogAction.ts#collectAllowedProductIds` already reads.
- **Live, this-turn** - the same bounded `ToolObservation` projections
  `buildToolObservation.ts` already sends the model (never the raw Gateway
  payload), read from `steps` accumulated so far in the current gathering
  loop iteration - a `search_products` call earlier in the same turn
  authorizes a `recommend_catalog_products` call later in that same turn,
  with no need to wait for the next turn's `recentCatalogContext`
  reconstruction.

No new evidence store, no mutation of either input - both are read-only.

## Allowed source tools

`search_products`, `get_product_details`, `explore_catalog` - exactly the
three tools `recentCatalogContext.ts` already recognized before this task.
`recommend_catalog_products` is **not** in this set: its own candidates
never authorize another `recommend_catalog_products` call, in either
evidence source. This is a deliberate anti-chaining rule (no
recommend -> recommend -> recommend loop) - verified by dedicated unit and
integration tests. A future task could allow bounded chaining explicitly;
this one does not.

## Product identity

`productId` is compared as a string after a safe, lossless
number-to-string normalization (`typeof value === "number" &&
Number.isFinite(value) ? String(value) : undefined`) - the exact pattern
already used by `asComparableProductId`/`asProductId` elsewhere in this
directory. Never `parseFloat`, never `Number()` on an arbitrary string,
never accepted from a string-typed model argument (the Gateway's own
`RECOMMEND_CATALOG_PRODUCTS_INPUT_SCHEMA` already requires
`sourceProduct.productId` to be a JSON number). A non-finite or missing
`productId` (`NaN`, `Infinity`, `null`, `undefined`, a string) is never
"observed" - always `source_product_not_observed`.

## Variant identity

If the model's request includes `combinationId`, the evidence must contain
an entry whose `combinationId` matches exactly (`combinationId: 0` is a
real, distinct requested value - never silently treated as "no variant").
No match -> `source_product_variant_not_observed`, even when the bare
`productId` was observed under a different variant.

If the request omits `combinationId`, any evidence entry for that
`productId` is enough, **unless** the observed evidence itself spans more
than one distinct `combinationId` for that product - in that case the
model must disambiguate, exactly like the existing
`RECENT_CATALOG_CONTEXT_RULE_LINES` instruction "if the reference is still
ambiguous... ask the customer to clarify". No variant is ever silently
chosen for the model.

Live-turn evidence from `search_products`/`explore_catalog` observations
never carries `combinationId` - `buildToolObservation.ts`'s
`projectSearchProducts`/`projectExploreCatalog` never project it (confirmed
by an existing, protected test asserting the exact key set of a projected
search item). This is a pre-existing, deliberate limitation of those
projections, unrelated to and out of scope for this task (changing it would
break `tests/agent-loop/buildToolObservation.test.ts`'s
`"search_products observation exposes at most five compact product
results"` key-set assertion). A combinationId-specific `sourceProduct`
therefore resolves reliably only via `recentCatalogContext` (which does
carry `combinationId` for `search_products` history, sourced from the
unprojected `response_summary_json`) - same-turn variant-specific
continuity is a narrower, accepted limitation.

## Recommendation gating

```
model requests recommend_catalog_products
  -> registry/dedup checks (unchanged)
  -> resolveObservedRecommendationSourceProduct(...)
       resolved -> executeGovernedCapability(...) (unchanged path)
       blocked  -> { tool, status:"blocked", errorCode:<reason> }, executed:false
```

The Gateway/T10B7/T10B6/T10B5 chain is never called when evidence is
blocked - verified by an integration test asserting zero HTTP requests reach
the local test server. `executed:false` means this call never consumes
`maxToolExecutions` budget, the same treatment `invalid_arguments` already
receives immediately below it in `processUseToolStep` - the model can
correct the source product and retry within the same turn's budget instead
of a single blocked call silently exhausting it.

## Blocked behavior

Reuses the existing `"blocked"` `ToolObservationStatus` (never a new
status) with one of three reasons, added to `agentStepTypes.ts` as
`RECOMMENDATION_SOURCE_PRODUCT_BLOCKED_REASONS` (a closed union, not a bare
string):

- `source_product_not_observed` - the productId was never observed anywhere.
- `source_product_variant_not_observed` - the productId was observed, but
  not with this exact `combinationId` (or the evidence is ambiguous between
  multiple variants and none was requested).
- `recent_catalog_context_unavailable` - `recentCatalogContext` itself is
  `null`/absent and no live-turn observation was supplied either (distinct,
  for telemetry, from "we checked and it wasn't there").

Never `failed` (not a technical failure) and never the `skipped` status
T10B8C introduced for T10B6-level rejections (the request never reaches
T10B6 at all when evidence fails - a distinct, earlier gate). The model's
system prompt gained two lines (`RECOMMEND_CATALOG_PRODUCTS_RULE_LINES`,
`buildAgentStepPromptPackage.ts`) telling it to use `search_products` or
`get_product_details` first and retry with the observed `productId` -
nothing about commercial strategy, presentation, or how many candidates to
request (deferred to `CP-R1-T10B8E`).

## Recommendation observations

Unchanged: `buildToolObservation.ts`'s `projectRecommendCatalogProductsCompleted`
still caps at `MAX_RECOMMENDATIONS` (5), preserves rank order, never
re-ranks or deduplicates. That constant is now `export`ed so
`recentCatalogContext.ts` can reuse the exact same number (see below) - the
only change to this file in this task.

## recentCatalogContext extension

`recentCatalogContext.ts`'s `sourceTool` union, `isCatalogTool()`, and the
loader's SQL `capability_name IN (...)` all gained
`"recommend_catalog_products"` - the loader now reconstructs
`recommend_catalog_products` history from `crm_capability_executions`
exactly like the three pre-existing tools, via a new
`productsFromRecommendCatalogProducts(payload)`:

- Reads `payload.recommendations[]` only when `payload.status === "completed"`
  (a `"skipped"` payload contributes nothing - it never reached a real
  recommendation result).
- Slices to `MAX_RECOMMENDATIONS` (imported from `buildToolObservation.ts`,
  not a second literal `5`) - see "Visible candidates only" below.
- Maps each candidate's `productId`/`combinationId`/`name` via the same
  `normalizeProductCandidate` helper the other two multi-product tools
  already use - never score, rank, ownership, warnings, personalization,
  query, snapshot, or raw response.

## Visible candidates only

`response_summary_json` for a completed `recommend_catalog_products`
execution holds the Gateway's full, untruncated `recommendations[]` (its
`buildResponseSummary` is not overridden, so `responseSummary` defaults to
`outcome.data` verbatim - confirmed by reading `executeCapability.ts` and
`catalogRecommendationGatewayAdapter.ts`). Slicing at the same
`MAX_RECOMMENDATIONS` the model's own live observation is capped at is what
keeps the invariant "observed by the model" == "eligible for continuity"
(never registering a candidate hidden by truncation as authorized
evidence) - verified by a dedicated test seeding 8 stored recommendations
and asserting only the first 5 become interaction products.

## Pending catalog action

Two distinct continuity mechanisms now share the same `PendingCatalogActionStep`
slot - never two parallel stores, never two fields on the loop result:

### send_product_link (pre-existing consumer of allowed product IDs)

Unchanged. The real, already-shipped mechanism
(`PendingCatalogActionStep = { actionType: "send_product_link",
candidateProductIds }`) is **model-emitted only** - the model includes it on
its own `respond` step (ACS-R1-05.1-T02.7), never created by the runtime
after a tool call completes. `pendingCatalogAction.ts#collectAllowedProductIds`
(the function that sanitizes what the model claims) gained one case in the
first pass of this task: `observation.tool === "recommend_catalog_products"`
now contributes `data.recommendations[].productId` to the allowed set, the
same treatment `search_products`/`explore_catalog`/`get_product_details`
observations already receive. A model that just received recommended
candidates B/C can legitimately say "quieres el link de alguno de estos
productos?" and include `pendingCatalogAction: { actionType:
"send_product_link", candidateProductIds: ["B","C"] }` on that same `respond`
step, and the existing sanitizer no longer strips them.

### get_product_details (new, runtime-managed continuity - correction pass)

Distinct from the above: a **new, explicit continuity** the runtime itself
creates, renews, and consumes - the model never has to emit or even know
about it. `PendingCatalogActionStep` gained an optional field,
`candidateProducts?: Array<{ productId: string; combinationId?: string }>`
(`agentStepTypes.ts`), populated only by
`pendingCatalogAction.ts#buildPendingCatalogActionFromRecommendation` right
after a `recommend_catalog_products` call completes with candidates.
`candidateProductIds` is still populated alongside it (same values, flat) so
every legacy/model-emitted consumer of that field keeps working unchanged -
`candidateProducts` is strictly additive.

`runAgentToolLoop.ts` tracks this as `activeRecommendationPendingAction`,
seeded from `input.pendingCatalogAction` only when it already carries
`candidateProducts` (i.e. it really is a recommendation-origin action loaded
from a prior turn - a plain/legacy/model-emitted `send_product_link` action
never sets this). See "get_product_details authorization" below for the
gating/consumption rules this drives.

## get_product_details authorization

**Corrected in the follow-up pass** (originally left unguarded - see the
release doc's "Correction" section). `get_product_details` keeps its
pre-existing, unconditioned authorization whenever no recommendation
continuity is open (`activeRecommendationPendingAction` is `null`) - every
pre-T10B8D flow (a bare search -> details, or details with zero evidence at
all) is completely unaffected, verified by the full pre-existing regression
suite passing unchanged.

Only while a recommendation's candidates are the active continuity window
does gating apply, checked in `processUseToolStep` before
`executeGovernedCapability` is ever called for `get_product_details`:

```
get_product_details requested, activeRecommendationPendingAction present
  -> does {productId, combinationId?} match one of candidateProducts?
       yes -> authorized, proceeds to the real Gateway call (unchanged path)
       no  -> is the productId observed via this turn's own or
              recentCatalogContext's search_products/get_product_details/
              explore_catalog evidence (recommend_catalog_products
              observations excluded from this fallback - see below)?
                yes -> still authorized (model legitimately moved on to an
                       already-observed, different product)
                no  -> { tool, status:"blocked",
                         errorCode:"product_not_in_pending_catalog_candidates" },
                       executed:false, zero HTTP, pendingCatalogAction
                       left intact (not consumed)
```

`recommend_catalog_products` observations are deliberately excluded from the
"otherwise evidenced" fallback pool (`collectNonRecommendationEvidenceProductIds`,
`runAgentToolLoop.ts`) - including them would let a wrong-variant request for
an otherwise-recommended product slip past the strict `candidateProducts`
variant check via the permissive, productId-only fallback, defeating variant
precision entirely (caught by a dedicated test during this correction).

### Variant matching

`pendingCatalogAction.ts#matchesPendingCatalogActionCandidate`: exact
`productId` match required; when the candidate carries a `combinationId`,
the request must match it exactly - a bare `productId` request (no
`combinationId` argument) never matches a variant-specific candidate ("no
usar solo productId cuando existe informacion de variante"). When the
candidate has no `combinationId`, any requested `combinationId` (or none)
still matches - current catalog semantics, never a fabricated variant.

### Creation and renewal

A completed `recommend_catalog_products` result **always** wins over
whatever was active before ("latest successful recommendation wins" -
`runAgentToolLoop.ts`, right after `processUseToolStep` returns for that
tool): non-empty candidates replace `activeRecommendationPendingAction`
entirely (never merged with a prior recommendation's candidates); empty
candidates (`recommendations: []`) invalidate a prior active one -
`recommendation_pending_catalog_action_invalidated_empty` warning -
because the latest vigent recommendation genuinely has none. `skipped`/
`failed`/blocked-by-evidence results never touch it either way - no new
result to render latest, so a prior active action (if any) survives
untouched, same conservative precedent already used for consumption.

### Consumption

Only for a `get_product_details` request that actually matched a
recommendation candidate (never "producto no candidato", never another
tool, never twice for an already-consumed action): `completed`, `failed`,
and `blocked` (governance, e.g. duplicate) all consume it -
`recommendation_pending_catalog_action_consumed:<status>` warning. This
extends the historical failed/blocked-only consumption rule
(`getPendingCatalogActionTerminalFailure`, unchanged, still governs the
`send_product_link` mechanism on its own) to also auto-consume on
`completed` - `send_product_link` never did that (the model decides there),
but this runtime-managed continuity always does, since the model has no way
to explicitly manage `candidateProducts` itself.

### Final result precedence

At `respond`, the model's own explicit `respond.pendingCatalogAction` always
wins when present and survives sanitization - zero change to any
pre-existing `send_product_link` behavior or test. Only when the model
leaves it out does an active, unconsumed recommendation continuity survive
automatically into `finalPendingCatalogAction` - the model never has to know
about `candidateProducts` to keep it open across the turn boundary. A
terminal `handoff`/`timeout`/`invalid_output`/`provider_unavailable` still
drops every continuity, recommendation included - unchanged, pre-existing
invariant.

Verified end-to-end (real HTTP chain, cross-turn) by
`recommendCatalogProductsAgentLoopIntegration.test.ts`: `search_products ->
recommend_catalog_products` (turn 1) leaves `finalPendingCatalogAction`
populated with the real candidates; a second `runAgentToolLoop` call (turn
2, simulating the next customer message) loads that as `input.pendingCatalogAction`
and authorizes `get_product_details` for the candidate with zero new search,
consuming it on completion.

## Empty

`recommendations: []` -> the row contributes no products (`rawProducts.length
=== 0`), same `recent_catalog_context_no_valid_products` warning every other
tool's empty/invalid row already produces. No special-case branch needed.

## Degraded

`degraded: true` in the stored payload does not gate anything here -
`productsFromRecommendCatalogProducts` only inspects `status` and
`recommendations`, so a degraded-but-completed execution's valid candidates
register exactly like a non-degraded one. `RecentCatalogContext` has no
metadata field for "this interaction was degraded" (adding one with zero
current consumers would be speculative infrastructure) - deliberately not
added.

## Skipped

`payload.status === "skipped"` -> zero products, same as empty. A skip never
reached a real recommendation result, so it can never become evidence.

## Identity generic mode

Unchanged from T10B8C: `identity_unresolved` in
`trustedCustomerSession.masterCustomerIdentity` never blocks and never
produces a handoff. The evidence check added by this task runs independent
of identity entirely - `resolveObservedRecommendationSourceProduct` takes no
identity/session input at all.

## Persistence

No new table, column, `commercial_event`, cache, or outbox row. The
recentCatalogContext extension reads the same `crm_capability_executions`
rows every other tool's history already comes from (only the SQL
`capability_name IN (...)` list widened). `pendingCatalogAction` persistence
rule is unchanged - still gated on `dispatch.outboxWritten === true`
(`runNativeAgentToolLoopCycle.ts`, untouched by this task): `outboxWritten
=== false` means `loop.finalPendingCatalogAction` (recommendation or
`send_product_link`, either shape) is never persisted durably;
`outboxWritten === true` persists it verbatim, `candidateProducts` included.
`events/types.ts#AgentToolLoopPendingCatalogActionPayload` gained the same
optional `candidateProducts` field (a local mirror of
`PendingCatalogActionStep`, same no-cross-module-import convention already
used for every other field in that file) so the persisted payload's type
honestly reflects what actually round-trips.

## Backward compatibility

- `recentCatalogContext` payloads from before this task (no
  `recommend_catalog_products` interactions) parse exactly as before - the
  loader's per-row dispatch is additive (`sourceTool === "recommend_catalog_products"
  ? ... : (existing dispatch)`), never restructured.
- `pendingCatalogAction` payloads from before this task (`{actionType:
  "send_product_link", candidateProductIds}`, no `candidateProducts`) load
  exactly as before - `candidateProducts` is optional, parsed only when
  present (`pendingCatalogAction.ts#parseCandidateProducts`), and its
  absence never gates `get_product_details` (see "get_product_details
  authorization" above) - verified by a dedicated legacy-payload test.
- A `candidateProducts` entry whose `productId` is not also present in
  `candidateProductIds` is dropped defensively on load (the two arrays are
  kept in agreement) - verified by test.
- `resolveObservedRecommendationSourceProduct` is a new module; nothing
  depended on its absence.

## Security

Never observed or persisted by anything this task added: `masterCustomerId`,
`identity.customerId`, `trustedCustomerSession`, Customer Profile, API keys,
headers, raw request/response bodies, score, rank, or ownership (the
recentCatalogContext extension explicitly excludes these - verified by test
asserting the serialized interaction never matches those field names).
Product ids and names are domain data, already permitted for every other
`recentCatalogContext` source tool.

## Concurrency

`resolveObservedRecommendationSourceProduct`, `productsFromRecommendCatalogProducts`,
`buildPendingCatalogActionFromRecommendation`, `matchesPendingCatalogActionCandidate`,
and the updated `collectAllowedProductIds` case are all pure functions - no
static/module-level mutable state. `activeRecommendationPendingAction` itself
is a local variable inside one `runAgentToolLoop` call's closure, never
shared across calls. Verified by an integration test running two
`runAgentToolLoop` calls with different `conversationId`/`recentCatalogContext`
concurrently (`Promise.all`) and asserting one conversation's observed
product never authorizes the other's identical `sourceProduct` request.

## Feature flag

Unchanged: `BRAIN_AGENT_TOOL_LOOP_ENABLED=false` remains the audited default
(`.env.example`). This task now closes all four items T10B8C's "Mitigacion
actual" subsection listed as prerequisites before that flag can flip to
`true` in production: source evidence validation, `recentCatalogContext` fed
by this tool, `pendingCatalogAction` for recommendation continuity (now the
dedicated `candidateProducts` mechanism, not only the pre-existing
`send_product_link` reuse), and continuity to `get_product_details` before
presenting price/stock/a link (now explicitly gated and runtime-driven, not
merely "already unconditioned").

## Explicitly out of scope

- No commercial policy, presentation strategy, or candidate-count guidance
  (`CP-R1-T10B8E`).
- No automatic/code-driven `get_product_details` call after a recommendation
  - the model still decides.
- No recursive recommendation chaining.
- No Customer Profile integration, no RFM runtime.
- No change to Catalog Service, T10B5, T10B6, T10B7, T10B8A, or the
  `recommendCatalogProductsCapability`/Gateway Adapter logic (T10B8B) - only
  its already-existing, unrelated `description` field, itself untouched by
  this task (T10B8C's single change there stands).
- Agent Tool Loop stays disabled by default.

## Next task

`CP-R1-T10B8E` - Recommendation Tool Policy and Commercial Prompt.
