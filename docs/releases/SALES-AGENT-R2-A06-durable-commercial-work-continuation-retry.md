# SALES-AGENT-R2-A06 - Durable CommercialWork Continuation and Retry

Status: completed  
Scope: dev/test durable worker + migration + tests, no production wiring  
Production behavior changed: NO

## 1. Summary

A06 adds durable continuation and bounded technical retry for `CommercialWork` by introducing a callable worker tick over the A03/A04 persisted aggregate and the A05 executor.

The worker can resume incomplete commercial work after the original request process ends:

```text
select due step
-> claim step with CAS lease
-> execute via A05 executor
-> persist result
-> schedule retry, complete work, or terminalize failure
```

It is exported for tests and future infrastructure integration, but it is not connected to PM2, cron, startup, API routes, WhatsApp inbound, follow-up scheduling, outbox delivery, finalizers, or customer-visible responses.

## 2. Lifecycle Fields

Migration `030_crm_commercial_work_retry_lifecycle.sql` extends `crm_commercial_work_steps` with:

```text
attempt_count
max_attempts
next_attempt_at
started_at
last_attempt_at
lock_owner
lock_until
```

Scheduling remains step-level. A06 does not duplicate `next_attempt_at` on `crm_commercial_work` because retries are step-specific and the step is the actual execution unit.

## 3. RUNNING And Leases

A06 adds `RUNNING` to the step lifecycle.

Primary transitions:

```text
READY -> RUNNING
RETRY_SCHEDULED -> RUNNING
RUNNING -> COMPLETED
RUNNING -> WAITING_SYSTEM
RUNNING -> RETRY_SCHEDULED
RUNNING -> WAITING_CUSTOMER
RUNNING -> FAILED
RUNNING -> BLOCKED
RUNNING -> CANCELLED
RUNNING -> SUPERSEDED
```

Claims use compare-and-swap semantics against the current persisted step state. A worker claim writes:

```text
status = RUNNING
lock_owner = workerId
lock_until = now + lease
started_at / last_attempt_at
attempt_count = attempt_count + 1
```

Active leases are not selectable by other workers. Expired `RUNNING` steps are selectable for recovery.

## 4. Retry Policy

Retry policy lives in `lib/brain/commercial/work/retryPolicy.ts`.

V1 policies:

```text
SELECT_PRODUCTS             maxAttempts 2
SET_SHIPPING_DESTINATION    maxAttempts 2
CALCULATE_SHIPPING          maxAttempts 3
CREATE_QUOTE                maxAttempts 3
```

`SELECT_PRODUCTS` and `SET_SHIPPING_DESTINATION` are retry-enabled only because their A05 evidence repair and stable idempotency make repeat execution safe.

Retryable A06 outcome:

```text
temporarily_blocked
```

Non-retry outcomes:

```text
missing_information
invalid_arguments
denied
requires_approval
failed
stale evidence blocks
unsupported steps
```

## 5. Backoff And Scheduling

When A05 returns a retryable system wait and `scheduleRetries` is enabled by the worker, A06 maps:

```text
WAITING_SYSTEM -> RETRY_SCHEDULED
next_attempt_at = now + bounded exponential backoff
```

Backoff is deterministic and capped:

```text
delay = min(baseDelayMs * 2^(attempt - 1), maxDelayMs)
```

The worker never sleeps or busy-loops. One tick selects a bounded batch, processes it, and returns a structured summary.

## 6. Worker Boundary

Worker implementation:

```text
lib/brain/commercial/work/worker/commercialWorkWorker.ts
```

Public entry point:

```text
runCommercialWorkTick({
  batchSize,
  now,
  workerId,
  executeCapability,
  loadCurrentFacts,
  loadConversationControl
})
```

Worker responsibilities:

```text
find due work
claim step
detect stale RUNNING
call A05 executor
return execution summary
```

A05 executor remains authoritative for:

```text
dependency checks
conversation-control revalidation
evidence repair
capability execution
step/objective/work advancement
optimistic persistence
```

## 7. Stale Recovery And Evidence Repair

Before retrying a stale `RUNNING` step, the worker delegates to the A05 executor, which first reloads durable facts and repairs completed evidence without calling the gateway again.

Covered case:

```text
CREATE_QUOTE RUNNING
quote fact exists
lock expired
-> worker claims
-> executor sees created_quote evidence
-> step COMPLETED
-> capability calls = 0
```

This validates crash-after-side-effect recovery without duplicate mutation.

## 8. Stable Idempotency

Each persisted step keeps one stable `idempotency_key`.

The repository preserves that key across:

```text
initial execution
retry scheduling
future retry claim
stale RUNNING recovery
restart
```

A06 does not generate a new key per attempt.

## 9. Critical Continuation

The main A06 test validates:

```text
SELECT_PRODUCTS       COMPLETED
SET_DESTINATION       COMPLETED
CALCULATE_SHIPPING    RETRY_SCHEDULED
CREATE_QUOTE          BLOCKED
original executor ends
new worker tick starts later
CALCULATE_SHIPPING    COMPLETED
CREATE_QUOTE          COMPLETED
CommercialWork        COMPLETED
```

Assertions:

```text
customer messages required = 0
LLM calls = 0
outbox writes = 0
customer action writes = 0
duplicate mutations = 0
```

This proves operational continuation outside the original customer turn.

## 10. Limitations

A06 deliberately does not implement:

```text
production worker activation
customer follow-up
customer response after work completes
conversation sequencing
parallel execution
generic event broker
new scheduler infrastructure
LLM loop
```

It is acceptable in A06 for `CommercialWork` to become `COMPLETED` without informing the customer. UX completion and objective-aware follow-up belong to A07.

## 11. Migration Note

A06 adds an additive migration and does not modify the A04 migration.

The pre-existing checksum drift in `026_sales_agent_configurations.sql` remains separate from A06. The new migration was validated directly against the local `crm_test` harness because the full migration runner remains blocked by that pre-existing checksum issue.

## 12. Validation

Executed:

```powershell
npx tsc --noEmit
npm run typecheck
npx --yes tsx@4.20.5 --test tests/commercial/calculateShippingCapability.test.ts tests/commercial/createQuoteCapability.test.ts tests/commercial/commercialWorkProjection.test.ts tests/commercial/commercialWorkRepository.test.ts tests/commercial/commercialWorkTransitions.test.ts tests/commercial/commercialWorkExecutor.test.ts tests/commercial/commercialWorkRetryWorker.test.ts
npx --yes tsx@4.20.5 --test tests/commercial/commercialWorkRetryWorker.test.ts
npx --yes tsx@4.20.5 --test tests/commercial/actionLifecycleContract.test.ts tests/commercial/actionQueueViewModel.test.ts tests/commercial/outboxWorker.test.ts tests/commercial/followUpScheduling.test.ts tests/commercial/followUpRuntimeAuthority.test.ts tests/commercial/followUpRevalidationAndOptOut.test.ts tests/commercial/followUpReplanning.test.ts tests/commercial/followUpPlanner.test.ts tests/commercial/followUpPlanAdapter.test.ts tests/commercial/followUpDispatchPolicy.test.ts tests/domains/followUpObservability.test.ts tests/e2e/followUpRestartRecovery.e2e.test.ts
npm run build
```

Results:

```text
A03/A04/A05/shipping/quote/A06: 83/83 pass
A06 retry worker: 7/7 pass, covering CWRT01-CWRT25 labels
action/follow-up/outbox unit + follow-up restart: 273/273 pass
typecheck: pass
build: pass, with pre-existing lint warnings only
```

Outbox delivery/native e2e tests that select from `brain_message_outbox` remain affected by local shared DB accumulation: `crm_test` had 1,945 due `planned` rows and `main_management` had 1,566 due `planned` rows, while those tests select the first 200 rows before filtering by `outboxIds`. They were not used as A06 pass/fail evidence because the failure is local harness selection pollution, not an A06 code path.

## 13. Next Step

Recommended next:

```text
SALES-AGENT-R2-A07 - objective-aware follow-up integration
```

A07 should decide how completed or customer-blocked `CommercialWork` creates customer-visible follow-up without weakening the A06 side-effect boundary.
