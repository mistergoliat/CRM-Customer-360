---
doc_id: release-sales-agent-r2-a11-1
title: SALES-AGENT-R2-A11.1 - Owner-Only Live Fixes / Product Discovery + WAITING_CUSTOMER Recovery
status: done
last_reviewed: 2026-08-20
source_of_truth_for:
  - the minimal Product Discovery (SEARCH_PRODUCTS) slice added to CommercialWork
  - root causes and fixes for the two real bugs WA01 (owner-only live testing) found
depends_on:
  - ./SALES-AGENT-R2-A11-autonomous-runtime-operationalization-controlled-rollout.md
  - ./SALES-AGENT-R2-A10-capability-coverage-runtime-correctness-audit.md
  - ./SALES-AGENT-R2-capability-coverage-matrix.md
tags:
  - release
  - sales-agent
  - commercial-work
  - product-discovery
---

# SALES-AGENT-R2-A11.1: Owner-Only Live Fixes / Product Discovery + WAITING_CUSTOMER Recovery

Verdict: **A11_1_FIX_VALIDATED** against real MariaDB (`crm_test`), `npx tsc --noEmit`,
and `npm run build`, all clean. Real owner-number WhatsApp re-validation (repeating
WA01) has not been performed in this session - no live Meta/owner-phone access here,
same limitation documented throughout A11. This document does **not** declare
`A11_OWNER_ONLY_OPERATIONAL`.

## 1. The two live bugs, root-caused

**Bug 1** ("buenas. neesito 2 discos olimpicos de 20kg" → bot replied "¿Qué producto
te interesa?"): the semantic planner correctly extracted `productReference`/`quantity`,
but R2 had no mechanism to ever resolve a first-mention product reference into real
catalog evidence - `requirementResolver.ts`'s `resolveProductRequirement` only ever
matched against `RecentCatalogContext` (a read model built exclusively from **prior**,
legacy-loop-correlated `search_products` executions this same conversation). A
first-mention reference always resolved `"missing"`, `buildCommercialWorkProjection.ts`
correctly (per its own pre-A11.1 logic) turned that into `WAITING_CUSTOMER` +
`MISSING_PRODUCT_EVIDENCE` - a system-owned gap ("I never searched") that two
downstream consumers then mishandled as if it were customer-owed: the finalizer
collapsed `PRODUCT_EVIDENCE` into the same generic question as a bare `MISSING_PRODUCT`,
and the follow-up policy routed it to `MISSING_INFORMATION` (a customer-facing nudge for
something only the system could fix).

**Bug 2** (repeated "¿Qué producto te interesa?" on every subsequent turn): a direct
symptom of Bug 1, not an independent defect - `dispatchCommercialWorkResponse.ts`
dispatches a message every turn from the *current* CommercialWork state, and since Bug 1
left that state permanently unable to progress (no search ever ran), every turn
re-derived the identical wrong state and therefore the identical wrong message. Fixed
as a consequence of Bug 1's fix, confirmed by WCP01/WCP02 (below).

Also investigated per the task's explicit list: the reported "double execution" was
confirmed a false alarm (two distinct Meta inbound messages, not a real duplicate -
no dedup added). Two additional real, independent bugs were found during the audit and
are fixed in the same change (Part 7/8 below).

## 2. Minimal Product Discovery slice (Part 2/3)

Reuses the existing Capability Gateway's `search_products` capability - no second
catalog client, no LLM-invoked tools, no invented product IDs, no legacy fallback,
no CommercialWork replacement.

- **`deriveCommercialWorkSteps.ts`**: `SELECT_PRODUCTS`/`CHANGE_QUANTITY` now derive a
  `SEARCH_PRODUCTS` prerequisite step (reusing the pre-existing but previously
  unreachable step type `DISCOVER_PRODUCTS` already declared) whenever the objective has
  a `productReference` and no resolved `items` yet. `SELECT_PRODUCTS` then depends on
  that step's `STEP_COMPLETED`, replacing the old `CUSTOMER_INPUT/PRODUCT` dependency
  only for this case.
- **`commercialWorkExecutor.ts`**: `SEARCH_PRODUCTS` added to `EXECUTABLE_STEP_TYPES`
  (previously derived but never executable, an A10-documented gap) and to
  `buildGatewayInput` (`{query: productReference, limit: 5}`).
- **`buildCommercialWorkProjection.ts`** (`applyObjectiveState`): replaces the old
  `productEvidenceAvailable === false → WAITING_CUSTOMER` short-circuit with real
  evidence-driven branching, reading the latest matching `search_products`
  `crm_capability_executions` row (matched on **request** query text - see below) via
  the same `recentCapabilityExecutions` input GET_SHIPPING_QUOTE already relies on for
  `calculate_shipping`, never a second read model:
  - No matching execution yet → `READY` (system must search first, never
    `WAITING_CUSTOMER`).
  - 1 candidate → auto-select, populate `objective.inputs.items`, `READY`.
  - 2+ candidates → `WAITING_CUSTOMER` + `PRODUCT_AMBIGUOUS`, real candidate names
    attached (`objective.inputs.productCandidates`, new field).
  - 0 candidates → `WAITING_CUSTOMER` + `PRODUCT_NOT_FOUND`.
  - Technical failure, retryable → `WAITING_SYSTEM` (never `WAITING_CUSTOMER` - a
    catalog outage is never a customer question).
  - Technical failure, non-retryable → `FAILED`.
- **`capabilityExecutionReader.ts`**: added `request_summary_json`/`requestSummaryJson`
  to the read model - required because a failed/blocked search execution has no
  `response_summary_json` (`executeCapability.ts` persists `responseSummary: null` on
  every non-`execute()` early return), so matching on the *request* query is the only
  way to recognize "yes, I already asked about this exact reference" on both success and
  failure. No migration - the column already existed.
- **`retryPolicy.ts`**: new `SEARCH_PRODUCTS` retry policy (maxAttempts=3, mirrors
  `CALCULATE_SHIPPING`'s catalog-backed pattern) so a retryable technical failure reaches
  `RETRY_SCHEDULED` and the existing, generic retry worker recovers it - no new worker
  code needed.
- **`semanticIntentAdapter.ts`**: when `requirementResolver.ts`'s legacy
  `RecentCatalogContext`-based matcher already found 2+ ambiguous candidates (real
  evidence from a *prior* search this conversation - the R2-07 architecture scenario's
  exact shape), those candidates are now attached to the seed
  (`productCandidates`) so `applyObjectiveState` can go straight to
  `WAITING_CUSTOMER`/`PRODUCT_AMBIGUOUS` without a redundant fresh search.

**A same-round bug found and fixed while building this** (not present in the final
code): `commercialWorkExecutor.ts`'s `activateUnblockedSteps` auto-flips *any* `BLOCKED`
step with empty blockers straight to `READY` the instant its `STEP_COMPLETED` dependency
is satisfied - within the **same** executor pass that just ran `SEARCH_PRODUCTS`,
*before* a fresh projection round ever interprets the search result into
`objective.inputs.items`. Left at `blockers: []`, the new `SELECT_PRODUCTS` step would
reactivate one full round early and call `select_products` with `items: []`, which fails
and reads back as objective `FAILED`. Fixed by giving that transient step a
`MISSING_PRODUCT_EVIDENCE` blocker (not in `canAutoActivateStep`'s allow-list), so it
only ever becomes `READY`/`WAITING_CUSTOMER` through the next fresh projection round,
after the search result has actually been interpreted.

## 3. Follow-up correctness (Part 5)

No code change needed beyond the redesign above: `evaluateObjectiveFollowUpEligibility.ts`
already gates all follow-up scheduling on `work.status === "WAITING_CUSTOMER"` /
`objective.status === "WAITING_CUSTOMER"` - since a system-owned search gap is now
`READY`/`WAITING_SYSTEM` (never `WAITING_CUSTOMER`), it structurally never reaches
follow-up scheduling. `PRODUCT_AMBIGUOUS`/`PRODUCT_NOT_FOUND` are correctly customer-owed
(the customer must pick or clarify) and are added to `MISSING_INFORMATION`'s
`waitingReasons` allow-list plus dedicated `buildObjectiveFollowUpMessage` wording.

## 4. Finalizer wording (Part 6)

`buildMissingInfoQuestion` now takes the full `waitingCustomerObjectives` (not a
flattened string list) so it can read `objective.inputs.productCandidates`/
`productReference` and distinguish: `PRODUCT_AMBIGUOUS` (names the real options),
`PRODUCT_NOT_FOUND` (says so, asks for the exact name), `PRODUCT`/missing reference
(the only case still asking the old generic question - correct here, since there really
is nothing to search for), `DESTINATION`, `QUANTITY`. `WAITING_SYSTEM` never reaches
this function at all (excluded from `waitingCustomerObjectives` by construction).

## 5. Blocker deduplication (Part 7) - real, independent bug

Traced to `deriveCommercialWorkSteps.ts`: nearly every step copies
`blockers: [...objective.blockers]` onto itself by design (byte-for-byte, same `source:
"objective"`, no `stepId`), for step-level consumers that shouldn't have to
cross-reference their objective. `collectCommercialWorkBlockers`
(`evaluateCommercialWork.ts`) and `commercialWorkExecutor.ts`'s `nextAggregate` both
naively concatenate `objectives.flatMap(blockers) + steps.flatMap(blockers)` - every
objective-level blocker was counted twice, structurally, for any objective with a
non-empty blocker list (matches the live report's exact observed pattern: `SUPERSEDED,
MISSING_PRODUCT_EVIDENCE, WAITING_CUSTOMER` each appearing twice). Fixed with a shared
`dedupeCommercialWorkBlockers` (identity = `code|source|objectiveId|stepId`, first
occurrence wins) applied at both aggregation sites - not a `DISTINCT`-at-the-end hack,
the actual double-counting source. `BLOCK01` (new test) proves it.

## 6. Lineage self-reference (Part 8) - real, independent bug

`reconciliation.ts`'s `withSequenceAndLineage` set `previousWorkPublicId:
previous?.publicId ?? null` unconditionally. For an "update" target (in-place
reconciliation of an already-active work), `previous` **is** the same work being
updated - `previous.publicId === work.publicId`, a self-reference on every update.
`supersedesWorkPublicId` right next to it already correctly conditioned on
`target.action === "create"`; `previousWorkPublicId` now mirrors that, and for
"update" carries forward whatever lineage was already persisted on the row
(`input.target.previousWork.previousWorkPublicId`) instead of either self-referencing or
erasing real lineage set at creation time. `LINEAGE01` (new test) proves it, and was
confirmed to fail against the pre-fix code (temporarily reverted and re-run) before
being finalized.

## 7. New tests

- `tests/commercial/commercialWorkProjection.test.ts`: `CW09b1`-`CW09b5` (no-search →
  `READY`; 1/2/0 candidates; retryable technical failure → `WAITING_SYSTEM`), `BLOCK01`
  (blocker dedup).
- `tests/commercial/commercialWorkWaitingCustomerReactivation.test.ts`: `WCP01`
  (ambiguous state stable across `settleCommercialWorkProjection` reprojection rounds,
  zero redundant re-search - real DB-backed), `WCP02` (a vague follow-up message never
  resets the real ambiguity back to a generic question).
- `tests/commercial/commercialWorkSemanticCompleteness.test.ts`: `LINEAGE01`.
- `tests/commercial/commercialWorkExecutor.test.ts`, `tests/fixtures/commercial-work-benchmark/corpus.ts`,
  `tests/commercial/commercialWorkSemanticCompleteness.test.ts` ("Part 3", "Part 6/7"):
  updated, not relaxed - see "Existing tests updated" below for why each one changed.

## 8. Existing tests updated (not relaxed) - why

- **`CWEX22-CWEX24`** (`commercialWorkExecutor.test.ts`): used `DISCOVER_PRODUCTS`
  (→ `SEARCH_PRODUCTS` step) as its "genuinely unsupported step type" example -
  `SEARCH_PRODUCTS` is now supported by design. Retargeted at a synthetically retyped
  `HANDOFF` step (same construction pattern the file's own "cyclic" case already uses),
  which is still genuinely unsupported.
- **R2-07** (`tests/fixtures/commercial-work-benchmark/corpus.ts`): expected
  `missingRequirements: ["PRODUCT_EVIDENCE"]` → `["PRODUCT_AMBIGUOUS"]`. This is the
  exact scenario Part 6 fixes - the generic code is intentionally retired in favor of
  the precise one; the scenario's actual behavior (ambiguous, `WAITING_CUSTOMER`,
  real candidates) is unchanged.
- **"Part 3: an untargeted cancellation..."** (`commercialWorkSemanticCompleteness.test.ts`):
  used an unresolvable `productReference` ("la classic") that, through the benchmark's
  fixture catalog server (always returns the same 2 products for any query), now
  resolves via a real search instead of staying stuck - completing the objective before
  the cancel arrives, which correctly forces `SUPERSEDED` not `CANCELLED`
  (`transitions.ts`: `COMPLETED → SUPERSEDED` only, matching the sibling
  shipping-cancel test's already-documented rule). Retargeted at a productReference the
  fixture cannot match to a single item, preserving the test's real intent (cancelling a
  still-incomplete objective).
- **"Part 6/7: an unresolved product reference..."**: same fixture-always-ambiguous
  effect - "la Xtreme" now genuinely reaches `search_products` and lands
  `PRODUCT_AMBIGUOUS` (2 real candidates), not the old generic `PRODUCT_EVIDENCE`.
  `select_products` is still never called (assertion preserved).

## 9. Regression

Full `tests/commercial/` (123 files, ~1810 tests) run three times across this session's
fix cycle. Final state: every CommercialWork/Product-Discovery-related test green.
Remaining failures across runs, all independently confirmed **pre-existing and
unrelated** by running each in isolation (passes alone; only fails under concurrent
full-batch load or shared-DB-state contention):
- `createCustomerCapability.test.ts`, `customerOnboardingPostPlanStage.test.ts`,
  `customerSession.test.ts`, `customerSessionPrivacy.test.ts`,
  `linkExternalIdentityCapability.test.ts`, `processInboundCommercialShadow.test.ts`,
  `runCommercialOperationalLoop.test.ts`: fail only in their `after()` teardown hook
  (`Missing DATABASE_NAME`) - these files have no `Object.assign(process.env, ...)`
  block of their own (unlike every CommercialWork test file), an environmental gap
  unrelated to this task.
- `[A13]`/`[R17]`/`[P25]`/`[S29]`/`[C8]` (`salesAgentConfigurationApi.test.ts`,
  `salesAgentConfiguration.test.ts`): unrelated subsystem (Sales Agent Configuration
  API), shared `crm_test` state pollution from prior sessions (a stored row with
  `missing_required_field`) - reproducible in isolation, unrelated to this task's files.
- `[CWPAR01/CWPAR19]`, `[CWPAR12-15]`, `ACS-R1-05-T06.2`: wall-clock/timing-threshold and
  concurrency-ordering tests, flaky only under full-batch CPU contention - each passes
  reliably alone.
- `CWDB27-CWDB28`: a global, unscoped `SELECT COUNT(*) FROM crm_capability_executions`
  before/after check - inherently racy against *any* concurrently-running test file that
  inserts a capability-execution row (this task's own `WCP01`/`WCP02` do, seeding a real
  row for `settleCommercialWorkProjection` to reload); passes reliably alone. Pre-existing
  fragility, not redesigned here (out of this task's scope).

`npx tsc --noEmit`: clean. `npm run build`: clean (exit 0).

## 10. Design decisions / compatibility (Part 12/13)

No CommercialWork replacement, no new workflow engine, no agent-tool-loop reactivation,
no second catalog client, no invented product IDs (every `productId`/`combinationId`
traces to a real `CatalogSearchResultItem`), no catalog failure ever surfaced as a
customer question (`WAITING_SYSTEM`/`FAILED`, never `WAITING_CUSTOMER`), no direct
Catalog Service coupling in the finalizer (it only ever reads
`objective.inputs.productCandidates`, already-resolved data the projection layer
attached - never calls the catalog itself). No safe-default env flags touched
(`BRAIN_WHATSAPP_TEST_MODE_ENABLED`, `BRAIN_AUTONOMOUS_RESPONSES_ENABLED`,
`BRAIN_COMMERCIAL_WORK_WORKER_ENABLED`, `BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED` all
unchanged).

## 11. Live-readiness harness (Part 11)

`scripts/manual-test/whatsapp-r2-smoke.ts` extended with `WA-R2-07` (the exact WA01
message - "buenas. neesito 2 discos olimpicos de 20kg" - as a first-mention reference
through the real R2 path, no seed turn) and `WA-R2-08` (the "me puedes ayudar"/"una
pesa" continuation). Requires a real `BRAIN_MODEL_API_KEY` (live LLM) - not runnable in
this session, same limitation as every other real-LLM smoke script in this repo. This is
the recommended next step before redeploying.

## 12. Risks / debt

- `DISCOVER_PRODUCTS` objective type still has no seed producer anywhere in the planner
  (pre-existing dead code, confirmed again during this audit, unrelated to this fix -
  not touched).
- The benchmark's fixture catalog server (`agent-loop/benchmark/environment.ts`) always
  returns the same 2 fixed products for any query - real single-match and zero-match
  scenarios are only exercised at the pure-projection level (`CW09b2`/`CW09b4`), not
  through the full real pipeline. A live Catalog Service smoke (`WA-R2-07`/`WA-R2-08`
  above) is the only way to see real single-match/zero-match resolution end to end.
- `CWDB27-CWDB28`'s test-isolation fragility (Section 9) is pre-existing and was not
  redesigned - flagged, not fixed, out of this task's scope.

## WA01/WA02 readiness

Code-complete and tested against real MariaDB; not live-validated. Per this task's own
explicit instruction, `A11_OWNER_ONLY_OPERATIONAL` requires repeating WA01 live after
redeploy - not claimed here.
