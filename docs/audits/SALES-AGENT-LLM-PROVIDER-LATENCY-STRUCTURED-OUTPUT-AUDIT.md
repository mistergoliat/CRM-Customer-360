---
title: SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT — Agent Tool Loop Provider Latency and Structured Output Audit
doc_id: audit-sales-agent-llm-provider-latency-structured-output
status: completed
owner: architecture
last_reviewed: 2026-08-12
source_of_truth_for:
  - root-cause analysis of agent_tool_loop_provider_failure (empty_response, invalid_model_json)
  - Agent Tool Loop provider request/response/retry contract audit
  - prompt/context size audit for buildAgentStepPromptPackage.ts
  - latency decomposition for the native Agent Tool Loop
depends_on:
  - ../ACTIVE_RELEASE.md
  - ../CAPABILITY_MATRIX.md
  - ../../AGENTS.md
  - ./SALES-AGENT-R1-current-commercial-capability-audit.md
tags:
  - audit
  - sales-agent
  - agent-loop
  - llm-provider
  - latency
  - structured-output
---

# SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT

Auditoria de solo lectura. No se modifico codigo, no se hizo commit, push ni PR, no se cambio `.env` ni el modelo configurado, no se ejecutaron requests productivas contra el proveedor LLM ni tools con side effects reales. Toda afirmacion tecnica cita `file:line` verificado contra el codigo real en `develop` (working tree limpio al momento de esta auditoria). Donde la causa raiz no puede confirmarse solo con lectura de codigo (p. ej. el comportamiento interno de `deepseek-v4-flash` ante el prompt real), se marca explicitamente como hipotesis y se distingue de lo verificado.

## 1. Executive summary

**Veredicto: `MULTIPLE_ISSUES`** — compuesto por `NEEDS_OPTIMIZATION` (retry/repair policy, tamano de prompt, observabilidad) y `STRUCTURED_OUTPUT_UNRELIABLE` (calificado: el harness ya activa JSON mode, pero no tiene ningun mecanismo de reparacion para cuando el proveedor igual devuelve `empty_response`/`invalid_model_json`). No se encontro evidencia suficiente para `ARCHITECTURAL_OVERUSE_OF_LLM` como hallazgo primario (el numero de rondas LLM por turno es mayormente necesario dado el modelo de decision actual) ni para `MODEL_MISMATCH` (no hay instrumentacion hoy que permita separar "el modelo fallo" de "el harness descarto una respuesta recuperable").

Los cuatro hallazgos centrales, todos verificados contra codigo real:

1. **El Agent Tool Loop ya envia `response_format: {type: "json_object"}`** en cada llamada (`httpAgentLoopProvider.ts:189`) — la hipotesis "el prompt solo le pide JSON en texto, sin forzarlo estructuralmente" **queda descartada**. JSON mode esta activo.
2. **No existe ningun mecanismo de reparacion para fallos estructurales del proveedor** (`empty_response`, `invalid_model_json`) en ninguna capa del stack. A nivel HTTP (`httpAgentLoopProvider.ts:243-269`) ambos se marcan `retryable: false` explicitamente. A nivel de loop (`runAgentToolLoop.ts:530-534` en gathering, `runAgentToolLoop.ts:655-659` en finalization) **cualquier excepcion del proveedor termina el turno completo inmediatamente** con `terminalReason: "provider_unavailable"`, sin usar el segundo intento de finalizacion que el propio loop ya reserva (`FINALIZATION_MAX_ATTEMPTS = 2`, `runAgentToolLoop.ts:64`) para exactamente este tipo de recuperacion. Esto esta **confirmado como comportamiento intencional y testeado** (`tests/agent-loop/runAgentToolLoop.test.ts:939-969`, test `[PF12]`), no un bug accidental — pero es la causa arquitectonica directa del patron reportado en el Turno 2 del smoke (dos tools completadas y persistidas, respuesta final perdida).
3. **El presupuesto de latencia por turno esta dominado casi en su totalidad por rondas LLM, no por Catalog Service/Carrier MS.** Con los defaults (`maxDecisions=3`, `maxToolExecutions=2`, `runAgentToolLoop.ts:60-61`) y latencias observadas de 14-26s por inferencia, un turno de 2-3 llamadas al modelo — el camino feliz normal para "buscar producto + agregar al carrito" — ya cuesta 30-80 segundos de punta a punta, incluso cuando **todo funciona correctamente**. Esto es un problema de UX independiente de los `invalid_response`.
4. **La observabilidad tiene huecos concretos que impiden confirmar la causa raiz especifica** de `empty_response`/`invalid_model_json`: `finishReason`, `inputTokens`/`outputTokens` y el `elapsedMs` de llamadas exitosas se descartan en `invokeProviderWithDeadline` (`runAgentToolLoop.ts:120-122`) y nunca llegan a ningun log ni a `commercial_event`. En particular, **`finish_reason` — que confirmaria o descartaria de inmediato la hipotesis de truncamiento por `max_tokens`** — se lee del proveedor (`httpAgentLoopProvider.ts:278`) y se tira inmediatamente despues.

La preocupacion especifica planteada sobre `get_product_details` devolviendo campos comerciales extensos (`longDescription`, garantia, cuidados, provenance, variantes completas) **se investigo y no se reproduce**: la proyeccion real (`buildToolObservation.ts:33-56`) ya es un allowlist estricto de 7 campos (`productId`, `name`, `shortDescription`, `price`, `availability`, `stockQuantity`, `publicLink`). El tool-observation payload no es el problema principal de tamano de contexto; el problema real de tamano es que el **system prompt completo** (13 bloques de reglas inmutables mas el JSON Schema completo de las 8 tools) se reenvia byte-por-byte en cada una de las hasta ~5-6 llamadas que puede requerir un turno.

## 2. Current runtime path

```text
WhatsApp -> Meta webhook -> processNativeWhatsAppInbound
  -> runNativeAutonomousCycle
    -> runNativeAgentToolLoopCycle (lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts:344)
      -> runAgentToolLoop (lib/brain/commercial/agent-loop/runAgentToolLoop.ts:395)

         FASE 1 - gathering (hasta maxDecisions=3 decisiones, hasta maxToolExecutions=2 tool calls; ambos budgets configurables por Sales Agent Configuration, limites de plataforma 1-12/0-12 - constants.ts:104-109):
           loop mientras (decisionIndex < maxDecisions && toolExecutionCount < maxToolExecutions):
             1. buildAgentStepPromptPackage (system + user completos, SIEMPRE reconstruidos desde cero)
             2. invokeProviderWithDeadline -> provider.invoke() -> httpAgentLoopProvider
                - exito (JSON valido, AgentStep valido) -> use_tool: ejecuta via Capability Gateway -> Catalog Service/Carrier MS, agrega ToolObservation, decisionIndex++
                - exito pero AgentStep invalido (schema) -> UN reintento ciego (mismo prompt) -> si tambien falla, break a finalizacion
                - EXCEPCION del proveedor (empty_response/invalid_model_json/timeout/5xx agotado) -> terminalReason="provider_unavailable" INMEDIATO, sin retry, sin pasar por finalizacion (runAgentToolLoop.ts:530-534)
                - respond/handoff -> termina el turno aqui

         FASE 2 - finalization (solo si la fase 1 se quedo sin budget sin terminar; hasta FINALIZATION_MAX_ATTEMPTS=2 intentos, solo respond/handoff, sin tools):
           for attempt in [0,1]:
             1. buildAgentStepPromptPackage (phase="finalization", availableTools=[])
             2. invokeProviderWithDeadline
                - exito con AgentStep invalido -> reintenta (attempt+1, hasta 2 intentos totales)
                - EXCEPCION del proveedor -> terminalReason="provider_unavailable" INMEDIATO, incluso en el intento 1 de 2 (runAgentToolLoop.ts:655-659) - el segundo intento reservado NUNCA se usa para este tipo de fallo
                - respond/handoff -> termina el turno

      -> dispatchAgentLoopResponse (lib/brain/commercial/agent-loop/dispatchAgentLoopResponse.ts:130)
         - terminalReason="responded" -> envia loop.finalMessage
         - terminalReason="provider_unavailable"|"timeout" -> buildContinuityFallbackMessage("model_unavailable", ...) - mensaje generico al cliente
         -> persistAgentAction -> sandbox -> executeActionThroughGate -> outbox -> WhatsApp
```

Ejemplo real reconstruido del Turno 2 del smoke ("dame 2 de las classic") contra este diagrama: decisionIndex 0 -> `get_product_details` (tool 1/2, exito) -> decisionIndex 1 -> `select_products` (tool 2/2, exito, `toolExecutionCount == maxToolExecutions` -> el while sale) -> entra a finalization -> intento 1 de finalization lanza `invalid_model_json` (`elapsedMs=14708` del log reportado) -> `terminalReason="provider_unavailable"` inmediato, **sin usar el intento 2 de finalization**, pese a que ambas tools ya estaban completadas y persistidas. Esto coincide exactamente con lo reportado ("las tools terminaron correctamente y el fallo ocurrio en una inferencia posterior").

## 3. Provider request audit

`createHttpAgentLoopProvider` (`lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts:131-283`) construye el request real:

```json
{
  "model": "<effectiveModel, ver seccion 11>",
  "temperature": 0,
  "max_tokens": 1024,
  "response_format": { "type": "json_object" },
  "messages": [
    { "role": "system", "content": "<system prompt completo, ver seccion 5>" },
    { "role": "user", "content": "<JSON.stringify del userPayload, ver seccion 5>" }
  ]
}
```

Detalles verificados:

- **`response_format: {type: "json_object"}` esta presente en el 100% de las llamadas** (`httpAgentLoopProvider.ts:189`) — la API "obliga estructuralmente" al proveedor a devolver JSON valido (contrato OpenAI-compatible), no es solo una instruccion en texto. Esto contradice de raiz la hipotesis #6 del brief ("falta de JSON mode / structured output real").
- `max_tokens` **solo se envia si `maxOutputTokens` fue configurado explicitamente** (`httpAgentLoopProvider.ts:141,188`) — un deployment sin publicacion (`SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT`) SI define `maxOutputTokens: 1024` (`sales-agent-configuration/defaults.ts:37`), asi que en la practica casi todo deployment real envia `max_tokens=1024` salvo que se haya publicado explicitamente sin ese campo.
- `temperature` default `0` (`defaults.ts:36`), rango de plataforma `0-1` (`constants.ts:95-96`).
- Solo dos roles usados: `system`/`user` — nunca `assistant` ni un historial multi-turno real de mensajes; el "historial" del loop dentro del turno viaja embebido como JSON en el mensaje `user` (`priorStepsThisTurn`), no como mensajes `assistant` separados. Esto es deliberado (`agentLoopProviderTypes.ts:1-6`: "one message list in, one raw AgentStep out") pero significa que **no hay ningun turno `assistant` real que el proveedor pueda usar para su propio prefix caching basado en roles** — el unico prefix estable es el `system` message completo.
- No hay ningun campo `tools`/`tool_choice`/function-calling nativo en el request — las "tools" del Agent Tool Loop son puramente una convencion de texto dentro del `AgentStep` (`{"type":"use_tool","tool":"...","arguments":{...}}`), nunca el mecanismo de tool/function calling nativo del proveedor. Esto es coherente con la decision de diseno documentada (contrato deliberadamente minimo, `agentStepTypes.ts:1-8`), pero significa que el proveedor nunca tiene una via estructural nativa para "tool call" separada de la respuesta de texto — todo pasa por el mismo canal de JSON libre bajo `json_object` mode.
- El endpoint es tratado como el contrato OpenAI Chat Completions clasico (`choices[].message.content`, `usage.prompt_tokens/completion_tokens`, `id`/`model`/`finish_reason` top-level) — documentado en el propio codigo como el shape real de DeepSeek `/chat/completions` (`httpAgentLoopProvider.ts:118-130`).

## 4. Provider response audit

Parseo real, en orden (`httpAgentLoopProvider.ts:225-270`):

1. `response.json()` — si falla, `errorCode: "invalid_json_response"` (el sobre HTTP no es JSON valido; distinto de "el contenido del modelo no es JSON valido").
2. `data.choices?.[0]?.message?.content` — **si es falsy** (`undefined`/`null`/`""`), `errorCode: "empty_response"`. **Solo se lee `message.content`; no existe ningun manejo de un campo alterno tipo `reasoning_content`** que algunos proveedores/modelos "reasoning"-style usan para separar cadena de pensamiento del contenido final. Si el modelo configurado emite razonamiento en un canal separado y deja `content` vacio cuando el presupuesto de tokens se agota en ese canal, esto es indistinguible hoy de un fallo generico del proveedor — no hay ningun log que capture si `data` trae otros campos.
3. `parseModelJson(content)` (`lib/brain/commercial/shared/parseModelJsonOutput.ts:50-56`) — extrae el primer objeto `{...}` balanceado (contando llaves, respetando strings/escapes) tras despojar un posible fence de markdown (`stripJsonFence`, ` ```json ... ``` `). Si `JSON.parse` sobre ese fragmento falla, `errorCode: "invalid_model_json"`.

Comportamiento del extractor (`extractFirstJsonObject`, `parseModelJsonOutput.ts:13-48`) ante los escenarios pedidos:

- **Markdown fences**: manejado explicitamente (`stripJsonFence`).
- **Texto antes/despues del JSON**: manejado — el escaneo busca el primer `{` y cuenta profundidad hasta el `}` que la cierra, ignorando prosa antes o despues.
- **JSON truncado** (el proveedor corta a mitad de objeto, p. ej. por `finish_reason=length`): **NO manejado** — el contador de profundidad nunca llega a 0, la funcion cae al `return stripped` (todo el texto desde el primer `{` en adelante, sin cerrar), y `JSON.parse` sobre eso lanza -> `invalid_model_json`. No existe ningun intento de reparacion (cerrar llaves/corchetes abiertos, recortar al ultimo campo completo).
- **Body completamente vacio**: cubierto por el chequeo `!content` -> `empty_response`, antes de siquiera intentar parsear.
- **Schema mismatch** (JSON valido pero no calza con `AgentStep`): esto NO es un error del provider — pasa el parseo y llega a `validateAgentStep` (`validateAgentStep.ts:68-108`), que es donde SI existe una via de reintento (ver seccion 7).

Ni `empty_response` ni `invalid_model_json` capturan o loguean el `content` crudo (por diseno de seguridad: nunca loguear salida cruda del modelo) — **correcto para higiene de logs, pero significa que hoy es imposible diagnosticar post-hoc por que un caso especifico fallo**, mas alla de reproducirlo. Ver seccion 10.

## 5. Prompt/context size audit

`buildAgentStepPromptPackage` (`lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts:429-455`) compone 6 capas; las capas 1-4 forman el mensaje `system`, 5-6 el mensaje `user`. Clasificacion:

| Capa | Contenido | Clasificacion | Nota |
|---|---|---|---|
| 1. Loop contract (`buildLoopContractLines`, l.304-322) | Que variantes de `AgentStep` son legales esta fase | NECESARIO | Pequeno, ~5 lineas |
| 2. Evidence/tool rules (`buildEvidenceAndToolRulesLines`, l.352-398) | 13 bloques de reglas inmutables: link publico, contexto de catalogo reciente, historial de compra, senales comerciales de historial, presentacion adaptativa, explore_catalog, recommend_catalog_products, shipping destination, select_products, calculate_shipping, stock disclosure, cierre comercial, pending catalog action | **NECESARIO en su mayoria (son guardrails de compliance/anti-alucinacion), pero REDUCIBLE en su forma actual** | Se envian **completos, sin importar que tools esten realmente disponibles o sean relevantes este turno** — un turno que nunca toca shipping igual paga el costo de `SHIPPING_DESTINATION_RULE_LINES`/`CALCULATE_SHIPPING_RULE_LINES` en cada llamada |
| 2b. Tool JSON Schemas (`renderToolLine`, l.331-334) | Schema JSON completo de las 8 tools, verbatim, en cada llamada de gathering | REDUCIBLE (via prompt caching del proveedor, no recortando contenido) | Estatico entre llamadas del mismo turno; candidato ideal a prefix caching si el proveedor lo soporta |
| 3. Identity (`renderSalesAgentIdentityPrompt`) | agentName/companyName/role/companyDescription/customInstructions/prohibitedPhrases | NECESARIO | Acotado por limites de configuracion (`customInstructionsMaxLength: 4000` — potencialmente grande pero controlado por el operador, no por el runtime) |
| 4. Immutable boundary line | 1 linea fija | NECESARIO | Trivial |
| 5. userPayload dinamico | `currentTime`, `customerMessage`, `commercialContext` (acotado: opportunity status/stage, needProfile subset, shippingDestination, commercialLineItems, ultimos 5 `recentMessages`, opcional `customerPurchaseHistory`/`customerHistoryCommercialSignals`), `recentCatalogContext` (max 5 interacciones x max 12 productos, solo id+nombre) | NECESARIO, ya acotado | Buen diseno existente |
| 6. `priorStepsThisTurn` | Steps + ToolObservations de este turno, acumulativo por decision | NECESARIO, ya acotado por observation (seccion 6) | Crece linealmente con el numero de tool calls de este turno, pero cada observation individual ya esta proyectada/limitada |

**El hallazgo de tamano de contexto mas concreto no es ninguna observation individual (ya estan bien acotadas, seccion 6) sino la repeticion completa de las capas 1-2b en cada una de las hasta ~5-6 llamadas de un mismo turno**, sin ningun mecanismo de cache/prefix-reuse (`response_format` es el unico campo "extra" enviado; no hay `cache_control`, no hay ningun header o campo de prompt-caching en el request — `httpAgentLoopProvider.ts:178-192`).

Caso especifico: la **fase de finalization nunca puede llamar tools** (`availableTools: []`, `runAgentToolLoop.ts:643`), pero `buildEvidenceAndToolRulesLines("finalization", ...)` (l.353-372) **igual incluye integramente** `SHIPPING_DESTINATION_RULE_LINES`, `SELECT_PRODUCTS_RULE_LINES`, `CALCULATE_SHIPPING_RULE_LINES`, `RECOMMEND_CATALOG_PRODUCTS_RULE_LINES`, `EXPLORE_CATALOG_RULE_LINES` — reglas que explican como *invocar* tools que estructuralmente no se pueden invocar en esa fase. Puro desperdicio de tokens en la fase que, segun el brief, es exactamente donde ocurrio el `invalid_model_json` del Turno 2.

## 6. Tool observation audit

Verificado contra `buildToolObservation.ts` — **la preocupacion especifica del brief sobre `get_product_details` no se reproduce**:

`projectProductDetails` (`buildToolObservation.ts:33-56`) proyecta exactamente: `productId`, `name`, `shortDescription`, `price.{amount,currency}`, `availability`, `stockQuantity`, y opcionalmente `publicLink.{canonicalUrl,scope,available,unavailableReason,requiresVariantSelection,variantAttributeLabels}`. **No incluye** `longDescription`, garantia, cuidados, links adicionales, provenance interno, ni el arreglo completo de variantes/combinaciones — exactamente lo contrario de lo que se sospechaba.

Limites confirmados por tool:

- `search_products`: max 5 items (`MAX_SEARCH_ITEMS`, l.8), solo `productId/name/availability/stockQuantity`.
- `explore_catalog`: max 10 items (`MAX_EXPLORE_ITEMS`, l.9), campos acotados (`productId/name/price/currency/stockQuantity/stockScope/availability`).
- `recommend_catalog_products`: max 5 recomendaciones (`MAX_RECOMMENDATIONS`, l.11), max 5 reasons c/u, max 10 warnings.
- `set_shipping_destination`/`select_products`/`calculate_shipping`: pasan `data` "tal cual" (l.93-115) — pero esa `data` ya es la forma pequena y acordada de cada capability (status + campos especificos), nunca el payload crudo de Carrier MS/pc_pos.
- `company_knowledge`: sin limite explicito de cantidad de `entries`, pero la fuente es un fixture lexico interno acotado, no un servicio externo de tamano variable.

Conclusion: **el tool-observation payload no es el vector principal de crecimiento de contexto.** El diseño de proyeccion ya es disciplinado. El vector real es el numero de rondas (cada ronda re-envia el system prompt completo mas todas las observations acumuladas de rondas previas), auditado en la seccion 5 y 8.

## 7. Retry/repair audit

**Capa de transporte** (`httpAgentLoopProvider.ts`) — `maxModelRetries` (rango de plataforma `0-5`, `constants.ts:100-101`; el log del incidente con `maxAttempts=6` implica `maxModelRetries=5` configurado en ese deployment):

| Error | `retryable` | Maneja backoff/reintento tecnico |
|---|---|---|
| Network error / `fetch failed` | `true` | Si, hasta `maxModelRetries` |
| `AbortError` (timeout de intento) | `true` | Si |
| HTTP `429`/`500`/`502`/`503`/`504` | `true` | Si |
| HTTP `400`/`401`/`403`/otros 4xx | `false` | No (correcto: un 401 no se arregla reintentando) |
| `invalid_json_response` (sobre HTTP no-JSON) | `false` | No |
| **`empty_response`** | **`false`** | **No** |
| **`invalid_model_json`** | **`false`** | **No** |

Esto explica exactamente el patron observado (`attemptCount=1, maxAttempts=6, retryable=false`): el provider nunca reintenta estos dos codigos, sin importar cuantos reintentos tecnicos tenga configurados.

**Capa de loop** (`runAgentToolLoop.ts`) — dos vias completamente distintas segun el tipo de fallo:

- **Fallo de shape/schema** (JSON valido, pero no calza con `AgentStep`) -> **SI tiene reparacion**: gathering permite exactamente 1 reintento (`gatheringRetryUsed`, l.536-548) antes de caer a finalization; finalization permite hasta `FINALIZATION_MAX_ATTEMPTS=2` intentos (l.661-667) antes de `invalid_output`.
- **Excepcion lanzada por el proveedor** (network_error, timeout, `empty_response`, `invalid_model_json`, HTTP status tras agotar reintentos tecnicos) -> **CERO reparacion, en ninguna fase**: tanto en gathering (l.530-534) como en finalization (l.655-659), el primer `invoked.kind === "error"` termina el turno entero con `terminalReason: "provider_unavailable"` de inmediato. **Esto es intencional y esta testeado explicitamente** — `tests/agent-loop/runAgentToolLoop.test.ts:939-969`, test `[PF12]`, verifica literalmente que un fallo de proveedor en el **primer** intento de finalization (de 2 disponibles) termina el turno sin usar el segundo intento, incluso con `toolExecutionCount=2` (evidencia ya recolectada).

Este es el hallazgo mas importante de la auditoria: **`empty_response`/`invalid_model_json` son exactamente el tipo de error para el cual existe un mecanismo de reparacion en el codigo (el retry de gathering, el segundo intento de finalization) — pero ese mecanismo nunca se activa para ellos**, porque a nivel de loop se tratan igual que un 401 o que agotar los reintentos tecnicos de un 503, en vez de tratarse como el equivalente estructural del "AgentStep invalido" que si tiene reparacion.

Adicionalmente, el reintento de schema-mismatch que SI existe es **ciego**: en gathering, `continue` (l.547) vuelve a armar el prompt con `buildAgentStepPromptPackage` usando exactamente los mismos `priorSteps`/`steps` (nada cambio), es decir **reenvia el prompt byte-identico**, sin incluir el motivo de rechazo (`validation.reason`) ni el output invalido previo. Con `temperature=0` (default), esto depende enteramente de no-determinismo incidental del proveedor para producir un resultado distinto — nunca de una correccion guiada.

**Politica de retry/repair recomendada** (separando las tres categorias pedidas):

- **Errores de transporte** (timeout, 429, 5xx, connection reset): la politica actual ya es correcta — `RETRY TECNICO` acotado, nunca en 4xx. No requiere cambio.
- **Errores estructurales** (`empty_response`, `invalid_model_json`, JSON truncado, `invalid_json_response`): hoy `FAIL FAST` indebido. Deberian ser `REPAIR UNA VEZ` — un unico reintento adicional dentro de la MISMA fase/slot de decision donde ocurrio el fallo (nunca un retry tecnico ciego a nivel HTTP, sino una nueva invocacion del loop con la oportunidad de incluir una linea correctiva). Si el intento de reparacion tambien falla estructuralmente, **entonces si** `FAIL FAST` a `provider_unavailable`/handoff — nunca reintentos indefinidos.
- **Errores semanticos** (tool inexistente, argumentos invalidos, `AgentStep` con `type` no permitido esta fase): la politica actual ya es correcta y ya es "reparacion" en la practica — se convierten en una `ToolObservation` `blocked` que el modelo ve en la siguiente decision y puede corregir dentro del budget (`INVALID_ARGUMENTS_RECOVERY_RULE_LINE`, `buildAgentStepPromptPackage.ts:344-345`), sin gastar un "fallo" del loop. No requiere cambio.

## 8. Latency decomposition

Presupuesto de latencia por turno, con los valores observados:

```text
Catalog Service (search/get_product_details/explore/batch): ~90-170 ms por llamada
Carrier MS (calculate_shipping):                             no medido en el smoke, asumido comparable (fuera de alcance de esta auditoria)
LLM (http-agent-loop-provider / deepseek-v4-flash):           ~14 000-26 000 ms por invocacion
```

Con los defaults de plataforma (`maxDecisions=3`, `maxToolExecutions=2`, `timeoutMs` default `20000` ms pero configurable `5000-60000` ms, `constants.ts:98-99`):

| Escenario | # inferencias LLM | Latencia LLM acumulada (14-26s c/u) | Latencia Catalog acumulada | Total aprox. |
|---|---|---|---|---|
| Mensaje conversacional sin tool (`respond` directo) | 1 | 14-26 s | 0 | **14-26 s** |
| 1 tool + respuesta final | 2 | 28-52 s | ~0.1-0.2 s | **~28-52 s** |
| 2 tools + respuesta final (patron real del Turno 2: `get_product_details` + `select_products` + finalization) | 3 | 42-78 s | ~0.2-0.3 s | **~42-78 s** |
| 2 tools + 1 reintento de formato + finalization | 4 | 56-104 s | ~0.2-0.3 s | **~56-104 s** |

El tiempo de Catalog Service/Carrier MS es **menos del 1% del presupuesto total de un turno** en todos los escenarios. **La causa dominante de latencia percibida es el numero de round-trips al LLM multiplicado por su latencia individual, no el trabajo de tools/DB.** Incluso el "camino feliz" mas simple con una sola tool ya cuesta ~30-50 segundos de punta a punta para el cliente en WhatsApp — un tiempo de espera alto para una conversacion, independientemente de si el turno termina en exito o en `provider_unavailable`.

Nota sobre `timeoutMs`: dado que los fallos reportados tienen `errorCode` estructural (no `terminalReason: "timeout"`) con `elapsedMs` de 14.7-25.6s, el `timeoutMs` efectivamente configurado en el deployment que genero esos logs debe ser mayor a ~26s (dentro del rango de plataforma hasta 60s) — el fallo no es por agotar el deadline, es un fallo estructural dentro de un intento que si tuvo tiempo de completarse.

## 9. Deterministic transition opportunities

Evaluacion de las dos secuencias pedidas:

- **`get_product_details -> select_products`**: requiere interpretacion genuina (resolver "las classic" a un `productId` concreto, inferir cantidad de "dame 2") — **no es candidato a transicion deterministica**, es exactamente el tipo de decision para la que el LLM existe en este loop.
- **`set_shipping_destination -> calculate_shipping`**: cuando `set_shipping_destination` resuelve con `data.status="resolved"` Y ya existe una seleccion de productos confirmada (`commercialLineItems` presente) Y el mensaje del cliente es inequivocamente sobre costo de envio, encadenar `calculate_shipping` automaticamente en el backend (sin una ronda LLM intermedia) es tecnicamente posible — pero cambia quien "decide" invocar una tool, tocando el principio de arquitectura "propuesta del planner != decision" (ver memoria `architecture-principles.md`). **No se recomienda implementar sin decision de producto explicita** (P2-2 en la seccion 12).

Conclusion: el numero de rondas LLM por turno (2-4 en los casos reales observados) es **mayormente inherente** al modelo de decision "un paso a la vez" del contrato actual, no evidencia de que el backend este usando al LLM como scheduler de pasos triviales. El problema dominante no es *cuantas* rondas hacen falta, sino **la calidad/latencia de cada ronda individual** (secciones 3-8) y **que pasa cuando una ronda falla estructuralmente** (seccion 7).

## 10. Observability gaps

Verificado por lectura directa de codigo:

- **Latencia de llamadas exitosas nunca se captura.** `invokeProviderWithDeadline` (`runAgentToolLoop.ts:102-130`) calcula `startedAt` pero solo lo usa en la rama de error (`elapsedMs: Date.now() - startedAt`, l.125); la rama de exito (l.121-122) descarta el tiempo. Hoy es imposible saber cuanto tardo una decision que SI funciono.
- **`inputTokens`/`outputTokens`/`providerRequestId`/`finishReason` se calculan en el provider y se descartan inmediatamente.** `httpAgentLoopProvider.ts` los puebla en `AgentLoopProviderResponse` (l.272-279), pero `invokeProviderWithDeadline` solo propaga `response.rawOutput` (l.122) — el resto nunca sale de esa funcion. No hay tokens por decision, por turno, ni costo por turno en ningun lugar del sistema hoy.
- **`finish_reason` en particular nunca se loguea**, ni siquiera en el camino de fallo — es el dato que mas directamente confirmaria o descartaria la hipotesis de truncamiento por `max_tokens` (seccion 11), y hoy se lee (`httpAgentLoopProvider.ts:278`) y se pierde sin usar.
- **No existe TTFT** (Time To First Token) en ningun punto — el `fetch` no usa streaming, solo se puede medir tiempo total de respuesta, y ni siquiera eso se loguea en el camino exitoso.
- **No hay desglose por decision/fase.** `AgentToolLoopCompletedRecordedPayload` (`lib/brain/commercial/events/types.ts:245-275`) registra `decisionCount`, `toolExecutionCount`, `stepsSummary` (tipo/fase/tool/governance/observationStatus por step) y `providerFailure` (solo si el turno termino en `provider_unavailable`) — pero **ningun timestamp ni duracion por decision individual**, y **ningun dato de tokens**.
- **Ningun diagnostico de contenido crudo en fallos estructurales** — correcto por higiene de seguridad (nunca loguear salida del modelo), pero significa que hoy no hay ningun proxy seguro (longitud del contenido, si empezaba con `{`, si `finish_reason=="length"`) que permita diagnosticar sin reproducir el incidente.

Estos huecos son la razon por la que esta auditoria no puede confirmar con evidencia directa la causa raiz especifica de `empty_response`/`invalid_model_json` mas alla de "el harness no repara estos fallos y no registra los datos que explicarian por que ocurren" — ver seccion 11.

## 11. Model suitability

**No se puede evaluar de forma concluyente `deepseek-v4-flash` con la evidencia disponible**, y por instruccion explicita de esta auditoria no se recomienda cambio de modelo ahora. Lo que si es verificable:

- El harness ya usa JSON mode (seccion 3) — el proveedor tiene una obligacion estructural de devolver JSON valido, lo cual hace que un `empty_response`/`invalid_model_json` consistente sea mas notable, no menos, que si el harness solo pidiera JSON por texto.
- `max_tokens=1024` (default efectivo, seccion 3) es un presupuesto relativamente chico para un modelo que — si genera contenido de razonamiento/cadena-de-pensamiento dentro del mismo canal `content` antes de emitir el JSON final — podria agotar el presupuesto antes de completar el objeto JSON (produciendo `invalid_model_json` por truncamiento) o dejar `content` vacio si el razonamiento se enruta a otro campo que este parser no lee (produciendo `empty_response`). **Esta es una hipotesis arquitectonicamente coherente con la latencia observada (14-26s es alto para una decision de un solo campo), pero no esta confirmada** — requiere exactamente los datos que faltan en la seccion 10 (`finish_reason`, longitud de `content`, presencia de un campo `reasoning_content` en la respuesta cruda) para confirmarse o descartarse.
- No se encontro ningun allowlist de modelos en este audit que excluya o valide especificamente `deepseek-v4-flash` mas alla del allowlist generico de `SALES_AGENT_MODEL_CONFIGURATION_LIMITS`/`validation.ts` (fuera del alcance profundizado de esta lectura).

**Condiciones que justificarian benchmarkear otro modelo** (ver seccion 13): solo despues de (a) implementar el repair-retry de la seccion 7/12 (P0), (b) instrumentar `finish_reason`/tokens/latencia por llamada (P1), y con esos datos en mano, si la tasa de `empty_response`/`invalid_model_json` sigue siendo alta (p. ej. >2-3% de las decisiones) **y** `finish_reason` no es mayormente `"length"` (lo que descartaria truncamiento por presupuesto de tokens como causa) **y** la latencia p50/p95 por llamada sigue muy por encima de lo esperable para el tamano de contrato (un objeto JSON de pocos campos), recien ahi hay evidencia suficiente para atribuir el problema al modelo en si y justificar un benchmark A/B.

## 12. Recommended changes

### P0-1: Sin reparacion para fallos estructurales del proveedor en ninguna fase del loop

- **Problema**: `empty_response`/`invalid_model_json` (y cualquier otra excepcion del proveedor) terminan el turno completo de inmediato, sin usar el mecanismo de reparacion que el propio loop ya reserva para "AgentStep invalido" (retry de gathering, segundo intento de finalization).
- **Causa**: `runAgentToolLoop.ts:530-534` (gathering) y `runAgentToolLoop.ts:655-659` (finalization) tratan `invoked.kind === "error"` de forma identica sin importar `normalizedReason`, llamando `finalize("provider_unavailable", ...)` de inmediato.
- **Archivos**: `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` (ambos call-sites arriba); `lib/brain/commercial/agent-loop/providers/providerFailureClassification.ts` (el campo `normalizedReason: "invalid_response"` ya existe y es exactamente el discriminador necesario).
- **Cambio recomendado**: cuando `normalizedReason === "invalid_response"` (cubre `empty_response`, `invalid_model_json`, `invalid_json_response`) — y solo entonces, nunca para `authentication_error`/`rate_limited`/etc. — permitir exactamente un reintento adicional dentro de la misma fase antes de declarar `provider_unavailable`, reusando el patron que `gatheringRetryUsed` y el loop de `FINALIZATION_MAX_ATTEMPTS` ya implementan para fallos de schema, en vez de crear un tercer mecanismo paralelo.
- **Impacto esperado**: corrige directamente el patron del Turno 2 (tools completadas y persistidas, respuesta final perdida) — es probablemente el cambio de mayor apalancamiento de toda esta auditoria.
- **Riesgo**: una llamada adicional de ~14-26s en el camino que ya es el mas lento, cuando se activa; debe quedar acotado a exactamente un intento y respetar el deadline existente (ya hay guardas de deadline en ambas fases).
- **Tests requeridos**: extender `[PF11]`/`[PF12]` (`tests/agent-loop/runAgentToolLoop.test.ts:914-969`) con casos donde `normalizedReason: "invalid_response"` SI obtiene un reintento y se recupera con una respuesta valida subsecuente, y un caso donde el reintento tambien falla estructuralmente y el turno termina en `provider_unavailable` de forma acotada (nunca un loop infinito).

### P1-1: Los reintentos de formato son ciegos (prompt identico, sin feedback del error)

- **Problema**: tanto el retry de gathering (`runAgentToolLoop.ts:536-548`) como el de finalization (`:661-667`) reenvian el prompt byte-identico, sin incluir `validation.reason` ni el output invalido previo — con `temperature=0` esto depende de no-determinismo incidental para producir un resultado distinto.
- **Archivos**: `runAgentToolLoop.ts` (ambos sitios de retry); `buildAgentStepPromptPackage.ts` (necesitaria un input opcional nuevo, p. ej. `priorAttemptFailure`).
- **Cambio recomendado**: en el reintento (tanto de schema-mismatch como el nuevo de P0-1), agregar una linea correctiva concreta ("tu respuesta anterior no era JSON valido / estaba vacia — responde con exactamente un objeto JSON, nada mas" o el `validation.reason` real) para convertir el reintento en reparacion semantica real, no en un resend a ciegas.
- **Impacto esperado**: sube la tasa de recuperacion real de los reintentos que ya existen (y del nuevo de P0-1).
- **Riesgo**: bajo — campo aditivo y opcional; debe respetar la misma disciplina de sanitizacion del resto del modulo (nunca filtrar el output crudo del modelo a logs).
- **Tests requeridos**: unit test verificando que el prompt del reintento incluye la razon de rechazo; test de regresion confirmando que el prompt ya no es byte-identico entre intento 1 y 2.

### P1-2: System prompt estatico reenviado completo en cada ronda, sin trimming por fase ni senal de caching

- **Problema**: las capas 1-2b de `buildAgentStepPromptPackage.ts` (13 bloques de reglas + JSON Schema de las 8 tools) se envian completas en cada una de las hasta ~5-6 llamadas de un turno, incluyendo en `finalization` reglas sobre tools que estructuralmente no se pueden invocar ahi.
- **Archivos**: `buildAgentStepPromptPackage.ts:352-398` (particularmente `finalization` branch, l.353-372); `httpAgentLoopProvider.ts:178-192` (sin ningun campo de prompt-caching en el request).
- **Cambio recomendado**: (a) recortar en la rama `finalization` las reglas que solo gobiernan *como invocar* una tool (`SHIPPING_DESTINATION_RULE_LINES`, `SELECT_PRODUCTS_RULE_LINES`, `CALCULATE_SHIPPING_RULE_LINES`, `RECOMMEND_CATALOG_PRODUCTS_RULE_LINES`, `EXPLORE_CATALOG_RULE_LINES`), manteniendo las que gobiernan la redaccion de `respond` (stock disclosure, cierre comercial, evidencia, pending catalog action); (b) verificar si el endpoint configurado soporta prefix caching automatico server-side (comun en APIs OpenAI-compatible) y, de ser asi, confirmar que el `system` message es 100% identico byte-a-byte entre llamadas del mismo turno (ya deberia serlo, es funcion pura de fase+config+tools) para que el cache del proveedor pueda engancharse sin cambios de codigo adicionales.
- **Impacto esperado**: menos tokens de prompt procesados por llamada, con reduccion potencial de costo y de la porcion de latencia atribuible a procesamiento de prompt, multiplicado por las 2-5 llamadas de un turno tipico.
- **Riesgo**: bajo para (a), pero requiere reverificar que ninguna regla removida de `finalization` era en realidad necesaria ahi (p. ej. confirmar que `STOCK_DISCLOSURE_RULE_LINES`/`COMMERCIAL_CLOSING_RULE_LINES`/`PENDING_CATALOG_ACTION_RULE_LINES` se mantienen, ya que si aplican al `respond` de finalization); (b) es solo verificacion, no cambio de codigo.
- **Tests requeridos**: snapshot test confirmando que el prompt de `finalization` ya no contiene las reglas de mecanica de tools mientras conserva las de redaccion/evidencia; actualizar tests existentes de `buildAgentStepPromptPackage` en consecuencia.

### P1-3: Sin observabilidad de latencia/tokens/finish_reason en llamadas exitosas ni fallidas

- **Problema**: ver seccion 10 completa — sin esto, ni esta auditoria ni ninguna futura puede confirmar la causa raiz especifica de `empty_response`/`invalid_model_json`, ni calcular p50/p95 reales, tokens por turno o costo por turno.
- **Archivos**: `runAgentToolLoop.ts:108-130` (`invokeProviderWithDeadline`, descarta todo salvo `rawOutput` en exito); `lib/brain/commercial/events/types.ts:245-275` (`AgentToolLoopCompletedRecordedPayload` sin campos de timing/tokens por decision); `lib/brain/commercial/agent-loop/providers/providerFailureClassification.ts` (agregar `finishReason` opcional al `AgentLoopProviderFailureCause`).
- **Cambio recomendado**: capturar `elapsedMs`+`inputTokens`/`outputTokens`/`finishReason` en TODA llamada (exito y fallo), adjuntarlos a cada `AgentLoopStepRecord` o a un arreglo paralelo, y agregar un rollup por turno (total de llamadas LLM, tiempo total en LLM, tokens totales) a `AgentToolLoopCompletedRecordedPayload`; loguear `finishReason` especificamente en cada fallo `invalid_response`.
- **Impacto esperado**: convierte la hipotesis de truncamiento (seccion 11) en un hecho confirmable/descartable con datos reales, y habilita las metricas de latencia/costo pedidas para el benchmark (seccion 13).
- **Riesgo**: bajo — campos aditivos, mismos numeros/enums ya calculados por el provider, ninguna captura de contenido crudo.
- **Tests requeridos**: extender `httpAgentLoopProvider.test.ts` para verificar que `finishReason`/tokens/`elapsedMs` fluyen en el camino exitoso y en el de `invalid_response`; extender `tests/commercial/agentToolLoopCompletedEventConfig.test.ts` para el nuevo payload.

### P2-1: `maxOutputTokens=1024` sin datos que confirmen si es insuficiente

- **Problema/causa**: no hay visibilidad hoy de si la generacion esta llegando al techo de `max_tokens` (`finishReason=="length"`); cambiar el numero a ciegas es exactamente lo que esta auditoria fue instruida a no recomendar.
- **Archivos**: `sales-agent-configuration/defaults.ts:34-40`, `constants.ts:92-102`.
- **Cambio recomendado**: **gateado en P1-3** — solo despues de tener datos de `finishReason`, decidir si subir el techo (hasta el limite de plataforma 2048) o reforzar la instruccion existente ("nada mas que el JSON, sin razonamiento ni explicacion") si el problema es contenido no-JSON antes del objeto, no truncamiento puro.
- **Impacto esperado**: reduccion potencial de `invalid_model_json`/`empty_response` si el truncamiento se confirma como causa (parcial o total).
- **Riesgo**: bajo, cambio de configuracion una vez justificado por datos.
- **Tests requeridos**: ninguno hasta tener los datos de P1-3; luego, test de regresion fijando el nuevo default.

### P2-2: Encadenamiento deterministico opcional `set_shipping_destination -> calculate_shipping`

- **Problema/causa**: ver seccion 9 — oportunidad de ahorro de una ronda LLM en un camino comun, pero cambia quien decide invocar una tool.
- **Archivos**: `runAgentToolLoop.ts` (`processUseToolStep`/loop de gathering).
- **Cambio recomendado**: **no implementar en este ciclo** — requiere decision explicita de producto/arquitectura (toca el principio "propuesta del planner != decision del backend").
- **Impacto esperado**: ahorro menor de latencia en un camino especifico; no es la palanca principal.
- **Riesgo**: medio — expande autonomia del backend sin aprobacion explicita si se implementa sin ese paso.
- **Tests requeridos**: n/a en esta etapa (es una decision, no codigo).

## 13. Benchmark plan

El codebase ya tiene el seam correcto para esto: `AgentLoopProvider` es una interfaz (`agentLoopProviderTypes.ts:32-36`) implementada tanto por `createHttpAgentLoopProvider` (real) como por `fakeAgentLoopProvider.ts` (test). Un benchmark reproducible deberia:

1. Congelar un corpus fijo con los 10 casos minimos pedidos (busqueda simple, cambio de cantidad, cambio de comuna, destino ambiguo "Santiago", producto no observado previamente, mensaje conversacional sin tool, multi-intencion simple, tool con error controlado, mas los dos casos reales del smoke) como fixtures de `commercialContextSummary`/`recentCatalogContext`/`customerMessage`, byte-identicos entre corridas.
2. Ejecutar `runAgentToolLoop` con el Capability Gateway apuntando a fakes/mocks (nunca Catalog Service/Carrier MS reales, nunca WhatsApp real) para que la unica variable entre corridas sea el `AgentLoopProvider` (proveedor/modelo actual vs. candidato) — nunca cambiar prompt, contrato o budgets simultaneamente con el modelo.
3. Medir, por corrida completa del corpus: `JSON validity rate`, `tool selection accuracy`, `argument accuracy` (contra el resultado esperado de cada fixture), `final answer correctness` (revision humana o LLM-judge separado), `p50`/`p95` de latencia por llamada y por turno completo, tokens por turno completado, costo por turno completado, `failure rate` (`empty_response`+`invalid_model_json`+`invalid_output`), y promedio de llamadas LLM por turno.
4. Ejecutar el mismo corpus contra el modelo actual **despues** de aplicar P0-1/P1-3 (para no confundir "el harness perdio la respuesta" con "el modelo no pudo responder"), y solo entonces comparar contra un modelo candidato bajo el mismo harness ya corregido.

Esta auditoria **documenta** el plan pero, por restriccion explicita, **no lo ejecuta** — ningun request productivo al proveedor fue realizado como parte de este trabajo.

## 14. Final recommendation

Secuencia concreta de implementacion:

1. **P0-1** (reparacion de fallos estructurales del proveedor) — es el fix mas aislado, mas alto impacto, y ataca directamente el incidente reportado.
2. **P1-3** (observabilidad: latencia/tokens/finish_reason en toda llamada) — en paralelo o inmediatamente despues de P0-1: necesario para verificar que P0-1 funciono en produccion, y es el prerrequisito de datos para P2-1 y para el benchmark de la seccion 13.
3. **P1-2** (trim de finalization + verificacion de prompt caching) — reduce costo/latencia de forma independiente de los fixes de correctitud.
4. **P1-1** (reparacion semantica real en vez de reintento ciego) — mejora la efectividad de los reintentos que P0-1 introduce y de los que ya existen.
5. **P2-1** solo una vez que P1-3 produzca datos reales de `finishReason`.
6. **P2-2** solo con decision de producto explicita, fuera del alcance de esta auditoria.

No se recomienda cambiar el modelo configurado ahora. La condicion para reconsiderarlo es explicita en la seccion 11 y depende de los datos que P1-3 aun no produce.

---

```text
Auditoria: MULTIPLE_ISSUES (NEEDS_OPTIMIZATION + STRUCTURED_OUTPUT_UNRELIABLE, calificado)
Archivo: docs/audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md
P0: 1
P1: 3
P2: 2
Principal causa de latencia: numero de round-trips al LLM por turno (hasta ~5-6 con defaults + reintentos) x ~14-26s por inferencia - Catalog Service/Carrier MS es <1% del presupuesto total
Principal causa de invalid_response: ausencia total de reparacion para fallos estructurales del proveedor en runAgentToolLoop.ts (confirmado por codigo/tests), combinada con observabilidad insuficiente (finish_reason/tokens nunca capturados) que impide confirmar la contribucion especifica del modelo
Cambio de modelo recomendado ahora: BENCHMARK_AFTER_FIXES
```
