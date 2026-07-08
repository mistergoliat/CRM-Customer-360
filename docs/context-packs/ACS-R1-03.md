---
title: Context Pack - ACS-R1-03 Customer 360
doc_id: context-pack-acs-r1-03
status: active
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-08
source_of_truth_for:
  - agent reading order for ACS-R1-03
  - allowed and forbidden documentation scope for ACS-R1-03
depends_on:
  - ../00-START-HERE.md
  - ../ACTIVE_RELEASE.md
  - ../CAPABILITY_MATRIX.md
  - ../releases/ACS-R1-03-customer-360.md
  - ../audits/autonomous-commerce-current-state-audit.md
  - ../audits/autonomous-commerce-transactional-closure-audit.md
  - ../audits/acs-r1-03-customer-360-acceptance.md
  - ../architecture/adr/ADR-008-customer-360-boundary.md
  - ../capabilities/customer-360-read-model.md
  - ../capabilities/customer-addresses.md
  - ../data/customer-360-contract.md
  - ../data/customer-address-contract.md
  - ../data/customer-lifecycle-event-contract.md
supersedes: []
tags:
  - context-pack
  - active
---

# ACS-R1-03 Customer 360

## Objetivo

Hacer explicito que Customer 360 es un read model consolidado y que su acceptance formal no se confunde con su implementacion tecnica.

## Lectura obligatoria en orden

1. [START-HERE](../00-START-HERE.md)
2. [ACTIVE_RELEASE](../ACTIVE_RELEASE.md)
3. [CAPABILITY_MATRIX](../CAPABILITY_MATRIX.md)
4. [ACS-R1-03 release spec](../releases/ACS-R1-03-customer-360.md)
5. [ADR-008 Customer 360 boundary](../architecture/adr/ADR-008-customer-360-boundary.md)
6. [Customer 360 capability](../capabilities/customer-360-read-model.md)
7. [Customer addresses capability](../capabilities/customer-addresses.md)
8. [Customer 360 contract](../data/customer-360-contract.md)
9. [Customer address contract](../data/customer-address-contract.md)
10. [Customer lifecycle event contract](../data/customer-lifecycle-event-contract.md)
11. [Current state audit](../audits/autonomous-commerce-current-state-audit.md)
12. [Transactional closure audit](../audits/autonomous-commerce-transactional-closure-audit.md)
13. [Customer 360 acceptance audit](../audits/acs-r1-03-customer-360-acceptance.md)

## Evidencia

- [Current state audit](../audits/autonomous-commerce-current-state-audit.md)
- [Transactional closure audit](../audits/autonomous-commerce-transactional-closure-audit.md)
- [Customer 360 acceptance audit](../audits/acs-r1-03-customer-360-acceptance.md)
- [CAPABILITY_MATRIX](../CAPABILITY_MATRIX.md)

## Invariantes

1. Customer 360 es read model, no source of truth.
2. La identidad sigue siendo provisional mientras no exista `customer_master`.
3. `address_id` y la confirmacion explicita siguen separadas de `is_default`.
4. Quotes y orders se proyectan, no se elevan a maestros.
5. `n8n_*` y fixtures no pueden aparecer como fuente productiva del snapshot.

## Capabilities afectadas

- `get_customer_context`
- `get_customer_addresses`
- `create_customer`
- `create_customer_address`
- `prepare_quote`
- `find_order`
- `get_order_status`

## Fuentes de verdad

- `docs/ACTIVE_RELEASE.md`
- `docs/CAPABILITY_MATRIX.md`
- `docs/releases/ACS-R1-03-customer-360.md`
- `docs/architecture/adr/ADR-008-customer-360-boundary.md`
- `docs/capabilities/customer-360-read-model.md`
- `docs/capabilities/customer-addresses.md`
- `docs/data/customer-360-contract.md`
- `docs/data/customer-address-contract.md`
- `docs/data/customer-lifecycle-event-contract.md`

## Archivos permitidos

- `docs/ACTIVE_RELEASE.md`
- `docs/CAPABILITY_MATRIX.md`
- `docs/releases/ACS-R1-03-customer-360.md`
- `docs/audits/autonomous-commerce-current-state-audit.md`
- `docs/audits/autonomous-commerce-transactional-closure-audit.md`
- `docs/audits/acs-r1-03-customer-360-acceptance.md`
- `docs/architecture/adr/ADR-008-customer-360-boundary.md`
- `docs/capabilities/customer-360-read-model.md`
- `docs/capabilities/customer-addresses.md`
- `docs/data/customer-360-contract.md`
- `docs/data/customer-address-contract.md`
- `docs/data/customer-lifecycle-event-contract.md`
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

1. ACS-R1-03 sigue marcado como `implemented_pending_acceptance`.
2. Existen auditorias historicas enlazadas como evidencia, no como fuente normativa.
3. Customer 360 no aparece como tool del agente.
4. El estado visible de la vault no presenta `Customer Service` como source of truth activo.

## Contradicciones conocidas

- El acceptance audit existe como snapshot historico, pero no convierte por si solo la release en accepted.
- La identidad provisional sigue siendo la referencia real mientras no exista `customer_master`.
- Algunos contratos proyectados dependen de fuentes heterogeneas y pueden degradar parciales.
