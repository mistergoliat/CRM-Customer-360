---
title: LLM-R1-T08D — Multi-Intent Tool Budget Audit and Commercial Mutation Execution Guard
doc_id: release-llm-r1-t08d-multi-intent-tool-budget-and-mutation-guard
status: implemented_partial
owner: architecture
last_reviewed: 2026-08-13
source_of_truth_for:
  - C09 root cause (tool prioritization, not budget or get_product_details necessity)
  - the Commercial Mutation Execution Guard (runtime, fail-closed)
  - why thinking=disabled remains not production-viable without further work (C09's completion gap)
depends_on:
  - ./LLM-R1-T08C-nonthinking-tool-execution-repair.md
  - ../audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md
tags:
  - release
  - agent-loop
  - llm-provider
  - reliability
  - runtime-guard
---

# LLM-R1-T08D — Multi-Intent Tool Budget Audit and Commercial Mutation Execution Guard

`LLM-R1-T08C`'s prompt-only fix fully resolved C02/C04 but left C09 unchanged (0% `select_products` completion, 100% unbacked claims) - a multi-intent, tool-budget-constrained case. This task determines the real root cause and adds the runtime safety net the task always required regardless of outcome: a Commercial Mutation Execution Guard.

## Parte 1-4: reconstruction and root cause (read the runtime, not just benchmark output)

Reconstructed from code, not assumed:

- **`maxToolExecutions=2` rationale** (`runAgentToolLoop.ts:60-61`): introduced once (commit `fd7c78f`), never revisited for its magnitude. No doc ties the number 2 to a specific cost/latency calculation. Independent from `maxDecisions=3` - the gathering loop exits the instant *either* counter is exhausted (`while (decisionIndex < maxDecisions && toolExecutionCount < maxToolExecutions)`, line 634). A call rejected before real work (`invalid_arguments`) never consumes `maxToolExecutions`, only `maxDecisions` - unrelated to this task's question.
- **C09's own `groundTruth`** (`tests/fixtures/agent-loop-benchmark/corpus.ts:181-189`) requires **only** `select_products` this turn - `set_shipping_destination`/`calculate_shipping` are explicitly, by design, deferred to a follow-up turn ("`LLM-R1-T05` Parte E"). The case's own `offlineScript` is `get_product_details → select_products → respond` - exactly 2 tool executions, fitting the existing budget. **The budget was never the constraint by design.**
- **`get_product_details` necessity, verified against the real evidence gate** (`resolveObservedRecommendationSourceProduct.ts`, called from `runAgentToolLoop.ts`'s `processUseToolStep` for `select_products`): `collectHistoricalEvidence` accepts `recentCatalogContext.interactions` from **any prior turn** as valid evidence - C09's fixture seeds exactly this (`PRODUCT_31_EVIDENCE` via a `search_products` interaction). `select_products({productId:"31"})` would pass the evidence gate with **zero** tool calls this turn. Classification: **CONTEXT_DEPENDENT in general, REDUNDANT for C09 specifically** - the model calls it anyway because `buildAgentStepPromptPackage.ts`'s `RECENT_CATALOG_CONTEXT_RULE_LINES` recommends verifying current price/stock before answering commercially (a legitimate rule for other cases, not a gate requirement here).
- **Prior consideration of a budget increase**: already evaluated and explicitly deferred as "Bounded Action Plan" (`docs/audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md` §13, `docs/audits/SALES-AGENT-LLM-END-TO-END-LATENCY-AUDIT.md` §11) - classified `FUTURE_OPTIMIZATION` because C09's original (thinking-enabled) bottleneck was diagnosed as **response length per round**, not **number of rounds**. No prior doc proposed simply raising `maxToolExecutions` to 3 as a standalone fix.

**Conclusion**: `maxToolExecutions=2` is sufficient by the corpus's own design; `get_product_details` is redundant for C09; the real defect is **(C) tool prioritization** - given a shared budget across two visible sub-intents (a confirmed selection + a shipping question), the model spends both slots on *reads* (`get_product_details` verification + `set_shipping_destination` for the secondary intent) instead of completing the one *mutation* (`select_products`) the customer unambiguously confirmed.

## Parte 6: strategy selected - Option A (no budget change)

`maxToolExecutions` stays **2**. Added one new gathering-only prompt rule (`buildAgentStepPromptPackage.ts`, inserted after `SELECT_PRODUCTS_RULE_LINES`, deliberately never added to the finalization suffix since prioritization is only a live decision while tools are offered):

> "When the customer's message asks for more than one thing and completing all of them would need more tool calls than you have left this turn, prioritize the tool that commits what they explicitly confirmed (e.g. select_products for a stated product and quantity) over a tool that only prepares or answers a secondary request in the same message (e.g. set_shipping_destination, or get_product_details used only to re-verify a product you can already identify) - finish the confirmed commitment first, then offer to continue with the rest next."

A new unit test (`[T08D-3]`, `tests/agent-loop/runAgentToolLoop.test.ts`) confirms mechanically that a model following this priority (get_product_details + select_products, skipping the shipping sub-intent) completes cleanly within the unchanged budget of 2 - the runtime never was the blocker.

## Parte 5: Commercial Mutation Execution Guard (mandatory, implemented regardless of Option A's outcome)

New invariant, enforced in `runAgentToolLoop.ts`'s `respondedResult` - the single choke point both gathering's and finalization's `respond` branches already funnel through, so the guard applies uniformly to both phases with no duplicated logic:

> A response can never claim a product selection/quantity/order is done unless this turn's own steps show a `select_products` observation actually completing it (`status: "completed"`, `data.status: "selected"`).

Implementation, matching the task's explicit preferences:

- **Structural evidence, never regex, for `backed`**: `loop.steps.some(record => record.step.type === "use_tool" && record.step.tool === "select_products" && record.observation?.status === "completed")`.
- **Regex used only as a last resort, and only to decide `claimed`** (does the message read as a completion statement at all) - reuses `checkUnbackedCommercialMutationClaim` (relocated from `benchmark/` to `lib/brain/commercial/agent-loop/commercialMutationClaims.ts`, since it is now genuinely shared between the benchmark harness and this real runtime guard, not benchmark-only).
- **Fail closed, no invented persistence, existing terminal reason reused**: when `unbacked` (`claimed && !backed`), the model's own `message` **and** any `pendingCatalogAction` it attached are both discarded (once one claim in a step is untrusted, nothing else in that step is selectively trusted), replaced by a fixed, honest, backend-authored fallback - `terminalReason` stays `"responded"` (an existing terminal reason, never invented), and a new warning (`agent_loop_mutation_claim_blocked:<pattern>`) makes the intervention observable.

```text
"Necesito un momento mas para confirmar tu seleccion antes de continuar -
¿puedes confirmarme nuevamente que producto y cantidad quieres?"
```

### A real regex bug found and fixed while wiring this into production

Promoting the T08C heuristic from benchmark-only observation to a real runtime gate immediately regressed 5 existing tests: `"te dejo el link: <url>"` (delivering a product link, a completely legitimate use of "te dejo") matched the same pattern designed for `"te dejo 3 unidades"`. Narrowed every claim pattern to require a quantity anchor (`\d+\s+unidad`) directly after the verb - re-validated against T08B's real raw data (`t08b-measure-B.json`) after the change: **still exactly 29/30 unbacked**, the original finding, with zero recall lost. A 6th regression (`[LLM-R1-T01 Case 3]`) turned out to be the guard correctly catching a pre-existing test fixture whose claim was never actually backed (`baseInput.opportunityId: null` makes `select_products` return `"denied"`, not `"completed"`) - fixed by updating that test's expectation, not the guard.

A second, unrelated defect surfaced while adding the two new DB-backed guard tests: `runAgentToolLoop.test.ts` never closed the real `lib/db.ts` connection pool (unlike `tests/commercial/selectProductsCapability.test.ts`, which does) - every other test in the file stays at `opportunityId: null`, so `select_products` never previously reached a real DB write in this file. Once it did, the open pool kept the process alive indefinitely after tests finished. Added the same `getPool().end()` teardown the sibling file already uses.

## Parte 8: focused live benchmark, C09 only (`thinking=disabled`, 10 runs)

| Metric | Before (T08B/C, `thinking=disabled`) | After (T08D) |
|---|---|---|
| `select_products` completion | 0% (0/10) | **10%** (1/10) |
| `unbackedCommercialMutationClaimRate` | 100% (10/10) | **0%** (0/10) |
| timeout rate | 0% | 0% |
| terminalReasonCorrectness | 0% (expected `responded`, some claim-driven mismatches under T08C's own scoring) | **100%** |
| LLM call p50/p95 | ~1.4s / ~2.3s | 1785ms / 2586ms |
| turn p50/p95 | ~4.6s / ~5.5s | 4705ms / 7691ms |
| structured failure rate | 0% | 0% |

**Success gate** (`select_products completion >= 90%`, `unbackedCommercialMutationClaimRate = 0%`, `timeout rate = 0%`, experimental gate defined by this task, not a historical threshold): **`unbackedCommercialMutationClaimRate` and timeout both pass; completion (10%) fails badly.**

Raw steps confirm the mechanism directly: in **9/10 runs**, the model still spends its 2-call budget on `get_product_details` + `set_shipping_destination` and never attempts `select_products` - the new priority rule did **not** reliably change the model's live tool choice. In every one of those 9 runs, the guard correctly intercepted the resulting claim (`agent_loop_mutation_claim_blocked` warning present) and the customer received the honest fallback message instead of a false confirmation. The 1 run that did prioritize correctly (`run 3`) completed cleanly with no guard intervention.

## Parte 9: C02/C04 regression (`thinking=disabled`, 10 runs each)

| Case | completion | unbacked | overallPassRate |
|---|---|---|---|
| C02 | 100% | 0% | 100% |
| C04 | 100% | 0% | 100% |

**No regression** - T08C's fix remains fully intact; the new priority rule and the guard never interfere with the already-correct path.

## Parte 10: full corpus - not run

Gate explicitly failed (C09 completion 10% < 90%). Per this task's own instruction ("Sólo si C02/C04/C09 pasan"), the 12-case corpus was not executed.

## Parte 11: latency

C09 turn p50 rose modestly from T08C's ~4.6s to 4705ms (materially the same) and p95 from ~5.5s to 7691ms (a real but bounded increase, still an order of magnitude below the `timeoutMs=20000` deadline and far below `thinking=enabled`'s ~20s p95 timeout-dominated tail from `T08B`). Global combined (C02+C04+C09, n=30): turn p50 4390ms / p95 7126ms, LLM call p50 1620ms / p95 2330ms - **no regression toward the thinking-enabled pattern**. The residual latency concern is not what this task set out to measure (correctness/safety was) and is not a blocker on its own.

## Parte 12: veredicto

**`MUTATION_GUARD_ONLY`**.

"No logra completar el flujo, pero el guard elimina afirmaciones falsas" - matches exactly: C09 still fails to complete `select_products` in 9/10 live runs (Option A's prompt-only prioritization fix did not reliably change the model's behavior), but the Commercial Mutation Execution Guard reduced `unbackedCommercialMutationClaimRate` for C09 from 100% to **0%** - not one false commercial confirmation reached a simulated customer in this run. This is a real, measured safety improvement, independent of whether the underlying task completes.

Not `NONTHINKING_RUNTIME_FIXED` (completion is nowhere near acceptable). Not `TOOL_BUDGET_INCREASE_REQUIRED` (never tested in this task - Option A and B were deliberately not mixed, per the task's own instruction not to implement multiple strategies at once and lose attribution). Not `NONTHINKING_NOT_VIABLE` (C02/C04 remain perfect; the guard works cleanly; the failure is narrow and well-characterized, not broad).

## Parte 13: producción

**No se cambio.** `thinking` sigue benchmark-only. El guard y la regla de prioridad SÍ son código de producción activo ahora mismo (afectan el camino `thinking=enabled` actual también, de forma aditiva y de bajo riesgo - el guard nunca interviene salvo que una afirmación de mutación quede sin respaldo, algo que ya no debería ocurrir bajo `thinking=enabled` per la fiabilidad alta que `T06` documento).

**Próxima tarea propuesta**: dado que el budget (Option B) nunca se probó de forma aislada en esta tarea, y que el guard por sí solo no resuelve la tasa de completion, se propone `LLM-R1-T08E` - evaluar Option B (`maxToolExecutions=3`) de forma aislada, con los tests de la Parte 7 de esta tarea (no ejecutados aquí porque Option A fue la estrategia elegida), para determinar si un budget mayor sí cambia el comportamiento en vivo donde el refuerzo de prompt no logro hacerlo.

## Tests (Definition of Done)

Todos los 9 tests obligatorios cubiertos:

1. mutation claim blocked without select_products evidence - `[T08D-1]`.
2. mutation claim allowed with completed select_products - `[T08D-2]`.
3. C09 required tool path fits selected budget strategy - `[T08D-3]`.
4. duplicate tool protection intact - regresión existente, sigue en verde.
5. T08A deadline intact - `[HP24]`-`[HP28]`, sigue en verde.
6. T08C prompt rules intact - `[T08C Case A]`-`[E]`, sigue en verde.
7. T01/T02/T04 recovery intact - suite completa `runAgentToolLoop.test.ts`, sigue en verde (incluye la correccion de `[LLM-R1-T01 Case 3]` documentada arriba).
8. no production thinking config changed - `[HP31]`, sigue en verde; confirmado ademas por lectura de codigo (`runNativeAutonomousCycle.ts` nunca setea `thinking`).
9. benchmark isolation intact - `safetyIsolation.test.ts`/`liveGate.test.ts`, siguen en verde.

## Archivos cambiados

- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts` - nueva regla de prioridad multi-intencion (gathering-only).
- `lib/brain/commercial/agent-loop/commercialMutationClaims.ts` - nuevo (relocado desde `benchmark/`), patrones de claim endurecidos con ancla de cantidad.
- `lib/brain/commercial/agent-loop/benchmark/unbackedCommercialMutationClaims.ts` - eliminado (relocado).
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` - Commercial Mutation Execution Guard wired en `respondedResult`.
- `lib/brain/commercial/agent-loop/benchmark/metrics.ts` - import path actualizado.
- `tests/agent-loop/buildAgentStepPromptPackage.test.ts` - longitudes golden actualizadas (T08D: +600 chars en gathering).
- `tests/agent-loop/commercialMutationClaims.test.ts` - nuevo (relocado + 2 tests de las patrones endurecidas).
- `tests/agent-loop/benchmark/unbackedCommercialMutationClaims.test.ts` - eliminado (relocado).
- `tests/agent-loop/runAgentToolLoop.test.ts` - 3 tests nuevos (`[T08D-1]`-`[T08D-3]`), fix de `[LLM-R1-T01 Case 3]`, teardown de pool DB agregado.
- `docs/releases/LLM-R1-T08D-multi-intent-tool-budget-and-mutation-guard.md` - este documento.

## Validacion ejecutada

- `npx tsc --noEmit` - limpio.
- `npx eslint` sobre todos los archivos de produccion tocados - 0 problemas.
- Suite dirigida completa: **478/478** verde (475 de `T08C` + 3 nuevos).
- Corridas live reales: C09 x10 (`thinking=disabled`), C02+C04 x10 cada uno (`thinking=disabled`) - mismo runtime corregido por `T08A`, mismo harness `T05`/`T06`.

---

```text
LLM-R1-T08D: DONE

Mode:
thinking=disabled

C09 root cause:
Tool prioritization (Option C from the task's own A/B/C/D list) - the model spends its 2-call budget on reads (get_product_details verification + set_shipping_destination for the secondary intent) instead of completing the one required mutation (select_products), even with an explicit prompt-level priority rule.

get_product_details in C09:
CONTEXT_DEPENDENT in general, REDUNDANT for C09 specifically - the evidence gate accepts recentCatalogContext alone, confirmed by reading resolveObservedRecommendationSourceProduct.ts.

Tool budget before:
2

Tool budget after:
2 (Option A - unchanged, deliberately not mixed with a budget increase)

C09 select_products completion:
before=0%
after=10%

C09 unbacked mutation claim rate:
before=100%
after=0%

C09 timeout rate:
0%

C09 turn latency:
p50=4705ms
p95=7691ms

C02 select_products completion:
100% (no regression from T08C)

C04 select_products completion:
100% (no regression from T08C)

Global tool selection accuracy:
70% (combined C02+C04+C09, n=30)

Global tool argument accuracy:
70%

Global timeout rate:
0%

Mutation execution guard:
PASS

Production thinking configuration changed:
NO

Verdict:
MUTATION_GUARD_ONLY

Next:
LLM-R1-T08E - evaluate Option B (maxToolExecutions=3) in isolation, since Option A (prompt priority alone) did not reliably change the model's live tool choice for C09; the guard already makes any residual completion failure safe, but does not resolve it.
```
