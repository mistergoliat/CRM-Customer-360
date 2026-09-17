# P7.0 — Comparative Harness & Capability Runtime Audit

Auditoria comparativa previa a P7. No implementa codigo, no modifica contratos, no hace commit. Repo: `CRM-Customer-360`, branch `develop`, HEAD `34bc4d0` (mismo commit que actualizo `docs/R3_COMMERCIAL_AGENT_HANDOFF.md` con P6.3 CLOSED). Working tree limpio salvo `scripts/diagnostics/` (untracked, fuera de scope, no tocado).

Metodo: dos investigaciones independientes delegadas y verificadas contra fuentes primarias — (1) inventario exhaustivo del codigo real de R3 con cita `file:line`, (2) investigacion de patrones externos contra documentacion oficial con URL. El repo es autoridad sobre R3; la documentacion oficial es autoridad sobre los frameworks externos. Ninguna afirmacion sobre un framework externo viene de memoria sin verificar.

---

## A. Executive finding

**PARTIAL.**

R3 ya esta estructuralmente alineado con los harness modernos en las piezas que importan mas: existe un contrato de tool call minimo y estable (`AgentStepUseTool`), un validador de forma separado de la autorizacion, un registry unico de capabilities con metadata rica (schema, governance, evidence, `useWhen`/`doNotUseWhen`), un chokepoint unico de ejecucion gobernada (`executeGovernedCapability`) con identity gate + availability + retry acotado + auditoria, y un resultado de tool normalizado en una union cerrada (`ToolObservation.status`), no strings libres. Estas piezas ya cumplen el rol que OpenAI Agents SDK, Semantic Kernel y MCP resuelven con `FunctionTool`/`Plugin`/`tools/call`.

Lo que falta no es autoridad de ejecucion — Gateway ya revalida verdad viva en cada llamada y nunca confia en P6 — sino **coherencia observable entre lo que el modelo vio (eligibility pre-cognicion) y lo que efectivamente paso en Gateway**, y el **contexto de trabajo durable** (`workId`/`objectiveId`) no llega hoy a `CapabilityGatewayContext`, solo `opportunityId`. Ese es el gap real, y es de alcance pequeno: telemetria/correlacion, no una nueva capa de autoridad.

---

## B. Market pattern summary

Investigacion completa (con URLs) delegada a un subagente de investigacion externa; resumen aqui, tabla comparativa completa en la seccion Q.

- **OpenAI Agents SDK** (`openai.github.io/openai-agents-python`): separa explicitamente argumentos visibles al modelo de contexto runtime confiable via `RunContextWrapper[T]`/`ToolContext`, documentado literalmente como "not sent to the LLM". Tiene aprobacion humana como primitiva (`needs_approval`, pausa/resume como estado durable, no como turno nuevo), guardrails de tool a nivel input/output separados de guardrails de agente, tracing con `function_span()` por cada tool call, y un switch explicito desarrollador-controlado entre "error visible al modelo" vs "excepcion que nunca llega al modelo" (`failure_error_function`).
- **Semantic Kernel**: el Kernel es literalmente un contenedor DI; plugins reciben dependencias por constructor o parametros tipados especiales invisibles al LLM. No se encontro metadata declarativa de side-effect/riesgo en la funcion misma — el enforcement de permisos se hace con filtros/interceptores alrededor del loop de invocacion automatica, no como campo estatico.
- **MCP**: protocolo de transporte/interoperabilidad puro. `tools/list`/`tools/call`, schema JSON, `ToolAnnotations` (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`) explicitamente **auto-reportadas y no confiables por defecto**. Aprobacion humana es una recomendacion SHOULD, no un mecanismo de protocolo. Governance/identidad quedan explicitamente fuera del protocolo, delegadas al server/client.
- **LangGraph** (patron ToolNode): el resultado de una tool vuelve al modelo como mensaje en el mismo estado compartido (`ToolMessage` anexado a `messages`), no via un canal de contexto separado. `InjectedState` marca que parametro de una tool viene del estado del grafo y no del modelo.
- **Google ADK**: `ToolContext` inyecta estado de sesion con escritura por deltas, mas un objeto `actions` (`skip_summarization`, `transfer_to_agent`, `escalate`) que deja que el runtime — no el modelo — decida el siguiente paso del loop.
- **PydanticAI**: `RunContext[DepsType]` es el analogo mas directo de todos los frameworks a "objeto de contexto confiable inyectado, nunca visible al modelo" — mas rigido incluso que OpenAI (debe ser el primer parametro posicional). Distingue `ModelRetry` (reintento presupuestado) de `ToolFailed` (fallo terminal no presupuestado).
- **Vercel AI SDK**: mas ligero; el segundo parametro de `execute` da tracking de llamada/historial/cancelacion, no un contenedor DI generico.

Conclusion de mercado: la separacion "argumentos del modelo vs contexto confiable del runtime" es un patron universal y ya resuelto en R3 aunque sin nombre unico (ver seccion F). Lo que NINGUN framework externo resuelve por si solo es la politica de negocio: identidad, governance, idempotencia de dominio — todos la dejan al implementador. Eso es exactamente lo que ya vive en el Capability Gateway de R3.

---

## C. R3 inventory

Tabla completa (20 items) verificada contra codigo real, HEAD `34bc4d0`.

| # | Concern | Implementacion actual | Path | Authority | Reusable P7 |
|---|---|---|---|---|---|
| 1 | `AgentStep use_tool` | `AgentStepUseTool = {type:"use_tool", tool, arguments}` | `agent-loop/agentStepTypes.ts:14-18` | Agent Tool Loop contract | Estable, sin slot libre — cualquier campo nuevo de P7 exige una variante nueva o un campo agregado |
| 2 | Validador | `validateAgentStep(raw, allowedTypes)` — solo forma, explicitamente no valida contra registry (docstring propio) | `agent-loop/validateAgentStep.ts:92-155` | Capa de forma, separada de governance | Ya separa "malformado" de "rechazado por governance" — no fusionar en P7 |
| 3 | Tool schema al modelo | `CapabilityGatewayDefinition.inputSchema` es fuente unica; `renderToolLine()` solo lee | `capability-gateway/types.ts:141-153`; `agent-loop/buildAgentStepPromptPackage.ts:727-728` | Registry | Ya incluye `description`, `useWhen`, `doNotUseWhen`, `operationSemantics`, `evidenceProduced/Required` — sidecar semantico rico ya existe |
| 4 | Tool pool | `AGENT_LOOP_TOOL_POOL` (14, fijo) + `buildToolDescriptions()` | `agent-loop/runAgentToolLoop.ts:89-104, 254-266` | Backend, "nunca segundo registry" | Confirmado estatico; P6.3 no lo filtra (no-goal explicito). Un clasificador paralelo (`READ_TOOL`/`COMMERCIAL_ACTION`/`NOT_AGENT_EXPOSED`) enruta ejecucion, no expone/oculta pool |
| 5 | `runAgentToolLoop` | 1654 lineas, estado de turno completo (ver seccion N) | `agent-loop/runAgentToolLoop.ts` | — | Ver N |
| 6 | `processUseToolStep` | Lineas 581-826 del mismo archivo | `agent-loop/runAgentToolLoop.ts:581-826` | — | Ver E |
| 7 | `CommercialActionRequest` | Union de 6 tipos, solo mutacion | `commercial-action-request/types.ts:58-64` | R3-A03, frontera reasoning->mutacion | Ver G |
| 8 | Gateway registry/types | `CAPABILITY_GATEWAY_REGISTRY` (~20 defs) | `capability-gateway/registry.ts`, `types.ts` | Fuente unica de existencia/governance/schema | `governance = {sideEffect, authority, riskClass}` + `maxRetries`, `evidenceProduced/Required` (8 valores), `operationSemantics` (`FULL_REPLACEMENT`/`CREATE_SNAPSHOT`) |
| 9 | `executeGovernedCapability` | Orden real: resolve def (fail closed) -> identity gate -> `checkAvailability` -> `execute` con retry acotado -> `insertCapabilityExecution` en todo exit | `capability-gateway/executeCapability.ts:18-203` | Chokepoint unico | Ya equivale a guardrails+execution+audit en una funcion |
| 10 | Identity gate | `evaluateCapabilityIdentityGate` | `capability-gateway/identityGate.ts:43-101` | Frontera compartida | Niveles reales: `LEVEL_0_ANONYMOUS`..`LEVEL_3_PRESTASHOP_LINKED`; reads nunca gateados (`sideEffect!=="mutating"` -> `allowed:true`) |
| 11 | Read vs mutation trace | Ver seccion H | — | — | — |
| 12 | Retry/idempotencia | Retry acotado dentro de `executeGovernedCapability`; idempotencia real solo en `create_quote` (`sha256(create-quote:opportunityId:selectionFactId)`) | `capability-gateway/createQuoteCapability.ts:32-34, 122-136` | createQuoteCapability | Resto de mutating capabilities usa semantica "changed:false" en su propio dominio, no idempotency key |
| 13 | `ToolObservation` | `{tool, status, data?, errorCode?, reason?, retryable?, providerErrorCode?, warnings?}`; `status` es union cerrada `["completed","failed","blocked","skipped"]` | `agent-loop/agentStepTypes.ts:93-126`; builder `buildToolObservation.ts` | Runtime-owned bounded projection | Ya normalizado — no hace falta un `CapabilityExecutionResult` nuevo antes de `ToolObservation` |
| 14 | Error taxonomy | `CAPABILITY_AVAILABILITY_STATUSES` (5) y `CAPABILITY_GATEWAY_EXECUTION_STATUSES` (7) tipados; `errorCode` por capability es string por convencion, sin enum cruzado | `capability-gateway/types.ts:8-26` | — | Los nombres del prompt (`INVALID_ARGUMENTS`, `POLICY_REJECTED`, etc.) no existen verbatim; ver seccion L para mapeo real |
| 15 | Correlation IDs | `correlationId` obligatorio en `CapabilityGatewayContext`; tabla de auditoria `crm_capability_executions` NO guarda `inboundMessageId`, solo `correlationId/requestId/decisionId/actionId` | `capability-gateway/types.ts:111-130`; `capability-gateway/repository.ts:11` | — | Gap real de trazabilidad fina si `correlationId` no es 1:1 estricto por turno |
| 16 | `CommercialWork` context en ejecucion | **Cero referencias** a `workId`/`objectiveId`/`CommercialWork` en `CapabilityGatewayContext` o en la construccion del contexto en `runAgentToolLoop.ts:886-891` (solo `correlationId, conversationId, opportunityId, trustedCustomerSession`) | grep confirmado vacio | — | **Gap estructural central para P7** — ver F |
| 17 | `cognitionContext` | `SalesAgentRuntimeResult.cognitionContext = {domainReadModel, preCognitionCapabilityEligibility}`, in-memory, nunca cruza Gateway | `sales-agent-runtime/salesAgentRuntime.ts:194-197, 704-709` | Un solo consumo: `runSalesAgentRuntimeCycle.ts:666` para reusar DRM en shadow post-P5 | Confirma exactamente lo que dice el handoff seccion 13 |
| 18 | `AgentSession` | Memoria conversacional append-only; eventos `READ_TOOL_*`/`COMMERCIAL_ACTION_*` ya loguean outcomes de tool calls como memoria conversacional, separado del audit trail de Gateway | `agent-session/types.ts:51-58` | Nunca verdad comercial | — |
| 19 | P6 eligibility wiring | Confirmado **shadow-only**; **cero referencias** a `capability-eligibility` dentro de `capability-gateway/*.ts` | `capability-eligibility/*` | Descriptivo | Statuses `ELIGIBLE`/`BLOCKED`; 9 reason codes reales (`OBJECTIVE_REQUIRED`, `MISSING_SELECTION`, `IDENTITY_LEVEL_INSUFFICIENT`, `MISSING_DESTINATION`, etc.) |
| 20 | Event telemetry | No existe evento por-tool-call en `CommercialEventV1`; solo `agent_tool_loop_completed` (resumen acotado, sin args/observation) y el evento especifico de eligibility | `events/types.ts` (762 lineas) | `lib/brain/commercial/events/` | El detalle por-llamada vive solo en `crm_capability_executions` (DB), mecanismo distinto al de eventos — gap real si P7 quiere tracing por request |

---

## D. Tool definition map

| Metadata | Fuente hoy | Single source of truth? | Drift risk |
|---|---|---|---|
| Nombre canonico | Gateway registry | Si | Bajo — `AGENT_LOOP_TOOL_POOL` y registry deben coincidir, verificado en boot |
| Nombre visible al modelo | Mismo nombre canonico (sin alias en R3; `toolAliases.ts` es legacy R2, no usado por `runAgentToolLoop`) | Si | Nulo hoy; existe deuda historica documentada (`toolAliases.ts`) pero inerte |
| Description/useWhen/doNotUseWhen | Gateway registry (`types.ts:154-189`) | Si | Bajo |
| Argument schema | Gateway registry `inputSchema` | Si | Bajo |
| Output/result shape | `ToolObservation` builder por-tool (`buildToolObservation.ts`) | Si, pero en archivo separado del registry | Medio — el shape de salida vive en un archivo distinto al de entrada; cambiar uno sin el otro es posible sin error de compilacion si el tipo es demasiado laxo |
| read_only/mutating | Gateway registry `governance.sideEffect` | Si | Bajo |
| Autonomy/authority | Gateway registry `governance.authority` | Si | Bajo |
| Risk | Gateway registry `governance.riskClass` | Si | Bajo |
| Identity requirement | Tabla separada (`identity/commercial-identity-requirement/operations.ts`), no en el registro de capability | **No** — segunda fuente, cruzada por nombre de operacion | Medio, pero **intencional** por principio arquitectonico ("no duplicar identity policy") — mantiene identidad fuera del registry de ejecucion a proposito |
| Objective compatibility / fact prerequisites | `capability-eligibility/definitions.ts` (sidecar P6), lee `executionClass` **en vivo** desde el registry, nunca lo copia | **No** — tercera fuente, pero deliberadamente delgada y sin duplicar `executionClass` | Bajo — el propio codigo evita duplicar justamente el campo mas peligroso de duplicar |
| Freshness requirements | DRM (`domain-read-model/freshness.ts`) | Si, separado del registry por diseno (DRM es dominio de lectura, no de capability) | Bajo |
| Availability | `checkAvailability` por capability, dentro del registry | Si | Bajo |
| Idempotencia | Solo `create_quote` la declara explicitamente (dentro de su propio `execute`) | No aplica a las demas — implicito via "changed:false" | Medio — sin convencion cruzada, cada capability decide su propia nocion de "no-op" |
| Execute implementation | Por capability, en el registry | Si | Bajo |

**Veredicto: (A) separacion intencional saludable, no (B) fragmentacion que exige una canonical capability definition.** La evidencia concreta: `capability-eligibility/definitions.ts` lee `executionClass` en vivo del registry en vez de copiarlo (linea 47), y el principio arquitectonico invariante #9 del handoff prohibe explicitamente duplicar identity/governance/registry. La fragmentacion que existe (identity en tabla propia, eligibility en sidecar propio) es la aplicacion consistente de ese principio, no una desviacion accidental. Ver seccion P para la recomendacion completa sobre `defineCommercialCapability`.

---

## E. Request path

Trazado real, `AgentStep` -> Gateway:

```
model output (raw string/JSON)
  -> validateAgentStep()                      [forma, agentStepTypes.ts / validateAgentStep.ts]
  -> AgentStepUseTool {tool, arguments}        [contrato minimo, sin trusted context]
  -> runAgentToolLoop gathering loop           [step/loop budget check]
  -> processUseToolStep()                      [runAgentToolLoop.ts:581-826]
       1. enrichToolArguments()                [rellena campos omitidos desde contexto durable, ej. budgetMax]
       2. registry/pool check                  [blocked_unregistered si falla]
       3. dedupe check (executedCalls)          [blocked_duplicate]
       4. evidence gates por-tool               [ej. sourceProduct de recommend_catalog_products]
       5. resolveAgentCapabilityExposure(tool)  [READ_TOOL / COMMERCIAL_ACTION / NOT_AGENT_EXPOSED]
       6a. READ_TOOL      -> ReadToolRequest         -> executeReadTool()
       6b. COMMERCIAL_ACTION -> ensureOpportunity (lazy, 1x/turn) -> CommercialActionRequest -> executeCommercialActionRequest()
  -> executeGovernedCapability()               [chokepoint unico — identity, availability, execute+retry, audit]
  -> CapabilityGatewayResult
  -> buildToolObservation()
  -> ToolObservation {status: completed|failed|blocked|skipped, ...}
```

Respuestas explicitas a las preguntas del brief:

- **Existe ya un request envelope.** Dos, deliberadamente separados: `ReadToolRequest` (read-only) y `CommercialActionRequest` (mutation-only, 6 tipos). Ambos convergen en el unico chokepoint `executeGovernedCapability`.
- **`CommercialActionRequest` ya cumple esa funcion — pero solo para mutaciones.** Los reads usan un contrato hermano y estructuralmente distinto (`ReadToolRequest`). No es una limitacion accidental: `executeReadTool` re-verifica `governance.sideEffect==="read_only"` en vivo, y `executeCommercialActionRequest` re-corre el identity gate como defensa en profundidad antes de llegar al Gateway. Es duplicacion intencional, no drift.
- **Trusted context agregado despues de la salida del modelo**: `correlationId`, `conversationId`, `opportunityId` (resuelto/creado de forma perezosa si falta), `trustedCustomerSession`. **No se agrega**: `workId`, `objectiveId`, `version` de `CommercialWork`, ni el snapshot de eligibility pre-cognicion.
- **Contexto peligrosamente suministrado por el modelo**: ninguno detectado — `arguments` del modelo pasa por `enrichToolArguments`/schema validation y el registro decide `checkAvailability`/`execute` con sus propios reads de dominio; el modelo nunca inyecta identity, correlationId, ni ningun campo de gobierno.
- **Campos que se duplican**: la re-verificacion de identity gate (una vez dentro de `executeCommercialActionRequest`, otra vez dentro de `executeGovernedCapability`) es duplicacion deliberada, documentada como defensa en profundidad.
- **Que se pierde entre `use_tool` y Gateway**: el snapshot de eligibility pre-cognicion no viaja con la request — se calculo una vez para el prompt y nunca se adjunta al `CommercialActionRequest`/`ReadToolRequest` resultante, asi que no hay forma de correlacionar, en el resultado, "esto era ELIGIBLE o BLOCKED cuando el modelo lo pidio".

---

## F. Trusted runtime context

Clasificacion de cada item pedido:

| Item | Clasificacion | Evidencia |
|---|---|---|
| `inboundMessageId` | RUNTIME TRUSTED CONTEXT | Disponible en `runAgentToolLoop` input; no viaja hasta la tabla de auditoria del Gateway (solo `correlationId`) |
| `conversationId` | RUNTIME TRUSTED CONTEXT | En `CapabilityGatewayContext` hoy |
| `opportunityId` | RUNTIME TRUSTED CONTEXT | En `CapabilityGatewayContext` hoy, resuelto/creado perezosamente para mutating |
| `CommercialWork` ID/version | **NOT NEEDED hoy en Gateway** (ver seccion 16 de C) pero **NECESARIO para P7** si se quiere correlacionar ejecucion con work/objective | Cero referencias confirmadas por grep |
| Objective ID/type | Igual que arriba | — |
| Customer identity / trusted session | RUNTIME TRUSTED CONTEXT | `trustedCustomerSession` ya en `CapabilityGatewayContext` |
| `correlationId` | RUNTIME TRUSTED CONTEXT | Ya obligatorio |
| Source event | RUNTIME TRUSTED CONTEXT (parcial) | `sourceEventId=inboundMessageId` en eventos, no en Gateway context |
| Current domain facts | GATEWAY-DERIVED / DOMAIN-DERIVED | Cada capability lee su propio dominio en vivo dentro de `execute()` (ej. `getActiveShippingDestinationForOpportunity`), no se pasan como contexto de entrada |
| Pre-cognition eligibility | RUNTIME TRUSTED CONTEXT (computado, pero **hoy no adjunto** a la request) | `cognitionContext.preCognitionCapabilityEligibility`, in-memory, nunca cruza el Gateway |
| Tool execution history dentro del turno | RUNTIME TRUSTED CONTEXT (existe, ver N), no se pasa al Gateway hoy | `steps`, `executedCalls` en `runAgentToolLoop` |
| Idempotency context | GATEWAY-DERIVED (solo para `create_quote`) | `createQuoteCapability.ts` |

Confirmacion explicita de la separacion pedida por el brief:

- **LLM supplies**: intent de capability (`tool`) + argumentos declarados en `inputSchema`. Nada mas — confirmado, ningun campo de governance/identity es model-supplied.
- **Runtime supplies**: `correlationId`, `conversationId`, `opportunityId`, `trustedCustomerSession` — ya sucede hoy. **Falta**: `workId`/`objectiveId`/version y el eligibility snapshot ya calculado.
- **Gateway/domain supplies**: verdad de ejecucion autoritativa — identity gate, availability, lectura de dominio en vivo dentro de cada `execute()`. Esto ya existe y ya es correcto; Gateway nunca confia en el snapshot P6.

---

## G. `CommercialActionRequest` assessment

- **Proposito original**: frontera R3-A03 entre razonamiento del agente y mutacion comercial (`types.ts:3-7`).
- **Fields**: `actionType` (union de 6), `input`, mas contexto (`correlationId`, `causationId`, opportunity, `source`).
- **Producers**: `atlAdapter.ts` (Agent Tool Loop R3) y `workAdapter.ts` (ejecutor R2/CommercialWork legacy) — dos productores confirmados, `CommercialActionRequestSource = "agent_tool_loop" | "multi_intent" | "commercial_work" | "sales_agent_harness"` (4 sources conocidos).
- **Consumer**: `executeCommercialActionRequest.ts:87-149`.
- **Mutation-only o generico**: **mutation-only**, confirmado — 6 `actionType` fijos, todos de escritura. Los reads usan `ReadToolRequest`, un contrato paralelo.
- **Relacion con Gateway**: envoltura delgada que re-valida identity y luego delega a `executeGovernedCapability`.
- **Identity context**: re-verificada dentro de este contrato antes de llegar al Gateway (defensa en profundidad).
- **Correlacion**: ya tiene `correlationId`/`causationId`.
- **Idempotencia**: no es responsabilidad de este contrato — vive dentro de `createQuoteCapability.execute()`.
- **Opportunity/work linkage**: tiene `opportunityId`; **no tiene** `workId`/`objectiveId`.
- **Read path usa otro contrato**: si, confirmado (`ReadToolRequest`).

**Clasificacion: EXTEND MINIMALLY.** Puede evolucionar para P7 agregando campos opcionales (`workId`, `objectiveId`, `preCognitionEligibilityStatus` para el capability solicitado) sin romper a los 2 productores ni al unico consumidor. No hace falta reemplazarlo — ya es la frontera correcta para mutaciones, y el patron gemelo (`ReadToolRequest`) ya resuelve reads sin forzar un contrato generico artificial. **REPLACE** no esta justificado por ninguna evidencia encontrada.

---

## H. Read vs mutation execution paths

**Confirmado: dos caminos estructuralmente distintos, no el mismo camino con un branch**, hasta que ambos convergen en `executeGovernedCapability`.

`search_products` (read-only):
```
use_tool -> validateAgentStep -> processUseToolStep
  -> exposure=READ_TOOL -> buildReadToolRequestFromAtlStep -> ReadToolRequest
  -> executeReadTool (re-chequea sideEffect==="read_only" en vivo)
  -> executeGovernedCapability -> identity gate (siempre allowed, sideEffect!=="mutating")
  -> checkAvailability -> searchProductsCapability.execute() -> CatalogPort
  -> CapabilityGatewayResult -> ReadToolResult -> buildToolObservation -> ToolObservation{status:"completed"}
```

`create_quote` (mutating):
```
use_tool -> validateAgentStep -> processUseToolStep
  -> exposure=COMMERCIAL_ACTION -> ensureCommercialActionOpportunity (lazy, 1x/turno)
  -> buildCommercialActionRequestFromAtlStep -> CommercialActionRequest{CREATE_QUOTE}
  -> executeCommercialActionRequest (re-corre identity gate como defensa extra)
  -> executeGovernedCapability -> identity gate (exige LEVEL_2_MASTER_RESOLVED)
  -> checkAvailability -> createQuoteCapability.execute()
       (assembleQuoteInput -> idempotency key -> reuse check -> QuoteServicePort.createQuote)
  -> CapabilityGatewayResult -> CommercialActionResult -> buildToolObservation
  -> ToolObservation{status:"completed", data:{status:"created"|"reused", quoteId}}
```

**Pregunta del brief — ¿deberia P7 unificarlos conceptualmente sin unificarlos fisicamente?** Ya estan unificados conceptualmente donde importa: mismo chokepoint de autoridad (`executeGovernedCapability`), mismo tipo de resultado normalizado (`CapabilityGatewayResult` -> `ToolObservation`). La separacion fisica (`ReadToolRequest` vs `CommercialActionRequest`) es la implementacion de un principio de seguridad real (defensa en profundidad, invariante distinto para sideEffect read vs mutating), no deuda. P7 no necesita tocar esto.

---

## I. Microservice boundary

| Capability | Adapter/port | Transport | Microservicio | LLM conoce infra? |
|---|---|---|---|---|
| `search_products`, `get_product_details`, `explore_catalog`, `search_products_by_semantics`, `recommend_catalog_products`, `batch_get_products` | `lib/catalog/httpCatalogAdapter.ts` | HTTP | Catalog Service | No — `buildToolObservation.ts` proyecta solo campos allowlisted (`productId/name/price/availability/publicLink`) |
| `calculate_shipping` | `lib/integrations/carrier-service/httpCarrierServiceAdapter.ts` + `CatalogPort.batchGetProducts` (hidratacion de peso/precio) | HTTP | Carrier MS (autoridad unica de cobertura/tarifa) + Catalog Service | No — `selectionFactId`/`destinationFactId` internos nunca salen |
| `create_quote`, `get_quote`, `issue_quote`, `send_quote_email` | `lib/integrations/quote-service/httpQuoteServiceAdapter.ts` | HTTP | Quote Service | No — solo `data` ya acotado del capability sale, nunca el input crudo del Quote Service |
| `select_products`, `set_shipping_destination`, `select_shipping_option` | Servicios de dominio propios (`commercial-line-items`, `shipping-destination`, `selected-shipping-option`) | MariaDB directo | Ninguno (persistencia interna) | N/A |
| `get_customer_purchase_history`, `get_customer_recommendation_signal` | `customer-profile-context/loader.ts` | Lectura de dominio interna | Customer Profile boundary | N/A — clasificadas `NOT_AGENT_EXPOSED`, el LLM nunca las llama directo; solo el ejecutor determinista de `CommercialWork` |

**Ningun leak de infraestructura hacia el modelo detectado.** Ningun capability filtra URL interna, nombre de host, ni forma cruda de request/response del microservicio. La unica cosa "customer-facing" que sale es `publicLink.canonicalUrl` de producto, que es intencional (link para el cliente, no infraestructura interna).

---

## J. MCP fit analysis

Respuestas concretas, basadas en el spec oficial (seccion B/Q) y el inventario real (secciones C/E/I):

- **¿Util entre Gateway y microservices?** No hoy. Los adapters HTTP actuales (Catalog/Quote/Carrier) ya son delgados, tipados y con contrato propio; MCP agregaria una capa de protocolo (JSON-RPC, sesiones, framing) sin resolver ningun problema detectado en el inventario. Los microservicios PesasChile no son consumidos por multiples agentes heterogeneos hoy — un solo consumidor (R3) no justifica un protocolo de interoperabilidad.
- **¿Util para servicios externos futuros?** Posiblemente, si algun dia se integra una herramienta de terceros que ya hable MCP nativamente (evita escribir un adapter a mano). Especulativo, sin caso concreto hoy.
- **¿Util para Instagram/Facebook/voice (P12+)?** Posiblemente como forma de exponer el mismo tool surface a runtimes distintos sin reescribir adapters — pero eso es P12, fuera de scope de P7, y el spec MCP no resuelve nada de multicanalidad por si mismo.
- **¿Deberiamos exponer Gateway completo como MCP?** No. El spec es explicito: `ToolAnnotations` (incluido `readOnlyHint`/`idempotentHint`) son auto-reportadas y no confiables por defecto, y la autorizacion/identidad quedan fuera del protocolo. Exponer el Gateway completo via MCP significaria reconstruir identity gate + governance + eligibility en la capa de servidor MCP, exactamente la duplicacion que el invariante arquitectonico de R3 prohibe.
- **¿Deberiamos exponer cada microservicio directamente via MCP?** No. Eso bypassea el Gateway entero — pierde identity gate, disponibilidad gobernada, auditoria unica y la re-lectura de verdad en vivo que hoy garantiza `executeGovernedCapability`. Violaria el invariante "Outbox/Gateway es la via canonica" aplicado a ejecucion.
- **¿Que perderiamos en governance?** Identity levels, `riskClass`, retry acotado por capability, auditoria unificada (`crm_capability_executions`) — nada de esto tiene equivalente obligatorio en el protocolo MCP.
- **¿Que ganariamos en interoperability?** Reutilizacion de tooling MCP generico (inspectors, clientes de terceros) si algun consumidor externo necesitara hablar con R3 sin conocer su HTTP interno — sin caso de uso actual.
- **¿Que latencia/overhead agregaria?** Una capa adicional de serializacion JSON-RPC + gestion de sesion sobre HTTP ya existente, sin beneficio medido.

**Clasificacion: NOT USEFUL NOW.** Para "util despues" ver seccion R (gap DEFERRED). La hipotesis inicial del brief se confirma: MCP puede eventualmente adaptar transporte, pero no debe tocar `CommercialWork`, eligibility, identity policy, Gateway governance ni domain authority.

---

## K. Result / ToolObservation model

Camino de vuelta trazado: `service result -> CapabilityGatewayResult -> (ReadToolResult | CommercialActionResult) -> ToolObservation -> R3 provider`.

- **Shapes actuales**: `ToolObservation = {tool, status, data?, errorCode?, reason?, retryable?, providerErrorCode?, warnings?}`, con `status` restringido a la union cerrada `["completed","failed","blocked","skipped"]` (`agentStepTypes.ts:93`). `skipped` es exclusivo de `recommend_catalog_products`.
- **Success**: `status:"completed"`, `data` con el shape proyectado especifico del tool (ver `buildToolObservation.ts`, switch por tool con proyecciones dedicadas: `projectSearchProducts`, `projectCalculateShipping`, `projectCreateQuote`, etc.).
- **Rejected/unavailable/invalid args/identity failure/stale**: todos colapsan hoy en `status:"blocked"` o `status:"failed"` mas un `errorCode`/`reason` de texto libre por convencion (no un enum cerrado por-causa). `shipping_calculation_stale` (importado de `lib/domains/selected-shipping-option`) es el unico caso con nombre de codigo dedicado que corresponde a STALE_STATE.
- **Retryable vs terminal**: existe el campo `retryable`, poblado por capability.
- **Excepciones que se filtran**: no se encontro evidencia de excepciones no capturadas llegando hasta `ToolObservation` — el builder es exhaustivo (switch cerrado por tool).
- **Strings libres dominan?**: parcialmente. El `status` de alto nivel esta bien tipado y cerrado; el `errorCode`/`reason` de bajo nivel es string por convencion, sin enum cruzado.

**Pregunta central: ¿R3 necesita un `CapabilityExecutionResult` canonico antes de `ToolObservation`, o ya existe equivalente?**

**Ya existe equivalente — `CapabilityGatewayResult` mas `ToolObservation`, con `status` en union cerrada.** No hay que recrearlo. Lo que falta no es un nuevo tipo de resultado; es cerrar el segundo nivel (`errorCode`/`reason`) con una taxonomia compartida — eso es una mejora incremental sobre lo existente (ver L), no un contrato nuevo.

---

## L. Error model

Inventario real (nombres reales del repo, no inventados):

- `CAPABILITY_AVAILABILITY_STATUSES = ["available","unavailable","denied","requires_approval","temporarily_blocked"]` (`capability-gateway/types.ts:8-15`)
- `CAPABILITY_GATEWAY_EXECUTION_STATUSES = ["completed","missing_information","denied","requires_approval","temporarily_blocked","invalid_arguments","failed"]` (`capability-gateway/types.ts:17-26`)
- `capability_not_registered` — pre-Gateway, fail closed
- `master_identity_required` / `identity_context_unavailable` / `identity_requirement_unresolved` — identityGate.ts
- `catalog_service_not_configured` / `quote_service_not_configured` / `carrier_service_unavailable` — dependencia no disponible, por capability
- `shipping_calculation_stale` (`SHIPPING_CALCULATION_STALE_ERROR_CODE`) — el unico STALE_STATE con nombre propio
- `duplicate_tool_call`, `capability_not_agent_exposed` — rechazos pre-Gateway dentro de `processUseToolStep`

**Los nombres del brief (`INVALID_ARGUMENTS`, `POLICY_REJECTED`, `IDENTITY_REQUIRED`, `OBJECTIVE_CONFLICT`, `STALE_STATE`, `DEPENDENCY_UNAVAILABLE`, `TRANSIENT_EXTERNAL_ERROR`, `IDEMPOTENT_REPLAY`, `EXECUTED`) no existen verbatim en el repo.** Mapeo aproximado a lo real:

| Taxonomia hipotetica | Analogo real en R3 |
|---|---|
| EXECUTED | `status:"completed"` |
| INVALID_ARGUMENTS | `invalid_arguments` (status de Gateway, ya existe) |
| POLICY_REJECTED | `denied` (status de Gateway) |
| IDENTITY_REQUIRED | `master_identity_required` / equivalentes de identityGate |
| DEPENDENCY_UNAVAILABLE | `*_service_not_configured` / `*_service_unavailable`, por capability |
| STALE_STATE | `shipping_calculation_stale` (unico caso con nombre propio; el resto no tiene equivalente formalizado) |
| OBJECTIVE_CONFLICT | No existe analogo a nivel Gateway — mas cercano a P5 (`objective-reconciliation`), fuera del scope de ejecucion |
| TRANSIENT_EXTERNAL_ERROR | No formalizado como codigo — implicito en `retryable:true` |
| IDEMPOTENT_REPLAY | No formalizado como status — implicito en `data.status:"reused"` de `create_quote` (unico caso) |

Comparado con OpenAI (error-as-result vs exception, developer switch), MCP (protocol error vs `isError:true` en el resultado) y PydanticAI (`ModelRetry` presupuestado vs `ToolFailed` no presupuestado): R3 ya tiene la distincion de alto nivel (`status` cerrado + `retryable`), pero el segundo nivel (`errorCode`) esta menos disciplinado que cualquiera de los tres frameworks externos revisados en profundidad. **Esto es un gap real pero MINOR/IMPORTANT (no BLOCKER) — ver R.**

---

## M. Eligibility -> request coherence

Los 4 casos del brief, respondidos con evidencia real:

- **Caso 1 (ELIGIBLE -> pide -> ejecuta)**: camino normal, funciona hoy sin cambios — Gateway ejecuta porque sus propios checks pasan, no porque P6 dijo ELIGIBLE.
- **Caso 2 (ELIGIBLE segun P6 -> Gateway rechaza por verdad viva mas fresca)**: **ya posible hoy y correcto por diseno** — P6 es pre-cognicion (hechos al inicio del turno), Gateway siempre lee en vivo dentro de cada `execute()`. Si algo cambio entre el calculo de P6 y la ejecucion, Gateway gana. Esto es exactamente el invariante "Gateway conserva la autoridad final".
- **Caso 3 (BLOCKED -> modelo arregla el bloqueador -> pide de nuevo -> Gateway permite)**: **posible hoy en ejecucion** (Gateway relee hechos en vivo, asi que efectivamente lo permite), pero **invisible en telemetria** — nada registra que el bloqueador se resolvio dentro del mismo turno.
- **Caso 4 (BLOCKED -> modelo pide igual sin cambiar nada -> Gateway rechaza)**: tambien correcto en ejecucion hoy (Gateway rechaza por sus propios checks), pero **indistinguible del Caso 3 en telemetria** — ambos aparecen simplemente como "Gateway rechazo" o "Gateway permitio", sin marca de si hubo evidencia nueva en el turno.

**Confirmado por el inventario (agente de codigo):**
- `preCognitionCapabilityEligibility` se calcula **una sola vez**, antes del provider, desde el work/DRM de inicio de turno (`salesAgentRuntime.ts:519-524`).
- Se pasa **sin cambios** a cada iteracion del prompt dentro del mismo turno (`runAgentToolLoop.ts:1259, 1539`), incluso cuando el propio loop ya ejecuto tools mutantes (`set_shipping_destination`, `select_products`) en iteraciones previas del mismo turno.
- `commercialContextSummary` **si** se refresca a mitad de turno (via `tryAssimilate()`, cuando llega un mensaje nuevo) — pero no existe un hook equivalente para refrescar eligibility despues de una mutacion.
- El shadow "post" de P6.2 reutiliza el **mismo DRM de inicio de turno** (`cognitionContext.domainReadModel`), no relee hechos frescos — asi que ni siquiera el shadow post-reconciliation es realmente "post-ejecucion" con verdad actualizada.
- **No existe ningun campo de telemetria, warning, ni evento que distinga Caso 3 de Caso 4 hoy.**

**Conclusion, consistente con el handoff**: esta es la brecha real que el propio `R3_COMMERCIAL_AGENT_HANDOFF.md` nombra como trabajo de P7 ("P6.2 todavia no condiciona esa ejecucion... P7 integrar/revalidar eligibility con el execution path gobernado existente"). El punto de decision para P7 es: (a) recalcular eligibility justo antes de `executeGovernedCapability` con verdad en vivo — requeriria un seam de refresco de DRM dentro del loop que hoy no existe (solo existe el `commercialContextSummary`, mas grueso), o (b) apoyarse enteramente en los checks en vivo del Gateway (ya correctos hoy) y tratar P6/P6.3 como una pista de prompt sin acoplamiento de ejecucion — agregando solo telemetria para poder distinguir Caso 3 de Caso 4 en produccion antes de decidir si (a) hace falta. Ver T para la recomendacion.

---

## N. Turn-scoped tool execution state

`runAgentToolLoop` **ya mantiene** todo lo que el brief pregunta, con nombres reales:

- **Prior tool calls / dedupe**: `executedCalls: Set<string>`, key = `buildDedupeKey(tool, args)` con JSON canonico (orden de campos no defeatea el dedupe).
- **Results/observations**: `steps: AgentLoopStepRecord[]`, cada uno `{stepIndex, step, governance, observation, phase}`.
- **Execution counter**: `toolExecutionCount`, solo incrementa si `result.executed===true` (una llamada rechazada antes de trabajo real no consume presupuesto).
- **Step/loop budget**: modo legacy (`maxDecisions=3`, `maxToolExecutions=2`) o modo open-turn (`BRAIN_R3_OPEN_TURN_EXECUTION_ENABLED`) con techos de emergencia (`OPEN_TURN_EMERGENCY_MAX_ACCEPTED_STEPS=24`, `...MAX_TOOL_EXECUTIONS=20`) y guard de no-progreso (`OPEN_TURN_NO_PROGRESS_THRESHOLD=4`) trackeado en `progress = createOpenTurnProgressState()`.
- **Pending catalog actions**: `activeRecommendationPendingAction` + `recommendationPendingActionConsumed`, mecanismo de continuidad separado del `pendingCatalogAction` emitido por el modelo.
- **Gate universal pre-accion**: `tryAssimilate()` corre antes de actuar sobre cualquier step (ambas fases), pero solo chequea mensajes entrantes nuevos — no eligibility.

**Respuesta: no hace falta un `TurnExecutionContext` nuevo.** El estado ya existente (`steps`, `executedCalls`, `progress`) es material crudo suficiente. Lo que P7 necesita agregar es una **lectura**, no una abstraccion: derivar de `steps` si alguna tool mutante ya toco un prerequisito del capability que se esta por pedir (una senal gruesa "algo cambio este turno", no un diff completo de DRM).

---

## O. State refresh / reprojection boundary — P7 vs P8

Separacion estricta segun lo pedido:

| Comportamiento | Clasificacion |
|---|---|
| R3 recibe solo `ToolObservation` acotado despues de `select_products`/`set_shipping_destination`/`create_quote` | **ALREADY EXISTS** — proyecciones intencionalmente angostas (`buildToolObservation.ts`), confirmado que ni siquiera exponen IDs internos como `selectionFactId`/`destinationFactId` |
| DRM se reconstruye a mitad de turno | **P8 RESPONSIBILITY** — no existe hoy; `cognitionContext.domainReadModel` es del inicio del turno, reusado (no reconstruido) |
| `CommercialWork` se actualiza a mitad de turno por una tool | **P8 RESPONSIBILITY** — P5 (la unica escritura de objective) corre sobre la `CommercialProposal` al final del turno, no es disparado por tool execution individual |
| Eligibility se actualiza a mitad de turno | **P8 RESPONSIBILITY** para un recalculo real con DRM fresco; una senal gruesa "algo mutante paso este turno" (sin DRM nuevo) es alcance razonable de **P7**, ver T |
| El modelo puede continuar con la tool result dentro del mismo turno | **ALREADY EXISTS (PARTIAL)** — continua con el `ToolObservation` puntual de esa tool, no con una vista de verdad global refrescada |

No se mete reprojection completo dentro de P7 en la recomendacion de la seccion T.

---

## P. Canonical capability definition recommendation

Propuesta hipotetica evaluada:

```text
defineCommercialCapability({
  name,
  model: { description, inputSchema },
  governance: { sideEffect, risk, identity },
  eligibility: { objectives, requiredFacts },
  execution: { ... }
})
```

**Beneficios reales si se implementara**: reduce drift potencial, mejora inspeccionabilidad, generacion automatica de schema, semantica compartida P6/Gateway en un solo lugar.

**Riesgos reales, con evidencia del propio repo**:
- El registry actual **ya** deja identity fuera a proposito (tabla separada, invariante arquitectonico explicito contra duplicar identity policy).
- `capability-eligibility/definitions.ts` **ya** evita duplicar `executionClass`, leyendolo en vivo del registry — justo el patron que una mega-definicion estatica tendria que romper para incluir `eligibility` inline.
- Meter `identity` y `eligibility` dentro de una definicion estatica unica reintroduce exactamente el riesgo que el brief nombra: "static metadata intentando representar runtime policy" — la eligibility de R3 depende de hechos runtime (DRM), no es un dato estatico declarable junto al schema.
- Migracion de ~20 capabilities es costo alto para un beneficio que la seccion D ya mostro que **no** esta resolviendo una fragmentacion real (la separacion es intencional y consistente).

**Recomendacion: NO por ahora (no NOW, no INCREMENTALLY tampoco de forma proactiva).** La fragmentacion actual es saludable segun el propio invariante arquitectonico de R3. Si en el futuro aparece drift real y medido (ej. un capability con `executionClass` inconsistente entre registry y eligibility, algo que hoy el codigo evita activamente), reconsiderar como **LATER**, y aun asi evaluar una mega-definicion sin incluir `eligibility`/`identity` inline — esos dos deben seguir leyendo en vivo del registry, no copiandolo.

---

## Q. Market comparison table

| Concern | OpenAI Agents SDK | Semantic Kernel | MCP | LangGraph/ADK | R3 hoy | Gap |
|---|---|---|---|---|---|---|
| Tool definition | `@function_tool` / `FunctionTool(name, description, params_json_schema, on_invoke_tool)` | `[KernelFunction]`/`@kernel_function` en plugin | `{name, description, inputSchema, outputSchema?, annotations?}` | LangGraph: `ToolNode` lee `tool_calls`. ADK: funcion + docstring/Zod | `CapabilityGatewayDefinition` en registry unico | Ninguno — ya equivalente |
| Schema validation | Pydantic auto-generado | Reflection | JSON Schema | ADK: type hints/Zod | `inputSchema` + `validateAgentStep` (forma) | Ninguno relevante |
| Runtime/trusted context | `RunContextWrapper[T]`/`ToolContext`, explicito "not sent to the LLM" | DI por constructor + params tipados especiales | No especificado, delegado al server | LangGraph: `InjectedState`. ADK: `ToolContext` (state+actions+auth) | `CapabilityGatewayContext` (correlationId, opportunityId, trustedCustomerSession) — **sin workId/objectiveId** | **IMPORTANT — falta workId/objectiveId, unico gap de contexto real** |
| Remote service adapter | `MCPServerStdio/Sse`/`HostedMCPTool` | `as_mcp_server()` (direccion inversa) | MCP mismo es el adapter | ADK: `McpToolset` | HTTP adapters propios por microservicio (Catalog/Quote/Carrier) | Ninguno — ya resuelto, MCP no aporta hoy (ver J) |
| Permisos/governance | Approval policies + guardrails | Filters alrededor del loop | Explicitamente fuera del protocolo | ADK: `actions.escalate`/auth sub-flow | Identity gate + `governance.authority` en Gateway | Ninguno — ya resuelto |
| Side-effect metadata | No declarativo | No declarativo | `ToolAnnotations` (auto-reportadas, no confiables) | No especificado | `governance.sideEffect` tipado, enforced (no solo hint) | Ninguno — R3 ya va mas alla del hint de MCP |
| Approvals (human-in-the-loop) | `needs_approval`, pausa/resume como estado durable | No especificado como primitiva | SHOULD-level, sin mecanismo de protocolo | No especificado | `governance.authority = "requires_approval"` existe en el tipo, sin verificar wiring end-to-end en esta auditoria | **MINOR — verificar en auditoria futura si hay capabilities `requires_approval` realmente exigido en runtime** |
| Idempotencia | No es primitiva del SDK | No especificado | Solo hint, no confiable | No especificado | Real y enforced solo en `create_quote` (idempotency key + reuse check) | **MINOR — resto de mutating capabilities sin key formal, dependen de semantica "changed:false" propia** |
| Tracing | `function_span()` por tool call, built-in | No especificado en paginas revisadas | No especificado en el protocolo | No especificado | Solo auditoria DB (`crm_capability_executions`), sin tracing por-request en eventos | **IMPORTANT — gap real de observabilidad, ver R** |
| Resultados normalizados | Tipos estrictos via Pydantic/TypedDict | Schema via descripcion/filter | `content`/`structuredContent` tipado | No especificado (LangGraph), PydanticAI: `ToolReturnPart` | `ToolObservation.status` union cerrada (4 valores) + `data` proyectado por tool | Ninguno en el nivel alto; ver L para el segundo nivel (`errorCode`) |
| State persistence | No es su rol | No es su rol | No es su rol | ADK: `SessionService` event-sourced | `CommercialWork` + DRM + `AgentSession`, ya event-sourced/versionado | Ninguno — ya mas maduro que lo revisado externamente |
| State refresh | No es su rol | No es su rol | No es su rol | No especificado | No existe mid-turn (ver O) | P8, no P7 |
| Retries | Switch developer-controlado error-as-result vs exception | No especificado | No especificado por protocolo | Vercel: backoff HTTP. PydanticAI: `ModelRetry` (presupuestado) vs `ToolFailed` (no presupuestado) | Retry acotado dentro de `executeGovernedCapability`, `maxRetries` mayormente 0 | Ninguno — comparable, aunque sin la distincion fina de PydanticAI entre reintento-modelo vs reintento-sistema |
| Tool filtering / discovery dinamica | `defer_loading`+`ToolSearchTool`, filtros MCP estaticos/dinamicos | No especificado | `tools/list_changed`, paginacion | No especificado | Pool estatico, sin filtrado dinamico (decision explicita, no gap) | Ninguno — deferred a proposito (no-goal de P6.3 y de P7, ver W) |
| Microservice transport abstraction | Via MCP | Via MCP (as_mcp_server) | Es el transporte mismo | ADK: `McpToolset` | HTTP adapters tipados por microservicio | Ninguno relevante hoy (ver J) |

No se puntua ni se elige "ganador" — tabla puramente factual.

---

## R. Gaps

| Gap | Clasificacion | Evidencia |
|---|---|---|
| `CapabilityGatewayContext` no incluye `workId`/`objectiveId`/version de `CommercialWork` | **IMPORTANT** | Cero referencias confirmadas por grep; unico contexto durable disponible en Gateway es `opportunityId` |
| Ningun evento/telemetria distingue Caso 3 (bloqueador resuelto mid-turn) de Caso 4 (pedido repetido sin cambios) | **IMPORTANT** | Seccion M — confirmado por doble verificacion (agente de codigo + relectura del handoff) |
| No hay tracing por-tool-call en `CommercialEventV1`; el unico detalle vive en la tabla `crm_capability_executions` | **IMPORTANT** | Solo `agent_tool_loop_completed` a nivel turno, sin args/observation |
| Segundo nivel de error (`errorCode`) no tiene enum cruzado, es string por convencion | **MINOR** | Seccion L |
| Solo `create_quote` tiene idempotency key formal; el resto depende de semantica "changed:false" propia de cada dominio | **MINOR** | Seccion C item 12 |
| `crm_capability_executions` no guarda `inboundMessageId` directamente, solo `correlationId`/`requestId`/`decisionId`/`actionId` | **MINOR** | Trazabilidad fina posible via `correlationId` si es 1:1 por turno, pero no verificado explicitamente en esta auditoria |
| `toolAliases.ts` (legacy R2, camelCase->snake_case) sigue existiendo fisicamente, inerte para R3 | **DEFERRED** | No usado por `runAgentToolLoop`; riesgo de reactivacion accidental, no de comportamiento actual |
| MCP no resuelve nada nuevo hoy; util solo especulativamente para multicanal/terceros | **DEFERRED** | Seccion J |
| Mega-registry `defineCommercialCapability` no se justifica hoy | **DEFERRED** | Seccion P |
| Reproyeccion de DRM/eligibility post-ejecucion con verdad fresca | **DEFERRED (P8)** | Seccion O |

**Ningun BLOCKER encontrado.** Nada de lo auditado impide avanzar P7 con alcance acotado; el sistema ya es seguro en ejecucion (Gateway siempre revalida verdad viva) — lo que falta es visibilidad, no autoridad.

---

## S. P7 design options

**OPTION A — Minimal evolution of existing requests/telemetry**

- Agregar campos opcionales a `CommercialActionRequest`/`ReadToolRequest` (o a `CapabilityGatewayContext`): `workId`, `objectiveId`, `preCognitionEligibilityStatus` para el capability solicitado (lookup del snapshot ya calculado, sin recalcular nada).
- Agregar una senal gruesa "algo mutante ya paso este turno que toca un prerequisito de este capability", derivada de `steps`/`executedCalls` ya existentes en `runAgentToolLoop` — sin DRM nuevo, sin HTTP nuevo.
- Un evento nuevo (o extension de `agent_tool_loop_completed`) que capture, por tool call: capability, `preCognitionEligibilityStatus` al inicio del turno, la senal gruesa de arriba, y el status final de Gateway — suficiente para distinguir Caso 3 de Caso 4 en produccion.
- **Files touched**: `commercial-action-request/types.ts`, `read-tool-request/types.ts`, `capability-gateway/types.ts` (context, opcional), `runAgentToolLoop.ts` (lookup + senal), `events/types.ts` (evento nuevo o extendido).
- **Architecture impact**: bajo — todo aditivo/opcional, ningun contrato existente cambia de forma incompatible.
- **Migration cost**: bajo.
- **Risk**: bajo — Gateway sigue siendo la unica autoridad de ejecucion, P7 no le agrega logica de rechazo nueva.
- **Compatibility**: total, campos opcionales.
- **Needed now**: si, parcialmente — es lo que permite medir si el gap de coherencia (M) importa en produccion antes de invertir en algo mas grande.

**OPTION B — New canonical invocation envelope**

- Un `CapabilityInvocationRequest` que envuelva/normalice tanto `ReadToolRequest` como `CommercialActionRequest` antes de `executeGovernedCapability`, con contexto confiable uniforme.
- **Architecture impact**: medio — toca ambos productores; riesgo de erosionar la separacion deliberada read/mutation (defensa en profundidad documentada en H).
- **Migration cost**: medio.
- **Risk**: medio — podria colapsar por error el re-chequeo de identity gate duplicado que hoy es intencional.
- **Compatibility**: requiere adaptar 2 productores y 2 consumidores.
- **Needed now**: no — Option A logra el mismo beneficio de correlacion sin tocar la separacion que el codigo ya protege a proposito.

**OPTION C — Canonical capability definition refactor (`defineCommercialCapability`)**

- Ver seccion P — rechazada por ahora.
- **Architecture impact**: alto — ~20 capabilities, registry, identity table, eligibility definitions.
- **Migration cost**: alto.
- **Risk**: alto — reintroduce duplicacion de identity/eligibility que el codigo activamente evita hoy.
- **Compatibility**: rompe el patron de "leer en vivo, no copiar" que protege contra drift de `executionClass`.
- **Needed now**: no.

---

## T. Recommended P7 scope

**La hipotesis del brief se valida, con una correccion de foco.**

Lo que P7 deberia hacer (confirmado necesario por el gap real, seccion R/M):

1. **Attach trusted runtime context**: agregar `workId`/`objectiveId` (y opcionalmente version) al contexto de ejecucion — hoy ausentes, unico gap estructural real de contexto.
2. **Correlate request with pre-cognition eligibility**: adjuntar el `preCognitionEligibilityStatus` ya calculado al `CommercialActionRequest`/`ReadToolRequest` resultante — no recalcular, solo transportar lo que ya existe en `cognitionContext`.
3. **Add telemetry eligibility/request/outcome**: el unico gap de observabilidad real confirmado — sin esto, Caso 3 y Caso 4 son indistinguibles en produccion hoy.

Lo que P7 **NO** necesita hacer porque **ya existe**:

- **"Canonicalize model tool request"** — ya existe (`AgentStepUseTool` + `validateAgentStep` + `ReadToolRequest`/`CommercialActionRequest`). No hay que crear un envelope nuevo (Option A, no B).
- **"Gateway revalidates authoritative truth"** — ya existe y ya es correcto (`executeGovernedCapability` siempre lee en vivo, nunca confia en P6). No tocar esta logica.
- **"Normalize execution/rejection into ToolObservation"** — ya existe (`status` union cerrada de 4 valores). No crear un `CapabilityExecutionResult` nuevo.

Lo que P7 **NO debe** hacer, confirmado por el propio invariante del handoff y por esta auditoria:

- **Hard reject solely from P6 snapshot** — Gateway debe seguir siendo la unica autoridad; P6 sigue siendo advisory. Correcto, no cambiar.
- **Dynamic tool filtering** — el pool estatico es una decision explicita (no-goal de P6.3), no una limitacion tecnica.
- **Reproject full DRM** — es P8; la senal gruesa de Option A no requiere DRM nuevo.
- **Rebuild CommercialWork** — P5 sigue siendo el unico escritor de objective, sobre la proposal, no sobre tool execution individual.
- **MCP migration** — confirmado NOT USEFUL NOW en J.
- **Refactor all capabilities into mega-registry** — confirmado NO en P.
- **Change microservice APIs** — ningun cambio de contrato de microservicio identificado como necesario.

**Hipotesis validada con correccion**: el brief asumia que quiza faltaba normalizar ToolObservation o hacer que Gateway revalide — ambas cosas **ya existen**. El verdadero trabajo de P7 es mas pequeno de lo hipotetizado: threading de contexto + telemetria de coherencia, Option A completa.

---

## U. Test strategy (propuesta, sin escribir tests)

- **P7-A** (model cannot spoof trusted context): confirmar que `workId`/`objectiveId`/`preCognitionEligibilityStatus` nuevos en el request son siempre runtime-derived, nunca leidos de `AgentStepUseTool.arguments` — un intento del modelo de incluir esos campos en `arguments` debe ser ignorado silenciosamente por el builder de request, no propagado.
- **P7-B** (canonical request preserves arguments): el request resultante conserva exactamente los `arguments` validados por `validateAgentStep`, sin mutacion salvo `enrichToolArguments` ya existente.
- **P7-C** (runtime attaches work/objective/correlation context): dado un turno con `CommercialWork` activo, el `CapabilityGatewayContext`/request resultante contiene `workId`/`objectiveId` correctos.
- **P7-D** (eligible + execute): capability ELIGIBLE en el snapshot pre-cognicion, Gateway ejecuta normalmente, telemetria registra `eligibilityStatus:"ELIGIBLE"` + outcome `completed`.
- **P7-E** (eligible + Gateway reject): capability ELIGIBLE en snapshot, pero hecho vivo cambio (ej. destino invalidado por otra via) -> Gateway rechaza -> telemetria registra la divergencia snapshot-vs-outcome sin que eso bloquee nada por si solo.
- **P7-F** (blocked + unchanged state + Gateway reject): Caso 4 — capability BLOCKED, ninguna tool mutante ejecuto antes en el turno, Gateway rechaza -> telemetria marca "sin evidencia nueva este turno".
- **P7-G** (blocked pre-snapshot + state changed + Gateway execute): Caso 3 — capability BLOCKED al inicio, una tool mutante relevante ejecuto antes en el mismo turno, Gateway permite -> telemetria marca "evidencia nueva este turno" distinto de F.
- **P7-H** (read-only path): `ReadToolRequest` sigue funcionando sin cambios de comportamiento, solo contexto adicional adjunto para telemetria.
- **P7-I** (mutating path): `CommercialActionRequest` igual.
- **P7-J** (identity rejected): identity gate sigue siendo la unica fuente de verdad de identidad; el nuevo contexto no lo bypassea ni lo duplica de forma distinta a la ya existente.
- **P7-K** (dependency unavailable): `*_service_not_configured`/`_unavailable` siguen propagando igual, con contexto adicional solo en la capa de telemetria, no en la decision.
- **P7-L** (normalized ToolObservation): `ToolObservation.status` sigue siendo la union cerrada de 4 valores; el nuevo contexto no aparece en `ToolObservation` (permanece en la capa de telemetria/auditoria, no en lo que ve el modelo).
- **P7-M** (no second capability path): confirmar que no se crea una tercera via de ejecucion paralela a `ReadToolRequest`/`CommercialActionRequest`.
- **P7-N** (no Gateway bypass): confirmar que todo tool call sigue pasando por `executeGovernedCapability` sin excepcion.
- **P7-O** (no R2 planner): confirmar que ningun cambio de P7 reintroduce `deriveCommercialWorkSteps`/`reconcileCommercialTrigger`.

---

## V. Likely files

Solo como estimacion de superficie de cambio para P7 (Option A) — no implementado en esta auditoria:

- `lib/brain/commercial/commercial-action-request/types.ts` — campos opcionales nuevos
- `lib/brain/commercial/read-tool-request/types.ts` — campos opcionales nuevos
- `lib/brain/commercial/capability-gateway/types.ts` — `CapabilityGatewayContext` extendido (opcional)
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` — lookup del snapshot de eligibility + senal gruesa desde `steps`
- `lib/brain/commercial/events/types.ts` — evento nuevo o extension de `agent_tool_loop_completed`
- `lib/brain/commercial/capability-gateway/repository.ts` — posible columna adicional si se decide persistir `workId`/`objectiveId` en `crm_capability_executions` (requeriria migracion — evaluar si telemetria de eventos basta sin tocar la tabla)
- `docs/R3_COMMERCIAL_AGENT_HANDOFF.md` — actualizar roadmap/status al cerrar P7

---

## W. Explicit non-goals

- No filtrado dinamico de tools.
- No reconstruccion de `CommercialWork` fuera de P5.
- No reproyeccion completa de DRM (P8).
- No migracion a MCP.
- No refactor de todas las capabilities a un mega-registry.
- No cambios de contrato de microservicio (Catalog/Quote/Carrier).
- No nueva autoridad de rechazo basada solo en el snapshot P6 — Gateway sigue siendo la unica autoridad.
- No segunda via de ejecucion paralela a `ReadToolRequest`/`CommercialActionRequest`.
- No tocar `scripts/diagnostics/` (fuera de scope de esta auditoria, confirmado untracked y no tocado).

---

## Research discipline — fuentes externas consultadas

Todas verificadas via WebFetch/WebSearch contra documentacion oficial el 2026-09-17, con distincion EXTERNAL PATTERN / R3 REPO FACT / RECOMMENDATION mantenida en todo el documento:

- OpenAI Agents SDK: `openai.github.io/openai-agents-python/{context,tools,guardrails,tracing,mcp}/`, `openai.github.io/openai-agents-js/guides/human-in-the-loop/`, `github.com/openai/openai-agents-python`
- Semantic Kernel: `learn.microsoft.com/en-us/semantic-kernel/{concepts/kernel, agents/plugins/using-the-KernelFunction-decorator, concepts/enterprise-readiness/filters}`
- MCP: `modelcontextprotocol.io/specification/2025-06-18/server/tools`, `github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-06-18/schema.ts`, `modelcontextprotocol.io/specification/draft/basic/authorization` (resumen via busqueda, no fetch completo — marcado explicitamente en el hallazgo original)
- LangGraph: `reference.langchain.com/python/langgraph.prebuilt/tool_node/ToolNode`
- Google ADK: `adk.dev/tools-custom/`, `google.github.io/adk-docs/tools-custom/mcp-tools/` (parcial via busqueda)
- Vercel AI SDK / PydanticAI: `ai-sdk.dev/docs/ai-sdk-core/{tools-and-tool-calling,settings}`, `pydantic.dev/docs/ai/core-concepts/{dependencies,retries}`, `ai.pydantic.dev/api/tools/` (cobertura liviana, segun alcance pedido)

Toda afirmacion sobre R3 esta respaldada por cita `file:line` verificada contra HEAD `34bc4d0`, no por memoria de conversaciones anteriores.
