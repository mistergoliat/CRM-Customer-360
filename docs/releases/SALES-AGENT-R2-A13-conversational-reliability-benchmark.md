# SALES-AGENT-R2-A13 - Conversational Reliability Benchmark

## Verdict

`A13_BASELINE_RELIABILITY_NEEDS_FIXES`

16 of 22 scenario checks pass against the current `develop` HEAD (73%). The 6 failures are all
genuine, independently confirmed defects in the CommercialWork R2 runtime - none are artifacts of
this benchmark's own harness (every harness-side false positive found while building this benchmark
was root-caused and fixed before this baseline was taken; see Part 6). None reach P0 (no defect
produces an incorrect mutation or a wrong price/product actually written to durable state or shown
to the customer as fact). Five reach P1 (broken commercial state, duplicate customer-facing dispatch,
or a customer-visible stall/repeated question); one is P2.

**No new commercial feature was added by this task.** This release is exclusively a benchmark
(fixtures + a test file + this document) built entirely from already-existing production code and
already-existing test infrastructure. No file under `lib/` was modified.

## 0. Scope discipline

Per the task's explicit constraints, this pass:

- Did **not** fix any of the 6 confirmed defects. Each failing test asserts the CORRECT expected
  behavior and is left failing on purpose, with an inline `FINDING` comment naming severity, root
  cause, and evidence.
- Did **not** touch legacy code, quote architecture, runtime ownership, or add omnichannel behavior.
- Did **not** mask any failure with a permissive fallback or a weakened assertion.
- Did **not** modify any file under `lib/`, `app/`, or any migration.

Files added:

- `tests/commercial/fixtures/a13-conversational-reliability-scenarios.ts` - pure data (invariant/
  category vocabulary, a scenario manifest cross-referencing every test to its category and the
  invariants it covers, reusable planner-script/identity fixtures).
- `tests/commercial/a13ConversationalReliabilityBenchmark.test.ts` - the benchmark runner and all 22
  scenario checks, built entirely on existing test infrastructure (see Part 3).
- This document.

## 1. Canonical entry point (task requirement 1)

The canonical entry point for CommercialWork (R2) inbound execution is
[runCommercialWorkInboundCycle.ts](../../lib/brain/commercial/work/runCommercialWorkInboundCycle.ts).
It is reached from `runNativeAutonomousCycle.ts` only when `shouldRouteToCommercialWork(waId)`
(`commercialCycleConfig.ts`) is true for the inbound `wa_id` - never a second, parallel commercial
pipeline for the same turn. This audit confirms (unchanged from A08.5/A11 audits) that it remains the
single, real production entry point: one semantic-planning LLM call, then durable
CommercialWork create/reconcile, then real Capability Gateway execution, then a grounded
FINAL/PARTIAL/BLOCKED customer reply - every failure path resolves to its own controlled dispatch
rather than throwing or falling through to the legacy Agent Tool Loop.

## 2. Planner -> objective -> step -> Capability Gateway -> projection -> finalizer flow (task requirement 2)

Traced directly from `runCommercialWorkInboundCycle.ts`, in call order:

1. **Sequencing** (`sequencing.ts#assignCommercialTriggerSequence`) - assigns or reuses a
   per-conversation `commercialSequence` keyed by `triggerDedupeKey = commercial-work:{conversationId}:{inboundMessageId}`.
   This is a real, working dedupe key at the sequencing layer - but see Part 4.1: nothing downstream
   ever consults it to short-circuit a redelivered message once the prior work has gone terminal.
2. **Semantic planning** (`semanticIntentAdapter.ts#planCommercialObjectiveSeeds`) - the one real LLM
   call. Wraps `multi-intent/buildIntentPlannerPromptPackage.ts` (prompt), `parseCommercialIntentPlan.ts`
   (hand-rolled bounded parsing of the raw JSON plan - malformed/empty degrades to a parse failure,
   an unrecognized intent type degrades to `unsupported`, never a technical error), and
   `requirementResolver.ts` (deterministic, no LLM, resolves PRODUCT/QUANTITY/DESTINATION/
   PRODUCT_SELECTION/SHIPPING_OPTION from `RecentCatalogContext` or durable-state fallbacks present in
   the CALLER-supplied `commercialContextSummary` - see Part 6.1 for a real gap this exposed).
   `commercialObjectiveSeedsFromResolvedIntent` maps each resolved intent to one or more
   `CommercialObjectiveSeed`s.
3. **Reconciliation** (`reconciliation.ts#reconcileCommercialTrigger`) -
   `resolveCommercialWorkTarget` decides create-vs-update by looking up the conversation's current
   work via `repository.ts#findActiveCommercialWorks`. **This lookup's own status filter
   (`ACTIVE_WORK_STATUSES = ["ACTIVE","WAITING_CUSTOMER","WAITING_SYSTEM","HANDOFF","FAILED"]`)
   excludes `COMPLETED`/`CANCELLED`/`SUPERSEDED`** - see Part 4.1, the single most consequential
   finding of this benchmark. `reconcileCommercialObjectives` merges any carried (non-cancelled/
   non-superseded) objectives from the found previous work with this turn's new semantic seeds.
4. **Projection** (`buildCommercialWorkProjection.ts`) - the pure projector. Per-objective-type
   `applyObjectiveState` switch, real dependency/evidence/staleness checks against durable facts
   (`commercialLineItems`/`shippingDestination`/`selectedShippingOption`/`createdQuote`, all passed in
   by the caller - see Part 6.1 on where these come from), the identity gate
   (`commercialIdentityGate.ts#applyCommercialIdentityGate`, gates a `READY` objective against
   `RuntimeIdentityContext`), and cross-family invalidation (`applyPendingMutationInvalidations`).
   `deriveCommercialWorkSteps.ts` derives one or more `CommercialWorkStep`s per objective
   (2-step search-then-select/calculate-then-select chains for `SELECT_PRODUCTS`/
   `SELECT_SHIPPING_OPTION` when fresh evidence must be gathered first).
5. **Execution** (`commercialWorkExecutor.ts#executeCommercialWork`) - selects `READY` steps,
   dispatches each through the real Capability Gateway (`executeGovernedCapability`, no schema
   validation of its own - the `inputSchema` field on a capability definition is documentation only,
   never enforced by the generic wrapper), persists one `crm_capability_executions` row per real
   dispatch, applies `stepRecordFromGateway`'s gateway-status-to-step-status mapping, schedules
   `RETRY_SCHEDULED` on a retryable technical failure.
6. **Settle loop** (`settleCommercialWorkProjection.ts`) - up to 3 rounds per turn: reproject with
   FRESH durable facts (re-read from the DB every round, unlike step 4's very first pass) -> persist if
   changed -> execute any newly-`READY` step -> repeat. This is what lets a same-turn cascade (e.g. "select
   this AND quote it") converge without a second customer turn - and also the loop that a
   correction+shipping interaction can fail to converge within, see Part 4.3.
7. **Finalizer** (`buildCommercialWorkFinalizerMessage.ts`) - a pure, evidence-grounded FINAL/PARTIAL/
   BLOCKED message. Confirmed never invents a catalog product name or price beyond
   `objective.inputs.productReference`/`quantity` - a real, structural guarantee this benchmark relied
   on directly for its NO_FALSE_PRODUCT/NO_FALSE_PRICE checks.
8. **Dispatch** (`dispatchCommercialWorkResponse.ts`) - `persistAgentAction` (idempotency key =
   `commercial-work:{conversationId}:{inboundMessageId}:{work.publicId}:{work.version}` - see Part 4.1
   on why this key fails to dedupe a redelivered message once the work's `publicId` has changed) ->
   sandbox autonomy evaluation -> `executeActionThroughGate` (the real outbox writer).
9. **Follow-up** (`followup/objectiveAwareFollowUp.ts`) - scheduled only when the turn ends
   `WAITING_CUSTOMER`, reusing the existing A07 mechanism unchanged.

Worker-side recovery (`worker/commercialWorkWorker.ts#runCommercialWorkTick`) is a separate, real
production entry point (not `runCommercialWorkInboundCycle`) for `RETRY_SCHEDULED`/`WAITING_SYSTEM`
work - see Part 4.5 for a real candidate-selection defect found there.

## 3. Existing test infrastructure reused (task requirement 3)

No new test scaffolding was built from scratch. This benchmark drives the SAME production entry
point the newest CommercialWork E2E tests already use, and reuses their exact fixtures/patterns:

- `lib/brain/commercial/work/benchmark/environment.ts#setupR2BenchmarkEnvironment`/
  `seedBenchmarkSelection`/`seedBenchmarkShippingDestination`/`setConversationControl` - the real
  MariaDB `crm_test`-backed fixture environment (fresh conversation/master_customer/opportunity rows,
  fake Carrier MS, real domain-layer writes).
- `lib/brain/commercial/work/benchmark/offlinePlannerProvider.ts#createOfflinePlannerProvider` - the
  deterministic, no-live-LLM planner provider every CommercialWork E2E test in this codebase already
  uses.
- Identity/session fixture patterns (`buildRuntimeIdentity`/`runtimeIdentityAtLevel`/
  `customerSessionDecision`/`buildTrustedSession`) copied from the established pattern in
  `repeatPurchaseE2E.test.ts`/`customerAwareRecommendationE2E.test.ts`.
- `resetCapabilityGatewayCatalogPortForTests` (`capability-gateway/registry.ts`) - the same env-var-driven
  catalog port reset `setupBenchmarkEnvironment` already uses, reused here to point at a small
  additional local HTTP fixture server (see Part 6.2 - the ONE genuinely new piece of test
  infrastructure, needed because the shared fixture's own `resolve-product-intent` endpoint is
  deliberately query-agnostic and cannot produce a `resolved`/`no_match` distinction by query text).
- `runCommercialWorkTick`/`getCommercialWorkByPublicId` (`lib/brain/commercial/work`) - the real
  production retry worker, invoked exactly like `commercialWorkRetryWorker.test.ts` already does
  (`isWaIdEligibleForCommercialWork: () => true`, worker gates open).

The only net-new infrastructure is a ~120-line local HTTP fixture server (query-text-routable
`resolve-product-intent` responses) and a `commercialLineItems`/`shippingDestination` snapshot-sync
helper - both are test-only, additive, and documented in Part 6.

## 4. Failure taxonomy and root-cause grouping

Five distinct root causes explain all 6 failing checks. Grouped by root cause, most architecturally
significant first.

### 4.1 Terminal-work lineage gap (P1) - `A13-11`, `A13-19`

**Root cause**: `repository.ts#findActiveCommercialWorks`'s own status filter
(`ACTIVE_WORK_STATUSES = ["ACTIVE","WAITING_CUSTOMER","WAITING_SYSTEM","HANDOFF","FAILED"]`) excludes
`COMPLETED`/`CANCELLED`/`SUPERSEDED`. `reconciliation.ts#resolveCommercialWorkTarget` is the ONLY
caller of that lookup and has no other way to find the conversation's most recent work. The result:
**once a CommercialWork fully completes (an everyday, fast outcome for any simple, fully-resolved
request - not a rare edge case), no later trigger for that conversation can ever find it again.**
`resolveCommercialWorkTarget` returns `{action:"create", previousWork:null, reason:"no_work"}` -
never `reason:"terminal_work"` (that branch is dead code for these three statuses; it is only ever
reachable for the two terminal statuses `ACTIVE_WORK_STATUSES` does happen to include, `HANDOFF` and
`FAILED`). Confirmed directly, not inferred: `previousWorkPublicId`/`supersedesWorkPublicId` are both
`NULL` in the DB row of a work opened this way, and a controlled experiment using numeric
(message-id-bearing) `inboundMessageId`s across two turns proved that objects which visually looked
"carried forward" in an earlier draft of this benchmark were in fact freshly re-derived with the
LATER turn's own message id, not the earlier one's.

Two concrete, customer-visible consequences:

- **`A13-19` (duplicate_inbound)**: an exact webhook redelivery of the same `inboundMessageId`,
  arriving after the original turn's work already completed, is treated identically to a brand-new
  customer message. `dispatchCommercialWorkResponse.ts`'s own idempotency key
  (`commercial-work:{conversationId}:{inboundMessageId}:{work.publicId}:{work.version}`) cannot catch
  this either, because the new work has a different `publicId`. Result: a SECOND real
  `crm_agent_actions` row and a SECOND outbox message are created, resending the exact same
  confirmation to the customer. Confirmed with two real `crm_agent_actions` rows, two distinct
  `outbox_message_id`s, identical `draft_message` text.
- **`A13-11` (cancellation)**: a customer's "cancel my selection," arriving after the selection's own
  work already completed, opens a brand-new, empty work with nothing to cancel. The durable
  `commercial_line_items` row is never touched (confirmed: still present, unchanged, after the
  "cancellation"), and the finalizer falls through to a generic "your request is complete" message -
  the customer is told nothing went wrong while their product remains fully selected.

`sequencing.ts#assignCommercialTriggerSequence`'s own dedupe key correctly recognizes a redelivered
`inboundMessageId` (returns the same `commercialSequence` both times) - that signal exists and is
correct, it is simply never consulted by `resolveCommercialWorkTarget`/`dispatchCommercialWorkResponse`
to short-circuit before a second work/dispatch is created.

### 4.2 Carried-objective status conflation across the identity gate (P1) - `A13-09`

**Root cause**: `buildCommercialWorkProjection.ts`'s `stillWaitingOnCustomer(carriedStatus)` helper
(used by `SELECT_PRODUCTS`/`CHANGE_QUANTITY`/`SET_DESTINATION`/`GET_SHIPPING_QUOTE`/
`SELECT_SHIPPING_OPTION`/`CREATE_QUOTE`) exists to avoid silently re-asking a question the CAPABILITY
itself already asked last round. It only inspects the carried `status` field
(`carriedStatus === "WAITING_CUSTOMER"`), which cannot distinguish that case from a `WAITING_CUSTOMER`
imposed by `commercialIdentityGate.ts#applyCommercialIdentityGate` - a DIFFERENT mechanism that runs
AFTER `applyObjectiveState` and only ever reconsiders an objective currently `READY`. Once an
objective is carried forward with `carriedStatus:"WAITING_CUSTOMER"` from an identity block,
`applyObjectiveState` re-applies `WAITING_CUSTOMER` unconditionally, so the objective never reaches
`READY` again - and the identity gate, which only inspects `READY` objectives, never gets a chance to
let it through even after identity is genuinely upgraded to sufficient.

Confirmed: a `CREATE_QUOTE` objective blocked at LEVEL_0 (anonymous), then re-visited on a later turn
with identity upgraded to LEVEL_2 (sufficient) and a bare "I've identified myself" message (no
repeated `create_quote` intent), never resumes - `create_quote` is dispatched zero times. The SAME
scenario in `repeatPurchaseE2E.test.ts`/this benchmark's own `A13-06` works only because each turn
RE-STATES the same explicit intent (`repeat_purchase`) verbatim - a fresh same-type semantic seed
supersedes the carried one, producing a clean `carriedStatus:undefined`. **A bare confirmation - the
realistic, minimal thing a customer says after finishing identification - can never resume a stalled
request.** Customer-visible impact: the bot keeps behaving as if identity is still missing (repeated
requests for information already given), directly violating NO_REPEATED_QUESTION.

### 4.3 Product-change / same-family invalidation round-budget interaction (P1) - `A13-05`

**Root cause not fully pinpointed** (see Part 5 for the recommended follow-up). Confirmed
reproducible: within a still-open (non-terminal) work that already has a real, `COMPLETED`
`GET_SHIPPING_QUOTE` alongside a `COMPLETED` `SELECT_PRODUCTS`, a same-turn correction that renames
the product (a fresh `SELECT_PRODUCTS` seed for a different product, requiring its own
`SEARCH_PRODUCTS -> SELECT_PRODUCTS` two-hop resolution) can leave the new `SELECT_PRODUCTS` objective
stuck `BLOCKED` with a genuinely `completed` `SEARCH_PRODUCTS` step behind it never applied (`items`
never populated, `select_products` never dispatched for the new product) - the product change
silently never takes effect - while `GET_SHIPPING_QUOTE` still reaches `COMPLETED`, carrying
duplicated/stale blocker codes (`MISSING_SELECTION` appears twice, alongside `STALE_EVIDENCE`, never
cleared once resolved) from an earlier round. Customer-visible impact: the customer is told their
request completed while their product change was silently dropped, and there is no way to verify from
the finalizer's own evidence whether the shown shipping figure is for the product they actually asked
for last. Directly threatens OBJECTIVE_CORRECT, NO_CONTEXT_LOSS, and NO_FALSE_PRICE.

The stale/duplicated blocker-array symptom (append-only `missingRequirements`/`blockers` arrays that
are never cleared once a later round resolves the underlying condition) was independently observed on
other objective types during this benchmark's construction (e.g. a `CREATE_QUOTE` objective reaching
`READY` while still carrying a stale `MISSING_SELECTION` blocker from an earlier round) and is likely
a contributing factor here, though not proven as the sole cause.

### 4.4 Shipping-option `optionIndex` type coercion (P1) - `A13-10b`

**Root cause pinpointed precisely, exact location not identified further** (baseline-only scope).
`resolveObservedShippingOption.ts`'s validation (`typeof input.optionIndex === "number" &&
Number.isInteger(...) && input.optionIndex >= 0`) is strict by design - and correctly so, since it is
the ONLY evidence gate standing between a customer's raw reference and a real, persisted shipping
selection. Direct, isolated reproduction: calling it with `optionIndex: 0` (a real number) against a
real, freshly-persisted `calculate_shipping` execution resolves correctly; calling it with
`optionIndex: "0"` (the identical value as a STRING) against the SAME row is wrongly rejected as
`shipping_option_index_out_of_range`. The value is set as a genuine number in
`buildCommercialWorkProjection.ts` (`objective.inputs.optionIndex = match.index`, where `match.index`
is a `number`-typed field), so the coercion happens somewhere in `CommercialWork`'s own step
persistence/reload path (`commercialWorkExecutor.ts`'s `buildGatewayInput` reads `step.input.optionIndex`
back from a `PersistedCommercialWork` that may have round-tripped through the `crm_commercial_work_steps.input_json`
column at least once) - not pinpointed to an exact line per this pass's scope. This benchmark's own
`A13-10` (the clean two-turn "quote then select" happy path) does NOT currently trigger it, because
that scenario's `SELECT_SHIPPING_OPTION` step happens to resolve and dispatch within the same settle
round it was computed, entirely in-memory, before any DB round-trip. `stepRecordFromGateway`'s own
code comment explicitly assumes this specific error code "should never happen if the projection layer
did its job" and maps it to the TERMINAL `failed` status rather than A11.4's self-healing `blocked`
path (reserved for genuine stale evidence) - so whenever this does trigger, it dead-ends the
CommercialWork with no recovery.

### 4.5 Retry-worker candidate selection ignores step dependency ordering (P2) - `A13-21`

**Root cause not fully pinpointed** (baseline-only scope; the defect is in the worker's own
candidate-selection/claim logic in `worker/commercialWorkWorker.ts`, not traced to an exact line).
Confirmed via a real Catalog outage + recovery + retry-tick sequence: when a tick is given a work with
both a due `RETRY_SCHEDULED` step (`SEARCH_PRODUCTS`, `nextAttemptAt` in the past) and its OWN
dependent step (`SELECT_PRODUCTS`, whose only dependency is `STEP_COMPLETED` on `SEARCH_PRODUCTS`,
still showing `READY` even though its dependency was never satisfied - a status inconsistency in its
own right), the tick's candidate selection **claims and runs the dependent step instead of the step
that was actually due**. The tick's own result reports `SEARCH_PRODUCTS` as skipped with reason
`"already_claimed"`; `SELECT_PRODUCTS` transitions to `RUNNING` (`attemptCount` incremented) with
`tickResult.executed` staying `0` (no capability was actually dispatched either way this tick).
`SEARCH_PRODUCTS` itself is left exactly as it was - the due retry never actually ran. Classified P2
rather than P1: the codebase has an independent, already-tested stale-`RUNNING` recovery mechanism
(`commercialWorkRetryWorker.test.ts`'s `CWRT05-08`, unaffected by this benchmark) that would likely
eventually reclaim a step stuck this way after its lock expires - this is a scheduling-correctness/
efficiency defect that delays recovery rather than one that silently produces a wrong customer-visible
outcome. It does, however, directly break the "system-owned block recovers via the retry worker with
zero customer input" invariant this scenario category exists to validate, for a two-step dependency
chain specifically.

## 5. P0/P1/P2/P3 list

| Severity | Scenario | Summary |
|---|---|---|
| P0 | - | None found. No defect in this baseline produces an incorrect mutation, or presents a fabricated/wrong product or price as fact. |
| P1 | `A13-19` (duplicate_inbound) | Root cause 4.1. A redelivered webhook resends the same customer-facing confirmation a second time via a genuinely new work + dispatch. |
| P1 | `A13-11` (cancellation) | Root cause 4.1. Cancelling a request whose originating work already completed is a silent no-op - durable selection untouched, generic "complete" message shown. |
| P1 | `A13-05` (product_changes) | Root cause 4.3. A same-turn product-change correction, alongside an active same-family shipping quote, can leave the new selection permanently unapplied while the work reports success. |
| P1 | `A13-10b` (shipping_lookup_selection, latent) | Root cause 4.4. `optionIndex` can reach `select_shipping_option`'s evidence gate as a string, wrongly rejecting a genuinely valid, fresh option and terminally failing the work. |
| P1 | `A13-09` (onboarding_resume) | Root cause 4.2. An identity-gated objective (any type using `stillWaitingOnCustomer`) never resumes on a bare confirmation after identity is upgraded - repeats the identity request forever for that stalled work. |
| P2 | `A13-21` (waiting_system_recovery) | Root cause 4.5. The retry worker can claim/run a dependent step ahead of the step it depends on, skipping the actually-due retry for that tick. |
| P3 | - | None found as a standalone item this pass (the closest candidate, stale/duplicated blocker-array entries noted in 4.3, is folded into that P1 as a contributing symptom rather than reported separately). |

## 6. Known environment limitations

- **No live LLM anywhere in this benchmark.** Every scenario uses `createOfflinePlannerProvider`
  (deterministic, scripted `CommercialIntentPlan` output) - matching every other CommercialWork E2E
  test in this codebase. A live-LLM layer was explicitly out of scope for this pass (task instruction
  8: "Add live-LLM tests only as a separate benchmark layer").
- **No live Catalog Service, Quote Service, or Customer Profile service reachable in this sandbox** -
  matches every prior A-phase benchmark in this codebase (A07.5, A10, A11, A12). `create_quote` scenarios
  correctly reach a real, observable `temporarily_blocked`/`quote_service_not_configured` outcome, never
  a fabricated success. `get_customer_purchase_history`/`get_customer_recommendation_signal` correctly
  reach a real `customer_profile_unavailable` outcome (A13-06/A13-07/A13-16).
- **No live WhatsApp path exercised** - `dispatchCommercialWorkResponse`'s own outbox write is
  exercised for real (a genuine `crm_agent_actions`/outbox row), but no real Meta Cloud API send.
- **6.1 A real, reusable test-harness lesson, not a product defect**: `runCommercialWorkInboundCycle.ts`'s
  very FIRST projection pass (inside `reconcileCommercialTrigger`) uses the caller-supplied
  `snapshot.commercialLineItems`/`shippingDestination` verbatim - never a fresh DB read (only
  `settleCommercialWorkProjection`'s later rounds refetch real durable facts directly). A snapshot that
  omits a durable selection/destination seeded directly via `seedBenchmarkSelection`/a prior real turn
  (bypassing the snapshot entirely) is a test-harness inconsistency real production never has
  (`buildNativeCommercialContext` always builds the snapshot from the same durable state each turn).
  Left unsynced, this can make the semantic planner treat an already-fully-resolved intent as still
  "waiting_for_information," causing it to be persisted as a "pending commercial intent" and
  re-surfaced as a spurious extra objective on the very next turn - confirmed and then eliminated (via
  `durableStateSnapshotOverride` in the final test file) as the cause of several early false positives
  during this benchmark's construction. This is recorded here so a future test author does not
  re-discover it the hard way.
- **6.2 One small piece of net-new test infrastructure**: the shared benchmark fixture's own
  `/api/v2/catalog/resolve-product-intent` HTTP handler (`agent-loop/benchmark/environment.ts`) is
  deliberately query-agnostic (always both fixture products, always `clarification_required`) - correct
  for its original purpose, but unable to produce a `resolved`/`no_match` distinction by query text,
  which several required scenario categories (`product_search_and_selection`, `no_results`) need. This
  benchmark adds one small (~120 line), query-text-routable local HTTP server, following the exact same
  technique (`resetCapabilityGatewayCatalogPortForTests`, env-var-pointed) - test-only, additive, never
  a change to production code.

## 7. Scenario coverage

All 21 required categories are covered by one scenario each (`A13-01`..`A13-21`), plus one
supplementary deterministic regression (`A13-10b`) for a latent defect discovered while building
`A13-10`. The full manifest (category, title, invariants each scenario is responsible for) is data,
not prose - see `tests/commercial/fixtures/a13-conversational-reliability-scenarios.ts`'s
`A13_SCENARIO_MANIFEST`.

| ID | Category | Result |
|---|---|---|
| A13-01 | product_search_and_selection | PASS |
| A13-02 | ambiguity | PASS |
| A13-03 | no_results | PASS |
| A13-04 | quantity_changes | PASS |
| A13-05 | product_changes | **FAIL (P1, 4.3)** |
| A13-06 | repeat_purchase | PASS |
| A13-07 | customer_aware_recommendation | PASS |
| A13-08 | identity_l0_l2_l3 | PASS |
| A13-09 | onboarding_resume | **FAIL (P1, 4.2)** |
| A13-10 | shipping_lookup_selection | PASS |
| A13-10b | shipping_lookup_selection (latent defect, direct repro) | **FAIL (P1, 4.4)** |
| A13-11 | cancellation | **FAIL (P1, 4.1)** |
| A13-12 | supersession | PASS |
| A13-13 | multi_intent | PASS |
| A13-14 | long_conversation_continuity | PASS |
| A13-15 | unsupported_intent | PASS |
| A13-16 | customer_profile_failure | PASS |
| A13-17 | catalog_failure | PASS |
| A13-18 | planner_malformed_output | PASS |
| A13-19 | duplicate_inbound | **FAIL (P1, 4.1)** |
| A13-20 | waiting_customer_continuation | PASS |
| A13-21 | waiting_system_recovery | **FAIL (P2, 4.5)** |

**Total: 22 checks, 16 pass, 6 fail.**

Validated with: `npx tsc --noEmit` clean (whole project); the full `A13ConversationalReliabilityBenchmark.test.ts`
file run standalone (`npx tsx --test tests/commercial/a13ConversationalReliabilityBenchmark.test.ts`),
consistently 16/22 across repeated runs; a targeted regression slice of five adjacent, pre-existing
CommercialWork E2E test files (`commercialWorkInboundCycle.test.ts`, `repeatPurchaseE2E.test.ts`,
`customerAwareRecommendationE2E.test.ts`, `selectShippingOptionCapability.test.ts`,
`commercialWorkRetryWorker.test.ts` - 31 tests) run clean, confirming zero regressions from this
benchmark's presence.

## 8. Recommended A13.x fixes (smallest corrective slices, in priority order)

1. **A13.1 - Terminal-work lineage / redelivery dedupe** (fixes 4.1, `A13-11`+`A13-19`, the two most
   customer-visible P1s). Smallest slice: before treating a trigger as "no_work," have
   `resolveCommercialWorkTarget` (or a new, narrow helper) check `assignCommercialTriggerSequence`'s
   own dedupe result - if this exact `triggerDedupeKey` already has a `commercial_sequence` AND a
   completed dispatch exists for it, short-circuit to a genuine "already handled, do not re-dispatch"
   outcome rather than creating a second work. A separate, narrower question (should a `cancel` targeting
   a family whose owning objective already lives in a terminal work be able to still act on the
   underlying DURABLE fact?) should be scoped explicitly, not folded silently into the redelivery fix.
2. **A13.2 - Identity-gate carry-forward** (fixes 4.2, `A13-09`). Smallest slice: `stillWaitingOnCustomer`
   needs to distinguish "the capability itself asked" from "the identity gate blocked it" - e.g. by
   checking the carried objective's own blocker `code` (`IDENTITY_REQUIREMENT`) rather than only its
   status, so an identity-gated `WAITING_CUSTOMER` objective is still eligible to reach `READY` (and
   therefore be re-evaluated by the identity gate) on carry-forward.
3. **A13.3 - `optionIndex` type safety** (fixes 4.4, `A13-10b`). Smallest slice: normalize
   `optionIndex` to a number (`Number(...)` with a finite/integer guard) at the one point
   `resolveObservedShippingOption.ts` first receives it, defensively, regardless of where the string
   coercion is happening upstream - matches this same evidence gate's own existing "never trust, always
   re-validate" discipline.
4. **A13.4 - Product-change / round-budget investigation** (fixes 4.3, `A13-05`). Not yet a "smallest
   slice" - the root cause needs one more focused investigation pass (instrumenting
   `applyPendingMutationInvalidations` and the `SELECT_PRODUCTS` two-hop chain's interaction across
   `settleCommercialWorkProjection`'s 3 rounds for this specific multi-objective case) before a minimal
   fix can be scoped confidently.
5. **A13.5 - Retry-worker dependency-aware candidate selection** (fixes 4.5, `A13-21`, lowest priority -
   P2, existing stale-lock recovery is a partial mitigation). Smallest slice: the worker's candidate
   query/claim logic should never select a step whose own `STEP_COMPLETED` dependency is unmet in the
   same batch that also contains the step it depends on.

Per this task's explicit instruction, none of the above were implemented in this pass.
