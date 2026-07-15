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

Primer cierre (SHA `6558f29`) fue corregido por `ACS-R1-05-T03.1` (SHA funcional `59a536c`) antes de aceptar la tarea: el primer intento dejaba la recuperacion de stale-lock sin consumir intento, sin terminalizacion para filas `executing` agotadas, y revalidaba antes del claim en vez de despues para los origenes `planned`/`failed`. Estado final: `done`.

- Estado: `done`.
- SHA funcional: `59a536c` (correccion; `6558f29` fue el primer intento, con semantica incorrecta de recuperacion/terminalizacion/revalidacion). Rama `acs-r1-05-t03-followup-worker-hardening`.
- Archivos funcionales: `lib/brain/commercial/followup/runFollowupTick.ts` (reescrito - candidatos, claim CAS, terminalizacion y cancelacion endurecidos), `lib/brain/commercial/followup/followUpWorkerPolicy.ts` (constantes y funciones puras, sin acceso a DB; `FOLLOW_UP_STALE_EXECUTION_EXHAUSTED_REASON` nuevo en la correccion).
- **Seleccion de candidatas** (`selectDueFollowUps`): ademas de `status = 'planned' AND scheduled_for <= UTC_TIMESTAMP()`, ahora tambien selecciona **toda** fila `status = 'executing' AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL <FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS> SECOND)` (P0-2, stale-locked, con o sin intentos restantes - la correccion de T03.1 elimino el filtro `attempt_number < max_attempts` de esta rama, que antes dejaba invisibles para siempre las filas agotadas) y `status = 'failed' AND attempt_number < max_attempts` (P0-3), siempre acotado a `action_type = 'schedule_followup'` y a `expires_at`. `FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS = 300` (`followUpWorkerPolicy.ts`) es una constante nueva y explicita, nombrada, no un literal repetido. No hay transicion global `executing -> planned` en ningun punto; la recuperacion y la terminalizacion siempre pasan por su propio CAS.
- **Claim CAS por origen** (`claimPlannedFollowUp`, `claimStaleExecutingFollowUp`, `claimFailedFollowUpRetry`, despachadas por `claimFollowUpCandidate`; mas `terminalizeExhaustedStaleFollowUp`, que no es un claim): las cuatro son `UPDATE ... WHERE action_id = ? AND action_type = 'schedule_followup' AND <precondicion exacta>`, cada una verificada por `affectedRows`, el mismo patron CAS ya usado por el claim `planned -> executing` original. `claimStaleExecutingFollowUp` re-verifica staleness y `attempt_number < max_attempts` en el propio `UPDATE` (no solo en la seleccion previa), por lo que dos recuperaciones concurrentes sobre la misma fila nunca pueden ganar ambas - la segunda relee `updated_at` ya refrescado por la primera y su condicion deja de cumplirse. `claimFailedFollowUpRetry` incrementa `attempt_number = attempt_number + 1` atomicamente dentro del mismo `UPDATE` que gana el CAS, nunca en un paso separado. `terminalizeExhaustedStaleFollowUp` exige `status = 'executing' AND attempt_number >= max_attempts AND updated_at < ...`, escribe `status = 'failed', failure_reason = 'follow_up_stale_execution_exhausted'` sin tocar `attempt_number`, y es idempotente por construccion (tras el primer exito la fila ya no esta en `executing`, asi que una segunda llamada no afecta filas).
- **Semantica de recuperacion vs retry (corregida en T03.1)**: recuperar una fila `executing` stale **SI** incrementa `attempt_number` exactamente una vez, atomicamente dentro del mismo `UPDATE` que gana el CAS - es un intento comercial nuevo, no la continuacion silenciosa del anterior (no hay confirmacion de que el intento previo se haya completado o fallado, asi que se cuenta como su propio intento). Reclamar una fila `failed` tambien incrementa `attempt_number` exactamente una vez, con el mismo mecanismo. Una fila `executing` stale que ya alcanzo `max_attempts` **nunca se reclama**: se terminaliza a `failed` con `failure_reason = 'follow_up_stale_execution_exhausted'` (codigo fijo, corto, sin datos sensibles), sin ejecutar `cycleRunner`, sin crear otra accion, sin incrementar intentos. Verificado con tests dedicados: incremento exacto tras cada recuperacion, recuperaciones sucesivas hasta agotar `max_attempts`, terminalizacion con el motivo exacto, segundo tick que nunca vuelve a tocar la fila terminalizada, y dos terminalizaciones concurrentes donde solo una modifica la fila.
- **Revalidacion post-claim uniforme (corregida en T03.1)**: la secuencia es siempre seleccionar -> claim CAS -> revalidar (`shouldCancelFollowUp` + `wa_id`) -> abortar (`abortClaimedFollowUp`, `UPDATE ... WHERE status = 'executing'`) si corresponde -> solo entonces `cycleRunner`. El primer cierre revalidaba **antes** del claim para origen `planned`/`failed` y solo revalidaba despues del claim para la recuperacion de `executing` - la correccion elimina esa asimetria: ahora ningun origen ejecuta `cycleRunner` sin haber revalidado el estado comercial ya con la fila reclamada (`executing`) bajo su propio CAS. `cancelFollowUp` (standalone, precondicion `status IN ('planned', 'failed')`) ya no se llama desde el bucle del tick en ningun caso - queda como punto de entrada externo (p. ej. una futura cancelacion desde operador), probado directamente; nunca sobrescribe `executing`/`executed`/`cancelled`/`requires_review`. La carrera cancelacion-vs-claim (contra `claimPlannedFollowUp`) se sigue resolviendo por CAS: exactamente una gana, la otra ve `affectedRows = 0` y lo reporta en vez de sobrescribir. Verificado con un hook de sincronizacion explicita nuevo (`onAfterClaim`, invocado justo despues del claim exitoso, antes de la revalidacion) que permite a los tests insertar la respuesta del cliente / oportunidad terminal / toma de control humana exactamente en la ventana entre claim y revalidacion, sin sleeps arbitrarios, para los tres origenes (`planned`, `failed` con retry, `executing` recuperado).
- **Invariantes preservadas sin reabrirlas**: el planner T01 (`follow-up-planner/planFollowUp.ts`) y la idempotencia T01.1 no se tocan; `follow_up_dispatch_policy` (T02, `sales-consultative/followUpDispatchPolicy.ts`) no se copia ni se referencia dentro del worker; `requires_review` nunca es seleccionado por `selectDueFollowUps` y por tanto nunca se ejecuta; la cancelacion por respuesta del cliente, propietario humano, IA pausada, conversacion cerrada y oportunidad terminal (`shouldCancelFollowUp`, sin cambios de logica) se aplica ahora de forma identica a los tres origenes de claim; la reentrada via `runNativeAutonomousCycle` (inyectable, `cycleRunner`) no cambia; cero envio directo desde el worker.
- **Fallo del ciclo** (bloque `catch`, sin cambios de mecanismo): `UPDATE ... SET status = 'failed', failure_reason = ? WHERE status = 'executing'` - retryable vs terminal para este caso se sigue decidiendo enteramente en el proximo intento de claim (`claimFailedFollowUpRetry`'s precondicion `attempt_number < max_attempts`), a diferencia de la terminalizacion de stale-lock agotado (mecanismo nuevo y distinto, ver arriba) que si transiciona a `failed` en el momento mismo de la deteccion, sin pasar por un `cycleRunner` fallido. `failure_reason` del catch sigue sin redaccion (P1-2, deuda explicita de T06, no tocada aqui).
- Tests: 30/30 verde en `tests/commercial/runFollowupTick.test.ts` contra MariaDB real (`main_management`) - 15 tests de T03 mas 11 tests nuevos de la correccion T03.1 (incremento de intento en recuperacion, recuperaciones sucesivas hasta `max_attempts`, terminalizacion con motivo exacto, segundo tick no retoca fila terminalizada, concurrencia de terminalizacion, ademas de las tres pruebas de revalidacion post-claim por origen usando el hook `onAfterClaim`), mas 4 aserciones corregidas en tests preexistentes de T03 (recuperacion ahora espera `attempt_number` incrementado; la prueba de "nunca recuperada" fue reemplazada por "terminalizada"; la prueba de concurrencia de recuperacion ahora tambien verifica el intento final).
- Invariantes T01/T02 verificadas en verde en la misma corrida: `followUpPlanner.test.ts`, `followUpPlanAdapter.test.ts`, `followUpDispatchPolicy.test.ts`, `salesConsultativeFollowUpRepository.test.ts` - 75/75, cero aserciones modificadas en esos archivos. Regresion adicional verificada: `actionLifecycleContract.test.ts`, `actionQueueViewModel.test.ts`, `agentActionQueue.test.ts`, `sales-consultative.test.ts`, `sales-consultative-service.test.ts`, `outboxWorker.test.ts` - 106/106. E2E (`npm run e2e:autonomous`, escenario E, follow-up) sigue en `PASS`; los otros dos fallos del harness (`B`, `H`) y el `PARTIAL` (`A`) son preexistentes, ya verificados identicos contra el commit base `9d6b50a` durante T03 - no son causados por esta correccion.
- No objetivo de T03/T03.1 tocado: planner T01, dispatch policy T02, `failure_reason` sin redactar (P1-2), outbox/`applyMetaDeliveryStatus`/`crm_opportunities` (T04), planners paralelos/codigo muerto (T05), flags auto-escalados (T06), Customer Service, Address Book, Voice, frontend, EC2/Nginx/Meta deployment; cero tablas o migraciones nuevas; cero cambio de comportamiento en `send_whatsapp_reply`/`prepare_quote_draft`/`take_over_case`/`pause_ai`/`mark_lost_candidate`/`create_internal_task`.

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
