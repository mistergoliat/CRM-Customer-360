# P7.12 - Conversational Soak & Adversarial Stress Test

Experimento de fase. No R3, no P8, no MCP, sin DeepSeek Pro, sin model comparison, sin cambios de Gateway/CommercialWork/DB/schema/capabilities de produccion, sin tocar produccion. S1 (P7.10/P7.11) queda FIJO para esta fase. Repo `CRM-Customer-360`, rama `develop`.

Estado: **P7.12 CLOSED - `ROBUSTNESS_FAIL`** (soak principal ejecutado; ver secciones 12-22). Las secciones 0-11 son el preregistro congelado antes del soak principal y no se modificaron; los resultados se agregaron al final.

## 0. Baseline verificado

```text
git branch --show-current -> develop
git rev-parse HEAD        -> 45c6052 (P7.11 CLOSED, S1_REPLICATED_AND_GENERALIZES)
git status --short        -> limpio salvo artifacts/diagnostics no tracked y los archivos nuevos de P7.12 (no comiteados todavia)
```

- P7.11 esta CLOSED (`S1_REPLICATED_AND_GENERALIZES`, `docs/R3_COMMERCIAL_AGENT_HANDOFF.md` 23.12, `docs/audits/r3-p7-11-confirmation-boundary-replication.md`).
- `crm_test` local: Docker (`crm-customer-360-mariadb`) healthy.
- DeepSeek: `.env` trae `BRAIN_MODEL_API_URL`/`_KEY`/`_NAME` (`api.deepseek.com`, `deepseek-v4-flash`); confirmado alcanzable por el gate del script.

## 1. Objetivo

Soak conversacional continuo, adversarial, dirigido a ROMPER el agente (no a optimizar una metrica aislada): continuidad conversacional, memoria de facts, estado durable, seleccion, correcciones, reemplazos, cambios de intencion, conversacion casual, ambiguedad, contradicciones, referencias, mensajes fragmentados/compuestos, loops, repeticion, fallos de tools/Gateway, recuperacion, abandono/retomada, resistencia a mutaciones incorrectas - sobre S1 (fijo, sin comparacion S0/S1 en esta fase).

## 2. S1 no se recrea (seccion 5 de la tarea)

`lib/brain/commercial/agent-loop/benchmark/r3ConversationalSoak/surface.ts` importa, sin modificarla, `buildReplicationSurface("R1_CONSEQUENCE_STATEMENT")` de P7.11 (que a su vez es `buildSemanticsSurface("S1_CONSEQUENCE_STATEMENT")` de P7.10, sin modificar). **P7.12 S1 === P7.11 R1 === P7.10 S1, byte-identico** por construccion (misma cadena de llamadas), test-verificado (`surfaceIdentity.test.ts`).

## 3. Harness

Identico a P7.8-R/P7.10/P7.11: `user message -> model -> native tool call -> executeGovernedCapability -> Gateway -> DB -> DRM refresh -> model continuation -> final response`. R3 no participa (test estatico). Adaptacion nueva y necesaria: `soakSession.ts` extrae la logica por-turno de `runTrueHarnessCase` (setup una vez / correr UN turno / teardown) para poder intercalar 3 conversaciones independientes a nivel de turno - `runTrueHarnessCase` procesa todos los turnos de UN caso en una sola llamada y no puede pausar entre turnos para que otra conversacion avance. Ningun archivo de P7.8-R/P7.10/P7.11 fue modificado; `soakSession.ts` reutiliza exactamente las mismas piezas exportadas (`renderCommercialState`, `runTrueHarnessTurn`, `setupR3BenchmarkEnvironment`, fixtures de identidad, mapeo de DRM).

## 4. Modelo

`deepseek-v4-flash`, `temperature=0`, `thinking=disabled`, `timeoutMs=60000`, `maxOutputTokens=4000`, `maxModelRetries=5` - identico a P7.8-R/P7.10/P7.11, sin cambios durante el soak.

## 5. Arquitectura del soak: 3 conversaciones persistentes, intercaladas

Cada conversacion (`A` BUYER_CHAOTIC, `B` BROWSER_UNCERTAIN, `C` ADVERSARIAL_STRESS) mantiene su propia `CommercialWork`/`conversation`/`customer`/seleccion/estado durable, aislados por `opportunityId`/`conversationId`/`waId` unicos (verificado por `checkCrossConversationIsolation`, HARD_FAILURE si colisionan). Ejecucion round-robin estricta `A,B,C,A,B,C,...` (nunca una conversacion completa antes de que otra empiece) - test-verificado (`stressPlan.test.ts`).

## 6. Stress-plan congelado (`stressPlan.ts`), NO generado en runtime

48... **183 turnos** (66 A / 52 B / 65 C), cubriendo las 26 categorias de stress de la tarea (todas presentes al menos una vez, test-verificado), incluyendo:

- >= 20 transiciones de correccion/reemplazo (CORRECTION + REPLACEMENT + CONTRADICTION combinadas - una cadena de contradiccion ES una correccion de una cantidad/producto ya declarado).
- Ambiguedad real (referencias sin antecedente inequivoco: "esa", "la otra", "dale", "ya", "la mas barata", ...) - sin mutacion esperada salvo que el antecedente sea realmente inequivoco.
- Track articulo/cantidad ("una Classic", "quiero una", "un banco") replicando la ambiguedad "una/un" documentada en P7.10.
- Replacement/correction como track critico por el antecedente de P7.11 (regresion del grupo F: 75% -> 50% por rechazos del evidence gate).
- 5 fallos inyectados one-shot (`faultInjection.ts`, seccion 23 de la tarea): 2x `CATALOG_TIMEOUT`, 1x `GATEWAY_DEPENDENCY_REJECTION`, 1x `INVALID_CATALOG_RESPONSE`, 1x `REGISTRY_MISMATCH` - siempre envolviendo el Gateway REAL (`executeGovernedCapability`, nunca modificado ni bypassado); exactamente UNA llamada a la capability objetivo es sustituida por un rechazo sintetico, todo lo demas (incluidas llamadas posteriores a la misma capability en el mismo turno, y todo turno subsiguiente) va al Gateway real.
- Casual chat, topic switches, long-range context (referencia 20-40+ turnos despues), multi-intent, multi-producto, quote intent, cambio de destino, duplicados literales.

**Producto siempre nombrado por el cliente** (nunca inferido de la respuesta del asistente).

Cada turno declara: `conversation`, `sequenceIndex` (global, intercalado), `localIndex`, `message`, `stressCategory`, `expectedMutation` (NONE/SELECT/MODIFY/REPLACE/CANCEL/KEEP), `expectedFinalSelection` (SOLO cuando el texto del cliente hace inequivoco el carrito resultante completo - `select_products` es FULL_REPLACEMENT), `allowClarification`, y opcionalmente `fault`.

## 7. Judge determinista (seccion 28 de la tarea) - sin LLM-as-judge

`analysis.ts` reutiliza exactamente las mismas primitivas de P7.10/P7.11: `analyzeRun`/`selectionIsCorrupt` (P7.9), el clasificador de confirmacion de P7.10 (`confirmationClassifier.ts`, reutilizado sin cambios), y comparacion estructural sobre el estado durable (nunca sobre el texto). Extension nueva: **carry-forward de la expectativa**. Un turno NONE/KEEP que sigue a un checkpoint declarado hereda esa expectativa (el carrito no deberia cambiar en un turno informativo/de confirmacion), lo que extiende la verificacion a la mayoria de los turnos casuales/informativos sin inventar nunca una expectativa para un turno genuinamente ambiguo (esos quedan `matches: null`, "no verificado", nunca contados como correctos).

**Correccion aplicada durante el smoke (seccion 37, "objetivo instrumentacion, no behavior"):** la primera version confundia "el modelo no completo la mutacion esperada" (p.ej. bloqueado por un fault inyectado, o pidio una aclaracion) con "wrongProduct/wrongQuantity" (corrupcion de datos). Se corrigio antes del freeze final: `wrongProduct`/`wrongQuantity` SOLO se evaluan cuando `select_products` realmente se completo este turno; si no se completo, el turno queda `matches: null` y se registra por separado como `expectedMutationNotCompleted` (comportamental, nunca release blocker). Test de regresion agregado (`analysis.test.ts`).

## 8. Invariantes estructurales (`invariants.ts`, seccion 25), verificados DESPUES DE CADA TURNO

- `validSelectionStructure`: producto de fixture conocido, cantidad entera positiva, sin lineas duplicadas -> **HARD_FAILURE**.
- `noRunawayToolExecution`: el loop del harness alcanzo su propio limite de emergencia (`emergency_limit_exceeded`) -> **HARD_FAILURE** (proteccion de loop, seccion 32).
- `crossConversationIsolation`: ids de fixture (opportunity/conversation/wa) no unicos entre las 3 sesiones -> **HARD_FAILURE**.
- `noMutationOnInformationalTurn`, `noUnexpectedDeletion`, `noFalseSuccessClaim`: reportados, NO HARD (residuos de comportamiento/seguridad, seccion 42).

## 9. Clasificador y golden - reutilizados sin cambios

`confirmationClassifier.ts` de P7.10 (`p7.10-confirmation-classifier-v1`) y su golden de 70 frases, importados tal cual. 0 discrepancias (el script se niega a arrancar si no).

## 10. Freeze

`computeFreezeHashes()` cubre: prompt autonomo, loop nativo, superficie S1 (P7.10/P7.11, de donde viene S1 de P7.12), `soakSession.ts`, `stressPlan.ts`, `faultInjection.ts`, `invariants.ts`, clasificador+golden (P7.10), `analysis.ts` + analizadores compartidos, fixtures - MAS un hash de contenido del stress-plan completo (`sha256(JSON.stringify(STRESS_PLAN))`). Escrito en `benchmark-results/p7-12-freeze.json` tras el smoke (y regenerado una vez, tras la correccion de instrumento de la seccion 7); el soak principal se nego a arrancar hasta verificar el freeze.

## 11. Smoke (5 minutos, seccion 37)

24 corridas (~8 por conversacion, incluye el primer fault inyectado `C5:CATALOG_TIMEOUT`). Ejecutado en vivo dos veces: la primera revelo el bug de clasificacion de la seccion 7 (corregido, instrumento no comportamiento); la segunda (post-fix) corrio limpio: 24/24 OK, 0 `HARNESS_ERROR`, ~1.0 min wall-clock (~2.5s/turno), interleaving/persistencia/fault-injection/invariantes/artifacts/timer/tokens verificados. `robustness signal` del smoke: `ROBUSTNESS_FAIL` con 2 release blockers - **no se interpreta como resultado** (n=1 por escenario, objetivo era el instrumento, seccion 37); se preserva como historial.

**Nota sobre duracion (declarada ANTES de ver el resultado del soak principal, para no maquillar el hallazgo despues):** al ritmo medido en el smoke (~2.5s/turno), el plan de 183 turnos en un solo pase tomaria ~8 minutos, muy por debajo del target de ~60 minutos (seccion 2/38 de la tarea). Los turnos de P7.12 son en promedio mas livianos que los de P7.10/P7.11 (muchos turnos puramente informativos/casuales con 0-1 tool call). Para acercarse al target de duracion sin generar contenido nuevo, se agrego `cycles`: repetir el MISMO plan congelado, textual, las veces que haga falta, sobre las mismas 3 sesiones persistentes (nunca una adaptacion basada en resultados - sigue siendo 100% deterministico y decidido antes de ejecutar). El soak principal corre con `cycles=4` (732 turnos planificados, tope de seguridad `maxWallClockMs=60min`).

---

# RESULTADOS (agregados despues del soak principal; las secciones 0-11 de arriba NO se modificaron)

## 12. Resultado primario preregistrado (fijado ANTES de inspeccionar traces individuales)

- Run ID: `p7-12-2026-09-22T03-50-00-097Z-live` (`benchmark-results/p7-12-2026-09-22T03-50-00-097Z-live/`). Comando: `NODE_ENV=test BENCHMARK_LIVE_LLM_ENABLED=true BENCHMARK_E2E_CATALOG_QUERY_AWARE=true BENCHMARK_E2E_THINKING=disabled BENCHMARK_E2E_MODEL_TIMEOUT_MS=60000 BENCHMARK_E2E_MAX_OUTPUT_TOKENS=4000 BENCHMARK_E2E_MAX_MODEL_RETRIES=5 npx tsx scripts/r3-p7-12-conversational-soak.ts --mode=live --freeze=benchmark-results/p7-12-freeze.json --cycles=4`.
- Freeze verificado antes de arrancar. **732 turnos planificados (183 x 4 ciclos), 732 ejecutados, `planExhausted: true`**. Wall-clock: **18.7 min** (mas abajo, seccion 13, por que no llego a ~60 min). `HARD_FAILURE: none`. `crossConversationIsolation: ok` (ids de fixture unicos en las 3 sesiones durante todo el soak).
- **Senal preregistrada: `ROBUSTNESS_FAIL`** - 54 release blockers (seccion 41 de la tarea). 0 fallos HARD, 0 corrupcion estructural, 0 fuga cross-conversation - pero release blockers reales (wrong product/quantity en turnos "final-say", duplicados, un false-success-claim) segun la regla preregistrada.
- **Hallazgo dominante (ver seccion 14): colapso casi total del uso de tools durante el soak**, causa raiz de la gran mayoria de los release blockers. No es ruido: es sistematico, medible y con un punto de corte claro.

## 13. Duracion real vs objetivo de ~60 minutos

El plan de 183 turnos, en un solo pase, corre en ~8 minutos al ritmo medido en el smoke (~2.5s/turno) - muy por debajo del objetivo de la tarea. Se agrego repeticion mecanica del MISMO plan congelado (`cycles=4`, seccion 11) para acercarse al objetivo sin generar contenido nuevo. Resultado real: **18.7 minutos** para 732 turnos (~1.5s/turno en promedio, incluso mas rapido que el smoke) - todavia por debajo de los 60 minutos. La causa no es contencion ni fallos: la latencia por llamada se mantuvo estable (p50 1.37s, p95 1.93s, ver seccion 16) durante todo el soak, y el motivo real de por que no se acerco a los 60 min esta ligado al hallazgo de la seccion 14 (el modelo dejo de invocar tools, y una respuesta de solo texto es mucho mas rapida que un turno con varias llamadas a tools). No se alargo artificialmente el soak (sin sleeps, sin turnos inventados) para forzar el numero de 60 minutos: la tarea pide explicitamente no maquillar resultados (seccion 44/47).

## 14. HALLAZGO PRINCIPAL: colapso del uso de tools en conversaciones largas/repetidas

**Este es el hallazgo central de P7.12** y la causa raiz de la gran mayoria de los 54 release blockers.

- De los 732 turnos, **solo 24 (3.3%) invocaron algun tool** (`toolCallsPerTurnMean = 0.066`; `totalToolCalls = 48` en total; `totalModelCalls = 777` - practicamente 1 llamada al proveedor por turno, es decir, casi ningun turno entro siquiera en un loop de tool-calling).
- **El ultimo turno de todo el soak que invoco un tool fue `sequenceIndex 323` de 731** (44% del recorrido). Desde el turno 324 en adelante - **408 turnos consecutivos, el 55.8% restante del soak, abarcando la segunda mitad del ciclo 2 y los ciclos 3 y 4 completos** - el modelo no volvio a invocar NINGUN tool, en ninguna de las 3 conversaciones.
- De los 84 turnos accionables con expectativa declarada (`expectedMutation` en SELECT/MODIFY/REPLACE), **83 (98.8%) terminaron sin ningun tool call** - la falla es sistematica y pareja entre categorias (QUANTITY_FRAGMENT 16/16 sin tool, CORRECTION 16/16, MULTI_PRODUCT 4/4, REPLACEMENT 8/8, CONTRADICTION 12/12, MULTI_INTENT 4/4, DIRECT_PURCHASE 23/24).
- Analisis exploratorio (heuristica de texto amplia, NUNCA parte de la senal preregistrada): de esos 83 turnos sin tool call, **26 (31.3%) tienen una respuesta que narra una actualizacion como si hubiera ocurrido** - p.ej. *"¡Perfecto! Actualizo a 2 unidades de la Barra Olimpica Classic 20kg ($89.990 c/u)."*, *"¡Listo! Actualizo la seleccion a: 2 x Barra Olimpica Classic 20kg..."* - sin ningun `select_products` en ese turno. El detector de produccion reutilizado sin cambios (`checkUnbackedCommercialMutationClaim`, seccion 9) solo marco **4** de estos como `FALSE_SUCCESS_CLAIM`: es deliberadamente angosto (documentado en su propio comentario - patrones anclados a frases especificas de un incidente anterior, "te dejo/agrego/preparo N unidades", "quedo/quedaron seleccionadas", etc.) y no cubre variantes como "Actualizo a N unidades" o "Quedan anotadas". **El numero real de reales de "false success" es sustancialmente mayor que 4** - la heuristica exploratoria (31.3% de 83 = ~26) es una cota inferior mas realista, no la cifra final.
- Los tokens de entrada crecen de forma moderada (8.3k en el turno 0 a 22.1k en el turno 731, con un pico puntual de 62.6k en el turno 155) - **no hay evidencia de que se este agotando la ventana de contexto** (serian valores muy chicos para cualquier limite real del modelo). El colapso de tool-calling no se explica por un limite de contexto duro; es mas compatible con una deriva de comportamiento especifica de conversaciones muy largas y con patrones repetidos (los mismos mensajes, literalmente, aparecen hasta 4 veces en el historial de cada conversacion por el ciclado del plan) - el modelo parece "instalarse" en un patron de responder conversacionalmente en vez de re-invocar la politica de tool-calling.
- Con turnos informativos pasa lo mismo en menor escala: solo 19 de 416 turnos NONE (4.6%) invocaron algun tool (antes casi todas las preguntas de precio/stock hubieran llamado `get_product_details`; en P7.10/P7.11, con conversaciones cortas, esto no se veia).

**Interpretacion causal (honesta, sin sobre-alcance).** No se puede aislar con certeza, dentro de esta sesion, POR QUE ocurre: (a) es plausible que sea una degradacion genuina y reproducible de DeepSeek Flash con `temperature=0` en conversaciones muy largas/con patrones repetidos (el fenomeno que P7.12 fue diseñado a buscar); (b) tambien es consistente con la no-determinismo ya documentado de DeepSeek en `temperature=0` (P7.10 seccion 11/25: "no es determinista") - el smoke de 5 minutos (un solo ciclo corto, sesiones frescas) SI mostro tool calls exitosos en una fraccion razonable de turnos accionables (ver seccion 11), mientras que el soak principal (sesiones mucho mas largas) casi no los mostro; no se pudo replicar el soak principal una segunda vez dentro de esta sesion para descartar variabilidad sesion-a-sesion. Cualquiera sea la causa exacta, el patron es real, medible, reproducido de forma consistente durante mas de la mitad del soak, y constituye el hallazgo de mayor severidad de toda la serie P7.8-P7.12.

## 15. Metricas de seguridad (`safety`)

| Metrica | Valor |
|---|---|
| `conversationIntegrityFailures` (total, todas las categorias) | 94 |
| `wrongProductRate` (sobre turnos verificables) | 63/80 = 78.8% (IC95 69-86) |
| `wrongQuantityRate` | 12/80 = 15.0% (IC95 9-24) |
| `informationalOverMutationRate` (turnos NONE/KEEP que mutaron igual) | 4/508 = 0.8% (IC95 0.3-2.0) |
| `duplicateMutationRate` (REPEATED_MESSAGE/DUPLICATE_ACTION_RISK) | 11/24 = 45.8% |
| `selectionCorruptionRate` (estructural: producto invalido, duplicado, cantidad no entera/<=0) | **0/732 = 0%** |
| `crossConversationLeak` | **false** (ids unicos verificados en las 3 sesiones) |
| `falseSuccessClaimRate` (detector angosto de produccion, seccion 14) | 4/732 = 0.5% (subestimado, ver seccion 14) |
| `unsafeAmbiguousMutationRate` (turnos AMBIGUOUS_REFERENCE con clarificacion permitida) | 0/60 = 0% |

**Lectura.** `wrongProduct`/`wrongQuantity` altos NO son, en su mayoria, el modelo confundiendo Classic con Pro dentro de un turno: son la consecuencia DOWNSTREAM de la seccion 14 (el carrito nunca se actualiza, asi que el estado "carried forward" queda desactualizado turno tras turno y cada vez que se compara contra una expectativa declarada - CANCEL, DIRECT_PURCHASE, REPEATED_MESSAGE - no coincide). La seguridad ESTRUCTURAL (cero corrupcion, cero fuga cross-conversation, cero sobre-mutacion informativa material) se mantuvo intacta durante todo el soak: cuando el modelo SI actuaba, actuaba de forma segura; el problema es que dejo de actuar.

## 16. Metricas de comportamiento (`behavioral`) y operacionales (`operational`)

| Behavioral | Valor |
|---|---|
| `correctNextCommercialAction` | 0/112 = **0%** |
| `unnecessaryConfirmationRate` | 58/112 = 51.8% |
| `unnecessaryRequestionRate` | 34/112 = 30.4% |
| `contextRecoveryRate` (RESUME/OLD_CONTEXT_REFERENCE) | 0/8 = 0% |
| `replacementSuccessRate` | 0/8 = 0% |
| `correctionSuccessRate` | 0/40 = 0% |
| `cancelSuccessRate` | 0/28 = 0% |
| `resumeSuccessRate` | 0/8 = 0% |
| `multiIntentAttemptedRate` | 1/24 = 4.2% |

| Operational | Valor |
|---|---|
| Total turnos / model calls / tool calls / Gateway calls | 732 / 777 / 48 / 45 |
| Timeouts / provider failures | 0 / 0 |
| Gateway rejections | 4 |
| Latencia por llamada p50/p90/p95/p99 (ms) | 1374 / 1806 / 1933 / 2166 |
| Tokens de entrada / salida (total) | 10,328,703 / 52,213 |
| Llamadas maximas de tools / provider en un turno | 7 / 7 |

**Lectura.** `unnecessaryConfirmationRate` (51.8%) es una REVERSION marcada respecto de P7.10/P7.11, donde S1 justamente REDUJO la confirmacion innecesaria a 2.8-19%. En este soak, mas de la mitad de los turnos accionables terminan pidiendo confirmacion de todas formas, y el resto se reparte entre pedir un dato faltante (30.4%) o - la porcion mas preocupante - simplemente narrar que ya se actualizo sin hacerlo (seccion 14). Latencia y calidad de argumentos (0 timeouts, 0 fallos de provider, 0 argument failures) se mantuvieron estables: no hay evidencia de degradacion de infraestructura, solo de politica/comportamiento del modelo.

## 17. Grupo replacement (seccion 43 de la tarea): cohorte separada por antecedente de P7.11

P7.11 encontro que el grupo F (correction/replacement) REGRESA con R1 (75% -> 50%) por mas rechazos del evidence gate. P7.12 mide `replacementSuccessRate = 0/8 = 0%` - peor todavia, pero **no se puede atribuir al evidence gate esta vez**: de los 8 turnos REPLACEMENT, 8/8 no completaron ningun `select_products` (mismo patron de la seccion 14), asi que no hay evidencia de que el gate este rechazando reemplazos - simplemente no se estan intentando. Siguiendo la regla de la tarea (seccion 43: "no tocar el gate automaticamente"; determinar primero si el evidence era suficiente, si el modelo debio hacer grounding antes, o si el gate esta sobre-restrictivo): en este soak, la pregunta es discutible porque casi no hubo intentos de `select_products` que el gate pudiera evaluar. La cohorte de reemplazo de P7.12 queda contaminada por el hallazgo de la seccion 14 y no aporta evidencia nueva sobre el evidence gate en si.

## 18. Fault injection (seccion 23) - sin poder evaluarse en profundidad

Los 5 fallos inyectados (`C5` CATALOG_TIMEOUT, `C17`/`C1x` REGISTRY_MISMATCH, `B40` GATEWAY_DEPENDENCY_REJECTION, `C42` INVALID_CATALOG_RESPONSE, `A43` CATALOG_TIMEOUT, repetidos x4 ciclos) se dispararon correctamente segun el mecanismo one-shot (verificado en tests DB-backed, seccion 11 y `runSoak.test.ts`), pero dado que la mayoria de los turnos ni siquiera invocan tools (seccion 14), no hay suficientes intentos de recuperacion post-fallo para caracterizar como el modelo se recupera de una dependencia caida en este banco. Es un residuo abierto para una replica futura con el problema de la seccion 14 resuelto o aislado.

## 19. Residuos y clasificacion (94 integrity failures totales)

| Kind | n |
|---|---|
| `WRONG_PRODUCT_DURABLE` | 63 |
| `WRONG_QUANTITY_DURABLE` | 12 |
| `ACCIDENTAL_DUPLICATE` | 11 |
| `STALE_INTENT_OVERWRITES_NEWER` | 4 |
| `FALSE_SUCCESS_CLAIM` (detector angosto) | 4 |
| `ACCIDENTAL_SELECTION_DELETION` / `STATE_LEAK_ACROSS_CONVERSATIONS` / `CANCELLATION_IGNORED` / `MUTATION_AFTER_NEGATION` / `CASUAL_TURN_CHANGED_STATE` / `RUNAWAY_LOOP` | 0 cada uno |

Los 54 release blockers (seccion 12) son el subconjunto de estos que caen en una categoria "final-say" (DIRECT_PURCHASE, CORRECTION, REPLACEMENT, CANCEL, MULTI_PRODUCT, REPEATED_MESSAGE, CONTRADICTION) segun la regla preregistrada (`analysis.ts`, `findReleaseBlockers`); el resto son residuos reportados pero no bloqueantes por si mismos.

## 20. Limitaciones

1. **No se pudo replicar el soak principal una segunda vez** dentro de esta sesion para determinar si el colapso de tool-calling de la seccion 14 es reproducible de forma confiable o si fue un evento de una sola corrida (el smoke, mas corto, no mostro el mismo grado de colapso). Esto es la limitacion mas importante: el hallazgo central de P7.12 queda como "observado una vez, con evidencia fuerte y un patron limpio (corte en el turno 323/731)", no como "replicado".
2. El detector de `FALSE_SUCCESS_CLAIM` es el de produccion, angosto por diseño (seccion 14); el numero reportado (4) es una subestimacion conocida del fenomeno real.
3. `cycles=4` (repetir el mismo plan) no estaba en el diseño original de la tarea (que asumia ~60 min con un solo pase); se agrego para acercarse al objetivo de duracion sin generar contenido nuevo, pero introduce conversaciones MUY largas y repetitivas (hasta 4 repeticiones literales del mismo mensaje en la misma conversacion) que pueden no representar trafico real tan bien como conversaciones largas pero no-repetidas.
4. Un solo modelo (`deepseek-v4-flash`), `temperature=0` no determinista (documentado desde P7.10).
5. El grupo replacement (seccion 17) y el fault injection (seccion 18) quedan contaminados/sin poder evaluarse por el hallazgo de la seccion 14 - no es evidencia en ningun sentido sobre el evidence gate o la recuperacion de fallos en si.
6. No mide R3, el sistema completo, otros modelos, ni compara S0 vs S1 (S1 fijo, sin comparacion, tal como pedia la tarea). No hay evidencia de produccion.

## 21. Recomendacion (no se decide arquitectura todavia)

**Prioridad inmediata, antes de cualquier P7.13 planificado:** replicar el hallazgo de la seccion 14 de forma aislada y controlada - una conversacion UNICA, sin ciclado, que crezca organicamente hasta ~300-400 turnos con contenido NO repetido, midiendo especificamente en que punto (si en alguno) el modelo deja de invocar tools. Si se replica, esto es un release blocker real para cualquier despliegue de S1 (o de este harness) en conversaciones largas, independientemente del resultado de P7.10/P7.11 en conversaciones cortas. Ampliar el detector de false-success-claim (como modulo de benchmark, NO tocar el de produccion sin autorizacion explicita) para capturar el patron real observado ("Actualizo a N unidades", "Quedan anotadas", etc.) antes de la proxima medicion. No tocar el evidence gate, no tocar S1, no tocar produccion hasta tener una replica.

## 22. Validaciones

| Validacion | Resultado |
|---|---|
| tests P7.12 (`r3ConversationalSoak`) | 50/50 |
| tests P7.11 (`r3ConfirmationBoundary`) | 34/34 |
| tests P7.10 (`r3MutationSemantics`) | 69/69 (aislado; flake transitorio de contencion de pool al correr todas las suites juntas, no relacionado con P7.12) |
| tests P7.9 (`r3CapabilityIsolation`) | 29/29 (aislado, mismo flake) |
| tests P7.8-R (`r3TrueAB`) | 37/37 |
| `npm run typecheck` | limpio (exit 0) |
| `npm run build` | OK (exit 0) |
| eslint focalizado (`r3ConversationalSoak`, script P7.12, tests P7.12) | limpio |
| `git diff --check` | limpio |
| `git status --short` | solo las rutas nuevas de P7.12 + el directorio preexistente `artifacts/benchmarks/r3-stable-agent-v1/` (no relacionado); ningun archivo tracked modificado |
| `.env` | modificado TEMPORALMENTE para el soak en vivo (mismo procedimiento que P7.10/P7.11); restaurado a sus valores originales al terminar |

## 23. Estado de la fase y confirmaciones

**P7.12 CLOSED - `ROBUSTNESS_FAIL`** (senal preregistrada; 54 release blockers, 0 HARD_FAILURE, 0 corrupcion estructural, 0 fuga cross-conversation). Confirmaciones:

- DeepSeek Flash unicamente (`deepseek-v4-flash`), sin DeepSeek Pro, sin comparacion de modelos;
- S1 sin cambios (`P7.12 S1 === P7.11 R1 === P7.10 S1`, byte-identico, test-verificado); sin comparacion S0/S1 en esta fase;
- harness nativo unicamente; R3 no participa (test estatico);
- sin cambios de MS, Gateway, DB ni schema de produccion;
- sin produccion (todo corrio contra `crm_test` local, `SELECT DATABASE()` verificado antes y despues);
- sin P8, sin MCP;
- sin tuning post-freeze salvo la correccion de instrumento ANTES del freeze final descrita en la seccion 7/11 (bug de clasificacion, no de comportamiento - corregido durante el smoke, tal como exige la seccion 37 de la tarea);
- sin commit, sin push.

`docs/ACTIVE_RELEASE.md` y `docs/CAPABILITY_MATRIX.md` no se tocan. El handoff (`docs/R3_COMMERCIAL_AGENT_HANDOFF.md`) se actualiza en un cambio separado si el usuario lo pide.
