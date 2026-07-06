# Autonomous Operator Readiness — Verification Report

> Fecha: 2026-07-01
> Rama: `ai/claude/pr-14-autonomous-native`
> Alcance: sistema comercial autónomo end-to-end (inbound nativo WhatsApp → ciclo autónomo → outbox → worker → delivery → workspace del operador).
> Todo lo declarado en este documento está respaldado por comandos reproducibles listados en cada sección. No se envió ningún mensaje a clientes reales durante la verificación.

## 1. Resumen ejecutivo

El flujo end-to-end quedó operativo y verificado en el entorno local:

- Un inbound de WhatsApp (payload Meta) se persiste exactamente una vez, resuelve identidad/conversación, ejecuta el ciclo autónomo con LLM real, produce una decisión auditable (`crm_agent_decisions`), una acción gobernada (`crm_agent_actions`) y un mensaje en outbox (`brain_message_outbox`).
- El worker de outbox envía con revalidación de ownership inmediatamente antes del envío, retry con backoff exponencial para fallos transitorios, y escalamiento terminal con `ActionOutcome` + auditoría.
- Los webhooks de delivery proyectan estados de forma monotónica e idempotente.
- El operador puede tomar control, responder manualmente, pausar la IA, devolver el control, cerrar y reabrir — todo garantizado por backend y base de datos (transacciones + compare-and-swap), no por UI.
- La exclusión IA/operador está protegida contra carreras: la toma de control cancela atómicamente las respuestas autónomas pendientes, y el worker revalida ownership tras reclamar cada fila.

## 2. Diagrama textual del flujo final

```text
Meta webhook (POST /api/integrations/whatsapp/webhook)
  → verificación HMAC sha256 (fail-closed en producción) + allowlist
  → processNativeWhatsAppInbound  [lib/brain/native-whatsapp/service.ts]
      dedupe por provider_message_id → identidad (master_customer + external identity,
      detección de conflicto PR-03A) → TX{ conversation upsert (preserva ownership,
      reabre si estaba cerrada) + conversation_message + commercial_event } → audit
  → runNativeAutonomousCycle  [lib/brain/commercial/native-cycle/]
      buildNativeCommercialContext → shim (resolver_identity, contexto multivuelta,
      acciones pendientes/completadas, opportunity.waiting_for)
      → shadow (LLM real + policy) → operational loop (decisión → crm_agent_decisions,
      crm_opportunities con conversation_case_id enlazado) → execution bridge
      (crm_agent_actions + brain_message_outbox 'planned' con phone_number_id
      derivado de conversation.channel_account_id)
  → runOutboxTick  [lib/brain/messaging/autonomousOutboxTick.ts]  (worker:outbox)
      claim atómico planned→locked → REVALIDACIÓN pre-envío (ownership humano,
      IA pausada, conversación cerrada, ventana 24h) → allowlist → send Meta
      → sent | retry(planned + next_attempt_at, backoff exponencial) | failed(terminal)
      → crm_action_executions (1 por intento) + crm_action_outcomes + canonical
        conversation_message + crm_agent_actions status
  → applyMetaDeliveryStatus  (webhook statuses)
      proyección monotónica (sent→delivered→read, failed terminal; nunca regresa)
      sobre conversation_message + brain_message_outbox.provider_status
      + commercial_event + ActionOutcome (solo si la proyección aplicó → sin duplicados)
  → runFollowupTick  [lib/brain/commercial/followup/runFollowupTick.ts]  (worker:followup)
      selección por scheduled_for → cancela si cliente respondió / owner humano /
      IA pausada / conversación cerrada / oportunidad terminal → CAS planned→executing
      → re-entra al ciclo → executed/failed
  → UI  [app/(hub)/conversations/[id] + components/conversations/workspace/]
      loadConversationThread (merge conversation_message + outbox, dedupe por
      provider_message_id) + loadConversationAutonomousState + controles de operador
      (POST /api/conversations/[id]/control) + composer manual
      (POST /api/conversations/[id]/reply) + paginación (GET .../messages)
```

## 3. Tabla por área

| Área | Estado | Evidencia |
|---|---|---|
| Inbound único e idempotente (webhook duplicado) | passed | harness F; tests `native-whatsapp.test.ts` |
| Identidad y conversación (reuso, conflictos) | passed | harness B; tests `identity-conflict.test.ts` |
| Ciclo autónomo con LLM real → decisión → acción → outbox | passed | harness A/B en modo live (10/10) |
| Contexto multivuelta (mensajes recientes, acciones, waiting_for) | passed | shim `buildNativeBrainContextShim` + harness B (decisiones en 2 turnos) |
| Outbox seguro: claim atómico, idempotencia por dedupe_key | passed | harness A/D/G; tests `outbox-ownership.test.ts` |
| Ownership IA/humano atómico (backend + DB) | passed | harness C/D; tests `conversationControl.test.ts` |
| Carrera IA vs operador | passed | harness D; test "worker re-validates ownership" |
| Respuesta manual del operador | passed | harness C; validación visual (composer real) |
| Retry con backoff + escalamiento terminal | passed | harness G; tests retry/exhaustion |
| Delivery monotónico e idempotente | passed | harness A/F; test delivery duplicado |
| Follow-up: ejecución, no-duplicación (CAS), cancelación | passed | harness E; `runFollowupTick` |
| Cierre / reapertura por inbound | passed | harness I; test escenario I |
| Ventana WhatsApp 24h (bloqueo backend manual + IA) | passed | harness H; tests window |
| Datos incompletos (sin cliente/oportunidad/acciones) | passed | harness J |
| Workspace del operador (render + controles + APIs) | passed | validación visual contra dev server (8/8 marcadores, endpoints 200) |
| Templates para ventana cerrada | blocked (externo) | no implementado; el backend bloquea texto libre explícitamente y la UI lo dice sin botones falsos |
| Transferencia / asignación entre operadores | partial | sin backend de directorio de operadores; botón deshabilitado con motivo explícito |
| Adjuntos (media inbound/outbound) | partial | tipo de mensaje se persiste; no hay descarga/render de media |
| Envío real vía Meta | blocked (externo) | requiere allowlist `BRAIN_AUTONOMOUS_TEST_WA_IDS` con número autorizado (ver §12) |

## 4. Evidencia por comando

| Comando | Resultado |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | 0 errores (36 warnings preexistentes) |
| `npm test` (`tsx --test tests/**/*.test.ts`) | 607/607 pass (594 baseline + 13 nuevos) |
| `npm run build` | build de producción exitoso |
| `npm run db:migrate` | 014 aplicada; 0 pendientes |
| `npm run e2e:autonomous` (LLM real) | 10/10 PASS |
| `npm run e2e:autonomous -- --skip-llm` | 10/10 PASS |
| Validación visual (login + página + APIs contra dev server) | 8/8 marcadores OK; `/messages`, `/autonomous`, `/control` → 200 |

## 5. Defectos P0 encontrados y corregidos

1. **Cada inbound reseteaba `ai_enabled=1, human_owner_active=0`** (`createOrUpdateNativeConversation` ON DUPLICATE): si el operador había tomado control y el cliente respondía, la IA recuperaba el control silenciosamente. Corregido: el inbound nunca toca los flags de ownership; sí reabre una conversación cerrada (política de reapertura).
2. **Mezcla de identidad entre clientes** (`loadCommercialState.buildCandidateWhereClause`): `channel='whatsapp'` estaba en el OR de identidad, de modo que cada búsqueda matcheaba TODAS las oportunidades WhatsApp de la tabla (estado comercial de un cliente contaminaba a otro; la clase exacta de incidente legacy prohibida). Corregido: el canal es filtro AND, nunca ancla de identidad.
3. **Oportunidades nuevas sin enlace a conversación** (`reduceCommercialState`): `conversationCaseId` nunca caía al inbound actual → `crm_opportunities.conversation_case_id = NULL`, rompiendo HUB, follow-ups y panel autónomo. Corregido con fallback al inbound/case actual.
4. **Bridge escribía outbox sin `phone_number_id`** (`sqlExecutionUnitOfWork`, NULL hardcodeado): el worker no podía enviar ninguna respuesta autónoma. Corregido: se deriva de `conversation.channel_account_id` con fallback a `META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID`.
5. **Shim nativo sin `resolver_identity`** → TypeError en el shadow (`identity_type` de undefined) que abortaba el ciclo en fail-safe. Corregido en el shim + lectura defensiva.
6. **`affectedRows` siempre 0 sobre `safeQueryRows`**: el CAS del follow-up worker nunca reportaba éxito → follow-ups quedaban en `executing` para siempre; el worker de outbox habría auditado `sent_after_cancel` en cada envío. Corregido con `safeExecute` en `lib/db` y migrando los call sites.
7. **Outcome duplicado por webhook de delivery repetido**: `recordDeliveryOutcome` corría aunque la proyección monotónica no aplicara. Corregido: solo se registra outcome cuando la proyección aplicó.
8. **Deriva de timezone en lecturas de DATETIME**: el pool convertía fechas UTC almacenadas como hora local (ventana de 24h calculada mal por horas). Corregido con `timezone: "Z"` en el pool, alineado con la convención de escritura (strings UTC).
9. **Sin retry para fallos transitorios de Meta**: un error de red marcaba `failed` terminal y el mensaje se perdía. Corregido con `attempt_count`/`next_attempt_at` (migración 014) + backoff exponencial + límite + escalamiento.
10. **Sin revalidación de ownership pre-envío en el worker**: implementada en `runOutboxTick` (cierre, ownership humano, IA pausada, ventana), con cancelación auditada y detección de la carrera residual (`outbox.sent_after_cancel`).

## 6. Archivos modificados / creados

**Nuevos (esta sesión):**
- `migrations/014_outbox_retry_backoff.sql`
- `lib/domains/conversations/control.ts` — transiciones canónicas take/release/pause/close/reopen
- `lib/brain/messaging/autonomousOutboxTick.ts` — tick compartido de outbox (worker, tests, harness)
- `lib/brain/commercial/followup/runFollowupTick.ts` — tick compartido de follow-up
- `app/api/conversations/[id]/control/route.ts`
- `components/conversations/workspace/ConversationControls.tsx`
- `scripts/e2e-autonomous-harness.ts` + npm script `e2e:autonomous`
- `tests/native/outbox-ownership.test.ts` (7 tests)
- `tests/domains/conversationControl.test.ts` (7 tests)

**Modificados (esta sesión):**
- `lib/brain/native-whatsapp/service.ts` — ownership preservado en inbound, reapertura, outcome idempotente
- `lib/brain/commercial/operational-loop/loadCommercialState.ts` — canal como filtro AND
- `lib/brain/commercial/operational-loop/reduceCommercialState.ts` — enlace conversación
- `lib/brain/commercial/execution-gate/sqlExecutionUnitOfWork.ts` — phone_number_id real
- `lib/brain/commercial/native-cycle/buildNativeBrainContextShim.ts` — resolver_identity
- `lib/brain/commercial/shadow/runCommercialShadowEvaluation.ts` — lectura defensiva
- `lib/brain/commercial/action-queue/persistActionOutcome.ts` — outcomes de delivery con fallback de actionId, status `cancelled`
- `lib/brain/messaging/outboxWorker.ts` — selección respeta `next_attempt_at`
- `lib/db.ts` — `timezone: "Z"` + `safeExecute`
- `lib/audit.ts` — nuevas AuditAction de control/outbox
- `lib/domains/conversations/manual-reply.ts` — takeover compartido + ventana 24h + sendFn inyectable
- `lib/brain/local-ai-sdr/repository.ts` — mensajes `system` en timeline
- `scripts/autonomous-outbox-worker.ts`, `scripts/autonomous-followup-worker.ts` — delegan en los ticks compartidos
- `app/(hub)/conversations/[id]/page.tsx`, `ConversationHeader.tsx`, `ConversationComposer.tsx`, `types.ts` — controles reales, ventana por `last_inbound_at`
- `package.json` — scripts `test` y `e2e:autonomous`

(La rama también contiene trabajo previo sin commitear de la sesión anterior en dashboard/actions/opportunities/customers, preservado sin cambios.)

## 7. Migraciones

- `014_outbox_retry_backoff.sql`: agrega `attempt_count`, `next_attempt_at` e índice `(status, next_attempt_at)` a `brain_message_outbox`. Aditiva, preserva datos; rollback = DROP de columnas/índice (documentado en el archivo).
- Mantenimiento local: rebaseline del checksum de `013` en `schema_migrations` (el archivo fue editado después de aplicarse; mismo procedimiento documentado en `docs/operations/local-migration-checksum-drift-009-010.md`; tablas verificadas antes de tocar metadata).

## 8. Endpoints

- **Nuevo** `POST /api/conversations/[id]/control` — `{action: take|release|pause|close|reopen}`; 409 en transiciones inválidas; requiere operador + escritura habilitada.
- Existentes verificados: `GET /api/conversations/[id]/messages` (paginación `before`), `GET /api/conversations/[id]/autonomous`, `POST /api/conversations/[id]/reply` (ahora rechaza 409 `window_closed` y toma control atómicamente vía helper compartido).

## 9. Decisiones arquitectónicas tomadas

1. **Fuente canónica de ownership** = fila `conversation` (`ai_enabled`, `human_owner_active`, `status`), espejada a `crm_opportunities` para los gates de planificación. Coincide con ADR-003/ADR-006 (estado comercial fuera de prompts/workflows).
2. **Política de reapertura**: un inbound nuevo sobre conversación cerrada la reabre preservando ownership. Un inbound jamás cambia ownership.
3. **Ventana 24h**: sin templates implementados, el backend bloquea texto libre fuera de ventana (manual 409; autónomo cancelado con `window_closed` + auditoría de escalamiento). La UI lo comunica sin ofrecer botones falsos.
4. **Identidad de mensaje entre capas**: `dedupe_key` (planificación/outbox) → `provider_message_id` (envío/webhooks/timeline). El merge de timeline dedupa por `provider_message_id`; la fila persistida en `conversation_message` gana sobre la del outbox.
5. **Carrera residual worker↔operador**: si el operador cancela mientras la llamada al proveedor está en vuelo, el envío ya ocurrió; se detecta (UPDATE con guard `status='locked'` no aplica) y se audita `outbox.sent_after_cancel` en vez de ocultarlo.
6. **Follow-ups con owner humano**: se cancelan (`human_owner_active`), no se posponen — una respuesta autónoma pendiente es incompatible con el control humano (Escenario C.3).
7. **Ticks compartidos e inyectables** (`runOutboxTick`, `runFollowupTick`): una sola implementación para worker, tests y harness; el transporte es inyectable, eliminando mocks productivos.

## 10. Riesgos pendientes / deuda técnica

- `crm_agent_actions.conversation_case_id` llega null en algunas acciones del bridge cuando la decisión es interna (`take_over_case`); el enlace por oportunidad sí queda. Menor, afecta solo narración del panel.
- Los warnings del loop (`shadow_policy_failed`, `EVAL-*`) son ruidosos en modo `requires_review`; son observabilidad, no estado.
- El merge de timeline pagina por `created_at` sobre dos fuentes; con volúmenes muy altos convendría un cursor compuesto.
- 36 warnings de lint preexistentes (unused vars en zonas legacy).
- `.tmp-commercial-tests-cjs/` contiene artefactos compilados viejos (no usados por el runner actual).

## 11. Bloqueos exclusivamente externos

1. **Envío real por Meta**: `BRAIN_META_SEND_ENABLED=false` y sin allowlist. Para una prueba real controlada se necesita un número de WhatsApp de prueba autorizado por el dueño del negocio.
2. **Webhook en producción**: `META_WHATSAPP_APP_SECRET` y `META_WHATSAPP_VERIFY_TOKEN` no están configurados localmente (la verificación de firma es fail-closed en producción). Deben venir de la app de Meta.
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
npm run worker:outbox      # allowlist activa: solo envía al número de prueba
npm run worker:followup

# 4. Escribir por WhatsApp desde el número de prueba y observar la conversación
#    en /conversations. Kill switch: BRAIN_META_SEND_ENABLED=false detiene todo envío.
```

## 13. Pasos exactos para reproducir la verificación local

```powershell
npm run db:up; npm run db:wait; npm run db:migrate
npm run typecheck; npm run lint; npm test; npm run build
npm run e2e:autonomous                 # ciclo con LLM real (BRAIN_MODEL_* en .env.local)
npm run e2e:autonomous -- --skip-llm   # variante determinista sin LLM
```

## 14. Confirmación

Durante toda la sesión `BRAIN_META_SEND_ENABLED` permaneció en `false`, no existe allowlist configurada y cada envío del harness/tests pasó por un transporte falso en proceso. **No se envió ningún mensaje a clientes reales.**
