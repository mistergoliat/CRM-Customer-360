---
release: ACS-R1-04
title: Customer Identity Resolution + Onboarding
doc_id: release-acs-r1-04-customer-identity-onboarding
status: active
updated_at: 2026-07-08
current_task: ACS-R1-04-T02
next_task: ACS-R1-04-T03
blocked: false
owner: product
source_of_truth_for:
  - ACS-R1-04 release scope
  - ACS-R1-04 task queue
  - ACS-R1-04 definition of done
depends_on:
  - ../ACTIVE_RELEASE.md
  - ../CAPABILITY_MATRIX.md
  - ../product/autonomous-commerce-prd.md
  - ../architecture/adr/ADR-008-customer-360-boundary.md
  - ../capabilities/customer-360-read-model.md
  - ../data/customer-360-contract.md
  - ../data/customer-lifecycle-event-contract.md
  - ../data/customer-onboarding-identity-contract.md
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

## Tareas

| ID | Tarea | Estado | Dependencias | Evidencia de cierre |
| -- | ----- | ------ | ------------ | ------------------- |
| ACS-R1-04-T01 | Definir contrato de onboarding e identidad | done | ACTIVE_RELEASE, PRD, CAPABILITY_MATRIX, ADRs y contratos relacionados | [customer-onboarding-identity-contract](../data/customer-onboarding-identity-contract.md) |
| ACS-R1-04-T02 | Implementar resolucion por `wa_id` y telefono normalizado | in_progress | ACS-R1-04-T01 | pending |
| ACS-R1-04-T03 | Persistir onboarding multi-turno | ready | ACS-R1-04-T02 | pending |
| ACS-R1-04-T04 | Definir reglas de creacion y vinculacion canonica | ready | ACS-R1-04-T03 | pending |
| ACS-R1-04-T05 | Incorporar Customer 360 al contexto autonomo | ready | ACS-R1-04-T04 | pending |
| ACS-R1-04-T06 | Conectar identidad y onboarding al inbound nativo | ready | ACS-R1-04-T05 | pending |
| ACS-R1-04-T07 | Persistir executions, outcomes y advertencias | ready | ACS-R1-04-T06 | pending |
| ACS-R1-04-T08 | Ejecutar pruebas end-to-end: nuevo, antiguo y conflicto | ready | ACS-R1-04-T07 | pending |
| ACS-R1-04-T09 | Auditoria de aceptacion y cierre | ready | ACS-R1-04-T08 | pending |

## Tarea actual

`ACS-R1-04-T02`

## Definition of Done

- Estados de identidad definidos.
- Contrato de entrada y salida definido.
- Provisional representable.
- Customer existente representable.
- Conflicto representable.
- Ninguna creacion automatica de customer por cada inbound.
- Reglas de confidence y `matchedBy` documentadas.
- Tests requeridos definidos.
- Ninguna dependencia de `n8n_*` ni fixtures productivos.

## Siguiente tarea

`ACS-R1-04-T03`

## Bloqueos

- Ninguno documentado en este momento.

## Deudas fuera del incremento

- `ACS-R1-01` conserva deuda de hardening del capability gateway.
- `ACS-R1-03` conserva deuda de acceptance formal y cierre de auditoria.
- Address Book, Quote, Policy, Shipping, Checkout y Voice quedan fuera de este incremento.

## Regla de actualizacion

Cuando la tarea actual termine:

1. Cambiar su estado a `done`.
2. Mover la siguiente tarea a `in_progress`.
3. Actualizar `ACTIVE_RELEASE.md`.
4. Actualizar `current_task` y `next_task`.
5. Agregar evidencia de cierre.
6. Actualizar `CAPABILITY_MATRIX.md` si cambio la implementacion real.
7. No crear una auditoria por cada tarea.
8. Crear auditoria solo al cerrar una release.
