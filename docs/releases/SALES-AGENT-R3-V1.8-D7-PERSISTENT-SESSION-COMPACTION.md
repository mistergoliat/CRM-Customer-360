# SALES-AGENT-R3-V1.8-D7 -- Persistent Session Compaction

Status: implemented. Real production code changed, scoped to durable session
compaction on top of D1-D6's already-shipped persistent-session foundation.
Real DeepSeek + real MariaDB (`main_management`) live validation included,
driven through the actual production entry point.

## 1. Executive verdict

**`R3_V1_8_D7_PERSISTENT_SESSION_COMPACTION_VALIDATED`**

Durable session compaction is implemented, tested (unit + real-MariaDB
integration + real-DeepSeek live benchmark), and wired behind its own
fail-closed flag (`BRAIN_R3_SESSION_COMPACTION_ENABLED`, default `false`).
Older conversation history is folded into a compacted evidentiary summary
while `conversation_message` remains the complete, untouched canonical
transcript; recent history stays provider-native raw turns. All 15 exit
gates (Section AB of the task brief) hold with direct evidence.

## 2. Domain finding: `compactedThroughSeq`'s real unit

D1 (migration 034) speculatively documented `agent_sessions.compacted_through_seq`
as an `agent_session_events.seq` boundary - written before D3 confirmed
`conversation_message` as the sole canonical transcript (`agent_session_events`
supplies tool-activity evidence only). D7 populates this column with a
**`conversation_message.id`** cutoff instead - the actual unit compaction
operates on.

This is a domain clarification, not a schema change (Section C's own "STOP
and justify" instruction, honored): the column has never been populated in
production, and its only other reader (`deriveToolActivityObservations` in
`deriveMessages.ts`) produces output with zero real prompt consumer today
(confirmed against `buildAgentStepPromptPackage.ts` - `toolActivityObservations`
is not read there). No migration, no type rename, zero behavior change for
that inert consumer. Documented in `compactedSessionPrefixContent.ts`'s own
header and cross-referenced from `types.ts`.

## 3. Compacted content contract

New shared module, `compactedSessionPrefixContent.ts`:

```ts
type CompactedSessionPrefixContent = { schemaVersion: 1; summaryText: string };
```

Stored in `agent_sessions.compacted_prefix_json` (already a free-form JSON
column, D1). `compacted_through_seq` (the `conversation_message.id` cutoff)
lives in its own existing column, not duplicated inside the JSON. Both the
reader (`deriveConversationMessages`) and the writer
(`runSessionCompaction.ts`) import the same `parseCompactedSessionPrefixContent`/
`resolveValidCompactionCutoff` helpers - one shape, two consumers, never a
second guess.

`summaryText` is passed through the existing `sanitizeAgentSessionPayload`
before persistence (reused, not reinvented - Section G/V discipline).

## 4. Trigger

`shouldTriggerSessionCompaction(uncompactedMessageCount, maxRawMessages)` -
one condition (`count > maxRawMessages`), no second heuristic. Config:

| Flag | Default |
|---|---|
| `BRAIN_R3_SESSION_COMPACTION_ENABLED` | `false` |
| `BRAIN_R3_SESSION_COMPACTION_MAX_RAW_MESSAGES` | `40`, clamped to `SESSION_COMPACTION_MAX_RAW_MESSAGES_CEILING` (`80`) |
| `BRAIN_R3_SESSION_COMPACTION_TARGET_RECENT_MESSAGES` | `20` |

The ceiling (`80`, well under `AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES` =
`100`, D3's existing hard cap) is what makes the no-gap invariant (Section 8
below) hold deterministically without touching
`conversationTranscriptReader.ts`'s SQL at all.

Checked post-dispatch, on every turn where the flag is on - cheap no-ops
dominate (one bounded, already-lock-guarded read via
`loadPersistentSessionContext`, same mechanism the persistent-cognition path
already pays for every turn). Additionally gated on
`persistentSessionCognitionEnabled` being true this turn (own decision, not
required by the brief): during a D6 rollback, compaction also pauses instead
of burning model calls compacting a session nothing currently reads.

## 5. Compaction window / split

`splitForCompaction(messages, targetRecentMessages)` - pure, keeps the last
`targetRecentMessages` raw, everything older is `toCompact`. Matches the task
brief's own Section E worked example exactly: a second compaction round's
`toCompact` set includes the *previous* round's own recent-tail messages
(never discarded, never re-read from scratch) plus whatever is newly
arrived - proven in `[D7-O4]` (incremental compaction test) against real
MariaDB.

## 6. Content policy

`compactAgentSessionHistory.ts`'s system instruction states the policy
directly, verbatim from the task brief's own Section B/G: summarize WHAT
HAPPENED (goals, preferences, constraints, categories, corrections,
contradictions, topic switches, commitments, unresolved questions), never
WHAT TO DO NEXT (no intent/step/stage/plan), never chain-of-thought or raw
tool dumps, never assert exact prices/stock/shipping/quote status as current
truth. Real DeepSeek output (Section 12 below) followed this almost to the
letter unprompted beyond the instruction itself, including explicitly noting
"No se mencionaron precios, stock ni detalles de envío como hechos
actuales."

## 7. Model / provider strategy

`compactAgentSessionHistory(input)` - the one dedicated boundary (task brief
Section H). No DB access, no tools, no side effects. Builds a message array
of `[system instruction, optional previous-summary system message, ...real
user/assistant turns being compacted, final instruction]` and calls
`AgentLoopProvider.invoke()` - the same interface/contract the main turn
already uses, reused rather than reinvented.

Dedicated provider construction (`buildDefaultCompactionProvider` in
`runSessionCompaction.ts`): `createHttpAgentLoopProvider({temperature: 0,
maxOutputTokens: 800, thinking: "disabled"})` - deterministic, bounded, and
`thinking: "disabled"` for the same documented reason the R3 pilot hotfix
already set it on the main turn (DeepSeek can otherwise consume the entire
output budget as `reasoning_content`, leaving `content` empty). A caller may
inject a different `provider` (test/DI seam); production never does.

Never throws: provider errors, timeouts, and structurally invalid/empty
output (missing or blank `summaryText`) all return a typed
`{ok: false, reason}` - the orchestrator fails open to the existing bounded
raw history for that turn.

## 8. Persistence + no-overlap/no-gap proof

`AgentSessionStore.persistCompactedPrefix(input)` (new store method,
`mariaDbAgentSessionStore.ts` + `inMemoryAgentSessionStore.ts`) - one atomic
`UPDATE` writing `compacted_prefix_json`/`compacted_through_seq`/
`compacted_prefix_updated_at` together, guarded by a monotonic-advance WHERE
clause (`compacted_through_seq IS NULL OR compacted_through_seq < ?`). No
separate read-then-compare round trip, no advisory lock, no lock held across
the model call (Section K) - the guard is the entire concurrency control.

**No-overlap**: `deriveConversationMessages` (`deriveMessages.ts`) excludes
every transcript row with `id <= throughSeq` once a valid compacted prefix
exists - proven in `[D7-M1]` and, against real MariaDB end to end, `[D7-O3]`.

**No-gap**: `loadPersistentSessionContext.ts` widens its own transcript read
window to `AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES` (100) whenever a valid
compacted prefix exists (byte-identical to D3-D6 otherwise - zero behavior
change until a real compaction has run at least once for that session). Since
the trigger ceiling (80) stays comfortably under that hard cap, every message
after the cutoff is guaranteed to be read - proven end to end in `[D7-O3]`
(`derivedMessages` reconstructed exactly the 20 raw messages after the
cutoff, in order, byte-identical to what was inserted).

## 9. Concurrency

`[D7-S4]` (real MariaDB, two concurrent `persistCompactedPrefix` calls racing
on the same session): the higher `throughSeq` always wins regardless of which
write physically lands last. `[D7-O7]` proves the realistic race from
Section K directly: a provider whose `invoke()` performs a competing
`persistCompactedPrefix` write *while this run's own model call is in
flight* - the only point a genuine race can occur, since no lock is ever held
across that call - and the losing (stale) result is discarded safely,
`persisted: false, warning: "superseded_by_newer_compaction"`, never an
error, never a partial write.

## 10. Failure isolation (G8)

`runSessionCompactionIfEligible` wraps its entire body in one `try/catch` and
never throws; `runSalesAgentRuntimeCycle.ts`'s post-dispatch call site wraps
it in a second, redundant `try/catch` (matching every other post-dispatch
write in that file). A compaction failure only appends a
`session_compaction_failed:<reason>` warning to `runtime.warnings` - proven
live with a real turn (`[D7-CC3]`, unconfigured provider forced via env, real
MariaDB): the turn still dispatches (`status: "responded"`,
`outboxWritten: true`), only the warning differs.

`[D7-O5]` (generation failure) and `[D7-O6]` (malformed existing prefix)
prove the existing valid state, if any, is never touched - no partial write,
never a crash.

## 11. `deriveMessages` integration

Unchanged shape from D3/D5.2: `[system stable+identity, optional compacted-
prefix system message, ...real historical user/assistant turns, final
merged user message]`. The compacted-prefix message is rendered as
`role: "system", content: "[Compacted session history through message #N]
<summaryText>"` - never fabricated as a user/assistant turn, never
duplicated with raw history it already covers.

## 12. Real-provider live benchmark

Real DeepSeek (`BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY`/`BRAIN_MODEL_NAME`
from this environment's own `.env`) + real MariaDB (`main_management`),
driven through the **actual production entry point**
(`processNativeWhatsAppInbound -> ensureAutonomousSalesTurnContinuity ->
runNativeAutonomousCycle -> runSalesAgentRuntimeCycle`, no provider bypass,
no direct call to any inner function). Same environment conditions as
D5/D5.1/D5.2/D6: `LOGISTICS_DB_ENABLED=false`,
`CATALOG_SERVICE_BASE_URL=http://127.0.0.1:4010` unreachable. One throwaway
scratchpad script (`d7-benchmark.ts`), repo root, never committed, deleted
after use - same precedent as every prior D-task.

10-turn scenario (topic return + category-breadth + shipping mention):
"barra olimpica 20kg" -> 8 unrelated product/category questions -> "volvamos
a la barra olimpica del principio, la de 20kg."

- **Compaction triggered 4 times** across the conversation
  (`SESSION_COMPACTED` events with real `fromSeq`/`toSeq`/`rawMessageCount`/
  `rawEstimatedSize`/`compactionDurationMs`), `compacted_through_seq`
  advancing monotonically (`22126 -> 22129 -> 22132 -> 22135`, real
  `conversation_message.id` values).
- **Topic return survived compaction**: the final compacted `summaryText`
  explicitly reads "...Luego volvió a preguntar por la disponibilidad de la
  barra olimpica de 20kg." The turn-10 dispatched response itself says "no
  pude verificar la disponibilidad de la barra olímpica de 20kg" - the exact
  product/spec from turn 1, correctly carried across 3 compaction rounds and
  8 intervening turns.
- **Fresh-truth separation held even under real model output**: the summary
  explicitly stated "No se mencionaron precios, stock ni detalles de envío
  como hechos actuales" - the model itself declined to assert business
  facts as current truth, unprompted beyond the system instruction.
- **No fallback/handoff regression**: all 10 turns dispatched a coherent,
  business-appropriate `responded` message (each one gracefully explaining
  the - expected, environment-induced - Catalog Service outage and asking to
  retry), never a raw error, never a handoff.
- Governance/dispatch unaffected: identity resolution, `conversation_message`
  persistence, and outbox dispatch all behaved exactly as D5/D6 already
  characterized for this same unreachable-Catalog-Service condition.

Reproducing this benchmark requires setting `BRAIN_WHATSAPP_TEST_WA_IDS` and
`BRAIN_AUTONOMOUS_TEST_WA_IDS` (two access-control allowlists distinct from
`BRAIN_SALES_AGENT_RUNTIME_WA_IDS`) to the same test `wa_id` - a real finding
of this task, not previously documented at the D7 layer: three independent
allowlists gate a turn before `SalesAgentRuntime`/compaction are ever
reached, easy to miss when driving the real production entry point directly
instead of through `runSalesAgentRuntimeCycle` alone (which D5/D6's own
benchmarks called more directly).

## 13. Session lifecycle

No change to D2's session lifecycle. Compaction never creates a new
`agent_sessions` row and never requires the conversation to be open - a
closed/reopened conversation's existing compacted prefix remains valid and
usable exactly as before, since `loadPersistentSessionContext` reads it the
same way regardless of conversation status.

## 14. Observability

`SESSION_COMPACTED` (already reserved by D1's `AGENT_SESSION_EVENT_TYPES`) is
now really emitted. `AgentSessionCompactedPayload` (`types.ts`) extended
(additive) with `rawMessageCount`/`rawEstimatedSize`/`compactionDurationMs`
alongside D1's original `fromSeq`/`toSeq`/`summaryEstimatedSize` - exactly
the metrics task brief Section V names. Never logs summary text, raw
messages, or PII - `sanitizeAgentSessionPayload` still gates every event
payload.

## 15. Rollback

`BRAIN_R3_SESSION_COMPACTION_ENABLED=false` (default) immediately stops all
compaction - no DB rollback, no migration, no session deletion. An existing
compacted prefix (from before the flag was flipped off) remains valid and is
still read/used by `deriveMessages` regardless of the flag's current value -
the flag only gates the *writer*, never the reader (matching D6's own
rollback contract shape for a comparable reason).

## 16. Tests

| Group | File | Result |
|---|---|---|
| Trigger/split/content-contract (pure) | `tests/commercial/sessionCompactionPolicy.test.ts` (new) | 8/8 pass |
| Model-calling boundary (fake provider) | `tests/commercial/compactAgentSessionHistory.test.ts` (new) | 7/7 pass |
| `deriveMessages` D7 filtering/degrade | `tests/commercial/deriveMessages.test.ts` (+3 new, 1 rewritten fixture) | 22/22 pass |
| Orchestrator, real MariaDB + fake provider | `tests/commercial/runSessionCompaction.test.ts` (new) | 7/7 pass: first compaction, incremental, generation-failure isolation, malformed-prior-prefix degrade, concurrent-supersession |
| `persistCompactedPrefix` atomicity/concurrency, real MariaDB | `tests/commercial/agentSessionStoreMariaDb.test.ts` (+5 new) | 13/14 pass (1 pre-existing, unrelated flake - see below) |
| Post-dispatch wiring, real MariaDB | `tests/commercial/runSalesAgentRuntimeCycle.test.ts` (+2 new) | 17/17 pass |
| D3-D6 regression (unchanged-contract re-run) | `deriveMessages`, `loadPersistentSessionContext`, `resolvePersistentSessionCognitionContext`, `runPersistentSessionShadow`, `salesAgentRuntimeSessionWriteWiring`, `shouldEnablePersistentSessionCognition`, `salesAgentR3PersistentSessionDefaultRouting`, `salesAgentRuntime`, `buildAgentStepPromptPackage` | 118/118 pass |
| Governance/dispatch/Capability Gateway regression | `capabilityGateway*`, `commercialActionRequest`, `readToolRequest`, `dispatchSalesAgent*`, `agentSessionSanitizer`, `agentSessionSummary`, `runAgentToolLoop`, `httpAgentLoopProvider` | 290/290 pass |
| `npx tsc --noEmit` | clean | |
| `npm run build` | clean, full Next.js production build | |
| `npm run lint` | 0 errors, 40 pre-existing warnings (identical count/files to D5.2/D6) | |
| Full repo suite | `npm test` | same pre-existing failure categories as D6 documented (A13 benchmark, `agentSessionStoreMariaDb` same-millisecond flake, `commercialWorkParallelExecution` wall-clock timing, `continuityConcurrency`, `DATABASE_NAME` cross-file env-isolation, `customerIdentityOnboarding.e2e`, one `salesAgentConfiguration` test-order-dependent row) - spot-checked via `git stash` against the pre-D7 baseline: identical failures reproduce with zero D7 code present |

The one recurring MariaDB same-millisecond ordering flake
(`agentSessionStoreMariaDb.test.ts`) is the exact, already-documented
pre-existing flake V1.7 through D6 all independently confirmed - untouched by
this task (`seq` is read, never reordered, by anything D7 changed).

## 17. Files changed

New:
- `lib/brain/commercial/agent-session/compactedSessionPrefixContent.ts`
- `lib/brain/commercial/agent-session/sessionCompactionPolicy.ts`
- `lib/brain/commercial/agent-session/compactAgentSessionHistory.ts`
- `lib/brain/commercial/agent-session/runSessionCompaction.ts`
- `tests/commercial/sessionCompactionPolicy.test.ts`
- `tests/commercial/compactAgentSessionHistory.test.ts`
- `tests/commercial/runSessionCompaction.test.ts`
- This file.

Modified (production):
- `lib/brain/commercial/agent-session/types.ts` - `AgentSessionCompactedPayload`
  extended (additive) with `rawMessageCount`/`rawEstimatedSize`/
  `compactionDurationMs`; `isValidAgentSessionCompactedPayload` validates them.
- `lib/brain/commercial/agent-session/deriveMessages.ts` - compacted-prefix
  message now renders `summaryText` (not a raw JSON dump); transcript rows
  at/before the cutoff excluded; `transcriptRowToProviderMessage` extracted
  and shared with the new writer.
- `lib/brain/commercial/agent-session/loadPersistentSessionContext.ts` -
  widens the transcript read window to the existing hard cap once a valid
  compacted prefix exists (no-gap invariant); byte-identical otherwise.
- `lib/brain/commercial/agent-session/store.ts` - `AgentSessionStore` gains
  `persistCompactedPrefix`.
- `lib/brain/commercial/agent-session/mariaDbAgentSessionStore.ts` /
  `inMemoryAgentSessionStore.ts` - `persistCompactedPrefix` implemented.
- `lib/brain/commercial/agent-session/index.ts` - barrel exports for the new
  modules/symbols.
- `lib/brain/commercial/config/commercialCycleConfig.ts` -
  `buildSessionCompactionFeatureFlags`.
- `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts` -
  post-dispatch compaction check (own try/catch, warning-only on failure);
  three new optional input fields.
- `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts` - flag
  wiring at the one `runSalesAgentRuntimeCycle` call site.

Modified (tests):
- `tests/commercial/agentSessionStore.test.ts` - `AgentSessionCompactedPayload`
  fixtures extended for the new required fields.
- `tests/commercial/agentSessionStoreMariaDb.test.ts` - 5 new
  `persistCompactedPrefix` tests (atomicity, advance, stale-guard,
  concurrency, unknown session).
- `tests/commercial/deriveMessages.test.ts` - `[D3-Q1]` fixture updated to
  the real D7 content shape; 2 new D7 tests (no-overlap filter, malformed-
  prefix degrade).
- `tests/commercial/loadPersistentSessionContext.test.ts`,
  `resolvePersistentSessionCognitionContext.test.ts`,
  `runPersistentSessionShadow.test.ts`,
  `salesAgentRuntimeSessionWriteWiring.test.ts` - mechanical fixture updates
  for the new required `persistCompactedPrefix` store method (no assertion
  changed).
- `tests/commercial/runSalesAgentRuntimeCycle.test.ts` - 2 new post-dispatch
  wiring tests.

Not modified: `conversationTranscriptReader.ts` (SQL unchanged - the no-gap
invariant is achieved entirely by widening the caller's own window size),
`AgentSessionEvent`/`deriveToolActivityObservations`'s exclusion logic
itself (only its domain-note comment updated), `buildAgentStepPromptPackage.ts`,
`resolvePersistentSessionCognitionContext.ts`, Capability Gateway, dispatch/
outbox, D4 shadow code, D5/D6 flags or defaults, migrations (none added).

## 18. Remaining debt

- **`deriveToolActivityObservations`'s own `throughSeq` comparison is now
  cross-domain-inert** (compares an `agent_session_events.seq` against a
  `conversation_message.id`) - harmless today only because its output has no
  real prompt consumer (confirmed against `buildAgentStepPromptPackage.ts`).
  Flagged explicitly in `compactedSessionPrefixContent.ts`'s own header for
  whoever wires `toolActivityObservations` into a real prompt next.
- **The pathological "compaction has failed for a very long time" case**
  (uncompacted count exceeds `AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES`,
  100) would silently show the oldest-after-cutoff window rather than the
  newest messages - an already-accepted, pre-existing hard-cap boundary
  (D3's own `AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES`), not new debt this
  task introduces, and requires the trigger ceiling (80) to be badly
  misconfigured or compaction to fail repeatedly for many turns in a row to
  ever manifest.
- **Compaction runs synchronously, post-dispatch, adding latency only to the
  occasional eligible turn** (never the customer-facing response itself,
  which is already dispatched by that point) - a true background/queued
  worker was considered and rejected as unnecessary infrastructure for this
  task's scope (no existing queue/worker infra this feature needs to join).
- **The R3 pilot itself remains closed to real traffic** -
  `BRAIN_SALES_AGENT_RUNTIME_WA_IDS` is still empty by default, unchanged by
  this task; D7 changes what happens *inside* a long R3 conversation once a
  wa_id is eventually allowlisted, not whether any real customer reaches R3
  today.
- The pre-existing, unrelated test debt catalogued in D6's own doc (A13
  benchmark, `CommercialWork` parallel timing, `DATABASE_NAME` cross-file
  env-isolation, same-millisecond MariaDB ordering, identity/onboarding
  external Customer Service dependency) is unchanged by this task.

## 19. V1.8 final readiness

**`READY_FOR_R3_V1_8_FINAL_PERSISTENT_MEMORY_CLOSURE`**. Persistent session
memory now handles short, medium, and long conversations: D1-D6 built and
defaulted-on the live read/write path; D7 adds the missing piece for
long-running conversations (durable compaction, proven with real
incremental-compaction, no-overlap/no-gap, concurrency, failure-isolation,
and real-DeepSeek topic-return/fresh-truth evidence). No further structural
gap is known in the persistent-session mechanism itself at V1.8's scope.

## Verdict

**`R3_V1_8_D7_PERSISTENT_SESSION_COMPACTION_VALIDATED`**

- G1-G15 (task brief Section AB) all hold with direct evidence: unit tests,
  real-MariaDB integration tests (including real concurrency races), and a
  real-DeepSeek/real-MariaDB live benchmark through the actual production
  entry point.
- Raw transcript (`conversation_message`) remains untouched and canonical;
  old history compacts durably; recent history stays provider-native;
  no compacted/raw overlap or gap, proven end to end against real MariaDB.
- Incremental compaction verified: a second round builds on the first
  round's own summary and never re-reads already-compacted history.
- Concurrency: a monotonic-advance guard, verified against real racing
  writes (both a raw store-level race and a realistic mid-model-call race).
- Compaction failure never fails the customer turn - proven live with a real
  turn dispatching normally despite a forced compaction failure.
- Fresh domain truth remains authoritative; the compacted summary itself
  (real DeepSeek output) explicitly declined to assert business facts as
  current truth.
- Topic return and corrections survive compaction - proven both structurally
  (fake-provider tests) and with real DeepSeek output across a 10-turn,
  4-compaction-round live conversation.
- D6 fallback semantics unchanged; governance/dispatch regression clean
  (290/290); D3-D6 regression clean (118/118).
- `npx tsc --noEmit`, `npm run build`, `npm run lint` all clean. No database
  migration.
- V1.8 final readiness: `READY_FOR_R3_V1_8_FINAL_PERSISTENT_MEMORY_CLOSURE`.
