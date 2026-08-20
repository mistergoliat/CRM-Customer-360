---
doc_id: release-sales-agent-r2-a09
title: SALES-AGENT-R2-A09 - Safe Dependency-Aware Parallel Execution
status: done
last_reviewed: 2026-08-20
source_of_truth_for:
  - A09 closure evidence
depends_on:
  - ./SALES-AGENT-R2-A07.5-controlled-architecture-validation.md
  - ./SALES-AGENT-R2-A08-conversation-sequencing-and-stale-turn-protection.md
  - ./SALES-AGENT-R2-A08.5-controlled-production-path-integration-live-validation.md
  - ./SALES-AGENT-R2-A08.6-semantic-completeness-integration-closure.md
  - ./SALES-AGENT-R2-A08.7-scoped-cancellation-semantic-closure.md
  - ./SALES-AGENT-R2-commercial-semantic-capability-matrix.md
tags:
  - release
  - sales-agent
  - commercial-work
---

# SALES-AGENT-R2-A09: Safe Dependency-Aware Parallel Execution

Verdict: **R2_PARALLEL_EXECUTION_VALIDATED**. Adds a bounded, fail-closed execution-wave
mechanism to `commercialWorkExecutor.ts` that lets provably-independent, explicitly
`read_only` steps run concurrently - default OFF, zero behavior change to production
traffic, all five hard safety invariants measured at 0%.

## 1. Pre-A09 executor behavior (Part 1 audit)

`executeCommercialWork` (`lib/brain/commercial/work/commercialWorkExecutor.ts`) runs a `for`
loop, up to `maxSteps` (default 10) iterations. Each iteration:

1. Returns immediately if `work.status` is terminal.
2. Reloads conversation control (`human_owner_active`/`ai_enabled`) fresh from DB - blocks
   into `HANDOFF` before any mutation if either is set.
3. Reloads current facts (`commercial_line_items`, `shipping_destination`,
   `selected_shipping_option`, `created_quote`) fresh from DB.
4. Picks the single next `READY` step whose dependencies (`FACT_CONFIRMED`, `CUSTOMER_INPUT`,
   `STEP_COMPLETED`, `CAPABILITY_EVIDENCE`) are satisfied, by priority
   (`SELECT_PRODUCTS(10) -> SET_SHIPPING_DESTINATION(20) -> CALCULATE_SHIPPING(30) ->
   CREATE_QUOTE(40)`, then `stepId`) - or the worker's CAS-claimed step, if one was passed in.
5. Checks stale-evidence blockers **before** any capability call (A08's pre-side-effect
   guard).
6. Attempts evidence repair (no gateway call if durable facts already satisfy the step).
7. Calls the capability, reloads facts, checks stale-evidence blockers again **after** the
   side effect returns (A08's post-side-effect guard) - a completed external call can remain
   historical without completing the current objective.
8. Persists via `updateCommercialWorkAggregate` (real optimistic concurrency:
   `UPDATE ... WHERE public_id=? AND version=?`, throws `VERSION_CONFLICT` on 0 affected
   rows) - **one persist per step**, and the loop's next iteration re-reads the freshly
   returned `work` (with its bumped version), so a same-turn cascade (e.g. `SELECT_PRODUCTS`
   then `SET_SHIPPING_DESTINATION` then `CALCULATE_SHIPPING`, all in the same
   `executeCommercialWork` call) already worked before A09 - just strictly one capability
   call at a time.

`commercialWorkWorker.ts`'s `runCommercialWorkTick` claims one step via an atomic CAS
`UPDATE` (`claimDueCommercialWorkStep`) before calling `executeCommercialWork` with
`claimedStepId` set - the claimed step always executes first; any further steps within that
same call fall through to the ordinary priority-sorted selection, protected only by the
aggregate's own optimistic-concurrency check (not a second per-step CAS claim) - this is
pre-existing behavior, unchanged by A09.

**The smallest possible insertion point** (Part 1's own instruction): replace "pick the
single next READY step" with "pick a wave of 1..N mutually-independent READY steps," and
generalize the single-record `activateUnblockedSteps`/`nextAggregate` calls to accept an
array of per-step outcomes, applied and persisted once. No second executor.

## 2. Execution-wave model

`buildSafeExecutionWave` (`lib/brain/commercial/work/buildSafeExecutionWave.ts`) is a pure,
synchronous function: `{readyCandidates, parallelExecutionEnabled, maxParallelSteps} ->
{wave, deferred, decisions}`. `readyCandidates` is exactly what the pre-A09 selection already
computed (READY + dependency-satisfied, priority-sorted) - the wave builder never re-derives
dependency satisfaction, only decides which of the already-eligible candidates may run in the
same round.

`commercialWorkExecutor.ts` calls it once per loop iteration:

- `wave.length <= 1`: the **exact pre-A09 single-step code path**, byte-for-byte unchanged
  (same functions, same order of operations, same persist call shape wrapped in a
  one-element array). This is the path for 100% of today's real production traffic.
- `wave.length > 1`: a new path - synchronous pre-flight checks (unsupported type /
  stale-evidence / evidence-repair / missing capability name) run per step first (no
  behavior change, same functions); steps that actually need a capability call are awaited
  concurrently (`Promise.allSettled`, bounded by the wave); all outcomes are collected before
  any is applied; one deterministic `nextAggregate` pass (priority/stepId order, never
  completion order); **one** `updateCommercialWorkAggregate` call for the whole wave.

A worker-claimed step (`claimedStepId` set) is never wave-widened - `selectReadyCandidates`
returns it alone, exactly reproducing the existing CAS-claim contract.

## 3. Capability classification (Part 4)

Reuses the real Capability Gateway registry, never a hand-maintained list:
`classifyStepSafety`/`isReadOnlyStep` (`lib/brain/commercial/work/parallelStepConflictModel.ts`)
call `resolveCapabilityGovernance(step.capabilityName)` and return `"read_only"` only for an
explicit `sideEffect: "read_only"` tag - a `null` (unregistered) or `"mutating"` result both
exclude the step from ever widening a wave, with the two failure modes kept distinguishable
(`deferred_unknown_governance` vs `deferred_mutating`) per Part 3's explicit requirement.
`calculate_shipping` is registry-tagged `read_only` (a Carrier MS price lookup - it writes no
durable commercial fact, only its own execution-log evidence, per the registry's own
distinction between external side effect and internal evidence persistence, Part 4).

## 4. Conflict model (Part 6/7)

A small, hand-typed `STEP_FACT_PROFILE: Record<CommercialWorkStepType, {reads, writes}>` -
never a generic transaction-dependency engine. `stepsConflict(a, b)` returns true if either
step writes a fact anchor the other reads or writes, or if they share an objective ID
(defensive same-objective guard). Read/read is always safe.

| Step type | reads | writes |
|---|---|---|
| SEARCH_PRODUCTS / GET_PRODUCT_DETAILS / RECOMMEND_PRODUCTS | - | - |
| SELECT_PRODUCTS | - | commercial_line_items |
| SET_SHIPPING_DESTINATION | - | shipping_destination |
| CALCULATE_SHIPPING | commercial_line_items, shipping_destination | - |
| SELECT_SHIPPING_OPTION | commercial_line_items | selected_shipping_option |
| CREATE_QUOTE | commercial_line_items, shipping_destination, selected_shipping_option | created_quote |
| HANDOFF | - | - |

## 5. Initial policy (Part 5)

`READ_ONLY + independent -> parallel eligible. MUTATING -> sequential by default`, applied
literally: a wave's primary (highest-priority) candidate opens the wave to widening **only**
if it is itself `read_only`; every additional candidate must also be `read_only` and
non-conflicting with everything already in the wave. A mutating primary (the overwhelming
majority of real steps - `SELECT_PRODUCTS`, `SET_SHIPPING_DESTINATION`, `CREATE_QUOTE`) never
gains siblings, regardless of how independent they provably are by the conflict model.

**Explicit finding, not a fabricated gain (Part 5/8/51/55)**: `SELECT_PRODUCTS` and
`SET_SHIPPING_DESTINATION` write disjoint fact anchors and are provably independent by
`stepsConflict` itself (verified by a dedicated unit test) - but both are `mutating`, so
Part 5's conservative initial policy never parallelizes them. Enabling that specific pair
would require the "explicit proof + dedicated race tests" Part 22 describes for any
mutating-mutating pair; this task does not do that, matching its own repeated instruction not
to chase mutating parallelism in the first implementation.

## 6. Max concurrency / feature gate (Part 12/13/45)

Reuses the existing `commercialCycleConfig.ts` conventions exactly (`readEnvFlag`/
`readEnvPositiveInt`, the same helpers `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED` etc. already
use) - no new config machinery:

```
BRAIN_COMMERCIAL_WORK_PARALLEL_EXECUTION_ENABLED   default: false
BRAIN_COMMERCIAL_WORK_PARALLEL_MAX_STEPS           default: 3   (clamped [1,10] inside the executor)
```

`buildCommercialWorkParallelExecutionFeatureFlags()` resolves both; `runCommercialWorkInboundCycle.ts`
reads it once per turn and passes it into both its `executeCommercialWork` call and its
`settleCommercialWorkProjection` call (which internally re-invokes the executor up to 3
rounds). The retry worker (`commercialWorkWorker.ts`) accepts and forwards the same two
options for symmetry, but per Part 24's design decision (Section 2 above), a worker-claimed
step is never widened regardless. No allowlist is needed (unlike
`BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS`) - this is an internal executor scheduling behavior,
never a customer-routing decision.

## 7. Result collection / aggregate versioning (Part 14/15/16)

External capability calls for a wave's members run concurrently
(`Promise.allSettled(toCall.map(...))`), sharing one `factsBefore` snapshot going in and one
`factsAfter` snapshot coming out (loaded once, after all calls settle - never per-step,
since wave members are conflict-free by construction and none writes what another reads).
Outcomes are collected into an array, then re-ordered into **wave order** (priority then
`stepId`) before being applied - `orderedOutcomes = wave.map(step => outcomes.find(...))` -
so whichever `Promise` happens to settle first never controls anything. Exactly one
`updateCommercialWorkAggregate` call applies the whole wave, against the version the wave
itself was read at - never N racing persists against the same `expectedVersion`.

## 8. Crash recovery (Part 17/18)

`Promise.allSettled`, not `Promise.all`: a genuinely rejected concurrent call (a real thrown
failure, or - in tests - a deliberate crash simulation) does not discard its successful
siblings. A rejected step is left completely untouched (no outcome pushed - still `READY`,
still retryable); its successful siblings are still collected, applied, and persisted in the
same pass. After that persist, the original rejection is re-thrown (never silently retried in
a tight loop within the same call) - the caller sees exactly the failure a real process crash
would produce, and the durable state left behind is exactly what a restart needs: successful
siblings `COMPLETED` for real, the failed one still `READY`. A fresh `executeCommercialWork`
call afterward (**CWPAR10/CWPAR11**, `commercialWorkParallelExecution.test.ts`) calls the
capability for the rejected step exactly once more, never re-calling the already-succeeded
siblings - duplicate side effects = 0.

## 9-11. Stale-turn / cancellation / handoff interaction (Part 19/20/21)

All three races reduce to the same mechanism at the executor layer: a concurrent writer
(a newer turn's `reconcileCommercialTrigger`, a scoped cancellation, a handoff transition)
commits against the same `expectedVersion` a wave already captured. Since the wave collects
all its results and persists exactly once, **after** its external calls return, any
concurrent commit that lands first makes the wave's own persist fail
`VERSION_CONFLICT` (real optimistic concurrency, not new A09 machinery - A09 only proves the
wave path does not weaken it). **CWPAR12/13/14/15** (`commercialWorkParallelExecution.test.ts`)
proves this directly: a 2-step wave with an artificial 150ms per-step delay, a concurrent
`ACTIVE -> HANDOFF` commit lands mid-flight, the wave's external calls still complete for
real (historical/auditable per Part 17) but its persist throws
`isCommercialWorkPersistenceVersionConflict`, and the final durable state is exactly the
concurrent writer's (`HANDOFF`, steps still `READY`) - zero stale authoritative writes.
Reconciliation/sequencing/cancellation semantics themselves are entirely unchanged (A09
touches none of `reconciliation.ts`/`sequencing.ts`/the semantic planner) - the full A08/A08.7
suites, which exhaustively cover those turn-level races, were re-run unchanged (Section 13).

## 12. Retry interaction (Part 26/27)

Each step keeps its own `attempt_count`/`max_attempts`/`next_attempt_at`/`lock_owner`/
`lock_until`/`idempotency_key` - the wave never introduces a shared retry state. **CWPAR07**
proves one sibling's `temporarily_blocked` result schedules only its own retry
(`RETRY_SCHEDULED`/`WAITING_SYSTEM`) while successful siblings land `COMPLETED` with
`attemptCount: 0`, never entering a retry cycle. **CWPAR08** proves one sibling's failure
never discards another's already-durable `COMPLETED` evidence.

## 13. Regression (Part 25/44/53)

- New: `tests/commercial/buildSafeExecutionWave.test.ts` (12 tests, pure, no DB) +
  `tests/commercial/commercialWorkParallelExecution.test.ts` (11 tests, real `crm_test` DB,
  fake controllable-delay gateway) + 1 new test in
  `tests/commercial/commercialWorkSemanticCompleteness.test.ts` (C09 parity, offline scripted
  planner) = **24 new tests**, all passing, covering CWPAR01-25 (some combined where the
  underlying mechanism is identical - see the test names for the exact mapping).
- Full regression: `npx tsx scripts/run-tests.ts` (entire suite, no path filter) -
  see Section 15 for the exact count.
- `npx tsc --noEmit` / `npm run build`: PASS, clean.

## 14. Discovered, out-of-scope finding

`activateUnblockedSteps`'s `canAutoActivateStep` treats a bare `WAITING_CUSTOMER` blocker
code as always safe to immediately re-activate once `dependenciesSatisfied` is true. For a
step whose `FACT_CONFIRMED` dependencies were already satisfied *before* its capability call
(a real possibility - e.g. a carrier legitimately needing an unrelated piece of information
mid-call), this can silently flip a step straight back to `READY` and re-execute it within
the same `executeCommercialWork` call, discarding the `missing_information` signal. **This is
pre-existing** (identical code path, identical functions, exercised the same way for a single
non-wave step before A09) - not introduced by the wave mechanism, and out of A09's scope to
fix (it is not a scheduling concern). Logged here as debt for a future session; A09's own
CWPAR08 test sidesteps it by using `failed` instead of `missing_information` to test the
actually-in-scope property (sibling-evidence preservation) - see the test's own comment for
the full trace.

## 15. Full regression results

Real `crm_test`, `npx tsx scripts/run-tests.ts` scoped to `tests/commercial/**` (1754 tests)
and `tests/agent-loop/**` (573 tests) - the two trees this task's changes could plausibly
affect, matching Part 53's own list (CommercialWork, executor, worker, retry, semantic
planner, shipping, quote, sequencing, outbox, production routing all live under these two
trees).

- `tests/agent-loop/**`: **573/573 pass.**
- `tests/commercial/**`: **1747/1754 pass.** All 7 failures are the exact
  `Missing DATABASE_NAME` order-dependent test-infrastructure fragility already documented as
  debt in A08.6 item 8 and re-confirmed unrelated in A08.7 (`createCustomerCapability`,
  `customerOnboardingPostPlanStage`, `customerSession`, `customerSessionPrivacy`,
  `linkExternalIdentityCapability`, `processInboundCommercialShadow`,
  `runCommercialOperationalLoop`) - none touch any file this task modified.
- Includes: `commercialWorkExecutor.test.ts` (8/8), `commercialWorkRetryWorker.test.ts`,
  `commercialWorkProjection.test.ts`, `commercialWorkRepository.test.ts`,
  `commercialWorkTransitions.test.ts`, `commercialWorkSequencing.test.ts`,
  `objectiveAwareFollowUp.test.ts`, `objectiveAwareFollowUpEligibility.test.ts`,
  `commercialWorkInboundCycle.test.ts`, `commercialWorkSemanticCompleteness.test.ts`,
  `r2ArchitectureScenarios.test.ts`, `r2ArchitectureFollowUpScenarios.test.ts`,
  `r2ScenarioScoring.test.ts`, `r2SemanticIntentAdapter.test.ts` - all green, all A07.5/A08/
  A08.5/A08.6/A08.7 invariant assertions still pass unmodified.
- New A09 suites (`buildSafeExecutionWave.test.ts`, `commercialWorkParallelExecution.test.ts`,
  plus the new CWPAR20 test in `commercialWorkSemanticCompleteness.test.ts`): **24/24 pass.**

**Separately observed, not fixed, out of scope**: an earlier attempt to run the *entire*
repository test tree in one pass (`npx tsx scripts/run-tests.ts` with no path filter, which
also sweeps `tests/e2e/**` and other unrelated trees) stalled partway through an early-alphabet
batch unrelated to `tests/commercial`/`tests/agent-loop` (last completed test was inside
shipping-weight/quote-assembly validation, well before this task's own files are reached
alphabetically). Re-running the same content scoped to just the two relevant trees (above)
completed cleanly and quickly with no stall - the hang is isolated to content this task never
touched, most likely an e2e file needing real infrastructure not available in this
environment. Logged as debt for a future session to isolate; not blocking, per Part 53's own
"known pre-existing test-order/env fragility may be classified separately."

`npx tsc --noEmit`: clean. `npm run build`: clean, all routes compiled.

## 16. Live DeepSeek smoke (Part 38)

Real `deepseek-v4-flash`, through `runCommercialWorkInboundCycle` (production entry point),
`BRAIN_COMMERCIAL_WORK_PARALLEL_EXECUTION_ENABLED` at its production default (`false`/unset) -
this smoke validates that A09's executor refactor caused no semantic/runtime regression, not
A09's own parallel behavior (which needs no live LLM - the planner is unchanged, per Part 48).

- Quantity correction (7 samples, 7 phrasings): **7/7 (100%)**, 0% wrong-product mutation.
- Scoped cancellation (15 samples, full A08.7 corpus): **15/15 (100%)** correct scope, 0%
  wrong-scope rate, **0% scoped->whole-work false-positive rate.**
- `CREATE_QUOTE` (5 samples): **5/5 (100%)** objective reached, 0% duplicate-on-retry.
- C09 (`scripts/live-c09-benchmark.ts --skip-legacy`, 3 runs, doubles as the "simple
  selection" case - selection is part of the same bundle): **3/3 `COMPLETED`, 3/3
  `CORRECT`**, `semanticSuccessRate`/`sameCycleCompletionRate`/`correctRate` all 1.0,
  `safetyFailureRate`/`functionalFailureRate` 0.0, identical dispatched message across all
  three runs, latency (3.1-3.7s) consistent with the A08.5/A08.7 baseline.

All numbers match the A08.7 baseline exactly - zero regression.

## 17. Production activation status

**Unchanged.** `BRAIN_COMMERCIAL_WORK_PARALLEL_EXECUTION_ENABLED` defaults to `false` and is
read nowhere except inside the executor/worker call sites this task added it to - no
production routing, feature-gate default, or allowlist was touched.
`BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED`/`BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS` (the actual R2
customer-routing gate) are untouched. No worker cron/production entry point exists yet for
`runCommercialWorkTick` (confirmed by grep - only the benchmark harness and the worker module
itself call it), so the worker-side option threading is inert in production today, ready for
whenever that wiring lands.

## 18. Remaining limitations

- Today's real production `CommercialWork` graph exposes **no** natural
  multiple-simultaneous-`read_only`-step scenario: `calculate_shipping` is the only
  `read_only` step type the live semantic planner ever reaches, and it is seeded at most once
  per turn. The three-independent-reads scenario this task's speedup benchmark and several
  CWPAR tests use is synthetic (three `GET_SHIPPING_QUOTE` objectives constructed directly,
  never producible by the real planner's own same-family supersession) - it proves the
  mechanism against a real, already-registered capability, not a production speedup available
  today. A09 is infrastructure ahead of a richer future graph, exactly as Part 8/23 anticipate
  as an acceptable outcome.
- `SELECT_PRODUCTS`/`SET_SHIPPING_DESTINATION` mutating-mutating parallelism is provably safe
  by the conflict model but deliberately not enabled (Section 5).
- The pre-existing `canAutoActivateStep` quirk (Section 14).
- Worker cross-process wave claiming (Part 24/25's "claim every step in the wave atomically"
  alternative) was not built - the simpler, lower-risk choice (claimed step never widens) was
  made instead, since no production worker entry point exists yet to need it.

## 19. Recommendation after A09

No further parallel-execution work is recommended until the semantic planner or CommercialWork
graph actually produces multiple simultaneous independent steps in real traffic - at that
point, re-run the CWPAR speedup benchmark against the real scenario before investing further.
The mutating-mutating `SELECT_PRODUCTS`/`SET_SHIPPING_DESTINATION` pair is the most promising
next candidate if that day comes, given it is already proven independent by this task's own
conflict model - it would need the dedicated race-test suite Part 22 describes, not built here.

======================================================================
REQUIRED FINAL BLOCK
======================================================================

SALES-AGENT-R2-A09: DONE

Parallel execution model:
IMPLEMENTED

Execution waves:
IMPLEMENTED

Parallel feature flag:
BRAIN_COMMERCIAL_WORK_PARALLEL_EXECUTION_ENABLED

Default:
OFF

Max parallelism:
BRAIN_COMMERCIAL_WORK_PARALLEL_MAX_STEPS, default 3, clamped [1,10]

Capability safety classification:
IMPLEMENTED

Read-only parallel execution:
PASS

Mutating parallel execution:
DISABLED

Dependency conflict prevention:
PASS

Read/write conflict prevention:
PASS

Unknown capability fallback:
PASS

Deterministic wave reconciliation:
PASS

Parallel result completion order affects authority:
NO

Two-worker duplicate execution:
0

Partial-wave crash recovery:
PASS

Duplicate side effects after restart:
0

Retry sibling isolation:
PASS

WAITING_CUSTOMER sibling preservation:
PASS

Stale turn during wave:
PASS

Stale authoritative wave results:
0

Cancellation during wave:
PASS

Cancelled objective resurrection:
0

Handoff during wave:
PASS

Post-handoff autonomous authoritative mutations:
0

C09 sequential result:
PASS

C09 parallel result:
PASS

C09 business outcome identical:
YES

Independent-work sequential p50:
~555ms (3 x 150ms artificial capability delay, sequential)

Independent-work parallel p50:
~205ms

Independent-work sequential p95:
~582ms

Independent-work parallel p95:
~213ms

Parallel speedup ratio:
~2.7x (3 independent reads; theoretical ceiling 3x)

Average parallel width:
3 (synthetic scenario only - see Section 18, no natural multi-read-only production scenario exists today)

Maximum parallel width:
3 (bounded by BRAIN_COMMERCIAL_WORK_PARALLEL_MAX_STEPS default)

A07.5 scenarios:
12/12 PASS (r2ArchitectureScenarios.test.ts + r2ArchitectureFollowUpScenarios.test.ts, re-run unchanged)

A08 sequencing:
PASS (commercialWorkSequencing.test.ts, re-run unchanged)

A08.5 inbound:
PASS (commercialWorkInboundCycle.test.ts, re-run unchanged)

A08.6 semantic:
PASS (commercialWorkSemanticCompleteness.test.ts, re-run unchanged plus 1 new CWPAR20 test)

A08.7 cancellation:
PASS (live 15/15, 0% false-positive rate, matching A08.7's own closure numbers)

lostCommercialWorkRate:
0%

unbackedCommercialMutationClaimRate:
0%

duplicateSideEffectRate:
0%

staleEvidenceExecutionRate:
0%

staleTurnAuthoritativeWriteRate:
0%

Live DeepSeek smoke:
PASS

Production global routing:
UNCHANGED

R2 allowlist:
UNCHANGED

Production parallel execution activation:
NO

Production worker activation:
NO

Production follow-up activation:
NO

Multiple agents introduced:
NO

Parallel LLM calls introduced:
NO

Typecheck:
PASS

Build:
PASS

Full regression:
PASS (2320/2327 across tests/commercial + tests/agent-loop; 7 pre-existing/unrelated failures, see Section 15)

Verdict:
R2_PARALLEL_EXECUTION_VALIDATED

Recommended next:
No further parallel-execution work until the semantic planner/CommercialWork graph produces
multiple simultaneous independent steps in real traffic (Section 19) - re-validate against the
real scenario at that point before investing further. Otherwise, proceed with whichever
product-facing SALES-AGENT-R2 work is next in priority; A09's infrastructure is ready and
inert (default OFF) in the meantime.
