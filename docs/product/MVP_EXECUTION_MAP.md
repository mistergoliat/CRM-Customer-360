---
title: MVP Execution Map
doc_id: product-mvp-execution-map
status: approved
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-09
source_of_truth_for:
  - MVP execution map
  - workstreams
  - ownership matrix
  - dependency graph
  - parallel work matrix
  - integration gates
depends_on:
  - ./autonomous-commerce-prd.md
  - ../ROADMAP.md
  - ../ACTIVE_RELEASE.md
  - ../CAPABILITY_MATRIX.md
  - ../architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md
  - ../architecture/adr/ADR-008-customer-360-boundary.md
  - ../data/customer-onboarding-identity-contract.md
  - ../data/customer-creation-linking-authority-contract.md
  - ../data/customer-360-contract.md
  - ../data/customer-lifecycle-event-contract.md
  - ../capabilities/customer-service-capability.md
  - ../integrations/customer-service-http-contract.md
supersedes: []
tags:
  - product
  - execution
  - ownership
---

# MVP Execution Map

Este documento no define prioridad temporal. Define ownership, dependencias y gates para trabajar en paralelo sin romper contratos.

## 6.1 Workstreams del MVP

| Workstream | Objetivo | Responsabilidad | Entidades propias | Datos que consume | Datos que puede escribir | Eventos que emite | Eventos que consume | Ports o servicios usados | ADR aplicables | Contratos aplicables | Dependencias | Limites | Release de integracion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Customer & Identity | Resolver y mantener identidad provisional o canonica | Identidad, onboarding y Customer Service boundary | customer identity, master customer, onboarding state, external identities | inbound WhatsApp, customer 360 read context, consent evidence | puede escribir: identity/session state, onboarding state, unresolved external identity records; mutaciones delegadas: resolved external identity links exclusivamente mediante Customer Service Port | identity resolved, identity conflict, onboarding updated | inbound messages, resolution requests, consent evidence | Customer Identity Service, Customer Service Port, Customer Service HTTP adapter | ADR-006, ADR-008 | customer-onboarding-identity-contract, customer-creation-linking-authority-contract, customer-service-capability, customer-service-http-contract, customer-360-contract | depende de inbound nativo, consent policy y Customer 360 gate | no puede escribir directamente `master_customer` ni convertir provisional identity en master | ACS-R1-04 |
| Commercial Runtime | Mantener el ciclo comercial autonomo | next best action, follow-up, handoff, opportunity lifecycle | opportunity, sales need profile, agent decisions, agent actions, action outcomes | identity context, catalog, customer 360, messages, policies | opportunities, need profiles, decisions, actions, outcomes | decision made, action proposed, follow-up scheduled, handoff requested | inbound messages, catalog results, delivery status, policy outcomes | Commercial loop, outbox worker, capability gateway | ADR-001, ADR-003, ADR-004, ADR-006, ADR-007 | customer-lifecycle-event-contract, lead-opportunity-contract, follow-up-decision-policy | depende de Customer & Identity, catalog boundary y outbox | no puede escribir sobre identidad, billing ni orders ajenos | ACS-R1-04 / ACS-R1-07 |
| Operator CRM | Dar control humano y lectura operativa | UI, supervision, read models, operator actions | customer workspace, conversation workspace, opportunity view, action queue | read models, timelines, metrics, audit logs | operator annotations, approvals, visual state | operator reviewed, approval granted, handoff accepted | decisions, actions, outcomes, queue state | Hub UI, read model services | ADR-002, ADR-004, ADR-008 | customer-360-contract, customer-address-contract, customer-lifecycle-event-contract | depende de read models estables y contracts de lectura | no puede escribir directo sobre dominios ajenos | ACS-R1-04 / ACS-R1-08 |
| Quotes & Transactions | Conducir la transaccion sin mezclarla con identidad | quote creation, checkout support, order visibility | quotes, transactions, order projections | customer context, catalog, address confirmation, policy | quote drafts, quote records, transactional projections | quote created, checkout requested, order projected | catalog updates, identity updates, policy approvals | Quote service, transaction ports | ADR-005, ADR-006, ADR-007, ADR-008 | quote contract, catalog contract, order visibility contract, customer-address-contract | depende de customer context, catalog, address confirmation y policy | no puede crear identidad ni usar Customer 360 como master | ACS-R1-07 |
| Analytics | Medir y proyectar la operacion | event model, metrics, projections | analytics events, analytics projections | product events, commercial events, operational events | projections, metric snapshots | event recorded, projection refreshed | domain events, delivery status, action outcomes | analytics pipeline, projection workers | ADR-002, ADR-006, ADR-007 | customer-lifecycle-event-contract, analytics event contracts | depende de IDs canonicos y versionado de eventos | no puede inferir verdad de negocio sin eventos versionados | ACS-R1-05 / future |
| Marketing | Gestionar contacto y campañas | segmentation, contact policy, campaign execution | campaigns, audiences, contact preferences, suppression | identity, consent, preferences, outcomes | campaign drafts, audience drafts, suppression lists | campaign drafted, audience prepared | consent changes, contact outcomes, opt-outs | marketing policy engine, campaign adapter | ADR-006, ADR-007 | contact policy contract, campaign contract, contact preference contract | depende de identity, consent y suppression | no puede ejecutar sin policy y consentimiento | outside current MVP / future_release_not_scheduled |
| Voice | Orquestar llamadas con gobernanza | call requests, call outcomes, transcription linkage | voice calls, transcriptions, call notes | identity, consent, authority, opportunity context | call requests, transcription links, voice outcomes | call requested, call ended, transcription linked | authority decisions, consent evidence, contact policy | voice port, transcription service | ADR-006, ADR-007, ADR-008 | voice contract, transcription contract, contact policy | depende de identity, consent, call policy y outcomes | no puede iniciar voz autonoma sin gate explicito | ACS-R1-09 |
| Platform & Integrations | Sostener el transporte y las integraciones | adapters, ports, schedulers, outbox, gateway plumbing | transport adapters, capability gateway, schedulers | config, policies, external responses | integration state, transport state | dispatch succeeded, dispatch failed, retry exhausted | capability decisions, transport events | HTTP adapters, gateway, workers | ADR-001, ADR-002, ADR-006, ADR-007 | customer-service-http-contract, catalog boundary contract, outbox contracts | depende de interfaces y contratos versionados | no puede introducir runtimes alternativos | ACS-R1-04 / ACS-R1-05 |

## 6.2 Capability Map del MVP

| Capability | Workstream propietario | Estado actual | Dependencias | Contrato canonico | Release ACS | Paralelizable | Gate de integracion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| identity resolution | Customer & Identity | implemented | inbound nativo, consent evidence, Customer Service boundary | customer-onboarding-identity-contract | ACS-R1-04 | yes | identifiers canonicos, resolucion estable, persistencia, conflictos explicitos, contratos versionados, tests de integracion |
| customer onboarding | Customer & Identity | implemented | identity resolution, persistence | customer-onboarding-identity-contract | ACS-R1-04 | yes | estado persistente, transiciones cerradas, versionado |
| customer master | Customer & Identity | future | Customer Service boundary, master data | customer-creation-linking-authority-contract | future_release_not_scheduled | no | no se integra hasta existir master data y governance aprobada |
| address book | Customer & Identity | planned | identity, address contract | customer-address-contract | ACS-R1-05 | yes | address ownership, confirmation, no direct writes ajenos |
| contact preferences | Marketing | future | identity, consent, contact policy | contact policy contract | outside current MVP | yes | consent, frequency caps, suppression, authority model |
| conversation linkage | Commercial Runtime | implemented | identity, inbound, outbox | customer-lifecycle-event-contract | ACS-R1-04 | yes | canonical IDs, message dedupe, consistent thread state |
| opportunity management | Commercial Runtime | implemented | identity, inbound, profile | lead-opportunity-contract | ACS-R1-04 | yes | one owner of writes, stable stage model |
| commercial planning | Commercial Runtime | implemented | opportunity, customer context, catalog | lead-opportunity-contract | ACS-R1-04 | yes | planner outputs versioned, no direct side effects |
| commercial actions | Commercial Runtime | implemented | planning, outbox | customer-lifecycle-event-contract | ACS-R1-04 | yes | action lifecycle and auditable outcomes |
| follow-up | Commercial Runtime | implemented_partial | scheduling, outbox, policy | follow-up-decision-policy | ACS-R1-04 | yes | idempotency, cancellation, policy checks |
| handoff | Operator CRM | implemented_partial | identity, opportunity, action state | customer-lifecycle-event-contract | ACS-R1-04 | yes | explicit human ownership, no hidden autonomy |
| operator conversation workspace | Operator CRM | implemented_partial | conversation read model | customer-360-contract | ACS-R1-04 | yes | read models stable, no writes ajenos |
| operator customer context | Operator CRM | implemented_partial | customer 360 projection | customer-360-contract | ACS-R1-04 | yes | partial data handling, no master writes |
| operator opportunity view | Operator CRM | implemented_partial | opportunity read model | lead-opportunity-contract | ACS-R1-04 | yes | consistent state, error handling |
| catalog search | Platform & Integrations | implemented | catalog adapter | catalog boundary contract | ACS-R1-01 | yes | source of truth, HTTP adapter, tests |
| quote creation | Quotes & Transactions | planned | catalog, customer context, address confirmation | quote contract | ACS-R1-07 | yes | quote contract, catalog contract, pricing rules, persistence |
| quote persistence | Quotes & Transactions | planned | quote creation | quote contract | ACS-R1-07 | yes | canonical storage, idempotency |
| checkout support | Quotes & Transactions | planned | quote, policy, customer context | checkout contract | ACS-R1-07 | yes | canonical checkout flow and approval gates |
| order visibility | Quotes & Transactions | implemented_partial | order projection | order visibility contract | ACS-R1-03 | yes | read model consistency, projection ownership |
| analytics events | Analytics | planned | canonical IDs, domain events | customer-lifecycle-event-contract | ACS-R1-05 | yes | versioned events, replayability, projection ownership |
| commercial metrics | Analytics | planned | analytics events | metrics contract | ACS-R1-05 | yes | metric definitions, projection ownership |
| agent performance metrics | Analytics | planned | analytics events, execution logs | metrics contract | ACS-R1-05 | yes | stable metrics and replayability |
| campaign model | Marketing | deferred | identity, contact policy | campaign contract | outside current MVP | yes | not operational until consent and policy are approved |
| audience segmentation | Marketing | deferred | identity, preferences, outcomes | campaign contract | outside current MVP | yes | segmentation is dormant until marketing release exists |
| contact policy | Marketing | deferred | consent, preferences | contact policy contract | outside current MVP | yes | policy-driven contact control |
| campaign execution | Marketing | deferred | contact policy, idempotency, outcomes | campaign contract | outside current MVP | no | no execution before policy, consent and suppression |
| voice call request | Voice | deferred | identity, consent, authority | voice contract | ACS-R1-09 | yes | voice port, consent, authority, outcome contract |
| voice outcomes | Voice | deferred | call execution | voice contract | ACS-R1-09 | yes | state machine and outcomes wired |
| transcription linkage | Voice | deferred | call outcomes | transcription contract | ACS-R1-09 | yes | transcription linkage and association gates |

## 6.3 Ownership Matrix

| Recurso o entidad | Owner | Consumidores | Quien puede escribir | Quien solo puede leer | Contrato | Persistencia canonica |
| --- | --- | --- | --- | --- | --- | --- |
| customer identity | Customer & Identity / Customer Service | Commercial Runtime, Operator CRM, Analytics | Customer Service Port only | everyone else via ports | customer-onboarding-identity-contract, customer-creation-linking-authority-contract | external service + local session state |
| master customer | Customer Service | Customer & Identity, Operator CRM, Quotes & Transactions | Customer Service only | ACS via port/read model | customer-creation-linking-authority-contract | external master data |
| customer addresses | Customer & Identity / Address Book | Customer 360, Quotes & Transactions | Address Book service only | Operator CRM, Customer 360 | customer-address-contract | address book store |
| contact preferences | Marketing | Commercial Runtime, Voice, Operator CRM | Marketing policy service only | everyone else | contact policy contract | future marketing store |
| conversation | Commercial Runtime | Operator CRM, Analytics | Conversation runtime only | Operator CRM, Analytics | customer-lifecycle-event-contract | conversation store |
| conversation messages | Commercial Runtime | Operator CRM, Analytics | conversation runtime / outbox projection | read models only | customer-lifecycle-event-contract | message store |
| opportunity | Commercial Runtime | Operator CRM, Analytics | commercial runtime only | Operator CRM, Analytics | lead-opportunity-contract | opportunity store |
| sales need profile | Commercial Runtime | Operator CRM | commercial runtime only | Operator CRM | lead-opportunity-contract | need profile store |
| agent decisions | Commercial Runtime | Analytics, Operator CRM | commercial runtime only | read models only | customer-lifecycle-event-contract | decision store |
| agent actions | Commercial Runtime | Analytics, Operator CRM | commercial runtime only | read models only | customer-lifecycle-event-contract | action store |
| action executions | Commercial Runtime / Platform | Analytics, Operator CRM | execution worker only | read models only | customer-lifecycle-event-contract | execution store |
| action outcomes | Commercial Runtime / Platform | Analytics, Operator CRM | execution worker only | read models only | customer-lifecycle-event-contract | outcome store |
| quotes | Quotes & Transactions | Operator CRM, Commercial Runtime | quote service only | read models only | quote contract | quote store |
| campaigns | Marketing | Operator CRM, Analytics | marketing service only | read models only | campaign contract | campaign store |
| analytics events | Analytics | all read models | analytics ingestion only | consumers only | customer-lifecycle-event-contract | event stream |
| analytics projections | Analytics | Operator CRM, reporting | projection workers only | read models only | metrics contract | projection store |
| voice calls | Voice | Operator CRM, Commercial Runtime | voice service only | read models only | voice contract | voice call store |
| transcriptions | Voice | Operator CRM, Analytics | transcription service only | read models only | transcription contract | transcription store |
| catalog products | Platform & Integrations | Commercial Runtime, Quotes & Transactions | catalog source of truth only | everyone else via port | catalog boundary contract | catalog source / adapter |
| orders | Quotes & Transactions | Operator CRM, Customer 360 | order system only | read models only | order visibility contract | external order source |

## 6.4 Dependency Graph

### hard_dependency

- Customer & Identity -> Commercial Runtime
- Customer & Identity -> Operator CRM
- Commercial Runtime -> Quotes & Transactions
- Platform & Integrations -> all runtime workstreams

### contract_dependency

- PRD -> ROADMAP
- ROADMAP -> release specs
- release specs -> ADRs and contracts
- contracts -> implementation

### data_dependency

- customer identity -> customer 360
- customer identity -> analytics
- opportunity -> analytics
- orders -> customer 360

### integration_dependency

- Customer & Identity -> Operator CRM
- Commercial Runtime -> Analytics
- Quotes & Transactions -> Operator CRM
- Platform & Integrations -> every runtime that touches external systems

### policy_dependency

- Customer & Identity -> Marketing
- Customer & Identity -> Voice
- Contact Policy -> Marketing execution
- Contact Policy -> Voice initiation

### operational_dependency

- Customer & Identity -> inbound runtime
- Commercial Runtime -> outbox worker
- Analytics -> replay/reprocessing
- Voice -> transcription and outcome persistence

## 6.5 Parallel Work Matrix

| Trabajo | Workstream | Estado de paralelizacion | Dependencia exacta | Que puede hacerse ahora | Que no puede hacerse todavia | Gate de integracion |
| --- | --- | --- | --- | --- | --- | --- |
| Operator CRM UI | Operator CRM | independent | read models y fixtures | avanzar UI y estados visuales | escribir sobre dominios ajenos | read models definidos, contratos estables, errores manejados |
| Analytics event model | Analytics | independent | canonical IDs | definir eventos y proyecciones | declarar metricas productivas sin IDs | eventos versionados, idempotencia, replay |
| Analytics productivo | Analytics | integration_blocked | event stream versionado | preparar workers y schemas | asumir prod sin eventos versionados | metric definitions y ownership de proyecciones |
| Marketing domain model | Marketing | contract_blocked | contact policy | modelar audiencias y restricciones | ejecutar marketing real | identity, consent, preferences, policy |
| Marketing execution | Marketing | policy_blocked | authority model | definir outcomes y suppression | contactar sin policy y consent | frequency caps, suppression, idempotency |
| Voice microservice | Voice | implementation_blocked | voice port | modelar call states y transcript linkage | llamar a clientes sin gate | call states, consent, authority, outcome contract |
| Quote service | Quotes & Transactions | contract_blocked | quote contract | modelar quote drafts y persistence | crear checkout real sin contrato | quote, catalog, pricing, persistence |
| Quote integration | Quotes & Transactions | integration_blocked | catalog + customer context | preparar adapter y mappings | escribir en orders ajenos | catalog, customer context, commercial runtime |

## 6.6 Integration Gates

### Customer & Identity

- identificadores canonicos
- resolucion estable
- persistencia
- conflictos explicitos
- contratos versionados
- tests de integracion

### Operator CRM

- read models definidos
- contratos estables
- estados consistentes
- errores manejados
- sin escritura directa sobre dominios ajenos

### Analytics

- eventos versionados
- IDs canonicos
- idempotencia
- replay o reprocessing
- definicion de metricas
- propiedad de proyecciones

### Marketing

- customer identity
- consentimientos
- preferencias de contacto
- contact policy
- frequency caps
- suppression
- idempotencia
- authority model
- outcomes

### Voice

- voice port
- call states
- consentimiento
- authority
- transcripcion
- outcome contract
- asociacion a customer y opportunity

### Quotes & Transactions

- quote contract
- catalog contract
- pricing rules
- customer context
- address confirmation
- idempotencia
- persistence
- commercial runtime integration

## 6.7 Reglas de paralelizacion

- Un workstream puede disenar e implementar internamente antes de su release de integracion.
- No puede declarar integracion productiva antes de cumplir su gate.
- No puede crear tablas o modelos duplicados de otro dominio.
- No puede escribir directamente sobre persistencia ajena.
- No puede introducir un runtime alternativo.
- No puede modificar contratos compartidos sin coordinacion explicita.
- No puede usar mocks como evidencia de operacion productiva.
- No puede adelantar politicas de contacto, consentimiento o autoridad.
- Una release ACS sigue siendo la unidad de integracion y aceptacion.

## 6.8 Dependencias externas en pausa

El workstream `Customer & Identity` depende de un Customer Service externo en estado `PAUSED_EXTERNAL`; los workstreams de Address Book (dentro de `Customer & Identity`, `ACS-R1-05`) y Voice (`ACS-R1-09`) permanecen en `DEFERRED`, sin bloquear `Commercial Runtime` ni el follow-up autonomo. Fuente canonica de estos estados: [../audits/follow-up-runtime-reconciliation.md](../audits/follow-up-runtime-reconciliation.md).
