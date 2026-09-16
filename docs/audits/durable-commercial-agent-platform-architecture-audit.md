# Durable Commercial Agent Platform — Architecture Audit

- **Date**: 2026-09-15
- **Scope**: Full local repository (`E:\dev\codex\CRM-Customer-360`, commit `faf88d7`) + production EC2 instance, read-only.
- **Method**: 8 parallel read-only research passes over the local codebase (one per architectural cluster below) + direct read-only SSH reconnaissance against production. No code, config, schema, or data was modified. No benchmarks were executed against production.
- **Status of this document**: forensic snapshot, not a design proposal for R3 itself. Where this audit recommends direction (target architecture, migration roadmap), that is explicitly separated from the findings.

---

## 0. Design principle under evaluation

> The agent should not be the source of truth for the business. Commercial state, objectives, events, identity, cart, shipping, quote, and lifecycle should belong to a durable platform. The LLM should reason and select actions over explicit, verifiable state.

**Verdict: the codebase is closer to this principle than a surface read suggests, but it is not one architecture — it is at least three generations of the same idea, running concurrently in production, each partially implementing it.** The newest generation (R3 / SalesAgentRuntime + CommercialWork) gets the hard parts right (durable facts never derived from transcript, real optimistic concurrency, real idempotency keys, centralized context assembly). The fragmentation *between* generations — not the absence of durable-state discipline — is the dominant architectural problem this audit found.

---

## 1. Executive summary

**The central fact that explains most other findings**: this repository runs **five mutually-exclusive commercial "runtimes"** for the same job (turn a WhatsApp message into a commercial decision), selected per-conversation by wa_id allowlist flags, checked in this priority order in `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts`:

```
CommercialWork (R2) > MultiRequest > AgentToolLoop > SalesAgentRuntime (R3) > legacy shadow/operational-loop
```

All five are real, live code — not dead branches — and each has grown its **own** representation of concepts that should be singular: opportunity/case status, "next action," "waiting for," capability execution, and even a second and third independent tool-execution/audit surface. This is the accumulated cost of building three generations (legacy → R2 CommercialWork → R3 SalesAgentRuntime) without retiring the previous one as the next one matured.

**What is genuinely good, and should be preserved, not rebuilt:**

- Business-critical facts (cart, shipping destination, opportunity stage, shipping-quote evidence) are durable, versioned, and **explicitly, repeatedly documented in code** as never being derived from the conversation transcript. The "delete the transcript" test (§10) mostly passes.
- Real optimistic concurrency (CAS with `version` columns), real per-conversation mutual exclusion (a CAS claim with a `NOT EXISTS` guard), and real crash-recovery via stale-lease reclaim exist in the turn-settlement and CommercialWork layers — this is materially more mature than the "concurrency audit" section of this task assumed it needed to discover from scratch.
- Real idempotency keys (SHA-256, deterministic) protect quote creation, quote issuance, quote email, and WhatsApp outbound send.
- Context assembly is genuinely centralized in one function, not scattered — a real strength.
- Capability contracts are LLM-loop-independent by construction: a future Hub UI, Voice Agent, or internal API could call the governed Capability Gateway directly today.
- A channel-neutral, provider-agnostic identity table (`master_customer` + `customer_external_identity`) already exists — multichannel identity resolution does not require inventing a new `customer_key`, contrary to what the fragmented WhatsApp-keyed runtime state elsewhere would suggest.
- Human handoff has **one** shared state between the operator Hub and the AI agent — no parallel commercial reality, a common and serious failure mode in other systems that this one avoids.

**What is confirmed broken or fragmented, in priority order:**

1. **`select_products` does FULL_REPLACEMENT, not a patch** — confirmed bug, plus a second manifestation (no CAS on the cart write, so concurrent calls can lose updates independently of the sequential-turn bug).
2. **`issue_quote` never checks whether the cart changed since `create_quote` ran** — can silently issue a quote for a cart the customer already changed.
3. **A second, fully live, ungoverned capability-execution surface exists** (`READ_CAPABILITY_REGISTRY` behind the multi-request runtime) that bypasses the identity gate entirely and writes **zero** audit rows — a real, current gap in the "every capability execution is audited" architecture, not a theoretical one.
4. **No single event log can reconstruct a commercial case end-to-end.** Three independent append-only logs exist at three granularities, and which one(s) get written depends on which of the five runtimes handled a given turn. The legacy operational-loop path writes **no** event log at all.
5. **`crm-followup` has no execution fallback.** Unlike the outbox worker (which has an HTTP route as backup), the follow-up worker's tick function has exactly one production caller — the stopped pm2 process. With it stopped, scheduled follow-ups simply never fire, with no retry/expiry/alerting path.
6. **The follow-up dispatch policy fails closed to "never schedule anything"** when `BRAIN_COMMERCIAL_POLICY_ENABLED=false` — the documented default.
7. **Opportunity is not the right evolution target for the Durable Commercial Case.** It has real identity and CAS, but its cart/destination/shipping state was never modeled on it — three separate modules smuggle that state into a generic per-request fact table via a hand-rolled `opportunity:<id>` string key. A structurally richer sibling, `crm_commercial_work` (+ objectives + steps), already exists and is checked first in routing.
8. **Root cause (already known, reconfirmed here)**: `evaluateCapabilityIdentityGate` denies `create_quote`/`issue_quote`/`send_quote_email`/`link_external_identity` whenever `trustedCustomerSession` is absent — this is intentional fail-closed design, not a bug, but it is the deterministic explanation for the Q04/Q05/Q09 benchmark failures found on production.

**Production reality (read-only SSH, 2026-09-15):** deploy is current (`faf88d7`, 0 behind `develop`). `crm-web`, `crm-outbox`, `crm-turn-settle`, `catalog-service`, `customer-profile`, `quote-service` are online; **`crm-commercial-work` and `crm-followup` are stopped.** Because CommercialWork's core per-turn pipeline runs synchronously inline inside `crm-web`'s request (confirmed from source), the stopped worker degrades only its retry/crash-recovery sweep — not a full outage for turns that complete in one pass. `crm-followup` stopped is a full outage for that feature (see finding above). `crm-web` runs `next start` against an `output: standalone` build — a real, independently-confirmed misconfiguration producing recurring "Failed to find Server Action" errors. Three stray untracked `.env.*` backup files sit on the production filesystem alongside the live `.env` (secret-sprawl hygiene finding, new in this pass).

---

## 2. Current production architecture

Reconstructed end-to-end, with real file paths, DB tables, and pm2 process ownership.

```
[Meta WhatsApp Cloud API]
      | HTTPS POST (webhook)
      v
app/api/integrations/whatsapp/webhook/route.ts  POST()
  - HMAC verify, allowlist gate, extracts messages[]/statuses[]
  - TEXT ONLY: message.text.body / message.body — image/audio/document/
    location message types are recognized (messageType captured) but their
    content is silently dropped (text becomes empty string)
  PROCESS: crm-web (Next.js "next start")
      |
      v  processNativeWhatsAppInbound()  [lib/brain/native-whatsapp/service.ts]
  - dedupe on (provider='meta', provider_message_id) -> conversation_message
  - resolveOrPersistNativeExternalIdentity: external_identity, wa_id/phone
  - ONE DB TRANSACTION:
      INSERT/UPDATE conversation (008), INSERT conversation_message (008),
      recordCommercialEvent (011), touchConversationAfterInbound,
      IF settleDelayMs>0: upsertPendingTurn -> crm_inbound_turn_settlements (035/036)
  - IF settleDelayMs<=0 (DEFAULT, current prod behavior): awaits
    ensureAutonomousSalesTurnContinuity() INLINE, same HTTP request
  PROCESS: crm-web (still same HTTP request when settleDelayMs=0)
      |
      v  ensureAutonomousSalesTurnContinuity()  [continuity/]
  - shared "never end a turn in silence" wrapper
      |
      v  runNativeAutonomousCycle()  [native-cycle/]
  Gates (any can short-circuit, zero LLM call): WhatsApp access gate ->
  BRAIN_AUTONOMOUS_RESPONSES_ENABLED killswitch -> test-wa_id allowlist ->
  opt-out store
  - resolveNativeCustomerSession() -> identity + onboarding (external
    Customer Service, PAUSED_EXTERNAL per docs/ACTIVE_RELEASE.md)
  - loadAutonomousCustomerContext() -> Customer 360
  - buildNativeCommercialContext() -> CommercialContextSnapshot
  >>> RUNTIME SELECTION (mutually exclusive, this priority order):
        1. shouldRouteToCommercialWork(waId)       [CommercialWork / R2]
        2. isMultiRequestRuntimeEnabled()            [multi-request runtime]
        3. buildAgentToolLoopFeatureFlags()           [Agent Tool Loop]
        4. shouldRouteToSalesAgentRuntime(waId)      [SalesAgentRuntime / R3]
        5. else: legacy shadow/operational-loop/execution-bridge pipeline
      Each is a per-wa_id allowlist, fail-closed, default empty/false.
      ALL OF THIS RUNS INLINE IN THE crm-web WEB REQUEST.
      |
      +--[CommercialWork]--> runCommercialWorkInboundCycle() [work/]
      |     1 LLM planning call -> reconcileCommercialTrigger ->
      |     crm_commercial_work (029-031) -> executeCommercialWork()
      |     SYNCHRONOUSLY -> Capability Gateway -> settleCommercialWorkProjection()
      |     -> dispatchCommercialWorkResponse() -> outbox
      |     IF WAITING_CUSTOMER: scheduleObjectiveAwareFollowUp()
      |
      +--[SalesAgentRuntime/R3 or Agent Tool Loop]-->
      |     runSalesAgentRuntimeCycle() -> runAgentToolLoop() ITERATIVE LOOP:
      |       buildAgentStepPromptPackage() [context compiler]
      |       -> httpAgentLoopProvider.invoke() [DeepSeek, OpenAI-compatible]
      |       -> AgentStep: use_tool | respond | handoff
      |       -> IF use_tool: Capability Gateway -> STATE MUTATION
      |       -> loop until respond/handoff/budget exhausted; live inbound
      |          can be assimilated mid-loop (checkForNewInbound.ts)
      |     FINALIZATION: dispatchGovernedSalesAgentMessage()
      |       - transactional ownership recheck (FOR UPDATE)
      |       - writeCanonicalOutboxMessage() -> brain_message_outbox (003)
      |
      +--[multi-request]--> executeRequestTurn() -> executeReadCapabilityForRequest()
      |     -> READ_CAPABILITY_REGISTRY (SEPARATE, UNGOVERNED — see §11)
      |
      +--[else, legacy]--> shadow -> operational-loop -> execution-bridge
            -> crm_agent_decisions, crm_agent_actions (005) -> outbox
      |
      v
  brain_message_outbox row (status='planned')  <-- SINGLE convergence point
      |
      v  runOutboxTick()   PROCESS: crm-outbox (ONLINE)
  - claim (planned->locked), re-validate ownership/24h window, retry w/ backoff
      |
      v
  [Meta WhatsApp Cloud API] -- outbound send

Parallel/async workers (separate pm2 processes, poll on a timer):
  - crm-turn-settle (ONLINE): drains crm_inbound_turn_settlements, re-enters
    through the same continuity boundary.
  - crm-commercial-work (STOPPED): only drains RETRY_SCHEDULED/stale-RUNNING
    steps + an async-delivery crash-recovery sweep — NOT the main execution
    path, which runs inline in crm-web (see finding above).
  - crm-followup (STOPPED): the ONLY caller of runFollowupTick — no fallback.
  - catalog-service, customer-profile, quote-service: external microservices,
    thin HTTP adapters only in this repo, confirmed no local server code.

Legacy/dead paths observed (NOT in the live flow):
  - lib/brain/processInbound.ts + app/api/brain/process-inbound/route.ts: old
    n8n-facing ingress, explicitly bypassed by the native path.
  - native-whatsapp/service.ts#processSalesInbound: marked DEAD CODE in-repo
    ("zero production callers, verified by grep").
```

### Component inventory

| Stage | File(s) | DB Tables | Feature Flags | Worker/Process |
|---|---|---|---|---|
| Webhook ingress | `app/api/integrations/whatsapp/webhook/route.ts` | – | `BRAIN_WHATSAPP_ALLOWED_WA_IDS`, `META_WHATSAPP_APP_SECRET` | crm-web |
| Persistence + turn-settle upsert | `lib/brain/native-whatsapp/service.ts` | `conversation`, `conversation_message`, `commercial_event`, `crm_inbound_turn_settlements` | `BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS` (default 0) | crm-web |
| Turn settlement (optional) | `lib/brain/commercial/turn-settlement/*` | `crm_inbound_turn_settlements` | delay/max-ms flags | crm-turn-settle |
| Continuity guarantee | `continuity/ensureAutonomousSalesTurnContinuity.ts` | `commercial_event` | – | crm-web / crm-turn-settle |
| Routing | `native-cycle/runNativeAutonomousCycle.ts` | – | `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED(+_WA_IDS)`, `BRAIN_MULTI_REQUEST_*`, `BRAIN_AGENT_TOOL_LOOP_ENABLED`, `BRAIN_SALES_AGENT_RUNTIME_ENABLED(+_WA_IDS)`, `BRAIN_COMMERCIAL_SHADOW_ENABLED` | crm-web |
| CommercialWork runtime (R2) | `work/{runCommercialWorkInboundCycle,commercialWorkExecutor,settleCommercialWorkProjection,dispatchCommercialWorkResponse}.ts` | `crm_commercial_work(_objectives/_steps)` (029-031), `crm_capability_executions` | `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED/_WA_IDS` | crm-web inline + crm-commercial-work (retries only) |
| SalesAgentRuntime (R3) | `sales-agent-runtime/*`, `agent-loop/*` | `agent_sessions` (033/034), `crm_capability_executions`, `crm_opportunities` | `BRAIN_SALES_AGENT_RUNTIME_ENABLED/_WA_IDS`, `BRAIN_R3_*` | crm-web |
| Multi-request (bypass) | `multi-request/executeRequestTurn.ts` -> `capabilities/executeReadCapability.ts` | `crm_conversation_requests`, `crm_request_events` (015) | `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED` | crm-web |
| Legacy pipeline | `{shadow,operational-loop,execution-bridge}/*` | `crm_agent_decisions`, `crm_agent_actions` (005), `crm_turn_plans` (016) | `BRAIN_COMMERCIAL_SHADOW_ENABLED`, `BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED` | crm-web |
| Finalization/dispatch | `dispatchGovernedSalesAgentMessage.ts`, `execution-gate/sqlExecutionUnitOfWork.ts` -> `canonicalOutboxWriter.ts` | `brain_message_outbox` (003) | – | crm-web |
| Outbox delivery | `messaging/{autonomousOutboxTick,metaSendAdapter,metaClient}.ts` | `brain_message_outbox`, `crm_action_executions/outcomes` (013/025) | `BRAIN_META_SEND_ENABLED` | crm-outbox (ONLINE) |
| Follow-up wake | `followup/runFollowupTick.ts` | `crm_agent_actions` (027) | – | crm-followup (**STOPPED, no fallback**) |

**Which runtime is actually "live"?** Per `docs/ACTIVE_RELEASE.md`, `SalesAgentRuntime`/R3 is the active development target and the subject of essentially all recent commits, but the doc states its pilot allowlist is still empty of real customer wa_ids. This is in tension with the previously-found live `create_quote` benchmark artifact on production (uncommitted) — plausibly explained by the benchmark harness bypassing the allowlist rather than real customer traffic, but **not independently re-verified this session** (flagged as an open question, §27).

---

## 3. Channel abstraction

**Verdict: uneven.** The two true edges of the system — the DB persistence layer and the prompt/provider layer — are already channel-agnostic and well-built for extension. Everything in the middle hardcodes WhatsApp.

- **Good**: `conversation`/`conversation_message` (migration 008) use generic `channel`/`provider`/`external_contact_id`/`provider_message_id` columns; internal `id` is the durable PK, kept separate from Meta's message id. `buildAgentStepPromptPackage.ts` and `httpAgentLoopProvider.ts` consume only `commercialContextSummary`/`recentCatalogContext`/`priorSteps` — no WhatsApp awareness at all.
- **Bad**: the one type designed specifically to *be* the future channel-agnostic re-entry boundary (`AgentRuntimeEvent`/`CustomerMessageEvent`) still hard-bakes `waId`/`phoneNumberId` as required fields. `brain_message_outbox` — the single canonical outbound sink — types `channel: "whatsapp"` as a literal, not a union, and hardcodes the string in its INSERT. `dispatchGovernedSalesAgentMessage` requires a non-nullable `waId` and applies WhatsApp-specific normalization. Delivery-status handling and typing indicators are Meta-Cloud-API-specific with no adapter interface.
- **Turn-settlement is hard-typed to WhatsApp** (`wa_id`/`phone_number_id` as first-class fields, content modeled as a single joined string) — reusing it for voice would require a channel-neutral identity pair and a non-text fragment model, not just a new adapter at the edge.

**Answer to "could the core runtime stay channel-agnostic today?"**: No. Adding a second channel would require touching business logic in the re-entry contract, every dispatch function, and the single outbox table — not just an edge adapter — even though the two true edges were built to support exactly this kind of extension.

---

## 4. Turn / message / session / case semantics

| Concept | Type/Table | Persisted? | Carries business meaning? |
|---|---|---|---|
| message | `conversation_message` row | Yes | No — transport row |
| fragment | not its own row; counted via `crm_inbound_turn_settlements.fragment_count` | Implicit | No — debounce mechanics only |
| turn | `crm_inbound_turn_settlements` (execution state) / `crm_turn_plans` (planner output) | Yes, both | No for the settlement row; the plan row holds business content but is a planning artifact, not a case |
| conversation | `conversation` table | Yes | **No** — channel/thread/ownership only; `status` is only `open`/`closed`, driven by human-takeover control flow |
| agent_session | `agent_sessions` + `agent_session_events` | Yes | **No, by explicit design** — module header states it "never becomes a second source of truth for identity, customer profile, selected products, shipping, quote, order or follow-up schedule" |
| ConversationRequest | `crm_conversation_requests` | Yes | Partial — explicitly documented in-repo as the **non-canonical** path the live Native Agent Tool Loop never populates |
| opportunity | `crm_opportunities` | Yes | Yes — closest thing to a commercial case today, but see §5 |
| CommercialWork | `crm_commercial_work`/`_objectives`/`_steps` | Yes | **Yes — the structurally richer candidate** |

Direct answers:
- **Conversation is transport, not commercial.** No objective/intent/commercial-status field exists on it.
- **`agent_session` is pure memory, not lifecycle**, confirmed by its own code comments and by `currentGoals` being permanently hardcoded to `[]`.
- **`crm_conversation_requests` is a lower-level, non-canonical per-intent artifact**, not a case — its own migration header says so, and three separate domain modules (cart/destination/shipping) deliberately anchor to `opportunity:<id>` instead, specifically to avoid it.

---

## 5. Commercial Case / Opportunity analysis

Field-by-field audit of `crm_opportunities` against the target Durable Commercial Case shape:

| Field | Status | Note |
|---|---|---|
| caseId-equivalent identity | **PRESENT** | `id` PK + `opportunity_key` UNIQUE |
| customer | **PRESENT** (provisional, per project rule) | `customer_master_id`/`customer_candidate_id`/`wa_id` |
| status/lifecycle | **PARTIAL** | 14-state enum, but no `expired` status anywhere; "blocked" is only a boolean, not a lifecycle state |
| primaryObjective | **PARTIAL** | One flat enum value, not a structured objective — the real structured objective lives on the sibling `crm_commercial_work_objectives` |
| subgoal | **MISSING** | Exists only on the sibling `crm_commercial_work_steps` |
| cart | **MISSING as a first-class field** | Smuggled into `crm_request_facts` via a synthetic `opportunity:<id>` string key, explicitly bypassing the "non-canonical" request runtime |
| destination | **MISSING as a first-class field** | Same pattern |
| shipping (selected) | **MISSING as a first-class field** | Same pattern |
| quote | **PARTIAL** | `crm_quotes.opportunity_id` is nullable; the quote's true scope is `request_id` |
| order | **MISSING** | No order entity/table exists from a won opportunity anywhere; only read-only legacy lookups for identity purposes |
| unresolvedRequirements | **PRESENT** | `missing_requirements_json` |
| supersededFacts | **PARTIAL** | Not on Opportunity itself, but the anchored fact rows do carry real supersession semantics |
| blockingReasons | **MISSING as structured data** | Only a boolean `ai_blocked`; structured `block_reasons_json`/`blockers_json` exist only on sibling tables |
| stateVersion | **PRESENT** | Real `version` column, CAS-enforced |
| createdAt/updatedAt/completedAt | **PRESENT, completedAt conflated** | One generic `closed_at` shared by won/lost/cancelled/archived; `wonAt`/`lostAt` fields exist in the type system but are **never written or read anywhere** (dead field) |

**Lifecycle**: cancellation is real; **expiry does not exist**; **reopen is not supported** — a terminal opportunity is never reopened, instead a new sequentially-numbered opportunity is minted for the same conversation (so conversation:opportunity is effectively 1:N over time, not 1:1). Multiple simultaneous non-terminal opportunities per customer are **not prevented** (no unique constraint on `customer_master_id`). The conversation link (`conversation_case_id`) has **no DB foreign key** — unlike `agent_sessions.conversation_id`, which has a real FK + unique constraint. Opportunity's "one active per conversation" invariant is application-level only (an advisory lock), materially weaker than AgentSession's DB-enforced guarantee.

**Recommendation**: **Opportunity should not become the Durable Commercial Case as-is, and a brand-new aggregate is not warranted either — `crm_commercial_work` already is the closer candidate and should mature into that role, with Opportunity demoted to (or kept as) a thin customer-facing summary/read-model.** Opportunity keeps its two hardest-to-rebuild primitives (durable identity, real CAS) but its actual field set is thin and stale relative to the target shape, while `crm_commercial_work` (+objectives+steps) already has status/version/blockers/objectives/supersession much closer to spec, has a nullable FK to Opportunity, and is checked *before* the Opportunity-adjacent multi-request path in cycle routing. This recommendation is directional: `crm_commercial_work` is currently allowlist-gated, not universal (confirmed in §2) — closing that gap is itself the first migration step, not a prerequisite finding.

---

## 6. State ownership matrix

The most load-bearing table in this audit. Classification legend: **PERSIST** (correctly durable) / **DERIVE** (should stay computed, currently is) / **CACHE** (safe to lose) / **EPHEMERAL** (transient by design) / **DEPRECATE** (candidate for removal, not confirmed unused).

| State | Owner | Durable? | Source of Truth | Classification | Risk |
|---|---|---|---|---|---|
| `crm_request_facts` (versioned fact store) | `request-facts/repository.ts` (017) | Yes | Itself | PERSIST | Low — clean event-sourced-per-key design |
| `commercialLineItems` (cart) | `lib/domains/commercial-line-items/*` | Yes, via facts | crm_request_facts | PERSIST | **Medium** — full-replacement means no discrete "what changed" event |
| `shippingDestination` | `lib/domains/shipping-destination/*` | Yes, via facts | crm_request_facts | PERSIST | Low |
| Selected shipping option | `lib/domains/selected-shipping-option/*` | Yes, via facts | crm_request_facts | PERSIST | Low — has explicit freshness check |
| `latestShippingQuote` | `resolveLatestShippingQuoteContext.ts` | No, recomputed | `crm_capability_executions` | DERIVE | Low |
| `recentCatalogContext` | `agent-loop/recentCatalogContext.ts` | No, recomputed (24h window) | `crm_capability_executions` | DERIVE | Low |
| `pendingCatalogAction` | `agent-loop/pendingCatalogAction.ts` | No, recomputed | `commercial_event` | DERIVE | Low |
| `pendingCommercialIntents` | `multi-intent/pendingIntentState.ts` | Yes, via facts | crm_request_facts | PERSIST | Low |
| Quote (`crm_quotes`) | `quotes/*` (020) | Yes | Itself | PERSIST | Low |
| Persistent agent session | `agent-session/*` (033/034) | Yes (events) / Derive (summary) | `agent_session_events` | PERSIST/DERIVE | Low — module explicitly never a second source of business truth |
| Compacted session prefix | `agent_sessions.compacted_prefix_json` (034) | Yes | Itself, derived once | CACHE | Low |
| `conversationContinuity` | `agent-loop/conversationContinuity.ts` | No, by explicit design | Historical messages this turn | EPHEMERAL | None |
| `commercialContextSummary` | Prompt-assembly call sites | No | DB reads | EPHEMERAL | Low |
| `commercialObjective`/`nextBestAction`/`waitingFor` (**turn-level**) | `continuity/salesTurnDisposition.ts` | No (descriptive audit copy only) | `crm_agent_actions`/`crm_opportunities` are the real authority | EPHEMERAL + audit DERIVE | **Medium — name collision** with the row below |
| `waiting_for`/`next_action_type` (**opportunity-level**) | `crm_opportunities` columns (004) | Yes, mutable | Itself | PERSIST, but **legacy pattern** | **High** — no event log to replay from if the row is corrupted |
| Opportunity identity/status/stage (whole row) | migration 004 | Yes | Itself | PERSIST (structural anchor) | **High** — FK anchor for ~8 other tables; cannot be deleted, only superseded |
| CommercialWork aggregate | `work/*` (029-031) | Yes | Re-derived every turn from facts+executions+events, then persisted | DERIVE-with-durable-tracking hybrid | Medium — losing a row mid-retry is safe for business truth but resets in-flight lease/attempt state |
| TurnPlan (`crm_turn_plans`) | 016 | Yes | Itself | PERSIST (idempotency cache) | Low |
| ConversationRequest + `crm_request_events` | 015 | Yes | Itself + append-only event log | PERSIST | Low for the log; Medium because this whole runtime's prod status is unconfirmed |
| Follow-up schedule/state | `crm_agent_actions` (005/013/027) | Yes, mutable | Itself | PERSIST | Medium — migration 027 documents a real historical bug class (permanently-unreachable rows); now guarded by a unique constraint |
| Customer identity (canonical) | `master_customer`, `customer_external_identity` | Yes | Itself | PERSIST | High if lost — canonical anchor |
| Customer identity evidence | 032 | Yes, supersede pattern | Itself | PERSIST | Low |
| `crm_sales_need_profiles` (legacy P1M) | 009 | Yes | Itself | PERSIST but **overlaps** `CommercialObjectiveInputs` conceptually | Medium — legacy engine disabled by default but still has live call sites |
| `crm_customer_onboarding` (legacy) | 007 | Yes | Itself | Likely superseded by 023 per that migration's own header | Medium — not confirmed zero live callers |
| `crm_customer_onboarding_state` (canonical) | 023 | Yes, single row per conversation | Itself | PERSIST | Medium — **no transition history by declared scope**, a correction/retry sequence cannot be reconstructed |
| Escalation/handoff state | 019 | Yes, full history | Itself | PERSIST | Low — well-designed |
| Inbound turn settlement | 035/036 | Yes (crash-recovery only) | Itself | EPHEMERAL by design, durable in practice | Low — acknowledged debt: no retry cap |
| Capability execution audit | `crm_capability_executions` (022) | Yes, append-only | Itself | PERSIST | Low — the real backbone letting several DERIVE projections stay stateless |
| `commercial_event` (011) | Yes, append-only | Itself | PERSIST | Low for safety; **Medium for governance** — one closed enum now serves ~20 unrelated concerns |
| Outbound delivery state | `brain_message_outbox` (003/014), `crm_action_outcomes` (013/025) | Yes | Itself | PERSIST | Low — clean documented state machine |
| Customer addresses | 018 | Yes | Itself | PERSIST | Low |

---

## 7. Event model

**Verdict: partial.** Three separate append-only event logs exist at three granularities — none sufficient alone:

1. `commercial_event` (011) — cross-cutting technical/audit log, ~20 event types, explicitly "descriptive, never authoritative" for most. Reads are narrow (single-row lookbacks), except a capped 120-row Customer 360 timeline read.
2. `crm_request_events` (015) — per-request append-only log with a genuine full-replay read (`ORDER BY occurred_at ASC`). Closest match to the candidate taxonomy below, but belongs to the multi-request runtime whose production traffic share is unconfirmed.
3. `agent_session_events` (033) — per-session log, explicitly scoped to conversational memory only, never business truth.

**No single log lets you reconstruct a case's full history**, because which log gets written depends on which of the five runtimes handled a turn — and the legacy operational-loop path writes **no** event log at all, only mutable rows (plus an append-only decisions table that records decisions, not domain events). `crm_request_facts`/`crm_quotes`/`crm_customer_identity_evidence` independently reinvent the same "versioned, supersede, generated-column single-active-row" pattern three separate times — not wrong, but duplicated engineering effort.

### Event taxonomy comparison

| Candidate Event | Status | Real name | Notes |
|---|---|---|---|
| CASE_OPENED | EQUIVALENT | `request_created`/`request_detected`, or implicit row INSERT | |
| OBJECTIVE_SET | EQUIVALENT | `crm_commercial_work_objectives` row insert | No discrete event fired |
| OBJECTIVE_COMPLETED | EQUIVALENT | `completed_at` + `status='COMPLETED'` (mutable) | |
| PRODUCT_ADDED / REMOVED / REPLACED | **MISSING** | — | `select_products` FULL_REPLACEMENT means no incremental diff is ever emitted |
| QUANTITY_CHANGED | **MISSING** | — | Same reason; `CHANGE_QUANTITY` objective type exists with no backing capability at all |
| DESTINATION_SET | EXISTS | `address_selected`/`address_confirmed` | |
| SHIPPING_CALCULATED | EQUIVALENT | `crm_capability_executions` row for `calculate_shipping` | |
| SHIPPING_SELECTED | EQUIVALENT | `selected_shipping_option` fact write | |
| QUOTE_CREATED | EXISTS | `quote_created` + `crm_quotes` insert | |
| QUOTE_ISSUED | EQUIVALENT | Not a distinct step in this domain model | |
| QUOTE_SENT | EXISTS | `quote_sent` + `markQuoteSent` | |
| CUSTOMER_CORRECTION | EQUIVALENT | Implicit via fact supersede/`status='rejected'` | No discrete event type |
| CUSTOMER_CANCELLED | EXISTS | `request_cancelled` | |
| CASE_BLOCKED | EQUIVALENT | `CommercialWorkBlocker` records (richer than a flat event) | |
| CASE_COMPLETED | EXISTS | `request_resolved` / `crm_commercial_work.status='COMPLETED'` | |
| HUMAN_HANDOFF | EXISTS | `human_escalation_created` + `crm_request_escalations` table | Richer than an event |

---

## 8. State reducer / invariants

| Invariant | Status |
|---|---|
| Latest explicit correction wins | **HELD** — every durable fact is versioned via a supersede+insert transaction with a DB-enforced single-active-row constraint |
| Destination change invalidates shipping | **PARTIALLY HELD** — only at pick-time (`select_shipping_option` rejects if `destinationFactId` is stale); an *already-persisted* selection is never retroactively invalidated when destination later changes |
| Cart change invalidates shipping-derived state | **NOT ENFORCED** — same shape; freshness is only checked lazily at pick-time, never as a write-time cascade |
| Quote tied to exact cart/state version | **HELD at create, VIOLATED at issue** — `create_quote`'s idempotency key is genuinely tied to `selectionFactId`; `issue_quote` has **no** comparison to current cart state at all |
| Confirmed products cannot disappear implicitly | **VIOLATED** — the known `select_products` FULL_REPLACEMENT bug |
| Resolved facts cannot be re-asked without contradiction | **HELD**, with the caveat that "contradiction" is handled purely by overwrite (last value wins), never a distinct confirm-the-contradiction flow — a reasonable design choice, not a gap |

**Capability semantics** (full table condensed):

| Capability | Writes | Idempotent | Concurrency-safe |
|---|---|---|---|
| `select_products` | **FULL_REPLACEMENT** of cart fact | Yes for identical repeat | **No CAS** — concurrent calls can lose updates |
| `set_shipping_destination` | Full replace, single scalar | Yes, no-op on same value | Safe — last-write-wins is the intended semantics |
| `calculate_shipping` | None (pure read + ephemeral evidence anchors) | Naturally idempotent | Safe |
| `select_shipping_option` | Full replace, single scalar | Yes | Gate exists (freshness) but only checked at pick-time |
| `create_quote` | Fact + external Quote Service | **Real SHA-256 idempotency key** | Mostly safe — concurrent duplicates share the key, loser gets a retryable conflict |
| `issue_quote` | External quote status via CAS `expectedVersion` | Yes for repeat calls | Safe against a second issue; **stale relative to cart** (no freshness check) |
| `send_quote_email` | External delivery request | **Real idempotency key** `(quoteId, recipient)` | Safe |

**Cross-cutting**: the capability-gateway dispatch entry point has **no opportunity-level lock**; all concurrency safety is pushed down per-capability, unevenly.

**Cart/product state**: line items are flat — `{productId, combinationId, quantity}`, no per-item confirmed/tentative status, no persisted provenance (evidence grounding happens upstream and is not recorded alongside the item). The objective taxonomy already anticipates patch-style semantics (`CHANGE_QUANTITY` exists as a type) but **no `add_product`/`remove_product`/`update_quantity`/`set_cart` capability exists anywhere** — zero matches repo-wide.

**Objective management**: cleanly decomposed, not conflated — `CommercialObjective.type` (primary objective), `CommercialObjectiveStatus` with an explicit transition table (subgoal/lifecycle), `CommercialWorkBlocker` (blocker, typed enum), waiting state (status value + a separate follow-up-eligibility subsystem), and completion criteria always keyed off durable evidence. **Confirmed: "gracias" does not clear `CREATE_QUOTE`.** A pure closing remark produces zero new objective seeds (filtered by the intent taxonomy), and `reconcileCommercialObjectives` carries forward every non-terminal prior objective unchanged. This is corroborated by an existing benchmark fixture that explicitly tests this exact case. Objectives are only cleared by explicit typed events: a classified `cancel` intent, supersession by a same-family objective, durable-evidence completion, or `human_owner_active`/`ai_disabled`.

**Unresolved cross-check flagged**: a separate, keyword-substring-based opportunity-stage engine (`sales-consultative/engine.ts`, matching phrases like `"ya no"`/`"cancelar"` to close an opportunity as `lost`) appears referenced from inbound-handling code, entirely disconnected from the `CommercialObjective` state machine. This closely resembles the keyword-routing incident `docs/PRODUCT_NORTH_STAR.md` names as already fixed "hasta ACS-R1-05.1-T01" and one research pass found the specific legacy entry point (`processSalesInbound`) explicitly marked dead code with zero callers — but another pass found `sales-consultative` invoked from a live inbound path. **Not resolved in this audit; see §27.**

---

## 9. Memory architecture

| Category | Owner | Durable? | Mixing? |
|---|---|---|---|
| Factual/business (products, destination, shipping, quote, identity) | `crm_request_facts` + domain wrappers | Yes | **None found** — explicit code comments state facts are "rehydrated fresh... never inferred from recentMessages or a prior turn's tool observation" |
| Episodic (what happened, corrections, failures) | `agent_session_events`, `commercial_event`, `crm_agent_actions` | Yes | None — event payloads never carry message text |
| Conversational (transcript, tone, referents) | `conversation_message`, capped read (20 rows, hard cap 100; legacy fallback: last 5) | Durable at the row level, **lossy in the prompt** | Borderline case (`pendingCatalogAction`) correctly engineered to read from an event, not the transcript |
| Semantic/customer (purchase history, RFM) | External PrestaShop source, shaped by `customer-profile-context/summary.ts` | Durable (external system of record) | None — prompt rules explicitly forbid the model deriving RFM itself |
| Ephemeral cognition (temp plan, candidate action) | `RecentCatalogContext` (24h window), per-turn multi-intent plan | Mostly ephemeral by design | None found |

**Overall verdict**: better than typical — the team has visibly already fought this problem (explicit "never derived from transcript" comments at multiple call sites, an explicit content firewall in the compaction pipeline banning business facts from summaries). **The one real gap is silent truncation, not mixing**: conversational memory beyond ~20 messages (5 in the legacy fallback) has no compensating summary today, because the fully-built compaction pipeline (migration 034) is **disabled by default**.

---

## 10. Session / harness analysis

| Property | Status |
|---|---|
| Durable session | **PRESENT** — `agent_sessions`, 1:1 with conversation via a real DB unique constraint |
| Resumability | **PRESENT** for session/event log; **PARTIAL** for mid-turn state — a turn's own tool-loop progress is a local JS array, not reconstructed if the process dies mid-loop |
| Event log | **PRESENT** — append-only, monotonic `seq`, dedupe key |
| Selective context retrieval | **PRESENT** — bounded reads everywhere (20/100 events, 20/100 transcript, 5/12 catalog) |
| Compaction | **PARTIAL — built but disabled by default** (`BRAIN_R3_SESSION_COMPACTION_ENABLED=false`) |
| Interrupted-turn recovery | **MISSING** — tool-activity events are written only *after* the whole loop finishes, not per-step; a mid-turn crash leaves no durable trace beyond the pre-loop marker |
| Tool observations retained | **PARTIAL** — retained within one turn; durably logged only as coarse markers (never the observation payload); a function built to replay them into a future prompt has **zero real consumer today** |
| State reconstruction from durable state | **PRESENT** for business state; **MISSING** for cognition/plan |
| Deterministic state outside model context | **PRESENT** — tools read durable tables directly, independent of prompt content |

### The "delete transcript" test

**Mostly passes.** Shipping destination, cart/line items, opportunity stage/need-profile, and shipping-quote evidence are all confirmed structured fields sourced from durable tables, never re-derived from `recentMessages`. What would genuinely be lost: `conversationContinuity` (defaults safely to "unknown"), and any customer statement not yet promoted into a structured fact (a stated preference, an objection not yet acted on) — this is expected, appropriately-scoped conversational memory, not a correctness gap.

**Important scope caveat found**: the harness properties above (durable session, compaction, persistent cognition) only apply to the **wa_id-allowlisted SalesAgentRuntime/R3 path**, default off globally. The legacy default path (`runNativeAgentToolLoopCycle`) has a materially thinner memory story — 5-message inline history, no session-cognition read at all.

---

## 11. Capability contracts

**Critical finding: three parallel capability/tool-execution surfaces coexist in production, not one.**

1. **Capability Gateway** (governed) — 21 capabilities, identity-gated, every execution audited to `crm_capability_executions` via one chokepoint function (`executeGovernedCapability`, 11 call sites, all confirmed to funnel through it).
2. **Multi-request `READ_CAPABILITY_REGISTRY`** (9 capabilities) — a structurally separate, **live-wired** registry with its own execution function, **no identity gate, no audit row at all**, and different backends for same-named capabilities (`search_products` here hits direct PrestaShop SQL, not the Catalog microservice the Gateway version uses). Its type system explicitly supports mutation-risk capabilities in this same ungoverned registry — this is provisioned for, not a today-only theoretical concern.
3. **Legacy `SalesAgentToolName` policy layer** — a third, older tool vocabulary where every tool except `searchProducts` has no Gateway mapping, so the legacy policy layer **trusts the LLM's own self-reported blocking flag** for those.

### Capability Gateway matrix (21 capabilities, condensed)

| Capability | Preconditions | Idempotent | Notes |
|---|---|---|---|
| `search_products`, `get_product_details`, `batch_get_products`, `explore_catalog`, `search_products_by_semantics`, `search_company_knowledge`, `recommend_catalog_products` | read_only, no identity gate | Yes (pure reads) | |
| `resolve_customer`, `create_customer`, `link_external_identity`, `link_prestashop_identity` | Identity-self-governed, own inline authority checks | Domain-level dedupe only, **no gateway idempotency key** | |
| `set_shipping_destination` | Mutating, identity NONE | Yes (full replace) | |
| `select_products` | Mutating, identity NONE; evidence-grounding enforced *upstream*, not inside | Yes (full overwrite) | **FULL_REPLACEMENT** |
| `calculate_shipping` | Classified read_only despite the name (persists nothing) | Yes | |
| `select_shipping_option` | Mutating; evidence + **freshness gate inside the capability** | Yes | Deliberately different, better pattern than `issue_quote` |
| `create_quote` | Mutating, `LEVEL_2_MASTER_RESOLVED` | **Yes — real SHA-256 idempotency key + reuse-on-same-selection** | |
| `get_quote` | read_only | Yes | |
| `issue_quote` | Mutating, `LEVEL_2` | **Yes — real idempotency key** | No cart-freshness check (§8) |
| `send_quote_email` | Mutating, `LEVEL_2` | **Yes — real idempotency key** | |
| `get_customer_purchase_history`, `get_customer_recommendation_signal` | read_only, `LEVEL_3_PRESTASHOP_LINKED`, **NOT_AGENT_EXPOSED by design** | Yes | Only CommercialWork's deterministic executor calls these — a third, deliberate exposure category alongside READ_TOOL/COMMERCIAL_ACTION |

**Can a non-LLM caller (Hub UI, Voice Agent, internal API) use a capability today?** **Yes, structurally.** `executeGovernedCapability(capabilityName, input, context)` takes a plain string, a plain object, and a small typed context (`{correlationId, conversationId?, opportunityId?, trustedCustomerSession?}`) — no LLM message, no transcript. The LLM tool loop is proven to be just one caller that happens to assemble this typed request; nothing in any capability's `execute()` body depends on it being that caller. Caveat: `inputSchema` is advisory-only, never enforced by the Gateway itself — a non-LLM caller gets no free schema validation.

**Is there one real chokepoint?** For the governed Gateway, yes. But the **multi-request bypass is a confirmed, production-wired exception** — real, tested, live-routed, not dead code.

---

## 12. Turn/settlement and concurrency analysis

- **Message-A/message-B race**: cannot happen within a conversation. `claimPendingTurn` is a CAS UPDATE with a `NOT EXISTS` subquery that refuses to claim a turn while any sibling row for the same `conversation_id` is `PROCESSING`. A second inbound message either extends the in-flight turn's window or opens an un-claimable PENDING row that the in-flight turn may assimilate directly (`checkForNewInbound` + `reconcileAssimilatedSiblings`). This is deliberate, documented mutual exclusion.
- **`crm_commercial_work` has a real optimistic-concurrency `version` column**, CAS-checked on every update, with `affectedRows<=0` as a second guard.
- **Step-level parallel execution is deliberately narrow** (`buildSafeExecutionWave`/`parallelStepConflictModel`): a mutating primary step never gets parallel siblings; conflicts are checked via an exhaustive hand-typed fact-profile table. Default is sequential.
- **Per-conversation trigger sequencing** uses a real MySQL advisory lock (`GET_LOCK`) plus `SELECT ... FOR UPDATE`, with bounded deadlock retry.
- **Crash recovery**: a crash mid-turn leaves the turn-settlement row stuck `PROCESSING`; a later tick (any instance) detects staleness by `updated_at` age and re-claims via CAS re-verification. Step-level work has an independent, finer-grained lease (`lock_owner`/`lock_until`) any worker can reclaim once expired. The **only** state genuinely lost on a crash is the LLM's in-flight reasoning trace for that turn — the whole turn re-runs from durable facts, and mutating capabilities are individually idempotent, so a crash costs re-work/latency, not data corruption.
- **Idempotency is real, not assumed**, for quote creation/issuance/email and WhatsApp send — all via deterministic keys, confirmed at file:line — with `INSERT IGNORE` against a UNIQUE `dedupe_key` chosen explicitly over check-then-insert because that pattern "cannot rule out" a concurrent-writer race. Order creation has no code path yet (N/A, not unprotected).
- **Scalability**: the turn-settlement claim and CommercialWork step claim are both single atomic SQL statements with no in-memory locks or process-local state — running N instances of either worker is safe by construction. The one serialization primitive (`GET_LOCK`) is DB-level, correct across any number of app instances.

---

## 13. Observability, security, and privacy

- **No structured logger anywhere** in the repo (no pino/winston; sparse `console.log`/`warn`/`error`). Practically, the durable audit-trail tables (`crm_capability_executions`, `crm_commercial_work_steps.evidence_json`) are the real diagnostic surface, not logs.
- **A real correlation id exists** and flows from turn-settlement through the runtime into `crm_capability_executions.correlation_id` — 18+ call sites confirmed. **It breaks at the outbox boundary**: the outbox row uses a different key (`sourceRequestId = inboundMessageId`), so tracing forward from a capability execution to its eventual WhatsApp send requires joining on `conversation_id`/`opportunity_id` instead of one shared trace id.
- **PII redaction is real but narrow**: `redactErrorMessage` (the one shared redaction utility) catches Bearer tokens, API keys, key/token/secret patterns, emails, and 8+-digit phone numbers — pattern-based, will not catch PII embedded in ordinary prose (e.g., a street address in free text). Whether `crm_capability_executions.request_summary_json`/`response_summary_json` are actually redacted before write (per `docs/ACTIVE_RELEASE.md`'s claim) was **not independently confirmed** against the summary-construction code — flagged unverified, not asserted either way.
- **Access control on conversation reads is coarse**: gated by "any authenticated operator," no per-customer/per-owner ACL found.
- **New from production recon**: three stray untracked `.env.*` backup files (`.env.save`, `.env.save.1`, `.env.backup-20260812-010958`) sit on the production filesystem alongside the live `.env`, correctly permissioned (600) but never cleaned up — secret-sprawl hygiene debt, not an active leak.

---

## 14. Follow-up architecture

The existing `docs/audits/follow-up-runtime-reconciliation.md` (July) is now materially stale — most of its P0 findings are resolved:

- **Resolved**: hardcoded attempt/max/policy values now derive from the real plan; stale-executing lock recovery and failed-retry now exist; `cancelFollowUp` now has an explicit status precondition; opt-out is real, transactional, and fail-closed, checked independently at two layers (contradicts the July doc's "missing" verdict).
- **Architecturally changed since that doc**: the worker no longer re-enters full cognition with a fabricated customer message — it revalidates a fixed signal set and dispatches the message drafted at scheduling time. It always continues the same case, never a new conversation.
- **Two new, current findings**:
  1. **The dispatch policy fails closed to "deny persistence entirely"** when `BRAIN_COMMERCIAL_POLICY_ENABLED=false` — the documented default. Under default config, **no follow-up row is ever created at all.** (Production's actual flag value was not re-verified this session.)
  2. **No execution fallback exists.** `runFollowupTick`'s only production caller is the stopped `scripts/autonomous-followup-worker.ts` process — unlike the outbox worker, which has an HTTP route as backup. With `crm-followup` stopped in production (confirmed, §2), scheduled follow-ups simply never fire; rows accumulate with no retry/expiry/alerting path.
- Human takeover cancels immediate pending actions atomically but cancels `schedule_followup` only **lazily**, on the worker's next tick — which, combined with the worker being stopped, means a scheduled follow-up survives a human takeover indefinitely today.
- Duplicate prevention (one active row per opportunity) is real and DB-enforced.

---

## 15-16. Multimodal / evidence ingestion — confirmed absent

**MISSING, with no ambiguity.** The webhook captures `messageType` and stores the raw Meta payload, but only ever parses `message.text.body` — any other type (image/audio/video/document/location/contacts) persists with empty text; the content is never interpreted. Repo-wide search for ASR/OCR/vision integration (whisper, tesseract, speech-to-text, computer vision) returned zero matches. A durable "Evidence" concept does exist (`customer-identity-evidence`, migration 032) but it is exclusively about identity-signal provenance (wa_id/phone/email matching) — unrelated to multimodal message content, and should not be conflated with the (missing) attachment-evidence concept this task describes.

## 17. Voice/telephony — confirmed absent, concrete blocker identified

**MISSING** (zero hits for telephony/IVR/TTS). The specific blocker: `turn-settlement/types.ts` bakes `wa_id`/`phone_number_id` as first-class fields and models a turn's content as a single joined text string. Reusing this mechanism for voice would require, at minimum, a channel-neutral identity pair and a non-text fragment model — this is a design fact about working WhatsApp code, not a defect.

## 18. Multichannel identity/case resolution — better foundation than expected

A channel-neutral identity table **already exists**: `master_customer` (provider-agnostic PK) + `customer_external_identity` (`provider`, `identity_type`, `external_id`, unique per provider+external_id) — already used in code with providers `"whatsapp"`, `"prestashop"`, `"meta"`, `"local_ai_sdr"`. **The forward path to multichannel resolution does not require inventing a new `customer_key`** — `master_customer.id` is already the intended, externally-owned target, consistent with the project's stated provisional-identity rule. Resolution into it is deliberately narrow today (only two trusted sources, gated on the externally-paused Customer Service integration) — the gap is population reliability, not the abstraction itself. Most live runtime state (`conversation`, `crm_opportunities`) remains wa_id-keyed, matching the documented provisional posture.

## 19. Human handoff — single shared state, confirmed

**PRESENT and well-built.** `lib/domains/conversations/control.ts` states its own invariant explicitly: the single source of truth (`conversation.ai_enabled`/`human_owner_active`/`status`) is mirrored onto `crm_opportunities`; the operator Hub and the AI runtime read and write the identical columns — no separate/shadow ownership state was found. Taking over atomically cancels pending immediate actions and outbox rows in the same transaction — but, as noted in §14, deliberately excludes `schedule_followup`, caught only lazily. Resuming AI needs no reconciliation step: human and AI messages live in the same `conversation_message` table, and the context builder maps every non-inbound row to the assistant role regardless of sender, so the agent's next turn correctly sees the human's replies. `autonomy-sandbox`, despite its name, is a live shared safety gate imported by real dispatch code, not an isolated simulator.

---

## 20. Production findings (read-only SSH, 2026-09-15)

| Fact | Evidence | Classification |
|---|---|---|
| Deploy is current: `faf88d7`, 0 behind `origin/develop` | `git rev-parse HEAD` on host | PRODUCTION_CONFIRMED |
| `crm-web`, `crm-outbox`, `crm-turn-settle`, `catalog-service`, `customer-profile`, `quote-service` online; `crm-commercial-work`, `crm-followup` stopped | `pm2 jlist` | PRODUCTION_CONFIRMED |
| `crm-commercial-work` stopped is a partial degradation (retry/crash-recovery only), not a full outage, because its main pipeline runs inline in `crm-web` | Cross-referenced against source (§2) + pm2 state | PRODUCTION_CONFIRMED |
| `crm-followup` stopped is a full outage for that feature | Cross-referenced against source (§14: no fallback caller) + pm2 state | PRODUCTION_CONFIRMED |
| `crm-commercial-work`'s own startup log shows `BRAIN_COMMERCIAL_WORK_WORKER_ENABLED=true`, `BRAIN_AUTONOMOUS_RESPONSES_ENABLED=true`, `BRAIN_WHATSAPP_TEST_MODE_ENABLED=true`, `BRAIN_COMMERCIAL_WORK_ASYNC_DELIVERY_ENABLED=true` — obtained from the app's own operational log line, not from reading `.env` | pm2 out-log | PRODUCTION_CONFIRMED |
| `BRAIN_WHATSAPP_TEST_MODE_ENABLED=true` in production is notable and worth operator attention | Same log line | PRODUCTION_CONFIRMED, needs operator judgment |
| `crm-outbox` confirms `metaSendEnabled=true`, `allowRealSend=true` (live sending) | pm2 out-log | PRODUCTION_CONFIRMED |
| `crm-followup`'s out-log is empty (0 lines) despite 20 historical restarts | `wc -l` on log file | MEDIUM CONFIDENCE — plausibly log rotation, not proof the worker never ran |
| `crm-web` runs `next start` against an `output: standalone` build, producing recurring "Failed to find Server Action" errors | pm2 error log | PRODUCTION_CONFIRMED (real, unrelated-to-R3 correctness bug) |
| Three stray untracked `.env.*` backup files on disk alongside the live `.env` | `ls -la .env*` (metadata only, no content read) | PRODUCTION_CONFIRMED |
| Exact `BRAIN_*` allowlist values (which wa_ids route to R3/CommercialWork), and all DB row-level state (event counts, capability-execution samples, session-event samples) | — | **NOT_OBSERVABLE this session** — requires reading `.env`, which is out of bounds per this session's established boundary. `npm run db:status` / `npm run backlog:report` are existing, explicitly no-mutation scripts already in the repo that the operator can run directly to fill this gap |

---

## 21. Gap analysis (synthesis)

| Gap | Severity | Root or secondary |
|---|---|---|
| Five parallel runtimes for the same job | Critical (root) | **Root** — explains the state-ownership, event-model, and capability-surface fragmentation below |
| `select_products` FULL_REPLACEMENT + no CAS | High | Secondary (reducer design, isolated) |
| `issue_quote` no cart-freshness check | High | Secondary |
| Multi-request `READ_CAPABILITY_REGISTRY` bypasses identity gate + audit trail | High | Secondary, but structurally enabled by the multi-runtime split (root) |
| No single case-level event log | High | **Secondary consequence of the root cause** |
| `crm-followup` no execution fallback + fails closed to "never schedule" by default | High | Secondary, operational |
| Opportunity thin relative to target Case shape; `crm_commercial_work` gated, not universal | High | Secondary consequence of root cause |
| Session compaction built but off by default | Medium | Secondary, a flag flip + verification away |
| No `objective`/`executionPolicy` typed contract in the context compiler | Medium | Secondary, additive |
| No structured logger; correlation id breaks at outbox boundary | Medium | Secondary, observability |
| No multimodal/voice support | Expected gap, not a defect | Greenfield |
| `crm-web` standalone/next-start misconfiguration | Medium | Unrelated to R3 architecture, real production bug |

---

## 22. Target architecture

Mapping the task's conceptual pipeline onto what already exists vs. what's net-new:

| Target component | Reuse | Status |
|---|---|---|
| Channel Adapter | `conversation`/`conversation_message` schema | Reusable now; dispatch/outbox layer needs decoupling from WhatsApp literals |
| Case Resolver | `resolveRuntimeOpportunity` + identity resolution | Reusable, needs to route to a single runtime |
| Durable Commercial Case Runtime | **`crm_commercial_work` (+objectives+steps)**, not Opportunity | Reusable, needs to become the universal path (currently allowlist-gated) |
| Event Log | `crm_request_facts` (field-level) + `crm_capability_executions` (execution-level) | Reusable as the two halves of a case-level log; needs one unifying read path across runtimes |
| Objective Manager | `work/objectiveTypes.ts` + `deriveCommercialObjectives.ts` | Reusable, already well-decomposed; needs to stop being one-of-five |
| Concurrency Controller | Turn-settlement CAS/lease + `crm_commercial_work.version` + `sequencing.ts` advisory lock | Reusable, already strong; extend to the cart write path |
| Context Compiler | `buildAgentStepPromptPackage.ts` | Reusable, already centralized; needs typing into the `AgentTurnInput` shape and an `objective`/`executionPolicy` field |
| Agent Harness | `agent_sessions`/`agent_session_events` | Reusable; turn on compaction, wire per-step durable tool-activity events |
| Capability Gateway | `capability-gateway/*` | Reusable, already LLM-independent by construction; must absorb or retire the two bypass surfaces |
| Domain Services | Catalog/Quote/Customer-Profile microservices via thin adapters | Reusable as-is |
| Follow-up Scheduler | `follow-up-planner`/`runFollowupTick` | Reusable; needs a fallback trigger and a default-safe dispatch policy |
| Human Handoff | `conversations/control.ts` | Reusable as-is — already correct |
| Multichannel identity | `master_customer`/`customer_external_identity` | Reusable as-is |
| Evidence Ingestion, Voice Adapter, Multimodal Agent Input | — | **Net-new / greenfield** — nothing to reuse |
| Observability (tracing) | Correlation id in `crm_capability_executions` | Reusable; extend through the outbox boundary |

---

## 23. Migration roadmap

Adjusted from the task's suggested V0-V9 to reflect what this audit actually found (V0 is effectively this document):

- **V1 — Canonical read model.** Pick `crm_commercial_work` as the canonical case aggregate; keep `crm_opportunities` only as an FK anchor + thin read-model (cannot be deleted, ~8 tables reference it). Resolve the `waitingFor`/`nextAction` name collision. No schema deletion, additive only.
- **V2 — Universal case runtime.** Make CommercialWork the only path (retire the priority-ordered runtime selection), starting with new conversations, migrating allowlists gradually. This is the single highest-leverage change — it collapses most of the state/event/capability fragmentation found in §6-§7 without a rewrite, because the target-shaped aggregate already exists.
- **V3 — Reducer/invariant fixes.** Patch-style cart capability (`add_product`/`remove_product`/`update_quantity`), cascade invalidation for destination/cart → shipping, `issue_quote` cart-freshness check. Each is an isolated, testable, small diff — no dependency on V1/V2.
- **V4 — Capability contract hardening.** Route multi-request's 9 capabilities through the governed Gateway (or retire the runtime entirely once V2 lands, since its main reason to exist — a lighter-weight path for simple lookups — disappears once one runtime serves everyone); alias every legacy `SalesAgentToolName` or delete that vocabulary.
- **V5 — Context compiler typing.** Formalize `AgentTurnInput`, add `objective` and `executionPolicy` fields backed by CommercialWork's already-real objective/policy data — additive to the already-centralized `buildAgentStepPromptPackage`.
- **V6 — Harness completion.** Turn on session compaction after verifying it in a full run; make tool-activity events durable per-step, not only post-loop.
- **V7 — Follow-up hardening.** Add an HTTP-route fallback trigger matching the outbox worker's pattern; fix the dispatch-policy default so it doesn't silently disable all scheduling; make human takeover cancel `schedule_followup` atomically, not lazily.
- **V8 — Multichannel.** Decouple `AgentRuntimeEvent`/dispatch/outbox from required WhatsApp fields now that V2-V7 have consolidated the runtime; the identity side (`master_customer`) needs no new work.
- **V9 — Multimodal/voice.** Genuinely greenfield; sequence after the above since evidence ingestion needs a stable case runtime and event log to attach to.
- **V10 — Production benchmark.** See §24-26.

Each phase should ship independently reviewable, with its own acceptance criteria per `AGENTS.md`'s "cambios pequenos y revisables" rule — this roadmap is explicitly not a big-bang rewrite; V2 in particular is a rollout (allowlist expansion), not a code rewrite, since the target aggregate already exists.

---

## 24. Benchmark architecture

Mapping the requested suites to what this audit found is actually testable today, without building new infrastructure first:

- **A. Unit/domain invariants** — directly testable today against `work/buildCommercialWorkProjection.ts` and the capability files in §8; deterministic, no new harness needed.
- **B. State reducer benchmark** (events → expected state) — testable today via `crm_request_facts` fixtures + `buildCommercialWorkProjection.ts`, since that function already re-derives projection from durable facts on every turn.
- **D. Capability execution (clean pre-seeded state)** — this audit's biggest enabler: because Gateway capabilities are confirmed LLM-independent (§11), this suite can call `executeGovernedCapability` directly with fixture contexts, no LLM or full turn cycle required.
- **C/E/F/G/H/I/J/K/L** — all require the runtime-consolidation work in §23 first to have one path to benchmark against; building this suite against all five current runtimes would multiply effort five-fold for no benefit.

---

## 25. E2E scenario corpus

Reusing the task's proposed corpus, each now tied to a confirmed finding this audit can validate a fix against:

- **Corrections** (Training → no, Kong → San Miguel → mejor San Bernardo): directly exercises the confirmed `select_products` FULL_REPLACEMENT bug (§8) — this scenario should fail today and is the acceptance test for the V3 patch-semantics fix.
- **Objective persistence** ("cotízame esto" / "gracias" / "ah y cuánto pesa?"): **already validated** — an existing benchmark fixture (`r3StableAgentV1/corpus.ts`) tests exactly this and expects zero mutation tools fired on the gratitude turn (§8).
- **Follow-up, Day 0 → Day 2, cross-channel**: currently untestable end-to-end because `crm-followup` has no fallback trigger (§14) — this scenario is the acceptance test for the V7 fix.
- **Restart mid-flow** (dies after shipping calculation, resumes, creates quote): testable today against the confirmed CAS/lease recovery machinery in §12 — expected to already pass.
- **Audio/image scenarios**: not executable until V9 (§23) — correctly out of scope until then, not a benchmark gap today.

---

## 26. Release gates

Justified against this audit's actual findings, not generic aspiration:

```
silent product loss = 0            <- directly targets the confirmed select_products bug (§8)
duplicate quote creation = 0       <- already achieved today (real idempotency key, §8/§12)
stale quote issuance = 0           <- NEW gate this audit surfaces; not currently met (issue_quote, §8)
superseded fact revival ~ 0        <- already achieved today (DB-enforced single-active-row, §6)
false commercial confirmation = 0  <- already achieved today for Gateway capabilities; NOT achieved
                                       for the multi-request bypass (§11), which has no audit trail
                                       to even detect a violation
re-greeting active case ~ 0        <- already achieved today (conversationContinuity, §10)
objective loss = 0                 <- already achieved today, confirmed by code path + fixture (§8)
durable-state corruption = 0       <- already achieved today (CAS everywhere except cart write, §12)
recovery success > 99%             <- already achieved today (stale-lease reclaim, §12)
follow-up delivery rate > 0%       <- NEW gate; currently effectively 0% in production (worker
                                       stopped + no fallback + fail-closed default policy, §14/§20)
```

---

## 27. Risks / open questions

1. **Unresolved contradiction**: is the keyword-substring `sales-consultative` engine live from the native WhatsApp inbound path, or fully retired (as one research pass's "dead code, zero callers" finding for `processSalesInbound` suggests)? This matters directly — `docs/PRODUCT_NORTH_STAR.md` names exactly this pattern as a historical incident ("segunda autoridad de escritura no declarada"). Needs a dedicated, narrowly-scoped follow-up read of every call site of `sales-consultative/engine.ts`.
2. **`docs/ACTIVE_RELEASE.md`** states R3's pilot allowlist has zero real customer wa_ids, in tension with the previously-found live `create_quote` benchmark artifact on production. Plausibly explained by the benchmark harness bypassing the allowlist, but not independently re-verified.
3. **Exact `BRAIN_*` allowlist values** (which wa_ids route to which runtime) were not observable this session (`.env` reads are out of bounds by this session's own established boundary) — the operator should run `npm run db:status`/`npm run backlog:report` (both explicitly no-mutation, already in the repo) to close this gap.
4. **Whether `crm_customer_onboarding` (legacy, migration 007) has any reachable production entry point** beyond its one still-live importing module was not fully traced within the research budget.
5. **Whether declared follow-up policy `stopConditions`** (`handoff`, `ai_disabled`, `opportunity_terminal`, `quote_expired_or_superseded`) are actually enforced, beyond the two confirmed ones (`customer_replied`, opt-out) — flagged for a dedicated follow-up-scheduling deep dive.
6. **Whether `crm_capability_executions.request_summary_json`/`response_summary_json` are actually PII-redacted before write** was not independently confirmed against the summary-construction code.
7. **DB row-level state** (actual event counts, capability-execution volume, session-event samples, representative conversation counts) is entirely unverified this session — schema is known from local migrations, but live production data was not queried, by design (credential boundary).

---

## Appendix: files read (representative, not exhaustive)

Full paths are given inline throughout each section above, as produced by each research pass. Key directories covered: `app/api/integrations/whatsapp/webhook/`, `lib/brain/native-whatsapp/`, `lib/brain/commercial/{native-cycle,turn-settlement,continuity,sales-agent-runtime,agent-loop,work,capability-gateway,capabilities,agent-session,context,quotes,quote-assembly,identity,followup,follow-up-planner,operational-loop,multi-request,multi-intent,events,agent-runtime-event,execution-bridge,execution-gate,policy,operator-pilot,autonomy-sandbox,sales-consultative}/`, `lib/domains/{commercial-line-items,shipping-destination,selected-shipping-option,customer-identity,customer-onboarding,conversations,customer-360,customer-identity-evidence,customer-addresses}/`, `lib/brain/messaging/`, all 43 files under `migrations/`, and `docs/{PRODUCT_NORTH_STAR.md,ACTIVE_RELEASE.md,audits/follow-up-runtime-reconciliation.md}`.
