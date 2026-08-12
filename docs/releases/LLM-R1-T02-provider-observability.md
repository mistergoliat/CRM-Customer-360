---
title: LLM-R1-T02 — Provider Observability for the Native Agent Tool Loop
doc_id: release-llm-r1-t02-provider-observability
status: implemented_pending_real_smoke
owner: architecture
last_reviewed: 2026-08-12
source_of_truth_for:
  - per-inference (AgentLoopInferenceRecord) and per-turn (llmMetrics) LLM observability contract
  - persisted-payload naming rule for token-count fields (inputSize/outputSize, never "...Tokens...")
depends_on:
  - ../audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md
  - ./LLM-R1-T01-structured-output-recovery.md
tags:
  - release
  - agent-loop
  - llm-provider
  - observability
---

# LLM-R1-T02 — Provider Observability for the Native Agent Tool Loop

Implementa las recomendaciones P1-3 (observabilidad) de la auditoria `docs/audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md`: cada llamada real al proveedor LLM (exitosa, fallida, o recuperada por `LLM-R1-T01`) ahora deja un registro estructurado propio, y el turno agregado expone un rollup de latencia/tokens. Es observabilidad pura - no se modifico modelo, retries, budgets, prompts, tools ni el `AgentStep` contract, y el comportamiento funcional del loop es identico antes/despues (mismos inputs -> mismas tools -> mismos retries -> mismo `terminalReason` -> mismos side effects).

## Problema

La auditoria confirmo que `httpAgentLoopProvider.ts` ya obtenia (o podia obtener) `finishReason`/`inputTokens`/`outputTokens`/`providerRequestId` en cada llamada, pero `runAgentToolLoop.ts` los descartaba: `invokeProviderWithDeadline`'s rama de exito solo devolvia `rawOutput`, sin `elapsedMs` ni ningun metadato. En el camino de fallo, `elapsedMs` si se capturaba pero `finishReason`/tokens/`providerRequestId` nunca llegaban a `AgentLoopProviderFailure`. Resultado: era imposible reconstruir cuantas llamadas hizo un turno, cuanto tardo cada una, o si `empty_response`/`invalid_model_json` correlacionaban con `finish_reason=length` (la senal que confirmaria o descartaria truncamiento por `max_tokens`).

## Metadata antes descartada

- **Camino exitoso** (`invokeProviderWithDeadline`, `runAgentToolLoop.ts`): `elapsedMs` nunca se calculaba ni se devolvia; `model`/`inputTokens`/`outputTokens`/`providerRequestId`/`finishReason` de `AgentLoopProviderResponse` se descartaban enteros - solo `rawOutput` sobrevivia.
- **Camino de fallo estructural** (`empty_response`/`invalid_model_json`, `httpAgentLoopProvider.ts`): el envelope de respuesta (`data`/`choice`) ya estaba parseado en el momento de lanzar la excepcion, pero `finish_reason`/`usage`/`id` nunca se adjuntaban a la causa clasificada (`AgentLoopProviderFailure` no tenia esos campos).
- **Turno agregado**: `AgentToolLoopCompletedRecordedPayload` no tenia ningun campo de latencia/tokens de LLM - solo `decisionCount`/`toolExecutionCount` (conteo de decisiones del `AgentStep`, no de llamadas reales al proveedor - un fallo estructural recuperado por T01 nunca produce un `AgentLoopStepRecord`, asi que ni siquiera `decisionCount` refleja el numero real de invocaciones).

## Nueva telemetria por inferencia

Nuevo tipo `AgentLoopInferenceRecord` (`agentStepTypes.ts`), un registro por cada invocacion real del provider este turno (exito, fallo, o timeout del deadline del loop) - incluida una llamada fallida luego recuperada por `LLM-R1-T01`, y el reintento preexistente de `AgentStep` invalido:

```text
phase          "gathering" | "finalization"
attempt        0 = primer intento de este slot de decision/fase; 1+ = un reintento del mismo slot
decisionIndex  gathering: que decision fue esta llamada; null en finalization
elapsedMs      siempre presente - Date.now() - startedAt, medido en exito, fallo y timeout por igual
model          | providerRequestId | finishReason | inputTokens | outputTokens  - null cuando no disponible, nunca inventado
outcome        "success" | AgentLoopProviderFailureNormalizedReason (reutiliza la taxonomia existente - nunca una segunda)
```

`AgentLoopResult.llmCalls: AgentLoopInferenceRecord[]` (siempre presente, array vacio solo cuando el loop nunca alcanzo al provider - p. ej. sin provider configurado).

**Distincion gathering/finalization y del structured-recovery attempt de T01**: en gathering, un contador local `gatheringAttemptIndex` (0 en el primer intento de cada `decisionIndex`, incrementado en cada reintento del mismo slot, reseteado a 0 solo cuando `decisionIndex` avanza de verdad) distingue el intento inicial del intento de recuperacion. En finalization, se reutiliza directamente la variable `attempt` del `for` existente (`FINALIZATION_MAX_ATTEMPTS`) - sin contador nuevo. Un test dedicado (`[LLM-R1-T02 Caso 5]`) verifica que la recuperacion de T01 produce exactamente 2 entradas en `llmCalls`, cada una individualmente observable con su propio `outcome`.

**`finish_reason` en fallos estructurales** (Parte 5, el dato mas critico): `httpAgentLoopProvider.ts` ahora adjunta `finishReason`/`inputTokens`/`outputTokens`/`providerRequestId` a la causa clasificada en `empty_response` e `invalid_model_json` (donde el envelope si se parseo), reusando la misma extraccion que ya alimentaba el camino exitoso (`availableResponseMetadata`, factorizado una sola vez, cero duplicacion). En `invalid_json_response` (el envelope mismo nunca parseo) y en cualquier error de transporte (`network_error`, `provider_timeout`, status HTTP), estos campos quedan `undefined` - nunca `null`-como-si-se-hubiera-verificado, nunca inventados. La clasificacion del error (`normalizedReason`/`errorCode`) no cambio en absoluto.

## Rollup por turno

Nuevo `AgentToolLoopLlmMetricsPayload` (`events/types.ts`), construido por `buildLlmMetrics(loop)` (`runNativeAgentToolLoopCycle.ts`) y adjunto al evento `agent_tool_loop_completed` como `llmMetrics` (mismo patron condicional que `providerFailure`/`pendingCatalogAction`: ausente por completo cuando el loop nunca hizo ninguna llamada, nunca un objeto degenerado en cero):

```json
{
  "llmMetrics": {
    "callCount": 4,
    "totalElapsedMs": 47120,
    "inputSize": 8420,
    "outputSize": 551,
    "usageComplete": true,
    "calls": [ /* AgentToolLoopLlmCallSummary[] - una entrada por llamada, ver abajo */ ]
  }
}
```

## Nombres de campo: por que `inputSize`/`outputSize`, nunca `...Tokens...`

Hallazgo critico durante esta tarea: `lib/brain/commercial/events/normalize.ts`'s `assertPlainSerializable` (el sanitizador centralizado que ya usa todo evento comercial) rechaza **cualquier** clave del payload que matchee `/authorization|api[-_]?key|token|secret|password|cookie|header|webhook/i` con `commercial_event_forbidden_key`. `inputTokens`/`outputTokens` matchean esa expresion como substring (`"...Tokens..."` contiene `"token"`), asi que **no pueden persistirse con ese nombre** - intentarlo lanza en producción la primera vez que un turno real intente persistir sus metricas. Verificado directamente:

```js
const p = /authorization|api[-_]?key|token|secret|password|cookie|header|webhook/i;
p.test("inputTokens")  // true - forbidden
p.test("inputSize")    // false
```

Esta es exactamente la misma razon por la que el codigo preexistente ya nombra `effectiveMaxOutputSize` (nunca `...maxOutputTokens`) en el mismo payload (`AgentToolLoopCompletedRecordedPayload`, `events/types.ts`) - se siguio ese precedente ya establecido en vez de inventar uno nuevo:

- **Tipos internos, en memoria** (`AgentLoopProviderResponse`, `AgentLoopProviderFailure`, `AgentLoopInferenceRecord`): siguen usando `inputTokens`/`outputTokens` exactamente como ya existian y como pide la Parte 6 de la tarea (`prompt_tokens -> inputTokens`, `completion_tokens -> outputTokens`) - nunca pasan por el sanitizador, no hay colision.
- **Tipos persistidos** (`AgentToolLoopLlmCallSummary`, `AgentToolLoopLlmMetricsPayload`, `events/types.ts`): renombrados a `inputSize`/`outputSize` en el limite de serializacion (`buildLlmCallsSummary`/`buildLlmMetrics`, `runNativeAgentToolLoopCycle.ts`) - el unico punto de traduccion, documentado con comentarios explicitos en ambos archivos para que una futura edicion no revierta el nombre sin darse cuenta.

Un test de regresion dedicado (`[LLM-R1-T02] no key anywhere in a persisted llmMetrics payload matches the shared forbidden-key pattern...`) prueba esto contra el normalizador real (no una copia del regex), asi que si alguien renombra el campo de vuelta a `...Tokens...` en el futuro, el test falla en CI en vez de fallar en produccion.

## Semantica de tokens faltantes

`buildLlmMetrics` (Parte 4) implementa la semantica explicita pedida, con dos senales independientes:

- `inputSize`/`outputSize` (`number | null`): suma **solo de los valores conocidos** de cada dimension, por separado - `null` unicamente cuando **ninguna** llamada del turno reporto un valor usable para esa dimension (nunca un `0` inventado). Si 2 de 3 llamadas reportaron `inputTokens`, el resultado es la suma de esas 2, nunca `null` ni `0`.
- `usageComplete` (`boolean`): `false` en cuanto **una sola** llamada carezca de `inputTokens` u `outputTokens`, incluso si la suma parcial de arriba es un numero real. Es la unica forma de saber si `inputSize`/`outputSize` reflejan el turno completo o son parciales.

`llmMetrics` completo es `null` (ausente del payload) cuando el turno nunca llego a invocar al provider - nunca un objeto `{callCount:0, ...}` engañoso.

Casos probados explicitamente (`tests/agent-loop/llmProviderObservabilityMetrics.test.ts`, `[LLM-R1-T02 Caso 7]`/`[LLM-R1-T02 Caso 8]`): suma correcta con todas las llamadas completas; suma parcial + `usageComplete=false` cuando una llamada de las varias carece de tokens; `null` cuando la unica llamada carece de tokens; `usageComplete=false` cuando falta solo una de las dos dimensiones en una llamada (nunca acopladas incorrectamente); `llmMetrics=null` cuando `llmCalls` esta vacio.

## Archivos modificados

- `lib/brain/commercial/agent-loop/agentStepTypes.ts` - `AgentLoopProviderFailure` gana 4 campos opcionales (`finishReason`/`inputTokens`/`outputTokens`/`providerRequestId`); nuevo `AgentLoopInferenceOutcome`, `AgentLoopInferenceRecord`; `AgentLoopResult` gana `llmCalls: AgentLoopInferenceRecord[]` (requerido, nunca opcional - mismo patron que `steps`).
- `lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts` - extrae `availableResponseMetadata` una sola vez (factorizacion pura, mismo valor exacto que ya se devolvia en exito) y la adjunta tambien a `empty_response`/`invalid_model_json`. Ningun cambio a `retryable`, a la clasificacion HTTP/red, ni al parsing de `rawOutput`.
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` - `invokeProviderWithDeadline` ahora mide `elapsedMs` en las 3 ramas (exito/timeout/error, antes solo error) y devuelve `metadata` en exito; nuevos helpers `buildSuccessInferenceRecord`/`buildFailureInferenceRecord`/`buildTimeoutInferenceRecord`; `llmCalls` se declara junto a `steps` y se puebla en cada uno de los dos call-sites (gathering/finalization) para las 3 ramas; todo constructor de `AgentLoopResult` (`finalize`, `respondedResult`, los 2 `handoff` return, el early-return sin provider) incluye `llmCalls`.
- `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts` - nuevas `buildLlmCallsSummary`/`buildLlmMetrics` (exportadas, mismo patron que `buildStepsSummary`); `recordAgentToolLoopCompletedCommercialEvent` recibe `llmMetrics: buildLlmMetrics(loop) ?? undefined`; los 2 `AgentLoopResult` sinteticos (`skippedResult`, `runNativeAgentToolLoopCycleConfigurationFailure`) ganan `llmCalls: []`.
- `lib/brain/commercial/events/types.ts` - nuevos `AgentToolLoopLlmCallOutcome`, `AgentToolLoopLlmCallSummary`, `AgentToolLoopLlmMetricsPayload`; `AgentToolLoopCompletedRecordedPayload` gana `llmMetrics?: AgentToolLoopLlmMetricsPayload | null` (opcional, mismo patron que `providerFailure`).
- `lib/brain/commercial/events/normalize.ts` - `normalizeAgentToolLoopCompletedCommercialEvent` acepta `llmMetrics` opcional y lo incluye en el payload solo si esta presente (mismo spread condicional que `providerFailure`/`pendingCatalogAction`).
- `tests/agent-loop/recommendCatalogProductsSkippedEventPersistence.test.ts` - un `AgentLoopResult` literal existente gana `llmCalls: []` (requerido por el tipo, sin cambio de comportamiento del test).

## Tests agregados

- `tests/agent-loop/httpAgentLoopProvider.test.ts`: `[LLM-R1-T02 Caso 1]` (metadata de exito completa), `[LLM-R1-T02 Caso 2]` (invalid_model_json preserva metadata, nunca filtra el contenido invalido crudo), `[LLM-R1-T02 Caso 3]` (empty_response preserva metadata), `[LLM-R1-T02 Caso 4]` (invalid_json_response nunca fabrica metadata), mas un test de red (`network_error` tampoco fabrica metadata).
- `tests/agent-loop/runAgentToolLoop.test.ts`: `[LLM-R1-T02 Caso 1]` (elapsedMs/model/tokens en una llamada exitosa), `[LLM-R1-T02 Caso 4]` (network_error con elapsedMs capturado pero metadata null), `[LLM-R1-T02 Caso 5]` (2 entradas `llmCalls` distintas para la recuperacion de T01, con `attempt`/`decisionIndex`/`outcome` correctos), `[LLM-R1-T02 Caso 6]` (finalization con 2 tools previas + recuperacion: `llmCalls` de 4 entradas exactas, `toolExecutionCount` sin cambio, `select_products` ejecuta exactamente una vez), `[LLM-R1-T02 Caso 8]` (llamada exitosa sin `usage` deja `inputTokens`/`outputTokens` en `null`, nunca `0`), mas un test de seguridad (`llmCalls` nunca carga `rawOutput`/nombres de tool/claves prohibidas).
- `tests/agent-loop/llmProviderObservabilityMetrics.test.ts` (nuevo, DB-free, mismo patron que `recommendCatalogProductsSkippedEventPersistence.test.ts`): `[LLM-R1-T02 Caso 7]` (suma agregada correcta, con y sin fallos mezclados), `[LLM-R1-T02 Caso 8]` (semantica null/parcial/`usageComplete` en el agregado, incluyendo el caso de una sola dimension faltante), mas los tests de seguridad de la Parte 7: `llmMetrics`/`calls[]` nunca cargan una clave prohibida (probado contra el sanitizador real, no una copia), sus claves son exactamente las documentadas (nunca `rawOutput` filtrado), y el payload completo serializado nunca contiene `apikey`/`authorization`/`bearer`/`system prompt`/`rawoutput`.

## Garantia de cero cambios funcionales

Verificado explicitamente:

- `invokeProviderWithDeadline` solo agrega campos a lo que ya devolvia (`elapsedMs`, `metadata`) - el valor de `rawOutput`, el momento en que se resuelve la promesa, y cuando se dispara `timeout` vs `error` no cambiaron una linea.
- Los helpers `buildSuccessInferenceRecord`/`buildFailureInferenceRecord`/`buildTimeoutInferenceRecord` solo **leen** de `invoked`/`providerFailure` y **empujan** a `llmCalls` - nunca participan en ninguna decision de `continue`/`return`/reintento. La logica de `LLM-R1-T01` (que ya decide cuando reintentar) no se toco.
- Los 111 tests preexistentes de `runAgentToolLoop.test.ts` + `httpAgentLoopProvider.test.ts` + `agentToolLoopCompletedEventConfig.test.ts` (incluidos los 5 de `LLM-R1-T01` y `[PF11]`/`[PF12]`) pasan sin ninguna modificacion a sus aserciones - la unica edicion fuera de los archivos nuevos/de test-de-esta-tarea fue agregar `llmCalls: []` a un `AgentLoopResult` literal preexistente para satisfacer el tipo (requerido por TypeScript, no un cambio de comportamiento).
- Suite completa (`npm test`, contra MariaDB local real): comparada explicitamente contra el mismo baseline sin este cambio (`git stash` de los archivos modificados + re-run completo), mismo procedimiento que `LLM-R1-T01` - ver seccion de Validacion mas abajo para los numeros exactos de esta corrida.

## Fuera de alcance (explicito)

- TTFT (time to first token) - requeriria streaming, no implementado.
- Cambio de modelo, `max_tokens`, temperatura, `timeoutMs`, `maxModelRetries`, `maxDecisions`, `maxToolExecutions`.
- Guided/semantic repair del prompt de recuperacion (reenviar el motivo de rechazo al modelo) - `LLM-R1-T04`.
- Prompt trimming / reduccion del system prompt de finalization - tarea separada (`LLM-R1-T03`, ver "Siguiente tarea").
- Raw prompt, raw model output, API keys, headers, PII adicional del cliente - nunca capturados en ningun punto nuevo de esta tarea (ver seccion de seguridad arriba).
- Cambios a Catalog, Carrier, shipping o cualquier otra capability.
- Migracion de base de datos - los eventos viven en `payload_json` (JSON libre), la extension es 100% aditiva y compatible sin tocar el schema.

## Validacion ejecutada

- `npm run typecheck` - limpio.
- `npm run lint` - 0 errores (34 warnings preexistentes, identicas a `LLM-R1-T01`, ninguna en archivos de esta tarea).
- Focused: `tests/agent-loop/runAgentToolLoop.test.ts` + `tests/agent-loop/httpAgentLoopProvider.test.ts` + `tests/agent-loop/llmProviderObservabilityMetrics.test.ts` + `tests/commercial/agentToolLoopCompletedEventConfig.test.ts` + `tests/agent-loop/recommendCatalogProductsSkippedEventPersistence.test.ts` - 136/136 pass.
- Suite completa (`npm test`, contra MariaDB local real): 2865 tests, 2833 pass / 32 fail. Comparado explicitamente contra el mismo baseline sin este cambio (`git stash` de los 9 archivos modificados + los 2 nuevos + re-run completo: 2842 tests, 2809 pass / 33 fail), mismo procedimiento que `LLM-R1-T01`. Diferencia de nombres de test fallidos entre ambas corridas: **vacia en la direccion "solo falla en T02"** (cero fallos nuevos introducidos); `[S31] falls back to the safe default when the deployment default is invalid (bad shape or bad JSON)` fallo en el baseline y paso en la corrida de T02 - un test de `sales-agent-configuration` sin relacion alguna con observabilidad de LLM, consistente con la misma clase de flakiness entre corridas ya documentada en `LLM-R1-T01` (`ACS-R1-05-T06.2 (P2)`/`[P25]`).

## Siguiente tarea recomendada

`LLM-R1-T03 — Prompt Finalization Reduction`: recortar en la fase `finalization` las reglas de `buildAgentStepPromptPackage.ts` que solo gobiernan *como invocar* una tool (`SHIPPING_DESTINATION_RULE_LINES`, `SELECT_PRODUCTS_RULE_LINES`, `CALCULATE_SHIPPING_RULE_LINES`, `RECOMMEND_CATALOG_PRODUCTS_RULE_LINES`, `EXPLORE_CATALOG_RULE_LINES`) - estructuralmente imposibles de necesitar ahi (`availableTools: []`, `FINALIZATION_ALLOWED_TYPES` nunca acepta `use_tool`) - manteniendo las reglas que si gobiernan la redaccion de `respond` (stock disclosure, cierre comercial, evidencia, pending catalog action). Con `llmMetrics.inputSize`/`totalElapsedMs` ya observables desde esta tarea, `LLM-R1-T03` puede medir el impacto real del recorte antes/despues en vez de estimarlo.
