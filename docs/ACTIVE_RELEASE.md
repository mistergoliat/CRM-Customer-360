---
release: ACS-R1-04
title: Customer Identity Resolution + Onboarding
status: active
updated_at: 2026-07-08
current_task: ACS-R1-04-T04
next_task: ACS-R1-04-T05
blocked: false
doc_id: release-active
source_of_truth_for:
  - active release
  - current task
  - next task
  - blocked state
  - active release objective
depends_on:
  - ./00-START-HERE.md
  - ./releases/README.md
  - ./releases/ACS-R1-04-customer-identity-onboarding.md
  - ./CAPABILITY_MATRIX.md
tags:
  - release
  - product
---

# ACTIVE_RELEASE

## Objetivo del incremento

Permitir que un mensaje entrante de WhatsApp resuelva identidad existente, mantenga identidad provisional cuando no haya coincidencia, detecte conflictos sin fusionar customers automaticamente, inicie onboarding minimo, cargue Customer 360 cuando exista `customerId`, incorpore contexto historico al ciclo autonomo y persista el estado entre mensajes.

## Resultado esperado

- Un unico release activo.
- Una sola tarea `in_progress`.
- El estado de identidad queda explicitado sin confundir customer existente, provisional o en conflicto.
- Customer 360 sigue siendo un read model, no un master.
- El onboarding minimo queda listo para continuar en la siguiente ejecucion.

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

## Tabla de tareas

| ID | Tarea | Estado | Dependencias | Evidencia de cierre |
| -- | ----- | ------ | ------------ | ------------------- |
| ACS-R1-04-T01 | Definir contrato de onboarding e identidad | done | PRD, ACTIVE_RELEASE, CAPABILITY_MATRIX, ADRs y contratos relacionados | [customer-onboarding-identity-contract](data/customer-onboarding-identity-contract.md) |
| ACS-R1-04-T02 | Implementar resolucion por `wa_id` y telefono normalizado | done | ACS-R1-04-T01 | [lib/domains/customer-identity](../lib/domains/customer-identity), [tests/domains/customerIdentity.test.ts](../tests/domains/customerIdentity.test.ts) |
| ACS-R1-04-T02.1 | Corregir clasificacion de input y resolucion telefonica canonica | done | ACS-R1-04-T02 | [lib/domains/customer-identity](../lib/domains/customer-identity), [lib/integrations/customer-external-identity/repository.ts](../lib/integrations/customer-external-identity/repository.ts), [tests/domains/customerIdentity.test.ts](../tests/domains/customerIdentity.test.ts) |
| ACS-R1-04-T03 | Persistir onboarding multi-turno | done | ACS-R1-04-T02.1 | [lib/domains/customer-onboarding](../lib/domains/customer-onboarding), [migrations/023_crm_customer_onboarding_state.sql](../migrations/023_crm_customer_onboarding_state.sql), [tests/domains/customerOnboarding.test.ts](../tests/domains/customerOnboarding.test.ts) |
| ACS-R1-04-T04 | Definir reglas de creacion y vinculacion canonica | in_progress | ACS-R1-04-T03 | pending |
| ACS-R1-04-T05 | Incorporar Customer 360 al contexto autonomo | ready | ACS-R1-04-T04 | pending |
| ACS-R1-04-T06 | Conectar identidad y onboarding al inbound nativo | ready | ACS-R1-04-T05 | pending |
| ACS-R1-04-T07 | Persistir executions, outcomes y advertencias | ready | ACS-R1-04-T06 | pending |
| ACS-R1-04-T08 | Ejecutar pruebas end-to-end: nuevo, antiguo y conflicto | ready | ACS-R1-04-T07 | pending |
| ACS-R1-04-T09 | Auditoria de aceptacion y cierre | ready | ACS-R1-04-T08 | pending |

## Tarea actual

`ACS-R1-04-T04`

## Definition of Done de la tarea actual

Ver [releases/ACS-R1-04-customer-identity-onboarding.md](releases/ACS-R1-04-customer-identity-onboarding.md#definition-of-done-de-la-tarea-actual), que apunta al contrato canonico (`customer-onboarding-identity-contract.md`, seccion 6) para las reglas de `create_customer` y `link_external_identity`.

## Siguiente tarea

`ACS-R1-04-T05`

## Bloqueos

- Ninguno documentado en este momento.

## Deudas fuera del incremento

- `ACS-R1-01` — hardening del capability gateway (`ACS-R1-01.1`) completado: retry unico en el HTTP adapter (el gateway es el unico propietario del retry), flags productivas documentadas (incl. la contradiccion de `BRAIN_SALES_AGENT_DRY_RUN`), aprobacion derivada de metadata de la capability en vez de `blocking` reportado por el LLM, nombres canonicos snake_case centralizados en un solo alias table, etapa de ejecucion generica (`runCapabilityExecutionStage`), seleccion de producto por ranker deterministico auditado, smoke test real y prueba integrada multi-turno. Ver `docs/audits/acs-r1-01-1-capability-gateway-hardening-evidence.md`. Deuda restante: `propose_followup` no esta conectado al scheduling real de follow-ups (due_at/worker); el registry de capabilities de multi-request aun lee PrestaShop por SQL directo (no este Catalog Port); `denied` no dispara escalamiento formal todavia.
- `ACS-R1-03` conserva deuda de acceptance formal y cierre de auditoria.
- Address Book, Quote, Policy, Shipping, Checkout y Voice quedan fuera de este incremento.
- `ACS-R1-04-T02.1` corrigio el alcance de `CustomerIdentityResolutionService`: `wa_id` sigue scoped a `provider = channel` (exacto); el telefono ahora busca en `customer_external_identity` sin filtrar por provider (telefono historico de cualquier canal), via `findDistinctCustomersByNormalizedValueAcrossProviders`. `customer_addresses.recipient_phone` y `ps_customer` (Prestashop) fueron revisados y descartados: el primero es contacto de despacho, no identidad verificada; el segundo no tiene bridge verificado hacia `master_customer.id`. Un input invalido ahora es `invalid_input`, distinto de `identification_required`. Sigue sin estar conectado al inbound nativo, al Gateway ni a Customer 360 (eso es T04-T06).
- `ACS-R1-04-T03` agrego `crm_customer_onboarding_state` (migration 023) y `lib/domains/customer-onboarding` como persistencia canonica de `CustomerOnboardingState`. La tabla legacy `crm_customer_onboarding` (P1M) se descarto como fuente canonica (clave, enum de estado y columnas incompatibles con el contrato) y quedo intacta, sin dual-write. No conecta inbound, LLM, Gateway, Customer 360 ni escritura de customers (T04-T06). Detalle completo en [releases/ACS-R1-04-customer-identity-onboarding.md](releases/ACS-R1-04-customer-identity-onboarding.md).
- Deuda de entorno (no introducida por T03): la DB de desarrollo local tiene `schema_migrations` detenido en `011_commercial_event.sql` por un checksum desalineado, lo que bloquea `npm run db:migrate` para las migraciones 012-022 y hace fallar ~82 tests preexistentes no relacionados con este incremento en este entorno. Detalle en la nota de deuda de T03 en el documento de release.

## Regla de actualizacion

Cuando la tarea actual termine:

1. Cambiar su estado a `done`.
2. Mover la siguiente tarea a `in_progress`.
3. Actualizar `current_task`.
4. Actualizar `next_task`.
5. Agregar evidencia de cierre.
6. Actualizar `CAPABILITY_MATRIX.md` si cambio la implementacion real.
7. No crear una auditoria por cada tarea.
8. Crear auditoria solo al cerrar una release.
