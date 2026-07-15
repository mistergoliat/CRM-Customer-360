---
release: ACS-R1-04
title: Customer Identity Resolution + Onboarding
status: active_blocked_external
updated_at: 2026-07-15
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
  - ./releases/ACS-R1-05-autonomous-follow-up-runtime.md
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

## Dependencias externas en pausa

Fuente normativa: [ROADMAP](ROADMAP.md#dependencias-externas-y-capacidades-en-pausa). Resumen: Customer Service `PAUSED_EXTERNAL` (motivo ya descrito en el bloqueo de arriba); Address Book y Voice `DEFERRED`.

## Workstream paralelo autorizado

- `ACS-R1-05` - Autonomous Follow-up Runtime
- current task: `ACS-R1-05-T05`
- status: `parallel_in_progress`

Este workstream:

- no cierra `ACS-R1-04`;
- no altera el bloqueo de `ACS-R1-04-T08`;
- no activa `ACS-R1-04-T09`;
- puede avanzar porque no depende del Customer Service externo (`PAUSED_EXTERNAL`).

`ACS-R1-05-T01` (cerrada, commit `d3b07ca`; primer intento `ef9c5ca` fue rechazado por semantica incorrecta de historial/intentos/idempotencia) consolido `sales-consultative/repository.ts` sobre `follow-up-planner/planFollowUp.ts` como unica fuente de calculo de `attemptNumber`/`maxAttempts`/`scheduledFor` para filas `schedule_followup` (antes hardcodeadas `1`/`1`/`"allowed"`). El historial durable (`loadFollowUpActionHistory`) queda escopado estrictamente por `opportunity_id` cuando existe (nunca cae a `wa_id` compartido entre oportunidades distintas), o por `conversation_case_id` exacto cuando no; solo estados explicitos (`planned`/`requires_review`/`executing`) cuentan como activos, y solo `executing`/`executed`/`failed` consumen un intento comercial (`rejected`/`blocked`/`cancelled`/`expired` no agotan `maxAttempts`). Un retry exacto (mismo `planId`/`intent`/`attemptNumber`) reutiliza la fila activa; un plan distinto mientras una fila sigue activa devuelve `active_followup_exists` sin sobrescribir (T01 no implementa supersession); sin fila activa, un intento terminal habilita el siguiente legitimo. `policy_status` y `action.status` son mapeos independientes de `plan.status` (nunca se persiste crudo), y `maxAttempts` viene de una constante canonica nombrada (`COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS`). Otros tipos de accion (`send_whatsapp_reply`, `prepare_quote_draft`, `take_over_case`, `pause_ai`, `mark_lost_candidate`, `create_internal_task`) conservan exactamente su persistencia previa. Probado con MariaDB real contra `crm_test` (`tests/commercial/salesConsultativeFollowUpRepository.test.ts`, 19/19) mas tests puros de planner/adapter (`followUpPlanAdapter.test.ts` 12/12, `followUpPlanner.test.ts` +1 regresion). Detalle completo, incluidos dos bugs pre-existentes de escritura real corregidos de paso, en la seccion "Evidencia de cierre" de la release spec.

`ACS-R1-05-T02` (cerrada) conecto `policy/evaluateCommercialPolicy.ts` como `follow_up_dispatch_policy` - un gate obligatorio, no un shadow-advisory, justo antes del `INSERT INTO crm_agent_actions` dentro de `upsertFollowUpActionRow` (`sales-consultative/repository.ts`). El adapter nuevo (`sales-consultative/followUpDispatchPolicy.ts`) llama al boundary puro de politica con un `SalesAgentResult` vacio (sin claims/actions/toolRequests/entityProposals) para ejercitar unicamente su gate de canal, sin copiar ninguna de sus reglas de bloqueo. Fuentes reales, nunca texto libre ni la timezone del servidor: `optOut` desde `crm_opportunities.signals_json` (estructurado, hoy siempre vacio - no existe aun una capa de opt-out capture en el repo, y T02 no la agrega); `quietHoursActive` desde hora+timezone explicitos (`America/Santiago`, ventana 21:00-09:00, constante nueva ya que el contrato no fijaba una); `humanOwnerActive`/`aiBlocked` desde `conversation.human_owner_active`/`conversation.ai_enabled` como dos senales independientes (nunca combinadas, para que "dueno humano activo sin IA deshabilitada" siga siendo revisable y no un bloqueo duro); `identityConflict` desde `crm_customer_onboarding_state.status = 'conflict'` (el estado nativo real de ACS-R1-04, nunca el `resolver_identity` legacy del shadow). Un `conversationId` sin fila real degrada a "sin senal adicional" (invariante T01 de fallback seguro preservado); solo una excepcion tecnica real de la fuente de senales falla cerrado. Mapeo: `allow` conserva `planned`/`requires_review` calculados por el plan; `require_review` fuerza `requires_review` aunque el plan proponga `planned` (nunca degradado a `planned` - cubre quiet hours y human-owner-active); `deny`/`failed_safe` no insertan fila (mismo patron `follow_up_plan_not_persisted:<status>` de T01, ahora `follow_up_dispatch_deny:<reasonCode>`/`follow_up_dispatch_failed_safe:<reasonCode>`). Gated por `BRAIN_COMMERCIAL_POLICY_ENABLED` (mecanismo tipado `readEnvFlag` existente, ya documentado en `.env.example`), nunca por flags `BRAIN_COMMERCIAL_SHADOW_*`; deshabilitada, el write falla cerrado (nunca `allowed` por defecto). Solo codigos de razon cortos y fijos se persisten en `policy_notes_json` (nunca el `CommercialPolicyResult` completo, PII ni texto libre del cliente). Los 19 tests de T01.1 siguen en verde sin cambiar sus aserciones (solo se fijo un `currentTime` deterministico para evitar flakiness por quiet hours, y se activo `BRAIN_COMMERCIAL_POLICY_ENABLED=true` en el harness). Probado con 14 tests puros nuevos (`tests/commercial/followUpDispatchPolicy.test.ts`) y 11 tests nuevos con MariaDB real contra `crm_test` (`salesConsultativeFollowUpRepository.test.ts`, `[T02-1]`..`[T02-10]`). Detalle completo en la seccion "Evidencia de cierre - ACS-R1-05-T02" de la release spec.

`ACS-R1-05-T03` (cerrada; primer intento `6558f29` corregido por `ACS-R1-05-T03.1` `59a536c`, y por `ACS-R1-05-T03.2` `af0718f`) endurecio el runtime canonico de follow-up (`sales-consultative` -> `crm_agent_actions` -> `runFollowupTick` -> `runNativeAutonomousCycle`) sin tocar el planner T01 ni la dispatch policy T02. `selectDueFollowUps` selecciona tres grupos disjuntos de candidatas: `planned` due; **toda** fila `executing` con lock vencido (`updated_at` mas antiguo que `FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS = 300`, constante en `followUpWorkerPolicy.ts`), con o sin intentos restantes; y `failed` con `attempt_number < max_attempts`. Recuperar una fila `executing` stale con intentos restantes **incrementa `attempt_number` exactamente una vez** dentro del propio `UPDATE` que gana el CAS (`claimStaleExecutingFollowUp`) - es un intento comercial nuevo, no la continuacion silenciosa del anterior; una fila `executing` stale que ya agoto `max_attempts` nunca se reclama, se **terminaliza** a `failed` con `failure_reason = 'follow_up_stale_execution_exhausted'` (`terminalizeExhaustedStaleFollowUp`, CAS idempotente, sin `cycleRunner`, sin nueva fila, sin incrementar intentos). `claimFailedFollowUpRetry` sigue incrementando `attempt_number` exactamente una vez. La revalidacion del estado comercial (`shouldCancelFollowUp`) ahora corre **siempre despues del claim**, de forma identica para los tres origenes (`planned`, `failed`, `executing` recuperado) - el primer intento (`6558f29`) revalidaba antes del claim para `planned`/`failed`, dejando una ventana donde el estado pudo cambiar entre la revalidacion y el claim; la correccion cierra esa ventana reclamando primero y revalidando sobre la fila ya propia. `cancelFollowUp` (`status IN ('planned', 'failed')`, retorna `{cancelled: boolean}`, P1-1) ya no se llama desde el bucle del worker - queda como punto de entrada externo, probado directamente; el worker aborta una fila ya reclamada exclusivamente via `abortClaimedFollowUp` (`status = 'executing'`). `ACS-R1-05-T03.2` corrigio ademas una mezcla de fuente horaria en los tres CAS de staleness (seleccion de `executing`, recuperacion, terminalizacion): escribian `updated_at = CURRENT_TIMESTAMP(3)` (reloj de sesion) pero calculaban el cutoff con `UTC_TIMESTAMP()` (reloj siempre-UTC) - dependian por accidente de que la sesion MariaDB corriera en UTC. Las tres consultas ahora usan `CURRENT_TIMESTAMP(3)` en ambos lados; verificado con un test que fuerza `SET time_zone = '-04:00'` en una conexion dedicada (`withConnection`) y confirma la semantica completa (reciente no se reclama, stale se recupera, intento incrementado exactamente una vez, agotada se terminaliza, recien reclamada no vuelve a verse stale) sobre esa misma sesion, restaurando la zona horaria antes de liberar la conexion. Probado con 31/31 tests en `tests/commercial/runFollowupTick.test.ts` contra MariaDB real (`main_management`, incluye el hook de sincronizacion explicita `onAfterClaim` para probar la ventana de revalidacion sin sleeps y el test de sesion no-UTC), mas 75/75 combinados con los tests de T01/T02 sin modificar sus aserciones, mas 106/106 en regresion adicional y el escenario E del harness E2E en `PASS`. Detalle completo, incluida la evidencia de concurrencia CAS para recuperacion y terminalizacion, en la seccion "Evidencia de cierre - ACS-R1-05-T03" de la release spec.

`ACS-R1-05-T04` (cerrada) consolido los dos escritores divergentes de `brain_message_outbox` (`outbox.ts`'s `createOutboxPlannedRecord` y `execution-gate/sqlExecutionUnitOfWork.ts`'s `SqlOutboxRepository.insertCommand`) en un unico writer canonico (`lib/brain/messaging/canonicalOutboxWriter.ts`) con una sola sentencia `INSERT IGNORE`, una sola normalizacion de columnas y una sola resolucion de `phone_number_id` (explicito -> `conversation.channel_account_id` -> fallback de configuracion) - verificado por `rg` (una unica coincidencia productiva de `INSERT` sobre la tabla). Extendio `applyMetaDeliveryStatus` (`native-whatsapp/service.ts`) para que los delivery outcomes lleguen hasta `crm_opportunities` (antes un dead-end en `crm_action_outcomes`/`brain_message_outbox`): la oportunidad se resuelve por `meta_payload_json.opportunity_id` del outbox o, en su defecto, por `crm_agent_actions.opportunity_id` - nunca por "la oportunidad activa actual de la conversacion" - y se proyecta mediante un CAS que nunca deja que un webhook de un mensaje outbound viejo sobrescriba la proyeccion de uno mas nuevo, sin tocar `status`/`stage`/`temperature`/`next_action_type` (migracion 025, cuatro columnas nuevas en `crm_opportunities`). Anadio idempotencia real a `crm_action_outcomes` via `outcome_dedupe_key` (`sha256("delivery|meta|<provider_message_id>|<outcome_type>")`, migracion 025) compartida entre el camino de exito HTTP y el webhook - un evento duplicado o concurrente deja exactamente una fila, verificado con MariaDB real. El registro del outcome dejo de estar condicionado a que la proyeccion avance (historial append-only genuino) y la falla real de persistencia del outcome ya no se silencia con `.catch(() => void 0)`. Se agrego trazabilidad opcional de atribucion A/B (`experiment_id`/`variant_id`/`template_id`/`prompt_version`/`content_hash`) desde el writer hasta `crm_action_outcomes.metadata_json`, sin asignador de variantes ni calculo estadistico. Probado con 26 tests nuevos con MariaDB real (`tests/commercial/canonicalOutboxWriter.test.ts`, `tests/commercial/deliveryOutcomeProjection.test.ts`) mas 282/282 en regresion combinada (T01/T02/T03, execution gate, sales-consultative, action queue, outbox worker simulador); `npm run e2e:autonomous` comparado explicitamente contra el mismo commit base sin los cambios de T04 (via `git stash`) resulto identico en ambos casos (`PASS:8, PARTIAL:1, FAIL:1`), confirmando que ningun fallo del harness es atribuible a T04. No reabrio el hardening del worker cerrado en T03; no toco `ACS-R1-04`; el runtime de follow-up sigue sin `operational: verified`. Detalle completo en la seccion "Evidencia de cierre - ACS-R1-05-T04" de la release spec.

Detalle de alcance, tareas y Definition of Done: [ACS-R1-05 - Autonomous Follow-up Runtime](releases/ACS-R1-05-autonomous-follow-up-runtime.md). Estado tecnico real del runtime (que existe, que esta conectado, gaps): [Follow-up runtime reconciliation](audits/follow-up-runtime-reconciliation.md).

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
- [Follow-up runtime reconciliation](audits/follow-up-runtime-reconciliation.md)

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
