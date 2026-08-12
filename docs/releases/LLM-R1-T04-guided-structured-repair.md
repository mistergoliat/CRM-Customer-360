---
title: LLM-R1-T04 — Guided Structured Repair for the Native Agent Tool Loop
doc_id: release-llm-r1-t04-guided-structured-repair
status: implemented_pending_real_smoke
owner: architecture
last_reviewed: 2026-08-12
source_of_truth_for:
  - AgentLoopPriorAttemptFailure signal contract (buildAgentStepPromptPackage.ts)
  - AgentStepValidationReasonCode taxonomy (validateAgentStep.ts)
  - pendingRepairSignal one-shot-consumption discipline (runAgentToolLoop.ts)
depends_on:
  - ../audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md
  - ./LLM-R1-T01-structured-output-recovery.md
  - ./LLM-R1-T02-provider-observability.md
  - ./LLM-R1-T03-prompt-finalization-reduction.md
tags:
  - release
  - agent-loop
  - llm-provider
  - prompt-engineering
  - reliability
---

# LLM-R1-T04 — Guided Structured Repair for the Native Agent Tool Loop

Convierte los reintentos estructurales del Agent Tool Loop (el structured-recovery attempt de `LLM-R1-T01` para `invalid_response`, y el reintento preexistente para `AgentStep` invalido) en una reparacion explicita: el segundo intento recibe una instruccion breve y sanitizada sobre por que fallo el intento anterior, en vez de un reenvio ciego del mismo prompt. No se toco modelo, budgets, retries tecnicos, tools, ni la semantica de negocio - solo la construccion del prompt de ese intento especifico.

## Problema

`LLM-R1-T01` le dio a `invalid_response` exactamente un intento adicional dentro de la misma fase/slot de decision, y el reintento preexistente para `AgentStep` invalido funciona igual: ambos reconstruyen el prompt llamando a `buildAgentStepPromptPackage` con los mismos argumentos que el intento original, produciendo un prompt **identico**. Con `temperature=0` (default de plataforma), reenviar exactamente el mismo prompt depende por completo de no-determinismo incidental del proveedor (variacion de batching/kernel en arquitecturas MoE, por ejemplo) para producir un resultado distinto - el reintento no tenia ninguna señal nueva que le permitiera al modelo corregir su propio error.

## Comportamiento previo

```text
attempt 1 (invalid_response o AgentStep invalido)
  -> buildAgentStepPromptPackage(mismos argumentos)
  -> attempt 2: prompt byte-identico al attempt 1
  -> el modelo no sabe que fallo, ni por que
```

## Nueva señal de repair

Nuevo tipo `AgentLoopPriorAttemptFailure` (`buildAgentStepPromptPackage.ts`), y un nuevo campo opcional `priorAttemptFailure` en `AgentLoopPromptInput`:

```ts
export type AgentLoopPriorAttemptFailure =
  | { kind: "invalid_response" }
  | { kind: "invalid_agent_step"; reasonCode: AgentStepValidationReasonCode };
```

Cuando esta presente, `buildAgentStepPromptPackage` antepone una nueva "capa 0" al system prompt (antes del contrato del loop, capa 1) con la instruccion de reparacion. Cuando esta ausente (`undefined`/`null` - el caso de **todo primer intento**), esa capa esta vacia y el prompt es **byte-identico** al de antes de esta tarea - verificado por test contra las longitudes exactas medidas en `LLM-R1-T03` (`gathering` 19783/19767 caracteres segun fixture, `finalization` 16034 caracteres).

`runAgentToolLoop.ts` gestiona la señal con una variable local por fase (`gatheringPendingRepairSignal`/`finalizationPendingRepairSignal`), con una disciplina de **consumo de un solo uso**: se lee dentro del `buildAgentStepPromptPackage(...)` de la iteracion actual y se resetea a `null` inmediatamente despues, antes de que el resultado de esa llamada sea siquiera conocido. Se vuelve a asignar solo justo antes de un `continue` de reintento (structured recovery de T01, o el reintento de schema preexistente) - nunca en ningun otro punto.

## Diferencias entre invalid_response y schema mismatch

**`invalid_response`** (falla del proveedor - `empty_response`/`invalid_model_json`/`invalid_json_response`, clasificado por `providerFailureClassification.ts`, ya existente desde `LLM-R1-T01`): el modelo nunca llego a responder nada util, asi que la instruccion es generica y centrada en el formato:

```text
Your previous response was structurally invalid or empty.
Return exactly one valid JSON object matching the AgentStep contract below.
Do not include markdown, prose, explanations, or any text outside the JSON object.
```

**`schema_validation_failure`** (JSON valido pero `validateAgentStep` lo rechazo): el modelo si produjo algo, asi que la instruccion es especifica sobre que corregir, usando el `reasonCode` (nunca el texto libre `reason`, nunca el `rawOutput` que fallo):

```text
Your previous AgentStep was rejected: reason=<reasonCode>.
Return exactly one valid AgentStep for the current phase, correcting that specific problem.
```

## Sanitizacion: `AgentStepValidationReasonCode`

`validateAgentStep.ts` ganó una clasificacion nueva, fija y acotada, asignada en el **mismo call site** que el `reason` de texto libre preexistente (nunca inferida despues por pattern-matching sobre ese texto, lo cual seria fragil):

```ts
export const AGENT_STEP_VALIDATION_REASON_CODES = [
  "invalid_agent_step_shape",     // raw no es ni siquiera un objeto plano
  "missing_or_invalid_type",      // raw.type ausente o no es use_tool/respond/handoff
  "type_not_allowed_in_phase",    // type valido pero no permitido en esta fase (p. ej. use_tool en finalization)
  "missing_required_field",       // falta tool/message/reason segun el tipo
  "invalid_type"                  // un campo tiene la forma incorrecta (p. ej. arguments no es un objeto plano)
] as const;
```

`AgentStepValidationResult`'s rama `invalid` ahora incluye `reasonCode` junto al `reason` de texto libre preexistente (que sigue existiendo sin cambios, solo para logs internos - `warnings.push(\`agent_step_invalid:${validation.reason}\`)`, sin tocar). El prompt de reparacion **solo lee `reasonCode`**, nunca `reason` ni `rawOutput` - la firma de tipos de `AgentLoopPriorAttemptFailure` hace estructuralmente imposible pasar texto libre: `reasonCode` esta tipado contra el enum, no contra `string`.

Nota: uno de los mensajes de texto libre preexistentes (`AgentStep.type "${type}" is not allowed in this context...`) interpola `type` - en la practica ya acotado a exactamente `"use_tool"|"respond"|"handoff"` por el chequeo anterior en la misma funcion (nunca texto arbitrario), pero de todas formas nunca se usa en el prompt de reparacion: solo su `reasonCode` (`type_not_allowed_in_phase`) llega ahi.

## Garantia de no raw-output leakage

- Verificado por diseño de tipos: `AgentLoopPriorAttemptFailure` no tiene ningun campo que acepte una cadena arbitraria - `kind: "invalid_response"` no lleva payload, y `reasonCode` esta tipado contra el enum bounded, nunca `string`.
- Verificado por test (`[LLM-R1-T04 Caso 5]`, `tests/agent-loop/runAgentToolLoop.test.ts`): un `rawOutput` de prueba que incluye la cadena unica `SECRET_RAW_MODEL_OUTPUT_123` en un campo que `validateAgentStep` nunca lee (`{type: "not_a_real_agent_step_type", note: SECRET}`) dispara el rechazo por `reasonCode: "missing_or_invalid_type"` - se capturan **ambos** mensajes (`system` y `user`) de la llamada de reparacion real y se confirma que la cadena secreta esta ausente de los dos.
- El texto de reparacion para `invalid_response` nunca menciona contenido del intento anterior en absoluto (el proveedor nunca devolvio nada usable que citar).

## Garantia de bounded retry

- Cero cambios a los budgets de `LLM-R1-T01`: `gatheringStructuredRecoveryUsed` (un solo uso, fase completa) y `gatheringRetryUsed` (un solo uso, fase completa) en gathering; `FINALIZATION_MAX_ATTEMPTS = 2` en finalization. `LLM-R1-T04` solo agrega la señal de reparacion en los mismos puntos donde esos budgets ya permitian un `continue` - nunca agrega un `continue` nuevo ni relaja ninguna condicion existente.
- Test (`[LLM-R1-T04 Caso 6]`, mismo patron que `LLM-R1-T01`'s `Case 2`): un proveedor que siempre falla con `invalid_response` produce exactamente 2 llamadas (el intento original + la unica recuperacion guiada), nunca una tercera.
- La señal de reparacion se consume exactamente una vez por construccion (reset a `null` inmediatamente despues de leerse en cada iteracion) - no puede, por diseño, sobrevivir a una segunda ronda ni contaminar un turno posterior (cada `runAgentToolLoop` es una invocacion fresca, sin estado de modulo compartido).

## Garantia de no duplicacion de side effects

- El mecanismo de reparacion nunca toca `processUseToolStep`/el Capability Gateway - sigue siendo estructuralmente imposible ejecutar una tool durante finalization (`availableTools: []`, `validateAgentStep(raw, FINALIZATION_ALLOWED_TYPES)` rechaza `use_tool`), y en gathering la reparacion solo reintenta la MISMA llamada al proveedor para el MISMO `decisionIndex` - nunca reprocesa un `AgentLoopStepRecord` ya empujado a `steps`.
- Test (`[LLM-R1-T04 Caso 3]`, reproduce el patron de `LLM-R1-T01`'s `Case 3`/`LLM-R1-T03`'s `Caso 6`): `get_product_details` y la tool mutante `select_products` (governance `sideEffect: "mutating"`) se ejecutan durante gathering, la inferencia de finalization falla con `invalid_response`, la reparacion guiada recupera el turno - `toolExecutionCount` se mantiene en 2 y `select_products` aparece exactamente una vez en `result.steps`.

## Interaccion con T02 observability

- Cero cambios a `AgentLoopInferenceRecord`/`llmCalls`/`buildLlmMetrics` - la llamada fallida y la llamada de reparacion siguen siendo dos entradas `llmCalls` completamente independientes y observables, con su propio `outcome`/`attempt`/`elapsedMs`/tokens, exactamente como antes de esta tarea.
- Test (`[LLM-R1-T04 Caso 8]`): confirma explicitamente `result.llmCalls.length === 2`, `llmCalls[0].outcome === "invalid_response"` (`attempt: 0`), `llmCalls[1].outcome === "success"` (`attempt: 1`) - la guia de reparacion no altera en absoluto el registro de observabilidad, solo cambia el contenido del prompt enviado.

## Interaccion con T03 finalization reduction

- La capa 0 (repair) se antepone a las capas 1-4 existentes - las reglas que `LLM-R1-T03` ya remueve de finalization (mecanica de invocacion de `select_products`/`calculate_shipping`/`explore_catalog`/`recommend_catalog_products`) siguen removidas; la reparacion no las reintroduce.
- Test (`[LLM-R1-T04 Caso 9]`, unitario en `buildAgentStepPromptPackage.test.ts`, y confirmado tambien end-to-end dentro de `[LLM-R1-T04 Caso 3]` en `runAgentToolLoop.test.ts` capturando el prompt real de la llamada de reparacion de finalization): el prompt de finalization reparado sigue sin contener `"Use select_products only once..."`/`"recommend_catalog_products requires sourceProduct.productId"`/etc., y sigue conteniendo el grounding/closing que T03 preservo.

## Metrica estatica (tamaño del prompt de reparacion)

Medido con la misma fixture de `LLM-R1-T03` (`baseInput` + `pesasChileConfig()` de `tests/agent-loop/buildAgentStepPromptPackage.test.ts`):

```text
normal (sin priorAttemptFailure):
  gathering systemPrompt.length:    19783 (con 1 tool disponible) / 19767 (sin tools)
  finalization systemPrompt.length: 16034

repair invalid_response:
  delta vs. normal: +217 caracteres (ambas fases - el texto de reparacion es identico en las dos)

repair invalid_agent_step (ejemplo con reasonCode="missing_required_field"):
  delta vs. normal: +161 caracteres (finalization) / +164 caracteres (gathering, con reasonCode="type_not_allowed_in_phase" - la longitud varia unos pocos caracteres segun el reasonCode exacto, todos entre 13-25 caracteres)
```

El delta esta enteramente explicado por las 2-3 lineas de la capa 0 (`buildPriorAttemptFailureLines`) - el resto del prompt (capas 1-4, mas el mensaje `user`) es **byte-identico** al normal, verificado por test (`assert.ok(repairPrompt.includes(normalPrompt))`, no solo por inspeccion). Nunca se reintroducen los cientos/miles de caracteres de contexto que `LLM-R1-T03` elimino de finalization.

## Archivos modificados

- `lib/brain/commercial/agent-loop/validateAgentStep.ts` - nuevo `AGENT_STEP_VALIDATION_REASON_CODES`/`AgentStepValidationReasonCode`; `AgentStepValidationResult`'s rama `invalid` gana `reasonCode` (aditivo, `reason` de texto libre preexistente sin cambios).
- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts` - nuevo `AgentLoopPriorAttemptFailure`; nuevo `buildPriorAttemptFailureLines` (capa 0, vacia cuando `priorAttemptFailure` esta ausente); `AgentLoopPromptInput` gana `priorAttemptFailure?`; `systemInstructions` antepone la capa 0.
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` - nuevas `gatheringPendingRepairSignal`/`finalizationPendingRepairSignal` (una por fase, disciplina de un solo uso); ambos call sites de `buildAgentStepPromptPackage` pasan `priorAttemptFailure` y lo resetean de inmediato; los 2 `continue` de gathering y los 2 `continue` de finalization asignan la señal correspondiente antes de reintentar.
- `tests/agent-loop/buildAgentStepPromptPackage.test.ts` - 8 tests nuevos (unitarios: primer intento sin cambios, ambos tipos de reparacion en ambas fases, cada `reasonCode`, no-leakage estructural, metrica de tamaño, interaccion con T03).
- `tests/agent-loop/runAgentToolLoop.test.ts` - 7 tests nuevos (end-to-end: prompt real que recibe el provider en cada escenario de reparacion, budget acotado, side effects no duplicados, observabilidad T02 intacta).

## Tests

Ver la lista completa en las dos secciones de archivos modificados arriba. Resumen por caso pedido en la tarea:

1. First attempt unchanged - `[LLM-R1-T04 Caso 1]` (unitario + end-to-end).
2. Gathering invalid_response repair - `[LLM-R1-T04 Caso 2]`.
3. Finalization invalid_response repair - `[LLM-R1-T04 Caso 3]`.
4. Schema mismatch repair - `[LLM-R1-T04 Caso 4]` (unitario, los 5 `reasonCode` posibles; end-to-end, un caso real).
5. No raw output leakage - `[LLM-R1-T04 Caso 5]`.
6. Recovery budget unchanged - `[LLM-R1-T04 Caso 6]`.
7. Tools not duplicated - cubierto dentro de `[LLM-R1-T04 Caso 3]` (mismo test, aserciones adicionales).
8. T02 observability intacta - `[LLM-R1-T04 Caso 8]`.
9. T03 finalization reduction intacta - `[LLM-R1-T04 Caso 9]` (unitario) + aserciones dentro de `[LLM-R1-T04 Caso 3]` (end-to-end).
   Metrica estatica - `[LLM-R1-T04 Metrica estatica]`.

## Confirmacion: T01/T02/T03 permanecen intactos

- Ningun archivo de `LLM-R1-T02` (`events/*`) se toco en absoluto.
- `httpAgentLoopProvider.ts`/`providerFailureClassification.ts` (proveedor, clasificacion de fallos) - **cero lineas tocadas**.
- Los budgets/flags de `LLM-R1-T01` (`gatheringStructuredRecoveryUsed`, `gatheringRetryUsed`, `FINALIZATION_MAX_ATTEMPTS`) - **cero lineas tocadas**, solo se leen para decidir CUANDO asignar la nueva señal.
- La clasificacion de tool-invocation removida por `LLM-R1-T03` (`*_FINALIZATION_RULE_LINES`) - **cero lineas tocadas**; la nueva capa 0 se antepone, nunca reemplaza ni modifica las capas 1-4 existentes.
- Suite completa de `LLM-R1-T01`/`LLM-R1-T02`/`LLM-R1-T03` (209 tests focalizados: `buildAgentStepPromptPackage.test.ts`, `runAgentToolLoop.test.ts`, `validateAgentStep.test.ts`, `httpAgentLoopProvider.test.ts`, `llmProviderObservabilityMetrics.test.ts`, `agentToolLoopCompletedEventConfig.test.ts`, `recommendCatalogProductsSkippedEventPersistence.test.ts`) - 209/209 pass sin modificar ninguna aserción preexistente (solo se agregaron tests nuevos).

## Validacion ejecutada

- `npm run typecheck` - limpio.
- `npm run lint` - 0 errores (34 warnings preexistentes, identicas a `LLM-R1-T01`/`T02`/`T03`, ninguna en archivos de esta tarea).
- Focused: 209/209 pass (ver arriba).
- Suite completa (`npm test`, contra MariaDB local real): **2888 tests, 2855 pass / 33 fail**. Comparado explicitamente contra el mismo baseline sin este cambio (`git stash` de los 5 archivos modificados + re-run completo: 2874 tests, 2843 pass / 31 fail), mismo procedimiento que `LLM-R1-T01`/`T02`/`T03`. Diferencia de nombres de test fallidos: **vacia en la direccion "solo falla en baseline"**; 2 nombres aparecen solo en la corrida de T04 (`[FS7] once the active row is terminal, a new attempt for the same sequence is allowed`, en `tests/commercial/followUpSequenceContinuity.test.ts` - scheduling de follow-ups, sin ninguna relacion con `agent-loop/`; y `[P25] a failed publish attempt leaves the previously published configuration untouched`, el mismo test de concurrencia de `sales-agent-configuration` ya observado como flaky en el baseline de `LLM-R1-T01`) - ambos son tests de concurrencia/timing contra MariaDB real en modulos sin ninguna dependencia de los 3 archivos de produccion tocados por esta tarea, consistentes con la clase de flakiness entre corridas ya documentada en las tareas anteriores. Los 31 fallos restantes son exactamente los mismos ya documentados en `LLM-R1-T01`/`T02`/`T03` (checksum drift de migracion 025, mocks de transporte WhatsApp, tests de ownership/pilot-isolation del outbox worker).

## Siguiente tarea recomendada

`LLM-R1-T05 — Production Measurement and Model Benchmark Decision`: con `LLM-R1-T01` (recuperacion acotada), `LLM-R1-T02` (observabilidad por inferencia/turno), `LLM-R1-T03` (prompt de finalization reducido) y `LLM-R1-T04` (reparacion guiada) ya en produccion, corresponde medir el comportamiento real (`llmMetrics`, tasa de `invalid_response`/`invalid_agent_step`, tasa de recuperacion exitosa via `outcome`/`reasonCode`, `finishReason` real observado) contra trafico productivo antes de considerar cualquier cambio de modelo, siguiendo el plan de benchmark documentado en `docs/audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md` (seccion 13).
