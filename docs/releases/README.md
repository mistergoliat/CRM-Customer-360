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
| `ACS-R1-04` | `active_blocked_external` | [ACS-R1-04 spec](ACS-R1-04-customer-identity-onboarding.md) | pending | `0c51419` for T06.1 only | Customer Identity Resolution + Onboarding |
| `ACS-R1-05` | `parallel_in_progress` | [ACS-R1-05 spec](ACS-R1-05-autonomous-follow-up-runtime.md) | pending | n/a | Autonomous Follow-up Runtime (Commercial Runtime) - reasignada desde Address Book, ver Notas |
| `ACS-R1-06` | `planned` | planned | pending | n/a | Business Policy |
| `ACS-R1-07` | `planned` | planned | pending | n/a | Quote |
| `ACS-R1-08` | `planned` | planned | pending | n/a | Operator Readiness |
| `ACS-R1-09` | `planned` | planned | pending | n/a | Voice |
| `ACS-R2` | `planned` | planned | pending | n/a | Capabilities transaccionales |

## Notas

- `ACS-R1-02` no se presenta como implementado; su alcance fue absorbido por `ACS-R1-04`.
- `ACS-R1-04` es la unica release activa en el sentido secuencial tradicional (`active_blocked_external`: bloqueada solo por Customer Service externo, `PAUSED_EXTERNAL` en `ROADMAP.md`).
- `ACS-R1-05` fue reasignada de "Address Book + Address Confirmation" a "Autonomous Follow-up Runtime" (2026-07-14, ver [ACS-R1-05 spec](ACS-R1-05-autonomous-follow-up-runtime.md)). Es un workstream paralelo autorizado (`parallel_in_progress`), no una segunda release activa que compita por secuencia con `ACS-R1-04` - avanza porque no depende del Customer Service externo. Address Book quedo sin release ACS asignada; ver "Deferred capabilities" en `ROADMAP.md`.
- `accepted_with_debt` indica release terminada con deuda explicitada, no trabajo activo.
- Las specs historicas no reemplazan la release activa.
