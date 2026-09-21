# P7.9 - Capability Contract Isolation

Experimento de fase. No P8, no MCP, sin cambios de Gateway/CommercialWork/DB/capabilities de produccion, sin tocar R3, sin cambiar la semantica de `quantity`, sin tuning post-resultado, sin commit y sin push. Repo `CRM-Customer-360`, rama `develop`.

Estado: **PREREGISTRO ESCRITO ANTES DE CUALQUIER CORRIDA** (las secciones 1-9 se congelan antes del smoke; los resultados se agregan al final sin modificar el preregistro).

## 0. Baseline verificado

```text
git branch --show-current -> develop
git rev-parse HEAD        -> 5c7be9077d32bc17b788a36d1094619f8900baed
git log -1                -> 5c7be90 test(r3): isolate harness and capability contract effects   (= commit de P7.8-R)
git status --short        -> solo `?? scripts/diagnostics/` (untracked, preexistente); benchmark-results/ esta ignorado
```

- P7.8-R esta commiteado (5c7be90). Harness autonomo real (`benchmark/r3TrueAB/`) y proyeccion thin C1 (`buildThinToolSurface`) disponibles. Sin cambios experimentales pendientes al inicio.
- Documentos base leidos: `docs/R3_COMMERCIAL_AGENT_HANDOFF.md` (23.6-23.9), `docs/audits/r3-p7-8-autonomous-harness-ab.md`, `docs/audits/r3-p7-8r-true-harness-capability-tax.md`.

## 1. Estado de P7.8-R: preregistrado vs exploratorio

| | Senal | Estatus |
|---|---|---|
| Preregistrada (detector heredado de P7.8, defectuoso) | `NO_CLEAR_WINNER` | resultado oficial de la fase P7.8-R |
| Post-hoc corregida (detector estricto definido despues de ver resultados) | `CAPABILITY_CONTRACT_IS_BOTTLENECK` candidato | **exploratoria**: hipotesis prioritaria, NO evidencia confirmatoria |

Cifras exploratorias de P7.8-R (progreso tras grounding, detector estricto): A 4/19 = 21.1%, B 6/19 = 31.6%, C1 13/22 = 59.1%; Q- pide cantidad: A 3/18, B 5/18, C1 11/18. Sin sobre-mutacion, argumentos invalidos, rechazos de Gateway ni corrupcion en ningun brazo. P7.9 debe **confirmar o rechazar** esa hipotesis y aislar QUE componente del contrato model-facing produce el efecto.

## 2. Diseno: la unica variable es el contrato model-facing

Todas las variantes usan el harness autonomo real de P7.8-R (`runTrueHarnessCase` -> `runTrueHarnessTurn` -> `executeGovernedCapability`): mismo prompt (`p7.8r-true-harness-v1`), mismo loop, mismo Gateway, identidad, estado de dominio, refresco de estado (tool -> Gateway -> DRM reconstruido -> siguiente llamada), modelo/config, fixtures y orden. R3 no participa. Solo cambia la **representacion** que ve el modelo de las 7 tools en alcance (`search_products`, `get_product_details`, `select_products`, `set_shipping_destination`, `calculate_shipping`, `create_quote`, `get_quote`); las otras 7 tools quedan verbatim en toda variante (igual que C1).

Configuracion (identica a P7.8-R, exigida por el script antes de correr en vivo): `deepseek-v4-flash`, temperature 0, thinking disabled, timeout 60000, `maxOutputTokens` 4000, `maxModelRetries` 5, `BENCHMARK_E2E_CATALOG_QUERY_AWARE=true` (el stub de catalogo resuelve por nombre, como en P7.8-R). Limites del loop: 24 llamadas de modelo, 20 tools.

### 2.1 Hallazgo de inspeccion (antes de correr): el schema actual no tiene field descriptions

Las 7 tools en alcance tienen schemas con solo `type`, `required`, `additionalProperties`, `minimum`/`minItems` y propiedades opcionales (`combinationId`, `limit`). **No existe texto de campo.** Consecuencias para la descomposicion:

- B5 ("schema text") solo puede quitar anotaciones de validacion (`minimum`, `minItems`); por construccion se espera casi inerte (~37 chars). Se ejecuta igualmente como control.
- Las propiedades opcionales que C1 omitio (`combinationId`, `limit`) NO se pueden atribuir con B1-B5 (el enunciado exige mantener nombres de argumentos en B5); solo quedan medidas dentro del salto **B4 -> B6** (esquema completo: constraints + opcionales).
- La frase de semantica (`operationSemantics`: FULL_REPLACEMENT / CREATE_SNAPSHOT) es un cuarto componente de prosa que el enunciado no lista. Decision preregistrada: se mantiene constante en B1/B2/B3/B5 y se elimina en B4/B6 (la descripcion thin de `select_products` ya dice "replaces the whole saved selection").

## 3. Variantes y matriz del contrato (documentada antes de ejecutar)

Componentes de una tool: `description` (registro o thin), `useWhen`, `doNotUseWhen`, `semantics` (frase operationSemantics), `schema`.

| Variante | description | useWhen | doNotUseWhen | semantics | schema |
|---|---|---|---|---|---|
| B0 control | actual | actual | actual | actual | actual |
| B1 thin description | **thin** (1 frase) | actual | actual | actual | actual |
| B2 sin useWhen | actual | **quitado** | actual | actual | actual |
| B3 sin doNotUseWhen | actual | actual | **quitado** | actual | actual |
| B4 prosa thin | **thin** | **quitado** | **quitado** | **quitada** | actual |
| B5 schema sin anotaciones | actual | actual | actual | actual | **sin `minimum`/`minItems`** |
| B6 full thin (= C1 P7.8-R) | thin | quitado | quitado | quitada | **thin** (required + tipos; sin opcionales ni constraints) |

B0 es byte-identico a la superficie `current` de P7.8-R; B6 es byte-identico a `buildThinToolSurface()` (ambos por test). Quantity sigue `required` + `integer` en todas.

### 3.1 `select_products` en cada variante

| Componente | B0 | B1 | B2 | B3 | B4 | B5 | B6 |
|---|---|---|---|---|---|---|---|
| name | select_products | = | = | = | = | = | = |
| description | "Records the customer's confirmed product selection (productId/combinationId/quantity) as this opportunity's durable, authoritative commercial line items. Every item must reference a product this conversation actually observed via a catalog discovery capability (search_products, search_products_by_semantics, get_product_details or explore_catalog) - a fabricated or unobserved productId is rejected before this capability runs." (428 c) | "Save the products and quantities the customer has chosen (replaces the whole saved selection)." (94 c) | actual | actual | thin (94 c) | actual | thin (94 c) |
| useWhen | "the conversation establishes which products and quantities make up the current purchase" (99 c) | actual | **quitado** | actual | quitado | actual | quitado |
| doNotUseWhen | "the products are still only being explored, compared, or recommended rather than committed to" (112 c) | actual | actual | **quitado** | quitado | actual | quitado |
| semantics | "This call's arguments must represent the complete desired state after the operation, never only what changed - it replaces the entire previous state, it is not a delta or merge." (178 c) | actual | actual | actual | quitada | actual | quitada |
| schema | `items[]` minItems 1; item: `productId` string, `combinationId` string (opcional), `quantity` integer minimum 1; additionalProperties false (332 c) | actual | actual | actual | actual | sin `minItems`/`minimum` (307 c) | `items[]`; item: `productId`, `quantity` integer (273 c) |
| required | items; productId, quantity | = | = | = | = | = | = |
| field descriptions | **ninguna** (el contrato actual no las tiene) | - | - | - | - | - | - |
| total tool (chars) | 1164 | 830 | 1065 | 1052 | 441 | 1139 | 382 |

### 3.2 Tamano del contrato por variante (chars; tokens aprox = chars/4)

| Variante | catalogo total (14 tools) | 7 tools en alcance | descripciones (todas) | schemas (todos) |
|---|---|---|---|---|
| B0 | 15,005 (~3,752) | 6,717 (~1,680) | 11,171 | 3,580 |
| B1 | 12,828 (~3,207) | 4,540 (~1,135) | 8,994 | 3,580 |
| B2 | 13,932 (~3,483) | 5,644 (~1,411) | 10,098 | 3,580 |
| B3 | 13,303 (~3,326) | 5,015 (~1,254) | 9,469 | 3,580 |
| B4 | 9,776 (~2,444) | 1,488 (~372) | 5,942 | 3,580 |
| B5 | 14,968 (~3,742) | 6,680 (~1,670) | 11,171 | 3,543 |
| B6 | 9,644 (~2,411) | 1,356 (~339) | 5,942 | 3,448 |

Desglose por tool y por componente para las 7 tools: `contract-matrix.json` de cada corrida.

## 4. Hipotesis

- **H-rep**: B6 reproduce el efecto de P7.8-R frente a B0 (mejora material de Q- pide cantidad sin degradar seguridad).
- **H-comp**: si H-rep, el efecto se concentra en uno o mas componentes (descripcion, useWhen, doNotUseWhen, schema) o es un efecto combinado (interaccion/contexto agregado). Sin inferencias fuertes de interaccion con n pequeno.
- **Q- y Q+ son problemas distintos**: cognicion de cantidad faltante (Q-) y ejecucion con cantidad conocida (Q+) se concluyen por separado; no se asume la misma causa.

## 5. Detector congelado (preregistrado)

El detector corregido de P7.8-R pasa a ser preregistrado: `benchmark/r3CapabilityIsolation/replyClassifier.ts` (`p7.9-reply-detector-v1`, sha256 en el manifest). Clasifica la respuesta final en `CORRECT_QUANTITY_REQUEST`, `GENERIC_CONFIRMATION`, `LINK_OFFER`, `OTHER_QUESTION`, `PRODUCT_INFORMATION` (sin pregunta) y `NO_REPLY`; prioridad: pedido de cantidad > oferta de avanzar ("la agrego?", "avanzamos?", "quieres revisarlo?") > oferta de link > otra pregunta > informacion. Una oracion cuenta como pedido de cantidad solo si contiene un patron de cantidad (`cuantas/cuantos`, `que cantidad`, `cantidad de unidades/que/...`, `numero de unidades`, `una o dos`) Y es pregunta o pedido indirecto ("indicame cuantas...", "si me confirmas cuantas..."). "Cuanto" en singular queda fuera (es "cuanto cuesta").

Golden set (`tests/agent-loop/benchmark/r3CapabilityIsolation/goldenReplies.json`, 69 entradas): los **54 mensajes Q- reales de P7.8-R** (etiquetados a mano leyendolos uno a uno, antes de correr el clasificador contra ellos; reproduce 3 + 5 + 11 = 19 pedidos de cantidad) + ejemplos del enunciado. Resultado: 0 discrepancias. Ejemplos que NO cuentan como cantidad: "Quedan 15 unidades. ¿Quieres el link?" (LINK_OFFER), "¿Quieres que lo agregue?", "¿Quieres revisarlo?", "¿Avanzamos?" (GENERIC_CONFIRMATION). Que si cuentan: "¿Cuantas unidades necesitas?", "¿Que cantidad quieres?", "¿Una o dos unidades?". Decision de borde (en el golden): "¿Quieres que la agregue? Si es asi, indicame cuantas unidades..." cuenta como pedido de cantidad; "...(por defecto 1)" junto a "¿Cuantas unidades quieres?" tambien.

**Extension hecha en el smoke, antes del freeze.** El primer smoke (21 corridas) mostro que "¿Confirmo/Confirmas las 2 unidades?" y "¿Te gustaria que te arme una cotizacion?" caian en `OTHER_QUESTION` cuando son confirmaciones/ofertas de avanzar (afecta la taxonomia Q+ y la tasa de confirmacion generica de Q-, no la metrica primaria de pedir cantidad). Se amplio `ADVANCE_PATTERN` (`cotizacion`, `arme/armo/armar`, `confirmo/confirmas` + objeto de pedido) y se agregaron 8 entradas al golden etiquetadas a mano (fuente `p7.9-smoke`; los 54 mensajes reales y los ejemplos del enunciado quedaron intactos; 77 entradas, 0 discrepancias). El smoke se repitio completo y RECIEN AHI se registro el freeze. Las cifras de los smokes no se usan como resultado (n=1; ademas temperature 0 no es determinista en DeepSeek: K01/B6 no commiteo en el primer smoke y si en el segundo).

**No se cambia el detector despues del batch** (regla 21 del enunciado, seccion 9).

## 6. Corpus P7.9 (`r3-p7-9.v1`)

Separado por semantica de cantidad, anotada por escenario (nunca inferida del texto): **12 Q-** (M01-M12), **12 Q+** (K01-K12), **8 negativos** (I01-I08). El catalogo fixture solo tiene las dos barras (31 Classic, 32 Pro) - no hay "discos" - asi que se varia sintaxis, posicion de cantidad, follow-ups anaforicos (M04/M06/M11/K07/K11), cotizaciones (M05, K12), cambio de seleccion (M04, K05 con seleccion durable sembrada) y cierre coloquial ("me llevo", "dame ... nomas", "Classic x2"). Los turnos de contexto (pregunta informativa previa) se anotan `other` (no se analizan, pero una mutacion ahi se reporta como `contextTurnMutation`, nunca se excluye). Q- sin cantidad en el mensaje ni en el estado; Q+ con cantidad explicita y producto/cantidad esperados declarados; negativos: precio, stock, comparacion, recomendacion, compatibilidad, caracteristicas, link, disponibilidad. Ningun mensaje esta copiado del prompt ni de los contratos (test). Escenarios completos: `benchmark/r3CapabilityIsolation/isolationCorpus.ts`.

## 6b. Metricas preregistradas

**Primaria**: `commercialProgressAfterGroundingRate`, SEPARADA en Q+ (grounding -> `select_products` pedido en el mismo turno) y Q- (grounding -> el modelo pide explicitamente la cantidad y no selecciona). Total agregado solo como resumen. Denominador: turnos de compra explicita en los que `get_product_details` completo (depende de la variante), por eso se reporta ademas con **denominador fijo** (todos los turnos Q- / Q+).

Secundarias por variante: Q+ commit rate / durable commit rate; Q- pide cantidad / confirmacion generica / cierre informativo (+ oferta de link, otra pregunta, sin respuesta); `commitAfterGroundingRate`, `durableCommitAfterGroundingRate`; over-mutation (negativos), wrongQuantity, wrongProduct, selectionCorruption; validArguments, gatewayRejection, duplicateToolCall, JSON de provider invalido; tool calls y provider calls por turno; latencia p50/p90/p95; tokens de entrada/salida; taxonomia del fallo Q+ (malformed_call, harness_terminal, other_tool, regrounding, asks_known_quantity, generic_confirmation, link_offer, information, other_final_response); desglose por escenario; intervalos de Wilson 95%.

## 7. Regla de promocion y senal (preregistradas)

Una variante aislada (B1-B5) es **candidata** frente a B0 si mejora **>= +20 pp** en *Q- pide cantidad explicita* (denominador fijo: todos los turnos Q-) **o** en *Q+ commit rate* (denominador fijo: todos los Q+), **sin**: over-mutation > B0 + 5 pp, argumentos invalidos > B0 + 5 pp, rechazo de Gateway > B0 + 5 pp, ni corrupcion de seleccion > B0. No se elige por progreso agregado.

Senal (mapeo fijado antes de medir): B6 no es candidato -> `CAPABILITY_TAX_NOT_REPLICATED` (si B6 tiene efecto pero viola seguridad, o algun parcial pasa sin B6: `NO_CLEAR_CAUSE`). B6 candidato: exactamente uno de {B1,B2,B3,B5} candidato -> `DESCRIPTION_IS_BOTTLENECK` / `USEWHEN_IS_BOTTLENECK` / `DONOTUSEWHEN_IS_BOTTLENECK` / `SCHEMA_PRESENTATION_IS_BOTTLENECK`; dos o mas -> `MULTIPLE_FACTORS`; ninguno -> `COMBINED_CONTRACT_COMPLEXITY_IS_BOTTLENECK` (B4 puede acompanar). Datos insuficientes (fallos de harness, < 30 turnos por grupo) -> `NO_CLEAR_CAUSE`. Se calcula por separado para Q- (cognicion de cantidad) y Q+ (ejecucion), y en conjunto.

## 8. Plan de corridas

32 escenarios x 3 corridas x 7 variantes = **672 corridas** (primera opcion del enunciado; sin diseno de 2 etapas). Orden determinista e intercalado: bucle externo = ordinal de corrida (las 3 corridas de un escenario quedan separadas en el tiempo), escenarios intercalados por grupo (M, K, I), y las 7 variantes de un (escenario, corrida) corren seguidas con el lider rotando (cada variante lidera 13-14 de 96 grupos). El orden queda en `manifest.plan`.

## 9. Congelamiento y regla post-resultado

- Antes del batch se calculan sha256 (LF-normalizado) de: prompt autonomo, loop (+ cliente nativo), adaptador/superficies + `executeCapability`, corpus, analizador (+ clasificador, `analysis.ts`, `metrics.ts`), constructor de fixtures iniciales (`runTrueHarnessCase`, entornos) y detector (+ golden). Se escriben en el smoke (`--write-freeze`) y el batch se niega a arrancar si algo cambio (`--freeze`); van en `manifest.freezeHashes`. Solo un `HARNESS_FAILURE` real justifica tocarlos (y obliga a repetir el smoke).
- Si aparece un defecto del analizador despues del batch: se reporta el resultado preregistrado original, se documenta el defecto y solo se genera un resultado **exploratorio corregido** que la fase siguiente debe confirmar (como en P7.8-R). Nada de tuning post-resultado.

## 10. Ejecucion

- Run: `benchmark-results/p7-9-2026-09-21T18-53-09-878Z-live-batch/` (`manifest.json`, `runs.jsonl`, `summary.json`, `comparison.json`, `failures.json`, `contract-matrix.json`). Git SHA `5c7be90` (+ 8 rutas sin commit: 7 de P7.9 - 3 ediciones aditivas al harness y los archivos nuevos, ver seccion 20 - y `scripts/diagnostics/` preexistente). Inicio 18:53:09Z, fin 19:41:27Z (~48 min, ~4.3 s por corrida).
- **672/672 corridas ejecutadas, 0 fallos de harness**, 111 turnos terminales por variante, todos `responded`. Freeze verificado al arrancar el batch (hashes del smoke).
- Configuracion efectiva (manifest): `deepseek-v4-flash`, temperature 0, thinking disabled, timeout 60000, `maxOutputTokens` 4000, `maxModelRetries` 5; overrides `BENCHMARK_E2E_*` = los de P7.8-R (incluye `CATALOG_QUERY_AWARE=true`). Prompt autonomo `p7.8r-true-harness-v1` (sha16 `0b5d735df4c18e94`, identico en las 672).
- Hashes de freeze (sha256, prefijo 12): prompt `bc3a6eb834e1`; loop `34139ee5d088` + cliente nativo `1ecdde22554b`; adaptador `toolSurface.ts` `69a946d58dea`, `isolationSurfaces.ts` `50f5b3a29846`, `executeCapability.ts` `057a1c270a67`; corpus `23edac6ac74d` (sha16 del contenido `9441bd975bbd795a`); analizador `isolationAnalysis.ts` `9111fae49842`, `analysis.ts` `29996f4598bf`, `metrics.ts` `a841191d6747`; fixtures `runTrueHarnessCase.ts` `dce8c5efa8ca`, entornos `41575a4d8d6b` / `cab72bfdfa4c`; detector `replyClassifier.ts` `cbbbfd8f5efd` + golden `41d86b99d66b`. Hash del contrato por variante (sha16): B0 `099b78...`, B1 `956eaf...`, B2 `123f52...`, B3 `9b02bb...`, B4 `2e844d...`, B5 `a721d7...`, B6 `a54590...` (los 7 distintos).
- Orden: `manifest.plan` (672 entradas, intercalado; lideres B0-B4 x14, B5-B6 x13). Las 3 corridas de cada escenario quedan separadas (bucle externo = ordinal de corrida).
- Ningun escenario de contexto muto estado (`contextTurnMutation` = 0 corridas en las 7 variantes).

## 11. Resultados preregistrados (detector y reglas de las secciones 5-7, sin cambios)

Todas las tasas con n = 36 turnos Q-, 36 turnos Q+ y 24 negativos por variante. Intervalos de Wilson 95% en `summary.json`.

### 11.1 Q- (cantidad faltante)

| Metrica | B0 | B1 | B2 | B3 | B4 | B5 | B6 |
|---|---|---|---|---|---|---|---|
| **pide cantidad explicita (fijo, metrica de promocion)** | 16/36 = 44.4% [30-60] | 9/36 = 25.0% [14-41] | 19/36 = 52.8% [37-68] | 19/36 = 52.8% [37-68] | 15/36 = 41.7% [27-58] | 15/36 = 41.7% [27-58] | 16/36 = 44.4% [30-60] |
| progreso tras grounding (Q-, primaria) | 10/25 = 40.0% | 7/27 = 25.9% | 12/27 = 44.4% | 12/27 = 44.4% | 13/28 = 46.4% | 9/26 = 34.6% | 13/30 = 43.3% |
| confirmacion generica ("¿la agrego?") | 33.3% | 44.4% | 38.9% | 33.3% | 30.6% | 41.7% | 36.1% |
| otra pregunta | 22.2% | 30.6% | 8.3% | 13.9% | 27.8% | 16.7% | 16.7% |
| oferta de link | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| cierre informativo (sin pregunta) | 0% | 0% | 0% | 0% | 0% | 0% | 2.8% |
| selecciona con cantidad asumida | 19.4% | 36.1% | 16.7% | 25.0% | 22.2% | 16.7% | 22.2% |

### 11.2 Q+ (cantidad conocida)

| Metrica | B0 | B1 | B2 | B3 | B4 | B5 | B6 |
|---|---|---|---|---|---|---|---|
| **commit `select_products` (fijo, metrica de promocion)** | 16/36 = 44.4% [30-60] | 13/36 = 36.1% | 13/36 = 36.1% | 16/36 = 44.4% | 15/36 = 41.7% | 15/36 = 41.7% | 19/36 = 52.8% [37-68] |
| commit durable | 44.4% | 36.1% | 36.1% | 44.4% | 41.7% | 41.7% | 52.8% |
| progreso tras grounding (Q+, primaria) | 12/26 = 46.2% | 8/22 = 36.4% | 12/29 = 41.4% | 16/30 = 53.3% | 11/25 = 44.0% | 11/27 = 40.7% | 14/26 = 53.8% |
| wrongQuantity / wrongProduct | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

### 11.3 Controles negativos, calidad y costo

| Metrica | B0 | B1 | B2 | B3 | B4 | B5 | B6 |
|---|---|---|---|---|---|---|---|
| over-mutation (0/24) | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| corrupcion de seleccion (0/96) | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| validArgumentsRate | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| argumentos invalidos (llamadas) | 0/217 | 0/235 | 0/217 | 0/234 | 0/229 | 0/213 | 0/248 |
| JSON de provider invalido | 0/313 | 0/328 | 0/312 | 0/330 | 0/319 | 0/309 | 0/333 |
| duplicateToolCallRate | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| gatewayRejectionRate | 1.8% | 4.7% | 1.4% | 2.6% | 1.7% | 3.8% | 2.8% |
| tool calls / provider calls por turno | 1.95 / 2.82 | 2.12 / 2.95 | 1.95 / 2.81 | 2.11 / 2.97 | 2.06 / 2.87 | 1.92 / 2.78 | 2.23 / 3.00 |
| latencia por llamada p50 / p90 / p95 (ms) | 1270 / 1562 / 1665 | 1250 / 1537 / 1623 | 1243 / 1521 / 1635 | 1232 / 1556 / 1703 | 1175 / 1504 / 1629 | 1231 / 1563 / 1649 | 1177 / 1528 / 1648 |
| tokens de entrada / salida por turno | 12,075 / 165 | 11,496 / 179 | 11,512 / 168 | 11,492 / 170 | 9,461 / 170 | 11,785 / 166 | 9,808 / 188 |
| contrato (chars) | 15,005 | 12,828 | 13,932 | 13,303 | 9,776 | 14,968 | 9,644 |

Los "rechazos" de Gateway son ambientales y del catalogo fixture, no del contrato: `create_quote` con Quote Service no configurado (27, M05/K12), `select_products` bloqueado por el evidence gate `source_product_not_observed` (15, follow-ups sin grounding en el turno), `explore_catalog` `invalid_response` (10) y `search_products_by_semantics` `registry_mismatch` (5) contra el stub, 1 `master_identity_required`. Diferencias entre variantes (1.4-4.7%) son de decenas de llamadas.

### 11.4 Agregado (solo resumen; nunca la unica lectura)

| | B0 | B1 | B2 | B3 | B4 | B5 | B6 |
|---|---|---|---|---|---|---|---|
| progreso tras grounding (Q+ y Q-) | 22/51 = 43.1% | 15/49 = 30.6% | 24/56 = 42.9% | 28/57 = 49.1% | 24/53 = 45.3% | 20/53 = 37.7% | 27/56 = 48.2% |
| progreso cohorte fija (72 turnos) | 44.4% | 30.6% | 44.4% | 48.6% | 41.7% | 41.7% | 48.6% |
| `commitAfterGroundingRate` | 37.3% | 38.8% | 32.1% | 43.9% | 34.0% | 32.1% | 39.3% |
| `durableCommitAfterGroundingRate` | 37.3% | 38.8% | 32.1% | 43.9% | 34.0% | 32.1% | 39.3% |

### 11.5 Regla de promocion (seccion 7) y senal preregistrada

| Variante | Delta Q- pide cantidad (pp) | Delta Q+ commit (pp) | seguridad | candidata |
|---|---|---|---|---|
| B1 description | -19.4 | -8.3 | ok (Gateway +2.8) | no |
| B2 useWhen | +8.3 | -8.3 | ok | no |
| B3 doNotUseWhen | +8.3 | 0.0 | ok | no |
| B4 prosa thin | -2.8 | -2.8 | ok | no |
| B5 schema | -2.8 | -2.8 | ok | no |
| B6 full thin | **0.0** | **+8.3** | ok | **no** |

**Senal preregistrada: `CAPABILITY_TAX_NOT_REPLICATED`** (global, Q- y Q+). Ninguna variante alcanzo +20 pp; ninguna viola seguridad. Datos suficientes (0 fallos de harness, 36 turnos por grupo).

## 12. Estado de replicacion de P7.8-R

**NO REPLICADO.** B6 es byte-identico a C1 de P7.8-R y B0 al contrato actual de B; en este corpus B6 = B0 en Q- (16/36 ambos; P7.8-R: 27.8% -> 61.1%, +33 pp) y B6 supera a B0 en Q+ commit por +8.3 pp (P7.8-R: 4/9 -> 5/9). El aumento de "progreso agregado" de P7.8-R (31.6% -> 59.1%) no aparece (43.1% -> 48.2%, +5 pp, dentro del ruido). La hipotesis exploratoria `CAPABILITY_CONTRACT_IS_BOTTLENECK` **no queda confirmada**.

## 13. Analisis causal por componente (comparaciones preregistradas)

| Comparacion | Que mide | Q- pide cantidad | Q+ commit | Lectura |
|---|---|---|---|---|
| B0 vs B1 | impuesto de la descripcion | 44.4 -> 25.0 (**-19.4**) | 44.4 -> 36.1 (-8.3) | efecto en direccion contraria a la hipotesis; no consistente con B4/B6 (que tambien llevan descripcion thin y no caen) |
| B0 vs B2 | impuesto de useWhen | 44.4 -> 52.8 (+8.3) | 44.4 -> 36.1 (-8.3) | inerte dentro del ruido |
| B0 vs B3 | impuesto de doNotUseWhen | 44.4 -> 52.8 (+8.3) | 44.4 -> 44.4 (0.0) | inerte dentro del ruido |
| B0 vs B5 | impuesto del texto del schema | 44.4 -> 41.7 (-2.8) | 44.4 -> 41.7 (-2.8) | inerte, como se esperaba (el schema actual no tiene texto de campo) |
| B0 vs B4 | superficie semantica combinada | 44.4 -> 41.7 (-2.8) | 44.4 -> 41.7 (-2.8) | inerte (prosa 15,005 -> 9,776 chars sin efecto conductual) |
| B0 vs B6 | impuesto total del contrato | 44.4 -> 44.4 (0.0) | 44.4 -> 52.8 (+8.3) | control positivo **no reproduce** P7.8-R |

Sin inferencias de interaccion (n pequeno). Lo unico que el contrato movio de forma medible es **costo**: -19% tokens de entrada por turno (B6) y -22% (B4), latencia por llamada ~-7%, sin perdida de seguridad ni de progreso.

## 14. Conclusiones separadas

**A. Cognicion de cantidad faltante (Q-): ningun componente del contrato la produce.** Q- pide cantidad va de 41.7% a 52.8% entre B0 y cualquier variante salvo B1, sin patron por componente (B2 y B3 +8.3 cada uno, B4 y B6 sin cambio). Frente a B0, B6 tiene delta 0.0 pp con IC pareado aproximado de +-11 pp (exploratorio, seccion 16): un efecto de +20 pp queda excluido, y con mas razon el +33 pp de P7.8-R para este corpus. Lo que si separa los escenarios es el **tipo de mensaje**, identico en las 7 variantes (seccion 15).

**B. Ejecucion con cantidad conocida (Q+): efecto no descartable pero no demostrado.** B6 +8.3 pp sobre B0 (IC pareado aproximado [-6, +22] pp, McNemar exacto p = 0.45): el intervalo incluye +20 pp, asi que P7.9 no puede afirmar ni descartar un efecto pequeno-moderado de B6 sobre Q+; ninguna variante parcial se acerca (B1 -8.3, B2 -8.3, B3 0.0, B4 -2.8, B5 -2.8). Las dos conclusiones tienen causas distintas y ninguna es "el contrato".

## 15. Residuo (comportamiento del modelo por tipo de mensaje)

Descriptivo, agregando las 7 variantes (n = 21 celdas por escenario). **Exploratorio, no preregistrado.** El comportamiento esta en su mayor parte determinado por el escenario (las celdas mixtas son 2-7 de 24 por variante) y es identico entre contratos:

- **Q+ sin ningun commit en las 7 variantes (21/21 fallan): K01 "Quiero dos barras Classic", K02 "Necesito 3 barras ... Pro", K03 "Me llevo una Pro", K09 "1 barra Pro por favor", K10 "Necesito llevar 5 barras Classic".** Casi siempre cierran con "¿Confirmo las 2 unidades?", "¿Te las dejo guardadas ...?", "¿Quieres que la agregue a tu pedido?" (confirmacion generica en 60-71% de los fallos Q+ de cada variante; el resto son preguntas por el producto). **Con verbo de accion o cotizacion si commitea**: K06 "... agregalas" 21/21, K12 "Cotizame 2 ..." 19/21, K08 "Classic x2 por favor" 16/21, K04 "Agregame 2 Classic" 12/21.
- **Taxonomia del fallo Q+ (B0 / B1 / B2 / B3 / B4 / B5 / B6)**: confirmacion generica 12/15/16/12/13/15/11; otra pregunta final (que producto es "Pro", incluso en ingles) 6/8/6/8/8/6/6; pide de nuevo la cantidad ya dicha 2/0/1/0/0/0/0; malformed_call, harness_terminal, otra tool, regrounding, oferta de link e informacion: 0 en todas. **No hay fallos de ejecucion: el modelo nunca llama mal a `select_products`; decide no llamarla y preguntar.**
- **Q- de la misma familia**: enunciados de preferencia/necesidad ("Prefiero la barra Pro", "Necesito la barra Classic para mi gimnasio", "Dame la Pro nomas", "mejor me quedo con la Pro") terminan en "¿Quieres que la agregue?" en vez de "¿cuantas?" (M03 7/21 piden cantidad, M04 1/21, M08 1/21, M12 1/21); "Me interesa llevar ...", "Me gustaria comprar ...", "Ya decidi: la Classic", "Cotizame la barra Classic" si la piden (M01 18/21, M10 21/21, M11 17/21, M07 16/21, M05 12/21). Con verbo de accion sin cantidad ("agregame la Classic", "comprémosla") el modelo **asume cantidad 1** y persiste (M02 20/21, M09 21/21): en 19-36% de los turnos Q- (en P7.8-R: 0/18).
- **Lectura**: el modelo con este prompt trata un enunciado de deseo como aun no confirmado y busca confirmacion ("¿confirmas?") en vez de mutar, tanto con cantidad (Q+) como sin ella (Q-); solo un verbo de accion explicito lo lleva a mutar. Es un patron de acto de habla del modelo/prompt, no del contrato de tools: 0 de 5 escenarios "de deseo" cambia con ninguna de las 7 representaciones. Si "confirmar antes de persistir" es o no deseable es una decision de negocio (como la regla de cantidad), no un defecto per se.
- **Segundo cuello de botella (senal de que P7.8-R no lo agoto)**: mientras B6 no mejora Q-, Q+ queda en 36-53% en todas las variantes; el residuo Q+ ya existia en P7.8-R (45-55%) y P7.9 lo confirma como independiente del contrato.

## 16. Analisis exploratorio (NO preregistrado; no reemplaza los resultados de la seccion 11)

- **Ruido**: temperature 0 no da determinismo en DeepSeek. Con el MISMO contrato y escenario, las 3 corridas discrepan en 2-7 de 24 celdas por variante (B0 6/24, B1 7/24, B2 6/24, B3 2/24, B4 7/24, B5 4/24, B6 5/24). Deltas de +-8 pp equivalen a 3 turnos de 36.
- **McNemar exacto pareado vs B0** (pares = mismo escenario y corrida; 12 pruebas, sin ajuste multiple): Q-: B1 p = 0.039 (B0 solo 8, B1 solo 1), B2 0.25, B3 0.45, B4 1.0, B5 1.0, B6 1.0. Q+: B1 0.51, B2 0.45, B3 1.0, B4 1.0, B5 1.0, B6 0.45. Unico resultado nominalmente "significativo": B1 **reduce** Q- (IC pareado aproximado de la diferencia -19.4 pp: [-34.5, -4.4]); no se sostiene con multiplicidad (12 pruebas) ni es coherente con B4/B6 (que incluyen la misma descripcion thin). Hipotesis a confirmar, no hallazgo: una descripcion corta con `useWhen/doNotUseWhen` largos podria ser incoherente para el modelo.
- **IC pareados aproximados (Wald) de B6 - B0**: Q- 0.0 pp [-10.9, +10.9]; Q+ +8.3 pp [-5.8, +22.5].
- **Por escenario** (`summary.json` `scenarioBreakdown`): los efectos de variante se concentran en pocas celdas incoherentes entre si (p. ej. M03: B3 y B4 3/3, B0 y B6 0/3; M05: B2/B6 3/3, B3 0/3; K05: B6 3/3, B1/B3/B5 0/3), consistente con sensibilidad caotica a cualquier cambio de texto mas que con un componente.
- **Limitacion conocida del instrumento (P7.7 seccion 9, el stub no resuelve bien "la Pro")**: en escenarios con solo "Pro" (K03, K05) el modelo grounded 9/21 y a veces pregunta "¿a que producto Pro te refieres?" (incluso en ingles: "I need a bit more context to help you"). Afecta por igual a las 7 variantes.

## 17. Defectos post-batch del analizador

Ninguno que cambie un resultado. Revisados: clasificacion de respuestas (las 6 respuestas `other_final_response` de B0 son preguntas por el producto/`Pro`, correctas como `OTHER_QUESTION`), denominadores, contaminacion de contexto (0), rechazos de Gateway (ambientales). Observaciones que **no** son defectos y no se corrigen: (a) `commercialProgressAfterGrounding` excluye del denominador los turnos sin `get_product_details` en el turno (M11: 0/21 grounded; K11: 4/21) - por eso la metrica de promocion usa denominador fijo; (b) el modelo asume cantidad 1 con verbos de accion (M02, M09): se cuenta como fallo Q- por la anotacion preregistrada, igual en las 7 variantes. No se genera resultado corregido.

## 18. Senal de arquitectura/capability

**`CAPABILITY_TAX_NOT_REPLICATED`** (preregistrada, global y para Q- y Q+). No se cumple ninguno de: `USEWHEN_IS_BOTTLENECK`, `DONOTUSEWHEN_IS_BOTTLENECK`, `DESCRIPTION_IS_BOTTLENECK`, `SCHEMA_PRESENTATION_IS_BOTTLENECK`, `COMBINED_CONTRACT_COMPLEXITY_IS_BOTTLENECK`, `MULTIPLE_FACTORS`. No se afirma "el contrato de capabilities es cuello de botella". Tampoco se afirma que el contrato sea irrelevante: para Q+ B6 (+8.3 pp) tiene IC que llega a +22 pp, y solo se probaron 7 tools con un modelo, un corpus sintetico y un stub. P7.9 **no decide R3 vs autonomo**.

## 19. Limitaciones

Un modelo (`deepseek-v4-flash`), 36 turnos por grupo y variante (IC de Wilson de +-15-16 pp), 3 corridas por celda con no determinismo a temperature 0; corpus sintetico con solo dos productos (sin "discos") y stub de catalogo que no resuelve bien "la Pro" (K03/K05); dos escenarios de cotizacion (M05/K12) con Quote Service BLOCKED (los rechazos de `create_quote` no son evidencia); anotacion Q-/Q+ hecha a mano por escenario (la decision "agrega la Classic" = Q- es del enunciado); detector por regex (con golden de 77 entradas y una extension hecha en el smoke) sin juez independiente; el schema actual no tiene field descriptions, asi que B5 solo cubre `minimum`/`minItems` y la eliminacion de propiedades opcionales (`combinationId`, `limit`) solo esta medida dentro de B6 (posible B7 = B4 + propiedades opcionales fuera); solo 7 de 14 tools se adelgazan; el prompt autonomo es el de P7.8-R (no se varia); no se comparo R3 (fuera de alcance); sin trafico real de EC2.

## 20. Archivos

Nuevos: `lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/` (`replyClassifier.ts`, `isolationCorpus.ts`, `isolationSurfaces.ts`, `isolationAnalysis.ts`, `runIsolation.ts`), `scripts/r3-p7-9-capability-isolation.ts`, `tests/agent-loop/benchmark/r3CapabilityIsolation/` (4 archivos de test + `goldenReplies.json`), este documento, y la entrada 23.10 (+ nota en "Do Not Accidentally Reintroduce") de `docs/R3_COMMERCIAL_AGENT_HANDOFF.md`. Ediciones aditivas al harness/instrumento (sin efecto sobre P7.8-R): `r3TrueAB/toolSurface.ts` (`export` de `OPERATION_SEMANTICS_SENTENCES`, `computeStats`, `buildSurface`; `ToolSurfaceId` como `string`), `r3TrueAB/runTrueHarnessCase.ts` (`arm` como `string`; solo etiqueta), `r3AutonomousAB/analysis.ts` (`analyzeRun` acepta un resolvedor de anotaciones, por defecto las tablas de P7.8; `flatMap` con arrow). Sin cambios de produccion, Gateway, CommercialWork, DB, capabilities ni del prompt; sin R3; sin P8 ni MCP.

## 21. Validaciones

```text
tests P7.9 (4 archivos)                               -> 29/29 PASS  (detector 6, superficies 9, analisis/corpus/plan/promocion 7, DB offline 7)
tests P7.8-R (r3TrueAB, 3 archivos)                   -> 37/37 PASS
tests P7.8 (r3AutonomousAB, 3 archivos)               -> 41/41 PASS  (autonomousPrompt 11/11 con entorno limpio)
tests E2E corpus (r3CommercialE2E)                    -> 3/3 PASS
tests Gateway (gateway, hardening, identity gate, trusted context, agentCapabilityExposure) -> 62/62 PASS
tests selectProductsCapability                        -> 10/10 PASS
npm run typecheck / npm run build                     -> PASS
lint focalizado (r3CapabilityIsolation, r3TrueAB, analysis.ts) -> limpio
git diff --check                                      -> limpio (solo el aviso LF/CRLF de autocrlf)
```

Notas: `autonomousPrompt.test.ts` no termina si se corre con las variables `DB_*` de `crm_test` exportadas (un handle de pool queda abierto): es un artefacto del entorno de esa corrida, con entorno limpio pasa en 4 s (11/11). Los tests P7.9 con DB fijan su propio entorno `crm_test` (como los de P7.8-R). Sin base de produccion (`NODE_ENV=test`, `crm_test`). No se corrio la suite completa del repo.

## 22. Siguiente fase recomendada

No adoptar ni descartar ninguna arquitectura y no P8. Por evidencia: (1) **no adelgazar contratos de capabilities como remedio a "no pide cantidad"/"no commitea"**: P7.9 no lo respalda; sirve solo para ahorrar ~20% de tokens de entrada y eso ya esta medido sin costo de seguridad. (2) El foco pasa al **acto de habla / confirmacion previa a persistir**: con el contrato B0 fijo, variar el prompt autonomo (la sentencia de objetivo y una regla de "enunciado de deseo con producto y cantidad = seleccion") y/o el modelo, sobre un corpus **estratificado por acto de habla** (declarativo de deseo vs imperativo/cotizacion) para cuantificar 0/21 vs 21/21. (3) **Regla de negocio antes de medir**: si pedir "¿confirmas?" antes de persistir con cantidad dada es defecto o cautela; y la regla de cantidad por defecto con verbo de accion (M02/M09 persisten cantidad 1). (4) Arreglar la limitacion del stub ("Pro") o evitarla en el corpus. (5) Si se quiere cerrar B6/Q+: un ensayo con n mayor solo para Q+ (IC pareado llega a +22 pp) y B7 = B4 + propiedades opcionales fuera.

## 23. Confirmaciones

Semantica de `quantity` sin cambios (requerida, entera, en las 7 variantes; test); sin cambio de capabilities de produccion; sin bypass del Gateway (toda variante pasa por `runTrueHarnessCase` -> `executeGovernedCapability`, con fila de auditoria por llamada; test); sin cambios a R3; sin P8; sin MCP; sin tuning post-resultado (el unico cambio del detector fue en el smoke, antes del freeze, ver seccion 5); sin commit; sin push.
