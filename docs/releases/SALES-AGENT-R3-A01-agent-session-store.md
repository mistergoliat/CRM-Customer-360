# SALES-AGENT-R3-A01 -- Agent Session Store

Status: implemented, additive/shadow, real-database verified. No production
routing, model decision, CommercialWork behavior, or WhatsApp response
changed. `BRAIN_AGENT_TOOL_LOOP_ENABLED` and every other existing flag are
untouched. No release was opened. `migrations/033_agent_sessions.sql` was
applied to `crm_test` and every guarantee this document claims was verified
against a real, running MariaDB in a follow-up pass within this same task
(see "Real-database verification" below) - this is not the original,
DB-unreachable pass; that limitation was closed, not worked around.

This is R3-A01 from `docs/architecture/SALES-AGENT-R3-A00-target-architecture.md`'s
migration plan: the `AgentSessionStore` spike, built behind the existing
Agent Tool Loop as a shadow recorder, plus the identity-gate parity
verification A00 flagged as the one open question blocking everything after
it.

## Phase 1 -- Audit findings

Read live code first, not just A00's prose summary. Findings that changed or
sharpened A00's claims:

- **`commercial_event` (migration 011) cannot cleanly double as the session
  event log.** Its writer (`events/repository.ts#insertCommercialEventOnConnection`)
  and dedupe (`UNIQUE KEY uq_commercial_event_dedupe_key`) pattern is sound
  and worth mirroring - but `event_type` is a closed TypeScript union
  (`CommercialEventType`, `events/types.ts`) already serving ~15 unrelated
  audit concerns (identity resolution, onboarding transitions, follow-up
  timers, ATL/R2 turn completion...), and the table has no session-grouping
  column at all. Widening that enum and adding a nullable `session_id`
  column to satisfy a new, ordered, per-session read pattern would widen the
  blast radius of an already-loaded shared table for what this task must
  stay: a narrow, additive slice. **Decision: two new tables**
  (`agent_sessions`, `agent_session_events`, `migrations/033_agent_sessions.sql`),
  same MariaDB engine, same `lib/db.ts` pool - not a second persistence
  engine, per `ADR-009`. The dedupe/correlation/causation/sanitizer *pattern*
  is reused directly (see below), just not the table.
- **The sanitizer is directly reusable, and was reused, not reimplemented.**
  `events/normalize.ts#normalizeCommercialEventPayload` (`assertPlainSerializable`
  under the hood) already does exactly what Phase 5 of the task brief asks
  for: a recursive, fail-closed walk that throws on a forbidden key at any
  depth, including inside arrays. `lib/brain/commercial/agent-session/sanitizer.ts`
  calls it directly. It was **strengthened, additively**: `SENSITIVE_KEY_PATTERN`
  gained `reasoning[-_]?(content|text)`, `chain[-_]?of[-_]?thought`,
  `thinking`, `raw[-_]?(output|prompt)`, `prompt` - every existing
  `commercial_event` payload shape (`events/types.ts`) was checked against
  these additions and none collide; this only makes rejection stricter for
  every existing caller, never looser.
- **`RuntimeIdentityContext`/`CustomerSessionDecisionContext`'s PII boundary
  is real but is enforced by construction discipline (allowlisted field
  picking, a distinct type with no PII field to put a leak into), not an
  automated check** (`native-cycle/customer-session/types.ts`, confirmed by
  direct read, matching A00's finding). This is why `agent-session/sanitizer.ts`
  adds its own second layer (a PII-shaped-key blocklist) rather than
  assuming the shared boundary alone is enough once a NEW module starts
  constructing payloads by hand.
- **`conversationId` is a real, stable `BIGINT UNSIGNED` primary key**
  (`migrations/008_conversation_ai_runtime_core.sql`), with `conversation.id`
  already the anchor `crm_capability_executions`/`commercial_event` use. A
  session's identity is minted deterministically from it
  (`buildAgentSessionId`), so `ensureSession` is idempotent without a
  read-before-write race, and a `UNIQUE KEY` on `conversation_id` enforces
  the 1:1 invariant at the database level, not just in application code.
- **`resetPoolForTests()` (`lib/db.ts`) is the established mechanism for
  simulating a process restart within one test run** (already used by
  `ACS-R1-05-T07`'s restart-recovery tests) - `agentSessionStoreMariaDb.test.ts`
  uses it the same way.
- **The `ai_agent_execution`/`ai_agent_decision`/`ai_tool_execution`/`ai_conversation_state`
  tables `ADR-002` describes DO exist** (`migrations/008_conversation_ai_runtime_core.sql`)
  - a correction to `SALES-AGENT-R3-A00`'s Phase 1 table, which said they were
  "not observed." They exist as schema, but `rg -l` across the whole repo
  shows only `lib/brain/local-ai-sdr/**` (an older, separate module) and one
  bootstrap smoke script ever write to them - the current native/commercial
  runtime (`agent-loop/`, `native-cycle/`, `capability-gateway/`, `work/`)
  never touches them. A00's substantive conclusion (these tables are
  dormant relative to the live path, `commercial_event`/`crm_capability_executions`/
  `crm_agent_decisions` serve that role in practice) was correct; only the
  literal "not observed" wording was too strong. See "Update to A00" below.
- **Identity-gate parity: see Phase 12 below** - a real, code-confirmed gap
  was found, not the "must be verified" open question A00 left it as.

## Phase 2 -- Session identity

One `AgentSession` per `conversation`, enforced at the database level:
`agent_sessions.conversation_id` carries `UNIQUE KEY uq_agent_sessions_conversation_id`
plus `FOREIGN KEY ... REFERENCES conversation(id) ON DELETE CASCADE`.

`AgentSessionId` (`agsess_<sha256(conversationId)[:32]>`, `dedupe.ts#buildAgentSessionId`)
is:

- **Provider-neutral** - no DeepSeek, no external Harness package, no model
  name anywhere in its construction or the schema.
- **Not `CommercialWork.publicId`** - a session is not owned by, or scoped
  to, any single commercial transaction. `agent_sessions` has no foreign key
  to `crm_commercial_work` at all.
- **Deterministic** - `ensureSession({conversationId})` called twice for the
  same conversation always resolves to the same id, so it is idempotent
  without a read-before-write race (`mariaDbAgentSessionStore.ts#ensureSession`
  uses `INSERT IGNORE` plus a re-select, exactly mirroring `events/repository.ts`'s
  proven pattern).

A session outlives any single `CommercialWork` instance, any single follow-up,
any single turn - closing/completing a transaction never touches
`agent_sessions.status`. Nothing in this slice ties conversation lifetime to
transaction lifetime; that separation was true before this task (a
conversation and an opportunity are already independent entities per
`docs/product/autonomous-commerce-state-model.md`) and this slice does not
narrow it.

## Phase 3 -- `AgentSessionStore` contract

`lib/brain/commercial/agent-session/store.ts`:

```ts
interface AgentSessionStore {
  ensureSession(input: EnsureSessionInput): Promise<AgentSession>;
  appendEvent(input: AppendEventInput): Promise<AppendEventResult>;
  loadSession(sessionId: string): Promise<AgentSession | null>;
  loadSessionForConversation(conversationId: number): Promise<AgentSession | null>;
  loadRecentEvents(input: LoadRecentEventsInput): Promise<AgentSessionEvent[]>;
  loadSummary(sessionId: string): Promise<AgentSessionSummary | null>;
  rebuildSummary(sessionId: string): Promise<AgentSessionSummary>;
}
```

No `Pool`/`PoolConnection`/SQL crosses this boundary. Two implementations:
`mariaDbAgentSessionStore.ts` (real, production) and `inMemoryAgentSessionStore.ts`
(test double, mirrors the real implementation's dedupe/ordering/CAS semantics
closely enough that logic-level tests against it exercise real interface
behavior - never a second production persistence engine, same pattern this
repo already uses for exactly this purpose, e.g. `agent-loop/providers/fakeAgentLoopProvider.ts`).
`appendEvents` (plural, from the task brief's illustrative shape) was
deliberately not added: every real caller in this slice appends one event at
a time, and a batch variant with no caller would be exactly the kind of
speculative surface this repo's own conventions avoid.

## Phase 4 -- Event taxonomy

`lib/brain/commercial/agent-session/types.ts#AGENT_SESSION_EVENT_TYPES`. All
fifteen candidate names from the task brief were kept (no better canonical
vocabulary was found), but **not all are emitted yet**:

| Event type | Emitted by A01's shadow recorder? |
|---|---|
| `USER_MESSAGE_RECEIVED` | Yes - once per turn |
| `ASSISTANT_MESSAGE_SENT` | Yes - once per turn (payload distinguishes message/handoff/none via `outcome`) |
| `READ_TOOL_REQUESTED` / `READ_TOOL_COMPLETED` / `READ_TOOL_FAILED` | Yes - derived from `AgentToolLoopStepSummary` |
| `COMMERCIAL_ACTION_REQUESTED` / `_COMPLETED` / `_FAILED` / `_REJECTED` | Yes - derived the same way, for the four mutating ATL tools |
| `COMMERCIAL_ACTION_ACCEPTED` | Reserved - no `CommercialActionRequest` boundary exists in code yet (R3-A03) |
| `GOAL_UPDATED` | Reserved - no goal-tracking source exists in the runtime yet |
| `FOLLOWUP_SCHEDULED` / `_CANCELLED` / `_WAKE` | Reserved - no live integration point wired in A01 (see "Known limitations") |
| `SESSION_SUMMARY_UPDATED` | Reserved - the projector explicitly skips it if present, to avoid a self-referential loop; not currently appended |

Every event carries `eventId, sessionId, conversationId, eventType,
correlationId, causationId, dedupeKey, payload (sanitized), occurredAt,
createdAt` - the task brief's minimum field list, `metadata` deliberately
folded into `payload` rather than kept as a separate JSON column (unlike
`commercial_event`): nothing in this slice needed the two-field split, and
adding an unused column would be exactly the kind of speculative structure
this repo's conventions avoid.

**Content boundary, stated explicitly because it is not obvious from the
name alone**: neither `USER_MESSAGE_RECEIVED` nor `ASSISTANT_MESSAGE_SENT`
carries message text. `conversation_message` remains the sole canonical
timeline (Phase 3 of `SALES-AGENT-R3-A00`). The session only records that a
turn happened, correlated by `inboundMessageId` - a future Harness that
needs the actual text joins back to `conversation_message` for it.

## Phase 5 -- No chain-of-thought / secret persistence

Two layers, both fail-closed (`agent-session/sanitizer.ts`):

1. **Reused, strengthened `events/normalize.ts` sanitizer.** Rejects any key
   matching `authorization|api[-_]?key|token|secret|password|cookie|header|webhook`
   (pre-existing) plus the new `reasoning[-_]?(content|text)|chain[-_]?of[-_]?thought|thinking|raw[-_]?(output|prompt)|prompt`
   (added this task, additive only).
2. **A local PII-shaped-key layer** (`AGENT_SESSION_PII_KEY_PATTERN`),
   deliberately NOT merged into the shared pattern above - `phone`/`email`
   are legitimate field names in other, already-reviewed `commercial_event`
   payload shapes elsewhere in this codebase, so widening the shared pattern
   to reject them would break those existing, correct callers. This layer
   is local to `agent-session/`, which is a stricter context by design
   (Phase 6 below).

**Naming discipline** (inherited, not invented): `SENSITIVE_KEY_PATTERN`
rejects any key containing the substring `token` - so a numeric count must
be named e.g. `latencyMs`/`callCount`, never `...TokenCount`/`...Tokens`.
This is the exact same constraint `AgentToolLoopLlmCallSummary` (`events/types.ts`)
already documents and works around by naming its fields `inputSize`/`outputSize`.
A01's own event payloads never needed an LLM-token-count field (that
observability already lives in `agent_tool_loop_completed`'s `llmMetrics`,
via `commercial_event` - duplicating it here would violate "avoid an
excessively granular event model"), so this constraint did not have to be
worked around in this slice, but the docstring in `sanitizer.ts` records it
for whoever adds one later.

**Tests** (`tests/commercial/agentSessionSanitizer.test.ts`, 13/13 passing):
rejects `prompt`, `reasoning_content`, `reasoningContent`, `rawOutput`,
`chain_of_thought`/`chainOfThought`, `thinking`, `authorization`, `apiKey`,
a secret nested at arbitrary depth (object and array), `cookie`/`webhookSecret`;
confirms ordinary numeric/enum metrics pass through unchanged.

## Phase 6 -- PII boundary

Tested directly (`tests/commercial/agentSessionStore.test.ts`,
"appendEvent rejects a payload carrying PII-shaped fields"): a payload
containing `phone`/`email` is rejected with `agent_session_forbidden_payload:pii_shaped_key:...`
before anything reaches the store, never silently stored. `AGENT_SESSION_PII_KEY_PATTERN`
covers `phone`, `email`, `address`, `wa_id`/`waId`, `externalId`,
`normalizedPhone`, PrestaShop credential-shaped keys - the task brief's
explicit list. `masterCustomerId`/`opportunityId`/`conversationId` are
deliberately allowed through (the task brief: "the session may retain
internal opaque references... when existing architecture already considers
those safe internal identifiers" - which it already does, per
`RuntimeIdentityContext.masterCustomerId` and `CapabilityGatewayContext.opportunityId`).

This is a genuinely new, additional check, not a claim that the shared
`RuntimeIdentityContext`/`CustomerSessionDecisionContext` split is now
"automated" where it previously was not - that broader hardening (e.g. a
lint rule or type-level guard preventing a new PII field from silently
reaching `CustomerSessionDecisionContext`) remains exactly the future work
`SALES-AGENT-R3-A00`'s Phase 7 already flagged, out of scope here.

## Phase 7 -- Structured session summary

`lib/brain/commercial/agent-session/summary.ts#projectAgentSessionSummary` -
pure, no I/O, deterministic. Fields actually populated by A01:
`recentToolActivity` (bounded to 10, `SUMMARY_MAX_RECENT_TOOL_ACTIVITY`),
`pendingCommercialAction`, `lastCommercialOutcome`, `lastUserMessageAt`,
`lastAssistantMessageAt`, `eventCount`, `lastEventAt`. `currentGoals` is
present in the type (reserved for a future Harness's own goal-tracking) but
**always empty** in A01 - there is no `GOAL_UPDATED` source in the runtime
yet, and fabricating a plausible-looking value would violate `AGENTS.md`
("No datos ficticios presentados como reales").

This is a narrower summary than the task brief's illustrative
`discussedProducts`/`customerBudget`/`customerGoal` example. That richer
shape needs product-identity-level signals (which product, what budget) that
are not available at A01's chosen integration point without reaching into
`runAgentToolLoop.ts`'s internals - explicitly out of scope for a shadow-only
slice that must not touch the loop itself (Phase 13). What A01 provides
today is honestly what it can back with real data: which tools ran, in what
category (read vs. action), and what the last commercial outcome was -
enough for a future Harness to know "something happened," not yet "what."

## Phase 8 -- Summary rebuild / recovery

`rebuildSummary` always recomputes from the **full** session event log (not
the Phase-9-bounded recent window `loadRecentEvents` uses) and persists the
result with an incrementing `summary_version` - the persisted `summary_json`
is a materialized optimization, never a second source of truth; the event
log is always sufficient to reproduce it.

Tests (`agentSessionStore.test.ts`): summary generation from a real event
sequence; two consecutive `rebuildSummary` calls are deterministic (same
`eventCount`, monotonically incrementing `version`); `loadSummary` returns
`null` before any rebuild (never a stale/wrong guess); a log containing
`GOAL_UPDATED`/`FOLLOWUP_SCHEDULED`/`SESSION_SUMMARY_UPDATED` never throws
(`agentSessionSummary.test.ts`, "an unrecognized/non-applicable event type
is skipped, never thrown").

**A real ordering bug was found and fixed while writing these tests**: the
original in-memory sort broke ties (same-millisecond `occurredAt`) using
`eventId.localeCompare` - but `eventId` is a content hash of `dedupeKey`
(`buildAgentSessionEventId`), not a sequence, so it could silently reorder a
`REQUESTED` event after its own `COMPLETED` event within the same
millisecond. Fixed two ways: the in-memory store now relies on
`Array.prototype.sort`'s ES2019-guaranteed stability over the array's true
append order (no hash tiebreak at all); the real MariaDB table gained an
explicit `seq BIGINT UNSIGNED AUTO_INCREMENT` column (`migrations/033_agent_sessions.sql`)
as the `ORDER BY occurred_at, seq` tiebreaker, since SQL has no ordering
stability guarantee the way JS arrays do. `id` (the VARCHAR hash) is never
used for ordering in either implementation now.

## Phase 9 -- Bounded context

`AGENT_SESSION_DEFAULT_MAX_RECENT_EVENTS = 20`, `AGENT_SESSION_HARD_MAX_RECENT_EVENTS = 100`,
`AGENT_SESSION_DEFAULT_MAX_AGE_MS = 24h` (`store.ts`). Not invented from
nothing: matches the existing, already-proven precedent at this exact scale
- `RecentCatalogContext` caps at 5 interactions/12 products with a 24h
window, `buildNativeCommercialContext` caps recent conversation messages at
12 (`COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES`). `loadRecentEvents` clamps
`maxEvents` to the hard cap regardless of what a caller requests - tested
(`agentSessionStore.test.ts`, "bounded by maxEvents and never exceeds the
hard cap").

## Phase 10 -- Commercial transaction outcome projection

`COMMERCIAL_ACTION_COMPLETED`/`_FAILED`/`_REJECTED` events carry `{tool,
phase, governance, observationStatus}` - never a product id, price, or any
domain value. The summary's `lastCommercialOutcome`/`pendingCommercialAction`
let a future Harness know "a mutation was attempted/completed/failed," never
what the resulting durable state actually is. Tested (`agentSessionStore.test.ts`,
"a commercial action's completion is observable without duplicating on
repeat delivery"): the session observes the outcome, but the durable fact
itself still lives exclusively in `crm_request_facts`/`crm_quotes`/`crm_agent_actions`
- this slice never writes to any of those tables.

## Phase 11 -- Duplicate inbound compatibility

**What A01 guarantees**: `appendEvent`'s `dedupeKey` (built from `sessionId`
+ `inboundMessageId` for `USER_MESSAGE_RECEIVED`/`ASSISTANT_MESSAGE_SENT`,
plus `stepIndex`+`tool`+`eventType` for tool events) has a real database-level
`UNIQUE KEY` (`uq_agent_session_events_dedupe_key`). The **same**
`inboundMessageId` passed to `appendEvent` twice - whether from a genuine
retry after a crash, or a caller bug - can never produce two
`USER_MESSAGE_RECEIVED` session rows. Tested at the interface level
(`agentSessionStore.test.ts`, "the same inboundMessageId never produces two
USER_MESSAGE_RECEIVED events") and written (not run - see "Known
limitations") at the database level (`agentSessionStoreMariaDb.test.ts`,
concurrent `Promise.all` race on one `dedupeKey`).

**What remains explicitly out of scope, not silently declared solved**:
this does not touch the real terminal-work redelivery gap `A13` evidence
found, where the same physical inbound can produce **two different**
`inboundMessageId`s upstream (before `AgentSessionStore` ever sees either
one). `AgentSessionStore`'s dedupe is a second safety net keyed on an
identity it receives, not the producer of that identity - `conversation_message`'s
own `UNIQUE KEY uq_provider_message (provider, provider_message_id)`
(`migrations/008`) is the layer actually responsible for collapsing two
webhook deliveries of the same provider message into one `inboundMessageId`
in the first place. **The future `InboundIdempotencyBoundary` the A13
finding implies belongs upstream of `AgentSessionStore` entirely** - at the
webhook/inbound-normalization layer that assigns `inboundMessageId`, not
inside session storage. This document does not mark that A13 issue
resolved; it remains open, tracked where A13 already tracks it.

## Phase 12 -- Identity-gate parity audit

**Finding: `IDENTITY_GATE_GAP_FOUND`**

Compared directly against source, not inferred:

- R2: `CommercialActionRequest` (an objective) -> `work/commercialIdentityGate.ts#applyCommercialIdentityGate`
  (reads `identity/commercial-identity-requirement/operations.ts#REQUIREMENT_BY_OPERATION`)
  -> only a `SUFFICIENT` decision lets the objective reach `READY` ->
  capability.
- ATL: LLM tool request -> **no identity-sufficiency check at all** ->
  `executeGovernedCapability` -> capability's own `execute()`.

Read directly: `capability-gateway/selectProductsCapability.ts`,
`shippingDestinationCapability.ts`, `selectShippingOptionCapability.ts`,
`createQuoteCapability.ts` each check only `context.opportunityId != null`
("does an opportunity exist to anchor this fact to") - **none** read
`context.trustedCustomerSession?.runtimeIdentity` for a gating decision.
Customer-identity-linking capabilities (`create_customer`,
`link_external_identity`, `link_prestashop_identity`) do check identity
inline, but are not in `AGENT_LOOP_TOOL_POOL` at all - not reachable from
ATL, so not part of this parity question.

Cross-checked against `identity/commercial-identity-requirement/operations.ts#REQUIREMENT_BY_OPERATION`
(the source R2's gate reads):

| Capability | Required level | Enforced in ATL today? |
|---|---|---|
| `select_products` | `NONE` (by design - "shipping data is never identity", operations.ts comment) | N/A - no gap, nothing to enforce |
| `set_shipping_destination` | `NONE` (same rationale) | N/A - no gap |
| `select_shipping_option` | `NONE` | N/A - no gap |
| `create_quote` | `MINIMUM_LEVEL LEVEL_2_MASTER_RESOLVED` | **No.** `createQuoteCapability.ts#execute()` never reads identity. The requirement table's own comment admits this: *"assembleQuoteInput reads customer identity from context and degrades gracefully today when it is missing (never a hard block at the capability layer yet); this is the PROPOSED requirement for a future gating slice (A07+), not a behavior change here."* |

**Severity**: medium. `create_quote` has `governance.riskClass: "medium"`
and creates a real external Quote Service record (a genuine business
commitment - a quote number, pricing, a validity window) reachable today
through ATL with no guarantee the customer's identity was ever resolved to
`LEVEL_2_MASTER_RESOLVED`, when R2's own design intent (already recorded in
the requirement table before this task) says it should require exactly
that. Not `high`: no price/discount is set, no order is mutated, and the
same capability already degrades honestly (never fabricates data) when
identity/customer context is genuinely missing.

**Exact enforcement point missing**: `lib/brain/commercial/capability-gateway/createQuoteCapability.ts#execute()`,
before `assembleQuoteInput`/`port.createQuote` are called.

**Not fixed in A01**, deliberately: closing this gap means
`createQuoteCapability.ts#execute()` starts denying calls it does not deny
today for whoever is currently on the ATL allowlist - a real behavior
change to a live capability, which the task's own top-level constraint
("do not modify current production behavior") rules out for this slice,
regardless of how small the code change would be. **Recommended for
`R3-A02`** (`SALES-AGENT-R3-A00`'s migration plan already reserves A02 for
"Generalize the identity gate" - this finding is exactly its trigger):
extract `decideCommercialIdentityRequirement`'s call site out of
`work/commercialIdentityGate.ts`'s R2-only wiring into a form
`createQuoteCapability.ts` (and any future `LEVEL_2`+ capability) can call
directly, reusing the same pure decision function, never a second
implementation of the level-comparison logic.

## Phase 13 -- Shadow integration

One integration point, one file changed:
`lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts`. The shadow
call (`recordAgentToolLoopSessionShadowEvents`) is inserted **after** the
existing `recordAgentToolLoopCompletedCommercialEvent` call - i.e. strictly
after `runAgentToolLoop()`/`runCommercialMultiIntentLoop()` and
`dispatchAgentLoopResponse()` have already produced the turn's real,
final outcome. `runAgentToolLoop.ts` itself (the 927-line loop file) is
**untouched** - every session event is derived from `AgentToolLoopStepSummary[]`,
data the cycle wrapper already computes today for the existing
`commercial_event` write (`buildStepsSummary(loop)` was hoisted into a
local variable and reused, not duplicated, to keep this a minimal diff -
`git diff --stat` for this file: 30 insertions, 2 deletions).

**Failure mode: degradable, not fatal**, matching the file's own existing
precedent one block above it. The new call is wrapped in its own
`try/catch`; a failure pushes `agent_session_shadow_event_write_failed:<message>`
onto `loop.warnings` (the same internal-only observability channel every
other technical failure in this cycle already uses - `shadow_failed`,
`loop_failed`, `agent_tool_loop_completed_event_write_failed`) and the turn
returns exactly as it would have without this task's change. This choice
was not close: A01 has no operator-facing consumer of session data yet, so
there is nothing a customer-facing turn could correctly degrade *to* if
session recording were made fatal - failing the turn over an audit-trail
write that nothing downstream depends on yet would be strictly worse for
the customer, with no offsetting safety benefit.

**Not allowed / not done**: no change to which branch `runNativeAutonomousCycle.ts`
routes a turn to, no change to any prompt, tool pool, capability, or
dispatch decision, no change to what the customer receives. Verified by
`npx tsc --noEmit` (clean outside pre-existing, unrelated `experiments/`
errors) and by the fact that every new symbol this task introduces is
additive (a new directory, a new migration, one new import, one new
try/catch block appended after the function's existing logic, immediately
before its `return`).

## Phase 14 -- Tests

42 tests across four pure/logic files, all run and passing in this session
(no DB required - `createInMemoryAgentSessionStore`):

- `tests/commercial/agentSessionSanitizer.test.ts` - 13/13.
- `tests/commercial/agentSessionSummary.test.ts` - 5/5.
- `tests/commercial/agentSessionStore.test.ts` - 16/16 (covers task scenarios
  1-15, 21-25 from the Phase 14 checklist).
- `tests/commercial/agentToolLoopSessionShadow.test.ts` - 8/8 (shadow
  derivation logic: read vs. mutating tool classification, failed/
  rejected/skipped observation mapping, handoff turns, idempotent
  re-recording of a retried turn, no message text ever persisted).

One real ordering bug and one real PII-boundary gap were found and fixed
*by* writing and running these tests (see Phase 6 and Phase 8) - not
theoretical coverage.

## Real-database verification

Docker Desktop's engine came up later in this same task, closing the
original blocker. `docker compose --env-file infra/.env -f infra/docker-compose.dev.yml up -d`
succeeded (`crm-customer-360-mariadb`, healthy, `127.0.0.1:3306`),
`npm run db:migrate -- --database=test` applied `032`/`033` cleanly (no
checksum drift against `crm_test` - the drift documented elsewhere in this
repo's history is against `main_management`, a different database), and
`tests/commercial/agentSessionStoreMariaDb.test.ts` was then run for real:

- **A real bug was found and fixed** - not in `AgentSessionStore` itself,
  but in the test's own `ensureTestConversation()` fixture helper: it built
  `conversation.public_id` from a free-text string
  (`agsess-test-<timestamp>-<random>`), but that column is `CHAR(36)` (a
  UUID slot, `migrations/008`) - MariaDB's strict mode rejects the oversize
  value (`ER_DATA_TOO_LONG`) rather than silently truncating it. Fixed by
  using `crypto.randomUUID()` for `public_id` and moving the free-text
  identifier to `external_contact_id` (a `VARCHAR(191)`, which does not have
  this constraint). This is exactly why the exit criteria distinguish
  "code-reviewed" from "live-verified" - this bug existed in the reviewed,
  passing-`tsc` test file and was only caught by actually running it against
  a real database.
- All 5 tests then passed: `ensureSession` idempotency backed by the real
  `UNIQUE KEY uq_agent_sessions_conversation_id`; the `dedupe_key` `UNIQUE KEY`
  holding under a genuine concurrent `Promise.all` race (5 simultaneous
  `appendEvent` calls against the same row, exactly one survives); session
  and event history surviving a real `resetPoolForTests()` cycle (a fresh
  `mysql2` pool reading the same persisted rows); `ORDER BY occurred_at, seq`
  returning true insertion order; a PII-shaped payload rejected before any
  `INSERT` reaches the database (confirmed by a `COUNT(*)` of zero
  afterward).

**Regression check**, re-run with the database reachable (strictly stronger
than the first pass, which could only report DB-touching tests as
"unrelated to my change" without being able to prove it): every test file
that imports either of the two files this task modified
(`runNativeAgentToolLoopCycle.ts`, `events/normalize.ts`) - **72/72
passed**, including all 16 `tests/commercial/commercial-events.test.ts`
cases that had failed with `ECONNREFUSED` on the first, DB-unreachable pass.
Additionally ran the Capability Gateway, identity, and follow-up suites
Phase 14 asked for (`capabilityGateway.test.ts`,
`capabilityGatewayHardening.test.ts`, `commercialIdentityRequirement.test.ts`,
`runtimeIdentityContext.test.ts`, `runFollowupTick.test.ts`,
`customerIdentityCapabilityGateway.test.ts`,
`commercialWorkIdentityGating.test.ts`, `objectiveAwareFollowUp.test.ts`) -
**141/141 passed**, including `commercialWorkIdentityGating.test.ts`, the
suite most directly adjacent to the Phase 12 identity-gate finding.

Combined test evidence for this task: **47 new tests (42 in-memory/pure + 5
real-MariaDB) + 213 pre-existing regression tests (72 + 141), all passing.**

`npx tsc --noEmit`: clean across the whole repository outside 22
pre-existing errors confined to `experiments/deepseek-harness/` (untracked,
predates this task, unrelated to this task's files).

## Known limitations

- **Real-database verification was initially blocked, then completed within
  this same task** once Docker Desktop's engine became available (see "Real-database
  verification" above) - `migrations/033_agent_sessions.sql` is applied to
  `crm_test`, and `tests/commercial/agentSessionStoreMariaDb.test.ts` passed
  5/5 against it. Not applied anywhere beyond `crm_test` in this session
  (never `main_management`, never a deployed environment) - that remains a
  future, ordinary migration rollout, not something this document claims.
- **`FOLLOWUP_SCHEDULED`/`_CANCELLED`/`_WAKE` have no live emitter.** The
  taxonomy exists; `runFollowupTick.ts` was not touched. Wiring a real
  follow-up wake event correctly also requires resolving the two-divergent-
  re-entry-mechanism finding `SALES-AGENT-R3-A00` already flagged (Phase 2.G) -
  doing that properly is bigger than "extremely small, clearly isolated"
  and belongs in a later slice, not A01.
- **`GOAL_UPDATED` has no live emitter and `AgentSessionSummary.currentGoals`
  is always empty.** No goal-tracking source exists anywhere in the current
  runtime to honestly populate it from.
- **The `create_quote` identity-gate gap (Phase 12) is documented, not
  fixed** - by design, per the task's "do not modify current production
  behavior" constraint. See `R3-A02` recommendation above.
- **The capability-execution-audit-not-transactional-with-the-mutation gap**
  `SALES-AGENT-R3-A00` flagged (`crm_capability_executions` writes happen
  after, not atomically with, a capability's own mutation) is unrelated to
  and unchanged by this task - noted here only so it is not mistaken for
  something A01 was supposed to have addressed.

## Update to A00

One correction, per this task's own instruction to update A00 only on a
material contradiction found during implementation - see Phase 1 above: the
`ai_*` observability tables from `ADR-002` DO exist as schema
(`migrations/008_conversation_ai_runtime_core.sql`), contradicting A00's
literal "not observed in this audit" phrasing. A00's Phase 1 table has been
corrected in place to say they exist but are written only by
`lib/brain/local-ai-sdr/**` (a separate, older module), never by the current
native/commercial runtime - preserving A00's actual conclusion while fixing
the overclaim.

## Rollback

Purely additive; rollback is a subtraction, not a repair:

1. Revert the two edited files (`runNativeAgentToolLoopCycle.ts`,
   `events/normalize.ts`) - both changes are small, isolated diffs (see
   `git diff --stat` above).
2. Delete `lib/brain/commercial/agent-session/` and the five new test files.
3. `DROP TABLE IF EXISTS agent_session_events; DROP TABLE IF EXISTS agent_sessions;`
   (the exact rollback SQL is already at the bottom of
   `migrations/033_agent_sessions.sql`) - applies to `crm_test`, the only
   database this migration was applied to in this session (never
   `main_management`, never a deployed environment).

No other table, flag, or production code path depends on any of this. The
system returns to exactly its current, already-verified behavior.

## Next slice recommendation

**`R3-A02` - Generalize the identity gate**, exactly as `SALES-AGENT-R3-A00`'s
migration plan already named it, now with a concrete, code-confirmed target:
extract `decideCommercialIdentityRequirement`'s decision logic out of
`work/commercialIdentityGate.ts`'s R2-only wiring so `createQuoteCapability.ts`
(Phase 12's finding) can call it directly, closing the one real,
non-theoretical gap this audit found - before `R3-A06`
(`crm_opportunities` creation on the ATL path) or any routing-widening
slice makes that gap reachable by more conversations.

This was verified within this same task (see "Real-database verification"
above) - `migrations/033_agent_sessions.sql` is applied to `crm_test` and
`agentSessionStoreMariaDb.test.ts` passed 5/5, so `R3-A02` can proceed
without first re-doing this step.

## Exit criteria

| Criterion | Status |
|---|---|
| Durable session exists | Yes - `agent_sessions` table applied to `crm_test`, live-verified |
| Append-only events work | Yes - interface-level (in-memory, 16 tests) and real-database (`agentSessionStoreMariaDb.test.ts`) both green |
| Database dedupe works | Yes - `UNIQUE KEY uq_agent_session_events_dedupe_key` held under a real concurrent `Promise.all` race against `crm_test` (5 simultaneous inserts, one survivor) |
| Session survives restart | Yes - `resetPoolForTests()` + a fresh `mariaDbAgentSessionStore()` against `crm_test` correctly resumed the same session and event history |
| Summary is reconstructible | Yes - tested, deterministic, and a real ordering bug was caught and fixed by this testing |
| Retrieval is bounded | Yes - tested against both the default and hard cap |
| No chain-of-thought/raw prompt/raw output can be persisted | Yes - tested, and the shared sanitizer was strengthened to close a real gap (`reasoning_content`/`rawOutput`/etc. were not previously covered) |
| Secret/PII boundary is tested | Yes - real-database test confirms a PII-shaped payload never reaches an `INSERT` (`COUNT(*) = 0` after a rejected attempt), plus a real gap (PII field names were not rejected at all before this task) was found and fixed |
| Session is not business truth | Yes by construction - no domain table is written by this module; verified by code review against the explicit prohibited-list in the task brief |
| Transaction outcomes observable without duplicating domain truth | Yes - tested |
| No production routing behavior changed | Yes - additive-only integration, verified by diff size and clean `tsc` |
| Relevant regression tests are clean | Yes - 260 tests total (47 new: 42 in-memory/pure + 5 real-MariaDB; 213 pre-existing regression tests across the files that import either modified file, plus Capability Gateway/identity/follow-up/CommercialWork-identity-gating suites), all passing against a real database |
| Identity-gate parity result is explicitly documented | Yes - `IDENTITY_GATE_GAP_FOUND`, Phase 12 |

## R3_A01_AGENT_SESSION_STORE_VALIDATED

Every exit criterion is met and live-verified against a real, running
MariaDB (`crm_test`), not just code-reviewed: `migrations/033_agent_sessions.sql`
is applied; `tests/commercial/agentSessionStoreMariaDb.test.ts` passed 5/5,
covering database-level dedupe under genuine concurrency, `seq`-ordered
retrieval, PII rejection before any `INSERT`, and process-restart resume via
the same `resetPoolForTests()` mechanism `ACS-R1-05-T07` already established
for this exact guarantee. 260 tests passed in total across this task's own
new coverage and the pre-existing regression suites it touches or sits
beside, with zero failures once the database was reachable. Two real bugs
were found and fixed by this task's own testing before this verdict was
reached - an ordering-tiebreaker bug in the store implementation itself, and
a `CHAR(36)` sizing bug in a test fixture - so this is evidence-based
confidence, not an assumption that the code was already correct.

`R3-A02` (generalize the identity gate onto `createQuoteCapability.ts`,
Phase 12) is unblocked and can proceed directly - no further environment
setup is needed before starting it.
