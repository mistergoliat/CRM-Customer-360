---
title: SALES-AGENT-R1 TASK_001 - Durable Handoff Fix
doc_id: sales-agent-r1-task-001-durable-handoff-fix
status: implemented_pending_real_db_validation
tags:
  - release
  - sales-agent
  - handoff
  - fix
---

# SALES-AGENT-R1 TASK_001 - Durable Handoff Fix

Fecha: 2026-08-15.

## 1. Problema

Identificado en `docs/audits/SALES-AGENT-R1-commercial-proposal-checkout-readiness-audit.md`
(seccion 17, `TASK_001`, `last_reviewed: 2026-08-06`) y confirmado directamente
contra el codigo en `develop` antes de implementar este fix: cuando el modelo
emite `{"type":"handoff"}`, `dispatchAgentLoopResponse.ts` construia y
despachaba el mensaje de reconocimiento generico, pero nunca escribia
`human_owner_active`/`ai_enabled`. El mismo cliente que pidio un humano
recibia, en su siguiente inbound, respuestas automaticas del mismo agente -
salvo que un operador humano notara el caso y tomara control manualmente.

Verificacion previa a la implementacion: `grep` de `takeHumanControlTx` en
`lib/brain/commercial/agent-loop/dispatchAgentLoopResponse.ts` no arrojo
resultados; el unico llamador productivo de esa funcion era
`lib/domains/conversations/manual-reply.ts` (respuesta manual del operador),
nunca el loop nativo del agente.

## 2. Hallazgo durante la implementacion: fix previo sin mergear (mismo bug)

Antes de comitear se encontro un commit ya existente, sin mergear a
`develop`, que ataca exactamente el mismo defecto:
`58ebe209868f98d8daa116a414a92b3af80d5e50` ("fix(sales-agent): durably
transfer conversation control on AI handoff", 2026-08-10, rama
`fix/acs-r1-05-t06-2-durable-handoff`, co-autoria de una sesion previa de
Claude). Ese commit esta construido sobre una rama congelada de
`ACS-R1-05-T06.2` mucho mas antigua que `develop` actual - su diff completo
contra `develop` borra miles de lineas que hoy existen (RFM, Quote Service,
quote-assembly, multi-intent, etc.), asi que la rama en si **no es
mergeable** tal cual. El commit puntual, sin embargo, es directamente
aplicable: su version de `dispatchAgentLoopResponse.ts`/
`tests/native/ensureAutonomousSalesTurnContinuity.test.ts` coincide exactamente
(mismo blob de Git) con el estado de esos archivos en `develop` al momento
de esta sesion.

Ese commit tiene **mas alcance que la primera version de este fix**: ademas
del loop nativo (`dispatchAgentLoopResponse.ts`), tambien conecta el camino
de continuidad reactiva (`continuity/dispatchFallbackAction.ts`, clases de
fallback `handoff_acknowledgement`/`unsafe_primary_draft`) - un escenario
de handoff real que la primera version de este fix dejaba sin cubrir.
Decision (confirmada por el usuario): adoptar el diseno completo de ese
commit en vez de quedarse con la version parcial. Nada de esto se hizo
mergeando esa rama - se reimplemento el mismo diseño directamente sobre
`develop`.

## 3. Cambio implementado

### 3.1 `lib/domains/conversations/control.ts`

Nueva funcion `takeHumanControlForAiHandoff(input: {conversationId, currentTime, reason})`,
reutilizando `takeHumanControlTx` sin modificarla:

```ts
export async function takeHumanControlForAiHandoff(input: { conversationId: number; currentTime: string; reason: string }): Promise<number> {
  const nowSql = toMysql(input.currentTime);
  const cancelledOutbox = await withTransaction((connection) => takeHumanControlTx(connection, input.conversationId, nowSql));
  await auditLog({ action: "conversation.control.ai_handoff", entityType: "conversation", entityId: input.conversationId, after: { reason: input.reason, cancelledOutbox } });
  return cancelledOutbox;
}
```

`takeHumanControlTx` (sin cambios) hace, en una sola transaccion:

- `UPDATE conversation SET human_owner_active = 1, ai_enabled = 0 ...`
- `UPDATE crm_opportunities SET human_owner_active = 1 ...` (misma
  oportunidad, via `conversation_case_id`)
- `cancelPendingAutonomousSendsTx(...)`: cancela cualquier fila
  `brain_message_outbox`/`crm_agent_actions` todavia `planned`/`locked` para
  esa conversacion, con `reason = "superseded_by_operator"`.

El `auditLog` (nuevo literal `conversation.control.ai_handoff` agregado al
union `AuditAction` en `lib/audit.ts`) es fire-and-forget - su rama no
transaccional nunca lanza (confirmado leyendo `lib/audit.ts:109-140`: try/catch
propio, retorna temprano si `!isDbWriteEnabled()` o si la tabla no existe),
asi que nunca puede convertir una toma de control exitosa en un fallo
reportado.

Ningun follow-up ya agendado sobrevive: el siguiente tick de
`runFollowupTick.ts` no encuentra una accion pendiente que ejecutar para esa
conversacion, porque la cancelacion ya corrio en la misma transaccion que
tomo el control.

### 3.2 `lib/brain/commercial/agent-loop/dispatchAgentLoopResponse.ts`

Cuando `input.loop.terminalReason === "handoff"` y
`bridgeFlags.actionPersistenceEnabled` es `true`:

```ts
await takeHumanControlForAiHandoff({
  conversationId: input.conversationId,
  currentTime: input.currentTime,
  reason: input.loop.handoffReason ?? "agent_tool_loop_handoff"
});
```

**Antes** de construir el mensaje de reconocimiento
(`buildContinuityFallbackMessage("handoff_acknowledgement", ...)`).

### 3.3 `lib/brain/commercial/continuity/dispatchFallbackAction.ts` (nuevo en esta version)

Mismo gate y mismo llamado, condicionado a
`HUMAN_HANDOFF_FALLBACK_CLASSES = new Set(["handoff_acknowledgement", "unsafe_primary_draft"])`:
las unicas dos clases de fallback que `ensureAutonomousSalesTurnContinuity.ts`
ya trata como "un humano debe quedar a cargo ahora". Las clases de fallback
de infraestructura (`catalog_unavailable`, `model_unavailable`,
`invalid_model_result`, `max_steps_exceeded`) permanecen bajo control de la
IA para que pueda seguir reintentando en un turno posterior - sin cambios
ahi.

### 3.4 Por que el gate es `actionPersistenceEnabled`, no `actionQueueEnabled`

`dispatchAgentLoopResponse` ya tenia un guard temprano
(`if (!bridgeFlags.actionQueueEnabled) return emptyResult(...)`), pero con
`actionQueueEnabled=true` y `actionPersistenceEnabled=false` (el default),
`persistAgentAction` resuelve a `"dry_run"` **sin tocar la base de datos en
absoluto** - es el modo en que corren hoy los tests de
`runNativeAgentToolLoopCycleConfigurationFailure.test.ts` (`[CF2]`-`[CF5]`)
sin necesitar MariaDB. Si la toma de control se hubiera gateado solo por
`actionQueueEnabled`, esos tests habrian empezado a requerir una conexion
real de base de datos que hoy no necesitan, rompiendo esa convencion de
"dry run sin DB" sin ninguna necesidad real (con persistencia apagada, nada
mas en esta funcion persiste tampoco). Confirmado empiricamente: correr el
subset `[CF2]`-`[CF5]` despues del cambio sigue en verde sin ninguna conexion
a base de datos (ver seccion 5).

## 4. Alcance / no alcance

- `control.ts` gana una funcion nueva (`takeHumanControlForAiHandoff`) pero
  `takeHumanControlTx` en si no se modifica.
- No se agrega distincion visible en el Hub entre origen humano/IA del
  handoff (explicitamente fuera de alcance de `TASK_001` en la auditoria
  original).
- No se agrega guard de conversacion cerrada (nota menor de la auditoria
  original, no bloqueante).
- No se toco ningun otro terminal reason del loop nativo (`responded`,
  `max_steps_exceeded`, `invalid_output`, `provider_unavailable`,
  `timeout`) ni ninguna otra clase de fallback de continuidad
  (`catalog_unavailable`, `model_unavailable`, `invalid_model_result`,
  `max_steps_exceeded`) - la condicion es exclusiva de
  `terminalReason === "handoff"` (loop nativo) y de
  `handoff_acknowledgement`/`unsafe_primary_draft` (continuidad reactiva).

## 5. Tests

Nuevo: `tests/agent-loop/dispatchAgentLoopResponseHandoffControl.test.ts`
(mismo patron de `tests/domains/conversationControl.test.ts`: DB real via
`processNativeWhatsAppInbound` para sembrar una conversacion, luego
verificacion directa de la fila `conversation`):

- `TASK_001: a model-decided handoff durably takes human control before the
  acknowledgement is dispatched` - crea una conversacion real, despacha un
  resultado `handoff` con `BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED=true`, y
  verifica `human_owner_active=1`/`ai_enabled=0` en la fila real.
- `a non-handoff terminal reason (responded) never touches conversation
  control` - mismo flujo con `terminalReason: "responded"`, verifica que la
  fila permanece sin cambios (`human_owner_active=0`/`ai_enabled=1`).

Extendido (adaptado del commit previo sin mergear, seccion 2):
`tests/native/ensureAutonomousSalesTurnContinuity.test.ts` gana un helper
`loadConversationControlState` y dos aserciones nuevas sobre tests ya
existentes (`ACS-R1-05-T06.2`, escenario `unsafe_primary_draft` real y
escenario `escalate_to_operator -> handoff_acknowledgement`), verificando
`human_owner_active=1`/`ai_enabled=0` despues del fallback, sin cancelar el
acknowledgement que el propio fallback acaba de encolar (orden: toma de
control antes del dispatch). El diff aplico limpio contra el estado actual
de `develop` (`git apply --check` confirmado - el blob del archivo antes
del commit viejo coincide byte a byte con el estado real de `develop`).

Regresion verificada sin DB: subset
`tests/agent-loop/runNativeAgentToolLoopCycleConfigurationFailure.test.ts` +
`tests/agent-loop/runAgentToolLoop.test.ts` + `tests/domains/createdQuote.test.ts`
(107 tests, incluye trabajo de `SALES-AGENT-R1-T3` de esta misma sesion) -
105 pass / 2 fail, los mismos 2 fallos preexistentes en el baseline
(confirmado con `git stash` + re-run antes del cambio). `[CF2]`-`[CF5]`
(cobertura de handoff sin DB) en verde.

`npx tsc --noEmit` -> limpio. `npm run lint` -> 0 errores, 34 warnings
preexistentes (mismos archivos/reglas que documenta
`CP-R1-T11H.1-full-suite-stabilization.md`).

## 6. Limitacion conocida: sin validacion real contra MariaDB

Ninguno de los tests de DB real (nuevo o extendido) corrio en esta sesion.
Intento de ejecucion del nuevo:

```text
tests/agent-loop/dispatchAgentLoopResponseHandoffControl.test.ts
-> connect ECONNREFUSED 127.0.0.1:3306
   at createConversation -> processNativeWhatsAppInbound -> ... -> queryRows (lib/db.ts:76)
```

El fallo ocurre exactamente en el primer intento de conexion real (dentro de
`createConversation`, antes de llegar a la logica bajo prueba) - no es un
error de tipos ni de logica del test. Se intento levantar Docker Desktop
durante esta sesion para correr el test contra MariaDB real; el daemon
no llego a un estado estable (`vmmem` quedo consumiendo CPU sin responder,
`wsl --status`/`wsl --shutdown` colgados, requirio intervencion manual del
usuario fuera de esta sesion). La validacion contra DB real queda
pendiente, bloqueada por el entorno, no por el codigo.

## 7. Criterio de cierre final

Este documento pasa de `implemented_pending_real_db_validation` a
`validated` cuando, contra una instancia real de MariaDB
(`npm run db:up` + `npm run db:migrate` o equivalente):

1. `tests/agent-loop/dispatchAgentLoopResponseHandoffControl.test.ts` corre
   en verde (ambos casos).
2. `tests/native/ensureAutonomousSalesTurnContinuity.test.ts` corre en verde,
   incluidas las dos aserciones nuevas de control de conversacion.
3. `tests/domains/conversationControl.test.ts` sigue en verde (sin
   regresion sobre `takeHumanControlTx`, que este fix reutiliza sin
   modificar).
4. Se confirma, con una fila real, que un follow-up ya agendado
   (`crm_agent_actions.status='planned'`) para la conversacion queda
   `cancelled` despues del handoff - cierra el tercer criterio de
   aceptacion original de `TASK_001` ("un follow-up ya agendado se cancela
   en el proximo tick del worker").

## 8. Riesgos y deuda

- Este fix no se reconcilia en `docs/ACTIVE_RELEASE.md` - `SALES-AGENT-R1`
  no es parte de la jerarquia de releases ACS rastreada ahi (mismo gap ya
  identificado para `CP-R1` en esta misma sesion y, de forma independiente,
  en `docs/audits/SALES-AGENT-R1-current-commercial-capability-audit.md`,
  seccion 1: "la documentacion canonica ... no menciona en absoluto" el
  workstream `CP-R1`). Decision explicita: no se edito la auditoria
  original (`AGENTS.md` prohibe modificar auditorias historicas) ni
  `ACTIVE_RELEASE.md` para este fix puntual.
- Sin base de datos local disponible en este entorno de desarrollo en el
  momento de este cierre - ver seccion 6.
- La rama vieja `fix/acs-r1-05-t06-2-durable-handoff` (commit `58ebe20`)
  sigue existiendo, sin mergear, sin push forzado ni borrado - queda como
  esta, fuera de alcance de este fix limpiarla o cerrarla formalmente.

## 9. Siguiente tarea

`SALES-AGENT-R1-T3` - registrar la capability que llama `createQuote` en el
Quote Service real y conectarla al Capability Gateway /
`AGENT_LOOP_TOOL_POOL`, usando el output ya validado del Quote Input
Assembler (`SALES-AGENT-R1-T2`, ver `docs/integrations/quote-input-assembly.md`).
