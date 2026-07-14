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

- Estado: `done`.
- SHA funcional: `ef9c5ca` (rama `acs-r1-05-t01-followup-planner-persistence`).
- Archivos funcionales: `lib/brain/commercial/sales-consultative/followUpPlanAdapter.ts` (nuevo, adapter puro de contexto), `lib/brain/commercial/sales-consultative/repository.ts` (conecta `upsertActionRow` al planner solo para `schedule_followup`; otros tipos de accion sin cambios de comportamiento), `lib/brain/commercial/sales-consultative/index.ts` (export del adapter).
- Planner canonico: `follow-up-planner/planFollowUp.ts` (`planCommercialFollowUp`), sin modificar - es la unica fuente de calculo de `intent`/`scheduledFor`/`attemptNumber`/`maxAttempts`/`status`/`riskLevel`/`approvalRequirement`/`policyNotes`/`blockReasons`/`idempotencyKey`.
- Disparador: `sales-consultative/engine.ts`, sin modificar - sigue siendo quien detecta la senal de follow-up desde el inbound real.
- Historial durable: `loadFollowUpActionHistory` (`repository.ts`) lee `crm_agent_actions` por `opportunity_id` (fallback `wa_id`) y `action_type = 'schedule_followup'`; activo = estado fuera de `COMMERCIAL_ACTION_TERMINAL_STATUSES` (`action-lifecycle/constants.ts`: `rejected`/`blocked`/`cancelled`/`expired`/`executed`/`failed`); terminal = ese mismo set reutilizado, sin vocabulario nuevo; retryable = cualquier fila terminal habilita el siguiente intento.
- Idempotencia: `plan.idempotencyKey` (hash del plan completo, incluye `attemptNumber`) reemplaza `sales-action:{opportunityKey}:schedule_followup` solo para este tipo de accion; el guard primario es la busqueda de fila activa (no la igualdad de key), porque `scheduledFor` cambia turno a turno y una comparacion de key nunca detectaria un retry logico entre llamadas en momentos distintos.
- Mapeo de estado: `recommended -> planned`, `requires_operator_review -> requires_review`; `blocked`/`not_needed`/`cancelled`/`expired`/`invalid` no crean fila ejecutable (`mapFollowUpPlanStatusToActionStatus`, `followUpPlanAdapter.ts`).
- Bugs pre-existentes corregidos de paso (confirmados en `develop` HEAD `bee047a` antes de este cambio, invisibles bajo la suite mockeada): `INSERT INTO crm_agent_actions` tenia 39 columnas mapeadas a solo 38 placeholders `?` (`ER_WRONG_VALUE_COUNT_ON_ROW` en cualquier write real); `scheduled_for` recibia un ISO string crudo contra una columna `DATETIME` en vez de pasar por `toMysqlDateTime()`.
- Tests nuevos: `tests/commercial/followUpPlanAdapter.test.ts` (7 tests, puros, sin DB) y `tests/commercial/salesConsultativeFollowUpRepository.test.ts` (7 tests, MariaDB real contra `crm_test`) - ver la seccion de pruebas de la tarea para el detalle punto por punto.
- No objetivo de T01 tocado: `evaluateCommercialPolicy` no se conecto como gate (queda para T02); `runFollowupTick.ts`, outbox, Meta sender, `autonomous-loop`, shadow flags y `failure_reason` sanitization no se modificaron.

## Bloqueos

Ninguno propio de esta release. No depende de Customer Service (`PAUSED_EXTERNAL`, ver `ROADMAP.md`) ni de Address Book/Voice (`DEFERRED`). No depende de que `ACS-R1-04-T08`/`T09` cierren.

## Deudas fuera del incremento

- Frequency cap por customer: no existe en ningun path (planner, policy o persistencia). No es alcance de `ACS-R1-05-T01`..`T07`; registrar como tarea futura si el negocio lo requiere.
- `metaSendAdapter.ts` (envio con guards de politica) permanece sin usar por ningun worker productivo (P3-1 de la auditoria); no es bloqueante para esta release.
- El `correlationId` de follow-up no se persiste como columna propia (P3-2); reconstruir la traza sigue requiriendo joins por `decision_id`/`action_id`.
