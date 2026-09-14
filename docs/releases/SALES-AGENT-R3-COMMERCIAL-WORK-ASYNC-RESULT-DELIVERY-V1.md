# R3 COMMERCIAL WORK ASYNC RESULT DELIVERY V1

Status: `IMPLEMENTATION`
Verdict: `ASYNC_RESULT_DELIVERY_V1_IMPLEMENTED_LOCAL_DB_UNAVAILABLE`

## 1. Preflight architecture

Traced the real deferred path end to end before writing anything:

```
commercialWorkWorker.ts#runCommercialWorkTick
  -> selectDueCommercialWorkSteps (READY / due RETRY_SCHEDULED / expired RUNNING)
  -> claimDueCommercialWorkStep (CAS)
  -> commercialWorkExecutor.ts#executeCommercialWork (persists durable step/work state only)
```

`executeCommercialWork` never calls a finalizer or a dispatcher - it only persists
the aggregate via `updateCommercialWorkAggregate`. The **synchronous** turn
(`runCommercialWorkInboundCycle.ts`) additionally runs, after its own
`executeCommercialWork` call:

```
settleCommercialWorkProjection (reprojection cascade, may execute more steps)
  -> dispatchCommercialWorkResponse
       -> buildCommercialWorkFinalizerMessage (pure, grounded in the persisted aggregate)
       -> persistAgentAction (action-queue, idempotency_key unique)
       -> evaluateAgentActionForSandbox
       -> executeActionThroughGate (execution gate -> brain_message_outbox)
```

The worker (`runCommercialWorkTick`) stopped after `executeCommercialWork` -
it never called `settleCommercialWorkProjection` or `dispatchCommercialWorkResponse`.
Confirmed by `tests/commercial/commercialWorkRetryWorker.test.ts`'s own
`CWRT01-CWRT04-CWRT20-CWRT25` test, whose original name and final assertions
(`assert.equal(after.actions, before.actions); assert.equal(after.outbox,
before.outbox);`) documented this as *deliberate, verified* pre-existing
behavior: a deferred `create_quote` completing via retry produced **zero**
customer-visible consequence. `scripts/autonomous-commercial-work-worker.ts`'s
own header comment already described the *intended* architecture ("a
completed step's customer-visible follow-on... flows through the same
canonical action-queue -> execution-gate -> brain_message_outbox path...this
worker never writes to the outbox itself") - aspirational, never wired up
until this task.

## 2. Existing finalizer/dispatch path reused

Zero new finalizer, zero new outbox, zero new retry engine. The new seam
(`lib/brain/commercial/work/worker/dispatchAsyncCommercialWorkDelivery.ts`)
calls, in order, the exact same functions the synchronous turn calls:
`settleCommercialWorkProjection` (pure reprojection cascade,
`buildCommercialWorkProjection` under the hood) then `dispatchCommercialWorkResponse`
(action-queue -> sandbox -> execution gate -> outbox, unmodified). No
worker-specific response template exists anywhere in the new code.

## 3. Worker completion seam

`sweepUndeliveredCommercialWorkDeliveries` runs once at the end of every
`runCommercialWorkTick` call (after the due-step claim/execute loop), gated
by a new `BRAIN_COMMERCIAL_WORK_ASYNC_DELIVERY_ENABLED` flag (default
`false`, independent of `BRAIN_COMMERCIAL_WORK_WORKER_ENABLED`) and by the
existing `BRAIN_AUTONOMOUS_RESPONSES_ENABLED` killswitch. It scans
`crm_commercial_work` for rows in a dispatch-worthy status
(`COMPLETED`/`WAITING_CUSTOMER`/`FAILED`/`CANCELLED`/`HANDOFF`) updated within
a bounded recent window (`BRAIN_COMMERCIAL_WORK_ASYNC_DELIVERY_LOOKBACK_MINUTES`,
default 30, real wall-clock time via `crm_commercial_work.updated_at`'s
`ON UPDATE CURRENT_TIMESTAMP(3)`, never business-logic `now`), then evaluates
each through `evaluateAndDispatchAsyncCommercialWorkDelivery`. One mechanism
covers both the common case (a work that just settled to a terminal status
THIS tick) and the crash-recovery case (a work that reached that status in an
earlier tick whose worker process crashed before dispatching) - there is no
separate "immediate" trigger, deliberately, to avoid two code paths doing the
same thing.

The trigger is durable-state-based, not "on every internal state change":
`ACTIVE` (more `READY` steps) and `WAITING_SYSTEM` (a scheduled retry owns
it - Harness section 8, never a premature message) are excluded from the
dispatch-worthy set, so a work mid-retry produces zero evaluation noise and
zero premature delivery.

## 4. Durable revalidation

`evaluateAndDispatchAsyncCommercialWorkDelivery` never trusts a snapshot
captured earlier in the tick. For every candidate it:

- reloads the work fresh via `getCommercialWorkByPublicId` (current version,
  current status);
- runs it through `settleCommercialWorkProjection` again (reprojects from
  current durable facts, may itself discover the work is no longer
  dispatch-worthy);
- checks the settled status against the dispatch-worthy set;
- reads `conversation.human_owner_active`/`ai_enabled` fresh, immediately
  before dispatch (never a value captured before the capability call) -
  passed into the existing `dispatchCommercialWorkResponse` ->
  `evaluateExecutionGate` chain, which already blocks on
  `human_owner_active`/`ai_blocked` (unmodified).

No equivalent-result-already-dispatched check is needed as a separate step:
`dispatchCommercialWorkResponse`'s own idempotency (section 5) makes a
repeated evaluation of an already-delivered version a safe no-op.

## 5. Idempotency identity

Reused, not reinvented. `dispatchCommercialWorkResponse`'s existing
`buildIdempotencyKey(conversationId, inboundMessageId, work)` already embeds
`work.publicId:work.version`. There is no real inbound message for a
worker-triggered evaluation, so a fixed sentinel
(`ASYNC_COMMERCIAL_WORK_DELIVERY_SENTINEL = "async-worker-completion"`) fills
the `inboundMessageId` slot - the actual uniqueness guarantee comes from
`work.version`, an optimistic-concurrency identity (`crm_commercial_work.version`,
`UPDATE ... WHERE public_id = ? AND version = ?`) that only one writer can
ever legitimately advance to for a given number (see
`commercialWorkExecutor.ts`/`repository.ts#updateCommercialWorkAggregate`),
so it survives retries/restarts/duplicate workers by construction, never by
a new dedupe table. `crm_agent_actions.idempotency_key`'s existing unique
index (`uq_crm_agent_actions_idempotency_key`, migrations/005) is the actual
enforcement point; `persistAgentAction`'s existing
inserted/updated_existing/duplicate_ignored handling and
`executeActionThroughGate`'s existing `outboxMessageId !== null -> duplicate`
check are both reused unmodified.

## 6. create_quote deferred lifecycle

T0: customer message -> `create_quote` attempted synchronously -> Quote
Service temporarily unavailable -> capability returns `temporarily_blocked`
-> step `RETRY_SCHEDULED`, work `WAITING_SYSTEM` (pre-existing behavior,
unmodified) -> sweep finds the work but skips it (`WAITING_SYSTEM` excluded
from the dispatch-worthy set) -> zero false confirmation.

Later: worker claims the due step -> `create_quote` succeeds -> durable quote
evidence persisted (pre-existing `setCreatedQuoteForOpportunity`, unmodified)
-> step/work reach `COMPLETED` -> the sweep's next tick (or the same tick,
since the sweep runs after the claim loop) finds the work, settles it,
confirms `COMPLETED`, dispatches through the existing pipeline -> customer
receives the quote result without sending another message.

## 7. Handoff race handling

`evaluateAndDispatchAsyncCommercialWorkDelivery` reads
`conversation.human_owner_active`/`ai_enabled` fresh immediately before
calling `dispatchCommercialWorkResponse`, regardless of what the persisted
`CommercialWork.status` says. The durable capability success (e.g. the
created quote row) stays recorded either way - only the customer-visible
dispatch is suppressed, via the existing execution gate's
`human_owner_active`/`ai_blocked` block reasons (`evaluateExecutionGate.ts`,
unmodified). No new customer-notification/reactivation policy was added.

## 8. Supersession handling

The current durable work is always re-fetched by `publicId` right before
evaluation - never a cached row from the sweep's own scan query. A work whose
status has since moved to `SUPERSEDED` is excluded twice over: the sweep's
own SQL scan only selects `COMPLETED`/`WAITING_CUSTOMER`/`FAILED`/`CANCELLED`/`HANDOFF`
(never `SUPERSEDED`), and `buildCommercialWorkFinalizerMessage`'s own
`activeObjectives()` already excludes `SUPERSEDED`/`CANCELLED` objectives
from its narrative (pre-existing, unmodified). No stale S1 selection can ever
be announced once S2 has superseded it in the same durable aggregate.

## 9. Followup separation

Untouched. `scheduleObjectiveAwareFollowUp`/`objectiveAwareFollowUp.ts` are
not called or modified by this seam. `WAITING_SYSTEM` (worker retry owns it)
is explicitly excluded from the dispatch-worthy set, so a `create_quote`
retry window never triggers a followup message, and a genuine
`WAITING_CUSTOMER` transition (the followup subsystem's own domain) is left
entirely to the existing synchronous-turn/`scheduleObjectiveAwareFollowUp`
machinery - the async seam only delivers the same finalizer text the sync
turn would have produced, through the same action-queue path, never a
second, competing notification mechanism.

## 10. Channel coupling

Unchanged, documented debt (not solved here, per task scope): the seam calls
`dispatchCommercialWorkResponse`, whose action type is `send_whatsapp_reply`.
The seam itself is channel-agnostic (durable finalized result -> action ->
outbox); the WhatsApp coupling lives entirely inside the pre-existing
`dispatchCommercialWorkResponse`/action-queue/execution-gate stack, not in
anything added by this task.

## 11. Files changed

- `lib/brain/commercial/work/worker/dispatchAsyncCommercialWorkDelivery.ts` (new) -
  the seam: `evaluateAndDispatchAsyncCommercialWorkDelivery`,
  `sweepUndeliveredCommercialWorkDeliveries`.
- `lib/brain/commercial/work/worker/commercialWorkWorker.ts` - wires the sweep
  into `runCommercialWorkTick` (new `asyncDeliveryEnabled`/
  `asyncDeliveryLookbackMinutes`/`asyncDeliveryBatchSize` options, new
  `asyncDelivery` result field); hoisted the pre-existing per-candidate
  `eligibleForCommercialWork` resolution above the loop so the sweep can
  reuse it.
- `lib/brain/commercial/work/worker/index.ts` - barrel export.
- `lib/brain/runtime/autonomousRuntimeConfig.ts` - new
  `loadCommercialWorkAsyncDeliveryEnabled`/`loadCommercialWorkAsyncDeliveryLookbackMinutes`.
- `lib/brain/commercial/events/{types,dedupe,normalize,service}.ts` - new
  `commercial_work_async_delivery_evaluated` event type (observability,
  section 12), same pattern as the pre-existing
  `commercial_work_inbound_cycle_completed`.
- `scripts/autonomous-commercial-work-worker.ts` - logs the new
  `asyncDelivery` tick summary and the new flag at startup.
- `tests/commercial/commercialWorkAsyncDelivery.test.ts` (new).

No migration. No change to `commercialWorkExecutor.ts`, `dispatchCommercialWorkResponse.ts`,
`buildCommercialWorkFinalizerMessage.ts`, `settleCommercialWorkProjection.ts`,
`followup/*`, `execution-gate/*`, `action-queue/*`, or any capability.

## 12. Tests

New file `tests/commercial/commercialWorkAsyncDelivery.test.ts` (DB-backed,
MariaDB `crm_test`, same conventions as `commercialWorkRetryWorker.test.ts`):

- `CWAD-A/H` - `temporarily_blocked` produces zero delivery
  (`WAITING_SYSTEM` excluded); a later successful retry produces exactly one
  action + one outbox row, message grounded in `buildCommercialWorkFinalizerMessage`'s
  own `CREATE_QUOTE` completion clause.
- `CWAD-B/L` - a second tick over an already-delivered work (no due step
  left) adds zero action/outbox rows.
- `CWAD-C` - a work forced directly to `COMPLETED` (simulating "capability
  succeeded and persisted, then the worker process crashed before
  dispatch") is delivered exactly once by the sweep on the next tick.
- `CWAD-E` - `human_owner_active=true` on an already-`COMPLETED` work:
  outbox untouched, durable `COMPLETED` status unaffected.
- `CWAD-F` - `ai_enabled=false`: same suppression.
- `CWAD-G` - a `COMPLETED` work forced to `SUPERSEDED` (the only status
  `COMPLETED` may transition to, per `transitions.ts`): never delivered.
- `CWAD-I` - a `CREATE_QUOTE` step exhausted to `FAILED` (same pattern as
  `CWRT11`): delivered once, message asserted to NOT contain the
  success-clause wording (`"cotización quedó creada"`) - no false success.
- `CWAD default-off` - `asyncDeliveryEnabled` omitted: zero sweep candidates,
  zero action/outbox rows - proves the pre-existing worker behavior
  (`commercialWorkRetryWorker.test.ts`, unmodified) needed no change, since
  the new seam is opt-in.

Combined coverage of the brief's 12 named scenarios (A-L): D (crash after
action creation, before outbox) and L (duplicate worker execution) are
covered by the same idempotency mechanism CWAD-B exercises directly (repeated
`dispatchCommercialWorkResponse` calls for the same `work.publicId:version`);
J (synchronous path unchanged) and K (existing followup unchanged) are
validated by leaving `commercialWorkInboundCycle.test.ts`,
`buildCommercialWorkFinalizerMessage.test.ts`, and the followup test files
completely untouched, never by a new assertion.

## 13. Validation run in this environment

- `npx tsc --noEmit` - clean.
- `npx eslint` on every changed/new `lib`/`scripts` file - 0 errors, 0
  warnings.
- `npm run build` - 30/30 pages, clean (pre-existing unrelated
  `no-unused-vars` warnings only, same baseline other R3 entries in this doc
  already recorded).
- `git diff --check` - clean (CRLF/LF advisory only, pre-existing repo
  convention).

**Not run**: `tests/commercial/commercialWorkAsyncDelivery.test.ts` and the
rest of the DB-backed suite (`commercialWorkRetryWorker.test.ts`,
`commercialWorkInboundCycle.test.ts`, `buildCommercialWorkFinalizerMessage.test.ts`,
`createQuoteCapability`, handoff/control, followup, outbox, `npm test`) -
this environment has no reachable MariaDB (`127.0.0.1:3306` refused) and no
running Docker daemon to bring up `infra/docker-compose.dev.yml`, the same
"no network/DB route" limitation this workstream's own prior entries
(`TR-B4`/`TR-B4.1`/`TR-B5`/`CAPABILITY-SEMANTICS-COMMERCIAL-POLICY-V1`)
already recorded in this file. The new test file was written to the same
conventions and manually traced against `transitions.ts`'s status-transition
table to confirm every direct `updateCommercialWorkAggregate` fixture call in
it is a legal transition. **This must be run for real before this task is
considered closed** - flagged explicitly, not silently assumed green.

## 14. Tool hardening impact

Closes the specific gap the task named: `create_quote` deciding ->
`temporarily_blocked` -> durable retry -> durable success -> the
customer-visible result now reaches the outbox without the customer sending
another message, with the same zero-false-confirmation and
zero-duplicate-message guarantees the synchronous path already had.

## 15. Remaining gaps (explicit, non-blocking)

- **Not executed against a real DB in this session** (section 13) - the
  single largest open item. Run the full validation checklist (section 17 of
  the task brief) before rollout.
- **`FAILED` finalizer wording, pre-existing, not fixed here**:
  `buildCommercialWorkFinalizerMessage` has no dedicated `FAILED` branch - a
  work whose only objectives are `FAILED` falls to the generic "necesito un
  momento más para revisar tu consulta" fallback, which reads as "still
  working" rather than "this could not be completed." Confirmed this is
  identical, pre-existing behavior for the SYNCHRONOUS path too (not
  introduced or worsened by this task) - per the brief's explicit
  instruction ("do not invent a new customer-notification policy unless an
  existing finalizer already defines one"), left as-is and flagged here
  rather than silently patched.
- **Default `false`**: `BRAIN_COMMERCIAL_WORK_ASYNC_DELIVERY_ENABLED` ships
  off, independent of `BRAIN_COMMERCIAL_WORK_WORKER_ENABLED` - matches this
  repo's standing rollout discipline (every worker-facing flag in
  `autonomousRuntimeConfig.ts` defaults `false`). Needs an explicit operator
  decision plus real-DB test evidence before flipping.
- **Recovery sweep re-evaluates already-delivered rows within its lookback
  window every tick** (marked `ponytail:` in the code) - cheap and correct
  at this pilot's scale (idempotent, indexed query); revisit with a
  watermark only if sweep volume ever becomes measurable.
- **Identity-gated deferred steps** (`LOAD_PURCHASE_HISTORY`/
  `LOAD_RECOMMENDATION_SIGNAL`): the seam's `settleCommercialWorkProjection`
  call never threads a `trustedCustomerSession` (the worker has no live
  customer session) - pre-existing behavior, those capabilities already fail
  closed without one; not a new gap, just newly reachable via the recovery
  sweep for those objective types.

## 16. Final verdict

`ASYNC_RESULT_DELIVERY_V1_IMPLEMENTED_LOCAL_DB_UNAVAILABLE` - implementation,
reasoning, and static validation (typecheck/eslint/build/diff-check) are
complete and clean; the DB-backed acceptance/regression tests described in
section 12/13 were written but could not be executed in this environment and
must be run before this task is treated as closed.
