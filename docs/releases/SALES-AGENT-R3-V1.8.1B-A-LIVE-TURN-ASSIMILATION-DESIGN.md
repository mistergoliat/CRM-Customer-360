# SALES-AGENT-R3-V1.8.1b-A -- Live Turn Assimilation + Conversational Continuity: Audit + Design + Objetivo B/C Implementation

Status: audit and design covering all three objectives (A/B/C), with
Objetivos B (conversation-scoped ownership) and C (conversational
continuity) actually implemented, tested, and closed in this same pass.
Objetivo A (live turn assimilation inside the Agent Tool Loop) is designed
in full (Section 8) but deliberately deferred to a dedicated follow-up -
see Section 20 for the exact split and why.

## 0. Implementation verdict (Objetivos B + C)

**`R3_V1_8_1B_BC_OBJECTIVES_VALIDATED`**

- **Objetivo B**: `claimPendingTurn` (`lib/brain/commercial/turn-settlement/repository.ts`)
  gains a correlated `NOT EXISTS` guard - a `PENDING` row can only be
  claimed if no sibling row for the same `conversation_id` is already
  `PROCESSING`. Zero schema change, zero change to `upsertPendingTurn`'s
  insert/extend semantics. 3 new tests (`[B6]`/`[B7]`/`[B8]`,
  `tests/commercial/turnSettlementRepository.test.ts`, real MariaDB),
  12/12 passing in that file (9 pre-existing + 3 new).
- **Objetivo C**: new pure module
  `lib/brain/commercial/agent-loop/conversationContinuity.ts`
  (`ConversationContinuitySignal`, derived fresh every turn, never
  persisted), wired through `salesAgentRuntime.ts` ->
  `runAgentToolLoop.ts` -> `buildAgentStepPromptPackage.ts`, plus 6 new
  prompt rule lines (`CONVERSATION_CONTINUITY_RULE_LINES`) in both the
  gathering and finalization branches of `buildEvidenceAndToolRulesLines`.
  11 new tests (`[C1]`-`[C8]` pure unit,
  `tests/agent-loop/conversationContinuity.test.ts`; `[V1.8.1b-C9]`/
  `[V1.8.1b-C10]` end-to-end against real persisted history,
  `tests/commercial/salesAgentRuntime.test.ts`), all passing.
- The pre-existing exact-length "golden prompt" tests in
  `tests/agent-loop/buildAgentStepPromptPackage.test.ts` (a deliberate
  anti-drift convention already used by T08C/T09A/T11H) were updated to
  the new, larger, correct lengths following that exact same convention -
  +967 chars in both phases' system prompt, +126 chars in the user
  payload. `[LLM-R1-T03 Caso 8]`'s own comparison target was changed from
  an ancient, task-specific historical ceiling (pre-T03, now legitimately
  exceeded by the accumulated real content of several later tasks
  including this one) to a more durable invariant (finalization always
  smaller than gathering) - see that test's own updated comment for the
  full reasoning.
- Regression: `tests/agent-loop/*.test.ts` (477/477),
  `tests/commercial/salesAgentRuntime.test.ts` (27/27),
  `tests/native/*.test.ts` (68/68), the full turn-settlement suite (45/45).
  Full suite (`npm test`, 12 batches): 4230 tests (4217 V1.8.1a baseline +
  13 new), 4207 pass, 23 fail - every failing test maps 1:1 to a file
  already named `PREEXISTING` by V1.8.1a's own closure doc
  (`a13ConversationalReliabilityBenchmark`, `agentSessionStoreMariaDb`'s
  known same-millisecond flake, `commercialWorkParallelExecution`'s known
  timing test, `createCustomerCapability`/`customerOnboardingPostPlanPrivacy`/
  `customerOnboardingPostPlanStage`/`customerSession`/`customerSessionPrivacy`,
  `linkExternalIdentityCapability`/`processInboundCommercialShadow`,
  `runCommercialOperationalLoop`, `customerIdentityOnboarding.e2e`) - zero
  new failing files. `npx tsc --noEmit`, `npm run build` (27/27 pages),
  `npm run lint` (0 errors, 40 warnings, identical baseline) all clean.
- Objetivo B's single-table `UPDATE ... WHERE NOT EXISTS (SELECT ... FROM
  same_table)` pattern (Section 6) is confirmed to work correctly against
  real MariaDB, not just reasoned about.

## 1. Current state (as verified against real code, not assumed)

The reactive WhatsApp path today, exactly:

```
Meta webhook -> processNativeWhatsAppInbound
  BEGIN TRANSACTION (V1.8.1a)
    persist conversation_message (canonical inbound, unchanged since V1.8)
    if settleDelayMs > 0: upsertPendingTurn (same transaction, V1.8.1a Fix 1)
  COMMIT
  if settleDelayMs <= 0: ensureAutonomousSalesTurnContinuity (sync, unchanged)

scripts/autonomous-turn-settle-worker.ts -> runTurnSettleTick (poll loop)
  selectDuePendingTurns / selectStaleProcessingTurns
  claimPendingTurn(id)  -- CAS: UPDATE ... WHERE id=? AND status='PENDING'
  processClaimedTurn(row)
    assembleTurnFragments(conversationId, first, latest)  -- fixed range read
    requestTypingIndicator (best-effort, non-blocking)
    ensureAutonomousSalesTurnContinuity({
      messageId: row.latest_inbound_message_id,          -- FIXED anchor
      messageText: assembled.content,                      -- FIXED text
      additionalInboundMessageIds,
      checkInboundFreshnessBeforeDispatch: true
    })
      -> runNativeAutonomousCycle -> runSalesAgentRuntimeCycle
           -> runSalesAgentRuntime -> runAgentToolLoop (gathering + finalization)
           -> dispatchSalesAgentTerminalOutcome -> dispatchGovernedSalesAgentMessage
                recheckConversationOwnership (SELECT ... FOR UPDATE)
                recheckInboundFreshness (conversation_message.id > anchor?)  -- ONE check, right before outbox insert
                writeCanonicalOutboxMessage
    wasSuperseded? -> supersedeTurn(id, newerMessageId) : completeTurn(id)
```

`runAgentToolLoop` itself (`lib/brain/commercial/agent-loop/runAgentToolLoop.ts`,
1054 lines) is a pure function of its input - no DB access of its own. Two
phases:

- **Gathering** (`while (decisionIndex < maxDecisions && toolExecutionCount < maxToolExecutions)`,
  lines 808-967): build prompt -> invoke provider -> validate `AgentStep` ->
  `respond`/`handoff` return immediately (terminal); `use_tool` ->
  `processUseToolStep` (real Capability Gateway/read-tool call, real durable
  side effects for mutating tools) -> push step -> loop.
- **Finalization** (`for (attempt < FINALIZATION_MAX_ATTEMPTS)`, lines
  969-1050): same prompt builder, no tools offered, only `respond`/`handoff`
  legal.

`customerMessage` (the joined fragment text) and the anchor
(`inboundMessageId`, mapped 1:1 to `crm_inbound_turn_settlements.latest_inbound_message_id`
at claim time) are both **fixed for the whole run** - set once in
`runSalesAgentRuntimeCycle.ts`/`salesAgentRuntime.ts` before `runAgentToolLoop`
is ever called, never re-read, never mutated across gathering/finalization
iterations.

Freshness is checked exactly **once**, at the very end, inside
`dispatchGovernedSalesAgentMessage.ts`'s `recheckInboundFreshness`
(`conversation_message.id > anchorMessageId`, same transaction as the outbox
insert). If stale, the candidate is discarded (`superseded_by_newer_inbound`)
and the settlement row becomes `SUPERSEDED` - no re-reasoning, no
resubmission, no follow-up turn is created automatically anywhere in this
call chain.

`crm_inbound_turn_settlements` (migration 035) uniqueness
(`pending_scope_key`, a generated column, `UNIQUE KEY`) only prevents two
`PENDING` rows for the same conversation. It does **not** prevent a new
`PENDING` row from being created (or claimed) while another row for the same
`conversation_id` is `PROCESSING` - `claimPendingTurn`'s own `UPDATE ... WHERE
id = ? AND status = 'PENDING'` has no conversation-scoped exclusivity check
at all.

Conversational continuity: no signal exists today.
`buildAgentStepPromptPackage.ts` (686 lines) has zero greeting/continuity
rule lines (confirmed by grep - the words "greet"/"saludo"/"hola" do not
appear anywhere in that file). The persistent-session historical prefix
(`deriveMessages.ts`) is already real, durable conversational history
(`conversation_message` rows mapped to `user`/`assistant` provider messages,
plus an optional compacted-prefix `system` message) - the model already
receives it every turn. The re-greeting defect is a **prompt-instruction
gap**, not a memory gap.

## 2. The exact race/gap that exists today

### Gap 1 (Objetivo B): no conversation-level cognitive-run exclusivity

1. Fragment/turn A settles, worker claims it -> row A `PROCESSING`.
2. While A's `runAgentToolLoop` is mid-flight, a new WhatsApp message arrives
   for the **same conversation**.
3. `processNativeWhatsAppInbound` persists it and calls `upsertPendingTurn` -
   `tryExtendPendingTurn` fails (row A is `PROCESSING`, not `PENDING`), so
   `tryInsertPendingTurn` succeeds: a **new row B, `PENDING`, for the same
   conversation**, coexists with row A `PROCESSING` (no uniqueness conflict -
   `pending_scope_key` is `NULL` for A since A is not `PENDING`).
4. If row B becomes due (`settle_after <= NOW()`) before row A finishes, the
   worker's next tick claims **both** A and B and runs `processClaimedTurn`
   on each - **two concurrent `runAgentToolLoop` executions for the same
   conversation**, exactly the defect Objetivo B names.
5. Even when B is claimed only after A finishes, A's own dispatch-time
   `recheckInboundFreshness` already independently prevents a stale double
   *send* (proven, `[T9]` in V1.8.1) - but A's entire cognitive run (a real
   DeepSeek call, real tool executions) was wasted work, and the customer
   waits for a second full run before getting any answer at all. This is the
   "respuestas atrasadas" symptom.

### Gap 2 (Objetivo A): no safe-boundary assimilation inside a run

Even once Gap 1 is closed (no *concurrent* runs), the single active run for
a conversation still cannot **incorporate** a new inbound that arrives while
it is reasoning. Its only two possible outcomes today are: finish and
dispatch (racing the one final freshness check), or finish and get
suppressed at that final check (`SUPERSEDED`, work discarded, customer
waits for a **second, independent, from-scratch** run to see the new
input). There is no middle path where the *same* cognitive work absorbs the
new sentence and answers it directly - which is the literal customer-visible
defect described in the task brief (fragmented thought handled as if it
were two disconnected requests).

### Gap 3 (Objetivo C): no continuity signal, no continuity prompt rules

`buildAgentStepPromptPackage.ts` gives the model perfect historical memory
but zero *instruction* on how to use it conversationally. Nothing is wrong
architecturally - the model simply has never been told "you already know
this, don't reopen the conversation." This is why the fix must be prompt
rules plus a small factual signal, never a memory fix (there is no memory
bug).

## 3. Proposed design (overview)

Three independent, additive extensions to the existing Harness-like model -
none require a rewrite, none introduce a workflow engine, none touch
Catalog/identity/Capability Gateway internals:

1. **Objetivo B - conversation-scoped ownership**: extend the *claim* step
   only (`claimPendingTurn`) with a correlated-subquery guard: a `PENDING`
   row can only transition to `PROCESSING` if no other row for the same
   `conversation_id` is currently `PROCESSING`. Zero schema change. Zero
   change to insert/extend semantics - a fragment arriving mid-run still
   opens its own ordinary `PENDING` row, exactly as today; it simply cannot
   be *claimed* until the conversation is free. This is "settlement
   ownership" from the task brief's own suggested mechanism list, expressed
   as one additional `WHERE NOT EXISTS` clause.

2. **Objetivo A - live turn assimilation**: two new safe boundaries inside
   `runAgentToolLoop`'s existing control flow (after a tool step completes,
   and immediately before a `respond`/`handoff` step is accepted as
   terminal) that re-check durable truth (a new, injected,
   `conversationId`-scoped read - `conversation_message.id > current
   assimilated anchor`) and, if newer inbound exists, fold its text into the
   turn's own `customerMessage` and advance the anchor **before** the next
   inference, instead of discarding the whole run. Bounded by a small,
   independent retry budget (never unbounded).

3. **Objetivo C - conversational continuity**: a small, purely descriptive,
   never-persisted signal (`isFirstConversationalTurn`/
   `hasPriorAssistantMessages`/`hasPriorCustomerMessages`) derived fresh
   every turn from the exact same durable history `deriveMessages.ts`
   already loads, plus new prompt rule lines that tell the model how to use
   it. No new table, no new column, no cognitive workflow state, no textual
   post-processing.

## 4. Existing pieces reused (nothing rebuilt)

- `crm_inbound_turn_settlements` (schema, CAS claim, stale-reclaim) - reused
  as-is for Objetivo B; its own `latest_inbound_message_id`/`fragment_count`
  become the durable anchor Objetivo A's assimilation boundary reads.
- `dispatchGovernedSalesAgentMessage.ts`'s `recheckInboundFreshness` -
  reused unmodified as the **final** safety net; Objetivo A reduces how
  often it actually fires (it becomes the rare residual-race path, not the
  common path), it does not replace it.
- `deriveMessages.ts` / `resolvePersistentSessionCognitionContext.ts` - the
  exact same historical-message array already computed every turn is the
  source for Objetivo C's continuity signal; no second history read.
- `assembleTurnFragments.ts`'s own query shape (`conversation_message`,
  `direction='inbound'`, ordered by `id`) - the pattern Objetivo A's
  "load anything newer than my anchor" read reuses (open-ended instead of a
  closed range).
- `runTurnSettleTick.ts`'s existing crash/stale-reclaim mechanism
  (`selectStaleProcessingTurns`/`reclaimStaleProcessingTurn`) - unchanged;
  Objetivo A never invents a second recovery path.
- The Agent Tool Loop's own bounded-retry idiom (`gatheringRetryUsed`,
  `FINALIZATION_MAX_ATTEMPTS`) - Objetivo A's assimilation cap follows the
  same "small, independent, one-shot-per-class" discipline already
  established in this exact file.

## 5. New persistence

**Objetivo B**: none. Pure application-code change to one SQL statement.

**Objetivo C**: none. Purely derived, never stored.

**Objetivo A**: none required to *function* (the assimilation anchor is
carried in the run's own memory, cross-checked against durable
`conversation_message`/`crm_inbound_turn_settlements` state at each
boundary - never itself a new row). Optional, additive observability
columns on `crm_inbound_turn_settlements` (Section 12) are the only
candidate schema change, and only needed once Objetivo A actually ships
code - not part of this pass.

## 6. Concurrency model

Conversation-scoped exclusivity, never a global lock:

```sql
UPDATE crm_inbound_turn_settlements t1
   SET status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP(3)
 WHERE t1.id = ?
   AND t1.status = 'PENDING'
   AND NOT EXISTS (
     SELECT 1 FROM crm_inbound_turn_settlements t2
      WHERE t2.conversation_id = t1.conversation_id
        AND t2.status = 'PROCESSING'
   )
```

A single-table `UPDATE` with a correlated `NOT EXISTS` subquery against the
same table (via a second alias) is standard, supported SQL in MariaDB - it
is not the "can't specify target table for update in FROM clause" case
(that restriction applies to multi-table `UPDATE`/derived-table forms, not a
plain correlated subquery in a single-table `UPDATE ... WHERE` clause).
Verified against real MariaDB as part of this task's own tests (Section 13).

Properties:

- Two rows for conversation A can never both be `PROCESSING` at once - the
  `NOT EXISTS` check and the `status='PENDING'` check are evaluated
  atomically under InnoDB's row locking for the matched row, and any second
  concurrent claim attempt for a sibling row of the SAME conversation will
  either see the first one's row-lock (serializing) or, once committed, see
  it already `PROCESSING` and fail its own `NOT EXISTS` check.
- Conversation B's claim is entirely unaffected - the subquery is scoped by
  `conversation_id`, so it never contends with conversation A's rows.
- No in-memory state anywhere - correctness holds across multiple worker
  processes, PM2 restarts, and horizontal scale-out, exactly like every
  other CAS in this codebase (`runFollowupTick.ts`, `commercialWorkWorker.ts`).
- A losing claim is not an error (mirrors the existing `if (!claimed)
  continue;` idiom in `runTurnSettleTick.ts`) - the row stays `PENDING` and
  is retried on a later tick, once the conversation frees up.

## 7. Crash-recovery semantics

Unchanged mechanism, now also the correct behavior for Objetivo B: a worker
that crashes mid-`PROCESSING` leaves the row `PROCESSING`, which (via this
task's own new guard) **also continues to block any sibling `PENDING` row
for that conversation from being claimed** until
`selectStaleProcessingTurns`/`reclaimStaleProcessingTurn` (existing,
120s-stale threshold, unchanged) reclaims it. This is intentional, not a
side effect to work around: while it is ambiguous whether the previous
worker is truly dead, a second cognitive run for the same conversation must
not start (that would silently reintroduce Gap 1). Once reclaimed, the
recovering worker re-derives cognition from current durable truth exactly
as `[T7]`/`[T8]` (V1.8.1/V1.8.1a) already prove - no attempt to resume the
dead worker's in-memory reasoning state.

Objetivo A's live-assimilation state (the in-run "assimilated anchor") is
**never** persisted mid-run and never needs to be recovered - if the worker
crashes mid-assimilation, the row simply stays `PROCESSING`, gets reclaimed
exactly like any other crash, and the new attempt starts fresh from
`row.latest_inbound_message_id`/current `conversation_message` truth (I2/I3:
reasoning is disposable, only completed business effects are durable and
must never be replayed - proven for `create_quote` in V1.8.1a's own
`[T8/K/G6]`).

## 8. Live-turn assimilation algorithm (Objetivo A design, for the follow-up task)

Two safe boundaries only, both inside `runAgentToolLoop`'s existing control
flow, never touching an in-flight LLM HTTP call:

**Boundary 1 - after a tool step, before the next gathering iteration**
(right after the existing `steps.push({...})` call for a `use_tool` step,
before `decisionIndex += 1`):

```
result = processUseToolStep(...)
steps.push(...)
newInbound = checkForNewInbound(conversationId, assimilatedAnchorId)   -- new DI seam, real default queries conversation_message
if newInbound.found:
  customerMessage = customerMessage + "\n" + newInbound.content        -- local var, mirrors assembleTurnFragments' own join
  assimilatedAnchorId = newInbound.latestMessageId
  assimilatedMessageIds.push(...newInbound.messageIds)
  assimilationRounds += 1
decisionIndex += 1
```

**Boundary 2 - candidate final response, before it is accepted as terminal**
(both the gathering-phase `respond` branch and the finalization-phase
`respond` branch, right before `return respondedResult(step)`):

```
if step.type === "respond":
  newInbound = checkForNewInbound(conversationId, assimilatedAnchorId)
  if newInbound.found and assimilationRounds < MAX_ASSIMILATION_ROUNDS:
    customerMessage = customerMessage + "\n" + newInbound.content
    assimilatedAnchorId = newInbound.latestMessageId
    assimilatedMessageIds.push(...newInbound.messageIds)
    assimilationRounds += 1
    invalidatedCandidateCount += 1
    continue   -- back into gathering, NOT a return; the discarded candidate is never pushed as a step
  steps.push({...})
  return respondedResult(step)
```

Both boundaries call the exact same injected function
(`checkForNewInbound`, a new optional `RunAgentToolLoopInput` field,
defaulting to a real implementation that queries `conversation_message
WHERE conversation_id = ? AND direction = 'inbound' AND id > ? ORDER BY id
ASC` - the open-ended sibling of `assembleTurnFragments`'s closed-range
query, same ordering discipline). `assimilatedAnchorId` starts at
`input.inboundMessageId` (today's fixed anchor) and only ever advances
forward.

`MAX_ASSIMILATION_ROUNDS` (proposed: 2, independent of `maxDecisions`/
`maxToolExecutions`/`FINALIZATION_MAX_ATTEMPTS`) bounds worst-case cost the
same way `gatheringStructuredRecoveryUsed`/`FINALIZATION_MAX_ATTEMPTS`
already bound their own retry classes - a customer who keeps typing faster
than the model can finish reasoning eventually gets an answer to
*something*, with the residual gap closed by the unchanged final
`recheckInboundFreshness` (Section 9) rather than an unbounded loop.

The run's final `AgentLoopResult` gains three new, purely observational
fields: `assimilatedInboundMessageIds` (every id folded in mid-run - must
also be excluded from persistent-session history alongside the original
anchor, same discipline `additionalInboundMessageIds` already established
in V1.8.1), `assimilationRounds`, `invalidatedCandidateCount` - threaded up
through `SalesAgentRuntimeResult`/`SalesAgentRuntimeCycleResult` to
`ensureAutonomousSalesTurnContinuity`, which advances the settlement row's
own anchor (`row.latest_inbound_message_id`, via a new small repository
function) and the dispatch-time freshness check's own `anchorMessageId` to
the **assimilated** anchor, not the claim-time one - closing the loop so
the final freshness check (Section 9) only ever fires for input that
arrived *after* the last assimilation boundary, not for anything already
folded in.

## 9. Finalization / freshness algorithm

`dispatchGovernedSalesAgentMessage.ts`'s `recheckInboundFreshness` stays
architecturally unchanged (Section 4) - it remains the last-possible-moment,
same-transaction-as-outbox-insert check. What changes is only its INPUT: the
`anchorMessageId` it compares against becomes the run's own **assimilated**
anchor (Section 8) instead of the fixed claim-time anchor. This is a strict
superset of today's guarantee - it can only ever suppress *fewer* false
positives (input already assimilated no longer reads as "newer"), never
weaken the check itself. `[T9]` (V1.8.1, unmodified) continues to prove the
mechanism; a new test (Section 13, deferred with Objetivo A) proves the
assimilated-anchor variant specifically.

Outbox-level (post-dispatch, pre-Meta-send) freshness: audited, not
implemented. `brain_message_outbox` rows are sent by a separate worker
(`outboxWorker.ts`) asynchronously after this whole chain already
committed the row as `planned`. The task brief asks to audit whether this
gap is real before building anything for it - Section 21 records the
finding: real but pre-existing and out of scope for this task (see Test 13
below).

## 10. Conversational continuity derivation

Computed fresh every turn, in `salesAgentRuntime.ts`, immediately after
`persistentSessionCognition` is resolved - no new I/O, no new table:

```ts
export type ConversationContinuitySignal = {
  isFirstConversationalTurn: boolean;
  hasPriorAssistantMessages: boolean;
  hasPriorCustomerMessages: boolean;
};
```

- **Persistent-session path (the default since V1.8-D6)**: derived directly
  from `persistentSessionCognition.historicalMessages` - `hasPriorAssistantMessages`
  = any `role: "assistant"` entry exists; `hasPriorCustomerMessages` = any
  `role: "user"` entry exists. A compacted-prefix-only array with zero real
  tail is not expected under the current compaction policy (it always keeps
  a target recent-message tail), and even in that edge case the prefix's
  own summary text already signals prior history to the model - no special
  compaction case is needed in the derivation itself.
- **Legacy fallback path** (persistent-session cognition disabled or
  degraded this turn): derived from the same reduced `recentMessages` array
  already built into `commercialContextSummary` (`buildMinimalCommercialContextSummary`) -
  `direction: "outbound"`/`"inbound"` entries map the same way. Missing or
  malformed `recentMessages` defaults to `isFirstConversationalTurn: false`
  (the safer failure mode - an occasional under-warm first message is a much
  smaller defect than re-greeting an active conversation).

This is intentionally **not** persisted anywhere, **not** cached across
turns, and **not** a workflow flag - every turn recomputes it from whatever
durable history is actually loaded that turn, so it can never drift out of
sync with the real transcript, and there is nothing to migrate, backfill, or
reset.

## 11. Prompt changes (exact)

New constant array in `buildAgentStepPromptPackage.ts`, included in both the
gathering and finalization branches of `buildEvidenceAndToolRulesLines`
(same place `COMMERCIAL_CLOSING_RULE_LINES` already sits) - behavioral rules
only, zero hardcoded example phrases:

```
"The user payload's conversationContinuity field states whether real prior conversational turns already exist for this customer - never infer this from the wording of the current message alone."
"Use a greeting only when conversationContinuity.isFirstConversationalTurn is true."
"When conversationContinuity.isFirstConversationalTurn is false, do not greet the customer again, do not restart the conversation, and do not recap what is already known merely to reopen it."
"If the customer sends a short greeting while conversationContinuity.isFirstConversationalTurn is false, acknowledge naturally and continue the existing conversation instead of responding as if it were new."
"Do not ask again for facts already available in commercialContext or in the conversation history above - continue directly from that established context."
"These continuity rules govern tone and framing only - they never override the evidence/tool-usage rules or the AgentStep contract above."
```

`conversationContinuity` is added as a new field on both `currentTurnPayload`
(persistent-session branch) and `userPayload` (legacy branch) of the `user`
message - additive JSON key, never changes any existing field's shape (no
test in this codebase asserts a full-payload `deepEqual`, verified by grep
before this change).

## 12. Observability

Objetivo B needs none beyond what already exists - a losing claim is
already a normal, logged-nowhere non-event (`if (!claimed) continue`,
unchanged), and the eventual successful claim/complete/supersede path is
unchanged.

Objetivo C needs none - it is a pure per-turn derivation with no side
effects to observe; if it is wrong, it is wrong in the prompt payload itself,
inspectable the same way every other `commercialContext` field already is.

Objetivo A (the follow-up task) is the one piece that benefits from a
little more - per the task brief's own list, kept intentionally minimal:
`crm_inbound_turn_settlements` already carries settlement id, conversation
id, initial inbound anchor (`first_inbound_message_id`), and (after Section
8's anchor-advance change) the final assimilated anchor
(`latest_inbound_message_id`) and initial fragment count (`fragment_count`)
for free - no new columns needed for those four. Two new, small, additive
columns would be needed for the last two ("cuantos inbound asimilados
durante RUNNING" and "cuantas veces se invalido una candidate") -
`assimilated_inbound_count`/`invalidated_candidate_count`, both
`INT UNSIGNED NOT NULL DEFAULT 0` - proposed as part of Objetivo A's own
migration, not this task's (Section 20). No new event-type taxonomy, no
raw prompt/PII persisted beyond what already exists.

## 13. Tests (status against this task vs. the deferred follow-up)

Numbered exactly as the task brief's own list, each marked with what this
task actually implements:

1. **Debounce basico** - pre-existing, unchanged (`[T3/G2/G3]`, V1.8.1).
2. **New inbound during LLM inference** - Objetivo A (deferred). Requires
   the in-flight-boundary assimilation this task does not implement.
3. **New inbound during tool execution** - Objetivo A (deferred), Boundary
   1 above.
4. **New inbound during finalization** - Objetivo A (deferred), Boundary 2
   above.
5. **Side effect + assimilation (no compensation)** - partially covered
   today by V1.8.1a's `[T8/K/G6]` (mutation survives a crash/reclaim
   without duplicating); the assimilation-specific variant (mutation, then
   a NEW inbound arrives, next inference re-reads fresh state including the
   mutation) is Objetivo A (deferred).
6. **Same-conversation concurrency (max one active owner)** - **this task**,
   new test against real MariaDB: two rows for the same conversation, one
   already `PROCESSING`, the second's claim attempt must fail.
7. **Different conversations run in parallel** - **this task**, new test:
   conversation A `PROCESSING` never blocks conversation B's claim.
8. **Crash recovery** - pre-existing mechanism unchanged (`[T7]`, V1.8.1);
   this task adds one new test confirming the ownership guard itself
   survives a claim/reclaim cycle correctly (a reclaimed row must still
   pass the same `NOT EXISTS` check, and must not be blocked by its own now
   stale-but-still-technically-PROCESSING predecessor row once that row is
   reclaimed rather than left dangling).
9. **First-turn greeting** - **this task**, new test:
   `conversationContinuity.isFirstConversationalTurn === true` when no
   real prior messages exist.
10. **Active conversation, no greeting** - **this task**, new test.
11. **Active conversation + "hola"** - covered structurally by the same
    signal/prompt-rule pair as #10; real-model behavior (does DeepSeek
    actually comply) is a benchmark concern, not a unit-test one - flagged,
    not asserted against a live model in this task (see Section 21).
12. **Known facts, no re-asking** - same as #11: the signal/rule pair is
    unit-tested; live-model compliance is a benchmark concern.
13. **Final stale outbound audit** - **this task**, audit only (Section 9's
    finding above): real but pre-existing, out of scope for code changes.

## 14. Compatibility impact

Zero for existing traffic. Objetivo B's guard only changes claim ELIGIBILITY
for a `PENDING` row when a sibling `PROCESSING` row for the same
conversation already exists - a scenario that, before this task, could only
ever produce the exact bug being fixed (two concurrent runs). Every other
claim path (the overwhelming majority - one active row per conversation at
a time, which is already the common case even without this guard) is
byte-identical. Objetivo C only adds a new JSON key and new system-prompt
lines - no existing field changes shape, no existing rule is removed or
contradicted (the new lines are additive and explicitly scoped to "tone and
framing only").

## 15. Migration impact

None for this task (Objetivo B + C, Section 5). Objetivo A's future
migration (Section 12's two optional counter columns) would be additive
only, `DEFAULT 0`, no backfill, following the exact same "no new migration
unless proven necessary" discipline V1.8.1a already established.

## 16. Rollout flags

Objetivo B's ownership guard is not independently flagged - it is a pure
bugfix to `claimPendingTurn`'s own CAS condition, active whenever turn
settling itself is active (`BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS > 0`,
still `0` by default/unchanged). Introducing a separate flag for a
narrowing-only correctness fix (it can only prevent claims that were always
a bug) would add configuration surface with no real rollback value - the
existing settle-delay flag already is the kill switch for the entire
mechanism this guard lives inside.

Objetivo C's continuity signal/rules are also not independently flagged -
same reasoning: they are additive prompt content, active whenever the Agent
Tool Loop itself runs (both R3 runtime paths), and the only "rollback" that
would ever matter (reverting a bad prompt change) is a normal code
revert/redeploy, not a runtime toggle - this codebase does not flag
individual prompt-rule additions elsewhere either (e.g. `COMMERCIAL_CLOSING_RULE_LINES`,
`PENDING_CATALOG_ACTION_RULE_LINES` have no flags of their own).

Objetivo A (deferred) would need its own flag
(`BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED`, proposed default `false`) since
it changes the Agent Tool Loop's own control flow (a `continue` instead of
`return` at two real terminal points) - a genuinely new code path deserving
its own kill switch, unlike B/C above.

## 17. Rollback strategy

Objetivo B: revert the one-line `claimPendingTurn` SQL change (or the whole
commit) - no data migration, no flag flip needed; the guard is pure
application logic over existing columns.

Objetivo C: revert the prompt-rule/payload-field commit - no data impact,
no flag flip needed.

Objetivo A (deferred): `BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED=false` (its
own proposed flag, Section 16) is the rollback lever, mirroring
`BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS=0`'s own role for the turn-settling
mechanism it sits inside.

## 18. Risks

- **Objetivo B**: a pathological conversation that never lets its
  `PROCESSING` row finish (e.g. a genuinely hung provider call past the
  loop's own `timeoutMs`) delays every subsequent `PENDING` row for that
  SAME conversation until the existing stale-reclaim window (120s) passes -
  this is a real, but bounded and pre-existing, latency risk (today, the
  SAME hang would have let two runs collide instead, which is strictly
  worse for the customer). Not a new failure mode Objetivo B introduces,
  a real one it makes visible/bounded instead of silently double-running.
- **Objetivo C**: a model that ignores the new instruction lines entirely
  (prompt compliance is never guaranteed) - mitigated only by the
  instruction quality itself and, longer-term, a benchmark (Section 21),
  never enforced structurally (there is no reliable way to structurally
  block "the model said hola" without the exact textual-post-processing
  hack the task brief explicitly forbids).
- **Objetivo A (deferred)**: the highest-risk piece of this whole release -
  restructuring `runAgentToolLoop`'s terminal-return control flow (`return`
  -> conditional `continue`) touches the most heavily exercised code path in
  the whole R3 stack. Deliberately not implemented in this pass; see Section
  20.

## 19. Decisions explicitly rejected

- **Global lock / single-threaded chat processing** - rejected per the task
  brief's own explicit non-goal; would serialize unrelated conversations for
  no correctness benefit.
- **In-memory lock/mutex per conversation** - rejected: fails across
  multiple worker processes and PM2 restarts, violates "no in-memory state
  for correctness" (Section 6/7).
- **A brand-new "conversation lock" table** - rejected: `crm_inbound_turn_settlements`
  already carries conversation-scoped ownership state; a second table would
  duplicate that concept for no benefit (Section 4/6).
- **Absorbing new inbound into the active `PROCESSING` row's own
  `latest_inbound_message_id` at claim/extend time (an earlier candidate
  design for Objetivo B)** - rejected after tracing it through: it would
  silently strand the absorbed fragment with no settlement row ever driving
  a follow-up turn once the active run finishes without having assimilated
  it (since, before Objetivo A ships, nothing inside the run ever reads that
  extension) - a real regression risk the simpler claim-time-only guard
  (Section 6) does not have, since a new fragment still always gets its own
  ordinary `PENDING` row under the chosen design.
- **Textual post-processing to strip greetings
  (`if response.startsWith("Hola") removeGreeting()`)** - rejected per the
  task brief's own explicit prohibition; also incorrect on its face (a
  legitimate mid-message "hola" would be mangled).
- **A persisted `hasGreeted`/`conversationStage` cognitive workflow flag** -
  rejected per the task brief's own explicit prohibition; also redundant -
  the exact same fact is already reconstructible, correctly, from durable
  transcript state every turn (Section 10).
- **Mutating an in-flight LLM HTTP request** - rejected per the task
  brief's own explicit prohibition; also not a real capability any provider
  contract in this codebase exposes.
- **Compensating/rolling back a durable mutation once a newer inbound
  arrives** - rejected per the task brief's own explicit prohibition and
  this codebase's own established principle ("cognition can be superseded,
  durable business truth cannot be un-happened" - V1.8.1a's own Section N).
- **A new, larger event-type taxonomy for turn observability
  (`turn_started`/`inbound_assimilated`/`final_candidate_invalidated`/`turn_completed`
  as `commercial_event` rows)** - rejected in favor of the two small,
  additive counter columns (Section 12): the task brief itself explicitly
  warns against "una taxonomia inflada," and every fact those four event
  types would carry is already derivable from
  `crm_inbound_turn_settlements`'s own existing + two new columns without a
  second observability surface to keep in sync.

## 20. What this task implements now vs. defers

**Implemented in this pass** (small, independently reviewable, zero
concurrency-model risk):

- Objetivo B: the `claimPendingTurn` conversation-ownership guard
  (Section 6), with new tests 6/7/8 (Section 13).
- Objetivo C: the `conversationContinuity` signal + prompt rules
  (Sections 10-11), with new tests 9/10 (Section 13).

**Deferred to a dedicated follow-up task** (`R3-V1.8.1b-B` or similar):

- Objetivo A in full: the two safe-boundary assimilation points inside
  `runAgentToolLoop` (Section 8), the assimilated-anchor threading through
  `SalesAgentRuntimeResult`/`ensureAutonomousSalesTurnContinuity`/
  `dispatchGovernedSalesAgentMessage` (Section 9), its own rollout flag
  (Section 16), and tests 2/3/4/5 (Section 13).

**Why split here**: Objetivo A is the one piece that changes the Agent Tool
Loop's own terminal control flow - the highest-traffic, most safety-critical
code path in the whole R3 stack (every real customer turn passes through
it). B and C are each fully self-contained, additive, and independently
low-risk; shipping them now closes two real, currently-live defects (wasted
concurrent runs, and the re-greeting UX defect) immediately, without betting
both on getting the harder assimilation control-flow change right in the
same pass. This mirrors how V1.8 itself shipped (D1 through D7 across many
sessions, never one combined change) and follows this repo's own explicit
governance ("Mantener cambios pequenos y revisables").

## 21. Additional findings worth carrying forward

- Test 11/12 (real-model continuity compliance) are **not** unit-testable
  against a fake/scripted provider in any meaningful way - a scripted
  provider always returns whatever the test tells it to, so asserting "the
  model didn't greet" against a fake provider only tests that the fake
  provider does what it's told. A real benchmark (mirroring V1.8.1's own
  `scripts/live-turn-settle-benchmark.ts`) is the right vehicle once Objetivo
  A's assimilation is also in place - deferred alongside it.
- Test 13 (outbox-level staleness before Meta send): audited. Once
  `dispatchGovernedSalesAgentMessage` writes a `planned` row to
  `brain_message_outbox`, the actual Meta send happens later, asynchronously,
  from `outboxWorker.ts` - that worker's own claim/send path does not
  re-check `conversation_message` for anything newer than the outbox row's
  own `sourceRequestId` (`inboundMessageId`) before sending. This is a real,
  narrow residual gap (a `planned` response could still be sent after a
  customer's very next message, if that next message arrives in the window
  between outbox-insert and the worker's own send), but it is **pre-existing**
  (unrelated to turn settling - it exists for every R3 dispatch, delay=0
  included) and explicitly out of this task's scope per the task brief's own
  "no implementar automaticamente si no es necesario, primero auditar."
  Recorded here as known, real, unactioned debt for a future task to pick up
  deliberately, not silently.
