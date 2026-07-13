---
release: ACS-R1-04
title: Customer Identity Resolution + Onboarding
status: active
updated_at: 2026-07-13
current_task: ACS-R1-04-T07
next_task: ACS-R1-04-T08
blocked: false
last_accepted_commit: 0c51419
t06_1_sha: 0c51419
doc_id: release-active
source_of_truth_for:
  - active release
  - current task
  - next task
  - blocked state
  - last accepted commit
depends_on:
  - ./ROADMAP.md
  - ./releases/README.md
  - ./releases/ACS-R1-04-customer-identity-onboarding.md
  - ./product/MVP_EXECUTION_MAP.md
  - ./CAPABILITY_MATRIX.md
tags:
  - release
  - product
---

# ACTIVE_RELEASE

Este documento es un puntero operativo breve. El alcance, la tabla de tareas, la Definition of Done y la deuda detallada viven en la release spec (unica fuente de esos datos).

## Release activa

- `ACS-R1-04`

## Tarea actual

- `ACS-R1-04-T07`

## Siguiente tarea

- `ACS-R1-04-T08`

## Bloqueos

- Ninguno documentado en este momento. `ACS-R1-04-T06.2` reconcilio el inbound de identidad nativo tras `PR #43`/commit `3222003` (regresion de `resolveOrCreateNativeCustomer`, colision de migracion `022`, dominio paralelo y dual-write a la tabla legacy) - ver la release spec, seccion "Deudas fuera del incremento", entrada `ACS-R1-04-T06.2`.

## Commit aceptado

- `last_accepted_commit`: `0c51419`
- `t06_1_sha`: `0c51419`

## Release spec

- [ACS-R1-04 - Customer Identity Resolution + Onboarding](releases/ACS-R1-04-customer-identity-onboarding.md)

## Required reading

- [Autonomous Commerce PRD](product/autonomous-commerce-prd.md)
- [ROADMAP](ROADMAP.md)
- [MVP execution map](product/MVP_EXECUTION_MAP.md)
- [ACS-R1-04 release spec](releases/ACS-R1-04-customer-identity-onboarding.md)
- [Customer onboarding and identity contract](data/customer-onboarding-identity-contract.md)
- [Customer creation, linking and interest authority contract](data/customer-creation-linking-authority-contract.md)
- [Customer Service capability](capabilities/customer-service-capability.md)
- [Customer Service HTTP contract](integrations/customer-service-http-contract.md)
- [CAPABILITY_MATRIX](CAPABILITY_MATRIX.md)

## Nota operativa

`ACS-R1-04-T07` persiste executions, outcomes y advertencias especificas de identity/onboarding mas alla de lo que el Capability Gateway ya audita via `insertCapabilityExecution`. No reabre las reglas de autoridad ni la frontera de Customer 360 fijada por `T06` y `T06.1`. Ver la Definition of Done completa en la release spec.

`ACS-R1-04-T06.2` (previa a T07, ya cerrada) reconcilio `resolveOrCreateNativeCustomer` (renombrada `resolveOrPersistNativeExternalIdentity`) y elimino el dominio paralelo `lib/domains/customer-identity-onboarding` introducido fuera de secuencia por `PR #43`. T07 puede instrumentar esta ruta con confianza: la suite dirigida de T02-T06.2 vuelve a estar en verde.

## Regla de actualizacion

Cuando la tarea actual termine:

1. Cambiar su estado a `done` en la release spec.
2. Mover la siguiente tarea a `in_progress`.
3. Actualizar `current_task` y `next_task` aqui y en la release spec.
4. Actualizar `last_accepted_commit`.
5. Actualizar `docs/CAPABILITY_MATRIX.md` si cambio la implementacion real.
6. No crear una auditoria por cada tarea; crear auditoria solo al cerrar una release.
