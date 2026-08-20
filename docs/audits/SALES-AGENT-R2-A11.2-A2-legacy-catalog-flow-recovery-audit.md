# SALES-AGENT-R2-A11.2-A2 - Legacy Catalog Flow Recovery Audit

Estado: auditoria comparativa, sin cambios de codigo. Alcance deliberadamente angosto: solo
`runAgentToolLoop.ts` (Agent Tool Loop legacy) vs CommercialWork (R2), solo capacidades de
catalogo. No repite el inventario del Catalog Service ni el root cause del bug de busqueda -
eso vive en [`SALES-AGENT-R2-A11.2-catalog-service-integration-audit.md`](./SALES-AGENT-R2-A11.2-catalog-service-integration-audit.md)
("A11.2" de aqui en adelante) y sigue vigente sin cambios.

Pregunta que responde este documento: **¿el Agent Tool Loop legacy ya tenia una secuencia
correcta de discovery -> search -> details -> recommendation -> selection que R2 dejo de
cablear?**

Respuesta corta: **hibrido, pero no simetrico**. Para el problema que realmente reporto el
bug (encontrar un producto desde una descripcion en lenguaje natural), legacy no tenia nada
mejor - usa la capability `search_products` identica, registrada una sola vez en el mismo
Capability Gateway, contra el mismo endpoint roto (Escenario B: no hay nada que portar, A11.2-B/C
siguen siendo necesarios sin cambios). Para lo que pasa **despues** de que un producto ya fue
encontrado - detalle/link, recomendacion, gating de evidencia, continuidad entre turnos -
legacy tiene una orquestacion real, probada y bien disenada que R2 nunca reconstruyo
(Escenario A: se puede portar el diseno, no hay que reinventarlo).

---

## 0. Hallazgo previo: existe un TERCER runtime, mas viejo que el Agent Tool Loop

Antes de comparar, una correccion de alcance necesaria. `runNativeAutonomousCycle.ts` (el
chokepoint compartido, ya identificado en A11.2 Parte 16) selecciona exactamente uno de
**tres** runtimes por turno, en este orden de prioridad (`runNativeAutonomousCycle.ts:270-437`):

1. `commercialWorkEnabled` (`shouldRouteToCommercialWork`) -> R2 CommercialWork, retorna temprano.
2. `agentToolLoopEnabled` -> el Agent Tool Loop real (`runNativeAgentToolLoopCycle` ->
   `runAgentToolLoop`), retorna temprano. Comentario propio del codigo, linea 439-442: "this
   branch stops here - no brainContextShim, no shadow evaluation, **no old operational loop**,
   no legacy capability-execution stage."
3. Si ninguno de los dos esta activo: cae a un pipeline **aun mas antiguo** ("shadow
   evaluation" + "operational loop" + `buildCatalogGroundedMessage.ts`, Fase 2/3/3.5,
   `runNativeAutonomousCycle.ts:650-830`) - un flujo enteramente deterministico (sin LLM
   tool-by-tool): ejecuta `search_products` una vez, rankea con `rankCatalogSearchResults`,
   hidrata con `batch_get_products` en una sola llamada, rankea por presupuesto
   (`rankCatalogCandidatesByBudget`) y compone un mensaje con plantillas fijas
   (`buildMessageFromRanking`), sin que un LLM decida que tool llamar.

Este tercer path (comentarios lo datan en `ACS-R1-01.1`, la release mas antigua de todo el
sistema) **no es el "legacy" que pidio esta auditoria** - el usuario nombro explicitamente
`runAgentToolLoop.ts` y el pool de 10 tools. Se documenta su existencia porque es information
real y porque explica por que "legacy" en este repo tiene mas de una capa historica, pero no
se audita en profundidad aqui (fuera del alcance angosto pedido). Dato util para el futuro:
si alguna vez ambos flags (`commercialWorkEnabled`, `agentToolLoopEnabled`) estan apagados,
el sistema no queda inactivo - cae silenciosamente a este tercer pipeline determinista, que
ya resuelve "search -> hidratar -> rankear -> presentar" sin depender de decisiones del LLM.
Vale la pena tenerlo en mente si alguna vez se audita el arbol completo de runtimes.

---

## 1. Secuencia legacy exacta: mecanica del loop

`runAgentToolLoop.ts:530-927`. Dos fases con presupuestos independientes:

- **Gathering**: `while (decisionIndex < maxDecisions && toolExecutionCount < maxToolExecutions)`
  - `maxDecisions = 3` (`DEFAULT_MAX_DECISIONS`), `maxToolExecutions = 2`
  (`DEFAULT_MAX_TOOL_EXECUTIONS`), ambos configurables por caller pero estos son los defaults
  reales de produccion.
  - **El presupuesto real de encadenamiento es 2 tool executions por turno**, no 3 - la
    tercera "decision" solo puede ser `respond`/`handoff` una vez gastadas las 2 ejecuciones
    (la condicion del `while` corta ahi). Esto acota cuanto puede "encadenar varias tools" el
    LLM en un solo turno: como maximo 2 llamadas reales, ej. `search_products` ->
    `get_product_details`, o `recommend_catalog_products` -> `get_product_details`. Un
    encadenamiento de 3 (ej. search -> details -> select) **no cabe en un turno** - requiere
    2 turnos, o el modelo debe elegir cual de las 2 hacer.
  - Cada decision, el LLM ve `priorStepsThisTurn` (los pasos y observations de ESTE turno,
    `buildAgentStepPromptPackage.ts:625-633`) y elige exactamente un `AgentStep`:
    `use_tool` (nombra una tool + argumentos), `respond`, o `handoff`. Es genuinamente
    ReAct: tool -> observation -> siguiente decision del mismo LLM, no un plan de una sola
    pasada.
- **Finalization**: si se agota el presupuesto de gathering sin `respond`/`handoff`, hasta
  `FINALIZATION_MAX_ATTEMPTS = 2` intentos, **sin tools ofrecidas** (`availableTools: []`) -
  solo puede responder o hacer handoff con lo que ya sabe.

`processUseToolStep` (`runAgentToolLoop.ts:375-515`) gobierna cada ejecucion real:
deduplicacion por hash de argumentos (`buildDedupeKey`, nunca repite la misma tool+args en el
mismo turno), verificacion de registro en `AGENT_LOOP_TOOL_POOL`/Gateway, y **dos gates de
evidencia especificos de catalogo que corren ANTES de tocar el Gateway** (Parte 3).

---

## 2. Que decidia el LLM vs que resolvia el runtime (determinismo real, no solo nominal)

A diferencia de lo que el ticket original de esta auditoria (A11.2) asumia como riesgo -
"el LLM decide tool-by-tool, sin control" - el runtime legacy **si** impone reglas
deterministicas fuertes alrededor de esa eleccion, via `buildAgentStepPromptPackage.ts`
(`EXPLORE_CATALOG_RULE_LINES`, `RECOMMEND_CATALOG_PRODUCTS_RULE_LINES`,
`SELECT_PRODUCTS_RULE_LINES`, lineas 189-235 y 340-361) + los gates de
`processUseToolStep` (que se ejecutan pase lo que pase diga el LLM, no son solo texto de
prompt):

- El LLM decide: **cuando** llamar cada tool y **con que argumentos** (dentro del JSON Schema
  de cada una).
- El runtime decide, sin que el LLM pueda saltarselo: si `recommend_catalog_products`/
  `select_products` puede ejecutarse en absoluto (evidencia de producto observado, Parte 3),
  si una tool esta duplicada, si el presupuesto de tool calls esta agotado, si un
  `get_product_details` pedido durante una continuidad de recomendacion activa corresponde a
  un candidato real de esa recomendacion (Parte 4).

Es decir: el diseno legacy **ya seguia el principio que la tarea original pedia** ("LLM no
decide tool-by-tool sin gobierno") - solo que lo implemento como reglas de prompt + gates de
runtime sobre un LLM que SI elige la tool, en vez de como derivacion 100% determinista sin
intervencion del LLM en la eleccion (que es como lo hace R2). Ambos disenos cumplen la
garantia real (nunca se ejecuta una capability sin evidencia valida); difieren en el
mecanismo.

---

## 3. Evidence gates de catalogo (lo mas valioso y mejor disenado que tiene legacy)

Dos gates, corriendo dentro de `processUseToolStep` **antes** de `executeGovernedCapability`
- si fallan, cero llamadas HTTP al Catalog Service (`runAgentToolLoop.ts:404-454`):

### 3.1 `recommend_catalog_products`

`resolveObservedRecommendationSourceProduct.ts:93-125`. El `sourceProduct.productId` debe
haber sido "observado" esta conversacion, por dos fuentes combinadas:

- **Cross-turn** (`collectHistoricalEvidence`, linea 38-47): `RecentCatalogContext`, leido de
  `crm_capability_executions` con ventana de 24h (`recentCatalogContext.ts:1-8`), filtrado a
  `search_products | get_product_details | explore_catalog` - **nunca** `recommend_catalog_products`
  (comentario explicito linea 21-25: "no recursive recommend -> recommend -> recommend
  chains").
- **Same-turn** (`collectLiveEvidence`, linea 59-83): las `ToolObservation`s ya generadas este
  mismo turno, mismo allowlist de 3 tools.

Si `productMatches.length === 0` -> `blocked: source_product_not_observed`. Si hay
`combinationId` pedido y no matchea exactamente -> `blocked: source_product_variant_not_observed`.
Si el productId matchea pero con 2+ variantes distintas observadas sin que el modelo haya
especificado cual -> tambien bloqueado (nunca elige una por el modelo).

### 3.2 `select_products`

Mismo mecanismo, reusado item por item (`runAgentToolLoop.ts:437-454`): cada
`(productId, combinationId)` que el modelo intenta seleccionar debe estar en el mismo pool de
evidencia de 3 tools. **Un candidato de `recommend_catalog_products` NO cuenta como evidencia
propia para `select_products`** - debe observarse independientemente via
`search_products`/`get_product_details`/`explore_catalog` primero. Esto es una regla real,
explicita en el prompt (`RECOMMEND_CATALOG_PRODUCTS_RULE_LINES[0]`, linea 232: "never use a
recommend_catalog_products candidate as the sourceProduct for another recommend_catalog_products
call") y en `SELECT_PRODUCTS_RULE_LINES[1]` (linea 342).

**Consecuencia arquitectonica**: el grafo real de evidencia no es una cadena lineal
`search -> recommend -> select`. Es: `{search_products | explore_catalog | get_product_details}`
como unica fuente de evidencia valida para **ambos** `recommend_catalog_products` y
`select_products` - `recommend_catalog_products` es una rama lateral que produce candidatos
para mostrar/enlazar, pero para comprar uno de esos candidatos el flujo real vuelve a pasar
por `get_product_details` (o `search_products`) sobre ese productId especifico antes de que
`select_products` lo acepte.

---

## 4. Continuidad entre turnos: `pendingCatalogAction` (lo que R2 no tiene)

`pendingCatalogAction.ts` + el bloque `PENDING_CATALOG_ACTION_RULE_LINES`
(`buildAgentStepPromptPackage.ts:298-305`). Mecanismo real, persistido en
`commercial_event` (`event_type = 'agent_tool_loop_completed'`, un solo row por lookback,
`pendingCatalogAction.ts:275-300`):

1. Turno N: el modelo presenta 1+ productos y cierra con "¿Quieres que te envie el link?" ->
   el `respond` step adjunta `pendingCatalogAction: { actionType: "send_product_link",
   candidateProductIds }`. Tambien se genera automaticamente (sin que el modelo lo pida) cuando
   `recommend_catalog_products` completa con candidatos
   (`buildPendingCatalogActionFromRecommendation`, `pendingCatalogAction.ts:112-134`) - esto
   queda abierto como "continuidad de recomendacion" (`activeRecommendationPendingAction`,
   `runAgentToolLoop.ts:565-567`) aunque el modelo no lo mencione explicitamente.
2. Turno N+1: el cliente responde ("si", "el segundo", nombra uno). El runtime valida contra
   `matchesPendingCatalogActionCandidate` (comparacion exacta de productId+combinationId,
   `pendingCatalogAction.ts:96-100`) y - **mientras esa recomendacion siga activa** - restringe
   `get_product_details` a esos candidatos especificos, salvo que el producto pedido ya este
   evidenciado por otra via (`collectNonRecommendationEvidenceProductIds`,
   `runAgentToolLoop.ts:361-367`, `activeRecommendationPendingAction` gate linea 466-489).
3. Consumo: una vez que `get_product_details` matchea un candidato de la recomendacion y
   termina (completed/failed/blocked, no solo completed), la continuidad se consume
   (`runAgentToolLoop.ts:824-836`) - no queda abierta indefinidamente.

**R2 no tiene un equivalente de esto.** R2 si reusa `RecentCatalogContext` (via
`requirementResolver.ts:matchProductReference`, ya documentado en A11.2 Parte 14) pero
solo para reconciliar un `productReference` de texto libre contra nombres ya vistos - no
existe en R2 el concepto de "una recomendacion abierta con candidatos especificos que el
siguiente turno puede confirmar por posicion o nombre", ni el de "oferta de link pendiente".
Esto es directamente portable como diseno: la idea (una accion ofrecida por el sistema queda
como estado estructurado, con candidatos identificados por id, consumible por el turno
siguiente) no depende de que el LLM elija tools - es perfectamente expresable como un
`CommercialObjective`/evidence adicional en el modelo determinista de CommercialWork.

---

## 5. Tabla de capabilities (respondiendo la matriz pedida)

| Capability | Legacy la invoca | Que la dispara | Puede encadenar otra | Evidence generado | Equivalente R2 |
|---|---|---|---|---|---|
| `search_products` | Si | El LLM decide, apenas hay info suficiente (regla: "use a tool as soon as you have enough information") | Si -> `get_product_details`, `recommend_catalog_products`, `select_products` (via evidence pool, Parte 3) | `RecentCatalogContext` (top 5, position+productId+name) + `ToolObservation` este turno (`productId/name/availability/stockQuantity`, `buildToolObservation.ts:20-32`) | `SEARCH_PRODUCTS` (ejecutable) |
| `get_product_details` | Si | El LLM decide: tras search/explore para dar link o detalle completo; obligatorio antes de compartir un link (`PRODUCT_PUBLIC_LINK_RULE_LINES`); o para resolver un `pendingCatalogAction` activo | Si -> alimenta evidencia para `recommend_catalog_products`/`select_products` igual que search | `RecentCatalogContext` (1 producto) + observation con `price/stock/publicLink` completos (`buildToolObservation.ts:34-57`) | `GET_PRODUCT_DETAILS` (step type existe, **no ejecutable**, `EXECUTABLE_STEP_TYPES` no lo incluye) |
| `explore_catalog` | Si | El LLM decide, SOLO para extremos/top-N/ranking/filtros - explicitamente "not for open-ended semantic product discovery" (`EXPLORE_CATALOG_RULE_LINES[1]`) | Si, misma pool de evidencia que search_products | `RecentCatalogContext` (mismo shape que search) + observation con `scope/sort/totalMatched/exhaustiveForScope` | inexistente - ni siquiera hay `EXPLORE_CATALOG` en `COMMERCIAL_WORK_STEP_TYPES` |
| `recommend_catalog_products` | Si | El LLM decide, pero **bloqueado antes del Gateway** si `sourceProduct` no fue observado (Parte 3.1) | Si -> `get_product_details` (via `pendingCatalogAction` cross-turn, Parte 4). **Nunca** directo a `select_products` (sus candidatos no son evidencia propia) | `RecentCatalogContext` (via `productsFromRecommendCatalogProducts`) + `pendingCatalogAction` persistido en `commercial_event` | `RECOMMEND_PRODUCTS` (step type existe, no ejecutable, Y su objective type nunca es producido por el planner - doblemente muerto en R2, confirmado en A11.2 Parte 2.1) |
| `select_products` | Si | El LLM decide, solo tras confirmacion explicita de cantidad/producto - nunca mientras solo compara u opina | Terminal en este loop (no hay `set_shipping_destination`/`calculate_shipping`/`create_quote` encadenables desde aqui en la misma logica de evidencia de catalogo) | `commercial_line_items` durable (fact), igual mecanismo que R2 | `SELECT_PRODUCTS` (ejecutable) |

---

## 6. Los 8 criterios de salida pedidos

**1. Secuencia legacy exacta por caso comercial**: no hay una secuencia fija por caso - es
gobernada por reglas + gates (Partes 2-4), no por un grafo hardcodeado. El caso simple
(C01/C02 de A11.2, "cliente describe un producto y lo quiere comprar") resuelve en el minimo
posible: `search_products -> select_products`, **2 llamadas, exactamente el mismo shape que
R2 ya construyo** (`SEARCH_PRODUCTS -> SELECT_PRODUCTS`). `get_product_details` no es
prerequisito de `select_products` cuando el producto ya viene evidenciado por `search_products`
- solo es obligatorio para compartir un link o confirmar "precio actual" explicitamente. El
caso de recomendacion (C10) usa la cadena mas larga: `search_products/get_product_details ->
recommend_catalog_products -> [turno siguiente] get_product_details -> select_products`.

**2. Tools realmente encadenadas**: maximo 2 ejecuciones reales por turno (Parte 1); cadenas
mas largas requieren 2+ turnos, sostenidas por `RecentCatalogContext` (24h) y
`pendingCatalogAction` (1 turno de lookback).

**3. Que decisiones tomaba el LLM**: cuando llamar una tool y con que argumentos, nunca si
la evidencia alcanza para ejecutarla (eso lo decide el runtime, gates duros) - ver Parte 2.

**4. Que evidence dejaba cada tool**: tabla de la Parte 5, columna 4.

**5. Que partes pueden trasladarse 1:1 a CommercialWork**: las **reglas**, no el mecanismo de
eleccion. Concretamente: (a) el gate de evidencia de `resolveObservedRecommendationSourceProduct`
generalizado a "todo item que CommercialWork intenta seleccionar/recomendar debe rastrear a
una ejecucion real de search/details/explore de esta conversacion" - hoy R2 lo logra
implicitamente por construccion (items solo se llenan desde un resultado real de search), pero
no como un gate nombrado y reusable; (b) el concepto de `pendingCatalogAction` (accion
ofrecida por el sistema, con candidatos identificados, consumible el turno siguiente) como un
nuevo tipo de evidence/estado en el modelo de CommercialWork (Parte 4); (c) la regla "usa
`get_product_details` antes de compartir un link o afirmar precio/stock actual" - aunque, con
T12 conectado (A11.2-C), esto queda mayormente subsumido: T12 ya devuelve `publicLink`/precio/
stock por candidato en la misma llamada de `search_products`, asi que portar
`get_product_details` como step separado deja de ser critico para el flujo de compra base
(si sigue siendo relevante para *re-confirmar* datos si ha pasado mucho tiempo, pero eso no es
lo que bloqueaba el bug reportado).

**6. Que partes deben eliminarse (no trasladarse)**: el loop de decision LLM-por-paso en si
mismo (es lo que R2 reemplaza por diseno, con razon); la deduplicacion por hash de argumentos
del turno (`buildDedupeKey`) - CommercialWork ya tiene idempotencia a nivel de step; los
reintentos de formato de respuesta (`FINALIZATION_MAX_ATTEMPTS`, recovery de JSON invalido) -
no aplican a un ejecutor determinista que no le pide al LLM que elija la tool.

**7. Que gaps siguen existiendo incluso en legacy**: el bug de `search_products` (A11.2 Parte 3)
- identico, mismo Capability Gateway, nunca corregido en legacy tampoco. T12 nunca fue
conectado ni en legacy ni en R2 - no es que R2 "perdio" el wiring de T12, nunca existio en
ningun runtime de este repo. `explore_catalog` no resuelve discovery amplio/vago ("una pesa",
C03 de A11.2) en legacy tampoco - esta reservado por regla explicita a extremos/rankings, el
mismo limite que documenta A11.2 Parte 9. Ninguna capability de catalogo en ningun runtime usa
sinonimos de dominio (los que si existen en T12, sin conectar). La unica ventaja real de
legacy para C03 es que el LLM **puede elegir no llamar ninguna tool y responder directamente
con una pregunta de precision** (un `respond` step sin `use_tool`) - R2 no tiene esa salida:
su derivacion determinista siempre dispara `SEARCH_PRODUCTS` en cuanto hay `productReference`,
sin la opcion de "preguntar primero" que el juicio del LLM legacy si tenia disponible.

**8. Graph final propuesto legacy -> R2**: ver Parte 7.

---

## 7. Grafo propuesto (nombres reales, integrando A11.2 + este audit)

```
PRODUCT_REFERENCE (planner, sin cambios)
       |
SEARCH_PRODUCTS  (contra T12 tras A11.2-B/C - ya incluye publicLink/precio/stock por candidato)
       |
   T12 resolution.status
   +----------------+---------------------+
 resolved      clarification_required   no_match
   |                  |                    |
 SELECT_PRODUCTS  WAITING_CUSTOMER    WAITING_CUSTOMER
 (auto, con         (candidatos con     (PRODUCT_NOT_FOUND,
 evidence de       precio real, no      sin cambio)
 T12 ya incluida)  solo nombres)
```

`RECOMMEND_PRODUCTS`/`explore_catalog` siguen fuera de este grafo principal (A11.2 Partes
8-9, reconfirmado aqui: ninguno de los dos runtimes historicos los resuelve mejor para
discovery amplio). Si en el futuro se decide portar el patron `pendingCatalogAction` +
`recommend_catalog_products` con evidence gate, es un grafo **paralelo**, activado por un
intent nuevo del planner (fuera de alcance de A11.2, ya senalado en A11.2 Parte 19) - no un
prerequisito del camino principal de compra.

---

## 8. Impacto sobre el plan de slices de A11.2

No cambia el orden ni la necesidad de **A11.2-B** (fix de stopwords en Catalog Service) ni
**A11.2-C** (conectar `search_products` a T12) - este audit confirma que no hay wiring legacy
que los vuelva innecesarios; el bug es compartido por todo runtime existente. Se ajusta
**A11.2-D**: con T12 conectado, `publicLink`/precio/stock ya llegan en la misma llamada de
search - la necesidad de portar `get_product_details` como step ejecutable independiente baja
de prioridad para el flujo de compra base (se mantiene como deuda documentada, no como
bloqueante).

Se agrega, explicitamente **fuera del alcance de A11.2** (mismo criterio que A11.2 Parte 19
ya establecio para un intent nuevo de discovery/recomendacion): un futuro slice para portar
el patron `pendingCatalogAction` (accion ofrecida por el sistema + candidatos identificados +
consumo en el turno siguiente) al modelo de evidence de CommercialWork, y otro para
`recommend_catalog_products` con su evidence gate - ambos dependen de que exista primero un
intent de planner que los dispare, no de un cambio de integracion con el Catalog Service.

---

## Veredicto

**Escenario hibrido, caracterizado con precision**: para el problema que origino esta
auditoria completa (discovery de producto desde lenguaje natural, el bug de
"discos olimpicos de 20kg"), la respuesta es **Escenario B** - no hay una secuencia legacy
correcta que R2 haya dejado de cablear, porque legacy nunca resolvio ese problema tampoco
(misma capability, mismo bug, T12 nunca conectado en ningun runtime). Para la orquestacion
posterior a encontrar un producto (detalle/link, recomendacion, evidence gating, continuidad
entre turnos), la respuesta es **Escenario A** - legacy tiene diseno real y probado que si
vale la pena portar como reglas deterministicas, no reinventar, cuando llegue el momento de
esa release (fuera de A11.2). Ningun hallazgo de este audit cambia la recomendacion de A11.2:
proceder con A11.2-B seguido de A11.2-C.
