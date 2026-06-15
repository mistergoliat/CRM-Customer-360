# Brain End-to-End Manual Backend Send Test

Esta guia documenta la prueba operacional manual de extremo a extremo para el flujo backend de envio.

No automatiza nada, no crea cron, no crea polling y no cambia los defaults de los flags. El flujo legacy de n8n sigue siendo el camino productivo por defecto salvo que un operador lo desactive manualmente durante la prueba.

## Objetivo

Verificar manualmente este recorrido:

1. `processInbound` recibe inbound en `dryRun` con `agent_draft` de Knowledge.
2. `processInbound` crea `brain_message_outbox` en `planned` si los flags y la policy lo permiten.
3. `POST /api/brain/outbox/worker` con `lockOnly=true` pasa `planned -> locked`.
4. `POST /api/brain/outbox/worker` con `sendLocked=true` pasa `locked -> sending -> sent/failed`.
5. Si `sent` y `BRAIN_PERSIST_CANONICAL_OUTBOUND=true`, se persiste el outbound canonico.
6. Si `sent` y `BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND=true`, se actualiza el caso con campos minimos.
7. El flujo legacy permanece activo salvo que el operador lo desactive manualmente para la comparacion.

## Precondiciones

Antes de iniciar, confirmar:

1. La migracion de `brain_message_outbox` ya fue aplicada.
2. Existe acceso a una cuenta M2M u operator con permiso para `POST /api/brain/process-inbound` y `POST /api/brain/outbox/worker`.
3. Hay un numero WhatsApp de prueba controlado.
4. Existe un caso o `conversation_case_id` de prueba, si se quiere validar el refresh minimo del caso.
5. Se conoce un `waId` valido para la prueba.
6. Se usa un ambiente no productivo o un numero de prueba autorizado.

## Flags

Todos estos flags siguen en `false` por defecto:

- `BRAIN_PROCESS_INBOUND_ALLOW_OUTBOX_PLAN`
- `BRAIN_OUTBOX_WORKER_ENABLED`
- `BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND`
- `BRAIN_META_SEND_ENABLED`
- `BRAIN_PERSIST_CANONICAL_OUTBOUND`
- `BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND`

Opcionalmente, si quieres probar el endpoint sandbox de Meta por separado, sigue regido por `BRAIN_META_SEND_TEST_ENABLED=false` por defecto, pero no es parte de esta corrida end-to-end.

## Secuencia recomendada

### 1. Preparar el inbound

Habilitar solo lo necesario para que `processInbound` pueda dejar la fila `planned`:

- `BRAIN_PROCESS_INBOUND_ALLOW_OUTBOX_PLAN=true`
- `BRAIN_OUTBOX_WORKER_ENABLED=true`
- `BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND=true`
- `BRAIN_META_SEND_ENABLED=true`

Mantener apagados por defecto:

- `BRAIN_PERSIST_CANONICAL_OUTBOUND=false`
- `BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND=false`

Si quieres validar el paso de persistencia canónica y refresh del caso en la misma corrida manual, activa esos dos flags solo en el tramo final del test.

### 2. Ejecutar `processInbound`

Request ejemplo:

```json
{
  "channel": "whatsapp",
  "source": "n8n_meta_webhook",
  "waId": "56912345678",
  "phoneNumberId": "123456789",
  "messageId": "wamid.demo.inbound.001",
  "messageText": "Hola, quiero probar el flujo backend manual.",
  "conversationCaseId": 4821,
  "options": {
    "dryRun": true,
    "executeActions": false,
    "returnInstructionsForN8n": true,
    "runAgentDryRun": true,
    "preferredAgent": "knowledge",
    "buildExecutionPlanDryRun": true,
    "persistOutboxPlan": true
  }
}
```

Resultado esperado:

- `ok=true`
- `instructions.continueLegacyFlow=true`
- `instructions.executeActions=false`
- `outbox_plan_result.status=planned` o `existing`
- `outbox_plan_result.outbox_id` presente si se persistio o reutilizo

Si el flag esta apagado, el resultado esperado es:

```json
{
  "outbox_plan_result": {
    "status": "skipped_by_flag"
  }
}
```

### 3. Revisar la outbox planned

SQL de verificacion:

```sql
SELECT
  id,
  dedupe_key,
  status,
  source,
  source_request_id,
  wa_id,
  phone_number_id,
  conversation_case_id,
  message_text,
  planned_at,
  locked_at,
  sent_at,
  failed_at,
  provider_message_id,
  error_code,
  error_message,
  updated_at
FROM brain_message_outbox
WHERE dedupe_key = ?;
```

Esperado:

- `status = 'planned'`
- `locked_at IS NULL`
- `sent_at IS NULL`
- `failed_at IS NULL`

### 4. Bloquear la fila

Request ejemplo:

```json
{
  "dryRun": false,
  "lockOnly": true,
  "sendLocked": false,
  "limit": 1,
  "debug": false
}
```

Esperado:

- `locked_count=1`
- el registro pasa a `status='locked'`
- `locked_at` se completa
- no hay envio real

SQL de verificacion:

```sql
SELECT id, dedupe_key, status, locked_at, updated_at
FROM brain_message_outbox
WHERE id = ?;
```

### 5. Enviar el locked

Request ejemplo con `outboxId` puntual:

```json
{
  "dryRun": false,
  "lockOnly": false,
  "sendLocked": true,
  "outboxId": 123,
  "limit": 1,
  "debug": false
}
```

Esperado:

- `locked -> sending -> sent` si Meta responde ok
- `locked -> sending -> failed` si Meta falla
- solo se procesa el registro `locked` indicado por `outboxId`
- no se tocan registros `planned`, `blocked`, `failed` ni `sent`

SQL de verificacion:

```sql
SELECT
  id,
  dedupe_key,
  status,
  provider_message_id,
  sent_at,
  failed_at,
  error_code,
  error_message,
  updated_at
FROM brain_message_outbox
WHERE id = ?;
```

### 6. Verificar canonical outbound

Si `BRAIN_PERSIST_CANONICAL_OUTBOUND=true` y el send fue `sent`, revisar:

```sql
SELECT
  id,
  conversation_case_id,
  wa_id,
  phone_number_id,
  channel,
  platform,
  direction,
  message_type,
  message_text,
  provider_message_id,
  source,
  created_at
FROM n8n_conversation_messages
WHERE provider_message_id = ?
ORDER BY id DESC;
```

Si no existe `provider_message_id`, usar el fallback disponible que haya quedado documentado por el helper de persistencia.

### 7. Verificar update minimo del caso

Si `BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND=true` y el send fue `sent`, revisar:

```sql
SELECT
  conversation_case_id,
  updated_at,
  last_message_at,
  last_outbound_at,
  last_message_id,
  bot_replied,
  final_action
FROM n8n_conversation_cases
WHERE conversation_case_id = ?;
```

Esperado:

- `updated_at` refrescado
- `last_message_at` y/o `last_outbound_at` refrescados si existen
- `last_message_id` actualizado si el schema lo permite
- `bot_replied = 1` si existe
- `final_action = 'reply'` si existe
- ningun cambio de `status` o `lifecycle_status`

## Rollback manual

Si algo no sale bien:

1. Volver estos flags a `false`:
   - `BRAIN_PROCESS_INBOUND_ALLOW_OUTBOX_PLAN`
   - `BRAIN_OUTBOX_WORKER_ENABLED`
   - `BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND`
   - `BRAIN_META_SEND_ENABLED`
   - `BRAIN_PERSIST_CANONICAL_OUTBOUND`
   - `BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND`
2. No ejecutar nuevamente el worker.
3. Revisar si quedo alguna fila `locked` o `sending`.
4. Si existe una fila atascada, resolverla manualmente en DB segun la politica operativa del ambiente de prueba.

## Riesgos

- Doble respuesta si el legacy de n8n sigue activo y tambien emite respuesta al mismo tiempo.
- Envio a numero real si el `waId` de prueba no esta aislado.
- Falta de `provider_message_id` si el proveedor responde de forma incompleta.
- Schema drift en `n8n_conversation_messages` o `n8n_conversation_cases`.
- Fila atascada en `locked` o `sending` si la prueba se interrumpe a mitad de camino.

## Criterio de exito

La prueba se considera exitosa si:

- la outbox termina en `sent`
- `provider_message_id` queda persistido
- el outbound canonical queda visible en HUB si `BRAIN_PERSIST_CANONICAL_OUTBOUND=true`
- el caso se actualiza con los campos minimos si `BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND=true`
- no cambia `status` ni `lifecycle_status`
- el flujo legacy sigue intacto salvo la desactivacion manual temporal del operador

## Criterio de falla

La prueba falla si:

- la fila queda en `failed`
- `error_code` o `error_message` indican error de envio
- no se persiste canonical outbound cuando Meta si confirmo `sent`
- se actualiza el caso sin que haya `sent`
- cambia `status` o `lifecycle_status`

## Siguiente paso

Si esta corrida valida el backend manual de envio, el siguiente milestone recomendado es cerrar P1I y entrar a P1J para el Handoff/Case Engine backend.
