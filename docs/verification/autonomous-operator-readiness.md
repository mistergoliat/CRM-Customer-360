---
title: Autonomous Operator Readiness Verification
doc_id: audit-autonomous-operator-readiness
status: historical
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
source_of_truth_for:
  - verification evidence
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - verification
  - historical
---
# Autonomous Operator Readiness â€” Verification Report

> Fecha: 2026-07-01
> Rama: `ai/claude/pr-14-autonomous-native`
> Alcance: sistema comercial autÃ³nomo end-to-end (inbound nativo WhatsApp â†’ ciclo autÃ³nomo â†’ outbox â†’ worker â†’ delivery â†’ workspace del operador).
> Todo lo declarado en este documento estÃ¡ respaldado por comandos reproducibles listados en cada secciÃ³n. No se enviÃ³ ningÃºn mensaje a clientes reales durante la verificaciÃ³n.

## 1. Resumen ejecutivo

El flujo end-to-end quedÃ³ operativo y verificado en el entorno local:

- Un inbound de WhatsApp (payload Meta) se persiste exactamente una vez, resuelve identidad/conversaciÃ³n, ejecuta el ciclo autÃ³nomo con LLM real, produce una decisiÃ³n auditable (`crm_agent_decisions`), una acciÃ³n gobernada (`crm_agent_actions`) y un mensaje en outbox (`brain_message_outbox`).
- El worker de outbox envÃ­a con revalidaciÃ³n de ownership inmediatamente antes del envÃ­o, retry con backoff exponencial para fallos transitorios, y escalamiento terminal con `ActionOutcome` + auditorÃ­a.
- Los webhooks de delivery proyectan estados de forma monotÃ³nica e idempotente.
- El operador puede tomar control, responder manualmente, pausar la IA, devolver el control, cerrar y reabrir â€” todo garantizado por backend y base de datos (transacciones + compare-and-swap), no por UI.
- La exclusiÃ³n IA/operador estÃ¡ protegida contra carreras: la toma de control cancela atÃ³micamente las respuestas autÃ³nomas pendientes, y el worker revalida ownership tras reclamar cada fila.

## 2. Diagrama textual del flujo final

```text
Meta webhook (POST /api/integrations/whatsapp/webhook)
  â†’ verificaciÃ³n HMAC sha256 (fail-closed en producciÃ³n) + allowlist
  â†’ processNativeWhatsAppInbound  [lib/brain/native-whatsapp/service.ts]
      dedupe por provider_message_id â†’ identidad (master_customer + external identity,
      detecciÃ³n de conflicto PR-03A) â†’ TX{ conversation upsert (preserva ownership,
      reabre si estaba cerrada) + conversation_message + commercial_event } â†’ audit
  â†’ runNativeAutonomousCycle  [lib/brain/commercial/native-cycle/]
      buildNativeCommercialContext â†’ shim (resolver_identity, contexto multivuelta,
      acciones pendientes/completadas, opportunity.waiting_for)
      â†’ shadow (LLM real + policy) â†’ operational loop (decisiÃ³n â†’ crm_agent_decisions,
      crm_opportunities con conversation_case_id enlazado) â†’ execution bridge
      (crm_agent_actions + brain_message_outbox 'planned' con phone_number_id
      derivado de conversation.channel_account_id)
  â†’ runOutboxTick  [lib/brain/messaging/autonomousOutboxTick.ts]  (worker:outbox)
      claim atÃ³mico plannedâ†’locked â†’ REVALIDACIÃ“N pre-envÃ­o (ownership humano,
      IA pausada, conversaciÃ³n cerrada, ventana 24h) â†’ allowlist â†’ send Meta
      â†’ sent | retry(planned + next_attempt_at, backoff exponencial) | failed(terminal)
      â†’ crm_action_executions (1 por intento) + crm_action_outcomes + canonical
        conversation_message + crm_agent_actions status
  â†’ applyMetaDeliveryStatus  (webhook statuses)
      proyecciÃ³n monotÃ³nica (sentâ†’deliveredâ†’read, failed terminal; nunca regresa)
      sobre conversation_message + brain_message_outbox.provider_status
      + commercial_event + ActionOutcome (solo si la proyecciÃ³n aplicÃ³ â†’ sin duplicados)
  â†’ runFollowupTick  [lib/brain/commercial/followup/runFollowupTick.ts]  (worker:followup)
      selecciÃ³n por scheduled_for â†’ cancela si cliente respondiÃ³ / owner humano /
      IA pausada / conversaciÃ³n cerrada / oportunidad terminal â†’ CAS plannedâ†’executing
      â†’ re-entra al ciclo â†’ executed/failed
  â†’ UI  [app/(hub)/conversations/[id] + components/conversations/workspace/]
      loadConversationThread (merge conversation_message + outbox, dedupe por
      provider_message_id) + loadConversationAutonomousState + controles de operador
      (POST /api/conversations/[id]/control) + composer manual
      (POST /api/conversations/[id]/reply) + paginaciÃ³n (GET .../messages)
```

## 3. Tabla por Ã¡rea

| Ãrea | Estado | Evidencia |
|---|---|---|
| Inbound Ãºnico e idempotente (webhook duplicado) | passed | harness F; tests `native-whatsapp.test.ts` |
| Identidad y conversaciÃ³n (reuso, conflictos) | passed | harness B; tests `identity-conflict.test.ts` |
| Ciclo autÃ³nomo con LLM real â†’ decisiÃ³n â†’ acciÃ³n â†’ outbox | passed | harness A/B en modo live (10/10) |
| Contexto multivuelta (mensajes recientes, acciones, waiting_for) | passed | shim `buildNativeBrainContextShim` + harness B (decisiones en 2 turnos) |
| Outbox seguro: claim atÃ³mico, idempotencia por dedupe_key | passed | harness A/D/G; tests `outbox-ownership.test.ts` |
| Ownership IA/humano atÃ³mico (backend + DB) | passed | harness C/D; tests `conversationControl.test.ts` |
| Carrera IA vs operador | passed | harness D; test "worker re-validates ownership" |
| Respuesta manual del operador | passed | harness C; validaciÃ³n visual (composer real) |
| Retry con backoff + escalamiento terminal | passed | harness G; tests retry/exhaustion |
| Delivery monotÃ³nico e idempotente | passed | harness A/F; test delivery duplicado |
| Follow-up: ejecuciÃ³n, no-duplicaciÃ³n (CAS), cancelaciÃ³n | passed | harness E; `runFollowupTick` |
| Cierre / reapertura por inbound | passed | harness I; test escenario I |
| Ventana WhatsApp 24h (bloqueo backend manual + IA) | passed | harness H; tests window |
| Datos incompletos (sin cliente/oportunidad/acciones) | passed | harness J |
| Workspace del operador (render + controles + APIs) | passed | validaciÃ³n visual contra dev server (8/8 marcadores, endpoints 200) |
| Templates para ventana cerrada | blocked (externo) | no implementado; el backend bloquea texto libre explÃ­citamente y la UI lo dice sin botones falsos |
| Transferencia / asignaciÃ³n entre operadores | partial | sin backend de directorio de operadores; botÃ³n deshabilitado con motivo explÃ­cito |
| Adjuntos (media inbound/outbound) | partial | tipo de mensaje se persiste; no hay descarga/render de media |
| EnvÃ­o real vÃ­a Meta | blocked (externo) | requiere allowlist `BRAIN_AUTONOMOUS_TEST_WA_IDS` con nÃºmero autorizado (ver Â§12) |

## 4. Evidencia por comando

| Comando | Resultado |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | 0 errores (36 warnings preexistentes) |
| `npm test` (`tsx --test tests/**/*.test.ts`) | 607/607 pass (594 baseline + 13 nuevos) |
| `npm run build` | build de producciÃ³n exitoso |
| `npm run db:migrate` | 014 aplicada; 0 pendientes |
| `npm run e2e:autonomous` (LLM real) | 10/10 PASS |
| `npm run e2e:autonomous -- --skip-llm` | 10/10 PASS |
| ValidaciÃ³n visual (login + pÃ¡gina + APIs contra dev server) | 8/8 marcadores OK; `/messages`, `/autonomous`, `/control` â†’ 200 |

## 5. Defectos P0 encontrados y corregidos

1. **Cada inbound reseteaba `ai_enabled=1, human_owner_active=0`** (`createOrUpdateNativeConversation` ON DUPLICATE): si el operador habÃ­a tomado control y el cliente respondÃ­a, la IA recuperaba el control silenciosamente. Corregido: el inbound nunca toca los flags de ownership; sÃ­ reabre una conversaciÃ³n cerrada (polÃ­tica de reapertura).
2. **Mezcla de identidad entre clientes** (`loadCommercialState.buildCandidateWhereClause`): `channel='whatsapp'` estaba en el OR de identidad, de modo que cada bÃºsqueda matcheaba TODAS las oportunidades WhatsApp de la tabla (estado comercial de un cliente contaminaba a otro; la clase exacta de incidente legacy prohibida). Corregido: el canal es filtro AND, nunca ancla de identidad.
3. **Oportunidades nuevas sin enlace a conversaciÃ³n** (`reduceCommercialState`): `conversationCaseId` nunca caÃ­a al inbound actual â†’ `crm_opportunities.conversation_case_id = NULL`, rompiendo HUB, follow-ups y panel autÃ³nomo. Corregido con fallback al inbound/case actual.
4. **Bridge escribÃ­a outbox sin `phone_number_id`** (`sqlExecutionUnitOfWork`, NULL hardcodeado): el worker no podÃ­a enviar ninguna respuesta autÃ³noma. Corregido: se deriva de `conversation.channel_account_id` con fallback a `META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID`.
5. **Shim nativo sin `resolver_identity`** â†’ TypeError en el shadow (`identity_type` de undefined) que abortaba el ciclo en fail-safe. Corregido en el shim + lectura defensiva.
6. **`affectedRows` siempre 0 sobre `safeQueryRows`**: el CAS del follow-up worker nunca reportaba Ã©xito â†’ follow-ups quedaban en `executing` para siempre; el worker de outbox habrÃ­a auditado `sent_after_cancel` en cada envÃ­o. Corregido con `safeExecute` en `lib/db` y migrando los call sites.
7. **Outcome duplicado por webhook de delivery repetido**: `recordDeliveryOutcome` corrÃ­a aunque la proyecciÃ³n monotÃ³nica no aplicara. Corregido: solo se registra outcome cuando la proyecciÃ³n aplicÃ³.
8. **Deriva de timezone en lecturas de DATETIME**: el pool convertÃ­a fechas UTC almacenadas como hora local (ventana de 24h calculada mal por horas). Corregido con `timezone: "Z"` en el pool, alineado con la convenciÃ³n de escritura (strings UTC).
9. **Sin retry para fallos transitorios de Meta**: un error de red marcaba `failed` terminal y el mensaje se perdÃ­a. Corregido con `attempt_count`/`next_attempt_at` (migraciÃ³n 014) + backoff exponencial + lÃ­mite + escalamiento.
10. **Sin revalidaciÃ³n de ownership pre-envÃ­o en el worker**: implementada en `runOutboxTick` (cierre, ownership humano, IA pausada, ventana), con cancelaciÃ³n auditada y detecciÃ³n de la carrera residual (`outbox.sent_after_cancel`).

## 6. Archivos modificados / creados

**Nuevos (esta sesiÃ³n):**
- `migrations/014_outbox_retry_backoff.sql`
- `lib/domains/conversations/control.ts` â€” transiciones canÃ³nicas take/release/pause/close/reopen
- `lib/brain/messaging/autonomousOutboxTick.ts` â€” tick compartido de outbox (worker, tests, harness)
- `lib/brain/commercial/followup/runFollowupTick.ts` â€” tick compartido de follow-up
- `app/api/conversations/[id]/control/route.ts`
- `components/conversations/workspace/ConversationControls.tsx`
- `scripts/e2e-autonomous-harness.ts` + npm script `e2e:autonomous`
- `tests/native/outbox-ownership.test.ts` (7 tests)
- `tests/domains/conversationControl.test.ts` (7 tests)

**Modificados (esta sesiÃ³n):**
- `lib/brain/native-whatsapp/service.ts` â€” ownership preservado en inbound, reapertura, outcome idempotente
- `lib/brain/commercial/operational-loop/loadCommercialState.ts` â€” canal como filtro AND
- `lib/brain/commercial/operational-loop/reduceCommercialState.ts` â€” enlace conversaciÃ³n
- `lib/brain/commercial/execution-gate/sqlExecutionUnitOfWork.ts` â€” phone_number_id real
- `lib/brain/commercial/native-cycle/buildNativeBrainContextShim.ts` â€” resolver_identity
- `lib/brain/commercial/shadow/runCommercialShadowEvaluation.ts` â€” lectura defensiva
- `lib/brain/commercial/action-queue/persistActionOutcome.ts` â€” outcomes de delivery con fallback de actionId, status `cancelled`
- `lib/brain/messaging/outboxWorker.ts` â€” selecciÃ³n respeta `next_attempt_at`
- `lib/db.ts` â€” `timezone: "Z"` + `safeExecute`
- `lib/audit.ts` â€” nuevas AuditAction de control/outbox
- `lib/domains/conversations/manual-reply.ts` â€” takeover compartido + ventana 24h + sendFn inyectable
- `lib/brain/local-ai-sdr/repository.ts` â€” mensajes `system` en timeline
- `scripts/autonomous-outbox-worker.ts`, `scripts/autonomous-followup-worker.ts` â€” delegan en los ticks compartidos
- `app/(hub)/conversations/[id]/page.tsx`, `ConversationHeader.tsx`, `ConversationComposer.tsx`, `types.ts` â€” controles reales, ventana por `last_inbound_at`
- `package.json` â€” scripts `test` y `e2e:autonomous`

(La rama tambiÃ©n contiene trabajo previo sin commitear de la sesiÃ³n anterior en dashboard/actions/opportunities/customers, preservado sin cambios.)

## 7. Migraciones

- `014_outbox_retry_backoff.sql`: agrega `attempt_count`, `next_attempt_at` e Ã­ndice `(status, next_attempt_at)` a `brain_message_outbox`. Aditiva, preserva datos; rollback = DROP de columnas/Ã­ndice (documentado en el archivo).
- Mantenimiento local: rebaseline del checksum de `013` en `schema_migrations` (el archivo fue editado despuÃ©s de aplicarse; mismo procedimiento documentado en `docs/operations/local-migration-checksum-drift-009-010.md`; tablas verificadas antes de tocar metadata).

## 8. Endpoints

- **Nuevo** `POST /api/conversations/[id]/control` â€” `{action: take|release|pause|close|reopen}`; 409 en transiciones invÃ¡lidas; requiere operador + escritura habilitada.
- Existentes verificados: `GET /api/conversations/[id]/messages` (paginaciÃ³n `before`), `GET /api/conversations/[id]/autonomous`, `POST /api/conversations/[id]/reply` (ahora rechaza 409 `window_closed` y toma control atÃ³micamente vÃ­a helper compartido).

## 9. Decisiones arquitectÃ³nicas tomadas

1. **Fuente canÃ³nica de ownership** = fila `conversation` (`ai_enabled`, `human_owner_active`, `status`), espejada a `crm_opportunities` para los gates de planificaciÃ³n. Coincide con ADR-003/ADR-006 (estado comercial fuera de prompts/workflows).
2. **PolÃ­tica de reapertura**: un inbound nuevo sobre conversaciÃ³n cerrada la reabre preservando ownership. Un inbound jamÃ¡s cambia ownership.
3. **Ventana 24h**: sin templates implementados, el backend bloquea texto libre fuera de ventana (manual 409; autÃ³nomo cancelado con `window_closed` + auditorÃ­a de escalamiento). La UI lo comunica sin ofrecer botones falsos.
4. **Identidad de mensaje entre capas**: `dedupe_key` (planificaciÃ³n/outbox) â†’ `provider_message_id` (envÃ­o/webhooks/timeline). El merge de timeline dedupa por `provider_message_id`; la fila persistida en `conversation_message` gana sobre la del outbox.
5. **Carrera residual workerâ†”operador**: si el operador cancela mientras la llamada al proveedor estÃ¡ en vuelo, el envÃ­o ya ocurriÃ³; se detecta (UPDATE con guard `status='locked'` no aplica) y se audita `outbox.sent_after_cancel` en vez de ocultarlo.
6. **Follow-ups con owner humano**: se cancelan (`human_owner_active`), no se posponen â€” una respuesta autÃ³noma pendiente es incompatible con el control humano (Escenario C.3).
7. **Ticks compartidos e inyectables** (`runOutboxTick`, `runFollowupTick`): una sola implementaciÃ³n para worker, tests y harness; el transporte es inyectable, eliminando mocks productivos.

## 10. Riesgos pendientes / deuda tÃ©cnica

- `crm_agent_actions.conversation_case_id` llega null en algunas acciones del bridge cuando la decisiÃ³n es interna (`take_over_case`); el enlace por oportunidad sÃ­ queda. Menor, afecta solo narraciÃ³n del panel.
- Los warnings del loop (`shadow_policy_failed`, `EVAL-*`) son ruidosos en modo `requires_review`; son observabilidad, no estado.
- El merge de timeline pagina por `created_at` sobre dos fuentes; con volÃºmenes muy altos convendrÃ­a un cursor compuesto.
- 36 warnings de lint preexistentes (unused vars en zonas legacy).
- `.tmp-commercial-tests-cjs/` contiene artefactos compilados viejos (no usados por el runner actual).

## 11. Bloqueos exclusivamente externos

1. **EnvÃ­o real por Meta**: `BRAIN_META_SEND_ENABLED=false` y sin allowlist. Para una prueba real controlada se necesita un nÃºmero de WhatsApp de prueba autorizado por el dueÃ±o del negocio.
2. **Webhook en producciÃ³n**: `META_WHATSAPP_APP_SECRET` y `META_WHATSAPP_VERIFY_TOKEN` no estÃ¡n configurados localmente (la verificaciÃ³n de firma es fail-closed en producciÃ³n). Deben venir de la app de Meta.
3. **Templates de WhatsApp**: requieren templates aprobados en Meta Business; hasta entonces el sistema bloquea texto libre fuera de ventana.

## 12. Pasos exactos para una prueba real controlada

```powershell
# 1. En .env.local (NO commitear):
#    BRAIN_AUTONOMOUS_TEST_WA_IDS=<numero_de_prueba_autorizado_solo_digitos>
#    BRAIN_META_SEND_ENABLED=true
#    (META_WHATSAPP_ACCESS_TOKEN y META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID ya existen)

# 2. Exponer el webhook (tunel) y configurarlo en Meta con:
#    META_WHATSAPP_VERIFY_TOKEN=<token elegido>   META_WHATSAPP_APP_SECRET=<app secret>

# 3. Levantar la app y los workers:
npm run dev:local
npm run worker:outbox      # allowlist activa: solo envÃ­a al nÃºmero de prueba
npm run worker:followup

# 4. Escribir por WhatsApp desde el nÃºmero de prueba y observar la conversaciÃ³n
#    en /conversations. Kill switch: BRAIN_META_SEND_ENABLED=false detiene todo envÃ­o.
```

## 13. Pasos exactos para reproducir la verificaciÃ³n local

```powershell
npm run db:up; npm run db:wait; npm run db:migrate
npm run typecheck; npm run lint; npm test; npm run build
npm run e2e:autonomous                 # ciclo con LLM real (BRAIN_MODEL_* en .env.local)
npm run e2e:autonomous -- --skip-llm   # variante determinista sin LLM
```

## 14. ConfirmaciÃ³n

Durante toda la sesiÃ³n `BRAIN_META_SEND_ENABLED` permaneciÃ³ en `false`, no existe allowlist configurada y cada envÃ­o del harness/tests pasÃ³ por un transporte falso en proceso. **No se enviÃ³ ningÃºn mensaje a clientes reales.**
