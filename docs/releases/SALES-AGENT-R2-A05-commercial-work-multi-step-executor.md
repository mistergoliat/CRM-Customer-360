# SALES-AGENT-R2-A05 - CommercialWork Multi-Step Executor

Status: completed  
Scope: dev/test executor module + tests, no production wiring  
Production behavior changed: NO

## 1. Summary

A05 implements the first `CommercialWork` executor over the A03/A04 aggregate:

```text
load CommercialWork by public_id + expectedVersion
-> evaluate eligible READY step
-> revalidate current facts/conversation control
-> execute exactly one supported primitive through executeGovernedCapability
-> persist aggregate result with optimistic version
-> repeat until maxSteps, no READY work, or terminal state
```

The executor is exported from `lib/brain/commercial/work` for controlled callers and tests, but is not connected to inbound routing, a worker, follow-up activation, finalizers, outbox, or customer responses.

## 2. Supported V1 Step Types

Executable in A05:

```text
SELECT_PRODUCTS
SET_SHIPPING_DESTINATION
CALCULATE_SHIPPING
CREATE_QUOTE
```

Unsupported step types return a structured blocked result and persist the step as `BLOCKED` with an `UNSUPPORTED` blocker. They never throw uncontrolled errors and never bypass the Capability Gateway.

## 3. Version And Authority

The executor accepts only:

```text
workPublicId + expectedVersion
```

It always reloads the persisted aggregate from `crm_commercial_work` before executing. A stale expected version returns `version_conflict` and performs no mutation.

No unversioned in-memory work object can authorize execution.

## 4. Execution Rules

Eligibility requires:

- work is non-terminal;
- conversation autonomy is still valid (`human_owner_active = 0`, `ai_enabled = 1`);
- step is `READY`;
- dependencies are satisfied against current facts;
- the step type is supported;
- stale fact anchors are not detected.

Dependency cycles using `STEP_COMPLETED` are detected and returned as a structured block before any capability call.

Step order is deterministic:

```text
SELECT_PRODUCTS -> SET_SHIPPING_DESTINATION -> CALCULATE_SHIPPING -> CREATE_QUOTE -> others
```

## 5. Persistence Strategy

Each step result is persisted immediately through:

```text
updateCommercialWorkAggregate(publicId, expectedVersion, nextWork)
```

No external capability call is wrapped in a long DB transaction. The repository keeps the aggregate optimistic-lock invariant from A04.

After each step, the executor refreshes objective/step/work status and reactivates only prereq/customer-input blockers. It deliberately does not auto-reopen steps blocked by `STALE_EVIDENCE` or `UNSUPPORTED`.

## 6. Evidence Repair

When current durable facts already satisfy a READY step, the executor completes that step without calling the gateway:

```text
SELECT_PRODUCTS -> current commercial_line_items match requested items
SET_SHIPPING_DESTINATION -> current destination matches requested destination
CREATE_QUOTE -> current created_quote matches current selectionFactId
```

This repairs persisted work state after restart/reprojection gaps without duplicating side effects.

## 7. Capability Gateway Boundary

Actual primitive execution uses:

```text
executeGovernedCapability(capabilityName, input, context)
```

The executor maps gateway outcomes into work states:

- `completed` -> step `COMPLETED`, unless the capability reports a business gap that still needs customer input.
- `temporarily_blocked` -> step `WAITING_SYSTEM`, retry candidate.
- `missing_information` -> step `WAITING_CUSTOMER`.
- `invalid_arguments` / `denied` / `failed` / `requires_approval` -> step `FAILED`.

Tests use an injected gateway function for isolation, but the production default is the real governed gateway.

## 8. Side-Effect Boundary

A05 does not add:

```text
worker
route handler
inbound hook
follow-up activation
LLM call
outbox write
customer-visible response
agent action queue write
finalizer
```

The regression test explicitly checks that executor runs do not create `crm_agent_actions` or `brain_message_outbox` rows.

## 9. Related Fixes

Before closing A05, the five known shipping/quote regressions were resolved:

- `calculate_shipping` test expectation now includes the real internal evidence anchors and option index.
- `create_quote` exposes a test-only assembly dependency seam so tests can inject Catalog without configuring an external service.
- `create_quote` no-line-items expectation now includes the assembler's real `opportunityId` detail.

## 10. Validation

Executed:

```powershell
npx tsc --noEmit
npx --yes tsx@4.20.5 --test tests/commercial/calculateShippingCapability.test.ts tests/commercial/createQuoteCapability.test.ts
npx --yes tsx@4.20.5 --test tests/commercial/commercialWorkExecutor.test.ts
npx --yes tsx@4.20.5 --test tests/commercial/commercialWorkProjection.test.ts tests/commercial/commercialWorkRepository.test.ts tests/commercial/commercialWorkTransitions.test.ts
npm run build
```

Results:

```text
typecheck: pass
shipping + quote: 23/23 pass
executor: 8/8 pass, covering CWEX01-CWEX26 labels
A03/A04 projection + repository + transitions: 45/45 pass
build: pass, with pre-existing lint warnings only
```

Broader A03/A04 validation should still be run before merging if the branch is bundled with unrelated dirty worktree changes.
