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
| ACS-R1-04-T03.1 | Validar migracion canonica y preservar invariantes de persistencia | done | ACS-R1-04-T03 | [migrations/023_crm_customer_onboarding_state.sql](../../migrations/023_crm_customer_onboarding_state.sql), [tests/domains/customerOnboarding.test.ts](../../tests/domains/customerOnboarding.test.ts) (tests 10-11) |
| ACS-R1-04-T04 | Definir reglas de creacion y vinculacion canonica | in_progress | ACS-R1-04-T03.1 | pending |
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
- `ACS-R1-04-T03` agrego `crm_customer_onboarding_state` (migration 023) y el dominio `lib/domains/customer-onboarding` como persistencia canonica de `CustomerOnboardingState` (contrato seccion 11), con maquina de estados, normalizacion y optimistic locking por `version`. El contrato **si** permite persistir `firstName`, `lastName`, `email` y `orderReference` - son exactamente los campos de `CustomerOnboardingCollectedData` (seccion 11) - y esta tabla los guarda dentro de `collected_json`, tal como el dominio los normaliza (`lib/domains/customer-onboarding/service.ts`). La tabla legacy `crm_customer_onboarding` (P1M/local-ai-sdr, migration 007) se revisó y se descarto como fuente canonica por incompatibilidades reales: usa `conversation_case_id` (no `conversation.id`), un enum de estado incompatible, no tiene `purpose`, no tiene `version` para optimistic locking, y ademas de exponer `firstname`/`lastname`/`email` como columnas planas de nivel superior (en vez de `collected_json`), persiste `last_response_text`, `context_json` y `warnings_json` - datos que el contrato si prohibe en esta tabla (mensajes, prompts, payloads arbitrarios; seccion 12). Se dejo intacta, sin dual-write ni fallback. T03 no conecta el dominio al inbound, al LLM, al Gateway, a Customer 360 ni a operaciones de escritura sobre customers (eso sigue siendo T04-T06); no expone un `saveAnyState` generico, solo las transiciones explicitas del contrato.
- `ACS-R1-04-T03.1` corrigio la FK de `customer_id` en `crm_customer_onboarding_state` de `ON DELETE SET NULL` a `ON DELETE RESTRICT`: la invariante de `completed` (contrato seccion 11 y 14) exige un `customerId` valido, y `SET NULL` permitia que borrar el `master_customer` referenciado dejara una fila `completed` con `customer_id = NULL`, violando esa invariante silenciosamente. Confirmado con un test DB-backed que demuestra que el `DELETE` es rechazado (`tests/domains/customerOnboarding.test.ts`, "integration 10"). Tambien se intento un `CHECK (status <> 'completed' OR customer_id IS NOT NULL)`, pero MariaDB 11.4 lo rechaza con error 1901 ("Function or expression 'customer_id' cannot be used in the CHECK clause") porque `customer_id` ya participa en un FOREIGN KEY - confirmado por reproduccion directa (un CHECK aislado sobre esa columna funciona; agregar el FK, en el mismo `CREATE TABLE` o en un `ALTER TABLE` posterior, hace fallar el mismo CHECK). La invariante queda protegida por el FK (`RESTRICT`, arriba) mas la capa de dominio (`completeOnboarding` en `lib/domains/customer-onboarding/service.ts` es el unico camino que fija `status = 'completed'` y exige `customerId` no vacio). Detalle completo en el comentario de cabecera de [migrations/023_crm_customer_onboarding_state.sql](../../migrations/023_crm_customer_onboarding_state.sql).
- `ACS-R1-04-T03.1` valido la cadena canonica `001 -> 023` completa desde una base MariaDB 11.4 genuinamente vacia (contenedor Docker nuevo, sin volumen previo, inicializado con `infra/mariadb/init/*` sin modificar). Hallazgo: el comando documentado `npm run db:migrate -- --database=dev`, ejecutado tal cual contra esa base vacia, **falla** en el primer `CREATE TABLE IF NOT EXISTS schema_migrations` con `CREATE command denied to user 'crm_app'`. La causa no es el SQL de ninguna migracion (011 incluida): es un bug de precedencia de alias en `lib/database-config.ts` (`resolveWithAlias`), que arma la lista de candidatos como `[...aliases, key]` y por lo tanto revisa el alias generico (`DB_USER`) *antes* que la clave especifica (`MIGRATION_DATABASE_USER`); como `infra/.env` define ambos, `DB_USER=crm_app` (solo DML) siempre gana sobre `MIGRATION_DATABASE_USER=crm_dev_admin` (con DDL) para las conexiones `migration`/`test`/`legacy`. Confirmado con un diagnostico directo (`resolveNamedDatabaseConnection("migration")` devuelve `user: "crm_app"` pese a que `process.env.MIGRATION_DATABASE_USER` es `crm_dev_admin`). Esto solo se manifiesta contra una base realmente nueva: el contenedor de desarrollo compartido (`crm-customer-360-mariadb`) tenia un grant de `crm_app` sobre `main_management` mas amplio que el que otorgan hoy los scripts de init (heredado de una version anterior, ya que `docker-entrypoint-initdb.d` solo corre una vez), lo que enmascaraba el bug. Usando las credenciales correctas (sin modificar ninguna migracion ni el runner - solo un script de diagnostico desechable que invoca la misma logica de aplicacion/checksum con credenciales explicitas), la cadena `001 -> 023` completa (22 archivos; no existe `012`) aplica en orden, sin conflictos de checksum, crea `crm_customer_onboarding_state` con sus FKs/indices/unique esperados, y una repeticion de la corrida resulta en `[skip]` para los 22 archivos. La suite completa corrida contra esa base recien migrada paso **799/800** (unico fallo: `tests/commercial/capabilityGateway.test.ts`, "search_products executes over HTTP...", que referencia IDs de fixture hardcodeados (`opportunityId: 7`) inexistentes en una base sin seed - no relacionado con el dominio de onboarding ni con ninguna migracion de este release). El contenedor de desarrollo compartido se dejo exactamente como estaba (se detuvo y se reinicio sin tocar su volumen); sigue con `schema_migrations` detenido en `011_commercial_event.sql` por el mismo problema de base contaminada documentado originalmente en T03. Fix sugerido (no aplicado, fuera de alcance de T03.1): en `resolveWithAlias` (`lib/database-config.ts`), revisar `key` antes que `aliases` (candidatos `[key, ...aliases]`), para que las claves especificas (`MIGRATION_DATABASE_USER`, `TEST_DATABASE_USER`, etc.) tengan precedencia sobre los alias genericos (`DB_USER`) en vez de ser eclipsadas por ellos.

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
