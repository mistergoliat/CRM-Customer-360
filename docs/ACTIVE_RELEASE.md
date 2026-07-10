---
release: ACS-R1-04
title: Customer Identity Resolution + Onboarding
status: active
updated_at: 2026-07-09
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
  - active release objective
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

## Release activa

- `ACS-R1-04`

## Tarea actual

- `ACS-R1-04-T07`

## Siguiente tarea

- `ACS-R1-04-T08`

## Bloqueos

- Ninguno documentado en este momento.

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

`ACS-R1-04-T07` persiste executions, outcomes y advertencias especificas de identity/onboarding mas alla de lo que el Capability Gateway ya audita via `insertCapabilityExecution`. No reabre las reglas de autoridad ni la frontera de Customer 360 fijada por `T06` y `T06.1`.
