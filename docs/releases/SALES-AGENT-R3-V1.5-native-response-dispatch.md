# SALES-AGENT-R3-V1.5 -- Native Response Dispatch

Status: implemented and tested against real MariaDB (`main_management`). A
`terminalReason: "responded"` turn from `SalesAgentRuntime` now dispatches
straight to the canonical `brain_message_outbox` through a dedicated,
deterministic R3-native boundary - no `crm_agent_actions` row, no
`autonomy-sandbox`, no `execution-gate`. Every other terminal reason
(handoff/timeout/invalid_output/max_steps_exceeded/provider_unavailable)
still dispatches through the unmodified R1 stack
(`dispatchAgentLoopResponse.ts`), exactly as V1.4 left it.

## Phase 0 -- Production evidence that motivated this task

Real inbound message 172 (WhatsApp pilot): `terminalReason=responded`,
`decisionCount=2`, `toolExecutionCount=1`, `finalMessagePresent=true`, a
correct product-search answer - and no `brain_message_outbox` row, because
`dispatchAgentLoopResponse.ts` (V1.4's own reused R1 dispatcher) requires
`BRAIN_EXECUTION_GATE_ENABLED`/`BRAIN_OUTBOX_BRIDGE_ENABLED` in addition to
`BRAIN_AGENT_ACTION_QUEUE_ENABLED`/`BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED` -
R3's real conversational response path was structurally coupled to R1's full
action-lifecycle stack. This task removes that coupling for the one turn
shape (`responded`) that is not a commercial mutation.

## Phase 1 -- Architecture decision

A final conversational response is not a commercial mutation.
`crm_agent_actions`/`autonomy-sandbox`/`execution-gate` exist to govern R1's
action-lifecycle (propose -> approve -> execute a commercial mutation);
requiring that stack for "the model answered a question" was the false
dependency. Commercial mutations (`select_products`, `create_quote`, ...)
are untouched - they continue through `CommercialActionRequest` ->
Capability Gateway -> domain service, unaffected by this task.

reasoning = flexible (`SalesAgentRuntime`, unmodified)
actions = typed (`DispatchSalesAgentResponseResult`)
state = durable (the existing `brain_message_outbox`, unmodified schema)
rules = deterministic (this boundary's own governance, no LLM/policy call)

## Phase 2 -- New R3-native dispatch boundary

New file: `lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentResponse.ts`
(`dispatchSalesAgentResponse`) - same directory as `runSalesAgentRuntimeCycle.ts`
(the existing R3 routing-seam module), not a new top-level module.

```ts
dispatchSalesAgentResponse({
  conversationId, conversationCaseId, opportunityId, waId, inboundMessageId,
  correlationId, currentTime, humanOwnerActive, aiBlocked, finalMessage
}) -> { attempted, outboxWritten, outboxId, duplicate, status, reason, warnings }
```

`status` is one of `dispatched | skipped | failed`; `reason` distinguishes
`dispatched`/`duplicate` from every governed-skip class
(`human_owner_active`/`ai_blocked`/`autonomous_responses_disabled`/
`wa_not_allowlisted`/`empty_message`/`invalid_wa_id`/`conversation_closed`/
`conversation_not_found`) and the one technical-failure class
(`persistence_error`).

## Phase 3 -- Old vs new path for `terminalReason: "responded"`

Old (V1.4, still exactly this for every other terminal reason):

```
SalesAgentRuntime -> dispatchAgentLoopResponse -> persistAgentAction
  -> evaluateAgentActionForSandbox -> executeActionThroughGate
  -> SqlExecutionUnitOfWork -> brain_message_outbox
```

New, `responded` only:

```
SalesAgentRuntime -> dispatchSalesAgentResponse
  -> deterministic governance (this file, no DB)
  -> transactional ownership recheck + writeCanonicalOutboxMessage
     (one transaction, lib/brain/messaging/canonicalOutboxWriter.ts)
  -> brain_message_outbox (unchanged table/worker)
```

`runSalesAgentRuntimeCycle.ts` (V1.4's routing-seam adapter) now branches on
`loop.terminalReason === "responded"` at its one dispatch call site: the new
path for `responded`, `dispatchAgentLoopResponse` unchanged for every other
terminal reason - the Scope Guard the task required. The new dispatcher's own
typed result is adapted onto the pre-existing `DispatchAgentLoopResponseResult`
shape (`action`/`actionPersistence`/`sandboxEvaluation`/`executionGate` all
honestly `null` - there is no `crm_agent_actions` row for a `responded` turn
anymore) so `SalesAgentRuntimeCycleResult`'s public shape, and every
downstream reader (`ensureAutonomousSalesTurnContinuity.ts`'s
`cycle.salesAgentRuntime` branch), need zero changes.

## Phase 4 -- Governance retained

Enforced, in order, before any DB write:

1. `finalMessage` non-empty (trimmed).
2. `humanOwnerActive === false` (turn-start snapshot).
3. `aiBlocked === false` (turn-start snapshot).
4. `BRAIN_AUTONOMOUS_RESPONSES_ENABLED` (`loadAutonomousResponsesEnabled()`,
   the existing R3 top-level autonomous-response killswitch - unchanged
   function, already used elsewhere in this codebase).
5. WhatsApp pilot allowlist (`isWaIdAuthorizedForPilot` /
   `loadAutonomousPilotAllowlist`, i.e. `BRAIN_AUTONOMOUS_TEST_WA_IDS` -
   same empty-allowlist-is-unrestricted semantics every sibling pilot route
   already uses, reused verbatim, not reinvented).
6. `waId` normalizes to a valid recipient (`normalizeWaIdDigits`).
7. Idempotency (`INSERT IGNORE` on a stable dedupe key, DB-enforced).

Then, **inside the same transaction as the outbox insert**: a fresh
`SELECT status, ai_enabled, human_owner_active FROM conversation WHERE id = ?
FOR UPDATE` recheck. This is additive beyond the task's own "at minimum"
list, folded into the same query at zero extra round-trip cost: `case_closed`
governance (`evaluateExecutionGate.ts`'s own existing check) would otherwise
be silently lost by bypassing execution-gate, so it is preserved here too.

This recheck is the release's explicit hard requirement: the turn-start
`humanOwnerActive`/`aiBlocked` snapshot cannot see an operator taking control
or pausing the AI *while SalesAgentRuntime was reasoning*. Rechecking only
`conversation` (not `crm_opportunities`) is sufficient - `takeHumanControlTx`
and `applyConversationControl` (`lib/domains/conversations/control.ts`)
always flip `conversation.human_owner_active`/`ai_enabled` in the same
transaction as any `crm_opportunities`-level mirror. Proven by test
(`[D9]`/`[D9b]`, `dispatchSalesAgentResponse.test.ts`): the turn-start input
flags say `humanOwnerActive: false`/`aiBlocked: false`, but the conversation
row in the database says otherwise (simulating a takeover/pause committed
after the snapshot was taken, before dispatch runs) - the outbox write is
still correctly blocked, with zero outbox rows created. This is on top of,
not instead of, the two other safety nets already in this codebase:
`takeHumanControlTx` cancels any already-`planned`/`locked` outbox row on
takeover, and `autonomousOutboxTick.ts#revalidateBeforeSend` re-validates
ownership again immediately before the real Meta send.

## Phase 5 -- Canonical outbox reuse (no second writer)

`writeCanonicalOutboxMessage` (`lib/brain/messaging/canonicalOutboxWriter.ts`)
is reused directly, passed the dispatcher's own open `PoolConnection` so the
ownership recheck and the insert share one transaction. This module was
already documented as "the ONLY module allowed to INSERT into
brain_message_outbox" and already does `INSERT IGNORE` on a unique
`dedupe_key` - the exact "transaction-safe... neutral existing repository
primitive" the task asked to locate rather than reimplement.
`execution-gate/sqlExecutionUnitOfWork.ts`'s own `SqlOutboxRepository`
already delegates to this same function - confirming it was already the
correct extraction point, not something this task needed to carve out of
execution-gate itself. No second outbound queue/table was created.

Dedupe key: `sales-agent-r3:{conversationId}:{inboundMessageId}:responded`,
matching the task's own suggested format - human-readable, distinct from
every other adapter's own key namespace (`agent-tool-loop:...`,
`commercial-work:...`, `brain-outbox-<hash>`), so a duplicate delivery of the
exact same inbound message can never collide with, or be masked by, another
runtime's row for the same conversation.

Outbox row fields: `source: "sales-agent-r3"`, `source_agent_name:
"sales-agent-r3-native-dispatcher"`, `source_agent_version:
"sales-agent-r3-dispatch.v1"` (`SALES_AGENT_RESPONSE_DISPATCHER_VERSION`) -
new, R3-identifying values (no existing schema constraint required reusing
`"ai_sdr"`; `source` is a free-text `VARCHAR(64)`). `wa_id`/
`conversation_case_id`/`message_text`/`status: "planned"`/`opportunityId`
(folded into `meta_payload_json.opportunity_id`, the same field
`deliveryStatusProjection.ts` already resolves against) all match the
existing worker's expected contract exactly - proven by test (`[D10]`): a
real `runOutboxTick({ dryRun: true, outboxIds: [...] })` against a row this
dispatcher wrote passes allowlist/atomic-claim/ownership-and-window
revalidation and is selected for send (`processed: 1`, `cancelled: 0`,
`skipped: 0`), never falling into `invalid_payload`/`ownership_revoked`/
`window_closed`.

## Phase 6 -- Observability

New `commercial_event` type `sales_agent_runtime_response_dispatched` (one
event per dispatch attempt, same discipline as `agent_tool_loop_completed`):
`events/types.ts` (type + payload), `events/dedupe.ts` (dedupe key),
`events/normalize.ts` (`normalizeSalesAgentRuntimeResponseDispatchedEvent`,
reuses the existing sanitizer - no chain-of-thought/reasoning field exists on
this payload to begin with), `events/service.ts`
(`recordSalesAgentRuntimeResponseDispatchedEvent`). Payload:
`inboundMessageId`, `terminalReason: "responded"`, `outboxWritten`,
`outboxId`, `duplicate`, `reason` (the same structured skip/failure
vocabulary above), `dispatcherVersion`. Written after every dispatch attempt
(success, skip, or failure alike), non-blocking (try/catch, matches every
other observability write in this codebase - "observability must never break
the turn").

## Phase 7 -- False dependency removed

After this task, a normal R3 `responded` turn succeeds with:

```
BRAIN_AGENT_ACTION_QUEUE_ENABLED=false
BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED=false
BRAIN_EXECUTION_GATE_ENABLED=false
BRAIN_OUTBOX_BRIDGE_ENABLED=false
BRAIN_AUTONOMOUS_SANDBOX_ENABLED=false
BRAIN_AUTONOMOUS_REPLY_ENABLED=false
BRAIN_AUTONOMOUS_RESPONSES_ENABLED=true   # unchanged: the one real R3 gate
BRAIN_SALES_AGENT_RUNTIME_ENABLED=true
BRAIN_SALES_AGENT_RUNTIME_WA_IDS=<allowlisted wa_id>
```

Proven by test `[D3]` (`dispatchSalesAgentResponse.test.ts`): with the six
R1 flags above all explicitly `false`, `dispatchSalesAgentResponse` still
writes the canonical outbox on its own flag alone. This is the release's own
stated gate: *"que barras olimpicas tienen?" -> R3 -> search_products ->
finalMessage -> brain_message_outbox -> worker -> WhatsApp* with that exact
flag combination.

## Phase 8 -- Out of scope (unchanged, per the task's own list)

`handoff`/`timeout`/`invalid_output`/`max_steps_exceeded`/
`provider_unavailable` terminal reasons; ATL (`runNativeAgentToolLoopCycle.ts`,
`dispatchAgentLoopResponse.ts` itself); `CommercialWork`
(`dispatchCommercialWorkResponse.ts`); the follow-up wake dispatcher
(`dispatchDraftedFollowUpMessage.ts`); multimodal; follow-up; legacy-flag
cleanup beyond what Phase 7 required. None of these files were modified by
this task - grep-confirmed.

## Phase 9 -- Remaining legacy dependencies in `runSalesAgentRuntimeCycle.ts`

For every terminal reason other than `responded`, the function still calls
`dispatchAgentLoopResponse` (full R1 stack) unchanged - by design, per Phase
8. This means a `handoff`/`provider_unavailable`/etc. R3 turn still requires
`BRAIN_AGENT_ACTION_QUEUE_ENABLED`/`BRAIN_EXECUTION_GATE_ENABLED`/
`BRAIN_OUTBOX_BRIDGE_ENABLED` to dispatch its own neutral fallback/handoff
acknowledgement. Extending R3-native dispatch to those terminal reasons is
explicitly out of scope for V1.5 (Phase 8) and not addressed here.

## Phase 10 -- Tests

New: `tests/commercial/dispatchSalesAgentResponse.test.ts` (12 tests, real
MariaDB `main_management`) - `[D1]` dispatched writes exactly one canonical
outbox row with the full expected contract; `[D2]` duplicate inbound produces
exactly one row; `[D3]` legacy R1 flags irrelevant; `[D4]`/`[D5]`
humanOwnerActive/aiBlocked input flags block; `[D6]` the R3 killswitch off by
default blocks; `[D7]`/`[D7b]` pilot allowlist miss/hit; `[D8]` empty
response blocks; `[D9]`/`[D9b]` the transactional ownership-race recheck
blocks even when the turn-start snapshot was stale; `[D10]` the written row
is a real, processable row for the existing outbox worker.

Modified: `tests/commercial/runSalesAgentRuntimeCycle.test.ts` - `[RC1]`/
`[RC5]` updated from asserting a `crm_agent_actions` row (no longer created
for `responded`) to asserting the canonical outbox row directly (by the new
R3 dedupe key) plus a `countAgentActionsForConversation() === 0` assertion;
`[RC7]`'s dispatch-enabled half now sets `BRAIN_AUTONOMOUS_RESPONSES_ENABLED`
instead of the R1 bridge flags. `[RC2]`/`[RC3]`/`[RC4]`/`[RC6]`/`[RC8]`
unchanged (governance-blocked, handoff, provider-failure, RecentCatalogContext,
and budget scenarios never touch the R1-vs-R3 dispatch seam this task
changed, or - for `[RC2]` - never reach dispatch at all).

Regression (unmodified files/behavior, run against real MariaDB):
`dispatchAgentLoopResponseHandoffControl.test.ts`,
`canonicalOutboxWriter.test.ts`, `autonomousRuntimeGates.test.ts`,
`outbox-ownership.test.ts`, `outbox-pilot-isolation.test.ts`,
`commercialWorkInboundCycle.test.ts`, `native-whatsapp.test.ts`,
`ensureAutonomousSalesTurnContinuity.test.ts`, `salesAgentRuntime.test.ts`.

**Result: 105/105 passing, 0 failures** (12 new + 8 modified in
`runSalesAgentRuntimeCycle.test.ts` + 85 regression).

`npx tsc --noEmit`: clean. `npm run build`: clean. `npm run lint`
(`lib`/`app`/etc., project-wide per `package.json`): 0 errors, 39
pre-existing warnings, none in any file this task touched.

## Files changed

New:
- `lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentResponse.ts`
- `tests/commercial/dispatchSalesAgentResponse.test.ts`
- `docs/releases/SALES-AGENT-R3-V1.5-native-response-dispatch.md` (this file)

Modified:
- `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts`
  (terminalReason-branched dispatch call site, result adapter)
- `lib/brain/commercial/sales-agent-runtime/index.ts` (barrel export)
- `lib/brain/commercial/events/types.ts`/`dedupe.ts`/`normalize.ts`/`service.ts`
  (new `sales_agent_runtime_response_dispatched` event kind)
- `tests/commercial/runSalesAgentRuntimeCycle.test.ts` (`[RC1]`/`[RC5]`/`[RC7]`
  updated for the new architecture, per Phase 10)

Untouched, confirmed by grep/test: `dispatchAgentLoopResponse.ts`,
`execution-gate/**`, `autonomy-sandbox/**`, `action-queue/**`,
`runNativeAgentToolLoopCycle.ts`, `dispatchCommercialWorkResponse.ts`,
`dispatchDraftedFollowUpMessage.ts`, `canonicalOutboxWriter.ts`,
`autonomousOutboxTick.ts`, `lib/domains/conversations/control.ts`.

## Verdict

**`R3_V1_5_NATIVE_RESPONSE_DISPATCH_VALIDATED`**
