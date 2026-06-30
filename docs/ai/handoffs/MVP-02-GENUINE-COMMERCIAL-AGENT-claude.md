# MVP-02 — Genuine Commercial Agent — Handoff (Claude)

- **Branch**: `ai/claude/mvp-02-genuine-commercial-agent`
- **Base commit**: `bd19df5162d3c49db81a4cee1cc49877fba04260` (`bd19df5`, "MVP1.0" — merge-base with `develop`, confirmed identical tree to `develop`/`ADRclaude` at task start)
- **Final commit**: `14f567c` (single commit, 31 files, +3086)
- **Worktree**: `C:\Users\Goli\Pesas Chile\CRM-Customer-360-mvp02`

## What this is

A real observe → plan → act → observe loop, not an intent classifier or template router. Full design rationale, component-by-component mapping, and the why-not-extend-the-old-foundation reasoning are in [`docs/architecture/commercial-agent-runtime.md`](../../architecture/commercial-agent-runtime.md) — not duplicated here. Product framing, autonomy-principle proof points, and the autonomy-perimeter table are in [`docs/product/mvp-02-genuine-commercial-agent.md`](../../product/mvp-02-genuine-commercial-agent.md). Full evaluation results and explicit non-coverage are in [`docs/qa/mvp-02-genuine-agent-evaluation.md`](../../qa/mvp-02-genuine-agent-evaluation.md). This document is the integration/deployment handoff, not a fourth copy of the architecture.

## Implemented code (all under `lib/brain/commercial/agent-runtime/`, plus two integration points)

```text
types.ts, state.ts, prompt.ts, loop.ts          -- runtime core + durable state + the loop itself
provider/{types,httpProvider,fakeProvider}.ts   -- real OpenAI-compatible HTTP provider + deterministic test providers
tools/{types,catalog,customer,opportunity,followup,handoff,registry}.ts
policy.ts                                       -- evaluateProposedAction
operationalSummary.ts                           -- HUB-facing read view
metrics.ts                                      -- computeAgentRuntimeMetrics
wireToNativeInbound.ts                          -- flag-gated trigger from native WhatsApp inbound
index.ts                                        -- barrel export

migrations/012_commercial_agent_runtime.sql     -- crm_agent_conversation_state, crm_agent_turn (applied to local DB)
lib/brain/native-whatsapp/service.ts            -- MODIFIED: one flag-gated call at the end of processNativeWhatsAppInbound
app/api/conversations/[id]/agent/route.ts       -- GET, operator-authenticated, returns buildAgentOperationalView()
.env.example                                    -- MODIFIED: BRAIN_COMMERCIAL_AGENT_ENABLED=false documented
```

Tests: `tests/commercial-agent/{loop,evaluation,wireToNativeInbound,operationalSummary,metrics}.test.ts` — 20 tests, all against real local MariaDB persistence, all passing.

## Validation run on this branch before commit

```text
npx tsc --noEmit -p tsconfig.json                 -> clean
npm run lint                                       -> 0 errors, 35 warnings (baseline, no new)
npm run build                                       -> success
npx tsx --test tests/commercial-agent/*.test.ts     -> 20/20 passing
npx tsx --test <full repo suite>                    -> 603/603 passing
```

## Real autonomy level achieved

Levels 0 (read) and 2 (reversible durable writes: opportunity, follow-up) are implemented, tested, and reachable through a real tool call, real policy gate, real persistence. Level 1 (`request_human_handoff`) is implemented and reachable but only ever invoked when the agent itself decides to hand off — never automatically on a human-request/complaint/emotional message (proven by the autonomy-principle tests cited in the product doc). Level 3 (discount-out-of-range, refund, irreversible cancel, compensation, warranty exception) has **no tools registered** — those requests fail closed as `capability_unavailable` rather than being silently allowed or silently faked. This matches the spec's instruction not to invent capabilities the model merely mentions.

## Missing data / not built by scope

- No `orders`/`maintenance`/`post_sales` tools (toolset is typed and selected per-conversation, ready to receive them; sales is the only vertical with real tools).
- No `lib/catalog`/`CatalogService` (ADR-005) integration — that branch (`ai/codex/ac-catalog`) is `changes_requested`, not merged; catalog tools wrap `SalesConsultativeProductRepository` instead, a one-file swap once AC-CATALOG lands.
- No full `AcceptedCommercialDecision -> CommercialAction -> ActionExecution -> ActionOutcome` lifecycle wiring — durable-write tools persist directly through the already-accepted `sales-consultative` repository methods (reusing their existing idempotency keys), not through `action-lifecycle`/`action-queue`. Documented as a deliberate simplification in the architecture doc, with the upgrade path named.
- No CSAT/recontact/abandonment data source exists yet, so those three product metrics are explicitly left uncomputed rather than proxied.

## Real external blocker (the only valid stop condition reached)

`BRAIN_MODEL_API_URL` / `BRAIN_MODEL_API_KEY` are unset in this environment (verified before implementation started, and remain unset now). The HTTP provider (`provider/httpProvider.ts`) is real, complete, and reuses the exact same env-var contract as the existing `runKnowledgeAgent.ts` model call — but it has not been exercised against a live model in this session. Every test and the evaluation suite use `createScriptedAgentProvider`, which proves the runtime's properties (tool execution, policy, persistence, continuity, recovery, bounded iteration) hold for *any* decision sequence a model could produce, not that a specific model will choose well. This is a missing external credential — a valid stopping condition per the task's own criteria — and it blocks only live-model verification, not any part of the implementation, which is complete, integrated, and tested.

## Deployment instructions

1. Apply `migrations/012_commercial_agent_runtime.sql` if not already applied (already run against local dev DB in this session).
2. Set `BRAIN_MODEL_API_URL` / `BRAIN_MODEL_API_KEY` / `BRAIN_MODEL_NAME` (reuses the existing knowledge-agent model contract; do not invent a second one).
3. Set `BRAIN_COMMERCIAL_AGENT_ENABLED=true`. With it `false`/unset (the default), `processNativeWhatsAppInbound` behavior is byte-identical to before this branch.
4. With the flag on and no model configured, the trigger fails closed (`model_not_configured`); inbound messages still persist normally — verified by `tests/commercial-agent/wireToNativeInbound.test.ts`.
5. With the flag on and a model configured, agent responses are staged as `planned` rows in `brain_message_outbox` — actual sending still requires the existing, separately gated `BRAIN_META_SEND_ENABLED` path. No new send surface was created.
6. Operators can read live state via `GET /api/conversations/:id/agent` (existing `requireOperator` auth).

## Suggested next step (not started, flagged for the next session)

Once `BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY` exist, swap `createScriptedAgentProvider` for `createHttpAgentProvider()` in copies of the `evaluation.test.ts` scenarios to get a model-specific (not just runtime-structural) pass, per the "how to extend" section of the QA doc.
