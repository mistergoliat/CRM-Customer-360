---
release: ACS-R1-04
title: Customer Identity Resolution + Onboarding
status: active
updated_at: 2026-07-09
current_task: ACS-R1-04-T06
next_task: ACS-R1-04-T07
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
| ACS-R1-04-T03.1 | Validar migracion canonica y preservar invariantes de persistencia | done | ACS-R1-04-T03 | [migrations/023_crm_customer_onboarding_state.sql](../migrations/023_crm_customer_onboarding_state.sql), [tests/domains/customerOnboarding.test.ts](../tests/domains/customerOnboarding.test.ts) (tests 10-11) |
| ACS-R1-04-T04 | Definir reglas de creacion y vinculacion canonica | done | ACS-R1-04-T03.1 | [customer-creation-linking-authority-contract](data/customer-creation-linking-authority-contract.md) |
| ACS-R1-04-T04.1 | Implementar Customer Service Port y politicas de creacion/vinculacion | done | ACS-R1-04-T04 | [lib/domains/customer-service](../lib/domains/customer-service), [lib/integrations/customer-service/http-adapter.ts](../lib/integrations/customer-service/http-adapter.ts), [tests/domains/customerService.test.ts](../tests/domains/customerService.test.ts), [tests/integrations/customerServiceHttpAdapter.test.ts](../tests/integrations/customerServiceHttpAdapter.test.ts) |
| ACS-R1-04-T05 | Incorporar Customer 360 al contexto autonomo | done | ACS-R1-04-T04.1 | [lib/brain/commercial/context/autonomousCustomerContext.ts](../lib/brain/commercial/context/autonomousCustomerContext.ts), [lib/brain/commercial/context/loadAutonomousCustomerContext.ts](../lib/brain/commercial/context/loadAutonomousCustomerContext.ts), [lib/domains/customer-360/service.ts](../lib/domains/customer-360/service.ts) (`loadByCustomerId`), [tests/commercial/autonomousCustomerContext.test.ts](../tests/commercial/autonomousCustomerContext.test.ts), [tests/commercial/loadAutonomousCustomerContext.test.ts](../tests/commercial/loadAutonomousCustomerContext.test.ts), [tests/commercial/runNativeAutonomousCycleCustomer360.test.ts](../tests/commercial/runNativeAutonomousCycleCustomer360.test.ts), [tests/commercial/multiRequestCustomer360.test.ts](../tests/commercial/multiRequestCustomer360.test.ts), [tests/commercial/customer360AutonomousBoundary.test.ts](../tests/commercial/customer360AutonomousBoundary.test.ts) |
| ACS-R1-04-T06 | Conectar identidad y onboarding al inbound nativo | in_progress | ACS-R1-04-T05 | pending |
| ACS-R1-04-T07 | Persistir executions, outcomes y advertencias | ready | ACS-R1-04-T06 | pending |
| ACS-R1-04-T08 | Ejecutar pruebas end-to-end: nuevo, antiguo y conflicto | ready | ACS-R1-04-T07 | pending |
| ACS-R1-04-T09 | Auditoria de aceptacion y cierre | ready | ACS-R1-04-T08 | pending |

## Tarea actual

`ACS-R1-04-T06`

## Definition of Done de la tarea actual

Ver [releases/ACS-R1-04-customer-identity-onboarding.md](releases/ACS-R1-04-customer-identity-onboarding.md#definition-of-done-de-la-tarea-actual).

## Siguiente tarea

`ACS-R1-04-T07`

## Bloqueos

- Ninguno documentado en este momento.

## Deudas fuera del incremento

- `ACS-R1-01` — hardening del capability gateway (`ACS-R1-01.1`) completado: retry unico en el HTTP adapter (el gateway es el unico propietario del retry), flags productivas documentadas (incl. la contradiccion de `BRAIN_SALES_AGENT_DRY_RUN`), aprobacion derivada de metadata de la capability en vez de `blocking` reportado por el LLM, nombres canonicos snake_case centralizados en un solo alias table, etapa de ejecucion generica (`runCapabilityExecutionStage`), seleccion de producto por ranker deterministico auditado, smoke test real y prueba integrada multi-turno. Ver `docs/audits/acs-r1-01-1-capability-gateway-hardening-evidence.md`. Deuda restante: `propose_followup` no esta conectado al scheduling real de follow-ups (due_at/worker); el registry de capabilities de multi-request aun lee PrestaShop por SQL directo (no este Catalog Port); `denied` no dispara escalamiento formal todavia.
- `ACS-R1-03` conserva deuda de acceptance formal y cierre de auditoria.
- Address Book, Quote, Policy, Shipping, Checkout y Voice quedan fuera de este incremento.
- `ACS-R1-04-T02.1` corrigio el alcance de `CustomerIdentityResolutionService`: `wa_id` sigue scoped a `provider = channel` (exacto); el telefono ahora busca en `customer_external_identity` sin filtrar por provider (telefono historico de cualquier canal), via `findDistinctCustomersByNormalizedValueAcrossProviders`. `customer_addresses.recipient_phone` y `ps_customer` (Prestashop) fueron revisados y descartados: el primero es contacto de despacho, no identidad verificada; el segundo no tiene bridge verificado hacia `master_customer.id`. Un input invalido ahora es `invalid_input`, distinto de `identification_required`. Sigue sin estar conectado al inbound nativo, al Gateway ni a Customer 360 (eso es T04-T06).
- `ACS-R1-04-T03` agrego `crm_customer_onboarding_state` (migration 023) y `lib/domains/customer-onboarding` como persistencia canonica de `CustomerOnboardingState`. El contrato si permite `firstName`/`lastName`/`email`/`orderReference` dentro de `collected_json` (seccion 11); la tabla legacy `crm_customer_onboarding` (P1M) se descarto como fuente canonica por clave, enum de estado y `purpose`/`version` incompatibles, y por exponer esos mismos campos como columnas planas ademas de `last_response_text`/`context_json`/`warnings_json` (si prohibidos, seccion 12). Quedo intacta, sin dual-write. No conecta inbound, LLM, Gateway, Customer 360 ni escritura de customers (T04-T06). Detalle completo en [releases/ACS-R1-04-customer-identity-onboarding.md](releases/ACS-R1-04-customer-identity-onboarding.md).
- `ACS-R1-04-T03.1` corrigio la FK `customer_id` de `crm_customer_onboarding_state` a `ON DELETE RESTRICT` (antes `SET NULL`), para que borrar un `master_customer` no pueda dejar un onboarding completado con `customer_id = NULL`; probado con un test DB-backed. Un `CHECK` equivalente se intento pero MariaDB 11.4 lo rechaza (error 1901) cuando la columna ya tiene FK propia — confirmado por reproduccion directa, no se agrego. Detalle completo en [releases/ACS-R1-04-customer-identity-onboarding.md](releases/ACS-R1-04-customer-identity-onboarding.md).
- `ACS-R1-04-T03.1` valido la cadena canonica `001→023` desde una base MariaDB 11.4 genuinamente vacia. El comando documentado `npm run db:migrate` falla ahi por un bug de precedencia de alias en `lib/database-config.ts` (`resolveWithAlias` revisa el alias generico `DB_USER` antes que la clave especifica `MIGRATION_DATABASE_USER`, asi que usa `crm_app`, solo DML, en vez de `crm_dev_admin`) — no es un defecto de ninguna migracion. Con las credenciales correctas la cadena completa aplica limpia, en orden, con checksums correctos, y la suite completa paso 799/800 (el unico fallo es un test preexistente no relacionado, con IDs de fixture hardcodeados). Fix de una linea sugerido y no aplicado (fuera de alcance de T03.1); el contenedor de desarrollo compartido se dejo intacto, todavia con `schema_migrations` detenido en `011_commercial_event.sql`. Detalle completo, causa raiz y evidencia en [releases/ACS-R1-04-customer-identity-onboarding.md](releases/ACS-R1-04-customer-identity-onboarding.md).
- `ACS-R1-04-T04` (documental, sin codigo) define [customer-creation-linking-authority-contract](data/customer-creation-linking-authority-contract.md): autoridad de `create_customer`, `link_external_identity` y `record_customer_interest` (inputs/outcomes, datos minimos, idempotencia, deduplicacion, consentimiento, conflictos, fallos del Customer Service). No reduce la autonomia estrategica de la IA — solo separa que decide la IA de que autoridad ejecuta. Implementacion real queda en `ACS-R1-04-T04.1`.
- `ACS-R1-04-T04.1` implemento el `CustomerServicePort` (`lib/domains/customer-service`: `types.ts`, `ports.ts`, `authority-policy.ts`, `service.ts`), el adapter HTTP fail-closed (`lib/integrations/customer-service/http-adapter.ts`, contrato en [customer-service-http-contract](integrations/customer-service-http-contract.md)) y las tres policies puras de autoridad (`evaluateCreateCustomerAuthority`, `evaluateLinkExternalIdentityAuthority`, `evaluateCustomerInterestAuthority`), con 49 tests (31 de policy/service, 18 del adapter HTTP contra un servidor local). El contrato de datos se bump a `1.0.2`: `CreateCustomerResult`/`LinkExternalIdentityResult` ahora declaran `invalid_input`/`failed` explicitamente (antes solo descritos en la seccion de fallos); `resolve_customer` mantiene sus cinco outcomes originales sin `failed`. `CustomerIdentityResolutionService` (T02/T02.1) no se toco, no hay dual-read ni fallback entre ambos. No se conecto el inbound, el LLM, el Capability Gateway, Customer 360 ni se persistio ningun interes (`record_customer_interest` es solo policy + tipos, sin persistencia) — eso sigue en `ACS-R1-04-T05`/`T06`. Ver [docs/capabilities/customer-service-capability.md](capabilities/customer-service-capability.md).
- `ACS-R1-04-T05` incorporo Customer 360 al ciclo autonomo como historia, nunca como resolucion de identidad. `lib/domains/customer-360/service.ts` gano `loadByCustomerId()` (extension aditiva: `Customer360LoadResult` con `found`/`not_found`/`unavailable` — antes `getByCustomerId()` colapsaba ambas fallas en `null`; `getByCustomerId()` sigue igual, delegando al metodo nuevo). `lib/brain/commercial/context/autonomousCustomerContext.ts` proyecta el snapshot completo a `AutonomousCustomerContext` (allowlist campo por campo: perfil minimo, resumen de relacion, hasta 3 oportunidades/perfiles de necesidad/cotizaciones recientes en orden newest-first deterministico, calidad de dato) — nunca email completo, telefono, wa_id, identidades vinculadas, direcciones, referencias de pedido, invoice number, cuerpos de mensaje, draft/final messages, provider ids ni el snapshot completo. `lib/brain/commercial/context/loadAutonomousCustomerContext.ts` es el unico punto de carga: `customerId` nulo son cero llamadas; una excepcion o fuente caida nunca detiene el ciclo (mapea a `unavailable`, nunca expone el mensaje crudo). `runNativeAutonomousCycle` carga Customer 360 una sola vez, antes de bifurcar entre runtimes (multi-request sigue siendo exclusivo del pipeline legacy, nunca ambos en el mismo turno), usando exclusivamente `input.customerMasterId` ya resuelto — sin resolver por `wa_id`, telefono o email. `MultiRequestCycleInput`/`PlanTurnInput`/`TurnPlannerProviderInput` y `CommercialContextSnapshot`/`buildNativeBrainContextShim`/`NormalizedCommercialBrainContext`/`SalesAgentInput` se extendieron de forma tipada y explicita (nunca dentro de `metadata: Record<string, unknown>`) para llevar la proyeccion reducida a ambos runtimes; el contexto entra al `inputHash` del turn plan (sin `lastRefreshedAt` ni timestamps de lectura), preservando que un retry del mismo inbound reutiliza el plan persistido sin invocar el planner de nuevo. 49 tests nuevos (proyector, loader, `Customer360QueryService.loadByCustomerId`, ciclo nativo con DI, multi-request, y boundary estatico/git contra `lib/domains/customer-service` en el SHA `128303c8`). No se conecto el inbound de identidad/onboarding ni el Capability Gateway (eso es `T06`); no se modifico `T04.1`.

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
