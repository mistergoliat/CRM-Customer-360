---
doc_id: release-sales-agent-r2-a08-5
title: SALES-AGENT-R2-A08.5 - Controlled Production-Path Integration and Live LLM Validation
status: done
tags:
  - release
  - sales-agent
  - commercial-work
---

# SALES-AGENT-R2-A08.5: Controlled Production-Path Integration and Live LLM Validation

## 1. Current inbound path before change

```
app/api/integrations/whatsapp/webhook/route.ts (POST)
  -> isAllowedRecipient (BRAIN_WHATSAPP_ALLOWED_WA_IDS union BRAIN_AUTONOMOUS_TEST_WA_IDS)
  -> processNativeWhatsAppInbound (lib/brain/native-whatsapp/service.ts)
       -> dedupe by (provider="meta", providerMessageId) BEFORE any write
       -> persist conversation/conversation_message/commercialEvent (1 txn)
       -> ensureAutonomousSalesTurnContinuity
            -> runNativeAutonomousCycle
                 Step 0/0.5: pilot allowlist + opt-out gates
                 Step 1: pick ONE runtime - multiRequest > agentToolLoop > legacy shadow/loop/bridge
                 Step 3: resolveNativeCustomerSession + Customer 360 (gated)
                 Step 4/5: run the selected runtime
```

Production traffic never touched CommercialWork (`lib/brain/commercial/work/`) - it only ran inside
benchmark/test harnesses (A01-A08).

## 2. Controlled R2 routing (this task)

`runNativeAutonomousCycle.ts`'s Step 1 runtime-selection block gained a new, highest-priority branch,
checked before `multiRequestEnabled`/`agentToolLoopEnabled`:

```ts
const commercialWorkEnabled = shouldRouteToCommercialWork(input.waId);
if (!multiRequestEnabled && !agentToolLoopEnabled && !commercialWorkEnabled) { /* unchanged early-exit gate, now also checks commercialWorkEnabled */ }
...
if (commercialWorkEnabled) {
  const rawSnapshot = await buildNativeCommercialContext({ conversationPublicId, currentTime });
  // not_found guard, same as the agentToolLoop branch
  const resolvedSalesAgentConfiguration = await resolveSalesAgentConfiguration(); // same config resolution, config-failure -> reuses the existing handoff
  const result = await runCommercialWorkInboundCycle({ snapshot, waId, messageText, ... });
  return { ran: result.ran, reason: result.reason, commercialWork: result, ... };
}
if (multiRequestEnabled) { /* unchanged */ }
if (agentToolLoopEnabled) { /* unchanged */ }
/* legacy - unchanged */
```

Because this is a hard `if`+`return` chain (never try-then-fallback), an allowlisted turn is fully owned
by R2 for that turn - it structurally cannot also run multi-request/Agent-Tool-Loop/legacy for the same
inbound. Non-allowlisted traffic reaches this `if` check, evaluates false, and falls through to the exact
same code that ran before this task - byte-identical.

## 3. Feature flag / allowlist

New, following the exact `shouldRouteToMultiIntentPlanner` (LLM-R1-T09B) pattern:

- `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED` (default `false`) - `commercialCycleConfig.ts#buildCommercialWorkRuntimeFeatureFlags`.
- `BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS` (default empty) - dedicated allowlist, `autonomousRuntimeConfig.ts#loadCommercialWorkRuntimeAllowlist`. Deliberately independent of `BRAIN_AUTONOMOUS_TEST_WA_IDS` (the multi-intent pilot's own allowlist) - enabling one pilot never silently enables the other (verified by a dedicated unit test).
- `shouldRouteToCommercialWork(waId, env)` - flag AND non-empty allowlist AND membership, fails closed on an empty allowlist even with the flag on.

Both documented in `.env.example`, defaulted off/empty. **A real, load-bearing gap this task found and
closed operationally, not just in code: migrations 029-031 (the entire `crm_commercial_work*` schema) had
never been applied to this environment's real dev database (only to `crm_test`) - the first live R2 write
against it threw on every turn until `npm run db:migrate` was run. Applying migrations before enabling this
flag anywhere is a hard operational precondition, now called out explicitly here since nothing in code can
enforce it.**

## 4. Semantic planner integration

`lib/brain/commercial/work/semanticIntentAdapter.ts#planCommercialObjectiveSeeds` - promoted, logic
unchanged, from `work/benchmark/semanticIntentAdapter.ts` (A07.5). One real LLM call per turn: loads
pending intents (`crm_request_facts`) -> builds the real multi-intent planner prompt
(`buildIntentPlannerPromptPackage`, LLM-R1-T09A) -> invokes the given `AgentLoopProvider` -> parses ->
resolves (`resolveCommercialIntentPlan`, deterministic) -> maps `ResolvedIntent[]` to
`CommercialObjectiveSeed[]` (the production mapper, unchanged). Provider-agnostic - the production entry
point hands it the real DeepSeek provider (`createHttpAgentLoopProvider` + `resolveSalesAgentConfiguration()`,
identical config resolution the Agent Tool Loop already uses). Live-measured at exactly 1 LLM call per
turn across every run in this task (avgLlmCalls: 1, both benchmark and smoke).

Validated mapping, live, against real DeepSeek: `SELECT_PRODUCTS`, `SET_DESTINATION` (derived from a
`get_shipping_quote` intent's explicit destination), `GET_SHIPPING_QUOTE`.

**CREATE_QUOTE semantic coverage: MISSING.** The multi-intent planner (`lib/brain/commercial/multi-intent/types.ts`)
only defines `select_products`/`get_shipping_quote` intents - confirmed unchanged from A07.5's own finding.
None of this task's required scenarios ask the agent to create a quote, so there is no "smallest necessary
extension" this task needed to make. The CommercialWork *executor* already supports a `CREATE_QUOTE`
objective/step/capability - only the semantic planner can't produce that seed from customer text yet. Left
explicitly untouched.

**Also newly found, live, and worth flagging precisely: the planner has no cancellation vocabulary either.**
`CommercialObjectiveSeed` supports a `{kind:"cancel"}` variant in `work/types.ts`, but nothing in the
semantic adapter ever produces one - `commercialObjectiveSeedsFromResolvedIntent` only ever returns
`select_products`/`get_shipping_quote`-shaped seeds. See Part 17 result below.

## 5. Sequence/reconciliation path

Unchanged from A08 - `assignCommercialTriggerSequence` (per-inbound dedupe + monotonic sequence
allocation) -> `reconcileCommercialTrigger` (create/update/stale_ignored target resolution + objective
carry-forward/supersession). This task's contribution is calling these from a real inbound for the first
time, not changing their logic. Live-verified: a duplicate `inboundMessageId` sent twice through
`runCommercialWorkInboundCycle` reused the same `commercialSequence`/work `publicId` both times
(deterministic test, `tests/commercial/commercialWorkInboundCycle.test.ts`).

## 6. Executor path

Unchanged from A05/A06 - `executeCommercialWork` (default `executeCapability` = the real
`executeGovernedCapability`, the same gateway the legacy loop uses - no second executor) followed by the
newly-promoted `settleCommercialWorkProjection` (moved, unchanged in behavior, from
`work/benchmark/runR2Scenario.ts`'s local `settleProjection` - the promoted version reloads *real*
conversation control via the executor's own `defaultLoadConversationControl`, instead of the benchmark's
hardcoded always-unblocked fixture).

`maxSteps` stays at `executeCommercialWork`'s existing default (10, clamped [1,50]) - a deterministic
execution-count bound, unrelated to the legacy Agent Tool Loop's `maxToolExecutions` (an LLM
tool-call-budget concept). No code change was needed to avoid inheriting it - the two concepts were never
connected in this codebase.

**Real finding from live runs (WA-R2-01, WA-R2-04): the SELECT_PRODUCTS step's `CUSTOMER_INPUT/PRODUCT`
dependency check is satisfied by the mere presence of an unresolved `productReference` string** (see
`commercialWorkExecutor.ts`'s `dependencySatisfied`), not by real catalog evidence. When the planner
extracts a bare product reference with no prior `RecentCatalogContext` evidence, the step still becomes
`READY` and gets executed, landing on `invalid_arguments` from the capability itself rather than being
held `WAITING_CUSTOMER` with a clean clarifying question beforehand. This is a pre-existing A03-A05
executor/dependency-declaration property, not something A08.5 introduced or was in scope to redesign -
documented here because it's the first time it was exercised by real, unscripted customer text.

## 7. Finalizer path

New: `lib/brain/commercial/work/buildCommercialWorkFinalizerMessage.ts` classifies FINAL/PARTIAL/BLOCKED
from the persisted `CommercialWork` aggregate's own objective/step status fields only - never LLM
narration. A future-tense claim ("estoy terminando...") is emitted only when a matching step is durably
READY/RUNNING/RETRY_SCHEDULED/WAITING_SYSTEM in the aggregate at the moment the message is built.
Live-verified across every run: zero occurrences of a future-tense claim without a matching durable step
(`safetyFailureRate: 0` in the live C09 batch).

Known limitation: the aggregate carries product IDs/free-text references, never catalog product names - a
selection confirmation names the customer's own words when available (`objective.inputs.productReference`)
and otherwise a bare item count, never an invented product name.

## 8. Failure/fallback policy

`runCommercialWorkInboundCycle.ts`'s routing is a hard `if`+`return` in `runNativeAutonomousCycle.ts` - R2
and legacy structurally cannot both execute for one inbound (verified: legacy/agentToolLoop/multiRequest
never ran for any allowlisted turn in any live run in this task). Every internal failure mode resolves to
its own controlled dispatch:

- Sales Agent Configuration resolution failure: reuses the existing `runNativeAgentToolLoopCycleConfigurationFailure` handoff.
- No opportunity yet: controlled handoff-acknowledgement fallback (pre-existing gap shared by the whole Agent Tool Loop family, LLM-R1-T09B - R2 inherits it).
- Planner failure before planning: zero CommercialWork mutation, `model_unavailable` fallback dispatch (live-observed in multi-turn scenario B, turn 2 - see Part 11).
- Stale/out-of-order trigger: zero mutation, zero dispatch.
- Any other unexpected exception: caught inside `runCommercialWorkInboundCycle` itself, best-effort neutral handoff dispatch. **A real instance of this path fired during live validation** - before migrations 029-031 were applied to the real dev DB, every CommercialWork persistence attempt threw, and this catch-all correctly produced a controlled fallback rather than a 500 or a silent drop, though it also (correctly, per its own handoff semantics) transferred human control for that conversation. Added a `console.error` log for this path (matching `native_autonomous_cycle_failed`'s existing pattern) so a real occurrence is never silently invisible - that log is what surfaced the missing-migrations root cause in minutes instead of being invisible.

## 9. Live DeepSeek configuration used

- Provider: DeepSeek (`BRAIN_MODEL_API_URL=https://api.deepseek.com/...`).
- Model: `deepseek-v4-flash`. **`.env`'s `BRAIN_MODEL_NAME` was found set to `brain-knowledge` (not a valid
  DeepSeek model) at the start of this task - every call failed with a real HTTP 400 from DeepSeek until
  the user corrected it to `deepseek-v4-flash`.** Documented here as a real environment-configuration
  finding, not a code defect.
- Thinking mode: provider default (never set to `enabled`/`disabled` by this integration - matches production, which also never sets it outside the benchmark-only lever).
- Timeouts: R2 uses `resolvedSalesAgentConfiguration.effectiveModelConfiguration.timeoutMs` (safe default 20s) for its single planner call. The legacy comparison harness needed 90s per turn (see Part 10) for its own up-to-4-5 sequential calls - this is a benchmark-script parameter, not a production config change.
- Retries: `maxModelRetries` from the resolved Sales Agent Configuration (safe default 0); one real provider retry (`empty_response`) was observed and handled correctly during the live legacy runs.
- Max tokens / temperature: safe defaults (`maxOutputTokens: 1024`, `temperature: 0`) - never overridden by this task.

## 10. Live benchmark results (C09, 10 real DeepSeek runs per harness)

Message: "quiero 2 de la classic y saber cuanto sale el despacho a Ñuñoa". Both harnesses seeded with one
real prior search turn first (real `search_products` capability call, correlated via a real customer
inbound) so `SELECT_PRODUCTS`'s evidence requirement is met honestly, same precondition LLM-R1-T09B
already documented for the legacy loop.

**Legacy Agent Tool Loop** (`scripts/live-c09-benchmark.ts`, `--runs=10`):
- 10/10 `terminalReason: "responded"`, real grounded messages (real product name, real destination, real price $4.990, real 2-3 day estimate) in every run.
- avgLlmCalls: 4.1 (one real provider retry observed, `empty_response`, handled).
- turnLatency p50/p95: 33614ms / 76726ms.

**R2 (real production entry point, `processNativeWhatsAppInbound` -> routing -> `runCommercialWorkInboundCycle`, including the real finalizer/dispatch)**:
- 10/10 `workStatus: COMPLETED`.
- semanticSuccessRate: 100%. sameCycleCompletionRate: 100%. asyncCompletionRate: 0%.
- lostCommercialWorkRate: 0%. unbackedCommercialMutationClaimRate (safetyFailureRate): 0%. duplicateSideEffectRate: 0% (one work row per run, verified). staleEvidenceExecutionRate: 0%.
- Customer-visible audit (Part 23): 10/10 classified **CORRECT** - grounded, complete, no unbacked claims.
- avgLlmCalls: 1 (exactly, every run).
- turnLatency p50/p95: 4123ms / 6155ms. commercialCompletionLatency p50/p95: 4123ms / 6155ms (same values - every run completed same-cycle).

R2 was correct on every C09 run and ~8x faster at the median than the legacy loop, at 1 LLM call instead
of ~4.

## 11. Multi-turn results (R2 only, real DeepSeek, 1 run each - sample size caveat noted)

- **A (quantity then shipping)**: "quiero 2 Classic" -> COMPLETED; "y despacho a Nunoa" -> COMPLETED, real destination+shipping grounding. **PASS.**
- **B (quantity correction)**: "quiero 2 Classic" -> COMPLETED; "mejor 3" -> planner returned an invalid/unparseable plan (`commercial_intent_plan_intents_missing_or_empty`), correctly resolved to the `model_unavailable` fallback message (zero mutation, no unbacked claim) rather than crashing or guessing. **Real, reproducible finding** (the same "mejor 3" phrasing also failed in the WA smoke run, Part 14) - a bare quantity-correction turn is not reliably parsed by the planner today. **FAIL** as a *quantity correction* outcome (no correction happened), though the *safety* behavior (no false claim) was correct.
- **C (combined then destination change)**: both turns COMPLETED, destination correctly updated to "Las Condes" on turn 2. **PASS.**
- **D (cancellation)**: "quiero 2 Classic" -> COMPLETED; "olvidalo" -> work stayed COMPLETED (from turn 1), dispatched "Listo, tu solicitud quedó completada." **Root cause confirmed in Part 4: the semantic planner has no way to emit a cancel-type seed at all** - "olvidalo" is classified `unsupported` (dropped), not translated into a cancellation. The prior objective is never actually cancelled; the customer-facing message, while not literally false, doesn't acknowledge the cancellation request either. **FAIL.**

## 12. Retry/follow-up integration

- **Objective-aware follow-up (Part 19)**: live-verified in the WA smoke run (WA-R2-05, "cuanto sale el despacho" with no destination) - work correctly reached `WAITING_CUSTOMER`, a real clarifying question was dispatched ("¿A qué comuna necesitas el despacho?"), and a real `schedule_followup` row was created via the existing, unmodified A07 `scheduleObjectiveAwareFollowUp`. **PASS.**
- **Technical retry via the A06 worker (Part 18)**: the retry worker itself remains fully covered by A06's own regression suite (`commercialWorkRetryWorker.test.ts`, part of this task's regression run, green), and the new entry point correctly passes `scheduleRetries: true` into `executeCommercialWork` (code-verified). **This task did not add a new dedicated test driving a WAITING_SYSTEM step created via `runCommercialWorkInboundCycle` through a manual `commercial-work-worker-tick.ts` invocation to completion** - the manual script exists and is ready to use (Part 28), but the specific end-to-end wiring wasn't exercised by a new automated test. Marked **PARTIAL**, not fabricated as PASS.
- **Stale follow-up cancellation (Part 20)**: not exercised by a new dedicated test in this task either - same honest gap. **NOT_RUN.**

## 13. Sequencing/race validation

A08's own `commercialWorkSequencing.test.ts` (8/8, part of this task's regression run) already proves the
underlying `assignCommercialTriggerSequence`/`reconcileCommercialTrigger` ordering guarantees at the
module level, including the older-turn-cannot-overwrite-newer-state race. This task's new duplicate-inbound
test (`commercialWorkInboundCycle.test.ts`) proves the new entry point correctly plumbs into those
primitives. A new race-injection test *specifically through the new inbound entry point* (two concurrent
`runCommercialWorkInboundCycle` calls forced to interleave) was not added - **PASS via the module-level
guarantee plus entry-point plumbing verification, not a new dedicated concurrency test at this layer.**

## 14. Allowlisted WhatsApp smoke

`scripts/manual-test/whatsapp-r2-smoke.ts`, real DeepSeek, real `processNativeWhatsAppInbound` (the exact
function the webhook route calls), real dispatch/capability execution, **no real Meta send** (per explicit
user decision - dry-run evidence judged sufficient; the script supports `--real-send --to=<wa_id>` and is
ready whenever a real target number is provided).

| Case | Result |
|---|---|
| WA-R2-01 (open catalog search, no evidence) | `SELECT_PRODUCTS` FAILED (`invalid_arguments`) - see Part 6 dependency-check finding. Not a regression: same behavior seen for a genuinely evidence-free product reference. |
| WA-R2-02 (selection, seeded evidence) | COMPLETED/FINAL, grounded message. **PASS.** |
| WA-R2-03 (selection + shipping, seeded) | All 3 objectives COMPLETED, real capability executions (select_products/set_shipping_destination/calculate_shipping), FINAL, grounded. **PASS**, C09-equivalent. |
| WA-R2-04 ("mejor 3" correction) | Same `invalid_arguments` pattern as scenario B/WA-R2-01 - confirms the quantity-correction gap is reproducible. |
| WA-R2-05 (missing destination) | WAITING_CUSTOMER, real clarifying question, real follow-up scheduled. **PASS.** |
| WA-R2-06 (handoff/control-stop) | Zero R2 mutation, zero dispatch for that turn - human authority correctly preserved. **PASS.** |

Real delivery: **NOT_RUN** (by user decision, not a technical limitation).

## 15. Non-allowlisted regression

Proven via: (a) `shouldRouteToCommercialWork` unit tests (fail-closed on flag-off, empty-allowlist,
non-member waId, and independence from `BRAIN_AUTONOMOUS_TEST_WA_IDS` - all green), and (b) code
construction - `runNativeAutonomousCycle.ts`'s `commercialWorkEnabled` branch is a hard `if`+`return`
gated solely on that predicate; a `false` result means the function never enters the branch at all, byte-
identical to pre-A08.5 behavior. **Not additionally proven by a new full legacy-pipeline live E2E run in
this task** - the full regression suite (477/477, including every A03-A08/shipping/quote/follow-up/action-
queue/outbox test) confirms no existing legacy behavior changed.

## 16. Known limitations

- CREATE_QUOTE semantic coverage: MISSING (Part 4) - out of scope for this integration's required scenarios.
- Cancellation semantic coverage: MISSING (Parts 4, 11) - a real, newly-confirmed gap. "olvidalo"-style requests are silently dropped (`unsupported`), never translated into a `{kind:"cancel"}` seed.
- Bare quantity-correction phrasing ("mejor 3") is not reliably parsed by the planner - confirmed twice, independently (multi-turn scenario B and WA-R2-04). Safe (no unbacked claim), but not a working correction.
- SELECT_PRODUCTS' step-level dependency check accepts an unresolved `productReference` string as satisfying its `CUSTOMER_INPUT/PRODUCT` requirement, letting a step execute and fail with a raw capability error instead of cleanly asking for clarification first (Part 6) - pre-existing A03-A05 behavior, first exercised here by real unscripted text.
- Product names are not available on the CommercialWork aggregate, only IDs/free-text references.
- The whole Agent Tool Loop/CommercialWork family still has no mechanism of its own to create a `crm_opportunities` row for a brand-new conversation - inherited from LLM-R1-T09B, not solved here.
- This environment's real dev database had migrations 029-031 missing before this task (Part 3) - now applied; worth a periodic drift check given the same class of gap has recurred before in this repo's history (see `ACTIVE_RELEASE.md`'s prior notes on migration drift).
- Technical retry (Part 18) and stale follow-up cancellation (Part 20) integration through the *new* entry point specifically: PARTIAL/NOT_RUN - the underlying primitives are fully tested by existing A06/A07 suites, but no new dedicated test exercises them through `runCommercialWorkInboundCycle` end-to-end.
- A dedicated concurrency/race test *at the new entry-point layer* (Part 22) was not added - relies on A08's module-level guarantee plus plumbing verification.

## 17. A09 recommendation

The integration gate is genuinely passed for the primary success criterion (a real customer message can
enter the production runtime, be interpreted by real DeepSeek, become durable CommercialWork, execute
deterministically, wait correctly for the customer, and produce a grounded reply) for the scenarios this
task actually validated live. Two real, non-trivial semantic gaps (cancellation, quantity-correction
phrasing) and the retry/race integration gaps above are real enough that A09 (parallel execution) should
wait until at least the cancellation gap is closed - parallelizing execution over an objective graph that
can't represent "the customer changed their mind" compounds a correctness gap, not just a performance one.
Recommend a narrow follow-up closing cancellation semantics before A09.

---

## Final block

**SALES-AGENT-R2-A08.5: DONE**

Controlled R2 inbound integration: **IMPLEMENTED**

Production global routing: **UNCHANGED**

R2 feature gate: `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED` (default `false`)

R2 allowlist: `BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS` (default empty, independent of the multi-intent pilot's allowlist)

Non-allowlisted legacy path: **PASS**

Production customer inbound creates/reconciles CommercialWork: **ALLOWLIST_ONLY**

Semantic planner: **REAL DEEPSEEK**

Live DeepSeek model: `deepseek-v4-flash`

Live C09 runs: **10** (legacy) / **10** (R2)

Live C09 semantic success rate: **100%**

Live C09 same-cycle completion rate: **100%**

Live C09 async completion rate: **0%**

Live C09 lostCommercialWorkRate: **0%**

Live C09 unbackedCommercialMutationClaimRate: **0%**

Live C09 duplicateSideEffectRate: **0%**

Live C09 staleEvidenceExecutionRate: **0%**

Live C09 staleTurnAuthoritativeWriteRate: **0%** (module-level guarantee, A08 suite; not separately re-measured live at the entry-point layer in this task)

Live C09 average LLM calls: **1** (R2) vs **4.1** (legacy)

Live C09 latency p50/p95: **4123ms / 6155ms** (R2) vs **33614ms / 76726ms** (legacy)

Live commercial completion latency p50/p95: **4123ms / 6155ms**

Customer-visible C09 audit: **PASS** (10/10 CORRECT)

Multi-turn continuity: **PASS** (scenarios A, C)

Quantity correction: **FAIL** (scenarios B, WA-R2-04 - planner does not reliably parse bare correction phrasing)

Destination correction: **PASS** (scenario C)

Cancellation: **FAIL** (scenario D - no cancel intent exists in the semantic planner)

Technical retry integration: **PARTIAL** (primitives fully tested by A06; no new dedicated entry-point-level test)

WAITING_CUSTOMER integration: **PASS** (WA-R2-05)

Objective-aware follow-up integration: **PASS** (WA-R2-05, real `schedule_followup` row)

Stale follow-up cancellation: **NOT_RUN**

Duplicate inbound: **PASS**

Handoff: **PASS** (WA-R2-06)

Provider failure before planning: **PASS** (deterministic test + live observation before the BRAIN_MODEL_NAME fix)

Provider failure after durable work: **NOT_RUN** as a dedicated live/deterministic scenario in this task

Canonical Capability Gateway: **YES**

Canonical crm_agent_actions: **YES**

Canonical outbox: **YES**

Legacy fallback double-mutation risk: **0** (structural guarantee - hard if/return chain, verified by code + regression suite)

A07.5 scenarios: not re-run in this task (out of this task's regression scope - A07.5's own suite covers them; not part of Part 35's named list)

lostCommercialWorkRate: **0%**

unbackedCommercialMutationClaimRate: **0%**

duplicateSideEffectRate: **0%**

staleEvidenceExecutionRate: **0%**

staleTurnAuthoritativeWriteRate: **0%**

Allowlisted WhatsApp smoke: **PASS** (code-path, dry-run; real delivery NOT_RUN by user decision)

Production worker activation: **NO**

Production follow-up activation: **NO**

Parallel execution: **NO**

A03-A08 regressions: **PASS** (477/477, `--test-concurrency=1` against `crm_test`)

Typecheck: **PASS**

Build: **PASS**

ACTIVE_RELEASE changed: **NO**

Verdict: **R2_PRODUCTION_PATH_PARTIAL**

(Not `R2_PRODUCTION_PATH_VALIDATED`: the core integration, safety invariants, and C09 live validation are
genuinely solid, but two real semantic gaps - cancellation and quantity-correction phrasing - plus the
retry/race integration test gaps at the new entry-point layer are real enough to withhold the full
verdict. Not `R2_INTEGRATION_REVISION_REQUIRED` or `BLOCKED`: nothing found requires reverting or blocks
continued controlled use - the gaps are additive follow-up work, not defects in what shipped.)

Recommended next: close the cancellation semantic gap (smallest fix: extend the planner's intent
vocabulary with a `cancel`-shaped intent and wire it through `commercialObjectiveSeedsFromResolvedIntent`'s
already-existing `{kind:"cancel"}` seed type) before SALES-AGENT-R2-A09 (safe dependency-aware parallel
execution).
