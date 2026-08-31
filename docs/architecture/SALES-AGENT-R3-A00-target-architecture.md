# SALES-AGENT-R3-A00 -- Target Architecture

Status: architecture design only. No production routing, runtime code, or
`commercialCycleConfig.ts` flag was modified for this task. No release was
opened; `ACS-R1-04` remains the active release and `ACS-R1-05.1` remains the
active parallel workstream per `docs/ACTIVE_RELEASE.md`. This document is the
transversal documental deliverable the task explicitly authorized, produced
by auditing live code (not documentation alone) plus the existing
`docs/architecture/A13-H0-deepseek-harness-bakeoff.md` spike.

## Method

Phase 1 was produced by reading, not guessing: `runAgentToolLoop.ts` and its
full `agent-loop/` directory, the Capability Gateway (`capability-gateway/`),
identity/session code (`native-cycle/customer-session/`,
`customer-identity-verification`, `commercial-identity-requirement`), the
outbox (`lib/brain/messaging/`), the follow-up scheduler
(`lib/brain/commercial/followup/`), and `lib/brain/commercial/work/` (R2).
Every claim below cites a real file. Where something could not be verified
against code (e.g. the `ai_*` observability tables ADR-002 describes),
that is stated explicitly rather than assumed -- per `AGENTS.md`: "No asumas
tablas, vistas o workflows no observados."

The canonical hierarchy already encodes most of this task's target
principles conceptually: `ADR-001` (planificador abierto / ejecutor cerrado),
`ADR-006` (Capability Gateway governance, `CapabilityEvaluation` states,
3-attempt replanning cap), `ADR-002` (AI runtime vs. commercial truth
boundary), `ADR-003`/`ADR-004` (action/next-best-action source of truth),
`ADR-007` (failure escalation), `ADR-009` (MariaDB-only persistence, no
dual-write). This document does not re-derive those decisions; it defines
the concrete R3 component model that satisfies them while adopting the
iterative-harness pattern the bake-off validated.

---

## Phase 1 -- Audit of reusable components

Two runtime shapes exist today, both reached from
`native-cycle/runNativeAutonomousCycle.ts`, mutually exclusive per turn via
`commercialCycleConfig.ts`:

- **R2 / CommercialWork** (`shouldRouteToCommercialWork`): one LLM call per
  turn (`semanticIntentAdapter.ts`) into a fixed 8-intent vocabulary, then a
  fully deterministic projection/execution/settle/dispatch pipeline.
- **Native Agent Tool Loop, "ATL"** (`agentToolLoopEnabled`,
  `BRAIN_AGENT_TOOL_LOOP_ENABLED`): an iterative gather/finalize loop
  (`runAgentToolLoop.ts`) already deployed to EC2 with a real WhatsApp smoke
  verified end to end (`docs/ACTIVE_RELEASE.md`, `CAPABILITY_MATRIX.md`
  `explore_catalog` row).

A third, older shape (`sales-consultative` / shadow / operational-loop) is
disabled by default (`BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED=false`) and a
fourth (`lib/brain/commercial/autonomous-loop/**`) is a dev-only sandbox with
zero production callers, confirmed by
`docs/product/follow-up-decision-policy.md`'s runtime-authority audit.

Classification below is per component, not per runtime, as instructed.

### Legacy Agent Tool Loop (ATL)

| Component | File(s) | Current responsibility | Classification | Reason |
|---|---|---|---|---|
| Gather/finalize loop | `agent-loop/runAgentToolLoop.ts` | Two-phase turn loop: gathering (max 3 decisions / 2 tool calls) then finalization (max 2 tool-free attempts) | **REUSE_BEHIND_NEW_INTERFACE** | Sound, tested, already governs a real budget; needs a session-store seam added, not a rewrite |
| `AgentLoopProvider` interface | `agent-loop/agentLoopProviderTypes.ts` | Provider-neutral `{invoke(request):response}` contract, no tool-calling coupling | **KEEP** | Already provider-neutral in shape; this is the seam principle 10 asks R3 to own |
| DeepSeek HTTP adapter | `agent-loop/providers/httpAgentLoopProvider.ts` | Concrete `AgentLoopProvider`, OpenAI-compatible JSON-mode + DeepSeek-specific `thinking`/`reasoning_tokens` fields | **REFACTOR** | Works, but bakes DeepSeek fields into a "provider-neutral" adapter; never exercised against a second real provider |
| Legacy `SalesAgentProvider` | `sales-agent/providers/httpSalesAgentProvider.ts` | Second, unrelated HTTP provider interface feeding the disabled shadow pipeline | **DEPRECATE** | Duplicate of `AgentLoopProvider` with no code sharing; only consumer (`sales-consultative`) is fail-closed off by default |
| Tool pool / LLM-facing allowlist | `runAgentToolLoop.ts:62-73` `AGENT_LOOP_TOOL_POOL`; `capability-gateway/toolAliases.ts` | Fixed, hardcoded subset of the Capability Gateway registry the model may call by name -- "never derived from LLM output, never a second registry" | **KEEP** | This *is* the `ReadToolGateway` pattern already, mixed with a few mutating tools; separating read/mutate is R3's job, not rebuilding the allowlist mechanism |
| Evidence/mutation guards | `agent-loop/commercialMutationClaims.ts`, `resolveObservedRecommendationSourceProduct.ts`, `buildToolObservation.ts` | Rejects a mutating tool call for a product never actually observed via a prior read tool; flags unbacked "I did X" claims | **KEEP** | Real, tested fail-closed guard against hallucinated arguments (Phase 7 risk) |
| `RecentCatalogContext` / `pendingCatalogAction` | `agent-loop/recentCatalogContext.ts`, `pendingCatalogAction.ts` | Reconstructs a 24h tool-observation window and last-turn pending action from `crm_capability_executions`/`commercial_event`, not a dedicated table | **REUSE_BEHIND_NEW_INTERFACE** | Correct pattern (derive, don't duplicate state) but scoped to ATL; becomes a projection the `AgentSessionStore` exposes |
| Turn wrapper / event write | `native-cycle/runNativeAgentToolLoopCycle.ts` | Persists exactly one `commercial_event` (`agent_tool_loop_completed`) per turn, with an enforced sanitizer that rejects `/token/i` keys and never persists raw prompt/output | **KEEP** | This is the existing, already-enforced "no hidden chain-of-thought" invariant the target architecture asks for -- not new work |
| Multi-intent branch | `multi-intent/` (`runCommercialMultiIntentLoop`, `actionPlanExecutor.ts`) | A second allowlist-gated variant sharing ATL's input/output contract | **REFACTOR** | Real fork of the same idea; should collapse into one Harness rather than remain a parallel branch |
| Benchmark harness | `agent-loop/benchmark/*` | `instrumentedProvider.ts` (observer wrapper), `runCorpus.ts`, `scoring.ts`, `metrics.ts` against a fixture corpus | **KEEP** | Directly reusable for R3-A07 (hybrid benchmark) |

### CommercialWork (R2)

| Component | File(s) | Current responsibility | Classification | Reason |
|---|---|---|---|---|
| Semantic intent planner | `work/semanticIntentAdapter.ts` | One `AgentLoopProvider.invoke` into a fixed 8-intent `CommercialIntentPlan` | **DEPRECATE (narrowing, not deletion)** | Bake-off's central finding: structurally cannot express comparison/budget-constrained asks; every advisory turn moves to the Harness. Still correct for the bounded intents it already resolves cheaply |
| Pure projector | `work/buildCommercialWorkProjection.ts` | Objective seeds + durable facts + identity gate -> objectives/steps/blockers, no I/O | **REUSE_BEHIND_NEW_INTERFACE** | This pure, deterministic transform is exactly what a Kernel needs; keep it, feed it from a `CommercialActionRequest` instead of only from R2's planner |
| Executor | `work/commercialWorkExecutor.ts` | Picks READY steps, dispatches via Capability Gateway, reprojects, persists with optimistic concurrency | **REUSE_BEHIND_NEW_INTERFACE** | Becomes the concrete `CommercialTransactionKernel` execution engine |
| Settle loop | `work/settleCommercialWorkProjection.ts` | Re-runs the pure projector up to 3 rounds for same-turn cascades | **KEEP** | Directly reusable, loop-shape-agnostic already |
| Reconciliation | `work/reconciliation.ts` | Opens/merges the target `CommercialWork` row for a conversation | **KEEP** | Needed regardless of what proposes the objective |
| Dispatch | `work/dispatchCommercialWorkResponse.ts` | Builds the customer-visible message from the persisted aggregate only, writes outbox | **REUSE_BEHIND_NEW_INTERFACE** | Correct pattern (never compose a reply from ephemeral state); the Harness needs an equivalent for advisory replies, this is the template |
| Repository / optimistic concurrency | `work/repository.ts` | `updateCommercialWorkAggregate` with `expectedVersion` CAS, `VERSION_CONFLICT` | **KEEP** | Same discipline already reused by `customer-onboarding`; this is the durable-state pattern the Kernel standardizes on |
| Identity gate | `work/commercialIdentityGate.ts` | Maps `CommercialObjectiveType` -> `COMMERCIAL_OPERATIONS` -> `decideCommercialIdentityRequirement`, downgrades under-identified objectives before they reach READY | **REFACTOR** | Correct logic, but currently wired only into R2's objective/step model. Must be generalized to gate any `CommercialActionRequest` regardless of origin (R2 planner or Harness) -- see Phase 7 open risk |
| R2's follow-up sub-module | `work/followup/objectiveAwareFollowUp.ts` | Templates a "send" action directly from an objective, bypasses the LLM entirely on follow-up fire | **REUSE_BEHIND_NEW_INTERFACE** | Correct instinct (a follow-up should not masquerade as customer text); needs to become the shared pattern rather than R2's private one -- see Phase 2.G |
| Retry policy | `work/retryPolicy.ts` | Bounded technical retry for the executor | **KEEP** | -- |
| R2 benchmark | `work/benchmark/runR2Scenario.ts` | Drives the real R2 pipeline turn-by-turn, returns capability calls/LLM calls/latency | **KEEP** | Directly reusable, already used by the bake-off |

### Capability Gateway

Confirmed **already loop-shape-agnostic**: `executeGovernedCapability()`
(`capability-gateway/executeCapability.ts`) has 7 independent call sites
today -- R2's executor, ATL, native-cycle stages, the multi-intent executor,
the identity/onboarding pipeline, and the benchmark harness -- each
supplying only a generic `CapabilityGatewayContext`
(`correlationId`/`conversationId`/`opportunityId`/...), with no R2-specific
or ATL-specific field. A new Harness loop is a further caller, not a change
to the gateway.

| Component | File(s) | Classification | Reason |
|---|---|---|---|
| Governance contract | `capability-gateway/types.ts` (`CapabilityGatewayDefinition.governance: {sideEffect, authority, riskClass}`) | **KEEP** | Structurally enforced -- policy (`policy/evaluateCommercialToolRequests.ts:41-46`) reads `resolveCapabilityGovernance()`, explicitly ignoring the model's own `toolRequest.blocking` flag |
| Registry | `capability-gateway/registry.ts` (`CAPABILITY_GATEWAY_REGISTRY`, ~17 entries) | **KEEP** | Single source; some capabilities (`batch_get_products`, `get_customer_purchase_history`, `recommend_catalog_products`) deliberately never exposed to any LLM at all |
| LLM-exposure allowlist | `capability-gateway/toolAliases.ts` | **KEEP** | The actual mechanism enforcing "only capabilities named here are reachable from a model tool request" -- exactly the boundary principle 9 (no raw DB access to the model) depends on |
| Execution path | `capability-gateway/executeCapability.ts` | **KEEP** | Rejects unregistered capabilities outright (ADR-006 absolute prohibition), bounded retry, always audits |
| Evidence write | `capability-gateway/repository.ts` (`insertCapabilityExecution` -> `crm_capability_executions`) | **REFACTOR** | Real and centralized, but written **after** `execute()` on a separate connection, not in the same transaction as the mutation -- a crash between mutation and audit write loses evidence for a real effect. Flagged as Phase 7 risk, not fatal today |

### Identity / session

| Component | File(s) | Classification | Reason |
|---|---|---|---|
| Identity levels | `customer-identity-verification` (`LEVEL_0_ANONYMOUS` .. `LEVEL_3_PRESTASHOP_LINKED` + entity-scoped requirement) | **KEEP** | Real, ordered, used today |
| Capability -> minimum level map | `commercial-identity-requirement/operations.ts`, `evaluate.ts` | **KEEP** | Pure, deterministic, precedence-ordered decision function -- exactly the shape a Kernel needs |
| `RuntimeIdentityContext` (server-only) vs. `CustomerSessionDecisionContext` (LLM-safe) | `native-cycle/customer-session/types.ts` | **REUSE_BEHIND_NEW_INTERFACE** | The PII boundary is real but enforced by type-shape and hand-picked field construction, not an automated redaction/scrubber or a test that fails on a new PII field being added. Hardening this (a lint rule or a build-time check) is worth doing before the Harness widens who reads `CustomerSessionDecisionContext`, but the boundary itself does not need to be redesigned |
| Session resolution | `native-cycle/customer-session/resolveNativeCustomerSession.ts` | **KEEP** | -- |
| Onboarding state machine | `lib/domains/customer-onboarding` (`crm_customer_onboarding_state`, optimistic locking) | **KEEP** | -- |

### Catalog / Customer Profile / Shipping / Quote

| Component | File(s) | Classification | Reason |
|---|---|---|---|
| `CatalogPort` | `lib/catalog/index.ts` (`createCatalogPort`), `httpCatalogAdapter.ts` | **KEEP** | Matches `ADR-005`'s boundary exactly; returns `null`/`unknown` rather than fabricating, already the ReadToolGateway's catalog half |
| Customer Profile / purchase history | `commercial-customer-context/loadCommercialCustomerContext.ts` | **KEEP** | The one safe LEVEL_3-gated boundary; `IDENTITY_INSUFFICIENT` short-circuits cleanly rather than calling out |
| Reduced Customer 360 projection | `context/autonomousCustomerContext.ts` | **KEEP** | Allowlisted, PII-free, history-only -- already shaped for LLM consumption |
| Shipping destination / line items | `shippingDestinationCapability.ts`, `selectProductsCapability.ts` (`crm_request_facts`, `uq_request_fact_active`) | **KEEP** | Evidence-gated (rejects a product never actually observed), idempotent by construction (fact supersedes fact, one active row) |
| Shipping calculation | `lib/domains/carrier-service`, `lib/domains/shipping-calculation` | **KEEP** | Real external carrier rates |
| Quote | `capability-gateway/createQuoteCapability.ts` | **KEEP** | Genuinely idempotent: reuses an existing quote when `selectionFactId` is unchanged, otherwise a `sha256` idempotency key passed straight to Quote Service |
| Quote Service integration | `lib/integrations/quote-service` | **REFACTOR** | Client code is real; per `CAPABILITY_MATRIX.md` (`prepare_quote: planned`), no live instance exists yet -- an integration gap, not an architecture gap |

### Follow-up / Outbox / Audit-evidence

| Component | File(s) | Classification | Reason |
|---|---|---|---|
| Due-row claiming | `followup/runFollowupTick.ts` (`selectDueFollowUps`, `claimPlannedFollowUp`) | **KEEP** | CAS `UPDATE ... WHERE status='planned'` on `affectedRows`, no row lock -- a deliberate, working race-tolerance choice |
| Duplicate protection | `migrations/027_...sql` `active_followup_sequence_key` (generated column, `UNIQUE KEY`) | **KEEP** | Real DB-level "one active follow-up per sequence" guarantee |
| Cancellation / live revalidation | `runFollowupTick.ts` (`shouldCancelFollowUp`, `revalidateFollowUpConfiguration`) | **KEEP** | Revalidates against the **currently published** config, never the schedule-time snapshot; fails closed to a retryable technical failure rather than silently skipping a check |
| Re-entry into the session (legacy path) | `runFollowupTick.ts:757-771` | **DO_NOT_REUSE as-is** | Builds a **synthetic inbound message** and replays it through `runNativeAutonomousCycle` as if the customer had typed it -- exactly the pattern R2's own follow-up code was built to avoid (see next row's comment). A fired follow-up must be a distinct event kind the Harness can never confuse with real customer text |
| Re-entry into the session (R2 objective-aware path) | `work/followup/objectiveAwareFollowUp.ts` | **KEEP as the pattern, REFACTOR the scope** | Correctly bypasses the LLM and dispatches a templated action directly; this is the right idea, but it is currently R2-private. R3 needs exactly one re-entry contract, not two divergent ones |
| Opt-out | `optOutStore.ts` | **KEEP** | Transactional insert+cancel, exact-match command detection (never fuzzy, so "no gracias" is never mistaken for opt-out) |
| Dead code | `multi-request/requestFollowups.ts` | **DO_NOT_REUSE** | Already removed as a productive persister per `ACS-R1-05-T05`'s reconciliation audit; zero callers |
| Dev-only sandbox | `autonomous-loop/**`, `follow-up-scheduling/**`, `follow-up-replanning/**` | **DO_NOT_REUSE** | In-memory only, reachable solely from `app/(hub)/dev/ai-sdr-simulator`, not re-exported from any production barrel |
| Outbox writer | `lib/brain/messaging/canonicalOutboxWriter.ts` | **KEEP** | Single writer by explicit code comment; `INSERT IGNORE` on a real dedupe key handles the race a select-then-insert cannot |
| Outbox worker | `lib/brain/messaging/autonomousOutboxTick.ts` | **KEEP** | Atomic claim, re-validate immediately before send, guarded terminal transitions that honestly detect (not hide) a send-after-cancel race; exponential backoff, capped attempts, terminal escalation |
| Correlation | `correlationId` threaded through `commercial_event`/`crm_agent_decisions`/`crm_capability_executions`/`crm_agent_actions` | **KEEP** | Consistent join key across every table already; only the follow-up-to-outbox direction has a dedicated read-model (`follow-up-observability/detailService.ts`) -- worth generalizing later, not blocking |
| `hub_audit_log` / `lib/audit.ts` | -- | **KEEP, different purpose** | Generic human-action audit (case control, config publish), not the capability-execution evidence path -- do not conflate the two |
| `ai_agent_execution`/`ai_agent_decision`/`ai_tool_execution`/`ai_conversation_state` | Described in `ADR-002` | **DO_NOT_REUSE (dormant schema)** | **Correction (R3-A01, direct read of `migrations/008_conversation_ai_runtime_core.sql`): these tables DO exist as schema** -- this document's original claim that they were "not observed" was too strong. `rg -l` across the whole repo shows they are written only by `lib/brain/local-ai-sdr/**` (a separate, older module) and one bootstrap smoke script; the current native/commercial runtime (`agent-loop/`, `native-cycle/`, `capability-gateway/`, `work/`) never touches them. This document's substantive conclusion stands unchanged: `commercial_event`/`crm_capability_executions`/`crm_agent_decisions` already serve `ADR-002`'s intended role in practice, and these tables are dormant relative to the live path, not a resource to build R3 on |

---

## Phase 2 -- R3 component model

```text
Customer (WhatsApp)
      |
      v
SalesAgentHarness  <----->  AgentSessionStore
      |     ^
      | read tools           CommercialActionRequest
      v     |                        |
ReadToolGateway              CommercialTransactionKernel
      |                              |
      v                              v
       Capability Gateway  <---------
              |
              v
    Catalog / Customer Profile / Shipping / Quote / Identity
              |
              v
       CRM/domain stores (MariaDB, ADR-009)

FollowUpScheduler  --wakes-->  AgentSessionStore  --new turn-->  SalesAgentHarness
Outbound  <--governed send--  CommercialTransactionKernel
```

### A. SalesAgentHarness

**Net-new orchestration layer**, built on `runAgentToolLoop.ts`'s proven
gather/finalize shape (`REUSE_BEHIND_NEW_INTERFACE`), extended with:

- A real session (below), so the loop is no longer stateless-per-turn.
- `AgentLoopProvider` as its only model boundary (`KEEP`), hardened away
  from DeepSeek-specific fields so a second provider is a new adapter file,
  not a loop change (already true in principle per the ATL audit; not yet
  proven against a second real provider).
- The multi-intent branch (`runCommercialMultiIntentLoop`) folded in as
  configuration, not a parallel code path.
- Bounded execution unchanged: `maxDecisions`/`maxToolExecutions` for
  gathering, fixed `FINALIZATION_MAX_ATTEMPTS` for finalization, a
  turn-level deadline checked every iteration -- these numbers already exist
  and already work; R3 does not need to invent a new budget model.

### B. AgentSessionStore

**Net-new component -- the one clear gap this audit confirmed.** Today
"session" is not stored; it is re-derived every turn from
`conversation`/`conversation_message` (capped at 12 recent messages),
`crm_opportunities`, `crm_sales_need_profiles`, durable facts, and the
*single most recent* `commercial_event` row for continuity
(`pendingCatalogAction.ts`). That is a real gap against "append-only
operational events, resume, recent context, structured summary" -- but the
building blocks to close it already exist and are proven:

- **Append-only backbone**: extend the `commercial_event` pattern
  (`dedupe_key`, `correlation_id`, `causation_id`, immutable rows) rather
  than inventing a new storage primitive. `ADR-009` already forbids a second
  persistence engine for this domain.
- **No hidden chain-of-thought**: already an enforced invariant, not new
  work -- `runNativeAgentToolLoopCycle.ts`'s sanitizer already rejects any
  payload key matching `/token/i` and the loop's own types document
  "never rawOutput, never a prompt" at the type level
  (`AgentLoopProviderCallMetadata`). The `AgentSessionStore` must preserve
  this discipline for every new event kind it introduces, not relax it.
- **Resume / structured summary**: net-new. Needs a materialized "recent
  context" projection (a bounded rebuild from the event log, same pattern
  `RecentCatalogContext` already uses at smaller scope) so the Harness does
  not replay the full event history into every prompt.
- **Scope boundary**: the session is conversational memory. It never
  becomes a second business-truth store -- `ADR-002`'s invariant ("el core
  comercial opera sin leer `ai_*`") applies identically here.

### C. ReadToolGateway

**Mostly already built.** The read-only subset of today's
`AGENT_LOOP_TOOL_POOL` -- `search_products`, `get_product_details`,
`search_company_knowledge`, `explore_catalog`, `recommend_catalog_products`,
plus `calculate_shipping` (a read-only external call) -- already routes
through `executeGovernedCapability` with no mutation authority. R3's work
here is narrow: formally split the pool into a read-only surface (this
component) and a mutating surface (goes through D instead), rather than
letting both sit in one undifferentiated allowlist as today.

### D. CommercialActionRequest boundary

**The one structural gap between ATL-as-it-exists and the target's
principle 2** ("the LLM never authorizes mutations"). Today, a mutating
tool call from ATL (`select_products`, `set_shipping_destination`,
`create_quote`, `select_shipping_option`) is governed -- it passes through
Capability Gateway policy, evidence checks, and retry -- but "propose" and
"execute" are the same function call (`executeGovernedCapability`), with no
separate typed request object in between the way R2's
`AIProposal -> CapabilityEvaluation -> AcceptedCommercialDecision` pipeline
(`ADR-001`) has for its planner path.

R3 introduces `CommercialActionRequest` as that missing typed intermediary
for the Harness: the model's `use_tool` step for a mutating capability
becomes a request object, not a call. **Before** that request reaches
`executeGovernedCapability`, it must pass the same identity-sufficiency
check R2's objectives already get
(`work/commercialIdentityGate.ts#applyCommercialIdentityGate`) -- generalized
so it is callable from any request origin, not wired only into R2's
projection. This is flagged, not assumed solved: it must be verified
whether ATL's existing mutating tool calls today already get an equivalent
identity check inside each capability's own `execute()`, or whether this is
a real, currently-open gate gap. Close this before widening ATL's mutation
surface (Phase 6, Phase 7).

### E. CommercialTransactionKernel

**Mostly `REUSE_BEHIND_NEW_INTERFACE`.** This is R2's existing deterministic
middle, generalized to accept a `CommercialActionRequest` from either origin
(R2's own planner, narrowed in scope, or the Harness):

- Pure projection (`buildCommercialWorkProjection.ts`) unchanged.
- Executor (`commercialWorkExecutor.ts`) unchanged.
- Settle loop (`settleCommercialWorkProjection.ts`) unchanged.
- Identity gate (`commercialIdentityGate.ts`) generalized per D above.
- Idempotency: `create_quote`'s hash-key-plus-reuse pattern and the
  `expectedVersion` optimistic-concurrency pattern already used by both
  `CommercialWork` rows and onboarding state become the standard the Kernel
  enforces for every mutation, not a per-capability accident.
- Confirmation / human approval: **the one component with no working
  implementation today.** `requires_review` is a real lifecycle status
  (`action-lifecycle/constants.ts`) and `evaluateExecutionGate.ts` already
  blocks execution on it -- but no registered capability currently declares
  `authority: "requires_approval"`, and the code says outright there is no
  operator route to clear a `requires_review` row
  (`follow-up-observability/reasonLabels.ts:38-40`: "sin flujo de aprobación
  disponible"). `PRODUCT_NORTH_STAR.md`'s requirement that discounts, price
  changes, refunds, and cancellations require human approval has a
  structural hook and zero working plumbing behind it. This is real,
  pre-existing debt this document did not create -- but any R3 slice that
  widens autonomous mutation authority must not touch a capability class
  that would need this gate until it exists.

### F. Capability Gateway

**`KEEP`, unchanged.** Already the shared execution boundary for 7
independent callers; a Harness-originated `CommercialActionRequest` becomes
an 8th caller through the exact same `executeGovernedCapability` contract.
No change to the gateway itself is implied by this architecture.

### G. FollowUpScheduler

**`REUSE_BEHIND_NEW_INTERFACE`** for claiming/dedup/cancellation
(`runFollowupTick.ts`'s core mechanics are sound), **`REFACTOR`** for
re-entry. Today there are two divergent answers to "how does a fired
follow-up reach the conversation": a synthetic inbound message replayed
through the full cycle (legacy path, explicitly the anti-pattern R2's own
code comments warn against), and a templated LLM-bypass dispatch (R2's
`objectiveAwareFollowUp.ts`, the right idea but R2-private).

R3 needs exactly one contract: a fired follow-up appends a structured
**wake event** to the `AgentSessionStore` -- never a fabricated customer
message -- that the Harness recognizes as a distinct turn kind. The
Harness may then decide to re-engage conversationally (advisory) or route
straight to a `CommercialActionRequest` (e.g. "quote is about to expire,
resend it") depending on what the wake event represents. Duplicate/
cancellation protection (the generated-column unique key, live-config
revalidation) carries over unchanged.

### H. Outbound

**`KEEP`, unchanged.** `canonicalOutboxWriter.ts` (single writer,
`INSERT IGNORE` dedupe) and `autonomousOutboxTick.ts` (atomic claim,
revalidate-before-send, guarded terminal transitions, exponential backoff)
already satisfy "governed, idempotent send" in full. Neither the Harness
nor the Kernel should ever call a provider directly; both produce a
`crm_agent_actions` row that flows into this existing pipeline exactly as
R2's `dispatchCommercialWorkResponse.ts` does today.

---

## Phase 3 -- State ownership

No item below has ambiguous ownership. This extends
`docs/product/autonomous-commerce-state-model.md`'s existing ownership
matrix with the Harness-specific additions; it does not contradict it.

| State | Owner | Notes |
|---|---|---|
| Conversation history | `conversation_message` | Canonical timeline, unchanged. The Harness reads it, never owns a second copy |
| Conversation summary | `AgentSessionStore` (new, derived) | A bounded, resumable projection over the session's own event log -- reconstructible, never authoritative over `conversation_message` |
| Current conversational goals | `AgentSessionStore` (new, transient-durable) | Ephemeral within a session, persisted only as evidence of what was pursued -- never a business-truth field, same discipline `ADR-002` already applies to `ai_conversation_state` |
| Identity | `master_customer`, `customer_external_identity`, `crm_customer_onboarding_state` | Unchanged. `RuntimeIdentityContext` is a per-turn computed view, never a store |
| Customer profile | `master_customer` projection + Customer Profile HTTP boundary | Unchanged; LEVEL_3-gated read, per `ADR-008` |
| Selected products | `crm_request_facts` (`commercial_line_items` fact key) | Unchanged -- durable, evidence-gated, one active fact per opportunity |
| Shipping destination | `crm_request_facts` (`shipping_destination` fact key) | Unchanged |
| Shipping selection | `crm_request_facts` / `selectedShippingOption` capability state | Unchanged |
| Quote | `crm_quotes` (via `createQuoteCapability.ts`) | Unchanged; idempotent by `selectionFactId` |
| Order | Out of scope -- no native order-mutation capability exists (`update_orders`: prohibited per authority matrix) | R3 does not change this; order state remains external/read-only |
| Follow-up | `crm_agent_actions` (`action_type='schedule_followup'`) | Unchanged as the durable schedule; the **wake event** it produces is owned by `AgentSessionStore`, not a second copy of the schedule |
| Tool executions | `crm_capability_executions` | Unchanged; every `CommercialActionRequest`'s execution and every `ReadToolGateway` call lands here identically |
| Commercial actions | `crm_agent_actions` | Unchanged, per `ADR-003`/`ADR-004` -- only an accepted decision creates a row here, from either the Kernel (R2-origin) or the Kernel processing a Harness-originated `CommercialActionRequest` |

The target conceptual separation from the task brief holds exactly:
**Agent Session = conversational memory** (new component, B),
**CRM/domain stores = business truth** (unchanged, `ADR-009`),
**Commercial Transaction = durable mutation/execution state** (unchanged,
`ADR-003`/`ADR-004`, now reachable from two request origins instead of one).

---

## Phase 4 -- Turn lifecycles

Component names below refer to Phase 2's model; file references are the
existing code that already implements the step unless marked **(new)**.

**1. Simple advisory question** ("what's the difference between these two
barbells"): Harness loads session summary -> calls `ReadToolGateway`
(`explore_catalog`/`get_product_details`) -> no `CommercialActionRequest`
needed -> responds via finalization -> session appends the turn (new) and
`commercial_event` records it as today.

**2. Multi-step product consultation** (budget-constrained multi-item ask):
Harness makes N `ReadToolGateway` calls across gathering iterations (bounded
by `maxToolExecutions`), assembling a grounded recommendation the way the
bake-off's `H0-11` scenario did -- no Kernel involvement until the customer
commits.

**3. Read-tool failure** (Catalog Service unavailable): `ReadToolGateway`
call returns `unavailable` via existing `CatalogEvaluation` semantics
(`ADR-005`, `ADR-006`'s `CapabilityEvaluation` states) -> Harness tells the
customer honestly (already the proven behavior in bake-off `H0-15`) ->
offers a next step -> no fabricated product data, ever.

**4. Customer decides to buy a recommended product**: Harness emits a
`CommercialActionRequest{type: select_products, ...}` **(new boundary)** ->
generalized identity gate runs -> Kernel's existing projection/execution
(`buildCommercialWorkProjection.ts`/`commercialWorkExecutor.ts`) persists
the selection to `crm_request_facts` exactly as `select_products` does
today.

**5. `CommercialActionRequest` -> transaction**: Kernel validates
(schema, identity, policy) -> on `available`, executes via
`executeGovernedCapability` (unchanged) -> writes `crm_capability_executions`
evidence -> on a bounded transaction (quote, shipping, cancellation),
follows R2's existing accept/execute/dispatch chain end to end.

**6. Identity insufficient for transaction**: `decideCommercialIdentityRequirement`
returns non-`SUFFICIENT` -> request is not executed -> Harness is told
`IDENTITY_INSUFFICIENT` (same enum R2 already uses) -> Harness asks the
missing question or triggers onboarding, conversationally -- never silently
retries the mutation.

**7. Transaction completes**: Kernel persists (`crm_agent_actions` row,
terminal `completed`), evidence recorded, outcome available -> a
`CommercialEvent` is emitted (`ADR-007`: "cada outcome puede generar un
nuevo `CommercialEvent`") -> Harness's session appends this as a durable
fact **(new: session must record what the Kernel did, not just what the
model said)**, so the next turn's summary already reflects it.

**8. Conversation continues after transaction**: Harness resumes from the
same session; the durable fact from step 7 is already in the summary/
projection, so it is not re-derived from raw message text -- prevents the
model re-asking a question it already has an authoritative answer to.

**9. Customer changes a previous decision** ("actually make it the 20kg
one"): a second `CommercialActionRequest` for `select_products` -- durable
facts already supersede-not-append (`crm_request_facts`'s existing
supersession semantics), so this requires no new mechanism.

**10. Follow-up wake-up**: `FollowUpScheduler` fires -> appends a
**wake event** to `AgentSessionStore` **(new re-entry contract, replacing
both existing divergent paths)** -> Harness receives it as a distinct turn
kind, decides to re-engage conversationally or emit a
`CommercialActionRequest` directly (e.g. re-sending an about-to-expire
quote via `objectiveAwareFollowUp.ts`'s existing template-dispatch pattern)
-- never fabricates a customer message.

**11. Duplicate inbound**: unchanged -- `commercial_event.dedupe_key` and
the outbox's `INSERT IGNORE` dedupe key already prevent this at both the
inbound and outbound edges; the session's own append-only log gets the
same dedupe discipline for any new event kind it introduces.

**12. Service outage/retry**: `ReadToolGateway`/Kernel calls follow the
existing `CapabilityEvaluation` -> bounded retry -> `failed` only after a
valid, authorized attempt (`ADR-002`/`ADR-007`) -> Harness replans within
its existing 3-attempt-equivalent gathering budget -> on exhaustion, safe
finalization message, never a stuck turn, never a fabricated success.

---

## Phase 5 -- ATL/R2 reuse matrix

| Component | Current responsibility | R3 responsibility | Decision | Reason |
|---|---|---|---|---|
| `AgentLoopProvider` | Provider-neutral model call contract | Unchanged -- the Harness's only model boundary | **KEEP** | Already the right shape; owning it satisfies principle 10 |
| `runAgentToolLoop` (gather/finalize) | ATL's per-turn loop | Becomes the `SalesAgentHarness` engine, extended with session read/write | **REUSE_BEHIND_NEW_INTERFACE** | Proven budget model, proven termination reasons; add a session seam, don't rewrite |
| `AGENT_LOOP_TOOL_POOL` / `toolAliases.ts` | Fixed LLM-facing tool allowlist, read+mutate mixed | Splits into `ReadToolGateway` surface and `CommercialActionRequest`-gated surface | **REFACTOR** | The allowlist mechanism is right; the undifferentiated read/mutate mixing is what changes |
| DeepSeek adapter (`httpAgentLoopProvider.ts`) | Concrete provider impl, DeepSeek-coupled fields | One of possibly several `AgentLoopProvider` implementations | **REFACTOR** | Generalize the type shape before claiming provider-neutrality is real, not just structural |
| `SalesAgentProvider` (legacy) | Second provider interface for the disabled shadow pipeline | None | **DEPRECATE** | Dead weight once the shadow pipeline is formally retired; do not port forward |
| `CommercialWork` repository | Durable aggregate persistence, optimistic concurrency | Becomes the Kernel's persistence layer, unchanged | **KEEP** | -- |
| Projection (`buildCommercialWorkProjection.ts`) | Pure objective/step derivation | Kernel's core transform, fed by either request origin | **REUSE_BEHIND_NEW_INTERFACE** | Already pure and I/O-free; ideal reuse target |
| Settle loop (`settleCommercialWorkProjection.ts`) | Same-turn cascade resolution | Unchanged | **KEEP** | -- |
| Capability Gateway | Governed execution for 7 existing callers | Same, +1 caller (Harness via Kernel) | **KEEP** | Already loop-shape-agnostic, confirmed by code, not assumed |
| `crm_capability_executions` (evidence) | Per-call audit row, gateway-centralized | Unchanged, but transactional-write gap flagged | **REFACTOR (targeted)** | Fold the audit write into the same transaction as the mutation where the underlying store allows it; today it is a best-effort write after the fact |
| Identity gates (`commercialIdentityGate.ts` + `commercial-identity-requirement`) | R2-objective-scoped identity sufficiency check | Generalized gate callable from any `CommercialActionRequest` | **REFACTOR** | Decision logic is already pure/reusable; the wiring is what's R2-specific today |
| Outbox (`canonicalOutboxWriter.ts`, `autonomousOutboxTick.ts`) | Governed idempotent send | Unchanged | **KEEP** | Already satisfies the target spec in full |
| Follow-up scheduler (`runFollowupTick.ts`) | Claim/cancel/dedupe due follow-ups | Unchanged mechanics, new unified re-entry contract | **REUSE_BEHIND_NEW_INTERFACE** | Core mechanics sound; re-entry is the one thing that must change |
| `semanticIntentAdapter.ts` (R2 planner) | Sole conversational entry point for all commercial turns | Narrowed to the bounded-transaction intents it already handles well (selection, quantity/product correction, shipping quote, cancellation) | **DEPRECATE (narrow scope, not delete)** | Bake-off's own verdict; R2's deterministic strength is real for these intents and should not be discarded |
| `autonomous-loop/**` dev sandbox | In-memory simulator, dev-only | None | **DO_NOT_REUSE** | No production callers, no productive value to carry forward |
| `multi-request/requestFollowups.ts` | Dead follow-up persister | None | **DO_NOT_REUSE** | Already formally removed as a productive path per prior reconciliation audit |

---

## Phase 6 -- Migration plan

No big-bang migration. R2 remains available as rollback until R3 reaches
validated parity for transactional behavior, per the task's own constraint.
Names are illustrative, sequencing is derived from the audit above --
specifically, from what Phase 1/2 found already built vs. genuinely new.

- **R3-A01 -- AgentSessionStore spike, no routing change.** Build the
  append-only session log and structured-summary projection (Phase 2.B)
  behind the existing `agentToolLoopEnabled` flag, read-only alongside
  today's per-turn rebuild -- do not remove the rebuild yet. Close the one
  open verification from Phase 2.D: confirm whether ATL's existing mutating
  tool calls already receive an identity-sufficiency check equivalent to
  R2's `commercialIdentityGate`, or whether this is a live gap. This is the
  smallest slice that unblocks everything after it.
- **R3-A02 -- Generalize the identity gate.** Extract
  `commercialIdentityGate.ts`'s decision logic so it is callable outside
  R2's objective/step model, wired into ATL's existing mutating tool calls
  if A01 found a gap there.
- **R3-A03 -- `CommercialActionRequest` boundary.** Introduce the typed
  request object for ATL's mutating tools (Phase 2.D), routed through the
  now-generalized identity gate and unchanged Capability Gateway. No new
  mutation capability is added in this slice -- only the boundary around
  the ones that already exist.
- **R3-A04 -- ReadToolGateway/CommercialActionRequest split.** Formally
  separate `AGENT_LOOP_TOOL_POOL` into the two surfaces from Phase 2.C/D.
- **R3-A05 -- Unify follow-up re-entry.** Replace the legacy
  synthetic-inbound-message path with the wake-event contract (Phase 2.G),
  generalizing `objectiveAwareFollowUp.ts`'s bypass-the-LLM pattern rather
  than keeping two divergent implementations.
- **R3-A06 -- `crm_opportunities` creation on the Harness path.** Close the
  bake-off/CAPABILITY_MATRIX-documented gap (`LLM-R1-T09B`): today ATL only
  mutates a pre-existing opportunity. This must land before ATL's
  conversational footprint widens, per the bake-off's own risk #1.
  Sequence before A07/A08, not after.
- **R3-A07 -- Hybrid benchmark.** Reuse `agent-loop/benchmark/*` and
  `work/benchmark/runR2Scenario.ts` unchanged to validate the widened
  Harness against R2 on the same 20-scenario corpus the bake-off already
  built, now against real session state instead of the bake-off's
  in-memory stand-in for `pendingIntents`.
- **R3-A08 -- Controlled WhatsApp rollout.** Widen `commercialCycleConfig.ts`
  routing so more conversation shapes reach the Harness before falling back
  to R2's narrowed planner, gated by the same allowlist mechanism already
  used for every prior controlled pilot in this repo.

Provisional customer identity per `AGENTS.md`/`docs/PRODUCT_NORTH_STAR.md`
applies unchanged throughout: no release in this plan builds a definitive
Customer 360 or invents a `customer_key`.

---

## Phase 7 -- Risks

- **LLM loop cost**: gathering/finalization budgets already bounded
  (`maxDecisions`/`maxToolExecutions`/`FINALIZATION_MAX_ATTEMPTS`) and
  proven in production; a persistent session with prompt-cache reuse should
  *reduce* per-turn token cost relative to R2's planner (bake-off measured
  2381 vs. 479 input tokens), but session-summary construction is new cost
  surface to benchmark, not assume.
- **Latency**: bake-off measured the Harness *faster* on average (7.1s vs.
  9.0s) despite more round-trips, because R2's single large call is not
  cache-friendly; still verify under real session-summary overhead in A07.
- **Tool-call explosion**: bounded today by `maxToolExecutions`; the
  evidence/mutation-claim guards (`commercialMutationClaims.ts`) already
  reject hallucinated arguments before they reach the Gateway -- carries
  forward unchanged.
- **Session growth**: `AgentSessionStore` must summarize/prune, not persist
  every raw event indefinitely into every prompt -- same discipline
  `RecentCatalogContext`'s existing 24h/5-interaction cap already
  demonstrates works at smaller scope.
- **Prompt-cache dependence**: bake-off's efficiency finding depends on a
  persistent session hitting the same provider's cache; a provider swap
  (principle 10) may not carry the same cache economics -- re-benchmark on
  any provider change, don't assume the numbers transfer.
- **Hallucinated action arguments**: mitigated structurally today
  (evidence-gated mutation guard, `inputSchema`-validated tool arguments
  after the real `sort_and_limit_required` incident documented in
  `CAPABILITY_MATRIX.md`) -- carries forward, not new work.
- **Provider outage**: `AgentLoopProvider`'s failure classification
  (`providerFailureClassification.ts`) already exists; the bake-off
  separately flagged the external DeepSeek Harness's default-on telemetry
  phone-home as a real consideration -- irrelevant here since R3 stays on
  the internal `AgentLoopProvider`, not the external package.
- **Session corruption**: genuinely new risk surface -- `AgentSessionStore`
  does not exist yet, so no incident history exists either. Mitigate by
  building it as strictly append-only/reconstructible from day one (same
  guarantee `commercial_event` already has), never as a mutable blob.
- **Transaction/session divergence**: the Kernel's mutation state
  (`crm_agent_actions`, `crm_request_facts`) and the session's conversational
  state must never disagree about "what happened" -- mitigated by Phase 4
  step 7's requirement that the session records the Kernel's *outcome*, not
  the model's *claim* of what it did.
- **Duplicate inbound**: already solved (`commercial_event.dedupe_key`,
  outbox `INSERT IGNORE`) -- extend the same dedupe discipline to any new
  session-log event kind, don't reinvent it.
- **Duplicate mutation**: already solved for the capabilities audited
  (quote's hash-key reuse, line-items' fact supersession, optimistic
  concurrency) -- the open item is only extending the same discipline to
  whatever ships in R3-A06 (`crm_opportunities` creation), not a new
  problem class.
- **Cross-turn stale state**: mitigated by the existing pattern of reading
  durable facts fresh each turn rather than trusting session-cached values
  for business truth (`ADR-002`'s invariant, unchanged) -- the session
  caches *conversation*, never price/stock/identity.
- **Security/privacy**: the `RuntimeIdentityContext`/`CustomerSessionDecisionContext`
  split already prevents PII from reaching the model, but it is enforced by
  construction discipline, not an automated check (Phase 1 finding) --
  widening who reads session data in R3-A01 is the right moment to add that
  check, before the surface grows further.
- **Model upgrade regressions**: mitigated by the existing benchmark harness
  (`agent-loop/benchmark/*`, `work/benchmark/*`) already scoring correctness/
  robustness/latency/tokens against a fixture corpus -- re-run on every
  provider or model version change, per the bake-off's own Phase 2 finding
  #3 (unverified findings on a fast-moving external package do not
  automatically stay true).

---

## Phase 8 -- Deliverable and verdict

This document is the deliverable
(`docs/architecture/SALES-AGENT-R3-A00-target-architecture.md`).

**Verdict: `R3_ARCHITECTURE_READY`**

The target hypothesis holds under audit: the Capability Gateway is already
loop-shape-agnostic in code (not just in intent), the governance chain the
task asks for is largely already formalized in `ADR-001`/`ADR-002`/`ADR-006`
and enforced in `crm_capability_executions`/identity gates/idempotency
patterns, and the outbox already satisfies the "governed, idempotent send"
requirement in full. The gaps found -- no `AgentSessionStore`, no unified
follow-up re-entry, no working human-approval queue behind `requires_review`,
a `CommercialActionRequest` boundary that today conflates propose-and-execute
for ATL's mutating tools, and a not-yet-verified identity-gate parity
question -- are real, bounded, and sequenceable. None require reopening a
decision this repository has already made (no dual-write engine, no new
persistence layer, no abandonment of the Capability Gateway contract).

**Smallest next implementation slice: `R3-A01`** -- the `AgentSessionStore`
spike plus the identity-gate parity verification, built behind the existing
`agentToolLoopEnabled` flag, read-only alongside today's per-turn rebuild,
with zero change to production routing. This is the one component nothing
else in Phase 2-6 can proceed without, and it is additive: if it needs
rollback, deleting it returns the system to exactly its current, already-
verified behavior.
