---
release: ACS-R1-04
title: Customer Identity Resolution + Onboarding
status: active
updated_at: 2026-07-13
current_task: ACS-R1-04-T08
next_task: ACS-R1-04-T09
blocked: true
last_accepted_commit: 102fc5e
t06_1_sha: 0c51419
t06_2_sha: 72cb9c3
t07_sha: cd9317e
t08_1_sha: 102fc5e
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

- `ACS-R1-04-T08`

## Siguiente tarea

- `ACS-R1-04-T09`

## Bloqueos

- `ACS-R1-04-T08` (pruebas end-to-end de identidad/onboarding) permanece bloqueada UNICAMENTE por la falta de un Customer Service desplegado (ni productivo ni sandbox) contra el cual ejecutar el smoke operacional que exige su Definition of Done - `CUSTOMER_SERVICE_BASE_URL`/`CUSTOMER_SERVICE_API_KEY` estan vacios en `.env.example` y no hay configuracion real en el repo. El gap estructural que T08 encontro (`ACS-R1-04-T08.1`, ver abajo) ya quedo resuelto: `resolve_customer`/`create_customer`/`link_external_identity` retornan `customerMasterId` (v2.0.0, breaking) y ACS verifica la proyeccion local `master_customer` antes de completar onboarding, via un gate centralizado que no inserta/actualiza `master_customer` ni elimina la FK de `crm_customer_onboarding_state.customer_id`. `ACS-R1-04-T08.1` tambien cerro, en un segundo incremento (commit `102fc5e`), la deuda de recuperacion runtime: un onboarding que aterriza en `temporarily_unavailable` por proyeccion no disponible ya no es un callejon sin salida - un inbound real posterior obtiene exactamente un nuevo intento de `resolve_customer` y completa sin un segundo `create_customer` en cuanto la proyeccion aparece. La suite E2E completa (14 tests, `tests/e2e/customerIdentityOnboarding.e2e.test.ts`, incluye el escenario negativo de proyeccion no disponible y la recuperacion runtime real en un turno N+1) corre en verde contra un servidor HTTP local controlado que implementa el contrato real (nunca un mock de `executeGovernedCapability`) y contra la cadena de migraciones completa sobre una base `crm_test` desechable, pero eso sigue siendo evidencia de integracion, no de verificacion operacional real - `create_customer`/`link_external_identity`/`resolve_customer` permanecen `operational: not_verified` en `CAPABILITY_MATRIX.md` hasta que exista un smoke contra un Customer Service real desplegado. Ver la release spec, seccion "Deudas fuera del incremento", entradas `ACS-R1-04-T08` y `ACS-R1-04-T08.1`, para el detalle completo (incluye un segundo bug real ya corregido con regresion en T08: `lib/domains/customer-identity/local-adapter.ts` trataba una fila de identidad externa no resuelta como un candidato valido con id literal `"null"`). `ACS-R1-04-T06.2` reconcilio el inbound de identidad nativo tras `PR #43`/commit `3222003` - ver la release spec, seccion "Deudas fuera del incremento", entrada `ACS-R1-04-T06.2`. `ACS-R1-04-T07` persistio executions/outcomes/warnings de identidad sobre `commercial_event` existente, sin nueva tabla ni cambio de autoridad - ver evidencia de cierre en la release spec.

## Commit aceptado

- `last_accepted_commit`: `102fc5e`
- `t06_1_sha`: `0c51419`
- `t06_2_sha`: `72cb9c3`
- `t07_sha`: `cd9317e`
- `t08_1_sha`: `102fc5e`

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

`ACS-R1-04-T08` ejecuto pruebas end-to-end (cliente nuevo, cliente antiguo, conflicto) contra el flujo de identidad/onboarding ya conectado (`T06`/`T06.1`) y ahora instrumentado (`T07`). No reabrio autoridad ni la frontera de Customer 360. Queda `blocked: true` unicamente por la verificacion operacional real contra un Customer Service desplegado (inexistente en este repo/entorno) - la integracion completa (inbound -> `runNativeAutonomousCycle` -> `resolveNativeCustomerSession` -> `CustomerOnboardingService` -> Capability Gateway -> adapter HTTP -> `commercial_event` T07 -> estado final) esta probada y en verde contra una base `crm_test` desechable.

`ACS-R1-04-T08.1` (cerrada, dos incrementos) reconcilio el `customerMasterId` entre Customer Service y ACS: contrato HTTP v2.0.0 (breaking, `customerId` -> `customerMasterId` en los tres resultados exitosos), adapter fail-closed ante respuestas invalidas/incompletas, y un gate centralizado (`completeOnboardingWithVerifiedCustomer`/`verifyCustomerMasterProjection`) que verifica la proyeccion local `master_customer` antes de completar onboarding - sin eliminar la FK, sin que ACS inserte/actualice `master_customer`, sin tabla ni migracion nueva. Un segundo incremento (commit `102fc5e`) agrego la recuperacion runtime real: `resolveNativeCustomerSession` ahora tambien intenta `resolve_customer` de nuevo cuando el onboarding esta en `temporarily_unavailable` (no solo `required`/`collecting`), y un helper centralizado nuevo (`ensureResolving`, `onboardingTransitions.ts`) conecta el metodo de dominio `retryResolution` (existente desde T03, sin callers hasta ahora) - nunca un segundo `create_customer`, verificado con un turno real end-to-end (`tests/e2e/customerIdentityOnboarding.e2e.test.ts`, "T08-A6"/"T08-A7"), nunca llamando las funciones del gate directamente. Esto cierra el gap estructural que T08 encontro; el unico bloqueo restante de T08 es la falta de un Customer Service desplegado para el smoke operacional. Ver la release spec para el detalle completo.

`ACS-R1-04-T07` (cerrada, commit `cd9317e`) persistio evidencia durable de resolucion de identidad (local/externa), transiciones efectivas de onboarding, business outcomes de `resolve_customer`/`create_customer`/`link_external_identity` (separados del status tecnico del Gateway) y warnings estructurados, todo sobre `commercial_event` existente - sin tabla nueva, sin duplicar `crm_capability_executions`, sin cambiar autoridad ni el orden pre-plan/post-plan. Tambien redacto `request_summary_json`/`response_summary_json` de las tres capabilities de identidad en `crm_capability_executions` (antes texto crudo con telefono/email/wa_id). Ver evidencia completa en la release spec.

`ACS-R1-04-T06.2` (previa a T07, ya cerrada) reconcilio `resolveOrCreateNativeCustomer` (renombrada `resolveOrPersistNativeExternalIdentity`) y elimino el dominio paralelo `lib/domains/customer-identity-onboarding` introducido fuera de secuencia por `PR #43`.

## Regla de actualizacion

Cuando la tarea actual termine:

1. Cambiar su estado a `done` en la release spec.
2. Mover la siguiente tarea a `in_progress`.
3. Actualizar `current_task` y `next_task` aqui y en la release spec.
4. Actualizar `last_accepted_commit`.
5. Actualizar `docs/CAPABILITY_MATRIX.md` si cambio la implementacion real.
6. No crear una auditoria por cada tarea; crear auditoria solo al cerrar una release.
