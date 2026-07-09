---
title: Capability - Customer 360 read model
doc_id: capability-customer-360-read-model
status: approved
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
source_of_truth_for:
  - customer 360 read model contract
  - read-only customer snapshot behavior
depends_on:
  - architecture/adr/ADR-008-customer-360-boundary
  - data/customer-360-contract
supersedes: []
tags:
  - capability
  - product
---
# Capability: Customer 360 read model

## Relaciones

- Gobernado por: [Autonomous Commerce PRD](../product/autonomous-commerce-prd.md)
- Depende de: [ADR-008 Customer 360 boundary](../architecture/adr/ADR-008-customer-360-boundary.md), [Customer 360 contract](../data/customer-360-contract.md), [ACS-R1-03 context pack](../context-packs/ACS-R1-03.md)
- Implementa: `Customer360Snapshot` read-only
- Evidencia: [Current state audit](../audits/autonomous-commerce-current-state-audit.md), [Acceptance audit](../audits/acs-r1-03-customer-360-acceptance.md)
- Context pack: [ACS-R1-03](../context-packs/ACS-R1-03.md)
- Reemplaza: none

## Proposito

Exponer una vista consolidada y read-only del cliente para operacion comercial, seguimiento y analitica operacional.

## Entrada

- `customerId`
- auth de operador o M2M
- fuentes nativas disponibles

## Salida

Un `Customer360Snapshot` versionado con:

- identidad provisional claramente visible;
- conversaciones;
- oportunidades;
- perfiles comerciales;
- acciones;
- outcomes;
- quotes;
- direcciones;
- orders proyectados cuando exista fuente;
- lifecycle events;
- metadata de fuente, frescura y completitud.

## Reglas

1. Read-only.
2. Sin side effects.
3. Sin fixtures.
4. Sin `n8n_*`.
5. Sin tabla monolitica.
6. Fuentes reemplazables via ports/adapters.
7. Falla parcial permitida.

## Metadata obligatoria

- `source`
- `freshness`
- `completeness`
- `warnings`

## Failure behavior

- Si una fuente cae, la vista degrada.
- Si la identidad no esta completa, se muestra como provisional.
- Si `ps_orders` no existe, la seccion de orders queda unavailable.
