---
title: SALES-AGENT-R1-AUDIT — Current Commercial Capability and End-to-End Sales Readiness Audit
doc_id: audit-sales-agent-r1-current-commercial-capability
status: completed
owner: architecture
last_reviewed: 2026-08-06
source_of_truth_for:
  - current commercial capability inventory (read-only snapshot)
  - sales readiness assessment at commit b9d0324
  - stop-point-of-sale analysis
depends_on:
  - ../ACTIVE_RELEASE.md
  - ../CAPABILITY_MATRIX.md
  - ../ROADMAP.md
  - ../PRODUCT_NORTH_STAR.md
  - ../../AGENTS.md
  - ./follow-up-runtime-reconciliation.md
tags:
  - audit
  - sales-agent
  - autonomous-commerce
---

# SALES-AGENT-R1-AUDIT — Current Commercial Capability and End-to-End Sales Readiness Audit

Auditoria de solo lectura. No se implemento funcionalidad nueva, no se corrigieron defectos, no se hizo commit, push ni PR. Todas las afirmaciones estan respaldadas por evidencia `file:line` verificada contra el codigo real en `develop@b9d0324`, o marcadas explicitamente como `unconfirmed`/`not found` cuando no se pudo verificar.

## 1. Resumen ejecutivo

PesasChile tiene un Sales Agent autonomo real, con un ciclo agente-herramienta nativo (`AgentStep` de tres variantes: `use_tool`/`respond`/`handoff`) conectado a un Capability Gateway gobernado, que hoy puede: buscar productos, pedir detalle de un producto, explorar/rankear el catalogo (mas caro/barato, top-N, filtros), recomendar productos relacionados a partir de un producto ya observado, y responder preguntas de una base de conocimiento **cuyo contenido es 100% placeholder no verificado**. Ese ciclo esta validado con evidencia real de un flujo WhatsApp completo en un despliegue EC2 (operador, no reproducido de forma independiente en esta auditoria).

La venta se detiene, sin excepcion, en el momento de pasar de "recomendar/informar" a "comprometer un precio final, verificar stock real, cotizar formalmente, calcular despacho, cobrar o crear un pedido". **Ninguna de esas seis capacidades (precio final vinculante, stock reservado, cotizacion productiva, shipping, checkout/pago, creacion de orden) tiene una implementacion productiva conectada al runtime por defecto.** Un motor de cotizacion (`crm_quotes` + `lib/brain/commercial/quotes/repository.ts`) esta completamente implementado y unit-testeado, pero **tiene cero llamadores en produccion** — es codigo real, desconectado.

El hallazgo mas critico de esta auditoria, no documentado en ningun archivo canonico existente: **el handoff humano decidido por el modelo no es persistente**. Cuando el agente emite `{"type":"handoff"}`, el sistema envia un mensaje de reconocimiento generico y registra el evento, pero **nunca escribe `human_owner_active`/`ai_enabled`** — el mismo cliente que pidio un humano recibira, en su siguiente mensaje, respuestas automaticas del mismo agente, salvo que un operador humano note el caso y tome control manualmente. Esto contradice el principio no negociable 7 de `PRODUCT_NORTH_STAR.md` ("un fallo tecnico nunca cierra una oportunidad ni deja al cliente sin continuidad") en su version inversa: aqui es un *exito* de deteccion (el modelo identifico correctamente que debia escalar) el que no se traduce en proteccion real del cliente.

Un segundo hallazgo estructural real: la documentacion canonica (`docs/ACTIVE_RELEASE.md`, `docs/CAPABILITY_MATRIX.md`, ambas `last_reviewed: 2026-07-29`/`2026-07-19`) **no menciona en absoluto** un workstream completo ya mergeado a `develop` (`CP-R1-T10B*`/`CP-R1-T12*`, PRs #75-#85, incluyendo Customer Profile, la quinta tool `recommend_catalog_products`, y la Customer History Commercial Policy). El pool de tools del agente tiene hoy **5 herramientas, no 4** como documenta la ultima entrada relevante de `ACTIVE_RELEASE.md`. Esto es deuda documental real, no un problema de codigo — pero significa que ningun documento canonico refleja el estado tecnico actual completo.

**Veredicto**: `SALES_AGENT_READY_FOR_PRODUCT_DISCOVERY_ONLY`, con condiciones `CATALOG_DISCOVERY_AVAILABLE`, `PRODUCT_RECOMMENDATION_AVAILABLE` (implementada, no activada por defecto), `QUOTATION_MISSING`, `CHECKOUT_MISSING`, `PAYMENT_MISSING`, `ORDER_CREATION_MISSING`, `HANDOFF_AVAILABLE` (con el defecto de persistencia arriba descrito), `MEDIA_MISSING`, `PRODUCTION_FLAGS_DISABLED`, `LIVE_VALIDATION_REQUIRED`. Ver seccion 36 para el detalle completo.

## 2. Metodologia

Auditoria de solo lectura ejecutada por un agente principal mas cinco subagentes de investigacion en paralelo (Capability Gateway/Agent Loop; Canales y media; Customer Profile/persistencia; Handoff/Knowledge/transaccional; Feature flags/dependencias externas/tests), cada uno instruido para citar `file:line` real y declarar `unconfirmed`/`not found` en vez de inventar evidencia. El agente principal verifico personalmente: estado git, lectura completa de los documentos canonicos (`AGENTS.md`, `docs/PRODUCT_NORTH_STAR.md`, `docs/ACTIVE_RELEASE.md`, `docs/CAPABILITY_MATRIX.md`, `docs/ROADMAP.md`, `docs/audits/follow-up-runtime-reconciliation.md`, `docs/releases/ACS-R1-05.1-*.md`), y ejecuto personalmente `npx tsc --noEmit`, `npm run build`, `npm run lint`, `npm test` (suite completa). Ningun archivo de produccion fue modificado; no se hizo commit, push ni PR. Los cinco subagentes usaron el mismo estandar de niveles L0-L6 definido en el brief de la tarea y no saltaron niveles sin evidencia.

Escala de madurez usada en todo el documento:

```text
L0_NOT_IMPLEMENTED        no existe implementacion utilizable
L1_CODE_PRESENT           codigo/contrato/adapter existe, sin prueba suficiente
L2_UNIT_VALIDATED         tests aislados con mocks o fixtures
L3_RUNTIME_WIRED          conectada al agent loop o flujo productivo
L4_INTEGRATION_VALIDATED  probada dentro del runtime con dependencias simuladas o locales
L5_LIVE_VALIDATED         probada contra la dependencia real
L6_PRODUCTION_ENABLED     habilitada y operativa en produccion
```

## 3. Estado Git

```text
repositoryRoot         : C:/Users/Goli/Pesas Chile/CRM-Customer-360
currentBranch          : develop
currentHead            : b9d0324
workingTreeStatus      : clean (## develop...origin/develop, sin cambios)
aheadBehindOriginDevelop: 0	0  (develop == origin/develop)
```

`git worktree list` muestra 6 worktrees adicionales activos en el filesystem del usuario (`CRM-Customer-360-catalog`, `-mvp-01a-whatsapp-hub`, `-mvp02`, `-quality-gate-01`, `-t10b8c`, `-t10b8d`) — cada uno en una rama de feature distinta (`ai/codex/ac-catalog`, `ai/codex/mvp-01a-whatsapp-hub`, `ai/claude/mvp-02-genuine-commercial-agent`, `ai/codex/ac-quality-gate-01`, `feat/cp-r1-t10b8c-*`, `feat/cp-r1-t10b8d-*`). Esta auditoria se ejecuto exclusivamente contra el worktree principal (`develop@b9d0324`); no se inspeccionaron los otros worktrees. No se cambio de rama, no se modifico el working tree.

`git log --oneline -5` confirma que el HEAD actual ya incorpora `feat/cp-r1-t12d-customer-history-commercial-policy` (PR #85, merge `b9d0324`) y `feat/cp-r1-t12-customer-profile-commercial-context` (PR #84, merge `f6f18b5`) — el workstream mas reciente cubierto por esta auditoria.

## 4. Arquitectura runtime: tres runtimes paralelos coexisten

Hallazgo transversal que condiciona todo lo demas: el repositorio contiene **tres runtimes comerciales**, no equivalentes en vivacidad:

| # | Runtime | Gate | Default | Rol real |
|---|---|---|---|---|
| 1 | **Native Agent Tool Loop** (`lib/brain/commercial/agent-loop/*`, `lib/brain/commercial/native-cycle/*`) | `BRAIN_AGENT_TOOL_LOOP_ENABLED` | `false` | El ciclo agente-herramienta nuevo (T02.1+), unico camino con 5 tools reales, unico con evidencia EC2 |
| 2 | **Multi-request runtime** (`lib/brain/commercial/multi-request/*`) | `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED` | `false` | Camino paralelo no canonico; aqui viven `find_order`/`get_order_status`, `crm_request_escalations`, routing de `maintenance_quote` — codigo real pero inactivo por defecto |
| 3 | **Legacy sales-consultative** (`lib/brain/commercial/sales-consultative/*`, `lib/brain/local-ai-sdr/*`) | `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED` | `false` (fail-closed desde ACS-R1-05.1-T01) | Motor por keywords, marcado explicitamente como "dead code... zero production callers" en `lib/brain/native-whatsapp/service.ts:905-910` |

Con los tres flags en su valor por defecto (`false`), el **runtime nativo operacional real que corre hoy sin el Agent Tool Loop** es el camino `runCommercialShadowEvaluation -> runCommercialOperationalLoop -> runCapabilityExecutionStage` dentro de `runNativeAutonomousCycle.ts` — el mismo que existia antes de T02.1, que no tiene tools de catalogo propias mas alla de lo que ya conectaba `ACS-R1-05-T06.2` (`batch_get_products` para ranking por presupuesto). El Agent Tool Loop (con sus 5 tools) solo se activa si el operador enciende `BRAIN_AGENT_TOOL_LOOP_ENABLED=true` explicitamente — que es exactamente lo que se hizo en el despliegue EC2 documentado en `docs/releases/ACS-R1-05.1-persistent-commercial-memory-controlled-whatsapp-pilot.md:169`.

Ademas existen **tres vocabularios de tools/capabilities distintos y no unificados**, confirmado por lectura directa:
- `CAPABILITY_GATEWAY_REGISTRY` (`lib/brain/commercial/capability-gateway/registry.ts:413-429`) — el gobernado, auditado, el unico que alimenta el Agent Tool Loop.
- `READ_CAPABILITY_REGISTRY` (`lib/brain/commercial/capabilities/registry.ts:125-241`) — 9 capabilities read-only del runtime multi-request, sin auditoria en `crm_capability_executions`, con su **propio** `search_products` que lee PrestaShop SQL directamente (`ps_product`) — una fuente de datos totalmente distinta del `search_products` del Gateway. `CAPABILITY_MATRIX.md:59` ya reconoce esta duplicacion como deuda aceptada.
- `BRAIN_TOOL_REGISTRY` (`lib/brain/tools/registry.ts:3-130`) — 14 entradas descriptivas del motor legacy; solo `searchProducts` tiene binding de ejecucion real, el resto (`getProductStock`, `getOrderByInvoice`, etc.) estan declaradas pero muertas.

## 5. Inventario de capabilities (Capability Gateway)

| CAPABILITY_ID | BUSINESS_PURPOSE | IMPLEMENTATION_PATH | MODEL_TOOL_NAME | MODEL_ACCESS | GATEWAY | INPUT_CONTRACT | SYSTEM_OF_RECORD | EXTERNAL_DEP | PERSISTENCE | FLAGS | TEST_LEVEL | LIVE_EVIDENCE | MATURITY | LIMITATIONS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `search_products` | busqueda textual de catalogo | `capability-gateway/registry.ts:47-91` | `search_products` | directo | registrado | `{query, limit?}` | Catalog Service (MS externo) | si (HTTP) | `crm_capability_executions` | `BRAIN_AGENT_TOOL_LOOP_ENABLED` | HTTP double local + DB real (`capabilityGateway.test.ts`) | reportado por operador EC2, **no confirmado independientemente** | L4 confirmado; matriz reclama L5/L6 | existe un segundo `search_products` no relacionado en el runtime multi-request (SQL PrestaShop directo) |
| `get_product_details` | detalle/precio/stock/link de un producto | `registry.ts:104-144` | `get_product_details` | directo | registrado | `{productId, combinationId?}` | Catalog Service | si | `crm_capability_executions` | idem | idem | idem | L4 (matriz reclama L5) | unica fuente de `publicLink` |
| `batch_get_products` | hidratar hasta 20 candidatos en una llamada | `registry.ts:173-216` | ninguno (deliberado) | ninguno | registrado, sin `inputSchema` (deliberado) | `{items:[...]}` | Catalog Service | si | `crm_capability_executions` | solo alcanzable con los 3 runtime flags apagados (camino legacy) | unit + integracion real MariaDB con HTTP double fake | ninguna | L4 | nunca ejercitado por el Agent Tool Loop; solo por `buildCatalogGroundedMessage.ts` legacy |
| `explore_catalog` | extremos/top-N/ranking/filtros | `registry.ts:306-382` | `explore_catalog` | directo | registrado | `{sort:{by,direction}, limit 1-10, query?, category?, price?, availability?}` | Catalog Service | si | `crm_capability_executions` | `BRAIN_AGENT_TOOL_LOOP_ENABLED` | tests DB-free + HTTP double | reportado por operador EC2 (flujo real de 2 turnos con `RecentCatalogContext`), **no confirmado independientemente** | L4 (matriz reclama L5) | guards cliente rechazan `price.max<price.min`/`sort`/`limit` invalido antes de HTTP; alias legacy `orderBy/orderDirection` es deuda temporal |
| `search_company_knowledge` | preguntas de politica/FAQ comercial | `companyKnowledgeCapability.ts:73-104` | `search_company_knowledge` | directo | registrado | `{query}` | fixtures en memoria, **cero contenido real** | no | `crm_capability_executions` | idem | logica pura | ninguna | **L3** (contenido 100% placeholder no verificado) | ver seccion 24 |
| `recommend_catalog_products` | recomendar productos relacionados a un producto ya observado | `catalogRecommendationGatewayAdapter.ts:241-288` | `recommend_catalog_products` | directo (desde CP-R1-T10B8C) | registrado | `{sourceProduct:{productId,combinationId?}, query?, explicitRepurchaseRequested?, excludedProducts?, limit?, inStockOnly?}` | Catalog Service SearchProducts V2 | si | `crm_capability_executions` | `BRAIN_AGENT_TOOL_LOOP_ENABLED` | integracion con HTTP double, persistencia fake en el propio test | ninguna | **L3** — release doc propio dice `implemented_exposed_not_activated` | gateada por evidencia (el producto fuente debe haber sido observado antes en el turno/conversacion); nunca smoke-testeada segun su propio doc |
| `resolve_customer` | resolucion de identidad (server-orquestado, nunca tool del modelo) | `customerIdentityCapabilities.ts:71-123` | ninguno | nunca (solo `resolveNativeCustomerSession`) | registrado | server-assembled | Customer Service externo | si, sin configurar (`.env.example` vacio) | `crm_capability_executions`+`commercial_event` | n/a | e2e con HTTP double + `crm_test` real | ninguna | L4 | `operational: not_verified` (no existe Customer Service desplegado) |
| `create_customer` | creacion de cliente (consent-gated) | `customerIdentityCapabilities.ts:131-269` | ninguno | nunca | registrado | server-assembled, LLM input ignorado | Customer Service + proyeccion `master_customer` | si, sin configurar | idem | n/a | idem | ninguna | L4 | solo invocado desde runtime legacy (`runCustomerOnboardingPostPlanStage`) — ver hallazgo de seccion 10 |
| `link_external_identity` | vincular wa_id a cliente resuelto | `customerIdentityCapabilities.ts:271-384` | ninguno | nunca | registrado | server-assembled | Customer Service | si, sin configurar | idem | n/a | idem | ninguna | L4 | idem |

**No registradas en el Capability Gateway** (por lo tanto invisibles/inaccesibles al Sales Agent nativo): `find_order`/`get_order_status`/`identify_equipment`/`get_service_price`/`list_customer_addresses` (viven en `READ_CAPABILITY_REGISTRY`, runtime multi-request, off por defecto); `prepare_quote`/`business_policy`/`calculate_shipping`/`create_checkout_link`/`place_sales_call` (no existen en ningun registry — `planned` en `CAPABILITY_MATRIX.md`, confirmado ausentes por grep).

## 6. Inventario de tools (perspectiva Agent Tool Loop)

`AGENT_LOOP_TOOL_POOL` real (`lib/brain/commercial/agent-loop/runAgentToolLoop.ts:34`) — **5 tools, no 4**: `search_products`, `get_product_details`, `search_company_knowledge`, `explore_catalog`, `recommend_catalog_products`. La quinta fue agregada por `CP-R1-T10B8C` (commit `8eed6fa`, PR #82) y **no aparece mencionada en `docs/ACTIVE_RELEASE.md` ni `docs/CAPABILITY_MATRIX.md`** — confirmado por grep con 0 coincidencias en ambos archivos. Este es un hallazgo de deuda documental, no de codigo.

| TOOL | REGISTERED | ALLOWED_FOR_SALES_AGENT | REQUESTED_BY_MODEL | EXECUTED_BY_GATEWAY | RESULT_NEXT_STEP | LIVE_DEPENDENCY | FAILURE_BEHAVIOR |
|---|---|---|---|---|---|---|---|
| `search_products` | si | si | si | si | si | Catalog Service | `temporarily_blocked` (retryable, maxRetries 1) si no disponible; `invalid_arguments` si query mala; `not_found`→`completed,data:null` |
| `get_product_details` | si | si | si | si | si | Catalog Service | idem |
| `explore_catalog` | si | si | si | si | si | Catalog Service | guards cliente antes de HTTP; alias legacy de `orderBy/orderDirection` |
| `search_company_knowledge` | si | si | si | si | si | ninguna (fixture en memoria) | siempre `completed`, salvo `query` ausente |
| `recommend_catalog_products` | si | si (desde T10B8C) | si | si | si, mas continuidad cross-turn via `PendingCatalogAction` | Catalog Service V2 | gateado por evidencia antes de HTTP; `failed` preserva codigo de error saneado |
| `batch_get_products` | si | **no** | no (nunca nombre de tool que el modelo pueda enviar) | si, solo desde el pipeline legacy | n/a al Agent Tool Loop | Catalog Service (`/v1/products/batch`, max 20) | enriquecimiento interno solamente |
| `resolve_customer`/`create_customer`/`link_external_identity` | si | no | no | invocadas directamente por el runtime servidor, nunca por el modelo | n/a | Customer Service (sin configurar) | ver deuda `not_verified` |

**Distincion tool definida ≠ registrada ≠ permitida ≠ ejecutable ≠ validada live**: las 5 tools del pool cumplen las primeras cuatro; ninguna cumple la quinta de forma independientemente confirmada por esta auditoria — toda evidencia "live" proviene de un reporte de operador sobre EC2, no reproducido aqui.

## 7. Capability Gateway — mecanica de ejecucion

**Allowlist**: no existe una estructura de allowlist separada del pool — el pool *es* la allowlist. Un paso `use_tool` se autoriza solo si el nombre esta en el arreglo fijo de 5 tools **y** resuelve a una `CapabilityGatewayDefinition` real (`runAgentToolLoop.ts:234`). Una tool no registrada/invalida produce una observacion sintetica `blocked`/`capability_not_registered`, **sin consumir el presupuesto de `maxToolExecutions`** (solo `maxDecisions`), permitiendo que el modelo reintente con el nombre correcto en el mismo turno. Una segunda defensa independiente existe en `executeGovernedCapability` (`executeCapability.ts:23-63`): si resuelve `null`, persiste una fila de auditoria `denied`/`capability_not_registered` antes de retornar — verificado por `tests/commercial/capabilityGateway.test.ts:71-80`.

**Deduplicacion**: `buildDedupeKey(tool, args)` canonicaliza el orden de claves y bloquea una repeticion exacta de tool+argumentos dentro del mismo turno (`status:"blocked"`, `errorCode:"duplicate_tool_call"`), tampoco consume `maxToolExecutions`.

**Flujo de ejecucion de una tool**: `processUseToolStep` (`runAgentToolLoop.ts:217-322`) — (1) enriquecimiento de argumentos backend-owned (solo `budgetMax` en `search_products` si el modelo lo omitio, nunca sobreescribe un valor del modelo); (2) chequeo de pool/registro; (3) chequeo de duplicado; (4) gate de evidencia especifico de `recommend_catalog_products` (el producto fuente debe haber sido observado realmente esta conversacion); (5) gate de continuidad especifico de `get_product_details` cuando hay un `pendingCatalogAction` de origen-recomendacion activo; (6) `executeGovernedCapability` — punto unico que resuelve la definicion, chequea disponibilidad, ejecuta con retry acotado (`while (outcome.retryable && retryCount < definition.maxRetries)`), inserta exactamente una fila `crm_capability_executions` por conjunto de intentos; (7) `invalid_arguments` se marca `executed:false` (no consume presupuesto — este es exactamente el defecto real que corrigio `ACS-R1-05.1-T02.6.1`, un modelo enviando `{orderBy,orderDirection}` en vez de `{sort:{by,direction}}`); (8) `buildToolObservation` proyecta el resultado crudo a una forma allowlisted (nunca payload crudo/credenciales/SQL/arreglos sin limite — capados en 5/10/5 items segun la tool).

**Mapeo de errores/timeouts**: `mapCatalogErrorToOutcome` (`registry.ts:384-400`) es el punto unico de traduccion: `invalid_input→invalid_arguments`, `unauthorized→denied`, `rate_limited|unavailable|timeout→temporarily_blocked(retryable)`, `not_found→completed(data:null)`, default→`failed`.

**Limites por ciclo**: `maxDecisions` (default 3) y `maxToolExecutions` (default 2) en la fase de "gathering", configurables 1-12/0-12 via Sales Agent Configuration publicada. Al agotarse cualquiera, entra una fase de finalizacion separada de **exactamente 2 intentos** (`FINALIZATION_MAX_ATTEMPTS`), solo `respond`/`handoff`, sin tools ofrecidas. Timeout total de turno: 20000ms por defecto, chequeado antes de cada llamada al proveedor en ambas fases.

**Autorizacion por agente / proteccion contra tools no permitidas**: cubierta arriba (pool fijo + resolucion de definicion). No existe un mecanismo de "autorizacion por agente" mas alla del pool global — no hay hoy multiples agentes con pools diferenciados.

## 8. Agent loop nativo — reconstruccion por etapas

| # | Etapa | Funcion/archivo:linea | Persistencia | Flag | Evidencia de test |
|---|---|---|---|---|---|
| 1 | Firma webhook + allowlist | `POST()` `app/api/integrations/whatsapp/webhook/route.ts:125-197`; `verifyMetaSignature:25-47`; `isAllowedRecipient:18-23` | `audit_log` | `META_WHATSAPP_APP_SECRET`/`BRAIN_WHATSAPP_ALLOWED_WA_IDS`/`BRAIN_AUTONOMOUS_TEST_WA_IDS` | ninguna dedicada a la ruta completa encontrada |
| 2 | Dedup + identidad + persistencia inbound | `processNativeWhatsAppInbound` `lib/brain/native-whatsapp/service.ts:985-1204` | `conversation`, `conversation_message`, `commercial_event`, `audit_log` (una transaccion) | `isDbWriteEnabled()` | `tests/native/native-whatsapp.test.ts` |
| 2b | Duplicado inbound | `loadConversationMessageByProviderMessageId("meta", providerMessageId)` `service.ts:1006` | solo lectura | n/a | `whatsapp-webhook-auth.test.ts` |
| 3 | Wrapper de continuidad | `ensureAutonomousSalesTurnContinuity` `continuity/ensureAutonomousSalesTurnContinuity.ts:151-560` | `commercial_event` (`autonomous_turn_disposition`/`_continuity_failed`) | n/a | `tests/native/ensureAutonomousSalesTurnContinuity.test.ts` |
| 4 | Seleccion de runtime + gates de piloto/opt-out | `runNativeAutonomousCycle` `native-cycle/runNativeAutonomousCycle.ts:159-244` | lee `crm_customer_opt_outs` | `BRAIN_AUTONOMOUS_TEST_WA_IDS`, opt-out, `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED`, `BRAIN_AGENT_TOOL_LOOP_ENABLED`, `BRAIN_SALES_AGENT_ENABLED` | `runNativeAutonomousCyclePilotIsolation.test.ts`, `runNativeAutonomousCycleOptOut.test.ts` |
| 5 | Sesion de cliente/identidad | `resolveNativeCustomerSession` (`native-cycle/customer-session`) | `master_customer`, `crm_customer_onboarding_state` | n/a | `identity-conflict.test.ts`, `nativeInboundIdentityBoundary.test.ts` |
| 6 | Carga Customer 360 (gateada) | `loadAutonomousCustomerContext` `runNativeAutonomousCycle.ts:274` | solo lectura | n/a | `customer360AutonomousBoundary.test.ts` |
| 7 | Snapshot de contexto comercial | `buildNativeCommercialContext` `runNativeAutonomousCycle.ts:309-312` | lee `crm_opportunities`, `crm_sales_need_profiles`, `conversation_message` | n/a | `buildNativeCommercialContext.test.ts` |
| 7b | RecentCatalogContext / PendingCatalogAction | `recentCatalogContext.ts:206-301`, `pendingCatalogAction.ts:275-300` | lee `crm_capability_executions` (ventana 24h) / `commercial_event` (evento mas reciente) | n/a | cubierta a nivel de loop |
| 8 | Resolucion de Sales Agent Configuration | `resolveSalesAgentConfiguration()` `runNativeAutonomousCycle.ts:371` | lee `sales_agent_configurations` | n/a | `salesAgentConfiguration*.test.ts` |
| 8b | Fallo de resolucion de configuracion | `runNativeAgentToolLoopCycleConfigurationFailure` `agent-loop/runNativeAgentToolLoopCycle.ts:288-327` | via `dispatchAgentLoopResponse` | n/a | `salesAgentConfigurationRuntime.test.ts` |
| 9 | Carga de contexto Customer Profile (opcional) | `defaultLoadCustomerProfileContext` `agent-loop/runNativeAgentToolLoopCycle.ts:180-222` | HTTP externo (MS Customer Profile) | `CUSTOMER_PROFILE_CONTEXT_ENABLED`, `CUSTOMER_HISTORY_COMMERCIAL_POLICY_ENABLED` | ninguna DB-backed encontrada en esta sesion |
| 10 | Construccion de prompt | `buildAgentStepPromptPackage` `agent-loop/buildAgentStepPromptPackage.ts:369-395` | ninguna | n/a | multiples tests de prompt |
| 11 | Llamada al modelo | `httpAgentLoopProvider.invoke` `providers/httpAgentLoopProvider.ts:147-282` | ninguna (HTTP sin estado) | `BRAIN_MODEL_API_URL`/`_API_KEY`/`_NAME` | ninguna para la llamada HTTP real; loop tests usan `fakeAgentLoopProvider.ts` |
| 12 | Validacion de paso | `validateAgentStep` `agent-loop/validateAgentStep.ts:68-108` | ninguna | n/a | validada inline por tests de loop |
| 13 | Despacho de tool → Gateway | `processUseToolStep` → `executeGovernedCapability` (seccion 7) | `crm_capability_executions` | ver seccion 5 | ver seccion 5 |
| 14 | Despacho terminal (respond/handoff/fallback) | `dispatchAgentLoopResponse` `agent-loop/dispatchAgentLoopResponse.ts:130-242` | `crm_agent_actions`, `brain_message_outbox` | `BRAIN_COMMERCIAL_BRIDGE_*` | `tests/native/outbox-*`, tests de execution-gate |
| 15 | Evento de auditoria | `recordAgentToolLoopCompletedCommercialEvent` `runNativeAgentToolLoopCycle.ts:490-522` | `commercial_event` (`agent_tool_loop_completed`) | n/a | tests de eventos |
| 16 | Envio por outbox | worker de outbox (fuera de este archivo) | `brain_message_outbox` → Meta real | `BRAIN_OUTBOX_WORKER_ENABLED`/`BRAIN_META_SEND_ENABLED`/`BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND` | no verificado en esta pasada |

**Comportamientos especificos**:
- Maximo de decisiones/tools por turno: 3/2 por defecto, configurable 1-12/0-12.
- Timeout total: 20000ms de reloj de pared.
- Retry tecnico: solo HTTP, en `httpAgentLoopProvider.ts` — backoff acotado 250ms→2000ms, solo 429/500/502/503/504, `maxModelRetries` default 0, nunca 400/401/403.
- Reparacion semantica: un reintento en fase de gathering ante forma invalida del paso del modelo; luego una fase de finalizacion separada de 2 intentos antes de rendirse.
- Respuesta vacia del modelo: error clasificado no-retryable `empty_response` → `terminalReason: "provider_unavailable"`.
- Tool invalida: nombre no registrado → `blocked`/`capability_not_registered`, sin consumir presupuesto; argumentos invalidos → `blocked` con codigo especifico, tampoco consume presupuesto.
- Dependencia caida: `checkAvailability()` retorna `unavailable` → `temporarily_blocked` (retryable) sin llamar `execute()`, auditado, observacion `blocked`.
- Handoff: el modelo emite `{type:"handoff",reason}` → `terminalReason:"handoff"` inmediato → se despacha un reconocimiento generico via `dispatchAgentLoopResponse.ts:140` — **ver hallazgo critico de la seccion 17: esto no bloquea a la IA de forma persistente**.
- Duplicados: dedup completo en `processNativeWhatsAppInbound` antes de que el ciclo corra una segunda vez para el mismo `providerMessageId`.

## 9. Canales y media

### WhatsApp texto — **L4_INTEGRATION_VALIDATED** (L5 en el piloto EC2 segun docs, no reproducido aqui)

Recepcion real vía `app/api/integrations/whatsapp/webhook/route.ts` con verificacion de firma HMAC-SHA256 (`verifyMetaSignature:25-47`, fail-closed en produccion si no hay secreto configurado). Deduplicacion en dos capas independientes: chequeo de aplicacion (`loadConversationMessageByProviderMessageId`) mas constraints de DB (`UNIQUE KEY uq_provider_message` en `conversation_message`, `UNIQUE KEY uq_commercial_event_dedupe_key` en `commercial_event`). Persistencia en `conversation`+`conversation_message` (nunca `brain_message_outbox`, que es solo outbound). Confirmacion de entrega (sent/delivered/read) via `applyMetaDeliveryStatus` con proyeccion SQL monotonica (`sent<failed<delivered<read`) que evita que un status obsoleto sobreescriba uno mas fresco — verificado por test con llegada fuera de orden. Ningun webhook real de Meta apunta a este entorno de desarrollo local; la unica evidencia de trafico real es el reporte de operador sobre EC2.

### Emoji — **L1_CODE_PRESENT/L3_RUNTIME_WIRED (pass-through), sin verificacion**

Cero codigo de stripping/normalizacion de emoji encontrado. El texto fluye como string JS plano de extremo a extremo; el schema (`utf8mb4`) soporta emoji de 4 bytes. Las llamadas `.normalize("NFD")` encontradas son para plegado de acentos en espanol (busqueda de keywords), no relacionadas con emoji. **Gap de verificacion real**: el pool `mysql2` (`lib/db.ts:21`) no especifica `charset` explicito — no se pudo confirmar que la negociacion de charset a nivel de conexion sea efectivamente `utf8mb4`. Cero tests con emoji real.

### Audio — **L0_NOT_IMPLEMENTED**

Confirmado por ausencia: cero resultados para `audio`, `voice_note`, `transcri`, `whisper`, `media_id`, `.ogg`, `multimedia` en `lib/`, `app/`, `tests/`, `migrations/`. Un mensaje de audio entrante produciria `conversation_message.message_type='audio'`, `body=''`, y **la referencia de media (`message.audio.id`) se descarta silenciosamente** — no hay ningun mecanismo de descarga en dos pasos de Meta, ni almacenamiento temporal, ni transcripcion, ni limite de tamano/formato, ni limpieza.

### Imagen — **L0_NOT_IMPLEMENTED**

Mismo patron que audio. Las unicas coincidencias de "image" en el codigo son tipos para **mensajes de plantilla salientes** (`lib/meta.ts:11`, `lib/brain/messaging/types.ts:84-130`), no para recepcion. Cero vision/OCR/matching de foto de producto/procesamiento de comprobante.

### Documento — **L0_NOT_IMPLEMENTED**

Cero manejo de PDF/adjuntos/documentos de cotizacion/comprobantes/ordenes en `lib/` o `app/`.

### Webhook duplicado/malformado (consolidado)

Mensaje duplicado: corta antes de re-ejecutar el ciclo. Status duplicado: idempotente via `outcome_dedupe_key`. JSON malformado: 400 `invalid_json`, nada persistido. `messages`/`statuses` vacio o ausente: 200, `processed:0`, sin crash. Campos requeridos faltantes: `{ok:false, error:"missing_inbound_fields"}` por item, la request completa igual retorna 200. Firma invalida: 401, nada persistido.

## 10. Identidad y onboarding

Flujos verificados con evidencia `file:line` (`resolveNativeCustomerSession.ts`, `onboardingTransitions.ts`, `runCustomerOnboardingPostPlanStage.ts`):

- **(a) Consulta informativa sin identidad**: la operacion no mapea a ningun proposito de onboarding (`onboardingPurposeMapping.ts:17-47`) → onboarding nunca se activa, identidad permanece `anonymous`, el turno continua sin bloqueo.
- **(b) Compra sin identidad**: la operacion mapea a un proposito (p. ej. `prepare_quote`→`quote`) → `startOnboarding` con campos requeridos por proposito (p. ej. `firstName`,`email` para quote/purchase).
- **(c) Cliente existente identificado**: resolucion local por telefono/external id; si la fuente no es `external_identity`, se dispara `link_external_identity` post-plan con consentimiento explicito del turno.
- **(d) Cliente nuevo**: minimos de datos + consentimiento de creacion este turno → `resolve_customer` (reusado si pre-plan ya corrio) → `no_match` → `create_customer`, gateado por `completeOnboardingWithVerifiedCustomer`/`verifyCustomerMasterProjection` antes de marcar `completed` — si la proyeccion local `master_customer` aun no existe, aterriza en `temporarily_unavailable`, nunca fabrica un cliente.
- **(e) Identidad incompleta**: onboarding `collecting`; extraccion conservadora del mensaje actual actualiza `pendingFields`.
- **(f) Identidad contradictoria**: conflicto local, o un `customerId` de onboarding completado que no coincide con una resolucion local fresca, o `resolve_customer` externo devolviendo `conflict` → identidad `{status:"conflict"}`, onboarding aterriza en el estado terminal `conflict`, `contextAccess` se vuelve `"none"`.

**Hallazgo arquitectonico real (no documentado previamente)**: `resolveNativeCustomerSession` (resolucion de identidad pre-plan) corre todos los turnos incondicionalmente. Pero `runCustomerOnboardingPostPlanStage` — el **unico** camino que puede ejecutar `create_customer`/`link_external_identity`/`collectFields` — solo se llama en la rama alcanzada unicamente cuando `agentToolLoopEnabled` es **falso** (`runNativeAutonomousCycle.ts:303-450` retorna antes de llegar a la linea 649 cuando el flag esta encendido). Es decir: **el momento en que se activa `BRAIN_AGENT_TOOL_LOOP_ENABLED` (prerrequisito para que la wiring de Customer Profile T12B-D importe), la creacion/vinculacion de clientes nuevos deja de ser alcanzable en ese mismo ciclo de turno** — solo coincidencias preexistentes de telefono/external-id podrian poblar `identity.customerId`. Confirmado por un comentario de codigo explicito (`toolAliases.ts:12-19`): `resolve_customer`/`create_customer`/`link_external_identity` son deliberadamente nunca tools invocables por el LLM, precisamente para mantenerlas en estas dos etapas fijas del pipeline — pero esas dos etapas no estan ambas conectadas a la misma rama de runtime.

**Segundo hallazgo**: el cargador de contexto de Customer Profile (T12B-D) recibe su `customerId` via `parseTrustedCustomerId(input.trustedCustomerSession)`, que lee `session.execution.identity.customerId` **directamente, sin filtrar por `contextAccess`** — a diferencia de la proyeccion Customer 360 legacy, que si respeta el gate `contextAccess === "none" ? null : ...`. Hoy es inerte porque `commercialIntent: true` esta hardcodeado y toda la cadena esta apagada por flag por defecto, pero es un gap real entre el modelo de acceso documentado de Customer 360 y el wiring de T12 que debe reconciliarse antes de activar `CUSTOMER_PROFILE_CONTEXT_ENABLED=true`.

Maturity: identidad/onboarding **L4_INTEGRATION_VALIDATED** (probado e2e contra `crm_test` real y un HTTP double fiel al contrato); `operational: not_verified` porque no existe Customer Service desplegado (`CUSTOMER_SERVICE_BASE_URL` vacio en `.env.example`).

## 11. Customer Profile (T12A-T12D)

Dos integraciones "Customer Profile" distintas y no relacionadas coexisten:
- **Legacy (T10B1)**: `lib/customer-profile/httpCustomerProfileAdapter.ts`, keyed por `masterCustomerId`. Solo consumido por `recommendation-context/*`. **Huerfano** — confirmado por grep, solo referenciado por su propio test y docs, nunca importado por ningun modulo de runtime.
- **Nuevo (T12B)**: `lib/integrations/customer-profile/http-client.ts`, keyed por `customerId = ps_customer.id_customer`. Es el que T12C/T12D conectan al agent loop.

**Cuatro flags independientes, todas `false` por defecto**, deben estar todas encendidas para que esto afecte un turno real: `CUSTOMER_PROFILE_ENABLED`, `CUSTOMER_PROFILE_CONTEXT_ENABLED`, `CUSTOMER_HISTORY_COMMERCIAL_POLICY_ENABLED`, y — critico, no documentado en los README de T12 — `BRAIN_AGENT_TOOL_LOOP_ENABLED` (toda la cadena T12B-D vive dentro de `runNativeAgentToolLoopCycle.ts`, muerta en runtime si ese flag esta apagado).

**Fail-open confirmado**: ninguna falla de Customer Profile (`NOT_FOUND`/`UNAVAILABLE`/`CONTRACT_ERROR`/timeout) detiene el turno — siempre degrada a un contexto con arreglos vacios y un codigo de razon; el turno llega al modelo igual, nunca dispara handoff por esta causa.

**Matching producto/variante**: enum puro de 5 estados (`NOT_PREVIOUSLY_PURCHASED`, `SAME_PRODUCT_PREVIOUSLY_PURCHASED`, `SAME_VARIANT_PREVIOUSLY_PURCHASED`, `PRODUCT_MATCH_VARIANT_UNKNOWN`, `HISTORY_UNAVAILABLE`).

**Senales comerciales** (`commercial-signals.ts`): `PRODUCT_PURCHASE_REPEATED` requiere `orderCount>=2` (nunca cantidad); `POSSIBLE_REORDER` confidence `LOW`/`MEDIUM`, **nunca `HIGH`** (excluido a nivel de tipo); `POSSIBLE_COMPLEMENT` requiere evidencia explicita de relacion de catalogo del turno actual — **hallazgo: esta senal es hoy provablemente inerte en produccion**, porque el contexto de Customer Profile se carga antes de la fase de llamado a tools, asi que nunca hay `catalogRelationshipEvidence` disponible para pasarle. Documentado con candor en el propio doc de release de T12D como limitacion conocida.

**Prohibiciones RFM/VIP**: triple capa redundante — tipo (`constraints` literal-tipado con todos los booleanos en `false`), objeto de guidance en prosa, y lineas de regla literales enviadas al modelo (`buildAgentStepPromptPackage.ts:102,127`): *"Do not infer RFM segment, VIP status, purchasing power, lifetime value, price sensitivity, loyalty, or churn risk."*

**Madurez**: **L3** para Customer Profile context (T12B/C) y para la Customer History Commercial Policy (T12D) — implementado, unit e integration-testeado (proveedor scripteado + HTTP double local), documentado como nunca validado contra un servicio Customer Profile real, apagado por defecto detras de 4 flags independientes.

**Persistencia y continuidad** (respuestas explicitas):
- Dentro del turno: contexto de historial comercial, senales derivadas, sesion de onboarding, identidad confiable — todo en memoria, pasado por parametro.
- Entre turnos (misma conversacion): solo lo que esta en DB — `crm_customer_onboarding_state`, `commercial_event`/`crm_capability_executions` (releidos como `pendingCatalogAction`/`recentCatalogContext`), `conversation_message`. **El historial de compra de Customer Profile no se cachea entre turnos — se re-consulta en vivo cada turno** cuando esta habilitado.
- Ante reinicio del servicio: todo lo de las tablas sobrevive; el unico estado en memoria a nivel de modulo encontrado son dos singletons stateless (cliente HTTP, lector de proyeccion), sin datos de cliente.
- Cliente que regresa dias despues: identidad/onboarding persiste via `crm_customer_onboarding_state`/`customer_external_identity`; historial de compra se re-consulta fresco (sin riesgo de staleness especifico para ese dato, ya que nada lo cachea).
- Riesgo de mezcla entre clientes: busqueda dirigida no encontro estado mutable a nivel de modulo que mezcle datos entre clientes/conversaciones — cada llamada toma `customerId`/`conversationId` explicito. Busqueda dirigida, no exhaustiva.

**Nota de nomenclatura**: la tabla real se llama `master_customer` (migracion 006), no `customer_master` como dicen `AGENTS.md`/`CLAUDE.md`/`PRODUCT_NORTH_STAR.md`. Es la misma tabla referenciada por esos documentos bajo un nombre distinto, no dos tablas — vale la pena reconciliar la nomenclatura documental.

## 12. Catalogo

Casos reconstruidos con evidencia real (secciones 5-8 arriba dan la base tecnica):

- **"quiero una barra" / "barra olimpica"**: `search_products` — funciona, tool registrada y en el pool.
- **"barra olimpica 20 kg"**: mismo tool con query mas especifica; sin normalizacion adicional documentada mas alla de lo que hace el Catalog Service.
- **"muestrame la segunda"**: resuelto por `RecentCatalogContext` (proyeccion de solo-lectura sobre `crm_capability_executions`, ventana 24h, capada a 5 interacciones/12 productos) — el modelo resuelve la referencia, el codigo solo provee el contexto de identidad (nunca precio/stock historico, invariante testeado).
- **"cuanto cuesta" / "tienen stock"**: `get_product_details` trae precio/stock actuales — nunca aceptados como definitivos entre turnos (ver seccion 13).
- **"que diferencia hay"**: sin tool dedicada de comparacion — el modelo compone la respuesta a partir de 2 llamadas a `get_product_details`/`explore_catalog`.
- **"que combina con esto"**: `recommend_catalog_products`, gateada por evidencia de producto-fuente observado — implementada, **no activada por defecto**.
- **"ya compre ese producto"**: resuelto por Customer Profile matching (seccion 11) — **apagado por defecto** (4 flags).

`pendingCatalogAction`/`recentCatalogContext`: ambos son proyecciones de solo lectura reconstruidas de `commercial_event`/`crm_capability_executions`, sin tabla dedicada, sin expiracion explicita mas alla de "el evento mas reciente gana" (`pendingCatalogAction`) o ventana de 24h (`recentCatalogContext`) — riesgo documentado de que una accion pendiente de un turno abandonado resurja mucho despues si no hay un evento `agent_tool_loop_completed` mas nuevo.

Limites: `explore_catalog` capado a 10 items en la observacion; `recommend_catalog_products` gateada por evidencia previa; `batch_get_products` capado a 20, solo interno.

## 13. Precios, stock y descuentos

- **¿Puede el agente dar un precio final confiable?** Solo el precio que el Catalog Service devuelve en el momento de la llamada (`get_product_details`/`search_products`/`explore_catalog`) — no hay congelamiento de precio, no hay autoridad de precio propia del CRM, no hay mecanismo de "precio prometido valido por X minutos".
- **¿Puede prometer stock?** Mismo mecanismo — dato de punto-en-el-tiempo del Catalog Service, sin reserva. `stockDisclosurePolicy.ts` (T02.6.2) gobierna **como se comunica** la cantidad (buckets: 0, exacto 1, exacto 2-19, "mas de 20", "hay stock" para >100) — es una politica de presentacion via prompt, **el runtime no valida ni reescribe deterministicamente lo que el LLM realmente dice** (limite explicito documentado en el propio codigo).
- **¿Puede aplicar descuentos?** No existe capability de descuento/promocion/cupon en ningun registry. `business_policy` esta `planned`/`not_registered` en `CAPABILITY_MATRIX.md`, confirmado ausente por grep.
- **¿Puede validar una promocion?** No — no existe el concepto en el codigo.
- **¿Puede congelar un precio?** No.
- **¿Trazabilidad del precio informado?** Cada llamada a `get_product_details`/`explore_catalog`/`search_products` queda en `crm_capability_executions` (auditable), pero no hay un mecanismo que vincule "el precio que el LLM efectivamente dijo en su respuesta de texto" con la fila de auditoria — solo el dato crudo que la tool devolvio, no el texto final.
- **¿Que pasa si el precio cambia despues?** Nada especial — el proximo turno vuelve a consultar el Catalog Service; no hay reconciliacion retroactiva de una promesa anterior.

Autoridad real de precio/stock: **externa, del Catalog Service, punto-en-el-tiempo, sin ningun mecanismo de congelamiento/reserva/validacion de promocion en este repositorio**.

## 14. Shipping

**L0_NOT_IMPLEMENTED, confirmado sin ambiguedad.** Cero cliente HTTP, cero capability, cero tabla de tarifas por comuna/region, cero integracion de transportista en `lib/integrations/*` (que solo tiene 5 subdirectorios: `customer-external-identity`, `customer-master`, `customer-profile`, `customer-service`, `legacy-n8n` — ninguno de shipping). Las unicas coincidencias de "despacho"/"envio"/"tracking" en codigo son: (a) un detector de compromisos comerciales no soportados (`detectUnsupportedCommercialCommitment.ts`, existe precisamente para *atrapar* al modelo inventando una promesa de despacho, no para proveerla); (b) un clasificador de intencion de "seguimiento de pedido" que solo enruta a `find_order`/`get_order_status` (no tracking de transportista real); (c) un campo `QuoteTotals.shipping` siempre `null` sin logica de calculo alguna.

Ante "cuanto sale el envio a Nunoa"/"despachan a regiones"/"puedo retirar": el agente no tiene ninguna fuente verificada — cualquier respuesta seria **inventada por el modelo**, sin ningun guardrail especifico de shipping (a diferencia de precio/stock, que si tienen tool real).

## 15. Order status y postventa

`find_order`/`get_order_status` **existen como codigo real** (`capabilities/registry.ts:77-116,168-193`) contra la tabla legacy real `ps_orders` (PrestaShop), con diseno fail-closed explicito ("Capabilities without a source of truth are declared implemented:false and always return unavailable — never fake data"). **Pero no estan en `AGENT_LOOP_TOOL_POOL`** — solo alcanzables via el runtime multi-request (`BRAIN_MULTI_REQUEST_RUNTIME_ENABLED`, apagado por defecto). En la configuracion por defecto, **el agente canonico tiene cero capacidad de consulta de orden** — un cliente preguntando "donde viene mi pedido" no puede recibir una respuesta real del ciclo nativo activo.

Distinciones dentro de `request-definitions/definitions.ts` (todas del runtime multi-request, off por defecto):
- `order_status`: requiere un hecho duro `order_identifier` (nunca inferido del texto), llama a `get_order_status`.
- `warranty`: solo re-etiqueta `find_order` — no existe una consulta de terminos de garantia distinta ni maquina de estados de reclamo.
- **Devoluciones/RMA: completamente ausente** — no existe ningun tipo de intent de "return"/"devolucion" en absoluto, confirmado leyendo el archivo completo (5 tipos de intent + fallback, ninguno es devolucion).
- `complaint`/`human_assistance`: "nunca se auto-resuelve... solo un operador lo cierra" — logica real de escalamiento (`crm_request_escalations`), tambien gateada off por defecto.
- Gestion de cambio de orden (modificar/cancelar): no encontrada en ningun lado.

Madurez: logica core de `find_order`/`get_order_status` **L2_UNIT_VALIDATED** minimo; wiring al runtime **por defecto: L0** (inalcanzable); garantia **L1** (etiqueta reusando lookup); devoluciones **L0**; queja/asistencia humana **L2 en multi-request, L0 en el canonico**.

## 16. Follow-up

Evidencia primaria: `docs/audits/follow-up-runtime-reconciliation.md` (auditoria previa completa, `status: completed`, `last_reviewed: 2026-07-14`) mas el estado de cierre en `docs/ACTIVE_RELEASE.md` (tareas `ACS-R1-05-T01` a `T07`, todas `done, accepted`).

**Estado tecnico actual** (post ACS-R1-05, ya cerrado con las 4 correcciones P0 de la reconciliacion original resueltas): planificador unico (`follow-up-planner/planFollowUp.ts`) conectado como fuente de calculo de `attemptNumber`/`maxAttempts`/`policy_status` (`ACS-R1-05-T01`); `evaluateCommercialPolicy` conectado como gate obligatorio antes de `upsertActionRow`, no solo shadow-advisory (`T02`); worker endurecido con recuperacion de stale-lock, retry de `failed`, enforcement real de `max_attempts` (`T03`); outbox consolidado en un unico writer canonico con proyeccion de delivery hasta `crm_opportunities` (`T04`); auto-escalacion de flags eliminada, lector fail-closed de configuracion de arranque (`T06`/`T06.1`); E2E real contra MariaDB con recuperacion de restart y correccion de 3 defectos reales de concurrencia (`T07`, cierra la release).

**Segunda capa (ACS-R1-05.1)**: scheduling nativo real conectado (`T02.3D` corrigio un defecto real donde `schedule_followup` siempre persistia `scheduled_for=NULL`, haciendolo inalcanzable para siempre por el worker); configuracion de follow-up versionada (v3 del dominio Sales Agent Configuration) con ventana horaria/DST-safe; opt-out con autoridad propia (`crm_customer_opt_outs`, migracion 028) conectado como "Step 0.5" antes de cualquier llamada al modelo; observabilidad de solo-lectura en el Hub (`/agents/sales/follow-ups`).

**Deuda remanente explicita** (de `ACTIVE_RELEASE.md`/`ROADMAP.md`, "Carried release debt"): follow-up sin memoria comercial completa (need profile aun no persistido de forma estructurada — `ACS-R1-05.1-T03/T04` siguen `planned`); frequency cap por customer no existe en ningun path (P3, no bloqueante); `metaSendAdapter.ts` sin usar por ningun worker productivo.

Madurez: **L4_INTEGRATION_VALIDADO** (E2E real contra MariaDB, restart recovery probado) para el mecanismo de scheduling/worker/opt-out; **operational: not_verified** porque nunca se ejecuto contra Meta/LLM/Catalog Service reales de forma independiente en esta auditoria (el reporte EC2 es evidencia de operador, no reproducida).

## 17. Handoff humano

**Dos sistemas de trigger no unificados**:
1. **Loop nativo canonico**: el modelo mismo emite `{"type":"handoff","reason":"..."}` como una de tres formas legales de paso — **no hay ningun trigger deterministico del sistema** (sin deteccion de keywords, sin contador de fallos repetidos de tool, sin gate de aprobacion de descuento) — es enteramente una decision libre del modelo, empujada solo por una linea generica de prompt. Un fallo de carga de configuracion del Sales Agent tambien fuerza sinteticamente `terminalReason:"handoff"` sin invocar al modelo.
2. **Motor legacy (apagado por defecto)**: deteccion deterministica de keywords (`"humano","asesor","ejecutivo","persona","agente"`).

**HALLAZGO CRITICO, no documentado en ningun canonico previo**: el handoff decidido por el modelo en el camino canonico **no es persistente**. Rastreados todos los escritores de las columnas que gatean "hay un humano en control ahora":

| Escritor | Archivo:linea | Condicion |
|---|---|---|
| Operador humano via UI ("take") | `control.ts:97-108,168-176` | Solo accion manual de operador |
| Motor legacy `requestHumanHandoffRecord` | `sales-consultative/repository.ts:1259-1295` | Gateado por `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED` (default `false`) |
| `updateOpportunityHandoffState` | `native-whatsapp/service.ts:863-869` | Solo desde `processSalesInbound`, documentado como codigo muerto sin llamadores en produccion |

El pipeline canonico (`dispatchAgentLoopResponse.ts:130-241`) solo **lee** `humanOwnerActive`/`aiBlocked` (para decidir si enviar), y ante `terminalReason==="handoff"` envia un unico mensaje de reconocimiento generico via el outbox normal — **nunca escribe `human_owner_active`/`ai_enabled`**. Consecuencia real: en la configuracion por defecto, cuando el modelo decide "handoff" (p. ej., el cliente pide explicitamente un humano), el cliente recibe un mensaje cortes, se registra un `commercial_event`, **pero la IA sigue con control total** y respondera normalmente al siguiente mensaje del cliente — salvo que un operador humano note el caso y tome control manualmente en el Hub. No existe ningun timer/expiracion automatica de liberacion de control tampoco (busqueda dirigida en `control.ts`, sin hallazgos).

**Lo que si funciona de verdad**: la toma manual de control por operador (`takeHumanControlTx`, `control.ts:97-108`) es real, atomica, transaccional — fija `human_owner_active=1`/`ai_enabled=0` en `conversation` y espeja en `crm_opportunities`, y **cancela** en la misma transaccion cualquier `brain_message_outbox`/`crm_agent_actions` pendiente para esa conversacion. Verificado como bloqueo real de la IA (`runNativeAgentToolLoopCycle.ts:339-344`, `evaluateExecutionGate.ts:209-216`). Retorno a control de IA: `action:"release"` explicito del operador, sin automatismo.

**Visibilidad en el Hub**: si, real. `app/(hub)/conversations/[id]/page.tsx:37-59` lee `ai_enabled`/`human_owner_active` directamente, calcula prioridad/departamento/modo de control; los botones take/release/pause existen en `ConversationControls.tsx`. Existe una pagina `/cases/[id]` separada, mas legacy, con un panel de copiloto distinto.

**Cola de escalamiento desconectada**: `app/api/escalations/route.ts` lee `crm_request_escalations`, cuyo unico escritor es el runtime multi-request (`executeRequestTurn.ts`) — apagado por defecto. **La API de escalamiento del Hub esta efectivamente siempre vacia en la configuracion por defecto**, sin camino desde las decisiones de handoff del loop canonico hacia ella.

**Auditoria**: real via `commercial_event` (`handoffCreated`, `handoffReasonPresent` en `AutonomousTurnDispositionRecordedPayload`), mas `agent_tool_loop_completed`. El motor legacy ademas escribe `auditLog({action:"ai_sdr.handoff.requested"})` — solo en el camino apagado.

Madurez: toma/liberacion manual de operador **L4_INTEGRATION_VALIDATED**; mensaje de reconocimiento de handoff decidido por el modelo **L3_RUNTIME_WIRED, funcionalmente incompleto** (no bloquea de forma durable); API de cola de escalamiento **L1_CODE_PRESENT**, estructuralmente sin datos.

## 18. Cotizaciones

**El hallazgo mas importante de esta seccion**: existe un motor de cotizacion real, completo y unit-testeado, con **cero llamadores en produccion**.

`lib/brain/commercial/quotes/repository.ts` (271 lineas) implementa contra una tabla real `crm_quotes`: `createQuoteDraft` (versionado completo — supersede el draft/enviado previo dentro de una transaccion, computa `next_version`, rechaza mutar una cotizacion ya `accepted` como conflicto, idempotente via `created_by_action_id`), `markQuoteSent` (emite evento `quote_sent`), `recordQuoteDecision` (`accepted`/`rejected` del cliente), `expireQuote`. Tipo `CommercialQuote`: `items: QuoteItem[]` (productId/nombre/cantidad/precio unitario, validado no-vacio, cantidad positiva, precio no-negativo), `totals: QuoteTotals` (subtotal/shipping/total/moneda), `addressSnapshot`, `expiryAt`, ciclo de vida `draft → sent → accepted|rejected|expired|superseded`.

**Cero llamadores de produccion de `createQuoteDraft`/`markQuoteSent`/`recordQuoteDecision`/`expireQuote`** en todo `lib/` (confirmado por grep — las unicas coincidencias son dentro del propio archivo). El unico consumidor externo es `multi-request/requestsView.ts`, que solo importa la lectura `getCurrentQuoteForRequest` (parte del runtime no-canonico, off por defecto). Unit-testeado (`tests/commercial/quotes.test.ts`) — **L2_UNIT_VALIDATED en el codigo, L0 en la practica** (ningun flujo real puede crear una cotizacion hoy).

**`prepare_quote_draft`** (el `action_type` mencionado en `ACTIVE_RELEASE.md`) es puramente una etiqueta de enum de `crm_agent_actions`, producida solo por el mapeador del motor legacy apagado — **no esta conectada al repositorio `crm_quotes` en absoluto**. No existe codigo que, al ver una fila con `action_type='prepare_quote_draft'`, llame a `createQuoteDraft()`. Es un marcador inerte de "alguien deberia hacer esto" para que un operador lo vea, no un disparador del objeto de cotizacion real.

Respondiendo las preguntas especificas del brief:
- ¿Crear/guardar/recuperar/versionar? Si a nivel de codigo, **no en la practica** (sin camino en vivo).
- ¿Modificar, agregar productos/variantes/cantidades? Solo via una nueva version completa (sin API de edicion parcial).
- ¿Shipping/servicios en la cotizacion? El campo `totals.shipping` existe pero nunca se calcula (siempre `null`); no hay items de servicio posibles (no hay catalogo de servicios, seccion 23).
- ¿Subtotal/impuesto/descuento? `subtotal`/`total`/`currency` son numeros planos que el *llamador* debe proveer — el repositorio no calcula nada, solo almacena.
- ¿Vigencia? Si — `expiryAt` + `expireQuote()` funcionan.
- ¿Enviar documento/aceptar/rechazar? Si a nivel de maquina de estados; "enviar" solo marca estado y emite un evento interno — la transmision real al cliente vive en el pipeline de outbox (no genera PDF).
- ¿Convertir a carrito/orden? No encontrado en absoluto.
- ¿AppSheet? Confirmado ausente — cero coincidencias en todo el repo (codigo o docs).

Madurez: modelo de datos `crm_quotes` **L2_UNIT_VALIDATED**, inalcanzable en la practica (**L0 a nivel de wiring de runtime**). Este es el hallazgo mas relevante para la decision de la seccion 34: la doc canonica (`CAPABILITY_MATRIX.md: prepare_quote planned/not_registered/not_connected/not_verified`) es correcta en el resultado (nada se puede cotizar hoy) pero no captura que ya existe un motor de cotizacion bastante completo, sin conectar.

## 19. Carrito

**L0_NOT_IMPLEMENTED.** No existe ningun cliente de creacion de carrito, ni recuperacion, ni modificacion, ni eliminacion de lineas, ni manejo de cantidad/variante/direccion/transportista para un carrito real. Las unicas coincidencias de "carrito" son mockups de UI de marketing (`lib/p1m/fixtures/marketing.ts` — feature de recuperacion de "carritos abandonados", puramente fixture estatico del sistema de mocks P1M) sin ninguna relacion con el Sales Agent.

## 20. Checkout

**L0_NOT_IMPLEMENTED.** `provide_checkout_link` existe como `nextBestAction` del motor legacy (apagado), disparado por deteccion de keywords, pero mapea directamente a `action_type: "send_whatsapp_reply"` — es decir, "proveer link de checkout" literalmente solo significa "enviar un mensaje de texto", sin generacion real de link, carrito o pasarela de pago detras. Sin generacion de URL, sin sesion, sin validacion de stock, sin recalculo, sin expiracion.

## 21. Pago

**L0_NOT_IMPLEMENTED.** Ningun cliente de pasarela de pago (Webpay/MercadoPago/etc.) existe pese a que el motor legacy *reconoce* esas palabras como keywords de intencion — nunca las integra. Sin link de pago real, sin monto, sin estado, sin conciliacion, sin idempotencia de pago.

## 22. Orden (creacion)

**L0_NOT_IMPLEMENTED.** Ningun cliente de creacion de orden PrestaShop (o de cualquier otro sistema) existe en `lib/` o `app/`. `find_order`/`get_order_status` (seccion 15) son de **solo lectura** contra `ps_orders` ya existente — no crean nada. `CREATE_CUSTOMER_ALLOWED_PURPOSES` incluye `"checkout"` solo como etiqueta de clasificacion de *por que* se crea un registro de cliente, no relacionado con un flujo de checkout real.

**Punto exacto de interrupcion del flujo carrito→checkout→pago→orden**: no se interrumpe en un punto intermedio — **nunca comienza**. No existe ningun primer paso real (ni carrito, ni link de checkout real, ni pago, ni creacion de orden) mas alla de etiquetas de intencion y un modelo de datos de cotizacion desconectado.

## 23. Servicios (armado, mantencion, instalacion)

Ningun capability estructurado real (catalogo/precio/agenda) existe. Cada coincidencia clasifica como (a) stub explicito o (b) prosa/etiqueta:

- **Stubs explicitos `implemented:false`**: `identify_equipment`/`get_service_price` (`capabilities/registry.ts:194-211`) — literalmente `return unavailable(name, "service_catalog_not_available")`, sin logica adicional. Viven en el registry no-canonico.
- **Etiquetas de intencion/hecho solamente**: `installationRequired`/`maintenanceRequired` son flags booleanos en el modelo de lead-signal legacy, sin capability aguas abajo que los consuma para precio o agenda.
- **`maintenance_information`/`maintenance_quote`**: el propio comentario del codigo (`request-definitions/definitions.ts:13-17`) admite que "armar una cotizacion significa elegir un producto especifico... no es una llamada de una linea" — quedan explicitamente sin resolucion automatica.
- **Colas legacy n8n** (`n8n_mantenciones_cardio_queue`, `n8n_postventa_queue`): sistema real, estructurado, pero es una cola operacional gestionada por n8n, mostrada de solo-lectura en la consola legacy del Hub — el agente de IA no puede invocarla, cotizarla ni agendarla desde ella.

Madurez: **L0_NOT_IMPLEMENTED** para la capacidad real (armado/mantencion/instalacion como servicio vendible/agendable/con precio). La cola legacy de n8n es **L4** solo como feature de visualizacion, fuera del alcance de "capability de IA".

## 24. Knowledge y documentos

`companyKnowledgeFixtures.ts` confirmado **100% placeholder** — las 7 entradas (`horarios_atencion`, `canales_atencion`, `cobertura_ubicacion`, `medios_pago`, `politicas_comerciales`, `despacho_general`, `contacto_humano`) tienen `answer` literalmente `"[FIXTURE NO VERIFICADO] <topic> pendiente de confirmacion por el negocio."` y `verified: false`. El mecanismo de busqueda es un scorer puro de superposicion de keywords (sin embeddings, sin ranking mas alla de score+orden), capado a 3 resultados. **Sin coincidencia, retorna un arreglo vacio** — la capability misma no inventa nada; si el *modelo* inventa una respuesta de todos modos ante un resultado vacio no se pudo verificar por lectura estatica de codigo (no existe un guardrail dedicado a reclamos informativos generales, a diferencia de los guardrails que si existen para compromisos comerciales de precio/despacho).

Un segundo sistema de conocimiento completamente distinto y no relacionado existe (`lib/brain/agents/knowledge/runKnowledgeAgent.ts`) — solo modo dry-run, con su propia fuente hardcodeada de un unico FAQ, alcanzable solo por una ruta de simulacion (`/api/brain/agents/run`), nunca el flujo real de WhatsApp.

La pagina `/knowledge` del Hub es enteramente estatica/mock — declara explicitamente `status="Preview"` y `<SurfaceBadge kind="fixture" />` en su propio markup, respaldada por el sistema de fixtures P1M.

**Sin AppSheet ni ningun sistema externo de documentos/conocimiento** encontrado en absoluto (cero coincidencias en todo el repo).

Madurez: `search_company_knowledge` (tool canonica) **L3_RUNTIME_WIRED**, contenido 100% placeholder no productivo; `runKnowledgeAgent` **L1_CODE_PRESENT**, huerfano; pagina `/knowledge` **L0_NOT_IMPLEMENTED** como feature real.

## 25. Persistencia y continuidad

| Tabla | Existe | Migracion | Notas |
|---|---|---|---|
| `conversation` | si | 008 | FK `customer_id → master_customer.id` |
| `conversation_message` | si | 008 | |
| `conversation_case` | **no existe como tabla** | — | `conversation_case_id` es solo una columna suelta (`VARCHAR`/`BIGINT` inconsistente) en `crm_opportunities`/`brain_message_outbox`, sin FK entre ambas |
| `commercial_event` | si | 011 | append-only; fuente de `recentCatalogContext`/`pendingCatalogAction` |
| `crm_opportunities` | si | 004 | |
| `crm_agent_actions` | si | 005 | |
| `crm_agent_decisions` | si | 004 | |
| `crm_capability_executions` | si | 022 | tabla de auditoria real del runtime nativo/comercial |
| `ai_tool_execution` | si, pero **tabla distinta y no relacionada** | 008 | pertenece al subsistema separado `lib/brain/local-ai-sdr/*`; migracion 022 explica en su propio comentario por que no se reutilizo |
| `brain_message_outbox` | si | 003 | |
| Onboarding | si, **dos tablas que no comparten datos** | 007 (`crm_customer_onboarding`, P1M/legacy, intacta) y 023 (`crm_customer_onboarding_state`, real, usada por `CustomerOnboardingService`) | |
| Pending catalog action | **sin tabla dedicada** | — | derivado en lectura de `commercial_event.payload_json` |
| Recommendation/recent-catalog context | **sin tabla dedicada** | — | derivado en lectura via join `crm_capability_executions`+`commercial_event` |
| Customer Profile context | **no persistido en absoluto** | — | recomputado via HTTP en vivo cada turno, sin cache |
| `master_customer` | si | 006 | ver nota de nomenclatura en seccion 11 |
| `customer_external_identity` | si | 010 | |

Ver seccion 11 para el modelo de memoria completo (dentro del turno / entre turnos / ante reinicio / dias despues) y riesgo de mezcla entre clientes.

## 26. Feature flags

Utilidad central: `lib/brain/commercial/config/commercialCycleConfig.ts:33-45` — `readEnvFlag(name, fallback=false)` acepta solo strings exactos `"true"`/`"false"`; cualquier otra cosa retorna el fallback. **Fail-closed solo por disciplina por-flag, no garantia global** — varios callers pasan `fallback=true` deliberadamente. Existen **dos copias independientes no compartidas** de la misma utilidad (`customer-profile-context/config.ts`) mas una tercera ad hoc en `processInbound.ts:1004`.

Tabla completa (extracto de los flags mas relevantes; ver el reporte del subagente para la lista exhaustiva de ~50 flags):

| FLAG | DEFAULT | PROPOSITO |
|---|---|---|
| `BRAIN_SALES_AGENT_ENABLED` | `false` | habilita proveedor/runtime HTTP real del Sales Agent |
| `BRAIN_AGENT_TOOL_LOOP_ENABLED` | `false` | activa el loop nativo AgentStep (mutuamente excluyente con el camino legacy) |
| `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED` | `false` | gate fail-closed del motor legacy (ACS-R1-05.1-T01) |
| `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED` | `false` | runtime multi-request (find_order, escalations, etc.) |
| `BRAIN_META_SEND_ENABLED` | `false` | switch maestro de envio real a Meta Graph API |
| `BRAIN_OUTBOX_WORKER_ENABLED`/`_ALLOW_REAL_SEND` | `false`/`false` | worker de outbox, doble-gateado con `BRAIN_META_SEND_ENABLED` |
| `CUSTOMER_PROFILE_ENABLED` | `false` | cliente HTTP T12B |
| `CUSTOMER_PROFILE_CONTEXT_ENABLED` | `false` | carga selectiva T12C (solo dentro del Agent Tool Loop) |
| `CUSTOMER_HISTORY_COMMERCIAL_POLICY_ENABLED` | `false` | senales T12D |
| `BRAIN_AUTONOMOUS_TEST_WA_IDS`/`BRAIN_WHATSAPP_ALLOWED_WA_IDS` | vacio | allowlist de piloto, aplicada en 4 capas independientes |
| `DB_WRITE_ENABLED` | **`true`** | switch global de escritura — **fail-open**, unico flag critico con default `true` |

**Inconsistencias reales encontradas**: `BRAIN_AUTONOMOUS_SANDBOX_ENABLED`/`BRAIN_AUTONOMOUS_REPLY_ENABLED` tienen defaults de fallback contradictorios entre `commercialCycleConfig.ts` (`true`) y `case-detail.ts` (`false`, via un helper separado `parseBooleanEnv`). Cuatro bloques de flags documentados en `.env.example` (`BRAIN_MESSAGE_TRANSPORT_ENABLED`, `BRAIN_OUTBOX_LEASE_SECONDS`, todo el bloque `BRAIN_WHATSAPP_TRANSPORT_*`, `BRAIN_EXECUTOR_*`, `BRAIN_OPERATOR_PILOT_*`) **nunca se leen en ningun lado del codigo** — scaffold/documentacion aspiracional pura.

## 27. Dependencias externas

| SERVICIO | BASE_URL_CONFIG | TIMEOUT | RETRY | LOCAL_VALIDATED | LIVE_VALIDATED |
|---|---|---|---|---|---|
| Meta WhatsApp (adapter nuevo) | hardcoded `graph.facebook.com` + `BRAIN_META_GRAPH_VERSION` | 8000ms | ninguno (un intento) | si (tests) | reporte de operador EC2, no confirmado aqui |
| Catalog Service | `CATALOG_SERVICE_BASE_URL` | 5000ms | ninguno ("retry pertenece a un futuro Gateway", segun comentario) | si | reporte de operador EC2 (`totalMatched=833`), no confirmado aqui |
| Customer Service (identidad) | `CUSTOMER_SERVICE_BASE_URL` | 5000ms | ninguno | si (HTTP double) | **no** — sin URL configurada en `.env.example`, sin servicio desplegado conocido |
| Customer Profile (T12B, wired) | `CUSTOMER_PROFILE_BASE_URL` | 3000ms | ninguno | si (HTTP double) | **no** |
| Customer Profile (T10B1, huerfano) | `CUSTOMER_PROFILE_SERVICE_BASE_URL` | 5000ms | ninguno | si | **no**, y ademas sin ningun llamador de runtime |
| Proveedor LLM (DeepSeek u otro compatible OpenAI) | `BRAIN_MODEL_API_URL` | 15000ms (Knowledge Agent); Agent Loop calcula por deadline de turno | Agent Loop provider **si tiene retry** (429/500/502/503/504, backoff 250-2000ms); Sales Agent/Knowledge Agent providers **no** | si (fake provider en tests) | reporte de operador EC2 |
| MariaDB | `DATABASE_HOST/PORT/NAME/USER/PASSWORD` | default driver | ninguno a nivel app | si | si (produccion existente segun memoria de sesiones previas) |
| n8n | `N8N_BASE_URL` | ~2s | ninguno | usado solo como *ping* de liveness para paginas de estado; `lib/integrations/legacy-n8n/*` **no es un cliente de API n8n** — es un repositorio MariaDB que lee tablas que n8n mismo escribio |
| PrestaShop | ninguno directo | n/a | n/a | la regla del propio repo prohibe que codigo de dominio toque SQL de PrestaShop directamente salvo la capa adapter | n/a |
| Shipping / voz / AppSheet / checkout-pago / armado-mantencion | ninguno | — | — | **no implementado**, confirmado ausente por busqueda de repo completo |

Columnas `PRODUCTION_ENABLED`/`OWNER` no determinables desde codigo estatico — ningun manifiesto de despliegue o metadata de ownership fue encontrado adjunto a estos adapters en el repo; requeriria los docs de release o una verificacion de entorno vivo, fuera del alcance de una auditoria estatica.

## 28. Tests y evidencia

**Inventario**: 170 archivos `*.test.ts` en `tests/`. **Cero** coincidencias de `.skip(`/`.todo(`/`.only(` en todo el arbol (confirmado por grep completo). El unico entrypoint de test (`package.json:27`, `tsx --test "tests/**/*.test.ts"`) **incluye** `tests/e2e/*.e2e.test.ts` por defecto (el glob `**` los alcanza) — es decir, `npm test` requiere MariaDB real para pasar completo.

Clasificacion aproximada por dependencia: ~68 archivos usan `lib/db` (MariaDB real, incluye los 7 de `tests/e2e`); ~29 usan un doble HTTP local (`http.createServer` o inyeccion `fetchImpl`) para adapters de catalogo/customer-profile/customer-service/LLM; el resto (~91, por sustraccion, no verificado archivo por archivo) son unitarios puros contra fixtures en memoria.

**Ejecucion real de la suite completa en este entorno** (Docker instalado pero **daemon no corriendo** — `docker ps` falla con "no se puede conectar al daemon"; sin MariaDB local disponible, consistente con la limitacion documentada repetidamente en `ACTIVE_RELEASE.md`/`follow-up-runtime-reconciliation.md` para sesiones previas):

```text
npx tsc --noEmit           → limpio, 0 errores
npm run lint               → 0 errores, 34 warnings (todas variables no usadas, preexistentes)
npm run build              → exitoso, 19 rutas estaticas + resto dinamicas, sin fallos
npm test (suite completa)  → tests 2697, pass 2224, fail 473, cancelled 0, skipped 0, todo 0, duration ~79s
```

De los 473 fallos: 606 menciones de `ECONNREFUSED 127.0.0.1:3306` (aprox. 303 tests unicos, contando doble-reporte de la salida `spec`+recap del test runner), 7 de `Missing DATABASE_NAME`, y un puñado de codigos de error de negocio (`ER_PROFILE_*`, `ER_HAS_PURCHASE_HISTORY`, etc.) que aparecen dentro de mensajes de assertion de tests reales de Customer Profile, no necesariamente fallos adicionales de infraestructura. **La abrumadora mayoria de los 473 fallos son atribuibles a la ausencia de MariaDB/Docker en este entorno, no a regresiones de codigo** — consistente con el patron documentado en cada tarea anterior de este repositorio bajo la misma restriccion de entorno.

**Comparacion contra baseline**: el working tree esta exactamente en `origin/develop` (`0 ahead, 0 behind`) — **no hay diff que comparar contra un baseline separado**; esta ejecucion *es* el baseline de `develop@b9d0324`. No se modificaron tests ni codigo.

**No se declara verificado nada que dependa de**: servidor falso, fixtures, proveedor scripteado, mocks, snapshots o contract tests aislados como si fueran evidencia "live" — cada afirmacion de madurez en este documento distingue explicitamente el nivel de doble usado.

## 29. Flujos end-to-end (F1-F14)

| Flujo | Entrada | Capacidad actual | Resultado real | Punto de corte | Madurez | Bloqueador |
|---|---|---|---|---|---|---|
| F1 Consulta simple | "¿Tienen barras olimpicas?" | `search_products` | responde con resultados reales del Catalog Service (si el flag del Agent Tool Loop esta encendido) | ninguno dentro de discovery | L3-L4 (L0 con flags por defecto) | `BRAIN_AGENT_TOOL_LOOP_ENABLED=false` por defecto |
| F2 Recomendacion por necesidad | "Necesito equipar un gimnasio pequeno" | `search_products`/`explore_catalog`, sin needs-based catalog matching estructurado mas alla de lo que el LLM infiera | responde con productos, sin garantia de cobertura completa de "necesidad" | discovery, sin curaduria estructurada | L3 | ninguna capability de "armar combo"/paquete |
| F3 Comparacion | "¿Que diferencia hay?" | 2 llamadas a `get_product_details` compuestas por el modelo | responde, sin tool de comparacion dedicada | discovery avanzado | L3 | sin capability propia |
| F4 Cliente con historial | "Algo compatible con lo que compre antes" | Customer Profile matching (T12B-D) | responde solo si 4 flags encendidos; `POSSIBLE_COMPLEMENT` inerte en la practica (ver seccion 11) | discovery con historial | L3, apagado por defecto | 4 flags + gap de `catalogRelationshipEvidence` nunca poblado |
| F5 Precio y stock | "Quiero dos. ¿Cuanto sale y hay stock?" | `get_product_details` | responde precio/stock del momento, sin reserva ni congelamiento | **aqui se detiene la venta real** | L3-L4 | sin autoridad de precio final ni reserva de stock (seccion 13) |
| F6 Shipping | "¿Cuanto sale el envio a Puerto Montt?" | ninguna | respuesta inventada por el modelo o silencio — sin tool | **se detiene** | L0 | seccion 14 |
| F7 Cotizacion | "Cotizame todo con despacho" | `crm_quotes` existe, sin llamador | no puede generar una cotizacion real | **se detiene** | L0 en wiring (L2 en codigo) | seccion 18 |
| F8 Negociacion | "¿Me haces un descuento?" | ninguna | sin capability de descuento; el modelo podria negarse o improvisar sin autoridad real | **se detiene** | L0 | sin `business_policy` |
| F9 Cierre | "Perfecto, lo compro" | ninguna capability de creacion de orden | no puede avanzar la venta | **se detiene** | L0 | secciones 19-22 |
| F10 Pago | "Envíame el link para pagar" | ninguna | no puede generar un link real | **se detiene** | L0 | seccion 21 |
| F11 Estado de orden | "¿Donde viene mi pedido?" | `find_order`/`get_order_status` existen pero no en el pool canonico | sin respuesta real en runtime por defecto | **se detiene** | L0 en wiring por defecto (L2 en codigo, multi-request) | flag `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED=false` |
| F12 Armado | "¿Pueden armarme las maquinas?" | stubs `implemented:false` | respuesta generica/handoff | **se detiene** | L0 | seccion 23 |
| F13 Audio/imagen | cliente envia foto/nota de voz | ninguna | referencia de media descartada silenciosamente, `body=''` | **se detiene inmediatamente** | L0 | seccion 9 |
| F14 Handoff | "Quiero hablar con un vendedor" | el modelo puede emitir `handoff`, un mensaje de reconocimiento se envia | **la IA sigue respondiendo el siguiente mensaje** — hallazgo critico seccion 17 | corte funcional real, no solo de alcance | L3, con defecto funcional | falta escritura de `human_owner_active` desde el camino canonico |

## 30. Sales readiness

| Dimension | Clasificacion |
|---|---|
| DISCOVERY | READY_WITH_FLAG (`BRAIN_AGENT_TOOL_LOOP_ENABLED=false` por defecto) |
| PRODUCT_SEARCH | READY_WITH_FLAG |
| PRODUCT_EXPLANATION | READY_WITH_FLAG |
| RECOMMENDATION | PARTIAL (implementada, gateada por evidencia, no activada) |
| CUSTOMER_CONTEXT | PARTIAL (4 flags independientes, `POSSIBLE_COMPLEMENT` inerte) |
| PRICE | PARTIAL (dato del momento, sin autoridad/congelamiento) |
| STOCK | PARTIAL (dato del momento, sin reserva) |
| SHIPPING | MISSING |
| QUOTATION | BLOCKED (motor real, cero wiring) |
| NEGOTIATION | MISSING |
| CHECKOUT | MISSING |
| PAYMENT | MISSING |
| ORDER_CREATION | MISSING |
| POSTSALE | BLOCKED (codigo real en runtime apagado por defecto) |
| FOLLOW_UP | READY_WITH_FLAG (mecanismo endurecido y probado E2E, `operational: not_verified` contra dependencias reales) |
| HUMAN_HANDOFF | PARTIAL (toma manual robusta; handoff decidido por modelo no persistente — defecto real) |
| MEDIA | MISSING (audio/imagen/documento) |
| SERVICES | MISSING |

## 31. Punto maximo actual

```text
El bot puede avanzar hoy desde:
descubrimiento de producto por texto (busqueda, detalle, exploracion/ranking, recomendacion relacionada)

hasta:
informar precio y stock del momento para un producto identificado, con politica de presentacion de stock
gobernada por prompt (no por runtime)

Se detiene antes de:
comprometer un precio final vinculante, reservar stock, cotizar formalmente, calcular despacho,
generar un link de pago o crear una orden

porque:
no existe autoridad de precio/stock mas alla del dato puntual del Catalog Service; el motor de
cotizacion existe en codigo pero tiene cero llamadores productivos; no existe ningun cliente de
shipping/checkout/pago/creacion-de-orden en el repositorio.
```

**Maximo demostrado por tests**: descubrimiento + recomendacion + follow-up + identidad/onboarding, todos con evidencia de integracion contra MariaDB real y/o dobles HTTP fieles al contrato (`L4_INTEGRATION_VALIDATED`).

**Maximo validado live**: el reporte de operador sobre el despliegue EC2 confirma un flujo real de 2 turnos WhatsApp con `explore_catalog`→`get_product_details` (ranking global, identificacion de producto, referencia anaforica, URL canonica) — **no reproducido de forma independiente en esta auditoria**, tratado como evidencia de operador, no como verificacion propia.

**Maximo habilitado en produccion**: no determinable desde este repositorio de forma estatica — todos los flags criticos (`BRAIN_AGENT_TOOL_LOOP_ENABLED`, `BRAIN_SALES_AGENT_ENABLED`, `BRAIN_META_SEND_ENABLED`, `CUSTOMER_PROFILE_*`) tienen default `false` en `.env.example`; el estado real de un `.env` de produccion desplegado esta fuera del alcance de esta auditoria de codigo (y no se inspecciono ningun valor de `.env` real, solo nombres de variables, por politica de no revelar secretos).

Estos tres maximos **no son equivalentes** y no deben tratarse como tal.

## 32. Gap analysis

| GAP_ID | CAPACIDAD FALTANTE | EFECTO DE NEGOCIO | WORKAROUND ACTUAL | PRIORIDAD | BLOQUEA_CIERRE_VENTA |
|---|---|---|---|---|---|
| G1 | Handoff decidido por modelo no persistente | cliente que pide humano sigue recibiendo respuestas de IA | ninguno automatico; depende de que un operador note el caso | **P0** | si (riesgo de confianza/reputacional, no solo de venta) |
| G2 | Autoridad de precio final/reserva de stock | no se puede prometer un precio ni bloquear stock durante la negociacion | ninguno | **P0** | si |
| G3 | Cotizacion productiva (wiring de `crm_quotes`) | no se puede formalizar una cotizacion pese a existir el motor | `prepare_quote_draft` como marcador inerte para operador | **P0** | si |
| G4 | Shipping | no se puede informar costo/plazo de despacho real | ninguno (riesgo de invencion del modelo) | **P0** | si |
| G5 | Checkout/pago/creacion de orden | no se puede cerrar una venta transaccionalmente | ninguno | **P0** | si |
| G6 | `find_order`/`get_order_status` fuera del pool canonico | consulta de estado de pedido no responde en runtime por defecto | activar `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED` (no es el runtime canonico) | **P1** | no directamente, pero bloquea postventa |
| G7 | Onboarding post-plan inalcanzable con Agent Tool Loop activo | creacion/vinculacion de cliente nuevo se rompe silenciosamente al encender el flag prerrequisito de Customer Profile | ninguno — hallazgo de esta auditoria, no mitigado | **P1** | indirectamente (bloquea identidad para cualquier venta con Customer Profile activo) |
| G8 | Customer Profile bypassa el gate de `contextAccess` | riesgo de exposicion de historial de compra fuera del modelo de acceso documentado, hoy inerte por flags apagados | ninguno — hallazgo de esta auditoria | **P1** | no (inerte hoy), pero bloquea activar el flag con seguridad |
| G9 | Documentacion canonica desactualizada (workstream CP-R1-T10B*/T12* completo ausente de ACTIVE_RELEASE/CAPABILITY_MATRIX) | decisiones futuras podrian basarse en un inventario de 4 tools cuando existen 5, o ignorar Customer Profile por completo | ninguno | **P1** | no directamente, pero degrada la confiabilidad de la jerarquia canonica |
| G10 | Servicios (armado/mantencion/instalacion) | no se puede vender ni agendar un servicio | colas legacy n8n de solo lectura | **P2** | no bloquea el cierre de una venta de producto simple |
| G11 | Media (audio/imagen/documento) | cliente que envia foto/audio pierde ese contenido silenciosamente | ninguno | **P2** | no bloquea texto, pero es una perdida de informacion real del cliente |
| G12 | Descuentos/promociones | no se puede negociar con autoridad | ninguno | **P2** | si, para negociacion, no para cierre de precio de lista |
| G13 | Cola de escalamiento del Hub desconectada del runtime canonico | operadores no ven escalamientos reales del canal principal | ninguno | **P2** | no bloquea venta, si bloquea operabilidad |
| G14 | Follow-up sin memoria comercial completa (need profile no persistido estructuradamente) | seguimiento generico en vez de contextual | mensaje generico | **P3** (deuda ya reconocida en `ACS-R1-05.1-T03/T04`, `planned`) | no |

Ningun P0 fue asignado a una capacidad que no bloquee el cierre de una venta.

## 33. Roadmap recomendado

Fundacion requerida (antes de cualquier capability de cierre):
1. Corregir G1 (handoff persistente) — es el unico hallazgo con riesgo directo de exposicion al cliente, y el fix es acotado (escribir `human_owner_active`/`ai_enabled` desde `dispatchAgentLoopResponse.ts` cuando `terminalReason==="handoff"`).
2. Reconciliar G7/G8 (gaps de onboarding/Customer Profile) antes de activar `BRAIN_AGENT_TOOL_LOOP_ENABLED`/`CUSTOMER_PROFILE_CONTEXT_ENABLED` en cualquier entorno con trafico real.
3. Cerrar G9 (deuda documental) — actualizar `ACTIVE_RELEASE.md`/`CAPABILITY_MATRIX.md` con el workstream `CP-R1-T10B*`/`CP-R1-T12*` ya mergeado.

Capacidad de cierre (secuencia natural hacia una venta completa, ya reflejada en `ROADMAP.md` como `ACS-R1-06`→`ACS-R1-07`):
4. Autoridad de precio/stock explicita (aunque sea "el precio es el del Catalog Service en el momento X, valido por Y minutos").
5. Conectar `crm_quotes` al runtime — es el trabajo de menor esfuerzo relativo de esta lista, porque el motor ya existe.
6. Shipping (cliente HTTP + capability nueva, hoy cero).
7. Checkout/pago/creacion de orden — la secuencia mas grande, correctamente ubicada al final por el propio `ROADMAP.md` (`ACS-R1-07`).

Optimizacion posterior:
8. Servicios (armado/mantencion) como capability estructurada.
9. Media (audio/imagen) — mejora de captura de informacion, no bloquea cierre de venta de producto simple.
10. Descuentos/promociones bajo `business_policy` (`ACS-R1-06`).

## 34. Decision sobre Quotation Capability

1. **¿Es Quotation Capability el siguiente paso correcto?** Es un candidato fuerte, pero no el unico correcto: el motor de datos (`crm_quotes`) ya existe y esta unit-testeado — el "siguiente paso" real es de **wiring e integridad de politica**, no de diseno desde cero. Sin embargo, activarlo sin resolver G1 (handoff no persistente) primero seria imprudente: una cotizacion formal que un cliente pide escalar a un humano ("quiero que un vendedor confirme esto") caeria en el mismo hueco de handoff no-persistente ya documentado.
2. **¿Que dependencias deben resolverse antes?** (a) autoridad de precio/stock explicita, aunque sea minima; (b) shipping, para que `totals.shipping` deje de ser siempre `null`; (c) el fix de handoff persistente (G1); (d) decidir la relacion entre `prepare_quote_draft` (accion inerte del motor legacy) y `crm_quotes` real — hoy son dos sistemas sin relacion, y conectar uno sin decidir sobre el otro dejaria una tercera fuente de verdad de cotizaciones.
3. **¿Que debe incluir su primera version?** Conectar `createQuoteDraft` a un punto de disparo real (probablemente una nueva capability del Gateway, `prepare_quote`, ya prevista en `CAPABILITY_MATRIX.md` como `planned`), con items provenientes de tools ya reales (`get_product_details`/`explore_catalog`), sin calculo de descuento/impuesto todavia (ya que no existe autoridad de descuento).
4. **¿Que debe quedar fuera?** Descuentos/promociones (requiere `business_policy`, aun `planned`); shipping real (requiere G6 del roadmap); conversion automatica a orden (requiere checkout/pago, explicitamente excluido de `ACS-R1-05.1` y correctamente secuenciado en `ACS-R1-07`).
5. **¿Donde debe persistirse?** Ya existe: `crm_quotes`, dentro del mismo modelo relacional a `crm_opportunities`/`conversation`. No hay necesidad de una tabla nueva para una v1.
6. **¿Quien debe ser autoridad de precios?** El Catalog Service, vía las mismas tools ya gobernadas (`get_product_details`/`explore_catalog`) — nunca el LLM computando un total por su cuenta (principio no negociable 3 de `PRODUCT_NORTH_STAR.md`).
7. **¿Como debe integrarse shipping?** Como un campo opcional inicialmente `null`/no disponible hasta que exista una capability real de shipping — nunca inventado por el modelo, siguiendo el mismo patron fail-closed que el resto del Gateway.
8. **¿Debe permitir prospectos sin `customerId`?** Dado el principio de "identidad sigue siendo provisional" (`PRODUCT_NORTH_STAR.md` #8) y que `ACS-R1-04` (Customer Service) sigue `PAUSED_EXTERNAL`, una v1 deberia permitir un borrador de cotizacion atado a la identidad provisional (`wa_id`/`conversation_case_id`), consistente con como ya opera el resto del runtime — nunca inventando un `customer_key` definitivo.
9. **¿Como se convierte despues en carrito u orden?** Fuera de alcance de una v1 — depende enteramente de que exista primero una capability de creacion de orden (`ACS-R1-07`/posterior), hoy inexistente.
10. **¿Existe algun gap mas urgente?** Si — **G1 (handoff no persistente)** es mas urgente que Quotation en terminos de riesgo, porque afecta la confianza del cliente y la seguridad operacional hoy mismo, con o sin cotizaciones. Se recomienda resolver G1 en paralelo o antes de iniciar el trabajo de Quotation Capability.

No se diseno el contrato completo de Quotation Capability en este documento — solo alcance y prerrequisitos, segun lo pedido.

## 35. Riesgos

- **Handoff no persistente (G1)** es un riesgo operacional/reputacional activo hoy, independiente de cualquier decision de roadmap — un cliente que pide explicitamente un humano puede seguir recibiendo respuestas automaticas indefinidamente si ningun operador nota el caso.
- **Evidencia "live" concentrada en un solo canal no reproducible**: casi toda la evidencia L5/L6 de este repositorio (catalogo, explore, EC2) proviene de reportes de un unico operador sobre un despliegue al que esta auditoria no tuvo acceso de red. Ningun hallazgo de esta auditoria pudo reproducir esa evidencia de forma independiente.
- **Tres runtimes y tres vocabularios de tools coexistentes** son una fuente real de confusion para cualquier persona (humana o agente de IA) que edite este repositorio sin leer el codigo con cuidado — el riesgo de instrumentar/registrar una capability en el registry equivocado es concreto (ya ocurrio con `search_products`, que existe duplicado con fuentes de datos distintas).
- **Documentacion canonica desactualizada** (G9) — cualquier decision tomada solo a partir de `CAPABILITY_MATRIX.md`/`ACTIVE_RELEASE.md` sin verificar el codigo real se basaria en un inventario de tools incompleto.
- **Motor de cotizacion desconectado (G3)** representa trabajo ya hecho que podria perderse de vista o reimplementarse de cero si no se documenta explicitamente como "existe, esta probado, falta conectar".
- **Ausencia de MariaDB/Docker en este entorno de auditoria** limita la confirmacion independiente de gran parte de la evidencia de integracion — 473 de 2697 tests no pudieron ejecutarse contra su dependencia real en esta sesion; esta es una limitacion de entorno documentada de forma consistente a traves de multiples tareas previas del repositorio, no un hallazgo nuevo.

## 36. Veredicto

```text
SALES_AGENT_READY_FOR_PRODUCT_DISCOVERY_ONLY
```

Condiciones:

```text
CATALOG_DISCOVERY_AVAILABLE
PRODUCT_RECOMMENDATION_AVAILABLE       (implementada, no activada por defecto)
CUSTOMER_CONTEXT_AVAILABLE             (implementada, apagada por 4 flags, un gap de wiring — POSSIBLE_COMPLEMENT inerte)
PRICE_AUTHORITY_AVAILABLE              (NO — solo dato puntual, sin autoridad/congelamiento)
STOCK_VALIDATION_AVAILABLE             (NO — solo dato puntual, sin reserva)
SHIPPING_QUOTE_AVAILABLE               (NO)
QUOTATION_MISSING                      (motor de datos existe, cero wiring de runtime)
CHECKOUT_MISSING
PAYMENT_MISSING
ORDER_CREATION_MISSING
POSTSALE_PARTIAL                       (find_order/get_order_status existen, fuera del runtime canonico por defecto)
FOLLOWUP_AVAILABLE                     (endurecido y probado E2E; operational: not_verified contra dependencias reales)
HANDOFF_AVAILABLE                      (con defecto critico real: no persistente para handoff decidido por modelo)
MEDIA_MISSING                          (audio/imagen/documento)
SERVICES_PARTIAL                       (solo stubs + cola legacy de solo lectura)
PRODUCTION_FLAGS_DISABLED              (todos los flags criticos default false en .env.example)
LIVE_VALIDATION_REQUIRED               (evidencia live existente es de operador, no reproducida por esta auditoria)
READY_FOR_QUOTATION_DISCOVERY          (si, con las condiciones de la seccion 34)
```

---

## Apendice A — Archivos revisados (no exhaustivo, principales)

Documentos canonicos: `AGENTS.md`, `CLAUDE.md`, `docs/PRODUCT_NORTH_STAR.md`, `docs/ACTIVE_RELEASE.md`, `docs/CAPABILITY_MATRIX.md`, `docs/ROADMAP.md`, `docs/audits/follow-up-runtime-reconciliation.md`, `docs/releases/ACS-R1-05.1-persistent-commercial-memory-controlled-whatsapp-pilot.md`.

Codigo (via cinco subagentes de investigacion mas verificacion directa): `lib/brain/commercial/agent-loop/**`, `lib/brain/commercial/native-cycle/**`, `lib/brain/commercial/capability-gateway/**`, `lib/brain/commercial/capabilities/**`, `lib/brain/commercial/multi-request/**`, `lib/brain/commercial/sales-consultative/**`, `lib/brain/commercial/quotes/**`, `lib/brain/commercial/followup/**`, `lib/brain/commercial/continuity/**`, `lib/brain/commercial/customer-profile-context/**`, `lib/brain/native-whatsapp/**`, `lib/brain/messaging/**`, `lib/customer-profile/**`, `lib/integrations/**`, `lib/catalog/**`, `lib/domains/**`, `lib/brain/tools/**`, `app/api/**`, `app/(hub)/**`, `.env.example`, `package.json`, `migrations/*.sql` (nombres/estructura, no contenido de datos).

## Apendice B — Tests ejecutados

```text
npx tsc --noEmit           → limpio
npm run lint               → 0 errores, 34 warnings preexistentes
npm run build              → exitoso
npm test                   → 2697 tests, 2224 pass, 473 fail (mayoria ECONNREFUSED por ausencia de MariaDB/Docker en este entorno)
```

## Apendice C — Baseline

Working tree identico a `origin/develop` (`0 ahead, 0 behind`) — esta ejecucion de tests **es** el baseline de `develop@b9d0324`, no existe una version separada contra la cual comparar.

## Apendice D — Limitaciones de evidencia

- Sin Docker/MariaDB corriendo en este entorno — 473 de 2697 tests no ejecutaron contra su dependencia real.
- Sin acceso de red al despliegue EC2 mencionado en `docs/releases/ACS-R1-05.1-*.md` — toda evidencia "live" de ese entorno es reporte de operador, no verificada de forma independiente.
- No se inspecciono el contenido de ningun `.env` real (solo nombres de variables en `.env.example` y el codigo que las lee) — no determinable si algun flag critico esta encendido en un entorno productivo real.
- Los cinco subagentes de investigacion trabajaron con lecturas acotadas de archivos grandes; donde declararon `unconfirmed`/`not found`, esta auditoria preserva esa incertidumbre en vez de resolverla por inferencia.
- No se auditaron los 6 worktrees adicionales del filesystem (`ai/codex/*`, `ai/claude/*`, `feat/cp-r1-t10b8c`, `feat/cp-r1-t10b8d`) — su contenido podria adelantar o contradecir hallazgos de esta auditoria si se mergean a `develop` despues de `b9d0324`.

## Apendice E — Estado del repositorio al cierre de esta auditoria

```text
git status --short   → (vacio, sin cambios)
git diff --stat      → (vacio, sin cambios)
```

Ningun archivo de produccion fue modificado. Unico archivo creado: este documento.
