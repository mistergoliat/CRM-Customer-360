# SALES-AGENT-R3-V1.8-D0 -- Persistent Session Implementation Preflight

Status: audit only, no production code changed. D1 was not implemented, no
migration was created, no runtime file was modified, no flag was added, no
prompt changed, Capability Gateway was not touched. One throwaway,
isolated Node script made exactly one real DeepSeek API call outside the
repository (scratchpad directory, never committed, no secrets logged) to
resolve Audit 4 with direct evidence instead of inference; nothing else
executed a network call.

## 1. Executive verdict

**`R3_PERSISTENT_SESSION_PREFLIGHT_READY_WITH_CONSTRAINTS`**

All four original uncertainties, plus the two the task added (session-write
failure, backfill viability), resolved with direct code evidence -- no
"decide during implementation" left open for any of them. The
`_WITH_CONSTRAINTS` qualifier (not a plain `_READY`) reflects three real,
concrete corrections this preflight found to `V1.8-C`'s own design, not any
new blocker:

1. `V1.8-C`'s proposed field name **`summaryTokenEstimate` is REJECTED by
   the real sanitizer** (verified by executing the actual regex against the
   actual string, Section 7/8) -- the approved replacement is
   `summaryEstimatedSize`.
2. **No existing lock covers the full turn boundary**, and every existing
   lock precedent in this codebase is deliberately short and DB-only,
   never held across an LLM call -- `V1.8-C`'s Section 12 proposal to
   "wrap the critical section from load through append" in one GET_LOCK
   would be an unprecedented, real-risk departure from this codebase's own
   pattern (Section 2/4).
3. **The DeepSeek cache metrics `V1.8-C` treated as unverified are real and
   confirmed live** (Section 9/10) -- but under two different field names
   than either the Harness's own `usage` object or `V1.8-C`'s guess, and
   the existing provider code reads neither today.

None of the three are blockers; all three are now closed, concrete
decisions (Section 16).

## 2. Concurrency/serialization finding

**Classification: `PARTIAL_SERIALIZATION_NEEDS_SESSION_GUARD`.**

Two genuinely different concurrency scenarios exist, and this codebase
already fully solves one of them but not the other:

- **Same inbound message redelivered (duplicate webhook)**: fully solved,
  upstream of everything this design touches.
  `processNativeWhatsAppInbound` (`lib/brain/native-whatsapp/service.ts:1006-1022`)
  checks `loadConversationMessageByProviderMessageId("meta",
  providerMessageId)` before creating any row and returns `{duplicate:
  true, ...}` immediately if found, backed by the DB's own `UNIQUE KEY
  uq_provider_message (provider, provider_message_id)`
  (`migrations/008_conversation_ai_runtime_core.sql:48`). This runs *before*
  `ensureAutonomousSalesTurnContinuity`/`runNativeAutonomousCycle` are ever
  invoked -- a redelivered message never reaches the LLM twice.
- **Two genuinely different inbound messages for the same `conversation_id`
  arriving close together**: **not serialized around the LLM call today.**
  `ensureAutonomousSalesTurnContinuity.ts` (read in full this task) is a
  pure orchestration wrapper -- no lock, no `FOR UPDATE`, no claim
  mechanism anywhere in it. `runNativeAutonomousCycle`/`processNativeWhatsAppInbound`
  run as a direct, synchronous request-handler call (Meta webhook -> Next.js
  API route -> inline execution) with no queue in front of them -- two
  real, near-simultaneous customer messages for the same conversation can
  genuinely execute this path concurrently in two separate requests.

Three existing, real, proven lock mechanisms were found and read in full --
all three share one structural property that matters directly for this
design:

| Mechanism | File | Scope | Held during the LLM call? |
|---|---|---|---|
| `acquireConversationLock` | `runtime-opportunity/resolveRuntimeOpportunity.ts:57-76` | Per-`conversationId`, wraps only `BEGIN -> SELECT ... FOR UPDATE -> maybe INSERT -> COMMIT` for opportunity resolution | **No** -- released before returning, never wraps a provider call |
| `withOptionalSingleReplyLock` | `action-queue/persistAgentAction.ts:171-189` | Per-idempotency/follow-up-sequence key, wraps action-row persistence only | **No** |
| `assignCommercialTriggerSequence` | `work/sequencing.ts:82-175` | Per-`conversationId`, wraps trigger-sequence assignment (CommercialWork/R2 pipeline only -- confirmed by `V1.8-B` to not even be on R3's real production path) | **No** |

**Answering the task's eight sub-questions directly:**

1. Can two R3 turns run the LLM simultaneously for the same
   `conversation_id`? **Yes, for two distinct inbound messages** (not for a
   redelivered duplicate of the same one).
2. Does an exclusion zone exist covering load-context -> model-loop ->
   terminal-outcome? **No.**
3. N/A (no such boundary exists to describe).
4. Partial mechanisms: the three locks above, plus `persistAgentAction`'s
   `idempotencyKey`-based `ER_DUP_ENTRY` recovery and the outbox's own
   `dedupe_key` -- all correctness nets for *specific durable writes*, none
   of them a turn-level guard.
5. `crm_commercial_conversation_sequences`/`assignCommercialTriggerSequence`
   orders **trigger identity only** (a bookkeeping sequence number), never
   wraps or serializes downstream execution -- and it belongs to the
   CommercialWork/R2 pipeline, which `V1.8-B` already proved is not R3's
   live production path.
6. Yes -- confirmed by reading all three lock implementations: every
   existing `GET_LOCK` in this codebase is released (in a `finally`) before
   the function returns, and none of the three ever calls a provider/LLM
   inside its locked section.
7. **Real risk, not theoretical**: holding a MariaDB session-level advisory
   lock (`GET_LOCK`) across a 10-30s+ LLM call means holding one pooled
   connection checked out of the pool for that whole duration --
   materially different from every existing precedent here (all three are
   sub-second, DB-only). Under real concurrent load this risks pool
   exhaustion for unrelated conversations' own short-lived locks/queries,
   and every existing precedent uses a fixed 10-second `GET_LOCK` timeout
   -- far shorter than the hold time this would require, so naively
   reusing the same timeout would make a second legitimate message fail
   outright rather than wait reasonably.
8. **Minimal pattern for D2/D3**: do not hold a lock across the LLM call.
   Acquire a short, existing-pattern `GET_LOCK` (mirroring
   `resolveRuntimeOpportunity`'s exact shape) only around "load session
   state and derive the message prefix to use this turn," release it
   immediately, run the model without holding it, and rely on the append
   side's existing idempotent dedupe-key mechanism (`V1.8-C section 11`,
   already implemented and proven) to keep the log itself always correct
   regardless of interleaving. A rare genuine race between two distinct
   messages may mean one turn's derived prefix does not yet include the
   other's result -- an honest, bounded staleness for one turn, self-
   healing on the very next turn's read, never a corrupted log. This is
   the same category of tradeoff `V1.8-C` itself already accepted for
   session-write failures (Section 12).

## 3. Exact current turn-ordering graph

```
Meta webhook (Next.js API route, synchronous, no queue)
  -> processNativeWhatsAppInbound
       -> loadConversationMessageByProviderMessageId (dedupe check, DB unique-key backed)
            [duplicate] -> return early, no cycle run, no LLM call
            [new] -> continue
       -> resolveOrPersistNativeExternalIdentity
       -> withTransaction: createOrUpdateNativeConversation + appendConversationMessage (inbound row)
  -> ensureAutonomousSalesTurnContinuity           <-- NO LOCK ANYWHERE IN THIS FUNCTION
       -> runNativeAutonomousCycle                  <-- NO LOCK
            -> buildNativeCommercialContext (fresh SQL read, unchanged by this design)
            -> loadRecentCatalogContext / loadPendingCatalogAction
            -> runSalesAgentRuntime -> runAgentToolLoop   <-- the LLM call(s) happen here, unguarded
                 -> [narrow, short-lived] resolveRuntimeOpportunity's own lock,
                    only if/when a mutating CommercialActionRequest needs an
                    opportunity anchor -- released long before/after, never
                    wrapping the model call itself
            -> dispatch (outbox write, its own dedupe_key)
            -> recordAgentToolLoopSessionShadowEvents (Section 6 -- write, best-effort)
```

## 4. Recommended session concurrency strategy

Reuse `resolveRuntimeOpportunity`'s exact shape (`GET_LOCK('agent_session:{conversationId}',
10)` before `BEGIN`, released in a `finally`), scoped *only* to the
"resolve/load session + derive this turn's message prefix" step -- not the
model call, not dispatch, not the terminal append. Combine with the
already-existing, already-proven idempotent append mechanism (dedupe keys
keyed on `inboundMessageId`/`stepIndex`/`tool`) as the correctness net for
whatever residual interleaving the short lock does not prevent. No new
lock primitive; no lock held longer than any existing precedent in this
codebase. **This is a design refinement of `V1.8-C section 12`, not a
reversal of it** -- the reuse target was right, the proposed scope (the
whole turn) was too broad given this task's own new evidence about
existing lock hold-time norms.

## 5. Conversation lifecycle finding

Read in full: `migrations/008_conversation_ai_runtime_core.sql` (schema)
and `lib/domains/conversations/control.ts` (the single module that governs
every real transition -- confirmed by targeted grep across `lib/` that no
other module writes `conversation.status`).

**Real states, exactly two in practice** (`status VARCHAR(32) DEFAULT
'open'`, no DB-level `CHECK` constraint, but exactly one writer module):
`'open'` and `'closed'`. `isConversationClosedStatus` (`control.ts:25-29`)
defensively also recognizes `'resolved'`/`'done'`/`'archived'` as closed on
*read*, but `control.ts` itself never *writes* any value other than
`'open'`/`'closed'` -- the wider read-side set exists for forward
compatibility with a status this module does not itself produce, not
evidence of a richer lifecycle actually in use today.

**Answering the task's ten sub-questions:**

1. Real states: `open`, `closed` (written); `resolved`/`done`/`archived`
   (recognized on read only, never observed written by this module).
2. `open` = normal operating state, independent of AI/human ownership.
   `closed` = conversation lifecycle ended; `close` action also cancels
   every pending outbox/action row in the same transaction
   (`cancelPendingAutonomousSendsTx`, `control.ts:207-208`).
3. Closed exactly when an operator (or an equivalent internal caller)
   invokes `applyConversationControl({action: "close"})` -- no automatic/
   time-based closure logic was found anywhere in `control.ts`.
4. **Yes, always** -- `reopen` is a first-class action
   (`control.ts:211-213`), guarded by `if (input.action === "reopen" &&
   !closed) return {ok:false, code:"not_closed", ...}` -- reopen is only
   valid from a closed state, and it always targets the **same row**
   (`UPDATE conversation SET status = 'open' ... WHERE id = ?`, the exact
   same `id` throughout).
5. After reopen: the conversation is `open` again, `ai_enabled`/
   `human_owner_active` are untouched by `reopen` itself (they retain
   whatever they were before close, since `close` only ever touches
   `status`) -- R3's next inbound turn runs exactly as it would for any
   other open conversation, no special-casing found or needed.
6. **Should mirror, per Section 6's policy below** -- not yet implemented
   (correctly, per this task's non-goals).
7. **Reuse the same session, never create another.** Directly forced by
   the evidence: `reopen` never creates a new `conversation` row (same
   `id`, same transaction pattern as every other action in this module),
   so `agent_sessions`'s existing `UNIQUE KEY uq_agent_sessions_conversation_id`
   already makes "one session per conversation, forever" the only
   consistent answer -- there is no code path in this codebase where a
   second `conversation` row would ever represent "the same logical
   conversation, reopened."
8. **No separate archive/delete found.** `close` is the only terminal-ish
   transition in `control.ts`; no delete/archive/purge function exists in
   this file, and no TTL/retention logic was found in it either.
9. Confirmed **none** -- same evidence as #8.
10. `close`/`reopen` toggling the *same* row's `status`, with ownership
    (`ai_enabled`/`human_owner_active`) tracked independently, is already
    exactly the Harness-compatible shape this task asks about: "same
    logical conversation -> same persistent session" holds trivially
    because the underlying row identity never changes.

**Selected policy: `SESSION_MIRRORS_CONVERSATION_STATUS`.**

## 6. Recommended session lifecycle policy

Add two symmetric writes to `applyConversationControl`'s existing
transactions (not implemented in this task): inside the `close` case's
transaction, alongside the existing `UPDATE conversation SET
status='closed'`, add `UPDATE agent_sessions SET status='closed' WHERE
conversation_id = ?`; inside `reopen`'s transaction, the symmetric
`UPDATE agent_sessions SET status='active' WHERE conversation_id = ?`.
Both are single-row, indexed (`UNIQUE KEY uq_agent_sessions_conversation_id`),
same-transaction updates -- no new lock, no new query pattern, no
lineage/forking logic needed (Section 5, point 7 already rules that out
with evidence). `agent_session_events` needs no change at all on close/reopen
-- events are never deleted, matching this repo's existing retention
posture for `commercial_event`/`crm_capability_executions` (no
delete/TTL logic found for either, same as `conversation` itself).

## 7. Sanitizer findings table

Read in full: `agent-session/sanitizer.ts`, `events/normalize.ts` (the real
`normalizeCommercialEventPayload` layer-1 implementation reused by the
sanitizer), `agent-session/store.ts`'s `AppendEventInput`/`appendEvent`
contract, and `mariaDbAgentSessionStore.ts`'s call site
(`sanitizeAgentSessionPayload(input.payload)` before every insert, no bypass
path found).

**Two real layers, confirmed by direct reading, not by description:**

- **Layer 1** (`events/normalize.ts:60-61`, reused verbatim by
  `agent-session/sanitizer.ts:26,68`):
  `SENSITIVE_KEY_PATTERN = /authorization|api[-_]?key|token|secret|password|cookie|header|webhook|reasoning[-_]?(content|text)|chain[-_]?of[-_]?thought|thinking|raw[-_]?(output|prompt)|prompt/i`,
  tested against every object key recursively, at any nesting depth
  (`assertPlainSerializable`, `events/normalize.ts:68-91`), throws
  `commercial_event_forbidden_key:{path}` on a match. Fail-closed --
  confirmed no catch-and-persist-anyway path exists anywhere in the append
  chain.
- **Layer 2** (`agent-session/sanitizer.ts:42-56`, `AgentSessionStore`-only,
  additive on top of layer 1):
  `AGENT_SESSION_PII_KEY_PATTERN = /\bphone\b|\bemail\b|\baddress\b|wa[-_]?id|external(id|_id)|normalizedphone|prestashop.?(password|credential)/i`,
  same recursive walk, throws `AgentSessionForbiddenPayloadError`.

**Additional constraints found on inspection, not previously documented in
`V1.8-C`:**

| Constraint | Finding |
|---|---|
| Maximum payload depth | **None enforced** -- `assertPlainSerializable` recurses without a depth limit |
| Maximum string length | **None enforced** |
| Array length | **None enforced** |
| Nested objects | Recursed into fully, same key checks applied at every level |
| Null handling | Passed through as `null`, no special casing |
| `undefined` handling | **Silently dropped** (`if (typeof nestedValue === "undefined") continue`), never thrown |
| Number handling | Passed through as-is -- **no `NaN`/`Infinity` check found** |
| UUID/public-id handling | No format validation in the sanitizer itself -- treated as a plain string, same as every other id field already flowing through this path (`executionPublicId`, etc.) |

None of these gaps are exploited by this design's four proposed fields
(all are small scalars/enums/ids, Section 8) -- flagged here as a general,
pre-existing absence worth knowing about, not a defect this task needed to
fix (`AGENTS.md`: no refactors beyond the active task).

**Verification method**: the regex is a pure, deterministic string test
with no dynamic behavior to observe, so this task ran it directly (Node,
the exact literal regex copied from the two source files, against the
exact literal proposed field-name strings) rather than writing a
characterization test file -- a faster, equally rigorous check for this
specific question, and no `.ts`/test file needed to be added to the repo
for it.

## 8. Approved payload field names

| Proposed field (`V1.8-C`) | Layer 1 | Layer 2 | Verdict | Approved name |
|---|---|---|---|---|
| `outboundMessagePublicId` | pass | pass | **ACCEPTED_AS_IS** | `outboundMessagePublicId` |
| `fromSeq` | pass | pass | **ACCEPTED_AS_IS** | `fromSeq` |
| `toSeq` | pass | pass | **ACCEPTED_AS_IS** | `toSeq` |
| `summaryTokenEstimate` | **fails** (contains `token`) | pass | **REJECTED** | `summaryEstimatedSize` (verified: passes both layers; matches this codebase's own existing naming convention for exactly this substitution -- `effectiveMaxOutputSize`, `sanitizer.ts:24`'s own comment: "a numeric metric must be named e.g. `outputSize`, never `outputTokenCount`/`outputTokens`") |

All four verified by executing the real, literal regexes from both source
files against the real, literal candidate strings (not by manual
inspection) -- output included verbatim:

```
outboundMessagePublicId | layer1(forbidden)= false | layer2(pii)= false
fromSeq                 | layer1(forbidden)= false | layer2(pii)= false
toSeq                   | layer1(forbidden)= false | layer2(pii)= false
summaryTokenEstimate    | layer1(forbidden)= true  | layer2(pii)= false
summaryEstimatedSize    | layer1(forbidden)= false | layer2(pii)= false
```

**Correction to `V1.8-C section 6`'s `SESSION_COMPACTED` payload**: use
`summaryEstimatedSize`, not `summaryTokenEstimate`, everywhere that
document names the latter. No other field in that design needs a change.

## 9. DeepSeek cache-metrics finding

**Classification: `CACHE_METRICS_AVAILABLE`.**

Static reading first: `httpAgentLoopProvider.ts`'s own
`OpenAiChatCompletionResponse` type (`httpAgentLoopProvider.ts:38-51`)
declares only `prompt_tokens`, `completion_tokens`,
`completion_tokens_details.reasoning_tokens` -- and the parsing code
(`availableResponseMetadata`, lines 314-324) reads only those three. No
cache field is declared or read today. A TypeScript type is not proof of
what the real HTTP response contains, so this task made one isolated,
real call to confirm rather than infer.

**Spike executed**: one throwaway script
(`cache-metrics-spike.mjs`, scratchpad directory, never added to the repo,
deleted from consideration after this run -- not a repo artifact) loaded
`BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY`/`BRAIN_MODEL_NAME` from the
real `.env` (values never printed -- only object keys and non-sensitive
numeric usage fields were logged) and made one real, minimal
(`max_tokens: 8`) chat-completion call against the actual configured
DeepSeek endpoint. No production code path was exercised; no database, no
Meta, no `runAgentToolLoop`.

**Real response `usage` object, keys and values, from that one call:**

```
USAGE_KEYS: prompt_tokens, completion_tokens, total_tokens,
            prompt_tokens_details, completion_tokens_details,
            prompt_cache_hit_tokens, prompt_cache_miss_tokens
USAGE_OBJECT: {"prompt_tokens":90,"completion_tokens":8,"total_tokens":98,
               "prompt_tokens_details":{"cached_tokens":0},
               "completion_tokens_details":{"reasoning_tokens":8},
               "prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":90}
```

Two independent, real, currently-unread representations of the same
concept exist simultaneously in the live response:

1. **Top-level, DeepSeek-specific**: `prompt_cache_hit_tokens` /
   `prompt_cache_miss_tokens` -- exactly the names this task's brief
   guessed, confirmed real.
2. **Nested, OpenAI-standard shape**: `prompt_tokens_details.cached_tokens`.

Both read as `0`/`90` respectively in this one-off, cold call with no prior
cacheable prefix -- consistent with a fresh, uncached request, not a
malfunction. This task did not attempt to force a cache hit (would require
a second call reusing an identical long prefix, out of scope for a
same-turn preflight check) -- the *field names and their presence* are
what this audit needed to confirm, not a live cache-hit-rate measurement.

## 10. Exact provider fields available

Recommended additive fields for `AgentLoopProviderResponse`
(`agent-loop/agentLoopProviderTypes.ts:23-39`), not implemented in this
task:

```ts
cacheReadTokens?: number | null;   // from usage.prompt_cache_hit_tokens
cacheMissTokens?: number | null;   // from usage.prompt_cache_miss_tokens
```

Parsed in `httpAgentLoopProvider.ts`'s existing
`availableResponseMetadata` block (lines 314-324) as:

```ts
cacheReadTokens: data.usage?.prompt_cache_hit_tokens ?? null,
cacheMissTokens: data.usage?.prompt_cache_miss_tokens ?? null,
```

The top-level DeepSeek-specific fields are preferred over the nested
`prompt_tokens_details.cached_tokens` -- same information, one fewer level
of null-safe traversal, and already exactly what this task's own brief
named. `total_tokens` is available but not recommended for addition --
it is a pure derived sum of two fields already captured
(`inputTokens + outputTokens`), and this codebase's own existing
convention (`LLM-R1-T02`/`LLM-R1-T08B`) only ever adds fields the provider
computes that the caller cannot trivially derive itself.

## 11. Session-write-failure current behavior

Read in full: `shadowRecorder.ts` (already read in `V1.8-C`, re-confirmed
here), and its one real call site,
`salesAgentRuntime.ts:241-254`.

1. **What happens today if `appendEvent` fails?** The call site checks
   `if (!shadowResult.ok) warnings.push(\`agent_session_shadow_event_write_failed:${shadowResult.warning}\`)`
   -- a string pushed onto the turn's own `warnings` array. Nothing else.
2. **Logged and continues?** Yes, exactly that -- no throw, no retry, no
   turn-status change.
3. **Can the turn still terminate `responded` even if the event never
   wrote?** **Yes, confirmed by reading the code path directly**: `status`
   (line 256, `TERMINAL_REASON_TO_STATUS[loop.terminalReason]`) is computed
   from `loop.terminalReason` alone, entirely independent of
   `shadowResult.ok`. The customer-facing dispatch decision was already
   made before this shadow call even runs.
4. **Retry?** None found -- a single `await`, no retry loop, no backoff.
5. **Health/readiness around the store?** None found in
   `agent-session/*` -- `getDefaultStore()` lazily constructs a
   MariaDB-backed store with no separate health-check function.
6. **Existing error types?** Exactly one typed error class,
   `AgentSessionForbiddenPayloadError` (sanitizer rejection only);
   every other failure path returns a plain string in
   `AppendEventResult.warning`, never a typed error object.

## 12. Recommended failure semantics for D2/D5

**Selected: `RETRY_THEN_DEGRADE`**, applied asymmetrically to the read and
write sides -- stated explicitly, not left ambiguous:

- **Read side** (loading/deriving this turn's session prefix, Section 4):
  on failure, **`DEGRADE_TO_LEGACY_CONTEXT`** -- fall back to constructing
  the prompt the way `buildAgentStepPromptPackage` does today (or the
  bootstrap-from-`conversation_message` path, Section 13) for that one
  turn only. Never `FAIL_CLOSED`: this repo's own, repeatedly-stated
  invariant -- `ensureAutonomousSalesTurnContinuity`'s own module comment,
  "guarantees the turn never ends in silence" -- makes blocking a
  customer-facing response over an internal read failure indefensible
  given the evidence already in this codebase.
- **Write side** (appending this turn's events after the model already
  responded, Section 11): add a short, bounded retry (1-2 attempts, brief
  backoff -- mirroring the existing HTTP provider's own retry philosophy,
  `httpAgentLoopProvider.ts`'s `RETRY_BASE_DELAY_MS`/`RETRY_MAX_DELAY_MS`
  shape, not a new invented scheme) before degrading to today's exact
  behavior (log a warning, let the turn stand). This is a real,
  intentional change from today's zero-retry behavior -- justified because
  once `deriveMessages` depends on this log (unlike today, where nothing
  reads it back), a dropped write is no longer a pure audit-trail gap but
  a next-turn context-continuity regression, so it is worth one extra
  cheap attempt before accepting the same degrade-and-warn outcome this
  codebase already accepts today.
- **`FAIL_CLOSED` is rejected outright** for both sides, with justification
  from evidence, not just conceptual preference: every module read in this
  task and its predecessors (`ensureAutonomousSalesTurnContinuity`,
  `dispatchSalesAgentResponse`, the fallback-dispatch machinery) is built
  around never leaving a customer without a reply; failing a turn over
  session bookkeeping would be the first place in this codebase that rule
  is broken.

## 13. Backfill viability

**Classification: `BOUNDED_BOOTSTRAP_VIABLE`**, with one specific
correction to `V1.8-C`'s own assumption.

- **Existing conversation-history query**: `loadNativeConversationDetailByPublicId`
  (cited with file:line in `V1.8-A`, native-whatsapp/service.ts) is
  **unbounded** (`ORDER BY created_at ASC, id ASC`, no `LIMIT`, full-history
  read, then `.slice(-12)` in JS) -- **this is not the right query to reuse
  for a bootstrap**, and `V1.8-C` did not specify which query it intended.
- **Index**: `conversation_message` has `KEY idx_message_conversation_created
  (conversation_id, created_at)` (`migrations/008_conversation_ai_runtime_core.sql:49`)
  -- confirmed present, covers exactly the access pattern a bounded
  bootstrap needs.
- **Corrected design**: bootstrap should use a **bounded** query from the
  start -- `SELECT ... WHERE conversation_id = ? ORDER BY created_at DESC,
  id DESC LIMIT ?` (index-covered, no full scan), then reverse in
  application code -- the exact same shape already proven and in
  production for `agent_session_events.loadRecentEvents`
  (`mariaDbAgentSessionStore.ts:189-203`), not the unbounded native-whatsapp
  query. This is a one-line difference from `V1.8-C`'s implicit assumption
  but a real one -- reusing the unbounded query for every pre-existing
  conversation's first post-D2 turn would be a real, avoidable full-history
  read at exactly the moment a bounded design was the whole point.
- **Outbound R3 text present in `conversation_message`?** Already
  established with file:line evidence in `V1.8-A` ("Assistant outputs...
  Yes, in `conversation_message`... written by the dispatch/outbox path")
  -- re-confirmed here by re-reading the same evidence, not re-derived from
  scratch.
- **Volume**: a bound in the same order of magnitude as this codebase's own
  existing precedents (`AGENT_SESSION_DEFAULT_MAX_RECENT_EVENTS = 20`,
  `COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES = 12`) is trivially cheap against
  an indexed, `LIMIT`-bound query -- no N+1 (one query, one conversation),
  no full scan.

## 14. D1 assumptions now considered proven

- `agent_sessions`/`agent_session_events`'s existing schema, dedupe, and
  ordering guarantees are exactly as `V1.8-C` described (re-verified by
  direct reading this task, not just cited).
- No existing lock or upstream mechanism already covers full-turn
  concurrency -- confirmed absent, not merely assumed absent (Section 2).
- `conversation.status` lifecycle is exactly `open`/`closed`, single-writer
  module, always-reuse-same-row on reopen -- confirmed by reading the one
  real authority (`control.ts`), not inferred from schema alone (Section
  5).
- Three of `V1.8-C`'s four new field names are safe as proposed; the
  fourth has a confirmed, approved replacement (Section 8).
- DeepSeek's real endpoint exposes cache-hit/miss token counts today,
  under confirmed real field names, with zero server-side change needed --
  only client-side parsing (Section 9/10).
- Session-write failures today never block a turn, and this design's
  `RETRY_THEN_DEGRADE` recommendation is a strict, justified refinement of
  that existing behavior, not a reversal of it (Section 11/12).
- A bounded, indexed, single-query bootstrap is viable with one concrete
  correction to which query shape to copy (Section 13).

## 15. Remaining unknowns

- **Exact hold-time-appropriate `GET_LOCK` timeout for the narrowed
  "resolve session + derive prefix" critical section** (Section 4) --
  this step should be fast (DB reads only, no LLM call inside it), so the
  existing 10-second precedent likely still applies, but this was not
  independently timed against real session-log sizes in this task.
- **Real-world frequency of the two-distinct-messages-same-conversation
  race** (Section 2) -- this task established that no guard exists and
  that the risk is not theoretical (no queue in front of the webhook
  handler), but did not have access to production traffic patterns to
  estimate how often it actually occurs.
- **Whether a broader MariaDB health/readiness layer exists somewhere else
  in this repo** that `AgentSessionStore` could hook into (Section 11,
  point 5) -- only `agent-session/*` was read for this question; a
  repo-wide health-check search was out of this preflight's scope.
- **Live cache-hit-rate behavior under a real growing prefix** (Section 9)
  -- confirmed the fields exist and are named correctly; did not attempt a
  two-call experiment to force and observe a real cache hit, since that
  was not needed to answer "which field names, if any."

## 16. Explicit implementation constraints

Binding on D1 and every slice after it, derived directly from this
preflight's findings:

1. Use `summaryEstimatedSize`, never `summaryTokenEstimate`, in
   `SESSION_COMPACTED`'s payload and anywhere else this concept appears.
2. Any per-conversation lock D2/D3 introduces must be scoped to "resolve
   session + derive prefix" only, released before the model call --
   never held across `runAgentToolLoop`'s provider invocation.
3. `agent_sessions.status` transitions must be added inside
   `applyConversationControl`'s existing `close`/`reopen` transactions in
   `lib/domains/conversations/control.ts` -- not as a separate,
   independently-timed write, and not via a new table or lifecycle
   concept.
4. The bootstrap/backfill query must be bounded (`LIMIT`, `ORDER BY ...
   DESC ... LIMIT N` then reverse) from its first version -- never the
   existing unbounded `loadNativeConversationDetailByPublicId` shape.
5. `AgentLoopProviderResponse`'s new cache fields must read
   `usage.prompt_cache_hit_tokens`/`usage.prompt_cache_miss_tokens`
   (top-level, DeepSeek-specific), not `usage.prompt_tokens_details.cached_tokens`
   -- both exist and mean the same thing; the top-level pair is simpler to
   parse and matches this task's own confirmed field names.
6. Session-read failures during a turn must degrade to legacy context
   construction for that turn, never fail the turn closed.
7. Session-write failures must get one short bounded retry before
   degrading to today's log-and-continue behavior -- never zero retries
   (today) and never an unbounded retry that risks delaying dispatch.

## Files inspected

`lib/brain/commercial/continuity/ensureAutonomousSalesTurnContinuity.ts`
(full read), `lib/brain/commercial/runtime-opportunity/resolveRuntimeOpportunity.ts`
(full read), `lib/brain/commercial/action-queue/persistAgentAction.ts`
(targeted read, lock section), `lib/brain/commercial/work/sequencing.ts`
(full read, from `V1.8-C`), `lib/brain/native-whatsapp/service.ts`
(targeted read, `processNativeWhatsAppInbound` lines 985-1084),
`migrations/008_conversation_ai_runtime_core.sql` (full read),
`lib/domains/conversations/control.ts` (full read),
`lib/brain/commercial/agent-session/sanitizer.ts` (re-read from `V1.8-C`),
`lib/brain/commercial/events/normalize.ts` (full read),
`lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts`
(full read), `lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts`
(targeted read, lines 236-256), `docs/releases/SALES-AGENT-R3-V1.8-C-NATIVE-PERSISTENT-AGENT-SESSION-MEMORY-DESIGN.md`,
`docs/releases/SALES-AGENT-R3-V1.8-A-CONVERSATIONAL-CONTEXT-INPUT-AUDIT.md`
(cited for the `conversation_message` outbound-text finding), `.env`
(existence-only check of three variable names, values never read into this
document).

## Tests/spikes executed

- One deterministic, literal-regex verification (Node one-liner, not a
  repo test file) confirming the sanitizer verdicts in Section 7/8 by
  execution rather than manual inspection.
- One isolated, real DeepSeek API call (`cache-metrics-spike.mjs`,
  scratchpad directory only, never added to the repository) -- `max_tokens:
  8`, no production code path, no database, no Meta, no API key or auth
  header logged. Output: real `usage` object keys, quoted in full in
  Section 9.
- No `.ts` file was added to the repository, so `npx tsc --noEmit` was not
  re-run (nothing changed that could affect it) -- consistent with this
  task's own instruction to validate only what was added.

## Files changed

New:
- `docs/releases/SALES-AGENT-R3-V1.8-D0-PERSISTENT-SESSION-IMPLEMENTATION-PREFLIGHT.md` (this file)

Modified:
- `docs/ACTIVE_RELEASE.md` (this task's entry under the `SALES-AGENT-R3`
  workstream)

No migration, `.ts` module, flag, prompt, or Capability Gateway file was
created or modified. D1 was not implemented.

## Verdict

**`R3_PERSISTENT_SESSION_PREFLIGHT_READY_WITH_CONSTRAINTS`**

- CONCURRENCY: `PARTIAL_SERIALIZATION_NEEDS_SESSION_GUARD` -- short,
  existing-pattern lock around session-resolve-and-derive only, never
  across the LLM call; idempotent append is the correctness net for the
  residual race.
- SESSION LIFECYCLE: `SESSION_MIRRORS_CONVERSATION_STATUS` -- mirror
  `agent_sessions.status` inside `control.ts`'s existing `close`/`reopen`
  transactions; same row is always reused on reopen, confirmed by code.
- SANITIZER: `outboundMessagePublicId`, `fromSeq`, `toSeq` approved as-is;
  `summaryTokenEstimate` rejected, replaced by `summaryEstimatedSize`
  (verified by execution).
- CACHE: `CACHE_METRICS_AVAILABLE` -- `usage.prompt_cache_hit_tokens` /
  `usage.prompt_cache_miss_tokens`, confirmed real via one isolated live
  call; add as `cacheReadTokens`/`cacheMissTokens` on
  `AgentLoopProviderResponse`.
- SESSION WRITE FAILURE: `RETRY_THEN_DEGRADE` -- degrade-to-legacy-context
  on read failure, one short bounded retry then degrade-and-warn (today's
  behavior) on write failure; `FAIL_CLOSED` rejected on evidence from this
  codebase's own repeated "never leave the customer in silence" invariant.
- BACKFILL: `BOUNDED_BOOTSTRAP_VIABLE` -- with the correction to use a
  `LIMIT`-bound query modeled on `loadRecentEvents`, not the existing
  unbounded conversation-history query.

Does not implement D1. Next actionable item is D1 itself, now unblocked on
all four (plus two bonus) original uncertainties.
