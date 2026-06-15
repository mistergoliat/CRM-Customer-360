# Brain Response Executor

`Brain Response Executor` es la base backend, en modo dry-run/no-op, para decidir si una respuesta conversacional podria ejecutarse y para construir previews auditables sin side effects.

## Objetivo

- validar una accion candidata
- construir un `execution_plan`
- preview de payload Meta
- preview de outbox y dedupe
- bloquear cualquier envio real, write de DB o mutacion de caso

## Contrato

`POST /api/brain/execute`

Campos relevantes:

- `source`: `brain`, `n8n` u `operator`
- `dryRun`: debe ser `true`
- `executeActions`: debe ser `false`
- `action.type`: `send_whatsapp_message`, `update_case`, `handoff`, `close_case`, `no_action`
- `action.payload`: payload de la accion candidata
- `actionPolicy`: politica liviana para determinar si el auto-reply esta permitido
- `botEligibility`: elegibilidad liviana para determinar si el bot esta bloqueado
- `context`: `waId`, `phoneNumberId`, `messageId`, `conversationCaseId`, `messageText`
- `persistOutboxPlan`: opcional, `false` por defecto. Solo escribe en `brain_message_outbox` y nunca en casos ni Meta.

## Reglas de bloqueo

- `dryRun=false` o `executeActions=true` se rechazan
- `send_whatsapp_message` requiere `waId`, `phoneNumberId` y `messageText`
- `messageText` vacio o demasiado largo devuelve `ok=false`
- si la policy o la elegibilidad bloquean el auto-reply, el plan queda `blocked`
- `update_case`, `handoff` y `close_case` quedan en `blocked` en esta fase
- `no_action` devuelve plan `noop`

## Persistencia de outbox

Cuando `persistOutboxPlan=true` y el plan corresponde a `send_whatsapp_message`, el backend intenta crear o reutilizar un registro en `brain_message_outbox`.

El resultado se expone en `outbox_result`:

```json
{
  "persisted": true,
  "existing": false,
  "status": "planned",
  "dedupe_key": "brain-outbox-...",
  "outbox_id": 1
}
```

Si el `dedupe_key` ya existe, el endpoint devuelve el registro existente:

```json
{
  "persisted": false,
  "existing": true,
  "status": "planned",
  "dedupe_key": "brain-outbox-...",
  "outbox_id": 1
}
```

Si la tabla no existe o el insert falla, el endpoint no rompe el dry-run; agrega warning y devuelve `persisted=false`.

Si el plan queda bloqueado por policy, el registro puede guardarse con `status="blocked"` si `persistOutboxPlan=true`.

## Preview Meta

Para `send_whatsapp_message`, el executor construye un preview de payload:

```json
{
  "messaging_product": "whatsapp",
  "to": "56912345678",
  "type": "text",
  "text": {
    "body": "Nuestro horario de atención es..."
  }
}
```

## Preview de outbox y dedupe

- `buildDedupeKey()` genera una clave deterministica
- `hashMessageText()` normaliza y hashea el texto antes de generar la clave
- `findOutboxByDedupeKey()` consulta la outbox transaccional
- `createOutboxPlannedRecord()` hace insert idempotente con `INSERT IGNORE`
- `checkDuplicateNoop()` queda como preview conceptual para dry-run puro
- `buildOutboxPreview()` solo describe el registro futuro

## Ejemplos

Plan previsto:

```json
{
  "ok": true,
  "dryRun": true,
  "executable": false,
  "execution_plan": {
    "type": "send_whatsapp_message",
    "status": "planned",
    "reason": "dry_run_only"
  },
  "outbox_result": {
    "persisted": true,
    "existing": false,
    "status": "planned",
    "dedupe_key": "brain-outbox-abc123",
    "outbox_id": 1
  }
}
```

Duplicado:

```json
{
  "outbox_result": {
    "persisted": false,
    "existing": true,
    "status": "planned",
    "dedupe_key": "brain-outbox-abc123",
    "outbox_id": 1
  }
}
```

Bloqueado:

```json
{
  "outbox_result": {
    "persisted": true,
    "existing": false,
    "status": "blocked",
    "dedupe_key": "brain-outbox-def456",
    "outbox_id": 2
  }
}
```

## Esquema de outbox

La migracion manual a aplicar es `migrations/003_brain_message_outbox.sql`.

Pasos recomendados:

1. Revisar el SQL en staging.
2. Aplicar `migrations/003_brain_message_outbox.sql` en la base correspondiente.
3. Verificar que exista `brain_message_outbox`.
4. Recién despues activar `persistOutboxPlan=true` en llamadas de prueba.

Estados documentados para la outbox:

- `planned`
- `pending`
- `locked`
- `sending`
- `sent`
- `failed`
- `cancelled`
- `blocked`

## Integracion con `processInbound`

`processInbound` puede pedir un `execution_plan` de prueba cuando:

- `options.buildExecutionPlanDryRun === true`
- el `agent_draft` existe y su `decision === "answer"`
- la `action_policy` permite auto-reply

Ese plan se adjunta solo como observacion. No cambia la respuesta al cliente.

`POST /api/brain/execute` puede persistir un `outbox_result` cuando `persistOutboxPlan=true`, pero la escritura queda limitada a la outbox y nunca muta casos ni ejecuta WhatsApp real.

## Estado del adaptador Meta

El executor expone en `metadata.send_adapter_status` el estado del adaptador Meta:

- `disabled`
- `configured`
- `missing_credentials`

Variables relacionadas:

- `BRAIN_META_SEND_ENABLED=false` por defecto
- `BRAIN_META_SEND_TEST_ENABLED=false` por defecto
- `BRAIN_META_GRAPH_VERSION=v25.0` configurable
- `META_WHATSAPP_ACCESS_TOKEN=`
- `META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID=`

## Endpoint de prueba sandbox

`POST /api/brain/messaging/send-test` existe solo para pruebas manuales o sandbox.

Reglas:

- requiere auth M2M u operator
- requiere `BRAIN_META_SEND_TEST_ENABLED=true`
- si `BRAIN_META_SEND_ENABLED !== "true"`, responde `disabled`
- nunca actualiza outbox
- nunca muta casos
- no debe usarse en produccion todavia
