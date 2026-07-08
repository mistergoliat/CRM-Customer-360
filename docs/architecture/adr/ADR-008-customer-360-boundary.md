---
title: ADR-008 - Customer 360 boundary and read-model ownership
doc_id: adr-008-customer-360-boundary
status: approved
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-08
source_of_truth_for:
  - customer 360 boundary
  - read-model ownership
  - identity and address boundary
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - adr
---
# ADR-008: Customer 360 boundary and read-model ownership

## Relaciones

- Gobernado por: [Autonomous Commerce PRD](../../product/autonomous-commerce-prd.md)
- Depende de: [ACS-R1-03 context pack](../../context-packs/ACS-R1-03.md)
- Implementa: read model consolidado de Customer 360
- Evidencia: [Current state audit](../../audits/autonomous-commerce-current-state-audit.md), [Transactional closure audit](../../audits/autonomous-commerce-transactional-closure-audit.md), [Acceptance audit](../../audits/acs-r1-03-customer-360-acceptance.md)
- Context pack: [ACS-R1-03](../../context-packs/ACS-R1-03.md)
- Reemplaza: none

## Estado

Accepted

## Contexto

El producto necesita una vista consolidada del cliente para operar ventas, postventa y seguimiento sin declarar una segunda fuente de verdad para identidad o direccion.

La plataforma ya dispone de fuentes nativas para conversaciones, oportunidades, decisiones, acciones, outcomes, quotes, addresses y eventos. Tambien existe un futuro `Customer Service` externo que debera asumir identidad y direcciones sin romper la frontera actual.

## Decision

Customer 360 se implementa como read model agregado y versionado.

```text
Ports replaceables
-> Customer360QueryService
-> Customer360Snapshot
-> Hub UI / API
```

### Ownership

- `Customer Service` sera el duenio futuro de identidad y direcciones.
- Autonomous Commerce es duenio de oportunidades, perfil comercial, decisiones, acciones, outcomes, follow-ups y handoff.
- Conversation Domain es duenio de conversaciones y mensajes.
- Quotes y orders se proyectan en Customer 360, pero no se duplican como maestros.

### Boundary rules

- No crear `customer_360` como tabla monolitica.
- No usar `n8n_*` como fuente del snapshot.
- No introducir side effects.
- No convertir la UI en verdad del dominio.
- No usar fixtures para representar datos productivos.

## Ports

### CustomerProfilePort

Lee la proyeccion consolidada del perfil desde las fuentes nativas actuales.

### AddressBookPort

Lee las direcciones del cliente desde `customer_addresses`.

## Adapter strategy

- `LocalCustomerProfileAdapter` consume tablas nativas actuales.
- `LocalAddressBookAdapter` consume `customer_addresses`.
- Los adapters futuros podran ser HTTP adapters sin cambiar el contrato del snapshot.

## Failure model

- Si una fuente falla, el snapshot conserva lo que si se pudo leer.
- La metadata debe exponer `source`, `freshness` y `completeness`.
- Un fallo parcial no invalida la pagina.
- `unavailable` y `partial` son estados validos; `fixture` no lo es en este flujo.

## Invariants

1. Customer 360 no es source of truth.
2. Identity no se inventa.
3. Address default no equivale a address confirmed.
4. `address_id` debe persistirse en el contexto comercial cuando una operacion lo requiera.
5. Snapshot y timeline deben ser reproducibles desde las fuentes nativas.
6. La UI solo consume el snapshot, no las tablas individuales.

## Consequences

### Positivas

- Se puede reemplazar una fuente local por un Customer Service externo sin reescribir la UI.
- La experiencia visual P1M puede evolucionar antes que la migracion total.
- La frontera entre visualizacion y ejecucion queda explicita.

### Negativas

- El snapshot necesita assembler y metadata mas ricos.
- Hay que tolerar fuentes parcialmente caidas.
- Order projection puede quedar incompleta en entornos sin `ps_orders`.
