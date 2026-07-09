---
title: ACS-R1-01 Capability Gateway Evidence
doc_id: audit-acs-r1-01-capability-gateway-evidence
status: historical
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
audited_at: 2026-07-08
immutable_snapshot: true
source_of_truth_for:
  - historical capability gateway evidence
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - audit
  - historical
---

# ACS-R1-01 - Evidencia de termino

Runtime autonomo canonico + Capability Gateway v1.

Fecha: 2026-07-08. Rama: `develop`.

## 1. Objetivo cumplido

Dejar un unico ciclo comercial productivo por WhatsApp que puede usar el microservicio externo de catalogo (`MS-pesaschile-catalog-service`) mediante una capability gobernada, persistir su ejecucion, responder al cliente con datos reales y continuar correctamente en turnos posteriores.

Hallazgo de partida (auditado antes de escribir codigo): el runtime productivo (`app/api/integrations/whatsapp/webhook/route.ts` -> `processNativeWhatsAppInbound` -> `runNativeAutonomousCycle`) ya era el unico camino alcanzable desde WhatsApp (`processInbound`, el orquestador mock y el simulador dev ya estaban desconectados, con test que lo garantiza). Pero dentro de ese camino, el `search_products` que el Sales Agent podia "pedir" (`toolRequests`) nunca se ejecutaba: `allowedCapabilities` se pasaba vacio (bloqueando el tool request en policy) y no existia ningun paso que tomara un tool request sobreviviente y lo convirtiera en una llamada HTTP real. El catalogo real (PrestaShop via `catalogRepository.ts`) solo se usaba desde `lib/brain/commercial/capabilities/registry.ts`, camino exclusivo del runtime multi-request (apagado por flag). El incremento cierra exactamente ese hueco.

## 2. Runtime canonico (confirmado, no reconstruido)

```
POST /api/integrations/whatsapp/webhook
-> processNativeWhatsAppInbound (lib/brain/native-whatsapp/service.ts)
-> runNativeAutonomousCycle
   Fase 1  buildNativeCommercialContext
   Fase 2  runCommercialShadowEvaluation      (LLM + policy)
   Fase 3  runCommercialOperationalLoop       (decision, next action)
   Fase 3.5 runCatalogCapabilityStage (NUEVO) + applyCatalogGroundingToNextAction (NUEVO)
   Fase 4  runCommercialExecutionBridge       (action + outbox)
-> brain_message_outbox -> outbox worker -> Meta
```

Fuera del camino productivo (verificado, no tocado): `lib/brain/processInbound.ts`, `app/api/ai/orchestrate/route.ts`, `app/api/dev/ai-sdr-simulator/route.ts`. Ningun archivo de estos fue importado ni modificado.

## 3. Multi-request

No se tocaron sus tablas ni su codigo (`crm_conversation_requests`, `crm_request_facts`, `crm_request_message_links`, `crm_turn_plans`, `crm_request_escalations`, `crm_agent_actions.request_id`). Sigue siendo un runtime paralelo detras de `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED` (default `false`), no reconciliado dentro del ciclo canonico en este incremento.

**Decision explicita y su motivo:** reconciliar multi-request como "infraestructura subordinada real" (que el ciclo canonico cargue requests activas y produzca una accion) exige tocar `runMultiRequestAutonomousCycle.ts`, `executeRequestTurn.ts` y su suite de tests dedicada, y hoy ese runtime ni siquiera envia lo que redacta (`responseDraft` nunca llega a outbox, gap ya documentado). Intentarlo dentro de este incremento habria significado reconstruir un runtime que el propio encargo prohibe reconstruir. Se documenta como riesgo/deuda en la seccion 8. `.env.example` quedo con un comentario explicito: mantener `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED=false` en produccion.

`capabilities/registry.ts` (el registro de capabilities que SI usa multi-request) tampoco fue migrado al nuevo Catalog Port: sigue leyendo `ps_product`/`ps_orders` via `catalogRepository.ts`. Motivo: es el unico consumidor de ese registro (`executeReadCapabilityForRequest`, invocado solo desde `executeRequestTurn.ts`), su test (`tests/commercial/readCapabilities.test.ts`) depende de `ps_product` existiendo fisicamente en la BD de la app (no del microservicio HTTP), y ese registro no es parte del runtime productivo estandar (sec. 2/12 del encargo excluyen multi-request explicitamente). Migrarlo habria sido alcance no pedido con riesgo de romper ese test en entornos donde `ps_product` si existe.

## 4. Capability Gateway v1

Nuevo modulo: `lib/brain/commercial/capability-gateway/` (`types.ts`, `registry.ts`, `executeCapability.ts`, `repository.ts`, `index.ts`).

Contrato (`types.ts`):

- Availability: `available | unavailable | denied | requires_approval | temporarily_blocked`.
- Execution status: `completed | missing_information | denied | requires_approval | temporarily_blocked | invalid_arguments | failed`.
- Cada resultado (`CapabilityGatewayResult`): `capability`, `version`, `availability`, `status`, `data`, `errorCode`, `retryable`, `evidence[]`, `retryCount`, `startedAt`, `completedAt`, `executionPublicId`.

`executeGovernedCapability(name, input, context)` (`executeCapability.ts`) es el unico punto de entrada: resuelve la capability desde un registro cerrado (una capability inexistente nunca se ejecuta - se persiste como `denied`/`capability_not_registered`, nunca lanza una excepcion), corre `checkAvailability`, ejecuta con un retry acotado por capability (`maxRetries`, hoy 1 para ambas capabilities registradas) solo si la propia capability marco el fallo como `retryable`, y persiste siempre un registro de auditoria (exista o no la capability, este o no disponible el catalogo).

Capabilities registradas hoy (`registry.ts`): `search_products`, `get_product_details`. Ambas de solo lectura, respaldadas por el Catalog Port.

## 5. Catalog port + adapter HTTP

`lib/catalog/` (`types.ts`, `httpCatalogAdapter.ts`, `index.ts`).

`CatalogPort` (ADR-005, recortado a lo que el microservicio real expone): `searchProducts`, `getProductDetails`. Modelo de dominio: `CatalogProduct`, `CatalogProductVariant`, `CatalogProductPrice` (precio `null` = desconocido, nunca cero ni inventado), `CatalogAvailabilityStatus` (`in_stock | out_of_stock | unknown`), `CatalogProvenance` (`source`, `retrievedAt`, `cached`).

El adapter (`httpCatalogAdapter.ts`) se escribio contra el contrato real de `MS-pesaschile-catalog-service` (repositorio inspeccionado via `gh api` para leer `README.md`, `client/catalogClient.ts`, `client/types.ts`, `src/shared/contracts.ts`, `src/shared/errors.ts` y `src/interfaces/http/app.ts` - no se adivino el contrato):

- Endpoints reales: `GET /v1/products/search?q=&limit=&includeOutOfStock=`, `GET /v1/products/:productId?combinationId=`.
- Headers reales: `x-api-key`, `x-correlation-id`.
- Codigos de error reales mapeados 1:1 (`UNAUTHORIZED`, `RATE_LIMITED`, `PRODUCT_NOT_FOUND`, `DATABASE_UNAVAILABLE`, `CATALOG_QUERY_FAILED`, `INTERNAL_ERROR`, etc.) a `invalid_input | unauthorized | rate_limited | not_found | unavailable | timeout | invalid_response`.
- Timeout via `AbortController` (`CATALOG_SERVICE_TIMEOUT_MS`, default 5000ms).
- Retry limitado: un reintento fisico solo para errores marcados `retryable` (5xx, 429, timeout/red); 400/401/403/404 nunca se reintentan.
- 404 en `getProductDetails` se traduce a `{ok: true, value: null}` (producto no encontrado es un resultado valido, no un error).
- Sanitizacion: los mensajes de error nunca incluyen la API key (test dedicado que lo verifica).
- Versionado: `CATALOG_ADAPTER_CONTRACT_VERSION = "catalog-service.v1"`.

Se opto por **portar el contrato** (no agregar el repo externo como dependencia npm cruzada) para no introducir una dependencia git de otro repositorio privado en `package.json`; el codigo del cliente de referencia se uso solo como fuente de verdad para endpoints/headers/errores.

## 6. Reemplazo de lecturas directas de catalogo en el runtime productivo

Antes de este incremento, el runtime productivo (shadow/loop/bridge) **no ejecutaba ningun tool** - los `toolRequests` del Sales Agent quedaban siempre bloqueados por policy porque `allowedCapabilities` se pasaba vacio. No habia, por tanto, ninguna lectura directa de `catalogRepository.ts`/SQL PrestaShop que reemplazar dentro del camino productivo: el hueco era la ausencia total de ejecucion, no una fuente incorrecta. Se cerro ese hueco con el Capability Gateway + Catalog Port (HTTP), nunca con SQL directo.

## 7. Persistencia de tool execution

Tabla nueva: `crm_capability_executions` (`migrations/022_crm_capability_executions.sql`).

**Por que una tabla nueva y no `ai_tool_execution`:** `ai_tool_execution` (migracion 008) tiene FK obligatoria hacia `ai_agent_execution`/`ai_agent_decision`, tablas que solo escribe el subsistema `lib/brain/local-ai-sdr` (no relacionado con `native-whatsapp`/`commercial`). Reutilizarla habria obligado a crear filas falsas en un subsistema de observabilidad ajeno solo para satisfacer una FK - viola la separacion `ai_*` (observabilidad tecnica no relacionada) vs dominio comercial. La tabla nueva sigue el patron ya usado por `crm_action_executions`/`crm_action_outcomes` (migracion 013): columnas logicas VARCHAR para correlacion cruzada sin FK (`decision_id`, `action_id`, `commercial_event_id`, `request_id`) mas columnas numericas con FK reales donde el destino es bigint (`action_row_id -> crm_agent_actions`, `opportunity_id -> crm_opportunities`, `conversation_id -> conversation`).

Columnas: `capability_name`, `capability_version`, `availability_status`, `execution_status`, `retry_count`, `retryable`, `error_code`, `request_summary_json`, `response_summary_json`, `evidence_json`, `started_at`, `completed_at`, mas la correlacion arriba descrita. Cada llamada a `executeGovernedCapability` persiste exactamente una fila (`lib/brain/commercial/capability-gateway/repository.ts#insertCapabilityExecution`), exista o no la capability, este o no disponible el catalogo.

## 8. Replanificacion / continuidad

Implementado en `runCatalogCapabilityStage.ts` + `applyCatalogGroundingToNextAction.ts`:

| Resultado de la capability | Comportamiento |
| --- | --- |
| `completed` con productos | El mensaje final se reemplaza deterministicamente por texto que cita solo los productos devueltos (nombre real, precio solo si vino en `get_product_details`). Nunca usa el texto crudo del LLM. |
| `completed` sin productos | Mensaje seguro: pide mas detalle, no afirma que no existe el producto en general. |
| `invalid_arguments` | Mensaje pide aclarar que producto/categoria busca. |
| `denied` | Mensaje seguro + no se reintenta la misma capability este turno; queda evidencia en `crm_capability_executions` para escalamiento tecnico (no se construyo una escalacion UI dedicada en este incremento - ver riesgos). |
| `temporarily_blocked` / `failed` (retryable agotado) | Mensaje seguro sin prometer plazo ("te aviso apenas pueda"); `retryable: true` queda persistido. |
| capability no registrada | Nunca se ejecuta; `denied` + `capability_not_registered`, auditado. |
| catalogo no configurado (`CATALOG_SERVICE_BASE_URL`/`API_KEY` ausentes) | `unavailable` a nivel de availability, mapeado a `temporarily_blocked` a nivel de ejecucion (retryable). |

`applyCatalogGroundingToNextAction` solo sobreescribe `draftMessage` cuando el `selectedNextAction.type` es uno de `respond | recommend_products | ask_clarifying_question | qualify` (tipos de respuesta al cliente) - nunca sobre `escalate_to_operator`, `pause`, etc. Si el ciclo decidio escalar a humano por otra razon (policy, ownership), esa decision se respeta y el override no se aplica.

**No implementado en este incremento (deuda explicita):** un segundo tool distinto de `search_products` disparando re-planificacion multi-iteracion (limite de 3 de ADR-006); hoy solo hay una capability-gateway-call por turno. El limite de 3 iteraciones de replanning general (Bloque 14 del backlog multi-request) sigue pospuesto, como ya estaba documentado antes de este incremento.

## 9. Flags - configuracion productiva recomendada

Nuevas variables (`.env.example`):

```
CATALOG_SERVICE_BASE_URL=       # URL del microservicio MS-pesaschile-catalog-service
CATALOG_SERVICE_API_KEY=        # x-api-key
CATALOG_SERVICE_TIMEOUT_MS=5000
```

Sin estas dos primeras, `search_products`/`get_product_details` reportan `unavailable` de forma explicita - nunca inventan datos.

Para que el ciclo canonico ejecute `search_products` end-to-end en produccion, ademas de las flags ya documentadas (`BRAIN_SALES_AGENT_ENABLED`, `BRAIN_COMMERCIAL_SHADOW_ENABLED`, `BRAIN_COMMERCIAL_RUNTIME_ENABLED`, `BRAIN_COMMERCIAL_POLICY_ENABLED`, `BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED`, `BRAIN_AGENT_ACTION_QUEUE_ENABLED`, `BRAIN_EXECUTION_GATE_ENABLED`, `BRAIN_OUTBOX_BRIDGE_ENABLED`) no se agrego ninguna flag nueva de encendido: `search_products` queda disponible para el Sales Agent en cuanto esas flags existentes esten en `true` (el codigo ya declara `searchProducts` como capability permitida de forma fija - ver seccion 12 "riesgos" sobre por que no se hizo configurable).

**Confirmado apagado por defecto** (sin cambios de este incremento): `BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER=false`, `BRAIN_SALES_AGENT_DRY_RUN=true`, `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED=false`, shadow/dry-run no son el default.

## 10. Pruebas ejecutadas

Comando: `npx tsx --test "tests/**/*.test.ts"` -> **735 tests, 735 pass, 0 fail** (base previa: 716; +19 de este incremento). `npx tsc --noEmit` -> exit 0. `npm run lint` -> 0 errores (35 warnings preexistentes, ninguno introducido por este cambio).

Archivos nuevos de test:

- `tests/catalog/httpCatalogAdapter.test.ts` (12 tests): busqueda y detalle exitosos, 401 no reintentado, 400 no reintentado, 404 -> `null` valido, 500 reintentado una vez y exitoso, 500 agota el retry -> `unavailable` retryable, 429 retryable, timeout retryable, JSON invalido -> `invalid_response`, body vacio -> `invalid_response`, la API key nunca aparece en un mensaje de error.
- `tests/commercial/capabilityGateway.test.ts` (5 tests, BD real): capability no registrada -> `denied` auditado sin ejecutar nada; catalogo no configurado -> `temporarily_blocked` auditado; ejecucion HTTP real -> `completed` + fila persistida con `conversation_id`/`opportunity_id`/`evidence_json`; `get_product_details` sin `productId` -> `invalid_arguments` sin llamada HTTP; fallo retryable seguido de exito -> `retryCount=1` persistido.
- `tests/native/catalogCapabilityCycle.test.ts` (2 tests, BD real, HTTP mock, `runNativeAutonomousCycle` real): (a) un Sales Agent que pide `searchProducts` produce una llamada HTTP real al microservicio mockeado, la persiste en `crm_capability_executions`, y el mensaje final en `selectedNextAction.draftMessage` cita el producto real devuelto (no el texto generico del LLM); (b) con el microservicio inalcanzable, el ciclo nunca inventa el producto y reporta `temporarily_blocked`/`retryable=true`.

**Escenario obligatorio de la seccion 10 del encargo - cobertura real:** los pasos 1-6 (inbound, pregunta de info faltante via policy/loop ya existente, ejecucion real de `search_products` por HTTP, persistencia de tool execution, recomendacion con producto real) quedan demostrados end-to-end por `catalogCapabilityCycle.test.ts`. Los pasos 7-11 (objecion, replanteo manteniendo oportunidad, "lo voy a pensar", follow-up creado, cancelacion/ejecucion posterior) **no se re-probaron en este incremento**: ya tenian cobertura propia y pasante en la suite existente (`followUpScheduling.test.ts`, `followUpPlanner.test.ts`, `runFollowupTick.test.ts`, `autonomousCommercialLoop.test.ts`) sobre el mismo `runCommercialOperationalLoop`/action-queue que este incremento no modifico; no se duplicaron.

**No probado en este incremento (limitacion declarada, no exito falso):** timeout/401/403/404/500/payload invalido/vacio/retry-agotado del catalogo SI se probaron (adapter + gateway). Duplicate inbound, reinicio entre turnos y human takeover SI tienen cobertura pasante preexistente sobre el mismo runtime (`native-whatsapp.test.ts`, `outbox-ownership.test.ts`) no modificado por este cambio. "Capability unavailable" se probo para `search_products`/`get_product_details`; no se agrego una tercera capability al gateway para probar el caso generico "capability declarada pero `implemented:false`" (el gateway de este incremento solo tiene las dos capabilities pedidas).

## 11. Archivos modificados/creados

**Modificados:**
- `.env.example` - variables `CATALOG_SERVICE_*` + nota de subordinacion de multi-request.
- `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts` - `allowedCapabilities` deja de ser `[]` (pasa a incluir `searchProducts`), nueva Fase 3.5 (catalog capability stage + grounding), `provider` inyectable (solo pruebas, default `null` = comportamiento identico a antes).

**Nuevos (productivo):**
- `migrations/022_crm_capability_executions.sql`
- `lib/catalog/{types.ts,httpCatalogAdapter.ts,index.ts}`
- `lib/brain/commercial/capability-gateway/{types.ts,registry.ts,executeCapability.ts,repository.ts,index.ts}`
- `lib/brain/commercial/native-cycle/runCatalogCapabilityStage.ts`
- `lib/brain/commercial/native-cycle/applyCatalogGroundingToNextAction.ts`

**Nuevos (tests):**
- `tests/catalog/httpCatalogAdapter.test.ts`
- `tests/commercial/capabilityGateway.test.ts`
- `tests/native/catalogCapabilityCycle.test.ts`

**No tocado (verificado, sigue desconectado del runtime productivo):** `lib/brain/processInbound.ts`, `app/api/ai/orchestrate/route.ts`, `app/api/dev/ai-sdr-simulator/route.ts`, todo `lib/brain/commercial/multi-request/*`, `lib/brain/commercial/capabilities/registry.ts` (multi-request), `lib/brain/local-ai-sdr/*`, `ai_tool_execution`.

## 12. Riesgos y deuda pendiente

1. **`searchProducts` esta hardcodeado como unica capability permitida** en `runNativeAutonomousCycle.ts` (`NATIVE_CYCLE_ALLOWED_CAPABILITIES`), no gobernado por policy/tenant configurable. Aceptable para este incremento (una sola capability nueva, de solo lectura) pero no escala si se agregan mas capabilities sin revisar el Policy Engine real (hoy `evaluateCommercialToolRequests.ts` trata cualquier tool request con `status:"planned"` marcado `blocking:true` como necesitando aprobacion de operador - correcto para acciones riesgosas, pero implica que el Sales Agent debe marcar los tool requests de solo lectura como `blocking:false` para que no escale a humano innecesariamente; esto no se documenta hoy en el prompt del Sales Agent y quedo descubierto solo al escribir el test end-to-end).
2. **Multi-request no fue reconciliado como infraestructura subordinada real** (seccion 3) - sigue siendo un runtime paralelo apagado por flag, no integrado al loop canonico. Incremento futuro explicito recomendado.
3. **`capabilities/registry.ts` (multi-request) sigue leyendo PrestaShop por SQL directo**, no via el nuevo Catalog Port - deuda documentada en seccion 3, con justificacion de por que no se toco ahora.
4. **`denied` (ej. API key invalida) no dispara una escalacion tecnica formal** (Escalation con target) - hoy solo se audita en `crm_capability_executions` y se responde con un mensaje seguro. ADR-007 pide que una falla sistemica pueda derivar a un target organizacional; este incremento no construyo esa derivacion para el Capability Gateway especificamente (existe un mecanismo de handoff general en el runtime, pero no se conecto automaticamente a `status:"denied"` de una capability).
5. **`get_product_details` se llama automaticamente sobre el primer resultado de `search_products`** dentro de `runCatalogCapabilityStage.ts` para enriquecer con precio/stock real; si el catalogo tiene latencia alta esto duplica el tiempo de respuesta del turno (dos llamadas HTTP secuenciales). No se midio latencia real contra el microservicio en produccion.
6. **Precio no se comunica cuando `get_product_details` falla o no corre** - el mensaje grounded solo cita nombre/disponibilidad en ese caso (correcto segun ADR-005, pero es una limitacion de utilidad, no un bug).

## 13. Entrega

- Documental + funcional: incremento con codigo productivo real, migracion aplicada localmente y verificada (`crm_capability_executions` existe en `main_management`), tests pasando contra BD real y HTTP mockeado.
- Validado: `npx tsc --noEmit` (0), `npm run lint` (0 errores), suite completa `npx tsx --test "tests/**/*.test.ts"` (735/735).
- No se toco auth, schema de tablas existentes, UI, ni ningun archivo fuera del alcance de catalogo/capability-gateway salvo las dos ediciones puntuales en `runNativeAutonomousCycle.ts` y `.env.example`.
