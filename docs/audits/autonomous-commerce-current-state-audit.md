---
title: Autonomous Commerce Current State Audit
doc_id: audit-autonomous-commerce-current-state
status: historical
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
audited_at: 2026-07-08
immutable_snapshot: true
source_of_truth_for:
  - historical current state evidence
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - audit
  - historical
---

# Autonomous Commerce Current State Audit

Fecha de inspeccion: 2026-07-08

## Alcance y fuentes

Este documento audita el estado real del repo respecto de:

- `docs/product/autonomous-commerce-prd.md`
- `AGENTS.md`
- ADR-001 a ADR-007
- `docs/product/autonomous-commerce-current-state.md`
- `docs/product/autonomous-commerce-capability-map.md`
- `docs/product/autonomous-commerce-tool-catalog.md`
- `docs/data/agentic-crm-data-model-audit.md`
- `docs/data/persistence-architecture-decision.md`

Tambien se inspeccionaron rutas de runtime, migraciones, workers, tests y UI operativa. La regla principal aplicada fue no confundir contratos, schemas, mocks, fixtures o tests con capacidad productiva si no existe runtime, persistencia, efecto y salida real.

## Taxonomia usada

Estados usados exactamente como pide la auditoria:

- `PRODUCTION_WIRED`
- `IMPLEMENTED_NOT_WIRED`
- `PARTIAL`
- `MOCK_OR_DEV_ONLY`
- `BLOCKED_EXTERNAL`
- `LEGACY`
- `DEPRECATED`
- `ABSENT`
- `UNKNOWN`

## 1. Resumen ejecutivo

### Veredicto actual

**Clasificacion final: `gestor autonomo de oportunidades parcial`**

### Respuesta corta

Hoy el repo no es un chatbot ni un nucleo no funcional. Tampoco es aun un gestor autonomo de oportunidades completo.

Lo que realmente existe es un sistema comercial native-first con:

- ingreso real por WhatsApp;
- identidad provisional persistida;
- conversacion y mensaje durables;
- oportunidad comercial activa;
- perfil de necesidad y decision comercial persistidos;
- cola de acciones gobernadas;
- outbox y envio externo por Meta;
- reconciliacion de delivery;
- follow-up automatizado;
- handoff humano;
- UI operativa real sobre varias superficies.

Lo que no existe aun como flujo estandar cerrado es:

- calculo transaccional completo de despacho y entrega;
- promociones y medios de pago productivizados;
- checkout nativo;
- creacion/correlacion de orden y pago;
- cierre ganado como ruta de producto completa y no solo como estado o transicion interna;
- una unica frontera de runtime sin rutas paralelas legacy/shadow/mock.

### Producto real hoy

El producto real hoy es un **CRM comercial autonomo parcial** que ya opera sobre una base nativa de conversaciones, oportunidades, decisiones, acciones y outbox, pero sigue conviviendo con:

- runtime legacy `processInbound`;
- runtime nativo `processNativeWhatsAppInbound`;
- runtime multi-request/operational loop;
- superficies mock/dev-only;
- vistas legacy `n8n_*`;
- catalogo parcialmente externo;
- multiples feature flags que cambian el camino efectivo.

### Que puede hacer end-to-end

- recibir un WhatsApp real;
- validar firma y allowlist;
- deduplicar por `providerMessageId`;
- resolver o crear identidad provisional;
- persistir conversacion y mensaje;
- activar un ciclo autonomo;
- calcular una decision comercial;
- persistir una accion gobernada;
- encolar outbound;
- enviar por Meta cuando esta habilitado;
- proyectar delivery status;
- cancelar o replanificar follow-up;
- suspender autonomia y transferir a humano;
- renderizar el estado en UI operativa.

### Que no puede hacer end-to-end

- completar una venta estandar de punta a punta sin huecos;
- cotizar con flujo transaccional cerrado;
- checkout nativo;
- orden nativa;
- pago observado y correlacionado al opportunity de forma productiva completa;
- reactivacion comercial como capacidad de producto final;
- omnicanal real;
- eliminar completamente legacy/shadow/mock.

### Dependencia de legacy

Sigue habiendo dependencia de:

- `processInbound` como ruta general historica;
- `n8n_*` para casos y mensajes legacy;
- vistas y superficies historicas;
- docs y blueprints que mezclan fases anteriores con el estado actual.

### Runtime productivo principal

El runtime principal productivo para WhatsApp nativo es:

`app/api/integrations/whatsapp/webhook/route.ts`
-> `lib/brain/native-whatsapp/service.ts`
-> `runNativeAutonomousCycle(...)`
-> `crm_agent_decisions` / `crm_agent_actions`
-> `brain_message_outbox`
-> worker de outbox
-> Meta
-> delivery webhook
-> proyeccion de estado
-> UI

### Runtimes paralelos

Si, existen runtimes paralelos:

- `processInbound` legacy general;
- runtime nativo WhatsApp;
- multi-request autonomous cycle;
- mock AI orchestrator endpoint;
- dev AI SDR simulator;
- workers autonomos separados para outbox y follow-up.

### Puede completar una venta estandar hoy

**No de forma completa.**

Puede avanzar muy lejos en descubrimiento, calificacion, recomendacion, objeciones, follow-up, handoff y outbound. Pero hoy no cierra una venta estandar con checkout, orden y pago correlacionados como un flujo productivo completo.

### Punto exacto de derivacion humana

La derivacion a persona ocurre cuando:

- hay `human_owner_active`;
- la politica exige review o aprobacion;
- existe conflicto de identidad;
- el resultado de policy o sales agent lo pide;
- el opportunity entra en handoff;
- la autonomia queda bloqueada por riesgo, aprobacion o propietario humano.

### Principal cuello de botella

El cuello de botella principal no es la ausencia de inteligencia comercial basica. Es la **fragmentacion del runtime y la falta de un tramo transaccional completo**:

- catalogo parcialmente externo;
- quote/check-out/order/payment incompletos;
- estados terminales no cerrados como producto final;
- coexistencia de rutas legacy, nativas, mock y multi-request.

## 2. Mapa del runtime productivo

### Flujo principal real

| Tramo | Entry point | Archivos principales | Tablas leidas | Tablas escritas | Workers / colas | Flags / deps | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Entrada | `POST /api/integrations/whatsapp/webhook` | `app/api/integrations/whatsapp/webhook/route.ts` | payload Meta | `hub_audit_log` | webhook HTTP | Meta signature, allowlist | `PRODUCTION_WIRED` |
| Normalizacion | parseo inbound/status | `app/api/integrations/whatsapp/webhook/route.ts`, `lib/brain/native-whatsapp/service.ts` | payload Meta | `conversation_message`, `brain_message_outbox` indirecto | none | `DB_WRITE_ENABLED`, allowlist | `PRODUCTION_WIRED` |
| Identidad | resolve/create customer | `lib/brain/native-whatsapp/service.ts`, `lib/integrations/customer-master/customer-repository.ts`, `lib/integrations/customer-external-identity/*` | `master_customer`, `customer_external_identity` | `master_customer`, `customer_external_identity` | none | MariaDB | `PRODUCTION_WIRED` |
| Conversacion | create/update thread | `lib/brain/native-whatsapp/service.ts`, `lib/domains/conversations/repository.ts` | `conversation`, `conversation_message` | `conversation`, `conversation_message` | none | MariaDB | `PRODUCTION_WIRED` |
| Oportunidad | commercial memory | `lib/brain/native-whatsapp/service.ts`, `lib/brain/commercial/sales-consultative/repository.ts` | `crm_opportunities`, `crm_sales_need_profiles`, `crm_agent_decisions`, `crm_agent_actions` | mismas | none | MariaDB | `PRODUCTION_WIRED` |
| Contexto | native conversation detail | `lib/brain/native-whatsapp/service.ts` | varias anteriores + `commercial_event` | none | none | read model | `PRODUCTION_WIRED` |
| Ciclo autonomo | native autonomous wrapper | `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts` | estado comercial, flags | decisiones y acciones segun resultado | runtime interno | `BRAIN_SALES_AGENT_ENABLED`, `BRAIN_COMMERCIAL_SHADOW_ENABLED`, `BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED` | `PRODUCTION_WIRED` |
| Decision | sales consultative engine | `lib/brain/commercial/sales-consultative/engine.ts` | contexto, catalogo, oportunidad | `crm_agent_decisions`, `crm_agent_actions`, `crm_opportunities`, `crm_sales_need_profiles`, `commercial_event` | none | policy + catalog boundary | `PRODUCTION_WIRED` |
| Accion | governed action queue | `lib/brain/commercial/execution-bridge/runCommercialExecutionBridge.ts`, `lib/brain/commercial/action-queue/persistAgentAction.ts` | `crm_agent_actions` | `crm_agent_actions` | queue semantics | gates / idempotency | `PRODUCTION_WIRED` |
| Capability/tool | read/write tools internas | `lib/brain/commercial/sales-consultative/repository.ts`, `lib/brain/commercial/sales-consultative/catalogRepository.ts` | catalogo, CRM, conversaciones | CRM/outbox segun tool | none | CatalogService boundary parcial | `PARTIAL` |
| Outbox | queue customer message | `lib/brain/messaging/outboundMessages.ts`, `brain_message_outbox` | `brain_message_outbox` | `brain_message_outbox`, `conversation_message` | outbox worker | `BRAIN_PERSIST_CANONICAL_OUTBOUND`, `BRAIN_META_SEND_ENABLED` | `PRODUCTION_WIRED` |
| Worker | send locked outbox rows | `lib/brain/messaging/outboxWorker.ts`, `scripts/autonomous-outbox-worker.ts` | `brain_message_outbox` | `brain_message_outbox`, `conversation_message` | persistent worker | worker flags, Meta creds | `PRODUCTION_WIRED` |
| Provider | Meta Graph API | `lib/brain/messaging/metaClient.ts` | allowlist, config | provider side effect | external provider | Meta credentials, HTTPS | `BLOCKED_EXTERNAL` |
| Delivery status | webhook status projection | `app/api/integrations/whatsapp/webhook/route.ts`, `lib/brain/native-whatsapp/service.ts` | payload Meta, outbox | `conversation_message`, `brain_message_outbox`, `commercial_event` | webhook HTTP | Meta status callbacks | `PRODUCTION_WIRED` |
| Outcome | delivery / action outcomes | `lib/brain/messaging/outboundMessages.ts`, `lib/brain/commercial/*` | outbox, actions | `crm_action_outcomes`, `commercial_event` | workers / hooks | repo paths in tests | `PRODUCTION_WIRED` |
| Actualizacion comercial | opportunity state updates | `lib/brain/commercial/sales-consultative/repository.ts`, `lib/brain/commercial/operational-loop/*` | opportunity / decision state | `crm_opportunities`, `crm_agent_decisions`, `crm_agent_actions` | internal orchestration | policy state machine | `PRODUCTION_WIRED` |
| UI | operational dashboards | `app/(hub)/*`, `lib/dashboard.ts`, `lib/domains/*` | CRM tables + legacy views | none | UI | mixed real/fixture/preview | `PARTIAL` |

### Que tramo es teorico o no conectado

- `calculate_shipping`, `get_delivery_estimate`, `get_payment_options`, `get_active_promotions`, `create_checkout_link`, `queue_email`, `place_sales_call`, `mark_won`, `mark_lost`, `pause_opportunity`, `reactivate_opportunity` siguen siendo planificados, parciales o ausentes como capacidades de producto final.
- `app/api/ai/orchestrate/route.ts` es un endpoint mock/dev-only con aviso explicito de que no usa LLM, no escribe DB y no envia WhatsApp.
- `app/api/dev/ai-sdr-simulator/route.ts` es dev-only.

## 3. Flujos end-to-end

### A. Inbound real de WhatsApp

Estado: `PRODUCTION_WIRED`

- webhook real en `app/api/integrations/whatsapp/webhook/route.ts`;
- validacion de firma `x-hub-signature-256`;
- allowlist por `BRAIN_WHATSAPP_ALLOWED_WA_IDS` y `BRAIN_AUTONOMOUS_TEST_WA_IDS`;
- deduplicacion por `provider="meta"` + `providerMessageId`;
- persistencia de conversacion y mensaje;
- resolucion o creacion de identidad provisional;
- resolucion de conversacion nativa;
- creacion o recuperacion de opportunity y profile;
- activacion de `runNativeAutonomousCycle(...)`;
- manejo de errores fail-closed;
- tests de inbound y webhook reales existen.

### B. Respuesta autonoma reactiva

Estado: `PRODUCTION_WIRED`, con tramos internos aun parciales

- carga de estado: real;
- interpretacion: real en engine;
- planificacion: real en operational loop;
- politica: real;
- next best action: real;
- persistencia de decision: real;
- creacion de action: real;
- creacion de outbound: real;
- envio: real pero gated por flags y Meta;
- actualizacion de estados: real;
- outcome: real para delivery y action outcome, pero no para un cierre transaccional completo;
- debilidad principal: no existe una venta estandar completa.

### C. Continuidad multi-turno

Estado: `PRODUCTION_WIRED`

- contexto durable en conversation, opportunity, need profile y decision log;
- acciones pendientes en `crm_agent_actions`;
- preguntas pendientes y missing info en el engine;
- productos considerados desde catalog repo;
- opportunity activa como memoria de negocio;
- nuevo mensaje puede reabrir o continuar la oportunidad;
- hay proteccion contra conflicto de identidad y contra reuso de terminales;
- sigue existiendo fragmentacion entre runtime nativo, multi-request y legacy.

### D. Follow-up

Estado: `PRODUCTION_WIRED`

- creacion de follow-up desde engine y repository;
- programacion por due date;
- worker persistente `scripts/autonomous-followup-worker.ts`;
- cancelacion por respuesta del cliente;
- revalidacion antes de ejecutar;
- idempotencia por action key;
- limites de attempts y expiracion;
- envio por ciclo autonomo y outbox;
- actualizacion de opportunity / state cuando corresponde.

### E. Handoff y control humano

Estado: `PRODUCTION_WIRED`

- deteccion por riesgo, aprobacion, propietario humano o request explicito;
- persistencia de handoff en opportunity/conversation;
- suspension de autonomia via `ai_enabled = 0` y `human_owner_active = 1`;
- toma de control manual desde UI;
- cancelacion de acciones pendientes;
- visibilidad en timeline y read models;
- el worker revalida ownership antes de enviar.

### F. Catalogo

Estado: `PARTIAL`

- registro real de tools internas de catalogo existe;
- fuente de datos actual: adapter hacia PrestaShop / catalog read model;
- search, filters, price, stock, dimensions, compatibility y related products existen en lectura;
- URL de producto y comparacion no forman aun una capability de producto aislada;
- manejo de errores existe, pero el boundary de `CatalogService` aun no es el producto final completo;
- el catalogo si participa en respuestas reales;
- `compare_products` es solo dato de dominio, no tool productizada.

### G. Capacidades transaccionales

Estado global: `ABSENT` a `PARTIAL`, segun el tramo

- calculo de despacho: `ABSENT`;
- estimacion de entrega: `ABSENT`;
- promociones: `ABSENT`;
- medios de pago: `ABSENT`;
- cotizaciones: `PARTIAL`;
- checkout: `ABSENT`;
- creacion de orden: `ABSENT`;
- observacion de pago: `ABSENT`;
- correlacion orden-oportunidad: `ABSENT`;
- cambio a `won`: `PARTIAL`.

Conclusiones:

- el sistema ya sabe razonar comercialmente;
- aun no tiene la capa transaccional para cerrar una venta estandar sin puente externo o humano.

### H. UI operativa

Estado global: `PARTIAL`

- conversaciones: reales;
- timeline: real;
- oportunidad: real;
- perfil: real/partial segun vista;
- acciones: reales;
- decisiones: reales;
- outcomes: parcialmente visibles segun superficie;
- tool executions: sobre todo tecnicos y no todos expuestos en UI comercial;
- errores: visibles en algunas vistas y APIs;
- handoff: visible;
- control humano: visible;
- metricas: reales pero mixtas;
- fixtures: si, especialmente en marketing, knowledge, integrations, settings y algunas superficies de preview;
- endpoints reales: si, pero no todas las pantallas usan el mismo nivel de verdad.

## 4. Matriz completa contra el PRD

Leyenda de evidencia abreviada:

- `NWS` = `app/api/integrations/whatsapp/webhook/route.ts`
- `NWH` = `lib/brain/native-whatsapp/service.ts`
- `NCT` = `lib/domains/conversations/repository.ts`
- `SNS` = `lib/brain/commercial/sales-consultative/engine.ts`
- `SNR` = `lib/brain/commercial/sales-consultative/repository.ts`
- `OBX` = `lib/brain/messaging/outboxWorker.ts`
- `MTA` = `lib/brain/messaging/metaClient.ts`
- `FUP` = `scripts/autonomous-followup-worker.ts`, `lib/brain/commercial/followup/runFollowupTick.ts`
- `UIR` = `app/(hub)/*`, `lib/dashboard.ts`, `lib/domains/runtime/capability-registry.ts`
- `CAT` = `lib/brain/commercial/sales-consultative/catalogRepository.ts`
- `MOCK` = `app/api/ai/orchestrate/route.ts`, `app/api/dev/ai-sdr-simulator/route.ts`

| ID | Etapa PRD | Capacidad | Estado | Runtime real | Evidencia | Persistencia | Test | Dependencia | Brecha |
| -- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PRD-01 | Inbound | Identidad provisional | `PRODUCTION_WIRED` | webhook + native service | `NWS`, `NWH`, `migrations/006`, `migrations/010` | `master_customer`, `customer_external_identity` | inbound/native tests | MariaDB | no es Customer Master final |
| PRD-02 | Inbound | Conversacion | `PRODUCTION_WIRED` | conversation thread native | `NWH`, `NCT`, `migrations/008` | `conversation`, `conversation_message` | native whatsapp tests | MariaDB | legacy mix sigue presente |
| PRD-03 | Memory | Mensajes | `PRODUCTION_WIRED` | timeline durable | `NWH`, `NCT`, `migrations/008`, `migrations/014` | `conversation_message` | native whatsapp tests | MariaDB | no unifica todo legado |
| PRD-04 | Memory | Oportunidad | `PRODUCTION_WIRED` | commercial state | `NWH`, `SNS`, `SNR`, `migrations/004` | `crm_opportunities` | commercial tests | MariaDB | estados terminales no equivalen a cierre completo |
| PRD-05 | Memory | Perfil de necesidad | `PRODUCTION_WIRED` | consultative profile | `SNS`, `SNR`, `migrations/009` | `crm_sales_need_profiles` | consultative tests | MariaDB | reglas de completitud aun evolucionan |
| PRD-06 | Reasoning | Descubrimiento | `PARTIAL` | engine heuristics | `SNS`, `lib/brain/commercial/operational-loop/*` | profile/opportunity | consultative tests | catalog + policy | no cubre todos los tipos de discovery |
| PRD-07 | Reasoning | Calificacion | `PARTIAL` | engine + policy | `SNS`, `lib/brain/commercial/sales-agent/*` | opportunity/profile | policy tests | policy + context | dependiente de contexto suficiente |
| PRD-08 | Reasoning | Recomendacion | `PARTIAL` | product scoring | `SNS`, `CAT` | opportunity + actions | consultative tests | catalog data | catalogo sigue incompleto |
| PRD-09 | Reasoning | Comparacion | `IMPLEMENTED_NOT_WIRED` | domain data only | `docs/product/autonomous-commerce-tool-catalog.md`, `CAT` | no tool productizada | catalog tests | catalog data | no capability boundary dedicada |
| PRD-10 | Reasoning | Objeciones | `PRODUCTION_WIRED` | objection detect/record/respond | `SNS`, `SNR` | `crm_agent_actions`, `crm_opportunities` | consultative tests | MariaDB | hay cobertura parcial por tipo de objecion |
| PRD-11 | Reasoning | Cross-sell | `PARTIAL` | related products / alternative selection | `SNS`, `CAT` | opportunity notes/actions | catalog + consultative tests | catalog boundary | no flujo transaccional completo |
| PRD-12 | Reasoning | Upsell | `PARTIAL` | premium/bundle logic | `SNS` | opportunity/actions | consultative tests | catalog data | depende de catalogo y policy |
| PRD-13 | Pricing | Precio | `BLOCKED_EXTERNAL` | catalog adapter | `CAT`, `lib/brain/commercial/capabilities/registry.ts` | read-only | catalog tests | Prestashop / catalog source | fuente externa aun necesaria |
| PRD-14 | Pricing | Stock | `BLOCKED_EXTERNAL` | catalog adapter | `CAT` | read-only | catalog tests | Prestashop / stock source | dependencia externa de inventario |
| PRD-15 | Pricing | Dimensiones | `BLOCKED_EXTERNAL` | catalog adapter | `CAT` | read-only | catalog tests | catalog source | no maestro de producto final |
| PRD-16 | Pricing | Compatibilidad | `BLOCKED_EXTERNAL` | catalog adapter | `CAT` | read-only | catalog tests | reglas externas / catalogo | modelo de compatibilidad incompleto |
| PRD-17 | Operations | Despacho | `ABSENT` | no ruta productiva | docs/tool catalog | none | no tests productivos | external ops service | falta integracion real |
| PRD-18 | Operations | Entrega | `ABSENT` | no ruta productiva | docs/tool catalog | none | no tests productivos | external ops service | falta oracle de entrega |
| PRD-19 | Operations | Promociones | `ABSENT` | no ruta productiva | docs/tool catalog | none | no tests productivos | marketing/pricing source | no source verificado |
| PRD-20 | Operations | Medios de pago | `ABSENT` | no ruta productiva | docs/tool catalog | none | no tests productivos | checkout/payment source | no integracion real |
| PRD-21 | Transaction | Cotizacion | `PARTIAL` | quote state/tool contracts | `migrations/020`, `lib/brain/commercial/operational-loop/*`, `tests/commercial/quotes.test.ts` | `crm_quotes` | quotes tests | MariaDB | UI y flujo comercial aun no consumen la quote como cierre final |
| PRD-22 | Transaction | Checkout | `ABSENT` | no ruta productiva | docs/tool catalog | none | no tests productivos | checkout/payment service | no link checkout nativo |
| PRD-23 | Transaction | Ordenes | `ABSENT` | no ruta productiva | capabilities read-only order lookup only | none | no tests productivos | external order system | no create order productivo |
| PRD-24 | Transaction | Pagos | `ABSENT` | no ruta productiva | docs/tool catalog | none | no tests productivos | provider de pago | no observacion de pago productiva |
| PRD-25 | Transaction | Cierre ganado | `PARTIAL` | state machine supports won | `lib/brain/commercial/operational-loop/*`, `tests/commercial/*won*` | `crm_opportunities` | transition/policy tests | policy + evidence | no tool productizada completa |
| PRD-26 | Transaction | Cierre perdido | `PARTIAL` | state machine supports lost | `lib/brain/commercial/operational-loop/*` | `crm_opportunities` | transition tests | policy + evidence | no tool productizada completa |
| PRD-27 | Follow-up | Follow-up | `PRODUCTION_WIRED` | worker + action queue | `FUP`, `SNR`, `migrations/005`, `migrations/014` | `crm_agent_actions` | follow-up tests | worker + flags | sigue dependiente de flags |
| PRD-28 | Follow-up | Cancelacion | `PRODUCTION_WIRED` | CAS cancel/replan | `FUP`, `SNR` | `crm_agent_actions` | follow-up tests | MariaDB | cobertura muy buena pero centrada en internal loop |
| PRD-29 | Follow-up | Reactivacion | `ABSENT` | no capability final | search + docs | none | no tests productivos | opportunity policy | reglas finales pendientes |
| PRD-30 | Follow-up | Recuperacion de carrito | `ABSENT` | no ruta productiva | no evidencia | none | no tests | commerce/cart system | fuera del nucleo actual |
| PRD-31 | Governance | Handoff | `PRODUCTION_WIRED` | human_owner_active / ai_enabled | `NWH`, `SNR`, `tests/native/native-whatsapp.test.ts` | `conversation`, `crm_opportunities` | native + handoff tests | UI + policy | depende de flags y owner state |
| PRD-32 | Governance | Control humano | `PRODUCTION_WIRED` | takeover / pause | `NWH`, `UIR` | conversation/opportunity flags | UI + native tests | UI + auth | no delega permisos al LLM |
| PRD-33 | Outbound | Outbound | `PRODUCTION_WIRED` | outbox + worker + Meta | `OBX`, `MTA`, `NWS` | `brain_message_outbox`, `conversation_message` | outbox/native tests | Meta + allowlist | envio real depende de provider externo |
| PRD-34 | Outbound | Delivery status | `PRODUCTION_WIRED` | status webhook projection | `NWS`, `NWH`, `OBX` | `conversation_message`, `brain_message_outbox`, `commercial_event` | native whatsapp tests | Meta webhook | real pero externalmente condicionado |
| PRD-35 | Outcomes | Outcomes | `PRODUCTION_WIRED` | action/outbox/delivery outcomes | `migrations/013`, `OBX`, `SNR` | `crm_action_outcomes`, `commercial_event` | outbox/follow-up tests | worker + hooks | no todo outcome se ve en UI |
| PRD-36 | Audit | Auditoria | `PRODUCTION_WIRED` | audit logs + commercial events | `migrations/011`, `NWH`, `app/api/system/*` | `hub_audit_log`, `commercial_event` | audit tests | MariaDB | semantica de audit aun bifurcada |
| PRD-37 | Timeline | Timeline | `PRODUCTION_WIRED` | conversation timeline | `NCT`, `NWH`, `outboundMessages.ts` | `conversation_message` | native whatsapp tests | MariaDB | legacy timeline sigue coexistiendo |
| PRD-38 | UI | UI operativa | `PARTIAL` | hub pages + read models | `UIR`, `app/(hub)/*` | read only | UI tests | fixtures + real data mix | no todas las superficies son reales |
| PRD-39 | Metrics | Metricas | `PARTIAL` | dashboard + health blocks | `lib/dashboard.ts`, `app/(hub)/dashboard/page.tsx` | read models | dashboard tests | env/DB/Meta | mezcla real, partial y fixture |
| PRD-40 | Channels | Email | `ABSENT` | no runtime productivo | docs/tool catalog | none | no tests | email provider | no motor de email |
| PRD-41 | Channels | Calls | `ABSENT` | no runtime productivo | docs/tool catalog | none | no tests | telephony provider | no voz productiva |
| PRD-42 | Channels | Webchat | `ABSENT` | no runtime productivo | UI/docs | none | no tests | webchat provider | no canal productivo propio |
| PRD-43 | Optimization | Optimizacion comercial | `ABSENT` | no runtime productivo | PRD only | none | no tests | analytics/experiments | no capa de optimizacion cerrada |

### Observaciones de la matriz

- `PRODUCTION_WIRED` no significa sin dependencias externas; significa que el runtime real existe y esta conectado.
- `BLOCKED_EXTERNAL` se usa donde el codigo esta conectado pero la capacidad depende de una fuente externa o infraestructura ajena.
- `PARTIAL` se usa donde hay parte real, pero falta el tramo productivo que la convierta en capacidad completa.
- `IMPLEMENTED_NOT_WIRED` se usa donde el codigo o contrato existe, pero no es parte del flujo productivo.
- `LEGACY` y `MOCK_OR_DEV_ONLY` aparecen sobre todo en runtimes secundarios y superficies de soporte.

## 5. Modelo de datos real

### Tablas y entidades principales

| Entidad | Proposito real | Quien escribe | Quien lee | SoT | Duplicada | Legacy | Notas |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `master_customer` | identidad provisional del cliente | native inbound, repos de customer | UI, context, opportunity service | si, hoy es la referencia provisional | si, junto a identities externas | no | no es Customer Master final |
| `customer_external_identity` | unir identidad externa con cliente | native inbound | identity resolver | si | si | no | puente provisional de identidad |
| `conversation` | thread durable por canal | native inbound, takeover logic | conversation repo, UI, service | si | no | no | soporta `ai_enabled` y `human_owner_active` |
| `conversation_message` | timeline del mensaje | inbound, outbound projection | UI, read models, delivery reconciliation | si | no | no | dedupe por `provider_message_id` |
| `crm_opportunities` | memoria comercial de la oportunidad | consultative repo, engine | UI, follow-up, state machine | si | no | no | estado comercial central actual |
| `crm_sales_need_profiles` | perfil de necesidad | consultative repo | engine, UI | si | no | no | dependencia clave de discovery/recommendation |
| `crm_agent_decisions` | decision comercial durable | consultative repo, native cycle | UI, operational loop, follow-up | si | no | no | verdad comercial de la decision |
| `crm_agent_actions` | accion gobernada | consultative repo, execution gate, follow-up | UI, workers, operational loop | si | no | no | boundary de accion durable |
| `crm_action_executions` | ejecucion de action | runtime comercial | outcomes, UI | si | no | no | contract tracing de ejecucion |
| `crm_action_outcomes` | outcome de ejecucion | workers, reconciliation | UI, audit, action queue | si | no | no | projection outcome |
| `brain_message_outbox` | intencion de envio | consultative repo, execution gate | outbox worker, UI, reconciliation | si | no | no | cola gobernada |
| `commercial_event` | evento comercial auditado | native inbound, delivery status, consultative flow | UI, audit, tests | si | no | no | event trail real |
| `ai_agent_execution` | observabilidad tecnica | orchestration/runtime | debug, UI tecnica | no | si | si, es tecnica | no es verdad comercial |
| `ai_agent_decision` | decision tecnica / observabilidad | orchestration/runtime | debug, UI tecnica | no | si | si, es tecnica | separada de `crm_agent_decisions` |
| `ai_tool_execution` | observabilidad de tools | orchestration/runtime | debug | no | si | si, tecnica | no es una action de negocio |
| `ai_conversation_state` | checkpoint tecnico | runtime ai | debug / recovery | no | si | si, tecnica | no reemplaza opportunity memory |
| `crm_quotes` | artefacto de cotizacion | operational loop / quote paths | quotes UI, tests | parcial | no | no | existe, pero no es checkout |
| `crm_request_escalations` | escalamiento por request | request escalation repo | follow-up / UI | si | no | no | soporte a handoff |
| `crm_conversation_requests` | solicitudes activas por conversacion | request tracking | request reduction / follow-up | si | no | no | soporta multi-request runtime |
| `crm_request_events` | eventos de request | request tracking | UI / reduction | si | no | no | trazabilidad de request |
| `crm_request_message_links` | relacion request-message | request tracking | UI / reduction | si | no | no | relacion many-to-many |
| `crm_turn_plans` | plan de turno | turn planner | UI / retry | si | no | no | soporte a planificacion |
| `crm_request_facts` | hechos durables por request | facts pipeline | request runtime | si | no | no | base para multi-request |
| `customer_addresses` | direcciones del cliente | address flows | UI / operations | si | no | no | presente y testeada |
| `hub_audit_log` | audit transversal | varios servicios | audit UI / ops | si | no | si, legado | sigue siendo troncal |
| `n8n_vw_hub_cases` | read view legacy | n8n / legacy data | legacy UI / dashboards | si | si | si | surface legacy activa |
| `n8n_conversation_cases` | case timeline legacy | legacy ingestiones | legacy UI | si | si | si | no es nucleo actual |
| `n8n_conversation_messages` | message timeline legacy | legacy ingestiones | legacy UI | si | si | si | coexistencia con native messages |
| `n8n_wa_inbound_messages` | inbound legacy | legacy ingestiones | legacy diagnostics | si | si | si | only legacy |

### Relacion con migraciones

- `003_brain_message_outbox.sql` -> outbox durable.
- `004_ai_sdr_operational_loop.sql` -> opportunities + decisions.
- `005_crm_agent_actions.sql` -> governed actions.
- `006_master_customer_platform_origin.sql` -> provisional customer identity.
- `008_conversation_ai_runtime_core.sql` -> conversation, message, AI technical tables.
- `009_crm_sales_need_profiles.sql` -> need profile.
- `010_native_whatsapp_identity_and_conversation_controls.sql` -> external identity + conversation controls.
- `011_commercial_event.sql` -> commercial event trail.
- `013_action_execution_outcome.sql` -> execution/outcome tables.
- `014_outbox_retry_backoff.sql` -> outbox retries.
- `015_crm_conversation_request_tracking.sql` -> multi-request runtime.
- `016_crm_turn_plans.sql` -> turn planning.
- `017_crm_request_facts.sql` -> request facts.
- `018_customer_addresses.sql` -> addresses.
- `019_crm_request_escalations.sql` -> escalations.
- `020_crm_quotes.sql` -> quotes.
- `021_agent_actions_request_link.sql` -> request linkage on actions.

### Problemas de semantica

- `master_customer` existe, pero su semantica es provisional y no debe leerse como Customer Master definitivo.
- `crm_agent_decisions` es la verdad comercial, mientras que `ai_*` son observabilidad tecnica.
- `conversation` y `conversation_message` son la timeline real, pero conviven con `n8n_*`.
- `crm_quotes` existe, pero no equivale a un checkout productivo.

## 6. Decisiones, acciones y outcomes

### Cadena real observada

```text
evento inbound
-> carga de contexto
-> decision comercial
-> accion gobernada
-> ejecucion o encolado
-> side effect / outbound
-> outcome
-> actualizacion de opportunity
```

### Como se enlaza hoy

- `commercial_event` captura el hecho comercial o de delivery.
- `crm_agent_decisions` guarda la decision comercial duradera.
- `crm_agent_actions` guarda la accion gobernada e idempotente.
- `brain_message_outbox` guarda la intencion de envio.
- `conversation_message` recibe la proyeccion canonica del outbound y del delivery.
- `crm_action_executions` y `crm_action_outcomes` dan capa de outcome.
- `crm_opportunities` recibe el estado comercial final o intermedio.

### Donde se rompe la trazabilidad

- hay dos familias de runtime: legacy/shadow y native/commercial;
- `ai_*` no son la verdad de negocio, pero siguen existiendo y pueden confundir;
- el catalogo y la capa transaccional no estan unificados bajo un solo contrato final;
- el cierre de venta no tiene aun una ruta de producto cerrada hasta orden/pago;
- algunas superficies UI muestran real, otras preview, otras fixture;
- parte del flujo depende de flags y provider externo.

### Datos que se pierden o quedan ambiguos

- no todo producto considerado queda explicitado como una entidad final de `quote` o `checkout`;
- el paso de recomendacion a compra no tiene orden nativa;
- `compare_products` no esta productizado como tool;
- estados terminales no siempre equivalen a una venta cerrada real;
- el motivo de cierre o de handoff puede quedar mejor en decision/action que en una entidad comercial de negocio final.

## 7. Capabilities y tools

### Inventario resumido de tools y capacidades

| Tool | Registrada | Implementada | Fuente real | Side effect | Autorizacion | Auditada | Usada por runtime |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `get_customer_context` | si | si | `master_customer`, conversation read model | no | backend | si | si |
| `get_recent_conversation` | si | si | `conversation_message` | no | backend | si | si |
| `get_active_opportunity` | si | si | `crm_opportunities` | no | backend | si | si |
| `get_sales_need_profile` | si | si | `crm_sales_need_profiles` | no | backend | si | si |
| `search_products` | si | si | catalog adapter | no | backend | si | si |
| `get_product_details` | si | si | catalog adapter | no | backend | si | si |
| `get_product_price` | si | si | catalog adapter | no | backend | si | si |
| `get_product_stock` | si | si | catalog adapter | no | backend | si | si |
| `get_product_dimensions` | si | si | catalog adapter | no | backend | si | si |
| `get_product_compatibility` | si | si | catalog adapter | no | backend | si | si |
| `get_related_products` | si | si | catalog adapter | no | backend | si | si |
| `create_opportunity` | si | si | `crm_opportunities` | si | backend | si | si |
| `update_opportunity` | si | si | `crm_opportunities` | si | backend | si | si |
| `save_sales_need_profile` | si | si | `crm_sales_need_profiles` | si | backend | si | si |
| `record_product_interest` | si | si | CRM tables | si | backend | si | si |
| `record_objection` | si | si | CRM tables | si | backend | si | si |
| `create_follow_up_action` | si | si | `crm_agent_actions` | si | backend | si | si |
| `cancel_follow_up_action` | si | si | `crm_agent_actions` | si | backend | si | si |
| `request_human_handoff` | si | si | `conversation`, `crm_opportunities` | si | backend | si | si |
| `queue_customer_message` | si | si | `brain_message_outbox` | si | backend | si | si |
| `calculate_shipping` | no | no | no real source | no | n/a | no | no |
| `get_delivery_estimate` | no | no | no real source | no | n/a | no | no |
| `get_payment_options` | no | no | no real source | no | n/a | no | no |
| `get_business_policy` | no | no | policy data when wired | no | backend | no | no |
| `get_active_promotions` | no | no | no real source | no | n/a | no | no |
| `create_checkout_link` | no | no | no real source | no | n/a | no | no |
| `mark_won` | no | no | no real source | si | n/a | no | no |
| `mark_lost` | no | no | no real source | si | n/a | no | no |
| `pause_opportunity` | no | no | no real source | si | n/a | no | no |
| `reactivate_opportunity` | no | no | no real source | si | n/a | no | no |
| `queue_email` | no | no | no real source | si | n/a | no | no |
| `place_sales_call` | no | no | no real source | si | n/a | no | no |
| `send_whatsapp` | prohibida | no | nunca debe ser direct send | si | n/a | si | no |
| `compare_products` | no tool dedicada | si como dato | catalog data | no | backend | parcial | no |

### Fantasmas, legacy y no productizados

- `send_whatsapp` es una prohibicion de producto, no una tool normal.
- `compare_products` existe como dato/derivacion, pero no como boundary de capability productizada.
- `app/api/ai/orchestrate/route.ts` y `app/api/dev/ai-sdr-simulator/route.ts` son superficies mock/dev-only.
- `processInbound` y el runtime shadow no deben confundirse con el nucleo nativo productivo.

## 8. Arquitectura paralela, legacy y deuda

### Runtimes paralelos

- `lib/brain/processInbound.ts`: runtime general legacy/shadow.
- `lib/brain/native-whatsapp/service.ts`: runtime nativo productivo.
- `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts`: wrapper autonomo nativo.
- `lib/brain/commercial/multi-request/*`: runtime alterno para request-based commerce.
- `app/api/ai/orchestrate/route.ts`: mock endpoint dev-only.
- `app/api/dev/ai-sdr-simulator/route.ts`: simulador dev-only.

### Legacy activo

- `n8n_vw_hub_cases`
- `n8n_conversation_cases`
- `n8n_conversation_messages`
- `n8n_wa_inbound_messages`
- vistas y paginas legacy de hub/cases
- algunos contratos historicos de AI SDR y shadow

### Feature flags que cambian el runtime

- `DB_WRITE_ENABLED`
- `BRAIN_WHATSAPP_ALLOWED_WA_IDS`
- `BRAIN_AUTONOMOUS_TEST_WA_IDS`
- `BRAIN_SALES_AGENT_ENABLED`
- `BRAIN_COMMERCIAL_SHADOW_ENABLED`
- `BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED`
- `BRAIN_OUTBOX_WORKER_ENABLED`
- `BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND`
- `BRAIN_META_SEND_ENABLED`
- `BRAIN_PERSIST_CANONICAL_OUTBOUND`
- flags de allowAutoReply / allowCaseMutation / allowHumanHandoff / allowFollowup / dryRun en la orquestacion AI

### Deuda principal

- unificacion de runtime;
- claridad entre verdad comercial y observabilidad tecnica;
- catalog boundary formal y completa;
- transaccion y pago;
- orden/checkout/cierre;
- limpieza de legacy UI y endpoints mock;
- menor dependencia de flags para operar el camino principal.

## 9. Estado de despliegue

### Como se ejecuta localmente

- Next.js app via `npm run dev`;
- MariaDB via `npm run db:up` / Docker compose;
- pruebas via `npm run test`;
- typecheck via `npm run typecheck`;
- workers via `npm run worker:outbox` y `npm run worker:followup`.

### Como se ejecuta en servidor

- app web;
- webhook Meta HTTP(S);
- worker de outbox persistente;
- worker o proceso de follow-up;
- DB MariaDB;
- provider Meta;
- potencial dependencia de PrestaShop/catalogo;
- posiblemente n8n aun coexistiendo como legado operacional.

### Diagrama actual

```text
WhatsApp / Meta
  -> webhook HTTP(S)
  -> Next.js route /api/integrations/whatsapp/webhook
  -> native WhatsApp service
  -> MariaDB (conversation, opportunity, decision, action, outbox)
  -> autonomous cycle
  -> outbox worker
  -> Meta Graph API
  -> delivery webhook
  -> status projection
  -> UI / timeline / dashboard

Follow-up path:
  MariaDB action row
  -> follow-up worker
  -> autonomous cycle
  -> outbox
  -> worker
  -> Meta
```

### Riesgos de despliegue

- si no corre el worker, la outbox queda pendiente;
- si Meta no esta configurado, outbound real no ocurre;
- si los flags estan cerrados, el runtime degrada a preview/dry-run;
- si la DB no responde, el flujo cae a fail-closed;
- si el legacy se usa por error, la verdad comercial puede fragmentarse.

## 10. Pruebas y evidencia

### Resultado de validaciones ejecutadas

#### 10.1 Typecheck

- Comando: `npm run typecheck`
- Resultado: exit code 0
- Demuestra: el repo compila tipos en el estado actual.
- No demuestra: ejecucion productiva, integracion externa o despliegue.
- Usa mocks: no.
- Requiere infraestructura no disponible: no.

#### 10.2 Suite test amplia

- Comando: `npm run test -- tests/native/native-whatsapp.test.ts tests/commercial/executionGate.test.ts tests/commercial/followUpScheduling.test.ts tests/commercial/quotes.test.ts`
- Resultado: 716 tests, 716 pass, 0 fail
- Demuestra:
  - inbound native WhatsApp funciona;
  - outbox y delivery reconciliation funcionan;
  - execution gate funciona;
  - follow-up worker / scheduler funcionan;
  - quotes y operational loop tienen cobertura real;
  - UI y APIs relevantes tienen cobertura.
- No demuestra:
  - que Meta real este disponible en este momento;
  - que el checkout/order/payment flow exista;
  - que todos los tramos esten default-on en produccion.
- Usa mocks: si, en varias pruebas, especialmente donde se valida contract/state sin provider real.
- Requiere infraestructura no disponible: para algunos subtests si, pero la suite paso con fixtures/mocks de prueba.

### Cobertura por grupo

| Grupo | Evidencia | Que demuestra | Que no demuestra |
| --- | --- | --- | --- |
| Inbound | `tests/native/native-whatsapp.test.ts` | webhook, firma, dedupe, persistencia, delivery projection | no comprueba disponibilidad de Meta real |
| Ciclo autonomo | `tests/commercial/*`, `tests/native/*` | loop, policy, actions, state machine | no reemplaza negocio transaccional |
| Outbox | `tests/commercial/outboxWorker.test.ts`, `tests/native/outbox-ownership.test.ts` | locking, retry, dedupe, delivery | no prueba provider externo continuo |
| Follow-up | `tests/commercial/followUpScheduling.test.ts`, `tests/commercial/runFollowupTick.test.ts` | schedule/cancel/replan/expire | no prueba un CRM de cierre completo |
| Outcomes | `tests/commercial/*outcome*`, `tests/native/*` | status projection y outcome trail | no cierra orden/pago |
| Catalogo | `tests/commercial/quotes.test.ts`, catalog tests | price/stock/recommendation path | no prueba fuente de catalogo universal |
| Handoff | native/commercial tests | takeover, owner active, AI blocked | no prueba operacion humana externa real |
| UI/API | dashboard/conversation/opportunity/action tests | read models y shells | no prueba el negocio completo |
| Migraciones | migration tests | schema alignment | no valida produccion live |

## 11. Brechas para completar una venta estandar

Flujo objetivo:

```text
cliente consulta por WhatsApp
-> sistema descubre necesidad
-> recomienda producto real
-> informa precio y stock
-> calcula despacho
-> maneja objecion
-> entrega cotizacion o checkout
-> cliente compra
-> orden se correlaciona
-> oportunidad cambia a ganada
```

### Gap map

| Paso | Estado actual | Gap |
| --- | --- | --- |
| Consulta por WhatsApp | `PRODUCTION_WIRED` | ninguno relevante |
| Descubrir necesidad | `PARTIAL` | discovery aun depende mucho de heuristica y contexto suficiente |
| Recomendar producto real | `PARTIAL` | catalogo util pero boundary incompleto |
| Informar precio y stock | `BLOCKED_EXTERNAL` | depende de fuente externa de catalogo |
| Calcular despacho | `ABSENT` | bloqueo critico |
| Manejar objecion | `PRODUCTION_WIRED` | cobertura aun por ampliar |
| Entregar cotizacion o checkout | `PARTIAL` / `ABSENT` | quote parcial; checkout ausente |
| Cliente compra | `ABSENT` | bloqueo critico |
| Orden se correlaciona | `ABSENT` | bloqueo critico |
| Opportunity cambia a ganada | `PARTIAL` | estado existe, pero no como cierre transaccional completo |

### Conclusio de flujo

El sistema ya sabe sostener una conversacion comercial autonoma y gobernada. Lo que falta para la venta estandar es el tramo transaccional:

- despacho/entrega;
- checkout;
- orden;
- pago;
- correlacion de compra;
- cierre ganado como producto final.

## 12. Proximos incrementos recomendados

### Incremento recomendado unico

```text
Incremento:
Productoizar un tramo de "quote-to-human-checkout handoff" usando la opportunity y el catalogo real ya existentes, sin inventar pago nativo.

Objetivo:
Generar una cotizacion util o CTA de compra verificable desde la opportunity, dejarla trazada en CRM y derivar el cierre a un flujo humano o externo claramente marcado.

Estado actual reutilizable:
- `crm_opportunities`
- `crm_sales_need_profiles`
- `crm_quotes`
- `crm_agent_actions`
- `brain_message_outbox`
- `conversation_message`
- `request_human_handoff`
- `follow-up worker`

Brecha:
- la cotizacion no se consume como artefacto productivo de cierre;
- no existe un paso end-to-end hacia checkout/orden/pago;
- el handoff comercial no esta empaquetado como producto de cierre.

Cambios necesarios:
- definir una salida de quote estable;
- enlazarla a action/outbox;
- exponerla en UI operativa;
- registrar outcome explicito;
- mantener autonomia suspendida si entra en review humano.

Flujo end-to-end:
mensaje comercial -> perfil -> recomendacion -> quote -> action -> outbox o handoff -> UI -> outcome trazado.

Criterio de aceptacion:
- una oportunidad puede producir una cotizacion visible y trazada;
- el cierre queda explicitamente derivado o resuelto;
- no se inventa pago nativo ni orden falsa.

Riesgos:
- confundir quote con venta cerrada;
- introducir side effects no autorizados;
- mezclar UI con logica sensible.
```

## 13. Recomendacion para reestructurar el PRD

Sin reescribir el PRD, la estructura sugerida deberia separar:

1. **Vision final**: que es el Autonomous Commerce System a largo plazo.
2. **Capacidades ya existentes**: inbound, conversation, opportunity, decision, action, outbox, follow-up, handoff.
3. **Etapa actualmente en ejecucion**: lo nativo y real que ya funciona hoy.
4. **Proximos incrementos**: cada paso pequeno que cierra un tramo end-to-end.
5. **Etapas futuras**: checkout, order, payment, omnicanal, optimizacion.
6. **Criterios de aceptacion**: por capacidad y por flujo.
7. **Dependencias externas**: Meta, catalogo, pagos, despacho, n8n legado.
8. **Deuda y legacy fuera del nucleo**: runtimes paralelos, mock/dev-only, vistas historicas.

La idea es que el PRD deje de mezclar vision, roadmap, estado actual y legado en una sola capa narrativa.

## A. Veredicto actual

### `gestor autonomo de oportunidades parcial`

Justificacion:

- el sistema si gestiona oportunidades, decisiones, acciones, follow-ups, handoff y outbox de forma real;
- la conversacion comercial ya es durable y gobernada;
- pero no completa la venta estandar de punta a punta;
- el tramo transaccional sigue incompleto;
- hay runtimes paralelos y legacy aun activos;
- la autonomia es real, pero aun parcial y con limites claros.

## B. Los 10 bloqueos mas importantes

1. Falta de checkout nativo.
2. Falta de orden nativa y correlacion de compra.
3. Falta de pago observado como capacidad productiva.
4. Falta de calculo de despacho.
5. Falta de estimacion de entrega.
6. Catalogo parcialmente externo y no totalmente encapsulado.
7. Reglas de cierre won/lost aun no empaquetadas como tool de producto.
8. Coexistencia de runtime legacy, nativo, mock y multi-request.
9. UI comercial aun mezcla real, preview y fixture.
10. Dependencia de Meta y de flags para mantener el camino productivo abierto.

## C. Las 10 capacidades productivas mas maduras

1. Inbound real de WhatsApp.
2. Dedupe y persistencia del mensaje nativo.
3. Resolucion provisional de identidad.
4. Conversacion duradera con timeline real.
5. Opportunity memory duradera.
6. Sales need profile persistido.
7. Decision comercial persistida.
8. Action queue gobernada.
9. Outbox y worker real.
10. Follow-up automatizado con cancelacion y revalidacion.

## D. Proximo incremento recomendado

**Productizar un quote-to-human-checkout handoff trazado sobre la opportunity actual**, reutilizando oportunidad, perfil, quote, action queue y outbox, sin intentar aun inventar un checkout o payment nativo.

## E. Archivos inspeccionados

Lista de archivos inspeccionados durante esta auditoria:

- `AGENTS.md`
- `CLAUDE.md`
- `.env`
- `package.json`
- `README.md`
- `docs/product/autonomous-commerce-prd.md`
- `docs/product/autonomous-commerce-current-state.md`
- `docs/product/autonomous-commerce-capability-map.md`
- `docs/product/autonomous-commerce-tool-catalog.md`
- `docs/data/agentic-crm-data-model-audit.md`
- `docs/data/persistence-architecture-decision.md`
- `docs/product/crm-ui-existing-state-audit.md`
- `docs/architecture/adr/ADR-001.md`
- `docs/architecture/adr/ADR-002.md`
- `docs/architecture/adr/ADR-003.md`
- `docs/architecture/adr/ADR-004.md`
- `docs/architecture/adr/ADR-005.md`
- `docs/architecture/adr/ADR-006.md`
- `docs/architecture/adr/ADR-007.md`
- `app/api/integrations/whatsapp/webhook/route.ts`
- `app/api/ai/orchestrate/route.ts`
- `app/api/brain/process-inbound/route.ts`
- `app/api/brain/execute/route.ts`
- `app/api/brain/outbox/worker/route.ts`
- `app/api/system/schema/route.ts`
- `app/api/system/capabilities/route.ts`
- `app/api/dev/ai-sdr-simulator/route.ts`
- `app/(hub)/dashboard/page.tsx`
- `app/(hub)/conversations/page.tsx`
- `app/(hub)/conversations/[id]/page.tsx`
- `app/(hub)/opportunities/page.tsx`
- `app/(hub)/opportunities/[id]/page.tsx`
- `app/(hub)/actions/page.tsx`
- `app/(hub)/actions/[id]/page.tsx`
- `app/(hub)/customers/page.tsx`
- `app/(hub)/customers/[id]/page.tsx`
- `app/(hub)/whatsapp/page.tsx`
- `app/(hub)/cases/[id]/page.tsx`
- `app/(hub)/dev/ai-sdr-simulator/page.tsx`
- `lib/brain/native-whatsapp/service.ts`
- `lib/brain/processInbound.ts`
- `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts`
- `lib/brain/commercial/followup/runFollowupTick.ts`
- `lib/brain/commercial/operational-loop/loadCommercialState.ts`
- `lib/brain/commercial/operational-loop/selectNextCommercialAction.ts`
- `lib/brain/commercial/operational-loop/validateCommercialTransition.ts`
- `lib/brain/commercial/execution-bridge/runCommercialExecutionBridge.ts`
- `lib/brain/commercial/execution-gate/executeActionThroughGate.ts`
- `lib/brain/commercial/action-queue/persistAgentAction.ts`
- `lib/brain/commercial/sales-consultative/engine.ts`
- `lib/brain/commercial/sales-consultative/repository.ts`
- `lib/brain/commercial/sales-consultative/catalogRepository.ts`
- `lib/brain/messaging/outboxWorker.ts`
- `lib/brain/messaging/outboundMessages.ts`
- `lib/brain/messaging/caseUpdates.ts`
- `lib/brain/messaging/metaClient.ts`
- `lib/dashboard.ts`
- `lib/domains/conversations/repository.ts`
- `lib/domains/conversations/service.ts`
- `lib/domains/opportunities/service.ts`
- `lib/domains/actions/service.ts`
- `lib/domains/customers/service.ts`
- `lib/domains/runtime/capability-registry.ts`
- `lib/brain/tools/registry.ts`
- `lib/brain/commercial/capabilities/registry.ts`
- `lib/integrations/customer-master/customer-repository.ts`
- `lib/integrations/customer-external-identity/repository.ts`
- `migrations/003_brain_message_outbox.sql`
- `migrations/004_ai_sdr_operational_loop.sql`
- `migrations/005_crm_agent_actions.sql`
- `migrations/006_master_customer_platform_origin.sql`
- `migrations/008_conversation_ai_runtime_core.sql`
- `migrations/009_crm_sales_need_profiles.sql`
- `migrations/010_native_whatsapp_identity_and_conversation_controls.sql`
- `migrations/011_commercial_event.sql`
- `migrations/013_action_execution_outcome.sql`
- `migrations/014_outbox_retry_backoff.sql`
- `migrations/015_crm_conversation_request_tracking.sql`
- `migrations/016_crm_turn_plans.sql`
- `migrations/017_crm_request_facts.sql`
- `migrations/018_customer_addresses.sql`
- `migrations/019_crm_request_escalations.sql`
- `migrations/020_crm_quotes.sql`
- `migrations/021_agent_actions_request_link.sql`
- `scripts/autonomous-outbox-worker.ts`
- `scripts/autonomous-followup-worker.ts`
- `tests/native/native-whatsapp.test.ts`
- `tests/native/outbox-ownership.test.ts`
- `tests/commercial/executionGate.test.ts`
- `tests/commercial/followUpScheduling.test.ts`
- `tests/commercial/quotes.test.ts`
- `tests/commercial/runFollowupTick.test.ts`
- `tests/commercial/outboxWorker.test.ts`
- `tests/commercial/*` suites referenced by the full run

## F. Comandos ejecutados

Lista de comandos ejecutados y resultados resumidos:

- `git status --short` -> mostro cambios locales no relacionados en `lib/domains/customers/repository.ts`, `lib/integrations/customer-master/customer-repository.ts`, `tests/domains/customers.test.ts`.
- `Get-ChildItem -Force` en la raiz -> inventario del repo.
- `Get-Content -Raw` de `docs/product/autonomous-commerce-prd.md` -> PRD base para toda la auditoria.
- `Get-Content -Raw` de `docs/product/autonomous-commerce-current-state.md` -> estado actual documentado.
- `Get-Content -Raw` de `docs/product/autonomous-commerce-capability-map.md` -> mapa de capacidades.
- `Get-Content -Raw` de `docs/product/autonomous-commerce-tool-catalog.md` -> catalogo de tools.
- `Get-Content -Raw` de `docs/data/agentic-crm-data-model-audit.md` -> modelo de datos observado.
- `Get-Content -Raw` de `docs/data/persistence-architecture-decision.md` -> decision de persistencia.
- `Get-Content -Raw` de ADR-001 a ADR-007 -> decisiones de arquitectura vigentes.
- `Get-Content -Raw` de las rutas de webhook, runtime nativo, runtime legacy, AI mock, workers y servicios de dominio listados arriba -> evidencia de runtime real.
- `Select-String` sobre headings del PRD y capability map -> estructura de capacidades y fases.
- `npm run typecheck` -> exit code 0.
- `npm run test -- tests/native/native-whatsapp.test.ts tests/commercial/executionGate.test.ts tests/commercial/followUpScheduling.test.ts tests/commercial/quotes.test.ts` -> 716 tests, 716 pass, 0 fail.
