---
title: ROADMAP
doc_id: product-roadmap
status: active
version: "2.1.0"
owner: product
last_reviewed: 2026-07-14
source_of_truth_for:
  - roadmap
  - PAUSED_EXTERNAL and DEFERRED external-dependency status vocabulary
depends_on:
  - ./ACTIVE_RELEASE.md
  - ./releases/README.md
  - ./product/MVP_EXECUTION_MAP.md
supersedes: []
tags:
  - product
  - release
---

# ROADMAP

La secuencia ACS es la unica roadmap normativa activa.

## Releases

| Release | Estado | Workstream principal | Workstreams secundarios | Contratos tocados | Integraciones habilitadas | Capabilities entregadas | Gate |
|---|---|---|---|---|---|---|---|
| `ACS-R1-01` | `accepted_with_debt` | Platform & Integrations | Commercial Runtime | Catalog boundary, capability gateway | Catalog HTTP adapter | `search_products`, `get_product_details` | Search/get product details operativos y auditados |
| `ACS-R1-02` | `superseded` | Customer & Identity | Platform & Integrations | Customer Service boundary draft | none independent | none independent | Absorbida por `ACS-R1-04` |
| `ACS-R1-03` | `accepted_with_debt` | Customer & Identity | Operator CRM, Analytics | Customer 360 contract, lifecycle event contract | Customer 360 read model | Customer 360 consolidado | Acceptance de Customer 360 y boundary de lectura |
| `ACS-R1-04` | `active_blocked_external` | Customer & Identity | Commercial Runtime, Platform & Integrations, Operator CRM | Customer onboarding identity, customer creation linking authority, customer service capability, customer service HTTP contract | Customer Service port, native inbound, Customer 360 access gate | identity resolution, onboarding, create/link, customer 360 gate | T08 integracion completa; pendiente smoke contra Customer Service desplegado |
| `ACS-R1-05` | `parallel_in_progress` | Commercial Runtime | Platform & Integrations | follow-up-decision-policy, customer-lifecycle-event-contract | autonomous-followup-worker, outbox bridge consolidation | follow_up_dispatch_policy, consolidated `crm_agent_actions` writer, hardened worker | follow-up durable, gobernado, recuperable y probado end-to-end |
| `ACS-R1-06` | `planned` | Platform & Integrations | Commercial Runtime | Policy and authority contracts | Business policy | Business policy | Identity + address + policy listos |
| `ACS-R1-07` | `planned` | Quotes & Transactions | Operator CRM, Commercial Runtime | Quote, catalog, order contracts | Quote flow | Quote creation and persistence | Catalog, customer context y policy listos |
| `ACS-R1-08` | `planned` | Operator CRM | Commercial Runtime | Operator readiness contracts | Operator controls | Operator readiness | Execution trace, approvals y supervision listos |
| `ACS-R1-09` | `deferred` | Voice | Platform & Integrations | Voice contract | Voice initiation | Voice outcomes and transcription linkage | Consent, authority y outcomes listos |
| `ACS-R2` | `planned` | Quotes & Transactions | Voice, Platform & Integrations | Transactional contracts | Transactional integrations | Transactional capabilities | Gating transaccional completo |

## Deferred capabilities / future_release_not_scheduled

Capacidades sin release ACS activa asignada. No compiten por secuencia con `ACS-R1-04`/`ACS-R1-05`; se retoman cuando su gate de reanudacion se cumpla.

| Capacidad | Owner | Motivo | Reanudar antes de |
|---|---|---|---|
| Address Book + address confirmation | Customer & Identity | Sin release ACS asignada tras la reasignacion de `ACS-R1-05` a Autonomous Follow-up Runtime; no bloquea el SDR autonomo ni el follow-up | shipping, checkout, creacion de pedidos, seleccion/confirmacion de direccion |

## Dependencias externas y capacidades en pausa

`ROADMAP.md` es la fuente normativa para los estados `PAUSED_EXTERNAL` y `DEFERRED`. `docs/ACTIVE_RELEASE.md`, `docs/product/MVP_EXECUTION_MAP.md` y las auditorias enlazan o resumen esta seccion; no la duplican.

### `PAUSED_EXTERNAL`

Una dependencia esta `PAUSED_EXTERNAL` cuando el bloqueo es enteramente externo al repositorio (endpoint, contrato, credenciales o entorno no disponibles) y no bloquea workstreams independientes.

- **Customer Service** (bloquea `ACS-R1-04`): no estan disponibles el endpoint, contrato real, credenciales, OpenAPI/Postman ni detalles operacionales del servicio unificador de clientes. Pendiente al reanudar: validar `resolve_customer`, `create_customer`, `link_external_identity`; confirmar que retorna `master_customer.id` como `customerMasterId`; validar autenticacion, idempotencia y manejo de sincronizacion parcial entre plataformas; ejecutar smoke operacional de `ACS-R1-04-T08`. Impacto: `ACS-R1-04-T08` continua bloqueada; `ACS-R1-04-T09` no puede cerrar la release; **no bloquea `ACS-R1-05` (Autonomous Follow-up Runtime) ni otros workstreams independientes**. No se declara que Customer Service deba construirse desde cero - existe un posible endpoint unificador externo que debera auditarse cuando este disponible.

### `DEFERRED`

Una capacidad esta `DEFERRED` cuando no pertenece al camino critico del MVP autonomo actual.

- **Address Book + address confirmation**: ver tabla "Deferred capabilities" arriba. No bloquea el SDR autonomo ni el follow-up. Administra multiples direcciones, destinatarios y confirmacion de direccion; no es el Customer Master. Reanudar antes de: shipping; checkout; creacion de pedidos; seleccion o confirmacion de direccion.
- **Voice** (`ACS-R1-09`): no pertenece al camino critico del MVP autonomo por WhatsApp. Reanudar despues de: conversacion autonoma estable; follow-up productivo; cancelacion por respuesta; outbox y delivery verificados; piloto real por WhatsApp.

Estado tecnico real del runtime de follow-up (que existe, que esta conectado, gaps): [Follow-up runtime reconciliation](audits/follow-up-runtime-reconciliation.md).

## Criterios generales

- Entrada: la release especifique alcance, dependencias, ADR y contratos aplicables.
- Salida: la release cierre su tarea activa, deje evidencia y solo entonces habilite la siguiente.
- El roadmap no define tareas ni contratos de bajo nivel.
- Los workstreams no crean roadmaps paralelos.
- P1/P2/P3 son etiquetas historicas y no gobiernan la secuencia actual.
