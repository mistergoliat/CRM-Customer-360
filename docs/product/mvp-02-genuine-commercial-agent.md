# MVP-02 — Genuine Commercial Agent

## Mission

Replace the intent-classifier/template-router shape with a real agent: receive a message, understand the goal, retrieve context, plan, call tools, observe results, replan, respond naturally, act, verify, and continue across turns -- until the customer's goal is resolved or a real blocker is hit. Implemented in `lib/brain/commercial/agent-runtime/`; see `docs/architecture/commercial-agent-runtime.md` for the technical design.

## Why this exists

Zenvia's current legacy flow gets ~8% positive CSAT. The first operational goal is not perfection -- it's a materially better, mostly-autonomous resolution rate than that, measured honestly (see Metrics below), not asserted from a demo.

## What "genuine" means here, proven, not claimed

This is not a planner that produces a plan and stops. `tests/commercial-agent/loop.test.ts` and `tests/commercial-agent/evaluation.test.ts` (20 tests, all passing against real persistence) prove an actual end-to-end path: a real inbound WhatsApp-shaped message is persisted through the existing native pipeline, a tool is selected and **executed** (not just requested), its real result is **observed**, the plan can change based on that result, a **durable commercial action** is created (`crm_opportunities`/`crm_agent_actions`, not an `ai_*` trace), and a second turn on the same conversation sees everything the first turn learned.

## Autonomy principle in practice

A request for a human, a complaint, a warranty ask, or emotional language does **not** auto-trigger handoff. Proven directly:

- `"a request to talk to a human does not stop the agent from continuing to help in the same turn"` -- the agent keeps the conversation, asks what's needed, and `state.humanOwnerActive` stays `false`.
- `"a claim/post-sale message is registered as an action, not auto-blocked"` and `"property: a post-sale claim is handled to the real limit (registered, evidence requested) without auto-handoff"` -- the claim is durably recorded and the agent asks for the specific evidence (order number, photo) it needs, without handing off.
- `"an exclusive handoff blocks further durable actions but the conversation stays readable"` -- handoff is reserved for when the agent actually decides it (insistence, real risk, missing capability, policy approval, no progress after real attempts), and even then only blocks *durable_write* tools, not reading/continuing to gather information.

## Autonomy perimeter, as implemented

| Level | Examples in this MVP | Gate |
|---|---|---|
| 0 -- read | `get_customer_context`, `search_products`, `get_product_detail`, `get_related_products` | always allowed |
| 1 -- communication/registration | `request_human_handoff` | always allowed |
| 2 -- reversible commercial actions | `create_or_update_opportunity`, `create_follow_up_action` | allowed within policy; denied under an active exclusive handoff |
| 3 -- high impact | (none registered yet: discounts out of range, refunds, irreversible cancellation, compensation, warranty exceptions) | `capability_unavailable` -- there is no tool to request, by design |

Levels 0-2 are never blocked just because a level-3 action might eventually be relevant to the conversation.

## First vertical: sales, real catalog data

A customer can: write freely, state a need without picking from a menu, get a clarifying question when something needed is missing, get a real product recommendation (price/stock/dimensions only ever sourced from a tool call, never invented -- structurally proven in `"property: no price is stated unless a tool actually returned it"`), refine across alternatives, and leave a durable opportunity. The same infrastructure (loop, tools, policy, state) is what `orders`/`maintenance`/`post_sales`/`customer_service` will plug into next -- no per-scenario flow was hardcoded; the variety comes from the evaluation suite exercising the same general capability differently, not from five different code paths.

## Operability

`GET /api/conversations/:id/agent` exposes, per conversation: goal, known facts, missing information, pending/completed actions, human-owner/handoff state, and a short factual narration per turn (`"Consultó catálogo."`, `"Creó o actualizó una oportunidad comercial."`) -- never the model's raw reasoning.

## Metrics

`computeAgentRuntimeMetrics()` (durable, from `crm_agent_turn`): `autonomousResolutionRate`, `humanTransferRate`, `toolSuccessRate`, `actionSuccessRate`, `groundingFailureRate`, `averageIterationsPerTurn`. `positive_csat_rate`/`recontact_rate`/`conversation_abandonment_rate` need operator or longitudinal data this MVP does not collect yet and are not faked with a proxy.

## Real status, not aspirational

- **Real and tested**: the loop, tool execution, policy gating, durable persistence, idempotency, multi-turn continuity, malformed-output recovery, bounded-iteration safe exit, WhatsApp wiring (flag-gated, proven both off and on-without-credentials), HUB read API, metrics.
- **Real but not yet exercised against a live model**: the HTTP provider. `BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY` are unconfigured in this environment (verified before implementation started) -- a credential blocker, not a code gap. See the QA report for what "real model" verification would require.
- **Not built in this MVP, by scope**: `orders`/`maintenance`/`post_sales` tool sets (the runtime supports them; no tools registered yet), Level-3 actions and their approval workflow, full `CommercialAction` lifecycle wiring for agent-originated actions (durable writes persist directly today), `lib/catalog`/`CatalogService` integration (blocked on AC-CATALOG's own `changes_requested` status, not on this MVP).

## Deployment

Disabled by default (`BRAIN_COMMERCIAL_AGENT_ENABLED=false`). Turning it on without `BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY` is safe (fails closed, inbound still persists). See the handoff for exact deployment steps.
