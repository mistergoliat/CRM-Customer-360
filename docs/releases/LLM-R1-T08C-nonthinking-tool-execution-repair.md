---
title: LLM-R1-T08C — Non-Thinking Tool Execution Repair
doc_id: release-llm-r1-t08c-nonthinking-tool-execution-repair
status: implemented_partial
owner: architecture
last_reviewed: 2026-08-13
source_of_truth_for:
  - the select_products evidence-binding prompt rule (LLM-R1-T08C)
  - unbackedCommercialMutationClaimRate metric contract
  - why thinking=disabled is not yet production-viable (C09's residual gap)
depends_on:
  - ./LLM-R1-T08B-deepseek-thinking-mode-benchmark.md
  - ../audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md
tags:
  - release
  - agent-loop
  - llm-provider
  - prompt
  - reliability
---

# LLM-R1-T08C — Non-Thinking Tool Execution Repair

`LLM-R1-T08B` found that `deepseek-v4-flash` with `thinking=disabled` keeps the drastic latency win but, in 29/30 runs of C02+C04+C09, skips `select_products` and narrates the selection as already done. This task asks a single question: **can a prompt/contract reinforcement fix that without touching model, architecture, or runtime enforcement?** Answer: **partially** - it fully closes the gap for C02/C04 (single-intent cases) but leaves C09 (a multi-intent, tool-budget-constrained case) unchanged.

## Parte 1-2: prompt audit

Read in full: `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts`. Every rule touching `select_products`/commercial mutations/claiming execution, classified:

| Rule | Where | Classification |
|---|---|---|
| "Use select_products only once the customer has confirmed..." (`SELECT_PRODUCTS_RULE_LINES[0]`) | gathering only | **IMPLICIT** - a *when-to-call* trigger, never phrased as "you must call this before claiming success"; **guidance, not obligation** |
| "If commercialContext.commercialLineItems already reflects... reuse it silently" (`[3]`) | gathering only | **CONFLICTING** - a real, legitimate escape hatch (don't re-call when durably unchanged), but nothing distinguishes "durably already true" from "the model just now inferred it from the customer's words" - exactly the gap that lets a non-thinking model conflate the two |
| "You must never claim to have executed anything yourself - the platform executes tools, not you." (generic, both phases) | gathering + finalization | **EXPLICIT but TOO_DISTANT / TOO_GENERIC** - present in both phases (this rule itself was never the gap), but positioned after ~13 other rule blocks (product links, recent-catalog-context, purchase history, adaptive presentation, explore_catalog, shipping, select_products, calculate_shipping, stock disclosure, **commercial closing**, pending-catalog-action) and phrased for *any* action, never concretely tied to `select_products`'s own observable evidence (`ToolObservation.status`) |
| `COMMERCIAL_CLOSING_RULE_LINES` (product-link closing offer) | gathering + finalization | **CONFLICTING (soft, positional)** - sits immediately before the generic anti-hallucination line, priming a confident, complete-sounding close right before the one guard meant to prevent overclaiming |
| Select_products-specific evidence rule tying `respond` content to a completed observation | **absent anywhere** | **gap** - no rule of this shape existed before this task |

### Parte 2 answers

1. **¿Existe una regla explícita que ate select_products a lo que se puede afirmar en `respond`?** No, antes de esta tarea.
2. **¿Obligación o guidance?** Guidance (item 0 above is a trigger condition, never an imperative precondition on the final claim).
3. **¿Presente en gathering?** La guía de *cuándo* llamar sí; la atadura evidencia→afirmación no, en ninguna parte.
4. **¿Presente en finalization?** No - `SELECT_PRODUCTS_FINALIZATION_RULE_LINES = SELECT_PRODUCTS_RULE_LINES.slice(4)` descartaba exactamente las líneas que mencionan la obligación (`LLM-R1-T03`, intencional en su momento: la mecánica de invocación es imposible sin tools). El resultado, no intencional, es que finalization no tenía **ningún** recordatorio de la obligación pendiente.
5. **¿Existe una regla que permita interpretar intención sin ejecutar?** No de forma explícita, pero la ausencia misma actúa como permiso implícito.
6. **¿Reglas de closing que compitan?** Sí, posicionalmente (`COMMERCIAL_CLOSING_RULE_LINES` justo antes del guard generico).
7. **¿Finalization sin select_products ejecutado permite redactar como si hubiera ocurrido?** Sí - confirmado exactamente por el hallazgo de T08B.
8. **¿El commercial context induce a creer que ya está persistida?** Sí - la regla de "reuse silently" (item 4) es plausible que se sobregeneralice sin una distinción explícita de durabilidad.

## Parte 3-5: el fix (quirúrgico)

Dos líneas nuevas agregadas al final de `SELECT_PRODUCTS_RULE_LINES` (`buildAgentStepPromptPackage.ts`) - **nunca duplicadas**: como `SELECT_PRODUCTS_FINALIZATION_RULE_LINES` ya es un sufijo contiguo (`.slice(4)`) de ese mismo arreglo, ambas líneas nuevas fluyen automáticamente a finalization sin ningún cambio adicional, sin reintroducir `select_products` como tool disponible ahí (verificado por test, `[T08C Case C]`).

```text
"A product selection, addition, or quantity change is confirmed only when a
select_products tool observation from this turn has status "completed"
(data.status "selected"), or commercialContext.commercialLineItems already
durably reflects that exact selection from a previous turn with nothing
changed this turn (see the reuse rule above) - if neither is true, never say
the selection, quantity, or order is done, confirmed, ready, or registered."

"Understanding what the customer wants is not the same as it being done:
never turn "the customer wants 3 units" into "I left you 3 units" (or any
equivalent confirmation) without that select_products evidence."
```

Deliberadamente **una sola regla, fraseada igual para ambas fases** (Parte 5's "finalization guard" no necesita texto distinto: la restricción sobre qué se puede *afirmar* es idéntica en ambas fases; lo único que cambia es qué puede *hacer* el modelo al respecto - llamar la tool en gathering, o responder honestamente en finalization - y esa diferencia ya la gobierna el mecanismo existente de disponibilidad de tools por fase, sin tocarlo). El campo real observado por el modelo (`data.status: "selected"`) se verificó contra `selectProductsCapability.ts`/`buildToolObservation.ts` antes de escribirlo - nunca inventado.

**Costo medido**: +656 caracteres en el system prompt, idéntico en gathering (20439 vs. 19783) y finalization (16690 vs. 16034) - los tests golden de longitud de `T03`/`T04` se actualizaron con el nuevo valor exacto, documentando por qué cambió.

**Alcance**: exclusivamente `select_products`. No se tocó `set_shipping_destination` (que en los datos de `T08B` sí se ejecutaba correctamente incluso en modo non-thinking) ni ninguna otra capability - `T08C` debía ser quirúrgica, y la evidencia de `T08B` solo implicaba a `select_products`.

## Parte 8: `unbackedCommercialMutationClaimRate`

Nuevo módulo benchmark-only, `lib/brain/commercial/agent-loop/benchmark/unbackedCommercialMutationClaims.ts`: heurística de patrones (nunca IA, nunca otra llamada al proveedor) sobre `finalMessage` que detecta una afirmación de mutación comercial ("te dejo/agrego/preparo N unidades", "quedó/quedaron seleccionadas...", "son N unidades", etc.) y la contrasta contra si existe una observación `select_products` con `status: "completed"` en los `steps` de ese turno. **Validada contra los datos reales de `T08B`** (no solo contra fixtures inventados): la primera versión, basada en las frases literales que yo mismo había leído manualmente, subcontaba (detectaba 21/30 en vez de los 29/30 reales) - se corrigió y amplió hasta igualar exactamente el 29/30 encontrado por inspección manual, incluyendo un bug real de JavaScript (`\b` no reconoce vocales acentuadas como "é" como caracteres de palabra, así que `/agregu[eé]\b/` nunca hace match con "agregué" - corregido con un lookahead explícito). Wired en `metrics.ts` como `correctness.unbackedCommercialMutationClaimRate`, visible en el reporte del CLI.

## Parte 9: tests unitarios (Casos A-E, todos en verde)

`tests/agent-loop/buildAgentStepPromptPackage.test.ts`, `[T08C Case A]`-`[T08C Case E]`: selección solicitada sin evidencia previa (regla presente), selección ya persistida (regla de reutilización sigue permitiendo confirmar), finalization sin select_products (guard presente, sin reintroducir tools), finalization con select_products completado (permite confirmar, evidencia visible en `priorStepsThisTurn`), sin intención de selección (la regla nunca se convierte en "siempre debes llamar select_products"). Más 9 tests del módulo de la métrica (`[UMC1]`-`[UMC9]`), incluyendo 2 agregados tras la validación contra datos reales que expusieron el bug de `\b`.

## Parte 7 y 10: benchmark focalizado live (C02+C04+C09, `thinking=disabled`, 10 runs/caso)

Mismo harness/corpus/config que `T08B`, mismo runtime corregido por `T08A`. Comparación oficial (`computeAggregateMetrics`, no un script ad-hoc) sobre exactamente los mismos 30 turnos de ambos lados:

| Métrica | Antes (`T08B`) | Después (`T08C`) |
|---|---|---|
| select_products completion rate (`requiredToolCompletionRate`) | **3.3%** (1/30) | **66.7%** (20/30) |
| `unbackedCommercialMutationClaimRate` | **96.7%** (29/30) | **33.3%** (10/30) |
| toolArgumentAccuracy | 3.3% | 66.7% |
| overallPassRate | 3.3% | 66.7% |
| terminalReasonCorrectness | 100.0% | 100.0% |
| structuredFailureRate | 0.0% | 0.0% |
| timeout rate | 0.0% | 0.0% |
| LLM call latency p50/p95 | 1494ms / 1980ms | 1471ms / 1953ms |
| turn latency p50/p95 | 3294ms / 4934ms | 4226ms / 5152ms |
| LLM calls/turn avg | 2.23 | 2.67 |

Latencia **prácticamente sin cambio** (turn p95 sigue muy por debajo del deadline de 20s) - el aumento leve de calls/turn (2.23→2.67) es el costo esperado y correcto de que el modelo ahora sí complete el paso `select_products` que antes se saltaba.

**Desglose por caso** (el promedio combinado esconde una bifurcación limpia):

| Caso | select_products completion antes→después | unbacked antes→después |
|---|---|---|
| C02 | 10%→**100%** | - →**0%** |
| C04 | 0%→**100%** | - →**0%** |
| C09 | 0%→**0%** | - →**100%** |

## Hallazgo: C09 tiene una causa raíz distinta, no corregida por el prompt

Inspección de los 10 runs crudos de C09 post-fix: en **10/10**, el modelo gasta su `maxToolExecutions=2` completo en `get_product_details` + `set_shipping_destination` (resolviendo la intención de despacho del mensaje multi-intención) y **nunca llega a intentar `select_products`** - no es que ignore la regla nueva por descuido, es que el presupuesto de tools se agota antes de que `select_products` sea siquiera una opción disponible. Al llegar a finalization (sin tools), el modelo **igual** viola la regla nueva y narra "te dejo 2 unidades..." - la única de las tres causas donde el prompt reforzado no cambió el resultado en absoluto.

Esto es un hallazgo distinto y más profundo que el de C02/C04 (que sí era "el modelo simplemente no se molesta en llamar la tool aunque tenía presupuesto de sobra"): C09 combina (a) una interacción de presupuesto de tools con un mensaje multi-intención - el mismo patrón estructural que `T06`/`T07` ya habían identificado como problemático (aunque ahí se manifestaba como timeout bajo `thinking=enabled`, aquí se manifiesta como afirmación no respaldada bajo `thinking=disabled`) - y (b) evidencia directa de que, bajo presión de presupuesto agotado, el refuerzo textual del prompt no es suficiente para evitar la narración falsa en el 100% de los casos observados.

## Success gate (Parte 7)

```text
select_products completion combinado (C02+C04+C09): 66.7% (20/30)
Gate: >= 90% para escalar al corpus completo de 12 casos
Resultado: NO CUMPLE
```

**No se ejecuta el corpus completo (Parte 11)** - instrucción explícita de la tarea ante un gate no cumplido. `thinking=enabled` no se vuelve a correr (baseline A ya existe en `T08B`).

## Parte 12: veredicto

**`PROMPT_FIX_PARTIAL`**.

- `PROMPT_FIX_SUFFICIENT` requiere `unbackedCommercialMutationClaimRate = 0%` - no se cumple (33.3%, concentrado 100% en C09).
- `PROMPT_FIX_PARTIAL` ("mejora significativamente pero sigue habiendo casos de mutación narrada sin ejecución") - **coincide exactamente**: mejora de 20x en completion rate, reducción de 96.7%→33.3% en el hallazgo crítico de `T08B`, pero C09 queda en 0% de mejora.
- No es `NONTHINKING_NOT_VIABLE`: el fix corrigió el patrón por completo en 2 de los 3 casos afectados (C02/C04, ambos 0%→100% de completion), no es un fallo amplio.

## Parte 13: no se cambia producción

Ningún archivo de configuración de producción cambia - la unica variable experimental (`thinking`) sigue siendo benchmark-only (`liveProvider.ts`), nunca seteada por `runNativeAutonomousCycle.ts`. El prompt SÍ cambió (`buildAgentStepPromptPackage.ts`, dos líneas nuevas) - esto **es** código de producción real, activo para cualquier caller del Agent Tool Loop hoy mismo (incluido el camino `thinking=enabled` actual), pero es una correccion de contrato aditiva y de bajo riesgo (nunca cambia qué tools existen, nunca cambia budgets/timeout/modelo) - no un cambio del veredicto de qué modelo/modo usar en producción, que sigue siendo `thinking=enabled` (`T08B`).

Dado que C09 necesita mas que un ajuste de prompt (evidencia directa: 0% de mejora bajo presión de presupuesto agotado), la tarea siguiente propuesta es la variante de enforcement de runtime que la tarea ya preveía para este escenario:

**`LLM-R1-T08D` — Commercial Mutation Execution Guard**: un guard de runtime (fuera de alcance de `T08C`) que, antes de despachar una respuesta al cliente, verifique si el `respond.message` afirma una mutación comercial (reutilizando `unbackedCommercialMutationClaims.ts` o una evolución de esa lógica) sin evidencia de `select_products` completado este turno/estado durable, y si es así, fuerce una respuesta honesta o un handoff en vez de despachar la afirmación no respaldada - dirigido específicamente al patrón de C09 (agotamiento de presupuesto en mensajes multi-intención), no un rediseño general.

## Archivos cambiados

- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts` - 2 líneas nuevas en `SELECT_PRODUCTS_RULE_LINES` (fluyen a ambas fases via el mecanismo de sufijo ya existente).
- `lib/brain/commercial/agent-loop/benchmark/unbackedCommercialMutationClaims.ts` - nuevo, la métrica.
- `lib/brain/commercial/agent-loop/benchmark/metrics.ts` - agrega `correctness.unbackedCommercialMutationClaimRate`.
- `scripts/benchmark-agent-tool-loop.ts` - imprime la métrica nueva.
- `tests/agent-loop/buildAgentStepPromptPackage.test.ts` - 5 tests nuevos (`[T08C Case A]`-`[E]`) + 2 longitudes golden actualizadas con su razón documentada.
- `tests/agent-loop/benchmark/unbackedCommercialMutationClaims.test.ts` - nuevo, 9 tests.
- `docs/releases/LLM-R1-T08C-nonthinking-tool-execution-repair.md` - este documento.

## Validación ejecutada

- `npx tsc --noEmit` - limpio.
- `npx eslint` sobre todos los archivos de producción tocados - 0 problemas.
- Suite dirigida (`tests/agent-loop/**/*.test.ts` + `tests/agent-loop/benchmark/**/*.test.ts`): **475/475** verde (461 de `T08B` + 14 nuevos de esta tarea).
- Corrida live real: 3 casos x 10 runs = 30 turnos, `thinking=disabled`, mismo runtime `T08A`. `T08A` (deadline) sin regresión: 0 timeouts, ninguna llamada excedió el deadline nominal.
- No se corrió el corpus completo (gate no superado, por diseño de la tarea).

---

```text
LLM-R1-T08C: DONE

Mode:
thinking=disabled

Focused cases:
C02,C04,C09

Runs per case:
10

select_products completion rate before:
3.3% (1/30)

select_products completion rate after:
66.7% (20/30) - C02 100%, C04 100%, C09 0%

Unbacked commercial mutation claim rate before:
96.7% (29/30)

Unbacked commercial mutation claim rate after:
33.3% (10/30) - C02 0%, C04 0%, C09 100%

LLM latency p50/p95:
1471ms / 1953ms (before: 1494ms / 1980ms - no material change)

Turn latency p50/p95:
4226ms / 5152ms (before: 3294ms / 4934ms - small increase, expected: select_products now actually runs)

Timeout rate:
0.0%

Structured failure rate:
0.0%

Prompt-only fix sufficient:
NO

Verdict:
PROMPT_FIX_PARTIAL

Next:
LLM-R1-T08D - Commercial Mutation Execution Guard (runtime enforcement targeted specifically at C09's tool-budget-exhaustion pattern, reusing unbackedCommercialMutationClaims.ts; production model/mode selection stays thinking=enabled per T08B until this closes)
```
