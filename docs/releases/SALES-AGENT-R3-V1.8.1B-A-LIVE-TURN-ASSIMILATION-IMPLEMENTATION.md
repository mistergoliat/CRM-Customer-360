# SALES-AGENT-R3-V1.8.1b-A -- Live Turn Assimilation (Objetivo A implementation)

Status: Objetivo A implemented, tested, and validated against real MariaDB
with a scripted provider. Supersedes Section 8/9 of
`docs/releases/SALES-AGENT-R3-V1.8.1B-A-LIVE-TURN-ASSIMILATION-DESIGN.md`
(that doc's own Section 20 deliberately deferred Objetivo A; this doc closes
that deferral). Objetivos B and C, documented in that same design doc, are
unchanged by this work.

**Verdict: `R3_V1_8_1B_A_LIVE_TURN_ASSIMILATION_VALIDATED_WITH_KNOWN_DEBT`**

Live DeepSeek + real WhatsApp benchmark (Section 27/28 of the task brief) is
explicitly **deferred**, per the requester's own scoping decision -- it sends
real customer-facing messages and needs an allowlisted test number. Everything
else (audit, safe boundaries, fresh commercial truth, atomic settlement
reconciliation, budget semantics, observability, feature flag, full
deterministic test matrix against real MariaDB) is closed in this pass.

## 1. What changed from the deferred design

The original Section 8 design proposed `MAX_ASSIMILATION_ROUNDS = 2` and naive
string concatenation. This implementation rejects both:

- **No round cap anywhere.** The only ceiling is the loop's pre-existing
  `deadline`/`timeoutMs` check, already evaluated at the top of both the
  gathering and finalization loops. Proven by test `[C/M]` (6 consecutive
  assimilation cycles in one run, no cap hit).
- **Deterministic reconstruction, not concatenation-with-drift-risk.**
  `customerMessage` is rebuilt by joining `[current, ...newFragments]` with
  the exact same `\n` convention `assembleTurnFragments.ts` already uses for
  the initial turn -- reused, not invented. Because the anchor only ever
  advances and each read is `id > anchor`, this is mathematically equivalent
  to one big re-query of the full range.
- **Universal pre-action gate, not a post-tool-only check.** The plan was
  revised once (mid-implementation) after a design review caught that a
  post-tool-only check leaves mutating tool calls vulnerable to stale intent
  -- a customer message can arrive *after* the LLM decided to call
  `select_products` but *before* that call executes. The final design checks
  freshness immediately after every `AgentStep` is validated, for all three
  step types (`use_tool`/`respond`/`handoff`), in both phases, before any
  consequence. A second, independent check still runs after a tool actually
  executes (a different race window -- the message arrives *during* the
  tool's own HTTP/DB call).
- **Atomic settlement reconciliation, not best-effort.** The same review
  caught that reconciling a sibling settlement as a separate step after
  `completeTurn()` leaves a real crash window: a sibling could be left
  `PENDING` with already-answered content and no dedupe mechanism to prevent
  a later independent duplicate cognitive run over it (unlike the settlement
  row's own `PROCESSING`->`COMPLETED` transition, which the outbox's own
  dedupe key already protects on reclaim-and-reprocess). Reconciliation now
  runs inside the exact same database transaction as the outbox insert.

## 2. Code-grounded audit (confirmed before implementation, not assumed)

- `runAgentToolLoop.ts` (1054 lines pre-A): gathering `while` loop, finalization
  `for` loop with `FINALIZATION_MAX_ATTEMPTS = 2`. `customerMessage`/
  `commercialContextSummary` were fixed for the whole run, set once before the
  loop, never re-read.
- Anchor propagation: a single string field (`inboundMessageId`) did three
  jobs in `dispatchGovernedSalesAgentMessage.ts` -- dedupe key, `sourceRequestId`,
  and freshness anchor -- from `runTurnSettleTick.processClaimedTurn` all the
  way to the outbox insert.
- `crm_inbound_turn_settlements` status enum: `PENDING | PROCESSING | COMPLETED | SUPERSEDED`
  only, no status existed for "consumed by another row's run."
- `deriveMessages.ts`/`resolvePersistentSessionCognitionContext.ts`:
  `historicalMessages` is read once, before `runAgentToolLoop` is ever called.
  A message assimilated mid-run cannot already be present in it (it did not
  exist in `conversation_message` at read time) -- confirmed structurally, no
  new history-exclusion mechanism was needed.
- `buildNativeCommercialContext.ts` is a pure, stateless, fully re-callable
  loader -- reused as the fresh-commercial-truth refresh seam, no second
  loader built.
- Idempotency audit of `select_products`/`set_shipping_destination`/
  `select_shipping_option` (the three mutating capabilities other than
  `create_quote`, already proven in V1.8.1a): all three are **idempotent via
  durable key** -- SELECT-before-write plus full-value equality against the
  active `crm_request_facts` row, backed by `upsertRequestFact`'s
  supersede-and-insert-new-version pattern under a DB-enforced
  `UNIQUE KEY (request_id, fact_key, active_marker)`. `select_shipping_option`
  additionally carries a freshness-of-evidence gate
  (`checkShippingEvidenceFreshness`). No unresolved risk found in any of the
  four mutating capabilities for the crash+reclaim scenario.

## 3. Implementation

### 3.1 `runAgentToolLoop.ts` -- two safe boundaries, one shared gate

New `RunAgentToolLoopInput` fields (all optional/additive):
`liveTurnAssimilationEnabled`, `checkForNewInbound` (DI seam, real default in
`turn-settlement/checkForNewInbound.ts`), `refreshCommercialContextSummary`
(DI seam for fresh-truth reload).

Local mutable state: `customerMessage`, `commercialContextSummary`,
`assimilatedAnchorId` (starts at `input.inboundMessageId`, only ever
advances), plus observational counters. A single closure, `tryAssimilate()`,
is the only place that reads new durable inbound and folds it in.

- **Boundary 1 (universal pre-action gate):** immediately after
  `validateAgentStep` succeeds, before any consequence of any step type, in
  both phases. If stale: discard the step entirely (never pushed, never
  executed, never dispatched), `continue` with no decision/tool budget
  consumed.
- **Boundary 2 (post-tool):** after a tool executes and its result is known
  (gathering only), before the next inference -- catches the customer message
  arriving *during* the tool's own execution, a genuinely different race
  window than Boundary 1.

Finalization's `for (attempt < FINALIZATION_MAX_ATTEMPTS)` became a
`while (Date.now() <= deadline)` loop with a separate `formatRepairAttempt`
counter, so a staleness discard never consumes the format-repair budget.
`toolExecutionCount`/`maxToolExecutions` is untouched by assimilation
entirely.

`AgentLoopResult` gained four optional observational fields:
`finalAssimilatedInboundMessageId`, `assimilatedInboundMessageIds`,
`assimilationCycleCount`, `invalidatedCandidateCount` -- optional (not
required) so every other `AgentLoopResult`-shaped literal in the codebase
(`runNativeAgentToolLoopCycle.ts`, `runCommercialMultiIntentLoop.ts`,
`runSalesAgentRuntimeCycle.ts`'s own dispatch shim, and every existing test
fixture) needed zero changes.

### 3.2 Fresh commercial truth (Section 8)

`refreshCommercialContextSummary` is built as a closure in
`runNativeAutonomousCycle.ts`'s `salesAgentRuntimeEnabled` branch (the exact
call site that already builds the initial `snapshot`), re-calling
`buildNativeCommercialContext` then the same reduction
(`buildMinimalCommercialContextSummary`, exported from
`runSalesAgentRuntimeCycle.ts` for this reuse) the initial call already uses.
Threaded down `NativeAutonomousCycleInput` (implicitly, via the closure being
built where it's already needed) -> `RunSalesAgentRuntimeCycleInput` ->
`SalesAgentRuntimeInput` -> `RunAgentToolLoopInput`. Only built when the flag
is on.

### 3.3 History exclusion (Section 7)

No new mechanism required -- structurally impossible for a live-assimilated
message to already be in `historicalMessages` (see the audit above).

### 3.4 Anchor + settlement-id propagation, atomic dispatch (Sections 12-16, 23)

`selfSettlementId` threads down as an input (`processClaimedTurn`'s `row.id`)
through `EnsureAutonomousSalesTurnContinuityInput`/`NativeAutonomousCycleInput`/
`RunSalesAgentRuntimeCycleInput` -- `null` for every caller that isn't the
turn-settlement worker (e.g. delay=0 direct dispatch has no settlement row).
`AgentLoopResult.finalAssimilatedInboundMessageId` (loop output) is combined
with it at `runSalesAgentRuntimeCycle.ts` into one bundle,
`liveAssimilation?: { finalAssimilatedInboundMessageId; selfSettlementId }`,
built **only** when the flag is on and something was actually assimilated --
threaded through `dispatchSalesAgentTerminalOutcome` ->
`dispatchSalesAgentResponse`/`dispatchSalesAgentFallback` ->
`dispatchGovernedSalesAgentMessage`.

Deliberately **not** threaded into `dispatchSalesAgentHardHandoff.ts`: that
dispatcher never calls `dispatchGovernedSalesAgentMessage` at all (its own
narrowly-scoped transaction). A sibling settlement left `PENDING` after an
eligible hard handoff resolves safely on its own next claim, via the
pre-existing `human_owner_active` governance gate in `runSalesAgentRuntime`
(zero LLM call, zero dispatch attempt, `completeTurn` runs harmlessly) -- just
with a less precise `COMPLETED` status instead of `ASSIMILATED`. Documented,
not a correctness gap (no duplicate cognitive run, no duplicate customer
message).

Inside `dispatchGovernedSalesAgentMessage.ts`'s existing `withTransaction`
callback, after ownership + freshness both pass:
1. `recheckInboundFreshness` compares against
   `liveAssimilation?.finalAssimilatedInboundMessageId ?? inboundMessageId` --
   the dedupe key/`sourceRequestId` keep using `inboundMessageId` unchanged
   (settlement/turn identity stays stable regardless of how far assimilation
   advanced).
2. `writeCanonicalOutboxMessage` (unchanged).
3. If `liveAssimilation` is present: `completeTurn(selfSettlementId, connection)`
   and the new `reconcileAssimilatedSiblings(connection, conversationId,
   selfSettlementId, finalAssimilatedInboundMessageId)` (migration 036,
   `turn-settlement/repository.ts`) -- both on the **same connection**, same
   transaction.

`reconcileAssimilatedSiblings`: `SELECT ... FOR UPDATE` sibling `PENDING`
rows (never `PROCESSING` -- Objetivo B's guard already guarantees no sibling
can be `PROCESSING` while `selfSettlementId` is), then per row: full coverage
(`latest_inbound_message_id <= anchor`) -> new status **`ASSIMILATED`**
(migration 036, reuses the existing `superseded_by_message_id` column to
record the covering anchor -- honest for both meanings); partial coverage
(`first_inbound_message_id <= anchor < latest_inbound_message_id`) -> advance
`first_inbound_message_id` to `anchor + 1`, stays `PENDING`; no overlap ->
untouched.

Because steps 1-3 are one transaction: a crash at any point either rolls
back all of it (row A stays `PROCESSING`, reclaimed and fully reprocessed
later, siblings untouched) or commits all of it together -- proven, not
argued, by three dedicated crash-boundary tests (Section 5 below).

`completeTurn`/the new sibling functions accept the same optional trailing
`PoolConnection` parameter `upsertPendingTurn` already established in
V1.8.1a -- reused precedent, not a new pattern.

### 3.5 Feature flag

`BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED`, default `false`
(`shouldEnableLiveTurnAssimilation()`, `commercialCycleConfig.ts`, same
`readEnvFlag` pattern as every other flag in that file). B/C stay
independent of this flag. When off, `tryAssimilate()`'s guard always
short-circuits and `liveAssimilation` is never built -- byte-identical
control flow and zero new queries, proven by test `[P]` at both the loop
level and the worker level.

### 3.6 Observability

`AgentLoopResult`'s four new fields flow into `SalesAgentRuntimeResult`
(two new fields, `assimilationCycleCount`/`invalidatedCandidateCount`, added
alongside the two already-planned ones) and then into the existing
`agent_tool_loop_completed` commercial event via a new optional
`liveTurnAssimilation` payload field -- no new event taxonomy.

## 4. Mutation/idempotency findings (Section 24)

| Capability | Mechanism | Classification |
|---|---|---|
| `create_quote` | Cryptographic idempotency key (`sha256(create-quote:{opportunityId}:{selectionFactId})`) sent to the external Quote Service, plus a local reuse-check | Replay-safe (proven in V1.8.1a) |
| `select_products` | SELECT-before-write + full-value equality vs. active `crm_request_facts` row | Idempotent via durable key |
| `set_shipping_destination` | Same pattern | Idempotent via durable key |
| `select_shipping_option` | Same pattern + `checkShippingEvidenceFreshness` (rejects a selection whose evidence is now stale relative to current commercial-line-items/shipping-destination facts) | Idempotent via durable key, extra protected-by-current-business-facts layer |

All four survive a crash+reclaim mid-live-assimilation without duplicating a
side effect. No redesign needed for any of them.

## 5. Tests

- `tests/agent-loop/runAgentToolLoopLiveAssimilation.test.ts` (new, 8 tests,
  scripted provider + injected `checkForNewInbound`): A (new inbound during
  provider call), B (during tool execution), C/M (6 consecutive cycles, no
  cap), D (invalidated candidate never contaminates state), E (finalization
  phase gate), F (handoff freshness-sensitivity), G (a stale `use_tool`
  candidate never actually calls the tool), P (flag off is byte-identical).
- `tests/commercial/turnSettlementRepository.test.ts` (+4 tests, real
  MariaDB): `[I1]` full-coverage reconciliation -> `ASSIMILATED`, `[I2]`
  partial-coverage -> lower-bound advance, `[I3]` no-overlap -> untouched,
  `[I4]` `completeTurn` with an in-transaction connection stays idempotent.
- `tests/commercial/dispatchGovernedSalesAgentMessageLiveAssimilation.test.ts`
  (new, 3 tests, real MariaDB, direct calls to the actual transaction
  boundary): `[J1]` happy path -- all three effects commit together, nothing
  further needed; `[J2]` mid-transaction crash (via a new test-only
  `simulateCrashAfterOutboxWriteFn` DI seam, mirroring the exact
  `upsertPendingTurnFn` precedent from V1.8.1a) -- nothing commits, later
  retry recovers cleanly; `[J3]` race window -- `recheckInboundFreshness`
  wins, reconciliation never runs, sibling keeps sole ownership.
- `tests/native/inboundTurnSettling.e2e.test.ts` (+2 tests, real MariaDB,
  real worker tick, real flag, real `checkForNewInbound`/
  `refreshCommercialContextSummary` wiring, only the LLM faked): full
  end-to-end proof (sibling reconciles atomically, continuity signal
  survives assimilation, exactly one dispatched response) and the flag-off
  case (the pre-existing `[T9]` dispatch-time freshness check still
  suppresses the stale response, confirming this is genuinely unaffected by
  the new flag, not merely untested).
- `tests/commercial/salesAgentRuntime.test.ts`: updated the pre-existing
  exhaustive-field-shape "no chain-of-thought" contract test to include the
  four new observational fields -- same anti-drift convention this codebase
  already uses for the "golden prompt length" tests.

All new/extended tests pass. Full regression (`npm test`, 12 batches):
comparable pass/fail counts to the V1.8.1a baseline (4217/23) plus these new
tests; the one apparent new failure on the first run
(`salesAgentRuntime.test.ts`'s exhaustive-shape test) was the expected,
already-fixed golden-shape drift above; a second apparent failure
(`continuityConcurrency.test.ts`'s concurrent-dispatch timing test) passed
cleanly in isolation (290ms vs. ~3s under full-suite load) and touches none
of the files this task changed -- classified as a pre-existing timing
sensitivity under load, not a regression. `npx tsc --noEmit`, `npm run build`
(27/27 pages), `npm run lint` (0 errors, 40 warnings, identical baseline) all
clean.

## 6. Crash/recovery semantics (Section 23)

No in-memory assimilation state is ever authoritative. If the worker crashes
mid-run (before the dispatch transaction), the settlement row stays
`PROCESSING`, gets reclaimed via the existing stale-processing mechanism, and
the new attempt re-derives everything from durable truth -- it does not need
to know the dead run's assimilation cycle count. Sibling reconciliation only
ever commits atomically with a successful dispatch (Section 3.4), so a crash
before that point never marks a sibling consumed too early.

## 7. Known remaining debt (carried forward, not silently absorbed)

- **Outbox-insert-to-Meta-send freshness** (brief Section 17): real,
  pre-existing (exists for every R3 dispatch, not specific to live
  assimilation), explicitly out of scope for this task. `outboxWorker.ts`
  does not re-check `conversation_message` for anything newer than the
  outbox row's own `sourceRequestId` before sending.
- **Live DeepSeek + real WhatsApp benchmark** (Section 27/28): deferred per
  the requester's own scoping decision, pending an allowlisted test number.
- **Hard-handoff sibling reconciliation** (Section 3.4 above): a sibling left
  over after an eligible handoff resolves to `COMPLETED` rather than the more
  precise `ASSIMILATED` -- a labeling imprecision, not a correctness gap
  (verified: zero duplicate cognitive run, zero duplicate customer message).
- **Starvation** (Section 20): not solved, per the task's own explicit
  instruction not to solve it with an arbitrary cap. The only real ceiling
  under pathological continuous input is the loop's existing deadline. Not
  measured under live load in this pass (deferred alongside the live
  benchmark).

## 8. Rollout / rollback

**Rollout:** `BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED=true`, scoped
additionally by the pre-existing `BRAIN_SALES_AGENT_RUNTIME_WA_IDS`
allowlist (this flag only ever matters inside the `salesAgentRuntimeEnabled`
branch) and `BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS > 0` (assimilation only
has anything to observe once turn settling itself is active).

**Rollback:** `BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED=false` (or unset) --
pure code revert of behavior, no data migration needed. Migration 036 (the
`ASSIMILATED` status) is additive and does not need to be rolled back even
if the flag is off; a rollback SQL is documented in the migration file's own
header for completeness.

## 9. Final verdict

`R3_V1_8_1B_A_LIVE_TURN_ASSIMILATION_VALIDATED_WITH_KNOWN_DEBT`. The
deterministic core (safe boundaries, fresh truth, atomic reconciliation,
budget semantics, no round cap) is proven against real MariaDB with a
scripted provider, including three explicit crash-boundary tests proving the
atomicity invariant rather than asserting it. Live-model/live-WhatsApp
validation is the one deliberately deferred piece, tracked as follow-up work
pending an allowlisted test number.
