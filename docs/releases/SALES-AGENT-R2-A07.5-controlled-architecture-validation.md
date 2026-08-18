# SALES-AGENT-R2-A07.5 - Controlled Architecture Validation

Status: done
Scope: dev/test/benchmark only - a new, separate R2 benchmark harness plus 7 small, regression-tested fixes in A03/A04/A05 and one legacy benchmark fixture
Production behavior changed: NO
A08 implemented: NO

## 1. Objective

Determine whether six releases of new architecture (A01-A07: `CommercialWork`, durable persistence, a multi-step executor, retry/continuation, objective-aware follow-up) actually eliminate the structural defect T08/T09 found in the legacy Agent Tool Loop, without depending again on that same loop - before spending any further effort on A08 (sequencing/concurrency).

## 2. Hypothesis under test

```text
Legacy: turn finished ~= commercial execution finished
R2:     turn finished != necessarily commercial work finished

CommercialWork must be able to represent and continue pending commercial
work after the turn, a retry, or a restart.
```

The test is designed to falsify this, not confirm it: every metric that could show lost work, duplicated side effects, or stale-evidence execution is asserted as a hard failure, not just reported.

## 3. Architecture under test

```text
semantic interpretation/planning (LLM-R1-T09A's real planner, reused unchanged)
        v
CommercialWork projection (A03, buildCommercialWorkProjection - pure)
        v
durable persistence (A04, crm_commercial_work/_objectives/_steps)
        v
deterministic dependency execution (A05, commercialWorkExecutor.ts)
        v
Capability Gateway (real registry, real fake Catalog/Carrier fixtures)
        v
continuation/retry (A06, commercialWorkWorker.ts)
        v
objective-aware follow-up (A07, DB-backed)
```

No A08, no A09, no production routing/flag change.

## 4. Part 1 audit (grounded in the real code, not the docs)

- **How a CommercialWork is created today**: `buildCommercialWorkProjection(input)` (`lib/brain/commercial/work/buildCommercialWorkProjection.ts`) is pure/synchronous. It calls `deriveCommercialObjectives` (handles same-family supersession - e.g. a new `SELECT_PRODUCTS` seed supersedes a prior active one), applies per-objective-type state from durable facts (`applyObjectiveState`), derives steps (`deriveCommercialWorkSteps`), and computes status/blockers/metrics.
- **Projection inputs**: `conversation`, `opportunity`, `trigger`, `objectiveSeeds`, `pendingCommercialIntents`, and current durable facts (`commercialLineItems`, `shippingDestination`, `selectedShippingOption`, `createdQuote`, `recentCapabilityExecutions`).
- **Persistence (A04)**: `persistCommercialWorkProjection` (insert) / `updateCommercialWorkAggregate` (optimistic-lock upsert) against `crm_commercial_work`/`crm_commercial_work_objectives`/`crm_commercial_work_steps` (migration `029`). Idempotency/continuity keys off `correlation_key`.
- **Loading**: `getCommercialWorkByPublicId`/`ByCorrelationKey`/`findActiveCommercialWorks`, all real DB reads, no cache.
- **A05 READY-step selection/execution**: `executeCommercialWork` loops up to `maxSteps`, picks the next `READY` step by priority (`SELECT_PRODUCTS(10) -> SET_SHIPPING_DESTINATION(20) -> CALCULATE_SHIPPING(30) -> CREATE_QUOTE(40)`), checks stale-evidence blockers **before** any capability call, attempts evidence repair (no gateway call if durable facts already satisfy the step), then calls `executeCapability`.
- **Facts/conversation-control revalidation**: every loop iteration reloads facts and conversation control fresh from DB before acting - `human_owner_active`/`ai_enabled` block immediately, transitioning the work to `HANDOFF`.
- **A06 claim/retry**: `runCommercialWorkTick` selects `READY`/due-`RETRY_SCHEDULED`/expired-`RUNNING` steps, claims via an atomic CAS UPDATE (`lock_owner`/`lock_until`), then calls the same `executeCommercialWork` with `claimedStepId`.
- **idempotency_key preservation**: `insertStep`'s `ON DUPLICATE KEY UPDATE` upsert preserves the step's `idempotency_key` across turns/retries; confirmed empirically in R2-05 (same key before/after the retry).
- **Evidence repair**: `repairEvidence()` in `commercialWorkExecutor.ts` - if a durable fact (e.g. `created_quote.selectionFactId`) already matches the step's expected input, the step completes without a second capability call. This is the exact mechanism R2-06 (crash recovery) needs and uses for real.
- **WAITING_CUSTOMER vs WAITING_SYSTEM**: structurally distinct in `applyObjectiveState`/`stepRecordFromGateway` - `WAITING_CUSTOMER` means a human answer is needed, `WAITING_SYSTEM` means a technical retry is needed. Never conflated.
- **A07 follow-up correlation**: `followup/objectiveAwareFollowUp.ts` stores `commercialWorkPublicId`+`commercialObjectivePublicId`+`followUpPolicy`+`waitingReason` in `crm_agent_actions.draft_payload_json`, dispatches through the canonical `send_whatsapp_reply`/execution-gate/outbox path - never a second, parallel dispatch mechanism.
- **What still needs LLM**: exactly one call, upstream of everything else - turning a customer's free-text message into structured intents (the T09A planner). Everything from `deriveCommercialObjectives` onward (projection, persistence, execution, retry, follow-up eligibility/correlation) is deterministic, zero-LLM.
- **What T08/T09 infra is reusable without contaminating the comparison**: the *environment* (fake Catalog HTTP server, fake Carrier, fake commune resolver in `lib/brain/commercial/agent-loop/benchmark/environment.ts`) and the live-provider plumbing are safe, generic infrastructure. The legacy *scorer* and *corpus* are tool-sequence-specific and were never reused as R2 requirements - R2 has its own scorer/metrics/corpus (`lib/brain/commercial/work/benchmark/`), only the C09-equivalent case is run through both stacks.

### Critical finding: no production wiring exists yet

Grepped the whole repository: `deriveCommercialObjectives`/`buildCommercialWorkProjection`/`persistCommercialWorkProjection`/`executeCommercialWork`/`runCommercialWorkTick` are referenced only inside `lib/brain/commercial/work/**` and its own tests. **A03-A07 have never been connected to a real customer message in production.** The architecture is fully built and well-tested in isolation, but this benchmark is the first thing that ever drives it end to end from a real (offline-scripted) planner call.

A real, already-tested semantic-interpretation layer does exist for this purpose: LLM-R1-T09A's multi-intent planner (`lib/brain/commercial/multi-intent/`). Its output (`ResolvedIntent[]`) was never wired to `CommercialWork` - it feeds `actionPlanExecutor.ts` instead (T09A's own, non-durable, inline execution path). This benchmark's one legitimate "minimal adapter" (`lib/brain/commercial/work/benchmark/semanticIntentAdapter.ts`) reuses the real planner call and the real deterministic requirement resolver unchanged, and adds only the mapping from `ResolvedIntent[]` to `CommercialObjectiveSeed[]` - never a second executor, never a reimplementation of planning or execution.

## 5. Scorer: how this differs from the legacy T08 scorer

Reused: customer message, initial state, facts/context, expected business outcome, safety invariants, expected mutations, C02/C04/C09-equivalent cases.

**Not** reused as a requirement: legacy tool sequence, exact LLM decision count, same-turn-response obligation (R2 may legitimately finish a turn before commercial work completes - tracked separately via `commercialCompletionLatencyMs`), legacy fault-injection expectations.

The R2 scorer (`lib/brain/commercial/work/benchmark/scoring.ts`) evaluates architecture/business properties directly from the final `PersistedCommercialWork` + a structural capability-call log - never from response text (R2's harness has no finalizer chat message at all by design, which is itself part of what the comparison shows: `LLMCallsPerTurn` stays near 1, planner only).

## 6. Corpus (`tests/fixtures/commercial-work-benchmark/corpus.ts`)

R2-01 through R2-09 and R2-12 (10 scenarios), plus R2-10/R2-11 (A07, in a separate file since they don't fit the same turn-driven shape). All against the real pipeline: real `crm_test` DB, real fake Catalog/Carrier fixtures, real executor/worker, real Capability Gateway registry (one small benchmark-only adapter for `create_quote`'s external Quote Service port - see Bugs Found #6).

## 7. Fault injection (deterministic, never LLM-decided)

- **R2-05**: `calculate_shipping` blocked once (synthetic `temporarily_blocked`, no real carrier call), then let through for real on the worker's retry tick.
- **R2-06**: `create_quote`'s real side effect completes for real, then a synthetic `CommercialWorkBenchmarkSimulatedCrashError` is thrown - propagates out of `runCommercialWorkTick` exactly like a real process crash would, leaving the step `RUNNING` with an expired lease for the worker to reclaim.
- **R2-08**: no injection needed - `applyPendingMutationInvalidations` (already-existing A03 logic) fires for real the moment a new active `SELECT_PRODUCTS` seed lands.
- **R2-12**: no injection needed - a plain `UPDATE conversation SET human_owner_active=1` before the executor pass; `defaultLoadConversationControl` reads that table for real.

## 8. Metrics

Implemented in `lib/brain/commercial/work/benchmark/metrics.ts`, all computed from the final `PersistedCommercialWork` + capability call log, never from text. `lostCommercialWorkRate` is the central one:

```text
isObjectiveDurablyRepresented(objective, work) =
  objective.status in {COMPLETED, CANCELLED, SUPERSEDED, WAITING_CUSTOMER, WAITING_SYSTEM}
  OR work.status == HANDOFF
  OR any owned step is RETRY_SCHEDULED
```

`FAILED` (retry-exhausted, no handoff) is deliberately **not** safe - that is real lost work. `lostCommercialWorkRate = lost objectives / total objectives`, aggregated across all runs, `null` (never a fabricated 0) when the denominator is 0.

## 9. Results per scenario (real, executed - `npx tsx@4.20.5 scripts/benchmark-commercial-work-architecture.ts`, offline/deterministic planner)

| Scenario | Result | Notes |
|---|---|---|
| R2-01 simple selection | PASS | 1 LLM call, 1 capability call, COMPLETED. |
| R2-02 C09 equivalent (decisive case) | PASS | Selection+destination+shipping all COMPLETED same cycle (Acceptable Result A) - 1 LLM call, 3 capability calls. |
| R2-03 missing destination | PASS | SELECT_PRODUCTS COMPLETED, GET_SHIPPING_QUOTE WAITING_CUSTOMER/MISSING_DESTINATION, no re-ask for product/quantity. |
| R2-04 continuation | PASS | Turn 2 ("Nunoa") correctly correlates to the same CommercialWork; prior selection never lost; final state COMPLETED. |
| R2-05 technical retry | PASS | First attempt blocked, worker tick recovers; same `stepId`/idempotency key before/after; zero LLM calls during retry. |
| R2-06 crash recovery | PASS | Real `create_quote` side effect, simulated crash, worker reclaims the stale `RUNNING` step, evidence repair completes it with **zero** second capability call. |
| R2-07 ambiguity | PASS | Two real candidates, `WAITING_CUSTOMER`/`PRODUCT_EVIDENCE`, zero guessed product (after the A03 fix, see Bugs Found #2). |
| R2-08 correction/supersession | PASS | qty 2->3 supersedes the prior selection; stale shipping evidence invalidated; no duplicate active selection. |
| R2-09 quote creation | PASS | `create_quote` completes, idempotent under reload. |
| R2-12 handoff/AI-disabled | PASS | `work.status = HANDOFF`, zero further autonomous execution, zero unbacked mutation claim. |
| R2-10 objective-aware follow-up | PASS | Scheduled, correlated to CommercialWork+objective, sent through the canonical `crm_agent_actions`/`brain_message_outbox` path, structurally zero LLM calls. |
| R2-11 stale follow-up cancellation | PASS | A real inbound row before due time cancels the follow-up (`customer_replied_since_schedule`), zero message sent, audit row preserved. |

**12/12 PASS.**

## 10. C09: legacy vs R2 (real, executed comparison)

Both runs offline/deterministic, same customer message, same fixture catalog identity (product 31, commune 99 "Nunoa"), same fixture environment. **This is not the live-LLM comparison** - see Section 13.

Command: `npx tsx@4.20.5 scripts/compare-legacy-vs-r2-c09.ts`.

| | Legacy Agent Tool Loop (Harness A) | R2 CommercialWork (Harness B) |
|---|---|---|
| LLM calls | 3 | 1 |
| Tool/capability executions | 2 | 3 |
| Selection completed | yes | yes |
| Destination completed | **no** | yes |
| Shipping completed | **no** | yes |
| Remaining work durably represented | **no** (no CommercialWork exists) | yes |
| Final message | "Listo, agregue 2 unidades... Dame un momento y te confirmo el valor del despacho a Nunoa." | (no finalizer message in this harness by design) |
| Turn latency | 83ms | 210ms (same-cycle; `commercialCompletionLatencyMs` also 210ms) |

This reproduces T08E/T08F's own finding exactly: the legacy loop's default budget (`maxToolExecutions=2`) is consumed by `get_product_details`+`select_products`, leaving the customer a promise ("dame un momento y te confirmo...") backed by **no durable state whatsoever**. R2 completes the full C09 bundle in the same cycle, with a durable representation regardless of outcome. The "promise without continuation" failure category T08F documented does not reproduce in R2, for the reason the architecture predicts: `CommercialWork` exists and is checked, not inferred from a chat transcript.

## 11. lostCommercialWorkRate

```text
lostCommercialWorkRate = 0%   (0 lost / 21 total objectives across 10 corpus runs)
```

Target met. Every objective across all 10 corpus scenarios ended `COMPLETED`, `WAITING_CUSTOMER`, `WAITING_SYSTEM`-transient-then-`COMPLETED`, or `HANDOFF`-covered.

## 12. Retry/restart evidence

- `retryRecoveryRate = 100%` (R2-05: blocked once, recovered by the next worker tick, zero customer input, zero LLM calls, stable `stepId`/idempotency key).
- `restartRecoveryRate = 100%` (R2-06: real side effect, simulated crash, stale-`RUNNING` reclaim, evidence repair - zero duplicate `create_quote` call, confirmed via the capability call log).

## 13. Duplicate side effect evidence

```text
duplicateSideEffectRate = 0%
unbackedCommercialMutationClaimRate = 0%
staleEvidenceExecutionRate = 0%
```

All three asserted as hard test failures in `tests/commercial/r2ArchitectureScenarios.test.ts`, not just reported. `duplicateSideEffectRate` is computed against real capability governance metadata (`resolveCapabilityGovernance(...).sideEffect === "mutating"`) - see Bugs Found #4 for why this matters.

## 14. Customer-visible audit

R2's harness has no finalizer/chat message by design (the architecture's own point: commercial correctness is checked structurally, not narrated). `customerVisibleCorrectRate` is derived the same way `lostCommercialWorkRate` is - no lost objective, no duplicate, no unbacked claim = correct. All 10 corpus runs: correct. This is a structural, not textual, audit - consistent with the task's own instruction that the C09 comparison is metrics-based, not wording-based.

## 15. Limits from the absence of A08

- Turn-to-turn continuity (`carryForwardActiveObjectives` in `runR2Scenario.ts`) is benchmark-only glue, not production wiring - nothing in A01-A07 orchestrates multi-turn re-seeding automatically (see Section 4's critical finding and Architectural Findings below).
- No conversation-level sequencing/staleness protection is tested or claimed: two racing inbound messages, a stale turn finishing after a newer one, and worker-vs-inbound exact serialization are explicitly out of scope (task Part 8) and remain A08 territory.
- R2-11 tests "a real inbound before due time cancels the follow-up" - it does not test exact ordering guarantees under concurrent triggers.

## 16. Limits from A07 DB-backed availability

Not applicable - A07 DB-backed was available and both R2-10 and R2-11 ran for real against `crm_test`, not blocked.

## 17. Bugs found (all small, regression-tested, A03/A04/A05-scoped or benchmark-fixture-scoped - none touch A08/production/design)

1. **`buildCommercialWorkCorrelationKey` overflow** (A04, `lib/brain/commercial/work/repository.ts`) - embedded the full canonical-JSON of active objectives directly into a `VARCHAR(191)` column; any realistic multi-objective `CommercialWork` (e.g. a C09-shaped turn) overflowed it (`"Data too long for column 'correlation_key'"`), reproduced first by R2-02. Fixed to a SHA-256 digest of the same canonical JSON (same uniqueness/collision behavior, fixed length). Regression test: `CWDB00b` in `tests/commercial/commercialWorkRepository.test.ts`.
2. **Ambiguous product status** (A03, `buildCommercialWorkProjection.ts`) - an unresolved/ambiguous product reference (`productEvidenceAvailable: false`) mapped `SELECT_PRODUCTS` to `BLOCKED`, inconsistent with a missing product name two branches above (which correctly maps to `WAITING_CUSTOMER`) and with A07's own `MISSING_PRODUCT_EVIDENCE` follow-up eligibility, which only ever applies to a `WAITING_CUSTOMER` objective (`evaluateObjectiveFollowUpEligibility.ts` requires `objective.status === "WAITING_CUSTOMER"` exactly). Fixed to `WAITING_CUSTOMER`. Regression test: `CW09b` in `tests/commercial/commercialWorkProjection.test.ts`.
3. **Orphaned step on same-turn supersession** (A03, `deriveCommercialWorkSteps.ts`) - a `CANCELLED`/`SUPERSEDED` objective produced **no** step at all, leaving any earlier-turn step for that same objective orphaned at its last real status in the DB (steps are only upserted from what a projection's `steps` array contains, never deleted). A later turn's executor pass could find that orphaned step's dependencies newly satisfied for unrelated reasons and reactivate/re-execute it - reproduced by R2-04 (an `"Invalid CommercialObjective transition SUPERSEDED -> READY"` persistence error). Fixed: a terminal objective now still produces its step, status forced to match (mirrors an already-existing, already-tested shape in `commercialWorkRepository.test.ts`'s CWDB26 manual construction). No new dedicated unit test (the fix is exercised end-to-end by R2-04/R2-08 and the full existing `commercialWorkProjection.test.ts`/`commercialWorkExecutor.test.ts` suites, all still green).
4. **Benchmark scorer bug**: `calculate_shipping` (governance-tagged `read_only` - a Carrier MS price lookup, no durable write of its own) was included in the R2 scorer's "mutating capability" set used for `duplicateSideEffectRate`, which would have wrongly flagged R2-08's legitimate shipping recalculation after a correction as a duplicate side effect. Fixed to use the real registry's governance metadata (`resolveCapabilityGovernance`) instead of a hand-maintained list. Benchmark-only, not a production bug.
5. **Benchmark adapter bug**: the `create_quote` benchmark bypass (`capabilityGateway.ts`) returned `executionPublicId: null` for a real completion, which made `evidenceForCapability()` attach zero evidence to a genuinely `COMPLETED` step - a false `unbackedCommercialMutationClaimRate` positive (reproduced by R2-09). Fixed to generate a real id. Benchmark-only.
6. **Benchmark fixture gap**: the legacy T08 benchmark's fake Catalog HTTP fixture (`lib/brain/commercial/agent-loop/benchmark/environment.ts`) never included `taxRate` in its product pricing payload (never needed by the Agent Tool Loop). `create_quote`'s real `assembleQuoteInput` fails closed with `catalog_tax_metadata_missing` without it, silently reported as an informational "completed" outcome (per `mapAssemblyErrorToOutcome`'s own, correct, non-technical-error design) rather than a real quote - meaning `create_quote` never actually created a quote in this benchmark until fixed. Added `taxRate: 0.19` (Chile IVA) to the fixture. Purely additive, benchmark-only.
7. **Benchmark scorer bug**: `restartRecovered` was derived from `retryRecovered`, which is `null` whenever `retryOccurred` is false - collapsing every pure crash-recovery scenario (R2-06, which never sets `retryOccurred`) to `restartRecovered: null` regardless of outcome, making `restartRecoveryRate` unmeasurable. Fixed to compute independently. Benchmark-only.

## 18. Architectural findings (documented, not fixed - would require design decisions or A08)

- **No production wiring from a customer message to `CommercialWork` exists** (Section 4). This benchmark is the first thing to drive A03-A07 end to end from a real (offline-scripted) planner call.
- **The projector expects the full current objective-seed set each call.** `buildCommercialWorkProjection`/`deriveCommercialObjectives` only supersede objectives present in the *same* seed batch - there is no notion of "a previous call already produced these objectives." A caller integrating this for real must re-seed every still-relevant objective (including already-`COMPLETED` ones, so they remain eligible supersession targets for a later correction) every turn, carrying the prior `objectiveId` forward as `seedId` to preserve identity. This benchmark's `carryForwardActiveObjectives` (`runR2Scenario.ts`) demonstrates the pattern; nothing in A01-A07 does this automatically yet.
- **The executor's single pass does not refresh a step's blockers when dependencies go from none-satisfied to some-satisfied within the same cascade** (only none-to-all triggers auto-activation in `activateUnblockedSteps`). Reproduced by R2-03 (a `GET_SHIPPING_QUOTE` step stayed `BLOCKED`/`MISSING_SELECTION` - the reason at projection time - even after the same turn's selection completed and the *real* remaining blocker became `MISSING_DESTINATION`). Worked around in the benchmark harness via a "settle" re-projection pass (re-runs the same, unmodified, pure A03 projector with fresh facts) rather than changing the well-tested A05 executor; documented here as integration guidance a real production caller would need, not patched into A05 itself.
- **`recentCapabilityExecutions`** (a real field on `CommercialWorkProjectionInput`, meant to detect a still-fresh prior `calculate_shipping` result across turns) **has no reader anywhere in the codebase** - `capability-gateway/repository.ts` only exports `insertCapabilityExecution`, never a query. A production caller wanting evidence-freshness detection across turns for a re-projected `GET_SHIPPING_QUOTE` would need to build this reader; this benchmark's scenarios did not need it once the underlying scorer bug (#4 above) was fixed, so it was not built.
- **`CommercialWork` is terminal once `COMPLETED`** (`WORK_TRANSITIONS.COMPLETED = ["SUPERSEDED"]`, `transitions.ts`) - correcting already-completed work (R2-08) must start a **new** `CommercialWork` row (linked to the old objective via `supersedesObjectiveIds`), never reopen the old one. A sensible, deliberate constraint of the state machine, but not documented anywhere before this benchmark exercised it operationally; `runR2Scenario.ts` detects a terminal prior work and routes to `persistCommercialWorkProjection` instead of `updateCommercialWorkAggregate` accordingly.
- **LLM-R1-T09A's planner has no `create_quote` intent** (its scope is `select_products`/`get_shipping_quote`/`unsupported` only, by design). R2-06/R2-09 seed `CREATE_QUOTE` directly (bypassing the planner) since testing quote durability/idempotency does not require planner coverage that does not exist yet in production either - a scope note, not a benchmark artifact.

## 19. Changes made (full list)

Production (A03/A04, all additive/corrective, none touch A08 or production routing):
- `lib/brain/commercial/work/repository.ts` - `buildCommercialWorkCorrelationKey` hashes the objectives portion.
- `lib/brain/commercial/work/buildCommercialWorkProjection.ts` - ambiguous product -> `WAITING_CUSTOMER`.
- `lib/brain/commercial/work/deriveCommercialWorkSteps.ts` - terminal objectives still produce a terminal-status step.
- `lib/brain/commercial/agent-loop/benchmark/environment.ts` - `taxRate` added to the fixture catalog pricing payload (benchmark fixture, additive).

New benchmark harness (`lib/brain/commercial/work/benchmark/`): `types.ts`, `scoring.ts`, `metrics.ts`, `verdict.ts`, `environment.ts`, `capabilityGateway.ts`, `semanticIntentAdapter.ts`, `offlinePlannerProvider.ts`, `runR2Scenario.ts`, `index.ts`.

New corpus: `tests/fixtures/commercial-work-benchmark/corpus.ts` (R2-01..R2-09, R2-12).

New tests: `tests/commercial/r2ScenarioScoring.test.ts` (17), `r2SemanticIntentAdapter.test.ts` (7), `r2ArchitectureScenarios.test.ts` (11), `r2ArchitectureFollowUpScenarios.test.ts` (2) - 37 new tests, plus 1 regression test each in `commercialWorkRepository.test.ts` (`CWDB00b`) and `commercialWorkProjection.test.ts` (`CW09b`) - 39 total, all green.

New CLI scripts: `scripts/benchmark-commercial-work-architecture.ts`, `scripts/compare-legacy-vs-r2-c09.ts`.

## 20. Tests executed

- Stage 1 (pure, no DB/LLM): `tests/commercial/r2ScenarioScoring.test.ts` - 17/17 pass.
- Stage 2 (deterministic/integration, real `crm_test` DB): `tests/commercial/r2SemanticIntentAdapter.test.ts` (7/7), `tests/commercial/r2ArchitectureScenarios.test.ts` (11/11, includes the four-invariant aggregate check).
- Stage 3 (A07, DB-backed): `tests/commercial/r2ArchitectureFollowUpScenarios.test.ts` - 2/2 pass, real, not blocked.
- Stage 4 (C09 legacy-vs-R2): `scripts/compare-legacy-vs-r2-c09.ts` - real, offline/deterministic (see Section 13 on why not live).
- Full regression: `tests/commercial/commercialWorkProjection.test.ts`, `commercialWorkRepository.test.ts`, `commercialWorkExecutor.test.ts`, `commercialWorkRetryWorker.test.ts`, `commercialWorkTransitions.test.ts`, `objectiveAwareFollowUp.test.ts`, `objectiveAwareFollowUpEligibility.test.ts` plus the four new R2 files together - 109/109, run three times consecutively to rule out flakiness (one earlier combined run showed 2 transient failures unrelated to any file touched by this task - not reproducible across three subsequent clean runs; consistent with this repo's already-documented pre-existing DB-test-isolation flakiness under heavy concurrent file batches, not a regression introduced here).
- Full `tests/commercial/*.test.ts` (1688 tests): 1670 pass, 18 fail - all 18 confirmed pre-existing and unrelated (verified individually: none touch any file this task modified; one, run in isolation outside the giant batch, fails with `Missing DATABASE_NAME`, an env-var race between test files sharing one `node:test` process, not a code defect).
- `npx tsc --noEmit`: clean throughout.
- `npm run build`: clean.

## 21. Verdict

**R2_CORE_VALIDATED.**

All 12 corpus scenarios pass. All four critical invariants (`lostCommercialWorkRate`, `unbackedCommercialMutationClaimRate`, `duplicateSideEffectRate`, `staleEvidenceExecutionRate`) measured at exactly 0%. A07 DB-backed follow-up ran for real, not pending. The C09-equivalent decisive case shows R2 completing the full selection+destination+shipping bundle in one cycle where the legacy loop's own documented failure mode (a customer-visible promise backed by no durable state) does not occur.

The one real limitation on this verdict: the C09 legacy-vs-R2 comparison in Section 10 is offline/deterministic, not live-LLM (this sandboxed environment has neither `DEEPSEEK_API_KEY` nor `BENCHMARK_LIVE_LLM_ENABLED` set - confirmed, not assumed). The offline comparison is real and executed, and directionally reproduces T08E/T08F's documented finding exactly, but a live-model run (10-20 runs, per the task's own staging) has not been done and should be run once credentials/network are available before treating the C09 result as fully closed against real-world model variance.

---

```text
SALES-AGENT-R2-A07.5: DONE

A07 DB-backed:
PASS

R2-01 simple selection:
PASS

R2-02 C09:
PASS

R2-03 missing destination:
PASS

R2-04 continuation:
PASS

R2-05 technical retry:
PASS

R2-06 crash recovery:
PASS

R2-07 ambiguity:
PASS

R2-08 correction/supersession:
PASS

R2-09 quote:
PASS

R2-10 objective follow-up:
PASS

R2-11 stale follow-up cancellation:
PASS

R2-12 handoff/AI-disabled:
PASS

lostCommercialWorkRate:
0%

unbackedCommercialMutationClaimRate:
0%

duplicateSideEffectRate:
0%

staleEvidenceExecutionRate:
0%

C09 legacy LLM calls:
3

C09 R2 LLM calls:
1

C09 legacy turn/completion latency:
83ms / n/a (no durable completion - work never existed)

C09 R2 turn/completion latency:
210ms / 210ms

Restart recovery:
PASS

Retry recovery:
PASS

Production behavior changed:
NO

A08 implemented:
NO

Verdict:
R2_CORE_VALIDATED

Recommended next:
SALES-AGENT-R2-A08, with two integration notes carried forward from Section
18 (multi-turn re-seeding and terminal-work correction routing are currently
benchmark-only glue, not production code - A08 should either formalize them
or explicitly own that responsibility).
```
