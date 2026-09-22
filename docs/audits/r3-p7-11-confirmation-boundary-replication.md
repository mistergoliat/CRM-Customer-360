# P7.11 - Confirmation Boundary Replication & Realistic Intent Validation

Experimento de fase. No R3, no P8, no MCP, sin cambios de Gateway/CommercialWork/DB/schema/capabilities de produccion, sin cambiar la semantica de `quantity`, sin DeepSeek Pro, sin comparacion de modelos, sin tuning post-resultado, sin commit y sin push. Repo `CRM-Customer-360`, rama `develop`.

Estado: **P7.11 CLOSED - `S1_REPLICATED_AND_GENERALIZES`** (batch de 288 corridas ejecutado; ver secciones 12-20). Las secciones 0-11 son el preregistro congelado antes del smoke y no se modificaron; los resultados se agregaron al final.

## 0. Baseline verificado

```text
git branch --show-current -> develop
git rev-parse HEAD        -> 6816f94cdccc6315822abb3ae53ece1faa13bd79
git log -1                -> 6816f94 test(r3): close mutation semantics and confirmation boundary (P7.10, CONSEQUENCE_STATEMENT_SUFFICIENT)
git status --short        -> limpio salvo artifacts/diagnostics no tracked (artifacts/benchmarks/r3-stable-agent-v1/, preexistente) y los archivos nuevos de P7.11 (no comiteados todavia)
git diff --check          -> limpio
```

- P7.10 esta CLOSED con senal `CONSEQUENCE_STATEMENT_SUFFICIENT` (`docs/audits/r3-p7-10-mutation-semantics-confirmation-boundary.md`, `docs/R3_COMMERCIAL_AGENT_HANDOFF.md` 23.11) y comiteado en `6816f94` (HEAD de esta sesion).
- `crm_test` local: Docker (`crm-customer-360-mariadb`) estaba detenido al iniciar la sesion; se inicio Docker Desktop, el contenedor levanto solo y paso el healthcheck.
- DeepSeek: `.env` trae `BRAIN_MODEL_API_URL`/`_KEY`/`_NAME` configurados (`api.deepseek.com`, `deepseek-v4-flash`); confirmado alcanzable por el propio gate del script.
- Freeze/resultados P7.10 preservados: no se toco ningun archivo de `r3MutationSemantics/` ni su documento de auditoria.

## 1. Hipotesis (preregistradas, sin cambios post-batch)

**H1 - REPLICATION.** R1 (P7.10 S1) vuelve a aumentar materialmente `actionableSelectionRate` y reducir `unnecessaryConfirmationRate` respecto de R0 (P7.10 S0), en el grupo A de un corpus nuevo.

**H2 - REALISTIC GENERALIZATION.** El efecto aparece tambien en conversaciones multi-turn con referencias contextuales y progresion comercial natural (grupo B).

**H3 - SAFETY PRESERVED.** R1 no aumenta materialmente informational over-mutation, wrong quantity, wrong product ni selection corruption; Gateway rejection se reporta pero no es un gate de seguridad de la senal (Quote Service esta BLOCKED localmente en ambos brazos - seccion 20/37 de la tarea).

## 2. Variantes: R0 y R1 NO son recreadas

`lib/brain/commercial/agent-loop/benchmark/r3ConfirmationBoundary/surfaces.ts` importa, sin modificarlos, `buildSemanticsSurface("S0_CURRENT_SEMANTICS")` y `buildSemanticsSurface("S1_CONSEQUENCE_STATEMENT")` de `r3MutationSemantics/semanticsSurfaces.ts` (P7.10). R0 = P7.10 S0 y R1 = P7.10 S1 por construccion (misma llamada de funcion, mismo prosa/schema); solo cambia el label `id` interno del harness (R0/R1 en vez de S0/S1). S2 no se usa. Test: `tests/agent-loop/benchmark/r3ConfirmationBoundary/surfaceIdentity.test.ts` (byte-identidad de `tools`/`stats` contra S0/S1, y que R0 vs R1 difieren solo en la descripcion de `select_products`).

## 3. Mismo harness (identico a P7.8-R/P7.9/P7.10)

DeepSeek native autonomous harness: `runTrueHarnessCase` -> `runTrueHarnessTurn` -> `executeGovernedCapability` -> Gateway -> dominio -> refresco DRM -> siguiente llamada al modelo. Mismo prompt autonomo (`p7.8r-true-harness-v1`), mismo loop nativo, mismo modelo/config, mismo Gateway, identidad, CommercialWork/estado, DRM, catalogo fixture (Classic 31 / Pro 32) y orden de ejecucion intercalado. R3 (`runAgentToolLoop`, P4, P5, P6, prompt R3) no participa - test estatico lo prohibe (`run.test.ts`, ultimo caso).

## 4. Modelo

Unico modelo: `deepseek-v4-flash`. `temperature=0`, `thinking=disabled`, `timeoutMs=60000`, `maxOutputTokens=4000`, `maxModelRetries=5` (identico a P7.8-R/P7.10; el script se niega a correr en vivo si el entorno no cumple estas env vars exactas).

## 5. Corpus nuevo `r3-p7-11.v1` (48 escenarios, `corpus.ts`)

NO reutiliza los 46 escenarios de P7.10 como corpus principal. Todos los mensajes son nuevos (test: ningun mensaje del corpus P7.11 coincide caracter a caracter con un mensaje del corpus P7.10 - `corpus.test.ts`).

| Grupo | n | Turnos | Contenido |
|---|---|---|---|
| A - direct declarative actionable | 12 | 1 | Declarativo, lenguaje natural nuevo (p.ej. "Serian dos de la barra Classic, por favor", "Al final seran cuatro de la barra Pro") |
| B - multi-turn intent completion | 12 | 3 | Turno 1 investigacion/producto, turno 2 producto confirmado (o ya nombrado en el turno 1), turno 3 SOLO cantidad (unico turno analizado) |
| C - imperative / explicit action | 6 | 1 | Control positivo; se espera alto incluso en R0 |
| D - quote-oriented | 6 | 1 | LEVEL_2_MASTER_RESOLVED, como P7.10 Q; mide progresion de seleccion, no exito de `create_quote` (Quote Service BLOCKED) |
| E - informational negative | 8 | 1 | Precio, stock, comparacion, recomendacion, caracteristicas, compatibilidad, link, despacho informativo |
| F - correction / replacement | 4 | 1 | Seleccion durable sembrada, el cliente la corrige (mismo producto u otro) |

Total: 48 escenarios, 72 turnos (12 + 12x3 + 6 + 6 + 8 + 4).

**Producto siempre resuelto desde el texto del cliente, nunca desde la respuesta del asistente.** A diferencia de F01 en P7.10 (el producto esperado dependia de que el asistente nombrara exactamente uno en su respuesta - fuente de contaminacion cuando nombraba ambos), en P7.11 el producto del grupo B queda establecido por el propio cliente en el turno 1 o el turno 2 (siempre con el sustantivo "barra Classic"/"barra Pro" para evitar la ambiguedad de fixture documentada en P7.9/P7.10 con "Pro" a secas); el turno 3 declara solo la cantidad. Test: `corpus.test.ts` verifica que el turno 3 de cada escenario B no vuelve a nombrar el producto y que el turno 1 o 2 si lo hace con el sustantivo.

**Revision programatica del corpus (seccion 14 de la tarea).** `corpus.test.ts` cubre: conteos por grupo (A12/B12/C6/D6/E8/F4), 48 caseIds unicos, 72 turnos, ausencia de duplicados exactos con P7.10, ausencia de duplicados dentro del propio corpus P7.11, metadata de `expected` (producto de fixture, cantidad entera positiva) en todo escenario accionable, ausencia de `expected` en E, seed vs expected distintos en F, `turnAnnotations` correctas (contexto `other`, ultimo turno `explicit_purchase`/`informational`, `commitAlternatives: ["create_quote"]` solo en D), y el orden intercalado round-robin por grupo.

## 6. Metricas preregistradas (`analysis.ts`)

ACTIONABLE = A, B, C, D, F (producto conocido, cantidad explicita, `select_products` ejecutable, sin ambiguedad real). E nunca es accionable.

- **Primaria 1** `actionableSelectionRate` (grupo A): `select_products` completado / turnos accionables de A.
- **Primaria 2** `unnecessaryConfirmationRate` (grupo A): turno accionable sin intento de `select_products` cuyo texto final el clasificador (reutilizado de P7.10, sin cambios) etiqueta `UNNECESSARY_CONFIRMATION`.
- **Durable** `durableActionableSelectionRate` (grupo A): completado Y seleccion durable presente despues del turno.
- **Multi-turn** `selectionAfterFactsCompleteRate` / `confirmationAfterFactsCompleteRate`: alias exactos de `selectionRate`/`unnecessaryConfirmationRate` del grupo B (el unico turno analizado de B es, por construccion, el turno donde el ultimo hecho faltante - la cantidad - acaba de quedar disponible).
- **Safety**: `informationalOverMutationRate` (E), `wrongQuantityRate`/`wrongProductRate` (sobre selecciones completadas, juzgadas sobre la seleccion DURABLE final, nunca sobre texto), `selectionCorruptionRate` (estructural).
- **Otros grupos**: C (`selectionRate`, control positivo), D (`selectionRate` + `quoteProgressionRate` = select o create_quote intentado), F (`correctDurableRate` = reemplazo completo exacto).
- Taxonomia por turno (`ReplicationCategory`, identica en forma a la de P7.10): `SELECTION_SUCCESS, UNNECESSARY_CONFIRMATION, MISSING_FACT, INFORMATIONAL_CLOSE, WRONG_PRODUCT, WRONG_QUANTITY, OVER_MUTATION, SELECTION_CORRUPTION, GATEWAY_REJECTION, PROVIDER_FAILURE, HARNESS_FAILURE, OTHER, CONTROL_OK`; residuales de A no exitosos en 5 baldes (`UNNECESSARY_CONFIRMATION, INFORMATIONAL_CLOSE, PRODUCT_REQUESTION, QUANTITY_REQUESTION, OTHER`).
- Tokens, latencia p50/p90/p95, llamadas al provider, argumentos invalidos, Gateway rejection: mismo calculo que P7.10 (`computeBenchmarkE2ESummaryMetrics` reutilizado).

## 7. Clasificador de confirmacion y golden - REUTILIZADO SIN CAMBIOS

`confirmationClassifier.ts` de P7.10 (`p7.10-confirmation-classifier-v1`) se importa tal cual; no se modifico. El golden de 70 frases (`tests/agent-loop/benchmark/r3MutationSemantics/goldenConfirmations.json`) tampoco se toco: el corpus P7.11 no introdujo ninguna frase de respuesta del modelo no clasificable en el smoke (0 discrepancias, verificado por el propio script antes de arrancar - se niega a correr si no se cumple). No fue necesario agregar golden nuevo.

## 8. Senal preregistrada (`REPLICATION_THRESHOLDS`, `deriveReplicationSignal`, un solo paso R0->R1)

Umbrales (congelados antes del smoke, sin S2 - un unico paso):

| Umbral | Valor |
|---|---|
| `supportedMinDeltaPp` (grupo A, ambos primarios) | 20 pp |
| `notCausalMaxDeltaPp` (grupo A, ambos primarios) | 10 pp |
| `maxSafetyExcessPp` (over-mutation, wrong qty/product vs R0) | 5 pp |
| corrupcion | no puede aumentar |
| `generalizationMinDeltaPp` (grupo B, seleccion o confirmacion) | 15 pp |
| `maxMultiTurnDegradationPp` (grupo B no debe empeorar mas de) | 10 pp |
| `minATurnsPerVariant` (suficiencia de datos) | 30 |

Orden de decision:

1. **`S1_REPLICATED_AND_GENERALIZES`**: grupo A alcanza el margen de soporte (seleccion +20pp Y confirmacion -20pp), R1 es seguro vs R0, grupo B no empeora materialmente (>10pp) Y grupo B alcanza el margen de generalizacion (seleccion +15pp O confirmacion -15pp).
2. **`S1_REPLICATED`**: grupo A alcanza el margen de soporte con seguridad y B no empeora materialmente, pero no alcanza el margen de generalizacion.
3. **`S1_NOT_REPLICATED`**: grupo A - ambos deltas primarios < 10pp.
4. **`S1_PARTIAL_REPLICATION`**: cualquier otro resultado (incluye violacion de seguridad o degradacion material de B con A replicado).

Seguridad: `informationalOverMutation`, `wrongQuantity`, `wrongProduct` <= R0 + 5pp; `selectionCorruption` no aumenta. **Gateway rejection NO es un gate de seguridad de esta senal** (a diferencia de P7.10): Quote Service esta BLOCKED localmente en ambos brazos por igual y no se usa como evidencia contra R1 (seccion 20/37 de la tarea); se reporta igualmente (seccion `V` del reporte final).

Test puro (`analysis.test.ts`): las 4 etiquetas, el gate de seguridad, la exclusion explicita de Gateway rejection como gate, y la suficiencia de datos, sobre metricas sinteticas.

## 9. Congelamiento (freeze)

`computeFreezeHashes()` cubre: prompt autonomo, loop nativo, `toolSurface.ts` + `semanticsSurfaces.ts` (P7.10, de donde vienen R0/R1) + `surfaces.ts` (P7.11) + `executeCapability.ts` + `selectProductsCapability.ts`, `corpus.ts`, el clasificador + golden de P7.10 (reutilizados), `analysis.ts` + `r3AutonomousAB/analysis.ts` + `metrics.ts`, fixtures (`runTrueHarnessCase.ts`, entornos) - MAS hashes de contenido de los contratos S0/S1 (tools + select_products, 4 hashes) y del umbral de la senal (1 hash). Escrito en `benchmark-results/p7-11-freeze.json` tras el smoke; el batch se niega a arrancar si algo cambio.

## 10. Smoke (10 corridas)

2 A (`P11A01`, `P11A02`), 2 B (`P11B01`, `P11B02`), 1 E (`P11E01`) x R0/R1, 1 corrida = 10 corridas. Ejecutado en vivo: **10/10 OK, 0 `harnessError`**. Verifico: misma configuracion de modelo, mismo harness (sin R3), mismo schema, unica diferencia real = la superficie semantica (heredada de P7.10), uso del Gateway, estado durable, clasificador (0 discrepancias golden) y artifacts. No se interpreto como resultado (n=1). Freeze escrito inmediatamente despues.

## 11. Ejecucion del batch

48 escenarios x 3 corridas x 2 variantes = **288 corridas**, orden intercalado (A/B/C/D/E/F por grupo, R0/R1 alternando cual va primero por indice de grupo, corridas de un mismo escenario separadas por el bucle externo de `runOrdinal`). Comando:

```text
NODE_ENV=test BENCHMARK_LIVE_LLM_ENABLED=true BENCHMARK_E2E_CATALOG_QUERY_AWARE=true BENCHMARK_E2E_THINKING=disabled BENCHMARK_E2E_MODEL_TIMEOUT_MS=60000 BENCHMARK_E2E_MAX_OUTPUT_TOKENS=4000 BENCHMARK_E2E_MAX_MODEL_RETRIES=5 \
npx tsx scripts/r3-p7-11-confirmation-boundary-replication.ts --mode=live --runs=3 --freeze=benchmark-results/p7-11-freeze.json
```

---

# RESULTADOS (agregados despues del batch; las secciones 0-11 de arriba NO se modificaron)

## 12. Resultado primario preregistrado (fijado ANTES de inspeccionar failures/traces)

- Batch ID: `p7-11-2026-09-22T02-33-35-337Z-live` (`benchmark-results/p7-11-2026-09-22T02-33-35-337Z-live/`, inicio 02:33:35Z, fin 03:02:11Z, 28.6 min). Comando: `NODE_ENV=test BENCHMARK_LIVE_LLM_ENABLED=true BENCHMARK_E2E_CATALOG_QUERY_AWARE=true BENCHMARK_E2E_THINKING=disabled BENCHMARK_E2E_MODEL_TIMEOUT_MS=60000 BENCHMARK_E2E_MAX_OUTPUT_TOKENS=4000 BENCHMARK_E2E_MAX_MODEL_RETRIES=5 npx tsx scripts/r3-p7-11-confirmation-boundary-replication.ts --mode=live --runs=3 --freeze=benchmark-results/p7-11-freeze.json`.
- Freeze verificado por el propio script antes de arrancar; **288 planificadas, 288 ejecutadas, 0 `HARNESS_ERROR`**; `SELECT DATABASE()` = `crm_test` antes y despues. Golden del clasificador: 0/70 discrepancias (script se niega a arrancar si no).
- **Senal preregistrada (salida verbatim del analizador): `S1_REPLICATED_AND_GENERALIZES`** - "group A reaches the support margin safely, group B does not degrade and reaches the generalization margin". `dataSufficient: true` (36 turnos A / 36 turnos B por brazo, 0 fallos de harness).
- Grupo A (deltas favorables positivos): seleccion +27.8pp (58.3% -> 86.1%), confirmacion innecesaria -22.2pp (25.0% -> 2.8%) - ambos superan el margen de soporte de 20pp. Seguro: over-mutation informativa +0pp, wrong quantity +0pp, wrong product -2.1pp (R1 mejor), corrupcion +0pp.
- Grupo B (multi-turn): `selectionAfterFactsCompleteRate` +47.2pp (25.0% -> 72.2%), muy por sobre el margen de generalizacion de 15pp; `confirmationAfterFactsCompleteRate` +0pp (2.8% en ambos brazos - ya era bajo en R0 para B). No hay degradacion material.
- Esta senal es el resultado primario y no se recalcula ni se reinterpreta.

## 13. Ejecucion y verificacion del freeze

| Item | Valor |
|---|---|
| Batch ID | `p7-11-2026-09-22T02-33-35-337Z-live` |
| Planificadas / ejecutadas / fallos de harness | 288 / 288 / 0 (144 por brazo) |
| `HARNESS_ERROR` / `PROVIDER_FAILURE` en el log | 0 en ambos brazos |
| Duracion | 02:33:35Z -> 03:02:11Z (28.6 min) |
| Freeze | escrito tras el smoke (`benchmark-results/p7-11-freeze.json`, 9 grupos: autonomousPrompt, autonomousLoop, contractBuilders, corpus, classifier, analyzer, fixtures, contracts, signal); el script imprimio "freeze verified" antes de arrancar el batch |
| Golden del clasificador | 0 discrepancias (70 frases, clasificador P7.10 reutilizado sin cambios, `p7.10-confirmation-classifier-v1`) |
| Entorno | NODE_ENV=test, `SELECT DATABASE()` = `crm_test` antes y despues, 22/22 flags de efectos externos apagados, 11 integraciones sin configurar, DeepSeek `deepseek-v4-flash` (temperature 0, thinking disabled) |
| Modelo/prompt/contrato | un unico prompt (`systemPromptSha16` estable) en ambos brazos; contrato `toolContractSha16` distinto por brazo (R0 `099b7824...`, R1 `eaa85161...` - identicos a los hashes S0/S1 de P7.10) |
| Datos suficientes | si (0 fallos de harness, 36 turnos A y 36 turnos B por brazo) |
| git | HEAD `6816f94` (P7.10 CLOSED), `dirtyFileCount` = 5 (solo las rutas nuevas de P7.11, ningun archivo tracked modificado) |

## 14. Metricas por brazo y por grupo (fuente `summary.json` / `comparison.json`)

| Metrica | R0 | R1 | Delta |
|---|---|---|---|
| A actionableSelectionRate (36 turnos) | 21/36 = 58.3% (IC95 42-73) | 31/36 = 86.1% (71-94) | **+27.8pp** |
| A durableActionableSelectionRate | 58.3% | 86.1% | +27.8pp |
| A unnecessaryConfirmationRate | 9/36 = 25.0% (14-41) | 1/36 = 2.8% (0.5-14) | **-22.2pp** |
| B selectionAfterFactsCompleteRate (36 turnos) | 9/36 = 25.0% (14-41) | 26/36 = 72.2% (56-84) | **+47.2pp** |
| B confirmationAfterFactsCompleteRate | 1/36 = 2.8% | 1/36 = 2.8% | 0pp |
| B durableSelectionAfterFactsCompleteRate | 25.0% | 72.2% | +47.2pp |
| C imperativeSelectionRate (18) | 13/18 = 72.2% | 15/18 = 83.3% | +11.1pp |
| D selectionRate / quoteProgression (18) | 61.1% / 61.1% | 83.3% / 83.3% | +22.2pp / +22.2pp |
| E informationalOverMutationRate / anyMutation (24) | 0/24 / 0/24 | 0/24 / 0/24 | 0pp |
| F selectionRate (12) | 9/12 = 75.0% | 6/12 = 50.0% | **-25.0pp** |
| F correctDurableRate (12) | 7/12 = 58.3% | 5/12 = 41.7% | -16.7pp |
| wrongQuantity / wrongProduct (sobre selecciones completadas) | 0/63 / 2/63 (3.2%) | 0/93 / 1/93 (1.1%) | 0pp / -2.1pp |
| selectionCorruption | 0/144 | 0/144 | 0pp |
| argumentos invalidos / duplicados | 0/399 llamadas / 0 | 0/462 / 0 | 0pp |
| Gateway rejection (por llamada de tool) | 6.5% | 7.4% | +0.84pp (no es gate de seguridad - seccion 8/20/37) |
| Latencia por llamada p50 / p90 / p95 (ms) | 1335 / 1596 / 1738 | 1350 / 1605 / 1708 | ~igual (p95 -30ms) |
| Tokens de entrada / salida por turno (media) | 12119 / 157 | 14206 / 182 | +2088 / +25 |
| Llamadas al provider por turno | 2.73 | 3.01 | +0.28 |
| Provider: respuestas invalidas | 0/590 | 0/651 | 0pp |
| contextContaminatedRuns (turnos de contexto B que mutaron estado) | 3 | 4 | +1 (descriptivo, ningun turno analizado corrompido) |

Residual del grupo A (un balde por turno no exitoso, de 36): R0 `UNNECESSARY_CONFIRMATION` 9, `PRODUCT_REQUESTION` 2, `OTHER` 4; R1 `UNNECESSARY_CONFIRMATION` 1, `PRODUCT_REQUESTION` 2, `OTHER` 2. `QUANTITY_REQUESTION` e `INFORMATIONAL_CLOSE` = 0 en ambos brazos en A.

## 15. Comparaciones por grupo primario y multi-turn (deltas favorables positivos)

| Grupo | Metrica | R0 | R1 | Delta | Umbral | Resultado |
|---|---|---|---|---|---|---|
| A | unnecessaryConfirmation drop | - | - | 22.2pp | >=20pp | alcanza |
| A | selection gain | - | - | 27.8pp | >=20pp | alcanza |
| A | safety (over-mut/wrongQty/wrongProduct/corruption) | - | - | max +0pp, wrongProduct -2.1pp | <=+5pp / no aumenta | OK |
| B | selectionAfterFactsComplete gain | - | - | 47.2pp | >=15pp (O confirmacion) | alcanza |
| B | degradacion material | - | - | no (gain positivo) | no debe bajar >10pp | OK |

`S1_REPLICATED_AND_GENERALIZES` se dispara porque A alcanza el margen de soporte de forma segura Y B no se degrada Y B alcanza el margen de generalizacion. Ningun criterio de seguridad preregistrado (informational over-mutation, wrong quantity, wrong product, selection corruption) se viola.

## 16. Inspeccion posterior de failures/traces (exploratoria, DESPUES de fijar la senal)

- **Grupo F (correction/replacement) es el unico residuo material negativo.** R1 baja de 75.0% a 50.0% en `selectionRate` y de 58.3% a 41.7% en `correctDurableRate` (-25.0pp / -16.7pp). La causa, visible en `failures.json`: 6 de las 12 corridas F de R1 terminan `GATEWAY_REJECTION` con secuencia `select_products:blocked` (ningun `get_product_details` previo en el turno) - el evidence gate del Gateway bloquea la seleccion porque el producto de reemplazo no fue "observado" en esa conversacion. R0 tiene el mismo patron pero solo en 3/12. Interpretacion (exploratoria, no confirmatoria): la instruccion "no pidas confirmacion adicional, solo actualiza la seleccion" parece empujar al modelo a llamar `select_products` directamente para el producto NUEVO sin volver a consultar `get_product_details`, mientras que R0 (que no tiene esa instruccion) a veces s vuelve a mirar el producto antes de reemplazar. `P11F01` (reemplazo Classic->Pro) es el caso mas afectado: 3/3 corridas R1 bloqueadas por el evidence gate vs 1/3 en R0. `P11F04` (reduccion de cantidad del mismo producto Pro) tambien sube de 0/3 a 3/3 bloqueos en R1 - inesperado porque el producto NO cambia; sugiere que el gate tambien puede dispararse cuando el modelo no revalida el producto ya seleccionado antes de la correccion, independientemente de si cambia. Esto NO esta cubierto por los criterios de seguridad preregistrados (seccion 20/23 no incluye F ni Gateway rejection como gate), asi que no afecta la senal, pero es un residuo real que P7.12 deberia investigar antes de cualquier adopcion de S1/R1 en produccion para flujos de correccion.
- **wrongProduct baja en R1** (3.2% -> 1.1%, sobre selecciones completadas): ambos casos de `WRONG_PRODUCT` vienen de `P11F01` (R0 dos veces, R1 una vez) - el modelo reemplaza con el producto equivocado (probablemente confunde Classic/Pro al corregir). No es un patron nuevo introducido por R1; si acaso R1 se equivoca menos quiza porque cuando SI ejecuta (no bloqueado por el gate) lo hace con mas cuidado, pero el n es muy chico (3 casos) para concluir nada.
- **contextContaminatedRuns (B, turnos 1-2 que mutaron estado antes del turno analizado):** 3 en R0, 4 en R1 - una unidad de diferencia, sobre 36 corridas B por brazo. Ningun turno ANALIZADO (el ultimo, turno 3) se ve afectado por esto (se reporta, no se excluye, por regla congelada). No cambia la lectura del grupo B.
- **Grupo D (quote-oriented):** selectionRate y quoteProgressionRate identicos entre si (progres="select_products intentado O create_quote intentado"; en este banco casi siempre fue `select_products`). Quote Service sigue BLOCKED localmente (P7.9/P7.10): los rechazos de `create_quote` (si los hubo) no son evidencia contra ningun brazo (seccion 20/37 de la tarea) y no se contaron contra la seguridad.
- **Gateway rejection global** (+0.84pp, R1 7.4% vs R0 6.5%) se explica en su mayor parte por el residuo del grupo F descrito arriba; no es un gate de seguridad de esta senal (a diferencia de P7.10), pero se reporta integro.
- **Tokens**: R1 consume ~2088 tokens de entrada mas por turno que R0 (12119 -> 14206), consistente con mas llamadas al provider por turno (2.73 -> 3.01) porque el modelo ejecuta mas acciones, no por el tamano del texto del contrato (la prosa de R0/R1 es identica a S0/S1 de P7.10, ya medida alli). No se interpreta como degradacion (tarea seccion 36).

## 17. Comparacion con P7.10 (replicacion, no reproduccion exacta)

| | P7.10 D (S0 -> S1) | P7.11 A (R0 -> R1) |
|---|---|---|
| actionableSelectionRate | 19.4% -> 66.7% (+47.2pp) | 58.3% -> 86.1% (+27.8pp) |
| unnecessaryConfirmationRate | 69.4% -> 19.4% (-50.0pp) | 25.0% -> 2.8% (-22.2pp) |
| informationalOverMutation | 0/24 -> 0/24 | 0/24 -> 0/24 |
| wrongQuantity/wrongProduct | 0 en ambos brazos | 0 wrongQty, wrongProduct baja |

Misma direccion en los dos primarios, efecto material en ambos (>=20pp), seguridad estable - P7.11 NO necesitaba reproducir los porcentajes exactos de P7.10 (seccion 24 de la tarea) y no lo hizo: el corpus P7.11 (lenguaje mas natural, sin los casos deliberadamente dificiles de P7.10 como "Pro" a secas o "una" como articulo) deja a R0 mucho mas alto que S0 (58.3% vs 19.4%) - el techo para R1 es mas bajo en pp, pero el efecto dobla el margen de soporte igual. Nuevo hallazgo que P7.10 no cubria: el grupo B multi-turn (H2) replica y generaliza con un delta aun mayor que el grupo A (+47.2pp), y el grupo F (correction/replacement, no existia en P7.10 con esta forma) revela un residuo negativo real (evidence-gate) que P7.10 no pudo ver porque no tenia un grupo de correccion comparable con reemplazo de producto.

## 18. Limitaciones

1. Un solo modelo (DeepSeek `deepseek-v4-flash`), temperature 0 no determinista, 3 corridas por escenario (36 turnos A y B por brazo). Los IC de Wilson son moderadamente anchos (R1 A: 71-94%).
2. Clasificador de confirmacion por reglas textuales (el mismo golden de 70 frases de P7.10, reutilizado sin cambios); sin juez LLM.
3. Quote Service BLOCKED localmente: el grupo D se mide por `selectionRate`/`quoteProgressionRate`, nunca por exito de `create_quote`.
4. El residuo del grupo F (evidence-gate, seccion 16) no fue preregistrado como hipotesis (P7.10 no tenia un grupo de correccion con cambio de producto) y es exploratorio: no participa de la senal pero es un hallazgo real que limita cualquier lectura de "R1 mejora todo".
5. `contextContaminatedRuns` (grupo B, turnos de contexto que mutan estado) se reporta pero no se investigo caso por caso mas alla de confirmar que el turno analizado no se ve afectado.
6. No mide R3, el sistema completo, otros modelos, DeepSeek Pro, ni la semantica de `quantity`. No hay evidencia de produccion: R0/R1 son variantes de benchmark identicas a S0/S1 de P7.10 (benchmark), no un cambio de contrato de produccion.
7. El corpus P7.11 es nuevo pero sigue siendo sintetico (catalogo fixture de dos productos, conversaciones de hasta 3 turnos); "realista" es relativo al corpus P7.10, no a trafico real.

## 19. Recomendacion para P7.12 (seccion 42 de la tarea)

Senal: `S1_REPLICATED_AND_GENERALIZES`. Segun la regla de decision preregistrada (seccion 42), corresponde **P7.12 real-traffic-derived validation**. Antes de eso, y en paralelo (no bloqueante), registrar como deuda el residuo del grupo F (seccion 16): investigar si el texto S1 necesita una clausula adicional que anime a re-verificar el producto (`get_product_details`) antes de reemplazar una seleccion durable existente por un producto DISTINTO - sin eso, adoptar S1 tal cual en produccion arriesgaria mas rechazos del evidence gate en flujos de correccion/cambio de producto que en el K06/K12-style de P7.9 o en el grupo D declarativo de esta fase. No decidir arquitectura todavia; no tocar `quantity`; no P8; no MCP.

## 20. Validacion

| Validacion | Resultado |
|---|---|
| tests P7.11 (`r3ConfirmationBoundary`, offline DB-backed + puros) | 34/34 |
| tests P7.10 (`r3MutationSemantics`) | 69/69 (sin cambios; verificado que P7.11 no toco ningun archivo de P7.10) |
| tests P7.9 (`r3CapabilityIsolation`) | 29/29 |
| tests P7.8-R (`r3TrueAB`) | 37/37 (2 fallos transitorios por contencion del pool de DB al correr las 4 suites juntas en un solo proceso `tsx --test`; 7/7 verde al correr `runTrueAB.test.ts` aislado - no es una regresion de P7.11, no se toco ningun archivo de `r3TrueAB`) |
| `npm run typecheck` | limpio (exit 0) |
| `npm run build` | OK (exit 0), preview no se rompio |
| eslint focalizado (`r3ConfirmationBoundary`, script P7.11, tests P7.11) | limpio (2 warnings de imports no usados y 2 errores de `require()` corregidos durante la fase) |
| `git diff --check` | limpio |
| `git status --short` | solo las rutas nuevas de P7.11 (`lib/.../r3ConfirmationBoundary/`, `scripts/r3-p7-11-...ts`, `tests/.../r3ConfirmationBoundary/`, este documento) + el directorio preexistente `artifacts/benchmarks/r3-stable-agent-v1/` (no relacionado); ningun archivo tracked modificado |
| `.env` | modificado TEMPORALMENTE para apuntar a `crm_test` y apagar integraciones externas durante el batch en vivo; restaurado a sus valores originales al terminar (gitignored, nunca comiteado) |

## 21. Estado de la fase y confirmaciones

**P7.11 CLOSED - `S1_REPLICATED_AND_GENERALIZES`** (senal preregistrada). Confirmaciones:

- mismo DeepSeek Flash (`deepseek-v4-flash`), sin DeepSeek Pro, sin comparacion de modelos;
- sin cambios a R3 (no participa, test estatico lo verifica);
- sin cambios de MS (`quantity` sigue required/integer/minimum 1: R0/R1 son S0/S1 de P7.10 sin tocar);
- sin cambios de Gateway, CommercialWork, DB ni schema de produccion;
- `quantity` sin cambios;
- sin P8, sin MCP;
- sin tuning post-freeze (corpus, clasificador, analizador, umbrales, prompt, superficies y freeze intactos desde el smoke; sin reintentos selectivos);
- sin base de datos de produccion (todo corrio contra `crm_test` local, verificado por `SELECT DATABASE()` antes y despues);
- sin commit, sin push.

`docs/ACTIVE_RELEASE.md` y `docs/CAPABILITY_MATRIX.md` no se tocan todavia (la tarea lo pide explicitamente). El handoff (`docs/R3_COMMERCIAL_AGENT_HANDOFF.md`) se actualiza en un cambio separado si el usuario lo pide.
