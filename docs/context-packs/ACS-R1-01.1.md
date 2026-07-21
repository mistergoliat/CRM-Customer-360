---
title: Context Pack - ACS-R1-01.1 Capability Gateway Hardening
doc_id: context-pack-acs-r1-01-1
status: active
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-08
source_of_truth_for:
  - agent reading order for ACS-R1-01.1
  - allowed and forbidden documentation scope for ACS-R1-01.1
depends_on:
  - ../00-START-HERE.md
  - ../ACTIVE_RELEASE.md
  - ../CAPABILITY_MATRIX.md
  - ../releases/README.md
  - ../audits/acs-r1-01-capability-gateway-evidence.md
  - ../product/autonomous-commerce-prd.md
  - ../product/autonomous-commerce-current-state.md
  - ../architecture/adr/ADR-005-catalog-boundary.md
  - ../architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md
  - ../architecture/adr/ADR-007-failure-escalation-and-outcomes.md
supersedes: []
tags:
  - context-pack
  - active
---

# ACS-R1-01.1 Capability Gateway Hardening

## Objetivo

Harden del capability gateway y del catalog boundary sin confundir implementacion existente con acceptance formal.

## Lectura obligatoria en orden

1. [START-HERE](../00-START-HERE.md)
2. [ACTIVE_RELEASE](../ACTIVE_RELEASE.md)
3. [CAPABILITY_MATRIX](../CAPABILITY_MATRIX.md)
4. [Releases index](../releases/README.md)
5. [ACS-R1-01 evidence](../audits/acs-r1-01-capability-gateway-evidence.md)
6. [Autonomous Commerce PRD](../product/autonomous-commerce-prd.md)
7. [Autonomous Commerce current state](../archive/autonomous-commerce-current-state.md) (movido a `docs/archive/` en la consolidacion documental)
8. [ADR-005 Catalog boundary](../architecture/adr/ADR-005-catalog-boundary.md)
9. [ADR-006 Autonomous planning and capability governance](../architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md)
10. [ADR-007 Failure escalation and outcomes](../architecture/adr/ADR-007-failure-escalation-and-outcomes.md)

## Evidencia

- [ACS-R1-01 capability gateway evidence](../audits/acs-r1-01-capability-gateway-evidence.md)
- [CAPABILITY_MATRIX](../CAPABILITY_MATRIX.md)
- [Active release](../ACTIVE_RELEASE.md)

## Invariantes

1. `ACS-R1-01` esta implementado.
2. `ACS-R1-01` sigue pendiente de hardening y no esta aceptado definitivamente.
3. `search_products` y `get_product_details` permanecen registrados y wired.
4. Existen deudas de retry, execution stage, policy, naming, smoke test y flags.
5. `ACS-R1-03` no se convierte en source of truth ni en tool del agente por arrastre de este pack.

## Capabilities afectadas

- `search_products`
- `get_product_details`
- `prepare_quote`
- `create_checkout_link`
- `calculate_shipping`
- `place_sales_call`

## Fuentes de verdad

- `docs/ACTIVE_RELEASE.md`
- `docs/CAPABILITY_MATRIX.md`
- `docs/audits/acs-r1-01-capability-gateway-evidence.md`
- `docs/product/autonomous-commerce-prd.md`
- `docs/architecture/adr/ADR-005-catalog-boundary.md`
- `docs/architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md`
- `docs/architecture/adr/ADR-007-failure-escalation-and-outcomes.md`

## Archivos permitidos

- `docs/ACTIVE_RELEASE.md`
- `docs/CAPABILITY_MATRIX.md`
- `docs/releases/README.md`
- `docs/audits/acs-r1-01-capability-gateway-evidence.md`
- `docs/product/autonomous-commerce-prd.md`
- `docs/product/autonomous-commerce-current-state.md`
- `docs/architecture/adr/ADR-005-catalog-boundary.md`
- `docs/architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md`
- `docs/architecture/adr/ADR-007-failure-escalation-and-outcomes.md`
- `AGENTS.md`
- `CLAUDE.md`

## Archivos prohibidos

- `app/`
- `lib/`
- `migrations/`
- `tests/`
- `scripts/`
- `package.json`
- `.env`
- runtime productivo

## Criterios de aceptacion

1. Existe un unico incremento tecnico activo.
2. La matrix de capacidades coincide con la evidencia presentada.
3. Ningun documento declara `ACS-R1-01` como accepted o completed.
4. La documentacion no presenta una auditoria historica como especificacion normativa.

## Contradicciones conocidas

- `ACS-R1-01` implementado pero con deuda de hardening abierta.
- `ACS-R1-03` implementado y aun no consolidado como acceptance formal en la vault.
- El catalog boundary sigue siendo una frontera en construccion, no una clausura ya cerrada.
