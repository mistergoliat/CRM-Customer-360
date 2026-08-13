---
title: SALES-AGENT-LLM-END-TO-END-LATENCY-AUDIT — Agent Tool Loop Latency Root Cause Audit
doc_id: audit-sales-agent-llm-end-to-end-latency
status: audit_complete_no_production_change
owner: architecture
last_reviewed: 2026-08-13
source_of_truth_for:
  - root cause of Agent Tool Loop end-to-end latency (LLM-R1-T07)
  - the loop-deadline enforcement gap in httpAgentLoopProvider.ts
  - the hidden reasoning-token discrepancy behind T06's ~5876 output-token figure
depends_on:
  - ./SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md
  - ./SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md
  - ../releases/LLM-R1-T05-production-measurement-model-benchmark.md
  - ../releases/LLM-R1-T06-live-benchmark-model-decision.md
tags:
  - audit
  - sales-agent
  - agent-loop
  - llm-provider
  - latency
  - benchmark
---

# SALES-AGENT-LLM-END-TO-END-LATENCY-AUDIT (LLM-R1-T07)

Base esperada: `T01 4b2cf25 / T02 a7c4ac5 / T03 000a539 / T04 7aa7b41 / T05 1060d33 / T06 58020b0`.

Pregunta: `T06` concluyo `BENCHMARK_ALTERNATIVES` (confiabilidad estructural buena, latencia de cola mala) sin explicar **por que**. Esta auditoria descompone esa latencia en sus componentes reales, sin comparar modelos y sin tocar codigo de produccion.

## 1. Executive summary

La latencia de cola del Agent Tool Loop **no es un problema de tamano de prompt, de cantidad de round-trips, ni de ejecucion de tools**. Es, casi en su totalidad, **volumen de tokens de razonamiento oculto que el proveedor genera antes de la respuesta JSON util y que el runtime actual nunca lee, nunca loguea y nunca limita**, agravado por **un defecto real y confirmado en el mecanismo de deadline** que permite que una llamada ya en curso se extienda muy por encima del `timeoutMs` nominal en vez de cortarse.

Dos hallazgos, uno de proveedor y uno de runtime:

1. **(Proveedor, dominante)** `deepseek-v4-flash` devuelve un campo `reasoning_content` separado del `content` (JSON) que el AgentStep consume. `usage.completion_tokens_details.reasoning_tokens` confirma que ese razonamiento **se contabiliza dentro de `completion_tokens`** — el mismo numero que T06 reporto como "output tokens". El tipo `OpenAiChatCompletionResponse` de `httpAgentLoopProvider.ts` no declara `reasoning_content` ni `completion_tokens_details`; el runtime nunca lo ve. Confirmado con datos reales (seccion 6): `elapsedMs` correlaciona con `outputTokens` con **r=0.995** (n=21, corrida live fresca de esta auditoria) y con `inputTokens` con **r=-0.122** (sin correlacion). La velocidad de generacion efectiva es estable (~82-129 tok/s, media 102.1 tok/s) en TODAS las llamadas — la unica variable que cambia es cuantos tokens (razonamiento + contenido) el modelo decide generar.
2. **(Runtime, confirmado por lectura de codigo)** `httpAgentLoopProvider.ts:209` (`attemptSignal.cleanup()`) cancela el timer de abort **inmediatamente despues de que `fetch()` resuelve y antes de `response.json()`** (linea 227). Esto significa que, una vez que la respuesta HTTP empieza a llegar, **ninguna llamada esta protegida por ningun timeout** mientras se lee/parsea el cuerpo — que es exactamente donde vive el tiempo de generacion largo. Confirmado empiricamente: en la corrida fresca de C09 de esta auditoria, una sola llamada (`run 8`) tardo **83641ms**, mas de 4x el `timeoutMs=20000` nominal del turno completo, y siguio devolviendo `outcome: "success"` (nunca se clasifico como `provider_timeout`).

Ninguno de los dos hallazgos requiere cambiar de modelo para explicarse. El primero es una caracteristica del modelo/proveedor actual (no es un bug del repo); el segundo es un defecto real del repo, independiente del modelo, que debe corregirse sin importar que modelo se use.

**Veredicto de la Parte 12: `BOTH_IN_PARALLEL`** (seccion 12).

## 2. Evidencia de T06 (punto de partida)

`docs/audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md` (120 turnos, 247 llamadas live contra `deepseek-v4-flash`) ya establecio:

- `invalidResponseRate` 0.4%, `invalidModelJsonRate` 0%, `schemaFailureRate` 0% — confiabilidad de contenido alta.
- LLM call latency p50 4266ms / p95 19857ms / max **97002ms** (una sola llamada).
- Turn latency p50 12537ms / p95 40798ms.
- 7/120 turnos (5.8%) `terminalReason: timeout`; **6 de esos 7 en C09** (60% de sus 10 corridas).
- C09: output promedio **5876 tokens por turno completado** (vs. 100-2000 en el resto del corpus).
- `finishReason=length`: 0/247 — el truncamiento por `max_tokens` quedo descartado como causa.
- Llamadas por turno: promedio 2.06, maximo 3.

**Limitacion metodologica descubierta al iniciar esta auditoria**: T06 nunca ejecuto el CLI con `--out`, asi que no existe ningun `BenchmarkRunSummary` crudo por-llamada de esa corrida — solo los agregados ya publicados arriba. Autorizado explicitamente por el usuario, esta auditoria ejecuto una **corrida live nueva, focalizada en C09** (10 corridas, mismo harness/modelo/config exactos que T06 — `BENCHMARK_LIVE_LLM_ENABLED=true`, `--live --case=C09 --runs=10 --out=...`), capturando el `BenchmarkRunSummary` completo. Esto reproduce el patron de T06 (7/10 timeouts vs. 6/10 en T06 — misma direccion, ruido esperable con n=10) y da, por primera vez, granularidad real por-llamada (`phase`, `elapsedMs`, `inputTokens`, `outputTokens`, `finishReason`, `outcome`) para las secciones 3-10. Ademas se ejecuto un **probe crudo, gated, fuera del harness** (2 llamadas reales adicionales al mismo endpoint/modelo, reutilizando `buildAgentStepPromptPackage` sin modificarla, imprimiendo el body crudo del proveedor sin parsear) para resolver la Parte 4 (TTFT) y la Parte 5.4 (reasoning tokens) de forma directa. Script temporal, nunca commiteado, eliminado al terminar — cero cambios de codigo de produccion.

Donde esta auditoria usa datos de la corrida fresca de C09 en vez de los agregados de T06, se marca explicitamente. Para C01-C08/C10-C12 no existen datos crudos (ni de T06 ni de esta auditoria) y esas partes se marcan `INSUFFICIENT_DATA` para desglose por-llamada — los agregados publicados en T06 siguen siendo validos y se citan donde aplica.

## 3. Tamano del request (Parte 1)

Medido directamente con el probe crudo (fase `gathering`, primera decision de C09, mismo `buildAgentStepPromptPackage` sin modificar):

| | systemPrompt chars | userPrompt chars | total chars | inputTokens (real, provider) |
|---|---|---|---|---|
| C09 gathering, decisionIndex=0 | 25724 | 513 | 26237 | 5439 |

`~4.86 chars/token` en este prompt (system dominado por las reglas inmutables de `buildAgentStepPromptPackage.ts` — Layer 1/2 — mas la identidad del agente, layer 3-4; el user payload es compacto: `currentTime`, `customerMessage`, `commercialContext`, `recentCatalogContext`, `priorStepsThisTurn`).

**inputTokens por fase, corrida fresca de C09 (n=21 llamadas reales)**:

| fase | n | inputTokens p50 | p95 | max |
|---|---|---|---|---|
| gathering | 18 | 5439 | 5537 | 5537 |
| finalization | 3 | 3598 | 3598 | 3598 |

El prompt de `finalization` es ~1841-1939 tokens mas chico que `gathering` (consistente con `LLM-R1-T03`, que elimino las lineas de invocacion de tools que finalization no puede usar). El input NO crece de forma relevante segun `decisionIndex`/`priorSteps` en esta muestra (5439/5493/5537 — variacion de ~100 tokens entre la 1ra, 2da y 3ra decision), porque `priorStepsThisTurn` solo agrega observaciones ya compactas (`summarizeObservation`), nunca el prompt completo previo.

**Fases "structured repair"/"schema repair" (Parte 1)**: `INSUFFICIENT_DATA` para tamano de prompt real — ni T06 ni la corrida fresca de C09 activaron ningun repair (`structuredRecoveryActivationRate` 0.83%/1 en 120 turnos en T06; 0/10 en esta corrida de C09). Por diseño de codigo (`buildAgentStepPromptPackage.ts`, `buildPriorAttemptFailureLines`), un repair NO es una fase nueva — es la MISMA fase (`gathering` o `finalization`) con 3-4 lineas extra al inicio del system prompt (`"Your previous response was structurally invalid..."` o `"Your previous AgentStep was rejected: reason=..."`) y `attempt>0` en el mismo `decisionIndex`/attempt slot. El costo estructural de un repair es, por diseño, marginal (+3-4 lineas de texto) — el riesgo de latencia de un repair no viene del tamano del prompt, viene de que consume OTRA llamada completa al proveedor (ver seccion 9).

## 4. Analisis de tokens (Parte 1, Parte 6)

**outputTokens por fase, corrida fresca de C09 (n=21)**:

| fase | n | outputTokens p50 | p95 | max |
|---|---|---|---|---|
| gathering | 18 | 1186 | 8082 | 8082 |
| finalization | 3 | 3082 | 3157 | 3157 |

El AgentStep JSON real que el loop consume es **trivial** en todos los casos observados: `{"type":"use_tool","tool":"set_shipping_destination","arguments":{"destination":"Ñuñoa"}}` (89 caracteres, ~25-30 tokens) o similar para cada `use_tool`; los 3 `respond` de finalization miden 275-297 caracteres (~70-90 tokens). Ningun AgentStep observado se acerca a explicar 500-8082 tokens de `completion_tokens` reportados por el proveedor para esa misma llamada.

**Causa raiz, confirmada con el probe crudo (no hipotesis)**: el body crudo de la API (nunca antes inspeccionado por este repo) trae:

```json
"message": {
  "content": "{\"type\":\"use_tool\",\"tool\":\"set_shipping_destination\",\"arguments\":{\"destination\":\"Ñuñoa\"}}",
  "reasoning_content": "We need respond to customer message... [685 tokens de razonamiento en prosa, en ingles, replanteando la politica completa del prompt] ...Let's output use_tool with set_shipping_destination destination \"Ñuñoa\"."
},
"usage": {
  "prompt_tokens": 5439,
  "completion_tokens": 711,
  "completion_tokens_details": { "reasoning_tokens": 685 }
}
```

`completion_tokens` (711) = `reasoning_tokens` (685) + el contenido real (~26 tokens). El tipo `OpenAiChatCompletionResponse` en `httpAgentLoopProvider.ts` (lineas 25-33) declara solo `choices[].message.content` y `usage.{prompt_tokens,completion_tokens}` — nunca `reasoning_content` ni `completion_tokens_details`. `parseModelJson`/`extractFirstJsonObject` (`lib/brain/commercial/shared/parseModelJsonOutput.ts:13-48`) busca el primer `{` y devuelve el objeto balanceado — si el modelo antepusiera el razonamiento dentro del mismo campo `content` (no es el caso aqui: DeepSeek lo separa en `reasoning_content`), tambien se descartaria en silencio. En ambos casos el resultado es el mismo: **el runtime nunca ve, nunca loguea, nunca limita el razonamiento — solo paga su tiempo de generacion.**

Segundo probe (mismo prompt, `stream:true`, para aislar el efecto): **4203 tokens de razonamiento**, `completion_tokens` total 4229, **40505ms** de principio a fin. Confirma que el fenomeno no es un evento raro de una sola corrida — es reproducible con el mismo prompt exacto.

**Respuesta a la Parte 6 (max_tokens)**: `httpAgentLoopProvider.ts:141` — `maxOutputTokens` nunca tiene default; si `config.maxOutputTokens === undefined`, la linea 188 omite `max_tokens` del body por completo (`...(maxOutputTokens !== undefined ? { max_tokens: maxOutputTokens } : {})`). En T06, `resolveLiveBenchmarkProviderConfig()` (`liveProvider.ts:58,68`) solo agrega `maxOutputTokens` si `BENCHMARK_LIVE_LLM_MAX_OUTPUT_TOKENS` esta seteada en el entorno — **no lo estaba** (confirmado, ver seccion 2 y el `.env` real de este entorno, misma variable ausente en esta auditoria). **No hay contradiccion que explicar entre `max_tokens=1024` y `outputTokens≈5876`: el `1024` de `SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT` nunca se envio en T06 ni en esta auditoria — el request no llevo `max_tokens` en absoluto.** El techo de output efectivo lo pone el proveedor (desconocido/no documentado en este repo), y como el razonamiento se contabiliza dentro del mismo presupuesto de `completion_tokens`, un techo real (si se configurara) cortaria razonamiento y contenido indistintamente segun cual se genere primero — riesgo real para la Parte 11.

**T06 effective max_tokens: no enviado (omitido del request).**

## 5. Correlaciones de latencia (Parte 2, Parte 3)

Datos reales, n=21 llamadas, corrida fresca de C09 de esta auditoria (unica corrida con datos crudos disponibles — ver seccion 2 para el alcance):

```text
correlation(inputTokens, elapsedMs)  = -0.122   (sin correlacion)
correlation(outputTokens, elapsedMs) =  0.995   (casi lineal)
correlation(totalTokens, elapsedMs)  =  0.962   (arrastrada casi enteramente por outputTokens)
```

`inputTokens` varia poco en esta muestra (5439-5537 en gathering, 3598 fijo en finalization) asi que su rango de variacion es demasiado chico para producir una correlacion fuerte incluso si importara un poco — pero el signo negativo y la magnitud (-0.122) descartan que el tamano de prompt sea un driver relevante de la cola de latencia observada. Esto es consistente con el 96.5%-98.8% `prompt_cache_hit_tokens` observado en el probe crudo: el proveedor ya cachea el prefijo estatico del prompt (identico entre llamadas del mismo tipo de fase) — el "prompt processing" (componente B del enunciado) ya es barato en la practica actual, sin que este repo haya implementado nada explicito para lograrlo.

**Los outliers de latencia tienen mucho output, no mucho input, no ambos.** Las 2 llamadas mas lentas de la muestra (83641ms/70001ms) tienen inputTokens identico al resto de su fase (5439) y outputTokens extremo (8082/7407) — input constante, output variable, latencia sigue al output.

**Tokens/segundo efectivo end-to-end** (Parte 3 — `outputTokens / elapsedSeconds`, marcado explicitamente como NO equivalente a velocidad de decode pura del proveedor, incluye TTFT/input-processing/red):

```text
n=21, rango 81.8-128.9 tok/s, media 102.1 tok/s
```

La estabilidad de este numero (82-129, sin outliers de "muy lento por token" ni "muy rapido por token") es la evidencia clave: **no hay ninguna llamada con "poco output pero muy lenta" ni "mucho output pero muy rapida"** — el patron "100 tokens/18s vs. 5000 tokens/18s" que la tarea pedia distinguir explicitamente NO aparece en esta muestra. Todas las llamadas decodifican a una tasa comparable; lo unico que cambia es cuanto deciden generar.

## 6. C09 deep dive (Parte 5)

Corrida fresca, 10 corridas, 21 llamadas reales, mismo caso/config que T06 (C09: `"quiero 2 de la classic y saber cuanto sale el despacho a Ñuñoa"`).

| run | terminalReason | totalElapsedMs | llmCalls (fase, elapsedMs, out) | tool steps |
|---|---|---|---|---|
| 0 | responded | 32088 | gathering 5985ms/522, gathering 6882ms/695, finalization 19181ms/2472 | get_product_details✓, set_shipping_destination✗ |
| 1 | responded | 38222 | gathering 5675ms/543, gathering 5903ms/483, finalization 26630ms/3157 | set_shipping_destination✗, get_product_details✓ |
| 2 | **timeout** | 26018 | gathering 12247ms/1293, gathering 13765ms/1389 | set_shipping_destination✗, set_shipping_destination(blocked, dup) |
| 3 | **timeout** | 27778 | gathering 14580ms/1480, gathering 13185ms/1353 | get_product_details✓, select_products✗ |
| 4 | **timeout** | 27778 | gathering 7913ms/767, gathering 19860ms/2048 | set_shipping_destination✗, set_shipping_destination(blocked, dup) |
| 5 | responded | 46905 | gathering 9373ms/950, gathering 8049ms/831, finalization 29470ms/3082 | get_product_details✓, set_shipping_destination✗ |
| 6 | **timeout** | 36877 | gathering 12123ms/1071, gathering 24747ms/2626 | set_shipping_destination✗, get_product_details✓ |
| 7 | **timeout** | 27575 | gathering 12323ms/1186, gathering 15247ms/1793 | set_shipping_destination✗, set_shipping_destination(blocked, dup) |
| 8 | **timeout** | 83647 | gathering **83641ms/8082** (unica llamada) | set_shipping_destination✗ |
| 9 | **timeout** | 70006 | gathering **70001ms/7407** (unica llamada) | set_shipping_destination✗ |

(`✗` = `set_shipping_destination` fallo — la version fresca de C09 corre contra el Catalog/DB mock local de esta auditoria, cuyo destino "Ñuñoa" no resolvio en esta sesion (`errorCode` de comuna, fuera del alcance de esta auditoria de latencia); no afecta ninguna de las conclusiones de tokens/tiempo, que dependen solo de `llmCalls`.)

**7/10 timeouts** (T06: 6/10) — misma severidad, misma direccion.

### 5.1 — ¿Una unica llamada o el agregado del turno?

**Ambos patrones ocurren, con datos reales de ambos**: `run 8`/`run 9` son una **unica llamada** (8082/7407 output tokens en una sola invocacion — esto por si solo ya excede cualquier presupuesto razonable). `run 2/3/4/6/7` son **acumulacion de 2 llamadas** (cada una individualmente mas modesta — 1071-2626 tokens — pero la suma cruza el deadline de turno). El "5876 tokens" que T06 reporto como promedio por turno **es compatible con ambos mecanismos superpuestos** en su muestra de 10 corridas.

### 5.2 — ¿En que fase ocurre?

**En ambas, no es especifico de una fase.** De las 21 llamadas de esta muestra, 18 son `gathering` y 3 son `finalization` (proporcion normal dado que solo 3/10 corridas llegaron a finalizar). El fenomeno de razonamiento oculto aparece en las 21 sin excepcion (outputTokens minimo observado: 483, incluso la llamada "mas barata" de la muestra ya excede por mucho lo que su AgentStep de 79-89 caracteres necesitaria). `finalization`, pese a tener prompt mas chico (seccion 3), no es inmune: sus 3 llamadas promedian **2903 output tokens** (2472/3157/3082) para un `message` final de 250-300 caracteres.

### 5.3 — ¿Que tipo de AgentStep intenta producir?

Siempre trivial: `use_tool` de un solo argumento (`set_shipping_destination{destination}`, `get_product_details{productId}`, `select_products{items}` con 1 item) o `respond{message}` de 1-2 oraciones. Cero correlacion entre la complejidad del AgentStep resultante y el volumen de tokens generados — el AgentStep mas caro observado (8082 tokens, `run 8`) produjo exactamente el mismo `use_tool` de 89 caracteres que el mas barato (`run 1`, 483 tokens).

### 5.4 — ¿Por que un contrato de salida pequeño consume miles de tokens? (evidencia vs. hipotesis)

**Confirmado (evidencia directa, probe crudo, seccion 4)**: el proveedor devuelve `reasoning_content` como campo separado de `content`, y `usage.completion_tokens_details.reasoning_tokens` confirma que esos tokens de razonamiento se suman dentro de `completion_tokens` — el mismo numero que T02/T05/T06 reportan como "output tokens" del turno. Esto es "modelo generando pensamiento antes del JSON" + "API contabilizando hidden reasoning dentro de usage" de la lista de indicios del enunciado, ambos confirmados, no hipoteticos.

**Descartado por evidencia directa**: prosa excesiva dentro de `message` (el `message` final siempre es corto, 250-300 caracteres); JSON gigante (el AgentStep parseado siempre es de 79-297 caracteres); repeticion del contexto (el `reasoning_content` observado es prosa nueva de planificacion, no una copia del prompt); multiples acciones narradas en una respuesta (el AgentStep sigue siendo de una sola accion, tal como exige el contrato); malformed-but-parseable structures (`validAgentStepRate` 100% en esta muestra); campos adicionales tolerados en el AgentStep (no se observaron).

**No confirmable sin instrumentacion adicional (fuera de alcance de esta auditoria)**: si `deepseek-v4-flash` puede configurarse para desactivar o acotar `reasoning_content` via algun parametro del proveedor (esfuerzo/presupuesto de razonamiento) — no se encontro ni se probo ningun parametro de ese tipo en el request actual (`temperature`, `max_tokens` opcional, `response_format` son los unicos campos que `httpAgentLoopProvider.ts` envia). Confirmar esto requeriria documentacion del proveedor o pruebas adicionales explicitamente fuera del alcance de "no cambiar produccion" de esta tarea.

## 7. Discrepancia de max_tokens (Parte 6)

Ya resuelta en la seccion 4: **no hubo discrepancia real que explicar** — `max_tokens` nunca se envio (ni en T06 ni en esta auditoria), asi que no existe ningun techo de `1024` contra el cual comparar `outputTokens≈5876`. El hallazgo real de esta seccion es distinto y mas importante: **incluso si se configurara un `max_tokens`, cortaria indistintamente razonamiento y contenido**, porque ambos comparten el mismo presupuesto de `completion_tokens` del lado del proveedor y el runtime actual no tiene forma de pedir "solo limita el razonamiento, nunca el JSON final" — ver Parte 11.

## 8. Descomposicion de timeouts (Parte 7)

`DEFAULT_TIMEOUT_MS=20000` (`runAgentToolLoop.ts:62`) es un **deadline unico por turno** (no por llamada, no por fase): `const deadline = Date.now() + timeoutMs;` se calcula **una sola vez** al entrar a `runAgentToolLoop` (linea 496) y se reusa, sin recalcular, en cada invocacion de `invokeProviderWithDeadline` a lo largo de gathering Y finalization, incluidos los reintentos de recuperacion estructural/schema repair. El chequeo `if (Date.now() > deadline)` al inicio de cada iteracion del loop (lineas 629, 798) solo decide si **arrancar una llamada nueva** — nunca corta una ya en curso.

### Defecto confirmado: la llamada en curso no se corta al llegar el deadline

`httpAgentLoopProvider.ts` recibe `options.timeoutMs` (el tiempo restante hasta el deadline absoluto) y arma su propio `AbortController` (`buildAttemptSignal`, lineas 101-116) con un timer para ese `timeoutMs`. Pero:

```ts
// httpAgentLoopProvider.ts:176-209 (resumido)
const attemptSignal = buildAttemptSignal(options.signal, remainingMs);
let response: Response;
try {
  response = await fetchImpl(endpoint, { ..., signal: attemptSignal.signal, body: ... });
} catch (error) {
  attemptSignal.cleanup();
  ...
}
attemptSignal.cleanup();   // <-- linea 209: se ejecuta ANTES de response.json()
if (!response.ok) { ... }
let data;
try {
  data = (await response.json()) as OpenAiChatCompletionResponse;   // <-- linea 227
} catch { ... }
```

`attemptSignal.cleanup()` (linea 209) llama `clearTimeout(timer)` y remueve el listener del signal externo (`invokeProviderWithDeadline`'s propio controller, cuyo `.abort()` — si llegara a dispararse — ya no tiene a quien notificar). Esto ocurre **inmediatamente despues de que `fetch()` resuelve y antes de leer/parsear el body** (`response.json()`, donde vive el tiempo real de generacion largo para una respuesta no-streaming). Una vez que `cleanup()` corrio, **no queda ningun timer activo** — `response.json()` no tiene absolutamente ninguna proteccion de timeout, sin importar cuanto tarde.

Esto explica, con certeza (no como hipotesis), por que se observan llamadas que exceden por mucho su presupuesto nominal: `run 8` de la corrida fresca de C09 tomo **83641ms** con un presupuesto de turno completo de 20000ms (4.2x el limite) y aun asi se clasifico `outcome: "success"`, nunca `provider_timeout`. El maximo historico de T06 (97002ms) es consistente con el mismo mecanismo.

### Clasificacion de los 7 timeouts observados (Parte 7)

| run | mecanismo | clasificacion |
|---|---|---|
| 8 | 1 llamada, 83641ms (4.2x el deadline de turno), reasoning-driven | **LONG_GENERATION** |
| 9 | 1 llamada, 70001ms (3.5x el deadline de turno), reasoning-driven | **LONG_GENERATION** |
| 2 | 2 llamadas, 12247+13765=26012ms; la 2da corrio 6012ms mas alla de su propio presupuesto restante (~7753ms) sin abortar | **MULTI_ROUND_ACCUMULATION + DEADLINE_BUDGET_INTERACTION** |
| 3 | 2 llamadas, 14580+13185=27765ms; ninguna individualmente extrema, pero la suma nunca fue protegida por-llamada | **MULTI_ROUND_ACCUMULATION + DEADLINE_BUDGET_INTERACTION** |
| 4 | 2 llamadas, 7913+19860=27773ms; la 2da corrio ~7773ms mas alla de su presupuesto restante (~12087ms) | **MULTI_ROUND_ACCUMULATION + DEADLINE_BUDGET_INTERACTION** |
| 6 | 2 llamadas, 12123+24747=36870ms; la 2da corrio ~16870ms mas alla de su presupuesto restante (~7877ms) | **MULTI_ROUND_ACCUMULATION + DEADLINE_BUDGET_INTERACTION** |
| 7 | 2 llamadas, 12323+15247=27570ms; la 2da corrio ~7570ms mas alla de su presupuesto restante (~7677ms) | **MULTI_ROUND_ACCUMULATION + DEADLINE_BUDGET_INTERACTION** |

```text
SLOW_FIRST_RESPONSE: 0
LONG_GENERATION: 2
MULTI_ROUND_ACCUMULATION: 5
DEADLINE_BUDGET_INTERACTION: 5 (superpuesto con los 5 de arriba - mismo mecanismo de codigo en todos los casos multi-llamada)
UNKNOWN: 0
```

Cero casos `SLOW_FIRST_RESPONSE`: el probe crudo (seccion 4) midio TTFT real en **626ms** (tiempo a primer chunk de stream, con el razonamiento ya empezando a fluir de inmediato) — el problema nunca es "tarda en empezar a responder", siempre es "una vez que empieza, genera miles de tokens de razonamiento antes de terminar".

## 9. Contribucion de tools/runtime (Parte 8)

Formula de residual (Parte 10), aplicada a los 10 turnos de la corrida fresca de C09:

```text
sum(LLM elapsedMs) = 416780ms
sum(totalElapsedMs) = 416894ms
residual = 114ms (0.03%)
```

**LLM: ~99.97%. Tools/runtime local: ~0.03%.** Esto reemplaza cualquier supuesto heredado de smokes anteriores (el enunciado pedia explicitamente no asumir "<1%" sin medir) — medido con el harness actual, en este entorno aislado, el tiempo de tools es functionally cero.

**Limite honesto de esta medicion**: el entorno del harness (`environment.ts`, `LLM-R1-T05`) usa un Catalog Service mock HTTP local en `127.0.0.1` y un Carrier MS fake inyectado directamente — nunca la red real de produccion. En produccion, `get_product_details`/`select_products`/`set_shipping_destination`/`calculate_shipping` golpean servicios reales (Catalog Service, Carrier MS, DB) sobre la red real, con latencia que este benchmark no puede medir. El 0.03% es valido para "cuanto pesa la orquestacion/logica local del loop en si misma" (Parte I del enunciado, "tools/capabilities" como componente del loop), no una promesa de que el tiempo de red real de produccion tambien sea insignificante.

## 10. Contribucion de round-trips (Parte 9)

`llmCallsPerTurnAvg` de C09 (T06: 2.2; esta corrida: 2.10) esta dentro del rango normal del corpus (T06: 1-3 llamadas/turno segun el caso). El "costo marginal de una llamada adicional" **no es una constante fija** en este workload: cada llamada adicional arrastra su propio riesgo independiente de razonamiento largo (seccion 5/6) ademas de un costo fijo de red/prompt-processing observado en ~600-1000ms (TTFT + prompt ya mayormente cacheado por el proveedor, seccion 5).

```text
costo_fijo_por_llamada ≈ 600-1000ms (TTFT, prompt processing con ~97% cache hit)
costo_variable_por_llamada ≈ (reasoning_tokens + content_tokens) / ~102 tok/s (empirico, seccion 5)
```

Para C09 especificamente, cada decision (`decisionIndex=0`, `1`, la finalization) dispara un episodio de razonamiento independiente del tamano observado (483-8082 tokens) — el problema de C09 no es que necesite 2-3 llamadas (numero normal), es que **cada una de esas llamadas tiene su propia probabilidad de generar miles de tokens de razonamiento**, y una arquitectura de menos round-trips (Bounded Action Plan) reduciria la CANTIDAD de episodios de razonamiento arriesgados, no elimina el riesgo por episodio. Esto confirma, con un mecanismo causal nuevo, la conclusion ya alcanzada por T06 seccion 13 (el problema de C09 es longitud de respuesta, no numero de rondas) — pero anade que reducir rondas SI ayuda de forma indirecta (menos oportunidades de que el razonamiento se dispare), sin ser la causa raiz.

## 11. Modelo de latencia end-to-end (Parte 10)

```text
TurnTime ≈ Σ ProviderCallElapsedMs + Σ ToolElapsedMs + LocalOverheadMs
```

Verificado con datos reales (seccion 9): `Σ ToolElapsedMs + LocalOverheadMs` = 114ms sobre 416894ms totales (0.03%) — la formula se cumple casi exactamente en este entorno. Residual material: **no**, no requiere investigacion adicional.

Descomponiendo `ProviderCallElapsedMs` con los datos de la seccion 5:

```text
ProviderCallElapsedMs ≈ TTFT(~600-1000ms, ya con prompt cacheado)
                        + (reasoning_tokens + content_tokens) / ~102 tok/s
```

Este es el modelo empirico completo: **el 99.97% de `TurnTime` es `ProviderCallElapsedMs`, y el 100% de la variabilidad de `ProviderCallElapsedMs` (r=0.995) sigue el volumen de tokens generados por el proveedor, dominado por razonamiento oculto no observado por el runtime hasta esta auditoria.**

## 12. Candidatos de optimizacion (Parte 11)

| Candidato | Evidencia | Impacto esperado | Riesgo de correctness | Impacto arquitectonico | Clasificacion |
|---|---|---|---|---|---|
| **Corregir el orden de `attemptSignal.cleanup()`** para que el deadline proteja tambien `response.json()` (p.ej. envolver la lectura del body en la misma carrera de abort, o mover `cleanup()` a un `finally` que abarque tambien el parseo) | Confirmado por lectura de codigo + reproducido con datos reales (83641ms vs. deadline de 20000ms) | Alto: convierte `timeoutMs=20000` en un contrato real en vez de uno que se puede violar 4x; acota el peor caso | Bajo — es una correccion de un bug de timing, no un cambio de contrato/API | Bajo — cambio local a `httpAgentLoopProvider.ts` | **P0** |
| **Investigar si el proveedor/endpoint expone un control de esfuerzo de razonamiento** (parametro tipo reasoning-effort/thinking-budget) antes de asumir que hay que cambiar de modelo | Confirmado que `reasoning_tokens` domina la latencia (r=0.995); no se encontro ni probo ningun parametro de control en el request actual | Muy alto si existe y es configurable (ataca la causa raiz real, no un sintoma) | Depende del parametro — desconocido sin documentacion del proveedor | Bajo si es un parametro de request; requiere una tarea de investigacion propia | **P0** (investigar, no implementar aqui) |
| `max_tokens` como techo duro | `finishReason=length` 0/247 en T06, 0/21 en esta corrida — nunca se alcanzo un techo porque nunca se envio uno | Incierto/riesgoso: un techo cortaria razonamiento y contenido indistintamente (mismo presupuesto de `completion_tokens`) — podria cortar el JSON final a mitad de generacion si el razonamiento ya consumio el techo | Alto — un corte a mitad del JSON rompe `parseModelJson`, dispara `invalid_model_json`/recovery en vez de resolver latencia | Bajo (un parametro) pero requiere testing extenso antes de cualquier cambio de produccion | **P1** (candidato, no implementar sin testing dedicado) |
| Reducir round-trips (Bounded Action Plan) | Seccion 10: cada round-trip adicional arrastra su propio riesgo de razonamiento largo, independientemente del numero total | Medio — reduce la CANTIDAD de episodios de riesgo, no el riesgo por episodio | Medio — ya evaluado y diferido en T05/T06 por motivos de diseño de accion-por-lote | Alto — rearquitectura del contrato AgentStep/loop | **P1** (ya identificado en T05/T06, esta auditoria no cambia esa clasificacion) |
| Reduccion adicional de prompt (mas alla de T03) | `correlation(inputTokens, elapsedMs) = -0.122` — sin correlacion; input ya ~97-99% cacheado por el proveedor | Bajo | Bajo | Bajo | **NOT_JUSTIFIED** |
| Prefix/prompt caching explicito | Ya esta ocurriendo automaticamente del lado del proveedor (96.5%-98.8% `prompt_cache_hit_tokens` observado sin ningun trabajo de este repo) | Bajo — poco margen adicional sobre lo que el proveedor ya hace solo | Bajo | Bajo | **NOT_JUSTIFIED** |
| TTFT optimization | TTFT medido en 626ms — ya rapido, no es el cuello de botella (seccion 5, Parte 4) | Ninguno | N/A | N/A | **NOT_JUSTIFIED** |
| Streaming de produccion | Permitiria medir TTFT en produccion y, potencialmente, abortar a mitad de un razonamiento fuera de presupuesto — pero es un cambio de arquitectura del provider/parseo (`parseModelJson` espera un string completo) | Medio-alto si se combina con un budget de razonamiento | Medio — cambia el contrato interno del provider | Alto | **P2** (candidato para una tarea de arquitectura futura, no aqui) |
| Separar planner y responder | Gathering y finalization ya son fases separadas; el problema no es falta de separacion, es volumen de razonamiento dentro de CUALQUIER fase (seccion 6.2 — finalization tambien lo sufre) | Bajo | N/A | N/A | **NOT_JUSTIFIED** |
| Respuesta deterministica tras tool success | Aplicable solo a flujos de una sola tool + respond trivial; no ataca C09 (multi-intencion) | Bajo-medio, acotado | Medio — cambia cuando el loop llama al modelo | Medio | **P2** |
| Timeout policy (per-call en vez de per-turno) | El deadline per-turno ya es la causa de que un timeout tardio (`run 8`, 83641ms) consuma TODO el presupuesto de una sola llamada, dejando cero margen para una 2da decision | Medio-alto, combinado con la correccion P0 de arriba | Medio — cambia el contrato de tiempo del loop, requiere decidir el nuevo default | Medio | **P1** |
| Model change | Ver seccion 13 — el driver dominante (razonamiento oculto) es una caracteristica del modelo/proveedor actual; no descartado, pero no es lo primero a intentar dado que hay una correccion de runtime P0 con impacto claro y sin riesgo de regresion de confiabilidad | Potencialmente alto si un modelo candidato no tiene razonamiento oculto no controlable | Ninguno para ESTA tarea (no se cambia modelo) | N/A | Ver `LLM-R1-T08` propuesto en seccion 14 |

## 13. Conclusion modelo-vs-runtime (Parte 12)

El criterio de la tarea:

- **`MODEL_BENCHMARK_NOW`** aplica "si la mayor parte de la latencia esta dentro del provider y no depende de nuestro output/prompt/round architecture" — **cierto aqui**: r=0.995 con `outputTokens` (dominado por `reasoning_tokens` del proveedor, seccion 4), r=-0.122 con `inputTokens` (nuestro prompt no es el driver), y el numero de rondas (2.1 promedio) esta dentro de lo normal del corpus.
- **`OPTIMIZE_RUNTIME_FIRST`** aplica "si el problema dominante es... deadline interno" — **tambien cierto aqui**: el defecto confirmado de `attemptSignal.cleanup()` (seccion 8) es 100% nuestro, independiente del modelo, y hace que CUALQUIER modelo lento en la cola (no solo `deepseek-v4-flash`) pueda violar el `timeoutMs` nominal por varios multiplos sin ser clasificado correctamente.

Ambos criterios se cumplen simultaneamente, con evidencia independiente para cada uno — no es una lectura ambigua forzada a "los dos" por default. **Veredicto: `BOTH_IN_PARALLEL`.**

- La correccion del deadline (P0 de la seccion 12) debe hacerse **sin importar** el resultado de cualquier comparacion de modelos futura: hoy el `timeoutMs=20000` no es un contrato real, y eso es cierto para `deepseek-v4-flash` y seguiria siendo cierto para cualquier modelo candidato.
- Una comparacion de modelos (`LLM-R1-T08`, propuesta) tiene sentido en paralelo, pero **debe priorizar candidatos donde el volumen de razonamiento oculto sea controlable o ausente por defecto** para esta tarea (decision estructural de bajo contenido, un AgentStep de una sola accion) — el hallazgo nuevo de esta auditoria (razonamiento oculto no controlable es el driver dominante) debe ser un criterio de seleccion explicito en esa tarea, no solo "modelo mas rapido en general".

## 14. Plan de implementacion priorizado

1. **P0 - Corregir el orden de cleanup/abort en `httpAgentLoopProvider.ts`** (seccion 8) para que el deadline realmente proteja `response.json()`, no solo `fetch()`. Tarea separada, toca codigo de produccion (fuera del alcance de esta auditoria, que es solo diagnostico).
2. **P0 - Investigar con el proveedor/documentacion si `deepseek-v4-flash` (u otro modelo del mismo proveedor) expone un control de esfuerzo de razonamiento.** Si existe, es el cambio de mayor apalancamiento posible (ataca la causa raiz real con el minimo riesgo arquitectonico).
3. **P1 - `LLM-R1-T08`: comparacion de modelos/configuraciones**, con el criterio de seleccion explicito de la seccion 13, bajo el mismo harness ya construido (`LLM-R1-T05`). No implementada aqui.
4. **P1 - Revisar la politica de timeout** (per-turno vs. per-llamada) una vez que el P0 de arriba este corregido — el deadline actual deja a la 2da/3ra decision de un turno con presupuesto residual arbitrariamente chico cuando la 1ra decision fue lenta.
5. **P2 - Explorar streaming de produccion** como base para un futuro budget de razonamiento (abortar generacion a mitad de camino si excede un umbral) — cambio arquitectonico mayor, requiere su propia tarea de diseño.
6. **NOT_JUSTIFIED, no perseguir**: reduccion adicional de prompt, prompt caching explicito, optimizacion de TTFT, separacion planner/responder — evidencia de esta auditoria descarta impacto material en cada uno.

---

```text
LLM-R1-T07: DONE

Primary latency cause:
Hidden reasoning_content tokens generated by the provider (deepseek-v4-flash), counted inside usage.completion_tokens, never read/logged/bounded by the current runtime. r=0.995 correlation with elapsedMs.

Provider share of turn latency:
99.97%

Tool/runtime share:
0.03% (measured against local Catalog/Carrier/DB mocks - production network tool latency not covered by this figure)

C09 primary cause:
Multi-intent phrasing triggers disproportionately large reasoning_content episodes (483-8082 output tokens observed per call) in both gathering and finalization phases, compounded by a real deadline-enforcement gap (see below) that lets an overlong call run to completion instead of being cut at timeoutMs.

T06 effective max_tokens:
Not sent (omitted from the request in both T06 and this audit's rerun) - no config row published, BENCHMARK_LIVE_LLM_MAX_OUTPUT_TOKENS unset.

Reason for ~5876 output tokens:
Provider-side reasoning_content (hidden chain-of-thought) counted inside usage.completion_tokens alongside the tiny actual AgentStep JSON (confirmed via raw response inspection: usage.completion_tokens_details.reasoning_tokens present and dominant).

Timeouts classified (fresh 10-run C09 rerun, n=7 timeouts):
SLOW_FIRST_RESPONSE: 0
LONG_GENERATION: 2
MULTI_ROUND_ACCUMULATION: 5
DEADLINE_BUDGET_INTERACTION: 5 (overlaps with MULTI_ROUND_ACCUMULATION - same code-level mechanism)
UNKNOWN: 0

Input-token/latency correlation:
-0.122 (no correlation)

Output-token/latency correlation:
0.995 (near-linear)

Highest-value optimization:
Fix httpAgentLoopProvider.ts's attemptSignal.cleanup() ordering (line 209) so the deadline actually bounds response.json(), not just fetch() - independent of any model decision.

Model benchmark decision:
BOTH_IN_PARALLEL

Production runtime changed:
NO
```
