# SALES-AGENT-R2-A04 - Durable CommercialWork Persistence

Status: completed  
Scope: DB schema + repository + tests, no runtime wiring  
Production behavior changed: NO

## 1. Summary

A04 implements the first durable persistence layer for the A03 `CommercialWork` model:

```text
build projection
-> persist CommercialWork aggregate
-> process ends
-> load CommercialWork aggregate
-> recover same logical state
```

No worker, autonomous executor, inbound hook, follow-up activation, production routing change, LLM call, capability execution, customer-visible message, or outbox write was added.

## 2. Existing Tables Reviewed

The existing tables are still the right owners for their current responsibilities:

| Table | Decision |
| --- | --- |
| `crm_request_facts` | Commercial truth. It can store selected products, destination, selected shipping option, and created quote facts, but not objective/step lifecycle, dependencies, retries, or aggregate versioning cleanly. |
| `crm_agent_actions` | Customer/operator action boundary. It has action status and idempotency, but using it for objective/step graphs would mix response/follow-up actions with hidden execution state. |
| `commercial_event` | Audit/event evidence. It is append-only evidence, not a queryable current unfinished-work aggregate unless every runtime decision replays history. |
| `crm_capability_executions` | Capability execution evidence. It proves what ran and with what evidence, but it does not represent remaining executable work. |

Conclusion:

```text
new CommercialWork persistence is required
```

## 3. Schema Chosen

A04 uses Option B:

```text
crm_commercial_work
crm_commercial_work_objectives
crm_commercial_work_steps
```

Rejected:

```text
objectives_json in crm_commercial_work
```

Reason: objective status, supersession, waiting states, and future reconciliation need queryable rows. Keeping objectives only as JSON would make the first recovery model simpler to write but harder to audit and evolve.

## 4. Work Identity And Correlation

`public_id` is the durable external work id.

`correlation_key` is unique and idempotent:

```text
commercial-work:v1:opportunity:<id|none>:conversation:<id>:<stable objective fingerprint>
```

The fingerprint uses objective type, origin, and normalized inputs, not raw customer text. V1 allows multiple active works per opportunity/conversation when the objective bundle differs; it does not force "one active work per opportunity" because that would be too restrictive for parallel or unrelated commercial requests.

Same logical projection replay:

```text
same correlation_key -> duplicate result -> existing work returned
```

## 5. Versioning And Concurrency

`crm_commercial_work.version` is the aggregate optimistic lock.

All aggregate updates require:

```text
expectedVersion
```

The repository updates with:

```text
WHERE public_id = ? AND version = ?
```

and increments `version = version + 1`. Objective and step updates use the work version instead of independent child versions. This is enough for A04 and avoids premature multi-lock complexity before a worker exists.

## 6. Transitions

Pure transition guards were added:

```text
canTransitionCommercialWorkStatus
canTransitionObjectiveStatus
canTransitionStepStatus
```

Examples covered:

- `READY -> COMPLETED`: allowed.
- `WAITING_SYSTEM -> READY`: allowed.
- `COMPLETED -> READY`: rejected.
- `CANCELLED -> ACTIVE`: rejected.
- `SUPERSEDED -> COMPLETED`: rejected.
- `COMPLETED -> SUPERSEDED`: allowed only to mark historical work replaced by a newer correction, never to reopen execution.

## 7. Objective Persistence

Objectives are stored as rows with:

```text
public_id
commercial_work_id
type
origin
status
inputs_json
resolved_inputs_json
missing_requirements_json
supersedes_objective_ids_json
evidence_json
blockers_json
completed_at
cancelled_at
superseded_at
```

The JSON columns are versioned with `payload_version = '1.0'`.

## 8. Step Persistence

Steps are stored as rows with:

```text
public_id
commercial_work_id
primary_objective_public_id
objective_ids_json
step_type
capability_name
status
dependencies_json
input_json
evidence_json
blockers_json
retryable
retry_candidate
idempotency_key
completed_at
cancelled_at
superseded_at
```

No worker fields were added yet:

```text
attempt_count
next_attempt_at
lock_owner
lock_until
started_at
```

Those belong to the later executor/worker task.

## 9. Evidence Strategy

CommercialWork stores references, not duplicated commercial truth.

Examples:

```json
{ "kind": "request_fact", "factType": "commercial_line_items", "id": "fact-..." }
{ "kind": "capability_execution", "capabilityName": "calculate_shipping", "id": "..." }
```

Selected products, destination, quote, and shipping payloads remain in their existing fact/capability stores.

## 10. Recovery Behavior

The repository hydrates back into the A03 domain contracts:

```text
CommercialWork
CommercialObjective[]
CommercialWorkStep[]
```

The SQL rows are not exposed as runtime contracts.

Critical C09 proof:

```text
selection fact durable
destination fact durable
GET_SHIPPING_QUOTE objective exists
calculate_shipping evidence absent
```

Persists and reloads as:

```text
CALCULATE_SHIPPING = READY
```

without LLM calls or capability executions.

## 11. Limits

A04 does not execute READY steps. This is mandatory:

```text
CALCULATE_SHIPPING = READY
```

now survives restart/reload, but no worker consumes it yet.

No automatic create from inbound was added. Persistence is invoked only by tests/dev code.

## 12. Validation

Passed:

```powershell
npx tsc --noEmit
npx --yes tsx@4.20.5 --test tests/commercial/commercialWorkTransitions.test.ts
npx --yes tsx@4.20.5 --test tests/commercial/commercialWorkProjection.test.ts
npx --yes tsx@4.20.5 --test tests/commercial/commercialWorkRepository.test.ts
npm test -- tests\commercial\commercialWorkProjection.test.ts
npm test -- tests\commercial\commercialWorkTransitions.test.ts tests\commercial\commercialWorkRepository.test.ts
npm test -- tests\commercial\requestFacts.test.ts tests\commercial\agentActionQueue.test.ts tests\scripts\migrationManifest.test.ts
npx --yes tsx@4.20.5 --test tests\commercial\calculateShippingCapability.test.ts tests\commercial\createQuoteCapability.test.ts
npm run build
```

Migration validation:

- Manifest test passed.
- `npm run db:migrate -- --database=test` is blocked before A04 by pre-existing checksum drift in `026_sales_agent_configurations.sql`.
- A04 migration was applied directly to `crm_test`.
- A04 tables were then dropped and reapplied directly to validate the documented down/up SQL path.
- Repository tests passed after the direct down/up.

Related known regression status:

- `calculateShippingCapability.test.ts` + `createQuoteCapability.test.ts`: 18/23 PASS, 5 pre-existing failures unchanged from A03.
- Failures remain the same expectation drift: shipping payload now includes internal fact anchors/option index; quote tests still expect older status/details behavior.

## 13. Exit Decision

```text
DURABLE_WORK_VALIDATED
```

Reason: persistence, reload, evidence references, C09 READY recovery, WAITING_CUSTOMER, WAITING_SYSTEM, quote READY/COMPLETED, supersession, cancellation, optimistic concurrency, invalid transition rejection, completed-step reopening block, and transaction rollback all pass against local MariaDB tables.

```text
SALES-AGENT-R2-A04: DONE

CommercialWork persistence:
IMPLEMENTED

Persistence strategy:
New aggregate persistence with crm_commercial_work + crm_commercial_work_objectives + crm_commercial_work_steps. Existing facts/actions/events/capability executions remain separate authorities.

New tables:
crm_commercial_work
crm_commercial_work_objectives
crm_commercial_work_steps

Existing tables modified:
NONE

Commercial facts duplicated:
NO

Work correlation strategy:
Unique commercial-work:v1 key over opportunity, conversation, and stable objective fingerprint.

Optimistic concurrency:
IMPLEMENTED

Work versioning:
IMPLEMENTED

Objective persistence:
IMPLEMENTED

Step persistence:
IMPLEMENTED

Evidence references:
IMPLEMENTED

Transition validation:
IMPLEMENTED

C09 persisted:
PASS

C09 reload:
PASS

C09 calculate_shipping after reload:
READY

WAITING_CUSTOMER reload:
PASS

WAITING_SYSTEM reload:
PASS

Quote READY reload:
PASS

Quote COMPLETED reload:
PASS

Supersession:
PASS

Cancellation:
PASS

Stale version rejection:
PASS

Completed step reopening blocked:
PASS

Transaction atomicity:
PASS

Migration up:
PASS - direct A04 SQL apply; full runner blocked before A04 by pre-existing 026 checksum drift

Migration down:
PASS - direct DROP of A04 tables followed by direct reapply

LLM calls:
0

Capability executions:
0

Runtime production wiring:
NO

New worker:
NO

Follow-up activation:
NO

Production routing changed:
NO

Production thinking changed:
NO

ACTIVE_RELEASE changed:
NO

Typecheck:
PASS

A03 regression tests:
PASS - commercialWorkProjection 29/29

A04 tests:
PASS - commercialWorkTransitions 3/3; commercialWorkRepository 13 grouped tests covering CWDB01-CWDB28

Related regression tests:
PASS - requestFacts, agentActionQueue, migrationManifest 30/30; calculateShipping/createQuote 18/23 with the same 5 pre-existing A03 failures

Build:
PASS

Verdict:
DURABLE_WORK_VALIDATED

Recommended next:
SALES-AGENT-R2-A05 should connect durable CommercialWork to a non-production/dev-only executor plan first, still without customer-visible autonomous execution until stale-turn protection and shipping/quote regression drift are reconciled.
```
