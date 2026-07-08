---
title: Capability - Customer addresses
doc_id: capability-customer-addresses
status: approved
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
source_of_truth_for:
  - customer address ownership
  - explicit address confirmation
depends_on:
  - architecture/adr/ADR-008-customer-360-boundary
  - data/customer-address-contract
supersedes: []
tags:
  - capability
  - product
---
# Capability: Customer addresses

## Relaciones

- Gobernado por: [Autonomous Commerce PRD](../product/autonomous-commerce-prd.md)
- Depende de: [ADR-008 Customer 360 boundary](../architecture/adr/ADR-008-customer-360-boundary.md), [Customer address contract](../data/customer-address-contract.md), [ACS-R1-03 context pack](../context-packs/ACS-R1-03.md)
- Implementa: entidad de direccion separada y confirmacion explicita
- Evidencia: [Current state audit](../audits/autonomous-commerce-current-state-audit.md), [Acceptance audit](../audits/acs-r1-03-customer-360-acceptance.md)
- Context pack: [ACS-R1-03](../context-packs/ACS-R1-03.md)
- Reemplaza: none

## Proposito

Gestionar direcciones como entidad separada del cliente, con multiples direcciones por cliente y confirmacion explicita por operacion.

## Reglas

1. Un cliente puede tener muchas direcciones.
2. `is_default` solo sugiere, no confirma.
3. Confirmar una direccion es una decision por request.
4. `address_id` debe persistirse en el contexto comercial cuando la operacion lo requiera.
5. La direccion confirmada para cotizar, enviar o despachar no se infiere desde el default.
6. Quotes y orders deben guardar snapshots inmutables de la direccion usada.

## Fuente

- `customer_addresses`

## Estado esperado

- lectura real;
- validacion de ownership;
- activacion/desactivacion;
- default unico por cliente;
- readiness para accion fisica solo con confirmacion explicita.
