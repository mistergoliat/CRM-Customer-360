# SALES-AGENT-R2-A01 - Autonomous Commercial Execution Architecture Audit

Status: completed  
Scope: documentation-only architecture audit  
Production behavior changed: NO

## 1. Executive summary

This audit reconstructs the current Sales Agent runtime from code and release history, with emphasis on the observed C09 limit:

```text
Customer:
"quiero 2 de la classic y saber cuanto sale el despacho a Nunoa"
```

The system has working commercial building blocks: inbound WhatsApp ingestion, conversation persistence, native autonomous routing, a governed capability gateway, durable line item selection, durable shipping destination, shipping calculation, quote creation, outbox delivery, handoff, and follow-up scheduling. T08F also showed a strong customer-visible safety result in the tested corpus: `realFunctionalFailureRate = 0%` and `safetyFailureRate = 0%`.

The main architectural truth is that the current runtime is not one architecture, but two routed execution modes:

1. The classic Agent Tool Loop in `lib/brain/commercial/agent-loop/runAgentToolLoop.ts`.
2. The newer multi-intent planner/executor path in `lib/brain/commercial/multi-intent/**`, enabled only for allowlisted identities through `BRAIN_MULTI_INTENT_PLANNER_ENABLED` and `BRAIN_AUTONOMOUS_TEST_WA_IDS`.

The classic Agent Tool Loop is a sequential, model-driven loop where one provider decision yields one `AgentStep`, and one `AgentStep` can execute at most one tool. It defaults to three decisions, two tool executions, and a 20 second loop timeout. Reads and mutations compete for the same `maxToolExecutions` budget. Once it returns `responded`, the turn is considered terminal. There is no durable "remaining work" row that says `calculate_shipping` is pending after a response such as "Ahora calculo el despacho".

The multi-intent path partially addresses C09 by separating semantic planning from deterministic execution. It can persist semantic pending intents and execute `select_products`, `set_shipping_destination`, and `calculate_shipping` in a backend-ordered sequence. However, it is allowlisted, scoped to selected intents, sequential, and its durable state is semantic missing-requirement state, not a general durable execution/workflow state with `running`, `completed`, `failed`, `retrying`, and dependency status.

Final assessment:

```text
Current system type:
Sequential tool-calling agent with durable domain facts, plus an allowlisted deterministic multi-intent executor.

Main structural bottleneck:
The runtime has no general durable representation of remaining commercial work across turns/process restarts.

Main reliability bottleneck:
Conversation-level concurrency is only partially protected by dedupe/idempotency, not by a broad per-conversation sequence lock.

Main scalability bottleneck:
Commercial execution is sequential and LLM-mediated in the classic path; queries and commands consume the same scarce tool budget.

Recommended strategy:
INCREMENTAL_HYBRID - preserve proven domain capabilities and idempotency, expand planner/deterministic execution for multi-intent work, then add a minimal durable commercial work layer only where continuation/recovery requires it.
```

## 2. Current architecture

### CONFIRMED FROM CODE

The current inbound-to-outbound architecture is:

```text
Meta WhatsApp webhook
  -> app/api/integrations/whatsapp/webhook/route.ts
  -> processNativeWhatsAppInbound
     lib/brain/native-whatsapp/service.ts
  -> ensureAutonomousSalesTurnContinuity
  -> runNativeAutonomousCycle
     lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts
  -> buildNativeCommercialContext
     lib/brain/commercial/context/buildNativeCommercialContext.ts
  -> runNativeAgentToolLoopCycle
     lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts
  -> either:
       runAgentToolLoop
       lib/brain/commercial/agent-loop/runAgentToolLoop.ts
     or:
       runCommercialMultiIntentLoop
       lib/brain/commercial/multi-intent/runCommercialMultiIntentLoop.ts
  -> executeGovernedCapability
     lib/brain/commercial/capabilities/executeCapability.ts
  -> dispatchAgentLoopResponse
     lib/brain/commercial/agent-loop/dispatchAgentLoopResponse.ts
  -> persistAgentAction
     lib/brain/commercial/action-queue/persistAgentAction.ts
  -> buildOutboxCommand / execution gate
     lib/brain/commercial/execution-gate/**
  -> writeCanonicalOutboxMessage
     lib/brain/messaging/canonicalOutboxWriter.ts
  -> brain_message_outbox
  -> outbox worker
     lib/brain/messaging/outboxWorker.ts
  -> Meta send
```

Key responsibilities:

| Component | Responsibility |
| --- | --- |
| WhatsApp webhook route | Verify Meta webhook/signature, parse inbound messages/status updates, apply allowlist gate, call native inbound processor. |
| Native inbound service | Dedupe inbound provider message id, resolve external identity, create/update conversation, append inbound message, record commercial event, trigger autonomous continuity. |
| Native cycle | Runtime gates, routing, context loading, Sales Agent configuration, agent loop invocation. |
| Classic Agent Tool Loop | Sequential LLM decisions, tool execution, observations, final response/handoff. |
| Multi-intent loop | LLM semantic planner, deterministic requirement resolution, deterministic sequential action plan execution, finalizer. |
| Capability gateway | Single governed execution boundary for catalog, shipping, quote, selection, etc.; logs `crm_capability_executions`. |
| Request facts | Durable commercial facts such as line items, shipping destination, selected shipping option, created quote, pending commercial intents. |
| Action queue | Durable action boundary in `crm_agent_actions`; includes outbound reply actions and follow-up actions. |
| Outbox | Transport queue in `brain_message_outbox`, downstream from actions. |
| Outbox worker | Locks planned outbound messages and sends them to Meta when flags allow real sending. |
| Follow-up worker | Claims scheduled follow-up actions and re-enters a new autonomous cycle. |

### INFERENCE

The current system already has many pieces of a future autonomous commercial architecture, but they are distributed as domain facts, action rows, event summaries, and transport queues. What is missing is not "a database" or "a worker" in the abstract. The missing piece is a durable representation of commercial work remaining after a turn, with dependencies and recovery semantics.

## 3. Inbound-to-outbound flow

### Textual flow

```text
Inbound WhatsApp
  |
  v
app/api/integrations/whatsapp/webhook/route.ts
  GET: Meta verification
  POST: signature verification, parse message/status payload
  |
  v
processNativeWhatsAppInbound
  lib/brain/native-whatsapp/service.ts
  |
  | DB writes:
  | - conversation
  | - conversation_message inbound
  | - commercial_event inbound
  |
  | DB reads:
  | - existing conversation/message/external identity
  |
  v
ensureAutonomousSalesTurnContinuity
  |
  v
runNativeAutonomousCycle
  lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts
  |
  | gates:
  | - pilot allowlist
  | - customer opt-out
  | - runtime flags
  |
  v
buildNativeCommercialContext
  lib/brain/commercial/context/buildNativeCommercialContext.ts
  |
  | DB reads:
  | - conversation detail
  | - opportunity
  | - recent messages
  | - crm_request_facts for shipping destination and commercial line items
  | - customer profile/RFM where configured
  |
  v
runNativeAgentToolLoopCycle
  lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts
  |
  | if human_owner_active or ai_enabled=0:
  |   skip model
  |
  | route:
  | - runCommercialMultiIntentLoop if multi-intent allowlisted
  | - else runAgentToolLoop
  |
  v
Provider decision
  lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts
  |
  | output:
  | - JSON content parsed as AgentStep
  |
  v
AgentStep validation
  lib/brain/commercial/agent-loop/validateAgentStep.ts
  |
  v
Capability execution
  lib/brain/commercial/capabilities/executeCapability.ts
  |
  | DB writes:
  | - crm_capability_executions
  | - domain-specific crm_request_facts for mutating capabilities
  |
  v
Final response/handoff
  |
  v
dispatchAgentLoopResponse
  lib/brain/commercial/agent-loop/dispatchAgentLoopResponse.ts
  |
  | DB writes:
  | - crm_agent_actions
  | - brain_message_outbox
  | - optional conversation control for handoff
  |
  v
outboxWorker
  lib/brain/messaging/outboxWorker.ts
  |
  | DB transitions:
  | - planned -> locked -> sending -> sent/failed
  |
  v
Meta WhatsApp send
```

### Step details

| Step | File/function | Input | Output | Side effects | Timeout/retry |
| --- | --- | --- | --- | --- | --- |
| Webhook route | `app/api/integrations/whatsapp/webhook/route.ts` | Meta webhook request | HTTP response | Signature verification, status routing, inbound processor call | No explicit request-level timeout observed in route. |
| Native inbound | `processNativeWhatsAppInbound` | Message payload, `wa_id`, phone number, text, provider message id | Native processing result | Creates conversation/message/event in transaction; dedupes exact provider message id | Duplicate provider message id returns without cycle. |
| Delivery status | `applyMetaDeliveryStatus` | Meta status payload | Projection result | Updates `conversation_message`, `brain_message_outbox`, `crm_action_outcomes`, commercial event | Monotonic status rank for delivery projection. |
| Native cycle | `runNativeAutonomousCycle` | Conversation id/public id, wa id, text, correlation | Cycle result | Runtime gating; context load; loop invocation | Inherits agent loop/provider/tool deadlines; no durable work continuation by itself. |
| Context build | `buildNativeCommercialContext` | Native cycle input | `CommercialContext` snapshot | Read-only; rehydrates durable facts | Fails open for some secondary context. |
| Classic loop | `runAgentToolLoop` | User message, context summary, provider, tools | Terminal result | Executes tools through Gateway; local loop state | Defaults: 3 decisions, 2 tool executions, 20s. |
| Multi-intent loop | `runCommercialMultiIntentLoop` | Same context plus allowlisted runtime | Terminal result | Loads/saves pending semantic intents; executes scoped actions | Sequential executor; no parallel fan-out. |
| Gateway | `executeGovernedCapability` | Capability name/args/context | Capability outcome | Inserts `crm_capability_executions`; capability-specific writes | Retries only if outcome retryable and capability `maxRetries` > 0. |
| Dispatch | `dispatchAgentLoopResponse` | Terminal loop result | Dispatch result | Persists `crm_agent_actions`; writes outbox; handoff control where needed | Idempotency key; duplicate action/outbox ignored. |
| Outbox worker | `outboxWorker.ts` | Worker request/flags | Worker response | Locks/sends planned outbox rows | Lock/retry/backoff exists for outbound delivery, not commercial work. |

## 4. Agent Tool Loop

Primary file: `lib/brain/commercial/agent-loop/runAgentToolLoop.ts`.

### Definitions

| Concept | Current meaning |
| --- | --- |
| Decision | One provider call that returns one validated `AgentStep`: `use_tool`, `respond`, or `handoff`. |
| Tool execution | One accepted `use_tool` step that passes validation/evidence gates and is executed through `executeGovernedCapability`. |
| Gathering | The model/tool loop while both `decisionIndex < maxDecisions` and `toolExecutionCount < maxToolExecutions`. |
| Finalization | After gathering ends, up to two provider attempts constrained to `respond` or `handoff`; no further tool execution is accepted. |
| Turn end | Any terminal result: `responded`, `handoff`, `provider_unavailable`, `timeout`, `invalid_output`, `max_steps_exceeded`, etc. |

### Current limits

| Limit | Value |
| --- | --- |
| `DEFAULT_MAX_DECISIONS` | 3 |
| `DEFAULT_MAX_TOOL_EXECUTIONS` | 2 |
| `DEFAULT_TIMEOUT_MS` | 20000 |
| Finalization attempts | 2 |
| Tools per decision | 1 |
| Parallel tool execution | 0 |

T08E experimented with `maxToolExecutions=3` for the C09 shape and improved completion. That is useful evidence, but it does not remove the structural limits: the classic loop still uses one model decision per tool, no durable remaining-work state, and a shared budget for reads and mutations.

### Answers to required questions

1. A "decision" is a single LLM/provider decision parsed as one `AgentStep`.
2. A "tool execution" is a single accepted `use_tool` step executed via the Capability Gateway.
3. Default maximum decisions: 3.
4. Default maximum tool executions: 2.
5. Gathering ends when decision budget or tool execution budget is exhausted, or when the model returns `respond`/`handoff`, or on terminal provider/timeout failure.
6. Finalization asks the provider for `respond`/`handoff` only. Tool use is no longer available.
7. A turn ends as soon as `runAgentToolLoop` returns a terminal result and dispatch persists the outbound action/outbox row.
8. In classic loop, unresolved intentions are not represented as durable work unless the model emits the narrow `pendingCatalogAction` on a response and dispatch writes the outbox. Otherwise they disappear as executable work.
9. "Pending" is decided only in narrow mechanisms: `pendingCatalogAction` for a catalog link action in classic loop, or `pending_commercial_intents` in the multi-intent path.
10. Classic loop cannot continue work after returning. Follow-up can initiate another autonomous cycle later, but not resume the same loop state.
11. Classic loop cannot restart from a partial loop state. It can reconstruct durable domain facts and recent catalog evidence, but not local observations, decision index, or remaining planned work.
12. Persisted information: capability executions, durable request facts, `commercial_event.agent_tool_loop_completed` summary, `crm_agent_actions`, `brain_message_outbox`.
13. In-memory only: current observations array, executed-call dedupe set, active recommendation state, timer/deadline counters, provider attempts, per-turn step list before summary.
14. If the process dies mid-loop, any committed tool side effects remain. Uncommitted local loop state and unsent final response may be lost. There is no generic restart continuation.
15. If a tool takes long, the loop awaits it. The Gateway context does not carry a remaining-deadline abort signal. External clients may have their own timeouts.
16. If a tool fails in a controlled way, the loop receives a structured observation and may replan or respond. If it throws unexpectedly, the capability/Gateway path generally normalizes to a failed outcome, but consistency varies by capability.
17. If DeepSeek/provider fails with technical retryable HTTP status, the HTTP provider retries within its own deadline/backoff. Persistent failure becomes `provider_unavailable`.
18. If provider output is invalid, the loop gets `invalid_response`. It has one structured recovery path for invalid response; if unrecovered, terminal `invalid_output`/fallback.
19. If global timeout ends, provider calls use remaining budget after T08A. Tool execution itself is not globally preempted by the loop budget once awaited.
20. Completed tool executions are not rolled back when a later provider/finalization failure happens.

## 5. AgentStep/provider contract

Primary files:

- `lib/brain/commercial/agent-loop/agentStepTypes.ts`
- `lib/brain/commercial/agent-loop/validateAgentStep.ts`
- `lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts`
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts`

### Current contract

`AgentStep` is a discriminated union:

```text
use_tool
respond
handoff
```

For `use_tool`, the step has exactly:

```text
tool: <one tool name>
arguments: <one object>
```

There is no schema field for:

```text
tools: [...]
tool_calls: [...]
parallel: true
sequence: [...]
```

### Provider capability vs runtime exposure

| Layer | Current behavior |
| --- | --- |
| Provider capability | DeepSeek/OpenAI-compatible APIs may support richer tool-calling patterns externally. |
| Our provider adapter | Uses chat completions with JSON-object response content and reads `choices[0].message.content`. |
| Parser/schema | Parses a single JSON object and validates it as a single `AgentStep`. Arrays or provider-native `tool_calls` are not consumed as tool calls. |
| Runtime | Executes at most one tool for one `use_tool` step, then calls the provider again. |

### Multiple tool calls

There is no structural support for multiple tool calls in one decision. If the provider returned native `tool_calls`, the current adapter would not iterate over them. If the model encoded an array in message content, the validator expects an object-shaped `AgentStep`; additional calls are not a first-class runtime concept.

This is not necessarily a provider limitation. It is a deliberate runtime contract:

```text
one provider call -> one AgentStep -> at most one tool execution
```

### Tests/history

T08B/T08C/T08D document the history around DeepSeek thinking mode, JSON validity, tool budget pressure, and the mutation guard. The current shape favors strict, inspectable, sequential steps over provider-native multi-tool emission.

## 6. LLM call architecture

The classic loop returns to the model after each tool because the model owns both semantic interpretation and next-step orchestration.

### Typical cases

| Case shape | Typical classic calls | Classification |
| --- | --- | --- |
| Simple conversational answer | 1 call: respond | `SEMANTICALLY_NECESSARY` |
| Search product | Call 1: choose search; Call 2: respond with results | Call 1 semantic/tool selection, Call 2 `RUNTIME_ORCHESTRATION` plus response generation |
| Select product after clear catalog context | Call 1: choose `select_products`; Call 2: respond | Call 1 `SEMANTICALLY_NECESSARY`, Call 2 possibly necessary for customer-visible confirmation |
| Calculate shipping when durable selection + destination already exist | Call 1: choose `calculate_shipping`; Call 2: respond | Call 1 semantic/tool selection; Call 2 response generation |
| C09 classic path | Call 1: choose details/search or destination; Call 2: choose next tool; Call 3: choose next tool or finalization | Several calls are `RUNTIME_ORCHESTRATION` because dependency order is not deterministic in runtime. |

### C09 under T08D/T08E/T08F

Observed/historical C09 pattern:

```text
get_product_details
-> set_shipping_destination
-> select_products
-> final response
```

With default `maxToolExecutions=2`, a preparatory read can consume a slot before the necessary mutations. With benchmark-only `maxToolExecutions=3`, T08E saw much better `select_products` completion. T08F classified customer-visible behavior as safe in the audited live corpus, but the architecture still lacks an automatic continuation after a response.

### Necessity analysis

| Call | Why it exists today | Classification |
| --- | --- | --- |
| Initial LLM call | Interpret user message and choose first action | `SEMANTICALLY_NECESSARY` in classic loop |
| Post-tool LLM call | Decide what to do after observation | Often `RUNTIME_ORCHESTRATION`; sometimes semantically necessary for ambiguity |
| Final LLM call | Produce customer-visible response | `SEMANTICALLY_NECESSARY` for natural language, but no tools allowed in finalization |
| Repeated post-tool calls in multi-intent case | Runtime lacks deterministic dependency planner in classic path | `POSSIBLY_REDUNDANT` when dependencies are known by backend |

The multi-intent loop is evidence that not every post-tool decision needs to be model-mediated. It uses the model for semantic intent extraction and final wording, while deterministic code resolves requirements and orders executable capabilities.

## 7. State inventory

### Conversation state

| State | Source | Notes |
| --- | --- | --- |
| Conversation row | `conversation` | Status, public id, channel/account, human ownership, AI enabled. |
| Messages | `conversation_message` | Inbound/outbound timeline and provider ids. |
| External identity | customer external identity/native resolution tables | Used to relate `wa_id` and channel identity. |
| Delivery status | `conversation_message`, `brain_message_outbox`, `crm_action_outcomes` | Meta status projection is monotonic. |
| Human control | `conversation.human_owner_active`, `conversation.ai_enabled` | Handoff takes control before acknowledgement when persistence is enabled. |

### Commercial state

| State | Source | Notes |
| --- | --- | --- |
| Opportunity | `crm_opportunities` | Active commercial context; no definitive Customer Master. |
| Need profile | `crm_sales_need_profiles` | Contextual profile from current sales flow. |
| Line items | `crm_request_facts` fact type `commercial_line_items` | Durable full selection; same selection idempotent. |
| Shipping destination | `crm_request_facts` fact type `shipping_destination` | Durable resolved commune; same commune idempotent. |
| Shipping options | Capability execution observations plus selected shipping fact | `calculate_shipping` itself does not persist options as durable current state; `select_shipping_option` validates against prior execution. |
| Created quote | `crm_request_facts` fact type `created_quote` | Quote Service integration persists created/reused draft quote. |
| Checkout/payment | Not observed as wired Sales Agent capability | Treat as not available in current runtime. |

### Agent state

| State | Source | Notes |
| --- | --- | --- |
| Recent catalog context | Reconstructed from `crm_capability_executions` and `commercial_event` | Durable evidence, reconstructed per turn. |
| Tool observations | In-memory during loop; projected to event summaries | Not resumable as full execution state. |
| Pending catalog action | Latest `agent_tool_loop_completed` event payload | Narrow catalog-link continuation context. |
| Pending commercial intents | `crm_request_facts` fact type `pending_commercial_intents` | Multi-intent semantic state, allowlisted path. |
| Customer profile/RFM | Customer Profile/RFM loaders | Contextual, fail-open, not transaction state. |

### Durable work state

Search result:

| Work state shape | Exists? | Where | Fit for commercial continuation |
| --- | --- | --- | --- |
| `requested` | Partial | `crm_agent_actions` for actions; pending intents for semantic requests | Not a general commercial workflow. |
| `pending` | Partial | `pendingCatalogAction`, `pending_commercial_intents`, planned follow-ups | Narrow meanings only. |
| `running` | Partial | Follow-up `executing`, outbox `locked/sending` | Applies to follow-up/outbound transport, not arbitrary tools. |
| `completed` | Yes for domain facts/capability logs | `crm_request_facts`, `crm_capability_executions` | Completed facts are durable. |
| `failed` | Partial | `crm_agent_actions`, outbox, capability executions | Failure exists per action/transport/capability, not per remaining work graph. |
| `blocked` | Partial | Tool observations, action statuses, policy notes | Not general resumable dependency state. |
| `retrying` | Partial | Follow-up attempts, outbox retry/backoff, provider technical retry | No general commercial work retry queue. |
| `deferred` | Partial | Follow-up scheduled action | Follow-up starts a new turn; it does not resume incomplete tool work. |

## 8. Pending intent/work

### PendingCatalogAction

Files:

- `lib/brain/commercial/agent-loop/agentStepTypes.ts`
- `lib/brain/commercial/agent-loop/pendingCatalogAction.ts`
- `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts`

What can be pending:

```text
send_product_link
```

Persistence:

```text
commercial_event.payload_json.pendingCatalogAction
event_type = agent_tool_loop_completed
```

Important constraints:

- It is loaded only from the latest `agent_tool_loop_completed` event for the conversation.
- If a later event has no pending action, older pending action is no longer current.
- It is persisted only when dispatch wrote/deduped an outbox row.
- It cannot represent arbitrary tools, dependencies, retries, or execution state.

Conclusion:

```text
pendingCatalogAction = semantic/customer-response continuation context
pendingCatalogAction != durable work queue
```

### Pending commercial intents

Files:

- `lib/brain/commercial/multi-intent/pendingIntentState.ts`
- `lib/brain/commercial/multi-intent/types.ts`
- `lib/brain/commercial/multi-intent/runCommercialMultiIntentLoop.ts`

What can be pending:

```text
select_products
get_shipping_quote
unsupported
```

Persisted as:

```text
crm_request_facts
fact_type = pending_commercial_intents
anchor = opportunity:<id>
status = inferred
```

It stores intent plus missing requirements. It survives restart. It is removed/updated by the multi-intent loop when requirements are resolved or remain missing.

However:

- It does not represent a general execution state machine.
- It does not store each capability as `running/completed/failed/retrying`.
- It does not support arbitrary future capabilities like quote acceptance/payment.
- It is behind allowlisted routing.

Conclusion:

```text
pending_commercial_intents = "I know what the customer meant and what information is missing"
pending_commercial_intents != "I know every remaining execution step and can resume it exactly"
```

## 9. Capability inventory

Primary registry: `lib/brain/commercial/capabilities/registry.ts`.

| Capability | Read/Write | Mutates state | External service | Idempotent | Retryable | Timeout | Dependencies | Current safety guard |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `search_products` | Read | No | Catalog Search V2 | N/A | Capability `maxRetries` observed as 0 in adapter context | External/client-specific | Catalog config | Read-only projection; bounded observation. |
| `get_product_details` | Read | No | Catalog | N/A | UNKNOWN/adapter-specific | External/client-specific | Product evidence/id | Gated when pending recommendation action active. |
| `search_company_knowledge` | Read | No | Fixture/local knowledge | N/A | UNKNOWN | None/UNKNOWN | Knowledge fixture | Read-only, not productive knowledge. |
| `explore_catalog` | Read | No | Catalog | N/A | UNKNOWN | External/client-specific | Catalog config | Read-only projection. |
| `recommend_catalog_products` | Read | No | Catalog/recommendation adapter | N/A | `maxRetries` 0 observed | External/client-specific | Source product evidence | Evidence gate requires observed source product. |
| `set_shipping_destination` | Write | Yes, `shipping_destination` fact | Commune resolver/local data | Same commune idempotent | `maxRetries` 0 | Resolver/client-specific | Active opportunity, resolvable destination | Only resolved commune persists. |
| `select_products` | Write | Yes, `commercial_line_items` fact | DB/catalog evidence from context | Same selection idempotent | `maxRetries` 0 | DB/catalog validation dependent | Active opportunity, observed products | Evidence gate requires observed products/variants; mutation guard protects claims. |
| `calculate_shipping` | Read | No durable shipping option write | Carrier MS plus Catalog batch | N/A | Outcome can mark retryable but `maxRetries` 0 | Carrier/client-specific | Active opportunity, line items, shipping destination, catalog batch | Requires durable selection and destination. |
| `select_shipping_option` | Write | Yes, selected shipping option fact | DB/current capability evidence | Same option likely idempotent by service semantics; exact implementation should be rechecked before production expansion | `maxRetries` 0 | DB | Prior fresh `calculate_shipping` execution, matching fact ids | Capability-internal evidence freshness gate. |
| `create_quote` | Write | Yes, Quote Service draft and `created_quote` fact | Quote Service HTTP port | Deterministic idempotency key and local reuse by selection fact | Local persist failure marked retryable, but `maxRetries` 0 | Quote Service/client-specific | Active opportunity, selected products, Quote Service availability | No args; assembles quote without required shipping. |
| Customer Profile/RFM | Read context, not Agent Tool Loop tool | No current transaction mutation | Customer Profile/local adapter | N/A | Fail-open | Loader-specific | Customer/profile availability | Context only; failures do not block sale. |
| Handoff | Write/control | Conversation ownership flags and outbound acknowledgement | DB/outbox | Action/outbox idempotent | Outbox retry | Outbox/Meta | Terminal handoff result | Takes human control before acknowledgement. |
| Follow-up | Write/scheduled action | `crm_agent_actions` `schedule_followup` | DB, later autonomous cycle | Active sequence/idempotency guards | Attempts/backoff/stale recovery | Worker tick, no exact request deadline | Opportunity/conversation/config/policy | CAS claim, revalidation, allowlist, opt-out. |
| Customer onboarding | Partial/contextual | Existing onboarding/identity state | DB | UNKNOWN | UNKNOWN | UNKNOWN | Onboarding state | Not a general Sales Agent commercial tool in current loop. |
| Checkout/payment | Not available | No | N/A | N/A | N/A | N/A | N/A | No current Sales Agent capability observed. |
| Email/quote delivery | Not available as autonomous end-to-end capability | No | N/A | N/A | N/A | N/A | N/A | Quote creation exists; delivery flow not wired end to end. |

## 10. Queries vs commands

### Classification

| Tool/capability | Classification | Evidence |
| --- | --- | --- |
| `search_products` | QUERY | Catalog read-only. |
| `get_product_details` | QUERY | Catalog read-only. |
| `search_company_knowledge` | QUERY | Knowledge read-only. |
| `explore_catalog` | QUERY | Catalog read-only. |
| `recommend_catalog_products` | QUERY | Recommendation read-only. |
| `calculate_shipping` | QUERY | Calls Carrier MS and returns options; does not persist selected option. |
| Customer Profile/RFM | QUERY | Context loader only. |
| `set_shipping_destination` | COMMAND | Persists durable shipping destination fact. |
| `select_products` | COMMAND | Persists durable commercial line items. |
| `select_shipping_option` | COMMAND | Persists selected shipping option fact. |
| `create_quote` | COMMAND | Calls Quote Service and persists created quote fact. |
| Handoff | COMMAND | Changes conversation control and sends acknowledgement. |
| Follow-up scheduling | COMMAND | Persists `crm_agent_actions` scheduled action. |
| Outbox send | COMMAND/TRANSPORT | Sends message externally via Meta. |

### Runtime distinction

The Capability Gateway has formal governance metadata, including side-effect classification (`read_only` vs `mutating`). The classic Agent Tool Loop does not use that distinction to allocate separate budgets or scheduling rules.

Therefore:

```text
search_products
get_product_details
set_shipping_destination
select_products
calculate_shipping
create_quote
```

all compete for the same `maxToolExecutions` counter once executed by the classic loop.

This directly relates to T08D/T08E: read/preparatory work can consume the limited execution slots before required mutations and derived reads complete.

## 11. Dependency graph

### Real dependency graph

```text
Inbound message
  |
  v
Conversation + opportunity context
  |
  +--> Customer Profile/RFM context
  |      (optional/fail-open, no current transaction mutation)
  |
  +--> Recent catalog context
         |
         +--> search_products / explore_catalog / get_product_details
         |      |
         |      v
         |   observed product evidence
         |      |
         |      v
         +--> recommend_catalog_products
                (requires observed source product)

Observed product evidence
  |
  v
select_products
  |
  v
commercial_line_items fact
  |
  +-------------------------+
                            |
Shipping destination text   |
  |                         |
  v                         |
set_shipping_destination    |
  |                         |
  v                         |
shipping_destination fact   |
  |                         |
  +-----------+-------------+
              |
              v
      calculate_shipping
              |
              v
      shipping options observation
              |
              v
      select_shipping_option
              |
              v
      selected shipping option fact

commercial_line_items fact
  |
  v
create_quote
  |
  v
Quote Service draft + created_quote fact
```

### Capability requirements

| Capability | Required prior state |
| --- | --- |
| `search_products` | Catalog service availability. |
| `get_product_details` | Product identifier/evidence. |
| `recommend_catalog_products` | Observed source product in recent catalog context or current observations. |
| `set_shipping_destination` | Active opportunity and resolvable destination. |
| `select_products` | Active opportunity and observed product/variant evidence. |
| `calculate_shipping` | Active opportunity, durable commercial line items, durable shipping destination, catalog batch product data, Carrier MS availability. |
| `select_shipping_option` | Prior fresh `calculate_shipping` capability execution whose option index matches current selection/destination facts. |
| `create_quote` | Active opportunity, durable selected products, Quote Service availability. Shipping is currently not required. |

## 12. Parallelism

### Current state

| Question | Answer |
| --- | --- |
| Does any Agent Tool Loop tool execute in parallel? | NO. |
| Does classic Agent Tool Loop support concurrency? | NO. |
| Does multi-intent executor run actions in parallel? | NO, it uses ordered sequential execution. |
| Is there `Promise.all` for commercial tools? | Not for Agent Tool Loop tool execution. Some context loading uses parallel/fail-open patterns, but not commercial tool execution. |
| Are there locks that prevent all parallelism? | Not a global tool lock. There are idempotency/CAS/advisory locks for specific action/follow-up/outbox cases. |

### Parallelism matrix

| Tool A | Tool B | Can run parallel? | Why |
| --- | --- | --- | --- |
| `search_products` | `search_company_knowledge` | Theoretically yes, currently no | Both are reads, but classic runtime has no parallel execution model. |
| `get_product_details` | `set_shipping_destination` | Theoretically yes if destination independent, currently no | One reads product, one resolves destination; no runtime fan-out. |
| `select_products` | `set_shipping_destination` | Sometimes yes conceptually, currently no | They write different facts, but both depend on active opportunity and can race with newer turns. |
| `select_products` | `calculate_shipping` | No | Shipping requires durable selected line items. |
| `set_shipping_destination` | `calculate_shipping` | No | Shipping requires durable destination. |
| `calculate_shipping` | `select_shipping_option` | No | Selection requires prior shipping options. |
| `select_products` | `create_quote` | No | Quote requires durable selection. |
| `create_quote` | `calculate_shipping` | Partially | Current quote does not require shipping, but both depend on selected line items and may be semantically ordered by customer expectation. |
| Outbox send | Follow-up tick | Operationally separate | They are separate workers over different action/transport rows, not parallel tool execution inside one commercial request. |

### Race risks

Without conversation-level sequencing, two distinct inbound messages may process at the same time and update the same opportunity facts. Idempotency protects exact duplicates and same-value writes, but it does not fully prevent stale-turn overwrites when messages are distinct.

## 13. Idempotency

### Mutation matrix

| Mutation | Idempotency mechanism | Duplicate behavior | Remaining risk |
| --- | --- | --- | --- |
| Inbound webhook exact duplicate | Provider message id dedupe in `conversation_message(provider, provider_message_id)` path | Duplicate inbound is ignored before autonomous cycle | Different provider message ids for semantically same text are not deduped. |
| `set_shipping_destination` | Same resolved commune check before fact upsert | Same commune returns unchanged; different commune supersedes prior fact | Concurrent older turn can overwrite newer destination if it commits later. |
| `select_products` | Selection normalization/compare; full replacement fact | Same selection unchanged; different selection supersedes prior fact | "Mejor 3" vs older "2" can race without conversation sequencing. |
| `select_shipping_option` | Evidence freshness against prior `calculate_shipping` execution and current fact ids | Prevents stale option selection when facts changed | Exact duplicate idempotency should be rechecked before expanding scope. |
| `create_quote` | Deterministic idempotency key `create-quote:<opportunityId>:<selectionFactId>` hash; local created quote reuse | Same selection should reuse upstream/local draft | If upstream succeeds and local persistence fails, retry relies on upstream idempotency and later local persist. |
| Handoff | `takeHumanControlForAiHandoff`; action/outbox idempotency | Terminal handoff controls conversation before ack | Repeated handoff mostly safe, but broader state race still possible. |
| `persistAgentAction` outbound reply | `idempotency_key`; optional single-reply advisory lock by conversation/message/action type | Duplicate action ignored/updated/reused | Only callers using `enforceSingleReplyPerMessage` get broader duplicate suppression. |
| Follow-up scheduling | Idempotency key plus active follow-up sequence key/advisory lock | At most one active follow-up per sequence | Follow-up is not generic work continuation. |
| Outbox write | Canonical dedupe key over channel/action/idempotency/recipient/content | Duplicate outbox row ignored/reused | Transport duplicate protected; message order still depends on worker processing. |
| Meta delivery status | Provider status projection rank | Monotonic status updates | Applies to delivery, not commercial mutation. |

### Timeout side effects

If the provider times out, no later provider side effect exists because provider calls only produce JSON. If a tool call is already underway and the loop budget expires, the tool may still complete because Gateway does not carry a global abort signal. Completed domain mutations remain committed even if final response later fails.

## 14. Retry model

### Retry classes

| Class | Current model |
| --- | --- |
| LLM retry | HTTP provider retries technical status codes `429/500/502/503/504` with backoff while deadline remains. Invalid model JSON has a structured recovery path in the loop, not generic HTTP retry. |
| Tool retry | `executeGovernedCapability` retries only when outcome is retryable and capability `maxRetries` allows it. Most audited mutating capabilities use `maxRetries = 0`. |
| Network retry | Provider has retry; external capability clients vary by adapter. |
| Business retry | Follow-up has attempt numbers, stale execution recovery, max attempts, and bounded technical backoff. |
| Outbox retry | Outbox has statuses, lock/retry/backoff migrations, stale locked reporting/recovery paths. |
| DB retry | No broad automatic DB retry around arbitrary transactions; specific duplicate-key races handled in action persistence. |

### Capability retry observations

| Area | Retry behavior |
| --- | --- |
| Catalog | Read tools may return unavailable/blocked observations; max retries generally not used in Gateway for observed adapters. |
| Shipping | Carrier/catalog failures can be classified retryable at outcome level, but `calculate_shipping` `maxRetries` is 0. |
| Quote | Some failures marked retryable, including local persistence failure after upstream success, but Gateway `maxRetries` 0 means no automatic same-turn retry. |
| Customer Profile | Context loading is fail-open; not a blocking commercial retry loop. |
| Meta send | Outbox worker handles delivery attempts/status transitions; real send gated by flags. |

### Retry storm risk

Current risk is moderate/contained because most tool `maxRetries` are 0 and workers have batch/attempt controls. The main risk is not retry storms; it is incomplete work requiring a new inbound turn or manual/operator visibility.

## 15. Timeout/deadline model

### Diagram

```text
Inbound HTTP request
  no explicit route-level deadline observed
  |
  v
runNativeAutonomousCycle
  |
  v
Agent Tool Loop budget
  default 20s
  |
  +-- provider call 1
  |     HTTP deadline uses remaining budget after T08A
  |
  +-- tool execution 1
  |     no Gateway-level remaining-deadline abort signal observed
  |
  +-- provider call 2
  |     HTTP deadline uses remaining budget
  |
  +-- tool execution 2
  |     awaited; external clients may have own timeouts
  |
  +-- finalization provider call(s)
        no tools accepted
```

### T08A relevance

T08A fixed an important bug where provider `fetch` and `response.json()` did not share one enforced deadline. Now the provider deadline is more trustworthy.

Remaining timeout boundaries:

- The inbound route itself does not define an explicit full request budget in the inspected code.
- The classic loop passes remaining budget to provider calls.
- Tool execution is not globally aborted by loop deadline.
- External services such as Catalog, Carrier MS, and Quote Service depend on their adapter/client-specific timeout behavior.
- Outbox worker is a separate asynchronous transport lifecycle, not part of the inbound request budget.

### Abandoned work

If the process dies after a mutating tool commits but before response dispatch, durable facts remain but the customer may not get a response. There is no generic "resume turn and finish remaining actions" record.

## 16. Provider failure model

### Representation

Provider failure is represented as structured loop/provider results, not only thrown exceptions.

Observed categories include:

```text
provider_unavailable
timeout
invalid_response
invalid_output
empty_response / schema-like invalidity through invalid_response paths
```

### Flow

```text
httpAgentLoopProvider
  -> technical HTTP retry for selected status codes
  -> parseModelJson
  -> validateAgentStep
  -> provider result / invalid_response
  -> runAgentToolLoop recovery or terminal result
  -> dispatchAgentLoopResponse fallback
  -> crm_agent_actions + outbox
  -> commercial_event.agent_tool_loop_completed with provider failure metrics
```

### What the user sees

The user sees a safe fallback message, not raw provider errors. For handoff, the user sees the continuity handoff acknowledgement.

### Metrics/persistence

`runNativeAgentToolLoopCycle` records `agent_tool_loop_completed` events with step summary, tool counts, config, terminal reason, provider failure where available, and LLM metrics. Recent ACTIVE_RELEASE notes identify an observability gap: `crm_agent_actions.failure_reason` can remain `NULL` for provider fallback because `dispatchAgentLoopResponse` does not currently map `providerFailure.normalizedReason` into that column.

### Continuation without provider

The classic Agent Tool Loop cannot continue semantic work without provider output. Already completed tool mutations remain, but deciding/responding requires either fallback or a later new cycle.

## 17. Tool failure model

### Patterns

| Failure | Current pattern |
| --- | --- |
| Catalog unavailable | Tool returns structured unavailable/blocked observation where adapter supports it; model can respond safely. |
| Shipping unavailable | `calculate_shipping` can return structured unavailable/temporarily blocked outcomes; requires durable selection/destination first. |
| Quote unavailable | `create_quote` availability checks Quote Service port; unavailable blocks capability. |
| Customer Profile unavailable | Context load fails open; does not block core sale. |
| DB unavailable | DB failures can fail persistence/capability/action writes; no generic continuation. |

C10 showed a controlled failure can remain safe. The pattern is directionally good but not a uniform durable execution model. Some failures are observations available to the LLM; some are terminal dispatch/persistence failures; some are fail-open context omissions.

### Provider failure vs tool failure

```text
provider failure:
  no reliable next semantic decision/final response from model

tool/service failure:
  capability may return a structured observation; model/finalizer can still explain, defer, or hand off
```

The multi-intent executor improves consistency by deterministically classifying requirement/action failures before finalization, but it is scoped and allowlisted.

## 18. Mutation safety

Primary code: `checkUnbackedCommercialMutationClaim` inside `runAgentToolLoop.ts`.

### Current protection

The Commercial Mutation Execution Guard protects against customer-visible claims that product selection/quantity/order-like selection was completed when this turn did not have a completed `select_products` step.

It accepts evidence from this turn's completed `select_products` execution. If the final message claims an unbacked selection mutation, it replaces the message with a fixed safe fallback and drops `pendingCatalogAction`.

### Scope

| Mutation | Guarded by current text claim guard? |
| --- | --- |
| `select_products` | YES, specifically. |
| `set_shipping_destination` | NO general claim guard observed. |
| `calculate_shipping` | Not a mutation; no analogous "calculated shipping" claim guard. |
| `select_shipping_option` | NO general claim guard observed. |
| `create_quote` | NO general claim guard observed. |
| Handoff/control | Controlled by dispatch/handoff path, not this guard. |
| Future accept quote/checkout/payment | NO current general guard. |

### Architectural role

The guard is a useful safety patch for a known false-claim class found in T08D. It is not yet a generalized mutation-proof system. Future mutations will need either:

- one guard per mutation claim class, or
- a generalized response-grounding layer that maps every customer-visible mutation claim to durable capability/fact evidence.

## 19. Conversation concurrency

Scenario:

```text
T0:
"quiero 2 Classic y despacho a Nunoa"

T0+1s:
"mejor 3"

T0+2s:
"y a Las Condes"
```

### Current mechanisms

| Mechanism | Exists | Scope |
| --- | --- | --- |
| Exact inbound duplicate dedupe | YES | Same provider message id. |
| Per-conversation broad processing lock | NO observed | Distinct inbound messages can trigger separate cycles. |
| Message ordering guarantee by message id | PARTIAL/NO | Message ids identify messages, not a processing sequence lock. |
| `persistAgentAction` single reply lock | PARTIAL | Optional for same conversation/message/action type. |
| Request fact idempotency | PARTIAL | Same value safe; different value supersedes. |
| Follow-up CAS | YES | Follow-up worker rows, not inbound turn sequencing. |
| Outbox locks | YES | Transport rows, not commercial turn ordering. |

### Risk

Distinct inbound messages can plausibly process concurrently. An older turn can commit a later write to `commercial_line_items` or `shipping_destination` after a newer turn, because the domain fact services compare same-value idempotency but do not enforce "newer inbound wins" sequencing.

Possible outcomes:

- double selection attempts;
- stale quantity overwriting newer quantity;
- stale shipping destination overwriting newer destination;
- responses written to outbox in a different order from customer intent;
- one turn answering based on context that became stale while it was processing.

Current protections reduce duplicate sends and exact duplicate webhook effects. They do not fully serialize commercial state by conversation.

## 20. Outbox

Primary files:

- `migrations/003_brain_message_outbox.sql`
- `migrations/014_outbox_retry_backoff.sql`
- `lib/brain/messaging/canonicalOutboxWriter.ts`
- `lib/brain/messaging/outboxWorker.ts`
- `lib/brain/messaging/outboxTransitions.ts`

### Contract

`brain_message_outbox` is a downstream transport queue for outbound messages, not the source of truth for commercial action execution.

It stores:

- WhatsApp outbound messages;
- recipient/channel/phone number;
- message text/payload;
- provider message id;
- transport status;
- error fields;
- dedupe key;
- conversation correlation.

Statuses include the planned/locked/sending/sent/failed/cancelled/blocked family through the outbox transition model and migrations.

### Capabilities

| Question | Answer |
| --- | --- |
| Can it store outbound delivery? | YES. |
| Can it store future commercial execution? | Not by contract. |
| Does it have retries? | YES, for transport delivery. |
| Does it have locks? | YES, for worker claiming/sending rows. |
| Does it provide ordering? | PARTIAL; worker selects batches by planned/id order, but it is not a conversation workflow sequencer. |
| Does it provide idempotency? | YES, canonical dedupe key. |
| Could it be reused for commercial continuity? | Only partially as an implementation reference. Its semantics are transport-specific, not a general work queue. |

## 21. Follow-up

Primary files:

- `lib/brain/commercial/followup/runFollowupTick.ts`
- `lib/brain/commercial/followup/computeFollowUpSchedule.ts`
- `lib/brain/commercial/action-queue/persistAgentAction.ts`
- `migrations/027_crm_agent_actions_followup_scheduling.sql`

### Current behavior

Follow-up uses `crm_agent_actions` rows with `action_type = 'schedule_followup'`.

Trigger:

```text
scheduled_for <= now
```

Worker candidate statuses:

```text
planned due
executing stale
failed with attempts remaining
```

Claim model:

- CAS update to `executing`;
- stale executing recovery increments attempt once when attempts remain;
- exhausted stale executing rows terminalize to `failed`;
- revalidates opt-out, conversation/human ownership, opportunity status, current configuration, allowed window;
- then re-enters `runNativeAutonomousCycle`.

### What state it preserves

It preserves:

- scheduled action id;
- `wa_id`;
- conversation/opportunity references;
- draft message;
- attempt number/max attempts;
- configuration attribution;
- sequence key.

### Can it resume incomplete tool work?

No. Follow-up can start a new autonomous cycle with a follow-up message. It can reconstruct durable commercial facts through normal context loading, but it does not know "the previous turn still needed `calculate_shipping`" unless that need is represented elsewhere semantically and routed into the new cycle.

### Reusable infrastructure

Reusable:

- CAS claim pattern;
- stale execution recovery;
- max attempts;
- bounded technical backoff;
- revalidation before execution;
- action sequence uniqueness.

Not directly reusable as-is:

- dependency graph execution for arbitrary capabilities;
- durable per-step commercial work state;
- multi-tool continuation inside one customer request.

## 22. Quote integration

Primary files:

- `docs/releases/SALES-AGENT-R1-T3-create-quote-wiring.md`
- `lib/brain/commercial/capabilities/**createQuote**`
- Quote assembly/service adapter modules under commercial domains.

### Current map

| Quote capability area | Status | Notes |
| --- | --- | --- |
| Quote Service exists | IMPLEMENTED/WIRED | Sales Agent has `create_quote` capability requiring Quote Service port availability. |
| Create draft quote | WIRED | No args; assembles from active opportunity and durable selected products. |
| Persist created quote fact | WIRED | `created_quote` stored in `crm_request_facts`; reuse by selection fact id. |
| Idempotency | WIRED | Deterministic idempotency key from opportunity and selection fact. |
| Shipping in quote | PARTIAL/NOT_REQUIRED | Current assembly uses `requireShipping:false`; not full shipping quote. |
| Issue/finalize quote | NOT_AVAILABLE in Sales Agent end-to-end path | Not observed as autonomous capability. |
| PDF | NOT_AVAILABLE/UNKNOWN | No current Sales Agent autonomous PDF delivery verified. |
| Email | NOT_AVAILABLE | No autonomous email quote delivery capability observed. |
| WhatsApp quote summary | PARTIAL | Agent can respond with summary after `create_quote`, but delivery lifecycle beyond outbox text is separate. |
| Quote status lifecycle | PARTIAL | Created quote fact exists; full quote lifecycle not audited as production-ready here. |
| Accept quote | NOT_AVAILABLE | No Sales Agent tool observed. |
| Payment/checkout | NOT_AVAILABLE | No Sales Agent tool observed. |
| Production-ready DB validation | PARTIAL | R1-T3 noted pending real DB validation at the time; current code should be validated in a separate task before expanding. |

Conclusion:

```text
Quote Service integration exists for draft creation.
Sales Agent does not yet autonomously handle quote issue -> delivery -> accept -> payment end to end.
```

## 23. Customer Profile role

Customer Profile/RFM is contextual intelligence, not the current commercial transaction state.

### Current role

| Question | Answer |
| --- | --- |
| Stores current cart/selection? | NO. Selection is `commercial_line_items` in request facts. |
| Stores shipping destination? | NO. Destination is `shipping_destination` fact. |
| Stores quote state? | NO. Quote state is `created_quote` fact/Quote Service. |
| Conditions agent decisions? | YES, included in context summary when available. |
| Synchronous dependency? | PARTIAL; loaded as context, designed to fail open. |
| Blocks sale on failure? | NO in observed context-loading design. |

It should not be promoted to Customer Master or transaction truth. Current AGENTS instructions also require identity to remain provisional until `customer_master` exists.

## 24. Durable vs in-memory state

| State | Durable DB | In-memory only | Reconstructible | Lost on restart |
| --- | --- | --- | --- | --- |
| Conversation | YES | NO | YES | NO |
| Conversation messages | YES | NO | YES | NO |
| Human ownership / AI enabled | YES | NO | YES | NO |
| Opportunity | YES | NO | YES | NO |
| Need profile | YES | NO | YES | NO |
| Recent catalog context | Source durable | Projection in turn | YES from `crm_capability_executions`/events | Projection yes, source no |
| Tool observations this turn | Summary/event partially | YES | PARTIAL from capability logs | Full local form yes |
| Executed calls dedupe set | NO | YES | NO | YES |
| Decision index/tool count | Event summary after completion | YES during loop | PARTIAL after normal completion | YES mid-loop |
| Selected items | YES | NO | YES | NO |
| Shipping destination | YES | NO | YES | NO |
| Shipping options from calculation | Capability execution log | Observation in turn | PARTIAL | Current choice context may be lost unless selected |
| Selected shipping option | YES when selected | NO | YES | NO |
| Quote | YES after create/persist | NO | YES | NO |
| PendingCatalogAction | YES in latest event payload | Also loaded in turn | YES if latest event has it | NO if persisted; yes if mid-turn |
| Pending commercial intents | YES in request facts | Also loaded in turn | YES | NO |
| Agent Loop local state | NO | YES | NO | YES |
| Provider conversation state | NO separate provider thread state observed | YES only request/response | NO | YES |
| Follow-up scheduled action | YES | NO | YES | NO |
| Outbox transport row | YES | NO | YES | NO |
| Remaining work after `respond` | NO general state | Often only model language | NO | YES |

## 25. C09 reconstruction

Input:

```text
"quiero 2 de la classic y saber cuanto sale el despacho a Nunoa"
```

### Classic Agent Tool Loop path

Conceptual execution from current code:

```text
Inbound persisted
  |
  v
Context loaded:
  - conversation
  - opportunity
  - recent messages
  - durable line items if any
  - durable destination if any
  - recent catalog evidence
  - customer profile/RFM optional
  |
  v
Provider decision 1
  -> one AgentStep
  -> often get_product_details/search-like preparatory read OR set_shipping_destination
  |
  v
Tool execution 1
  -> observation stored in memory
  -> capability execution logged
  -> if mutating, request fact persisted
  |
  v
Provider decision 2
  -> one AgentStep
  -> next single tool
  |
  v
Tool execution 2
  -> toolExecutionCount reaches default maxToolExecutions=2
  |
  v
Gathering ends
  |
  v
Finalization:
  -> provider may only respond/handoff
  -> cannot call calculate_shipping now
  |
  v
dispatchAgentLoopResponse
  -> crm_agent_actions
  -> brain_message_outbox
  -> commercial_event summary
```

If the executed tools are:

```text
select_products = completed
set_shipping_destination = completed
calculate_shipping = not executed
```

then durable state after response is:

```text
commercial_line_items fact = present
shipping_destination fact = present
calculate_shipping pending work = absent
```

The phrase:

```text
"Ahora calculo el despacho a Nunoa"
```

is:

```text
MODEL_LANGUAGE
```

unless another mechanism actually persisted a pending intent/work item or later executes `calculate_shipping`.

### Multi-intent path

When routed through `runCommercialMultiIntentLoop`, the architecture changes:

```text
Planner LLM
  -> semantic intents
Requirement resolver
  -> PRODUCT / QUANTITY / DESTINATION / PRODUCT_SELECTION
Execution planner
  -> ordered action plan
Action executor
  -> select_products
  -> set_shipping_destination
  -> calculate_shipping
Finalizer LLM
  -> response
```

This is a better fit for C09, but it is currently allowlisted/scoped and still sequential. Its pending state is semantic missing-requirement state, not a general resumable work execution graph.

### Exact limitation

The limitation is not only `maxToolExecutions=2`.

The structural limit is:

```text
Classic runtime asks the model to choose one tool at a time, charges reads and mutations against one shared tool budget, and has no durable representation of remaining work after terminal response.
```

Raising budget helps some cases. It does not create durable continuation, dependency-aware execution, parallelism, or stale-turn protection.

## 26. Complex commercial scenario reconstruction

### Scenario 1

```text
"quiero dos Classic,
tienes alguna parecida pero mas barata?,
y cuanto sale mandar todo a Nunoa?"
```

Likely needed operations:

1. Identify "Classic".
2. Search/details for Classic.
3. Find cheaper comparable products.
4. Select two Classic only if customer intent is firm, or ask clarification if recommendation may change selection.
5. Resolve Nunoa destination.
6. Calculate shipping for selected line items and destination.
7. Respond with comparable options and/or shipping result.

Classic loop pressure:

| Step | Tool/LLM | Risk |
| --- | --- | --- |
| Call 1 | LLM chooses search/details/recommendation | May spend first decision on read. |
| Tool 1 | `get_product_details` or `search_products` | Consumes one tool slot. |
| Call 2 | LLM chooses `recommend_catalog_products` or `set_shipping_destination` | Another orchestration call. |
| Tool 2 | Read or destination mutation | Consumes final default tool slot. |
| Finalization | Respond only | Cannot both select and calculate shipping if not already done. |

Failure points:

- ambiguous "parecida pero mas barata";
- catalog unavailable;
- product evidence gate;
- budget exhaustion;
- no durable pending work unless multi-intent pending semantic state applies;
- final message may safely degrade but not finish all work.

### Scenario 2

```text
"mejor dejame 3 de la Classic,
enviamelo a Las Condes
y hazme la cotizacion"
```

Needed operations:

1. Update selected line items to three Classic.
2. Set/update shipping destination to Las Condes.
3. Optionally calculate shipping if quote/summary should include shipping.
4. Create quote from durable line items.
5. Respond with quote result.

Classic loop pressure:

```text
select_products
-> set_shipping_destination
-> calculate_shipping
-> create_quote
-> respond
```

This is at least four capability steps if shipping must be calculated before quote, or three if quote creation does not require shipping. Current classic default can execute only two tools. Even with three, it may not reach all dependent work.

Multi-intent current scope:

- Can cover selection + destination + shipping for scoped intents.
- Does not currently cover `create_quote` as a planned multi-intent capability in the inspected planner types.

Conclusion:

The current classic loop stops scaling when a single customer message implies several dependent operations and some preparatory reads. The newer multi-intent executor is the right direction but not yet a complete commercial workflow layer.

## 27. Gap register

### GAP-01

Type: STRUCTURAL_GAP  
Severity: HIGH

Finding:

No general durable representation of remaining commercial work after a turn completes.

Evidence:

- Classic `responded` terminal result schedules no continuation.
- `pendingCatalogAction` is catalog-link context only.
- `pending_commercial_intents` stores semantic missing requirements, not per-step work execution.

Impact:

C09 can complete selection/destination but leave shipping unexecuted with no durable `calculate_shipping pending` state.

Existing partial solution:

`crm_request_facts`, `pending_commercial_intents`, follow-up actions, capability logs.

### GAP-02

Type: STRUCTURAL_GAP  
Severity: HIGH

Finding:

Classic `AgentStep` supports one tool per provider decision and no multi-tool plan.

Evidence:

`AgentStep` schema has one `tool` and one `arguments` object; provider adapter parses JSON content only.

Impact:

Multi-intent requests require repeated LLM orchestration and hit decision/tool budgets.

Existing partial solution:

Multi-intent planner/executor path.

### GAP-03

Type: PERFORMANCE_GAP  
Severity: MEDIUM

Finding:

Queries and commands compete for the same `maxToolExecutions`.

Evidence:

Classic loop increments `toolExecutionCount` for accepted executed tools regardless of read/write governance.

Impact:

Preparatory reads can prevent completion of required mutations/derived reads.

Existing partial solution:

Capability governance metadata classifies side effects, but classic budget does not use it.

### GAP-04

Type: RELIABILITY_GAP  
Severity: HIGH

Finding:

No broad conversation-level sequencing/lock for distinct inbound messages.

Evidence:

Inbound dedupes exact provider message id, but no inspected per-conversation lock around autonomous cycle execution.

Impact:

Older turns can overwrite newer commercial facts or produce out-of-order responses.

Existing partial solution:

Inbound dedupe, action idempotency, request fact idempotency, outbox dedupe, follow-up CAS.

### GAP-05

Type: RELIABILITY_GAP  
Severity: MEDIUM

Finding:

Tool execution is not governed by the Agent Tool Loop remaining deadline.

Evidence:

Provider deadline was fixed in T08A, but Gateway context does not carry a remaining-deadline abort signal.

Impact:

Long tool calls may outlive intended loop budget; side effects may complete after user-visible fallback/timeout conditions.

Existing partial solution:

External service clients may have individual timeouts; provider calls use remaining deadline.

### GAP-06

Type: STRUCTURAL_GAP  
Severity: MEDIUM

Finding:

Mutation guard is specific to `select_products` claims.

Evidence:

Guard checks unbacked product selection/quantity/order claims, not quote/shipping-option/payment claims.

Impact:

Future mutations need additional grounding before customer-visible assertions.

Existing partial solution:

Capability logs and durable request facts provide evidence base.

### GAP-07

Type: OBSERVABILITY_GAP  
Severity: MEDIUM

Finding:

Loop persistence is summary-oriented, not resumable execution trace.

Evidence:

`agent_tool_loop_completed` stores summary, counts, config, metrics, pending action; full local loop state is not persisted as a restartable frame.

Impact:

Operational debugging exists, but automatic recovery cannot reconstruct exact continuation.

Existing partial solution:

`crm_capability_executions`, `commercial_event`, LLM metrics, action/outbox rows.

### GAP-08

Type: STRUCTURAL_GAP  
Severity: MEDIUM

Finding:

Multi-intent executor is scoped and allowlisted.

Evidence:

Routing requires flag and allowlisted `wa_id`; planner types cover selected intents/capabilities only.

Impact:

It validates the architectural direction but is not the general production Sales Agent execution layer.

Existing partial solution:

Deterministic requirement resolver, execution planner, action executor, pending semantic intents.

### GAP-09

Type: RELIABILITY_GAP  
Severity: MEDIUM

Finding:

Completed mutations are not transactionally coupled to final response.

Evidence:

Tool writes commit before finalization/dispatch; later provider/dispatch failure does not roll back.

Impact:

State may be correct but customer may not know; restart does not automatically finish response.

Existing partial solution:

Durable facts can be reconstructed on next inbound; fallbacks/outbox action idempotency protect duplicate replies.

### GAP-10

Type: DOCUMENTATION_GAP  
Severity: LOW

Finding:

The repo has multiple historical docs and current release notes; active architecture requires careful reconstruction.

Evidence:

AGENTS requires canonical hierarchy and warns legacy/archive are non-normative.

Impact:

Future agents may overgeneralize from superseded docs unless this audit is used as current operational baseline.

Existing partial solution:

`AGENTS.md`, `PRODUCT_NORTH_STAR`, `ACTIVE_RELEASE`, release specs.

## 28. Existing reusable components

| Gap | Existing components that solve part of it |
| --- | --- |
| Durable remaining work | `crm_request_facts`, `pending_commercial_intents`, `crm_agent_actions`, follow-up worker, capability logs. |
| Multi-intent planning | `runCommercialMultiIntentLoop`, `requirementResolver`, `executionPlanner`, `actionPlanExecutor`. |
| Idempotent mutations | `commercial_line_items` service, `shipping_destination` service, quote idempotency, action queue, outbox dedupe. |
| Recovery/attempts | Follow-up worker CAS/stale recovery; outbox worker lock/retry model. |
| Evidence grounding | Capability executions, recent catalog context, request facts, mutation guard. |
| Human safety | Handoff control, AI/human ownership flags, opt-out gates, pilot allowlist. |
| Transport reliability | Canonical outbox writer and worker. |
| Observability | `commercial_event`, `crm_capability_executions`, `crm_agent_actions`, LLM metrics. |

Estimated reuse potential:

```text
70%
```

Reasoning:

Most domain facts, capability boundaries, idempotency primitives, and worker patterns already exist. The missing layer should be additive and minimal, not a rewrite.

## 29. Required production guarantees

| Guarantee | Desired statement | Current status | Evidence |
| --- | --- | --- | --- |
| G1 | A confirmed mutation is never claimed unless durably completed. | PARTIAL | `select_products` claim guard exists; other mutations lack generalized guard. |
| G2 | A duplicated inbound message does not duplicate commercial mutations. | PARTIAL | Exact provider message id dedupe yes; distinct concurrent messages not fully protected. |
| G3 | Completed work is not repeated after restart. | PARTIAL | Durable facts and quote idempotency help; local loop state not restartable. |
| G4 | Pending work survives restart. | PARTIAL | Semantic pending intents and follow-ups survive; general remaining tool work does not. |
| G5 | Independent work may execute concurrently. | NOT_SATISFIED | No parallel tool execution in classic or multi-intent executor. |
| G6 | Dependent work respects ordering. | PARTIAL | Multi-intent executor orders scoped actions; classic relies on model decisions. |
| G7 | A provider failure cannot corrupt commercial state. | PARTIAL | Provider failure does not invent tool side effects; already committed tool writes remain without transaction-level rollback/continuation. |
| G8 | One failed capability does not necessarily kill the entire commercial request. | PARTIAL | Structured observations allow safe degradation; not uniform durable execution. |
| G9 | Conversation updates cannot be overwritten by stale turns. | NOT_SATISFIED/PARTIAL | Some idempotency exists, but no broad per-conversation sequencing. |
| G10 | The agent can identify what remains unfinished. | PARTIAL | Multi-intent missing requirements only; classic no general unfinished-work model. |

## 30. Strategy comparison

### Strategy A - Evolve current Agent Tool Loop

| Dimension | Assessment |
| --- | --- |
| Complexity | Low to medium. |
| Risk | Medium; may accrete special cases. |
| Reuse | High. |
| Scalability | Limited unless contract changes to multi-tool plans and separate budgets. |
| Latency | Can improve with budget tuning, but repeated LLM calls remain. |
| Resiliency | Limited without durable work state. |
| Code impact | Localized at first. |
| Multi-intent | Partial. |
| Async | Weak. |
| Operability | Existing events/logs continue. |

Best use:

Short-term hardening: budget policy, more guards, better observability, query/command budgets.

### Strategy B - Planner + deterministic executor

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium. |
| Risk | Medium but controlled; pattern already exists. |
| Reuse | High. |
| Scalability | Better for multi-intent/dependencies. |
| Latency | Better when reducing post-tool LLM orchestration. |
| Resiliency | Better if paired with durable execution snapshots. |
| Code impact | Expands existing multi-intent modules. |
| Multi-intent | Strong for modeled intents. |
| Async | Partial unless durable work state added. |
| Operability | Can use current capability logs and events. |

Best use:

Promote/expand the existing allowlisted multi-intent architecture for common commercial bundles: selection, destination, shipping, quote.

### Strategy C - Durable commercial workflow layer

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium to high depending on scope. |
| Risk | High if introduced as a broad rewrite; medium if minimal and scoped. |
| Reuse | Medium-high if built on `crm_request_facts`, `crm_agent_actions`, Gateway, follow-up/outbox patterns. |
| Scalability | Strongest for continuation/recovery/async. |
| Latency | Can support async and parallel steps. |
| Resiliency | Strongest if designed with idempotency and sequencing. |
| Code impact | Larger. |
| Multi-intent | Strong. |
| Async | Strong. |
| Operability | Requires new observability surface. |

Best use:

Only for work that truly must survive turn completion/restart or run asynchronously with dependencies.

### Incremental A -> B -> C

Recommended. The repo already contains the seed of B. Jumping directly to a broad workflow engine would duplicate existing domain state and increase risk. Staying only in A will keep hitting C09-like limits.

## 31. Recommended target architecture

Recommended strategy:

```text
INCREMENTAL_HYBRID
```

### Component 1 - Semantic understanding

Why needed:

The system must understand several intentions in one message.

Existing component it extends:

`runCommercialMultiIntentLoop` planner and intent types.

Why current architecture cannot already do it:

Classic loop chooses one next tool at a time and loses global intent structure.

Minimum implementation:

Expand planner coverage for quote-related intent and change quantity/destination corrections, while preserving strict schemas and allowlist rollout.

### Component 2 - Deterministic commercial execution planner

Why needed:

Dependencies like selection + destination -> shipping should not require one LLM call per edge.

Existing component it extends:

`executionPlanner.ts`, `requirementResolver.ts`, `actionPlanExecutor.ts`.

Why current architecture cannot already do it:

Classic runtime delegates ordering to the model and charges all steps to a small shared budget.

Minimum implementation:

Model a small graph for:

```text
select_products
set_shipping_destination
calculate_shipping
create_quote
```

with explicit dependency and idempotency checks.

### Component 3 - Durable remaining-work state

Why needed:

The system must know what remains after a turn/process crash.

Existing component it extends:

`crm_request_facts` for semantic/durable facts, `crm_agent_actions` for scheduled action lifecycle, capability execution logs for evidence.

Why current architecture cannot already do it:

No current row stores a per-commercial-request execution graph with step status and dependencies.

Minimum implementation:

Start with a narrow durable work record for multi-intent commercial bundles, not a general workflow engine:

```text
work id
conversation/opportunity
requested intents
planned steps
step status
dependency keys
idempotency keys
last_error
next_attempt_at
```

Reuse existing tables if the schema can represent this cleanly; otherwise document and add a minimal table in a later task.

### Component 4 - Conversation sequencing

Why needed:

Stale turns must not overwrite newer customer corrections.

Existing component it extends:

Inbound message ids, `conversation_message`, action queue locks, request fact services.

Why current architecture cannot already do it:

Idempotency handles duplicates, not ordering across distinct messages.

Minimum implementation:

Introduce a per-conversation commercial turn sequence or lock around state-mutating execution, with stale write detection in fact services.

### Component 5 - Response grounding

Why needed:

Every mutation claim must be backed by durable evidence, not only product selection.

Existing component it extends:

Mutation guard, capability logs, request facts.

Why current architecture cannot already do it:

Current guard is specific to `select_products`.

Minimum implementation:

Define a mutation claim/evidence registry:

```text
claim type -> required durable fact/capability evidence -> fallback
```

## 32. Migration roadmap

### Phase 0 - documentation/observability

Problem:

The current behavior is spread across loops, events, request facts, action queue, and workers.

Objective:

Make current architecture visible without changing behavior.

Changes:

- Publish this audit.
- Add read-only dashboards/queries for C09-like turns if requested later.
- Document exact routing of classic vs multi-intent path.

Risks:

- None to runtime if documentation/read-only only.

Tests:

- Docs review.
- Optional read-only query validation.

Exit criteria:

- Team agrees on current bottlenecks and which components are reusable.

### Phase 1 - classic loop safety hardening

Problem:

Classic loop still serves many simple cases but has narrow mutation grounding and shared query/command budget.

Objective:

Reduce false claims and make budget pressure observable.

Changes:

- Add observability for query vs command slot consumption.
- Generalize mutation claim guard for quote/shipping-option claims.
- Do not change production budgets until measured.

Risks:

- Overblocking valid responses if evidence mapping is too strict.

Tests:

- Unit tests for each mutation claim class.
- Regression corpus for T08 cases.

Exit criteria:

- No unbacked mutation claims across current mutation set.

### Phase 2 - expand planner + deterministic executor

Problem:

Classic loop is inefficient for multi-intent dependent work.

Objective:

Move common multi-intent commercial bundles to deterministic execution.

Changes:

- Expand multi-intent capabilities to include `create_quote`.
- Add deterministic plan for selection + destination + shipping + quote.
- Keep allowlist/feature flag rollout.

Risks:

- Planner misclassification.
- Requirement resolver ambiguity.

Tests:

- C09 and complex scenario corpus.
- Requirement resolver tests.
- Capability order/dependency tests.

Exit criteria:

- Multi-intent path completes scoped bundles without extra model orchestration and without unsafe claims.

### Phase 3 - durable remaining-work state

Problem:

Pending executable work does not survive turn completion/restart in a general way.

Objective:

Persist and resume commercial work only where needed.

Changes:

- Define minimal durable work schema or reuse pattern.
- Persist planned steps and statuses.
- Add worker/re-entry for unfinished work with idempotent capabilities.

Risks:

- Duplicating `crm_agent_actions` or `crm_request_facts`.
- Premature general workflow complexity.

Tests:

- Process-crash simulations after each step.
- Idempotency/retry tests for Quote/Shipping/Selection.
- Stale turn tests.

Exit criteria:

- Completed work not repeated; pending work resumes; failed work visible and retryable where safe.

### Phase 4 - conversation sequencing and async scaling

Problem:

Distinct messages can race; independent work cannot run in parallel.

Objective:

Protect state ordering and enable safe concurrency where dependencies allow it.

Changes:

- Per-conversation turn sequencing or mutation lock.
- Stale write detection in fact upserts.
- Optional parallel executor for read-only/independent steps.

Risks:

- Deadlocks/latency if lock is too broad.
- Complex ordering semantics with follow-up/outbox.

Tests:

- Concurrent inbound message tests.
- Out-of-order response tests.
- Parallel read fan-out tests.

Exit criteria:

- Newer customer corrections cannot be overwritten by stale turns.
- Independent read work can parallelize without changing mutation order.

## 33. Risks/open questions

1. Exact provider-native multi-tool capability was not tested live in this audit. The relevant architectural fact is that our adapter does not expose native tool calls to the runtime.
2. Some individual external client timeouts are adapter-specific and should be audited in a separate microservice timeout pass before production SLA commitments.
3. `select_shipping_option` exact duplicate idempotency should be rechecked before expanding payment/checkout-like flows.
4. Quote Service production readiness beyond draft creation requires a separate Quote lifecycle audit.
5. A future durable work layer must avoid duplicating `crm_agent_actions` unless its semantics cannot fit there cleanly.
6. Conversation sequencing needs product decisions: should later inbound always supersede older in-flight work, or are some operations allowed to complete if already committed?
7. Multi-intent routing is allowlisted. Production rollout needs operational criteria, not only benchmark pass rates.
8. Customer identity remains provisional; no architecture should assume a definitive Customer Master.

## 34. Final verdict

The current Sales Agent is stronger than a simple chatbot: it has governed tools, durable commercial facts, idempotent mutations, action/outbox boundaries, follow-up recovery patterns, handoff safety, and a promising deterministic multi-intent path.

It is not yet a fully autonomous commercial execution system because the classic production path is still centered on sequential LLM-mediated tool calls and terminal turn responses. The architecture can remember completed facts, but it generally cannot remember executable remaining work. It can avoid many duplicate effects, but it does not fully serialize distinct inbound turns. It can safely degrade in audited cases, but it cannot guarantee that a phrase like "Ahora calculo el despacho" corresponds to real scheduled work.

The recommended path is not a wholesale rewrite and not an immediate external workflow engine. The minimum sound direction is:

```text
preserve current capabilities
-> expand deterministic multi-intent execution
-> add narrow durable remaining-work state where continuation/recovery requires it
-> add conversation sequencing before broad async/parallel execution
```

```text
SALES-AGENT-R2-A01: DONE

Current architecture reconstructed:
YES

Agent Tool Loop fully traced:
YES

AgentStep supports multiple tool calls:
NO

Provider supports more than runtime exposes:
UNKNOWN

Parallel tool execution exists:
NO

Durable conversation state:
YES

Durable commercial state:
PARTIAL

Durable pending-work state:
PARTIAL

Automatic continuation after turn:
NO

Conversation-level concurrency protection:
PARTIAL

Mutation idempotency:
PARTIAL

Tool retry model:
PARTIAL

Provider failure isolation:
PARTIAL

Tool failure isolation:
PARTIAL

Main structural bottleneck:
No general durable representation of remaining commercial work after a terminal response; classic execution is one AgentStep/one tool at a time.

Main reliability bottleneck:
Distinct inbound messages are not fully sequenced at conversation level, so stale turns can race with newer corrections.

Main scalability bottleneck:
Classic runtime serializes all commercial work through repeated LLM decisions and a shared tool budget for queries and commands.

Existing architecture reusable:
70%

Recommended strategy:
INCREMENTAL_HYBRID

Recommended next task:
Define the minimal durable commercial work/continuation contract for selection + destination + shipping + quote, reusing the existing multi-intent executor, request facts, capability gateway, and action/follow-up worker patterns.

Production behavior changed:
NO
```
