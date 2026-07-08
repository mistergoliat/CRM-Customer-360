---
title: Relationship Map
doc_id: product-relationship-map
status: non-normative
version: "1.1.0"
owner: architecture
last_reviewed: 2026-07-08
source_of_truth_for:
  - visual relationship index
depends_on:
  - ./00-START-HERE.md
  - ./ACTIVE_RELEASE.md
  - ./CAPABILITY_MATRIX.md
supersedes: []
tags:
  - index
  - non-normative
---

# Relationship Map

Este documento es un indice visual, no una fuente de verdad nueva.

## Vista general

```mermaid
graph TD
  PRD[product/autonomous-commerce-prd]
  START[00-START-HERE]
  ACTIVE[ACTIVE_RELEASE]
  MATRIX[CAPABILITY_MATRIX]
  ROADMAP[ROADMAP]
  INDEX[releases/README]

  subgraph Closed[Releases cerradas]
    R01[ACS-R1-01 accepted_with_debt]
    R03[ACS-R1-03 accepted_with_debt]
  end

  subgraph Active[Release activa]
    R04[ACS-R1-04 active]
    R04SPEC[release-acs-r1-04-customer-identity-onboarding]
  end

  subgraph Planned[Planned]
    R05[ACS-R1-05]
    R06[ACS-R1-06]
    R07[ACS-R1-07]
    R08[ACS-R1-08]
    R09[ACS-R1-09]
    R2[ACS-R2]
  end

  ADR08[adr-008-customer-360-boundary]
  CAP360[capability-customer-360-read-model]
  CAPADDR[capability-customer-addresses]
  DATA360[data-customer-360-contract]
  DATAADDR[data-customer-address-contract]
  DATAEVENT[data-customer-lifecycle-event-contract]
  AUDIT01[audit-acs-r1-01-capability-gateway-evidence]
  AUDIT03[audit-autonomous-commerce-current-state]
  AUDIT03TX[audit-autonomous-commerce-transactional-closure]
  AUDIT03ACC[audit-acs-r1-03-customer-360-acceptance]

  START --> PRD
  START --> ACTIVE
  START --> MATRIX
  ACTIVE --> R04SPEC
  ACTIVE --> MATRIX
  ROADMAP --> R04
  INDEX --> R04SPEC
  PRD --> ROADMAP
  PRD --> ADR08
  ADR08 --> CAP360
  ADR08 --> CAPADDR
  CAP360 --> DATA360
  CAPADDR --> DATAADDR
  CAP360 --> DATAEVENT
  CAPADDR --> DATAEVENT
  R01 --> AUDIT01
  R03 --> AUDIT03
  R03 --> AUDIT03TX
  R03 --> AUDIT03ACC
  R04 --> R04SPEC
```

## Relaciones principales

### Producto general

- `docs/ACTIVE_RELEASE.md` fija el trabajo activo.
- `docs/ROADMAP.md` fija la secuencia.
- `docs/CAPABILITY_MATRIX.md` fija el estado tecnico real.
- `docs/releases/README.md` indexa releases y estados.

### ACS-R1-01 y ACS-R1-03

- `ACS-R1-01` queda como release cerrada con deuda de hardening.
- `ACS-R1-03` queda como release cerrada con deuda de acceptance.
- Sus auditorias historicas son evidencia, no fuente normativa.

### ACS-R1-04

- `docs/releases/ACS-R1-04-customer-identity-onboarding.md` es la release activa.
- `docs/ACTIVE_RELEASE.md` es el tablero operativo de esa release.
- `resolve_customer` y `link_external_identity` pertenecen a la franja de identity onboarding.

### ADR, capabilities y contratos

- `docs/architecture/adr/ADR-008-customer-360-boundary.md` gobierna la frontera de Customer 360.
- `docs/capabilities/customer-360-read-model.md` y `docs/capabilities/customer-addresses.md` describen capabilities de lectura.
- `docs/data/customer-360-contract.md`, `docs/data/customer-address-contract.md` y `docs/data/customer-lifecycle-event-contract.md` fijan los contratos de datos.

## Regla de uso

- Si una relacion no aparece aqui, la fuente canonica sigue siendo el documento original con `doc_id` estable.
