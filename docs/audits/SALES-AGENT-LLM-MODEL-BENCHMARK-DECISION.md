---
title: SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION — Agent Tool Loop Model Suitability Decision
doc_id: audit-sales-agent-llm-model-benchmark-decision
status: live_benchmark_executed_benchmark_alternatives
owner: architecture
last_reviewed: 2026-08-13
source_of_truth_for:
  - Agent Tool Loop model suitability verdict (deepseek-v4-flash)
  - Bounded Action Plan future-architecture classification
  - deepseek-v4-flash thinking vs. non-thinking verdict (KEEP_THINKING_ENABLED)
depends_on:
  - ./SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md
  - ./SALES-AGENT-LLM-END-TO-END-LATENCY-AUDIT.md
  - ../releases/LLM-R1-T01-structured-output-recovery.md
  - ../releases/LLM-R1-T02-provider-observability.md
  - ../releases/LLM-R1-T03-prompt-finalization-reduction.md
  - ../releases/LLM-R1-T04-guided-structured-repair.md
  - ../releases/LLM-R1-T05-production-measurement-model-benchmark.md
  - ../releases/LLM-R1-T06-live-benchmark-model-decision.md
  - ../releases/LLM-R1-T07-end-to-end-latency-root-cause-audit.md
  - ../releases/LLM-R1-T08A-provider-deadline-enforcement-fix.md
  - ../releases/LLM-R1-T08B-deepseek-thinking-mode-benchmark.md
tags:
  - audit
  - sales-agent
  - agent-loop
  - llm-provider
  - benchmark
  - model-decision
---

# SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION

Esta auditoria responde la pregunta que `SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md` (seccion 13) dejo pendiente: con `LLM-R1-T01`-`T04` ya en produccion (recuperacion acotada, observabilidad por inferencia, prompt de finalization reducido, reparacion guiada), **¿sigue siendo `deepseek-v4-flash` un modelo adecuado para el Agent Tool Loop?** `LLM-R1-T05` construyo el harness reproducible y lo valido offline (`INSUFFICIENT_DATA`, sin datos reales). `LLM-R1-T06` ejecuto el benchmark live contra el proveedor/modelo real (`docs/releases/LLM-R1-T06-live-benchmark-model-decision.md`) y esta version del documento reemplaza el veredicto anterior con datos reales.

## 1. Veredicto ejecutivo

**`BENCHMARK_ALTERNATIVES`**. 120 turnos live (12 casos x 10 corridas) contra `deepseek-v4-flash`, misma configuracion efectiva de produccion (temperatura 0, `maxOutputTokens` no forzado, `maxModelRetries=0`, `timeoutMs=20000`, prompts/tools/budgets de `runAgentToolLoop.ts` sin tocar). La confiabilidad de contenido (JSON estructurado) es alta: `invalidResponseRate` 0.4% (1/247 llamadas), `invalidModelJsonRate` 0%, y el unico fallo real observado fue recuperado por el mecanismo de `LLM-R1-T01`/`T04`. **El problema material es latencia, concentrada en la cola**: `completeTurnLatencyMsP95` 40798ms, con una sola llamada real alcanzando 97002ms, y 7/120 turnos (5.8%) terminaron en `timeout` (el deadline de 20s del propio loop, no un fallo de contenido) - 6 de esos 7 concentrados en un unico caso (C09, multi-intencion: 60% de sus 10 corridas). Esto cumple explicitamente el criterio de la tarea para `BENCHMARK_ALTERNATIVES`: "la latencia sigue siendo excesiva" en al menos un flujo real y frecuente del corpus minimo.

**No se cambia el modelo en esta tarea.** El veredicto autoriza evaluar alternativas bajo el mismo harness (`LLM-R1-T07`, propuesto en la seccion 14), nunca reemplaza el modelo sin esa comparacion.

## 2. Metodologia de test

- Harness: `lib/brain/commercial/agent-loop/benchmark/` (`LLM-R1-T05`) - `runAgentToolLoop` real, sin modificar, contra `createHttpAgentLoopProvider` real (el mismo provider de produccion) apuntando a `https://api.deepseek.com/chat/completions` con el modelo `deepseek-v4-flash`.
- Aislamiento (verificado antes de habilitar live - `tests/agent-loop/benchmark/safetyIsolation.test.ts`/`liveGate.test.ts`, 9/9 pass): Catalog Service mock HTTP local (`127.0.0.1`, puerto efimero), Carrier MS fake inyectado directamente, resolver de comunas real sobre datos fake, `select_products`/`set_shipping_destination` contra la misma DB de test local que el resto de la suite. La unica llamada externa real en todo el benchmark es la del proveedor LLM - confirmado por codigo (`runCorpus.ts` arma `setupBenchmarkEnvironment()` identico en ambos modos, solo el `AgentLoopProvider` cambia) y por observacion (cero WhatsApp/outbox/Catalog/Carrier reales alcanzados durante las 132 llamadas reales al proveedor de esta tarea).
- **Fase 1 (smoke, `LLM-R1-T06`)**: 12 casos x 1 corrida, live. Sin side effects externos inesperados - unico hallazgo: el CLI (`scripts/benchmark-agent-tool-loop.ts`) no cerraba el pool de DB al terminar, dejando el proceso colgado indefinidamente aunque el benchmark ya hubiera completado y escrito su resultado. **Defecto del harness, corregido en esta tarea** (`getPool().end()` en un `finally` de `main()`) - cero cambios a codigo de produccion.
- **Fase 2 (medicion, `LLM-R1-T06`)**: 12 casos x 10 corridas = **120 turnos**, live, secuencial. `--runs=30` no se ejecuto - la muestra de 10 no resulto ruidosa (ver seccion 5-11) y la tarea autoriza explicitamente no escalar a 30 salvo necesidad.
- Configuracion del modelo: `BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY`/`BRAIN_MODEL_NAME` (produccion, `.env`, credenciales nunca impresas/logueadas/persistidas por el harness). `temperature=0`/`maxModelRetries=0` (default de `liveProvider.ts`, identico al `SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT` de `sales-agent-configuration/defaults.ts`). `maxOutputTokens` deliberadamente **no forzado** (omite `max_tokens` del request) - replica exactamente el comportamiento de `resolveEffectiveModelConfiguration` (`sales-agent-configuration/resolver.ts`) cuando no existe una fila de configuracion publicada: ese resolver NUNCA usa el `1024` de `SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT` como techo salvo que exista un valor publicado explicito, por diseño ("nunca cappear silenciosamente un deployment no configurado con un numero inventado" - comentario del propio resolver). Este entorno de desarrollo no tiene acceso a la DB de produccion para confirmar si existe hoy una fila publicada con un `maxOutputTokens` distinto - se documenta como la mejor aproximacion disponible, consistente con el propio codigo de resolucion, nunca inventada.
- `timeoutMs` del loop: no seteado por el harness (`runBenchmarkCase` no pasa `input.timeoutMs`), por lo tanto usa el mismo `DEFAULT_TIMEOUT_MS=20000` (`runAgentToolLoop.ts:62`) que produccion usa por default.

## 3. Corpus

12 casos (C01-C12), sin cambios desde `LLM-R1-T05` (descritos completos en `docs/releases/LLM-R1-T05-production-measurement-model-benchmark.md`). **Hallazgo metodologico de esta tarea**: C11/C12 fueron diseñados en `T05` para validar el mecanismo de recovery de `LLM-R1-T01`/`T04` via un `offlineScript` que fuerza `invalid_response` - un mecanismo que **no existe en modo live** (el modo live nunca usa `offlineScript`, solo el mensaje real del cliente contra el modelo real). Live, C11/C12 casi nunca pueden cumplir su propio `groundTruth` (`expectsStructuredFailure`/`expectedTerminalReason: provider_unavailable`) salvo que el modelo falle espontaneamente - lo cual, correctamente, no ocurrio en ninguna de las 20 corridas de C11+C12. Esto **no es un defecto del modelo ni del harness**, es una limitacion de diseño de esos dos casos especificos que solo tiene sentido offline; se excluyen de la lectura de `overallPassRate` como señal de correctness real del modelo (secciones 5 y 12), pero sus datos de latencia/tokens/calls siguen siendo validos y se reportan igual.

## 4. Configuracion de runtime

Identica a produccion en todo lo que esta tarea no esta autorizada a tocar: mismo `runAgentToolLoop.ts` (sin modificar), mismos budgets (`maxDecisions=3`/`maxToolExecutions=2` default de plataforma), mismo `FINALIZATION_MAX_ATTEMPTS=2`, mismo `AgentStep`/`AgentLoopProvider` contract, mismo Capability Gateway (solo sus puertos externos - Catalog/Carrier/comunas - redirigidos a fakes/mocks locales). Modelo: **`deepseek-v4-flash`**, sin cambios en esta tarea ni en ninguna de `LLM-R1-T01`-`T05`. Unico cambio de codigo de esta tarea: el cierre del pool de DB en el CLI del harness (seccion 2), fuera del camino de produccion.

## 5. Correctness

Agregado, 12 casos (incluye C11/C12, ver seccion 3 para su caveat): `requiredToolCompletionRate` 90.0%, `forbiddenToolInvocationRate` 0.0%, `toolArgumentAccuracy` 96.7%, `terminalReasonCorrectness` 85.8%, `overallPassRate` 60.0%. **Excluyendo C11/C12** (100 turnos, los 10 casos con `groundTruth` significativo en modo live): `overallPassRate` **72.0%** (72/100).

Desglose real por caso (10/10 = 100% salvo lo indicado):
- **C01, C03, C04, C05, C06, C08**: 100% `overallPassRate`. Sin hallazgos.
- **C02** (seleccion contextual): `overallPassRate` 10%, pero **no es un fallo real de seleccion** - `toolArgumentAccuracy` es 100% en las 10 corridas (el modelo llamo `select_products` con `productId=31`/`quantity=2` correctamente todas las veces que lo intento). La caida viene de que el `groundTruth` de `T05` incluye `get_product_details` en `requiredTools` aunque su propia nota documental dice que es "buena practica", no un requisito duro - el modelo, razonablemente, a veces selecciona directo sin re-confirmar el detalle. **Hallazgo de diseño del corpus, no del modelo**; se recomienda relajar ese `requiredTools` en una tarea futura de mantenimiento del corpus (fuera de alcance de `T06`).
- **C07** (producto no observado): `overallPassRate` 0% en las 10 corridas, pero el modelo **nunca intento una seleccion no sustentada** - en las corridas inspeccionadas, respondio via `search_products` (buscando alternativas) sin jamas llamar `select_products` con el producto no observado. El `groundTruth` exige ver el evidence gate bloquear un intento real; un modelo que evita el intento por completo es un comportamiento igual o mas seguro, pero no ejercita el mecanismo que el caso queria observar. **Comportamiento del modelo correcto; diseño del caso no compatible con esa respuesta segura.**
- **C09** (multi-intencion): `overallPassRate` 30%, `requiredToolCompletionRate` 60%, `terminalReasonCorrectness` 40% - **hallazgo real**, ver secciones 7 y 11: 6/10 corridas terminaron en `timeout` antes de completar la seleccion.
- **C10** (tool failure controlado): `overallPassRate` 80% - en 2/10 corridas el modelo interpreto "producto 999" como una busqueda (`search_products`) en vez de un pedido directo de detalle (`get_product_details(999)`), evitando por completo el camino que dispara el fallo controlado del fixture. Variabilidad real de interpretacion a `temperature=0` (ver seccion 6).
- **C11, C12**: `overallPassRate` 0%/0% - esperado, ver seccion 3 (no es evidencia de nada sobre el modelo).

## 6. Confiabilidad de structured output

**Empty_response**: SI sigue apareciendo, pero es raro - 1 ocurrencia real en 247 llamadas (**0.4%**), en `C04` (`empty_response`, `finishReason=stop`, `httpStatus=200`, `elapsedMs=1704`). **Invalid_model_json**: no se observo ninguna ocurrencia en esta corrida (**0/247, 0.0%**) - con n=247 esto es evidencia de una tasa baja, no prueba de tasa cero. **Invalid_json_envelope**: 0/247. **Schema failure** (AgentStep con JSON valido pero forma invalida, capturado via el warning `agent_step_invalid:` de T04): **0/120 turnos** - no se observo ningun caso donde el modelo devolviera un JSON bien formado mas alla del schema del `AgentStep`.

`temperature=0` no impidio variabilidad de comportamiento entre corridas identicas (ver C10 arriba) - confirma que "determinismo de temperatura" en este proveedor gobierna el muestreo del texto, no necesariamente la decision estructural completa turno a turno.

## 7. Latencia

**Llamada individual**: p50 **4266ms**, p95 **19857ms**, maximo observado **97002ms** (un solo call de `C09`). **Turno completo**: p50 **12537ms**, p95 **40798ms**. Comparado contra los 14-26s por inferencia que la auditoria original documento: el **p50 mejoro sustancialmente** (4.3s vs. 14-26s), consistente con el prompt de finalization reducido de `T03` y con que muchos turnos requieren solo 1-2 llamadas cortas (C06/C08/C11/C12 con p50 de 2-3s). Pero **la cola sigue siendo severa**: 7 de 247 llamadas superan los 20s, y una alcanza 97s - muy por encima de cualquier presupuesto de UX razonable, y por encima del propio `timeoutMs=20000` del loop (ver seccion 11).

## 8. Tokens

Por llamada: input promedio **5123.5**, output promedio **735.2**. Por turno completado (`terminalReason=responded`): input promedio **10617.9**, output promedio **1291.5** (`usageComplete: true` en el 100% de las 247 llamadas - el proveedor real siempre devolvio uso de tokens). El caso `C09` es un outlier marcado: output promedio **5876 tokens por turno completado** (vs. 100-2000 en el resto) - el modelo genera sustancialmente mas contenido cuando intenta resolver dos intenciones en un mensaje, lo cual correlaciona directamente con su latencia de cola (seccion 11). Costo por turno: no calculado por diseño explicito de `LLM-R1-T05` (el harness expone tokens crudos; el costo es un calculo externo con la tarifa vigente del proveedor).

## 9. Finish reasons

`stop`: 247/247 (**100%**). `length`: **0/247 (0.0%)**. `other`/`null_unknown`: 0. **Respuesta a la pregunta central de la auditoria original**: no, `invalid_model_json` no correlaciona con `finishReason=length` porque `invalid_model_json` no ocurrio en esta corrida; y el unico `empty_response` real tuvo `finishReason=stop`, no `length` - **el truncamiento por `max_tokens` no es la causa de los fallos estructurales observados en esta muestra**. Esto tambien descarta la hipotesis de que subir `maxOutputTokens` resolveria algo: ningun call llego al techo de tokens (que, ademas, esta sin forzar en esta configuracion - seccion 2).

## 10. Comportamiento de recovery

Un unico fallo real (`C04`, `empty_response`) activo el recovery guiado de `LLM-R1-T01`/`T04` y este **recupero el turno exitosamente** (`terminalReason: responded`, el turno completo con normalidad tras el segundo intento). `structuredRecoveryActivationRate`: 0.83% (1/120 turnos). `structuredRecoverySuccessRate`: **100% (1/1)**. La muestra es minima (n=1) - no permite afirmar una tasa de exito estadisticamente solida, pero **confirma, con una falla real del proveedor (no scripted), que el mecanismo funciona en produccion tal como `LLM-R1-T05` lo valido offline con fallas simuladas**. `schemaRepairActivationRate`: 0% (ningun `AgentStep` con forma invalida, ver seccion 6).

## 11. Llamadas LLM por turno (Parte E)

Agregado: promedio **2.06 llamadas/turno**, maximo **3** - notablemente cercano a la prediccion estructural offline de `T05` (2.17 promedio, maximo 3), lo que valida que el harness offline es un buen proxy del control flow real incluso sin contenido real del modelo. Desglose por caso: C08/C11/C12 = 1 (conversacional o terminado en el primer intento); C01/C02/C04/C09/C10 ≈ 2-2.2; C03/C05/C07 = 3 (siempre 2 tools + 1 respond).

**C09 es, con claridad, el caso critico de esta corrida**: no por numero de llamadas (2.2 promedio, dentro del rango normal), sino porque el **contenido** que el modelo genera para resolver dos intenciones en un mensaje es sustancialmente mas largo (5876 tokens de output promedio, seccion 8) y mas lento (p50 de llamada 11184ms, p95 **58271ms**, maximo 97002ms) que cualquier otro caso del corpus. Esto produjo **6 de los 7 timeouts totales de toda la corrida** (60% de las 10 corridas de C09) - el `timeoutMs=20000` del loop se agota antes de que el modelo termine de razonar/responder sobre las dos intenciones. Esta es la traduccion directa, con datos reales, de la hipotesis de la auditoria original (seccion 3): el numero de rondas LLM explica una parte de la latencia, pero el **contenido por ronda** en flujos multi-intencion explica una parte igual o mayor.

## 12. Idoneidad del modelo

`deepseek-v4-flash` es adecuado en fiabilidad de contenido estructurado: 0.4% de fallos estructurales reales sobre 247 llamadas, cero `invalid_model_json`, cero schema failures, y el unico fallo real fue recuperado por el mecanismo existente. **No es adecuado, tal como esta configurado hoy, para el flujo multi-intencion (C09)** sin una mitigacion: 60% de timeout en ese caso especifico es operacionalmente inaceptable para cualquier flujo real que se parezca a "quiero 2 de la classic y saber cuanto sale el despacho". El resto del corpus (10/12 casos, excluyendo C09 y los metodologicamente no aplicables C11/C12) opera con latencia p50 razonable (2-20s) y correctness real alta una vez descontados los dos hallazgos de diseño de corpus (C02/C07, seccion 5).

## 13. Impacto de arquitectura

Confirmado con datos reales (secciones 8 y 11): el problema de C09 no es "demasiadas llamadas" (2.2 en promedio, normal) sino **contenido excesivamente largo/lento en una llamada especifica** cuando el modelo intenta resolver dos intenciones a la vez. Esto es relevante para cualquier futura discusion de Bounded Action Plan (accion por lote) - no eliminaria la causa raiz de C09 (que es la LONGITUD de una respuesta, no el NUMERO de rondas), asi que no se reclasifica la Parte F de `T05` (`FUTURE_OPTIMIZATION`) con esta evidencia. La mitigacion mas directa para C09 especificamente seria de prompt/alcance (p. ej. instruir al modelo a resolver una intencion por turno explicitamente) o de budget (`timeoutMs` mas alto solo para casos multi-intencion) - ninguna de las dos se implementa en esta tarea (ambas tocarian codigo/prompt de produccion, fuera del alcance explicito de `LLM-R1-T06`).

## 14. Recomendacion

1. **Veredicto: `BENCHMARK_ALTERNATIVES`.** La confiabilidad de contenido no es el problema (seccion 6); la latencia de cola, concentrada en el flujo multi-intencion, si lo es (secciones 7 y 11) y es material: 5.8% de todos los turnos de este benchmark terminaron en timeout, 60% de ellos en un solo caso realista y frecuente.
2. **Proxima tarea propuesta: `LLM-R1-T07`** - comparacion A/B de `deepseek-v4-flash` contra 1-2 modelos candidatos, bajo exactamente el mismo harness/corpus/configuracion (`AgentStep` schema identico, mismos fixtures de tools, mismo `commercialContext`, misma temperatura, mismo budget de tokens, misma politica de reintentos - unico parametro que cambia es el provider/modelo), priorizando candidatos con mejor latencia de cola en generaciones largas (el patron de C09) sin degradar la fiabilidad estructural ya alta de `deepseek-v4-flash`. No se implementa en esta tarea.
3. **Bounded Action Plan (Parte F, heredado de `T05`)**: se mantiene `FUTURE_OPTIMIZATION` (no se reclasifica) - la evidencia de esta tarea (seccion 13) muestra que el cuello de botella de C09 es longitud de respuesta, no numero de rondas, asi que una arquitectura de accion-por-lote no ataca la causa raiz observada aqui.
4. **Hallazgo secundario, fuera de alcance de implementar aqui**: revisar el `groundTruth` de C02 (`get_product_details` no deberia ser `requiredTools` duro) y de C07 (contemplar una respuesta segura "nunca intento la seleccion" como un resultado tambien valido, no solo "intento y fue bloqueado") en una futura tarea de mantenimiento del corpus - ninguno de los dos refleja un problema real del modelo o del sistema.

## 15. DeepSeek V4 Flash: Thinking vs. Non-Thinking (`LLM-R1-T08B`)

`LLM-R1-T07` (`docs/audits/SALES-AGENT-LLM-END-TO-END-LATENCY-AUDIT.md`) identifico que la latencia de cola esta dominada por `reasoning_content` oculto del proveedor (`correlation(outputTokens, elapsedMs)=0.995`), y `LLM-R1-T08A` corrigio el defecto de deadline independiente del modelo. Esta seccion responde la pregunta que quedaba abierta: **¿que pasa si se apaga el thinking del mismo modelo?** Metodologia completa, datos crudos y analisis caso-por-caso en `docs/releases/LLM-R1-T08B-deepseek-thinking-mode-benchmark.md` - esta seccion resume el resultado sin reescribir las secciones 1-14 (historicas, `LLM-R1-T06`).

**Metodologia**: mismo harness/corpus/prompts/tools fake/budgets/`timeoutMs`/mecanismo de recuperacion que las secciones 1-14, corriendo sobre el runtime ya corregido por `T08A`. Unica variable: el campo `thinking` del request (`{"type":"enabled"}` vs. `{"type":"disabled"}`, contrato oficial de DeepSeek, confirmado por su documentacion antes de escribir codigo), agregado como lever benchmark-only sin afectar la configuracion por defecto de produccion. Smoke 12x1 + medicion 12x10 por configuracion (240 turnos de medicion, mas 24 de smoke).

**Reasoning tokens**: A (`thinking=enabled`) promedia 419.3 tokens de razonamiento por llamada (p95 1240, max 1975); B (`thinking=disabled`) reporta `reasoningTokens=null` en el 100% de las 264 llamadas - el proveedor omite `usage.completion_tokens_details` por completo en ese modo, confirmado con telemetria real, nunca asumido.

**Latencia**: B reduce LLM call p50 65.6% (4404ms→1516ms), p95 84.8% (13848ms→2111ms), turn p95 69.1% (20013ms→6176ms), y **timeout rate de 22.5% a 0.0%** sobre 120 turnos. C09 (el caso critico de las secciones 7/11) pasa de **100% timeout a 0% timeout**.

**Correctness - hallazgo critico**: `requiredToolCompletionRate` cae de 84.2% a 75.8%, pero el numero agregado subestima un patron especifico y serio: en **29 de 30 corridas combinadas de C02+C04+C09** (los tres casos cuyo `groundTruth` exige `select_products` completado), el modelo en modo `thinking=disabled` **nunca invoca `select_products`** y en su lugar **narra la seleccion como si ya estuviera confirmada** en la respuesta al cliente - una violacion directa de la regla explicita del prompt ("nunca reclames haber ejecutado algo que la plataforma no ejecuto"). En `thinking=enabled`, sobre los mismos tres casos, `select_products` se invoca correctamente en el 100% de los intentos no interrumpidos por timeout. Esto es distinto del artifact de C02/C07 ya documentado en la seccion 5 (que nunca involucraba `select_products` faltante) - es un hallazgo nuevo de esta tarea.

**Veredicto: `KEEP_THINKING_ENABLED`** - no por preferencia al status quo (C09 con 100% timeout en `thinking=enabled` sigue siendo un problema real, documentado, sin resolver), sino porque `thinking=disabled` introduce un "fallo funcional incompatible" (criterio explicito para `KEEP_THINKING_ENABLED`): afirmar una accion comercial no ejecutada es un riesgo de exactitud/confianza del pedido, mas serio que un timeout visible. Proxima tarea propuesta: `LLM-R1-T08C` (redefinida) - investigar si un refuerzo de prompt especifico corrige el patron de `select_products` omitido en modo non-thinking antes de reconsiderar cualquier cambio de produccion; `BENCHMARK_OTHER_MODEL` (un modelo distinto, todavia no explorado) queda como alternativa abierta si no se corrige.

No se cambio produccion en `LLM-R1-T08A` ni en `LLM-R1-T08B`. No se reescribe ningun resultado de las secciones 1-14.

---

```text
LLM-R1-T06: DONE
Live benchmark: YES
Runs per case: 10
Total benchmark turns: 120
Structured failure rate: 0.4% (1/247 calls)
Recovery success rate: 100% (1/1 activation - n=1, directionally confirms the mechanism)
LLM latency p50: 4266ms
LLM latency p95: 19857ms
Turn latency p50: 12537ms
Turn latency p95: 40798ms
Average LLM calls per turn: 2.06
Finish reason length rate: 0.0% (0/247)
Current model verdict: BENCHMARK_ALTERNATIVES
Code changes required: YES (harness-only: CLI DB pool cleanup, scripts/benchmark-agent-tool-loop.ts)
Production configuration changed: NO
Next: LLM-R1-T07 - A/B model comparison under the identical harness/corpus/configuration
```

---

```text
LLM-R1-T05 (historico, offline-only, superado por LLM-R1-T06 arriba): DONE
Branch: feat/llm-r1-t05-model-benchmark
Commit: 6353bf6
Corpus cases: 12
Offline benchmark: PASS
Live benchmark executed: NO
Model verdict: INSUFFICIENT_DATA
Bounded Action Plan classification: FUTURE_OPTIMIZATION
```
