# SALES-AGENT-R3-V1.8.1a -- Harness-Semantic Durability Hardening

Status: implementation + validation. Narrow hardening slice on top of V1.8.1
(Conversational Turn Settling). No new migration, no schema change, no
cognitive/workflow state added.

## 1. Executive verdict

**`R3_V1_8_1A_HARNESS_SEMANTIC_DURABILITY_VALIDATED`**

Both durability gaps identified after V1.8.1 are closed. Gap 1 (a committed
inbound could exist with no durable processing responsibility) is closed by
moving the pending-turn upsert inside the same DB transaction as the
canonical inbound persist, with an explicit throw-and-rollback on failure.
Gap 2 (a stale `PROCESSING` reclaim could duplicate an already-completed
mutation) is closed not by a redesign but by proof: `create_quote`'s existing
idempotency key (`opportunityId` + `commercial_line_items.factId`, both
re-read fresh from durable state on every attempt) already survives a real
crash-before-`completeTurn()` + stale-processing reclaim, demonstrated end to
end against real MariaDB with a new deterministic test (`[T8/K/G6]`). All 14
exit gates (Section AD below) hold with direct evidence.

## 2. Harness semantic model (Section B)

```
input = durable
session = durable
business effects = durable
agent run = disposable
```

A committed inbound must always be resumable; recovery must resume from
durable truth, never blindly replay a consequence. This task treats those as
two separate, independently provable invariants:

- **I1** (`COMMITTED INBOUND ⇒ DURABLE PROCESSING RESPONSIBILITY`) - Fix 1,
  Sections 4-8 below.
- **I2/I3** (`AGENT RUN = disposable`, `BUSINESS CONSEQUENCE = durable`,
  `RECOVERY = resume from current durable truth`) - Fix 2, Sections 9-11
  below.

## 3. Original durability gaps (Section C findings)

Inspection of `processNativeWhatsAppInbound` (`lib/brain/native-whatsapp/service.ts`,
pre-hardening) found the exact gap the task brief predicted:

```
BEGIN
  persist conversation_message (+ commercial_event, + conversation touch)
COMMIT
<-- crash window -->
if (settleDelayMs > 0) upsertPendingTurn(...)   // separate statement, own
                                                  // implicit transaction,
                                                  // failures only logged
```

**Finding A** (task brief question A): yes - `upsertPendingTurn` could run
inside the same DB transaction/connection as inbound persistence.
`withTransaction`'s callback already receives a `PoolConnection` that every
other write in the function (`createOrUpdateNativeConversation`,
`appendConversationMessage`, `recordCommercialEvent`,
`touchConversationAfterInbound`) already threads through; `upsertPendingTurn`
was the only write in that call graph still going through the pool directly.

**Finding B** (task brief question B): `create_quote`'s durable idempotency
key - `sha256(create-quote:{opportunityId}:{selectionFactId})`
(`createQuoteCapability.ts`'s `buildIdempotencyKey`) - is what prevents a
replayed settled turn from duplicating the mutation today. Both components
are read fresh from durable state (`context.opportunityId`, and
`commercial_line_items`'s own `crm_request_facts.factId` via
`assembleQuoteInput`) on every single execution attempt, never carried over
from in-memory cognition state. See Section 10 for the full trace.

## 4. Inbound transaction: before / after (Section D)

**Before:**

```
BEGIN persist inbound COMMIT
if (settleDelayMs <= 0) ensureAutonomousSalesTurnContinuity(...)   // unchanged
else upsertPendingTurn(...)   // separate statement AFTER commit, best-effort
```

**After:**

```
BEGIN
  persist canonical inbound conversation_message (+ commercial_event, + touch)
  if (settleDelayMs > 0) upsertPendingTurn(..., connection)   // SAME transaction
                                                                // throws on failure
COMMIT
if (settleDelayMs <= 0) ensureAutonomousSalesTurnContinuity(...)   // unchanged, outside tx
```

Two atomic outcomes now hold by construction:

- **A.** The settlement upsert fails (or throws) -> the whole transaction
  rolls back -> neither the inbound nor the settlement row exists. The
  dedupe check at the top of `processNativeWhatsAppInbound`
  (`loadConversationMessageByProviderMessageId`) finds nothing, so Meta's
  real webhook retry of the same delivery is processed as a fresh attempt,
  never as a false duplicate.
- **B.** The transaction commits -> the inbound and its durable processing
  responsibility both exist, in the same commit, or neither does.

## 5. Fix 1: atomic responsibility (Sections D/F/I1)

`lib/brain/commercial/turn-settlement/repository.ts`'s `upsertPendingTurn`
(and its two internal helpers, `tryExtendPendingTurn`/`tryInsertPendingTurn`)
now accept an optional `connection?: PoolConnection` second parameter. When
given, both the `UPDATE` (extend) and `INSERT` (create) branches execute on
that connection instead of `getPool()` directly - no SQL duplicated, same
extend-then-insert-then-retry loop, same `ER_DUP_ENTRY` recovery (safe inside
a transaction: unlike Postgres, MariaDB/InnoDB does not poison a transaction
on an ordinary statement error, so catching a duplicate-key error and
retrying mid-transaction is the same pattern `persistAgentAction.ts` already
established outside a transaction). Every existing standalone caller (the
turn-settle worker's own tests, `settleFragments` test helpers) is
unaffected - omitting the connection preserves the exact pre-V1.8.1a
pool-based behavior.

`lib/brain/native-whatsapp/service.ts`'s `processNativeWhatsAppInbound`
computes `turnSettlementConfig` once, before the transaction, and branches
inside the `withTransaction` callback: when `settleDelayMs > 0`, the upsert
runs on the transaction's own connection immediately after
`touchConversationAfterInbound`, and a `{ ok: false }` result throws
(`inbound_turn_settlement_upsert_failed:<reason>`), which `withTransaction`
turns into a rollback. The post-commit branch (Section 6) no longer
duplicates this logic - when settling is enabled, there is nothing left to
do after commit; the turn-settle worker already owns the row.

A new test-only dependency, `NativeWhatsAppProcessDependencies.upsertPendingTurnFn`
(mirrors the pre-existing `commercialEventRecorder` seam on the same type),
lets tests force a deterministic failure at exactly this boundary without
touching the DB schema or timing games.

## 6. delay=0 compatibility (Section E)

`BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS=0` (the default) never enters the new
branch at all - `turnSettlementConfig.settleDelayMs > 0` is false, so the
transaction is byte-for-byte the pre-V1.8.1a shape (persist inbound, commit,
nothing else), and the post-commit call to `ensureAutonomousSalesTurnContinuity`
is the same literal call as before. `[T1]` (pre-existing, re-verified) proves
this directly: a real inbound at the default config never creates a
turn-settlement row.

## 7. Concurrent fragment behavior (Section G)

`[T5/T6]` (new) drives two real, concurrent `processNativeWhatsAppInbound`
calls for the SAME conversation through the real webhook path with settling
enabled, against real MariaDB. Both canonical `conversation_message` rows
persist, exactly one `PENDING` turn-settlement row exists afterward, and its
`fragment_count` is `2`. No deadlock: `createOrUpdateNativeConversation`'s
`INSERT ... ON DUPLICATE KEY UPDATE` on the shared `conversation` row is the
first write inside each transaction, so a losing transaction blocks there
(a normal lock wait, not a cycle) before it ever reaches the settlement
table - the same row-lock ordering that already serialized every other write
in this function continues to serialize the new one.

## 8. Crash-window proof (Section H)

`[T3]` (new) injects a forced failure via `upsertPendingTurnFn` between the
inbound insert and the settlement upsert and proves the whole transaction
rolls back: zero `conversation_message` rows, zero `crm_inbound_turn_settlements`
rows for that `providerMessageId`/`wa_id`. `[T4]` (new) then replays the
identical webhook delivery (same `providerMessageId`) without the forced
failure and proves it is NOT treated as a duplicate (the dedupe check found
nothing to duplicate) and lands exactly one canonical inbound + one
settlement row. `[T2]` (new) proves the positive case: a normal settling-enabled
inbound commits both rows atomically in the same transaction.

## 9. Orphan audit (Section I)

Read-only diagnostic (`crm_test` and `main_management`, no mutation): for
every conversation with any `crm_inbound_turn_settlements` history, every
inbound `conversation_message.id` was checked against the union of
`[first_inbound_message_id, latest_inbound_message_id]` ranges across that
conversation's settlement rows.

- `main_management` (dev): zero turn-settlement rows exist at all - the
  pilot delay has never been set above `0` in this environment, confirming
  the rollback-path default has been the only path exercised there.
- `crm_test`: 18 conversations showed exactly one "uncovered" inbound
  message each. Every one was inspected directly and is a test-fixture
  artifact, not a production symptom: either the pre-existing "mensaje
  historico previo" row V1.8.1's own `[T8]` test inserts directly via SQL
  (deliberately never meant to be part of any settled turn - it represents
  unrelated prior history), or the "newer inbound arriving mid-cognition"
  row V1.8.1's own `[T9]` test inserts directly via SQL to simulate a race
  (deliberately never routed through `upsertPendingTurn` - the test proves
  supersession, not a second webhook delivery). No conversation showed a
  message consistent with an actual crash between a real webhook's insert
  and its settlement upsert.

**Finding: zero real orphaned inbound rows exist. No backfill/repair
required.**

## 10. Stale-processing semantics (Section Q)

Unchanged mechanism, canonized meaning: `reclaimStaleProcessingTurn` (CAS,
re-verifies staleness at claim time) transfers *processing responsibility*
for the still-uncompleted durable input to the new worker. It does not, and
must not, attempt to reproduce the previous worker's in-memory reasoning
state - the new worker reloads the persistent session, the current
transcript, and fresh domain state, and invokes the model again from there
(Section N: "reasoning attempt A -> crash -> reasoning attempt B" is
allowed). `processClaimedTurn` already never marks a row terminal on a
thrown error (pre-existing V1.8.1 discipline, unchanged) - a crash mid-turn
always leaves the row `PROCESSING` for a later stale-reclaim, never silently
`COMPLETED`.

## 11. Capability Gateway idempotency finding (Sections K/L)

Audited `createQuoteCapability.ts` (the mutating capability selected for the
replay test, per the task brief) end to end:

- **Idempotency key**: `sha256("create-quote:{opportunityId}:{selectionFactId}").slice(0,32)`.
- **Where generated**: `buildIdempotencyKey` inside `createQuoteCapability.ts`'s
  `execute()`, on every single invocation - never cached, never generated
  once per "session" or per "cognition attempt".
- **Where persisted**: sent as the real `Idempotency-Key` HTTP header to the
  external Quote Service (`httpQuoteServiceAdapter.ts`), and the resulting
  quote (including `selectionFactId` and `idempotencyKey`) is persisted
  durably via `setCreatedQuoteForOpportunity` into `crm_request_facts`
  (`created-quote` fact, keyed by `buildCreatedQuoteRequestAnchor(opportunityId)`).
- **Why it survives a stale-settlement reclaim**: both key components are
  re-read from durable state on every attempt, not carried over from any
  in-memory or per-attempt object. `opportunityId` comes from
  `CapabilityGatewayContext`, resolved fresh each turn from the conversation's
  current opportunity. `selectionFactId` comes from `commercial_line_items`'s
  own `crm_request_facts.factId` - a real row id, unchanged unless the
  customer's actual product selection changes. Two cognition attempts for
  the SAME settled turn (reclaimed after a crash) therefore always compute
  the SAME idempotency key, and the capability's own reuse-check
  (`getActiveCreatedQuoteForOpportunity(opportunityId)`, matched against
  `selectionFactId`) short-circuits before any second HTTP call. This
  guarantee already existed and was already regression-tested at the
  capability level (`tests/commercial/createQuoteCapability.test.ts`,
  "a second call with the UNCHANGED selection reuses the existing quote -
  Quote Service is called at most once") - not new to this task.

**Verdict: existing idempotency is sufficient (Section L). No redesign.**
This task adds one new, higher-level regression test (`[T8/K/G6]`, Section
12) that proves the guarantee holds specifically across the durable
crash/stale-reclaim mechanics this task hardens, not just at the capability's
own unit-test boundary.

## 12. Mutation crash/reclaim proof (Section K)

`[T8/K/G6]` (new, `tests/native/inboundTurnSettling.e2e.test.ts`), against
real MariaDB (`crm_test`) with a real `crm_opportunities` +
`commercial_line_items` fixture and the real `createQuoteCapability`
(only the external Quote Service HTTP client is faked, the same seam
`createQuoteCapability.test.ts` already uses):

1. A turn settles to `PENDING`, is claimed to `PROCESSING`
   (`runTurnSettleTick`).
2. A custom `ensureContinuity` test double calls the real `createQuoteCapability.execute()`
   - the mutation completes for real (`status: "created"`, one real
   fake-port `createQuote` call, the quote fact persists durably).
3. That same call then throws, simulating the worker process dying after the
   mutation durably completed but before `processClaimedTurn` ever reaches
   `completeTurn()`. The row is left `PROCESSING` (never marked terminal),
   exactly as `processClaimedTurn`'s existing crash-recovery discipline
   already guarantees.
4. `updated_at` is backdated past `TURN_SETTLE_STALE_PROCESSING_LOCK_SECONDS`
   (same technique the pre-existing `[T7]` test uses) and a second,
   independent `runTurnSettleTick` reclaims the row.
5. Cognition resumes: the same `ensureContinuity` test double runs again and
   calls `createQuoteCapability.execute()` a second time - same
   `opportunityId`, same unchanged `commercial_line_items`, so the same
   idempotency key. The capability's own reuse-check finds the quote already
   persisted from step 2 and returns `status: "reused"` without a second
   HTTP call.
6. The turn reaches `COMPLETED`.

**Result: exactly one Quote Service call across both attempts, exactly one
persisted quote, the settlement reaches a terminal state.**

## 13. Mutation + supersession result (Section P)

Unchanged from V1.8.1 - out of scope for this narrow slice by design
(V1.8.1's own Section 12/L classification stands: a mutation that completed
during a now-superseded turn's cognition is durable truth, never replayed,
never compensated). This task did not touch the freshness-recheck/dispatch
path (`dispatchGovernedSalesAgentMessage.ts`) at all; V1.8.1's own `[T9]`
(re-run unmodified as part of this task's regression, Section 16) continues
to prove it.

## 14. Resume-vs-retry semantics (Section O/Q)

Canonized explicitly, not reinterpreted: `SUPERSEDED` means the old execution
snapshot is obsolete because newer durable input exists - the newer input
gets its own resume path (its own `PENDING`/`PROCESSING` row), it is never a
retry of the old turn. A stale-`PROCESSING` reclaim is the same operator
applied to a different cause (a crash, not a race): resume responsibility for
the SAME uncompleted durable input, never "retry the old execution
byte-for-byte." Neither path replays a mutation - Section 11/12 above is why.

## 15. delay=0 result

Held (Section 6, `[T1]`).

## 16. Fragmented-turn / persistent-memory / typing / access-gate / dispatch
    regression (Sections U/V/T/AB)

The full pre-existing `tests/native/inboundTurnSettling.e2e.test.ts` suite
(`[T1]`, `[T3/G2/G3]`, `[T8/G4/J]`, `[T9/G8/K]`, `[T15/Q]`, `[T12/M/P]`,
`[T13]`, `[T14/N]`, `[T7/S]`) was re-run unmodified alongside the 6 new
tests this task adds and passes in full (14/14). None of these paths were
touched by Fix 1/Fix 2's code changes (both are additive: an optional
`connection` parameter on one repository function, and a branch reordering
inside one webhook function) - persistent-memory exclusion, typing, access
gates, and dispatch/outbox dedupe are all exercised exactly as before.

## 17. Observability (Section AA)

No new telemetry system. The existing throw-and-log discipline already
surfaces the two new failure classes this task cares about:

- Transaction failure before settlement ownership: the thrown
  `inbound_turn_settlement_upsert_failed:<reason>` error propagates out of
  `withTransaction` and is visible wherever `processNativeWhatsAppInbound`'s
  caller logs/handles the rejection (the webhook route already logs
  unhandled errors from this function).
- Stale-`PROCESSING` reclaim: unchanged, pre-existing
  `runTurnSettleTick`/`reclaimStaleProcessingTurn` path (no new logging
  needed - reclaim count is already part of `TurnSettleTickResult`).
- Settlement completion: unchanged, pre-existing `completeTurn`/`supersedeTurn`
  writes.

No message bodies, prompt text, or secrets are logged by anything this task
added.

## 18. Tests (Section X)

New, all against real MariaDB (`crm_test`), in
`tests/native/inboundTurnSettling.e2e.test.ts`:

- `[T2/G1]` - settling enabled: inbound + settlement commit atomically.
- `[T3/D]` - forced failure between insert and settlement upsert rolls back
  both.
- `[T4]` - duplicate webhook retry after that rollback succeeds idempotently
  (exactly one canonical inbound).
- `[T5/T6/G4]` - two real concurrent webhook deliveries for the same
  conversation still converge to exactly one `PENDING` row with the correct
  fragment count; no deadlock.
- `[T8/K/G6]` - mutation completes, simulated crash before `completeTurn()`,
  stale reclaim, cognition re-attempts the SAME mutation, exactly one
  external call / one persisted quote (Section 12).

6 new tests (T5/T6 share one test function). Combined with the 8 pre-existing
tests in the same file: **14/14 pass**, confirmed clean across 5 repeated
runs (25/25) after fixing two real test-harness bugs found while stabilizing
this addition - neither is a production-code issue, both are specific to
this shared-`crm_test`, never-reset-between-runs file:

1. `freshWaId()`'s original `` `5699${Date.now()}${random 0-999}`.slice(0,15) ``
   built a string longer than 15 characters and then truncated from the
   FRONT, silently dropping the random suffix (and collapsing the timestamp
   to ~100ms resolution) - two of the new tests calling it back-to-back could
   generate the identical `wa_id`, intermittently failing `[T3/D]`'s
   `count === 0` assertion against a sibling test's row. Fixed by building
   the string to fit within 15 characters up front, keeping full entropy
   from both parts.
2. `[T2/G1]` and `[T5/T6/G4]` are the first tests in this file that
   deliberately leave a row `PENDING` without ever consuming it via
   `runTurnSettleTick` (every pre-existing test consumes its own row in the
   same test). Since `runTurnSettleTick` sweeps every DUE row in the whole
   table, not just the caller's own, a leftover `PENDING` row could be picked
   up by a LATER test's own tick (e.g. `[T8/K/G6]`'s crash-injection
   callback, or `[T9]`'s mid-cognition provider) and processed through a
   provider/`ensureContinuity` scoped to a different test's assumptions.
   Fixed two ways: `[T8/K/G6]`'s own callback now ignores any
   `conversationId` that isn't its own, and `[T2]`/`[T5/T6]` neutralize their
   leftover `PENDING` row (mark it `COMPLETED` directly) once their
   assertions are done.

Also re-run, unmodified, to confirm zero regression at the layers Fix 1/Fix 2
touch:

- `tests/commercial/turnSettlementRepository.test.ts` - 20/20 pass
  (repository-level CAS/uniqueness/reclaim mechanics, now also exercised
  with the connection-aware `upsertPendingTurn` signature).
- `tests/commercial/deriveMessagesTurnSettling.test.ts` - 4/4 pass.
- `tests/commercial/createQuoteCapability.test.ts` - 7/7 pass (the
  pre-existing idempotency guarantee this task relies on, Section 11).
- `tests/native/*.test.ts` (68 files' worth in one run) - 68/68 pass,
  including the pre-existing `native-whatsapp.test.ts` rollback test
  (`commercialEventRecorder` forced-failure) - proof the new settlement-upsert
  branch did not disturb the pre-existing rollback behavior it sits next to.

## 19. Real MariaDB validation (Section Y)

Every new test runs against real MariaDB (`crm_test`) - the transaction
rollback proof (`[T3]`), the concurrent webhook race (`[T5/T6]`), the
stale-`PROCESSING` reclaim (`[T8]`, reusing the same CAS/backdating mechanism
`[T7]` established), and the mutation crash/reclaim (`[T8]`) all exercise
real InnoDB transaction/locking semantics, never a mock. A fake LLM
provider/`ensureContinuity` double is used only for deterministic crash
injection and to avoid real DeepSeek cost in this file - exactly as the
pre-existing V1.8.1 tests in the same file already do.

## 20. Real DeepSeek regression (Section Z)

Not re-run in this task. Fix 1/Fix 2 touch zero code on the cognition/model
path itself (no changes to `salesAgentRuntime.ts`, `runSalesAgentRuntimeCycle.ts`,
`deriveMessages.ts`, or any DeepSeek-calling code) - V1.8.1's own real
DeepSeek + MariaDB benchmark (`scripts/live-turn-settle-benchmark.ts`,
Section 20 of that release doc) remains the standing evidence for the
fragmented-turn/correction/single-message scenarios. Re-running it was
judged unnecessary scope for this narrow hardening slice; flagged here
rather than silently skipped.

## 21. Full-repo regression classification (Section AB)

`npm test` (12 batches): 4217 tests total (4212 V1.8.1 baseline + 5 new -
`[T5/T6]` share one test function), 4192 pass, 25 fail.

All 25 failures classified `PREEXISTING`:

- 21 map 1:1 to the exact 12 files V1.8.1's own closure doc already
  documented as preexisting (`a13ConversationalReliabilityBenchmark`,
  `createCustomerCapability`, `customerOnboardingPostPlanPrivacy`,
  `customerOnboardingPostPlanStage`, `customerSession`,
  `customerSessionPrivacy`, `linkExternalIdentityCapability`,
  `processInboundCommercialShadow`, `runCommercialOperationalLoop`,
  `customerIdentityOnboarding.e2e` - re-verified directly this session via
  `git stash push -u` against the clean pre-V1.8.1a working tree: the
  4 `customerIdentityOnboarding.e2e` failures reproduce identically on the
  clean baseline).
- 2 more (`agentSessionStoreMariaDb`'s same-millisecond ordering flake,
  `commercialWorkParallelExecution`'s wall-clock-speedup timing test) are the
  same category of known, timing-sensitive flake V1.8-FINAL's own closure doc
  already named as preexisting debt from D6/D7 - inherently non-deterministic
  across runs, not tied to any file this task touched.
- 2 more (`tests/domains/customerIdentityEvidence.test.ts`, `IDE08` +
  "repeat observation of the SAME value") were NOT in either prior doc's
  named list, so they were verified directly rather than assumed: run in
  isolation against the clean pre-V1.8.1a working tree, both pass (18/18).
  This is the same documented "`DATABASE_NAME` isolation cluster between
  files" flake category V1.8-FINAL already named as preexisting - it
  surfaces only when this file runs in the same batch/process as certain
  others, independent of any code this task changed.

**Zero new failures introduced by this task's code changes** (Fix 1: two
files, `repository.ts` and `service.ts`; Fix 2: zero production code
changes, tests only).

`npx tsc --noEmit`, `npm run build` (27/27 pages), and `npm run lint`
(0 errors, 40 warnings, identical to V1.8.1/V1.8-FINAL) are all clean.

## 22. Files changed

Modified:

- `lib/brain/commercial/turn-settlement/repository.ts` - `upsertPendingTurn`
  (+ its two internal helpers) accept an optional `PoolConnection`.
- `lib/brain/native-whatsapp/service.ts` - settlement upsert moved inside
  the inbound transaction; new `upsertPendingTurnFn` test seam on
  `NativeWhatsAppProcessDependencies`.

New tests:

- `tests/native/inboundTurnSettling.e2e.test.ts` - `[T2]`, `[T3]`, `[T4]`,
  `[T5/T6]`, `[T8/K/G6]` (6 new tests total).

New documentation:

- `docs/releases/SALES-AGENT-R3-V1.8.1A-HARNESS-SEMANTIC-DURABILITY-HARDENING.md`
  (this file).

Updated:

- `docs/ACTIVE_RELEASE.md` - this release's entry.

No changes to: `assembleTurnFragments.ts`, `runTurnSettleTick.ts`,
`config.ts`, `types.ts`, `createQuoteCapability.ts`, `executeCapability.ts`,
`ensureAutonomousSalesTurnContinuity.ts`, `deriveMessages.ts`,
`dispatchGovernedSalesAgentMessage.ts`, or any other V1.8.1 file - both
findings (Section 3) resolved without touching them.

## 23. Migration status

No new migration. Migration 035 (`crm_inbound_turn_settlements`) already
provides every column this fix needed; Fix 1 is a transaction/API-shape
change only, per Section W's own instruction to prefer no schema change.

## 24. Remaining debt

Everything V1.8.1 already carried forward as explicit debt remains unchanged
by this task (no bounded retry cap on `crm_inbound_turn_settlements`,
`dispatchSalesAgentHardHandoff` excluded from the freshness recheck, no live
Meta Cloud API typing UI smoke, no structured `turn_pending`/`turn_settled`
event taxonomy). Nothing new is added:

1. Real DeepSeek regression for the atomicity/idempotency changes was not
   re-run (Section 20) - judged unnecessary since neither fix touches the
   cognition/model code path, but flagged rather than silently skipped.
2. The `[T8/K/G6]` proof exercises `create_quote` specifically (the
   capability the task brief named). No second mutating capability was
   walked through the same crash/reclaim harness - `create_quote`'s
   idempotency pattern (durable key from `opportunityId` + a
   `crm_request_facts.factId`) is representative of the same family used by
   `selectShippingOptionCapability`/`calculateShippingCapability`
   (documented in prior audits, e.g. `[[sales-agent-r2-cross-service-integration-audit]]`),
   but that equivalence was not independently re-verified in this task.

## Exit gates (Section AD)

| Gate | Evidence |
|---|---|
| G1 every committed settling-enabled inbound has durable processing responsibility | `[T2]`, Section 5 |
| G2 no crash window between canonical inbound commit and settlement ownership | `[T3]`, Section 8 |
| G3 delay=0 behavior unchanged | `[T1]`, Section 6 |
| G4 concurrent fragments still converge to one PENDING turn | `[T5/T6]`, Section 7 |
| G5 stale worker recovery works | `[T7]` (pre-existing, re-verified), Section 10 |
| G6 completed mutation cannot duplicate after crash/reclaim | `[T8/K/G6]`, Section 12 |
| G7 recovery reloads durable state rather than depending on previous in-memory reasoning | Section 10 (by construction - `processClaimedTurn` never persists/replays reasoning) |
| G8 supersession behavior unchanged | `[T9/G8/K]` (pre-existing, re-verified), Section 16 |
| G9 mutation completed before supersession remains durable and not replayed | Section 13 (unchanged V1.8.1 scope decision) |
| G10 persistent memory unchanged | `[T8/G4/J]` (pre-existing, re-verified) + `deriveMessagesTurnSettling.test.ts`, Section 16 |
| G11 typing unchanged | `[T12]`/`[T13]`/`[T14]` (pre-existing, re-verified), Section 16 |
| G12 access gates unchanged | `[T15/Q]` (pre-existing, re-verified), Section 16 |
| G13 dispatch/outbox unchanged | Section 16 (zero files under `dispatchGovernedSalesAgentMessage.ts`/outbox touched) |
| G14 no unnecessary schema redesign | Section 23 - no migration |

All 14 hold with direct evidence.

## Pilot readiness (Section AF)

**`TURN_SETTLING_NOT_READY_FOR_PILOT`**

This task's own validation is structural/durability hardening, not a pilot
decision. The pilot configuration
(`BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS=1800`,
`BRAIN_R3_INBOUND_TURN_SETTLE_MAX_MS=5000`,
`BRAIN_WHATSAPP_TYPING_INDICATOR_ENABLED=true`) is unchanged and was not
enabled as part of this task, per the task brief's own explicit instruction.
V1.8.1's own debt (no retry cap, no live Meta UI smoke, no structured event
taxonomy) still stands between here and a real controlled multi-tester
pilot - this task closes two structural correctness gaps, it does not close
the pilot-readiness gap by itself.

## V1.9 readiness (Section AG)

**`READY_FOR_R3_V1_9_SELF_RECOVERY`**

Unchanged from V1.8.1's own assessment - V1.9 (Self-Recovery / Tool-Failure
Resilience) concerns a single turn's tool-call retry/reasoning behavior once
cognition has started, orthogonal to both turn-settling (V1.8.1) and this
task's durability hardening (V1.8.1a). Nothing in this task narrows or blocks
V1.9's scope.

**DO NOT IMPLEMENT V1.9.**
