---
title: SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION — Agent Tool Loop Model Suitability Decision
doc_id: audit-sales-agent-llm-model-benchmark-decision
status: insufficient_data_live_benchmark_pending
owner: architecture
last_reviewed: 2026-08-12
source_of_truth_for:
  - Agent Tool Loop model suitability verdict (deepseek-v4-flash)
  - Bounded Action Plan future-architecture classification
depends_on:
  - ./SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md
  - ../releases/LLM-R1-T01-structured-output-recovery.md
  - ../releases/LLM-R1-T02-provider-observability.md
  - ../releases/LLM-R1-T03-prompt-finalization-reduction.md
  - ../releases/LLM-R1-T04-guided-structured-repair.md
  - ../releases/LLM-R1-T05-production-measurement-model-benchmark.md
tags:
  - audit
  - sales-agent
  - agent-loop
  - llm-provider
  - benchmark
  - model-decision
---

# SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION

Esta auditoria responde la pregunta que `SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md` (seccion 13) dejo pendiente: con `LLM-R1-T01`-`T04` ya en produccion (recuperacion acotada, observabilidad por inferencia, prompt de finalization reducido, reparacion guiada), **¿sigue siendo `deepseek-v4-flash` un modelo adecuado para el Agent Tool Loop?** El harness reproducible que responde esta pregunta se construyo en `LLM-R1-T05` (ver release doc enlazado). Esta auditoria **no ejecuto ningun request real contra el proveedor** - el veredicto formal es `INSUFFICIENT_DATA` por diseño, no por omision: la tarea autoriza explicitamente este resultado en ausencia de una corrida live autorizada.

## 1. Veredicto ejecutivo

**`INSUFFICIENT_DATA`**. El harness offline (Parte C, obligatoria) se ejecuto completo y demuestra que el pipeline de medicion (corpus -> environment -> provider -> `runAgentToolLoop` real -> scoring -> metrics) funciona correctamente end-to-end, incluyendo los caminos de `LLM-R1-T01`/`T04` (recovery, fail-closed). Pero un provider **scripted/determinista** no es evidencia sobre el comportamiento real de `deepseek-v4-flash` - ningun numero de latencia, tokens o tasa de fallo estructural de la corrida offline debe leerse como una medicion del modelo. **No se ejecuto el modo live** (Parte D) - no hay `BENCHMARK_LIVE_LLM_ENABLED` en este entorno y no se solicito autorizacion explicita para gastar requests reales contra el proveedor. En consecuencia, ninguno de los cuatro veredictos accionables (`KEEP_CURRENT_MODEL`/`KEEP_AND_TUNE`/`BENCHMARK_ALTERNATIVES`/`REPLACE_CURRENT_MODEL`) tiene evidencia que lo respalde todavia.

**No se recomienda cambiar el modelo configurado.** Esta conclusion es identica a la de la auditoria original (seccion 14) y sigue sin evidencia nueva que la contradiga o la confirme.

## 2. Metodologia de test

- Harness: `lib/brain/commercial/agent-loop/benchmark/` (`LLM-R1-T05`) - `runAgentToolLoop` real, sin modificar, contra un `AgentLoopProvider` intercambiable (scripted offline por defecto; HTTP real solo bajo el gate `BENCHMARK_LIVE_LLM_ENABLED`).
- Aislamiento: Catalog Service mock HTTP local (`127.0.0.1`, puerto efimero), Carrier MS fake inyectado directamente, resolver de comunas real sobre datos fake, `select_products`/`set_shipping_destination` contra la misma DB de test local que el resto de la suite (nunca produccion, nunca Catalog/Carrier reales, nunca WhatsApp/outbox).
- Corrida ejecutada para esta auditoria: modo `offline`, `runsPerCase=1`, corpus completo (12 casos), via `tests/agent-loop/benchmark/offlineHarnessEndToEnd.test.ts` y confirmado independientemente con `scripts/benchmark-agent-tool-loop.ts`.
- **Ninguna corrida `live` se ejecuto.** Todo numero en las secciones 5-11 de abajo proviene exclusivamente del modo offline y se marca explicitamente segun corresponda: **[ESTRUCTURAL - valido]** (una propiedad real del control flow de `runAgentToolLoop`, verificada con datos reales aunque el contenido del modelo sea fake) o **[NO APLICABLE A COMPORTAMIENTO REAL DEL MODELO]** (un numero que el provider scripted produce pero que no dice nada sobre `deepseek-v4-flash`).

## 3. Corpus

12 casos (C01-C12), descritos completos en `docs/releases/LLM-R1-T05-production-measurement-model-benchmark.md`. Cobertura: busqueda simple, seleccion contextual, shipping con seleccion confirmada, cambio de cantidad, cambio de comuna, destino ambiguo ("Santiago"), producto no observado (evidence gate), conversacion sin tool, multi-intencion simple (acotada al budget real), tool failure controlado, `invalid_response` recuperable, `invalid_response` persistente (fail closed). `validateBenchmarkCorpus` confirma el corpus consistente (sin duplicados, sin tools simultaneamente requeridas/prohibidas, señales de failure respaldadas por su propio script) antes de cada corrida.

## 4. Configuracion de runtime

Identica a produccion en todo lo que `LLM-R1-T05` no esta autorizado a tocar: mismo `runAgentToolLoop.ts` (sin modificar), mismos budgets (`maxDecisions`/`maxToolExecutions` default de plataforma), mismo `FINALIZATION_MAX_ATTEMPTS=2`, mismo `AgentStep`/`AgentLoopProvider` contract, mismo Capability Gateway (solo sus puertos externos - Catalog/Carrier/comunas - redirigidos a fakes/mocks locales). Modelo configurado en produccion: **`deepseek-v4-flash`** (via `http-agent-loop-provider`, sin cambios en esta tarea ni en ninguna de `LLM-R1-T01`-`T04`).

## 5. Correctness

Offline, 12/12 casos cumplen su propio `groundTruth` (`overallPassRate: 100%`) - **[ESTRUCTURAL - valido, pero tautologico]**: cada `offlineScript` fue escrito para producir exactamente el resultado que su propio `groundTruth` espera, asi que un 100% offline demuestra que el harness/scoring funcionan correctamente, **no** que el modelo real acertaria tool selection/argument accuracy/terminal reason en esos mismos 12 casos. La tasa de correctness real de `deepseek-v4-flash` contra este corpus: **`NOT_MEASURED`**.

## 6. Confiabilidad de structured output

Offline: `invalidResponseRate` global 11.5% (3 de 26 llamadas), concentrado enteramente en C11/C12 por diseño del fixture (son los unicos casos que scriptan una falla) - **[NO APLICABLE A COMPORTAMIENTO REAL DEL MODELO]**, es una tasa fabricada por el corpus, no una medicion. La tasa real de `empty_response`/`invalid_model_json`/`invalid_json_response` de `deepseek-v4-flash` en produccion tras `LLM-R1-T01`-`T04`: **`NOT_MEASURED`** (este harness puede medirla en modo live; ver seccion 14).

## 7. Latencia

Offline: `llmCallLatencyMsP50/P95` ~0-1ms, `completeTurnLatencyMsP50/P95` de un digito a decenas de ms - **[NO APLICABLE A COMPORTAMIENTO REAL DEL MODELO]**, es el tiempo de un provider en memoria mas un HTTP roundtrip a `127.0.0.1`, no tiene relacion con los 14-26s por inferencia que la auditoria original documento contra el proveedor real. Latencia real p50/p95 por llamada y por turno completo de `deepseek-v4-flash` bajo la configuracion actual (post `LLM-R1-T01`-`T04`): **`NOT_MEASURED`**.

## 8. Tokens

Offline: `inputTokens`/`outputTokens` son `null` en el 100% de las llamadas (`usageComplete: false`) por diseño - el provider scripted nunca tuvo una inferencia real que reportar, y `LLM-R1-T02`'s disciplina de "`null` nunca `0`" se preservo deliberadamente en el fake (ver `offlineProvider.ts`). Tokens reales por llamada/por turno completado: **`NOT_MEASURED`**. Costo por turno: **`NOT_MEASURED`** (por diseño explicito de `LLM-R1-T05` - el harness expone tokens crudos, nunca hardcodea un precio; el costo es un calculo externo sobre esos tokens una vez medidos).

## 9. Finish reasons

Offline: `stop` en 23/26 llamadas exitosas, `null_unknown` en las 3 llamadas `invalid_response` de C11/C12 (el campo `finishReason` de una falla `invalid_response` solo esta poblado cuando el proveedor real alcanzo a parsear un envelope antes de fallar - el provider scripted de este harness nunca lo simula, por disenio, para no fabricar una señal que no viene de un fallo real). Cero `length` observado - **[NO APLICABLE A COMPORTAMIENTO REAL DEL MODELO]**, el corpus offline nunca genera contenido largo. La pregunta central de la auditoria original ("¿`invalid_model_json` correlaciona con `finishReason=length`? ¿`empty_response` correlaciona con `max_tokens` agotado?") sigue **`NOT_MEASURED`** - requiere una corrida live con volumen suficiente de fallos reales.

## 10. Comportamiento de recovery

Esta es la unica seccion con evidencia real y accionable, porque ejercita codigo de produccion (`LLM-R1-T01`/`T04`), no el modelo: C11 (offline) confirma que un `invalid_response` en el primer intento activa exactamente 1 recovery guiado y el turno completa (`llmCalls.length === 2`, `outcome`: `invalid_response` -> `success`, `terminalReason: responded`). C12 confirma que dos fallos consecutivos agotan el unico recovery que `LLM-R1-T01` concede y el turno falla cerrado (`terminalReason: provider_unavailable`, `llmCalls.length === 2`, **nunca** un tercer intento). Esto confirma, con `runAgentToolLoop` real (no un doble), que el mecanismo que `LLM-R1-T01`/`T04` implementaron efectivamente se activa y efectivamente esta acotado - independiente de si el modelo real produce `invalid_response` con frecuencia alta o baja. La frecuencia real con la que `deepseek-v4-flash` dispara este camino, y la tasa de exito del recovery guiado contra fallos reales del modelo (no scripted): **`NOT_MEASURED`**.

## 11. Llamadas LLM por turno (Parte E)

Offline, agregado sobre los 12 casos (`runsPerCase=1`): **promedio 2.17 llamadas/turno, maximo 3** - **[ESTRUCTURAL - valido]**: este numero SI es una propiedad real del control flow de `runAgentToolLoop` (no depende de que el contenido de la respuesta sea real o scripted, solo de cuantas decisiones goberna el loop antes de responder), consistente con el analisis de la auditoria original (seccion 3: "camino feliz normal ... ya 2-3 llamadas al modelo"). Desglose por caso:

| Caso | Llamadas | Por que |
|---|---|---|
| C01, C04, C05, C06, C07, C10 | 2 | 1 tool + 1 respond (o 1 tool + 1 respond via evidence-gate/controlled-failure) |
| C02, C03, C09 | 3 | 2 tools + 1 respond |
| C08 | 1 | conversacional puro, sin tool |
| C11 | 2 | 1 falla `invalid_response` + 1 recovery exitoso |
| C12 | 2 | 2 fallas `invalid_response` (bounded, fail closed) |

**C09 es el caso mas relevante para la Parte F**: el mensaje del cliente pide dos intenciones (seleccionar producto + calcular shipping) pero el budget real de gathering (`maxToolExecutions=2` default de plataforma) solo alcanza para completar la primera (`get_product_details`+`select_products` ya consume el budget), asi que el turno completa con 3 llamadas totales (2 gathering + 1 finalization) habiendo resuelto solo la mitad de la intencion del cliente, ofreciendo continuar el shipping en el siguiente turno. Esto **no es un defecto del modelo** - es una consecuencia directa y esperada del budget actual, y es exactamente el patron que la seccion 13 de la auditoria original identifico como "numero de round-trips al LLM por turno" siendo la causa principal de latencia percibida, no `deepseek-v4-flash` en si.

## 12. Idoneidad del modelo

No hay evidencia suficiente para pronunciarse. Los datos disponibles (offline, estructurales) confirman que el harness y los mecanismos de `LLM-R1-T01`-`T04` funcionan segun lo diseñado, pero cero datos aqui hablan de la calidad real de `deepseek-v4-flash` (tool selection, argument accuracy, finish reasons reales, latencia real, tasa real de `invalid_response`). Ningun cambio de modelo puede justificarse con lo que esta auditoria tiene disponible.

## 13. Impacto de arquitectura

Confirmado en la seccion 11: el numero de rondas LLM por turno (1-3 en el corpus, potencialmente mas en flujos multi-intencion reales) es una funcion del **control flow del loop** (budgets, decision-por-llamada), no del modelo. Cambiar de modelo sin atacar esto no reduciria el numero de round-trips por turno ni, por lo tanto, la porcion de latencia que la auditoria original atribuyo a "numero de llamadas x latencia por llamada" (seccion 3). Esto refuerza la secuencia ya recomendada por la auditoria original: arreglar/observar primero (`P0`-`P1`, ya hecho por `T01`-`T04`), medir despues (`T05`, este documento), y solo considerar arquitectura de accion-por-lote (Parte F, ver abajo) o cambio de modelo con evidencia real en mano.

## 14. Recomendacion

1. **No cambiar el modelo configurado ahora.** Condicion para reconsiderar: datos reales de un benchmark live bajo este mismo harness (ver `--live` en `scripts/benchmark-agent-tool-loop.ts`, gateado por `BENCHMARK_LIVE_LLM_ENABLED`).
2. **Proximo paso concreto**: ejecutar `BENCHMARK_LIVE_LLM_ENABLED=true npx tsx scripts/benchmark-agent-tool-loop.ts --live --runs=10` contra `deepseek-v4-flash` (el modelo ya configurado) bajo autorizacion explicita de costo, para llenar las secciones 5-9 con datos reales. Recien con eso, si `BENCHMARK_ALTERNATIVES` queda justificado (latencia real p95 sigue siendo operacionalmente mala, o la tasa real de `invalid_response` post-`T01`-`T04` sigue siendo alta), correr el mismo corpus contra un modelo candidato bajo el mismo harness (mismo `AgentStep` schema, mismos fixtures, mismo `commercialContext`, misma temperatura, mismo budget de tokens, misma politica de reintentos - solo el provider cambia).
3. **Bounded Action Plan (Parte F)**: clasificado como **`FUTURE_OPTIMIZATION`**, no `NOT_NEEDED` ni `HIGH_VALUE_FUTURE_OPTIMIZATION`. Razonamiento: la seccion 11 confirma que C02/C03/C09 (los casos de mayor multi-tool) usan 3 de las hasta ~5-6 llamadas que un turno puede llegar a costar - una arquitectura de lista de acciones en lote (una decision que devuelve N tools en vez de 1) podria eliminar potencialmente 1 ronda LLM en esos caminos (~33% menos llamadas en el caso mas comun de 3), lo cual es una reduccion de latencia real y medible SI la latencia por llamada resulta ser el cuello de botella dominante (a confirmar con datos live, seccion 7). No es `NOT_NEEDED` porque el patron es real y frecuente (3 de 12 casos del corpus minimo, y el smoke original que origino la auditoria). No es `HIGH_VALUE_FUTURE_OPTIMIZATION` todavia porque (a) cambia quien decide invocar una tool - el principio "propuesta del planner != decision del backend" exige una decision de producto explicita, no solo una oportunidad tecnica, y (b) sin latencia real medida (seccion 7 `NOT_MEASURED`), no hay forma de cuantificar el impacto real en segundos, solo en numero de llamadas. **No se implementa en esta tarea** - queda documentada como recomendacion futura unicamente, tal como pedia `LLM-R1-T05` explicitamente.

---

```text
LLM-R1-T05: DONE
Branch: feat/llm-r1-t05-model-benchmark
Commit: <ver docs/releases/LLM-R1-T05-production-measurement-model-benchmark.md tras el commit>
Corpus cases: 12
Offline benchmark: PASS
Live benchmark executed: NO
Current model: deepseek-v4-flash
Structured failure rate: NOT_MEASURED (offline-only 11.5% is fixture-driven, not model behavior)
Recovery success rate: NOT_MEASURED (offline-only: C11 100% / C12 0% by fixture design, not model behavior)
LLM call latency p50: NOT_MEASURED
LLM call latency p95: NOT_MEASURED
Complete-turn latency p50: NOT_MEASURED
Complete-turn latency p95: NOT_MEASURED
Average LLM calls per turn: 2.17 (structural, offline harness, 12 cases, runsPerCase=1)
Model verdict: INSUFFICIENT_DATA
Bounded Action Plan classification: FUTURE_OPTIMIZATION
```
