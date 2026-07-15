---
release: ACS-R1-05
title: Autonomous Follow-up Runtime
doc_id: release-acs-r1-05-autonomous-follow-up-runtime
status: parallel_in_progress
updated_at: 2026-07-14
current_task: ACS-R1-05-T04
next_task: ACS-R1-05-T05
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
| ACS-R1-05-T02 | Aplicar follow-up dispatch policy | done | ACS-R1-05-T01 | P0-4 (opt-out/quiet-hours/identity-conflict shadow-only, nunca gatean el write real); conecta `follow_up_dispatch_policy` (`evaluateCommercialPolicy`) como gate obligatorio antes de `upsertActionRow` |
| ACS-R1-05-T03 | Hardening del worker | done | ACS-R1-05-T01 | P0-2 (sin stale-lock recovery), P0-3 (sin retry/enforcement de `max_attempts`), P1-1 (`cancelFollowUp` sin precondicion de status) |
| ACS-R1-05-T04 | Consolidar outbox y delivery outcomes | in_progress | ACS-R1-05-T01 | P1-3 (delivery outcomes no llegan a `crm_opportunities`), P1-4 (dos escritores divergentes de `brain_message_outbox`) |
| ACS-R1-05-T05 | Aislar runtimes paralelos o muertos | ready | ACS-R1-05-T01 | P2-1 (5 planners paralelos), P2-2 (`multi-request/requestFollowups.ts` muerto), P2-5 (modulo `outbox-worker/` hyphenated duplicado) |
| ACS-R1-05-T06 | Seguridad y configuracion operacional | ready | ACS-R1-05-T01 | P1-2 (`failure_reason` sin redactar), P1-5 (flags auto-escalados en silencio por los dos workers) |
| ACS-R1-05-T07 | E2E productivo y restart recovery | ready | ACS-R1-05-T01 a T06 | Cierra la release: verifica end-to-end (patron del harness existente de identity onboarding) que el runtime consolidado sostiene reinicio/retry sin duplicar ni perder envios |

## Tarea actual

`ACS-R1-05-T04`

## Definition of Done de la tarea actual

`ACS-R1-05-T04` debe consolidar los dos escritores divergentes de `brain_message_outbox` (`outbox.ts`'s `createOutboxPlannedRecord` y `execution-gate/sqlExecutionUnitOfWork.ts`'s `SqlOutboxRepository.insertCommand`) en un unico writer (P1-4), y extender `applyMetaDeliveryStatus` (`native-whatsapp/service.ts`) para que los delivery outcomes lleguen hasta `crm_opportunities`, hoy un dead-end en `crm_action_outcomes`/`brain_message_outbox` (P1-3). Debe reutilizar - sin reabrirlo - el hardening del worker que T03 cerro (stale-lock recovery, retry de `failed`, precondicion de `cancelFollowUp`).

## Siguiente tarea

`ACS-R1-05-T05` (`ready`, no iniciada - depende de que T01 haya cerrado, ya satisfecho)

## Evidencia de cierre - ACS-R1-05-T03

- Estado: `done`.
- SHA funcional: `6558f29`. Rama `develop` (sin rama de tarea dedicada).
- Archivos funcionales: `lib/brain/commercial/followup/runFollowupTick.ts` (reescrito - candidatos, claim CAS y cancelacion endurecidos), `lib/brain/commercial/followup/followUpWorkerPolicy.ts` (nuevo - constantes y funciones puras, sin acceso a DB).
- **Seleccion de candidatas** (`selectDueFollowUps`): ademas de `status = 'planned' AND scheduled_for <= UTC_TIMESTAMP()`, ahora tambien selecciona `status = 'executing' AND attempt_number < max_attempts AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL <FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS> SECOND)` (P0-2) y `status = 'failed' AND attempt_number < max_attempts` (P0-3), siempre acotado a `action_type = 'schedule_followup'` y a `expires_at`. `FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS = 300` (`followUpWorkerPolicy.ts`) es una constante nueva y explicita, nombrada, no un literal repetido - justificada en comentario por estar por encima del poll default (30s) y de una corrida realista de `runNativeAutonomousCycle`. No hay transicion global `executing -> planned` en ningun punto; la recuperacion siempre pasa por su propio CAS.
- **Claim CAS por origen** (`claimPlannedFollowUp`, `claimStaleExecutingFollowUp`, `claimFailedFollowUpRetry`, despachadas por `claimFollowUpCandidate`): las tres son `UPDATE ... WHERE action_id = ? AND <precondicion exacta>`, cada una verificada por `affectedRows`, el mismo patron CAS ya usado por el claim `planned -> executing` original. `claimStaleExecutingFollowUp` re-verifica staleness y `attempt_number < max_attempts` en el propio `UPDATE` (no solo en la seleccion previa), por lo que dos recuperaciones concurrentes sobre la misma fila nunca pueden ganar ambas - la segunda relee `updated_at` ya refrescado por la primera y su condicion deja de cumplirse. `claimFailedFollowUpRetry` incrementa `attempt_number = attempt_number + 1` atomicamente dentro del mismo `UPDATE` que gana el CAS, nunca en un paso separado - un segundo `UPDATE` concurrente sobre la misma fila ya no ve `status = 'failed'` y pierde. Una fila con `attempt_number >= max_attempts` nunca es seleccionada (seleccion) ni reclamada (claim, defensa en profundidad) - es terminal sin necesidad de un valor de `status` distinto: la exhaustion se decide enteramente por la precondicion `attempt_number < max_attempts`, nunca por un nuevo estado.
- **Semantica de recuperacion vs retry**: recuperar una fila `executing` stale NO incrementa `attempt_number` (resume el mismo intento en curso, interrumpido por un crash del worker, no un nuevo intento comercial - no hubo confirmacion de que el intento anterior se haya completado ni fallado); reclamar una fila `failed` SI incrementa `attempt_number` exactamente una vez (es un intento comercial nuevo y deliberado). Verificado con tests dedicados (`attempt_number` sin cambio tras recuperacion; `attempt_number` en +1 exacto tras retry).
- **`cancelFollowUp` con precondicion explicita** (P1-1): `UPDATE ... WHERE action_id = ? AND status IN ('planned', 'failed')`, retorna `{ cancelled: boolean }` en vez de `void`. Nunca sobrescribe `executing`/`executed`/`cancelled`/`requires_review` - verificado con test dedicado que confirma que una fila `executing` no se toca. La carrera cancelacion-vs-claim se resuelve por CAS: exactamente una de las dos transiciones concurrentes (`cancelFollowUp` o `claimPlannedFollowUp`) gana, la otra ve `affectedRows = 0` y lo reporta (`{cancelled: false}` o `locked = false`) en vez de fallar silenciosamente o sobrescribir. Para las filas recuperadas de `executing` (que `cancelFollowUp` no puede tocar por diseno), se anaden dos piezas separadas: revalidacion post-claim de `shouldCancelFollowUp` (una vez que el tick ya posee la fila via `claimStaleExecutingFollowUp`) y `abortClaimedFollowUp` (un `UPDATE ... WHERE status = 'executing'`, mecanismo distinto de `cancelFollowUp`, valido porque en ese punto `executing` es precisamente la precondicion esperada, no la prohibida). El mismo `abortClaimedFollowUp` reemplaza el `cancelFollowUp` sin precondicion que el codigo original usaba para `conversation_not_found`.
- **Funciones puras y constantes explicitas** (`followUpWorkerPolicy.ts`, sin DB): `FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS`, `FOLLOW_UP_CLAIMABLE_STATUSES`/`isClaimableFollowUpStatus` (`planned`/`executing`/`failed`), `FOLLOW_UP_CANCELABLE_STATUSES`/`isCancelableFollowUpStatus` (`planned`/`failed`), `hasAttemptsRemaining`, `nextAttemptNumber`, `isStaleExecutingLock`. Documentado explicitamente que no acopla el dominio de follow-up con `lib/brain/messaging/outboxWorker.ts`'s `isStaleLockedTimestamp` - mismo concepto (comparacion de timestamp de lock), sin import compartido.
- **Invariantes preservadas sin reabrirlas**: el planner T01 (`follow-up-planner/planFollowUp.ts`) y la idempotencia T01.1 no se tocan; `follow_up_dispatch_policy` (T02, `sales-consultative/followUpDispatchPolicy.ts`) no se copia ni se referencia dentro del worker; `requires_review` nunca es seleccionado por `selectDueFollowUps` (no aparece en ninguna de las tres ramas de la clausula `WHERE`) y por tanto nunca se ejecuta - verificado con test dedicado; la cancelacion por respuesta del cliente y por oportunidad terminal (`shouldCancelFollowUp`, sin cambios de logica) se preserva para origen `planned`/`failed` (revalidacion pre-claim, como antes) y se extiende ahora tambien a filas `executing` recuperadas (revalidacion post-claim, ver arriba) - un follow-up recuperado tras un crash nunca ignora una respuesta del cliente o una oportunidad ya cerrada solo porque su fila haya quedado stale; la reentrada via `runNativeAutonomousCycle` (inyectable, `cycleRunner`) no cambia; cero envio directo desde el worker (el worker nunca llama a Meta ni al outbox, solo reentra al ciclo nativo).
- **Fallo del ciclo** (bloque `catch`, sin cambios de mecanismo): `UPDATE ... SET status = 'failed', failure_reason = ? WHERE status = 'executing'` - el mismo `UPDATE`, sin bifurcar por un estado "terminal" distinto. Retryable vs terminal se decide enteramente en el proximo intento de claim (`claimFailedFollowUpRetry`'s precondicion `attempt_number < max_attempts`), nunca en el momento del fallo. `failure_reason` sigue sin redaccion (P1-2, deuda explicita de T06, no tocada aqui).
- Tests nuevos: 15 tests nuevos en `tests/commercial/runFollowupTick.test.ts` (recuperacion stale con/sin intentos disponibles, lock reciente no recuperado, concurrencia de recuperacion, retry de `failed` con/sin intentos, incremento exacto de `attempt_number`, fallo retryable vs terminal segun intentos, `cancelFollowUp` sobre `planned`/`failed`/`executing`, carrera cancelacion-vs-claim, `requires_review` nunca ejecutado, accion de otro `action_type` nunca tocada, segundo tick no duplica), mas los 9 tests preexistentes sin modificar sus aserciones (solo se extendio `loadAction` con `attempt_number`/`max_attempts` y se agrego el helper `setActionState`). Total: 24/24 verde contra MariaDB real (`main_management`, la misma base que usa el resto de la suite `tests/commercial/**`, no `crm_test`).
- Invariantes T01/T02 verificadas en verde en la misma corrida: `followUpPlanner.test.ts`, `followUpPlanAdapter.test.ts`, `followUpDispatchPolicy.test.ts`, `salesConsultativeFollowUpRepository.test.ts` - 99/99 tests combinados con `runFollowupTick.test.ts`, cero aserciones modificadas en esos archivos. Regresion adicional verificada: `actionLifecycleContract.test.ts`, `actionQueueViewModel.test.ts`, `agentActionQueue.test.ts`, `sales-consultative.test.ts`, `sales-consultative-service.test.ts`, `outboxWorker.test.ts` - 106/106. E2E (`npm run e2e:autonomous`, escenario E, follow-up) sigue en `PASS` antes y despues del cambio; los otros dos fallos del harness (`B`, `H`) y el `PARTIAL` (`A`) se verificaron identicos contra el commit base (`9d6b50a`, via `git stash`) - no son causados por esta tarea.
- Infra local: la base `main_management` de este entorno solo tenia migraciones hasta la `011` (con un mismatch de checksum en esa migracion causado por normalizacion de fin de linea CRLF/LF, no por contenido divergente); se reseteo y remigro completa (`npm run db:reset`, 23 migraciones) igual que `crm_test` (`npm run db:test:reset`, tras otorgar a `crm_app` el mismo nivel de privilegio local que ya tenia sobre `main_management`). Cambio de infraestructura local unicamente (contenedor Docker en `127.0.0.1:3306`), sin tocar la base productiva de `.env` (RDS remoto, nunca alcanzable por estos scripts por el guard `isLocalHost`).
- No objetivo de T03 tocado: planner T01, dispatch policy T02, `failure_reason` sin redactar (P1-2), outbox/`applyMetaDeliveryStatus`/`crm_opportunities` (T04), planners paralelos/codigo muerto (T05), flags auto-escalados (T06), Customer Service, Address Book, Voice, frontend, EC2/Nginx/Meta deployment; cero tablas o migraciones nuevas; cero cambio de comportamiento en `send_whatsapp_reply`/`prepare_quote_draft`/`take_over_case`/`pause_ai`/`mark_lost_candidate`/`create_internal_task`.

## Evidencia de cierre - ACS-R1-05-T02

- Estado: `done`.
- SHA funcional: ver seccion de commits de `ACTIVE_RELEASE.md`. Rama `acs-r1-05-t02-followup-dispatch-policy`.
- Archivos funcionales: `lib/brain/commercial/sales-consultative/followUpDispatchPolicy.ts` (nuevo - adapter puro `follow_up_dispatch_policy` sobre `policy/evaluateCommercialPolicy.ts`), `lib/brain/commercial/sales-consultative/repository.ts` (gate conectado en `upsertFollowUpActionRow`, justo antes del `INSERT INTO crm_agent_actions`), `lib/brain/commercial/sales-consultative/followUpPlanAdapter.ts` (`FOLLOW_UP_TIMEZONE` exportado para reuso, sin cambio de comportamiento).
- **Arquitectura**: `sales-consultative/engine.ts` (trigger, sin cambios) -> `planCommercialFollowUp` (T01, sin cambios) -> `follow_up_dispatch_policy` (`evaluateFollowUpDispatchPolicy`, nuevo) -> `upsertFollowUpActionRow` (INSERT en `crm_agent_actions`). El gate es la unica via que puede convertir un plan `recommended`/`requires_operator_review` en una fila ejecutable; ningun caller puede saltarselo porque esta dentro de la misma funcion que hace el INSERT, no en un paso opcional externo.
- **Boundary de politica**: `evaluateFollowUpDispatchPolicy` llama directamente a `policy/evaluateCommercialPolicy.ts` con un `SalesAgentResult` intencionalmente vacio (`proposedActions`/`toolRequests`/`entityProposals: []`, `responseProposal: null`) - el gate de canal del evaluador (`computeChannelSignals`: opt-out/ai-blocked/identity-conflict fuerzan `blocked`; human-owner/quiet-hours/manual-approval fuerzan `requires_review`) es independiente de esos arrays, asi que este uso ejercita exactamente el "boundary puro" sin duplicar ninguna regla de bloqueo dentro de `sales-consultative`. No se llama `runCommercialShadowEvaluation` en ningun punto del path nuevo.
- **Resultado de dispatch explicito**: `FollowUpDispatchDecision = "allow" | "require_review" | "deny" | "failed_safe"`, mapeado desde `CommercialPolicyStatus` por una funcion pura e independientemente testeable (`mapCommercialPolicyStatusToDispatchDecision`): `allowed`/`allowed_with_restrictions -> allow`; `requires_review -> require_review`; `blocked -> deny`; `failed_safe -> failed_safe`. Nunca se usa un booleano `blocked` suelto.
- **Fuentes reales de senales** (`loadFollowUpDispatchChannelSignals`):
  - `optOut`: `crm_opportunities.signals_json` (array estructurado ya cargado en la oportunidad, nunca el texto libre del ultimo mensaje). Ningun escritor real del repositorio popula hoy una entrada `"opt_out"` en ese array (no existe capa de opt-out capture ni tabla de Customer Preference en este repo - T02 no la agrega, section 6 regla 7 de la tarea), asi que el gate evalua `false` en la practica hasta que exista ese escritor; el mecanismo esta real y conectado, no es una constante hardcodeada.
  - `quietHoursActive`: `computeQuietHoursActive(currentTime, timezone)`, hora y timezone explicitos (`FOLLOW_UP_TIMEZONE = "America/Santiago"`, reexportado de `followUpPlanAdapter.ts`), nunca la timezone del servidor. Ventana 21:00-09:00 local, nueva constante nombrada (`FOLLOW_UP_QUIET_HOURS_START_HOUR`/`END_HOUR`) porque `follow-up-decision-policy.md` deja la ventana "configurable by context" sin un valor canonico previo. Un `currentTime` no parseable degrada fail-closed (tratado como dentro de quiet hours).
  - `humanOwnerActive` / `aiBlocked`: `conversation.human_owner_active` / `conversation.ai_enabled` (migraciones 008/010), las mismas columnas que `updateOpportunityHandoffState` (`native-whatsapp/service.ts`) escribe de forma confiable - a diferencia de `crm_opportunities.human_owner_active`/`ai_blocked`, que no se usan aqui porque ese camino de escritura re-persiste el valor previo al turno (ver comentario en el codigo). Sourced como dos booleanos independientes, no combinados: `evaluateCommercialPolicy` ya les da severidad distinta (`aiBlocked` es parte del bloqueo duro; `humanOwnerActive` solo exige revision) - combinarlos habria hecho inalcanzable el resultado "revision" cuando solo hay dueno humano activo sin IA explicitamente deshabilitada.
  - `identityConflict`: `crm_customer_onboarding_state.status = 'conflict'` (migracion 023, el estado nativo real de resolucion de identidad de ACS-R1-04), nunca el `resolver_identity.identity_type` legacy que usa el runtime shadow.
  - `conversation status`/disponibilidad: `conversation.status = 'open'` alimenta `available`/`outboundAllowed`.
  - Un `conversationId` sin fila real en `conversation` (incluida ausencia total de `conversationId`) degrada a "sin senal adicional" (no bloquea, no es un fallo) - preserva el invariante T01 de "fallback seguro sin contexto completo". Solo una excepcion tecnica real de `safeQueryRows` (`ok:false`) hace fallar cerrado el gate completo.
- **Configuracion**: `BRAIN_COMMERCIAL_POLICY_ENABLED` (leido con el mecanismo tipado existente `readEnvFlag`, `config/commercialCycleConfig.ts`), default `false` ya documentado en `.env.example`. Sin dependencia de `BRAIN_COMMERCIAL_SHADOW_ENABLED` ni `BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER` en ningun punto del nuevo codigo (verificado con un test dedicado que lee el codigo fuente y confirma ausencia de esos imports/flags). Politica deshabilitada -> `failed_safe`, nunca `allowed` por omision.
- **Mapeo a persistencia**: `allow` conserva `action.status`/`policy_status` calculados por el plan (`planned`/`allowed` o `requires_review`/`requires_review`, sin cambio de T01). `require_review` fuerza `action.status = "requires_review"`/`policy_status = "requires_review"` aunque el plan hubiera propuesto `planned` - nunca degrada a `planned` (cubre quiet hours y human-owner-active). `deny`/`failed_safe` no insertan fila (mismo patron que T01's `follow_up_plan_not_persisted:<status>`): retornan `follow_up_dispatch_deny:<reasonCode>` / `follow_up_dispatch_failed_safe:<reasonCode>`, sin sobrescribir una fila activa previa. `approval_requirement` se eleva a `"operator_review"` solo cuando el plan tenia `"none"` y el dispatch exige revision.
- **Persistencia sin PII**: solo se agregan codigos cortos y fijos (`opt_out_active`, `quiet_hours_active`, `identity_conflict`, `ai_blocked`, `human_owner_active`, `conversation_unavailable`) a `policy_notes_json`, nunca el `CommercialPolicyResult` completo, contexto comercial, telefonos, emails, mensajes ni stack traces. `block_reasons_json` sigue siendo exclusivamente el de T01 (`plan.blockReasons`).
- **Invariantes T01.1 preservadas**: el gate corre unicamente en el tramo final antes del INSERT (despues de retry-exacto, `active_followup_exists` y `existing_action_reused`), nunca altera `loadFollowUpActionHistory`, nunca recalcula `attemptNumber` por su cuenta, nunca cancela ni sobrescribe una fila activa. Los 19 tests de T01.1 corren sin modificacion de aserciones (solo se fijo un `currentTime` deterministico y se activo `BRAIN_COMMERCIAL_POLICY_ENABLED=true` en el harness, ver seccion de tests) y siguen en verde.
- Tests nuevos: `tests/commercial/followUpDispatchPolicy.test.ts` (14 tests puros, sin DB, cubre los 12 casos pedidos mas 2 adicionales de `computeQuietHoursActive`), mas 11 tests nuevos en `tests/commercial/salesConsultativeFollowUpRepository.test.ts` (`[T02-1]`..`[T02-10]`, MariaDB real contra `crm_test`, sin mocks del repositorio). `crm_test` reseteada y migrada dos veces (23 migraciones, cero checksum conflicts).
- No objetivo de T02 tocado: `runFollowupTick.ts`, `autonomous-outbox-worker.ts`, `metaClient.ts`, `applyMetaDeliveryStatus`, `multi-request/requestFollowups.ts`, `autonomous-loop`, sanitizacion de `failure_reason`, recuperacion de stale-lock, retry de `failed`, frequency cap, Customer Service, Address Book, Voice; cero tablas o migraciones nuevas; cancelacion eager por inbound no implementada.

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
