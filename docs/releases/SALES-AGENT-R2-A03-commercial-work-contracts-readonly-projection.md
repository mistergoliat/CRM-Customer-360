# SALES-AGENT-R2-A03 - CommercialWork Contracts and Read-Only Projection

Status: completed  
Scope: read-only technical implementation  
Production behavior changed: NO

## 1. What was implemented

A new isolated module was added under:

```text
lib/brain/commercial/work/
```

It defines the first technical version of:

```text
CommercialWork
CommercialObjective
CommercialWorkStep
CommercialTrigger
CommercialWorkProjection
```

The implementation is:

```text
READ-ONLY
NON-PERSISTENT
NON-ROUTING
NO BEHAVIOR CHANGE
```

No runtime production path imports or calls the projection builder. The builder does not query DB, call the LLM, call `executeGovernedCapability`, write actions, write outbox rows, create events, or schedule follow-ups.

## 2. Files

Created:

```text
lib/brain/commercial/work/statuses.ts
lib/brain/commercial/work/objectiveTypes.ts
lib/brain/commercial/work/stepTypes.ts
lib/brain/commercial/work/types.ts
lib/brain/commercial/work/deriveCommercialObjectives.ts
lib/brain/commercial/work/deriveCommercialWorkSteps.ts
lib/brain/commercial/work/evaluateCommercialWork.ts
lib/brain/commercial/work/buildCommercialWorkProjection.ts
lib/brain/commercial/work/formatCommercialWorkProjection.ts
lib/brain/commercial/work/index.ts
tests/commercial/commercialWorkProjection.test.ts
docs/releases/SALES-AGENT-R2-A03-commercial-work-contracts-readonly-projection.md
```

## 3. Contract summary

### CommercialTrigger

V1 supports:

```text
CUSTOMER_MESSAGE
FOLLOW_UP_DUE
WORK_RETRY_DUE
SYSTEM_EVENT
HANDOFF
```

A03 primarily tests `CUSTOMER_MESSAGE`, but the union is not WhatsApp-only.

### CommercialWorkStatus

V1:

```text
ACTIVE
WAITING_CUSTOMER
WAITING_SYSTEM
COMPLETED
CANCELLED
SUPERSEDED
HANDOFF
FAILED
```

`RUNNING` is intentionally not a work-level status in A03 because no work execution/worker exists yet.

### CommercialObjectiveStatus

V1:

```text
PENDING
READY
IN_PROGRESS
COMPLETED
WAITING_CUSTOMER
WAITING_SYSTEM
BLOCKED
CANCELLED
SUPERSEDED
FAILED
```

### CommercialWorkStepStatus

V1:

```text
PENDING
READY
COMPLETED
BLOCKED
WAITING_CUSTOMER
WAITING_SYSTEM
RETRY_SCHEDULED
CANCELLED
SUPERSEDED
FAILED
```

`RUNNING` is omitted because A03 does not execute or claim steps.

## 4. Objectives and steps

Objective types implemented:

```text
DISCOVER_PRODUCTS
COMPARE_PRODUCTS
RECOMMEND_PRODUCTS
SELECT_PRODUCTS
CHANGE_QUANTITY
SET_DESTINATION
GET_SHIPPING_QUOTE
SELECT_SHIPPING_OPTION
CREATE_QUOTE
HANDOFF
```

Step types implemented:

```text
SEARCH_PRODUCTS
GET_PRODUCT_DETAILS
RECOMMEND_PRODUCTS
SELECT_PRODUCTS
SET_SHIPPING_DESTINATION
CALCULATE_SHIPPING
SELECT_SHIPPING_OPTION
CREATE_QUOTE
HANDOFF
```

Payment, checkout and order are intentionally not modeled as active objectives.

## 5. Projection input

`buildCommercialWorkProjection(input)` receives already-loaded state:

```text
trigger
conversation
opportunity
objectiveSeeds
pendingCommercialIntents
commercialLineItems
shippingDestination
selectedShippingOption
createdQuote
recentCapabilityExecutions
recentCommercialEvents
now
```

The builder does not load this state. This keeps data loading separate from deterministic derivation.

## 6. Evidence used

The projection references evidence instead of copying full commercial payloads:

```text
request_fact
capability_execution
commercial_event
agent_action
conversation_state
```

Important anchors:

- `commercial_line_items.factId`;
- `shipping_destination.factId`;
- `selected_shipping_option.factId`;
- `created_quote.factId`;
- `created_quote.selectionFactId`;
- `calculate_shipping` execution `publicId`;
- `calculate_shipping.responseSummaryJson.selectionFactId`;
- `calculate_shipping.responseSummaryJson.destinationFactId`;
- conversation handoff/AI-disabled state.

## 7. What can be derived today

A03 proves the runtime can deterministically derive these from existing state plus explicit objective seeds:

- selection completed from active `commercial_line_items`;
- destination completed from active `shipping_destination`;
- shipping quote ready when selection + destination exist and fresh shipping evidence is absent;
- shipping quote completed when latest `calculate_shipping` evidence matches current fact ids;
- shipping evidence stale when selection or destination fact ids changed;
- shipping waiting system when latest shipping execution is retryable/temporarily blocked;
- quote ready with current real dependency: selected line items only;
- quote completed when `created_quote.selectionFactId` matches active selection fact;
- quote stale when selection changed after quote creation;
- handoff/AI disabled block autonomous steps;
- pending semantic intent plus facts can become executable work without another LLM call.

## 8. What cannot be derived

A03 deliberately does not infer:

- requested shipping quote from facts alone;
- requested discovery from recent catalog context alone;
- requested quote from selected products alone;
- follow-up eligibility rows;
- durable cancellation of prior persisted work;
- worker retry dates;
- payment/checkout/order state;
- provider availability as a global blocker unless explicitly supplied later.

This distinction is critical:

```text
STATE EXISTS
```

does not mean:

```text
OBJECTIVE EXISTS
```

## 9. Semantic state vs execution state

Example validated by test:

```text
pending_commercial_intents says:
GET_SHIPPING_QUOTE exists

durable facts say:
commercial_line_items exists
shipping_destination exists

CommercialWorkProjection says:
GET_SHIPPING_QUOTE objective = READY
CALCULATE_SHIPPING step = READY
```

The semantic state identifies requested work. The projection reconciles it against existing durable facts and capability evidence to decide execution readiness.

## 10. Facts alone are insufficient

Test coverage confirms:

```text
selection exists
destination exists
objectiveSeeds = []
```

produces:

```text
objectives = []
steps = []
```

Therefore the projection represents:

```text
requested work reconciled with state
```

not:

```text
all theoretically possible next actions
```

## 11. C09 result

The critical C09 case is covered:

```text
selection exists
destination exists
shipping evidence absent
objective includes GET_SHIPPING_QUOTE
```

Projection:

```text
SELECT_PRODUCTS -> COMPLETED
GET_SHIPPING_QUOTE -> READY
CALCULATE_SHIPPING step -> READY
```

This proves the key A03 experiment: after selection and destination are durable, the remaining shipping work can be identified deterministically without another LLM inference.

## 12. A02 assumptions validated

Validated:

- `CommercialWork` can be represented as a read-only projection before persistence.
- Objective seeds are required; facts alone are not objectives.
- Existing fact ids are enough to check shipping/quote freshness.
- Query/command execution does not need to be decided by the LLM once objectives and facts are known.
- Waiting customer and waiting system can be distinguished.
- Handoff belongs to conversation/control state and blocks autonomous steps.

## 13. A02 assumptions adjusted

Adjusted:

- `RUNNING` should not be present in A03 contracts because no worker/claim lifecycle exists yet.
- `attemptCount`, `nextAttemptAt`, and worker locks are deferred.
- Follow-up eligibility was not added because it would invite premature runtime semantics.
- `CommercialWork` persistence remains the likely next gap, but A03 should not decide schema shape yet.

## 14. Validation

Commands run:

```powershell
npx tsc --noEmit
npx --yes tsx@4.20.5 --test tests/commercial/commercialWorkProjection.test.ts
npm test -- tests\commercial\commercialWorkProjection.test.ts
npx --yes tsx@4.20.5 --test tests/agent-loop/multi-intent/executionPlanner.test.ts tests/agent-loop/multi-intent/requirementResolver.test.ts tests/agent-loop/multi-intent/actionPlanExecutor.test.ts tests/agent-loop/multi-intent/buildMultiIntentResponseContract.test.ts tests/commercial/requestFacts.test.ts tests/domains/shippingDestination.test.ts tests/domains/selectedShippingOption.test.ts tests/domains/createdQuote.test.ts tests/commercial/calculateShippingCapability.test.ts tests/commercial/createQuoteCapability.test.ts tests/commercial/assembleQuoteInput.test.ts
npm run build
```

Results:

- Typecheck: PASS.
- New A03 projection tests: PASS, 29/29.
- Focused existing regression batch: 122/127 PASS, 5 existing capability tests failed outside the new module.
- Build: FAIL/TIMEOUT, `npm run build` did not complete within the 180s command budget; build-spawned Node processes were cleaned up.

Observed existing regression failures:

- `tests/commercial/calculateShippingCapability.test.ts` expected the older projected payload without internal `selectionFactId`/`destinationFactId` and option `index`.
- `tests/commercial/createQuoteCapability.test.ts` had four failures where current Quote capability behavior returned `temporarily_blocked` or included extra `opportunityId` detail versus test expectations.

These failures are in pre-existing tests/capabilities and were not caused by A03 files, which are isolated and not imported by runtime/capability code.

## 15. Final decision

A03 validates the model enough to recommend:

```text
PERSIST_COMMERCIAL_WORK
```

Reason:

The pure projection can reconstruct objectives, completed facts, remaining deterministic work, stale evidence, waiting-customer, waiting-system, quote readiness, and handoff blocking from existing state plus explicit objective seeds. The next gap is not conceptual modeling; it is durable work/step state and recovery.

```text
SALES-AGENT-R2-A03: DONE

CommercialWork contracts:
IMPLEMENTED

CommercialObjective contracts:
IMPLEMENTED

CommercialWorkStep contracts:
IMPLEMENTED

CommercialTrigger contracts:
IMPLEMENTED

Read-only projection:
IMPLEMENTED

Runtime production wiring:
NO

New persistence:
NO

New DB tables:
NO

New workers:
NO

LLM calls from projection:
0

Capability executions from projection:
0

C09 projection:
PASS

C09 selection completed:
COMPLETED

C09 destination completed:
COMPLETED

C09 calculate_shipping:
READY

Missing destination:
WAITING_CUSTOMER

Shipping unavailable:
WAITING_SYSTEM

Quantity change invalidates shipping:
PASS

Destination change invalidates shipping:
PASS

Create quote READY:
PASS

Create quote COMPLETED:
PASS

Stale quote rejected:
PASS

Handoff autonomous block:
PASS

Facts without objective create work:
NO

Projection deterministic:
YES

Projection side effects:
0

Typecheck:
PASS

Targeted tests:
PASS - commercialWorkProjection 29/29; focused existing regression batch 122/127 with 5 pre-existing capability expectation failures documented above

Build:
FAIL - timed out after 180s

Production thinking changed:
NO

Production routing changed:
NO

Follow-up activation changed:
NO

ACTIVE_RELEASE changed:
NO

Verdict:
COMMERCIAL_WORK_MODEL_VALIDATED

Recommended next:
PERSIST_COMMERCIAL_WORK - define the minimal durable CommercialWork/CommercialWorkStep persistence contract and recovery semantics, still behind no production routing.
```
