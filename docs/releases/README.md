---
title: releases
doc_id: release-index
status: active
version: "2.0.0"
owner: product
last_reviewed: 2026-07-09
source_of_truth_for:
  - release index
  - increment registry
depends_on:
  - ../ACTIVE_RELEASE.md
  - ./ACS-R1-04-customer-identity-onboarding.md
supersedes: []
tags:
  - release
  - product
---

# Releases

Indice operativo de releases ACS. No duplica la planificacion ni las tareas.

| Release | Estado | Especificacion | Auditoria de aceptacion | SHA de cierre | Notas |
|---|---|---|---|---|---|
| `ACS-R1-01` | `accepted_with_debt` | [ACS-R1-01 evidence](../audits/acs-r1-01-capability-gateway-evidence.md) | pending dedicated acceptance audit | pending | Runtime canonico + Catalog Capability |
| `ACS-R1-02` | `superseded` | none independent | none | n/a | Customer Service planificado, absorbido por `ACS-R1-04` |
| `ACS-R1-03` | `accepted_with_debt` | [ACS-R1-03 spec](ACS-R1-03-customer-360.md) | [ACS-R1-03 acceptance](../audits/acs-r1-03-customer-360-acceptance.md) | pending | Customer 360 read model |
| `ACS-R1-04` | `active` | [ACS-R1-04 spec](ACS-R1-04-customer-identity-onboarding.md) | pending | `0c51419` for T06.1 only | Customer Identity Resolution + Onboarding |
| `ACS-R1-05` | `planned` | planned | pending | n/a | Address Book + Address Confirmation |
| `ACS-R1-06` | `planned` | planned | pending | n/a | Business Policy |
| `ACS-R1-07` | `planned` | planned | pending | n/a | Quote |
| `ACS-R1-08` | `planned` | planned | pending | n/a | Operator Readiness |
| `ACS-R1-09` | `planned` | planned | pending | n/a | Voice |
| `ACS-R2` | `planned` | planned | pending | n/a | Capabilities transaccionales |

## Notas

- `ACS-R1-02` no se presenta como implementado; su alcance fue absorbido por `ACS-R1-04`.
- `ACS-R1-04` es la unica release activa.
- `accepted_with_debt` indica release terminada con deuda explicitada, no trabajo activo.
- Las specs historicas no reemplazan la release activa.
