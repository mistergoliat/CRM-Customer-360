---
release: ACS-R1-05
title: Autonomous Follow-up Runtime
doc_id: release-acs-r1-05-autonomous-follow-up-runtime
status: parallel_in_progress
updated_at: 2026-07-15
current_task: ACS-R1-05-T02
next_task: ACS-R1-05-T03
blocked: false
owner: product
source_of_truth_for:
  - ACS-R1-05 release scope
  - ACS-R1-05 task queue
  - ACS-R1-05 definition of done
depends_on:
  - ../ACTIVE_RELEASE.md
  - ../ROADMAP.md
  - ../product/MVP_EXECUTION_MAP.md
  - ../audits/follow-up-runtime-reconciliation.md
  - ../product/ai-sdr-follow-up-planner.md
  - ../product/follow-up-decision-policy.md
supersedes: []
tags:
  - release
  - product
---

# ACS-R1-05 - Autonomous Follow-up Runtime

## Estado

`parallel_in_progress`: workstream autorizado a avanzar en paralelo a `ACS-R1-04` porque no depende del Customer Service externo (`PAUSED_EXTERNAL`, ver `ROADMAP.md`). No es una segunda release "activa" en el sentido secuencial de `AGENTS.md` - es una excepcion explicita y acotada al follow-up, documentada aqui y en `ROADMAP.md`/`ACTIVE_RELEASE.md`.

## Objetivo

Consolidar y endurecer el runtime de follow-up ya existente, reutilizando planner, `crm_agent_actions`, worker, ciclo autonomo, outbox y Meta, sin crear un runtime paralelo nuevo.

## Alcance y Definition of Done: derivados de la auditoria

Esta release no redefine hallazgos: el alcance completo, la matriz de clasificacion de componentes, la ruta canonica reconstruida, las hipotesis verificadas (persistencia incompleta, worker, contact policy, cancelacion, outbox/envio, shadow flags, seguridad, idempotencia) y los gaps priorizados (P0-P3) viven en [Follow-up runtime reconciliation](../audits/follow-up-runtime-reconciliation.md) - unica fuente de esa evidencia. Cada tarea de esta release cierra exactamente uno o mas gaps de esa auditoria; ninguna tarea puede reabrir alcance que la auditoria no encontro.

## No objetivos

- Construir un runtime de follow-up paralelo o alternativo al ya conectado (`sales-consultative` -> `crm_agent_actions` -> `autonomous-followup-worker` -> `runNativeAutonomousCycle` -> outbox -> Meta).
- Marketing automation, campanas o contacto masivo (eso es `marketing_contact_policy`, fuera de esta release).
- Address Book, Quote, Shipping, Checkout, Voice.
- Declarar follow-up `operational: verified` en `CAPABILITY_MATRIX.md`.
- Cerrar o desbloquear `ACS-R1-04`.

## Required reading

- [Follow-up runtime reconciliation](../audits/follow-up-runtime-reconciliation.md)
- [ROADMAP](../ROADMAP.md)
- [MVP execution map](../product/MVP_EXECUTION_MAP.md)
- [ACTIVE_RELEASE](../ACTIVE_RELEASE.md)
- [AI SDR follow-up planner](../product/ai-sdr-follow-up-planner.md)
- [Follow-up decision policy](../product/follow-up-decision-policy.md)
- [AI SDR agent action queue](../product/ai-sdr-agent-action-queue.md)
- [AI SDR action lifecycle contract](../product/ai-sdr-action-lifecycle-contract.md)

## Tareas

| ID | Tarea | Estado | Dependencias | Gap(s) de la auditoria que cierra |
| -- | ----- | ------ | ------------ | ---------------------------------- |
| ACS-R1-05-T01 | Consolidar planner y persistencia | done | [Follow-up runtime reconciliation](../audits/follow-up-runtime-reconciliation.md) | P0-1 (hardcodes `attempt_number`/`max_attempts`/`policy_status`, idempotency key sin scope temporal); consolida `follow-up-planner/planFollowUp.ts` como fuente de calculo para `sales-consultative/repository.ts` |
| ACS-R1-05-T02 | Aplicar follow-up dispatch policy | in_progress | ACS-R1-05-T01 | P0-4 (opt-out/quiet-hours/identity-conflict shadow-only, nunca gatean el write real); conecta `follow_up_dispatch_policy` (`evaluateCommercialPolicy`) como gate obligatorio antes de `upsertActionRow` |
| ACS-R1-05-T03 | Hardening del worker | ready | ACS-R1-05-T01 | P0-2 (sin stale-lock recovery), P0-3 (sin retry/enforcement de `max_attempts`), P1-1 (`cancelFollowUp` sin precondicion de status) |
| ACS-R1-05-T04 | Consolidar outbox y delivery outcomes | ready | ACS-R1-05-T01 | P1-3 (delivery outcomes no llegan a `crm_opportunities`), P1-4 (dos escritores divergentes de `brain_message_outbox`) |
| ACS-R1-05-T05 | Aislar runtimes paralelos o muertos | ready | ACS-R1-05-T01 | P2-1 (5 planners paralelos), P2-2 (`multi-request/requestFollowups.ts` muerto), P2-5 (modulo `outbox-worker/` hyphenated duplicado) |
| ACS-R1-05-T06 | Seguridad y configuracion operacional | ready | ACS-R1-05-T01 | P1-2 (`failure_reason` sin redactar), P1-5 (flags auto-escalados en silencio por los dos workers) |
| ACS-R1-05-T07 | E2E productivo y restart recovery | ready | ACS-R1-05-T01 a T06 | Cierra la release: verifica end-to-end (patron del harness existente de identity onboarding) que el runtime consolidado sostiene reinicio/retry sin duplicar ni perder envios |

## Tarea actual

`ACS-R1-05-T02`

## Definition of Done de la tarea actual

`ACS-R1-05-T02` debe conectar `policy/evaluateCommercialPolicy.ts` (`follow_up_dispatch_policy`: opt-out, quiet hours, identity conflict) como gate obligatorio antes de que `upsertFollowUpActionRow` (`sales-consultative/repository.ts`) persista una fila `schedule_followup` ejecutable (`planned`/`requires_review`) - hoy esa evaluacion corre solo en shadow mode (`runCommercialShadowEvaluation`) y nunca gatea el write real (P0-4). Un cliente con opt-out activo o dentro de quiet hours no debe recibir una fila `schedule_followup` persistida como ejecutable.

## Siguiente tarea

`ACS-R1-05-T03` (`ready`, no iniciada - depende de que T02 conecte primero el policy gate que T03 debe respetar al endurecer el worker)

## Evidencia de cierre - ACS-R1-05-T01

Primer cierre (SHA `ef9c5ca`/`f8c17fe`) fue rechazado por semantica incorrecta de historial, intentos e idempotencia. `ACS-R1-05-T01.1` (SHA funcional `d3b07ca`) corrige los cinco defectos encontrados en la revision antes de aceptar la tarea. Estado final: `done`.

- Estado: `done`.
- SHA funcional: `d3b07ca` (correccion; `ef9c5ca` fue el primer intento, rechazado). Rama `acs-r1-05-t01-followup-planner-persistence`.
- Archivos funcionales: `lib/brain/commercial/follow-up-planner/constants.ts` (nueva constante canonica `COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS`), `lib/brain/commercial/follow-up-planner/planFollowUp.ts` (`buildSignature` ya no incluye `scheduledFor`), `lib/brain/commercial/sales-consultative/followUpPlanAdapter.ts` (adapter puro de contexto + clasificacion explicita de estados + mapeos separados), `lib/brain/commercial/sales-consultative/repository.ts` (scope estricto de historial, tres resultados distintos, mapeo separado de `policy_status`).
- Planner canonico: `follow-up-planner/planFollowUp.ts` (`planCommercialFollowUp`) - unica fuente de calculo de `intent`/`scheduledFor`/`attemptNumber`/`maxAttempts`/`status`/`riskLevel`/`approvalRequirement`/`policyNotes`/`blockReasons`/`idempotencyKey`. Su unico cambio de logica en esta correccion es que `buildSignature`/`finalizePlan` ya no incluyen `scheduledFor` en el hash de `planId`/`idempotencyKey` - `scheduledFor = plusHours(createdAt, defaultDelayHours)` cambiaba en cada llamada por el simple paso del tiempo, haciendo que dos llamadas por el mismo plan logico en momentos distintos nunca coincidieran. `policy.defaultDelayHours` si permanece en la firma: sales-consultative traduce su cadencia (`dueAt`) a ese campo, y una diferencia real de cadencia (24h vs 30h de espera) si distingue dos planes.
- Disparador: `sales-consultative/engine.ts`, sin modificar.
- **Scope del historial** (`loadFollowUpActionHistory`, `repository.ts`): con `opportunity_id` conocido, la consulta se limita exclusivamente a ese `opportunity_id` - nunca cae a `wa_id`. Sin `opportunity_id`, prioriza `conversation_case_id` exacto (`AND opportunity_id IS NULL AND conversation_case_id = ?`); solo usa `wa_id` para filas que tampoco tienen `opportunity_id`. Siempre acotado a `action_type = 'schedule_followup'`. Verificado con una oportunidad A y B compartiendo `wa_id`: el intento consumido de A no afecta el `attemptNumber` calculado para B.
- **Estados activos explicitos** (`FOLLOW_UP_ACTIVE_ACTION_STATUSES`, `followUpPlanAdapter.ts`): unicamente `planned`, `requires_review`, `executing`. Cualquier otro estado (incluido uno desconocido/futuro) degrada de forma segura a "no activo".
- **Estados que consumen intento** (`FOLLOW_UP_ATTEMPT_CONSUMING_STATUSES`): unicamente `executing`, `executed`, `failed`. `rejected`/`blocked`/`cancelled`/`expired` no consumen - un intento nunca real (nunca reclamado por el worker) no agota `maxAttempts`. Formula: `attemptNumber = max(attempt_number de filas consumidoras) + 1`, o `1` si no hay ninguna.
- **Tres resultados distintos** (`upsertFollowUpActionRow`): (1) retry exacto - mismo `planId`, mismo `intent`, mismo `attemptNumber` que la fila activa -> reutiliza esa fila, `existing_action_reused`, sin insertar ni sobrescribir; (2) accion activa distinta - la fila activa existe pero el plan recalculado difiere en `planId`/`intent`/`attemptNumber` -> `active_followup_exists`, sin insertar ni sobrescribir, sin supersession ni cancelacion automatica (fuera de alcance de T01); (3) sin accion activa -> el planner evalua y, si el estado lo permite, persiste el siguiente intento legitimo.
- Idempotencia: `plan.idempotencyKey` sigue siendo la base canonica para la columna `idempotency_key`, ahora genuinamente estable para el mismo plan logico (ver el fix de `buildSignature` arriba). La deteccion de retry exacto vs conflicto usa comparacion semantica explicita (`planId`+`intent`+`attemptNumber`), no solo igualdad de key.
- **`maxAttempts` canonico**: `COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS = 3` (`follow-up-planner/constants.ts`), importado por el adapter, inyectable en tests (`buildFollowUpPlanningInput({ maxAttempts: ... })`). Distinto de `COMMERCIAL_FOLLOW_UP_MAX_ATTEMPT_NUMBER = 999` (techo interno del planner sobre `attemptNumber`, no un default de politica).
- **Mapeo de estado separado**: `plan.status` nunca se persiste crudo como `policy_status`. `recommended -> action.status=planned, policy_status=allowed`; `requires_operator_review -> action.status=requires_review, policy_status=requires_review`; `blocked`/`not_needed`/`cancelled`/`expired`/`invalid` no crean fila ejecutable. Dos funciones independientes y testeadas por separado: `mapFollowUpPlanStatusToActionStatus`, `mapFollowUpPlanStatusToPolicyStatus`.
- Bugs pre-existentes corregidos de paso en el primer cierre (confirmados en `develop` HEAD `bee047a`, invisibles bajo la suite mockeada, no reintroducidos por esta correccion): `INSERT INTO crm_agent_actions` con 39 columnas y solo 38 placeholders `?`; `scheduled_for` recibiendo un ISO string crudo contra una columna `DATETIME`. Ambos con test de regresion dedicado.
- Tests nuevos/corregidos: `tests/commercial/followUpPlanAdapter.test.ts` (12 tests puros, sin DB), `tests/commercial/salesConsultativeFollowUpRepository.test.ts` (19 tests, MariaDB real contra `crm_test`), `tests/commercial/followUpPlanner.test.ts` (+1 test de regresion de estabilidad de `idempotencyKey`/`planId` frente a `now` variable).
- `crm_test` reseteada (drop+recreate solo de esa base, via `connectAsRoot`/`dropDatabase`/`ensureDatabaseExists`) y migrada dos veces: primera corrida desde vacio aplico las 23 migraciones sin conflictos de checksum; segunda corrida, todo `[skip]`.
- No objetivo de T01 tocado en esta correccion: `evaluateCommercialPolicy` sigue sin conectarse como gate (T02); `runFollowupTick.ts`, outbox, Meta sender, `autonomous-loop`, shadow flags y `failure_reason` sanitization no se modificaron; cero tablas o migraciones nuevas.

## Bloqueos

Ninguno propio de esta release. No depende de Customer Service (`PAUSED_EXTERNAL`, ver `ROADMAP.md`) ni de Address Book/Voice (`DEFERRED`). No depende de que `ACS-R1-04-T08`/`T09` cierren.

## Deudas fuera del incremento

- Frequency cap por customer: no existe en ningun path (planner, policy o persistencia). No es alcance de `ACS-R1-05-T01`..`T07`; registrar como tarea futura si el negocio lo requiere.
- `metaSendAdapter.ts` (envio con guards de politica) permanece sin usar por ningun worker productivo (P3-1 de la auditoria); no es bloqueante para esta release.
- El `correlationId` de follow-up no se persiste como columna propia (P3-2); reconstruir la traza sigue requiriendo joins por `decision_id`/`action_id`.
