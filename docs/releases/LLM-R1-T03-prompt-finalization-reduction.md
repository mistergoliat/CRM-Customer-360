---
title: LLM-R1-T03 — Finalization Prompt Reduction for the Native Agent Tool Loop
doc_id: release-llm-r1-t03-prompt-finalization-reduction
status: implemented_pending_real_smoke
owner: architecture
last_reviewed: 2026-08-12
source_of_truth_for:
  - KEEP/REMOVE classification of buildAgentStepPromptPackage.ts's finalization-phase rule blocks
  - measured finalization system-prompt size reduction (commit a7c4ac5 vs. this task)
depends_on:
  - ../audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md
  - ./LLM-R1-T01-structured-output-recovery.md
  - ./LLM-R1-T02-provider-observability.md
tags:
  - release
  - agent-loop
  - llm-provider
  - prompt-engineering
---

# LLM-R1-T03 — Finalization Prompt Reduction for the Native Agent Tool Loop

Reduce el system prompt de la fase `finalization` del Agent Tool Loop, eliminando las lineas cuyo unico proposito es enseñar al modelo a invocar una capability - estructuralmente imposible en esta fase (`availableTools=[]`, `validateAgentStep` rechaza cualquier `use_tool`). No se toco el prompt de `gathering` (probado byte-identico), el contrato `AgentStep`, `LLM-R1-T01` (structured recovery) ni `LLM-R1-T02` (observabilidad).

## Problema

La auditoria (`docs/audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md`, seccion 5) confirmo que el system prompt completo se reconstruye y reenvia en cada inferencia del turno, y que en `finalization` (`availableTools=[]`, el modelo solo puede `respond`/`handoff`) el prompt seguia incluyendo integramente 5 bloques de reglas cuyo proposito declarado es enseñar *como invocar* una capability - contenido literalmente inaccionable en esa fase, pagado en tokens en cada llamada de finalization (hasta 2 por turno, mas la recuperacion estructurada de `LLM-R1-T01`).

## Metodologia de clasificacion

Cada bloque candidato (y varios no mencionados por la auditoria, para cobertura completa) se inspecciono linea por linea contra el codigo real, no eliminado en bloque. Criterio: una linea es `REMOVE_FROM_FINALIZATION` solo si su unico proposito es tool-selection, construccion de argumentos, o logica de reintento/encadenamiento *dentro del budget de gathering* - nunca si tiene valor de grounding o de interpretacion de un resultado ya observado (lo cual sigue siendo directamente accionable al redactar `respond` en finalization).

### Clasificacion completa

| Bloque | KEEP (ambas fases) | REMOVE_FROM_FINALIZATION | Nota |
|---|---|---|---|
| `PRODUCT_PUBLIC_LINK_RULE_LINES` | Todas (8 lineas) | ninguna | 100% grounding sobre como/cuando compartir un link ya observado. |
| `RECENT_CATALOG_CONTEXT_RULE_LINES` | Todas (6 lineas) | ninguna | Resolucion de referencias del cliente para redactar la respuesta. |
| `CUSTOMER_PURCHASE_HISTORY_RULE_LINES` | Todas (9 lineas) | ninguna | Uso del historial de compra en la respuesta. |
| `CUSTOMER_HISTORY_COMMERCIAL_POLICY_RULE_LINES` | Todas (9 lineas) | ninguna | Idem, senales comerciales derivadas. |
| `ADAPTIVE_PRODUCT_PRESENTATION_RULE_LINES` | Todas (12 lineas) | ninguna | Como presentar productos en la respuesta. |
| `EXPLORE_CATALOG_RULE_LINES` (6 lineas) | **AMBIGUOUS -> dividido** | 2 de 6 | Ver detalle abajo - mezcla grounding con tool-selection. |
| `RECOMMEND_CATALOG_PRODUCTS_RULE_LINES` (3 lineas) | ninguna | **Las 3 (bloque completo)** | 100% invocacion/encadenamiento de tools, cero valor de interpretacion. |
| `SHIPPING_DESTINATION_RULE_LINES` (6 lineas) | **AMBIGUOUS -> dividido** | 2 de 6 | Ver detalle abajo. |
| `SELECT_PRODUCTS_RULE_LINES` (6 lineas) | **AMBIGUOUS -> dividido** | 4 de 6 | Ver detalle abajo. |
| `CALCULATE_SHIPPING_RULE_LINES` (9 lineas) | **AMBIGUOUS -> dividido** | 1 de 9 | Ver detalle abajo - la auditoria sugeria eliminar el bloque completo; **habria sido incorrecto**. |
| `STOCK_DISCLOSURE_RULE_LINES` | Todas (7 lineas) | ninguna | Confirmado por la tarea, validado: 100% redaccion de respuesta. |
| `COMMERCIAL_CLOSING_RULE_LINES` | Todas (4 lineas) | ninguna | Confirmado por la tarea, validado: cierre de la respuesta `respond`. |
| `PENDING_CATALOG_ACTION_RULE_LINES` | Todas (6 lineas) | ninguna | Confirmado por la tarea, validado: continuidad estructural del `respond`. |
| Preambulo de `buildEvidenceAndToolRulesLines("finalization", ...)` (2 lineas: "Use the customer's already-confirmed context..." y "You must never invent product, price, stock, or delivery information...") | Ambas | ninguna | Ya especificas de finalization, sin cambio. |
| Linea de cierre "You must never claim to have executed anything yourself..." | Si | ninguna | Sin cambio. |
| `INVALID_ARGUMENTS_RECOVERY_RULE_LINE` + `"Available tools:"` + `renderToolLine` (schemas) | N/A | **Ya ausentes antes de esta tarea** | Ver seccion "Tool schemas" abajo - nada que hacer, documentado. |

### Division linea por linea de los 4 bloques ambiguos

**`EXPLORE_CATALOG_RULE_LINES`** (interleaved, no un prefijo/sufijo limpio - se referencia por indice, nunca copiado):

```text
[0] KEEP   "Do not use search_products to claim a global maximum..." - grounding: evita sobre-afirmar un ranking desde evidencia de search_products ya observada.
[1] REMOVE "Use explore_catalog for extremes..." - seleccion de tool.
[2] REMOVE "Use get_product_details after explore_catalog..." - secuenciacion de tools.
[3] KEEP   "If exhaustiveForScope=true/false..." - gobierna el lenguaje absoluto/acotado en la respuesta misma.
[4] REMOVE "Never invent categoryId or categorySlug..." - construccion de argumentos.
[5] KEEP   "Never mention internal implementation terms..." - guardrail de jerga interna en la respuesta (carga aun mas peso al quedar [3], que menciona "exhaustiveForScope" literalmente).
```

**`SHIPPING_DESTINATION_RULE_LINES`** (sufijo contiguo, `.slice(2)`):

```text
[0] REMOVE "Use set_shipping_destination when..." - cuando/como invocar.
[1] REMOVE "...reuse it silently - do not call set_shipping_destination again..." - dedup antes de invocar.
[2] KEEP   "status \"resolved\"... never ask the customer to confirm it a second time" - gobierna la respuesta.
[3] KEEP   "status \"needs_clarification\"... ask the customer for the exact commune" - gobierna la respuesta.
[4] KEEP   "status \"not_found\"... tell the customer and ask them to restate it" - gobierna la respuesta.
[5] KEEP   "...never means a full delivery address is known; do not claim one exists" - grounding contra sobre-afirmar.
```

**`SELECT_PRODUCTS_RULE_LINES`** (sufijo contiguo, `.slice(4)`):

```text
[0] REMOVE "Use select_products only once the customer has confirmed..." - cuando invocar.
[1] REMOVE "Every item's productId... must be one already observed... never invent one" - evidencia para el argumento del CALL.
[2] REMOVE "Each select_products call must include the customer's complete desired selection..." - semantica del CALL.
[3] REMOVE "...reuse it silently - do not call select_products again..." - dedup antes de invocar.
[4] KEEP   "status \"blocked\", the referenced product was not actually observed... use search_products or get_product_details... then retry" - AMBIGUA: la mitad (que significa "blocked") es interpretacion de resultado relevante para no afirmar una seleccion no persistida; la mitad restante (reintentar) es mecanica de gathering. Se conservo la linea COMPLETA (nunca reescrita) por la politica conservadora explicada abajo.
[5] KEEP   "quantity must be a whole number greater than zero - ask the customer to clarify..." - accionable via `respond` (pedir aclaracion) incluso sin budget de tools.
```

**`CALCULATE_SHIPPING_RULE_LINES`** (sufijo contiguo, `.slice(1)` - **el hallazgo mas importante de esta tarea**):

```text
[0] REMOVE "Use calculate_shipping only after the destination... are both already confirmed" - cuando invocar.
[1] KEEP "Never calculate, estimate, or state a shipping cost yourself..." - anti-invencion critica (inventar despacho).
[2] KEEP "Never mention or offer a carrier... not present in the most recent observation's data.options" - anti-invencion critica (inventar carrier).
[3] KEEP "status \"shipping_destination_required\"..." - interpretacion de resultado.
[4] KEEP "status \"commercial_items_required\"..." - interpretacion de resultado.
[5] KEEP "status \"catalog_product_unavailable\"/\"weight_unavailable\"/\"price_unavailable\"... never estimate a substitute value" - anti-invencion.
[6] KEEP "status \"no_shipping_options\"... never claim a carrier covers it and never invent a workaround" - anti-invencion.
[7] KEEP "status \"blocked\" or \"failed\"... never reinterpret a technical failure as \"we don't ship there\"" - exactamente el guardrail "no ocultar/reinterpretar tool failure" que la tarea exige preservar.
[8] KEEP "Never mention Carrier MS, pc_pos, kilos, total_boleta..." - jerga interna en la respuesta.
```

**Hallazgo clave**: la recomendacion de la auditoria de eliminar `CALCULATE_SHIPPING_RULE_LINES` en bloque **habria sido una regresion real** - 8 de sus 9 lineas son guardrails de grounding/anti-invencion directamente relevantes para `respond` (inventar costo, inventar carrier, ocultar un fallo tecnico), no mecanica de invocacion. La auditoria acertaba en que **hay** contenido removible en este bloque, pero se equivocaba en el alcance. Este es exactamente el tipo de hallazgo que la tarea pedia validar contra codigo real antes de actuar.

### Politica conservadora para lineas mixtas

Ninguna linea de las 8 preservadas via `SELECT_PRODUCTS_FINALIZATION_RULE_LINES[4]`/`SHIPPING_DESTINATION_FINALIZATION_RULE_LINES`/`CALCULATE_SHIPPING_FINALIZATION_RULE_LINES` se **reescribio**: la division es siempre a nivel de linea completa (nunca sub-oracion), y cada subconjunto de finalization se deriva por **indice/`.slice()` directo del array original** (nunca una copia de texto) para que ambas versiones sean, por construccion, imposibles de desincronizar. Cuando una linea mezclaba interpretacion de resultado con una instruccion de reintento inerte en finalization (caso `SELECT_PRODUCTS_RULE_LINES[4]`), se opto por conservarla completa en vez de reescribirla - la clausula de reintento queda simplemente inaccionable (el modelo no puede invocar tools en finalization de todas formas, `validateAgentStep` la rechazaria), pero nunca se introdujo prosa nueva sin auditar.

## Reglas removidas de finalization

Resumen (ver tabla completa arriba para el detalle linea por linea):

- `RECOMMEND_CATALOG_PRODUCTS_RULE_LINES` - bloque completo (3 lineas).
- `EXPLORE_CATALOG_RULE_LINES` - 3 de 6 lineas (indices 1, 2, 4: seleccion de tool, secuenciacion, construccion de argumentos).
- `SHIPPING_DESTINATION_RULE_LINES` - 2 de 6 lineas (cuando invocar, dedup antes de invocar).
- `SELECT_PRODUCTS_RULE_LINES` - 4 de 6 lineas (cuando invocar, evidencia del argumento, semantica del call, dedup antes de invocar).
- `CALCULATE_SHIPPING_RULE_LINES` - 1 de 9 lineas (cuando invocar).

## Reglas preservadas y motivo

- **Grounding/anti-invencion generico** (preambulo de finalization, sin cambio): "never invent product, price, stock, or delivery information not returned by a tool this turn" + "never claim to have executed anything yourself" - cubre la mayoria de los riesgos de la revision de seguridad por si solo.
- **`STOCK_DISCLOSURE_RULE_LINES`/`COMMERCIAL_CLOSING_RULE_LINES`/`PENDING_CATALOG_ACTION_RULE_LINES`** - intactas, sin division: 100% reglas de redaccion/continuidad de `respond`, validado que no contienen mecanica de invocacion.
- **Subconjuntos `*_FINALIZATION_RULE_LINES`** de `EXPLORE_CATALOG`/`SHIPPING_DESTINATION`/`SELECT_PRODUCTS`/`CALCULATE_SHIPPING` - ver tabla arriba, cada linea preservada protege directamente contra uno de los riesgos nombrados explicitamente por la tarea (inventar carrier, inventar precio/despacho, afirmar destino no resuelto, ocultar un tool failure).
- **`PRODUCT_PUBLIC_LINK_RULE_LINES`/`RECENT_CATALOG_CONTEXT_RULE_LINES`/`CUSTOMER_PURCHASE_HISTORY_RULE_LINES`/`CUSTOMER_HISTORY_COMMERCIAL_POLICY_RULE_LINES`/`ADAPTIVE_PRODUCT_PRESENTATION_RULE_LINES`** - fuera de la lista de candidatos de la auditoria; inspeccionadas igual por completitud, confirmadas 100% grounding/redaccion, sin cambio.

## Tool schemas

Confirmado contra codigo real (`buildEvidenceAndToolRulesLines`, rama `gathering` vs. `finalization`): `"Available tools:"` + `renderToolLine` (que serializa `inputSchema` via `JSON.stringify`) y `INVALID_ARGUMENTS_RECOVERY_RULE_LINE` **ya estaban ausentes de finalization antes de esta tarea** - ambos solo se agregan en la rama de `gathering` del `return`. `availableTools=[]` en finalization ya significaba, desde antes de `LLM-R1-T03`, cero schemas de tools renderizados en esa fase. No se cambio nada aqui - documentado, como pedia la tarea, en vez de tocar codigo que ya estaba optimizado.

## Tamaño antes/despues

Medido con una fixture fija (`baseInput` + `pesasChileConfig()` de `tests/agent-loop/buildAgentStepPromptPackage.test.ts`) contra dos versiones reales del codigo: el commit `a7c4ac5` (HEAD de `LLM-R1-T02`, justo antes de esta tarea) via un git worktree temporal (`git worktree add --detach /tmp/t03-before a7c4ac5`), y el arbol de trabajo actual - ambas invocadas con `buildAgentStepPromptPackage` real, nunca estimado.

```text
GATHERING (fixture: availableTools=[{name:"explore_catalog", description:"d"}])
  systemPrompt.length antes: 19783 | despues: 19783 | identico byte a byte: SI
  userPrompt.length   antes: 205   | despues: 205   | identico byte a byte: SI

FINALIZATION (fixture: availableTools=[])
  systemPrompt.length antes: 19484
  systemPrompt.length despues: 16034
  reduccion: 3450 chars / 17.71%
  userPrompt.length antes: 205 | despues: 205 | identico: SI (el user payload nunca se toco)
```

`gathering`'s `systemPrompt`/`userPrompt` son **byte-identicos**, no solo "funcionalmente equivalentes" - verificado por comparacion directa de string (`before.gSys === after.gSys`), no solo por inspeccion de codigo. Esto es posible porque la rama `gathering` de `buildEvidenceAndToolRulesLines` no se toco en absoluto: sigue referenciando las mismas constantes completas (`EXPLORE_CATALOG_RULE_LINES`, `RECOMMEND_CATALOG_PRODUCTS_RULE_LINES`, `SHIPPING_DESTINATION_RULE_LINES`, `SELECT_PRODUCTS_RULE_LINES`, `CALCULATE_SHIPPING_RULE_LINES`) en el mismo orden.

## Confirmacion: gathering sin cambio semantico

- Diff real de `buildAgentStepPromptPackage.ts`: la rama `gathering` de `buildEvidenceAndToolRulesLines` (el `return` posterior al `if (phase === "finalization")`) tiene **cero lineas modificadas** - confirmado por inspeccion directa del diff (`git diff`, ninguna linea `-`/`+` aparece despues del cierre del bloque `finalization`).
- Prueba automatizada (`[LLM-R1-T03 Caso 5]`, `tests/agent-loop/buildAgentStepPromptPackage.test.ts`): `systemPrompt.length`/`userPrompt.length` de gathering son exactamente 19783/205, identicos a la medicion contra `a7c4ac5` de arriba.
- Prueba de contenido (`[LLM-R1-T03 Caso 5]`, segunda variante): cada linea removida de finalization sigue presente, textualmente, en el prompt de gathering.

## Tests

Todos en `tests/agent-loop/buildAgentStepPromptPackage.test.ts` salvo el ultimo:

- **`[PR19]`** (existente, corregido): antes afirmaba que las 4 lineas de `EXPLORE_CATALOG_RULE_LINES` estaban en ambas fases - ahora distingue explicitamente grounding (ambas fases) de mecanica de invocacion (solo gathering, ausente en finalization).
- **`[LLM-R1-T03 Caso 1]`**: finalization no contiene ninguna de las lineas removidas (select_products/calculate_shipping/explore_catalog/recommend_catalog_products/shipping_destination de invocacion).
- **`[LLM-R1-T03 Caso 2]`**: finalization sigue prohibiendo inventar stock, resultados de tools, links, carrier, o datos comerciales/de despacho no observados.
- **`[LLM-R1-T03 Caso 2/CALCULATE_SHIPPING]`**: prueba dedicada a las 8 lineas de interpretacion/anti-invencion de `calculate_shipping` que sobreviven - el hallazgo mas importante de esta tarea.
- **`[LLM-R1-T03 Caso 3]`**: `COMMERCIAL_CLOSING_RULE_LINES` presentes en finalization.
- **`[LLM-R1-T03 Caso 4]`**: reglas de `pendingCatalogAction` necesarias para responder siguen presentes en finalization.
- **`[LLM-R1-T03 Caso 5]`** (x2): cada linea removida de finalization sigue presente en gathering; longitudes de gathering byte-identicas a la medicion contra `a7c4ac5`.
- **`[LLM-R1-T03 Caso 6]`** (`tests/agent-loop/runAgentToolLoop.test.ts`): prueba end-to-end - el system prompt **real** que recibe el provider en una llamada de finalization (no solo `buildAgentStepPromptPackage` aislado) omite las lineas removidas y conserva grounding/closing; el turno completa normalmente (`terminalReason: "responded"`, `toolExecutionCount: 2`, las tools se ejecutan una sola vez).
- **`[LLM-R1-T03 Caso 8]`**: `finalization.systemPrompt.length` es estrictamente menor que el valor medido antes de esta tarea (19484) - nunca un porcentaje arbitrario como requisito, tal como pedia la tarea.

Regresion: `[PR19]` fue el unico test preexistente que dejo de reflejar la realidad (por diseño, es exactamente lo que este cambio debia alterar) - corregido, no eliminado.

## Confirmacion: T01/T02 permanecen intactos

- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts`, `lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts`, `lib/brain/commercial/agent-loop/agentStepTypes.ts`, `lib/brain/commercial/events/*` - **cero lineas tocadas** en esta tarea (`git diff --stat` solo muestra `buildAgentStepPromptPackage.ts` y 2 archivos de test).
- Suite completa de `LLM-R1-T01`/`LLM-R1-T02` (136 tests: `runAgentToolLoop.test.ts`, `httpAgentLoopProvider.test.ts`, `llmProviderObservabilityMetrics.test.ts`, `agentToolLoopCompletedEventConfig.test.ts`, `recommendCatalogProductsSkippedEventPersistence.test.ts`) - 136/136 pass sin modificar ninguna aserción existente de esos archivos (solo se agregaron 2 tests nuevos a `runAgentToolLoop.test.ts` para esta tarea).
- `[LLM-R1-T03 Caso 6]` reproduce exactamente el patron de `LLM-R1-T01`/`LLM-R1-T02` (2 tools completadas, `invalid_model_json` simulado - aunque en este test la ultima llamada ya responde valido, sin necesitar recovery, para mantener el foco en el contenido del prompt) y confirma que `toolExecutionCount`/`terminalReason` se comportan exactamente igual que antes.

## Riesgos residuales

1. **`SELECT_PRODUCTS_FINALIZATION_RULE_LINES[0]`** (indice 4 del array original) retiene una clausula de reintento ("...then retry with that exact productId/combinationId") que es inaccionable en finalization - inofensiva (el modelo no puede invocar `select_products` de todas formas; `validateAgentStep` rechazaria un `use_tool` en esta fase), pero no es una linea 100% limpia. Se opto deliberadamente por no reescribirla (ver "Politica conservadora" arriba) para no introducir prosa nueva sin auditar en una tarea de reduccion de contexto.
2. **`COMMERCIAL_CLOSING_RULE_LINES`/`PENDING_CATALOG_ACTION_RULE_LINES`** contienen referencias preexistentes a invocar `get_product_details` cuando el cliente pide un link (p. ej. "use get_product_details for that product"). Esto **ya era asi antes de esta tarea** (ninguna de las dos reglas es candidata de esta auditoria) - en finalization, si el cliente pide el link y `get_product_details` no fue observado aun, el modelo no puede satisfacer literalmente esa instruccion (no hay budget de tools). Defecto preexistente, fuera de alcance de `LLM-R1-T03` (no se modifico ninguna de las dos reglas); anotado aqui por transparencia, no introducido por este cambio.
3. **Prefix/prompt caching del proveedor** - la auditoria (P1-2) sugeria verificar si el endpoint soporta cacheo de prefijo automatico; esta tarea explicitamente no lo implementa, solo lo documenta como posibilidad futura (`LLM-R1-T04`/tarea separada), tal como instruia el alcance.
4. La reduccion de 3450 caracteres (17.71%) es una medicion de **caracteres**, no de tokens reales del tokenizer del proveedor - deliberado (la tarea explicitamente prohibe una formula de conversion aproximada); el impacto real en tokens/latencia/costo debe confirmarse con la observabilidad de `LLM-R1-T02` (`llmMetrics.inputSize`) contra trafico real, no asumirse desde el conteo de caracteres.

## Validacion ejecutada

- `npm run typecheck` - limpio.
- `npm run lint` - 0 errores (34 warnings preexistentes, identicas a `LLM-R1-T01`/`LLM-R1-T02`, ninguna en archivos de esta tarea).
- Focused: `tests/agent-loop/buildAgentStepPromptPackage.test.ts` (43/43), `tests/agent-loop/runAgentToolLoop.test.ts` (86/86), `tests/agent-loop/httpAgentLoopProvider.test.ts`, `tests/agent-loop/llmProviderObservabilityMetrics.test.ts`, `tests/commercial/agentToolLoopCompletedEventConfig.test.ts`, `tests/agent-loop/recommendCatalogProductsSkippedEventPersistence.test.ts` - 136/136 pass (T01/T02 suites, sin tocar).
- Suite completa (`npm test`, contra MariaDB local real): **2874 tests, 2842 pass / 32 fail**. Comparado explicitamente contra el mismo baseline sin este cambio (`git stash` de los 3 archivos modificados + re-run completo: 2865 tests, 2833 pass / 32 fail), mismo procedimiento que `LLM-R1-T01`/`LLM-R1-T02`. Diferencia de nombres de test fallidos entre ambas corridas: **conjunto identico en ambas direcciones** (`comm -13`/`comm -23` ambos vacios) - cero fallos nuevos, cero fallos resueltos, ninguna fluctuacion de flakiness esta vez (a diferencia de `LLM-R1-T01`/`LLM-R1-T02`, donde 1-2 tests de concurrencia sin relacion fluctuaron entre corridas). Los 32 fallos preexistentes son exactamente los mismos ya documentados en `LLM-R1-T01`/`LLM-R1-T02` (checksum drift de migracion 025, mocks de transporte WhatsApp, tests de ownership/pilot-isolation del outbox worker).

## Siguiente tarea recomendada

`LLM-R1-T04 — Guided Structured Repair`: en el reintento de `LLM-R1-T01` (tanto el de `AgentStep` invalido como el de recuperacion estructurada), reenviar al modelo el motivo concreto de rechazo (`validation.reason`, o "tu respuesta anterior estaba vacia/no era JSON valido") en vez de repetir el prompt identico a ciegas - actualmente el reintento depende de no-determinismo incidental del proveedor para producir un resultado distinto, especialmente relevante con `temperature=0`.
