# SALES-AGENT-R2-A02 - Commercial Execution Model Design

Status: completed  
Scope: documentation-only design/specification  
Depends on: `docs/releases/SALES-AGENT-R2-A01-autonomous-commercial-execution-architecture-audit.md`  
Production behavior changed: NO

## 1. Executive summary

This design defines the minimum evolutive execution model needed to turn the current Sales Agent into a reliable autonomous commercial agent without rewriting the working capabilities identified in A01.

The model is built around one logical execution anchor:

```text
CommercialWork
```

`CommercialWork` represents one durable commercial request or bundle of related objectives for an opportunity. It can begin from a customer message, follow-up due event, technical retry, quote event, payment event, or handoff event. It is not a chat message, not an outbox row, not a free-form LLM memory, and not a generic workflow engine.

The design separates four kinds of state:

```text
Conversation state
Commercial state
Objective state
Execution state
```

The most important design rule:

```text
The platform must always know:
- what the customer wants;
- what is already true in durable commercial state;
- what work remains;
- why it is blocked;
- whether to continue, retry, wait, follow up, respond, or hand off.
```

The LLM remains responsible for semantic interpretation, ambiguity handling, commercial reasoning, and customer-facing language. The deterministic runtime becomes responsible for dependency resolution, idempotent execution, retry scheduling, sequencing, stale-work cancellation, and evidence-grounded mutation claims.

This is not a recommendation to adopt Temporal, Kafka, RabbitMQ, LangGraph, CQRS, Saga, a new database, or a multi-agent architecture now.

Final design position:

```text
Recommended implementation strategy:
CommercialWork contract first
-> move multi-intent execution onto it
-> add quote objective
-> add durable continuation/retry
-> integrate follow-up as WAITING_CUSTOMER runtime behavior
-> add conversation sequencing
-> add safe executor-owned parallelism
```

New persistence is required partially: current tables cover facts, actions, transport, events, and capability audit, but not durable objective/step execution state with dependencies and recovery. The minimum should be a small commercial work/step persistence layer, not a broad external workflow platform.

## 2. Design principles

1. Opportunity remains the commercial anchor. Conversation is the channel/thread. Customer identity remains provisional until the Customer Master model exists.
2. The model proposes semantic intent and customer-facing language. The platform validates, executes, persists, retries, sequences, and enforces policy.
3. Durable facts remain facts. They should not become a hidden workflow log.
4. `crm_agent_actions` remains the action boundary. It should not be stretched into a complete objective/step dependency graph unless its lifecycle is explicitly extended.
5. `brain_message_outbox` remains transport. It must not become commercial work state.
6. `commercial_event` remains event/audit evidence. It must not be the only source of truth for unfinished work.
7. Every autonomous mutation must be idempotent and evidence-grounded.
8. A customer-visible future promise is allowed only when durable work exists to back it.
9. Follow-up is part of the commercial runtime, not an unrelated scheduled-message subsystem.
10. The minimum viable design should reuse the existing Capability Gateway, request facts, action queue, outbox, follow-up worker patterns, multi-intent planner/executor, quote wiring, and commercial events.

## 3. Primary execution unit

### Recommended name

```text
CommercialWork
```

Rationale:

| Candidate | Assessment |
| --- | --- |
| `CommercialExecution` | Too technical; sounds like one run, not a durable commercial request across turns. |
| `CommercialWork` | Best fit: durable, can contain objectives/steps, can pause/retry/resume. |
| `CommercialObjective` | Too narrow as primary anchor; objectives should be children of work. |
| `OpportunityWork` | Good, but overstates opportunity anchoring when a work item may originate from conversation/follow-up/system event. |
| `SalesWorkItem` | Too queue-like; risks making work queue the domain center. |

### Definition

`CommercialWork` is a durable execution envelope for a coherent commercial request associated with an opportunity.

It survives:

- multiple tool calls;
- multiple turns;
- retries;
- process restart;
- delayed work;
- follow-up;
- customer silence;
- temporary service failure;
- later customer corrections.

It relates to:

| Field | Purpose |
| --- | --- |
| `commercialWorkId` | Stable public id. |
| `opportunityId` | Primary commercial anchor. |
| `conversationId` | Channel/thread that triggered or owns the customer interaction. |
| `sourceMessageId` | First or latest customer message that created/modified it. |
| `waId` / provisional customer identity | Current identity bridge, not Customer Master. |
| `triggerId` | Event/action/retry/follow-up that caused the current cycle. |
| `status` | Work-level status: active/waiting/retry/completed/cancelled/failed/handoff. |
| `objectives` | What the customer/system wants to accomplish. |
| `steps` | Concrete executable work required to satisfy objectives. |
| `version` | Optimistic concurrency/sequencing guard. |

### What it is not

`CommercialWork` is not:

- a replacement for `crm_opportunities`;
- a replacement for `crm_request_facts`;
- a replacement for `crm_agent_actions`;
- a new Customer Master;
- a full external workflow engine;
- a second LLM agent;
- an outbox message.

## 4. Four state types

### A. Conversation state

Exists today:

- `conversation`;
- `conversation_message`;
- `conversation.human_owner_active`;
- `conversation.ai_enabled`;
- message timeline;
- channel/account identity;
- delivery projections.

Future role:

Conversation state answers:

```text
Can the agent speak on this thread?
Who owns the conversation?
What did the customer say most recently?
Is the thread open, closed, waiting customer, waiting system, or human-owned?
```

It must not answer:

```text
What products are selected?
What work remains?
What quote is active?
```

### B. Commercial state

Exists today:

- `crm_opportunities`;
- `crm_sales_need_profiles`;
- `crm_request_facts` for `commercial_line_items`;
- `crm_request_facts` for `shipping_destination`;
- selected shipping option fact;
- created quote fact;
- `crm_capability_executions` as capability evidence.

Commercial state answers:

```text
What is true about the sale?
What products are selected?
What destination is confirmed?
What quote exists?
What option was selected?
```

It does not answer:

```text
What step should execute next?
Why is quote creation blocked?
When should shipping retry?
```

### C. Objective state

Exists today:

- Partially in multi-intent semantic intents.
- Partially in pending intent facts.
- Partially in action rows/follow-up plans.
- Not as a common model.

Objective state answers:

```text
What outcome is the customer or system trying to achieve?
```

Examples:

- `DISCOVER_PRODUCTS`;
- `COMPARE_PRODUCTS`;
- `SELECT_PRODUCTS`;
- `CHANGE_QUANTITY`;
- `SET_DESTINATION`;
- `GET_SHIPPING_QUOTE`;
- `CREATE_QUOTE`;
- `SEND_QUOTE`;
- `WAIT_FOR_QUOTE_APPROVAL`;
- `CHECKOUT`;
- `WAIT_FOR_PAYMENT`;
- `HANDOFF`.

### D. Execution state

Exists today:

- Follow-up has planned/executing/failed/executed.
- Outbox has planned/locked/sending/sent/failed.
- Capability executions have completed/failed/etc.
- Agent loop has in-memory step state.

Missing:

A common execution state for commercial objectives and their steps.

Recommended vocabulary:

```text
PENDING
READY
RUNNING
COMPLETED
FAILED
BLOCKED
WAITING_CUSTOMER
WAITING_SYSTEM
RETRY_SCHEDULED
CANCELLED
SUPERSEDED
HANDOFF
```

## 5. Commercial objective model

### Contract shape

Conceptual V1:

```json
{
  "objectiveId": "obj_...",
  "objectiveType": "GET_SHIPPING_QUOTE",
  "origin": "CUSTOMER_REQUESTED",
  "status": "PENDING",
  "priority": "normal",
  "inputs": {
    "destinationText": "Nunoa"
  },
  "resolvedInputs": {
    "destinationFactId": null,
    "lineItemsFactId": null
  },
  "missingRequirements": [
    "PRODUCT_SELECTION"
  ],
  "supersedesObjectiveIds": [],
  "createdFromTriggerId": "trigger_...",
  "createdAt": "iso",
  "updatedAt": "iso"
}
```

### Required fields for V1

| Field | Required | Reason |
| --- | --- | --- |
| `objectiveId` | YES | Stable references/dependencies. |
| `objectiveType` | YES | Determines planner/executor rules. |
| `origin` | YES | Separates customer-requested from system-generated. |
| `status` | YES | Allows wait/retry/cancel/resume. |
| `inputs` | YES | Captures semantic request. |
| `resolvedInputs` | YES | Links objective to durable facts/evidence. |
| `missingRequirements` | YES | Drives WAITING_CUSTOMER. |
| `supersedesObjectiveIds` | YES | Corrections/cancellations. |
| `createdFromTriggerId` | YES | Audit/correlation. |
| `createdAt`/`updatedAt` | YES | Operational trace. |

### Objective catalog

| Objective | Origin | Current availability |
| --- | --- | --- |
| `DISCOVER_PRODUCTS` | Customer | Current tools exist. |
| `COMPARE_PRODUCTS` | Customer | Partial through catalog/recommendation tools. |
| `RECOMMEND_PRODUCTS` | Customer/system | Current tools exist partially. |
| `SELECT_PRODUCTS` | Customer | Current capability exists. |
| `CHANGE_QUANTITY` | Customer | Same as selection update; current capability can replace line items. |
| `SET_DESTINATION` | Customer/system prerequisite | Current capability exists. |
| `GET_SHIPPING_QUOTE` | Customer/system prerequisite | Current capability exists. |
| `SELECT_SHIPPING_OPTION` | Customer/system | Current capability exists. |
| `CREATE_QUOTE` | Customer/system-derived | Current capability exists for draft quote. |
| `SEND_QUOTE` | System/customer | Future; not currently end-to-end. |
| `WAIT_FOR_QUOTE_APPROVAL` | System-generated | Future objective state. |
| `ACCEPT_QUOTE` | Customer/external | Future. |
| `CHECKOUT` | Customer/system | Future. |
| `WAIT_FOR_PAYMENT` | System-generated | Future. |
| `CONFIRM_PAYMENT` | External event | Future. |
| `SCHEDULE_FOLLOW_UP` | System-generated | Current follow-up action exists; should become objective-linked. |
| `HANDOFF` | Customer/system/policy | Current handoff path exists. |

### Customer-requested vs system-generated

Example:

```text
Customer says:
"hazme la cotizacion"

Customer-requested:
- CREATE_QUOTE

System-generated prerequisites:
- VERIFY_SELECTION
- GET_SHIPPING_QUOTE if quote policy requires shipping
- CREATE_QUOTE step
- SEND_QUOTE when delivery capability exists
- WAIT_FOR_QUOTE_APPROVAL after quote delivery
```

The LLM may identify the requested outcome. The runtime derives prerequisite objectives/steps deterministically.

## 6. Work step model

### Contract shape

Conceptual V1:

```json
{
  "stepId": "step_...",
  "objectiveId": "obj_...",
  "stepType": "CALCULATE_SHIPPING",
  "capabilityName": "calculate_shipping",
  "status": "PENDING",
  "dependencies": [
    {
      "type": "STEP_COMPLETED",
      "stepId": "step_select_products"
    },
    {
      "type": "FACT_CONFIRMED",
      "factKey": "shipping_destination"
    }
  ],
  "input": {},
  "output": null,
  "attemptCount": 0,
  "maxAttempts": 2,
  "idempotencyKey": "commercial-work:...",
  "retryable": true,
  "nextAttemptAt": null,
  "lastError": null,
  "createdAt": "iso",
  "startedAt": null,
  "completedAt": null
}
```

### Necessary V1 fields

| Field | V1 | Reason |
| --- | --- | --- |
| `stepId` | YES | Stable idempotency/dependency reference. |
| `objectiveId` | YES | Ownership. |
| `stepType` | YES | Runtime rule lookup. |
| `capabilityName` | YES when executable by Gateway | Direct integration with current Gateway. |
| `status` | YES | Recovery and observability. |
| `dependencies` | YES | Deterministic READY/BLOCKED decision. |
| `input` | YES | Repeat-safe execution. |
| `output` | YES/PARTIAL | Store summary and evidence ids, not full PII/raw responses. |
| `attemptCount` | YES | Retry limits. |
| `maxAttempts` | YES | Retry safety. |
| `idempotencyKey` | YES for mutations | Required for retry-safe side effects. |
| `retryable` | YES | Technical vs commercial failure. |
| `nextAttemptAt` | YES when retryable | Worker selection. |
| `lastError` | YES | Operator/debug. |
| timestamps | YES | Audit/metrics. |

Fields to defer:

- arbitrary compensation/saga metadata;
- nested sub-workflows;
- arbitrary parallel branches beyond explicit dependencies;
- provider prompt/state snapshots;
- human approval payloads beyond existing action/policy fields.

## 7. Dependency model

Dependencies must be evaluated deterministically.

### Dependency types

```text
FACT_EXISTS
FACT_CONFIRMED
STEP_COMPLETED
CAPABILITY_AVAILABLE
CUSTOMER_INPUT_PRESENT
POLICY_ALLOWS
CONVERSATION_AUTONOMY_ALLOWED
HUMAN_NOT_OWNER
NOT_SUPERSEDED
```

### Example graph

```text
DISCOVER_PRODUCTS
  -> search_products / get_product_details
  -> observed catalog evidence

SELECT_PRODUCTS
  requires observed catalog evidence
  -> commercial_line_items fact

SET_DESTINATION
  requires destination text
  -> shipping_destination fact

GET_SHIPPING_QUOTE
  requires commercial_line_items fact
  requires shipping_destination fact
  -> calculate_shipping observation

SELECT_SHIPPING_OPTION
  requires fresh calculate_shipping observation
  -> selected_shipping_option fact

CREATE_QUOTE
  requires commercial_line_items fact
  optionally requires selected_shipping_option depending quote policy
  -> created_quote fact

SEND_QUOTE
  requires created_quote fact
  requires send capability
  -> crm_agent_actions + brain_message_outbox
```

### READY vs BLOCKED

The executor decides:

```text
READY
```

when all deterministic dependencies are satisfied.

It decides:

```text
BLOCKED_BY_DEPENDENCY
```

when a required fact/step/policy/customer input is missing.

It must not ask the LLM whether `calculate_shipping` requires destination. That is platform knowledge.

## 8. Autonomy inside the turn

Fast-path work should be completed synchronously when it is safe and likely to finish quickly.

### Fast-path criteria

Use measured latency and risk, not arbitrary constants. Candidate criteria:

- bounded number of READY steps;
- expected p95 latency below measured response budget;
- no long-running external job;
- every mutation has idempotency key;
- dependencies are local or already resolved;
- no customer clarification required;
- no human approval required;
- no high-risk side effect.

### Good synchronous candidates

| Work | Reason |
| --- | --- |
| Search product | Read-only, expected quick. |
| Get product details | Read-only. |
| Resolve destination | Mutating fact but idempotent and bounded. |
| Select product/change quantity | Idempotent full replacement fact. |
| Calculate simple shipping | Read-only, but depends on Carrier MS latency. Use measured budget. |
| Create draft quote | Possible if Quote Service is fast and idempotent; otherwise async. |

### Not fast-path by default

- quote PDF generation;
- email delivery;
- payment/checkout external redirect generation if slow;
- retries after provider outage;
- any operation requiring customer approval;
- any operation requiring human approval.

## 9. Autonomy after the turn

If work does not need more customer information but cannot safely complete inside the turn, persist it as:

```text
WAITING_SYSTEM
```

or:

```text
RETRY_SCHEDULED
```

Examples:

- shipping provider temporary outage;
- Quote Service delayed/unavailable;
- quote PDF generation;
- send email/WhatsApp attachment after quote creation;
- payment provider webhook wait;
- catalog temporary 503.

### Who resumes work

Recommended:

```text
CommercialWork worker
```

This can reuse patterns from:

- follow-up worker CAS claim;
- stale executing recovery;
- max attempts;
- bounded technical backoff;
- outbox worker planned/locked/sending transitions.

It should not reuse `brain_message_outbox` itself for non-message execution.

### Re-entry

Async continuation triggers:

```text
WORK_RETRY_DUE
CONTINUE_COMMERCIAL_WORK
EXTERNAL_EVENT
```

all call:

```text
runCommercialCycle(trigger)
```

## 10. Waiting for customer

An objective becomes `WAITING_CUSTOMER` when the runtime cannot proceed without a customer-provided fact, choice, or approval.

Examples:

| Missing item | Objective status |
| --- | --- |
| Ambiguous product | `WAITING_CUSTOMER` with `missingRequirement=PRODUCT_REFERENCE` |
| Missing commune | `WAITING_CUSTOMER` with `missingRequirement=DESTINATION` |
| Alternative needs confirmation | `WAITING_CUSTOMER` with `missingRequirement=PRODUCT_CONFIRMATION` |
| Quote approval | `WAITING_CUSTOMER` with `missingRequirement=QUOTE_APPROVAL` |
| Payment action | `WAITING_CUSTOMER` with `missingRequirement=PAYMENT_ACTION` |

Persist:

```json
{
  "missingRequirement": "DESTINATION",
  "questionAsked": "A que comuna lo enviamos?",
  "askedAt": "iso",
  "sourceActionId": "action_...",
  "followUpPolicy": "MISSING_INFORMATION",
  "stopConditions": [
    "customer_replied",
    "human_owner_active",
    "objective_cancelled",
    "opportunity_terminal"
  ]
}
```

The question asked must be tied to an objective. A later inbound can then answer the missing requirement instead of starting from scratch.

## 11. Follow-up as runtime behavior

Follow-up should be integrated as:

```text
WAITING_CUSTOMER
  -> follow-up schedule
  -> FOLLOW_UP_DUE trigger
  -> runCommercialCycle(trigger)
  -> reload CommercialWork/objectives/facts
  -> re-evaluate if follow-up is still valid
```

### Required relation

Future follow-up rows should know:

```text
commercialWorkId
objectiveId
waitingReason
followUpPolicy
```

not only:

```text
draft_message
wa_id
scheduled_for
```

### Avoiding incoherent follow-ups

Before sending a follow-up, revalidate:

- conversation still AI-enabled;
- no human owner active;
- customer has not replied since schedule;
- opportunity still relevant;
- objective still `WAITING_CUSTOMER`;
- missing requirement still missing;
- no blocking system failure makes the follow-up misleading;
- opt-out remains false;
- no active duplicate follow-up exists for the same work/objective.

Negative case:

```text
shipping failed permanently
```

must not lead to:

```text
"Quieres continuar con tu compra?"
```

unless the objective was explicitly reclassified into a valid customer choice.

## 12. Follow-up policies

Policies define behavior, not final copy.

| Policy | Applies when | Delay basis | Max attempts | Stop conditions | Escalation |
| --- | --- | --- | --- | --- | --- |
| `PRODUCT_DISCOVERY_INACTIVE` | Customer browsed/discussed products but no selection | Last customer/agent product interaction | Low | customer replied, selected product, opportunity terminal, human owner | Optional after repeated silence. |
| `SELECTION_INACTIVE` | Customer selected/changed items but did not continue | Selection fact timestamp | Medium | customer replied, quote created, cancelled, human owner | Optional. |
| `MISSING_INFORMATION` | Objective blocked on missing customer input | Question asked timestamp | Low-medium | customer answered, objective superseded, human owner | Escalate if high-value/old. |
| `QUOTE_PENDING` | Quote sent, waiting approval | Quote sent timestamp | Medium | approved/rejected/expired/human owner | Escalate for high value. |
| `PAYMENT_PENDING` | Checkout/payment action pending | Payment link/event timestamp | Medium | payment confirmed/failed/cancelled | Escalate on repeated failure/silence. |
| `SYSTEM_RECOVERY_NOTICE` | System recovered from outage and can proceed | Recovery event | Usually 0 or 1 | customer replied/handoff | Usually no escalation. |

Each policy should define:

- eligibility;
- delay sequence;
- max attempts;
- message strategy category;
- stop conditions;
- human escalation rule;
- allowed channels;
- quiet-hours behavior.

## 13. Event triggers

The future Sales Agent should not be activated only by customer messages.

| Trigger | Source | Correlation key | Loaded state | LLM needed? | Possible next actions |
| --- | --- | --- | --- | --- | --- |
| `CUSTOMER_MESSAGE` | WhatsApp webhook | conversation/message id | Conversation, opportunity, CommercialWork, facts | YES for semantic input | Add/modify/cancel objectives, execute ready work, respond. |
| `FOLLOW_UP_DUE` | Follow-up worker/action row | action id + work/objective id | Waiting objective, conversation, facts | MAYBE for phrasing; not for validation | Send follow-up, cancel, handoff, re-evaluate. |
| `WORK_RETRY_DUE` | CommercialWork worker | work/step id | Work, step dependencies, facts | NO if step deterministic | Retry capability, reschedule, fail, notify. |
| `QUOTE_CREATED` | Quote Service event | quote id + work id | Quote objective/facts | NO for state update; MAYBE for customer response | Mark step complete, send quote, wait approval. |
| `QUOTE_FAILED` | Quote Service event | quote id/work id | Quote step/objective | NO | Retry/fail/block/handoff. |
| `PAYMENT_CONFIRMED` | Payment provider | payment id/opportunity | Payment objective/facts | NO for confirmation; MAYBE for response | Mark paid, close/won, send acknowledgement. |
| `PAYMENT_FAILED` | Payment provider | payment id/opportunity | Payment objective | NO/MAYBE | Ask retry, follow-up, handoff. |
| `SHIPPING_RECOVERED` | Carrier/platform event | carrier/service key | Waiting/retry shipping steps | NO | Resume shipping steps. |
| `HUMAN_HANDOFF` | Operator/control state | conversation id | Conversation/work | NO | Suspend/cancel autonomous work. |
| `OPPORTUNITY_TERMINAL` | CRM/opportunity update | opportunity id | Active work | NO | Cancel/supersede pending work/follow-ups. |

## 14. Unified commercial cycle

Recommended conceptual entry point:

```text
runCommercialCycle(trigger)
```

### Cycle

```text
1. Load conversation, opportunity, customer identity bridge, commercial facts.
2. Load active CommercialWork for opportunity/conversation.
3. Incorporate trigger.
4. If semantic input exists, ask LLM/planner to extract objectives or corrections.
5. Reconcile objectives against existing work.
6. Derive or update work steps deterministically.
7. Acquire sequencing/lock for mutating work.
8. Execute READY steps within sync budget.
9. Persist facts, step outcomes, capability evidence, events.
10. Decide terminal disposition:
    - continue synchronously
    - respond FINAL
    - respond PARTIAL and continue async
    - ask customer and schedule follow-up
    - wait system/retry
    - handoff
    - no customer response needed
```

### Evolution from `runNativeAutonomousCycle`

`runNativeAutonomousCycle` can evolve into a wrapper over `runCommercialCycle` for `CUSTOMER_MESSAGE` triggers. It should not remain the only entry point because future triggers are not all inbound messages.

Recommended shape:

```text
runNativeAutonomousCycle(input)
  -> build CUSTOMER_MESSAGE trigger
  -> runCommercialCycle(trigger)
```

## 15. When the LLM is needed

| Decision | Owner |
| --- | --- |
| Interpret "mejor dejame 3" | `LLM_REQUIRED` |
| Interpret "olvida la Pro" | `LLM_REQUIRED` |
| Resolve whether "la classic" refers to a prior product | `LLM_REQUIRED` plus evidence resolver |
| Determine `calculate_shipping` requires destination | `DETERMINISTIC` |
| Determine quote already exists for same selection | `DETERMINISTIC` |
| Retry HTTP 503 | `DETERMINISTIC` |
| Select next READY step from dependency graph | `DETERMINISTIC` |
| Verify product evidence before selection | `DETERMINISTIC` |
| Decide if customer approves a quote from natural language | `LLM_REQUIRED` |
| Mark payment confirmed from webhook | `DETERMINISTIC` |
| Phrase customer response | `LLM_REQUIRED` unless fixed operational notice |
| Decide if policy permits send | `DETERMINISTIC` |
| Decide handoff required by human ownership | `DETERMINISTIC` |
| Recommend semantically similar alternative | `LLM_REQUIRED/tool-driven` |

Goal:

```text
Use LLM for meaning.
Use deterministic runtime for execution mechanics.
```

## 16. Planner role

The existing planner should become a semantic interpreter, not a workflow controller.

Recommended responsibilities:

- extract customer-requested objectives;
- resolve semantic references where evidence exists;
- identify missing information;
- classify corrections/cancellations;
- propose customer-facing response ingredients;
- flag ambiguity.

Not planner responsibilities:

- controlling retries;
- scheduling follow-up attempts;
- deciding durable execution status;
- bypassing dependency rules;
- authorizing mutations;
- choosing to ignore idempotency;
- managing outbox delivery.

The planner can say:

```text
Customer wants GET_SHIPPING_QUOTE for destination=Nunoa and quantity=2 Classic.
```

The runtime decides:

```text
select_products is READY
set_shipping_destination is READY
calculate_shipping is BLOCKED until both facts exist
```

## 17. Classic Agent Tool Loop role

The classic loop should remain useful, but not own long workflows.

Recommended roles:

- simple conversations;
- single-intent read-only product discovery;
- exploratory product discovery;
- fallback semantic reasoning;
- low-risk agentic tool use where durable continuation is not needed;
- response generation when deterministic execution already produced facts.

Should avoid:

- multi-step dependent commercial workflows;
- quote lifecycle orchestration;
- payment/checkout;
- retry scheduling;
- durable continuation;
- follow-up policy control.

Do not delete it now. Route long commercial bundles away from it once `CommercialWork` exists.

## 18. Parallel execution

Parallelism belongs to the executor, not provider-native tool calling.

### Classification

| Pair/work | Classification | Reason |
| --- | --- | --- |
| Product details + Customer Profile | `SAFE_PARALLEL` | Independent reads. |
| Product details + destination resolution | `CONDITIONAL` | Destination write independent, but stale-turn sequencing must be held. |
| Multiple catalog reads | `SAFE_PARALLEL` | Independent read-only calls if service limits allow. |
| Select products -> calculate shipping | `ORDERED` | Shipping requires durable selection. |
| Set destination -> calculate shipping | `ORDERED` | Shipping requires durable destination. |
| Calculate shipping -> select shipping option | `ORDERED` | Option selection requires fresh options. |
| Select products -> create quote | `ORDERED` | Quote requires selected products. |
| Calculate shipping + create quote | `CONDITIONAL` | Current quote does not require shipping; future quote policy may. |
| Send quote + wait approval | `ORDERED` | Cannot wait for approval before quote is delivered. |

### Requirements for parallel execution

- dependency graph proves independence;
- steps are read-only or mutate disjoint facts safely;
- idempotency keys exist;
- conversation sequencing prevents stale writes;
- service rate limits are respected;
- result ordering is deterministic before response.

## 19. Conversation sequencing

GAP-04 from A01 must be resolved before broad async/parallel mutation.

Scenario:

```text
T1: quiero 2 Classic
T2: mejor 3
T3: y a Las Condes
```

Guarantee:

```text
older turn cannot overwrite newer customer intent
```

### Options

| Option | Pros | Cons |
| --- | --- | --- |
| Per-conversation lock | Simple mental model; prevents concurrent mutation races | Can increase latency; risk of broad lock contention. |
| Monotonic turn sequence | Explicit ordering; good audit | Requires every write to check sequence. |
| Optimistic concurrency/version | Avoids long locks; detects stale writes | Needs retry/reconcile path. |
| Stale-write rejection in fact services | Protects core facts even if caller forgets | Must pass turn/work version to all mutating services. |

### Recommendation

Minimum:

```text
monotonic commercial_turn_sequence
+ optimistic work/fact version checks
+ short per-conversation mutation lease for RUNNING mutating steps
```

Use the lock/lease to avoid same-time mutations. Use versions to reject stale writes if a process wakes up late.

V1 rule:

```text
Every mutating step writes with:
- workVersion;
- sourceMessageSequence;
- expected active fact ids when applicable.
```

If mismatch:

```text
step -> SUPERSEDED or BLOCKED_STALE
cycle -> reload/reconcile
```

## 20. Reconciliation of new messages

New messages can:

- add objective;
- modify objective;
- cancel objective;
- supersede previous objective;
- answer missing information.

### Reconciliation rules

| Message type | Example | Runtime behavior |
| --- | --- | --- |
| Add objective | "y hazme cotizacion" | Add objective and derive prerequisite steps. |
| Modify objective | "mejor 3" | Supersede prior quantity/selection objective; cancel/replan dependent steps. |
| Modify destination | "mejor a Las Condes" | Supersede destination fact/objective; invalidate stale shipping options. |
| Cancel objective | "olvida la Pro" | Cancel affected product objective/steps. |
| Cancel all | "olvidalo" | Cancel active customer-requested work, retries, follow-ups. |
| Answer missing info | "Nunoa" | Fill missing requirement; transition objective from WAITING_CUSTOMER to READY/PENDING. |
| Reject path | "no, sin despacho" | Cancel shipping objective; replan quote without shipping if policy allows. |

### Invalidating old work

When a fact changes, dependent steps must be invalidated:

```text
commercial_line_items changed
  -> supersede calculate_shipping result
  -> supersede selected_shipping_option
  -> block/recreate quote if quote used old selection

shipping_destination changed
  -> supersede calculate_shipping result
  -> supersede selected_shipping_option
  -> block/recreate quote if quote used old destination
```

## 21. Cancellation

Cancellation must be explicit.

Statuses:

```text
CANCELLED
SUPERSEDED
```

Use `CANCELLED` when the customer/system stops the work:

```text
"olvidalo, no quiero la cotizacion"
```

Use `SUPERSEDED` when newer valid intent replaces old work:

```text
"mejor 3"
"mejor a Las Condes"
```

### Effects

| Existing work | On cancellation |
| --- | --- |
| Pending quote generation | Mark step/objective `CANCELLED`; do not execute retry. |
| Scheduled follow-up | Cancel linked follow-up action. |
| Shipping retry | Cancel retry if no longer needed. |
| Outbox already sent | Cannot unsend; record event and update work state. |
| Quote already created | Mark no longer current if superseded; do not claim cancelled quote as active. |
| Payment pending | Cancel payment follow-up; payment provider state may need separate future action. |

## 22. Retry model

Separate:

```text
technical retry
commercial retry
customer follow-up
```

### Technical retry

Use for temporary service failures:

- HTTP 503/timeout from Catalog/Carrier/Quote;
- DB transient failure after safe idempotency boundary;
- provider unavailable for semantic work only when semantic decision is still needed.

Rules:

- bounded attempts;
- exponential or fixed bounded backoff by capability policy;
- idempotency key required for mutations;
- retry does not need LLM if step input is already known;
- stop if work/objective superseded.

### Commercial retry

Use when a business condition may change:

- item temporarily unavailable;
- shipping coverage may change;
- quote expired and customer asks again.

This may require LLM/customer context, not blind retry.

### Customer follow-up

Use when waiting for customer:

- quote approval;
- missing destination;
- payment action;
- product confirmation.

This is not a technical retry.

## 23. Failure isolation

Example:

```text
selection = completed
shipping = failed retryable
quote = blocked by shipping
```

The runtime must preserve each state:

```text
SELECT_PRODUCTS objective -> COMPLETED
CALCULATE_SHIPPING step -> RETRY_SCHEDULED or FAILED
CREATE_QUOTE step -> BLOCKED_BY_DEPENDENCY
CommercialWork -> WAITING_SYSTEM or PARTIAL
```

It must not collapse everything into:

```text
provider_unavailable
```

### Customer communication

Response type depends on state:

| State | Response |
| --- | --- |
| Selection completed, shipping retryable | PARTIAL: selection confirmed, shipping is being retried only if durable retry exists. |
| Selection completed, shipping permanent failed | BLOCKED: explain shipping cannot be calculated now; offer alternative/handoff. |
| Quote blocked by missing approval | BLOCKED/WAITING_CUSTOMER: ask for approval. |
| Provider unavailable before semantic interpretation | Safe fallback or handoff; no commercial mutation claim. |

## 24. Provider failure

If DeepSeek/provider is unavailable, separate work into:

```text
semantic work requiring LLM
deterministic work already known
```

Can continue without provider:

- retry known `calculate_shipping`;
- retry known `create_quote`;
- mark quote created from external event;
- mark payment confirmed from webhook;
- cancel work on human handoff;
- expire follow-up by policy.

Cannot continue without provider:

- interpret new ambiguous customer message;
- classify natural-language correction/cancellation;
- generate nuanced customer response;
- choose product recommendation semantics where no deterministic evidence is enough.

Design rule:

```text
Provider failure must block only LLM_REQUIRED decisions, not deterministic recovery work.
```

## 25. Mutation evidence

Generalize T08D conceptually.

### Claim/evidence registry

| Customer-visible claim | Required evidence |
| --- | --- |
| "deje 3 unidades" | Active `commercial_line_items` fact with quantity 3 for product/variant, written by completed step/capability. |
| "registre Las Condes" | Active `shipping_destination` fact resolved to Las Condes. |
| "calcule el despacho" | Completed `calculate_shipping` execution tied to current line item and destination fact ids. |
| "seleccione esta opcion de despacho" | Active selected shipping option fact tied to fresh shipping execution/current facts. |
| "cree tu cotizacion" | Active `created_quote` fact and Quote Service success/idempotent reuse evidence. |
| "envie tu cotizacion" | `crm_agent_actions` send action + outbox row written/sent depending exact wording. |
| "el pago esta confirmado" | Payment provider confirmation event/fact. |
| "queda agendado un seguimiento" | Active `crm_agent_actions` follow-up row linked to objective. |
| "un humano tomara el caso" | Conversation human ownership/AI disabled state changed or handoff action persisted. |

The response generator may only use FINAL/PARTIAL language that matches evidence.

No new regex design is required here. The mechanism should be structured:

```text
response_intent.claims[]
  -> evidence requirements
  -> runtime validation
  -> allow/rewrite/block
```

## 26. Idempotency

Requirement:

```text
every autonomous mutation must be retry-safe
```

### Rules by mutation

| Mutation | Idempotency requirement |
| --- | --- |
| `select_products` | Same normalized selection is no-op; different selection supersedes with sequence/version check. |
| `set_shipping_destination` | Same resolved commune is no-op; different commune supersedes with sequence/version check. |
| `select_shipping_option` | Must validate current fact ids and option id/index freshness; retry same option no-op. |
| `create_quote` | Deterministic idempotency key by opportunity + selection + quote policy inputs. |
| future `send_quote` | Dedupe by quote id + recipient + channel + content/version. |
| future checkout/payment link | Provider idempotency key by quote/payment intent. |
| future order creation | Strict external idempotency key and local completion reconciliation. |

### Crash after side effect before step completed

Worker recovery must:

1. Reload step with `RUNNING` stale or `RETRY_SCHEDULED`.
2. Check durable evidence before re-executing.
3. If evidence exists, mark step `COMPLETED`.
4. If evidence absent and idempotency key exists, retry.
5. If evidence unknown and mutation unsafe, mark `REQUIRES_REVIEW`/handoff.

## 27. Work recovery

Scenario:

```text
Step 1 completed
Step 2 completed
process crashes
Step 3 pending
```

After restart:

```text
CommercialWork worker selects active work where:
- status in READY, WAITING_SYSTEM, RETRY_SCHEDULED, RUNNING stale
- nextAttemptAt <= now when retry scheduled
- conversation autonomy still allowed
- opportunity not terminal
```

Then:

```text
load work
load facts
reconcile dependencies
skip completed steps
repair stale RUNNING by evidence check
execute next READY step
persist result
decide response/wait/retry/follow-up
```

Completed mutating steps are not repeated if their durable evidence matches the step's idempotency/evidence key.

## 28. Customer-visible response strategy

### FINAL

Use when all customer-requested objectives that require immediate customer response are complete.

Example:

```text
Listo: deje seleccionadas 2 Classic y el despacho a Nunoa sale $X con opcion Y.
```

Required:

- selection evidence;
- destination evidence;
- shipping evidence.

### PARTIAL

Use when some work is complete and remaining work is durably scheduled/running.

Example:

```text
Deje seleccionadas las 2 Classic. Estoy terminando el calculo de despacho.
```

Allowed only if:

```text
shipping step exists
status in READY/RUNNING/RETRY_SCHEDULED/WAITING_SYSTEM
and worker/continuation can resume it
```

### BLOCKED

Use when customer/human/system input is required and no automatic progress is safe.

Example:

```text
Necesito la comuna para calcular el despacho.
```

The blocking reason must be persisted on the objective/step.

## 29. Response timing

Options:

```text
respond after everything
respond partial and continue
wait for customer
```

### Decision criteria

Do not hardcode an arbitrary latency threshold in the design. Measure:

- p50/p95 latency per capability;
- p50/p95 total work bundle latency;
- provider latency;
- outbox delay;
- customer-visible timeout/fallback rate;
- completion rate by objective bundle.

Then define policy:

```text
if ready work expected within measured sync budget:
  continue synchronously
else if remaining work can continue without customer:
  persist work, respond PARTIAL, continue async
else:
  ask customer, mark WAITING_CUSTOMER, schedule follow-up if policy allows
```

Sync budget should be configuration-driven and observable, not inferred from the LLM.

## 30. Follow-up activation

Follow-up is currently not fully active in production. Future activation requires:

- correct objective/work state;
- conversation sequencing;
- stop conditions;
- opt-out check;
- human ownership check;
- active opportunity check;
- no duplicate active follow-up for same work/objective/policy;
- pending objective still valid;
- no system failure that makes follow-up incoherent.

Rollout:

```text
shadow
allowlist
limited live
production
```

### Shadow

Compute follow-up eligibility and planned schedule, persist only read-only/audit evidence or disabled rows if existing contract allows.

### Allowlist

Enable real follow-up only for test `wa_id`s, with objective-linked rows.

### Limited live

Enable low-risk policies such as `MISSING_INFORMATION` and `QUOTE_PENDING` for narrow cohorts.

### Production

Enable policy matrix with monitoring, opt-out, human ownership, and stale-objective cancellation.

## 31. Opportunity lifecycle

`crm_opportunities` should remain the commercial anchor, but not become a giant workflow enum.

Conceptual states:

```text
discovery
active_purchase
quote_pending
awaiting_customer
checkout_pending
paid
lost
human_owned
```

Recommendation:

Use `crm_opportunities` for high-level commercial lifecycle/projection. Infer detailed status from:

- active `CommercialWork`;
- objective statuses;
- durable facts;
- actions/follow-ups;
- payment/quote events.

Avoid expanding opportunity `stage/status` to encode every work-step status. That would duplicate the execution model and create stale projections.

## 32. Quote lifecycle

### Lifecycle

```text
CREATE_QUOTE
ISSUE_QUOTE
SEND_QUOTE
WAIT_APPROVAL
ACCEPT_QUOTE
CHECKOUT
PAYMENT
```

### Availability

| Objective/step | Status |
| --- | --- |
| `CREATE_QUOTE` | CURRENTLY_AVAILABLE as draft creation capability. |
| `ISSUE_QUOTE` | FUTURE/UNKNOWN in Sales Agent runtime. |
| `SEND_QUOTE` | FUTURE as explicit quote delivery; current outbox can send text but not full quote lifecycle. |
| `WAIT_APPROVAL` | FUTURE objective state. |
| `ACCEPT_QUOTE` | FUTURE. |
| `CHECKOUT` | FUTURE. |
| `PAYMENT` | FUTURE. |

### Quote policy

V1 should support:

```text
CREATE_QUOTE requires commercial_line_items.
CREATE_QUOTE may optionally require selected_shipping_option based on quote policy.
```

Current code uses `requireShipping:false`; do not design as if full shipping-inclusive quote is already production-ready.

## 33. Customer Profile role

Customer Profile remains contextual intelligence.

It may influence:

- recommendation ranking;
- priority;
- follow-up strategy;
- tone;
- offers/objections;
- whether to escalate high-value customer.

It must not become:

- transaction state;
- selected products;
- shipping destination;
- quote status;
- payment status;
- Customer Master substitute.

Failures should generally be fail-open for sales execution, unless a future policy explicitly requires verified customer data for a sensitive action.

## 34. Minimal persistence model

### Existing table mapping

| State | Existing table fit |
| --- | --- |
| Conversation | `conversation`, `conversation_message` fit. |
| Commercial facts | `crm_request_facts` fits versioned facts. |
| Action boundary | `crm_agent_actions` fits proposed/scheduled/executed actions and follow-up. |
| Transport | `brain_message_outbox` fits outbound delivery only. |
| Event audit | `commercial_event` fits append-only events. |
| Capability audit | `crm_capability_executions` fits per-capability evidence. |
| Opportunity anchor | `crm_opportunities` fits commercial anchor/projection. |
| Objective + step dependency state | PARTIAL/NO current fit. |

### Can existing tables represent Commercial Execution correctly?

Answer:

```text
PARTIAL
```

Possible but not recommended mappings:

- Store work/objectives/steps as a single `crm_request_facts` JSON fact.
- Store each step as a `crm_agent_actions` row.
- Reconstruct state from `commercial_event`.

Problems:

- `crm_request_facts` is versioned fact truth, not a runnable queue with `nextAttemptAt`, `RUNNING`, stale lock, and per-step attempts.
- `crm_agent_actions` is action truth, but many work steps are internal capability executions, not customer/operator actions.
- `commercial_event` is append-only evidence; making it the only work state would require replay for every runtime decision and complicate corrections.
- `brain_message_outbox` is transport and must stay transport.

### Minimal new persistence

Recommended minimal persistence, to be specified in a later implementation task:

```text
crm_commercial_work
crm_commercial_work_steps
```

Alternative minimal version:

```text
crm_commercial_work
  with indexed top-level status/next_attempt_at/version
  and objectives_json/steps_json for V1
```

Preferred V1:

- one work table;
- one step table;
- objective JSON inside work or separate table only if query needs require it.

Do not create schema in this task.

## 35. Worker model

### Required worker responsibilities

```text
WORK_RETRY
CONTINUE_COMMERCIAL_WORK
FOLLOW_UP
```

### One generalized worker vs specialized workers

| Option | Pros | Cons |
| --- | --- | --- |
| One generalized CommercialWork worker | Single claim/retry model; easier recovery semantics | Might absorb follow-up/outbox concerns if not bounded. |
| Separate specialized workers | Keeps outbox/follow-up contracts clear | More integration points and duplicate CAS/retry logic. |

Recommendation:

```text
CommercialWork worker for work steps and retries.
Existing follow-up worker remains specialized, but becomes objective-linked.
Existing outbox worker remains transport-only.
```

Shared patterns:

- CAS claim;
- stale RUNNING recovery;
- max attempts;
- bounded backoff;
- current-state revalidation after claim;
- allowlist/opt-out/human ownership gates.

## 36. Observability

The runtime must answer:

```text
what is it doing?
why?
what is missing?
what failed?
what will retry?
when?
```

### Metrics

| Metric | Purpose |
| --- | --- |
| `active_commercial_work` | Current workload. |
| `waiting_customer_count` | Follow-up/customer bottleneck. |
| `waiting_system_count` | Service dependency bottleneck. |
| `retry_scheduled_count` | Technical instability. |
| `failed_work_count` | Manual/engineering attention. |
| `completed_objectives_count` | Business throughput. |
| `average_steps_per_objective` | Complexity. |
| `llm_calls_per_objective` | Model orchestration cost. |
| `tool_calls_per_objective` | Capability load. |
| `follow_up_conversion` | Follow-up value. |
| `stale_write_rejections` | Concurrency health. |
| `superseded_work_count` | Customer correction frequency. |
| `partial_response_with_continuation_count` | Async UX volume. |
| `unbacked_claim_blocked_count` | Response safety. |

### Required views

- by opportunity;
- by conversation;
- by work id;
- by objective;
- by failed/retry state;
- by follow-up policy;
- by provider/capability failure reason.

## 37. Human handoff

Handoff is a terminal/control state.

When:

```text
conversation.human_owner_active = true
```

the system must:

- stop autonomous customer replies;
- stop mutating commercial retries;
- cancel or suspend objective-linked follow-ups;
- mark active work `HANDOFF` or `SUSPENDED_BY_HUMAN`;
- allow read-only operator visibility;
- avoid creating new autonomous outbox rows.

Exceptions:

- delivery status projection may continue;
- read-only observability may continue;
- external payment/quote events may be recorded as facts/events but should not trigger autonomous customer-facing mutation without explicit policy.

## 38. Full lifecycle examples

### Scenario A - Simple

```text
"busco una barra olimpica"
```

| Item | Design |
| --- | --- |
| Trigger | `CUSTOMER_MESSAGE` |
| Objectives | `DISCOVER_PRODUCTS` |
| Steps | `search_products` or `explore_catalog` |
| State changes | Capability execution logged; possible product interest fact later. |
| LLM calls | Interpret product search; phrase response. |
| Capabilities | Catalog search. |
| Response | FINAL with grounded product options. |
| Remaining work | None unless customer asks follow-up. |
| Next trigger | Customer message. |

### Scenario B - Selection

```text
"dame 2 Classic"
```

| Item | Design |
| --- | --- |
| Trigger | `CUSTOMER_MESSAGE` |
| Objectives | `SELECT_PRODUCTS` |
| Steps | Resolve product evidence; `select_products`. |
| State changes | `commercial_line_items` confirmed fact. |
| LLM calls | Interpret reference if needed; phrase confirmation. |
| Capabilities | `get_product_details` if evidence missing; `select_products`. |
| Response | FINAL if selection completed; BLOCKED if ambiguous. |
| Remaining work | None, or WAITING_CUSTOMER for ambiguity. |
| Next trigger | Customer message or follow-up if policy says selection inactive. |

### Scenario C - Multi-intent

```text
"quiero 2 Classic y despacho a Nunoa"
```

| Item | Design |
| --- | --- |
| Trigger | `CUSTOMER_MESSAGE` |
| Objectives | `SELECT_PRODUCTS`, `SET_DESTINATION`, `GET_SHIPPING_QUOTE` |
| Steps | Resolve product; select products; set destination; calculate shipping. |
| State changes | line items fact, destination fact, shipping execution evidence. |
| LLM calls | Interpret objectives; final response. |
| Capabilities | Product details/search, `select_products`, `set_shipping_destination`, `calculate_shipping`. |
| Response | FINAL if shipping completes; PARTIAL only if durable shipping work remains. |
| Remaining work | Shipping retry/continuation if async. |
| Next trigger | `WORK_RETRY_DUE` if needed; customer message otherwise. |

### Scenario D - Complex

```text
"quiero 2 Classic,
hay una alternativa mas barata?,
mandalo a Nunoa
y hazme una cotizacion"
```

| Item | Design |
| --- | --- |
| Trigger | `CUSTOMER_MESSAGE` |
| Objectives | `SELECT_PRODUCTS`, `COMPARE_PRODUCTS`, `SET_DESTINATION`, `GET_SHIPPING_QUOTE`, `CREATE_QUOTE` |
| Steps | Resolve Classic; compare alternatives; determine whether selection is firm; select; set destination; calculate shipping if policy; create quote. |
| State changes | selection/destination/quote facts if completed. |
| LLM calls | Interpret whether customer wants firm Classic or comparison before final choice; phrase response. |
| Capabilities | Catalog, recommendation, selection, destination, shipping, quote. |
| Response | BLOCKED if alternative choice needed; FINAL/PARTIAL if firm selection and quote work completes/continues. |
| Remaining work | Quote/shipping async if persisted. |
| Next trigger | Customer clarification, work retry, or follow-up. |

### Scenario E - Customer correction

```text
"mejor 3"
"y a Las Condes"
```

| Item | Design |
| --- | --- |
| Trigger | Consecutive `CUSTOMER_MESSAGE`s |
| Objectives | Modify `SELECT_PRODUCTS`; modify `SET_DESTINATION`; update dependent shipping/quote objectives. |
| Steps | Supersede old selection/destination-dependent steps; write new facts with sequence/version checks. |
| State changes | old work `SUPERSEDED`; new facts current. |
| LLM calls | Interpret corrections. |
| Capabilities | `select_products`, `set_shipping_destination`, recalc shipping if requested/still relevant. |
| Response | Confirmation or updated quote/shipping depending objectives. |
| Remaining work | Replanned shipping/quote. |
| Next trigger | Work retry/follow-up/customer. |

### Scenario F - Provider/tool failure

```text
shipping unavailable
```

| Item | Design |
| --- | --- |
| Trigger | `CUSTOMER_MESSAGE` or `WORK_RETRY_DUE` |
| Objectives | `GET_SHIPPING_QUOTE` |
| Steps | `calculate_shipping` |
| State changes | Step `RETRY_SCHEDULED` or `FAILED`; selection/destination remain completed. |
| LLM calls | Not needed for deterministic retry; needed for customer phrasing if responding. |
| Capabilities | `calculate_shipping`. |
| Response | PARTIAL if retry scheduled; BLOCKED if permanent/unretryable. |
| Remaining work | Retry due if retryable. |
| Next trigger | `WORK_RETRY_DUE` or customer/handoff. |

### Scenario G - Customer silence

```text
quote sent
no response
follow-up due
```

| Item | Design |
| --- | --- |
| Trigger | `FOLLOW_UP_DUE` |
| Objectives | `WAIT_FOR_QUOTE_APPROVAL` |
| Steps | Revalidate waiting objective; send follow-up if still valid. |
| State changes | Follow-up attempt count; action/outbox rows; objective remains waiting or transitions. |
| LLM calls | Maybe for phrasing; not for eligibility. |
| Capabilities | Follow-up action/outbox. |
| Response | Follow-up message. |
| Remaining work | Continue waiting or escalate after attempts. |
| Next trigger | Customer message, next follow-up, quote expiry. |

### Scenario H - Restart

```text
selection completed
shipping pending
process crashes
```

| Item | Design |
| --- | --- |
| Trigger | Process restart then worker tick |
| Objectives | `GET_SHIPPING_QUOTE` active |
| Steps | Selection completed; shipping READY/PENDING. |
| State changes | Worker claims shipping step; executes or retries. |
| LLM calls | Not required for known shipping retry. |
| Capabilities | `calculate_shipping`. |
| Response | Optional PARTIAL completion message if customer was promised continuation. |
| Remaining work | None after success; retry/fail after failure. |
| Next trigger | Work retry or customer message. |

## 39. Architecture proposal

Conceptual blocks:

```text
Trigger intake
  -> Commercial state loader
  -> Semantic interpreter
  -> Objective reconciliation
  -> Work planner
  -> Executor
  -> State persistence
  -> Response / wait / retry / follow-up / handoff
```

### Mapping to existing code

| Block | Existing code relation |
| --- | --- |
| Trigger intake | `runNativeAutonomousCycle`, follow-up tick, future external event handlers. |
| Commercial state loader | `buildNativeCommercialContext`, request fact loaders, recent catalog context. |
| Semantic interpreter | Multi-intent planner; classic loop for fallback/simple cases. |
| Objective reconciliation | NEW, extending multi-intent pending intent concepts. |
| Work planner | EXTEND `executionPlanner.ts` dependency model. |
| Executor | EXTEND `actionPlanExecutor.ts` and Capability Gateway. |
| State persistence | EXTEND facts/actions/events; NEW work/step persistence. |
| Response strategy | EXTEND finalizer/mutation guard/dispatch. |
| Wait/retry/follow-up | EXTEND follow-up worker patterns; NEW CommercialWork worker. |
| Handoff | Existing conversation control/handoff dispatch. |

## 40. Reuse map

| Proposed block | Status | Notes |
| --- | --- | --- |
| WhatsApp trigger intake | `EXISTS` | Current native inbound path. |
| Follow-up trigger intake | `EXISTS/EXTEND` | Exists, needs objective link. |
| Work retry trigger intake | `NEW` | Can reuse worker patterns. |
| External quote/payment trigger intake | `NEW` | Future. |
| Conversation loader | `EXISTS` | Current native context. |
| Commercial facts loader | `EXISTS/EXTEND` | Request facts already used. |
| Semantic objective extraction | `EXTEND` | Multi-intent planner. |
| Objective reconciliation | `NEW` | Needed for corrections/cancellations/supersession. |
| Dependency planner | `EXTEND` | Existing multi-intent execution planner seed. |
| Capability executor | `EXISTS` | Capability Gateway. |
| Idempotent facts | `EXISTS/EXTEND` | Add sequence/version guard. |
| Quote creation | `EXISTS/EXTEND` | Draft create exists; lifecycle future. |
| Action boundary | `EXISTS` | `crm_agent_actions`. |
| Outbox delivery | `EXISTS` | Keep transport-only. |
| Follow-up scheduler | `EXISTS/EXTEND` | Link to work/objective. |
| Mutation evidence registry | `EXTEND` | Generalize T08D guard. |
| Work/step persistence | `NEW` | Minimal durable execution state. |
| CommercialWork worker | `NEW/PARTIAL` | Reuse follow-up/outbox worker patterns. |
| Observability | `EXTEND` | Existing events + new work metrics. |

## 41. Migration path

### Phase 1 - Unified objective/work contract

Problem:

No common model for objective and execution state.

Goal:

Define types/contracts and read-only mapping from current context/facts.

Changes:

- Add TypeScript contracts only.
- No runtime route change.
- Add tests for status/dependency derivation.

Exit:

CommercialWork can be built as read-only projection for C09.

### Phase 2 - Move multi-intent execution onto CommercialWork

Problem:

Multi-intent path has useful planner/executor but not common durable work.

Goal:

Use CommercialWork as internal representation for `SELECT_PRODUCTS`, `SET_DESTINATION`, `GET_SHIPPING_QUOTE`.

Changes:

- Keep allowlist.
- Persist work/steps in minimal store or V0 fact-backed store if chosen.
- Use deterministic executor.

Exit:

C09 completes or durably continues without model-language-only promises.

### Phase 3 - Add quote objective

Problem:

Quote draft exists but is not part of multi-intent objective execution.

Goal:

Add `CREATE_QUOTE` objective/step using existing `create_quote`.

Changes:

- Dependency on line items and optional shipping policy.
- Quote evidence registry.

Exit:

Selection + destination + shipping + quote bundle can execute/retry safely.

### Phase 4 - Durable continuation/retry

Problem:

Ready/retry work cannot resume generically.

Goal:

Add CommercialWork worker.

Changes:

- CAS claim.
- stale RUNNING recovery.
- retry due selection.
- evidence repair.

Exit:

Crash after step N resumes step N+1 without duplicate mutations.

### Phase 5 - Objective-linked follow-up

Problem:

Follow-up lacks objective awareness.

Goal:

Connect `WAITING_CUSTOMER` objectives to follow-up rows/policies.

Changes:

- Store work/objective reference in follow-up action payload or schema later.
- Revalidate objective before send.

Exit:

Follow-ups are coherent and stop when objective changes.

### Phase 6 - Conversation sequencing

Problem:

Distinct inbound messages can race.

Goal:

Prevent stale customer intent overwrites.

Changes:

- Turn sequence.
- Work/fact version checks.
- Short mutation lease.

Exit:

Older turn cannot overwrite newer correction.

### Phase 7 - Safe parallelism

Problem:

Independent work is currently sequential.

Goal:

Let executor parallelize safe read-only/independent steps.

Changes:

- Dependency graph parallel scheduler.
- Service limits.
- Deterministic join.

Exit:

Reduced latency without mutation order regressions.

## 42. Decision on external workflow engine

### Do we need Temporal or equivalent now?

```text
NO
```

Reason:

The immediate need is not long-lived arbitrary distributed workflow orchestration. The near-term need is a narrow durable objective/step model, retry-safe idempotent capabilities, and a worker pattern the repo already has in follow-up/outbox form.

Re-evaluate later if:

- work spans many days with complex timers;
- many external systems require compensation;
- in-house worker semantics become hard to operate;
- retry/dependency graphs become too complex for the minimal DB model.

### Do we need a message broker now?

```text
NO
```

Reason:

The current workload can start with DB-backed due work selection, CAS claims, and existing worker patterns. A broker may be useful later for high-volume event fan-out, but it is not required to design the commercial execution model.

## 43. Risks

| Risk | Mitigation |
| --- | --- |
| Overengineering | Keep V1 scoped to selection/destination/shipping/quote. |
| Duplicated state | Facts remain facts; work tracks objectives/steps only. |
| Stale objectives | Supersession/cancellation rules and turn sequencing. |
| Duplicate mutations | Idempotency keys and evidence repair before retry. |
| Excessive follow-ups | Objective-linked policies, stop conditions, max attempts. |
| Concurrency bugs | Mutation lease + optimistic version checks. |
| Provider dependence | Deterministic recovery for known work. |
| Workflow deadlocks | Clear BLOCKED reasons and operator visibility. |
| Wrong autonomous action | Capability Gateway, policy gates, human approval for sensitive actions. |
| Customer experience degradation | FINAL/PARTIAL/BLOCKED response strategy grounded in durable state. |
| Abusing existing tables | Explicit boundary: outbox transport, events audit, facts truth, work execution. |
| Customer identity confusion | Continue using provisional identity; do not invent Customer Master. |

## 44. Final recommendation

The minimal evolution that turns the current system into a true autonomous commercial agent is:

```text
Add a CommercialWork execution contract and minimal durable work/step state,
move the allowlisted multi-intent executor onto that contract,
expand it to quote creation,
add deterministic retry/continuation,
link follow-up to waiting objectives,
then add conversation sequencing and safe executor-owned parallelism.
```

This preserves the current strengths:

- Capability Gateway;
- durable commercial facts;
- action queue;
- outbox;
- follow-up worker patterns;
- multi-intent planner/executor;
- quote draft creation;
- idempotent selection/destination;
- commercial events and capability audit.

It avoids the main anti-patterns:

- no outbox-as-workflow;
- no facts-as-hidden-work-queue;
- no LLM-only memory;
- no new workflow engine before the minimal DB-backed model is proven;
- no rigid keyword workflow replacing agentic semantic interpretation.

```text
SALES-AGENT-R2-A02: DONE

Autonomous sales execution model defined:
YES

Primary execution anchor:
CommercialWork, opportunity-scoped and trigger-driven, linked to conversation, source message, provisional customer identity, objectives, and executable steps.

Primary durable state:
Commercial facts remain in crm_request_facts; actions remain in crm_agent_actions; transport remains in brain_message_outbox; objective/step execution state requires a minimal CommercialWork persistence layer.

Objective model:
Customer-requested and system-generated objectives with type, origin, status, inputs, resolved inputs, missing requirements, supersession, and trigger correlation.

Work-step model:
Typed executable steps with dependencies, status, input/output summary, attempt count, idempotency key, retryability, next attempt, last error, and timestamps.

Waiting-customer model:
WAITING_CUSTOMER objective/step state with missing requirement, question asked, asked timestamp, follow-up policy, and stop conditions.

Waiting-system model:
WAITING_SYSTEM or RETRY_SCHEDULED steps for known deterministic work that can continue without new customer input.

Retry model:
Technical retry is deterministic and bounded; commercial retry requires renewed commercial decision; customer silence uses follow-up policy.

Follow-up integration:
Follow-up becomes objective-linked WAITING_CUSTOMER behavior and re-enters runCommercialCycle through FOLLOW_UP_DUE after revalidation.

Conversation sequencing model:
Monotonic commercial turn sequence plus optimistic work/fact version checks and a short per-conversation mutation lease.

Parallel execution model:
Executor-owned dependency-graph parallelism for SAFE_PARALLEL work only; mutations remain ordered unless dependencies prove independence and sequencing is protected.

LLM responsibilities:
Semantic interpretation, ambiguity/correction/cancellation understanding, recommendation semantics, quote/payment approval language interpretation, and customer-facing phrasing.

Deterministic runtime responsibilities:
Dependency resolution, READY/BLOCKED decisions, capability execution, idempotency, retry scheduling, work recovery, stale-work cancellation, follow-up eligibility, sequencing, policy enforcement, and evidence validation.

Existing architecture reuse:
75%

New persistence required:
PARTIAL

New worker required:
PARTIAL

External workflow engine required now:
NO

Message broker required now:
NO

Recommended implementation strategy:
CommercialWork contract first, then migrate allowlisted multi-intent execution onto it, add quote objective, add durable continuation/retry, integrate objective-linked follow-up, add conversation sequencing, then add safe parallelism.

Recommended next implementation task:
Define TypeScript contracts and read-only projection builders for CommercialWork, CommercialObjective, and CommercialWorkStep over the current C09 state, without runtime behavior changes.

Production behavior changed:
NO
```
