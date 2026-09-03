# SALES-AGENT-R3-V1.8.1 -- Conversational Turn Settling + WhatsApp Typing Indicator

Status: implementation + validation. Real code behind two independent,
fail-closed flags (`BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS=0` by default,
`BRAIN_WHATSAPP_TYPING_INDICATOR_ENABLED=false` by default). Real DeepSeek +
real MariaDB (`crm_test`) end-to-end validation included, driven through the
actual production webhook entry point.

## 1. Executive verdict

**`R3_V1_8_1_CONVERSATIONAL_TURN_SETTLING_VALIDATED_WITH_KNOWN_DEBT`**

A durable, configurable inbound-turn-settling mechanism now sits between raw
WhatsApp webhook deliveries and R3 cognition: fragments are persisted
individually (unchanged), debounced by a quiet/max window into one
aggregated turn, executed exactly once through the existing
`ensureAutonomousSalesTurnContinuity` boundary, rechecked for staleness
immediately before dispatch, and only then sent. `BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS=0`
(the default) takes the exact pre-V1.8.1 code path - the rollback lever is a
single config value, not a deploy. A WhatsApp typing indicator, gated by its
own independent flag, fires once a turn settles and fails open (never blocks
the turn). All 17 exit gates (Section AE below) hold with direct evidence,
most against real MariaDB and, for the structural benchmark, real DeepSeek.

"Known debt", not "blocked", because: (1) no bounded max-retry-count exists
on `crm_inbound_turn_settlements` itself (a turn that keeps failing before
reaching `completeTurn`/`supersedeTurn` stays `PROCESSING` forever, reclaimed
every `TURN_SETTLE_STALE_PROCESSING_LOCK_SECONDS` indefinitely) - deliberately
not built per the task brief's own "do not introduce
`BRAIN_R3_INBOUND_TURN_SETTLE_MAX_MESSAGES` unless max-window alone proves
insufficient" discipline, extended here to the same judgment for a retry cap;
(2) real Meta Cloud API typing/read-receipt validation is request-construction
+ failure-isolation only (Section Y) - no live WhatsApp UI smoke was run, the
same category of deferred validation V1.8-FINAL already carried forward for
the base pilot; (3) `dispatchSalesAgentHardHandoff` is deliberately excluded
from the freshness recheck (Section L), a scope decision, not an oversight,
but it means a hard-handoff acknowledgement can still be sent after a newer
fragment arrived mid-cognition - documented, not silently absent.

Production classification: **`PRODUCTION_ARCHITECTURE_VALIDATED`** for the
settling/freshness mechanism itself, gated the same way V1.8's persistent
session was - real code, real tests, pilot rollout is a separate, later
decision (`BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS` stays `0` until a pilot
value is deliberately set, exactly like `BRAIN_R3_SESSION_COMPACTION_ENABLED`
before it).

## 2. Problem definition

A WhatsApp webhook delivery is a transport event, not a conversational turn.
A customer typing "hola" / "como" / "estas" as three separate messages
produced three independent, synchronous R3 executions and (with dispatch
already deduplicated at the outbox layer) up to three separate replies. The
task brief was explicit that this must be solved with **temporal** turn
settling only - no semantic rules (`if message == "hola"`, length/punctuation
heuristics). This closure adds exactly that: a time-based debounce, plus the
two failure modes a naive debounce introduces (a race during the model call
itself, and a crash losing the pending turn) - both closed durably.

## 3. Architecture before / after

**Before (V1.8 and earlier, still the delay=0 path):**

```
Meta webhook -> processNativeWhatsAppInbound
  -> persist conversation_message (transaction)
  -> ensureAutonomousSalesTurnContinuity (awaited, synchronous)
       -> runNativeAutonomousCycle -> ... -> dispatch
  -> HTTP response
```

**After, when `BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS > 0`:**

```
Meta webhook -> processNativeWhatsAppInbound
  -> persist conversation_message (transaction, UNCHANGED)
  -> upsertPendingTurn (crm_inbound_turn_settlements) - extend or create
  -> HTTP response (fast ack, no cognition latency)

scripts/autonomous-turn-settle-worker.ts (separate long-lived process)
  -> runTurnSettleTick (poll due PENDING + stale PROCESSING)
       -> claim (CAS)
       -> assembleTurnFragments (read conversation_message range)
       -> typing indicator (if enabled, non-blocking)
       -> ensureAutonomousSalesTurnContinuity (SAME boundary as delay=0,
          + additionalInboundMessageIds + checkInboundFreshnessBeforeDispatch)
       -> COMPLETED or SUPERSEDED
```

The webhook, `processNativeWhatsAppInbound`'s transaction, dedupe, identity
resolution, and `ensureAutonomousSalesTurnContinuity`/`runNativeAutonomousCycle`
themselves are unchanged code paths - V1.8.1 adds a branch before cognition
and two new optional fields threaded through the existing chain, never a
parallel implementation of cognition or dispatch.

## 4. Timer semantics

`settle_after = LEAST(last_inbound_at + settleDelayMs, max_settle_at)`,
recomputed on every fragment that extends a `PENDING` row. `max_settle_at =
first_inbound_at + maxSettleMs`, fixed at row creation, never moves. A turn
becomes due (`selectDuePendingTurns`) the instant `settle_after <=
CURRENT_TIMESTAMP(3)`. Purely time-based comparisons, computed by the DB
server's own clock (`CURRENT_TIMESTAMP(3)`), never a per-message content
check - satisfies the task brief's "no semantic classification" requirement
by construction.

## 5. delay=0 compatibility (rollback path)

`lib/brain/native-whatsapp/service.ts`'s `processNativeWhatsAppInbound`
branches on `loadTurnSettlementConfig().settleDelayMs <= 0` immediately after
the existing persistence transaction/audit log call. The `<= 0` branch is the
literal, byte-for-byte original call to `ensureAutonomousSalesTurnContinuity`
- no new object allocation, no `crm_inbound_turn_settlements` write, no
`setTimeout`. `[T1]` (`tests/native/inboundTurnSettling.e2e.test.ts`) proves
this directly: a real inbound message at the default config never creates a
turn-settlement row.

## 6. max-window semantics

`maxSettleMs` is clamped up to `settleDelayMs` at the config-loading layer
(`loadTurnSettlementConfig`, so a misconfigured `MAX_MS < DELAY_MS` cannot
silently produce a max-window-only turn) but the repository's own `LEAST()`
clamp is exercised directly (raw values, not routed through the config
clamp) by `[T5]` (`tests/commercial/turnSettlementRepository.test.ts`):
`settle_after` is proven to equal `max_settle_at` exactly once continued
fragments would otherwise push it later.

## 7. Durability design

New table `crm_inbound_turn_settlements` (`migrations/035_crm_inbound_turn_settlements.sql`):
`conversation_id, wa_id, phone_number_id, first_inbound_message_id,
latest_inbound_message_id, latest_inbound_provider_message_id,
fragment_count, first_inbound_at, last_inbound_at, settle_after,
max_settle_at, status, superseded_by_message_id, last_correlation_id`. No
`intent`/`topic`/`conversationStage`/`nextStep` column exists - the task
brief's own prohibition, enforced by the schema, not just by convention. A
worker crash mid-flight is recoverable (Section 16); a webhook process crash
before the row is written simply drops that one fragment's ability to
extend/open a pending turn - the fragment itself is already durably
persisted in `conversation_message` regardless, and the next real fragment
(or the customer's own retry) opens/extends the turn normally.

## 8. Pending-turn ownership / idempotency

At most one `PENDING` row per conversation, enforced at the DB level (not
application logic) via a generated column (`pending_scope_key`, `NULL` for
every non-`PENDING` row) under a `UNIQUE KEY` - the same technique migration
026 (`sales_agent_configurations.published_scope_key`) already established
in this codebase. A concurrent webhook race (`[T6]`) resolves to exactly one
row with both fragments reflected, via a bounded extend-then-insert-then-retry
loop (`upsertPendingTurn`, `lib/brain/commercial/turn-settlement/repository.ts`)
mirroring `persistAgentAction.ts`'s existing `ER_DUP_ENTRY` recovery pattern.
A fragment arriving while the prior turn is already `PROCESSING` correctly
opens its own new `PENDING` row (`pending_scope_key` is `NULL` for the
`PROCESSING` row, so no collision) - proven directly in the
`[claim/complete]` repository test.

## 9. Fragment assembly

`assembleTurnFragments` (`lib/brain/commercial/turn-settlement/assembleTurnFragments.ts`)
reads `conversation_message` in the turn's `[first_inbound_message_id,
latest_inbound_message_id]` range (`direction='inbound'`), ordered by `id`
(never `provider_timestamp`, which is client-reported and can arrive out of
order), joins non-empty bodies with `\n`, and returns
`{inboundMessageIds, latestInboundProviderMessageId, content}`. Canonical
`conversation_message` rows are never rewritten or merged - `[T3]` proves
the three original rows survive, individually, byte-identical, after
settling.

## 10. Persistent-memory interaction

`deriveConversationMessages` (`lib/brain/commercial/agent-session/deriveMessages.ts`)
gained one new, purely additive input:
`additionalExcludedMessageIds?: readonly string[] | null`, alongside the
pre-existing single-id `currentInboundMessageId`. The turn-settlement worker
passes every fragment id except the anchor (latest) one through this new
field (`resolvePersistentSessionCognitionContext` ->
`salesAgentRuntime.ts` -> `runSalesAgentRuntimeCycle.ts`, each threading it
one layer further); the legacy fallback context builder
(`buildMinimalCommercialContextSummary`) got the same exclusion for symmetry,
in case persistent-session cognition ever falls back mid-turn. `undefined`/`null`/
empty is a no-op - zero behavior change for every delay=0 caller (proven in
`tests/commercial/deriveMessagesTurnSettling.test.ts`, `[V1.8.1-2]`).
`[T8]` proves the end-to-end guarantee against real MariaDB: a settled
3-fragment turn's own fragments contribute **zero** to `historyMessageCount`,
while two real prior turns still contribute exactly 2 - the aggregate
customer message appears exactly once (folded into `customerMessage`), never
duplicated as standalone history.

## 11. Settle-before-dispatch

`dispatchGovernedSalesAgentMessage.ts` gained one new, opt-in boolean
(`checkInboundFreshness`) and one new function
(`recheckInboundFreshness`), run in the **same transaction, same connection**
as the pre-existing `recheckConversationOwnership` (`SELECT ... FOR UPDATE`)
and the outbox insert - the last possible moment before a response becomes
durable. It checks `conversation_message` directly (`id > anchorMessageId`,
`direction='inbound'`), never the turn-settlement table itself, so it also
catches a fragment that arrived and immediately opened its OWN new pending
turn while this one was still reasoning. Threaded through
`dispatchSalesAgentResponse`/`dispatchSalesAgentFallback` ->
`dispatchSalesAgentTerminalOutcome` -> `RunSalesAgentRuntimeCycleInput` ->
`NativeAutonomousCycleInput` -> `EnsureAutonomousSalesTurnContinuityInput`,
every hop optional and `undefined` for delay=0. `[T9]` proves the real race
against MariaDB: a fake provider inserts the "newer" fragment *during* its
own `invoke()` call, and the turn still lands `SUPERSEDED` with **zero**
`brain_message_outbox` rows written.

## 12. Mutation / supersession semantics

Section L's three-way classification, all satisfied by construction (no new
code was needed for the third case, only documentation of why):

1. **Read-only cognition superseded** - the model's reasoning is simply
   discarded; nothing durable existed to undo.
2. **Response-only outcome superseded** - `checkInboundFreshness` suppresses
   exactly the outbound text write; proven by `[T9]`.
3. **Mutation already completed before supersession** - out of scope by
   design: this task never touches the Capability Gateway or tool execution.
   A `select_products`/`create_quote` call that already ran during a
   superseded turn's cognition stands as durable truth; V1.8.1 does not
   attempt a compensating transaction, and does not replay it. The next
   settled turn (opened by the newer fragment) reads fresh state - including
   that mutation's effects - through the same `buildNativeCommercialContext`/
   persistent-session pipeline every turn already uses, so the model reasons
   over what actually happened, never over a fabricated do-over.

## 13. Typing indicator

`postMetaWhatsAppTypingIndicator` (`lib/brain/messaging/metaClient.ts`) sends
Meta's real `{"status":"read","typing_indicator":{"type":"text"}}` body to
the existing `/messages` endpoint - one call does both mark-as-read and
typing (Section P), no new endpoint. Called by `runTurnSettleTick` only
after a turn settles (never on the first raw fragment - Section M's own
reasoning: showing "typing..." immediately could discourage a customer from
finishing a fragmented thought), targeting
`latest_inbound_provider_message_id` (the Meta wamid), never
`conversation_message.id`. `[T12]` proves the call order (typing before the
model call) and the correct target id against real MariaDB with a
order-tracking fake provider.

## 14. Read receipt

Bundled into the same typing call (Section P) - Meta's own API shape does
not separate them. No independent read-receipt-only call exists; a typing
failure and a read-receipt failure are therefore the same failure, both
non-blocking (Section 16).

## 15. Meta integration

No Baileys. `postMetaWhatsAppTypingIndicator` reuses the exact same
`buildMetaGraphUrl`/access-token/timeout/abort-controller machinery as the
pre-existing `postMetaWhatsAppTextMessage`, gated on the same
`isMetaSendEnabled()` (`BRAIN_META_SEND_ENABLED`) plus the caller-side
`BRAIN_WHATSAPP_TYPING_INDICATOR_ENABLED`. No heartbeat/renewal loop was
added (Section O) - a single call per settled turn, per the task brief's
explicit "do not cargo-cult Baileys' presence-refresh behavior" instruction;
real Cloud API expiry behavior was not observed in this slice (no live smoke,
Section Y) and remains a candidate follow-up only if real pilot evidence
shows it is needed.

## 16. Crash / restart recovery

A `PROCESSING` row whose worker died is recoverable once
`updated_at` is older than `TURN_SETTLE_STALE_PROCESSING_LOCK_SECONDS` (120s
- long enough for real DeepSeek + tool-loop latency, short enough to recover
quickly), via the same CAS-reclaim shape `runFollowupTick.ts`'s
`claimStaleExecutingFollowUp` already established
(`reclaimStaleProcessingTurn`, re-verifies staleness at claim time, not just
at selection time). `[T7]` proves the full cycle end-to-end: a row is
claimed and then abandoned (simulating a kill between claim and cognition),
backdated past the stale window, and a second, independent `runTurnSettleTick`
call reclaims and completes it with **exactly one** real model invocation and
**exactly one** dispatched message - no lost customer message, no duplicate
response.

## 17. Access / routing safety

The turn-settlement layer adds zero new gating logic of its own - it re-enters
through the exact same `ensureAutonomousSalesTurnContinuity` ->
`runNativeAutonomousCycle` boundary the webhook already uses at delay=0, so
`BRAIN_WHATSAPP_TEST_MODE_ENABLED`/`BRAIN_WHATSAPP_TEST_WA_IDS`,
`BRAIN_AUTONOMOUS_TEST_WA_IDS`, and `BRAIN_SALES_AGENT_RUNTIME_WA_IDS` are
checked exactly as before, in the same order, for every settled turn.
`[T15]` proves it directly: a wa_id outside the R3 allowlist reaches the
settle-worker path and the model is provably never invoked (a fake provider
that throws on `invoke()`), yet the turn still lands `COMPLETED` (ran,
correctly did nothing) rather than stuck.

## 18. Observability

Structured, PII-free console logging only in this slice (no new
`commercial_event`/`agent_session_events` event types were added - reusing
`ensureAutonomousSalesTurnContinuity`'s own existing disposition/audit
writes for the settled turn's cognition itself): `[turn-settle]
typing_indicator_skipped|typing_indicator_failed|typing_indicator_threw`,
`[turn-settle] tick_error|stale_reclaim_error`, and the worker's own
per-tick summary (`processed/settled/superseded/reclaimed/failed`). No
message bodies, prompt text, or secrets are ever logged. Full structured
event taxonomy (`turn_pending`/`turn_extended`/`turn_settled`/... as
`commercial_event` rows) is deliberately deferred - see Section 26.

## 19. Performance

Real-provider measurements (`scripts/live-turn-settle-benchmark.ts`, Section
20 below) show `settle_to_dispatch_ms` (worker tick start to outbox write) in
the 1.3s-4.6s range, dominated by real DeepSeek + tool-loop latency, not by
the settling mechanism itself (the settle wait before the tick fires is a
fixed, configured 800ms-1.2s in that benchmark, separate from and additive
to model latency, exactly the task brief's Section Z formula: `configured
quiet delay + real processing latency`). No artificial sleeps were added
anywhere in this slice.

## 20. Real-provider benchmark

`npx tsx scripts/live-turn-settle-benchmark.ts` - real DeepSeek
(`BRAIN_MODEL_*`), real MariaDB (`crm_test`), real webhook entry point per
fragment, real `runTurnSettleTick` (no injected provider), `BRAIN_META_SEND_ENABLED=false`
(no real Meta send, per Section X). All four scenarios settled and dispatched
correctly:

| Scenario | Fragments | Result | Total ms |
|---|---|---|---|
| A - single message | 1 | `COMPLETED`, dispatched | 4676 |
| B - three rapid fragments ("hola"/"como"/"estas") | 3 | `COMPLETED`, dispatched: *"¡Hola! ¿Cómo estás? ¿En qué puedo ayudarte hoy?"* | 4329 |
| C - product request split | 4 | `COMPLETED`, dispatched (catalog tool unreachable in this environment - model degraded gracefully to a fallback offer, a pre-existing external-dependency limitation, not a V1.8.1 regression) | 7280 |
| D - correction split ("cotizame la de 20kg"/"espera"/"mejor la de 15kg") | 3 | `COMPLETED`, dispatched: *"Entiendo que quieres la opción de 15kg..."* | 7133 |

Scenario B is the structural proof the whole release exists for: three
separate webhook deliveries produced **one** natural, combined response, not
three. Scenario E (new inbound injected mid-cognition) was deliberately not
reproduced live - real DeepSeek latency is too variable to guarantee the
injection lands mid-call; it is proven deterministically instead by `[T9]`
(Section 11).

## 21. Typing validation

Request construction and failure isolation are proven against real MariaDB
with a fake Meta typing client (`[T12]`/`[T13]`/`[T14]`,
`tests/native/inboundTurnSettling.e2e.test.ts`): correct endpoint target
(latest fragment's wamid), correct call ordering (after settle, before the
model responds), zero calls when disabled, and zero impact on cognition/
dispatch when the call fails. Live Meta Cloud API UI smoke (does "typing..."
actually render in a real WhatsApp client) is classified **deferred** per
Section Y - this environment has no path to a real Meta-connected phone
number for that specific visual check.

## 22. Tests

- `tests/commercial/turnSettlementRepository.test.ts` - 9/9 pass. Repository/DB
  mechanics: single fragment (`[T2]`), extend-refreshes (`[T4]`), max-window
  clamp (`[T5]`), concurrent-race uniqueness (`[T6]`), cross-conversation
  isolation, claim/complete CAS, supersede, stale-processing reclaim
  (`[T7]`), due-detection.
- `tests/commercial/deriveMessagesTurnSettling.test.ts` - 4/4 pass. Pure
  `additionalExcludedMessageIds` unit coverage, including the delay=0 no-op
  guarantee.
- `tests/native/inboundTurnSettling.e2e.test.ts` - 9/9 pass, real MariaDB
  (`crm_test`), fake LLM provider (no real DeepSeek cost in this file):
  `[T1]` delay=0 rollback path, `[T3]` fragment aggregation + joined content
  + canonical transcript untouched, `[T7]` full worker-level crash recovery,
  `[T8]` history exclusion end-to-end, `[T9]` mid-cognition supersession,
  `[T12]`/`[T13]`/`[T14]` typing enabled/disabled/failure-isolated, `[T15]`
  access gate preserved.
- `scripts/live-turn-settle-benchmark.ts` - real DeepSeek + real MariaDB,
  4/4 scenarios `COMPLETED` + dispatched (Section 20).

22 new automated tests, all passing, zero modifications to any pre-existing
test file.

**Full-repo regression** (`npm test`, 12 batches, real MariaDB `crm_test`):
4212 tests total (4190 pre-existing + 22 new), 4191 pass, 21 fail. Every one
of the 21 failures lands in exactly 12 pre-existing files
(`a13ConversationalReliabilityBenchmark`, `commercialWorkIdentityOnboarding`,
`commercialWorkParallelExecution`, `createCustomerCapability`,
`customerOnboardingPostPlanPrivacy`, `customerOnboardingPostPlanStage`,
`customerSession`, `customerSessionPrivacy`, `linkExternalIdentityCapability`,
`processInboundCommercialShadow`, `runCommercialOperationalLoop`,
`tests/e2e/customerIdentityOnboarding.e2e.test.ts`) - none of them import,
call, or reference anything this task touched. Classified `PREEXISTING`, not
`NEW_V1_8_1_REGRESSION`, verified directly (not assumed): `git stash push -u`
followed by running the exact same 12 files against clean `develop` produced
the **identical** count (205 tests, 184 pass, 21 fail) before restoring the
stash. `npx tsc --noEmit`, `npm run build` (all pages), and `npm run lint`
(0 errors, 40 warnings, identical to the V1.8-FINAL baseline) are clean.

## 23. Files changed

New:
- `migrations/035_crm_inbound_turn_settlements.sql`
- `lib/brain/commercial/turn-settlement/{types,config,repository,assembleTurnFragments,runTurnSettleTick,index}.ts`
- `scripts/autonomous-turn-settle-worker.ts`
- `scripts/live-turn-settle-benchmark.ts`
- `tests/commercial/turnSettlementRepository.test.ts`
- `tests/commercial/deriveMessagesTurnSettling.test.ts`
- `tests/native/inboundTurnSettling.e2e.test.ts`
- `docs/releases/SALES-AGENT-R3-V1.8.1-CONVERSATIONAL-TURN-SETTLING.md` (this file)

Modified (all additive/optional-field changes, zero removed behavior):
- `lib/brain/native-whatsapp/service.ts` - the delay=0/>0 branch (Section 5).
- `lib/brain/messaging/metaClient.ts` - `postMetaWhatsAppTypingIndicator`.
- `lib/brain/commercial/agent-session/deriveMessages.ts` - `additionalExcludedMessageIds`.
- `lib/brain/commercial/agent-session/resolvePersistentSessionCognitionContext.ts` - same field, threaded.
- `lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts` - same field, threaded.
- `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts` - same field + `checkInboundFreshnessBeforeDispatch`, `buildMinimalCommercialContextSummary` widened.
- `lib/brain/commercial/sales-agent-runtime/dispatchGovernedSalesAgentMessage.ts` - `checkInboundFreshness` + `recheckInboundFreshness`.
- `lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentResponse.ts` - field threaded.
- `lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentFallback.ts` - field threaded.
- `lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentTerminalOutcome.ts` - field threaded (excluding hard-handoff, Section 12/L).
- `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts` - both fields added to `NativeAutonomousCycleInput`, threaded into the `salesAgentRuntimeEnabled` branch only.
- `lib/brain/commercial/continuity/ensureAutonomousSalesTurnContinuity.ts` - both fields threaded, plus the incidental `agentLoopProvider` forwarding fix (Section 26).
- `lib/brain/commercial/events/types.ts` - `superseded_by_newer_inbound` reason literal added.
- `.env.example` - `BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS`/`_MAX_MS`, `BRAIN_WHATSAPP_TYPING_INDICATOR_ENABLED`.
- `package.json` - `worker:turn-settle` script.
- `docs/ACTIVE_RELEASE.md` - this release's entry.

## 24. Migration status

`migrations/035_crm_inbound_turn_settlements.sql` applied cleanly to both
`main_management` (dev) and `crm_test`. New table only - no `ALTER TABLE` on
any existing table, no backfill needed (the mechanism is purely forward-
looking: it governs new inbound turns from the moment the flag is enabled,
never reinterprets historical `conversation_message` rows as turns).

## 25. Rollback

`BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS=0` (already the default) is the full
rollback - no migration revert needed (an unused table is harmless), no
deploy needed beyond an env var change. `BRAIN_WHATSAPP_TYPING_INDICATOR_ENABLED`
rolls back independently, at any time, without touching the settle delay
(Section AA's own explicit requirement - proven by `[T13]`).

## 26. Remaining debt

1. No bounded retry/attempt cap on `crm_inbound_turn_settlements` itself (a
   permanently-failing turn stays reclaimable forever) - deliberately not
   built, see Section 1.
2. `dispatchSalesAgentHardHandoff` does not participate in the freshness
   recheck (Section 12/L, a scope decision).
3. Live Meta Cloud API typing/read UI smoke deferred (Section 21).
4. No structured `commercial_event`/`agent_session_events` event taxonomy for
   `turn_pending`/`turn_extended`/`turn_settled`/etc. (Section 18) - console
   logging only in this slice. Worth adding before a real pilot needs the
   Section V metrics (fragment-count distribution, p50/p95 settle time,
   percentage superseded), but not required for structural correctness.
5. `ensureAutonomousSalesTurnContinuity.ts` previously declared
   `agentLoopProvider` (inherited from `NativeAutonomousCycleInput`) without
   ever forwarding it to `runNativeAutonomousCycle` - closed incidentally by
   this task (a one-line, purely additive fix) because it was required to
   test this feature's own dispatch/freshness chain against a fake LLM
   without bypassing `ensureAutonomousSalesTurnContinuity` itself. Noted here
   because it was a real, if minor, pre-existing gap, not because it changes
   any existing behavior.

## Exit gates (Section AE)

| Gate | Evidence |
|---|---|
| G1 delay=0 preserves current behavior | `[T1]`, Section 5 |
| G2 rapid fragments produce one cognitive turn | `[T3]`, Section 20 Scenario B |
| G3 canonical transcript remains unmodified | `[T3]`, Section 9 |
| G4 current fragments appear exactly once in provider context | `[T8]`, Section 10 |
| G5 one active pending turn per conversation | `[T6]`, Section 8 |
| G6 max window prevents indefinite waiting | `[T5]`, Section 6 |
| G7 pending turn survives restart | `[T7]`, Section 16 |
| G8 new inbound during processing suppresses stale response | `[T9]`, Section 11 |
| G9 supersession does not duplicate mutations | Section 12 (by construction/scope, no code path replays a mutation) |
| G10 typing is non-blocking | `[T14]`, Section 13 |
| G11 typing starts only after settle | `[T12]`, Section 13 |
| G12 access gates unchanged | `[T15]`, Section 17 |
| G13 persistent memory unchanged | `[T8]` + `tests/commercial/deriveMessagesTurnSettling.test.ts`, Section 10 |
| G14 Capability Gateway unchanged | zero files under `capability-gateway/` touched (Section 23 file list) |
| G15 dispatch/outbox dedupe unchanged | `dispatchGovernedSalesAgentMessage`'s pre-existing dedupe key/`writeCanonicalOutboxMessage` untouched; `checkInboundFreshness` is a new, opt-in pre-check, never a change to the dedupe mechanism itself |
| G16 real DeepSeek fragment scenario succeeds | Section 20 Scenario B |
| G17 rollback requires config only | Section 25 |

All 17 hold with direct evidence.

## 27. V1.9 readiness

**`READY_FOR_R3_V1_9_SELF_RECOVERY`**

Turn settling and V1.9 (Self-Recovery / Tool-Failure Resilience, per the
V1.8-FINAL closure) are orthogonal: V1.9 concerns a single turn's tool-call
retry/reasoning behavior once cognition has started, while V1.8.1 concerns
which fragments become "the turn" and whether its output is still current by
dispatch time. Nothing in this task narrows V1.9's scope or blocks it -
Scenario C's own catalog-tool failure (Section 20) is, if anything, live
evidence the V1.9 gap is still real and worth closing next.
