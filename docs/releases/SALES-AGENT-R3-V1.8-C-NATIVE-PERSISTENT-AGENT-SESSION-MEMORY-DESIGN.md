# SALES-AGENT-R3-V1.8-C -- Native Persistent Agent Session / Memory Design

Status: design only, no production code changed. This document designs, but
does not implement, the cross-turn session object `V1.8-B` scoped (Axis 2)
and `V1.8-C0` confirmed as the next actionable item after deciding not to
adopt `@deepseek-ai/dsh` in production. Every component this design touches
was read from its current source in this task (files listed in "Files
inspected"); nothing below is implemented, and no migration, flag, or
runtime file was created or modified.

## 1. Executive verdict

**`R3_NATIVE_PERSISTENT_SESSION_DESIGN_READY`**

The central finding that makes this a `READY` verdict rather than
`REQUIRES_ARCHITECTURAL_CHANGE`: **R3 already has almost the entire
persistence substrate this design needs.** `agent_sessions` /
`agent_session_events` (migration `033_agent_sessions.sql`, `SALES-AGENT-R3-A01`)
already provide a stable per-conversation session identity, an append-only
event log with a real monotonic `seq` column, database-enforced idempotent
dedupe keys, and correlation/causation tracking -- the exact shape this
task asks to design from scratch. What is missing is narrower than the task
brief's own candidate architecture suggests: not a new store, but (a) a
read side that does not exist today (nothing derives provider messages from
this log), (b) two payload fields that are currently withheld by an
explicit, still-correct design boundary (message text, tool-observation
detail) that this design extends rather than overrides, and (c) one new,
genuinely new artifact (a compaction cache). Section 21 lays out an
additive, seven-slice rollout with a rollback at every step; nothing here
requires touching Capability Gateway, `conversation_message`'s role as
canonical transcript, `RecentCatalogContext`, or `pendingCatalogAction`.

## 2. Harness-semantic mapping

| Harness concept | R3-native equivalent | Where it already exists |
|---|---|---|
| `Agent`/`Session` | Persistent Agent Session | `agent_sessions` row, keyed by `conversation_id` (already 1:1, `UNIQUE KEY uq_agent_sessions_conversation_id`) |
| `session.events` | Durable append-only conversational event stream | `agent_session_events`, already append-only with a real `seq BIGINT UNSIGNED AUTO_INCREMENT` tiebreaker |
| `agent.followup(message)` | Append customer message + continue same logical session | `store.appendEvent({eventType: "USER_MESSAGE_RECEIVED", ...})`, already idempotent via `dedupe_key` |
| `agent.session.deriveMessages()` | Deterministic provider-context derivation | **Does not exist yet** -- the one real gap (Section 7) |
| `AgentRegistry.resume()` | Reload durable session by conversation/session key | **Does not need a Harness-equivalent lifecycle op at all** -- R3 never holds an in-process object between requests (Section 10), so "resume" here is just `loadSessionForConversation` + `loadRecentEvents`, already implemented |
| Token meter | Context-budget accounting | **New, small** -- Section 14 |
| Compaction | Threshold-based historical compression | **New, small** -- Section 14, additive columns on `agent_sessions` |
| Tool-result pruner | Selective historical observation pruning | Largely already solved by existing scoping: `RecentCatalogContext`/`pendingCatalogAction` already prune catalog evidence to bounded windows (Section 9); the persistent session's own tool history only needs a thin classification layer (Section 9) |
| Checkpointing | Durable transactional session progress | **Already the existing behavior** of `appendEvent`'s dedupe-key-guarded `INSERT IGNORE` -- Section 11 explains why no new transaction machinery is needed |

This is the central decision this design commits to, stated once, plainly:
**imitate the shape (identity, append-only log, derive-on-read, bounded
compaction), reuse the substrate that already exists, add only what does
not.**

## 3. Target architecture

Answering the task's own Section C menu directly:

**Chosen: (D) extend an existing structure** -- `agent_sessions` +
`agent_session_events`, not (A) a purely on-the-fly derivation from
`conversation_message` alone (that would discard the idempotent,
correlation-tracked event log this repo already built and proved, `V1.3`
onward), not (B) a brand-new storage engine (ADR-009 already forbids a
second persistence engine, and nothing about this problem needs one), and
not (C) a hybrid that runs a second, parallel event store alongside the
first (that would be exactly the "second source of truth" `agent-session/types.ts:1-11`'s
own docstring already forbids).

```
Meta inbound (conversation_message insert, canonical text -- unchanged)
        |
runNativeAutonomousCycle
        |
   [NEW] ensure/load Persistent Agent Session  <-- agent_sessions (existing table, extended role)
        |                                          agent_session_events (existing table, extended payloads)
   [NEW] deriveMessages()                      <-- new, pure function
        |                                          reads: agent_session_events + conversation_message (join, no duplication)
        |                                          + agent_sessions.compacted_prefix_json (new columns)
   buildNativeCommercialContext (unchanged)    <-- fresh authoritative context, unchanged source
   loadRecentCatalogContext (unchanged)
   loadPendingCatalogAction (unchanged)
        |
   runSalesAgentRuntime -> runAgentToolLoop     <-- unchanged internal per-turn loop semantics (Section 8)
        |
   dispatch (unchanged)
        |
   [NEW] append USER_MESSAGE_RECEIVED (moved earlier) / tool events / ASSISTANT_MESSAGE_SENT
         (existing store.appendEvent, existing dedupe-key pattern)
```

## 4. Ownership model

Kept strictly separate, per the task's own invariant, with the one addition
this design makes explicit:

| Store | Role | Changes here? |
|---|---|---|
| `conversation_message` | Canonical human transcript | **No** -- remains the only place message text is written. This design's read side joins against it; it never duplicates its text. |
| Persistent Agent Session (`agent_sessions`/`agent_session_events`) | Model-reconstructible conversational history | **Extended** -- gains a read side, two additional payload fields, and a compaction cache (Sections 6-7, 14) |
| `agent_session_events` (operational/audit projection) | Same table as above -- this design does not introduce a second, separate audit projection | Already serves this role today (`AgentSessionSummary`/`rebuildSummary`); unchanged |
| `crm_capability_executions` / `commercial_event` | Authoritative execution record | **No** -- referenced, never duplicated (Section 9) |
| Domain stores (`crm_request_facts`, `crm_quotes`, opportunity/shipping tables) | Authoritative business truth | **No** -- `buildNativeCommercialContext` keeps rehydrating these fresh every turn, unchanged (Section 8) |

## 5. Session identity

**`conversation_id -> agent_session_id`, deterministic, already implemented
exactly as this task prefers.** `buildAgentSessionId(conversationId)`
(`agent-session/dedupe.ts:17-19`) is a stable `sha256`-derived id; the table
enforces the relationship at the DB level (`UNIQUE KEY
uq_agent_sessions_conversation_id`, `CONSTRAINT fk_agent_sessions_conversation`).
`wa_id` is never the key -- correct per this task's own explicit preference,
and already true in the existing schema.

| Question | Answer |
|---|---|
| Relation to `conversation_id` | 1:1, permanent, DB-enforced |
| Relation to `opportunity_id` | None, deliberately -- a session outlives any single opportunity; `commercialContextSummary` carries the current `opportunityId` fresh every turn instead (Section 8) |
| Relation to `wa_id` | None -- `conversation_id` is the only key, matching this task's explicit instruction |
| Cardinality | Exactly one active session per conversation, enforced by the existing `UNIQUE KEY` |
| When it's born | `ensureSession()`, already idempotent (lazy-create on first call) -- no explicit provisioning step needed |
| When it ends | `status` already has `active`/`closed` on the row; nothing sets `closed` today. Design choice: mirror the parent `conversation`'s own lifecycle state (close the session when the conversation itself closes/archives) rather than inventing an independent session lifecycle -- **verify the exact `conversation` status transition to hook at implementation time**, not designed further here since it is out of this document's evidence (the `conversation` table's own status machine was not read in this task) |
| More than one session per conversation? | No -- and no evidence found that R3 needs it. Not designed. |
| Lineage/forking | **Explicitly deferred, not designed.** R3 has no multi-branch conversation concept (unlike Harness's fork/seed use case, built for parallel coding-agent exploration); nothing in the four workstreams reviewed for this design implies a future need. Revisit only if a real multi-branch scenario appears. |
| Archival | No deletion -- events accumulate indefinitely, same retention posture as `commercial_event`/`crm_capability_executions` (no TTL/deletion logic found for either in this repo) |

## 6. Event model

**Reuse the existing `AGENT_SESSION_EVENT_TYPES` taxonomy almost entirely
as-is.** A deliberate, evidence-based decision that trims the task's own
candidate list:

- **`USER_MESSAGE_RECEIVED`, `ASSISTANT_MESSAGE_SENT`, `READ_TOOL_REQUESTED`/`COMPLETED`/`FAILED`,
  `COMMERCIAL_ACTION_REQUESTED`/`ACCEPTED`/`REJECTED`/`COMPLETED`/`FAILED`**:
  kept unchanged in name and dedupe-key shape (`agent-session/dedupe.ts`
  already covers every one). Their payloads gain two additive fields
  (Section 7).
- **`TURN_STARTED`/`TURN_COMPLETED`** (candidates in the task brief):
  **deliberately not added as new types.** `USER_MESSAGE_RECEIVED` already
  carries `inboundMessageId` and is already keyed so a repeat append is a
  no-op; moving its append point to *before* `runAgentToolLoop` runs
  (today it is written only in `recordAgentToolLoopSessionShadowEvents`,
  which fires *after* the loop and dispatch complete --
  `shadowRecorder.ts:1-7`) turns it into an exact turn-started marker for
  free. Symmetrically, `ASSISTANT_MESSAGE_SENT` is already written exactly
  once per turn regardless of outcome shape (`outcome: "message" |
  "handoff" | "none"`, `shadowRecorder.ts:138`), so it already is a
  turn-completed marker. Adding two more types that mean the same thing
  would just give a resumed turn two independent ways to ask "did this turn
  start/finish," a duplication this design avoids on the same "no second
  source of truth" principle the rest of `AgentSessionStore` already
  follows.
- **`SESSION_COMPACTED`**: genuinely new -- no existing analog. See Section 14.
- **`SESSION_RESUMED`** (candidate in the task brief): **not added as a
  durable event type.** In this design every turn "resumes" by
  construction (Section 10 -- there is never an in-process object to
  distinguish a fresh session from a resumed one), so a per-turn durable
  event would be redundant with the turn boundary itself. Kept instead as
  an **observability metric only** (Section 19), where it is genuinely
  useful (e.g. counting cold loads of a long event history) without adding
  conversational-log noise.

Per-type definition (only the fields that change from today):

| Type | New payload fields | Provenance | Ordering | Idempotency |
|---|---|---|---|---|
| `USER_MESSAGE_RECEIVED` | *(unchanged: `inboundMessageId`)* -- append point moves earlier (Section 8), shape does not change | `conversation_message.public_id` (referenced, not duplicated) | `occurred_at` + `seq` (existing columns) | `dedupeKey = session:{id}:user_message:{inboundMessageId}` (existing) |
| `ASSISTANT_MESSAGE_SENT` | **+ `outboundMessagePublicId: string \| null`** -- the dispatched `conversation_message.public_id`, null when the turn produced no customer-visible message (handoff/none outcomes) | Set by the dispatch adapter, which already knows this id at write time (`dispatchAgentLoopResponse`/`dispatchSalesAgentResponse`, both already write the outbound row before this shadow call runs) | Same as above | Same dedupe key as today |
| `READ_TOOL_*` / `COMMERCIAL_ACTION_*` | *(unchanged shape: `tool`, `phase`, `governance`, `observationStatus`)* -- already sufficient per Section 9's classification | `crm_capability_executions`/Capability Gateway (referenced, never duplicated) | Same | Same |
| `SESSION_COMPACTED` (new) | `fromSeq: number`, `toSeq: number`, `summaryTokenEstimate: number` | The compaction routine itself (Section 14) | Same | `dedupeKey = session:{id}:compacted:{toSeq}` |

**Provider visibility**: every field above is already screened by the
existing two-layer sanitizer (Section 19) before it can be persisted --
`outboundMessagePublicId` is a UUID-shaped reference id, not PII or
reasoning, and passes both layers unchanged.

**No private chain-of-thought**: unchanged invariant, already enforced by
`sanitizer.ts`'s reuse of `normalizeCommercialEventPayload`, which already
rejects `reasoning`/chain-of-thought/raw-prompt/raw-output-shaped keys.
Nothing in this design adds a reasoning-shaped field.

## 7. deriveMessages contract

New, pure function (no I/O of its own beyond what its inputs already
loaded):

```
deriveMessages(
  compactedPrefix: CompactedPrefix | null,   // agent_sessions.compacted_prefix_json
  recentEvents: AgentSessionEvent[],          // loadRecentEvents(), ascending
  messageTextResolver: (publicId: string) => Promise<string | null>,  // one batched conversation_message lookup
  authoritativeContext: CommercialContextSummary,  // buildNativeCommercialContext output, unchanged
  currentInboundMessage: string
) -> AgentLoopProviderMessage[]
```

Fixed ordering, directly answering the task's Section G/H target shape:

1. **Stable system prefix** -- today's layers 1-2
   (`buildLoopContractLines`/`buildEvidenceAndToolRulesLines`,
   `buildAgentStepPromptPackage.ts:617-620`), unchanged content, emitted as
   its own message so it is byte-identical across every call within a
   deployment (changes only on a code/prompt release, the natural cache
   anchor).
2. **Identity/configuration block** -- today's layers 3-4
   (`renderSalesAgentIdentityPrompt` + `IMMUTABLE_CONFIGURATION_BOUNDARY_LINE`,
   `buildAgentStepPromptPackage.ts:621-622`), its own message, changes only
   when `sales_agent_configurations` republishes (`T02.3A`/`T02.3B`) --
   still far more stable than per-turn.
3. **Compacted historical prefix** -- present only after the first
   compaction fires (Section 14); a single summarized message, stable
   between compactions.
4. **Stable conversational history prefix** -- `deriveMessages` walks
   `recentEvents` in ascending order, resolving `USER_MESSAGE_RECEIVED`/
   `ASSISTANT_MESSAGE_SENT` events to real `{role: "user"|"assistant",
   content}` messages via `messageTextResolver` (a single batched
   `conversation_message` lookup by the collected `public_id`s -- never a
   per-message query). **This is the one change that directly answers
   V1.8-A's central finding**: today's request has zero `role: "assistant"`
   messages anywhere (`V1.8-A section 4`); this design introduces real
   alternating user/assistant turns for the first time, reconstructed from
   the same canonical text `conversation_message` already owns, never a
   duplicate copy.
5. **Fresh authoritative context block** -- `commercialContextSummary`
   (opportunity/needProfile/shipping/lineItems), `RecentCatalogContext`,
   `pendingCatalogAction`: exactly today's fields, unchanged sourcing,
   moved into their **own** message, appended fresh every call. Placed
   *after* the historical prefix and *before* the current turn -- directly
   satisfying Section 8's requirement not to bury mutable truth inside old
   historical messages, and bounding the "always rebuilt, cache-breaking"
   part of the request to this one message instead of the entire payload.
6. **Current inbound message** -- `customerMessage`, unchanged.
7. **Current-turn tool observations** -- `priorStepsThisTurn`, unchanged
   internal shape and semantics (Section 8).

## 8. Authoritative-context injection

No change to *what* is rehydrated fresh every turn (identity, opportunity,
selected products, quantities, destination, shipping selection, quote,
catalog truth) or from where (`buildNativeCommercialContext.ts`,
unchanged, still SQL-backed, still never inferred from session history --
`V1.8-A section 3`'s own finding this design does not touch). What changes
is *where in the message array* it lands: today it is interleaved into the
single `user` JSON blob alongside the message tail, catalog context, and
pending action (`buildAgentStepPromptPackage.ts:625-633`); this design
gives it its own message, positioned as slot 5 above -- late enough that it
never becomes "deep inside old historical messages," early enough that it
still precedes the current turn it must inform.

**Cache impact**: today's single-blob design means every provider call
resends a byte-different payload from the first token, because the mutable
context and the message tail live in the same JSON string
(`V1.8-A section 4`, `V1.8-B/C0 section 10`'s cache-economics finding
applies here directly). Splitting into ordered messages means slots 1-2
(and 3, between compactions) are byte-identical across calls and turns --
a real, stable, cacheable prefix -- and only slots 4 (grows by clean
append, previous bytes never rewritten), 5, 6, 7 change. This is the
concrete mechanism, not a hope: DeepSeek's own cache (per the measured
`V18B-01` evidence already on record) rewards an unchanged prefix; this
design is the first R3-native structure that has one.

## 9. Tool-history policy

| Tool class | Classification | Reasoning |
|---|---|---|
| `search_products` / `get_product_details` / `explore_catalog` / `recommend_catalog_products` | **REFERENCE_ONLY** (via `RecentCatalogContext`, unchanged) | Already fully solved (Section 15) -- the persistent session records only that the tool ran (existing `READ_TOOL_*` shape, tool name + phase), never product data. Re-deriving or duplicating catalog evidence into the session log would create a second, competing source for exactly what `RecentCatalogContext` already owns cleanly. |
| Customer context / knowledge retrieval | **KEEP_REDUCED** (existing shape: tool name + governance + observationStatus, no data) | Enough for the model to recall "I already checked this," never enough to become stale current truth. |
| Shipping calculation / quote read | **KEEP_REDUCED**, same shape | Old shipping/quote figures must never be replayed as current -- `buildNativeCommercialContext`'s fresh authoritative block (Section 8) is the only source of current shipping/quote state, unchanged. The session only remembers *that* the topic was raised, matching the task's own rule ("historical price/stock/shipping/quote data is evidence of what the model saw then, not what is true now"). |
| Action success | **KEEP_REDUCED** -- already captured today (`observationStatus: "completed"`) | No change needed. |
| Action rejection | **KEEP_REDUCED** -- already captured today (`governance !== "authorized"` -> `COMMERCIAL_ACTION_REJECTED`, `observationStatus`/`governance` both in the payload) | This closes part of the gap `V1.8-C0 section 7` flagged (a rejected mutation was never proven to survive turn boundaries) -- the *event* already carries this; what was missing was only the read side (Section 7) to surface it back into context. |
| Transient errors (technical retries) | **PRUNE_EARLY** -- do not persist every internal retry artifact | Matches this task's own instruction (Section I). Only the terminal outcome of a step is durable; `runAgentToolLoop`'s own bounded technical-retry loop stays entirely in-turn, invisible to the session, exactly as today. |
| Never | **NEVER_REINJECT**: raw reasoning/chain-of-thought, raw tool result payloads (prices, stock counts, addresses) | Already structurally impossible -- the sanitizer rejects reasoning-shaped keys, and `KEEP_REDUCED` above never captures `data` in the first place. |

**Rule, restated as designed, not just quoted**: every reduced tool event
answers "did this happen, and how did it resolve" -- never "what exact
number came back." Numbers always come from the fresh authoritative block
(Section 8) or from `RecentCatalogContext` (identity/position only, already
governed by its own rule that forbids price/stock evidence --
`RECENT_CATALOG_CONTEXT_RULE_LINES`, unchanged).

## 10. Resume lifecycle

The most important simplification this design makes relative to the
Harness's own model (`V1.8-C0 section 9`): **R3-native never holds an
in-process `Agent` object to resume in the first place**, so there is no
Harness-shaped `resume()` operation to design. Every turn already starts
from nothing but durable state (`V1.8-A section 2`'s own call graph);
"resuming a session" is just "loading rows that were always going to be
loaded anyway," not a distinct lifecycle transition. This sidesteps
`V1.8-C0`'s Section 9 production-topology blocker entirely, by construction
-- there is no long-lived object whose absence needs compensating for.

```
Meta inbound
  -> resolve conversation (existing)
  -> ensureSession(conversationId)                     [existing: idempotent create-or-load]
  -> ok = check for USER_MESSAGE_RECEIVED with this      [NEW, cheap: one indexed lookup on the
       inboundMessageId already appended?                 existing uq_agent_session_events_dedupe_key]
       -> if yes: duplicate webhook, existing turn
          continuity/idempotency machinery already
          handles this upstream (unchanged)
  -> loadRecentEvents(sessionId) + compacted_prefix_json  [existing + new columns, Section 14]
  -> append USER_MESSAGE_RECEIVED (moved earlier, Section 6) [existing appendEvent, dedupe-guarded]
  -> rehydrate authoritative state (buildNativeCommercialContext, unchanged)
  -> deriveMessages(...)                                  [NEW, Section 7]
  -> run turn (runAgentToolLoop, unchanged internals)
  -> dispatch (unchanged)
  -> append tool events + ASSISTANT_MESSAGE_SENT           [existing appendEvent, extended payload]
  -> (async, non-blocking) maybe trigger compaction         [NEW, Section 14]
```

| Fault | Coverage |
|---|---|
| Process restart | No special handling needed -- next turn just loads rows, as always (see above) |
| Another application instance | Same -- no process affinity anywhere in this design |
| Crash mid-turn | `USER_MESSAGE_RECEIVED` for this `inboundMessageId` is already durable (appended before the loop runs, Section 6); a retry re-derives messages from the same durable state and safely re-runs the turn. No event is left half-written -- each `appendEvent` call is a single atomic `INSERT IGNORE`. |
| Retry after crash | Every event this design appends is dedupe-keyed off `inboundMessageId`/`stepIndex`/`tool`/`requestId` (all pre-existing dedupe builders, `agent-session/dedupe.ts`) -- a retried turn's repeat appends collapse to `status: "duplicate"`, never a second row. |
| Duplicate webhook | Same mechanism as above; also already handled upstream by this repo's existing turn-continuity machinery (`ensureAutonomousSalesTurnContinuity`), unchanged by this design. |
| Outbox failure after cognition completed | Already decoupled today: `ASSISTANT_MESSAGE_SENT` append and outbox dispatch are two independent idempotent writes (`canonicalOutboxWriter`'s own `dedupe_key`), already proven safe under restart by `ACS-R1-05-T07`'s dedicated restart-recovery E2E suite (`docs/ACTIVE_RELEASE.md`, `ACS-R1-05-T07` entry) for the sibling reactive-turn pipeline. This design adds no new coupling between the two. |
| Session write failure | **Real behavior change needed, flagged as a risk (Section 23)**: today, a session-append failure degrades to a silent warning and never blocks the turn (`shadowRecorder.ts`'s own "never throws" contract) because nothing downstream depended on the write succeeding. Once `deriveMessages` depends on this log for conversational continuity, a silently-dropped append becomes a silent context-continuity regression next turn, not a no-op. This needs an explicit decision at implementation time (log-and-degrade-to-legacy-tail vs. hard-fail the turn) -- not resolved here, named as an open risk. |
| Response write failure | Unchanged -- covered by existing outbox retry/dedupe machinery. |

## 11. Transaction / checkpoint model

No distributed transaction is introduced, and none is needed. Each of the
five checkpoints the task asks about maps onto an **already-atomic, already
idempotent** existing write:

| # | Checkpoint | Mechanism | Atomic with the others? |
|---|---|---|---|
| 1 | Inbound accepted | `conversation_message` insert, same transaction as inbound processing (existing, unchanged, upstream of this design entirely) | N/A -- happens before any of this design's logic runs |
| 2 | User message appended | `appendEvent({eventType: "USER_MESSAGE_RECEIVED", ...})`, dedupe-key-guarded `INSERT IGNORE` (existing) | No -- independently idempotent, does not need to be atomic with 1 |
| 3 | Tool/action observation appended | Same `appendEvent` mechanism, per-step dedupe key (existing) | No -- each step's events are independently idempotent |
| 4 | Assistant result finalized | `appendEvent({eventType: "ASSISTANT_MESSAGE_SENT", ...})` (existing, extended payload) | No |
| 5 | Terminal dispatch committed | `canonicalOutboxWriter`'s `INSERT IGNORE` on its own `dedupe_key`, already wrapped with a `FOR UPDATE` re-check of `human_owner_active`/`ai_enabled` in the same transaction as the insert (`SALES-AGENT-R3-V1.5`, `dispatchSalesAgentResponse.ts`) | No -- and deliberately not: `V1.5`'s own design already proved that coupling dispatch to an upstream write here would reintroduce the race it was built to close |

**Why no checkpoint needs to be atomic with another**: every one is already
individually idempotent via a deterministic dedupe key derived from
`inboundMessageId`/`stepIndex`/`tool`/`requestId` -- values that are
identical on any retry of the same logical turn. A crash between any two
checkpoints just means "some of this turn's idempotent writes already
landed; re-running the turn safely re-lands the rest, and skips what's
already there." This is precisely the same reasoning `ACS-R1-05-T07`'s own
restart-recovery suite already validated for the sibling pipeline
(`docs/ACTIVE_RELEASE.md`) -- this design reuses the pattern, not just the
philosophy.

## 12. Concurrency

Two inbound messages for the same conversation arriving near-simultaneously
is the one real new risk this design introduces (today, with no read side,
two concurrent writers to `agent_session_events` cannot corrupt anything a
prompt depends on; once `deriveMessages` reads this log, interleaving
becomes observable).

**Design: reuse `work/sequencing.ts`'s already-proven pattern, do not
invent a new one.** `assignCommercialTriggerSequence`
(`lib/brain/commercial/work/sequencing.ts:82-97`) already implements
exactly the shape this task's own Section M menu describes: a per-conversation
advisory lock (`GET_LOCK('crm-commercial-seq:{conversationId}', 10)`),
inside a transaction, with `FOR UPDATE` + a monotonic counter table, plus
bounded retry on deadlock (`ER_LOCK_DEADLOCK`/`ER_LOCK_WAIT_TIMEOUT`,
max 3 attempts). This design proposes the identical shape, scoped to a new
lock name (`crm-agent-session:{conversationId}`), wrapping the critical
section from "load session + derive messages" through "append this turn's
terminal event" -- so at most one turn per conversation is ever deriving
messages or running the model loop at a time.

**One verification item, not a design gap**: this document did not read
`ensureAutonomousSalesTurnContinuity.ts`'s own internals deeply enough to
confirm whether a per-conversation serialization point already exists
upstream of `runNativeAutonomousCycle` (the existing restart-recovery E2E
suite's "concurrencia real (10 iteraciones)" coverage, cited in
`ACS-R1-05-T07`, suggests some protection already exists for the sibling
reactive pipeline). **Before implementing the lock above, check whether it
would be redundant with an existing upstream guard** -- per this task's own
instruction, no new lock system should be added if the current one
already suffices.

`agent_session_events.seq` itself needs no additional protection: it is a
plain `AUTO_INCREMENT` column, and MariaDB/InnoDB already serializes
concurrent inserts on it correctly without application-level locking --
the advisory lock above is about turn-level atomicity (not appending two
interleaved turns' worth of events out of causal order), not about the
`seq` column's own correctness.

## 13. Cache strategy

Already the substance of Section 7-8; summarized here as the task's own
Section N/13 asks:

**What prevents stable-prefix caching in `buildAgentStepPromptPackage`
today** (`buildAgentStepPromptPackage.ts:625-633`, confirmed by direct
reading in this task): the entire `user` message is one `JSON.stringify`
call over an object that mixes `commercialContext` (mutates every turn),
`recentCatalogContext`/`pendingCatalogAction` (mutate whenever a catalog
tool runs), and `priorStepsThisTurn` (mutates every provider call within a
turn) into a single string. There is no message-level boundary between
what's stable and what's not, so nothing about this payload can ever be a
stable prefix -- not because DeepSeek's cache is limited, but because nothing
in the request shape gives it a stable prefix to find.

**Target request shape** (no implementation, shape only):

```
[
  { role: "system", content: STABLE_LOOP_CONTRACT_AND_TOOL_RULES },      // slot 1 -- stable across turns
  { role: "system", content: IDENTITY_AND_CONFIG },                       // slot 2 -- stable until config republish
  { role: "system", content: COMPACTED_HISTORY_SUMMARY }?,                // slot 3 -- stable between compactions
  ...derivedHistoryMessages,                                              // slot 4 -- append-only, grows
  { role: "user", content: FRESH_AUTHORITATIVE_CONTEXT_JSON },            // slot 5 -- always rebuilt, but small and isolated
  { role: "user", content: currentInboundMessage },                      // slot 6
  ...priorStepsThisTurn                                                  // slot 7 -- in-turn only
]
```

No concrete cache-hit-rate number is asserted here (that would need real
measurement against production traffic, out of scope for a design
document) -- the claim is structural: slots 1-4 are byte-stable or
append-only across calls where today's single blob is not, which is the
same property `V18B-01`'s measured cache-read growth (`V1.8-B section 6`,
`V1.8-C0 section 10`) was observed to depend on.

## 14. Compaction design

Interface only, no concrete thresholds chosen (none of the evidence
gathered in `V1.8-A`/`V1.8-B`/`V1.8-C0` supports picking a specific number
-- the Harness's own compaction was never observed firing in 41 real turns
across two audits, `V1.8-C0 section 11`, so there is no empirical basis for
a threshold yet).

```
SessionContextBudget {
  maxRecentEvents: number       // start from the existing precedent:
                                 // AGENT_SESSION_DEFAULT_MAX_RECENT_EVENTS = 20
                                 // (agent-session/store.ts:22) -- do not invent
                                 // a new default where a proven one exists
  maxHistoryTokensEstimate: number | null   // null = no compaction yet; a number
                                             // triggers CompactionPolicy below
}

CompactionPolicy {
  shouldCompact(budget, currentEventCount, estimatedTokens) -> boolean
  compact(events: AgentSessionEvent[]) -> { summary: CompactedPrefix, throughSeq: number }
}

ToolObservationPruner {
  // Not a new component -- Section 9's KEEP_REDUCED/REFERENCE_ONLY/PRUNE_EARLY
  // classification already IS this policy, applied at write time (the
  // reduced shape is chosen when the event is appended, not pruned later).
  // No additional pruning stage is designed on top of it.
}
```

**Storage: three new nullable columns on `agent_sessions`** (additive
migration, not created in this task), deliberately *not* reusing
`summary_json`/`summary_version` -- those already have a real, narrower,
unrelated job (`AgentSessionSummary`'s tool-activity/goal projection,
Section 15) that this design does not want to overload, per this task's own
warning against forcing an existing contract into a role it wasn't scoped
for:

```
compacted_prefix_json JSON NULL
compacted_through_seq BIGINT UNSIGNED NULL
compacted_prefix_updated_at DATETIME(3) NULL
```

**What compaction must preserve** (per the task's own list): key
conversation commitments, product references still likely relevant,
unresolved questions, recent decisions, provenance/source ranges (the
`fromSeq`/`toSeq` range is the provenance -- literal, not descriptive).
**What it must never preserve as authoritative**: any price/stock/shipping
figure -- unchanged from Section 9's rule, since compaction only ever
summarizes what the *session log* (already reduced, never raw commercial
data) contains.

## 15. Relationship with existing stores

### `AgentSessionStore` / `agent_sessions` / `agent_session_events`

**Verdict: `EXTEND_AS_SESSION_METADATA`.** Not `KEEP_AS_AUDIT_PROJECTION`
(this design gives it a read side and a new consumer, which is more than
"audit"), not `MERGE_WITH_NEW_SESSION` (there is no new session store to
merge with -- this design does not create one), not `DEPRECATE`/`REPLACE`
(nothing about it is wrong; it is under-used, not misdesigned). Its own
docstring's boundary -- "never a second source of truth for
identity/customer profile/selected products/shipping/quote/order/follow-up
schedule... a session may record that something was discussed or that an
action occurred" (`agent-session/types.ts:1-11`) -- is **not violated** by
this extension: message-text references and reduced tool outcomes are
still "that something was discussed/occurred," never a business-truth
value. This design is explicitly not forcing the store into a role its
contract forbids; it is finishing the role its contract already describes.

### `conversation_message`

**Verdict: hybrid -- reference by id, materialize text at `deriveMessages()`
read time (Section 7).** Compared against the task's own four options:

| Approach | Correctness | Latency | Query cost | Reconstructibility | Cache stability | Duplication | Migration complexity |
|---|---|---|---|---|---|---|---|
| 1. Duplicate text into session events | Risk of drift if a message were ever edited/redacted post-hoc (not currently possible, but a second copy makes it a real question) | Best (no join) | None extra | Trivial | Same as chosen approach | **High** -- exact duplicate of canonical text, the thing `agent-session/types.ts`'s own docstring already argues against | Low |
| 2. Reference ids only, no materialization | N/A | N/A | N/A | **Impossible** -- `deriveMessages` would have nothing to put in `content` | N/A | None | N/A -- incomplete, not a real option |
| 3. Reference ids, materialize at read time (**chosen**) | Always current with the canonical store (there is only one) | One extra batched query per turn (all ids collected, one `IN (...)` lookup) | Low -- indexed by `public_id` (existing `UNIQUE KEY uq_conversation_message_public_id`) | Full -- by construction | Unaffected -- the resolved text is still byte-stable turn to turn once compacted/appended | **None** | Low -- no schema change to `conversation_message`, only new columns elsewhere |
| 4. Hybrid (duplicate a truncated snippet, reference for full text) | Adds a second, partial copy with its own truncation-correctness question | Marginal latency win only for the truncated case | Marginal | Full, with an extra code path | Same as chosen | Some | Medium -- two representations to keep consistent |

Option 3 wins on every axis that matters here except a marginal, one-query
latency cost this design accepts deliberately -- it is the only option that
adds zero duplication of the one thing this repo has been careful, across
three prior audits, never to duplicate.

### `RecentCatalogContext` / `pendingCatalogAction`

**Verdict: `KEEP`, unchanged, per this task's own default.** Distinct,
already-proven responsibilities, confirmed by direct reading in this task
(Sections 9 above): `RecentCatalogContext` is structured product-reference
continuity (identity/position, never price/stock), `pendingCatalogAction`
is a single structured unresolved-offer flag, and the persistent session is
general conversational continuity (raw message history + reduced tool
outcomes). No evidence gathered in this design process suggests either
becomes redundant -- if anything, Section 9 shows the persistent session
deliberately *defers* to both rather than re-deriving what they already
solve.

## 16. Migration plan

Additive, seven slices, each independently revertible by disabling its own
flag/skipping its own read -- no slice requires a prior slice's rollback to
also roll back.

| Slice | Scope | Rollback |
|---|---|---|
| **D1** | Data contracts + persistence: add the three new `agent_sessions` columns (Section 14), add `SESSION_COMPACTED` to the event-type enum, add `outboundMessagePublicId` to `ASSISTANT_MESSAGE_SENT`'s payload shape. No behavior change -- pure additive schema + type. | Drop the new columns; nothing reads them yet. |
| **D2** | Session reconstruction: move `USER_MESSAGE_RECEIVED`'s append point earlier (before `runAgentToolLoop`, Section 6), start populating `outboundMessagePublicId`. Still shadow-only -- nothing reads any of this into a prompt yet. | Revert the two call-site changes; `AgentSessionStore`'s existing consumers are unaffected (nothing outside this design reads these fields). |
| **D3** | `deriveMessages()` implemented and unit-tested against real session data, **not yet wired into `buildAgentStepPromptPackage`**. Pure function, no production call site. | Delete the new module; zero production impact, since nothing calls it. |
| **D4** | Runtime shadow mode: call `deriveMessages()` alongside the existing prompt builder on every real turn, log/compare its output, **never send it to the provider**. Validates real-traffic behavior (message resolution, ordering, cache-prefix stability) with zero customer-facing risk. | Remove the shadow call; behavior is unaffected since its output was never used. |
| **D5** | Session-driven context under owner allowlist: wire `deriveMessages()`'s output into the actual provider call, gated by the same allowlist pattern every other R3 pilot slice already uses (`BRAIN_SALES_AGENT_RUNTIME_WA_IDS`-shaped flag, new name TBD at implementation time) -- zero general traffic. | Flip the flag off; falls back to today's `buildAgentStepPromptPackage` behavior, unchanged and still present in the codebase (not deleted until D6 proves it redundant). |
| **D6** | Remove the last-5-message-tail dependency (`buildMinimalCommercialContextSummary`'s `recentMessages.slice(-5)`, `V1.8-A section 4`) **only after** D5's allowlisted traffic proves the session-derived history is a strict improvement -- not before, and not assumed here. | Restore the slice; D5's flag already provides the fallback path in the interim. |
| **D7** | Compaction (Section 14) -- added last, deliberately, since no real conversation observed in any audit to date has been long enough to need it (`V1.8-C0 section 11`). Implement only once real D5/D6 traffic shows event counts approaching `AGENT_SESSION_DEFAULT_MAX_RECENT_EVENTS`. | Compaction columns stay `NULL`; `deriveMessages` already handles the "no compacted prefix yet" case as its normal path (Section 7), so this is not a special rollback, just an unreached state. |

No big-bang replacement at any slice -- `buildAgentStepPromptPackage`'s
current behavior remains the production default through D4, and the
fallback through D5/D6.

## 17. Backfill strategy

**No expensive global backfill.** Two existing properties already do most
of the work:

1. `ensureSession()` is already lazy and idempotent (`store.ts:28`) -- a
   conversation that predates this design simply gets its `agent_sessions`
   row created on its first post-D2 turn, with an empty event log. No
   migration script needed for session identity itself.
2. For the *content* gap (a pre-existing conversation has no session events
   for its history), design a **bounded, deterministic bootstrap
   compaction**: on the first `deriveMessages()` call for a session with
   fewer than some small number of native events, synthesize a one-time
   `compacted_prefix_json` directly from `conversation_message`'s own last
   `COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES` rows (reusing the exact
   existing constant and precedent, `constants.ts:2`, rather than inventing
   a new bound) and mark it with a distinct provenance tag (e.g.
   `source: "bootstrap"` inside `compacted_prefix_json`) so it is
   distinguishable later from a real compaction event. This gives every
   pre-existing conversation a reasonable starting context on its very next
   turn, at the cost of one extra read on that one turn only -- never a
   background job, never a full-history replay.

## 18. Test strategy (for the implementation phase, not run here)

Every scenario the task lists maps onto a specific layer this design
introduces, asserting the invariant named, not exact model wording (per the
task's own instruction):

| Case | Exercises | Invariant asserted |
|---|---|---|
| C01 carry-forward | `deriveMessages` history slot (4) | A prior turn's specific product reference is present as a real `role:"assistant"` message, not just buried in a JSON tail |
| C02 topic switch | Same | The model is free to switch; the session does not force or block it (no state machine exists to block it) |
| C03 return-to-topic | Same + compaction boundary (once D7 lands) | Old topic survives an intervening unrelated turn without re-fetching |
| C04 ordinal reference | `pendingCatalogAction`/`RecentCatalogContext`, unchanged (Section 15) | Confirms this design did not regress the existing, already-proven mechanism |
| C05 superseding | Fresh authoritative context slot (5) | A newer fact always wins over anything in the historical prefix -- the ordering in Section 7 is what's under test |
| C06 contradiction (stale vs. fresh) | Same | Historical price != current catalog price never gets treated as current; slot 5 always wins by construction, not by model instruction alone |
| C07 process resume | Section 10's whole design | Destroying and recreating the runtime process changes nothing about the next turn's derived messages -- proves there was never a stateful object to lose |
| C08 duplicate inbound | Section 10's dedupe-key check | A redelivered webhook produces zero duplicate session events and zero duplicate assistant turns |
| C09 concurrent inbound ordering | Section 12's lock | Two near-simultaneous inbounds for one conversation never interleave into a corrupted derived-message order |
| C10 tool rejection survives correctly | Section 9's `COMMERCIAL_ACTION_REJECTED` handling | A denied mutation is recallable by the model next turn without ever being presented as if it succeeded |
| C11 assistant message persistence | `outboundMessagePublicId` (Section 6) | Every dispatched customer-visible message is resolvable back into a real `role:"assistant"` message on the next turn |
| C12 long-history fixture | `AGENT_SESSION_HARD_MAX_RECENT_EVENTS` boundary (existing constant, `store.ts:23`) | `loadRecentEvents` bounding behaves correctly at real scale (180+ turns, per the `V1.8-A` incident) |
| C13 compaction-ready fixture | Section 14, D7 | A long fixture correctly triggers compaction and the compacted prefix still satisfies C01-C03 |
| C14 rollback to legacy current-context path | D5's flag (Section 16) | Flipping the flag off reproduces today's exact behavior, byte for byte, proving the fallback is real, not aspirational |

## 19. Observability

New metrics/events, none carrying reasoning or message text:

```
session_created           (conversationId, sessionId)
session_event_appended     (sessionId, eventType, dedupeOutcome: "created"|"duplicate")
session_context_derived    (sessionId, historyMessageCount, hasCompactedPrefix: boolean)
session_context_tokens     (sessionId, estimatedTokens)          // estimate only, no provider round trip
session_compaction_triggered (sessionId, fromSeq, toSeq)
session_compacted          (sessionId, fromSeq, toSeq, summaryTokenEstimate)
session_resumed            (sessionId, eventCountLoaded)          // metric only, per Section 6 -- not a durable agent_session_events row
session_resume_failed      (sessionId, reason)                    // metric only, same reasoning
session_sequence_conflict  (conversationId, detail)               // fires from the Section 12 lock path
```

**Provider cache metrics**: `AgentLoopProviderResponse`
(`agent-loop/agentLoopProviderTypes.ts:23-39`) does not currently expose
cache-token counts (only `inputTokens`/`outputTokens`/`reasoningTokens`).
**Verification item for implementation, not designed further here**: check
whether DeepSeek's raw HTTP response (already parsed by
`httpAgentLoopProvider.ts`) carries a cache-hit token field the way the
Harness's own `usage` object did (`cacheReadTokens`, measured directly in
`V1.8-B`/`V1.8-C0`) -- if so, add `cacheReadTokens?: number | null` /
`freshInputTokens?: number | null` to the existing response type (additive,
optional fields, same pattern already used for `reasoningTokens`). Not
fabricated here since this task did not read `httpAgentLoopProvider.ts`'s
raw response-parsing code closely enough to confirm the field exists.

**No private reasoning logged**, unchanged invariant from Section 6/9.

## 20. Security / privacy

Unchanged boundary, re-verified against every new field this design adds:

- **Chain-of-thought**: never added to any new field (Section 6/9's
  `KEEP_REDUCED` shapes carry only tool names, statuses, and reference
  ids). The existing sanitizer's reasoning-shaped-key rejection
  (`sanitizer.ts`, reusing `normalizeCommercialEventPayload`) already
  covers this without any change.
- **Secrets / raw auth tokens**: same layer-1 rejection, unchanged, already
  covers any key containing `token` as a substring -- a real, existing
  constraint this design's own new field names were checked against
  (`outboundMessagePublicId`, `fromSeq`, `toSeq`, `summaryTokenEstimate` --
  none collide with the forbidden pattern; `summaryTokenEstimate` was
  deliberately checked and does not match `\btoken\b`-adjacent forbidden
  keys used elsewhere in this codebase's naming convention discipline,
  `sanitizer.ts:24`, but **this should be re-verified against the literal
  regex in `events/normalize.ts` at implementation time**, not assumed from
  this document's reading of the comment alone).
- **PII in tool results**: `KEEP_REDUCED`'s own definition (Section 9)
  already excludes `data` from every persisted tool event -- if a
  capability's result ever carried customer PII (it should not, per
  existing Capability Gateway summary-redaction conventions,
  `capability-gateway/types.ts:124-133`), this design never touches it,
  since it never captures tool `data` at all.
- **Redaction boundary**: defined by construction, not by a filter applied
  after the fact -- every new field this design adds is a reference id, a
  status enum, or a numeric estimate, never free text or a raw payload.

## 21. Component disposition

| Component | Disposition | Reason |
|---|---|---|
| `SalesAgentRuntime` | **ADAPT** | Gains the "resolve/derive session, then call the loop" orchestration step around its existing call to `runAgentToolLoop` (Section 10) |
| `runAgentToolLoop` | **UNCHANGED** (internals) | `priorSteps` semantics, in-turn tool loop, termination logic all stay exactly as today (Section 8) -- only its *input* messages come from a new source |
| `buildAgentStepPromptPackage` | **ADAPT** | Its six-layer system-prompt construction is reused verbatim (Section 7, slots 1-2); its single-blob `user` message construction is replaced by `deriveMessages`'s multi-slot output |
| `httpAgentLoopProvider` | **EXTEND** (optional) | Only if Section 19's cache-metric verification finds a field worth surfacing; otherwise unchanged |
| `conversation_message` | **UNCHANGED** | Remains sole canonical transcript; referenced, never duplicated (Section 15) |
| `AgentSessionStore` | **EXTEND** | Gains a read side and two new payload fields; interface (`ensureSession`/`appendEvent`/`loadRecentEvents`/`loadSummary`/`rebuildSummary`) is otherwise reused unchanged (Section 15) |
| `agent_sessions` | **EXTEND** | Three new nullable columns (Section 14); existing columns/constraints untouched |
| `agent_session_events` | **EXTEND** | One new event type (`SESSION_COMPACTED`); existing schema, dedupe, and ordering columns untouched |
| `RecentCatalogContext` | **UNCHANGED** | Section 15 |
| `pendingCatalogAction` | **UNCHANGED** | Section 15 |
| `crm_capability_executions` | **UNCHANGED** | Referenced by `RecentCatalogContext` exactly as today; this design adds no new reader or writer |
| `commercial_event` | **UNCHANGED** | `agent_tool_loop_completed` keeps feeding `RecentCatalogContext`/`pendingCatalogAction` exactly as today |
| `Capability Gateway` | **UNCHANGED** | Not touched by this design at any layer, per this task's own non-goals |
| `conversation_sequence` (`work/sequencing.ts`) | **UNCHANGED, reused as a pattern** | Its `GET_LOCK`+`FOR UPDATE`+counter shape is copied conceptually for Section 12's lock, not imported or modified |

## 22. Implementation slices

Restates Section 16 as an ordered backlog (design-level, no estimates
beyond directional sizing, no story points):

1. **D1** -- schema/type additions (small, mechanical)
2. **D2** -- re-time existing append calls, add one new field (small)
3. **D3** -- `deriveMessages()` + unit tests (medium -- the one genuinely
   new piece of logic in this whole design)
4. **D4** -- shadow-mode wiring + comparison logging (small)
5. **D5** -- allowlisted live cutover (medium -- mostly wiring, some real
   risk since it is the first slice that touches the real provider call)
6. **D6** -- legacy-tail removal (small, gated on D5 evidence)
7. **D7** -- compaction (medium, deferred until real conversation length
   data justifies it, per Section 14)

## 23. Risks

- **Session-write-failure semantics must change** (Section 10): today's
  "never block the turn, degrade to a warning" posture was correct when
  nothing downstream read the log; once `deriveMessages` depends on it,
  this needs an explicit decision (not made in this design) about whether a
  failed append should fail the turn, degrade to the legacy tail for that
  one turn, or something else.
- **Concurrency lock reuse needs verification, not assumption** (Section
  12): this design proposes reusing `work/sequencing.ts`'s pattern but did
  not confirm whether an equivalent guard already exists upstream in
  `ensureAutonomousSalesTurnContinuity` -- adding a redundant lock is a
  correctness-neutral but unnecessary-complexity risk if one already
  exists.
- **Compaction thresholds are genuinely unknown** (Section 14): no audit to
  date has observed a real conversation long enough to need compaction;
  D7's design is an interface, not a tuned policy, and picking numbers too
  early risks tuning against a sample size of zero.
- **Cache-metric surfacing depends on an unverified field** (Section 19):
  if DeepSeek's raw response does not expose a cache-hit token count the
  way the Harness's `usage` object did, part of Section 19's observability
  plan is moot -- this should be confirmed early in D3/D4, not assumed.
- **`conversation`'s own close/archive lifecycle was not read in this
  task** (Section 5): the session-close design point is stated as "mirror
  the conversation's lifecycle" without having verified what that lifecycle
  actually is -- a real gap to close before D1, not a blocker to writing
  this design.
- **`messageTextResolver`'s batched lookup shape is unspecified beyond
  "one query"** -- if a session's recent-event window spans an unusually
  large number of distinct `conversation_message` rows, the `IN (...)`
  lookup's own size needs a bound; `AGENT_SESSION_HARD_MAX_RECENT_EVENTS =
  100` (existing constant) already caps this indirectly, but this was not
  independently verified against a worst-case query-plan check.

## 24. Explicit non-goals

Confirmed against the task's own instruction, matching the discipline
`V1.8-A`/`V1.8-B`/`V1.8-C0` already established for this workstream:

- No `activeIntent`/`currentTopic`/`conversationStage`/`nextExpectedStep`
  field anywhere in this design. Continuity comes entirely from the
  historical message prefix (Section 7) plus the model's own reasoning --
  exactly the property `V18B-01`'s live evidence already demonstrated
  works, per `V1.8-B`/`V1.8-C0`.
- No workflow engine, no deterministic semantic state machine. The lock in
  Section 12 governs write ordering only, never conversational logic.
- No mandatory natural-language constraints -- every new prompt slot
  (Section 7) is additive context, never an instruction that narrows what
  the model may say.
- No implementation in this task: no migration file created, no `.ts`
  module written, no flag added, no test added. This document is the
  design artifact only.
- No change to Capability Gateway, business/domain stores, `conversation_message`'s
  writer, or any auth/routing/API surface -- confirmed against every
  section above.

## Files inspected

`lib/brain/commercial/agent-session/types.ts`, `store.ts`,
`mariaDbAgentSessionStore.ts`, `sanitizer.ts`, `summary.ts`, `dedupe.ts`,
`shadowRecorder.ts`; `migrations/033_agent_sessions.sql`,
`migrations/008_conversation_ai_runtime_core.sql` (`conversation_message`
schema), `migrations/022_crm_capability_executions.sql`;
`lib/brain/commercial/work/sequencing.ts`;
`lib/brain/commercial/capability-gateway/types.ts`;
`lib/brain/commercial/agent-loop/recentCatalogContext.ts`,
`pendingCatalogAction.ts`, `buildAgentStepPromptPackage.ts` (lines
590-641), `runAgentToolLoop.ts` (structural grep only -- function/const
anchors, not a full read); `docs/releases/SALES-AGENT-R3-V1.8-A-CONVERSATIONAL-CONTEXT-INPUT-AUDIT.md`,
`docs/releases/SALES-AGENT-R3-V1.8-B-HARNESS-NATIVE-SESSION-CONTINUITY-AUDIT.md`,
`docs/releases/SALES-AGENT-R3-V1.8-C0-HARNESS-PRODUCTION-ADOPTION-REEVALUATION.md`,
`docs/ACTIVE_RELEASE.md` (`ACS-R1-05-T07`, `SALES-AGENT-R3-V1.5` entries,
cited for existing checkpoint/restart-recovery precedent).

## Files changed

New:
- `docs/releases/SALES-AGENT-R3-V1.8-C-NATIVE-PERSISTENT-AGENT-SESSION-MEMORY-DESIGN.md` (this file)

No other file was created or modified by this task. No migration, `.ts`
module, flag, or test was written. `docs/ACTIVE_RELEASE.md` is updated
separately in the same change, per the standing workflow rule.

## Verdict

**`R3_NATIVE_PERSISTENT_SESSION_DESIGN_READY`**

- Selected persistence architecture: extend `agent_sessions`/`agent_session_events`
  (Option D), not a new store.
- Selected transcript/session relationship: reference `conversation_message`
  ids, materialize text at `deriveMessages()` read time -- zero duplication.
- `deriveMessages` strategy: seven ordered slots (stable system, identity,
  compacted prefix, append-only history, fresh authoritative context,
  current turn, in-turn tool observations) -- Section 7.
- Resume strategy: none needed as a distinct operation -- every turn
  already reloads from durable state by construction (Section 10).
- Checkpoint strategy: five existing/extended idempotent, independently
  atomic writes -- no distributed transaction (Section 11).
- Concurrency strategy: reuse `work/sequencing.ts`'s `GET_LOCK` pattern,
  pending verification against a possible existing upstream guard (Section
  12).
- Cache strategy: message-array slot separation replacing today's single
  mutable JSON blob (Section 7/13).
- Compaction boundary: interface only, no thresholds chosen, deferred to
  D7 pending real conversation-length evidence (Section 14).
- Migration slices: D1-D7, additive, independently revertible (Section
  16/22).
- Components deprecated: none. Components kept unchanged: `RecentCatalogContext`,
  `pendingCatalogAction`, `conversation_message`, Capability Gateway,
  `runAgentToolLoop` internals.
- Risks: five named, none blocking (Section 23).
- Document path: `docs/releases/SALES-AGENT-R3-V1.8-C-NATIVE-PERSISTENT-AGENT-SESSION-MEMORY-DESIGN.md`.

Does not advance to implementation. Next actionable item is `D1` (schema/type
additions) as its own, separately-scoped release task.
