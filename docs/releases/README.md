---
title: releases
doc_id: release-index
status: active
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
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

Indice de releases y su estado real. No duplica el contenido de las specs.

| Release | Especificacion | Evidencia | Auditoria de aceptacion | Estado | Notas |
|---|---|---|---|---|---|
| `ACS-R1-01` | `docs/product/autonomous-commerce-prd.md` + `docs/audits/acs-r1-01-capability-gateway-evidence.md` | `docs/audits/acs-r1-01-capability-gateway-evidence.md` | pending dedicated acceptance audit | `accepted_with_debt` | Runtime canonico + Catalog Capability |
| `ACS-R1-02` | none independent | none independent | none | `superseded` | Customer Service planificado, absorbido por `ACS-R1-04` |
| `ACS-R1-03` | `docs/releases/ACS-R1-03-customer-360.md` | `docs/audits/autonomous-commerce-current-state-audit.md`, `docs/audits/autonomous-commerce-transactional-closure-audit.md` | `docs/audits/acs-r1-03-customer-360-acceptance.md` | `accepted_with_debt` | Customer 360 read model |
| `ACS-R1-04` | `docs/releases/ACS-R1-04-customer-identity-onboarding.md` | pending | pending | `active` | Customer Identity Resolution + Onboarding |
| `ACS-R1-05` | planned | planned | pending | `planned` | Address Book + Address Confirmation |
| `ACS-R1-06` | planned | planned | pending | `planned` | Business Policy |
| `ACS-R1-07` | planned | planned | pending | `planned` | Quote |
| `ACS-R1-08` | planned | planned | pending | `planned` | Operator Readiness |
| `ACS-R1-09` | planned | planned | pending | `planned` | Voice |
| `ACS-R2` | planned | planned | pending | `planned` | Capabilities transaccionales |

## Notas

- `ACS-R1-02` no se presenta como implementado; su alcance fue absorbido por `ACS-R1-04`.
- `ACS-R1-04` es la unica release activa.
- `accepted_with_debt` indica release terminada con deuda explicitada, no trabajo activo.
- Las specs historicas no reemplazan la release activa.
