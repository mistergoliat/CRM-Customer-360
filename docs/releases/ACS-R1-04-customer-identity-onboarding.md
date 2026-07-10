---
release: ACS-R1-04
title: Customer Identity Resolution + Onboarding
doc_id: release-acs-r1-04-customer-identity-onboarding
status: active
updated_at: 2026-07-09
current_task: ACS-R1-04-T07
next_task: ACS-R1-04-T08
blocked: false
owner: product
source_of_truth_for:
  - ACS-R1-04 release scope
  - ACS-R1-04 task queue
  - ACS-R1-04 definition of done
depends_on:
  - ../ACTIVE_RELEASE.md
  - ../ROADMAP.md
  - ../product/MVP_EXECUTION_MAP.md
  - ../product/autonomous-commerce-prd.md
  - ../architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md
  - ../architecture/adr/ADR-008-customer-360-boundary.md
  - ../data/customer-onboarding-identity-contract.md
  - ../data/customer-creation-linking-authority-contract.md
  - ../data/customer-360-contract.md
  - ../data/customer-lifecycle-event-contract.md
  - ../capabilities/customer-service-capability.md
  - ../integrations/customer-service-http-contract.md
supersedes:
  - ACS-R1-02
tags:
  - release
  - product
---

# ACS-R1-04 - Customer Identity Resolution + Onboarding

## Objetivo

Permitir que un mensaje entrante de WhatsApp resuelva una identidad existente, conserve una identidad provisional cuando no exista coincidencia, detecte conflictos sin fusionar customers automaticamente, inicie onboarding minimo, cargue Customer 360 cuando exista `customerId`, incorpore contexto historico al ciclo autonomo y persista el estado entre mensajes.

## Resultado esperado

- La identidad provisional, la identidad existente y el conflicto quedan representados de forma canonica.
- El onboarding minimo puede continuar entre mensajes.
- Customer 360 se usa como contexto, no como Customer Master.
- El estado persiste entre turnos sin depender de `n8n_*`.

## No objetivos

- Address Book operativo.
- Confirmacion de direccion.
- Quote.
- Shipping.
- Checkout.
- Voice.
- Nuevas pantallas.
- Merge automatico de customers.
- Redisenio de Customer 360.

## Required reading

- [Autonomous Commerce PRD](../product/autonomous-commerce-prd.md)
- [ROADMAP](../ROADMAP.md)
- [MVP execution map](../product/MVP_EXECUTION_MAP.md)
- [ACTIVE_RELEASE](../ACTIVE_RELEASE.md)
- [Customer onboarding and identity contract](../data/customer-onboarding-identity-contract.md)
- [Customer creation, linking and interest authority contract](../data/customer-creation-linking-authority-contract.md)
- [Customer Service capability](../capabilities/customer-service-capability.md)
- [Customer Service HTTP contract](../integrations/customer-service-http-contract.md)
- [CAPABILITY_MATRIX](../CAPABILITY_MATRIX.md)

## ADRs aplicables

- [ADR-006 - Autonomous planning and capability governance](../architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md)
- [ADR-008 - Customer 360 boundary](../architecture/adr/ADR-008-customer-360-boundary.md)

## Contratos aplicables

- [customer-onboarding-identity-contract](../data/customer-onboarding-identity-contract.md)
- [customer-creation-linking-authority-contract](../data/customer-creation-linking-authority-contract.md)
- [customer-360-contract](../data/customer-360-contract.md)
- [customer-lifecycle-event-contract](../data/customer-lifecycle-event-contract.md)
- [customer-service-capability](../capabilities/customer-service-capability.md)
- [customer-service-http-contract](../integrations/customer-service-http-contract.md)

## Tareas

| ID | Tarea | Estado | Dependencias | Evidencia de cierre |
| -- | ----- | ------ | ------------ | ------------------- |
| ACS-R1-04-T01 | Definir contrato de onboarding e identidad | done | PRD, ROADMAP, CAPABILITY_MATRIX, ADRs y contratos relacionados | [customer-onboarding-identity-contract](../data/customer-onboarding-identity-contract.md) |
| ACS-R1-04-T02 | Implementar resolucion por `wa_id` y telefono normalizado | done | ACS-R1-04-T01 | [customer-onboarding-identity-contract](../data/customer-onboarding-identity-contract.md) |
| ACS-R1-04-T02.1 | Corregir clasificacion de input y resolucion telefonica canonica | done | ACS-R1-04-T02 | [customer-onboarding-identity-contract](../data/customer-onboarding-identity-contract.md) |
| ACS-R1-04-T03 | Persistir onboarding multi-turno | done | ACS-R1-04-T02.1 | [customer-onboarding-identity-contract](../data/customer-onboarding-identity-contract.md) |
| ACS-R1-04-T03.1 | Validar migracion canonica y preservar invariantes de persistencia | done | ACS-R1-04-T03 | [customer-onboarding-identity-contract](../data/customer-onboarding-identity-contract.md) |
| ACS-R1-04-T04 | Definir reglas de creacion y vinculacion canonica | done | ACS-R1-04-T03.1 | [customer-creation-linking-authority-contract](../data/customer-creation-linking-authority-contract.md) |
| ACS-R1-04-T04.1 | Implementar Customer Service Port y politicas de creacion/vinculacion | done | ACS-R1-04-T04 | [customer-service-capability](../capabilities/customer-service-capability.md), [customer-service-http-contract](../integrations/customer-service-http-contract.md) |
| ACS-R1-04-T05 | Incorporar Customer 360 al contexto autonomo | done | ACS-R1-04-T04.1 | [customer-360-contract](../data/customer-360-contract.md) |
| ACS-R1-04-T06 | Conectar identidad y onboarding al inbound nativo | done | ACS-R1-04-T05 | [ACTIVE_RELEASE](../ACTIVE_RELEASE.md) |
| ACS-R1-04-T06.1 | Completar activacion y captura multi-turno del onboarding | done | ACS-R1-04-T06 | [ACTIVE_RELEASE](../ACTIVE_RELEASE.md) |
| ACS-R1-04-T07 | Persistir executions, outcomes y advertencias | in_progress | ACS-R1-04-T06.1 | pending |
| ACS-R1-04-T08 | Ejecutar pruebas end-to-end: nuevo, antiguo y conflicto | ready | ACS-R1-04-T07 | pending |
| ACS-R1-04-T09 | Auditoria de aceptacion y cierre | ready | ACS-R1-04-T08 | pending |

## Tarea actual

`ACS-R1-04-T07`

## Definition of Done de la tarea actual

`ACS-R1-04-T07` debe persistir executions, outcomes y advertencias especificas de identity/onboarding mas alla de lo que el Capability Gateway ya audita hoy via `insertCapabilityExecution`, sin duplicar esa auditoria, sin abrir un event store o dashboard nuevo no solicitado, y sin reabrir las reglas de autoridad, la compuerta de Customer 360 o la arquitectura de dos fases fijada en `T06` y `T06.1`.

## Siguiente tarea

`ACS-R1-04-T08`

## Bloqueos

- Ninguno documentado en este momento.

## Deuda aceptada

- `ACS-R1-01` conserva deuda de hardening del capability gateway.
- `ACS-R1-03` conserva deuda de acceptance formal y cierre de auditoria.
- Address Book, Quote, Policy, Shipping, Checkout y Voice quedan fuera de este incremento.
- `ACS-R1-04-T02.1` mantiene identidad provisional por `wa_id` scoped al canal y telefono historico cross-provider.
- `ACS-R1-04-T03` mantiene persistencia canonica en `crm_customer_onboarding_state` y deja la tabla legacy sin dual-write.
- `ACS-R1-04-T04` separa autoridad de estrategia; la IA decide que explorar, no que side effect ejecutar.
- `ACS-R1-04-T06` y `ACS-R1-04-T06.1` ya quedaron cerradas con el SHA `0c51419` y no deben reabrirse salvo correccion critica.
