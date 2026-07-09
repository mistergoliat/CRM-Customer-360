---
title: ROADMAP
doc_id: product-roadmap
status: active
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
source_of_truth_for:
  - roadmap entry point
  - navigation to product roadmap
depends_on:
  - ./releases/README.md
  - ./ACTIVE_RELEASE.md
supersedes: []
tags:
  - product
  - release
---

# ROADMAP

La ruta canonica del roadmap vive en [docs/releases/README.md](releases/README.md).

## Releases

| Release | Estado | Dependencia | Resultado habilitado | Siguiente release |
|---|---|---|---|---|
| `ACS-R1-01` | `accepted_with_debt` | Catalog Capability Gateway y runtime canonico | Search/get product details operativos | `ACS-R1-03` |
| `ACS-R1-02` | `superseded` | Plan de Customer Service absorbido por `ACS-R1-04` | Ninguno independiente | `ACS-R1-04` |
| `ACS-R1-03` | `accepted_with_debt` | Customer 360 read model y contratos de datos | Vista consolidada de cliente | `ACS-R1-04` |
| `ACS-R1-04` | `active` | Identity Resolution + Onboarding | Resolucion de identidad y onboarding minimo | `ACS-R1-05` |
| `ACS-R1-05` | `planned` | ACS-R1-04 | Address Book + Address Confirmation | `ACS-R1-06` |
| `ACS-R1-06` | `planned` | ACS-R1-04 y ACS-R1-05 | Business Policy | `ACS-R1-07` |
| `ACS-R1-07` | `planned` | ACS-R1-06 | Quote | `ACS-R1-08` |
| `ACS-R1-08` | `planned` | ACS-R1-04 y ACS-R1-07 | Operator Readiness | `ACS-R1-09` |
| `ACS-R1-09` | `planned` | ACS-R1-08 | Voice | `ACS-R2` |
| `ACS-R2` | `planned` | ACS-R1-07 y ACS-R1-09 | Capabilities transaccionales | future roadmap |

## Regla

- `ACS-R1-04` es el unico incremento activo.
- La roadmap resume secuencia y dependencias, no tareas detalladas de implementacion.
