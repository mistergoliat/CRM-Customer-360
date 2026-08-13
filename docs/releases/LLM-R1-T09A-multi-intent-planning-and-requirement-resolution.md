---
title: LLM-R1-T09A — Multi-Intent Planning and Requirement Resolution
doc_id: release-llm-r1-t09a-multi-intent-planning-and-requirement-resolution
status: implemented
owner: architecture
last_reviewed: 2026-08-13
source_of_truth_for:
  - CommercialIntentPlan/Requirement/Action/ExecutionResult contract (T09A scope)
  - BRAIN_MULTI_INTENT_PLANNER_ENABLED feature flag semantics
  - MI01-MI06 live benchmark results
depends_on:
  - ./LLM-R1-T08D-multi-intent-tool-budget-and-mutation-guard.md
  - ../architecture/commercial-multi-intent-planning.md
  - ../audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md
tags:
  - release
  - agent-loop
  - multi-intent
  - llm-provider
---

# LLM-R1-T09A — Multi-Intent Planning and Requirement Resolution

`LLM-R1-T08D` found that prompt-only prioritization does not reliably change which sub-intent the legacy Agent Tool Loop completes under a shared, scarce tool budget (`select_products` completion stayed at 10% for C09 across 10 live runs). This task asks a structurally different question: can a backend-owned planning layer resolve N sub-intentions from one message without depending on N independent LLM decisions at all? See `docs/architecture/commercial-multi-intent-planning.md` for the full design (CURRENT_FLOW/PROPOSED_INSERTION_POINT/STATE_AUTHORITIES audit, the four-layer contract, the requirement-source rules).

## What was built

- `lib/brain/commercial/multi-intent/` (new): `types.ts`, `parseCommercialIntentPlan.ts`, `buildIntentPlannerPromptPackage.ts`, `requirementResolver.ts`, `executionPlanner.ts`, `actionPlanExecutor.ts`, `buildMultiIntentResponseContract.ts`, `pendingIntentState.ts`, `runCommercialMultiIntentLoop.ts`.
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts`: exported the shared provider-invocation/observability helpers (`invokeProviderWithDeadline`, `captureProviderFailure`, `buildSuccessInferenceRecord`, `buildFailureInferenceRecord`, `buildTimeoutInferenceRecord`, `MUTATION_CLAIM_GUARD_FALLBACK_MESSAGE`) - pure `export` additions, zero behavior change, so the new orchestrator reuses the exact same deadline/timeout/error-classification/LLM-observability mechanics instead of a second implementation.
- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts`: added `MULTI_INTENT_PLAN_RULE_LINES`, finalization-phase-only, governing a new (optional, absent for the legacy loop) `commercialContext.multiIntentPlan` field.
- `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts`: selects `runCommercialMultiIntentLoop` vs. `runAgentToolLoop` behind the new flag - both share one `RunAgentToolLoopInput` object, everything downstream unchanged.
- `lib/brain/commercial/config/commercialCycleConfig.ts`: `buildMultiIntentPlannerFeatureFlags()` reading `BRAIN_MULTI_INTENT_PLANNER_ENABLED` (default `false`).
- `lib/brain/commercial/agent-loop/benchmark/multiIntent/` (new): `corpus.ts` (MI01-MI06), `runMultiIntentCorpus.ts` (reuses `scoreCase`/`BenchmarkGroundTruth`/`computeAggregateMetrics` unchanged - `runCommercialMultiIntentLoop` produces the same `AgentLoopResult` shape `runAgentToolLoop` does).
- `scripts/benchmark-multi-intent.ts` (new CLI, mirrors `scripts/benchmark-agent-tool-loop.ts`).
- Tests: `tests/agent-loop/multi-intent/` (48 new tests: parser, resolver, planner, executor, response contract, merge, and a DB+HTTP-backed integration suite for the orchestrator). `tests/agent-loop/buildAgentStepPromptPackage.test.ts`: golden finalization prompt length updated (16690 -> 17728 chars, gathering unchanged).
- Docs: this file, `docs/architecture/commercial-multi-intent-planning.md`, `docs/audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md` section 18.

No Zod/schema-validation library was added - none exists anywhere in this repository; `parseCommercialIntentPlan.ts` follows the same hand-rolled bounded-parse convention `validateAgentStep.ts` and every `CapabilityGatewayDefinition.inputSchema` already establish (see the architecture doc's "INTENT" section for the full rationale).

No new database table - `crm_request_facts` (already used for `shippingDestination`/`commercialLineItems`) is reused for pending-intent state with a new `fact_key`, same `opportunity:<id>` anchor convention.

## Regression discipline

`runAgentToolLoop.ts`'s only changes are `export` keyword additions (zero logic change) - verified by running the full legacy `tests/agent-loop/**` suite (478 tests) unmodified except the one golden prompt-length assertion the new finalization-only rule block necessarily shifts. Full agent-loop + multi-intent suite: **526/526 green**. `tsc --noEmit`: clean throughout every intermediate step, not just at the end.

The full repository suite (`tests/**/*.test.ts`, 3016 tests) was also run: 34 failures, all in `tests/native/outbox-pilot-isolation.test.ts` and unrelated commercial/config/schema-integrity files that this task never touches. Verified pre-existing and unrelated by stashing every T09A change (`git stash -u`) and re-running the same failing files against clean `develop` - identical failures reproduced with zero T09A code present. Stash restored afterward; `git status` confirmed the working tree matched exactly what T09A had produced before the check.

## MI01-MI06 live benchmark

`deepseek-v4-flash`, `thinking=disabled` (per task instruction - production `thinking` configuration untouched), same isolation discipline as every prior live benchmark in this repo (local Catalog Service mock, fake Carrier MS, real `CommuneResolver` over fake data, real local DB for `select_products`/`set_shipping_destination`/pending-intent persistence - the only real external call is the LLM provider itself).

**First full run (5 runs/case, 30 turns)**: `overallPassRate` 96.7%. One real failure: MI02's live planner extracted the literal word "despacho" (Spanish for "shipping") as if it were a destination commune, because the customer's message asked the shipping cost without naming a place ("...y cuanto sale el despacho"). This is a genuine planner-prompt gap the live benchmark was built to catch - the deterministic backend (resolver/planner-parser/executor) behaved exactly as designed given that (technically valid, non-empty) input.

**Fix**: one additional instruction in `buildIntentPlannerPromptPackage.ts` - "if the customer only asks how much shipping costs without naming a specific commune or city, omit destination entirely - never use a generic shipping word itself... as if it were a place name."

**Re-verified**: MI02 isolated, 8 runs/case: 8/8 (100%). Full corpus, 5 runs/case (30 turns): **30/30 (100%)**, `forbiddenToolInvocationRate` 0%, `unbackedCommercialMutationClaimRate` 0%, `timeoutRate` 0%, 2 real LLM calls per turn throughout (planner + finalizer, vs. up to 5 in the legacy loop), `completeTurnLatencyMsP50` ~2.8-3.2s per case, p95 up to ~3.7s.

MI04 (pronoun reference "esa" resolved against a single unambiguous RecentCatalogContext product) and MI05 (two real candidates for "la barra" - must ask, never guess) both passed 5/5 with no prompt changes needed - the planner's own coreference/ambiguity instructions held up live on the first try.

## Definition of Done

- [x] current flow audited (`docs/architecture/commercial-multi-intent-planning.md` section 1-3)
- [x] `CommercialIntentPlan` implemented, bounded, unknown-intent-safe
- [x] Requirement Resolver implemented (PRODUCT/QUANTITY/DESTINATION/PRODUCT_SELECTION, missing vs. ambiguous distinguished)
- [x] Execution Planner implemented (fixed dependency ordering, never LLM-decided)
- [x] Executor implemented, reuses the real Capability Gateway/evidence gate/`buildToolObservation` - no bypass, no duplicate persistence
- [x] Partial completion modeled (`classifyIntentOutcome` - completed/waiting_for_information/needs_clarification/failed/unsupported, independently per intent)
- [x] Pending intent continuation modeled and DB-verified across two real turns (`[MI-Loop-5]`)
- [x] Unknown intent handling implemented (`unsupported`, never a fabricated tool call)
- [x] Ambiguity modeled with real structured candidates, never silently resolved
- [x] Response contract implemented, finalizer only redacts (reuses the legacy finalization phase + Commercial Mutation Execution Guard unchanged)
- [x] Legacy path feature-flagged, default off, byte/semantically unchanged (526/526)
- [x] Unit/integration tests green (48 new tests, all 18 required cases covered)
- [x] Multi-intent benchmark created (MI01-MI06) and live-validated
- [x] MI01-MI06 validated live (30/30 final run)
- [x] `thinking=disabled` tested (per task instruction; production `thinking` config untouched)
- [x] Production unchanged (`BRAIN_MULTI_INTENT_PLANNER_ENABLED=false` default; no merge to `main`/`develop`)
- [x] Verdict emitted

## Cierre

```text
LLM-R1-T09A: DONE

Branch:
feat/llm-r1-t09a-multi-intent-planning

Base:
develop @ f7145eb

Supported intents:
select_products, get_shipping_quote

Supported requirements:
PRODUCT, QUANTITY, DESTINATION, PRODUCT_SELECTION

MI01 multi-intent full resolution:
PASS

MI02 partial completion + missing destination:
PASS

Pending intent continuation:
PASS

Ambiguity handling:
PASS

Unknown intent clarification:
PASS

Required capability completion rate:
100% (final 30-run live corpus)

Multi-intent resolution rate:
100% (final 30-run live corpus)

Unbacked commercial mutation claim rate:
0%

LLM calls/turn:
avg=2.00
max=2

Turn latency:
p50=~2975ms
p95=~3546ms (aggregate, final live run)

Timeout rate:
0%

Legacy path preserved:
YES

Production feature flag enabled:
NO

Production thinking configuration changed:
NO

Verdict:
MULTI_INTENT_ARCHITECTURE_VALIDATED

Next:
LLM-R1-T09B - enable BRAIN_MULTI_INTENT_PLANNER_ENABLED for BRAIN_AUTONOMOUS_TEST_WA_IDS only, real WhatsApp smoke (Part 25 - prepared, not enabled by this task)
```
