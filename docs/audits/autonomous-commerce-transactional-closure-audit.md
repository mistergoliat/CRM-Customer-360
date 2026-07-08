---
title: Autonomous Commerce Transactional Closure Audit
doc_id: audit-autonomous-commerce-transactional-closure
status: historical
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
audited_at: 2026-07-08
immutable_snapshot: true
source_of_truth_for:
  - historical transactional closure evidence
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - audit
  - historical
---

# Autonomous Commerce Transactional Closure Audit

Fecha de inspeccion: 2026-07-08

## Alcance

Auditoria de cierre transaccional y consolidacion de runtime para el estado actual del repositorio.

Fuentes revisadas:

- `docs/product/autonomous-commerce-prd.md`
- `docs/product/autonomous-commerce-current-state.md`
- `docs/product/autonomous-commerce-capability-map.md`
- `docs/product/autonomous-commerce-tool-catalog.md`
- `docs/data/agentic-crm-data-model-audit.md`
- `docs/data/persistence-architecture-decision.md`
- `docs/verification/autonomous-operator-readiness.md`
- `docs/product/autonomous-commerce-review-ac-catalog.md`
- `docs/architecture/adr/ADR-001.md` a `ADR-007.md`
- runtime, migrations, tests y UI citados en el cuerpo de esta auditoria

No se modifico codigo productivo durante esta tarea.

## 1. Resumen ejecutivo

### Que existe realmente hoy

El repo ya tiene un runtime comercial real, pero incompleto para cierre transaccional:

- ingestion nativa real por WhatsApp;
- identidad provisional persistida;
- conversacion durable;
- oportunidad comercial durable;
- perfil de necesidad;
- decision comercial;
- action queue gobernada;
- outbox real;
- worker de envio real;
- reconciliacion de delivery real;
- follow-up real;
- handoff humano real;
- quotes versionadas y auditadas;
- lectura real de ordenes existentes en `ps_orders`;
- UI operativa real sobre algunas superficies.

### Que puede hacer end-to-end hoy

- recibir un inbound real de WhatsApp;
- resolver o crear identidad provisional;
- persistir conversacion y mensaje;
- abrir o continuar opportunity;
- construir contexto comercial;
- producir decision comercial;
- persistir action y outbox;
- enviar por Meta cuando las flags y credenciales lo permiten;
- reconciliar delivery;
- cancelar o replanificar follow-up;
- transferir a humano cuando la politica lo exige;
- redactar y versionar quotes;
- leer ordenes existentes y su estado;
- mostrar parte del estado en UI.

### Que no puede hacer end-to-end hoy

- crear un checkout real productivo;
- crear una orden real desde el runtime actual;
- observar un pago real con webhook o polling de proveedor;
- correlacionar order y payment con un cierre transaccional completo;
- completar una venta estandar sin operator fallback en los tramos transaccionales;
- usar un unico runtime productivo sin carriles legacy/shadow/mock paralelos.

### Runtime canonico que debe sobrevivir

La ruta canonica para el flujo nativo debe ser:

```text
app/api/integrations/whatsapp/webhook/route.ts
-> lib/brain/native-whatsapp/service.ts
-> runNativeAutonomousCycle(...)
```

### Donde esta el cuello de botella

El principal bloqueo no es la falta de razonamiento comercial. Es la ausencia de una capa transaccional completa y la coexistencia de runtimes paralelos:

- `processInbound` legacy;
- runtime nativo;
- multi-request runtime;
- mock/dev-only AI endpoints;
- legacy `n8n_*` en algunos reads y superficies.

### Conclusión operativa

Hoy el sistema es un **gestor autonomo de oportunidades parcial** con tramos transaccionales reales, pero no es aun un vendedor transaccional funcional.

## 2. Runtime canonico

### Ruta que debe quedar como runtime productivo principal

| Tramo | Estado actual | Evidencia | Nota |
| --- | --- | --- | --- |
| Webhook WhatsApp | `PRODUCTION_WIRED` | `app/api/integrations/whatsapp/webhook/route.ts` | valida firma, allowlist y status |
| Servicio nativo | `PRODUCTION_WIRED` | `lib/brain/native-whatsapp/service.ts` | persiste identidad, conversation, opportunity y action |
| Ciclo autonomo | `PRODUCTION_WIRED` | `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts` | orquesta shadow/loop/bridge |
| Decision/accion | `PRODUCTION_WIRED` | `lib/brain/commercial/operational-loop/*`, `lib/brain/commercial/execution-bridge/*` | decision, action y outbox |
| Envio | `PRODUCTION_WIRED` | `lib/brain/messaging/outboxWorker.ts`, `lib/brain/messaging/metaClient.ts` | worker y Meta real |
| Delivery status | `PRODUCTION_WIRED` | webhook Meta + native service | proyeccion monotona |
| UI operativa | `PARTIAL` | `app/(hub)/*`, `lib/domains/*` | algunas superficies son reales, otras preview/fixture |

### Multi-request

`multi-request` no debe considerarse parte del runtime nativo de venta estandar.

Estado real:

- comparte ingress y runtime switch con `runNativeAutonomousCycle(...)`;
- tiene flag dedicada `BRAIN_MULTI_REQUEST_RUNTIME_ENABLED`;
- si la flag esta activa, salta por completo el pipeline single-intent;
- por tanto no es subordinado al runtime nativo, sino un **runtime paralelo compartido**.

Clasificacion:

- mantener como carril separado para request-based flows;
- no usar como camino normal de cierre transaccional;
- desconectar del flujo estandar salvo que el producto defina ese rol de forma explicita.

### Lista exacta

#### Mantener

- `app/api/integrations/whatsapp/webhook/route.ts`
- `lib/brain/native-whatsapp/service.ts`
- `runNativeAutonomousCycle(...)`
- `lib/brain/commercial/operational-loop/*`
- `lib/brain/commercial/execution-bridge/*`
- `lib/brain/messaging/outboxWorker.ts`
- `lib/brain/messaging/outboundMessages.ts`
- `lib/brain/messaging/metaClient.ts`
- `lib/brain/commercial/quotes/*`
- `lib/domains/customer-addresses/*`
- `lib/brain/commercial/capabilities/registry.ts` para `find_order` y `get_order_status`

#### Integrar

- `crm_quotes` con UI de opportunity y cierre;
- `customer_addresses` con quote y futura estimacion de despacho;
- `crm_action_outcomes` con timeline de cierre;
- `ps_orders` con correlacion de cierre;
- lectura de orden en la UI operativa;
- `crm_sales_need_profiles` y quote snapshot en el panel de opportunity.

#### Desconectar

- `processInbound` como camino normal desde WhatsApp;
- `app/api/ai/orchestrate/route.ts` como superficie mock/dev-only;
- `app/api/dev/ai-sdr-simulator/route.ts` como superficie dev-only;
- dependencias `n8n_*` en reads operativos principales;
- `multi-request` del flujo de venta estandar.

#### Deprecar

- shadow/dry-run como camino por defecto del runtime de negocio;
- docs y endpoints que presenten rutas legacy como si fueran el runtime principal;
- superficies que sigan llamando `n8n_*` para el core de CRM.

#### Eliminar posteriormente

- cualquier dependencia silenciosa de `n8n_*` en superficies de producto;
- placeholders que simulan checkout, pago o promociones;
- URLs o imagenes dummy donde el canal requiera datos reales;
- flags que mantengan habilitado el carril shadow como defecto.

## 3. Catalogo real

### Estado del boundary

En este checkout no existe un `lib/catalog` real. El catalogo productivo sigue saliendo de `lib/brain/commercial/sales-consultative/catalogRepository.ts`, que consulta PrestaShop directamente.

Conclusión:

- no existe aun un `CatalogService` formal como boundary productivo en este repo;
- el adapter actual puede servir como base;
- para cierre transaccional completo se requiere formalizar boundary y completar campos faltantes;
- la unica fuente real visible sigue siendo PrestaShop / `ps_*` via SQL.

### Tabla de datos catalogo

| Dato | Fuente real | Endpoint/query | Implementado | Conectado al runtime | Calidad |
| --- | --- | --- | --- | --- | --- |
| SKU | `ps_product.reference` | `catalogRepository.ts` | Si | Si, por search/details | Buena |
| nombre | `ps_product_lang.name` | `catalogRepository.ts` | Si | Si | Buena |
| descripcion | `ps_product_lang.description_short` / `description` | `catalogRepository.ts` | Si | Si | Buena |
| precio | `ps_product.price` + `ps_specific_price` | `catalogRepository.ts` | Si | Si | Buena, pero no es pricing comercial completo |
| stock | `ps_stock_available.quantity` | `catalogRepository.ts` | Si | Si | Buena |
| dimensiones | `ps_product.width` / `height` / `depth` | `catalogRepository.ts` | Si | Si | Buena |
| peso | no hay query real visible en este checkout | N/A | No | No | Ausente |
| compatibilidad | derivada de features/categoria/fabricante | `catalogRepository.ts` | Parcial | Si | Heuristica, no modelo canonico |
| URL | no hay lookup real en este checkout | N/A | No | No | Ausente |
| imagenes | `id_image` se convierte en URL placeholder | `catalogRepository.ts` | Parcial | Si, pero con placeholder | Debil |
| categorias | `ps_category_lang.name` | `catalogRepository.ts` | Si | Si | Buena |
| productos relacionados | heuristica por texto/features | `catalogRepository.ts` | Parcial | Si | No es grafo canonico |

### Lectura tecnica

`search_products`, `get_product_information`, `get_product_price`, `get_product_stock`, `get_product_dimensions`, `get_product_compatibility` y `get_related_products` existen como lectura real en el runtime de capabilities. Pero:

- no existe un boundary formal `CatalogService` en el checkout actual;
- `weight` no esta disponible;
- `URL` real no esta conectada;
- `images` son placeholder;
- `compatibility` y related products son heuristicas de catalogo, no una capa transaccional completa.

### ¿Se puede productivizar con lo existente?

Parcialmente si, pero no sin un servicio/boundary adicional:

- el adapter actual sirve para search, price, stock, dimensions y related-products heuristico;
- para cerrar venta real hacen falta campos y contratos adicionales: peso, URL, reglas de disponibilidad, tarifas, taxes, catalog governance y una capa formal reutilizable por checkout/order/payment.

## 4. Despacho

### Lo que existe

La base real de despacho hoy esta en:

- `customer_addresses`
- `lib/domains/customer-addresses/*`
- `AddressSnapshot` inmovilizada en quotes
- `delivery_deadline` en `crm_sales_need_profiles`
- `delivery` como tipo de claim/policy en el runtime comercial

### Fuente de verdad

- direccion persistida: `customer_addresses`;
- direccion para request: request fact `delivery_address_id`;
- direccion dentro de quote: `addressSnapshot` inmutable;
- detalle de contexto: `crm_sales_need_profiles`.

### Inputs necesarios para calcular shipping

- `region`;
- `commune`;
- `city`;
- `postalCode` si existe;
- `productId` o items;
- `quantity`;
- `dimensions`;
- idealmente `weight`;
- reglas de cobertura y carrier.

### Output esperado

- costo;
- carrier o servicio;
- ETA o ventana;
- cobertura si aplica;
- restricciones y razones de exclusion.

### Casos calculables hoy

- seleccion de direccion valida;
- snapshot inmutable de direccion;
- direccion completa vs incompleta;
- zonas simples si una futura tabla de reglas lo define.

### Casos que requieren handoff

- sin peso real;
- sin carrier o tarifa;
- despacho fuera de cobertura;
- bultos especiales / volumetricos;
- promesa de fecha exacta sin fuente externa.

### Estado de `calculate_shipping` y `get_delivery_estimate`

| Capability | Estado | Lectura real | Dependencia faltante |
| --- | --- | --- | --- |
| `calculate_shipping` | `ABSENT` | hay direcciones y snapshots, pero no calculadora productiva | carrier/rules service o tabla de tarifas |
| `get_delivery_estimate` | `ABSENT` | hay delivery deadline en perfiles, pero no oracle de entrega | fuente externa / SLA operativo |

### Conclusion

El repo tiene la base de direccion y snapshot, pero no tiene todavia la capa de despacho productivo. Se puede implementar sobre la infraestructura actual, pero no sin un servicio adicional de reglas o carrier.

## 5. Promociones y medios de pago

### Lo que existe

- `ps_specific_price` ya se usa para precio efectivo en catalogo;
- el knowledge agent conoce `paymentMethods` como informacion estatica;
- los documentos PRD mencionan promociones, descuentos, cuotas y medios de pago;
- no hay una capa transaccional de promociones o pagos productiva en runtime.

### Lo que no existe

- motor de promociones de carrito;
- cart rules productizadas;
- cupones con impacto transaccional real en runtime;
- listado de payment options por proveedor;
- integracion de medios de pago con orden o checkout;
- webhooks/polling de pago.

### `get_active_promotions`

Estado: `ABSENT`

Motivo:

- no hay fuente verificada conectada al runtime;
- lo mas cercano es `ps_specific_price`, que solo cubre descuento/precio especifico, no promociones comerciales completas.

### `get_payment_options`

Estado: `ABSENT`

Motivo:

- solo hay surfaces informativas y docs;
- no hay proveedor ni API de checkout/pago conectada;
- el LLM no puede inventar medios de pago ni aplicar descuentos.

### `get_commercial_policy`

Estado: `IMPLEMENTED_NOT_WIRED`

Motivo:

- la politica comercial si existe como codigo y ADRs;
- no esta expuesta como capability productiva de lectura;
- puede publicarse casi sin cambiar la arquitectura, pero hoy es solo una frontera interna.

### Regla obligatoria

No se debe permitir que el modelo invente descuentos, promociones ni medios de pago. La politica solo puede leerse desde fuentes verificadas o configuraciones operativas.

## 6. Quotes

### Estado real

`crm_quotes` si existe, si persiste y si tiene tests.

Schema real:

- `quote_id`;
- `request_id`;
- `conversation_id`;
- `opportunity_id`;
- `customer_id`;
- `created_by_action_id`;
- `version`;
- `status` = `draft|sent|accepted|rejected|expired|superseded`;
- `items_json`;
- `totals_json`;
- `address_snapshot_json`;
- `expiry_at`;
- `sent_at`;
- `decided_at`.

### Lo que ya existe

- versionado;
- idempotencia por `created_by_action_id`;
- snapshot inmutable de items y direccion;
- transicion `draft -> sent -> accepted/rejected/expired`;
- expiracion;
- evento `quote_created`;
- evento `quote_sent`;
- evento `quote_accepted` / `quote_rejected`;
- tests de versionado, conflicto y expiracion.

### Lo que esta desconectado del cierre transaccional completo

- la UI de opportunity no consume `quote` como cierre principal;
- `quote` no crea checkout por si sola;
- `quote` no crea order;
- `quote` no confirma payment;
- `quote` solo resuelve request-based flows y documenta el artefacto comercial.

### Relacion con cliente, opportunity, direccion, decision y action

| Relacion | Estado |
| --- | --- |
| customer -> quote | Si, via `customer_id` o snapshot de contexto |
| opportunity -> quote | Si, via `opportunity_id` |
| address -> quote | Si, via `address_snapshot_json` |
| decision/action/request -> quote | Si, via `created_by_action_id` y `request_id` |
| vigencia | Si, `expiry_at` |
| totales | Si, snapshot JSON |
| despacho/impuestos/promociones | Parcial / no completo |

### Conclusion

Quotes estan realmente implementadas y son reutilizables para el cierre transaccional. El problema es que todavia no son el artefacto que empuja la compra hasta order/payment.

## 7. Checkout

### Estado

`create_checkout_link` no esta implementado como capability productiva en este checkout.

### Evidencia

- no existe implementacion en `lib/brain/commercial/capabilities/registry.ts`;
- no hay `ps_cart` ni cart rules ni carrito prellenado en el runtime principal;
- no hay checkout API o deep-link productivo visible en el checkout actual;
- la ruta nativa no produce checkout, solo quote/outbox/handoff.

### Opcion mas directa

La opcion mas directa seria un checkout nativo de PrestaShop o un deep link a carrito/checkout externo, pero esta ruta requiere un servicio adicional o una integracion que hoy no existe en el repo.

### Conclusión

`create_checkout_link` es `ABSENT` como capability de producto, y no conviene inventar un checkout propio si PrestaShop o el proveedor de ecommerce ya pueden cubrirlo. En el estado actual, falta la integracion.

## 8. Orden

### Lo que existe

Existe lectura real de ordenes en `ps_orders`:

- `find_order`;
- `get_order_status`;
- `list_request`/reducer de `order_status`;
- tests que pasan cuando la tabla existe y degradan cuando no.

### Lo que no existe

- create order productivo desde el runtime actual;
- webhooks de order creation;
- correlacion automatica order -> opportunity en el flujo estandar;
- pipeline de order observada a partir del checkout.

### Correlacion correcta

La correlacion correcta debe apoyarse en:

- `id_order`;
- `reference`;
- `invoice_number`;
- email;
- `customer_id`;
- `wa_id` / identity provisional;
- request facts y conversation/request linkage.

### Riesgos de correlacion incorrecta

- unir por telefono sin orden o factura real;
- unir por texto del mensaje;
- usar `n8n_*` como verdad primaria;
- asumir que cualquier `ps_orders` es de la oportunidad activa.

### Conclusion

`get_order_status` y `find_order` estan productivamente implementadas como lectura, pero la creacion y la observacion de la orden desde el flujo de compra siguen faltando.

## 9. Pago

### Lo que existe

- la politica comercial conoce claims de `payment`, `order_status`, `delivery` y `commercial_condition`;
- hay contenidos de ayuda/knowledge sobre medios de pago;
- no hay provider de pagos conectado al runtime transaccional.

### Lo que falta

- provider;
- webhook;
- polling;
- estados de pago;
- relacion pago -> order;
- relacion pago -> opportunity;
- manejo de reversos/cancelaciones.

### Evidencia para cerrar oportunidad como `won`

`opportunity.status = won` no puede venir de interpretacion de lenguaje.

Debe venir de evidencia dura como:

- quote aceptada;
- order creada;
- payment confirmado;
- o una decision/policy con evidencia trazable equivalente.

### Conclusion

El pago es `ABSENT` como capacidad productiva. La opcion correcta es integrar un proveedor real y usar su evidencia como input al cierre.

## 10. Flujo de cierre

Flujo objetivo:

```text
recommendation
-> quote
-> checkout
-> order_created
-> payment_confirmed
-> mark_won
-> cancel_pending_followups
-> persist_outcome
-> update_UI
```

### Estado por paso

| Paso | Evento | Servicio | Tabla | Capability | Comando | Side effect | Idempotencia | Error | Retry | Criterio de aceptacion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| recommendation | `recommend_product` / response proposal | sales consultative engine | `crm_agent_decisions`, `crm_agent_actions` | parcial | internal action | yes | yes por action key | policy block | yes | producto real recomendado con evidencia |
| quote | `quote_created` / `quote_sent` | quotes repo | `crm_quotes`, request events | wired | `createQuoteDraft`, `markQuoteSent` | snapshot durable | yes | invalid quote / conflict | yes | quote versionada, auditable y visible |
| checkout | `checkout_started` | N/A hoy | N/A | absent | N/A | N/A | N/A | missing integration | N/A | link de checkout real y trazable |
| order_created | `order_created` | N/A hoy / external commerce | `ps_orders` u otro source | absent as write | N/A | event trace | no | missing source | N/A | orden observada y correlacionada |
| payment_confirmed | `payment_confirmed` | payment provider | payment store | absent | N/A | event trace | no | missing provider | N/A | pago confirmado con webhook/polling |
| mark_won | `won` transition | commercial policy / state machine | `crm_opportunities` | partial | state transition | opportunity terminal | yes | no evidence / policy block | yes | won solo con evidencia dura |
| cancel_pending_followups | `followup_cancelled` | follow-up planner | `crm_agent_actions` | wired | cancel action | follow-ups invalidated | yes | CAS conflict | yes | ninguna accion futura queda viva |
| persist_outcome | `action_outcome` | outcome persistence | `crm_action_outcomes`, `commercial_event` | wired | persist outcome | audit trail | yes | duplicate / missing link | yes | outcome terminal trazable |
| update_UI | `timeline updated` | UI/read models | read models | partial | N/A | visible state | N/A | stale cache / partial data | yes | UI refleja estado terminal |

### Lectura de cierre

Los primeros dos pasos existen realmente. Los pasos checkout/order/payment no. Por eso el flujo completo sigue roto en la mitad transaccional.

## 11. Plan de incrementos

### Incremento 1

```text
Incremento:
Convertir la quote en artefacto principal de cierre visible en opportunity y request.

Componentes existentes reutilizados:
- `crm_quotes`
- `crm_sales_need_profiles`
- `customer_addresses`
- `crm_agent_actions`
- `crm_action_outcomes`
- outbox y timeline ya existentes

Código nuevo:
- presentacion de quote en UI de opportunity
- exposicion de estado quote en read model
- enlace quote <-> action/outcome

Código modificado:
- opportunity service
- acciones / timeline UI

Capability habilitada:
- quote-to-close traceable

Flujo real:
recomendacion -> quote -> UI -> decision explicita

Prueba end-to-end:
- quote creada, enviada y aceptada/rechazada con evento y UI

Criterio de termino:
- una quote vigente y su decision se ven y se auditan en la oportunidad
```

### Incremento 2

```text
Incremento:
Agregar checkout link real basado en la plataforma de ecommerce existente o en un servicio de checkout externo autorizado.

Componentes existentes reutilizados:
- quote
- product catalog
- customer identity
- opportunity

Código nuevo:
- adapter de checkout
- capability `create_checkout_link`

Código modificado:
- flow de quote
- UI de opportunity

Capability habilitada:
- checkout link trazable y idempotente

Flujo real:
quote -> checkout link -> customer click -> evento de checkout_started

Prueba end-to-end:
- link generado, auditado, expirado o regenerado de forma idempotente

Criterio de termino:
- el cliente puede iniciar compra real sin construccion manual de checkout
```

### Incremento 3

```text
Incremento:
Correlacionar order y payment con la opportunity activa.

Componentes existentes reutilizados:
- `ps_orders` lectura
- request facts
- customer identity
- `crm_action_outcomes`

Código nuevo:
- webhook/polling de order/payment
- reconciliacion order -> opportunity

Código modificado:
- read models de opportunity
- closure policy

Capability habilitada:
- order_created / payment_confirmed

Flujo real:
checkout -> order_created -> payment_confirmed

Prueba end-to-end:
- order y payment entran al mismo cierre sin correlacion erronea

Criterio de termino:
- la oportunidad puede pasar a terminal con evidencia dura
```

### Incremento 4

```text
Incremento:
Cerrar el ciclo con `mark_won` y cancelacion automatica de follow-ups pendientes.

Componentes existentes reutilizados:
- state machine de opportunity
- follow-up worker
- action outcomes
- audit log

Código nuevo:
- criterio de won basado en evidencia
- orquestacion de cancelacion de pending work

Código modificado:
- policy
- UI de cierre

Capability habilitada:
- opportunity.won productivo

Flujo real:
payment_confirmed -> mark_won -> cancel_pending_followups -> persist_outcome -> update_UI

Prueba end-to-end:
- una oportunidad solo se marca won con evidencia dura y sin follow-ups residuales

Criterio de termino:
- compra estandar completamente autonomica
```

## 12. Recomendacion de consolidacion del runtime

### Canonico

Conservar como runtime productivo principal:

- `app/api/integrations/whatsapp/webhook/route.ts`
- `lib/brain/native-whatsapp/service.ts`
- `runNativeAutonomousCycle(...)`
- `lib/brain/commercial/operational-loop/*`
- `lib/brain/commercial/execution-bridge/*`
- `lib/brain/messaging/outboxWorker.ts`

### Aislar

Mantener fuera del camino normal de venta estandar:

- `processInbound`
- `app/api/ai/orchestrate/route.ts`
- `app/api/dev/ai-sdr-simulator/route.ts`
- `multi-request`

### Dejar como soporte

- quotes;
- request facts;
- address management;
- order lookup;
- action outcomes;
- UI read models.

## A. Arquitectura transaccional existente

- inbound nativo real por WhatsApp;
- conversation durable;
- opportunity durable;
- quote durable;
- outbox + worker real;
- delivery reconciliation real;
- order lookup real;
- follow-up real;
- handoff real;
- UI parcial real.

## B. Fuentes de verdad

- `conversation` y `conversation_message` para thread y timeline;
- `master_customer` + `customer_external_identity` para identidad provisional;
- `crm_opportunities` para estado comercial;
- `crm_sales_need_profiles` para contexto de necesidad;
- `crm_agent_decisions` para decision comercial;
- `crm_agent_actions` para accion;
- `crm_quotes` para quote;
- `brain_message_outbox` para salida;
- `crm_action_executions` y `crm_action_outcomes` para ejecucion/outcome;
- `customer_addresses` para direccion;
- `ps_orders` para observacion de orden;
- `hub_audit_log` / `commercial_event` para auditoria.

## C. Capabilities reutilizables

- ingestion WhatsApp;
- identity resolution;
- conversation threading;
- commercial decisioning;
- action queue;
- outbox;
- worker;
- delivery projection;
- follow-up;
- quote versioning;
- request facts;
- address snapshot;
- order lookup;
- action outcomes.

## D. Capabilities que deben implementarse

- `calculate_shipping`;
- `get_delivery_estimate`;
- `get_active_promotions`;
- `get_payment_options`;
- `get_commercial_policy` como capability de lectura;
- `create_checkout_link`;
- order creation / checkout observation;
- payment confirmation ingestion;
- `mark_won` como cierre basado en evidencia;
- `mark_lost` como cierre con evidencia;
- external carrier or pricing integration;
- formal `CatalogService` boundary.

## E. Runtime que debe desconectarse

- `processInbound` como ruta normal de venta estandar;
- `app/api/ai/orchestrate/route.ts`;
- `app/api/dev/ai-sdr-simulator/route.ts`;
- dependencias `n8n_*` en el core del CRM;
- `multi-request` como camino normal del flujo estandar;
- shadow/dry-run como defecto del runtime principal.

## F. Secuencia recomendada de desarrollo

1. hacer visible y trazable la quote en la oportunidad;
2. agregar checkout link real o servicio equivalente;
3. correlacionar order_created con opportunity;
4. conectar payment_confirmed;
5. habilitar `mark_won` basado en evidencia;
6. cancelar follow-ups pendientes al cierre;
7. consolidar runtime y apagar rutas paralelas del flujo estandar.

## G. Flujo end-to-end final

```text
WhatsApp inbound
-> identidad
-> conversacion
-> oportunidad
-> discovery
-> recomendacion
-> precio y stock
-> despacho y entrega
-> cotizacion
-> checkout
-> orden
-> pago
-> opportunity won
```

El flujo final todavia no existe completo. La mitad inicial si; la mitad transaccional no.

## H. Bloqueos externos reales

- proveedor de checkout o ecommerce;
- source de tarifas de despacho;
- fuente de stock/precio con gobernanza de comercio;
- proveedor de pago;
- posible necesidad de APIs o webhooks de PrestaShop / ecommerce externo;
- allowlist y credenciales Meta para envio real;
- cualquier integracion carrier o payment gateway.

## I. Decisiones que requieren definicion de producto

- si el checkout sera PrestaShop nativo, link externo o integracion propia;
- que source es autoritativo para shipping y delivery;
- como se exponen promociones sin permitir invencion del LLM;
- que evidencia exacta autoriza `won`;
- si `multi-request` se conserva como runtime paralelo o se restringe a un carril secundario;
- que surfaces de UI deben dejar de leer `n8n_*`;
- como se formaliza `CatalogService` como boundary unico.
