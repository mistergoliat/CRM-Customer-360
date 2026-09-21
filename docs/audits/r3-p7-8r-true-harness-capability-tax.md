# P7.8-R - True Harness & Capability Tax Experiment

Experimento de fase. No P8, no MCP, sin cambios de Gateway/CommercialWork/DB/capabilities de produccion, sin tocar el prompt hibrido A, sin commit y sin push. Repo `CRM-Customer-360`, rama `develop`, HEAD `b9a27fcafd1e1e1bff0ccbb6fcdee689613fcbec` (+ cambios sin commitear, seccion 13).

Estado: **P7.8-R CLOSED.**

- **Preregistered architecture signal: `NO_CLEAR_WINNER`.**
- **Post-hoc corrected exploratory finding: `CAPABILITY_CONTRACT_IS_BOTTLENECK` candidate, requires confirmatory replication.** (Correccion de medicion post-batch, seccion 7; cautelas en la seccion 9.)

Ambos se reportan; ninguna corrida se repitio.

Alcance y relacion con P7.8:

- **P7.8** (`docs/audits/r3-p7-8-autonomous-harness-ab.md`): prompt minimo sobre el MISMO loop R3 (`runAgentToolLoop`), mismo protocolo AgentStep, mismo contrato de tools. `NO_CLEAR_WINNER`. No fue una comparacion R3 vs DeepSeek autonomo puro.
- **P7.8-R** (este documento): comparacion R3 vs un harness autonomo real (loop propio, function calling nativo), y separacion causal del costo del contrato de capabilities.

Documentos base leidos: handoff R3 (23.6-23.8), `r3-p7-6-runtime-config-parity-audit.md`, `r3-p7-7-grounding-to-commit-behavior-fix.md`, `r3-p7-8-autonomous-harness-ab.md`.

## 0. Baseline verificado

```text
git branch --show-current -> develop
git rev-parse HEAD        -> b9a27fc (test(r3): compare hybrid and autonomous agent cognition)
git status --short        -> solo scripts/diagnostics/ untracked (preexistente)
```

P7.8 CLOSED / `NO_CLEAR_WINNER` confirmado en el handoff (23.8); sin cambios experimentales pendientes.

## 1. Prueba: el P7.8 anterior compartia el loop R3

Lo que P7.8 B seguia compartiendo con A y como lo trata P7.8-R (clases pedidas):

| Elemento | Clase | A (R3) | P7.8 B | P7.8-R B / C1 |
|---|---|---|---|---|
| `runAgentToolLoop` (gathering/finalization, `Steps remaining`) | COGNITIVE_ORCHESTRATION | si | **si (compartido)** | eliminado; loop propio |
| Protocolo/parser AgentStep (`use_tool/respond/handoff`, JSON mode) | COGNITIVE_ORCHESTRATION | si | **si** | eliminado; function calling nativo |
| Semantica de parada (respond como "propuesta de parada", checkpoint open-turn, claim sin respaldo => continuar) | COGNITIVE_ORCHESTRATION | si | **si** | eliminado; texto plano termina el turno |
| Guardas no-progress / techos de emergencia | COGNITIVE_ORCHESTRATION / cota | si | si | reemplazado por cotas duras (24 llamadas de modelo, 20 tools, deadline) |
| Recuperacion estructurada (reintento JSON, reparacion guiada) | COGNITIVE_ORCHESTRATION | si | si | eliminado (no aplica a tool calling nativo); reintento de transporte igual (5) |
| Politica de prompt hibrida, contrato P4, vista P6.3, reconciliacion P5 | COGNITIVE_ORCHESTRATION | si | eliminado | eliminado |
| pendingCatalogAction / continuidad de oferta de link | COGNITIVE_ORCHESTRATION | si | si | eliminado |
| Sesion persistente + modelo de mensajes harness-aligned | contexto de conversacion | si | si | transcripcion en memoria (mismo contenido: texto usuario/asistente) |
| Set de tools (14) | MODEL_FACING_CAPABILITY_CONTRACT | si | si | mismo set en B y C1 |
| Schemas, description, useWhen, doNotUseWhen, operationSemantics | MODEL_FACING_CAPABILITY_CONTRACT | si | **si (compartido)** | B: identico (verificado por test); C1: adelgazado en las 7 tools relevantes |
| Proyeccion de resultados (`buildToolObservation`) | MODEL_FACING (resultado) | si | si | igual en B y C1 (constante del experimento) |
| Evidence gate de `select_products` (producto observado) | EXECUTION_GOVERNANCE / SAFETY | si | si | retenido (misma funcion pura); el gate de `recommend_catalog_products` no se retuvo (fuera del corpus) |
| Guard de claims de mutacion sin respaldo | SAFETY | si (bloquea) | si | solo medido, no aplicado |
| Guard de duplicados | EXECUTION_GOVERNANCE | si | si | eliminado; se mide `repeatedMutationCalls` |
| Capa de commercial-action-request (validacion, eventos de sesion, ensure de oportunidad) | EXECUTION_GOVERNANCE / OBSERVABILITY | si | si | no usada; llamada directa a `executeGovernedCapability` (la oportunidad viene del fixture, igual que A) |
| Gateway: registry, identity gate, availability, argumentos, auditoria (`crm_capability_executions`), reintento acotado | EXECUTION_GOVERNANCE | si | si | **igual** (el mismo `executeGovernedCapability`) |
| Semantica de cantidad (`quantity` requerida, sin default) | DOMAIN_TRUTH | si | si | igual en B y C1 (C1 solo cambia el texto/schema model-facing, no el dominio) |
| Telemetria P7.2/P7.3 (eventos por invocacion) | OBSERVABILITY | si | si | registros propios del harness + filas de auditoria del Gateway |

Conclusion: en P7.8 B solo se elimino la capa "prompt/P4/P5/P6.3"; toda la fila `COGNITIVE_ORCHESTRATION` del loop y todo el contrato de tools seguian compartidos. P7.8-R elimina la orquestacion en B (aislando el "harness tax") y ademas adelgaza el contrato en C1 (aislando el "capability tax").

## 2. Arquitecturas

- **A - R3 current.** Exactamente el sistema actual (`runCommercialE2ECase`, sin `promptBuilder`, flags de P7.7): kernel, DRM, vista P6.3, prompt hibrido de 47,346 chars / 150 lineas de politica, `runAgentToolLoop`, Gateway, P4, P5.
- **B - pure DeepSeek + current tools.** `benchmark/r3TrueAB/trueHarnessLoop.ts`: mientras haya limites, llama al modelo con las tools; los tool calls se ejecutan uno a uno por `executeGovernedCapability`, se agrega el resultado normalizado y el estado comercial reconstruido desde el DRM (por cada tool); un texto plano es la respuesta final. Prompt congelado de 1,158 chars (`p7.8r-true-harness-v1`). Tools: el contrato actual verbatim (15,005 chars).
- **C1 - pure DeepSeek + thin tools.** Mismo harness y mismo prompt que B. Las 7 capabilities del corpus (`search_products`, `get_product_details`, `select_products`, `set_shipping_destination`, `calculate_shipping`, `create_quote`, `get_quote`) tienen una descripcion de una frase y el schema minimo que exige la ejecucion real; el resto de las tools mantiene su contrato actual (mismo set de 14 en A/B/C1). `quantity` sigue requerida (C1 aisla complejidad de contrato, no semantica de cantidad). Contrato total: 9,644 chars (las 7 tools relevantes: 6,717 -> 1,356 chars).

Autoridad de ejecucion en B/C1: `modelo -> adapter model-facing (mapeo nombre/argumentos) -> Capability Gateway -> capability/dominio`. Ningun camino a repositorio, MariaDB, Catalog ni Quote HTTP desde el modelo.

## 3. Infraestructura compartida (identica en A/B/C1)

Mismo modelo y configuracion (`deepseek-v4-flash`, temperature 0, thinking disabled, timeout 60000, `maxOutputTokens` 4000, `maxModelRetries` 5), mismos casos/fixtures/aislamiento por run, mismo estado inicial (kernel `ensureCommercialWorkCase`), misma identidad inyectada, mismos stubs de Catalog/Carrier, mismo Gateway y mismas implementaciones, mismo `buildToolObservation`, mismo `crm_test`. Orden intercalado determinista con rotacion del brazo lider por triple (A,B,C1 / B,C1,A / C1,A,B).

No reproducible/igual limite para los tres: live assimilation, canal EC2, Quote Service BLOCKED (E14 t1 se mide por la solicitud de `create_quote`, no por su exito). Diferencias de contexto declaradas: A usa sesion persistente y contexto de tool-history por DB; B/C1 usan transcripcion en memoria y `recentCatalogContext` (para el evidence gate); B/C1 no escriben outbox (no es metrica comparada).

## 4. Pruebas de aceptacion

- **B/C1 no usan el loop R3** (`tests/agent-loop/benchmark/r3TrueAB/trueHarness.test.ts`, estatico + runtime): los archivos del harness no importan `runAgentToolLoop`, `validateAgentStep`, `agentStepTypes`, `buildAgentStepPromptPackage`, `harnessAlignedMessageProjection`, `turnStoppingCheckpoint`, sales-agent-runtime, P4/P5/P6, DB, dominios ni servicios; no contienen `AgentStep`, `use_tool`, `handoff`, gathering/finalization, `Steps remaining` ni `commercialProposal`. En runtime (DB real, `runTrueAB.test.ts`), los mensajes enviados al modelo no contienen `AgentStep`, `Steps remaining`, `commercialProposal`, `capabilityEligibility`, la regla de cierre ni `pendingCatalogAction`; las tools van como `tools` nativos (14).
- **B/C1 usan el Gateway real**: el loop importa y usa por defecto `executeGovernedCapability`; en DB real cada tool call deja fila en `crm_capability_executions` (`get_product_details`, `select_products` completed) y un outcome de Gateway no nulo; `create_quote` con sesion anonima es denegado por el identity gate y no existe quote.
- **Refresco de estado**: llamada 1 -> `get_product_details` -> estado reconstruido (`selection: []`); llamada 2 -> `select_products` -> la llamada siguiente recibe `selection: [{31, 1}]` leida de la DB.
- Contrato B sin cambios (cada tool: descripcion + useWhen + doNotUseWhen + semantica + schema = lo que renderiza el prompt R3); C1 determinista, mismo set de tools, sin cambiar requeridos del dominio (`required` iguales; propiedades subconjunto; `quantity` requerida).
- Resto: misma config y estado inicial entre brazos, clasificacion Q+/Q-, controles negativos, denominadores identicos, terminacion del loop (limite de tools, de llamadas, deadline, error de provider, salida vacia), artifacts. 37 tests P7.8-R, todos PASS.

## 4b. Prompt y superficie de tools (congelados antes del batch)

Prompt B/C1: rol, politica central pedida ("Complete the customer's requested commercial outcome using the available tools. Continue until ... Do not claim actions that have not succeeded. Do not mutate commercial state for purely informational requests."), invariantes de grounding, regla de terminacion (texto plano cierra el turno) e identidad. Sin workflow, sin reglas de `select_products`, sin regla de cierre/link, sin P4 ni narrativa de eligibility (test). Estado durable: mensaje de contexto al inicio del turno + estado reconstruido junto a cada resultado de tool.

## 5. Corpus y corridas

E02, E04, E05, E07, E14, E15 (corpus P7.7, por referencia) + N01-N04, x3 runs x 3 brazos = **90 runs**, 90/90 ejecutadas, 0 harness failures. Run: `benchmark-results/true-ab-2026-09-21T17-59-50-922Z-live/` (`manifest/runs/summary/failures/comparison` preregistrados; `summary.corrected.json`/`comparison.corrected.json` de la seccion 7). Cohorte de compra explicita: 9 turnos x3 = 27 por brazo. **Q+** (cantidad dicha): E04 t0/t1, E15 (9 turnos); **Q-** (cantidad ausente): E02, E05 t0/t1, E07 t0, E14 t0/t1 (18 turnos).

Definiciones (preregistradas, `trueAnalysis.ts`): `commercialProgressAfterGroundingRate` = turnos de intencion explicita con `get_product_details` completado en los que hay una accion apropiada: Q+ => `select_products` pedido despues del grounding; Q- => la respuesta pide especificamente la cantidad sin inventarla (o, en E14 t1, se solicita la cotizacion). `commercialProgressFixedCohortRate`: misma regla sobre los 27 turnos (denominador independiente del comportamiento). `commitAfterGroundingRate` se mantiene como metrica secundaria comparable con P7.7/P7.8.

## 6. Resultados con el detector preregistrado (`summary.json`)

| Metrica | A | B | C1 |
|---|---|---|---|
| progress after grounding (primaria) | 15/19 = 78.9% | 16/19 = 84.2% | 19/22 = 86.4% |
| progress cohorte fija (27) | 19/27 = 70.4% | 19/27 = 70.4% | 22/27 = 81.5% |
| commitAfterGrounding | 4/19 = 21.1% | 4/19 = 21.1% | 5/22 = 22.7% |
| Q- pide cantidad | 15/18 | 15/18 | 17/18 |

Signal con estas cifras: `NO_CLEAR_WINNER` (harness tax 0.0 pp, capability tax +11.1 pp < 20 pp). **Estas cifras de progreso Q- estan infladas** por un defecto del detector (seccion 7).

## 7. Correccion de medicion post-batch (declarada)

Al leer las respuestas de los turnos Q- se vio que el detector heredado de P7.8 (`/cu[aá]nt[oa]s?|cantidad|unidades/` + un signo de pregunta) marcaba como "pide la cantidad" frases como "Quedan 15 unidades disponibles. ¿Quieres que te envie el link para revisarlo?", que no piden cantidad. El defecto afecta al analisis de los tres brazos, pero no los afecta por igual (A cierra casi siempre con la oferta de link tras "unidades disponibles").

Correccion: un detector estricto (pregunta que especificamente pide cuantas/que cantidad; `cuantos/cuantas`, `que cantidad`, `cantidad que/de unidades/...`, `numero de unidades`; "cuanto" en singular excluido) aplicado igual a todos los brazos. Validado contra una lectura manual de los 54 mensajes Q- (barajados, sin etiqueta de brazo) sin ningun desacuerdo. Se recalculo desde `runs.jsonl` con `scripts/r3-true-ab-reanalyze.ts`, sin re-ejecutar ningun run; los archivos preregistrados quedaron intactos y se agregaron los `*.corrected.json`. El detector se definio despues de ver resultados (grado de libertad del analista): por eso ambos conjuntos de cifras y ambas senales se reportan, y la conclusion se formula con cautelas (seccion 9). Solo `trueAnalysis.ts` cambio tras el batch; prompt, superficies de tools, loop, cliente y runner tienen el mismo hash.

## 8. Resultados corregidos (`summary.corrected.json` / `comparison.corrected.json`)

| Metrica | A R3 | B pure+current | C1 pure+thin |
|---|---|---|---|
| **commercialProgressAfterGrounding (primaria)** | 4/19 = 21.1% | 6/19 = 31.6% | 13/22 = 59.1% |
| progress cohorte fija (27) | 7/27 = 25.9% | 9/27 = 33.3% | **16/27 = 59.3%** |
| commitAfterGrounding (secundaria) | 4/19 = 21.1% | 4/19 = 21.1% | 5/22 = 22.7% |
| durableCommitRate (27) | 4/27 = 14.8% | 4/27 = 14.8% | 5/27 = 18.5% |
| **Q+ commitRateWhenQuantityKnown** | 4/9 = 44.4% | 4/9 = 44.4% | 5/9 = 55.6% |
| Q+ unnecessaryConfirmation | 5/9 | 5/9 | 4/9 |
| **Q- commitRateWhenQuantityMissing** | 0/18 | 0/18 | 0/18 |
| **Q- requestQuantityRateWhenMissing** | 3/18 = 16.7% | 5/18 = 27.8% | 11/18 = 61.1% |
| Q- respondWithoutCommitOrQuantityQuestion | 15/18 | 13/18 | 7/18 |
| Q- assumedQuantity (selecciona inventando cantidad) | 0/18 | 0/18 | 0/18 |
| quantityRequestAccuracy | 12/27 | 14/27 | 19/27 |
| clarificationTurnRate (turnos explicitos que cierran con pregunta) | 26/27 | 27/27 | 27/27 |

Por turno (progreso cohorte fija, 3 runs): la diferencia B->C1 proviene de E05 t0 (0->2), E05 t1 (0->2), E07 t0 (0->1), E14 t0 (2->3) y E04 t1 (1->2); E02 t0, E04 t0 no progresan en ningun brazo; E15 (todo en un mensaje) 3/3 en los tres.

### Controles negativos y calidad (identicos en los tres brazos)

overMutationRate 0/12 en A, B y C1 (`overMutationDurable` 0/12); wrongQuantity 0; selectionCorruption 0/39; repeatedMutationCalls 0/39; validArgumentsRate 1.0; gatewayRejectionRate 0; fallos de argumentos 0 (0/61, 0/75, 0/80 calls), 0 respuestas con JSON invalido en los tres, 0 rechazos previos al Gateway; ungroundedMutationClaim 0. Terminal: B y C1 `responded` 42/42; A `responded` 41 + 1 `provider_unavailable` (error de red transitorio).

### Tools, latencia y tokens

| | A | B | C1 |
|---|---|---|---|
| tool calls por turno | 1.45 | 1.79 | 1.90 |
| provider calls por turno | 2.52 | 2.57 | 2.69 |
| latencia por llamada p50 / p95 | 1508 / 2198 ms | 1264 / 1649 ms | 1205 / 1617 ms |
| latencia proveedor por turno p50 / p95 | 4302 / 8865 ms | 3631 / 5995 ms | 3484 / 6939 ms |
| tokens de entrada por turno | 25,007 | 11,013 | 8,753 |
| tokens de salida por turno | 221 | 161 | 174 |
| system prompt (chars) | 47,346 | 1,158 | 1,158 |
| contrato de tools (chars) | 16,292 (render texto) | 15,005 | 9,644 (7 tools relevantes: 6,717 -> 1,356) |

## 9. Impuestos y senal

- **Harness tax (A vs B)**: progreso cohorte fija +7.4 pp (25.9% -> 33.3%; 2 turnos de 27); commit despues del grounding identico (21.1% vs 21.1%); Q+ commit identico (44.4%). Por debajo del margen material de 20 pp: la orquestacion R3 (loop, protocolo, guardas, politica hibrida) **no explica el patron dominante**; A pide la cantidad menos (3/18 vs 5/18), consistente con su regla de cierre con oferta de link.
- **Capability tax (B vs C1)**: progreso cohorte fija +25.9 pp (33.3% -> 59.3%; 7 turnos), primaria +27.5 pp, Q- pide cantidad 27.8% -> 61.1%; sin cambios de seguridad (0 sobre-mutacion, 0 argumentos invalidos) y con **menos tokens y menor latencia**. El contrato de tools actual esta asociado a que el modelo ofrezca "agregarlo a tu compra" o el link en lugar de pedir explicitamente la cantidad.
- **Lo que el contrato NO cambia**: el commit durable (4/27 vs 4/27 vs 5/27) y el commit con cantidad conocida (Q+ 4/9, 4/9, 5/9): incluso con cantidad dicha y tools finas, ~45-55% de los turnos Q+ terminan preguntando ("¿la agrego?") en lugar de persistir la seleccion; `UNNECESSARY_CONFIRMATION` 5/9, 5/9, 4/9. Ese residuo es comun a las tres arquitecturas y es coherente con comportamiento del modelo (o con semantica de confirmacion), no con R3 ni con el contrato.

Preregistered architecture signal (regla preregistrada sobre las cifras preregistradas): `NO_CLEAR_WINNER`. Post-hoc corrected exploratory finding (cifras corregidas, requires confirmatory replication): `CAPABILITY_CONTRACT_IS_BOTTLENECK` candidate (capability tax detectado, harness tax no; los tres arms seguros). Lectura defendible: **hay evidencia de un costo del contrato de capabilities sobre el progreso conversacional cuando falta la cantidad (Q-), no sobre el commit durable, y no hay evidencia de un costo de la orquestacion R3**; la cautela principal es que el detector corregido se definio post-hoc y que 7 turnos concentrados en 4 casos con n=3 sostienen el efecto.

## 10. C2 (semantica experimental de cantidad): no implementado

Condicion preregistrada: solo si C1 demostraba que `quantity` seguia siendo la frontera. No se cumplio en el sentido pertinente: en Q- ningun arm inventa cantidad (`assumedQuantity` 0/18) y el arm C1 ya pide la cantidad en 61% de los casos (pedirla es la conducta correcta con `quantity` requerida), mientras el residuo de no-commit ocurre en Q+, donde la cantidad ya se dio. Un C2 (`quantity` opcional o default 1) solo cambiaria la semantica de negocio (persistir una cantidad no confirmada) sin atacar el fallo medido; requiere una regla de negocio explicita antes de experimentarse. Persistir "cantidad pendiente" ademas exigiria un cambio de dominio, fuera de alcance.

## 11. Complejidad (sin score)

| | A | B | C1 |
|---|---|---|---|
| Politica del system prompt | 150 lineas / 47,346 chars | ~8 lineas / 1,158 chars | igual que B |
| Codigo cognitivo especifico | `buildAgentStepPromptPackage.ts` (~950 lineas) + `runAgentToolLoop.ts` (~1,830 lineas: protocolo, fases, checkpoints, guardas) + P4/P5/P6.3 | harness: `trueHarnessLoop.ts` 167 + `trueHarnessPrompt.ts` 29 + `nativeToolClient.ts` 94 = 290 lineas de codigo | igual + `toolSurface.ts` 115 lineas (superficie fina) |
| Componentes en el camino critico | DRM->vista P6.3, contrato P4, reconciliacion P5, politica hibrida, loop AgentStep, sesion persistente, guardas | loop propio, cliente nativo, renderer de estado | igual que B |
| Contrato de tools | 16,292 chars | 15,005 | 9,644 |

Respuesta: la complejidad hibrida (prompt + loop + P4/P5/P6.3) no aporto, en este corpus y con este modelo, una ventaja medible en commit, seguridad ni progreso frente a un harness de ~290 lineas; tampoco esta demostrado que el harness minimo sea mas robusto en produccion (el evidence gate retenido es el unico guard de seguridad de R3 conservado).

## 12. Limitaciones

n=3 por celda, 27 turnos por brazo y 4 casos concentran el efecto B->C1; corpus sintetico y un solo modelo; Catalog/Carrier/identidad stubs; Quote Service BLOCKED; live assimilation y canal EC2 no ejercitados; detector de "pide cantidad" por regex (validado manualmente sobre este batch, sin juez LLM); el detector corregido es post-hoc; B/C1 no aplican el guard de claims de mutacion ni de duplicados (solo medidos: 0); sesion persistente (A) vs transcripcion en memoria (B/C1); C1 adelgaza solo 7 de 14 tools; ni B ni C1 cubren `recommend_catalog_products` (evidence gate no retenido) ni flujos de shipping largos; el "commit" sigue limitado por comportamiento de confirmacion del modelo (Q+ ~45-55%); el trafico real de EC2 (donde `select_products` si se solicito tras el grounding en 4 de 5 conversaciones) sigue sin explicarse por este corpus.

## 13. Archivos

Nuevos: `lib/brain/commercial/agent-loop/benchmark/r3TrueAB/` (`nativeToolClient.ts`, `toolSurface.ts`, `trueHarnessPrompt.ts`, `trueHarnessLoop.ts`, `runTrueHarnessCase.ts`, `scriptedNativeModel.ts`, `trueAnalysis.ts`, `runTrueAB.ts`), `scripts/r3-true-ab-benchmark.ts`, `scripts/r3-true-ab-reanalyze.ts`, `tests/agent-loop/benchmark/r3TrueAB/` (3 archivos, 37 tests). Modificado (instrumento, aditivo): `r3CommercialE2E/runCommercialE2ECase.ts` (`export` de `buildBaseSnapshot`). Sin cambios de produccion, Gateway, CommercialWork, DB ni del prompt A (mismo hash que antes del batch). Erratum a P7.8: ver su documento (el detector de cantidad heredado).

## 14. Validaciones

```text
tests P7.8-R                          -> 37/37 PASS
regresion dirigida (benchmark, P7.1-P7.7, P6, P5, P4 alcanzable) -> 398/402 PASS
  4 fallas identicas a las verificadas en HEAD limpio en P7.8 ([P4-C1], [P4-C2], [P5-C1], P7.2-F): preexistentes
npm run typecheck / npm run build     -> PASS
lint focalizado (archivos P7.8/P7.8-R)-> limpio
git diff --check                      -> limpio
```

Sin base de produccion (`NODE_ENV=test`, `crm_test`). No se corrio la suite completa del repo.

## 15. Siguiente fase recomendada

No adoptar ninguna arquitectura todavia y no P8. Por evidencia: (1) confirmar el capability tax con un corpus mas grande de turnos sin cantidad y un juez de "pide cantidad" independiente del regex; (2) separar que parte del contrato thin produce el efecto (la descripcion de una frase de `select_products`, la ausencia de `useWhen/doNotUseWhen`, o el schema) con variantes de una sola dimension; (3) investigar por que Q+ no commitea en ningun brazo (comportamiento de confirmacion del modelo; probar otro modelo); (4) corpus derivado de trafico real de EC2; (5) decidir con negocio la regla de cantidad antes de cualquier C2.

## 16. Confirmaciones

Sin cambios de produccion; sin bypass del Gateway; sin DB directa desde el modelo; sin P8; sin MCP; ningun brazo (prompt, tools, loop) se modifico tras observar resultados: solo se corrigio y se declaro el detector de medicion; sin commit; sin push.
