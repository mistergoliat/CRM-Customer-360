# SALES-AGENT-R3-V1.8-D3 -- Persistent Session Read Side + deriveMessages

Status: implemented. Real production code changed, scoped exactly to the
READ side of the persistent session (`agent_sessions`/`agent_session_events`)
plus a bounded, new read of `conversation_message`, for R3-native
(`SalesAgentRuntime`). Shadow-only, exactly as required: `buildAgentStepPromptPackage.ts`,
the real provider request path, `runAgentToolLoop.ts`'s own message
construction, and every customer-visible behavior are byte-for-byte
unchanged. `recentMessages` (the legacy tail) is untouched. No compaction is
implemented or emitted. No D4/D5 live routing is implemented. Every one of
this task's own non-goals was checked against the actual diff before this
document was written.

## 1. Executive verdict

**`R3_V1_8_D3_SESSION_READ_SIDE_VALIDATED`**

Every requirement in the task brief is implemented: a bounded event reader
(reusing `AgentSessionStore.loadRecentEvents` unchanged), a new bounded
`conversation_message` transcript reader, a pure `deriveMessages()`
projection, a short per-conversation `GET_LOCK` guard scoped only to the read
section, and `DEGRADE_TO_LEGACY_CONTEXT` failure semantics -- all verified by
execution against real MariaDB and pure unit tests, not by inspection alone.

## 2. Selected transcript/session merge strategy

**Confirmed exactly as `V1.8-C`/`V1.8-D0` preferred, with no evidence found
to contradict it (Section B's Option C, the "preferred architectural
direction unless code proves otherwise"):**

- `conversation_message` is the sole canonical human transcript
  (`direction: 'inbound' -> role "user"`, `'outbound' -> role "assistant"`).
- `agent_session_events` supplies operational evidence only (tool activity,
  turn markers) -- never message text.
- The two are never merged into one array. `deriveConversationMessages()`
  reads only `conversation_message`; `deriveToolActivityObservations()` reads
  only events. `deriveMessages()` composes both into two separate output
  fields, never one interleaved array.

This was forced by re-confirming `V1.8-D2`'s own central finding: no R3-native
dispatch path has synchronous access to a `conversation_message.public_id`
(Options A/B from the task brief were dead on arrival, already proven by
D2, not re-litigated here). Since `outboundMessagePublicId` on
`ASSISTANT_MESSAGE_SENT` is permanently `null` today, Option C was the only
one with real data to read.

**A real, load-bearing simplification this task found, not anticipated by
the brief's own "bootstrap" framing (Section F)**: because
`conversation_message` is *always* the transcript source -- never merely a
fallback for old conversations -- there is no separate "bootstrap code path"
distinct from "normal operation." A pre-D2 conversation with zero
`agent_session_events` simply has an empty `events` array; the bounded
transcript reader returns its real prior turns exactly the same way it would
for a conversation with a rich event history. `bootstrapUsed` (Section S) is
a pure observability flag (`events.length === 0 && transcriptMessages.length > 0`),
never a branch in the read logic itself. This matches Section P's own
instruction directly: "Never discard valid canonical transcript solely
because a session marker is missing."

## 3. Assistant-history solution

**Option C, as named above.** `conversation_message.direction` maps
deterministically: `'inbound' -> "user"`, `'outbound' -> "assistant"`.
`conversation_message.direction` also carries a third value in production
(`'system'`, `lib/domains/conversations/control.ts`'s own take/release/close/reopen
timeline rows) -- confirmed by reading `control.ts` directly, not assumed --
and `deriveConversationMessages()` explicitly excludes any direction other
than `inbound`/`outbound` from the conversational history (Section E: "filter
system/non-human message classes only if the schema actually contains such
categories" -- it does, and this is exactly that filter).

## 4. Bounded readers

**Events** (Section D): `AgentSessionStore.loadRecentEvents` reused
unchanged -- already bounded (`LIMIT`, hard-capped at
`AGENT_SESSION_HARD_MAX_RECENT_EVENTS`), already ordered ascending by
`occurred_at, seq`. No extension needed to the store interface itself.

**Transcript** (Section E): new file,
`lib/brain/commercial/agent-session/conversationTranscriptReader.ts`
(`loadRecentConversationTranscript`). Exact shape `V1.8-D0` Section 13
specified: `SELECT id, direction, body, created_at FROM conversation_message
WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`, reversed
in application code -- index-covered by the existing
`idx_message_conversation_created (conversation_id, created_at)`
(`migrations/008_conversation_ai_runtime_core.sql`). Deliberately NOT
`loadNativeConversationDetailByPublicId` (unbounded, full-history read then
`.slice(-12)` in JS) -- `V1.8-D0` already found that query wrong for this
purpose. Default `20`, hard cap `100` -- same order of magnitude as
`AGENT_SESSION_DEFAULT_MAX_RECENT_EVENTS`/`COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES`,
no larger default invented.

Returned rows carry `id` as the **numeric** `conversation_message.id` (as a
string), not `public_id` -- traced directly against
`lib/brain/native-whatsapp/service.ts` (`appendConversationMessage`'s
`messageId` return value, and `NativeAutonomousCycleInput.messageId`) to
confirm this is the exact same identifier `SalesAgentRuntimeInput`'s
`inboundMessageId`/`AgentRuntimeEvent.messageId` already carries -- required
for Section K's exclusion rule to be a plain string-equality check, never a
second id-translation layer.

## 5. Bootstrap behavior

As stated in Section 2: there is no separate bootstrap code path. The
bounded transcript reader is unconditionally used regardless of whether a
session or its events exist. `loadPersistentSessionContext`'s
`bootstrapUsed` field is a pure signal (`events.length === 0 &&
transcriptMessages.length > 0`) for future observability, verified by a real
MariaDB test (`[D3-T3]`: a session created via `ensureSession` with zero
appended events, alongside two real `conversation_message` rows, correctly
reports `bootstrapUsed: true` and returns both transcript rows). No global
backfill, no background migration, no synthetic `USER_MESSAGE_RECEIVED`/
`ASSISTANT_MESSAGE_SENT` events written for old history.

## 6. Concurrency guard

Implemented exactly per `V1.8-D0` Section 4/16.2: a short, existing-pattern
`GET_LOCK('agent_session:{conversationId}', 10)`, mirroring
`runtime-opportunity/resolveRuntimeOpportunity.ts`'s exact acquire-before-BEGIN,
release-in-finally shape -- scoped **only** around
`loadPersistentSessionContext`'s own DB reads (session load, bounded events,
bounded transcript, compaction-metadata validation). No provider call exists
anywhere in this module to hold the lock across (structurally impossible,
not just avoided by discipline -- `loadPersistentSessionContext.ts` has zero
import of any provider/Capability Gateway/commercial-service module).
`lockTimeoutSeconds` is an optional test-only override (default `10`,
matching every existing precedent's value) so the lock-exclusivity test does
not need to wait a real 10 seconds.

**Verified by execution against real MariaDB, not by reading the code
alone** (`tests/commercial/loadPersistentSessionContext.test.ts`):

- `[D3-U1]`: a separate connection holds the exact same named lock; a
  concurrent `loadPersistentSessionContext` call with `lockTimeoutSeconds: 1`
  genuinely blocks for the full second, then returns a degraded result
  (`agent_session_read_lock_timeout:{conversationId}`) -- proves real MariaDB
  exclusivity, not a mocked assertion.
- `[D3-U2]`: two sequential calls for the same conversation both complete in
  under a second -- the lock is released after success, not leaked.
- `[D3-U3]`: a call whose locked section throws (an injected failing store)
  still lets the *next* call for the same conversation complete promptly --
  the lock is released in a `finally`, even on a thrown exception.

## 7. deriveMessages() contract

New file, `lib/brain/commercial/agent-session/deriveMessages.ts`. Pure,
synchronous, zero I/O (no provider, no Capability Gateway, no commercial
service, no Meta, no outbox import anywhere in the file -- structurally, not
just by convention).

```ts
deriveConversationMessages(input: {
  transcriptMessages: ConversationTranscriptMessage[];
  compactedPrefix: PersistentSessionCompactedPrefix | null;
  currentInboundMessageId: string | null;
}): AgentLoopProviderMessage[]

deriveToolActivityObservations(
  events: AgentSessionEvent[],
  compactedPrefix: PersistentSessionCompactedPrefix | null
): AgentSessionToolActivity[]

deriveMessages(input: DeriveMessagesInput): {
  historicalMessages: AgentLoopProviderMessage[];
  toolActivityObservations: AgentSessionToolActivity[];
}
```

**Deliberate deviation from the task brief's illustrative shape, justified by
evidence** (the brief itself invites this: "Use actual project naming
conventions" / "prefer that separation if it avoids coupling"): `currentInboundMessageId`
is a parameter of `deriveConversationMessages`/`deriveMessages`, **not** of
`loadPersistentSessionContext`. Section K says "`deriveMessages` must NOT
emit [the current message]" -- the exclusion is literally this module's job,
not the read-side assembler's. `loadPersistentSessionContext` has no notion
of "which turn is current"; it only assembles ingredients. This keeps the
read side a pure ingredient-assembler and keeps `deriveMessages` a pure,
independently-testable projection that a caller can re-run without a second
DB round trip (e.g. to re-derive after a different `currentInboundMessageId`).

Section J's "historical slots only" split is implemented exactly as offered:
`deriveConversationMessages()` produces slots 3+4 (compacted prefix,
historical conversation) only. No `assembleAgentProviderMessages()` was
built -- that would require duplicating `buildAgentStepPromptPackage.ts`'s
own system-instruction/identity/fresh-context logic, explicitly out of scope
("Do not duplicate system prompt logic just to satisfy a diagram").

## 8. Provider roles supported

`AgentLoopProviderMessage.role` (`agent-loop/agentLoopProviderTypes.ts`)
extended from `"system" | "user"` to `"system" | "user" | "assistant"`.
`"tool"` was deliberately **not** added -- no evidence this loop's real
request/response cycle uses OpenAI's multi-turn tool-call role today
(Capability Gateway results are folded into the next user-role payload by
`buildAgentStepPromptPackage.ts`, never sent back as a `tool`-role message);
adding it now would be speculative, not evidence-based, matching Section M's
own instruction ("only add roles genuinely supported... do not invent
provider-role semantics").

Verified end to end against the real HTTP provider, not just the type
system (`[D3-HP1]`, `tests/agent-loop/httpAgentLoopProvider.test.ts`): a
`system`/`user`/`assistant`/`user` message array reaches the real request
body's `messages` field byte-identical -- `httpAgentLoopProvider.ts` has no
role-specific branching, so this required zero changes to that file itself.

**Mechanical, behavior-preserving propagation** (the same category of fix
`V1.8-D1` needed for `AgentLoopProviderFailure` after its own additive
extension): `runAgentToolLoop.ts`'s `invokeProviderWithDeadline` had a
locally-duplicated, narrower inline type
(`{role:"system"|"user";content:string}[]`) that `tsc` correctly flagged
once the shared type widened. Widened to import and use the real
`AgentLoopProviderMessage` type directly -- zero behavior change (every real
caller, `buildAgentStepPromptPackage.ts`'s two construction sites, still only
ever emits `"system"`/`"user"` literals, confirmed unchanged in the diff).
No other file needed a change: `runCommercialMultiIntentLoop.ts` and
`semanticIntentAdapter.ts` both call `invokeProviderWithDeadline` with
`promptPackage.messages` (already typed `AgentLoopProviderMessage[]`) and
needed no edits themselves.

## 9. Compaction read semantics

Read-only, exactly as scoped (`compacted_prefix_json`/`compacted_through_seq`,
migration `034`) -- nothing writes these columns; `D7` still owns that.
`loadPersistentSessionContext.ts#extractCompactedPrefix` validates the two
columns **together**: both `null` (the normal case for every session today,
since `D7` has no emitter yet) means `compactedPrefix: null`, no warning. A
one-sided or structurally invalid pair (a non-integer/negative
`compactedThroughSeq`, a non-object `compactedPrefixJson`) degrades **only**
that slot -- `compactedPrefix: null` plus a
`agent_session_invalid_compacted_prefix_metadata` warning -- never the whole
read (Section Q: "warn/degrade, do not crash the customer turn"). Verified
against real MariaDB with both a valid fixture (`[D3-T5]`) and a
deliberately one-sided invalid fixture (`[D3-T6]`).

Once valid, `deriveConversationMessages()` places it as a single leading
`role: "system"` message (`[Compacted session history through event #{throughSeq}] {JSON}`)
-- never fabricated as a fake user/assistant turn. `deriveToolActivityObservations()`
excludes every event with `seq <= compactedThroughSeq`, so a future `D7`
compaction and this task's tool-activity projection never double-represent
the same event range (`[D3-L2]`).

**Additive schema-contract extension this task required, not anticipated by
`V1.8-D1`**: `AgentSessionEvent` gained a real `seq: number` field
(`agent_session_events.seq`, migration `033`, already the table's real
`AUTO_INCREMENT` ordering column -- previously used only inside `ORDER BY`
clauses, never surfaced on the contract). Populated in
`mariaDbAgentSessionStore.ts` from `SELECT *`'s already-present `row.seq`
(read path) and from the real `INSERT`'s own `result.insertId` (`seq` is the
table's *only* `AUTO_INCREMENT` column, so `insertId` **is** the assigned
`seq` -- no second query needed). The in-memory fake gained a matching
`nextSeq` counter on its shared `backing` object (mirroring every other
"simulated process restart" field already there). One existing test fixture
(`tests/commercial/agentSessionSummary.test.ts`'s local `event()` factory)
needed a default `seq` value to keep compiling -- purely mechanical, zero
assertion changed.

## 10. Degraded-read behavior

`DEGRADE_TO_LEGACY_CONTEXT`, exactly as `V1.8-D0` selected. Any failure
inside the locked section (a lock timeout, or a thrown error from the
injected `AgentSessionStore`) is caught by `loadPersistentSessionContext`'s
own outer `try`/`catch` and returned as a typed
`{ok:false, degraded:true, warning}` -- never a thrown exception. Verified
with a real, non-lock-related failure (`[D3-T7]`, a store whose
`loadSessionForConversation` throws) and with the real lock timeout
(`[D3-U1]`). No unbounded retry was added -- the task's own instruction
("a single short retry may be used... but do not add complexity without
evidence") found no evidence justifying one for a pure read that already has
a `DEGRADE_TO_LEGACY_CONTEXT` fallback; unlike the write side (`V1.8-D2`),
nothing here writes data that would otherwise be silently lost.

Since nothing in the codebase calls `loadPersistentSessionContext` yet
(shadow-only, Section W), there is no "legacy context" fallback wired up in
production to actually engage on a degrade -- that wiring decision belongs
to whichever future task (`D4`/`D5`) connects this read side to real
cognition.

## 11. Cache-stability characterization

`[D3-R]` (pure unit test, `tests/commercial/deriveMessages.test.ts`): calling
`deriveConversationMessages` at "turn N" (a two-message transcript, no
current-turn exclusion) and again at "turn N+1" (the same two messages plus a
third, now-excluded current inbound message) produces a **deep-equal**
historical-message array for the completed-turn prefix -- proven by
`assert.deepEqual`, not merely inspected. This holds within the bounded
transcript window; it is not (and does not claim to be) an unbounded
guarantee once messages age out of the `LIMIT`-bound query, an honest scope
matching the task's own "no actual cache-hit improvement claimed yet" caveat
-- that requires `D5`/real provider execution to observe.

## 12. Tests

All run for real this task, in four groups:

| Group | File | Result |
|---|---|---|
| `deriveMessages()` pure unit tests (Sections K/L/N/O/Q/R) | `tests/commercial/deriveMessages.test.ts` (new) | **13/13 pass** |
| Read-side contract + bounded readers + concurrency guard, real MariaDB | `tests/commercial/loadPersistentSessionContext.test.ts` (new) | **10/10 pass** |
| Provider role serialization, real HTTP | `tests/agent-loop/httpAgentLoopProvider.test.ts` (+1 new test) | **42/42 pass** |
| Core `agent-session`/`SalesAgentRuntime`/`conversationControl` regression | `agentSessionStore.test.ts`, `agentSessionStoreMariaDb.test.ts`, `agentSessionSanitizer.test.ts`, `agentSessionSummary.test.ts`, `salesAgentRuntimeSessionWriteWiring.test.ts`, `runSalesAgentRuntimeCycle.test.ts`, `salesAgentRuntime.test.ts`, `conversationControl.test.ts` | **98/99 pass** |
| Broader R3-adjacent regression (Capability Gateway, identity gate, `CommercialActionRequest`, `ReadToolRequest`, dispatch, routing) | 10 files (same set `V1.8-D1`/`D2` ran) | **124/124 pass** |
| `runAgentToolLoop`/multi-intent/`semanticIntentAdapter` (the three call sites of the widened `invokeProviderWithDeadline` signature) | `runAgentToolLoop.test.ts`, `multi-intent/runCommercialMultiIntentLoop.test.ts`, `r2SemanticIntentAdapter.test.ts` | **132/132 pass** |

**Total: 419 tests run this task (66 of them new or newly extended), 418
pass.** The one failure
(`agentSessionStoreMariaDb.test.ts`, "loadRecentEvents ORDER BY occurred_at,
seq returns true insertion order for same-millisecond events") is the
identical, already-documented pre-existing MariaDB same-millisecond-ordering
flake `V1.7`, `V1.8-A`, `V1.8-B`, `V1.8-D1`, and `V1.8-D2` all independently
confirmed -- not touched here, per this task's own "do not fix the known flake
unless this task itself changes its underlying path" instruction (it does
not: `seq` is populated, never reordered, by this task's changes).

Also run: `npx tsc --noEmit` (clean, zero errors) and `npm run build` (clean,
full Next.js production build).

## 13. Files changed

New:
- `lib/brain/commercial/agent-session/conversationTranscriptReader.ts` --
  `loadRecentConversationTranscript`, the bounded `conversation_message`
  reader (Section 4).
- `lib/brain/commercial/agent-session/deriveMessages.ts` --
  `deriveMessages`/`deriveConversationMessages`/`deriveToolActivityObservations`
  and their types (Section 7).
- `lib/brain/commercial/agent-session/loadPersistentSessionContext.ts` --
  the read-side ingredient assembler + `GET_LOCK` guard + degrade semantics
  (Sections 6/10).
- `tests/commercial/deriveMessages.test.ts` (13 tests).
- `tests/commercial/loadPersistentSessionContext.test.ts` (10 tests).
- `docs/releases/SALES-AGENT-R3-V1.8-D3-PERSISTENT-SESSION-READ-SIDE-DERIVE-MESSAGES.md`
  (this file).

Modified (production code):
- `lib/brain/commercial/agent-session/types.ts` -- `AgentSessionEvent` gains
  `seq: number`.
- `lib/brain/commercial/agent-session/mariaDbAgentSessionStore.ts` -- `seq`
  populated on both the read path (`row.seq`) and the append path
  (`result.insertId`).
- `lib/brain/commercial/agent-session/inMemoryAgentSessionStore.ts` -- shared
  `nextSeq` counter on `InMemoryAgentSessionBacking`, assigned on every
  appended event.
- `lib/brain/commercial/agent-session/index.ts` -- barrel exports for the
  three new modules.
- `lib/brain/commercial/agent-loop/agentLoopProviderTypes.ts` --
  `AgentLoopProviderMessage.role` gains `"assistant"`.
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` --
  `invokeProviderWithDeadline`'s inline message type widened to the real
  `AgentLoopProviderMessage` (mechanical, Section 8).

Modified (tests):
- `tests/commercial/agentSessionSummary.test.ts` -- local event factory gains
  a default `seq` (mechanical, no assertion changed).
- `tests/agent-loop/httpAgentLoopProvider.test.ts` -- `[D3-HP1]` added.

Not modified: `buildAgentStepPromptPackage.ts`, `runAgentToolLoop.ts`'s own
message-construction/tool-loop logic (only the one inline type widened),
`salesAgentRuntime.ts`, `runSalesAgentRuntimeCycle.ts`, `shadowRecorder.ts`,
`appendWithRetry.ts`, `defaultStore.ts`, `dispatchSalesAgentResponse.ts`/`dispatchSalesAgentFallback.ts`/`dispatchSalesAgentHardHandoff.ts`,
Capability Gateway (any file), any migration, any flag, `recentMessages`
(`buildNativeCommercialContext.ts`), `control.ts`.

## 14. Remaining D4/D5 prerequisites

Everything D4 (the first runtime shadow-comparison phase, if still useful)
or D5 (live session-driven cognition) needs from D3 is now in place:

- `loadPersistentSessionContext()` returns a coherent, lock-guarded snapshot
  of session + bounded events + bounded transcript + validated compacted
  prefix for any `conversationId`, safe when the session does not exist and
  safe on any read failure.
- `deriveMessages()` turns that snapshot into a real `AgentLoopProviderMessage[]`
  historical prefix (with real `"assistant"` roles, Section N's defect
  finally closed in the derived projection) plus a separate, structured
  tool-activity array -- a pure function a caller can invoke as many times as
  needed without re-reading the DB.
- The provider contract (`AgentLoopProviderMessage`) already accepts
  `"assistant"`, verified live against the real HTTP provider -- a future
  wiring task does not need to touch `httpAgentLoopProvider.ts` again for
  this.
- `AgentSessionEvent.seq` is now a real, populated field -- a future `D7`
  compaction writer can compute `fromSeq`/`toSeq` directly against it without
  any further store-layer work.

D4/D5 still need to decide (explicitly out of D3's scope, not started here):
how/whether `deriveMessages()`'s output actually replaces or augments
`buildAgentStepPromptPackage.ts`'s current construction; whether a feature
flag gates that switch; how `assembleAgentProviderMessages()` (Section J's
full seven-slot order) is actually built without duplicating system-prompt
logic; and how `toolActivityObservations` gets projected into a real prompt
slot, if at all.

## 15. Deferred items

- **D7**: compaction itself -- the first real writer of
  `compacted_prefix_json`/`compacted_through_seq`/`compacted_prefix_updated_at`
  and the first emitter of `SESSION_COMPACTED`. This task only reads what D7
  will eventually write, defensively.
- **`outboundMessagePublicId`**: still permanently `null` (D2's own deferred
  item, unrelated to and unresolved by this task -- D3 does not depend on it
  at all, since Option C never needed it).
- **Live wiring**: `deriveMessages()`/`loadPersistentSessionContext()` are
  fully implemented and tested but have zero production call sites --
  connecting them to `SalesAgentRuntime`'s real turn (and deciding the
  shadow-comparison-vs-live-cutover question) is explicitly `D4`/`D5`'s job,
  never this task's.
- **`"tool"` provider role**: not added (Section 8) -- revisit only if a real
  need for OpenAI's multi-turn tool-call role emerges, never speculatively.

## Verdict

**`R3_V1_8_D3_SESSION_READ_SIDE_VALIDATED`**

- Selected transcript/session merge: `conversation_message` = canonical
  human transcript, `agent_session_events` = operational evidence only,
  never merged into one array.
- Assistant-history solution: Option C, `direction` maps deterministically
  to `role`, `'system'`-direction rows excluded.
- Bounded readers: events (unchanged `loadRecentEvents`) and a new bounded
  `conversation_message` reader, both index-covered, no N+1, no unbounded
  query anywhere in this diff.
- Bootstrap: no separate code path needed -- `conversation_message` is
  always the source; `bootstrapUsed` is a pure observability flag.
- Concurrency guard: a short `GET_LOCK`, scoped only to the read section,
  proven exclusive and always-released (success, and thrown-exception paths)
  against real MariaDB.
- Degraded-read behavior: `DEGRADE_TO_LEGACY_CONTEXT`, a typed result, never
  a throw, no unbounded retry.
- `deriveMessages()`: pure, zero I/O, produces a real historical
  `AgentLoopProviderMessage[]` (with `"assistant"` roles) plus a separate
  tool-activity array; current-turn exclusion and compacted-prefix placement
  both implemented and tested.
- Provider roles: `"assistant"` added, verified live against the real HTTP
  provider; `"tool"` deliberately not added, no evidence for it yet.
- Tests: 419 run, 418 pass, 1 pre-existing flake (already documented across
  five prior tasks, not touched). `npx tsc --noEmit` and `npm run build`
  both clean.
- Zero customer-visible behavior change; zero production call site added for
  the new read side. Next actionable items are `D4`/`D5`.
