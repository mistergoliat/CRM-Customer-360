---
title: SALES-AGENT-R1 — Commercial Proposal, Shipping and Checkout Readiness Audit
doc_id: audit-sales-agent-r1-commercial-proposal-checkout-readiness
status: completed
owner: architecture
last_reviewed: 2026-08-06
source_of_truth_for:
  - pre-implementation readiness assessment for the proposal/shipping/checkout milestone
  - blocker vs. deferrable classification for that milestone
depends_on:
  - ../PRODUCT_NORTH_STAR.md
  - ../product/autonomous-commerce-prd.md
  - ../product/autonomous-commerce-authority-matrix.md
  - ../CAPABILITY_MATRIX.md
  - ../ACTIVE_RELEASE.md
  - ../ROADMAP.md
  - ./SALES-AGENT-R1-current-commercial-capability-audit.md
  - ./autonomous-commerce-transactional-closure-audit.md
tags:
  - audit
  - sales-agent
  - proposal
  - checkout
  - pre-implementation
---

# SALES-AGENT-R1 — Auditoria preimplementacion: Propuesta comercial, shipping y checkout

Auditoria de solo lectura y diseno preliminar. No se implemento codigo, no se modifico ningun archivo productivo, no se hizo commit, push ni PR. Ejecutada contra `develop@b9d0324` (working tree limpio, `0 ahead / 0 behind` de `origin/develop` — mismo estado verificado en la auditoria previa de este mismo dia). Construida sobre `docs/audits/SALES-AGENT-R1-current-commercial-capability-audit.md` (no re-deriva sus hallazgos generales) mas cuatro subagentes de investigacion en paralelo y verificacion directa de migraciones/repositorios por el auditor principal.

## 1. Resumen ejecutivo

El hito objetivo — propuesta comercial persistente con precio/stock observados, shipping, aceptacion y checkout real, con handoff durable ante fallo — **no requiere rediseno arquitectonico**. El runtime canonico ya esta decidido (`ACS-R1-05.1-T01`, `single_commercial_runtime_authority_accepted`); existe un modelo de datos de cotizacion real y razonablemente bien disenado (`crm_quotes`) que puede **extenderse**, no reemplazarse; el defecto critico de handoff no persistente (ya identificado en la auditoria previa) tiene una correccion trivial de dos lineas con un precedente de codigo ya probado (`manual-reply.ts:70-73`) — es la tarea de menor riesgo y mayor prioridad de todo este documento.

El unico hallazgo que si es estructural y nuevo respecto de la auditoria anterior: **`crm_quotes.request_id` es `NOT NULL` y esta acoplado a `crm_conversation_requests`, la tabla propia del runtime multi-request no-canonico** (migracion 015). `getCurrentQuoteForRequest` falla con `request_not_found` si esa fila no existe, y el Native Agent Tool Loop (el runtime canonico real) **nunca crea filas `crm_conversation_requests`**. Esto significa que `crm_quotes`, tal como esta hoy, no puede usarse directamente desde el runtime canonico sin (a) una migracion aditiva que desacople `request_id` (hacerlo nullable, usar `opportunity_id`/`conversation_id` como ancla primaria para el camino canonico), o (b) hacer que el runtime canonico empiece a crear filas `crm_conversation_requests` solo para satisfacer esta dependencia — la opcion (a) es la recomendada, es aditiva, no rompe al runtime multi-request existente, y no requiere tocar ninguna tabla mas.

Checkout es la pieza mas lejos de resolverse: **cero** integracion real de PrestaShop mas alla de lectura SQL (confirmado exhaustivamente — sin webservice API, sin bridge `master_customer`↔`ps_customer`, sin carrito, sin cart rules, sin link recuperable). Esto no bloquea el inicio de la implementacion del hito completo, pero si bloquea especificamente la tarea de checkout — la primera release funcional recomendada en este documento **termina antes de checkout**, con una propuesta aceptada y shipping resuelto o explicitamente pendiente, dejando la decision de mecanismo de checkout (PrestaShop nativo vs. servicio externo) como una decision de producto explicita para una segunda release.

**Veredicto**: `READY_WITH_LIMITED_OPEN_DECISIONS`.

## 2. Veredicto

```text
READY_WITH_LIMITED_OPEN_DECISIONS
```

No se declara `NOT_READY_ARCHITECTURALLY` porque ninguna decision pendiente fuerza rehacer el runtime (ya decidido), el modelo de persistencia (extensible, no reemplazable) o el source of truth (Catalog Service ya es la autoridad de precio/stock, `crm_quotes` ya es la autoridad de propuesta). La decision de mecanismo de checkout es real y esta abierta, pero es diferible a una segunda release sin invalidar el trabajo de la primera — precisamente el patron que el criterio de "requiere rehacer runtime/persistencia/source-of-truth/integracion-de-checkout/ownership-de-efectos" busca detectar, y que aqui no se encuentra para el alcance de la primera release.

## 3. Flujo objetivo — reconstruccion tecnica

| Paso | Runtime/Modulo | Capability | Persistencia | Dependencia externa | Flag | Estado actual | Punto de corte |
|---|---|---|---|---|---|---|---|
| Mensaje WhatsApp | `app/api/integrations/whatsapp/webhook/route.ts` | n/a | `conversation`, `conversation_message` | Meta | — | L4, funciona | ninguno |
| Comprension de necesidad | Native Agent Tool Loop, `buildAgentStepPromptPackage.ts` | n/a (prompt) | `crm_sales_need_profiles` (parcial, no estructurado por `entityProposals` todavia) | proveedor LLM | `BRAIN_AGENT_TOOL_LOOP_ENABLED` (`false`) | L3-L4 | ninguno critico |
| Busqueda de productos | `search_products`/`explore_catalog`/`recommend_catalog_products` | Capability Gateway, registradas | `crm_capability_executions` | Catalog Service | idem | L4 | ninguno |
| Seleccion de producto y variante | `get_product_details` + `PendingCatalogAction` (solo para "enviar link", no para "seleccionar linea") | idem | `commercial_event` (evento mas reciente, sin tabla dedicada) | Catalog Service | idem | **L1** — no existe un contrato de "linea seleccionada", solo de "producto sobre el que ofrecer un link" | **aqui empieza el gap real** (seccion 6) |
| Confirmacion de cantidad | ninguna | no existe | no existe | — | — | **L0** | gap real |
| Precio y stock observados | `get_product_details`/`explore_catalog` | idem | `crm_capability_executions` (respuesta cruda completa, sin indice/correlacion confiable) | Catalog Service | idem | L4 el dato, **L0 la trazabilidad hacia una propuesta especifica** | seccion 5 |
| Creacion de propuesta persistente | `lib/brain/commercial/quotes/repository.ts` | **no registrada en el Gateway, cero llamadores productivos** | `crm_quotes` (real, versionado) | ninguna | ninguna (nunca se invoca) | **L2 (codigo), L0 (wiring)** | seccion 6 |
| Shipping | ninguna | no existe | `crm_quotes.totals.shipping` siempre `null` | ninguna | — | **L0** | seccion 9 |
| Publicacion de propuesta | `markQuoteSent` | idem, sin llamador | `crm_quotes.status='sent'` | ninguna (el envio real vive en outbox, separado) | — | L2 (codigo), L0 (wiring) | mismo gap |
| Aceptacion o modificacion | `recordQuoteDecision` | idem, sin llamador; ademas ninguna interpretacion de "aceptacion" del cliente existe en el Agent Tool Loop mas alla de `PendingCatalogAction` (solo para link, no para propuesta) | `crm_quotes.status='accepted'` | ninguna | — | **L0 wiring + L0 interpretacion de aceptacion en el loop nativo** | gap real |
| Revalidacion | ninguna | no existe | — | — | — | **L0** | gap real |
| Creacion de checkout | ninguna | no existe en absoluto | no existe | PrestaShop (solo lectura hoy) o servicio externo (no existe) | — | **L0** | seccion 10 |
| Entrega de link | ninguna | no existe | — | — | — | **L0** | mismo gap |
| Handoff durable ante fallo/aprobacion | el modelo puede emitir `handoff`, pero **no persiste** (`dispatchAgentLoopResponse.ts` nunca escribe `human_owner_active`/`ai_enabled`) | n/a | `commercial_event` (auditoria si, control-state no) | — | — | **L3, defecto real identificado y con fix concreto** | seccion 11 |

**Lectura de cierre**: el flujo funciona con solidez hasta "obtener precio/stock de un producto identificado". A partir de "seleccionar una linea con cantidad" el sistema no tiene ningun contrato — no es que este mal disenado, es que **no existe todavia**. `crm_quotes` existe pero esta completamente desconectado del runtime canonico. Checkout no tiene ninguna pieza real que reutilizar salvo patrones de idempotencia de otro modulo.

## 4. Runtime canonico

**Revisado**: Native Agent Tool Loop (`lib/brain/commercial/agent-loop/*`, `native-cycle/*`), Capability Gateway (`capability-gateway/*`), multi-request runtime (`multi-request/*`), legacy sales-consultative (`sales-consultative/*`), outbox (`messaging/*`), follow-up (`followup/*`), onboarding (`native-cycle/customer-session/*`), handoff (`domains/conversations/control.ts`), execution gate (`execution-gate/*`).

1. **¿Cual es hoy el runtime canonico real?** Formalmente, el Native Agent Tool Loop (`runNativeAutonomousCycle -> operational-loop/agent-loop -> persistCommercialState`) es la unica autoridad comercial habilitada por defecto desde `ACS-R1-05.1-T01` (veredicto `single_commercial_runtime_authority_accepted`, motor legacy fail-closed por `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED=false`). Pero el mecanismo especifico de tool-calling gobernado (`AgentStep`, 5 tools) esta el mismo apagado por defecto (`BRAIN_AGENT_TOOL_LOOP_ENABLED=false`) — cuando esta apagado, el camino que corre es `runCommercialShadowEvaluation -> runCommercialOperationalLoop -> runCapabilityExecutionStage`, sin acceso a tools de catalogo propias mas alla de lo que `ACS-R1-05-T06.2` ya conecto (`batch_get_products` para ranking por presupuesto, no tool-calling libre).
2. **¿Cual deberia ser el runtime canonico para este hito?** El Native Agent Tool Loop (`agent-loop/*`), sin ambiguedad. Es el unico con: Capability Gateway gobernado, schemas de argumento explicitos por tool, limites de decisiones/tools por turno, auditoria completa en `crm_capability_executions`, y el unico con evidencia de operacion real (reporte de operador EC2). Toda nueva capability de este hito (`prepare_proposal`, futura `calculate_shipping`, futura `create_checkout_link`) debe registrarse en `CAPABILITY_GATEWAY_REGISTRY` y anadirse a `AGENT_LOOP_TOOL_POOL`.
3. **¿Existe algun bloqueo tecnico para implementar ahi?** Uno real, ya identificado: `crm_quotes.request_id` (NOT NULL) acopla la tabla al runtime multi-request. Ningun otro bloqueo tecnico encontrado — el patron de registro de capability (schema, gateway, proyeccion allowlisted en `buildToolObservation.ts`) ya esta bien establecido y es directamente reutilizable.
4. **¿Que caminos legacy deben mantenerse como bridge?** `find_order`/`get_order_status` (multi-request, SQL real contra `ps_orders`) como bridge de postventa hasta que exista una capability de order-status registrada en el Gateway — es codigo real y correcto, solo mal ubicado. El address book (`lib/domains/customer-addresses/*`, real, CRUD completo, hoy apagado) debe habilitarse como prerrequisito de shipping, no reescribirse.
5. **¿Que caminos no deben recibir nueva funcionalidad?** El motor legacy `sales-consultative` (fail-closed, documentado como "dead code... zero production callers"); el `READ_CAPABILITY_REGISTRY` del multi-request con su `search_products` propio contra SQL de PrestaShop (deuda aceptada, no extender — ya existe un `search_products` correcto en el Gateway); el modulo `outbox-worker` hyphenated (simulador `/dev`, nunca produccion).

**Decision recomendada**: construir toda la funcionalidad nueva de este hito como capabilities del Gateway, expuestas en `AGENT_LOOP_TOOL_POOL`, activando `BRAIN_AGENT_TOOL_LOOP_ENABLED` de forma deliberada — no como una extension del camino shadow/operational-loop legacy, y no como una nueva funcionalidad del runtime multi-request.

## 5. Estado comercial durable

Verificado directamente contra las migraciones reales (no inferido por nombre de tabla):

| Tabla | Existe | Que persiste hoy | Que falta |
|---|---|---|---|
| `crm_opportunities` (migracion 004) | si | `requirements_json`, `missing_requirements_json`, `product_interests_json`, `objections_json`, `signals_json`, `stage`, `status`, `human_owner_active`, `ai_blocked`, `version` (optimistic locking) | ningun campo de "propuesta activa" ni "shipping" — la oportunidad conoce el *interes*, no la *linea comercial concreta* |
| `crm_sales_need_profiles` (migracion 009) | si | `use_case`, `goals_json`, `required_features_json`, `budget_min/max`, `available_space_json`, `location_json`, `delivery_deadline` — **si tiene un campo `location_json` y `delivery_deadline`**, utilizable como semilla de shipping | sin vinculo estructurado a productos/cantidades concretas; es perfil de necesidad, no lineas de pedido |
| `commercial_event` (migracion 011) | si | append-only, fuente de `recentCatalogContext`/`pendingCatalogAction` | no es una fuente de verdad de estado, es un log — reconstruir estado desde aqui es posible pero fragil (ya confirmado para precio/stock en la seccion 6 del audit anterior) |
| `crm_agent_actions`/`crm_agent_decisions` (migraciones 005/004) | si | accion/decision con `policy_status`, `risk_level`, `approval_requirement` — **el vocabulario de aprobacion ya existe a nivel de columna** | ninguna fila de accion representa hoy "propuesta enviada" o "checkout creado" como tipos de accion reales (solo `prepare_quote_draft` como etiqueta del motor legacy, sin ejecutor) |
| `crm_capability_executions` (migracion 022) | si | request/response crudos completos por llamada a tool, sin indice JSON, sin campo `productId` extraible de forma uniforme entre capabilities | no es, ni deberia forzarse a ser, la fuente de verdad de "que se le cotizo al cliente" |
| `crm_quotes` (migracion 020) | si | modelo completo: `items_json`/`totals_json`/`address_snapshot_json`, versionado, `active_marker` (una version activa por `request_id`), `expiry_at`, ciclo de vida completo | **acoplado a `request_id` NOT NULL** (runtime no-canonico); `QuoteItem` no tiene `combinationId`/variante ni campos de observabilidad de precio/stock |
| Tablas de conversacion (`conversation`, `conversation_message`) | si | identidad, control de IA/humano | ya cubierto por la auditoria anterior |

**Que ya existe estructuradamente**: identidad/onboarding, need profile basico, ciclo de vida de propuesta (en `crm_quotes`, desconectado), vocabulario de aprobacion a nivel de columna (`crm_agent_decisions.approval_requirement`).

**Que solo puede reconstruirse desde eventos/mensajes**: que producto especifico se le mostro al cliente en que momento con que precio exacto (parcialmente, via `crm_capability_executions`, con las limitaciones de la seccion 6).

**Que falta persistir**: una linea comercial (producto+variante+cantidad+precio observado+stock observado) como entidad de primera clase — hoy no existe en ninguna tabla, ni siquiera en `crm_quotes.items_json` (que es un JSON snapshot sin campos de variante/observabilidad).

**Que debe anadirse en la primera release**: extender `QuoteItem`/`QuoteTotals` (JSON, sin migracion de schema para el JSON en si, solo el codigo TypeScript) mas la migracion aditiva que desacopla `request_id`.

**Que puede diferirse**: cualquier reconstruccion automatica de need profile desde eventos, cualquier vinculo explicito accion→propuesta mas alla de lo que `created_by_action_id` ya provee.

**No se propone una reconstruccion masiva** — el modelo actual (`crm_opportunities` + `crm_sales_need_profiles` + `crm_quotes`) es extensible de forma segura y aditiva.

## 6. Seleccion de productos y cantidades

1. **¿Puede el runtime distinguir de forma durable entre un producto mencionado y uno confirmado?** No. `PendingCatalogAction` (`agentStepTypes.ts`, `pendingCatalogAction.ts`) solo modela "el turno anterior ofrecio enviar un link de estos productos candidatos" (`actionType: "send_product_link"`, `candidateProductIds: string[]`) — no existe ningun concepto de "producto confirmado para compra". Es un mecanismo de continuidad conversacional, no de seleccion comercial.
2. **¿Puede mantener varias lineas de producto?** No hoy en el runtime nativo. `crm_quotes.items_json` (desconectado) si soporta un arreglo de `QuoteItem`, pero nada en el Agent Tool Loop construye ese arreglo turno a turno.
3. **¿Puede modificar cantidades entre turnos?** No existe ningun campo de cantidad en `PendingCatalogAction` ni en ningun contrato del loop nativo. `QuoteItem.quantity` existe solo dentro de `crm_quotes`, desconectado.
4. **¿Puede reemplazar una variante?** `QuoteItem` no tiene `combinationId` en absoluto (confirmado por lectura directa de `lib/brain/commercial/quotes/types.ts`) — ni siquiera el modelo desconectado soporta variantes hoy.
5. **¿Existe evidencia trazable hacia la ejecucion de catalogo que origino cada producto?** Parcial — `crm_capability_executions` tiene la respuesta cruda, pero ninguna fila de `crm_quotes`/`PendingCatalogAction` referencia el `id`/`public_id` de la ejecucion que origino el dato. No existe un campo de correlacion hoy.

**Contrato minimo propuesto para una linea comercial** (deliberadamente pequeno, sin sobre-diseno):

```text
CommercialLineDraft {
  productId: string
  combinationId?: string              // nuevo — no existe hoy en QuoteItem
  name: string
  quantity: number
  unitPrice: number
  currency: string                    // ya existe a nivel de QuoteTotals, falta a nivel de linea si se permite moneda mixta (no se recomienda para v1 - usar la misma moneda para toda la propuesta)
  priceObservedAt: string (ISO)       // nuevo
  stockObservedAt: string (ISO)       // nuevo
  priceSource: "catalog_service_http" // nuevo, valor fijo hoy (CatalogProvenance.source)
  stockSource: "catalog_service_http" // nuevo
  stockQuantityObserved: number | null // nuevo
  validUntil: string | null           // nuevo
  reservationStatus: "none"           // nuevo, literal fijo para v1 (sin reserva real)
  sourceCapabilityExecutionId?: string // nuevo — correlacion best-effort a crm_capability_executions.public_id
}
```

Esto es una extension aditiva de `QuoteItem` existente, no un nuevo sistema de carrito. No se propone una abstraccion de "carrito" separada de `crm_quotes` — seria una capability monolitica adicional sin necesidad.

## 7. Precio y stock observados

Contrato exacto verificado (`lib/catalog/types.ts`, `httpCatalogAdapter.ts`):

- `CatalogProvenance = {source: "catalog_service_http", retrievedAt: string, cached: boolean}` — **`retrievedAt` se computa client-side** (`new Date().toISOString()` despues del round-trip HTTP), no es un campo real del upstream. `cached` si es un campo real del upstream (`freshness.cached`).
- `CatalogProductPrice = {amount, currency, taxIncluded, discountApplied}` — `currency` presente (nullable), `taxIncluded` presente (nullable boolean), **sin `taxRate`** en absoluto en este contrato v1. `amount` ya es el precio neto de descuento, sin distincion de precio de lista.
- `stockQuantity: number | null` a nivel de producto Y de variante (variante ademas tiene `priceImpact` como delta, nunca precio absoluto).
- `search_products` **no trae precio en absoluto** — solo `get_product_details`/`explore_catalog`/`batch_get_products` lo hacen.
- **Hallazgo importante**: existe un contrato V2 separado (`lib/catalog/search-products-v2/types.ts`), no accesible al modelo, que **si** trae `evaluatedAt` real del upstream y `taxRate`/`taxIncluded=true` reales — el Catalog Service real ya expone esta informacion mas rica, simplemente no a traves de los 4 endpoints que el Sales Agent usa hoy. Implicacion para diseno: una version futura de la propuesta podria beneficiarse de migrar la fuente de precio/stock al endpoint V2, o de anadir esos mismos campos a los endpoints V1.

**Que persiste `crm_capability_executions` realmente**: la respuesta cruda **completa**, sin recorte — confirmado que ninguna de las 4 capabilities de catalogo define `buildRequestSummary`/`buildResponseSummary` (solo `customerIdentityCapabilities.ts` lo hace, para redaccion de PII). `response_summary_json` es el objeto entero `JSON.stringify`'d, incluyendo `provenance`. Una fila por llamada (tras reintentos), `started_at`/`completed_at` capturados en la misma invocacion — sin riesgo de clock-skew dentro de esta tabla.

**¿Puede reconstruirse el precio despues sin tabla nueva?** Parcialmente y con riesgo real: `get_product_details` tiene `productId` como campo top-level confiable; `search_products`/`explore_catalog`/`batch_get_products` lo tienen dentro de un arreglo (una fila puede referenciar multiples productos). Sin indice JSON, sin correlacion a `decision_id`/`action_id` poblada por las capabilities de catalogo hoy, y sin garantia de que "la fila mas reciente" sea la que realmente se cito al cliente (una consulta posterior no relacionada se veria "mas reciente"). **Conclusion**: no conviene depender de `crm_capability_executions` como fuente de verdad de precio cotizado — es preferible que la propuesta (`crm_quotes`/`QuoteItem` extendido) capture su propio snapshot al momento de crear la linea, tal como el comentario de la migracion 020 ya declara como principio de diseno ("items and totals are snapshots — never live references").

**Moneda/impuestos**: `"CLP"` esta **hardcodeado** en tres lugares reales del codigo (motor legacy `catalogRepository.ts:111`, capability legacy `get_product_price` `registry.ts:164`, fallback de `crm_quotes/repository.ts:64`) — es una asuncion de codigo real, no solo prosa de auditoria previa. El contrato V1 vivo del Catalog Service es agnostico de moneda (campo nullable, lo que el upstream envie), sin ninguna variable de entorno que fije la moneda del negocio.

Clasificacion: no es necesario congelar precio ni reservar stock para la v1 — basta con los campos `priceObservedAt`/`stockObservedAt`/`priceSource`/`stockSource`/`validUntil`/`reservationStatus="none"` propuestos en la seccion 6, capturados al momento de construir la linea desde una tool observation ya real (`get_product_details`/`explore_catalog`), sin ninguna llamada adicional al Catalog Service.

## 8. Propuesta comercial persistente

Distincion explicita pedida por el brief, verificada contra codigo real:

```text
data model        : crm_quotes (migracion 020) — real, bien disenado, versionado, snapshots inmutables
repository        : lib/brain/commercial/quotes/repository.ts — real, transaccional, idempotente via created_by_action_id
domain lifecycle  : draft -> sent -> accepted|rejected|expired|superseded — implementado y funcional en el repository
calculation engine: NO EXISTE — subtotal/total son numeros que el llamador debe proveer, cero calculo de impuesto/descuento
runtime capability: NO EXISTE — no registrada en el Capability Gateway, no en AGENT_LOOP_TOOL_POOL, cero llamadores productivos (confirmado por grep — solo su propia definicion y 2 archivos de test la invocan)
delivery mechanism: PARCIAL — markQuoteSent solo marca estado + emite evento interno; la transmision real al cliente depende del pipeline de outbox, no genera documento/PDF
```

1. **¿Que existe realmente?** El data model, el repository, y el domain lifecycle — los tres solidos y testeados (`tests/commercial/quotes.test.ts`). Cero runtime capability, cero calculation engine.
2. **¿Que puede reutilizarse?** Los tres primeros integros. El patron de idempotencia (`created_by_action_id` con `UNIQUE KEY uq_quote_action`) es directamente reutilizable y ya sigue el mismo principio que `customerIdentityCapabilities.ts` usa para `create_customer`/`link_external_identity` (idempotency key derivada de `correlationId`, nunca aleatoria).
3. **¿Que debe construirse?** (a) migracion aditiva que desacopla `request_id`; (b) extension de `QuoteItem`/`QuoteTotals` (seccion 6); (c) capabilities nuevas del Gateway que envuelvan `createQuoteDraft`/`markQuoteSent`/`recordQuoteDecision` con argumentos allowlisted; (d) interpretacion de "aceptacion" del cliente en el prompt/loop nativo (hoy no existe ningun mecanismo — ni siquiera a nivel de `PendingCatalogAction` — para que un mensaje del cliente se traduzca en `recordQuoteDecision("accepted")`).
4. **¿Es mejor extender `crm_quotes` o reemplazarlo?** **Extender.** El unico problema real es el acoplamiento a `request_id`, resoluble con una migracion aditiva (hacer `request_id` nullable, agregar una constraint alternativa de "una version activa por `opportunity_id`" para el camino canonico, sin tocar el comportamiento existente del runtime multi-request). Reemplazar el modelo tirarian trabajo real, testeado, ya alineado con los principios de North Star (snapshots, versionado, nunca referencias vivas).
5. **¿Que estados necesita la primera version?** Los 6 que ya existen (`draft/sent/accepted/rejected/expired/superseded`) alcanzan — no se necesita un estado nuevo para la primera release.
6. **¿La propuesta puede existir con shipping pendiente?** Si, ya soportado estructuralmente (`totals.shipping: number | null`) — se recomienda anadir un campo explicito `shippingStatus: "pending"|"calculated"|"not_required"` para que `null` deje de ser ambiguo entre "todavia no calculado" y "no aplica".
7. **¿Puede asociarse a una identidad provisional y una oportunidad?** Si, ya soportado — `customer_id`/`opportunity_id` son ambos `NULL`able en el schema real (verificado en migracion 020), consistente con el principio de identidad provisional de `PRODUCT_NORTH_STAR.md`.

**Capabilities pequenas propuestas** (evitando una capability monolitica que resuelva todo el flujo, tal como pide el brief):

```text
create_proposal_draft    — arma lineas desde tool observations ya reales de este turno/conversacion (mismo patron de evidencia que recommend_catalog_products)
update_proposal_lines    — agrega/quita/modifica cantidad de una linea, siempre generando una nueva version (nunca mutacion in-place, consistente con el diseno ya existente de crm_quotes)
set_proposal_shipping    — adjunta shippingStatus/monto una vez exista una capability real de shipping (seccion 9); hasta entonces, deja shippingStatus="pending" explicito
publish_proposal         — envuelve markQuoteSent
record_proposal_decision — envuelve recordQuoteDecision, invocada cuando el loop interpreta una aceptacion/rechazo explicito del cliente
```

Ninguna de estas requiere una tabla nueva mas alla de la migracion aditiva ya descrita.

## 9. Shipping

1. **¿Existe una fuente de verdad implementada?** No. Confirmado por busqueda exhaustiva: cero clientes HTTP de shipping/carrier, cero tabla de tarifas, cero integracion n8n de despacho fisico (las coincidencias de "despacho" en n8n son sobre reenvio de mensajes WhatsApp postventa, no logistica).
2. **¿Existe un servicio externo disponible pero no conectado?** No confirmado — no se encontro ninguna referencia (codigo, `.env.example`, docs) a un proveedor de shipping real. `UNCONFIRMED` mas alla de este repositorio.
3. **¿Puede la primera propuesta publicarse con shipping pendiente?** Si — ver seccion 8, punto 6.
4. **¿Que datos minimos requiere el calculo?** Peso (ausente en absoluto — ni siquiera el path legacy lo consulta, confirmado por grep de `weight` en todo el repo con exactamente un hit, en un audit doc que declara su ausencia), dimensiones (existen solo en el path legacy desconectado, `ps_product.width/height/depth`, nunca en el Catalog Service real usado por el Sales Agent), direccion de destino (real y CRUD-completo en `lib/domains/customer-addresses/*`, pero apagado por `BRAIN_CUSTOMER_ADDRESSES_ENABLED=false` con dependencias en cadena de otros dos flags), y una tabla de tarifas/cobertura por comuna/carrier (inexistente).
5. **¿Que casos exigen revision manual?** Cualquier despacho fuera de la cobertura conocida (que hoy es "ninguna"), retiro en tienda (sin logica de disponibilidad de sucursal encontrada), y por defecto **todo calculo de shipping real hasta que exista una integracion**, consistente con la recomendacion de "shipping pendiente" explicito en la propuesta.
6. **¿Shipping bloquea el inicio de implementacion o puede incorporarse en una segunda tarea?** Puede incorporarse despues. `shippingStatus="pending"` desbloquea la primera release completa (propuesta durable + aceptacion) sin esperar shipping real.

**No se inventa arquitectura de shipping** — se marca `UNCONFIRMED` la existencia de cualquier proveedor externo, y `L0_NOT_IMPLEMENTED` con evidencia exhaustiva para todo lo demas.

## 10. Checkout real

1. **¿Existe codigo reutilizable?** Solo el patron de idempotencia/consentimiento/verificacion-post-hoc de `customerIdentityCapabilities.ts` (idempotency key derivada de `correlationId`, transportada como header HTTP real `Idempotency-Key`, consentimiento nunca hardcodeado, verificacion del eco del sistema externo antes de dar por completada la operacion) — un template solido, no codigo de checkout en si.
2. **¿Debe crearse directamente en PrestaShop?** Posible en teoria (existe acceso de lectura SQL a `ps_orders`/`ps_customer`/`ps_address`), pero **no existe ningun cliente de la Webservice API de PrestaShop** (confirmado ausente — cero referencias a `PrestaShopWebservice`/claves de API/ws_key en todo el repo) y **este repositorio nunca escribe a la base de PrestaShop** (confirmado: cero `INSERT`/`UPDATE`/`DELETE` contra `ps_*` en todo `lib/`). Crear una orden PrestaShop real desde aqui requeriria construir ese cliente desde cero, o pasar por la Webservice API real de PrestaShop (fuera del alcance de este repo hoy).
3. **¿Se requiere un microservicio dedicado?** El microservicio ya existente (`MS-pesaschile-catalog-service`, verificado leyendo sus rutas reales) **no expone ningun endpoint de carrito/checkout/orden** — solo busqueda/detalle/batch de productos. Un checkout real requeriria o extender ese microservicio, o construir uno nuevo, o usar la Webservice API nativa de PrestaShop directamente.
4. **¿Que datos minimos se necesitan?** Cliente (real o guest — ver punto 5), direccion, lineas de la propuesta ya aceptada, metodo de envio resuelto o explicitamente omitido, y un mecanismo de idempotencia por accion.
5. **¿Puede crearse sin `customerId` definitivo?** Sin confirmar si PrestaShop soporta guest checkout desde este repo (cero evidencia — ni a favor ni en contra, es configuracion del admin de PrestaShop, fuera del repo). Ademas, **no existe ningun bridge** entre `master_customer` (identidad provisional de este repo) y `ps_customer` — documentado explicitamente en el propio codigo (`lib/domains/customer-identity/local-adapter.ts:14-18`) como una decision deliberada de NO inventar ese vinculo sin contrato verificado.
6. **¿Como se revalidan precio y stock?** No existe mecanismo hoy — tendria que reutilizar el mismo patron de "snapshot en el momento" que `crm_quotes` ya usa, revalidando contra el Catalog Service inmediatamente antes de crear el checkout.
7. **¿Como se evita crear dos carritos o checkouts?** Reutilizando el patron ya probado: idempotency key derivada de `correlationId` + constraint unico en `created_by_action_id` (exactamente como `migrations/018_customer_addresses.sql` ya hace para direcciones).
8. **¿Como se relaciona checkout con propuesta y oportunidad?** Deberia anclarse a `crm_quotes.quote_id`/`opportunity_id`, nunca crear una propuesta nueva implicitamente.

**No se disena pago ni creacion de orden completa en este documento** — son inseparables de la decision de mecanismo de checkout, que es en si misma la pregunta abierta mas grande de este audit (ver seccion 13, punto 5).

## 11. Handoff y aprobacion humana

**Correccion concreta y ya disenada para el defecto identificado en la auditoria previa** (handoff decidido por el modelo no persiste `human_owner_active`/`ai_enabled`):

- **Funcion exacta a reusar**: `takeHumanControlTx(connection, conversationId, nowSql)` (`lib/domains/conversations/control.ts:98-108`) — su firma **ya no asume contexto de operador humano autenticado** (solo toma `connection`, `conversationId: number`, `nowSql: string`). Ya existe un precedente de codigo real llamandola directamente sin pasar por `applyConversationControl` (que si asume operador HTTP): `lib/domains/conversations/manual-reply.ts:70-73`.
- **Cambio recomendado**: `dispatchAgentLoopResponse.ts`, cuando `terminalReason === "handoff"`, debe llamar `takeHumanControlTx` dentro de una transaccion, lo antes posible dentro de la funcion (para que un fallo a mitad de camino deje la conversacion correctamente marcada humana, nunca al reves). Esto ya cancela en la misma transaccion cualquier `brain_message_outbox`/`crm_agent_actions` pendiente de tipo `send_whatsapp_reply`/`request_more_context` para esa conversacion (`cancelPendingAutonomousSendsTx`, linea 107 de `control.ts`).
- **¿Y un follow-up ya agendado?** Verificado que **no requiere cambio adicional**: `shouldCancelFollowUp` (`runFollowupTick.ts:361-408`) relee `human_owner_active`/`ai_enabled` en vivo en cada tick del worker — en cuanto la correccion fije esas columnas, cualquier follow-up ya agendado se cancela automaticamente la proxima vez que el worker lo procese. Hoy esta misma red de seguridad esta silenciosamente neutralizada por la misma causa raiz (las columnas nunca se escriben), no es un defecto separado.
- **Visibilidad en el Hub**: automatica, sin trabajo adicional — `app/(hub)/conversations/[id]/page.tsx:37-59` lee las columnas crudas sin cache; en cuanto la correccion las escriba correctamente, la pagina mostrara `controlMode:"human"`/`priority:"high"`/`department:"human_handoff"` en la siguiente carga.
- **Liberacion de control**: sin cambios — sigue siendo `action:"release"` explicito de un operador, sin automatismo (correcto: un handoff decidido por el modelo no deberia auto-revertirse).
- **¿Comparten handoff y approval la misma infraestructura?** Parcialmente — el vocabulario de columnas (`human_owner_active`/`ai_enabled`) es el mismo para ambos; no existe hoy una distincion visible en el Hub entre "un operador tomo control manualmente" y "la IA escalo" (mismo texto de sistema hardcodeado, mismo `controlMode` de 3 valores sin dimension de "origen") — util para una iteracion futura, explicitamente no requerido para cerrar el defecto.
- **¿Que debe cerrarse antes de proposal/checkout?** Esta correccion especificamente — no por dependencia tecnica (proposal/checkout no la requieren para funcionar), sino porque cualquier caso donde la propuesta/checkout genere una excepcion que requiera escalar a un humano heredaria el mismo defecto si no se corrige antes. Es ademas la tarea de menor esfuerzo y mayor impacto de este documento entero.

**Contraste con lo documentado en `docs/product/autonomous-commerce-prd.md` (RF-12, lineas 1467-1469)**: *"Debe suspender autonomia y transferir contexto."* — el estado actual viola este requisito funcional numerado explicitamente, no es solo una inconsistencia interna. Cita adicional relevante: la matriz de autoridad propia del PRD (§15, lineas 964-1017) ya clasifica "escalar" como ejecutable autonomamente por la IA (consistente con el comportamiento actual de emitir `handoff` sin aprobacion previa) — el defecto no esta en que la IA decida escalar sola, esta en que la plataforma no ejecuta la mitad de "suspender autonomia" que RF-12 exige.

Esta es una **tarea implementable concreta**, no solo una descripcion del defecto — ver TASK_001 en la seccion 16.

## 12. Matriz de autoridad

Comparada contra `docs/product/autonomous-commerce-authority-matrix.md`, `docs/product/autonomous-commerce-prd.md` (§15) y `docs/product/sales-agent-contract.md` — reflejando lo que el codigo **realmente hace hoy**, no la aspiracion documental:

| Accion | IA propone | Backend valida | Dominio decide | Humano aprueba | Sistema ejecuta |
|---|---|---|---|---|---|
| Seleccionar producto | si (`search_products`/`recommend_catalog_products`) | parcial (observaciones allowlisted, sin validacion de "seleccion" dedicada) | no aplica (la respuesta del modelo ES la decision) | no (autonomo) | si (`pendingCatalogAction`) |
| Confirmar cantidad | **no existe** | **no existe** | **no existe** | **no existe** | **no existe** |
| Obtener precio | no implementado en el loop nativo (`get_product_price` existe solo en el registry legacy, fuera del pool) | parcial (aislado) | no aplica | no aplica | no aplica |
| Crear propuesta | parcial, solo en el motor paralelo legacy (`prepare_quote_draft`), nunca en el loop nativo | parcial (`validateCommercialTransition.ts` valida transiciones de estado del motor legacy) | parcial (mismo motor legacy) | no encontrado | solo borrador (`autonomous-state.ts`: "Preparo borrador de cotizacion"), nunca una propuesta final |
| Calcular shipping | **no existe** | **no existe** | **no existe** | **no existe** | **no existe** |
| Publicar propuesta | **no existe** | **no existe** | **no existe** | **no existe** | **no existe** (depende del punto anterior, que tampoco tiene estado final en el loop nativo) |
| Interpretar aceptacion | parcial y estrecho — solo resuelve un `pendingCatalogAction` de "enviar link", nunca una aceptacion de propuesta/cotizacion | parcial (mismo mecanismo) | no aplica | no | si, solo para link de producto — **no existe para cotizacion/checkout** |
| Crear checkout | **no existe** | **no existe** | **no existe** | **no existe** | **no existe** |
| Aplicar descuento | **bloqueado por diseno, no por enforcement** — `apply_discount` aparece solo como nombre dentro de dos constantes de comandos hard-blocked (`salesAgentTypes.ts:172`, `operatorCopilotConstants.ts:180`), nunca como tool ejecutable | no aplica | no aplica | documentado como requerido (PRD §15, contrato linea 212), sin capability que aprobar | ninguna capability existe para ejecutarlo |
| Handoff | si — el modelo emite `{type:"handoff",reason}` autonomamente, consistente con PRD §15 | si (`validateAgentStep.ts`, gate de entrada `humanOwnerActive\|\|aiBlocked`) | parcial (sin gate de politica dedicado, el motor de politica corre en shadow en otro lugar) | no, por diseno (consistente con el PRD) | **parcial/defecto real** — envia el mensaje de reconocimiento pero nunca escribe `human_owner_active`/`ai_enabled` (seccion 11) |

**Disenos a evitar, verificados como ausentes hoy** (ninguno encontrado en el codigo real, buena senal): el backend no calcula estrategia comercial en lugar del agente; el LLM no calcula montos (no hay ningun `calculation engine`, ver seccion 8, asi que tampoco hay uno indebido dentro del LLM); no hay workflows rigidos por keyword en el camino canonico (si en el legacy, ya fail-closed); `apply_discount` esta bloqueado por diseno en dos capas independientes, consistente; no se encontraron efectos sin auditoria (todo pasa por `crm_capability_executions`/`commercial_event`); el contexto efimero no es la memoria principal (`crm_opportunities`/`crm_sales_need_profiles`/`crm_quotes` son las fuentes durables, aunque esta ultima este desconectada).

## 13. Clasificacion de los diez puntos

### 1. Runtime canonico

```text
status: ALREADY_RESOLVED (a nivel de autoridad de escritura) / NEEDED_FOR_FIRST_RELEASE_DESIGN (a nivel de "donde registrar las tools nuevas")
classification: NEEDED_FOR_FIRST_RELEASE_DESIGN
evidence: ACS-R1-05.1-T01 "single_commercial_runtime_authority_accepted"; AGENT_LOOP_TOOL_POOL con 5 tools reales (runAgentToolLoop.ts:34)
decision: toda capability nueva se registra en CAPABILITY_GATEWAY_REGISTRY y se anade a AGENT_LOOP_TOOL_POOL; ninguna nueva funcionalidad en multi-request/legacy
remaining_unknowns: ninguno tecnico; falta la decision operativa de encender BRAIN_AGENT_TOOL_LOOP_ENABLED en un entorno con trafico real
implementation_impact: bajo — el patron de registro ya existe y es directamente reutilizable
can_start_without_full_resolution: si
```

### 2. Autoridad de precio

```text
status: NEEDED_FOR_FIRST_RELEASE_DESIGN
classification: NEEDED_FOR_FIRST_RELEASE_DESIGN
evidence: Catalog Service es la unica fuente (lib/catalog/types.ts); sin congelamiento, sin taxRate en v1, "CLP" hardcodeado en 3 lugares reales
decision: no se congela precio en v1; se captura un snapshot (priceObservedAt/priceSource) al construir la linea de la propuesta, nunca se recalcula retroactivamente sin revalidacion explicita
remaining_unknowns: moneda real del negocio mas alla del hardcode a CLP encontrado (UNCONFIRMED a nivel de configuracion formal); si se debe migrar a search-products-v2 para obtener taxRate real
implementation_impact: medio — requiere decidir explicitamente que taxRate no se modela en v1 (el propio Catalog Service V1 no lo expone)
can_start_without_full_resolution: si
```

### 3. Autoridad de stock

```text
status: NEEDED_FOR_FIRST_RELEASE_DESIGN
classification: NEEDED_FOR_FIRST_RELEASE_DESIGN
evidence: mismo Catalog Service, stockQuantity numerico real a nivel de producto y variante, sin reserva
decision: mismo patron de snapshot que precio (stockObservedAt/stockSource), reservationStatus="none" fijo para v1
remaining_unknowns: ninguno bloqueante
implementation_impact: bajo
can_start_without_full_resolution: si
```

### 4. Mecanismo de shipping

```text
status: CAN_BE_DEFERRED (para calculo real) / NEEDED_FOR_FIRST_RELEASE_DESIGN (para el campo shippingStatus explicito)
classification: CAN_BE_DEFERRED
evidence: L0_NOT_IMPLEMENTED confirmado exhaustivamente (sin peso, sin carrier, sin tarifa); address book real pero apagado
decision: la propuesta v1 se publica con shippingStatus="pending" explicito; no se bloquea el hito por esto
remaining_unknowns: proveedor de shipping real (UNCONFIRMED, fuera del repo)
implementation_impact: ninguno para v1 mas alla de un campo de estado
can_start_without_full_resolution: si
```

### 5. Mecanismo de checkout

```text
status: BLOCKER_BEFORE_IMPLEMENTATION (unicamente para la tarea de checkout en si misma, no para el resto del hito)
classification: BLOCKER_BEFORE_IMPLEMENTATION
evidence: L0_NOT_IMPLEMENTED en toda escritura real de PrestaShop; sin webservice API; sin bridge de identidad; sin endpoint de carrito en el microservicio de catalogo existente
decision: requiere una decision de producto explicita (PrestaShop nativo vs. servicio de checkout externo) antes de escribir cualquier codigo de checkout — no se disena aqui, se recomienda diferir a una segunda release
remaining_unknowns: cual plataforma de checkout autoriza el negocio; si existe (o se construira) un bridge master_customer<->ps_customer; guest checkout habilitado o no en PrestaShop
implementation_impact: alto especificamente para checkout, nulo para el resto del hito si se secuencia correctamente
can_start_without_full_resolution: si, para el resto del hito — no, para la tarea de checkout en si misma
```

### 6. Estado durable de oportunidad

```text
status: ALREADY_RESOLVED en su mayor parte
classification: ALREADY_RESOLVED
evidence: crm_opportunities/crm_sales_need_profiles verificados campo por campo contra migraciones reales; extensible sin romper nada existente
decision: extender, no reconstruir
remaining_unknowns: ninguno bloqueante
implementation_impact: bajo
can_start_without_full_resolution: si
```

### 7. Definicion de propuesta

```text
status: NEEDED_FOR_FIRST_RELEASE_DESIGN
classification: NEEDED_FOR_FIRST_RELEASE_DESIGN
evidence: crm_quotes existe, bien disenado, pero acoplado a request_id NOT NULL (multi-request runtime) y sin campos de variante/observabilidad
decision: extender crm_quotes via migracion aditiva (request_id nullable + ancla alternativa por opportunity_id) mas extension de QuoteItem/QuoteTotals; no reemplazar
remaining_unknowns: exacta forma de la constraint alternativa de "una version activa" quedando compatible con el multi-request existente
implementation_impact: medio — una migracion aditiva + cambios de tipos TypeScript, sin tocar datos existentes
can_start_without_full_resolution: si, la migracion es acotada y bien entendida
```

### 8. Datos exigidos por capability

```text
status: NEEDED_FOR_FIRST_RELEASE_DESIGN
classification: NEEDED_FOR_FIRST_RELEASE_DESIGN
evidence: patron de inputSchema ya establecido (explore_catalog, recommend_catalog_products) directamente reutilizable
decision: cada nueva capability (create_proposal_draft, update_proposal_lines, publish_proposal, record_proposal_decision) define su propio JSON Schema siguiendo el patron existente
remaining_unknowns: ninguno bloqueante
implementation_impact: bajo
can_start_without_full_resolution: si
```

### 9. Handoff persistente

```text
status: NEEDED_FOR_FIRST_RELEASE_DESIGN, con diseno de fix ya completo
classification: NEEDED_FOR_FIRST_RELEASE_DESIGN
evidence: fix exacto identificado — llamar takeHumanControlTx desde dispatchAgentLoopResponse.ts, precedente ya probado en manual-reply.ts:70-73
decision: implementar como TASK_001, antes o en paralelo a todo lo demas
remaining_unknowns: ninguno tecnico
implementation_impact: minimo (cambio de pocas lineas, sin migracion)
can_start_without_full_resolution: si — de hecho, deberia resolverse primero por ser trivial y de alto impacto
```

### 10. Escenarios E2E

```text
status: NEEDED_FOR_FIRST_RELEASE_DESIGN
classification: NEEDED_FOR_FIRST_RELEASE_DESIGN
evidence: ningun escenario E2E de este flujo existe hoy (confirmado — no hay tests que ejerciten crm_quotes desde el loop nativo, porque no hay wiring)
decision: los escenarios minimos de la seccion 14 deben escribirse junto con cada capability nueva, siguiendo el patron ya usado (HTTP double + MariaDB real, nunca mocks para la ruta completa)
remaining_unknowns: ninguno bloqueante
implementation_impact: medio (esfuerzo de testing, no de diseno)
can_start_without_full_resolution: si
```

## 14. Escenarios minimos E2E para la primera release

### Happy path

```text
cliente selecciona productos (search_products/get_product_details, ya reales)
-> confirma variantes y cantidades (NUEVO: capability create_proposal_draft consume la evidencia del turno)
-> recibe propuesta (NUEVO: publish_proposal -> markQuoteSent)
-> shipping explicitamente pendiente (shippingStatus="pending", sin bloquear)
-> acepta (NUEVO: interpretacion de aceptacion -> record_proposal_decision)
-> [fin de la primera release — checkout es la siguiente release]
```

### Variaciones obligatorias para la primera release (dentro del alcance propuesta/aceptacion, sin checkout)

- cambio de cantidad antes de aceptar → nueva version de `crm_quotes`, nunca mutacion in-place (ya soportado por el schema real);
- propuesta nueva que reemplaza a la anterior → mismo mecanismo de version + `active_marker`;
- precio cambiado entre la creacion del borrador y la aceptacion → requiere una revalidacion explicita contra el Catalog Service antes de aceptar (a disenar como parte de `record_proposal_decision`);
- stock no disponible al momento de aceptar → mismo mecanismo de revalidacion, debe degradar a una nueva propuesta o a handoff, nunca aceptar silenciosamente sobre datos obsoletos;
- shipping pendiente → ya cubierto arriba, camino explicito, no un error;
- cliente solicita humano en cualquier punto del flujo → debe ejercitar el fix de la seccion 11 (handoff persistente) dentro de este mismo flujo, no solo de forma aislada;
- identidad provisional (sin `customerId` resuelto) → la propuesta debe poder crearse igual (ya soportado, `customer_id` nullable);
- reinicio del servicio entre la creacion del borrador y la publicacion → debe demostrarse que no se duplica ni se pierde la propuesta (mismo patron de recuperacion ya probado por `ACS-R1-05-T07` para follow-up/outbox, aplicado aqui).

**Diferido explicitamente a una segunda release** (no se disena una matriz exhaustiva de checkout/pago/orden en esta release, consistente con la instruccion del brief): shipping manual/calculado real, checkout duplicado, dependencia de checkout caida.

## 15. Blockers reales

Solo uno califica como `BLOCKER_BEFORE_IMPLEMENTATION` para *alguna* parte del hito, y es acotado a esa parte:

- **Mecanismo de checkout** (seccion 13, punto 5) — requiere una decision de producto (PrestaShop nativo vs. servicio externo) antes de escribir cualquier codigo de checkout. No bloquea el resto del hito si se secuencia correctamente (ver seccion 16).

Todo lo demas es `NEEDED_FOR_FIRST_RELEASE_DESIGN` o `ALREADY_RESOLVED` — ninguna otra pieza fuerza detener el trabajo.

## 16. Decisiones diferibles

- Proveedor de shipping real y su integracion (`CAN_BE_DEFERRED`, con `shippingStatus="pending"` como camino explicito mientras tanto).
- Migracion del contrato de precio/stock al endpoint V2 del Catalog Service (mas rico en `evaluatedAt`/`taxRate`) — mejora, no bloqueo.
- Distincion visible en el Hub entre "operador tomo control" vs "IA escalo" (mejora de UX de operacion, no requerida para cerrar el defecto de handoff).
- Vinculo explicito `crm_agent_actions`↔`crm_quotes` mas alla de `created_by_action_id` (ya suficiente para idempotencia hoy).
- Reconciliacion formal de las tres fuentes de matriz de autoridad que hoy coexisten sin sincronizar (`autonomous-commerce-authority-matrix.md`, PRD §15, `sales-agent-contract.md`) — deuda documental real, no bloquea implementacion.

## 17. Roadmap implementable

```text
TASK_001
objective: corregir el defecto de handoff no persistente
why_now: riesgo activo hoy, independiente de cualquier otra decision; fix trivial con precedente ya probado
scope: dispatchAgentLoopResponse.ts llama takeHumanControlTx cuando terminalReason==="handoff", dentro de una transaccion, antes de construir/enviar el mensaje de reconocimiento
out_of_scope: distincion visible en el Hub entre origen humano/IA del handoff; guard de conversacion cerrada (nota menor, no bloqueante)
dependencies: ninguna
files_or_modules_affected: lib/brain/commercial/agent-loop/dispatchAgentLoopResponse.ts, lib/domains/conversations/control.ts (posible export de un helper toMysql ya duplicado en 2 archivos)
acceptance_criteria: un handoff decidido por el modelo deja human_owner_active=1/ai_enabled=0 en conversation y crm_opportunities; el siguiente inbound no reactiva el loop; un follow-up ya agendado se cancela en el proximo tick del worker
risks: ninguno significativo — mismo patron ya probado en manual-reply.ts

TASK_002
objective: desacoplar crm_quotes de la dependencia obligatoria de request_id
why_now: prerrequisito estructural de cualquier capability de propuesta en el runtime canonico
scope: migracion aditiva que hace request_id nullable en crm_quotes, agrega una via alternativa de "una version activa por opportunity_id" (o conversation_id) para el camino canonico, sin alterar el comportamiento existente del runtime multi-request
out_of_scope: eliminar crm_conversation_requests o el runtime multi-request
dependencies: ninguna
files_or_modules_affected: nueva migracion (029_*), lib/brain/commercial/quotes/repository.ts, lib/brain/commercial/quotes/types.ts
acceptance_criteria: crm_quotes puede crear una fila valida sin un request_id de crm_conversation_requests preexistente; el runtime multi-request sigue funcionando exactamente igual para las filas que si lo usan
risks: requiere cuidado con la constraint unica existente (uq_quote_request_active) — la nueva constraint alternativa debe evitar dos versiones activas simultaneas por opportunity_id tambien

TASK_003
objective: extender QuoteItem/QuoteTotals con los campos de observabilidad de precio/stock y variante
why_now: sin esto, cualquier propuesta creada desde el runtime canonico no cumple lo que pide el hito (precio/stock observados, vigencia)
scope: agregar combinationId, priceObservedAt, stockObservedAt, priceSource, stockSource, stockQuantityObserved, validUntil, reservationStatus, sourceCapabilityExecutionId a QuoteItem; agregar shippingStatus a QuoteTotals
out_of_scope: cualquier calculo automatico de estos campos mas alla de copiarlos de una tool observation ya real
dependencies: TASK_002 (misma migracion/PR puede cubrir ambos)
files_or_modules_affected: lib/brain/commercial/quotes/types.ts, lib/brain/commercial/quotes/repository.ts
acceptance_criteria: una linea de propuesta creada desde una tool observation real conserva su snapshot de precio/stock/vigencia sin recalcularse implicitamente despues
risks: ninguno significativo — cambio de tipos + mapeo, sin logica nueva de negocio

TASK_004
objective: registrar las capabilities de propuesta en el Capability Gateway y anadirlas a AGENT_LOOP_TOOL_POOL
why_now: es el unico paso que realmente conecta crm_quotes al runtime canonico
scope: create_proposal_draft, update_proposal_lines, publish_proposal, record_proposal_decision — cada una pequena, con su propio inputSchema, siguiendo el patron de explore_catalog/recommend_catalog_products
out_of_scope: calculo de shipping, checkout, descuentos
dependencies: TASK_002, TASK_003
files_or_modules_affected: lib/brain/commercial/capability-gateway/registry.ts (o un archivo dedicado, siguiendo el patron de companyKnowledgeCapability.ts/catalogRecommendationGatewayAdapter.ts), lib/brain/commercial/agent-loop/runAgentToolLoop.ts (AGENT_LOOP_TOOL_POOL), buildToolObservation.ts, buildAgentStepPromptPackage.ts
acceptance_criteria: el modelo puede construir una propuesta con lineas reales, publicarla, y el sistema puede interpretar una decision del cliente sobre ella — probado con HTTP double + MariaDB real, nunca solo mocks, siguiendo el mismo estandar que explore_catalog
risks: definir bien la interpretacion de "aceptacion" del cliente en el prompt (evitar falsos positivos de aceptacion) es el riesgo de diseno mas real de esta tarea

TASK_005
objective: hacer visible la propuesta en el Hub (dentro de la vista de oportunidad)
why_now: sin esto, un operador no puede auditar ni intervenir sobre una propuesta activa
scope: superficie de solo lectura mostrando estado/version/lineas/shipping de la propuesta activa de una oportunidad
out_of_scope: edicion manual de la propuesta desde el Hub
dependencies: TASK_004
files_or_modules_affected: app/(hub)/opportunities/[id]/*, lector de dominio nuevo (solo lectura)
acceptance_criteria: una propuesta vigente y su decision se ven y se auditan en la vista de oportunidad
risks: ninguno significativo

--- fin de la primera release funcional ---

TASK_006 (segunda release, requiere decision de producto previa)
objective: decidir y prototipar el mecanismo de checkout real
why_now: es la unica pieza que depende de una decision de producto externa a este repositorio
scope: decision explicita (PrestaShop nativo via Webservice API vs. servicio de checkout externo autorizado) + adapter minimo + capability create_checkout_link
out_of_scope: pago y creacion de orden completos si el mecanismo elegido los separa de la creacion del checkout
dependencies: TASK_001-005 aceptadas; decision de producto sobre plataforma de checkout
files_or_modules_affected: nuevo modulo de integracion, nueva capability del Gateway
acceptance_criteria: el cliente puede iniciar una compra real sin construccion manual de checkout, con idempotencia probada
risks: el mas alto de todo el roadmap — depende de una integracion externa que no existe hoy en ninguna forma
```

**Que puede empezar de inmediato**: TASK_001 (sin dependencias). **Que puede ejecutarse en paralelo**: TASK_002/TASK_003 (misma migracion, secuencial entre si pero independientes de TASK_001). **Que debe esperar**: TASK_004 espera a TASK_002/003; TASK_005 espera a TASK_004; TASK_006 espera a que la primera release este aceptada y a una decision de producto explicita. **Donde termina la primera release funcional**: en una propuesta comercial persistente, versionada, con precio/stock observados y shipping explicitamente resuelto o pendiente, que el cliente puede aceptar — sin checkout todavia. No se propone implementar proposal, shipping, checkout, pago y orden simultaneamente.

## 18. Primera tarea recomendada

`TASK_001` — corregir el defecto de handoff no persistente. Es la unica tarea de este documento sin ninguna dependencia, con un fix ya disenado con precision de `file:line`, con un precedente de codigo ya probado en produccion (`manual-reply.ts`), y que cierra un riesgo real de cara al cliente hoy mismo — independiente de si el resto del roadmap de propuesta/checkout avanza o no.

## 19. Criterios de aceptacion (del hito completo, primera release)

- Un handoff decidido por el modelo deja la conversacion bajo control humano de forma durable, verificado con un follow-up ya agendado que se cancela correctamente.
- Una propuesta comercial puede crearse desde el runtime canonico, con lineas que llevan precio/stock observados y su procedencia, sin depender de `crm_conversation_requests`.
- La propuesta soporta shipping pendiente explicito sin bloquear su publicacion.
- El cliente puede aceptar o rechazar la propuesta y esa decision queda auditada.
- Ningun paso de este flujo inventa precio, stock, disponibilidad o compromisos de shipping — todo dato comercial viene de una tool ya gobernada.
- Checkout queda explicitamente fuera de esta release, con su decision de mecanismo documentada como pendiente, no como resuelta.

---

## Apendice A — Archivos y modulos revisados (principales)

`lib/brain/commercial/quotes/{repository,types}.ts`, `migrations/{004,009,011,015,018,020,022,025}*.sql`, `lib/catalog/types.ts`, `lib/catalog/httpCatalogAdapter.ts`, `lib/catalog/search-products-v2/{types,httpCatalogSearchProductsV2Client}.ts`, `lib/brain/commercial/capability-gateway/{registry,executeCapability,types}.ts`, `lib/brain/commercial/agent-loop/{runAgentToolLoop,agentStepTypes,pendingCatalogAction,dispatchAgentLoopResponse}.ts`, `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts`, `lib/domains/conversations/{control,manual-reply}.ts`, `lib/domains/customer-addresses/repository.ts`, `lib/domains/customer-identity/local-adapter.ts`, `lib/customer-identity/sourceReaders.ts`, `lib/brain/commercial/capabilities/registry.ts`, `lib/brain/commercial/sales-consultative/catalogRepository.ts`, `lib/brain/commercial/followup/runFollowupTick.ts`, `app/(hub)/conversations/[id]/page.tsx`, `docs/product/{autonomous-commerce-prd,autonomous-commerce-authority-matrix,sales-agent-contract}.md`, `docs/audits/{SALES-AGENT-R1-current-commercial-capability-audit,autonomous-commerce-transactional-closure-audit,follow-up-runtime-reconciliation}.md`, y una lectura acotada del repositorio externo `MS-Stock/catalog-service-mvp` (rutas reales, sin endpoint de carrito/checkout).

## Apendice B — Limitaciones de evidencia

- Sin Docker/MariaDB corriendo en este entorno (mismo estado que la auditoria previa del mismo dia) — ningun test nuevo fue ejecutado como parte de esta auditoria de diseno.
- El microservicio `MS-pesaschile-catalog-service` fue leido en su ubicacion local (`C:\Users\Goli\Pesas Chile\MS\MS-Stock\catalog-service-mvp`), que podria no reflejar el estado desplegado real.
- No se inspecciono ningun `.env` real, solo `.env.example` y el codigo que lee las variables — no determinable si algun flag critico esta encendido en un entorno productivo.
- La auditoria historica `autonomous-commerce-transactional-closure-audit.md` (2026-07-08, `status: historical`, `immutable_snapshot: true`) se trata como evidencia forense corroborante, nunca como fuente normativa vigente, consistente con `AGENTS.md`.
- Los cuatro subagentes de investigacion trabajaron con lecturas acotadas; donde declararon `unconfirmed`/`not found`, este documento preserva esa incertidumbre.

## Apendice C — Estado del repositorio al cierre

```text
git status --short   → solo este archivo nuevo, sin cambios en archivos productivos
git diff --stat      → vacio
```

Ningun archivo de produccion fue modificado. Unico archivo creado: este documento.
