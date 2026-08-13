---
title: LLM-R1-T08B — DeepSeek V4 Flash Thinking vs. Non-Thinking A/B Benchmark
doc_id: release-llm-r1-t08b-deepseek-thinking-mode-benchmark
status: implemented
owner: architecture
last_reviewed: 2026-08-13
source_of_truth_for:
  - the thinking A/B benchmark methodology, raw results, and verdict (LLM-R1-T08B)
  - the benchmark-only `thinking` provider lever and `reasoningTokens` observability contract
depends_on:
  - ../audits/SALES-AGENT-LLM-END-TO-END-LATENCY-AUDIT.md
  - ./LLM-R1-T07-end-to-end-latency-root-cause-audit.md
  - ./LLM-R1-T08A-provider-deadline-enforcement-fix.md
  - ../audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md
tags:
  - release
  - agent-loop
  - llm-provider
  - benchmark
  - latency
  - reliability
---

# LLM-R1-T08B — DeepSeek V4 Flash Thinking vs. Non-Thinking A/B Benchmark

Compara, bajo el mismo harness/corpus/config/runtime que `T05`/`T06`/`T08A`, `deepseek-v4-flash` con `thinking` habilitado (Configuracion A, reproduce el comportamiento de produccion) contra el mismo modelo con `thinking` deshabilitado (Configuracion B) - la unica variable experimental. No se compara otro modelo. No se cambio produccion.

## Que se construyo (Parte 1-2)

1. **Lever de `thinking`, benchmark-only** (`HttpAgentLoopProviderConfig.thinking?: "enabled" | "disabled"` en `httpAgentLoopProvider.ts`) - nunca tiene default; `undefined` omite el campo `thinking` del request por completo, byte-identico al comportamiento pre-T08B/produccion. `runNativeAutonomousCycle.ts` (unico caller de produccion) nunca lo setea - confirmado por lectura de codigo y por el test `[HP31]`. El campo real, per contrato oficial de DeepSeek (`api-docs.deepseek.com/api/create-chat-completion/`, verificado por fetch directo a la documentacion antes de escribir codigo), es un campo top-level `{"thinking": {"type": "enabled" | "disabled"}}` - default `enabled`, effort default `high`. `liveProvider.ts` agrega `BENCHMARK_LIVE_LLM_THINKING` (mismo gate estricto de literal-exacto que `BENCHMARK_LIVE_LLM_ENABLED`: solo `"enabled"`/`"disabled"` resuelven, cualquier otro valor se trata como ausente, nunca adivinado).
2. **Observabilidad de `reasoningTokens`**: `AgentLoopProviderResponse`/`AgentLoopProviderFailure`/`AgentLoopInferenceRecord`/`BenchmarkProviderCallRecord` ganan un campo `reasoningTokens: number | null` - solo el contador de `usage.completion_tokens_details.reasoning_tokens` (campo documentado oficialmente por DeepSeek). **`reasoning_content` (el texto de razonamiento) nunca se lee, nunca se declara en ningun tipo, nunca se loguea ni persiste** - confirmado por lectura de codigo (`OpenAiChatCompletionResponse` no declara ese campo) y por el test `[HP34]` (un marcador distintivo puesto en `reasoning_content` por un servidor de prueba nunca aparece ni en la respuesta devuelta ni en ninguna linea de `console.log`/`console.error` capturada durante la llamada).
3. **Bug de entorno encontrado y corregido antes de correr nada live**: MariaDB local (`crm-customer-360-mariadb`, contenedor Docker) estaba detenido (`ECONNREFUSED 127.0.0.1:3306`) - explicaba los 9 fallos "preexistentes" que arrastraba la suite completa desde `T08A`. Se reinicio el contenedor (accion local, reversible, sin tocar datos ni produccion); la suite completa paso a **461/461** verde. Ningun fallo de test era un defecto real de codigo.

## Configuracion (Parte 3-4, aislamiento)

Identico entre A y B salvo `thinking`: mismo modelo (`deepseek-v4-flash`), mismo endpoint (`api.deepseek.com`), misma cuenta/API key, mismo corpus C01-C12 (`tests/fixtures/agent-loop-benchmark/corpus.ts`, sin tocar fixtures), mismos prompts (`buildAgentStepPromptPackage.ts`, sin tocar), mismo contrato `AgentStep`, mismas tools fake/mock (`environment.ts`, Catalog Service local + Carrier MS fake + DB de test local), `temperature=0` en ambas (ver seccion "Temperature" abajo), `max_tokens` no forzado en ninguna (mismo comportamiento que T06/T07), `maxDecisions=3`/`maxToolExecutions=2` default, `timeoutMs=20000` default, mismo mecanismo de recuperacion estructural (T01) y reparacion guiada (T04), **mismo runtime corregido por T08A** (deadline real durante `response.json()`). 10 runs/caso en la medicion, igual que T06.

- **Smoke** (Parte 3): 12 casos x 1 run cada config. Confirmado con telemetria real (no asumido): A mostro `reasoningTokens` no-nulo en las 12/12 casos (rango 31-1561 en llamadas representativas); B mostro `reasoningTokens` null en las 12/12 (el proveedor omite `completion_tokens_details` por completo cuando `thinking:"disabled"`, no lo reporta en 0). Diferencia estructural confirmada antes de escalar - no fue necesario detener por `BLOCKED`.
- **Medicion** (Parte 4): 12 casos x 10 runs cada config = 120 turnos x 2 = **240 turnos de medicion**, mas los 24 del smoke. Sin ampliar mas alla de lo especificado.

## Resultados agregados (Parte 5 metricas obligatorias)

| Metrica | A (thinking=enabled) | B (thinking=disabled) |
|---|---|---|
| **Correctness** | | |
| successfulTurnRate | 77.5% | 100.0% |
| validAgentStepRate | 87.7% | 100.0% |
| toolSelectionAccuracy¹ | 84.2% | 75.8% |
| toolArgumentAccuracy | 91.7% | 75.8% |
| requiredToolCompletionRate | 84.2% | 75.8% |
| forbiddenToolInvocationRate | 0.0% | 0.0% |
| terminalReasonCorrectness | 69.2% | 91.7% |
| overallPassRate | 48.3% | 59.2% |
| **Structured reliability** | | |
| structuredFailureRate (invalid_response) | 1.2% | 0.0% |
| emptyResponseRate | 1.2% | 0.0% |
| invalidModelJsonRate | 0.0% | 0.0% |
| schemaFailureRate | 0.0% | 0.0% |
| structuredRecoveryActivationRate | 2.5% | 0.0% |
| structuredRecoverySuccessRate | 33.3% (n=3) | n/a |
| **Latencia** | | |
| LLM call p50/p95/max | 4404ms / 13848ms / 20012ms | 1516ms / 2111ms / 2473ms |
| turn p50/p95/max | 12058ms / 20013ms / 20021ms | 3268ms / 6176ms / 7688ms |
| timeoutTurnRate | 22.5% | 0.0% |
| **Tokens** | | |
| inputTokens/call avg (p50/p95) | 5187.3 (5381/5490) | 4977.9 (5302/5445) |
| completionTokens/call avg (p50/p95) | 456.3 (335/1315) | 42.3 (25/93) |
| reasoningTokens/call avg (p50/p95/max) | 419.3 (302/1240/1975), n=216/243 | null (n=0/264) |
| contentTokens/call (derivado, solo cuando ambos terminos conocidos) | 37.1, n=216 | no derivable (reasoningTokens siempre null) |
| inputTokens/turn avg | 9969.3 (n=93 turnos completados) | 10951.3 (n=120) |
| completionTokens/turn avg | 815.2 | 93.0 |
| reasoningTokens/turn avg | 737.8 | no derivable |
| **Calls** | | |
| LLM calls/turn avg/max | 2.02 / 4 | 2.20 / 4 |

¹ **Definicion operativa** (el enunciado no dio formula exacta, se documenta aqui): `toolSelectionAccuracy` = fraccion de turnos donde se completaron todos los `requiredTools` **y** nunca se invoco un `forbiddenTool` - distinto de `requiredToolCompletionRate` (ignora forbidden) y de `overallPass` (ignora argumentos/terminalReason). En este corpus, con `forbiddenToolInvocationRate=0.0%` en ambas configuraciones, coincide numericamente con `requiredToolCompletionRate`.

`usageComplete=false` en A (27/243 llamadas terminaron en timeout sin usage real, tokens null - nunca inventados) vs `true` en B (0 timeouts).

## C09 (Parte 5, caso prioritario)

| Metrica | A | B |
|---|---|---|
| successfulTurnRate | 0.0% | 100.0% |
| timeout rate | **100.0%** (10/10) | **0.0%** (0/10) |
| overallPassRate | 0.0% | 0.0% (ver hallazgo abajo - NO es el mismo tipo de fallo) |
| LLM call p50/p95/max | 11079ms / 20012ms / 20012ms | 1415ms / 2323ms / 2473ms |
| turn p50/p95 | 20010ms / 20015ms | 4593ms / 5462ms |
| reasoningTokens/call p50/p95/max | 1595 / 1975 / 1975 (n=7/17) | null (n=0/30) |
| completionTokens/call p50/p95/max | 1617 / 2001 / 2001 (n=7/17) | 25 / 107 / 114 (n=30/30) |
| toolArgumentAccuracy | 0.0% | 0.0% |

`toolArgumentAccuracy`/`overallPassRate` 0% en **ambas** - ver hallazgo critico abajo, C09 no queda resuelto, cambia el mecanismo de fallo.

## Hallazgo critico: `select_products` se omite y se narra como hecho, especifico de thinking-disabled

Inspeccionando los `steps` crudos (no solo los agregados) de C02, C04 y C09 - los tres casos del corpus cuyo `groundTruth` exige un `select_products` completado - aparece un patron sistematico, **nunca observado en Config A**, en **29 de 30 corridas combinadas de Config B** (C02: 9/10, C04: 10/10, C09: 10/10):

El modelo, sin razonamiento, ejecuta otras tools legitimas (`get_product_details`, `set_shipping_destination`) pero **nunca invoca `select_products`**, y en su respuesta final **narra la seleccion como si ya estuviera confirmada** ("Perfecto, 2 unidades de la Barra Olimpica Classic 20kg...") - una violacion directa de la regla del propio prompt ("You must never claim to have executed anything yourself - the platform executes tools, not you", `buildAgentStepPromptPackage.ts`). En Config A, sobre los mismos tres casos, `select_products` se invoca correctamente en el 100% de las corridas que no terminaron en timeout (30/30 intentos reales, ver `C02`/`C04` runs completos en el JSON crudo).

Contraste directo, mismo caso, mismo mensaje de cliente (C04, "cambiar la cantidad a 3"):

```text
A (10/10 runs): use_tool:select_products{productId:31,quantity:3}:completed -> respond
B (10/10 runs): respond:"Perfecto, te dejo 3 unidades..." (select_products NUNCA llamado)
```

Esto **no es el artifact de C02/C07 ya documentado en T06** (que trataba de `get_product_details` siendo un requisito de ground truth demasiado estricto, con `select_products` siempre correcto de fondo) - es un patron nuevo, distinto, y mas serio: el modelo confirma verbalmente una accion comercial (seleccion de productos) que nunca ejecuto en el backend. Para un agente comercial real esto es un riesgo de confianza/exactitud del pedido, no solo un numero de benchmark.

**C07 muestra un artifact de scoring nuevo, no una mejora real**: en Config B, el modelo repite la misma busqueda fallida 2-3 veces (bloqueada como `duplicate_tool_call`) antes de responder honestamente que no encontro el producto - eso dispara el chequeo generico de `scoreCase` ("al menos una observation con status blocked/failed") y produce `overallPass=true`, pero **nunca ejercita el evidence gate que C07 fue diseñado para observar** (el modelo sigue evitando por completo un intento de seleccion no sustentada, igual que en T06/Config A) - el "100% pass" de C07 en B es un falso positivo de scoring, no evidencia de que el modelo mejoro en ese mecanismo. No se cambio la fixture (per instruccion explicita de la tarea - la correccion queda registrada aqui, no implementada).

## Analisis causal (Parte 6)

**6.1 - Caida de reasoningTokens**: de 419.3/llamada (A) a **0/null (B)** - eliminado por completo, confirmado con telemetria real, no supuesto.

**6.2 - Caida de completionTokens**: de 456.3/llamada (A) a **42.3/llamada (B)** - reduccion de 90.7%.

**6.3 - Caida de LLM p50**: de 4404ms a **1516ms** - reduccion de 65.6% (-2888ms).

**6.4 - Caida de LLM p95**: de 13848ms a **2111ms** - reduccion de 84.8% (-11737ms).

**6.5 - Caida de turn p95**: de 20013ms a **6176ms** - reduccion de 69.1% (-13837ms).

**6.6 - Caida de timeout rate**: de 22.5% a **0.0%** - eliminado por completo en esta muestra de 120 turnos.

**6.7 - ¿Degradacion en tool correctness?** **Si, material y sistematica.** `requiredToolCompletionRate` cae 8.4pp en agregado (84.2%→75.8%), pero el numero agregado subestima la severidad real: es una caida concentrada y case-especifica (29/30 en C02/C04/C09 combinados) de un tipo de fallo nuevo y mas grave que el que reemplaza (narrar una accion comercial no ejecutada, no solo "elegir mal una tool"). Ver hallazgo critico arriba.

**6.8 - ¿Aumentan invalid_response/schema failures?** **No - disminuyen.** `invalidResponseRate` 1.2%→0.0%, `structuredRecoveryActivationRate` 2.5%→0.0%. Menos generacion (sin razonamiento oculto) deja menos superficie para fallos de truncamiento/formato.

**6.9 - ¿C09 deja de ser outlier?** **Parcialmente.** Como outlier de **latencia/timeout**: si, completamente (100%→0% timeout, p95 de llamada 20012ms→2323ms, en linea con el resto del corpus en B). Como outlier de **correctness**: no - sigue en 0% `overallPassRate` en ambas configuraciones, pero el mecanismo de fallo cambia por completo: en A falla por timeout catastrofico; en B completa rapido pero nunca invoca `select_products` y narra el resultado en su lugar (el mismo patron de la seccion anterior).

## Deadline (T08A) despues de la medicion (Parte 7)

```text
max provider call elapsedMs (A): 20012ms   (nominal timeoutMs=20000 - overshoot de 12ms, scheduling)
max turn elapsedMs (A):          20021ms   (overshoot de 21ms, scheduling)
max provider call elapsedMs (B): 2473ms
max turn elapsedMs (B):          7688ms
provider_timeout call count (A): 27/243 (instrumentedProvider y loop.llmCalls coinciden exactamente)
provider_timeout call count (B): 0/264
```

**Ninguna llamada excedio materialmente el deadline nominal** en 507 llamadas reales combinadas (243+264) - el overshoot maximo observado (12-21ms) es ruido de scheduling, no el patron pre-T08A (83641ms observado en `T07`, 4.2x el deadline). **T08A sigue respetado, sin regresion.**

## Temperature (Parte 8)

`temperature=0` configurado identico en A y B (mismo `SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT`, sin overrides). La documentacion oficial de DeepSeek (`api-docs.deepseek.com`) consultada para esta tarea no especifica una regla de interaccion `thinking`/`temperature` - no se encontro evidencia de que el modo thinking ignore `temperature` para este modelo. Ambas configuraciones completaron sus llamadas con `temperature=0` en el request sin ningun error 400 relacionado. No se ajusto `temperature` para compensar nada.

## Costo (Parte 9, sin tarifas inventadas)

```text
Config A: sum inputTokens=1,120,456  sum completionTokens=98,566  (de eso: reasoningTokens=90,562, contentTokens=8,004; n conocido=216/243 llamadas)
Config B: sum inputTokens=1,314,157  sum completionTokens=11,156  (reasoningTokens no reportado por el proveedor - n=0/264; completionTokens interpretable como contenido puro dado que thinking se confirmo apagado)
```

B uso mas llamadas totales (264 vs 243, `callsPerTurnAvg` 2.20 vs 2.02) - consistente con el hallazgo de la seccion anterior: sin razonamiento, el modelo a veces gasta su presupuesto de tools en llamadas que no son la requerida, en vez de ir directo a `select_products`. No se calculo costo en USD/CLP - ninguna tarifa oficial fue confirmada como parte de esta tarea; los tokens reportados arriba son suficientes para calcularlo despues con la tarifa vigente real.

## Veredicto (Parte 10)

**`KEEP_THINKING_ENABLED`**.

El criterio de `SWITCH_TO_THINKING_DISABLED` exige las cinco condiciones simultaneamente, incluida "correctness se mantiene materialmente" - **no se cumple**: el patron de `select_products` omitido-y-narrado-como-hecho (seccion "Hallazgo critico") es exactamente un "fallo funcional incompatible" (criterio explicito de `KEEP_THINKING_ENABLED`), reproducible en 29/30 corridas de tres casos distintos del corpus, no ruido.

Esto **no es una defensa del estado actual**: Config A tiene un problema real y documentado (C09 con 100% timeout en esta muestra, consistente con T06/T07) que sigue sin resolver. Ninguna de las dos configuraciones, tal como se probaron aqui, es apta para produccion sin trabajo adicional - la eleccion no es "A esta bien", es "B introduce un riesgo distinto y mas serio (afirmar una accion comercial no ejecutada) que A no tiene".

## Que sigue (Parte 11)

**No se cambia produccion en esta tarea** (confirmado: unico archivo de config afectado es el benchmark-only `thinking`, nunca seteado por `runNativeAutonomousCycle.ts`).

Dado que el veredicto es `KEEP_THINKING_ENABLED` (no `SWITCH`), la tarea `LLM-R1-T08C` originalmente propuesta ("Production Thinking Mode Configuration") no aplica tal como estaba planteada. Se propone en su lugar:

1. **`LLM-R1-T08C` (redefinida)**: investigar si el patron de `select_products` omitido en modo non-thinking es corregible con un refuerzo de prompt especifico (p. ej. una regla mas explicita e inmediatamente antes del cierre de turno: "si el cliente confirmo una seleccion, `select_products` debe haberse invocado ya - nunca la narres sin haberla ejecutado"), probado especificamente contra C02/C04/C09 en modo `thinking=disabled` bajo este mismo harness. Si se corrige, B vuelve a ser un candidato serio (resuelve C09 por completo en latencia/timeout sin el riesgo de correctness). Si no se corrige con prompt, evaluar `BENCHMARK_OTHER_MODEL` o una mitigacion especifica de C09 en runtime (fuera de alcance de esta tarea).
2. El defecto de deadline de `T08A` sigue confirmado sin regresion - no requiere trabajo adicional por ahora.

---

```text
LLM-R1-T08B: DONE

Model:
deepseek-v4-flash

A:
thinking=enabled

B:
thinking=disabled

Runs per case:
10

A reasoning tokens/call:
p50=302
p95=1240
max=1975

B reasoning tokens/call:
p50=null (provider omits completion_tokens_details entirely when thinking=disabled - confirmed via smoke+measurement telemetry, never assumed)
p95=null
max=null

A LLM latency:
p50=4404ms
p95=13848ms
max=20012ms

B LLM latency:
p50=1516ms
p95=2111ms
max=2473ms

A turn latency:
p50=12058ms
p95=20013ms

B turn latency:
p50=3268ms
p95=6176ms

A timeout rate:
22.5%

B timeout rate:
0.0%

A C09 timeout rate:
100.0%

B C09 timeout rate:
0.0%

A tool selection accuracy:
84.2%

B tool selection accuracy:
75.8%

A tool argument accuracy:
91.7%

B tool argument accuracy:
75.8%

A structured failure rate:
1.2%

B structured failure rate:
0.0%

T08A deadline respected:
YES

Production configuration changed:
NO

Verdict:
KEEP_THINKING_ENABLED

Next:
LLM-R1-T08C (redefined) - investigate a prompt-level fix for the select_products-skip/narrate-instead regression under thinking=disabled (C02/C04/C09), re-benchmark before reconsidering any production switch; BENCHMARK_OTHER_MODEL remains an open fallback if unresolved.
```
