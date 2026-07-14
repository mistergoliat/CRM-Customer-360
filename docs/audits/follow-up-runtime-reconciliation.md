---
title: Follow-up runtime reconciliation
doc_id: audit-follow-up-runtime-reconciliation
status: completed
owner: architecture
last_reviewed: 2026-07-14
source_of_truth_for:
  - existing follow-up runtime assessment
  - follow-up reuse decisions
  - follow-up implementation gaps
  - PAUSED_EXTERNAL and DEFERRED external-dependency status vocabulary
depends_on:
  - ../ROADMAP.md
  - ../product/MVP_EXECUTION_MAP.md
  - ../ACTIVE_RELEASE.md
tags:
  - audit
  - follow-up
  - autonomous-commerce
---

# Follow-up runtime reconciliation

Auditoria documental y tecnica (solo lectura) del runtime de follow-up autonomo existente en el repositorio. No implementa funcionalidad, no cierra `ACS-R1-04-T08`, no abre `ACS-R1-04-T09` ni ninguna release nueva de follow-up. Reconcilia que existe, que esta realmente conectado y que debe reutilizarse antes de escribir una sola linea de codigo nueva.

## 0. Regla de lectura de este documento

Ninguna capability queda marcada `operational: verified` por este documento. "Conectado" aqui significa "hay un caller productivo real, no solo un tipo o un test" - nunca "verificado end to end contra produccion real". El follow-up autonomo **existe y esta parcialmente conectado**, no es aspiracional, pero tampoco esta listo para operar sin los gaps P0 de la seccion 6.

## 1. Estado de dependencias externas (fuente canonica)

Este documento es la fuente unica para los estados `PAUSED_EXTERNAL` y `DEFERRED`. `docs/ACTIVE_RELEASE.md`, `docs/ROADMAP.md` y `docs/product/MVP_EXECUTION_MAP.md` deben enlazar o resumir esta seccion, no repetirla.

### Customer Service - `PAUSED_EXTERNAL`

No estan disponibles todavia el endpoint, contrato real, credenciales, OpenAPI/Postman ni detalles operacionales del servicio unificador de clientes.

Pendiente al reanudar:

- validar `resolve_customer`;
- validar `create_customer`;
- validar `link_external_identity`;
- confirmar que retorna `master_customer.id` como `customerMasterId`;
- validar autenticacion;
- validar idempotencia;
- validar manejo de sincronizacion parcial entre plataformas;
- ejecutar smoke operacional de `ACS-R1-04-T08`.

Impacto: `ACS-R1-04-T08` continua bloqueada; `ACS-R1-04-T09` no puede cerrar la release; no bloquea workstreams independientes (incluido este, follow-up).

No se declara que Customer Service deba construirse desde cero. Existe un posible endpoint unificador externo que debera auditarse cuando este disponible.

### Address Book - `DEFERRED`

No bloquea el SDR autonomo ni el follow-up. Administra multiples direcciones, destinatarios y confirmacion de direccion; no es el Customer Master.

Reanudar antes de: shipping; checkout; creacion de pedidos; seleccion o confirmacion de direccion.

### Voice - `DEFERRED`

No pertenece al camino critico del MVP autonomo por WhatsApp.

Reanudar despues de: conversacion autonoma estable; follow-up productivo; cancelacion por respuesta; outbox y delivery verificados; piloto real por WhatsApp.

## 2. Metodo

Se inspeccionaron en modo solo-lectura los cinco grupos de rutas obligatorias de la tarea (planner/policy, creacion/persistencia de acciones, worker, ciclo/outbox/Meta), se corrieron los tests existentes relacionados, y se verificaron con evidencia de codigo (file:line) las hipotesis especificas pedidas. No se asumio ningun archivo faltante: donde `lib/brain/outbox/**` y `lib/integrations/meta/**` (citados en la tarea) no existen, la ubicacion real es `lib/brain/messaging/**` (outbox, dedupe, Meta client/adapter/transport).

## 3. Componentes encontrados y clasificacion

Clasificacion por reachability real (quien la invoca hoy), no por que tan reciente o completa parezca. Vocabulario: `canonical` (es la que corre en produccion), `reusable_with_changes` (codigo real y de calidad, pero no conectado o con defectos que deben corregirse antes de confiar en el), `parallel` (corre de verdad, pero es una segunda implementacion no coordinada con la canonica), `legacy` (superado por otra pieza pero aun referenciado), `dead` (cero callers productivos), `missing` (no existe implementacion).

| Componente | Implementacion | Runtime caller | Persistencia | Tests | Estado | Decision |
|---|---|---|---|---|---|---|
| Follow-up planner (`lib/brain/commercial/follow-up-planner/planFollowUp.ts`) | Real: computa `attemptNumber`/`maxAttempts` desde estado real (`planFollowUp.ts:259-272,867-892`), nunca hardcodea | Solo `buildActionQueueViewModel.ts:479` -> `lib/case-detail.ts:465` -> pagina de detalle de caso (UI de operador, solo lectura); `persisted:false`/`executable:false` forzado por `validateFollowUpPlan.ts:154-155` | Ninguna (por diseno) | `tests/commercial/followUpPlanner.test.ts`, 18/18 verde | `parallel` (real, vivo, pero es una preview de operador, no el scheduler autonomo) | Promover a fuente de calculo de attempt/cooldown/policy para el path que si persiste (ver FU-T01) |
| Follow-up policy (`lib/brain/commercial/policy/evaluateCommercialPolicy.ts`) | Real: opt-out, quiet hours, identity conflict, cooldown (`evaluateCommercialPolicy.ts:57,280-294`) | Solo `runCommercialShadowEvaluation.ts` (shadow/dry-run), invocado dentro de `runNativeAutonomousCycle` pero como evaluacion no vinculante | Ninguna (resultado de evaluacion, no accion) | `tests/commercial/evaluateCommercialPolicy.test.ts` | `parallel` (corre de verdad en cada turno, pero no gatea el write real de follow-up) | Conectar como gate obligatorio antes de `upsertActionRow` (ver FU-T02) |
| Sales-consultative scheduler (`lib/brain/commercial/sales-consultative/engine.ts` + `repository.ts`) | Real, pero `attempt_number:1`, `max_attempts:1`, `policy_status:"allowed"` hardcodeados (`repository.ts:275,276,280`); cooldown ausente; idempotency key sin scope temporal (`repository.ts:228-236`) | `lib/brain/native-whatsapp/service.ts:15,813` y `lib/brain/processInbound.ts:27,1280` (inbound real de WhatsApp) | `crm_agent_actions`, `action_type='schedule_followup'` | `tests/commercial/sales-consultative*.test.ts`, 17/17 verde (mocks, no ejercitan el SQL real) | `canonical` (es el path que efectivamente corre hoy) con deuda P0 | Corregir hardcodes y conectar policy (FU-T01/FU-T02) antes de confiar en cadencia multi-intento |
| Multi-request follow-up (`lib/brain/commercial/multi-request/requestFollowups.ts`) | Completa, propia idempotencia, propia cancelacion lazy documentada | **Cero** callers productivos (solo tests) | `crm_agent_actions` (columna `request_id`, migracion 021, no 005) | `tests/commercial/requestFollowups.test.ts`, 6 tests, DB no disponible en este entorno | `dead` | Eliminar o justificar explicitamente por que se mantiene sin caller (FU-T05) |
| Multi-request deferred actions (`lib/brain/commercial/multi-request/deferredActions.ts`) | Real, con CAS e idempotencia (`deferredActions.ts:91-120`) | `executeRequestTurn.ts:6,92` (real, runtime multi-request) | `crm_agent_actions` | `tests/commercial/deferredActions.test.ts`, 3 tests, DB no disponible | `parallel` (accion generica diferida del runtime multi-request, no especifico de follow-up, coexiste con sales-consultative) | Mantener, documentar limite de alcance frente a follow-up |
| `crm_agent_actions` (tabla) | Migracion `005_crm_agent_actions.sql` + `021_agent_actions_request_link.sql` (agrega `request_id`) | 4 escritores independientes (ver seccion 6.2) | Es la persistencia | Cubierta indirectamente por todos los tests de arriba | `canonical` (la tabla si es la unica fuente durable) | Consolidar escritores, no la tabla (FU-T01) |
| Follow-up worker (`scripts/autonomous-followup-worker.ts` + `lib/brain/commercial/followup/runFollowupTick.ts`) | Real: CAS atomico (`runFollowupTick.ts:68-76`), cancelacion lazy (`shouldCancelFollowUp`, `runFollowupTick.ts:78-125`); sin stale-lock recovery, sin retry de `failed`, sin lectura de `max_attempts` | `npm run worker:followup` -> `scripts/autonomous-followup-worker.ts:77` (proceso standalone, no orquestado por nada mas) | Transiciones sobre `crm_agent_actions` | `tests/commercial/runFollowupTick.test.ts`, 9 tests, DB no disponible en este entorno (ver seccion 7) | `canonical` con deuda P0/P1 | Endurecer (FU-T03) antes de operar sin supervision |
| Re-entrada al ciclo autonomo (`runNativeAutonomousCycle`) | Real, no es un mensaje enlatado: reconstruye contexto, vuelve a evaluar shadow/operational-loop | Llamado por `runFollowupTick.ts:175` como `cycleRunner` por defecto | N/A (orquestador) | Ejercitado por `tests/commercial/runFollowupTick.test.ts` (via inyeccion) | `canonical` | Mantener |
| Outbox bridge | **Dos** escritores independientes hacia `brain_message_outbox`: `createOutboxPlannedRecord` (`lib/brain/messaging/outbox.ts:191`, usado por processInbound legacy y por sales-consultative) y `SqlOutboxRepository.insertCommand` (`lib/brain/commercial/execution-gate/sqlExecutionUnitOfWork.ts:88-152`, usado por el execution-bridge del ciclo nativo, que es el que realmente usa el follow-up worker) | Ambos con callers reales | `brain_message_outbox` | `tests/commercial/outboxWorker.test.ts` (55/55, pero cubre un modulo paralelo no productivo, ver fila siguiente); `tests/native/outbox-ownership.test.ts` (DB no disponible) | `parallel` (dos implementaciones reales y activas sobre la misma tabla, logica de columnas y dedupe divergente) | Consolidar en un unico writer (FU-T04) |
| Outbox worker "hyphenated" (`lib/brain/messaging/outbox-worker/**`, `FakeMessageTransport`) | Completo, con test propio que verifica que su codigo fuente **no** contiene `fetch`/`mysql2`/SQL/`graph.facebook` | Solo `lib/brain/commercial/autonomous-loop/**` -> `scenario-simulator` -> `app/(hub)/dev/ai-sdr-simulator/page.tsx` (pagina `/dev`, no produccion) | Ninguna (in-memory) | `tests/commercial/outboxWorker.test.ts`, 55/55 verde | `dead` (relativo a produccion; es simulador) | Aislar explicitamente como simulador, no contar como cobertura de outbox productivo |
| Meta sender (`lib/brain/messaging/metaClient.ts`) | Real: `fetch` a `https://graph.facebook.com/{version}/{phoneNumberId}/messages` (`metaClient.ts:249`) | `scripts/autonomous-outbox-worker.ts` -> `autonomousOutboxTick.ts`; y `app/api/brain/outbox/worker/route.ts` -> `outboxWorker.ts` | N/A (transporte) | Ejercitado indirectamente; sin smoke contra Meta real en este entorno | `canonical` | Mantener; consolidar con `metaSendAdapter.ts` (P3, ver seccion 6.4) |
| Delivery outcomes | Real: `applyMetaDeliveryStatus` (`lib/brain/native-whatsapp/service.ts:1067-1163`) actualiza `conversation_message`, `brain_message_outbox.provider_status`, `commercial_event`, `crm_action_outcomes` | Webhook `app/api/integrations/whatsapp/webhook/route.ts:199-214` | `crm_action_outcomes` | Cubierto por `tests/native/outbox-ownership.test.ts` (DB no disponible) | `reusable_with_changes` (funciona, pero nunca llega a `crm_opportunities`) | Extender hasta opportunity (FU-T04) |
| Cancelacion por inbound (inmediata) | `lib/domains/conversations/control.ts:75-95` cancela `send_whatsapp_reply`/`request_more_context` en la misma transaccion que take/pause/close - **excluye explicitamente `schedule_followup`** | `applyConversationControl` (operador humano) | `crm_agent_actions` | Cubierto por tests de control de conversacion | `reusable_with_changes` (existe pero no cubre follow-up) | Ver seccion 6.5, decision: mantener lazy para follow-up, documentar por que |
| Opt-out / quiet hours / identity conflict a nivel de dispatch | Tipos y evaluacion reales en `policy/evaluateCommercialPolicy.ts`, nunca leidos por `sales-consultative/repository.ts` | Ninguno en el path que persiste | No aplica al write real | Tests solo del evaluador aislado | `missing` (en el sentido de enforcement en el path que importa) | FU-T02 |

## 4. Ruta canonica reconstruida

```text
commercial decision
  -> follow-up planner            [parallel: el modulo dedicado (follow-up-planner) no es el que corre;
                                    el que corre es la logica inline de sales-consultative/engine.ts]
  -> policy evaluation            [disconnected: evaluateCommercialPolicy corre en shadow, no gatea el write]
  -> schedule_followup            [disconnected respecto de policy; connected como llamada interna del engine]
  -> crm_agent_actions            [connected: repository.ts:206-393 (upsertActionRow)]
  -> follow-up worker             [connected: runFollowupTick.ts selectDueFollowUps matchea action_type/status]
  -> runNativeAutonomousCycle     [connected: runFollowupTick.ts:175, no es mensaje enlatado]
  -> action/outbox                [partial: solo 2 de 9 action types son outbox-backed
                                    (execution-bridge:97-99), y depende de 4 flags]
  -> Meta                         [partial: brain_message_outbox si recibe el insert, pero solo se envia
                                    si el proceso worker:outbox esta corriendo por separado - nada lo garantiza]
  -> sent/delivered/failed        [connected: applyMetaDeliveryStatus]
  -> opportunity/outcome update   [disconnected: dead-end en crm_action_outcomes/brain_message_outbox]
```

No se considero ninguna flecha "connected" solo porque existieran tipos o documentacion: cada veredicto arriba cita el caller real encontrado en la seccion 6 y en los reportes de investigacion que respaldan este documento.

## 5. Planners paralelos encontrados

Se encontraron **cinco** implementaciones de decision de follow-up, no dos:

1. `follow-up-planner/planFollowUp.ts` - real, testeado, calculo correcto de attempt/policy, pero solo preview de UI (`parallel`, ver seccion 3).
2. `sales-consultative/engine.ts` + `repository.ts` - el unico conectado al inbound real y a persistencia (`canonical`), cadencia 1/3/7/4 dias por keyword, sin lectura de attempt/max/cooldown real.
3. `autonomous-loop/evaluateAutonomousLoop.ts` (+ `follow-up-scheduling/`, `follow-up-replanning/`) - cooldowns hardcodeados de 30 minutos, solo alcanzable desde `scenario-simulator` (paginas `/dev`), no desde `native-whatsapp/service.ts` ni `processInbound.ts`.
4. `multi-request/requestFollowups.ts` - `delayMinutes` por tipo de request, cero callers productivos (`dead`).
5. `policy/evaluateCommercialPolicy.ts` - gobierna al sales-agent LLM, solo corre en shadow mode, nunca gatea el write de follow-up.

**Planner recomendado como canonico**: `follow-up-planner/planFollowUp.ts` para el calculo de `attemptNumber`/`maxAttempts`/estado de politica (es el unico con logica correcta y testeada), pero manteniendo `sales-consultative/engine.ts` como el disparador real (es el que ya esta conectado al inbound con contexto de oportunidad real). La recomendacion no es reemplazar el trigger, es dejar de hardcodear su calculo. `autonomous-loop` y `requestFollowups.ts` deben aislarse o eliminarse (FU-T05); no tienen caller productivo y no deben confundirse con cobertura real.

No se encontro codigo legacy de AI SDR follow-up bajo `lib/brain/commercial/sales-agent/**`; ese directorio es solo prompt/validacion del proveedor LLM, sin logica de scheduling.

## 6. Hipotesis verificadas

### 6.1 Persistencia incompleta

Confirmado. `sales-consultative/repository.ts:275-276` hardcodea `attempt_number: 1` y `max_attempts: 1` en cada insert; `repository.ts:280` hardcodea `policy_status: "allowed"` sin evaluacion previa. Peor aun: el idempotency key (`repository.ts:228`, `sales-action:{opportunityKey}:{actionType}`) no tiene scope temporal ni de status - una vez que existe una fila `schedule_followup` para una oportunidad, todo intento futuro se resuelve como `existing_action_reused` sin importar si esa fila ya fue ejecutada, cancelada o expirada (`repository.ts:230-236`). Efecto neto: no existe cadencia multi-intento real en el path que corre hoy; un cliente puede recibir, como maximo, un unico follow-up durable por oportunidad, para siempre. `lib/brain/commercial/execution-bridge/runCommercialExecutionBridge.ts:65` repite el mismo patron (`maxAttempts: 1` hardcodeado).

### 6.2 Worker

- **Claim atomico**: si. `markFollowUpExecuting` (`runFollowupTick.ts:68-76`) es un `UPDATE ... WHERE status = 'planned'` verificado por `affectedRows`, un CAS real sobre InnoDB.
- **Dos workers concurrentes**: el claim primario es race-free (uno gana, el otro hace `continue`). Existe un riesgo no confirmado (plausible, no reproducido): `cancelFollowUp` (`runFollowupTick.ts:61-66`) es un `UPDATE` sin precondicion de status, a diferencia de los writes de completado que si exigen `WHERE status = 'executing'`. Una interleaving de dos workers (uno gana el claim, otro evalua cancelacion sobre la misma fila) podria dejar el registro en `cancelled` mientras el ciclo ya se ejecuto.
- **Accion abandonada en `executing`**: no hay recuperacion. No existe columna de lock-timestamp, TTL ni proceso reaper para `schedule_followup`. `selectDueFollowUps` solo selecciona `status = 'planned'`, asi que una fila que quede en `executing` por un crash del worker queda invisible para siempre. Contraste directo: `lib/brain/messaging/outboxWorker.ts` si implementa `isStaleLockedTimestamp`/`selectStaleLockedOutboxCandidates` para su propio `locked`/`sending`.
- **Retry de `failed`**: no existe. La transicion a `failed` es terminal; `selectDueFollowUps` nunca selecciona `status = 'failed'`.
- **Maximo de intentos**: la columna existe (`attempt_number`/`max_attempts`, migracion 005) pero `runFollowupTick.ts` nunca la lee ni la incrementa - el techo esta "declarado en el schema", no "enforced por el worker".
- **Correlacion**: real. `correlationId = followup:{action_id}:{timestamp}` (`runFollowupTick.ts:172`) se propaga a `crm_agent_decisions.correlation_id` y de ahi a `decision_id`/`action_id` en la nueva fila de accion y en `brain_message_outbox.meta_payload_json`. La cadena es reconstruible via joins, no via un unico valor grepeable.
- **Deduplicacion / stale locks**: cubierto para el claim (ver arriba); no cubierto para locks abandonados (ver punto 3).

### 6.3 Contact policy

Ver tabla de la seccion 3 y la fila "Opt-out / quiet hours / identity conflict". Resumen: `consent.allowFollowUp` no existe como campo en ningun lado; opt-out, quiet hours e identity conflict son reales solo dentro de `evaluateCommercialPolicy.ts` (shadow-only); human-owner-active, ai-paused, conversation-closed y opportunity-terminal si estan `enforced-at-dispatch` y testeados dentro de `runFollowupTick.ts:78-125` (`shouldCancelFollowUp`, con tests en `tests/commercial/runFollowupTick.test.ts`); frequency cap per customer no existe en ningun lado; frequency cap per opportunity esta roto en el path real (ver 6.1); max attempts es real solo en el planner no conectado (`follow-up-planner`).

### 6.4 Cancelacion

Confirmado: es **lazy**, no eager, para `schedule_followup`. `processNativeWhatsAppInbound` (`lib/brain/native-whatsapp/service.ts:856-1065`) nunca consulta ni cancela `crm_agent_actions` al persistir un inbound. La unica cancelacion inmediata (`lib/domains/conversations/control.ts:75-95`, misma transaccion que take/pause/close) excluye explicitamente `action_type = 'schedule_followup'` de su `WHERE`. La cancelacion real de follow-up ocurre solo dentro de `shouldCancelFollowUp`, evaluada por el worker justo antes de re-entrar al ciclo (`runFollowupTick.ts:78-125`), documentado en el propio codigo como "checked before re-entry". Esto es un diseno deliberado y funcional (evita condiciones de carrera de cancelar-antes-de-tiempo), pero significa que el estado visible de la fila (`status = 'planned'`) no refleja en tiempo real un takeover/pausa/cierre hasta que el tick corre.

### 6.5 Outbox y envio

`runFollowupTick` no produce unicamente una nueva decision: la cadena real llega a un `INSERT` en `brain_message_outbox` via `execution-bridge -> execution-gate -> SqlOutboxRepository.insertCommand` (`sqlExecutionUnitOfWork.ts:88-152`), condicionado a que la re-evaluacion LLM/policy elija una accion de tipo `send_whatsapp_reply`/`request_more_context` (2 de 9 tipos) y a 4 flags (`executionGateEnabled`, `outboxBridgeEnabled`, etc.). El envio real a Meta ocurre en un **proceso separado** (`worker:outbox` / `scripts/autonomous-outbox-worker.ts`) que nadie fuerza a correr junto al `worker:followup`. Flags requeridas confirmadas por `scripts/autonomous-followup-worker.ts:53-68`: el worker de follow-up auto-activa (solo si no estan seteadas) `BRAIN_SALES_AGENT_ENABLED`, `BRAIN_COMMERCIAL_SHADOW_ENABLED`, `BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER`, `BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED`, `BRAIN_AGENT_ACTION_QUEUE_ENABLED`, `BRAIN_EXECUTION_GATE_ENABLED`, `BRAIN_OUTBOX_BRIDGE_ENABLED`, entre otras - todas documentadas como `false` por defecto en `.env.example`. El worker de outbox, por separado, auto-activa `BRAIN_META_SEND_ENABLED`/`BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND` (`scripts/autonomous-outbox-worker.ts:56-60`). Ninguno de los dos scripts fuerza los flags del otro; nada en el repo exige correr ambos juntos.

### 6.6 Shadow flags

`BRAIN_COMMERCIAL_SHADOW_ENABLED` y `BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER` son una **dependencia real del runtime en vivo**, no un flag muerto: el primero decide si la etapa de evaluacion corre en absoluto (`commercialCycleConfig.ts:47-68`, `isAutonomyCycleEnabled` en `runNativeAutonomousCycle.ts:95-101`); el segundo decide si se llama al proveedor LLM real (`runCommercialShadowEvaluation.ts:37-44`). Es **naming debt**, no semantica muerta ni dependencia oculta: el vocabulario (`shadowConstants.ts:32-37`, `COMMERCIAL_SHADOW_MODES = ["shadow","fixture","dry_run"]`) delata un origen de "modo sombra" comparativo, pero en la ruta nativa actual esta etapa es la unica y autoritativa tomadora de decision - no esta "sombreando" nada. El propio `docs/audits/autonomous-commerce-current-state-audit.md` (linea 502, historico, no se modifica) ya advertia de esta confusion ("hay dos familias de runtime: legacy/shadow y native/commercial") y listaba una meta de "eliminar completamente legacy/shadow/mock" (linea 124) que a la fecha de esta reconciliacion no se ha ejecutado. No se renombra ni se elimina el flag en este documento.

### 6.7 Seguridad

- `draft_payload_json`/`draft_message` persisten texto crudo del cliente (`repository.ts:263-271`, `buildAgentAction.ts:380-384`); el unico sanitizador (`sanitizeAgentActionJsonValue`, `serializeAgentAction.ts:20-120`) redacta solo claves con forma de credencial (`token`, `secret`, `password`, etc.), no PII embebida en el texto libre.
- `execution_payload_json` siempre es `null` en los escritores encontrados (ejecucion deshabilitada en este milestone).
- `failure_reason` tiene manejo inconsistente: `action-queue/persistAgentAction.ts` (`sanitizeError`) y `operational-loop/runCommercialOperationalLoop.ts` (`buildSafeError`) redactan `Bearer <token>`/`sk-...`/`authorization|api-key|token|secret|password|cookie`; pero `runFollowupTick.ts:199-205` y `persistActionOutcome.ts:119-131` (`markActionFailed`) escriben `error.message` / `errorCode` **sin ninguna redaccion**. Un error de driver/red que incluyera un connection string o un header terminaria persistido sin sanitizar.
- No se encontro fuga de `META_WHATSAPP_ACCESS_TOKEN` en ningun log o columna; solo se usa en el header `Authorization`.
- `app/api/brain/outbox/worker/route.ts` expone, detras de auth, un modo `debug: true` que retorna `message_text_preview` (hasta 160 caracteres del mensaje del cliente) - superficie de PII gateada por autenticacion, no una fuga abierta, pero digna de nota.

### 6.8 Idempotencia

Real dentro de cada escritor individual (unique keys en `action_id`/`idempotency_key`, migracion 005; `INSERT IGNORE` + lookup previo en los 4 escritores de `crm_agent_actions`; `buildDedupeKey`/`findOutboxByDedupeKey` en `outbox.ts` y una segunda clave (`outbox:action:{actionId}:{idempotencyKey}`) en el execution-gate). **No** hay idempotencia cruzada entre los 4 escritores de `crm_agent_actions` (namespaces de key disjuntos) ni entre los 2 escritores de `brain_message_outbox` (logica de dedupe divergente). El claim atomico del worker de follow-up y el lock/CAS del worker de outbox si son robustos frente a reinicio/retry del mismo proceso.

## 7. Tests ejecutados

Comandos exactos de la seccion 9 de la tarea, ejecutados en este entorno (sin Docker/MariaDB disponibles - `docker ps` falla con "no se puede conectar al daemon"):

```text
npx tsx --test tests/commercial/followUpPlanner.test.ts
  -> 18 tests, 18 pass, 0 fail

npx tsx --test tests/commercial/runFollowupTick.test.ts
  -> 9 tests, 0 pass, 9 fail (ECONNREFUSED 127.0.0.1:3306 en cada seed de conversacion real)

npx tsx --test tests/commercial/actionLifecycleContract.test.ts tests/commercial/actionQueueViewModel.test.ts \
  tests/commercial/agentActionQueue.test.ts tests/commercial/sales-consultative.test.ts \
  tests/commercial/sales-consultative-service.test.ts tests/commercial/outboxWorker.test.ts \
  tests/commercial/requestFollowups.test.ts tests/commercial/deferredActions.test.ts \
  tests/native/outbox-ownership.test.ts
  -> 122 tests, 107 pass, 15 fail
     fallas: requestFollowups.test.ts (6), deferredActions.test.ts (3), outbox-ownership.test.ts (6)
     todas por ECONNREFUSED 127.0.0.1:3306 (mismo motivo: sin MariaDB local en este entorno)
```

No se declara cobertura donde no existe: los 9 tests de `runFollowupTick.test.ts` (claim atomico, cancelacion, CAS de completado) y los 6 de `outbox-ownership.test.ts` (ownership del outbox, delivery, retry) **no pudieron ejecutarse contra DB real en esta sesion** - son tests de integracion reales (siembran conversaciones via `processNativeWhatsAppInbound` contra MariaDB), no mocks, y su ausencia de verificacion aqui es una limitacion de este entorno, no evidencia de que el codigo este roto. Los que si corrieron y pasaron (`followUpPlanner`, `actionLifecycleContract`, `actionQueueViewModel`, `agentActionQueue`, `sales-consultative*`, `outboxWorker.test.ts`) usan mocks/adapters en memoria - exactamente la capa donde los hardcodes de la seccion 6.1 y las condiciones de carrera de la seccion 6.2 son invisibles.

## 8. Arquitectura recomendada

Una unica cadena, reutilizando el maximo posible de lo ya construido:

```text
sales-consultative/engine.ts (trigger real, conectado a inbound)
  -> follow-up-planner/planFollowUp.ts (attempt/cooldown/policy status, ya testeado)
  -> policy/evaluateCommercialPolicy.ts (gate real de opt-out/quiet-hours/identity-conflict, hoy shadow-only)
  -> sales-consultative/repository.ts (persistencia, corrigiendo hardcodes e idempotency key)
  -> autonomous-followup-worker.ts / runFollowupTick.ts (hardened: stale-lock + retry + guard en cancelFollowUp)
  -> runNativeAutonomousCycle (sin cambios, ya es re-entrada real)
  -> un unico outbox writer (consolidar execution-gate y outbox.ts)
  -> autonomous-outbox-worker.ts -> metaClient.ts (sin cambios, ya es real)
  -> applyMetaDeliveryStatus (extendido hasta crm_opportunities)
```

`follow-up-planner`, `multi-request/requestFollowups.ts`, `autonomous-loop` (relativo a produccion) y el modulo `outbox-worker/` hyphenated no se descartan como codigo, pero dejan de contarse como "cobertura productiva" hasta que se conecten o se aislen explicitamente como simulador/legacy.

## 9. Gaps priorizados

**P0 - impide follow-up productivo confiable:**

- P0-1: `attempt_number`/`max_attempts`/`policy_status` hardcodeados en el path real (`sales-consultative/repository.ts:275-280`) mas idempotency key sin scope temporal (`repository.ts:228-236`) - un cliente recibe, como maximo, un follow-up durable por oportunidad, para siempre.
- P0-2: sin recuperacion de stale-lock para acciones abandonadas en `executing` (comparar con `outboxWorker.ts`'s `isStaleLockedTimestamp`, que si existe).
- P0-3: sin retry de `failed` ni enforcement de `max_attempts` por el worker (columnas existen, nunca se leen en `runFollowupTick.ts`).
- P0-4: opt-out/quiet-hours/identity-conflict reales existen (`evaluateCommercialPolicy.ts`) pero nunca gatean el write real - un cliente que se dio de baja puede recibir un follow-up igual.

**P1 - riesgo operacional o de privacidad:**

- P1-1: `cancelFollowUp` sin precondicion de status (`runFollowupTick.ts:61-66`) - race plausible (no reproducida) entre claim y cancelacion concurrentes.
- P1-2: `failure_reason` sin redactar en `runFollowupTick.ts:199-205` y `persistActionOutcome.ts:119-131`, mientras otros modulos hermanos (`persistAgentAction.ts`, `runCommercialOperationalLoop.ts`) si redactan.
- P1-3: delivery outcomes nunca llegan a `crm_opportunities` - el estado de oportunidad puede divergir silenciosamente de la realidad de entrega.
- P1-4: dos escritores de `brain_message_outbox` con logica de columnas/dedupe divergente (`outbox.ts` vs `sqlExecutionUnitOfWork.ts`).
- P1-5: `worker:followup` y `worker:outbox` auto-escalan, cada uno por separado y en silencio, un bloque grande de flags de produccion cuando no estan seteadas - un operador que arranca solo uno de los dos obtiene un pipeline parcialmente vivo sin aviso.

**P2 - deuda de consolidacion:**

- P2-1: 5 implementaciones paralelas de decision de follow-up con 4 esquemas de cooldown distintos, sin fuente unica.
- P2-2: `multi-request/requestFollowups.ts` es codigo muerto (cero callers productivos) pese a tener persistencia y tests propios.
- P2-3: 4 escritores independientes de `crm_agent_actions` con namespaces de idempotency key disjuntos.
- P2-4: `docs/product/ai-sdr-follow-up-planner.md` y `docs/product/follow-up-decision-policy.md` describen dos sistemas de tipos que no se solapan, y ninguno menciona la implementacion realmente conectada (`sales-consultative`).
- P2-5: el modulo `outbox-worker/` hyphenated (con transportes fake) es maquinaria duplicada, alcanzable solo desde un simulador `/dev`.

**P3 - mejora posterior:**

- P3-1: `metaSendAdapter.ts` (envio con guards de politica) no es usado por ningun worker productivo - ambos llaman `metaClient.ts` directo.
- P3-2: el `correlationId` de follow-up no se persiste como columna propia; reconstruir la traza requiere joins por `decision_id`/`action_id`.
- P3-3: `sanitizeResponseBody` en `metaClient.ts` no redacta nada pese a su nombre - riesgo latente para el proximo caller.

## 10. Proximas tareas propuestas (no implementadas en este documento)

- `FU-T01` - Consolidar planner y persistencia: hacer que `sales-consultative` derive `attemptNumber`/`maxAttempts`/`policy_status` desde `follow-up-planner/planFollowUp.ts` en vez de hardcodear 1/1/"allowed"; corregir la idempotency key para que sea temporal/status-aware.
- `FU-T02` - Completar contact policy: conectar `evaluateCommercialPolicy` (opt-out, quiet hours, identity conflict) como gate obligatorio antes de `upsertActionRow`, no solo shadow-advisory.
- `FU-T03` - Hardening del worker: recuperacion de stale-lock para `executing`, retry de `failed` con enforcement real de `max_attempts`, y precondicion de status en `cancelFollowUp`.
- `FU-T04` - Conectar outbox y delivery outcomes: consolidar los dos escritores de `brain_message_outbox` en uno, y extender `applyMetaDeliveryStatus` hasta actualizar `crm_opportunities`.
- `FU-T05` - Aislar o eliminar codigo muerto/paralelo: `multi-request/requestFollowups.ts`, la familia `autonomous-loop` relativa a produccion, el modulo `outbox-worker/` hyphenated; y reconciliar `ai-sdr-follow-up-planner.md`/`follow-up-decision-policy.md` con la implementacion real.
- `FU-T06` - Redactar errores de forma consistente en todos los sitios de `failure_reason`, y reconciliar los flags auto-escalados de los dos workers contra los defaults documentados en `.env.example`.
- `FU-T07` - E2E productivo y restart recovery, una vez cerrados `FU-T01`..`FU-T04` (mismo patron que el harness existente de identity onboarding).

Los IDs y el orden se derivan de los hallazgos reales de este documento, no de una plantilla generica.

## 11. Decision de reutilizacion

Sobre los ~16 componentes de la matriz de la seccion 3:

- **Reutilizable sin cambios (~31%)**: tabla `crm_agent_actions`, el claim atomico del follow-up worker, la re-entrada a `runNativeAutonomousCycle`, el Meta sender (`metaClient.ts`), la escritura base de delivery outcomes.
- **Reutilizable con cambios (~44%)**: `follow-up-planner` (necesita conectarse), `evaluateCommercialPolicy` (necesita ser gate, no shadow), `sales-consultative` (necesita corregir hardcodes), el outbox bridge (necesita consolidarse a un escritor), delivery outcomes (necesita llegar a opportunity), cancelacion por inbound (necesita cubrir `schedule_followup`), el worker (necesita stale-lock/retry).
- **Eliminar o aislar (~19%)**: `multi-request/requestFollowups.ts`, la familia `autonomous-loop` relativa a produccion, el modulo `outbox-worker/` hyphenated con sus transportes fake, `metaSendAdapter.ts` como wrapper no usado.
- **Faltante (~6%)**: frequency cap por customer (no existe en ningun lado), propagacion de delivery outcome hasta `crm_opportunities`.

Porcentajes derivados del conteo de componentes de la seccion 3, no arbitrarios; un componente que aparece en mas de una categoria (p.ej. delivery outcomes) se cuenta una sola vez segun su clasificacion primaria en la tabla.

## 12. Estado documental final

```text
ACS-R1-04-T08 -> blocked_external
Customer Service -> PAUSED_EXTERNAL
Follow-up reconciliation -> completed
Follow-up implementation -> not_started, pendiente de hallazgos (se refiere a FU-T01..FU-T07; el runtime
  existente ya descrito arriba no es "no implementado" - es parcial, con gaps P0/P1 documentados)
Address Book -> DEFERRED
Voice -> DEFERRED
ACS-R1-04-T09 -> ready, no iniciada
```

Ninguna capability cambia a `operational: verified` en `docs/CAPABILITY_MATRIX.md` como resultado de este documento. El follow-up autonomo no queda declarado operativo, verificado ni aceptado.
