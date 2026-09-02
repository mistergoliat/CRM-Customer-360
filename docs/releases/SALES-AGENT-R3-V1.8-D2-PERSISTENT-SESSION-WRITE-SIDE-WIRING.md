# SALES-AGENT-R3-V1.8-D2 -- Persistent Session Write-Side Wiring

Status: implemented. Real production code changed, scoped exactly to the
write side of the persistent session (`agent_sessions`/`agent_session_events`)
for R3-native (`SalesAgentRuntime`). No `deriveMessages()`, no session
history read into the model, no provider-prompt change, no compaction, no
bootstrap/backfill, no new concurrency lock, and no change to the legacy
`recentMessages` tail -- every one of this task's own non-goals was checked
against the actual diff before this document was written.

## 1. Executive verdict

**`R3_V1_8_D2_SESSION_WRITE_SIDE_VALIDATED`**

Every requirement in the task brief was implemented, tested against real
MariaDB and real dispatch paths, and validated with zero regressions beyond
the one already-documented pre-existing flake. One real, load-bearing
architectural finding emerged while tracing "where does the canonical
outbound `conversation_message` public id become available" (Section 4):
**it never becomes available synchronously in any R3-native dispatch path
today** -- a finding this document treats as a first-class deliverable, not
a gap, since it directly determines what `outboundMessagePublicId` can
honestly contain right now.

## 2. Exact event ownership after D2

| Event | Writer | Timing | Notes |
|---|---|---|---|
| `USER_MESSAGE_RECEIVED` | `salesAgentRuntime.ts` (`recordUserMessageReceivedEvent`) | **Before** `runAgentToolLoop` is invoked | New in D2. `RETRY_THEN_DEGRADE` via `appendAgentSessionEventWithRetry`. |
| `READ_TOOL_*` / `COMMERCIAL_ACTION_*` | `agent-session/shadowRecorder.ts#recordAgentToolLoopToolActivityEvents` (new, R3-only) | After the loop completes, same as before | Unchanged governance/dedupe/sanitizer mapping -- only extracted into its own entry point (Section 9's "no tool-history redesign" requirement). |
| `ASSISTANT_MESSAGE_SENT` | `runSalesAgentRuntimeCycle.ts` (`recordAssistantMessageSentEvent`) | **After** `dispatchSalesAgentTerminalOutcome` returns | Moved in D2 (previously written pre-dispatch, inside `salesAgentRuntime.ts`, via the shared shadow recorder). `RETRY_THEN_DEGRADE`. `outboundMessagePublicId` always `null` today -- Section 4. |
| `SESSION_COMPACTED` | Nobody | N/A | Still reserved for a future D7 slice -- confirmed zero emitters (Section 12). |

**The pre-D2 shared writer, `recordAgentToolLoopSessionShadowEvents`, is
UNCHANGED** and still the sole writer for the ATL/legacy runtime
(`runNativeAgentToolLoopCycle.ts`) -- explicitly out of this task's scope
(every `V1.8` task in this series targets `SalesAgentRuntime`, never ATL).
A new, narrower sibling function
(`recordAgentToolLoopToolActivityEvents`) was extracted to give
`SalesAgentRuntime` tool-events-only semantics without touching ATL's own
call site or behavior -- both now share one internal implementation
(`appendToolActivityEvents`) so the governance/dedupe mapping is never
duplicated.

## 3. USER_MESSAGE_RECEIVED timing

Moved into `salesAgentRuntime.ts`, immediately before `runAgentToolLoop`'s
one call site (after `inboundMessageId` is computed, before `loopInput` is
invoked). Reuses the existing dedupe key builder unchanged
(`buildUserMessageDedupeKey(sessionId, inboundMessageId)`, `session:{sessionId}:user_message:{inboundMessageId}`)
and the existing reference-only payload shape (`{inboundMessageId}` -- no
customer text, unchanged from A01's original design).

Verified by execution, not just by reading the diff (`[D2-L1]`,
`tests/commercial/salesAgentRuntimeSessionWriteWiring.test.ts`): a tracking
fake store/provider pair proves the append call happens strictly before
`provider.invoke` on every real code path, using the actual
`runSalesAgentRuntime` function, not a re-implementation of its control
flow.

## 4. ASSISTANT_MESSAGE_SENT reference wiring

**Moved from `salesAgentRuntime.ts` (pre-dispatch) to
`runSalesAgentRuntimeCycle.ts` (post-dispatch)** -- per this task's own
Section I guidance ("move ASSISTANT_MESSAGE_SENT to the dispatcher/runtime
boundary that owns the canonical outbound id"). This is a real
architectural correction, not cosmetic: pre-D2, the shadow write ran
*before* `dispatchSalesAgentTerminalOutcome` was ever called (inside
`runSalesAgentRuntime` itself), so it could not have reflected the actual
dispatch outcome even in principle.

**Central finding, traced through every real R3-native dispatch path**
(`dispatchSalesAgentResponse.ts`, `dispatchSalesAgentFallback.ts`,
`dispatchSalesAgentHardHandoff.ts`, all funneling through the shared
`dispatchGovernedSalesAgentMessage.ts`): **none of them create or have
access to a `conversation_message` row.** Every one of them writes exactly
one row to `brain_message_outbox` with `status: 'planned'`
(`writeCanonicalOutboxMessage`) and returns an `outboxId` (a
`brain_message_outbox.id`), never a `conversation_message.public_id`.

The canonical outbound `conversation_message` row is created **later,
asynchronously, by the outbox-send worker**
(`lib/brain/messaging/outboundMessages.ts#persistCanonicalOutboundMessage`,
called from `autonomousOutboxTick.ts` -- hardcoded `enabled: true` -- and
from `outboxWorker.ts` -- gated behind the `BRAIN_PERSIST_CANONICAL_OUTBOUND`
flag, `false` unless explicitly set), and only once `outboxStatus ===
"sent"` -- i.e., only after Meta has actually confirmed delivery. This
happens in a completely separate call stack, on the worker's own tick
schedule, after `ASSISTANT_MESSAGE_SENT` has already been (or would already
have been) written.

**Consequence, implemented honestly rather than worked around**:
`outboundMessagePublicId` is set to `null` for every real outcome today
(`responded`, `handoff`, `fallback`, `none`) -- not because the write-side
wiring is incomplete, but because the value genuinely does not exist yet at
the point in the call stack where this event is written. Closing that gap
(making canonical persistence synchronous, or having the async worker
append a *new*, later event once the row exists) is out of D2's scope
(Section A forbids changing outbox/delivery semantics) and is named
explicitly in Section 11.

`outcome`/`terminalReason` are computed identically to the pre-D2 shadow
write (from `loop.finalMessage`/`loop.handoffReason`/`loop.terminalReason`)
-- a pure relocation of an unchanged computation, not a new behavior.

Verified against real MariaDB and real dispatch, for all three outcome
shapes plus replay idempotency (`tests/commercial/runSalesAgentRuntimeCycle.test.ts`,
`[D2-M1]`-`[D2-M4]`):

| Outcome | `outcome` | `terminalReason` | `outboundMessagePublicId` |
|---|---|---|---|
| `responded`, dispatched | `"message"` | `"responded"` | `null` |
| Eligible hard handoff | `"handoff"` | `"handoff"` | `null` |
| Technical failure (`provider_unavailable`) | `"none"` | `"provider_unavailable"` | `null` |

No message text/body appears in any event payload (`[D2-M1]` asserts this
directly against the real, persisted row).

## 5. Retry/degrade behavior

`agent-session/appendWithRetry.ts` (new, small, single-purpose):
`appendAgentSessionEventWithRetry(store, input)` -- one append attempt, one
fixed 50ms-delay retry on a transient failure, then a typed `"degraded"`
result. A sanitizer/programmer-contract failure (`AgentSessionForbiddenPayloadError`,
identified by its own stable `agent_session_forbidden_payload:` message
prefix -- no change to `AppendEventResult`'s type was needed to distinguish
this from a transient failure) short-circuits to a typed `"invalid"` result
**without a retry**, since a second identical attempt against an inherently
invalid payload would fail identically.

Both new call sites (`recordUserMessageReceivedEvent` in
`salesAgentRuntime.ts`, `recordAssistantMessageSentEvent` in
`runSalesAgentRuntimeCycle.ts`) use this one helper -- no duplicated retry
loop, no new retry framework (the task's own explicit constraint).
Verified by execution (`[D2-L3]`/`[D2-L4]`/`[D2-L5]`, in-memory; `[D2-O-B]`,
real MariaDB): one transient failure retries and recovers silently; two
failures degrade with a warning while the customer turn still reaches the
model; an injected sanitizer-shaped failure is attempted exactly once.

## 6. Lifecycle mirroring

`lib/domains/conversations/control.ts`'s `close`/`reopen` cases now include
`UPDATE agent_sessions SET status = 'closed'|'active' WHERE conversation_id
= ?` **inside the exact same `withTransaction` block** as the existing
`UPDATE conversation SET status = ...` -- no independent async write, no
new transaction boundary.

**No-session behavior, resolved exactly as this task's own preferred
default specified**: a plain `UPDATE ... WHERE conversation_id = ?` against
a conversation that never had an `agent_sessions` row simply affects zero
rows -- confirmed by `[D2-N3]` (real MariaDB): closing/reopening a
session-less conversation never creates one. Reopening a previously-closed
conversation with a session reuses the exact same `agent_sessions.id`
(`[D2-N2]`) -- there is no code path in `control.ts` that could create a
second `conversation` row for the "same" conversation, so there was never a
scenario requiring new lineage/forking logic.

`take`/`release`/`pause` (ownership transitions) do not touch
`agent_sessions.status` at all -- confirmed by `[D2-N4]`, matching this
task's own framing that ownership and lifecycle are independent axes
(exactly as they already are for `conversation.ai_enabled`/
`human_owner_active` vs. `conversation.status`).

## 7. Replay/idempotency behavior

Every new durable write in this task goes through an existing,
already-proven idempotency mechanism -- no new one was invented:

- `USER_MESSAGE_RECEIVED`: `dedupe_key = session:{sessionId}:user_message:{inboundMessageId}`,
  `UNIQUE KEY` on `agent_session_events.dedupe_key` (migration 033,
  unchanged). Same inbound replayed twice never produces two events
  (`[D2-L2]`, in-memory; `[D2-O-A]`, crash-then-replay scenario).
- `ASSISTANT_MESSAGE_SENT`: `dedupe_key = session:{sessionId}:assistant_message:{inboundMessageId}`,
  same unique-key guarantee. Verified against real MariaDB across a full
  replayed dispatch cycle (`[D2-M4]`, `[D2-O-B]`).
- `agent_sessions` lifecycle mirroring: idempotent by construction (a plain
  `UPDATE ... WHERE`, not an insert -- replaying `close` or `reopen` simply
  re-applies the same status).

Two explicit crash/replay characterizations were run (Section O of the task
brief), both with no real Meta call anywhere:

- **Scenario A** (`[D2-O-A]`): `USER_MESSAGE_RECEIVED` written, then a
  simulated crash (the provider throws before any `AgentStep`), then a
  replay of the identical inbound message. Result: exactly one
  `USER_MESSAGE_RECEIVED` event survives across both attempts.
- **Scenario B** (`[D2-O-B]`): a real canonical outbox write (`brain_message_outbox`,
  status `planned`) succeeds, the `ASSISTANT_MESSAGE_SENT` session-event
  write is injected to fail once (retries and recovers), then the same
  inbound is replayed end-to-end. Result: exactly one
  `ASSISTANT_MESSAGE_SENT` event exists after both the retry and the
  replay.

## 8. Tests

All run for real this task, in five batches:

| Batch | Files | Result |
|---|---|---|
| New, in-memory (Section L + Section O-A) | `tests/commercial/salesAgentRuntimeSessionWriteWiring.test.ts` (new) | **6/6 pass** |
| `runSalesAgentRuntimeCycle` (existing + Section M + Section O-B) | `tests/commercial/runSalesAgentRuntimeCycle.test.ts` | **15/15 pass** (9 pre-existing + 6 new) |
| Lifecycle (Section N) | `tests/domains/conversationControl.test.ts` | **10/10 pass** (5 pre-existing + 4 new + 1 pre-existing unit test) |
| Agent-session core + provider + full agent loop + `SalesAgentRuntime` | `agentToolLoopSessionShadow.test.ts`, `agentSessionStore.test.ts`, `agentSessionStoreMariaDb.test.ts`, `agentSessionSanitizer.test.ts`, `agentSessionSummary.test.ts`, `httpAgentLoopProvider.test.ts`, `runAgentToolLoop.test.ts`, `salesAgentRuntime.test.ts` | **224/225 pass** |
| ATL/legacy cycle + broader R3-adjacent regression (Capability Gateway, identity gate, `CommercialActionRequest`, `ReadToolRequest`, dispatch, routing) | `runNativeAgentToolLoopCycleConfig*.test.ts` (3 files), `capabilityGateway*.test.ts` (2), `capabilityGatewayIdentityGate.test.ts`, `commercialActionRequest.test.ts`, `customerIdentityCapabilityGateway.test.ts`, `dispatchSalesAgentResponse.test.ts`, `identityCapabilityGatewaySummaries.test.ts`, `readToolRequest.test.ts`, `salesAgentRuntimeR3NativeDispatchAuthority.test.ts`, `shouldRouteToSalesAgentRuntime.test.ts` | **145/145 pass** |

**Total: 401 tests run (26 of them new to this task), 400 pass.** The one
failure (`agentSessionStoreMariaDb.test.ts`, "loadRecentEvents ORDER BY
occurred_at, seq returns true insertion order for same-millisecond events")
is the identical, already-documented pre-existing MariaDB
same-millisecond-ordering flake `V1.7`, `V1.8-A`, `V1.8-B`, and `V1.8-D1`
all independently confirmed -- not touched here, per this task's own "do
not fix unrelated pre-existing flakes" instruction. Confirmed via the same
test file, same test name, same symptom already on record across four
prior tasks; not re-verified against a fresh `git stash` baseline in this
task since D1 already did that exact comparison one task ago against the
same flake.

Also run: `npx tsc --noEmit` (clean, zero errors) and `npm run build`
(clean, full Next.js production build).

## 9. Files changed

New:
- `lib/brain/commercial/agent-session/defaultStore.ts` -- shared lazy
  singleton for the real `AgentSessionStore` (extracted from
  `shadowRecorder.ts`, now also used by `salesAgentRuntime.ts` and
  `runSalesAgentRuntimeCycle.ts`).
- `lib/brain/commercial/agent-session/appendWithRetry.ts` --
  `appendAgentSessionEventWithRetry`, the one `RETRY_THEN_DEGRADE` helper
  every D2 write goes through.
- `tests/commercial/salesAgentRuntimeSessionWriteWiring.test.ts` --
  Section L + Section O-A.
- `docs/releases/SALES-AGENT-R3-V1.8-D2-PERSISTENT-SESSION-WRITE-SIDE-WIRING.md`
  (this file).

Modified (production code):
- `lib/brain/commercial/agent-session/shadowRecorder.ts` -- new
  `recordAgentToolLoopToolActivityEvents` entry point (R3-only, tool events
  only); `recordAgentToolLoopSessionShadowEvents` (ATL's own entry point)
  left behaviorally identical, refactored internally to share
  `appendToolActivityEvents` with the new function.
- `lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts` -- new
  pre-loop `recordUserMessageReceivedEvent`; switched its tool-event call
  to the new narrower `recordAgentToolLoopToolActivityEvents`.
- `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts` --
  new post-dispatch `recordAssistantMessageSentEvent`; new `sessionStore`
  DI field on `RunSalesAgentRuntimeCycleInput`, threaded to
  `runSalesAgentRuntime` unchanged.
- `lib/domains/conversations/control.ts` -- `agent_sessions.status`
  mirroring inside the existing `close`/`reopen` transactions.

Modified (tests):
- `tests/commercial/runSalesAgentRuntimeCycle.test.ts` -- `[D2-M1]`-`[D2-M4]`,
  `[D2-O-B]`.
- `tests/domains/conversationControl.test.ts` -- `[D2-N1]`-`[D2-N4]`.

Not modified: `runAgentToolLoop.ts`, `buildAgentStepPromptPackage.ts`,
`dispatchSalesAgentResponse.ts`/`dispatchSalesAgentFallback.ts`/
`dispatchSalesAgentHardHandoff.ts`/`dispatchGovernedSalesAgentMessage.ts`/
`dispatchSalesAgentTerminalOutcome.ts` (their result shapes already carried
everything D2 needed -- `outboxWritten`/`outboxId`/`messageSent` -- no
extension was required once the `conversation_message`-availability finding
was established), `canonicalOutboxWriter.ts`, `outboxWorker.ts`,
`autonomousOutboxTick.ts`, `runNativeAgentToolLoopCycle.ts` (ATL, untouched
by design), Capability Gateway (any file), any migration, any flag.

## 10. Remaining D3 prerequisites

Everything D3 (`deriveMessages()`, the bounded bootstrap reader, the
short concurrency lock) needs from D2 is now in place:

- `USER_MESSAGE_RECEIVED` is durable before cognition starts, with a stable
  reference-only payload D3's read side can rely on.
- `ASSISTANT_MESSAGE_SENT` is durable after the real dispatch outcome is
  known, with `outcome`/`terminalReason` accurately reflecting what
  happened -- D3's `deriveMessages()` can already reconstruct "a customer
  message arrived, and here is how the turn concluded" purely from the
  event log, once it exists.
- Both writes go through the same `RETRY_THEN_DEGRADE` helper, so D3 does
  not need to invent its own failure-handling story when it starts reading
  this log.
- `agent_sessions.status` now faithfully tracks `conversation.status`, so a
  future D3/D7 reader can trust `status = 'active'` as a real signal
  without cross-checking `conversation` separately.

## 11. Deferred items

Explicitly out of D2's scope, named here as the concrete backlog:

- **`outboundMessagePublicId` remains permanently `null` until a dedicated
  future task closes the async-persistence gap** (Section 4) -- either by
  making canonical `conversation_message` persistence synchronous with
  dispatch (a real architecture change, likely undesirable given it would
  couple dispatch latency to DB writes that today happen off the critical
  path), or by having the outbox-send worker emit a *new*, later
  session event once the row exists (respecting the append-only
  architecture -- never mutating the already-written `ASSISTANT_MESSAGE_SENT`
  row). Neither was in scope for D2 (Section A forbids changing outbox/
  delivery semantics).
- **D3**: `deriveMessages()`, the bounded bootstrap reader, the session
  prefix reader, the short per-conversation concurrency lock
  (`V1.8-D0` section 4).
- **D7**: compaction itself, and the first real emitter of
  `SESSION_COMPACTED`.
- **Cache metrics** (`cacheReadTokens`/`cacheMissTokens`, D1): still not
  propagated into `AgentToolLoopLlmCallSummary`/`commercial_event` -- D2
  did not need to touch `runAgentToolLoop.ts` for any of its own
  requirements, so this stays deferred exactly as D1 left it (with the
  correct future names, `cacheReadSize`/`cacheMissSize`, already on
  record).

## Verdict

**`R3_V1_8_D2_SESSION_WRITE_SIDE_VALIDATED`**

- New event ownership: `USER_MESSAGE_RECEIVED` pre-loop
  (`salesAgentRuntime.ts`); tool/activity events post-loop (new, narrower
  `recordAgentToolLoopToolActivityEvents`); `ASSISTANT_MESSAGE_SENT`
  post-dispatch (`runSalesAgentRuntimeCycle.ts`). ATL's own writer
  untouched.
- Pre-loop `USER_MESSAGE_RECEIVED`: durable before the provider is ever
  invoked, verified by execution.
- `outboundMessagePublicId`: always `null` today -- a real, traced
  architectural finding (no R3-native dispatch path has synchronous access
  to a `conversation_message` row), not an implementation gap.
- Retry/degrade: one bounded retry via a new, single-purpose helper;
  sanitizer-shaped failures never retried; the customer turn is never
  blocked.
- Lifecycle mirroring: `agent_sessions.status` flips inside the same
  transaction as `conversation.status`; no session ever created merely by
  a lifecycle action; reopen always reuses the same session id.
- Replay/idempotency: both new writes reuse existing, already-proven
  dedupe-key/unique-index guarantees; two explicit crash/replay
  characterizations both confirm at-most-one-event behavior.
- Tests: 401 run, 400 pass, 1 pre-existing flake (already documented across
  four prior tasks, not touched). `npx tsc --noEmit` and `npm run build`
  both clean.
- Does not implement D3. Next actionable item is D3 itself.
