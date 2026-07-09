---
release: ACS-R1-04
title: Customer Identity Resolution + Onboarding
doc_id: release-acs-r1-04-customer-identity-onboarding
status: active
updated_at: 2026-07-08
current_task: ACS-R1-04-T04
next_task: ACS-R1-04-T05
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
| ACS-R1-04-T02 | Implementar resolucion por `wa_id` y telefono normalizado | done | ACS-R1-04-T01 | [lib/domains/customer-identity](../../lib/domains/customer-identity), [tests/domains/customerIdentity.test.ts](../../tests/domains/customerIdentity.test.ts) |
| ACS-R1-04-T02.1 | Corregir clasificacion de input y resolucion telefonica canonica | done | ACS-R1-04-T02 | [lib/domains/customer-identity](../../lib/domains/customer-identity), [lib/integrations/customer-external-identity/repository.ts](../../lib/integrations/customer-external-identity/repository.ts), [tests/domains/customerIdentity.test.ts](../../tests/domains/customerIdentity.test.ts) |
| ACS-R1-04-T03 | Persistir onboarding multi-turno | done | ACS-R1-04-T02.1 | [lib/domains/customer-onboarding](../../lib/domains/customer-onboarding), [migrations/023_crm_customer_onboarding_state.sql](../../migrations/023_crm_customer_onboarding_state.sql), [tests/domains/customerOnboarding.test.ts](../../tests/domains/customerOnboarding.test.ts) |
| ACS-R1-04-T04 | Definir reglas de creacion y vinculacion canonica | in_progress | ACS-R1-04-T03 | pending |
| ACS-R1-04-T05 | Incorporar Customer 360 al contexto autonomo | ready | ACS-R1-04-T04 | pending |
| ACS-R1-04-T06 | Conectar identidad y onboarding al inbound nativo | ready | ACS-R1-04-T05 | pending |
| ACS-R1-04-T07 | Persistir executions, outcomes y advertencias | ready | ACS-R1-04-T06 | pending |
| ACS-R1-04-T08 | Ejecutar pruebas end-to-end: nuevo, antiguo y conflicto | ready | ACS-R1-04-T07 | pending |
| ACS-R1-04-T09 | Auditoria de aceptacion y cierre | ready | ACS-R1-04-T08 | pending |

## Tarea actual

`ACS-R1-04-T04`

## Definition of Done de la tarea actual

Ver contrato canonico: [customer-onboarding-identity-contract.md, seccion 6 - Separacion de operaciones](../data/customer-onboarding-identity-contract.md#6-separacion-de-operaciones). `ACS-R1-04-T04` debe definir las reglas canonicas de `create_customer` y `link_external_identity` (cuando se ejecutan, que datos minimos exigen, como evitan duplicados y fusiones automaticas) sin inventar reglas fuera de lo que el contrato ya establece en las secciones 5-7.

## Siguiente tarea

`ACS-R1-04-T05`

## Bloqueos

- Ninguno documentado en este momento.

## Deudas fuera del incremento

- `ACS-R1-01` conserva deuda de hardening del capability gateway.
- `ACS-R1-03` conserva deuda de acceptance formal y cierre de auditoria.
- Address Book, Quote, Policy, Shipping, Checkout y Voice quedan fuera de este incremento.
- `ACS-R1-04-T02.1` corrigio el alcance de `CustomerIdentityResolutionService`: la resolucion por `wa_id` (`provider + external_id` exacto) sigue scoped a `provider = channel`; la resolucion por telefono ahora busca en `customer_external_identity` **sin** filtrar por provider (telefono historico registrado por cualquier canal), via `findDistinctCustomersByNormalizedValueAcrossProviders`. Fuentes de telefono revisadas y descartadas conscientemente: `customer_addresses.recipient_phone` (es contacto de despacho, no identidad verificada del titular) y `ps_customer` de Prestashop (no existe bridge verificado entre `ps_customer.id_customer` y `master_customer.id` en este repo - ningun writer crea filas `customer_external_identity` con `provider = 'prestashop'`). Un input invalido ahora es `invalid_input`, distinto de `identification_required`. Sigue sin estar conectado al inbound nativo, al Gateway ni a Customer 360 (eso es T04-T06).
- `ACS-R1-04-T03` agrego `crm_customer_onboarding_state` (migration 023) y el dominio `lib/domains/customer-onboarding` como persistencia canonica de `CustomerOnboardingState` (contrato seccion 11), con maquina de estados, normalizacion y optimistic locking por `version`. La tabla legacy `crm_customer_onboarding` (P1M/local-ai-sdr, migration 007) se revisó y se descarto como fuente canonica: usa `conversation_case_id` (no `conversation.id`), un enum de estado distinto, no tiene `version`, y persiste campos que el contrato prohibe aqui (email/nombre como columnas planas, `last_response_text`, `context_json`). Se dejo intacta, sin dual-write ni fallback. T03 no conecta el dominio al inbound, al LLM, al Gateway, a Customer 360 ni a operaciones de escritura sobre customers (eso sigue siendo T04-T06); no expone un `saveAnyState` generico, solo las transiciones explicitas del contrato.
- Deuda de entorno descubierta (no introducida) durante T03: la base de datos de desarrollo local (`main_management`, contenedor `crm-customer-360-mariadb`) tiene `schema_migrations` detenido en `011_commercial_event.sql` por un checksum desalineado (el archivo aplicado originalmente no coincide byte a byte con `migrations/011_commercial_event.sql` actual, aunque la tabla `commercial_event` sí existe). Esto bloquea `npm run db:migrate -- --database=dev` para toda migracion 012+ y deja sin aplicar las migraciones 013-022 (`crm_action_executions`, `crm_conversation_requests`, `crm_turn_plans`, `crm_request_facts`, `customer_addresses`, `crm_request_escalations`, `crm_quotes`, `crm_capability_executions`), lo que hace fallar ~82 tests preexistentes no relacionados con T03 (`tests/commercial/*`, `tests/domains/customerAddresses.test.ts`, etc.) en este entorno. La migracion 023 de T03 se aplico de forma directa e idempotente (`CREATE TABLE IF NOT EXISTS`, sin dependencia de 012-022) para no quedar bloqueada por este problema preexistente; no se toco `schema_migrations` ni la migracion 011. Requiere resolucion aparte (fuera de alcance de T03).

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
