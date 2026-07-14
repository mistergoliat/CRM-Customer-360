---
title: ROADMAP
doc_id: product-roadmap
status: active
version: "2.0.0"
owner: product
last_reviewed: 2026-07-09
source_of_truth_for:
  - roadmap
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
| `ACS-R1-04` | `active` | Customer & Identity | Commercial Runtime, Platform & Integrations, Operator CRM | Customer onboarding identity, customer creation linking authority, customer service capability, customer service HTTP contract | Customer Service port, native inbound, Customer 360 access gate | identity resolution, onboarding, create/link, customer 360 gate | T06.1 cerrado, T07 en curso |
| `ACS-R1-05` | `planned` | Customer & Identity | Operator CRM | Customer address contract, customer 360 contract | Address Book, address confirmation | Address Book y confirmacion de direccion | Customer identity estable y direccion operativa |
| `ACS-R1-06` | `planned` | Platform & Integrations | Commercial Runtime | Policy and authority contracts | Business policy | Business policy | Identity + address + policy listos |
| `ACS-R1-07` | `planned` | Quotes & Transactions | Operator CRM, Commercial Runtime | Quote, catalog, order contracts | Quote flow | Quote creation and persistence | Catalog, customer context y policy listos |
| `ACS-R1-08` | `planned` | Operator CRM | Commercial Runtime | Operator readiness contracts | Operator controls | Operator readiness | Execution trace, approvals y supervision listos |
| `ACS-R1-09` | `planned` | Voice | Platform & Integrations | Voice contract | Voice initiation | Voice outcomes and transcription linkage | Consent, authority y outcomes listos |
| `ACS-R2` | `planned` | Quotes & Transactions | Voice, Platform & Integrations | Transactional contracts | Transactional integrations | Transactional capabilities | Gating transaccional completo |

## Dependencias externas en pausa

`ACS-R1-04` depende de un Customer Service externo actualmente en pausa (`PAUSED_EXTERNAL`); `ACS-R1-05` (Address Book) y `ACS-R1-09` (Voice) permanecen `planned`/`DEFERRED` y no bloquean el follow-up autonomo. Fuente canonica de estos estados y del estado real del runtime de follow-up: [Follow-up runtime reconciliation](audits/follow-up-runtime-reconciliation.md).

## Criterios generales

- Entrada: la release especifique alcance, dependencias, ADR y contratos aplicables.
- Salida: la release cierre su tarea activa, deje evidencia y solo entonces habilite la siguiente.
- El roadmap no define tareas ni contratos de bajo nivel.
- Los workstreams no crean roadmaps paralelos.
- P1/P2/P3 son etiquetas historicas y no gobiernan la secuencia actual.
