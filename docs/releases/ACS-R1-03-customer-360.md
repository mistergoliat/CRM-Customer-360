---
title: ACS-R1-03 - Customer 360 consolidado
doc_id: release-acs-r1-03-customer-360
status: accepted_with_debt
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
source_of_truth_for:
  - historical release scope snapshot
  - customer 360 increment
  - release acceptance criteria
depends_on:
  - product/autonomous-commerce-prd
  - architecture/adr/ADR-008-customer-360-boundary
supersedes: []
tags:
  - release
  - product
  - customer-360
---

# ACS-R1-03 - Customer 360 consolidado

## Relaciones

- Gobernado por: [Autonomous Commerce PRD](../product/autonomous-commerce-prd.md)
- Depende de: [ADR-008 Customer 360 boundary](../architecture/adr/ADR-008-customer-360-boundary.md)
- Implementa: `ACS-R1-03-customer-360`
- Evidencia: [Current state audit](../audits/autonomous-commerce-current-state-audit.md), [Transactional closure audit](../audits/autonomous-commerce-transactional-closure-audit.md), [Acceptance audit](../audits/acs-r1-03-customer-360-acceptance.md)
- Reemplaza: none

## Estado

`accepted_with_debt`

## Objetivo

Construir un Customer 360 real como read model agregado del cliente usando fuentes nativas existentes y ports reemplazables para el futuro `Customer Service` externo.

## Alcance

- Snapshot versionado del cliente.
- Consolidacion de conversaciones, oportunidades, perfiles, acciones, outcomes, quotes, direcciones y pedidos proyectados.
- Exposicion HTTP read-only.
- Vista Hub para `app/(hub)/customers/[id]`.
- Manejo parcial si una fuente no esta disponible.
- Metadata de fuente, frescura y completitud.
- Tests de aislamiento, autorizacion y partial failure.

## Fuera de alcance

- Microservicio `Customer Service`.
- HTTP adapter real externo.
- `create_customer` externo.
- Carrito, checkout, shipping, pagos, voz o marketing.
- Tabla monolitica `customer_360`.
- Uso de `n8n_*` como fuente del snapshot.
- Uso de fixtures como respaldo de produccion.
- Cambios al runtime autonomo canonico de ACS-R1-01.

## Decisiones principales

1. Customer 360 es read model, no source of truth.
2. Customer Service sera el due no futuro de identidad y direcciones.
3. Autonomous Commerce conserva la verdad operacional de oportunidades, perfil comercial, decisiones, acciones, outcomes, follow-ups y handoff.
4. Conversation Domain conserva la verdad de conversaciones y mensajes.
5. Quotes y orders solo se proyectan.
6. Las lecturas pasan por ports/adapters reemplazables.
7. Una fuente caida degrada el snapshot, no invalida la vista completa.

## Entregables tecnicos

- `GET /api/customers/:customerId/360`
- `Customer360Snapshot` versionado
- `Customer360QueryService`
- `CustomerProfilePort`
- `LocalCustomerProfileAdapter`
- `AddressBookPort`
- `LocalAddressBookAdapter`
- `LifecycleEventAssembler`

## Criterios de exito

- La pagina de customer detail muestra un Customer 360 real.
- La identidad provisional queda visible.
- Las direcciones muestran multiples filas y no confunden default con confirmacion.
- La vista sobrevive a una fuente no disponible.
- La arquitectura permite reemplazar adapters locales por HTTP adapters sin reescribir la UI.

## Riesgos

- `ps_orders` puede no existir en todos los entornos.
- Algunas tablas de quote/order pueden tener drift de schema.
- La frescura por seccion debe leerse como metadata, no como garantia de latencia cero.
