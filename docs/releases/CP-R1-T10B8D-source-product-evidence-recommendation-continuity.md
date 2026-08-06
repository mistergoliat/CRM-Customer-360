---
title: CP-R1-T10B8D - Source Product Evidence and Recommendation Continuity
doc_id: cp-r1-t10b8d-source-product-evidence-recommendation-continuity
status: implemented_not_activated
tags:
  - release
  - catalog
  - recommendations
  - agent-tool-loop
---

# CP-R1-T10B8D - Source Product Evidence and Recommendation Continuity

Branch: `feat/cp-r1-t10b8d-source-product-evidence-recommendation-continuity`,
base `origin/develop` (contains the CP-R1-T10B8C merge, PR #82 / `633f6d3`).
No commit, push or PR was made for this task, in either pass.

## Correction (get_product_details continuity)

The first pass of this task shipped source product evidence for
`recommend_catalog_products` and `send_product_link` continuity, but
deliberately left `get_product_details` unguarded - documented at the time
under "Explicitly out of scope" with the rationale that the only reachable
gating design would have reversed an already-approved, tested behavior
(`"pendingCatalogAction: unrelated get_product_details failure does not
consume the pending action"`, `runAgentToolLoop.test.ts`).

A follow-up correction closed that gap properly: `get_product_details` is
now gated whenever - and only whenever - a recommendation-origin
`pendingCatalogAction` is active, using a **new, separate discriminator**
(`candidateProducts`) that never applies to the pre-existing, model-emitted
`send_product_link` mechanism. This resolved the apparent conflict: the
"unrelated" test's `pendingCatalogAction` never carries `candidateProducts`
(it's a plain `send_product_link` fixture), so the new gate never engages for
it and the test still passes completely unmodified. The complementary case
the correction task asked for (`"a related (candidate) get_product_details
failure consumes the pending action"`) is now covered by a new test.

Everything from the first pass (`resolveObservedRecommendationSourceProduct`,
sourceProduct evidence gating, blocked reasons, zero-HTTP-on-block,
anti-chaining, `recentCatalogContext` extension, visible-candidates-only
truncation, generic identity mode) is unchanged and re-verified below - none
of it was rewritten, only extended.

## Archivos modificados

Production code (7 files - 1 new in the first pass, 6 modified across both
passes):

- `lib/brain/commercial/agent-loop/resolveObservedRecommendationSourceProduct.ts`
  (new, first pass) - the pure sourceProduct evidence-resolution function.
  Unchanged in the correction pass.
- `lib/brain/commercial/agent-loop/agentStepTypes.ts` - first pass:
  `RECOMMENDATION_SOURCE_PRODUCT_BLOCKED_REASONS` /
  `RecommendationSourceProductBlockedReason`. **Correction pass**:
  `PendingCatalogActionStep` gained an optional `candidateProducts?:
  PendingCatalogActionCandidateProduct[]` field (variant-aware, runtime-only,
  never model-emitted); new `GET_PRODUCT_DETAILS_PENDING_CATALOG_BLOCKED_REASON
  = "product_not_in_pending_catalog_candidates"`.
- `lib/brain/commercial/agent-loop/buildToolObservation.ts` - first pass:
  exported the existing `MAX_RECOMMENDATIONS` constant. Unchanged in the
  correction pass.
- `lib/brain/commercial/agent-loop/recentCatalogContext.ts` - first pass:
  `sourceTool` union, `isCatalogTool()`, loader SQL, and
  `productsFromRecommendCatalogProducts(payload)`. Unchanged in the
  correction pass.
- `lib/brain/commercial/agent-loop/pendingCatalogAction.ts` - first pass:
  `collectAllowedProductIds` gained the `recommend_catalog_products` case
  (now `export`ed, reused by the correction pass's "otherwise evidenced"
  fallback too). **Correction pass**: `parsePendingCatalogAction` and a new
  `parseCandidateProducts` helper now parse/validate `candidateProducts`
  (bounded, cross-checked against `candidateProductIds`, backward compatible
  with payloads that lack it); new exported
  `matchesPendingCatalogActionCandidate` (variant-aware candidate matcher)
  and `buildPendingCatalogActionFromRecommendation` (builds a
  recommendation-origin `PendingCatalogActionStep` directly from a completed
  `recommend_catalog_products` `ToolObservation`).
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` - first pass:
  `processUseToolStep` gained the sourceProduct evidence-gate call for
  `recommend_catalog_products`. **Correction pass**: `processUseToolStep`
  gained a second gate, for `get_product_details`, active only when an
  `activeRecommendationPendingAction` is passed in; the gathering loop now
  tracks `activeRecommendationPendingAction`/`recommendationPendingActionConsumed`
  (renewed on every completed `recommend_catalog_products` result, consumed
  on a matching `get_product_details` completed/failed/blocked); a new
  private helper `collectNonRecommendationEvidenceProductIds` (the
  fallback evidence pool, deliberately excluding `recommend_catalog_products`
  observations - see "Variant matching" below for why); `respondedResult`
  now falls back to the still-active recommendation continuity only when the
  model's own `respond.pendingCatalogAction` is absent.
- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts` - first
  pass: `RECOMMEND_CATALOG_PRODUCTS_RULE_LINES` (2 lines). **Correction
  pass**: one additional line in the same array, telling the model
  `get_product_details` after a recommendation is only guaranteed for an
  observed candidate's exact `productId`/`combinationId`.
- `lib/brain/commercial/events/types.ts` (**correction pass, new touch**) -
  `AgentToolLoopPendingCatalogActionPayload` gained the same optional
  `candidateProducts` mirror field (local, no cross-module import, same
  convention already used for every other field in this file) so the
  persisted event payload's type honestly reflects what
  `recordAgentToolLoopCompletedCommercialEvent` actually persists.

Tests (6 files - 1 new in the first pass, 5 modified across both passes):

- `tests/agent-loop/resolveObservedRecommendationSourceProduct.test.ts`
  (new, first pass, 20 tests). Unchanged in the correction pass.
- `tests/agent-loop/recentCatalogContext.test.ts` (first pass: +7, 15 -> 22).
  Unchanged in the correction pass.
- `tests/agent-loop/pendingCatalogAction.test.ts` (first pass: +1, 14 -> 15.
  **Correction pass: +14, 15 -> 29**) - `buildPendingCatalogActionFromRecommendation`
  (completed/empty/skipped/failed/blocked/wrong-tool/dedup, never leaks
  score/rank/ownership), `matchesPendingCatalogActionCandidate` (exact,
  different product, exact/wrong/absent variant, candidate without variant
  matches any request), legacy-payload compatibility (loads with only
  `candidateProductIds`, loads `candidateProducts` when present, drops a
  `candidateProducts` entry whose `productId` isn't also in
  `candidateProductIds`).
- `tests/agent-loop/runAgentToolLoop.test.ts` (**correction pass: +8, 64 ->
  72**) - `get_product_details` continuity: matching candidate authorized +
  consumes on completion; non-candidate with no other evidence blocked
  before any HTTP call, action intact; exact `combinationId` match
  authorized; wrong `combinationId` blocked; a related (candidate) failure
  still consumes (the complementary case the correction explicitly asked
  for); a duplicate call to an already-consumed candidate never resurrects
  the action; another tool never consumes; a non-candidate backed by this
  turn's own `search_products` evidence is authorized but does not consume.
  The pre-existing "unrelated get_product_details failure does not consume
  the pending action" test is unchanged and still passes - see "Existing
  test compatibility" below.
- `tests/agent-loop/recommendCatalogProductsAgentLoopIntegration.test.ts`
  (first pass: +6, 12 -> 18. **Correction pass: +6, 18 -> 24**; also test
  14's assertion updated - see "Existing test compatibility") - (22) E2E
  cross-turn: a real recommendation creates `finalPendingCatalogAction`,
  a second `runAgentToolLoop` call loads it and authorizes+consumes
  `get_product_details` for the real candidate; (23) `get_product_details`
  for a non-candidate product blocked, zero HTTP to the detail endpoint,
  action intact; (24) variant-specific candidate: the exact `combinationId`
  is authorized, a different one is blocked, both via the real recommend
  response; (25) `identity_unresolved` gets the full continuity flow in
  generic mode; (26) an empty recommendation invalidates a prior active
  recommendation action; (27) the latest successful recommendation replaces
  prior candidates entirely, never merges.
- `tests/agent-loop/recommendCatalogProductsSkippedEventPersistence.test.ts`
  (first pass: 0 new tests, 1 existing test's input extended). Unchanged in
  the correction pass.

Docs (2 files, both updated in the correction pass):

- `docs/integrations/recommendation-source-evidence-and-continuity.md` -
  "Pending catalog action" split into `send_product_link` (unchanged) vs.
  `get_product_details` (new) subsections; "get_product_details
  authorization" rewritten from "not changed" to the full gating/variant/
  creation/renewal/consumption/precedence design; "Persistence"/"Backward
  compatibility"/"Feature flag"/"Explicitly out of scope" updated to match;
  "Concurrency" updated to list the new pure functions.
- `docs/releases/CP-R1-T10B8D-source-product-evidence-recommendation-continuity.md`
  (this file).

`docs/ACTIVE_RELEASE.md` and `docs/CAPABILITY_MATRIX.md` were **not**
touched in either pass - same precedent as every prior `CP-R1-T10B*` task in
this repo; they track the unrelated `ACS-R1-*` release line.

## Contract audit

Re-confirmed before any correction edit, per the correction task's own
required search list:

- **Where `use_tool` is processed**: `processUseToolStep`
  (`runAgentToolLoop.ts`) - the single function every governed tool call
  (including `get_product_details`) already routes through; unchanged
  location, extended in place.
- **How `get_product_details` execution is decided**: before this
  correction, unconditionally - `AGENT_LOOP_TOOL_POOL` membership +
  registry lookup + dedup check were the only gates, confirmed by reading
  `GET_PRODUCT_DETAILS_INPUT_SCHEMA`/`getProductDetailsCapability` in
  `registry.ts` (only `productId` required, no evidence check anywhere in
  that file).
- **What prior validations exist**: none evidence-based, confirmed by
  grepping every `get_product_details`-conditioned branch in
  `runAgentToolLoop.ts` before this correction - the only existing
  `get_product_details`-specific logic was `getPendingCatalogActionTerminalFailure`
  (a **post**-execution consumption check, never a pre-execution gate).
- **How a blocked `ToolObservation` is built**: the same generic literal
  `{tool, status:"blocked", errorCode}` every other governance/evidence
  block in `processUseToolStep` already returns (unregistered, duplicate,
  the first pass's `recommend_catalog_products` evidence block) - reused
  verbatim, no new shape.
- **How `finalPendingCatalogAction` is updated**: `respondedResult`
  (`runAgentToolLoop.ts`) - previously driven solely by the model's own
  `respond.pendingCatalogAction` (sanitized) plus the
  `pendingCatalogActionTerminalFailure` suppression flag; now also falls
  back to the runtime-tracked recommendation continuity when the model
  leaves its own field out - see "Pending action renewal"/"Consumption"
  below.
- **What consumes `pendingCatalogAction`**: `getPendingCatalogActionTerminalFailure`
  (unchanged, still the only consumer for the `send_product_link`
  mechanism, failed/blocked only) plus the new, separate consumption block
  for the recommendation mechanism (completed/failed/blocked, see
  "Consumption").
- **How `candidateProductIds`/`candidateProducts` are identified**:
  `candidateProductIds` unchanged (flat, `PendingCatalogActionStep`);
  `candidateProducts` is the new, optional, variant-aware mirror, built
  only by `buildPendingCatalogActionFromRecommendation` and consumed only
  by `matchesPendingCatalogActionCandidate`.
- **How `productId`/`combinationId` are normalized**: `get_product_details`
  arguments are already strings at the schema level
  (`GET_PRODUCT_DETAILS_INPUT_SCHEMA: {productId:"string", combinationId:
  "string"}`) - normalized via the same `asComparableProductId` helper
  already used elsewhere in `runAgentToolLoop.ts` (trim/finite-number-to-
  string), no new coercion.

## get_product_details gating

```
get_product_details requested
  -> registry/dedup checks (unchanged)
  -> activeRecommendationPendingAction present (and not yet consumed this turn)?
       no  -> unchanged, pre-existing, unconditioned authorization - proceeds
       yes -> does {productId, combinationId?} match a candidateProducts entry?
                yes -> authorized, proceeds (unchanged Gateway path)
                no  -> observed via this turn's own or recentCatalogContext's
                       search_products/get_product_details/explore_catalog
                       evidence (recommend_catalog_products excluded)?
                         yes -> still authorized, does not consume
                         no  -> { tool:"get_product_details", status:"blocked",
                                  errorCode:"product_not_in_pending_catalog_candidates" },
                                executed:false, zero HTTP, action left intact
```

`executed:false` on the new block means a blocked-by-continuity call never
consumes `maxToolExecutions` budget, the same treatment every other
rejected-before-real-work call in this function already receives.

## Existing test compatibility

The correction's central constraint, verified directly: `"pendingCatalogAction:
unrelated get_product_details failure does not consume the pending action"`
(`runAgentToolLoop.test.ts`) passes **completely unmodified** - its
`pendingCatalogAction: {actionType:"send_product_link", candidateProductIds:
["501"]}` fixture never sets `candidateProducts`, so
`activeRecommendationPendingAction` seeds to `null` for that test and the
entire new gate never engages; `get_product_details(777)` still executes
unconditionally and fails at the real (mocked-down) HTTP layer exactly as
before, `toolExecutionCount === 1` unchanged. The complementary case the
correction asked for - `"a related (candidate) get_product_details failure
consumes the pending action"` - is now a new, separate test using a fixture
that does carry `candidateProducts`.

Every other pre-existing `get_product_details` test in
`runAgentToolLoop.test.ts` (none of them pass a `pendingCatalogAction` with
`candidateProducts`) is likewise unaffected - confirmed by the full
`runAgentToolLoop.test.ts` suite passing 72/72 (64 pre-existing + 8 new),
zero pre-existing assertions changed.

## Variant matching

`matchesPendingCatalogActionCandidate` (`pendingCatalogAction.ts`): exact
`productId` match required; when the candidate carries a `combinationId`,
the request must match it exactly - a bare `productId` request (no
`combinationId` argument at all) never matches a variant-specific candidate
("no usar solo productId cuando existe informacion de variante"). When the
candidate has no `combinationId`, any requested `combinationId` (or none)
still matches - current catalog semantics, never a fabricated variant.

**Bug caught and fixed during this correction**: the "otherwise evidenced"
fallback (see "get_product_details gating" above) initially reused the
same `collectAllowedProductIds` pool used elsewhere in this file - which,
after the first pass, already includes `recommend_catalog_products`
observations. That let a *wrong-variant* request for an otherwise-recommended
product slip through the permissive, productId-only fallback, defeating the
strict `candidateProducts` variant check entirely (caught by test 24 in
`recommendCatalogProductsAgentLoopIntegration.test.ts`: "B/11 blocked" was
failing because the fallback found "200" via the recommendation's own
observation, no combinationId check applied). Fixed with a new, narrower
helper (`collectNonRecommendationEvidenceProductIds`) that filters
`recommend_catalog_products` out of both the historical
(`recentCatalogContext`) and live (`toolObservationsThisTurn`) evidence
sources before delegating to `collectAllowedProductIds` - independent
corroboration only, never the same recommendation circularly re-authorizing
a variant it didn't actually offer.

## Post-audit fixes (closure audit)

The closure audit for this task (external review, not part of either
implementation pass) flagged two Minor findings, both closed before commit.

### Minor 1: recentCatalogContext dedup key

`loadRecentCatalogContext`'s
cross-interaction dedup (`recentCatalogContext.ts`, pre-existing since
ACS-R1-05.1-T02.6) keyed solely on `productId`. Before this task,
`get_product_details` was the only source ever carrying `combinationId` into
`recentCatalogContext`, one product at a time, so a same-`productId` collision
across interactions was rare and low-consequence. `recommend_catalog_products`
now regularly contributes several `combinationId`-bearing candidates in the
same window, so the same collision could silently drop a genuinely observed
variant if a bare `productId` for the same product had already been claimed by
another (e.g. `explore_catalog`) interaction - a false negative that could make
`resolveObservedRecommendationSourceProduct` wrongly report
`source_product_variant_not_observed` (or `source_product_not_observed`) for a
variant the conversation did observe. Never an authorization bypass (the
failure mode is over-blocking, not under-blocking), but flagged as worth
closing before commit given recommendations now make the collision realistic.

Fixed by keying dedup on `productId`+`combinationId`
(`productDedupeKey`, `JSON.stringify([productId, combinationId ?? null])` -
collision-free, no custom separator to get wrong) instead of `productId`
alone. A bare-`productId` observation and a variant-specific one for the same
`productId` are now always kept as distinct entries; only a genuine repeat
(identical `productId` and `combinationId`) is still deduplicated, preserving
the original budget-saving intent. One pre-existing test's fixture/assertion
was updated to reflect the corrected semantics (with an in-line comment
explaining why, same precedent as test 14's update above), and two new tests
were added: a bare-vs-variant non-collision case, and a two-distinct-variants
case. `recentCatalogContext.test.ts`: 22 -> 24 (+2, one existing renamed/
updated in place). No production file outside `recentCatalogContext.ts` was
touched by this fix; `resolveObservedRecommendationSourceProduct.ts` and
`pendingCatalogAction.ts` are unaffected (they only consume whatever
`recentCatalogContext` already returns).

### Minor 2: dedicated immutability tests

T10B8D reads and derives new state from `recentCatalogContext` and
`pendingCatalogAction` - both sensitive, conversation-scoped evidence. Code
review already confirmed every new/touched function builds new
arrays/objects rather than mutating its parameters, but the audit flagged
that this was verified only by reading the implementation, never asserted by
a test - an accidental future mutation (e.g. someone reaching for `.push`
instead of spread during a later change) would have no regression test to
catch it. Closed with 8 new tests, all using `deepFreeze` (a small recursive
`Object.freeze` helper added to each test file) so any real mutation attempt
throws immediately (strict-mode ESM) instead of passing silently:

- `recentCatalogContext.test.ts` (+4, 24 -> 28): the rows supplied by the
  data access layer are never mutated; the original product objects inside
  a row's payload are never mutated; the result's `interactions`/`products`
  are new arrays/objects, never the same references as the input; dedup
  filtering (`productDedupeKey`) never mutates the raw per-interaction
  product arrays it filters.
- `pendingCatalogAction.test.ts` (+4, 29 -> 33): creation
  (`buildPendingCatalogActionFromRecommendation`) never mutates the input
  `ToolObservation`; a later, unrelated recommendation's action-building
  never mutates an earlier one's already-returned result (no shared mutable
  state across calls, i.e. renewal-safe); the consumption check
  (`matchesPendingCatalogActionCandidate`, called the same way
  `runAgentToolLoop.ts` calls it) never mutates `candidateProductIds` or
  `candidateProducts`; mutating a returned action's arrays/objects directly
  never alters the original observation fixture it was built from.

No production code changed for this fix - it is test-only, confirming
behavior already verified by reading `recentCatalogContext.ts` and
`pendingCatalogAction.ts`.

## Pending action creation

`pendingCatalogAction.ts#buildPendingCatalogActionFromRecommendation(observation)`:
returns a `PendingCatalogActionStep` (`candidateProductIds` + `candidateProducts`)
only when `observation.tool === "recommend_catalog_products"`,
`observation.status === "completed"`, and `data.recommendations` is a
non-empty array - the exact candidates already projected to the model by
`buildToolObservation.ts` (already capped at `MAX_RECOMMENDATIONS`, first
pass), never score/rank/ownership/personalization/raw response. `null` for
`skipped`/`failed`/`blocked`/empty/wrong-tool.

`runAgentToolLoop.ts`'s gathering loop calls this immediately after
`processUseToolStep` returns for a `recommend_catalog_products` step whose
observation is `"completed"`.

## Pending action renewal

"Latest successful recommendation wins" (`runAgentToolLoop.ts`, same
location as creation): a non-empty result **replaces**
`activeRecommendationPendingAction` entirely, never merges with whatever
candidates were active before - verified by test 27
(`recommendCatalogProductsAgentLoopIntegration.test.ts`): two recommendations
in one turn, the second's single candidate is the *only* one in
`finalPendingCatalogAction`, the first's candidate is gone.

## Empty policy

A `completed` recommendation with `recommendations: []` **invalidates** a
prior active recommendation `pendingCatalogAction`
(`recommendation_pending_catalog_action_invalidated_empty` warning) - the
latest vigent recommendation genuinely has no candidates, so an older,
superseded one must not linger. Verified by test 26. `skipped`/`failed`/
blocked-by-evidence results are handled conservatively: they never touch
`activeRecommendationPendingAction` either way (no new result to render
"latest", so a prior active one - if any - survives untouched) - the same
precedent this task's own consumption rule already uses for unrelated
requests.

## Consumption

Only for a `get_product_details` request that actually matched a
recommendation candidate: `completed`, `failed`, and `blocked` (governance,
e.g. duplicate-call) all consume it -
`recommendation_pending_catalog_action_consumed:<status>` warning, tracked
via a turn-scoped `recommendationPendingActionConsumed` flag that also
resets on every renewal. This is a genuinely new rule, not reused from
`send_product_link`'s: that mechanism's own
`getPendingCatalogActionTerminalFailure` only ever consumed on
failed/blocked (never completed - the model decides there via its own
`respond.pendingCatalogAction`). The recommendation mechanism always
auto-consumes on completed too, because the model has no way to explicitly
manage `candidateProducts` itself. "Producto no candidato" never consumes
(verified by tests 15/23/the `runAgentToolLoop.test.ts` non-candidate
cases); "otra tool" never consumes (verified by test); an already-consumed
action is never re-consumed (guarded by the flag, verified by the
duplicate-call test).

Independently, `getPendingCatalogActionTerminalFailure` (unchanged) may
*also* fire for the same call if `input.pendingCatalogAction` (the turn's
starting value) happens to be the same recommendation action and the
candidate is in its flat `candidateProductIds` - both mechanisms agree in
that case (redundant, never conflicting), since `candidateProducts`-bearing
actions still populate `candidateProductIds` identically for backward
compatibility.

## Persistence

Unchanged rule: `pendingCatalogAction` (either mechanism, either shape) is
durable only when `dispatch.outboxWritten === true`
(`runNativeAgentToolLoopCycle.ts`, not modified by this task in either
pass). `candidateProducts` round-trips through
`recordAgentToolLoopCompletedCommercialEvent` because
`normalizeAgentToolLoopCompletedCommercialEvent` (`events/normalize.ts`)
spreads `input.pendingCatalogAction` verbatim into the payload (never a
field-by-field repack that could silently drop it) - confirmed by reading
that function; `events/types.ts#AgentToolLoopPendingCatalogActionPayload`
was extended with the same optional field so the type honestly declares
what already flows through at runtime, rather than relying on an
undeclared-but-present field. No new table, column, `commercial_event`
type, cache, or outbox row in either pass.

## send_product_link compatibility

The pre-existing, model-emitted `send_product_link` mechanism is
**unmodified** by this correction: `getPendingCatalogActionTerminalFailure`,
`normalizePendingCatalogActionForEvidence`, and every one of its own
pre-existing tests are untouched and pass unchanged. The two mechanisms are
distinguished purely by the presence of `candidateProducts` - a
`send_product_link` action the model constructs on `respond` never carries
it (the model doesn't know the field exists), so it can never accidentally
trigger the new `get_product_details` gate. `respondedResult`'s final
precedence rule (model's own explicit field wins when present; recommendation
continuity is only the fallback when the model leaves it out) guarantees a
model that *does* choose to offer `send_product_link` continuity after a
recommendation is never overridden by the automatic mechanism.

## E2E continuity

`recommendCatalogProductsAgentLoopIntegration.test.ts`, real HTTP chain
throughout (no mocked `fetch`, no MariaDB):

- **Test 22** (cross-turn): turn 1 (`search_products -> recommend_catalog_products`)
  leaves `finalPendingCatalogAction` populated with the real candidate;
  turn 2 (`get_product_details`, `input.pendingCatalogAction` = turn 1's
  output) is authorized with zero new search and consumes the action on
  completion.
- **Test 23** (invented candidate blocked): after a real recommendation,
  `get_product_details` for a non-candidate productId is blocked, the
  detail endpoint receives zero HTTP requests, and the pending action stays
  intact for a future, correct attempt.
- **Test 24** (variant): a candidate with `combinationId` only authorizes
  the exact variant - the same productId with a different `combinationId`
  is blocked, zero HTTP.
- **Test 25** (`identity_unresolved`): the full
  `recommend_catalog_products -> get_product_details` continuity flow works
  identically in generic customer mode - never blocked, never handed off.

## Unit tests

`tests/agent-loop/pendingCatalogAction.test.ts` (+14, 15 -> 29):
`buildPendingCatalogActionFromRecommendation` (completed with candidates,
order preserved; never leaks score/rank/ownership/reasons; empty ->
`null`; skipped/failed/blocked -> `null`; wrong tool -> `null`;
deduplicates repeated productIds), `matchesPendingCatalogActionCandidate`
(exact match; different productId; exact/wrong/absent-request variant on a
variant-bearing candidate; variant-less candidate matches any request),
legacy compatibility (an event with only `candidateProductIds` still loads,
no `candidateProducts` key present on the result; an event with
`candidateProducts` loads it, `combinationId` preserved; a
`candidateProducts` entry whose `productId` is absent from
`candidateProductIds` is dropped defensively).

`tests/agent-loop/runAgentToolLoop.test.ts` (+8, 64 -> 72): see "Existing
test compatibility" above for the full list.

## Integration tests

`tests/agent-loop/recommendCatalogProductsAgentLoopIntegration.test.ts`
(+6, 18 -> 24; +1 existing test's assertion corrected - see below): see
"E2E continuity" above for tests 22/23/24/25; test 26 (empty invalidates)
and test 27 (renewal/latest-wins) covered under "Empty policy"/"Pending
action renewal".

Test 14 (`"recommend_catalog_products never introduces or mutates
pendingCatalogAction continuity"`) documented the exact first-pass gap this
correction closes - its assertion (`finalPendingCatalogAction === null`
after a completed recommendation) is now factually false by design, so it
was renamed and its assertion updated to the corrected, intended behavior
(`finalPendingCatalogAction` now deep-equals the recommendation's
candidate). This is a `git diff`-visible, explicitly reported test-behavior
change, not a silent one - every other assertion in that test is otherwise
unchanged.

## Full-suite baseline

`npm test` (`tests/**/*.test.ts`), same worktree/environment, run on this
branch (correction pass complete) vs. the unmodified `origin/develop` base
commit (`633f6d3`, via `git stash`/`git stash pop` around this task's own
changes, same `node_modules`, same machine):

| | `origin/develop` (`633f6d3`) | this branch (corrected) |
|---|---|---|
| tests | 2506 | 2568 |
| pass | 2033 | 2095 |
| fail | 473 | 473 |

`2506 + 62 = 2568` and `2033 + 62 = 2095` exact - 34 from the first pass (20
+ 7 + 1 + 6 + 0) plus 28 from this correction (14 + 8 + 6), all 62 new tests
pass (62/62, 0 new fails). The fail count is identical: 473 = 473. Confirmed
with more than a count match - the full list of failing test names was
diffed between both runs (sorted, deduplicated `✖ <test name>` lines):
**empty diff**, the exact same 473 tests fail on both branches, for the
same reason (`ECONNREFUSED 127.0.0.1:3306` - no local MariaDB in this
environment). None of the 62 new tests (first pass + correction) require
MariaDB - confirmed absent from the failure diff.

Directed suites (each run in isolation), all green except the same 4
pre-existing MariaDB-dependent failures in `pendingCatalogAction.test.ts`
(`ECONNREFUSED`, byte-for-byte identical to `origin/develop`) and the same 4
in `runNativeAgentToolLoopCycleConfig.test.ts` (`[W6]`-`[W9]`, also
pre-existing `ECONNREFUSED`, unrelated to this task - that suite persists
through the real DB-backed outbox path):
`resolveObservedRecommendationSourceProduct.test.ts` (20/20),
`recentCatalogContext.test.ts` (22/22), `pendingCatalogAction.test.ts`
(25/29), `runAgentToolLoop.test.ts` (72/72),
`buildAgentStepPromptPackage.test.ts` (35/35),
`recommendCatalogProductsAgentLoopIntegration.test.ts` (24/24),
`recommendCatalogProductsSkippedEventPersistence.test.ts` (2/2),
`recommendCatalogProductsToolExposure.test.ts` (unmodified, 31/31),
`catalogRecommendationGatewayAdapter.test.ts` (unmodified, 89/89),
`catalogRecommendationGatewayAdapterIntegration.test.ts` (unmodified,
20/20), `runNativeAgentToolLoopCycleConfig.test.ts` (5/9, 4 pre-existing DB
failures).

### Post-audit baseline (both Minor fixes applied)

`npm test`, same branch, after the two closure-audit fixes above (+2
`recentCatalogContext.test.ts` for Minor 1, +8 across both files for Minor
2 - 10 new tests total):

| | before (this doc's original baseline) | after (post-audit fixes) |
|---|---|---|
| tests | 2568 | 2578 |
| pass | 2095 | 2105 |
| fail | 473 | 473 |

`2568 + 10 = 2578` and `2095 + 10 = 2105` exact, fail count unchanged
(473 = 473, same failing test files as before - re-checked by file name,
none of them in any T10B8D-related test file). Directed re-run:
`recentCatalogContext.test.ts` 28/28 (24 + 4 new), `pendingCatalogAction.test.ts`
33/33 minus the same 4 pre-existing MariaDB failures (29/33). `npx tsc
--noEmit`, `npm run lint` (0 errors, same 34 warnings), and `npm run build`
all re-run clean after both fixes.

## Typecheck

`npx tsc --noEmit` - clean, zero errors, both before and after the variant-
matching bug fix.

## Lint

`npm run lint` - 0 errors, 34 pre-existing warnings, in files this task
never touched (same set/count as the first pass and as `CP-R1-T10B8C`'s own
documented baseline).

## Build

`npm run build` - clean, exit code 0.

## Documentation

- `docs/integrations/recommendation-source-evidence-and-continuity.md` -
  see "Archivos modificados" above for the exact sections rewritten.
- This document - added the "Correction" section, updated "Archivos
  modificados", replaced "get_product_details authorization" with the full
  design (now under several dedicated headers matching this correction
  task's required result structure), added "send_product_link
  compatibility", updated every test-count/baseline number, updated
  "Risks".

## Risks

- **The variant-matching fallback bug** (see "Variant matching" above) was
  caught by this correction's own new test coverage before being reported
  here as fixed, not left latent - included for transparency about the
  implementation path, since it reflects a real, non-obvious interaction
  between the first pass's evidence-pool extension and this pass's stricter
  variant check.
- `PendingCatalogActionStep.candidateProducts` is optional and additive -
  every consumer that doesn't know about it (the model, legacy persisted
  events, `send_product_link`'s own sanitizer) is unaffected; verified by
  the full pre-existing suite passing unchanged plus dedicated legacy-
  payload tests.
- `events/types.ts#AgentToolLoopPendingCatalogActionPayload` gaining
  `candidateProducts` is the same additive, backward-compatible mirror-union
  widening pattern already used for `"skipped"` in T10B8C - no exhaustive
  switch over this type exists anywhere in the codebase (confirmed by grep
  before editing).
- `processUseToolStep`'s continuity parameter grew one field
  (`activeRecommendationPendingAction`) - private, module-internal function,
  one call site, verified by `tsc`.
- Two new, small, private helpers in `runAgentToolLoop.ts`
  (`collectNonRecommendationEvidenceProductIds`,
  the recommendation renewal/consumption tracking block) are not exported -
  no new public surface beyond the `PendingCatalogActionStep`/`ToolObservation`
  type changes and the two new exported `pendingCatalogAction.ts` functions.

## Next task

`CP-R1-T10B8E` - Recommendation Tool Policy and Commercial Prompt.

## Confirmaciones

- No commit was made (either pass).
- No push was made (either pass).
- No PR was created (either pass).
- No Git configuration was changed (either pass).
- Work happened in the same clean, separate worktree throughout - the
  contaminated primary checkout (T12B/T12C files) was never touched, reset,
  stashed, or included in either pass (a temporary local `git stash`/`git
  stash pop` cycle was used only inside this task's own isolated worktree,
  solely to obtain a clean `origin/develop` baseline test run for
  comparison - restored immediately after, confirmed via `git status
  --short` showing the exact same modified/untracked file set before and
  after the pop).
- No T12B/T12C file appears in this branch's diff (verified:
  `git diff --name-status origin/develop` (12 files) plus `git ls-files
  --others --exclude-standard` (4 files) list exactly the 16 files named
  above under "Archivos modificados", nothing else).
- T10B5, T10B6, T10B7, T10B8A, T10B8B, T10B8C were not modified.
- Catalog Service was not called or modified - all new/updated tests use a
  local `node:http` fixture server or pure function calls.
- Customer Profile was never called by anything this task added.
- `BRAIN_AGENT_TOOL_LOOP_ENABLED` was not touched and was never set to
  `true` during this work.
- `get_product_details` was never called automatically by anything this
  task added - the model still decides, in every test, including every new
  continuity test.
- No candidate was ever selected by code - every test drives model
  decisions through a scripted provider; the runtime only authorizes or
  blocks what the model itself requests, never chooses on its behalf.
- Ranking was not altered - `buildToolObservation.ts`'s projection and
  ordering are unchanged in both passes.
- No parallel persistence mechanism was created - `recentCatalogContext`
  and `pendingCatalogAction` remain the only two evidence/continuity
  stores, both extended, never duplicated.
- The bot was never blocked globally - every blocked observation (both the
  first pass's `recommend_catalog_products` evidence block and this pass's
  `get_product_details` continuity block) is scoped to that single tool
  call; the loop continues normally afterward (verified:
  `terminalReason: "responded"` in every blocked test).
- `identity.customerId` was never used as `masterCustomerId` - neither
  gating function takes identity/session input at all.
