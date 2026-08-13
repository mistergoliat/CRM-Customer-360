---
title: Commercial Multi-Intent Planning + Requirement Resolution
doc_id: architecture-commercial-multi-intent-planning
status: draft
version: "1.0.0"
owner: architecture
last_reviewed: 2026-08-13
source_of_truth_for:
  - CommercialIntentPlan contract
  - CommercialRequirementResolver design
  - CommercialExecutionPlanner dependency rules
  - CommercialActionPlanExecutor partial-completion semantics
  - Pending Intent State durable persistence
depends_on:
  - ../audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md
  - ../releases/LLM-R1-T09A-multi-intent-planning-and-requirement-resolution.md
  - ../releases/LLM-R1-T08D-multi-intent-tool-budget-and-mutation-guard.md
tags:
  - architecture
  - sales-agent
  - agent-loop
  - multi-intent
---

# Commercial Multi-Intent Planning + Requirement Resolution

LLM-R1-T09A. Introduces a backend-driven layer that lets one customer message express multiple commercial intents without forcing the Agent Tool Loop to resolve them through N independent LLM decisions. This document is the Part 1 audit (CURRENT_FLOW / PROPOSED_INSERTION_POINT / STATE_AUTHORITIES) plus the resulting contract design.

## 1. CURRENT_FLOW (audit, before this task)

```
inbound WhatsApp
  -> processNativeWhatsAppInbound
  -> runNativeAutonomousCycle.ts
       - pilot allowlist / opt-out gates
       - resolveNativeCustomerSession (identity)
       - buildNativeCommercialContext -> CommercialContextSnapshot
       - loadRecentCatalogContext, loadPendingCatalogAction
       - resolveSalesAgentConfiguration
  -> runNativeAgentToolLoopCycle.ts
       - loadCustomerProfileContext (purchase history)
       - buildCommercialContextSummary (reduced, sanitized projection of the snapshot)
       - runAgentToolLoop.ts
           Phase 1 "gathering": up to maxDecisions (default 3) independent LLM
           calls, each producing exactly one AgentStep (use_tool | respond |
           handoff). Each use_tool decision is a live LLM round-trip: decide
           -> validate -> governance/evidence gate -> executeGovernedCapability
           -> buildToolObservation -> feed back into the NEXT LLM call's
           prompt. Tool budget (maxToolExecutions, default 2) and decision
           budget are independent, whichever exhausts first ends gathering.
           Phase 2 "finalization": up to 2 more LLM calls, respond/handoff
           only, no tools offered - the model narrates using only this
           turn's own prior steps.
       - dispatchAgentLoopResponse (outbox, pendingCatalogAction persistence)
       - recordAgentToolLoopCompletedCommercialEvent (audit event)
```

**Where multi-intent messages break down today**: a message like "quiero 2 de la classic y cuanto sale el despacho a Ñuñoa" needs the model to decide, live, across multiple LLM round-trips, which of two competing sub-requests to prioritize inside a shared tool budget of 2. `LLM-R1-T08D` (audit doc section 17) found and partially mitigated this exact failure mode for C09 - a prompt-only prioritization rule moved `unbackedCommercialMutationClaimRate` to 0% (the Commercial Mutation Execution Guard) but did **not** reliably change which sub-intent the model completes (`select_products` completion stayed at 10% across 10 live runs). The root cause is structural: the legacy loop has no concept of "intent" at all - it is a sequence of independent, un-coordinated tool decisions, and prioritization between competing sub-requests is left entirely to whatever the model happens to do inside a shared, scarce tool budget.

## 2. PROPOSED_INSERTION_POINT

The new runtime is a **drop-in alternative to `runAgentToolLoop.ts`**, not a new pipeline stage. `runCommercialMultiIntentLoop.ts` (`lib/brain/commercial/multi-intent/`) takes the exact same `RunAgentToolLoopInput` and returns the exact same `AgentLoopResult` shape. The only change to existing production code is inside `runNativeAgentToolLoopCycle.ts`:

```ts
const loop = buildMultiIntentPlannerFeatureFlags().multiIntentPlannerEnabled
  ? await runCommercialMultiIntentLoop(agentToolLoopInput)
  : await runAgentToolLoop(agentToolLoopInput);
```

Everything downstream (`dispatchAgentLoopResponse`, `recordAgentToolLoopCompletedCommercialEvent`, pendingCatalogAction persistence, `buildStepsSummary`/`buildLlmCallsSummary`/`buildLlmMetrics`) is unmodified and works unchanged against either loop's output. `runNativeAutonomousCycle.ts` is untouched entirely - the flag is read one level below where it was already being read for the legacy loop's own on/off switch.

Why here and not lower/higher:

- Not inside `runAgentToolLoop.ts` itself: that function's gathering/finalization phases are a fundamentally different control flow (LLM decides per step vs. backend decides the whole plan before any LLM call after the first). Branching mid-function would tangle two unrelated architectures in one file and risk regressing the legacy path's 478 existing tests.
- Not in `runNativeAutonomousCycle.ts`: that file's job is resolving context/session/configuration once and picking a runtime family (multi-request vs. agent-tool-loop vs. legacy shadow). The multi-intent planner is a variant *within* the agent-tool-loop family, sharing 100% of its context-loading, so it belongs one level down, at the point where the family is already selected.

## 3. STATE_AUTHORITIES

| State | Owner | Read by this task | Written by this task |
|---|---|---|---|
| `commercialLineItems` (product selection) | `lib/domains/commercial-line-items` via `crm_request_facts` | `requirementResolver.ts` (PRODUCT_SELECTION durable check) | `select_products` capability only (unchanged - this task never writes it directly) |
| `shippingDestination` | `lib/domains/shipping-destination` via `crm_request_facts` | `requirementResolver.ts` (DESTINATION durable check) | `set_shipping_destination` capability only (unchanged) |
| `RecentCatalogContext` | `crm_capability_executions` (24h window) | `requirementResolver.ts` (PRODUCT fuzzy match), planner prompt (product names for coreference) | never written by this task (read-only, same as the legacy loop) |
| Pending commercial intents (new) | `crm_request_facts`, `fact_key="pending_commercial_intents"`, `request_id="opportunity:<id>"` | `runCommercialMultiIntentLoop.ts` at the start of every turn | `pendingIntentState.ts` at the end of every turn |
| Capability execution audit trail | `crm_capability_executions` | n/a | `executeGovernedCapability` (unchanged - same gateway, same audit path) |

No new tables. Part 11's own instruction ("antes de crear tabla nueva, auditar si puede reutilizarse de forma limpia") is satisfied by `crm_request_facts`: it is already a generic, versioned, per-anchor fact store (`migrations/017_crm_request_facts.sql`) used for exactly this kind of durable commercial state (`shippingDestination`, `commercialLineItems`). A pending intent is semantically identical - "a fact about this opportunity, superseded whenever it changes" - so it reuses the same `opportunity:<id>` anchor convention with a new `fact_key` (`pending_commercial_intents`), never a parallel mechanism.

## 4. The four layers (INTENT / REQUIREMENT / ACTION / EXECUTION RESULT)

```
lib/brain/commercial/multi-intent/
  types.ts                          - all four layers' types + IntentDefinition registry
  parseCommercialIntentPlan.ts      - Part 2/3/20: bounded validation, unknown -> unsupported
  buildIntentPlannerPromptPackage.ts- the ONE planner LLM call's prompt
  requirementResolver.ts            - Part 4/5/6: deterministic, no LLM
  executionPlanner.ts                - Part 7/8: deterministic, no LLM
  actionPlanExecutor.ts              - Part 9: executes through the real Capability Gateway
  buildMultiIntentResponseContract.ts- Part 10/13: partial-completion classification + finalizer projection
  pendingIntentState.ts              - Part 11/12: durable state + turn-to-turn merge
  runCommercialMultiIntentLoop.ts    - orchestrator (planner call -> deterministic backend -> finalizer call)
```

### INTENT

`CommercialIntentPlan = { intents: CommercialIntent[] }`, a discriminated union on `type`:

```ts
type CommercialIntent =
  | { type: "select_products"; productReference?: string; quantity?: number }
  | { type: "get_shipping_quote"; destination?: string }
  | { type: "unsupported"; description?: string };
```

No Zod (or any schema-validation library) is used - none exists anywhere in this repository today. `validateAgentStep.ts` and every `CapabilityGatewayDefinition.inputSchema` already establish the local convention: a hand-rolled, bounded parse function (`parseCommercialIntentPlan.ts`) plus a JSON-Schema-shaped description rendered into the prompt for the model to read, never a new dependency for one contract. Every check a schema validator would perform is still enforced explicitly: array bounds (`MAX_INTENTS_PER_PLAN=6`), string length/trim (`MAX_INTENT_TEXT_FIELD_LENGTH=200`), integer bounds (`MAX_QUANTITY=9999`), and only allowlisted keys are ever read off the raw object - no arbitrary field ever reaches an intent value.

An intent whose `type` does not match a known literal degrades to `{type:"unsupported", description:<bounded>}` at the per-intent level (Part 3) - the plan itself never fails just because one entry is unrecognized. Only a genuinely malformed root (`intents` missing/not an array/empty) is a real parse failure, subject to the one-shot repair + fail-closed policy below.

### REQUIREMENT

Fixed, backend-owned registry (`COMMERCIAL_INTENT_DEFINITIONS`, Part 29) - the model can never declare that an intent needs a requirement the registry does not already define:

```ts
select_products:      requirements = [PRODUCT, QUANTITY]
get_shipping_quote:   requirements = [PRODUCT_SELECTION, DESTINATION]
```

`requirementResolver.ts` resolves each requirement from fixed, ordered sources (Part 5), never inferring information that does not exist:

- **PRODUCT**: (1) `RecentCatalogContext` fuzzy name match against `productReference` (diacritic-insensitive substring match both directions); (2) if no reference was given at all and exactly one durable `commercialLineItems` entry exists, that item (an implicit "it"); (3) unresolved. A bare deictic word ("esa", "ese", "la anterior", ...) reaching the resolver is never fuzzy-matched - resolving a pronoun to a real product name is the planner LLM's job (Part 16: "el LLM produce referencias, el backend nunca infiere identidad"), and the resolver treats an unresolved pronoun the same as no reference at all.
- **QUANTITY**: explicit only, from the intent - never defaulted, never inferred.
- **DESTINATION**: (1) explicit text on the intent this turn; (2) durable `shippingDestination`; (3) unresolved. The resolver never validates the text against a real commune - that identity resolution stays exclusively the `set_shipping_destination` capability's job (`CommuneResolver`), matching the existing division of labor the legacy loop's own prompt rules already establish.
- **PRODUCT_SELECTION** (get_shipping_quote only): (1) a same-turn `select_products` intent that itself resolves "ready"; (2) durable `commercialLineItems` (non-empty); (3) unresolved.

Two failure modes are distinguished explicitly (Part 6): **missing** (nothing to resolve against - ask for it) vs. **ambiguous** (2+ real candidates, e.g. two RecentCatalogContext products both matching "barra" - ask which one, carrying the real candidate names as structured evidence, never guessed).

### ACTION

`executionPlanner.ts` turns already-resolved requirements into an ordered list of real Capability Gateway capabilities - `select_products`, `set_shipping_destination`, `calculate_shipping` (Part 26: no new/duplicated capability, only the three that already exist). Fixed dependency rules (Part 7/8):

- `select_products` has no dependency; planned whenever its own intent resolves "ready".
- `set_shipping_destination` is planned only when the customer stated a destination **this turn** (a durable one is reused silently, never re-asked) - it never depends on product selection.
- `calculate_shipping` is planned only when `get_shipping_quote` resolves "ready" (both `PRODUCT_SELECTION` and `DESTINATION` resolved). It carries `dependsOnIntentIndex` pointing at the `select_products` intent **only** when `PRODUCT_SELECTION` was satisfied by a same-turn selection - a durably-satisfied selection has no same-turn dependency, so an unrelated same-turn failure elsewhere never blocks it (Part 21 test 13).

`select_products` always precedes the shipping steps in the returned list.

### EXECUTION RESULT

`actionPlanExecutor.ts` runs the plan sequentially through the exact same `executeGovernedCapability` every other tool in this system uses - no bypass of governance, no bypass of the evidence gate (the requirement resolver **is** the evidence gate here: it only ever resolves PRODUCT from RecentCatalogContext or an already-durable selection, never an invented id, so the executor trusts it the same way `processUseToolStep` trusts `resolveObservedRecommendationSourceProduct` today), no second/duplicated persistence path. Every result is projected through `buildToolObservation.ts` unchanged, so a completed step here is structurally indistinguishable from one the legacy loop would have produced.

A step whose `dependsOnIntentIndex` names an intent whose own step did not complete is never sent to the Gateway - recorded as a `blocked`/`multi_intent_dependency_failed` observation instead (Part 9, verified by `[MI-Exec-1]`). Part 28 (no automatic rollback): the executor contains no compensating/reversal logic at all - a completed `select_products` is never undone because a later `set_shipping_destination`/`calculate_shipping` step fails; each intent's real, honest outcome is reported independently (`buildMultiIntentResponseContract.ts`'s `classifyIntentOutcome`, Part 10).

## 5. Response Contract and the finalizer

```ts
type MultiIntentResponseContract = {
  completedIntents: IntentOutcome[];
  pendingIntents: IntentOutcome[];           // waiting_for_information
  failedIntents: IntentOutcome[];
  needsClarificationIntents: IntentOutcome[]; // ambiguous requirement(s)
  unsupportedIntents: IntentOutcome[];
  missingRequirements: CommercialRequirementType[];
};
```

Extends the task's own suggested shape with two buckets Part 3/6/17 explicitly require distinguishing: an **ambiguous** requirement (two real candidates) needs a different customer-facing question than an **unsupported** intent (this system does not implement it at all) - collapsing both into "pending" would make the finalizer unable to tell them apart. `executionResults` is embedded per intent (`IntentOutcome.executionResults`), never duplicated as a second top-level array.

The finalizer reuses `buildAgentStepPromptPackage.ts`'s existing `"finalization"` phase **unchanged** - respond/handoff only (`validateAgentStep` structurally rejects `use_tool` in that phase, Part 16's "el LLM no ejecuta" is enforced by the contract itself, not by convention), fed this turn's real executed steps as `priorSteps` so every existing grounding rule (stock disclosure, shipping/selection evidence rules, the T08C/T08D claim-evidence rules) applies with zero new code. The only new prompt content is `MULTI_INTENT_PLAN_RULE_LINES` (finalization-only, inert/absent for the legacy loop) governing a new `commercialContext.multiIntentPlan` projection (`buildMultiIntentPlanPromptProjection`) - which intents are pending and what is missing, which are ambiguous and their real candidate names, which are unsupported. The Commercial Mutation Execution Guard (`commercialMutationClaims.ts`, unchanged) still gates the finalizer's output exactly as it gates the legacy loop's.

## 6. Planner: structured output, bounded recovery

One LLM call, `buildIntentPlannerPromptPackage.ts`: semantic interpretation only (extract intents/entities/references from the customer's message; resolve an obvious pronoun against `recentCatalogContextProductNames` when unambiguous) - never catalog identity, never a tool decision, never a claim that something was done (Part 16). Structured JSON output, same recovery principles as `LLM-R1-T01`/`T04`: one guided repair attempt on either a provider-level structural failure (`invalid_response`) or a schema-invalid plan, then fails closed - a real `handoff` (`multi_intent_planner_invalid_output`), never a guess, never an execution of a partially parsed plan (Part 20, verified by `[MI-Loop-8]`).

## 7. Pending Intent State and continuation

Turn 1 leaves `get_shipping_quote` `waiting_for_information` (missing `DESTINATION`) -> persisted via `crm_request_facts` (`pending_commercial_intents`). Turn 2's planner prompt is given the pending intent's type + missing fields; a well-behaved model re-emits the same intent type with the field filled in from the short reply (e.g. "Ñuñoa" alone). `mergeCommercialIntents` (Part 12) is the deterministic safety net under that: any pending intent whose type this turn's fresh plan re-addresses is **replaced**, never duplicated; any pending intent the message never touches is **carried forward** unchanged, never silently dropped. An `unsupported` pending record is never carried forward - it is not "a fact waiting for one more field", it needs a fresh customer decision. Verified end-to-end against the real local DB in `[MI-Loop-5]` (two real turns, real `select_products`/`set_shipping_destination` persistence, pending state genuinely cleared once resolved).

## 8. What is deliberately out of scope for T09A

- Only `select_products`/`get_shipping_quote` are implemented. `CREATE_QUOTE`/`CHECKOUT`/`PAYMENT`/`CUSTOMER_CREATION`/`FOLLOW_UP` are not - the contract is written so a future intent is a new union member + a new `IntentDefinition` entry, never a rewrite.
- `CUSTOMER_IDENTITY`/`DELIVERY_ADDRESS`/`EMAIL` exist only as declared, unresolved requirement types for future intents (Part 5's explicit "dejar fuera de ejecucion").
- `pendingCatalogAction`/`send_product_link` continuity (get_product_details/recommend_catalog_products) is not implemented in the multi-intent path - `runCommercialMultiIntentLoop.ts` always returns `finalPendingCatalogAction: null`. A documented limitation, not a bug (Part 26: this task orchestrates the three existing capabilities its two intents need, never a fourth).
- Grouping multiple missing fields into one combined question (Part 15) is covered generically by `MULTI_INTENT_PLAN_RULE_LINES`'s "ask only for missing fields... in one combined question when there is more than one pending intent" instruction, but was not built as a dedicated mechanism beyond that prompt rule - T09A's corpus (MI01-MI06) never exercises more than one missing field at once.
- No WhatsApp real-traffic change: `BRAIN_MULTI_INTENT_PLANNER_ENABLED` defaults to `false`; a future task can scope it to `BRAIN_AUTONOMOUS_TEST_WA_IDS` for a live smoke, per Part 25.
