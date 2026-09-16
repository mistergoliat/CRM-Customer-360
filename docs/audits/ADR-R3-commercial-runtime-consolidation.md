# ADR — R3 Commercial Runtime Consolidation

**Fecha:** 2026-09-15  
**Estado:** decisión arquitectónica documentada; implementación pendiente  
**Alcance:** auditoría de `runCommercialWorkInboundCycle`,
`runSalesAgentRuntimeCycle` y el wiring heredado de
`runNativeAgentToolLoopCycle`.  
**Cambios de producción en esta auditoría:** ninguno.

## Decisión resumida

Se elige la alternativa **A**:

> `CommercialWork` debe ser el outer durable case runtime y
> `SalesAgentRuntime` debe ser su cognition/harness engine.

La decisión tiene una precisión importante: no significa conservar el R2
completo. El `semanticIntentAdapter` y el dispatcher basado en
`crm_agent_actions` son piezas de la ruta histórica. Se conserva el kernel
durable de CommercialWork —caso, objetivos, blockers, proyección, versión,
steps ejecutables y recuperación— y se coloca R3 como la única capa que
interpreta la conversación, mantiene la sesión y decide la siguiente acción
cognitiva.

La autoridad futura será:

* caso y objetivo activo: proyección durable de CommercialWork;
* hechos comerciales: dominios/facts existentes;
* razonamiento y continuidad conversacional: SalesAgentRuntime + sesión R3;
* mutaciones: Capability Gateway y sus dominios;
* respuesta: una única frontera R3/Outbox canónica.

No se crea un tercer `CommercialCase` aggregate. Tampoco se mantienen dos
runtimes comerciales productivos de forma permanente.

### Convención de evidencia

Las referencias `archivo:línea` apuntan al árbol inspeccionado en `develop`
(`faf88d7`). Los hechos de producción de la conversación 83 y de los mensajes
468/470/472/474 fueron entregados como evidencia operativa en el brief de esta
auditoría y se tratan como ground truth para el cruce; no se ejecutaron
writes ni se consultó producción en este cambio.

## A. Reconstrucción histórica

### R2: durable commercial work

R2 nació para resolver el límite de un agente secuencial que podía decir
“haré X” sin dejar una representación durable de lo que faltaba. Su forma es:

```text
semantic intent plan -> CommercialObjective -> CommercialWorkStep
-> deterministic executor -> projection/settlement -> finalizer/dispatch
```

La persistencia fue separada intencionalmente de los hechos, acciones y
transporte. `migrations/029_crm_commercial_work_persistence.sql:1-150`
deja `crm_request_facts` como verdad comercial, `crm_agent_actions` como
frontera de acción/respuesta, `crm_capability_executions` como evidencia y
`crm_commercial_work(_objectives|_steps)` como aggregate de trabajo. La
versión del aggregate se incrementa mediante CAS en el repositorio; la
secuencia conversacional se agregó después y es distinta de esa versión en
`migrations/031_crm_commercial_work_conversation_sequence.sql:1-70`.

R2 evolucionó desde contratos read-only y persistencia hacia ejecución
multi-step, retries, identity gating, supersession y follow-up objetivo-aware.
El punto de entrada productivo actual es
`runCommercialWorkInboundCycle.ts:160-190`: un LLM clasifica el turno,
CommercialWork reconcilia el resultado y el executor opera de manera
determinista.

### Integración con el harness

El Agent Tool Loop apareció como una ruta distinta y más flexible:

```text
context -> AgentStep -> tool/observation -> next AgentStep -> response
```

El Capability Gateway, el pool de herramientas, los guards de evidencia y los
request boundaries fueron diseñados para ser independientes del loop. La
documentación de R3-V1.3 confirma que `SalesAgentRuntime` reutiliza
`runAgentToolLoop` directamente, no reimplementa otro loop y no absorbe todo
`runNativeAgentToolLoopCycle` (`docs/releases/SALES-AGENT-R3-V1.3-first-sales-agent-runtime.md`).

### R3 actual

R3 agregó, sobre esa base, una frontera runtime-neutral y luego capacidades
conversacionales que no existen en R2: sesión persistente, compaction, live
turn assimilation, open-turn execution, harness-aligned message sequencing,
settlement de turnos y dispatch nativo.

La integración real sigue siendo aditiva: `runNativeAutonomousCycle.ts`
resuelve una sola identidad/snapshot y selecciona una rama mutuamente
exclusiva. La prioridad actual es CommercialWork, MultiRequest, Agent Tool
Loop y finalmente SalesAgentRuntime; las ramas están en
`runNativeAutonomousCycle.ts:286-347` y el branch R3 comienza en
`runNativeAutonomousCycle.ts:639`.

Por tanto, CommercialWork y SalesAgentRuntime no son capas anidadas hoy.
Son dos runtimes hermanos que reciben el mismo tipo de entrada exterior y
comparten primitives. R3 no llama a CommercialWork.

## Call graphs en paralelo

La siguiente tabla reconstruye los dos caminos desde la entrada de runtime
hasta response/outbox. Los pasos de recuperación que ocurren fuera del request
inline también se muestran porque son parte del comportamiento durable real.

| Stage | `runCommercialWorkInboundCycle` | `runSalesAgentRuntimeCycle` |
|---|---|---|
| Input | `conversationId`, `waId`, `inboundMessageId`, correlation/time, customer text, `CommercialContextSnapshot`, provider/config, trusted session | `conversationId`, public id, customer/phone ids, `waId`, message, snapshot, provider/config, session store, settlement/freshness flags |
| Entry gate | Snapshot `humanOwnerActive`/`aiBlocked`; no model if blocked | Same snapshot gate; `SalesAgentRuntime` repeats governance and returns `blocked` |
| Identity | Uses `snapshot.customerSession.runtimeIdentity` for projection and trusted session for capability calls | Uses event identity plus `trustedCustomerSession`; Gateway identity gate applies at action execution |
| Customer context | Snapshot includes customer, opportunity, need profile, messages, destination and line items; R2 builds a smaller commercial summary | Same snapshot is reduced by `buildMinimalCommercialContextSummary` to opportunity status/stage, need profile, destination, line items and last messages |
| Opportunity/case | Requires an existing opportunity; if absent, forced handoff acknowledgement and no work | Starts with snapshot opportunity; `ensureOpportunity` is lazy and only runs when a `COMMERCIAL_ACTION` is attempted |
| Durable facts | Loads selected shipping option, created quote, recent capability executions, recent catalog, plus snapshot facts | Snapshot facts plus recent catalog and pending catalog action; individual capabilities rehydrate their own authoritative facts |
| Objective creation | `planCommercialObjectiveSeeds` performs one semantic LLM call and creates objective seeds | No objective seed/work id/version is created or loaded |
| Objective reconciliation | `reconcileCommercialTrigger` carries active objectives, applies sequence/stale check, projects/creates/updates `crm_commercial_work` and child rows | No CommercialWork reconciliation; only ephemeral `conversationContinuity` and in-turn `priorSteps` |
| Durable version | Work aggregate `version`, sequence/lineage and child step status are persisted with CAS | Turn settlement row and session event dedupe; no case aggregate version in runtime input |
| Context compiler | Summary is for the R2 planner; final reply is built from persisted work by the finalizer | `buildAgentStepPromptPackage` builds gathering/finalization prompts from summary, history, continuity, catalog context, pending action and observations |
| Model calls | One provider call in `planCommercialObjectiveSeeds`; later execution is deterministic | Iterative `runAgentToolLoop`: provider call, validate `AgentStep`, tool or response, observation, next call |
| Tool/capability calls | Ready steps call `executeCommercialActionRequest` for mutating steps or `executeGovernedCapability` for read-only steps | `executeReadTool` or `executeCommercialActionRequest`; both end at `executeGovernedCapability` |
| State mutation | Capability/domain writes facts; executor reloads facts and persists next aggregate version | Capability/domain writes facts; loop records tool/session activity but does not persist an objective projection |
| Reprojection | `settleCommercialWorkProjection` repeats pure projection/execution up to bounded rounds, including identity onboarding resume | No case reprojection; live assimilation refreshes the commercial summary and invalidates stale candidates only inside the turn |
| Waiting/blockers | Objective/step statuses become `WAITING_CUSTOMER`, `WAITING_SYSTEM`, `BLOCKED`, `FAILED` or terminal | Runtime returns `responded`, `handoff`, `failed` or `blocked`; unresolved commercial obligations are not a durable runtime result |
| Finalization | `buildCommercialWorkFinalizerMessage(work)` grounds text in durable aggregate | Model's final response is adapted to an `AgentLoopResult` and dispatched by terminal reason |
| Handoff | Work can be `HANDOFF`; current response path uses action persistence/sandbox/execution gate | R3 typed handoff transfers conversation control only for explicit eligible reason codes; ambiguous free text falls back |
| Response/outbox | `dispatchCommercialWorkResponse` -> `persistAgentAction` -> sandbox -> execution gate -> canonical outbox | `dispatchSalesAgentTerminalOutcome` -> R3 governed dispatcher -> ownership/freshness transaction -> canonical outbox |
| Post-dispatch | CommercialWork completion event; waiting work may schedule objective-aware follow-up; async sweep recovers undelivered terminal work | `ASSISTANT_MESSAGE_SENT`, session compaction and `agent_tool_loop_completed`; turn settlement completes or supersedes the row atomically with R3 outbox where eligible |
| Crash/retry | Step lease/worker claim, Gateway retry, `RETRY_SCHEDULED`, stale recovery, evidence repair and async delivery sweep | Provider/process crash leaves settlement `PROCESSING` for reclaim; session replay restores cognition, while capability/outbox idempotency protects durable effects |

### Wiring heredado de `runNativeAgentToolLoopCycle`

Este tercer módulo es un sibling, no un ancestor de R3. Comparte snapshot,
recent catalog, prompt/loop, tool exposure and Gateway, pero su terminal
dispatcher histórico es `dispatchAgentLoopResponse` y por tanto entra en
`crm_agent_actions`/sandbox/execution-gate. `SalesAgentRuntimeCycle` no lo
invoca y no usa ese dispatcher (`runNativeAutonomousCycle.ts:477-636` frente a
`:639-857`). Es wiring útil para identificar primitives y deuda; no es un
tercer runtime que deba permanecer.

## B. Rol actual de CommercialWork

### Lo que es legado R2

Estas responsabilidades pertenecen a la arquitectura anterior y no deben
seguir siendo la autoridad cognitiva final:

* `planCommercialObjectiveSeeds` como planner único de vocabulario fijo;
* la obligación de que cada turno pase por una clasificación semántica R2;
* `dispatchCommercialWorkResponse` como dispatcher de respuesta por
  `crm_agent_actions`/sandbox/execution-gate;
* el supuesto de que los steps derivados antes del razonamiento son el plan
  completo de la conversación;
* la ruta de routing por `BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS` como frontera
  de arquitectura.

El planner actual es explícitamente un LLM de un solo paso en
`runCommercialWorkInboundCycle.ts:258-269`. Es una duplicación de la decisión
que R3 ya puede tomar iterativamente con observaciones reales.

### Lo que es genuinamente reusable

CommercialWork contiene el único modelo durable de trabajo comercial observado
en el repositorio:

* aggregate `crm_commercial_work` con `version` y lineage;
* filas de objetivos con status, inputs, missing requirements, evidence,
  blockers y supersession;
* steps con dependencias, estado ejecutable, idempotency key, retry metadata
  y leases;
* `reconcileCommercialObjectives`, que carga objetivos activos y hace
  supersession por familia (`deriveCommercialObjectives.ts:48-66`,
  `reconciliation.ts:43-50`);
* `buildCommercialWorkProjection`, una proyección pura que rehidrata facts y
  calcula status (`buildCommercialWorkProjection.ts:882-916`);
* executor con stale-evidence checks, evidence repair, CAS y aplicación
  determinista de resultados (`commercialWorkExecutor.ts:294-319`,
  `commercialWorkExecutor.ts:601-820`);
* worker que reclama steps con CAS, leases, retry y revalidación de
  elegibilidad antes de continuar (`work/worker/commercialWorkWorker.ts:143-218`,
  `work/worker/commercialWorkWorker.ts:264-386`);
* async delivery/recovery sweep para un work que terminó sin dispatch
  confirmado (`work/worker/dispatchAsyncCommercialWorkDelivery.ts:1-25`,
  `:151-226`).

### Ciclo de objetivo

El modelo sí puede representar `CREATE_QUOTE` durante múltiples turnos:

1. `objectiveSeedsFromPendingIntents` vuelve a emitir `CREATE_QUOTE` cuando
   la selección faltante se resuelve en otro turno
   (`deriveCommercialObjectives.ts:94-126`).
2. `reconcileCommercialObjectives` carga el objetivo previo no terminal y
   conserva su `objectiveId`, inputs y `carriedStatus`.
3. Una nueva intención de la misma familia supersede la anterior; una
   intención lateral de otra familia puede coexistir.
4. La proyección resuelve `CREATE_QUOTE` contra el `selectionFactId` y marca
   el objetivo completed sólo cuando el created quote corresponde a esa
   selección (`buildCommercialWorkProjection.ts:791-819`).
5. Los estados y transiciones están cerrados en
   `statuses.ts:1-40` y `transitions.ts:3-48`: `WAITING_CUSTOMER`,
   `WAITING_SYSTEM`, `BLOCKED`, `COMPLETED`, `CANCELLED`, `SUPERSEDED` y
   `FAILED` no dependen de que el proceso siga vivo.

Esto significa que el objetivo sobrevive un restart y que la proyección no
depende del transcript para saber qué fact está confirmado. Sí depende de
inputs/semántica para abrir o superseder objetivos nuevos: no es una máquina
de intención completamente independiente del inbound.

### Límite del objetivo actual

El catálogo de objetivos incluye `CREATE_QUOTE` y
`WAIT_FOR_QUOTE_APPROVAL`, pero no un objetivo explícito `ISSUE_QUOTE`
(`objectiveTypes.ts:1-27`). La maquinaria es un durable execution case
parcial, no todavía la autoridad completa del quote lifecycle.

## C. Rol actual de SalesAgentRuntime

### Lo que es canonical R3

`runSalesAgentRuntimeCycle.ts:340-460` hace, en orden:

* traduce el evento de turno a `CUSTOMER_MESSAGE`;
* toma opportunity/case del snapshot exterior;
* compila un resumen mínimo y pasa catálogo reciente/pending action;
* llama una vez a `runSalesAgentRuntime`;
* adapta el resultado a un terminal outcome;
* despacha por `dispatchSalesAgentTerminalOutcome`;
* registra `ASSISTANT_MESSAGE_SENT`, compaction y el evento de loop.

`salesAgentRuntime.ts:335-476` resuelve la sesión persistente, deriva
continuidad, construye `RunAgentToolLoopInput` y llama a
`runAgentToolLoop`. La ruta R3 recibe realmente:

* `commercialContextSummary` reducido;
* historical session messages cuando persistent cognition está activo;
* `conversationContinuity` derivada, no persistida como business state;
* `recentCatalogContext` y `pendingCatalogAction`;
* `trustedCustomerSession` e identity configuration;
* `priorSteps` internos del turno;
* flags de live assimilation/open turn/harness-aligned;
* provider, budgets y timeout.

El prompt se arma en `buildAgentStepPromptPackage.ts:60-150` y sus dos ramas
de persistent/legacy están en `:838-919`. Las mutaciones pasan por
`executeCommercialActionRequest` y las lecturas por `executeReadTool`; ambos
terminan en `executeGovernedCapability` (`executeCommercialActionRequest.ts:87-137`,
`executeReadTool.ts:83-136`).

### Lo que falta en R3

R3 **no recibe un canonical active commercial objective**.

Prueba concreta:

* `RunSalesAgentRuntimeCycleInput` no tiene `workPublicId`, `workVersion`,
  `objective`, `blockers` ni `CommercialWork`;
* `runSalesAgentRuntime` construye un input que contiene summary, catálogo,
  sesión, continuidad y pasos del turno, pero no objetivos durables
  (`salesAgentRuntime.ts:413-442`);
* `buildMinimalCommercialContextSummary` sólo proyecta opportunity status/
  stage, need profile, destination, line items y últimos mensajes
  (`runSalesAgentRuntimeCycle.ts:167-200`);
* `RunAgentToolLoopInput` tampoco contiene objetivo durable ni work version
  (`runAgentToolLoop.ts:143-236`);
* el prompt compiler recibe `commercialContextSummary`, herramientas,
  `priorSteps`, historial y continuity; no recibe `crm_commercial_work_*`
  (`buildAgentStepPromptPackage.ts:60-113`).

Su sustituto es la reconstrucción implícita por el LLM desde transcript,
session, current facts, catálogo y observations. Es apropiado para la
cognición conversacional, pero no es suficiente como autoridad de obligación
comercial.

### Fortalezas y debilidades

Fortalezas R3:

* decisiones conversacionales flexibles y multi-turn;
* sesión persistente con historial real y compaction;
* live assimilation y freshness check antes de outbox;
* loop iterativo con observaciones y budgets;
* provider-neutral boundary y dispatch R3-native.

Debilidades R3:

* no tiene owner explícito de objetivo durable;
* una respuesta puede terminar sin representar trabajo pendiente;
* provider/tool crash no deja un step durable que recuperar;
* `SalesTurnDisposition` describe el turno después de ocurrido, pero no
  conduce el siguiente objetivo;
* `ensureOpportunity` se ejecuta perezosamente sólo desde la rama de
  `COMMERCIAL_ACTION` (`salesAgentRuntime.ts:352-371`), a diferencia de la
  expectativa de un caso ya anclado.

## D. Matriz de responsabilidades

La clasificación se refiere al estado final deseado, no a qué rama tiene más
código hoy.

| Responsibility | CommercialWork | SalesAgentRuntime | Shared | Correct Owner | Classification |
|---|---|---|---|---|---|
| Case identity | Aggregate anclado a conversation/opportunity | Sólo recibe ids | Conversation/identity adapter | CommercialWork case kernel | KEEP_COMMERCIALWORK |
| Opportunity | FK y proyección del caso | Lazy ensure on mutation | Opportunity domain | Opportunity domain + case kernel | SHARED_PRIMITIVE |
| Commercial objective | Durable objective/status/supersession | No lo recibe | Ninguna hoy | CommercialWork projection | KEEP_COMMERCIALWORK |
| Subgoal / executable intent | Durable step/dependency | Decisión dinámica del siguiente tool | Capability name | R3 propone; CW materializa lo durable | MERGE |
| Blockers | Objective/step blockers | Sólo terminal/fallback reason | Identity/governance denials | CommercialWork projection | KEEP_COMMERCIALWORK |
| Waiting state | `WAITING_CUSTOMER`/`WAITING_SYSTEM` durable | Terminal runtime status | Provider/domain outcomes | CommercialWork projection | KEEP_COMMERCIALWORK |
| Next action | Derivable desde READY steps/objectives | Model elige next step | `nextBestAction` legacy/disposition | Durable projection + R3 suggestion | MERGE |
| Durable cart | Rehidrata y referencia fact | Lee summary y tools | `crm_request_facts` domain | Commercial line-items domain | SHARED_PRIMITIVE |
| Destination | Rehidrata fact y dependencies | Lee summary y tool | Shipping domain | Shipping destination domain | SHARED_PRIMITIVE |
| Shipping | Projection de freshness y step | Capability tool call/observation | Carrier capability | Capability/domain fact | SHARED_PRIMITIVE |
| Quote | `CREATE_QUOTE` projection | `create_quote`/`issue_quote` tools | Quote Service | Quote capability/domain | SHARED_PRIMITIVE |
| Customer identity | Projection gate del objective | Trusted session + identity gate | Native session/Gateway | Native identity boundary | SHARED_PRIMITIVE |
| Transcript | Sólo source message id | Consume current/history | `conversation_message` | Conversation inbound service | SHARED_PRIMITIVE |
| Persistent session | No | Session events/history | AgentSessionStore | SalesAgentRuntime | KEEP_R3 |
| Compaction | No | Post-dispatch session maintenance | AgentSessionStore | SalesAgentRuntime | KEEP_R3 |
| Conversation continuity | No durable cognitive memory | Derives from session/legacy summary | Catalog/pending projections | SalesAgentRuntime, constrained by case | KEEP_R3 |
| Live turn assimilation | No | Reconciles newer fragments and invalidates candidate response | Turn settlement | R3 settlement/cognition boundary | KEEP_R3 |
| Turn settlement | No inbound debounce ownership | Receives settled turn | `crm_inbound_turn_settlements` | R3 ingress | KEEP_R3 |
| Provider/model | Uses provider only for semantic planner | Owns provider call/budget/retry | `AgentLoopProvider` | SalesAgentRuntime | KEEP_R3 |
| Prompt/context assembly | Planner summary only | `buildAgentStepPromptPackage` | Native snapshot | R3 context compiler | KEEP_R3 |
| Tool loop | No | `runAgentToolLoop` | Tool pool/exposure | SalesAgentRuntime | KEEP_R3 |
| Capability execution | Executor calls Gateway | Read/action requests call Gateway | Single Gateway/registry | Capability Gateway | SHARED_PRIMITIVE |
| Idempotency | Work/step keys and CAS | Tool/capability/outbox keys | Domain and DB unique keys | Each durable boundary | SHARED_PRIMITIVE |
| Concurrency | Work version and commercial sequence | Turn settlement/live freshness | Domain CAS | Three explicit layers | MERGE |
| Versioning | Case aggregate `version` | Session/settlement event ordering | Domain fact/Quote Service versions | Case + domain boundaries | MERGE |
| Retry | Step policy and worker retry | Provider retry and loop budget | Gateway bounded retry | Boundary-specific policies | MERGE |
| Crash recovery | Step leases, stale reclaim, async delivery | Settlement reclaim; session replay | Outbox worker | Durable workers | MERGE |
| Handoff | Objective/status can become `HANDOFF` | Typed terminal handoff + ownership transfer | Conversation control/outbox | Conversation control + case projection | MERGE |
| Follow-up scheduling | Objective-aware policy and waiting state | No authoritative scheduler | Action/outbox workers | Follow-up subsystem keyed to case | MERGE |
| Outbox | Current R2 response reaches canonical writer through legacy bridge | R3-native dispatch reaches canonical writer directly | `brain_message_outbox` | Canonical Outbox | SHARED_PRIMITIVE |
| Observability | CommercialWork completion/event metrics | Loop/session/terminal events | Correlation ids and Gateway audit | Unified event/read model | MERGE |
| R2 semantic planner | Owns current planning branch | Duplicates cognition | None | No permanent owner | DELETE_LEGACY |
| Legacy shadow/operational loop | Historical compatibility | Not R3 | None | No permanent owner | DELETE_LEGACY |

## E. Explicación del incidente de producción

### Dónde se crea `commercialObjective`

`SalesTurnDisposition` tiene un campo llamado `commercialObjective`, pero ese
campo no es el objetivo durable de CommercialWork. Se calcula en
`ensureAutonomousSalesTurnContinuity.ts` después de que la rama ya terminó:

* Agent Tool Loop: `:234-236` usa `terminalReason` y si hubo un tool
  autorizado.
* SalesAgentRuntime: `:318-320` usa `runtime.status` y los contadores
  `readToolCalls`/`commercialActionCalls`.
* Legacy: `:373-392` usa `selectedNextAction.type` del operational loop.

El resultado se persiste como disposición terminal mediante
`persistDisposition` (`ensureAutonomousSalesTurnContinuity.ts:73-116`). Es
durable como auditoría del turno, pero es descriptivo/ephemeral respecto del
plan comercial: no es leído por `SalesAgentRuntime` para conducir el siguiente
step y no contiene el grafo de objetivos, sus dependencias o sus facts.

### Duplicación semántica observada

| Concepto | Autoridad actual | Problema |
|---|---|---|
| Opportunity stage/need profile | `crm_opportunities` / profile | Estado comercial reducido; no obligación pendiente completa |
| CommercialWork objective | `crm_commercial_work_objectives` | Durable y correcto, pero sólo visible en la ruta R2 |
| Turn disposition objective | `commercial_event` vía `SalesTurnDisposition` | Etiqueta post-hoc de baja cardinalidad |
| Planner intent | Resultado de `semanticIntentAdapter` | Input de R2, no autoridad del caso |
| `nextBestAction` | Legacy loop/disposition/seguimiento | Read model/decisión de turno, no el objetivo durable |
| Session continuity | `agent_session_events` + historial | Memoria conversacional, nunca business truth |

La única autoridad futura debe ser el objetivo activo proyectado por
CommercialWork. `SalesTurnDisposition` queda como resumen de observabilidad;
planner intent queda como propuesta de entrada; `nextBestAction` queda como
proyección; la sesión no almacena verdad comercial.

### Por qué 470 y 472 terminaron en `discover_need`

La evidencia productiva indica que SalesAgentRuntime estaba activo y que esos
turnos hicieron cero tool calls. La regla local exacta es:

```ts
runtime.status === "handoff" ? "handoff"
  : toolUsed ? "recommend"
  : runtime.status === "responded" ? "discover_need"
  : "none"
```

Está en `ensureAutonomousSalesTurnContinuity.ts:318-320`. Por tanto, aunque
el texto diga “cotización”, el label se vuelve `discover_need` si R3 genera
una respuesta sin invocar una herramienta. No hay un `CREATE_QUOTE` durable
que el runtime pueda consultar, porque el input R3 no contiene
`crm_commercial_work_objectives` ni un `workPublicId`.

La explicación causal es, entonces:

```text
quote request -> R3 reconstructs from text/session/current summary
             -> no durable objective input
             -> no tool call
             -> terminal response
             -> disposition fallback label = discover_need
```

No es evidencia de que la proyección R2 haya perdido un `CREATE_QUOTE`; es
evidencia de que la rama R3 no ejecutó ni leyó esa proyección.

### Por qué 474 terminó en `handoff` / `ambiguous_handoff_reason`

La evidencia productiva indica `terminalReason=handoff`. R3 convierte un
handoff del modelo en `runtime.status = "handoff"`; la continuidad lo
clasifica directamente como `commercialObjective="handoff"`, antes de saber
si la razón es elegible. El dispatcher sólo considera válidos los códigos
estructurados `customer_requested_human` y `policy_requires_human`
(`dispatchSalesAgentHardHandoff.ts:41-66`). Un texto libre de incertidumbre
del modelo cae en `ambiguous_handoff_reason` y se transforma en fallback, no
en una transferencia válida.

Un objetivo durable `CREATE_QUOTE` con blocker de selección, identidad o
servicio habría dado un estado comercial explicable —`WAITING_CUSTOMER`,
`WAITING_SYSTEM` o `BLOCKED`—, pero no estaba conectado a esta rama. Por eso
CommercialWork no pudo impedir el handoff ambiguo.

### Cross-check operativo

| Dato productivo suministrado | Lectura arquitectónica |
|---|---|
| Conversation 83 en SalesAgentRuntime | Confirma que la rama analizada fue R3, no CommercialWork |
| persistent session, historyMessageCount=19 | Confirma memoria cognitiva; no demuestra objetivo durable |
| Open Turn, harness-aligned, live assimilation, compaction | Features R3 activas; ninguna crea un CommercialWork objective |
| Turn Settlement=5000 | Serializa/agrega el inbound; no clasifica intención |
| 468/470/472: 0 tools → discover_need | Coincide exactamente con `:318-320` |
| 474: 0 tools → handoff | Coincide con el branch de handoff; `ambiguous_handoff_reason` viene del contrato de eligibility |

## F. Decisión arquitectónica

### Elegida: A, con integración selectiva

Se elige A porque es la única alternativa que conserva cada invariant en el
lugar donde ya existe:

* CommercialWork ya representa trabajo pendiente, status, blockers, facts
  resueltos, version y recovery.
* R3 ya representa conversación persistente, razonamiento iterativo,
  provider/harness, assimilation y terminal dispatch.
* El Gateway ya es shared y no requiere que uno de los runtimes sea el dueño
  de la ejecución.
* Extraer tablas de CommercialWork hacia R3 sería un renombrado o segundo
  aggregate, no una simplificación: habría que reconstruir repository,
  projection, transitions, workers, retries y CAS.

### Por qué no B

B conserva la flexibilidad de R3 pero obliga a mover a
`SalesAgentRuntime` toda la semántica durable de CommercialWork. Eso
duplicaría o renombraría `crm_commercial_work`, sus child tables y los
workers, y dejaría ambiguo quién proyecta hechos, supersede objetivos y
recupera un step. No hay evidencia de que el runtime R3 actual tenga un
reemplazo para esas garantías.

### Por qué no C

C elimina el owner principal justamente donde la auditoría encontró la
frontera correcta. Un runtime nuevo tendría dos planners, dos estados y una
tercera migración conceptual. La necesidad es integrar owners existentes,
no inventar otro aggregate.

### Por qué no D

No hace falta otra alternativa: el defecto observado se explica por una
frontera ausente —R3 no consume el objetivo durable— y la solución puede
cerrarse con A sin introducir arquitectura fuera de las candidatas.

### Forma correcta de A

El flujo objetivo es:

1. Settlement crea el turno cognitivo, no una intención.
2. El case kernel reconcilia el inbound y proyecta el objetivo durable.
3. R3 recibe una entrada estructurada con case state, objetivo, facts,
   evidencia y policy.
4. R3 razona y propone una acción o respuesta; no muta business truth por su
   cuenta.
5. Gateway ejecuta la capability y audita.
6. La proyección rehidrata facts y actualiza objective/step/blockers.
7. R3 continúa sólo si existe una siguiente decisión cognitiva necesaria; si
   no, se responde según estado durable.

El planner R2 no debe correr antes de R3 y luego otro planner R3 después. La
propuesta cognitiva y la proyección durable deben ser una sola coordinación,
con un único ciclo de razonamiento por turno.

## G. Modelo canónico de ownership

### Case

`crm_commercial_work` es el durable case runtime. Su identidad técnica usa
conversation + opportunity cuando existe; no inventa `customer_master`. La
identidad de cliente continúa siendo provisional, con `wa_id` como referencia
principal y los identificadores observados como complemento.

### Objective

Un objective durable activo en CommercialWork es la autoridad de la
obligación comercial. Debe sobrevivir mensajes laterales, restart y fallas de
provider. Su status se deriva de facts, evidencia y política, nunca de una
frase del prompt.

### Facts

Cart, destination, shipping option, created quote e issued quote pertenecen
a sus dominios/capabilities. CommercialWork referencia facts y proyecta
readiness; no duplica precios, peso, carrier o documentos como memoria de
sesión.

### Session

AgentSessionStore conserva transcript cognitivo, eventos de sesión,
compaction y continuidad. No es dueño de cart, quote, blockers ni objective.

### Reasoning

SalesAgentRuntime/`runAgentToolLoop` conserva el loop iterativo, provider,
prompt compiler, tool exposure, observations y terminal response. Su entrada
futura mínima debe ser conceptualmente:

```ts
AgentTurnInput {
  caseState;             // CommercialWork projection
  objective;             // active durable objective
  currentTurn;           // settled inbound turn
  conversationContext;   // session/continuity
  relevantEvidence;      // facts, catalog evidence, capability evidence
  capabilities;          // Gateway exposure and policy
  executionPolicy;       // identity, ownership, side-effect policy
}
```

Mapeo actual: `caseState/objective` no existen en R3; `currentTurn` viene de
settlement/event; `conversationContext` viene de AgentSessionStore y
`conversationContinuity`; `relevantEvidence` está repartida entre snapshot,
catalog context y Gateway; `capabilities` viene de registry/tool pool;
`executionPolicy` viene de ownership, identity gate y Gateway.

### Capabilities

`executeGovernedCapability` es la única frontera final: rechaza no
registradas, aplica identity gate, availability, retry bounded y persiste
`crm_capability_executions` (`executeCapability.ts:18-198`). La futura
integración debe mantener esta frontera y no mover invariants al prompt.

### Outbox

`brain_message_outbox` es el único transporte canónico y
`writeCanonicalOutboxMessage` la única función que calcula su dedupe key
(`canonicalOutboxWriter.ts:85-105`, `:241-344`). R3 ya llega directamente a
esa frontera con ownership/freshness recheck en la misma transacción
(`dispatchGovernedSalesAgentMessage.ts:122-267`). CommercialWork todavía
atraviesa `persistAgentAction`/sandbox/execution-gate en
`dispatchCommercialWorkResponse.ts:125-265`; esa diferencia debe converger,
no convertirse en un segundo outbox.

## H. Keep / merge / delete

| Componente | Decisión | Justificación |
|---|---|---|
| `crm_commercial_work` | KEEP | Caso durable, versionado y consultable |
| `crm_commercial_work_objectives` | KEEP | Única autoridad durable de objetivos existente |
| `buildCommercialWorkProjection` | KEEP | Reducer/proyección pura y rehidratable |
| `reconcileCommercialObjectives` | KEEP | Retención y supersession multi-turn |
| `commercialWorkExecutor` | KEEP, con adaptación | Ejecución cerrada, stale checks, CAS y re-proyección |
| `commercialWorkWorker` / async delivery | KEEP | Leases, retries, crash recovery y entrega tardía |
| `crm_commercial_work_steps` | SIMPLIFY | Conservar steps para ejecución durable; no preplanificar toda la conversación |
| `semanticIntentAdapter` | DELETE_LEGACY del camino canónico | R2 planner fijo duplica la cognición R3 |
| `dispatchCommercialWorkResponse` | MERGE | Conservar finalizer grounded en aggregate; unificar salida con dispatch/outbox R3 |
| `runSalesAgentRuntime` | KEEP_R3 | Owner de cognition/harness |
| `runAgentToolLoop` | KEEP_R3 | Loop iterativo, evidence guards y observations |
| `buildAgentStepPromptPackage` | KEEP_R3, extender contrato | Debe recibir case/objective estructurados |
| AgentSessionStore / compaction | KEEP_R3 | Memoria conversacional, no business truth |
| turn settlement / live assimilation | KEEP_R3 | Serializa y supersede turnos cognitivos |
| `executeReadTool` / `executeCommercialActionRequest` | MERGE | Request boundaries shared, con un Gateway final |
| Capability Gateway/registry/identity gate | SHARED_PRIMITIVE | Contrato único para ambos callers durante transición |
| `dispatchSalesAgentTerminalOutcome` | KEEP_R3, ampliar | Terminal owner futuro; debe poder consumir estado durable |
| `dispatchAgentLoopResponse` | DELETE_LEGACY | Dispatcher ATL basado en action queue; R3 ya tiene native dispatch |
| `crm_agent_actions` para respuesta R3 | DELETE_LEGACY del camino canónico | No debe ser segunda autoridad de outbound; conservar sólo compatibilidad temporal |
| `crm_agent_actions` para follow-up | MERGE | Seguir como scheduler mientras follow-up siga en scope posterior |
| `runNativeAgentToolLoopCycle` branch | PRIMITIVES_TO_EXTRACT / CAN_REMOVE | Su loop/prompt/gateway ya vive en R3; retirar el routing duplicado después |
| MultiRequest branch | CAN_REMOVE | Variante planner/executor paralela, no runtime permanente |
| legacy shadow/operational-loop branch | CAN_REMOVE | Sólo rollback/diagnóstico durante transición |
| R3 allowlists | TEMPORARY_ROLLBACK | Safety rollout; no disponibilidad arquitectónica steady-state |

### Decisión especial sobre `crm_commercial_work_steps`

Un step durable no es business truth; es una materialización ejecutable de una
parte del objetivo. Es útil cuando hay una capability mutante, dependencia,
retry, lease, espera del sistema o recovery después de process death. No es
útil como plan rígido de toda la conversación: el LLM puede cambiar de plan
cuando el cliente corrige selección, destino u objetivo.

La clasificación es **SIMPLIFY**:

* conservar el step para trabajo que debe sobrevivir al turno;
* permitir que R3 proponga una nueva acción y que la proyección superseda o
  reproyecte el step anterior;
* no hacer que un step stale bloquee una instrucción nueva sin una relectura
  de facts + case version;
* no persistir cada decisión cognitiva como step durable;
* usar eventos de sesión para reasoning y steps para trabajo operativo
  recuperable.

`crm_commercial_work_steps` no debe reemplazarse completamente por eventos:
los eventos son auditables, pero un worker necesita una vista queryable de
READY/RUNNING/RETRY_SCHEDULED y una lease. Tampoco debe quedar como workflow
precalculado que el harness no pueda revisar.

## I. Secuencia de migración

Todas las fases siguientes son propuestas; ninguna se implementa en esta
auditoría.

### Fase 0 — contrato y observabilidad, reversible

Definir el contrato conceptual `AgentTurnInput` y un read model de case sin
cambiar routing. Añadir correlación entre inbound settlement, case version,
objective id, capability execution y outbox. Verificar que
`SalesTurnDisposition` quede explícitamente descriptivo.

### Fase 1 — R3 read-only con case adjunto

Construir el adapter que carga/proyecta CommercialWork y lo entrega a R3
como contexto estructurado. No permitir mutaciones nuevas. Mantener la
allowlist actual como rollback y comparar decisiones R3 con el objetivo
durable en eventos PII-free.

### Fase 2 — una sola propuesta cognitiva

Hacer que R3 produzca una propuesta tipada de acción/objetivo. La propuesta
entra a la proyección de CommercialWork; `semanticIntentAdapter` deja de ser
planner paralelo del camino seleccionado. La proyección sigue siendo
determinista y el Gateway sigue siendo el ejecutor cerrado.

### Fase 3 — ejecución durable selectiva

Materializar sólo los steps que necesiten side effect, dependencia, espera,
retry o recovery. Reutilizar CAS, stale evidence, worker leases y async
delivery. El reasoning intermedio permanece en sesión/eventos y no se
convierte en un grafo durable innecesario.

### Fase 4 — cerrar invariants de dominio

Antes de retirar rutas, corregir en capability/domain —no en prompt—:

* `select_products` es `FULL_REPLACEMENT` y hoy no recibe expected cart
  version (`commercial-line-items/service.ts:88-123`); patch/delta y CAS deben
  vivir en ese dominio si el producto los necesita;
* `create_quote` ya liga el resultado al `selectionFactId` y usa una clave
  de idempotencia por opportunity + selección
  (`createQuoteCapability.ts:32`, `:117-151`);
* `issue_quote` rehidrata el quote y usa `expectedVersion` del Quote Service,
  pero no valida la frescura de la selección/cart antes de emitir
  (`issueQuoteCapability.ts:45-86`); esa precondición debe ser una invariant
  de capability/domain/Quote Service, no de CommercialWork ni del prompt.

### Fase 5 — recovery y dispatch único

Probar crash después de provider, capability, mutación, case projection y
outbox. Mantener tres capas de concurrencia separadas:

1. turn serialization: `crm_inbound_turn_settlements` y live freshness;
2. case versioning: `crm_commercial_work.version`;
3. domain write CAS: request facts/Quote Service.

Unificar la salida terminal en la frontera R3 + canonical outbox, manteniendo
idempotencia y ownership recheck en la misma transacción.

### Fase 6 — retiro gradual

Con evidencia de correlación E2E hasta outbox:

* retirar CommercialWork como branch cognitiva independiente;
* retirar MultiRequest y el branch ATL como runtimes productivos;
* dejar legacy sólo como rollback temporal y después removerlo;
* retirar `dispatchAgentLoopResponse` y el bridge R2 de respuesta;
* conservar workers/primitives que alimentan el case kernel;
* eliminar allowlists de arquitectura una vez cerrado el rollout.

## J. Riesgos

* **Doble planner:** dejar R2 semantic planning delante de R3 produciría dos
  decisiones incompatibles para un turno. Mitigación: una propuesta R3 y una
  proyección determinista.
* **Step stale contra nueva instrucción:** un step durable puede ser más viejo
  que el mensaje que lo reemplaza. Mitigación: sequence + case CAS + fresh
  facts + supersession por objetivo; nunca resolverlo con texto de prompt.
* **Cart overwrite:** `FULL_REPLACEMENT` sin CAS permite que dos writers
  pierdan cambios. Mitigación: invariant en dominio antes de rollout general.
* **Quote stale:** `create_quote` protege su selección fact, pero `issue_quote`
  no cierra por sí solo la frescura del cart. Mitigación: capability/domain.
* **Oportunidad inexistente:** R2 hace fallback si no hay opportunity; R3 la
  crea sólo cuando intenta una acción comercial. Mitigación: case anchoring
  explícito, sin inventar Customer Master.
* **Recovery duplicado:** Gateway, step retry, provider retry y outbox retry
  tienen scopes distintos. Mitigación: correlation/idempotency por boundary y
  pruebas de crash por punto.
* **Audit gap del Gateway:** el execution record se inserta después del
  `execute()` (`executeCapability.ts:155-198`), por lo que un crash entre
  side effect y audit puede perder evidencia. Mitigación: transaction/outcome
  contract futuro; no ocultar el riesgo en el runtime.
* **Handoff ambiguo:** un free-text handoff sigue sin distinguir petición
  explícita de incapacidad del modelo. Mitigación: razón estructurada y case
  state; no transferir ownership por incertidumbre.
* **Dispatch dual:** R2 usa action queue y R3 usa native outbox. Mitigación:
  una única terminal/outbox boundary antes de retirar branches.
* **Allowlist como arquitectura:** los `BRAIN_*_WA_IDS` siguen siendo útiles
  para rollout/rollback, pero no deben determinar capacidades en steady state.
* **Identidad provisional:** no convertir `wa_id` en `customer_key` definitivo;
  la migración a Customer Master queda fuera de este ADR.
* **Evidencia productiva no repetida aquí:** el brief se acepta como ground
  truth para 83/468/470/472/474; este cambio no pretende reconsultar ni
  modificar producción.

## K. Preguntas abiertas

1. ¿Cuál será el contrato tipado exacto para que R3 proponga un objetivo sin
   permitirle escribir status o saltarse blockers?
2. ¿Qué cardinalidad de case se quiere: un active work por conversation,
   por opportunity o múltiples bundles compatibles? El esquema actual permite
   más de un work cuando cambia la fingerprint.
3. ¿Qué facts necesita `issue_quote` para demostrar selección fresca y en qué
   transacción se valida contra Quote Service?
4. ¿Cómo se asociará el outbound `conversation_message` con el settlement y
   objective final, dado que el dispatch R3 actual escribe outbox y el row
   outbound aparece después en el worker?
5. ¿Qué steps merecen recovery independiente y cuáles deben ser sólo
   `CommercialObjective` + event evidence?
6. ¿Qué follow-up semantics sobrevivirán cuando follow-ups entren en scope,
   evitando synthetic inbound messages y evitando que un follow-up se confunda
   con un mensaje del cliente?
7. ¿Qué métricas demostrarán igualdad entre números reales de WhatsApp sin
   usar el número como selector de arquitectura?
8. ¿Qué ventana de compatibilidad se necesita para retirar `crm_agent_actions`
   del outbound R3 sin afectar follow-up histórico?

## Clasificación de routing y dependencia de `wa_id`

Uso legítimo de `wa_id`:

* resolver la conversación y la identidad externa;
* aplicar el access/opt-out gate del cliente;
* dirigir el envío Meta al destinatario correcto;
* correlacionar evidencia del canal.

Uso transitorio, no final:

* `BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS` y
  `BRAIN_SALES_AGENT_RUNTIME_WA_IDS` para rollout/rollback fail-closed;
* `BRAIN_AUTONOMOUS_TEST_WA_IDS` para sandbox/pilot.

La selección actual prueba que la arquitectura depende del número:
`shouldRouteToCommercialWork` exige flag + allowlist no vacío
(`commercialCycleConfig.ts:202-227`) y R3 hace lo mismo
(`commercialCycleConfig.ts:252-279`). Eso es aceptable sólo como seguridad de
despliegue. En steady state, cualquier cliente elegible debe entrar al mismo
case kernel + R3 harness; no se debe generar una arquitectura distinta por
`wa_id`.

## Flujo canónico único propuesto

Cada nodo queda etiquetado por su estado de implementación en la fecha de
este ADR:

```text
WhatsApp Adapter [EXISTING AS-IS]
  -> Normalized / Settled Turn [EXISTING AS-IS]
  -> CommercialWork Durable Case + Objective Projection [EXISTING NEEDS CHANGE]
  -> R3 Cognition Harness with CaseState + ActiveObjective [EXISTING NEEDS CHANGE]
  -> Governed Capability Gateway [EXISTING AS-IS]
  -> Durable Domain Mutation / Fact Write [EXISTING AS-IS]
  -> CommercialWork Reprojection + Recovery State [EXISTING NEEDS CHANGE]
  -> R3 Response / Typed Handoff Decision [EXISTING NEEDS CHANGE]
  -> Canonical Outbox [EXISTING AS-IS]
```
