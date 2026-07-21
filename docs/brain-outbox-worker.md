---
title: Brain Outbox Worker
doc_id: brain-outbox-worker
status: superseded
superseded_by: docs/product/ai-sdr-outbox-worker-contract.md
version: "1.1.0"
owner: architecture
last_reviewed: 2026-07-21
source_of_truth_for: []
depends_on: []
supersedes: []
tags:
  - historical
---

# Brain Outbox Worker

`Brain Outbox Worker` toma registros `brain_message_outbox` en estado `planned` para bloquearlos de forma segura. Version P1I anterior al outbox worker contract y al canonical outbox writer actuales.es de un `sent` confirmado. P1I-008 agrega un refresh mínimo del caso, sin tocar lifecycle. Sigue siendo manual, fail-closed y sin automatizacion.

## Objetivo

- definir el contrato manual de ejecucion
- bloquear filas `planned` con `locked_at`
- detectar `stale_locked` sin reciclarlos automaticamente
- enviar desde `locked` solo con `sendLocked=true` y doble flag
- evitar cualquier camino automatico desde `processInbound`
- dejar claro que no hay envio Meta automatico ni estado `sent` fuera del camino manual

## Flags

- `BRAIN_OUTBOX_WORKER_ENABLED=false`
- `BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND=false`
- `BRAIN_OUTBOX_WORKER_BATCH_SIZE=5`
- `BRAIN_OUTBOX_WORKER_LOCK_SECONDS=60`
- `BRAIN_PERSIST_CANONICAL_OUTBOUND=false`
- `BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND=false`

## Contrato

`POST /api/brain/outbox/worker`

Requiere auth M2M u operator.

Request:

```json
{
  "dryRun": true,
  "lockOnly": false,
  "sendLocked": false,
  "outboxId": null,
  "limit": 5,
  "debug": false
}
```

Campos:

- `dryRun`: por defecto `true` cuando no se pide `lockOnly`
- `lockOnly`: por defecto `false`
- `sendLocked`: por defecto `false`
- `outboxId`: opcional, solo para envio puntual de un registro `locked`
- `limit`: maximo de registros a revisar, acotado por `BRAIN_OUTBOX_WORKER_BATCH_SIZE`
- `debug`: opcional, expone mas detalle de candidato
- `metadata`: opcional, reservado para trazabilidad futura

Response base:

```json
{
  "ok": true,
  "disabled": false,
  "status": "planned",
  "dryRun": true,
  "lockOnly": false,
  "sendLocked": false,
  "locked_count": 0,
  "sent_count": 0,
  "failed_count": 0,
  "skipped_count": 0,
  "candidates": [],
  "locked_records": [],
  "skipped_records": [],
  "sent_records": [],
  "failed_records": [],
  "warnings": [],
  "plan": {
    "mode": "dry_run",
    "enabled": true,
    "allowRealSend": false,
    "dryRun": true,
    "lockOnly": false,
    "sendLocked": false,
    "debug": false,
    "limit": 5,
    "batchSize": 5,
    "lockSeconds": 60,
    "candidateCount": 0,
    "lockedCount": 0,
    "skippedCount": 0,
    "selectedCount": 0,
    "sentCount": 0,
    "failedCount": 0,
    "candidates": [],
    "lockedRecords": [],
    "skippedRecords": [],
    "sentRecords": [],
    "failedRecords": [],
    "transitionResults": [],
    "blocked_reasons": [],
    "warnings": [],
    "notes": []
  }
}
```

## Comportamiento por defecto

Con `BRAIN_OUTBOX_WORKER_ENABLED=false`:

- responde `disabled`
- no consulta outbox
- no bloquea filas
- no llama Meta
- no muta registros

Ejemplo:

```json
{
  "ok": false,
  "disabled": true,
  "status": "disabled",
  "reason": "worker_disabled",
  "error_code": "disabled",
  "error_message": "BRAIN_OUTBOX_WORKER_ENABLED=false"
}
```

## dryRun

`dryRun=true` solo consulta candidatos `planned` y devuelve un plan.

- no cambia estados
- no bloquea filas
- no marca `sent`
- no llama Meta

Ejemplo:

```json
{
  "ok": true,
  "status": "planned",
  "dryRun": true,
  "locked_count": 0,
  "skipped_count": 0,
  "candidates": [
    {
      "id": 42,
      "dedupe_key": "brain-outbox-abc123",
      "status": "planned",
      "source": "brain",
      "wa_id": "56912345678",
      "phone_number_id": "123",
      "conversation_case_id": 987,
      "message_text_preview": "Hola, te escribimos para...",
      "message_text_length": 42,
      "planned_at": "2026-06-15T00:00:00.000Z",
      "locked_at": null,
      "failed_at": null,
      "created_at": "2026-06-15T00:00:00.000Z",
      "updated_at": "2026-06-15T00:00:00.000Z",
      "stale_locked": false
    }
  ]
}
```

## lockOnly

`lockOnly=true` con el worker habilitado bloquea filas `planned` de forma transaccional y se detiene antes de cualquier envio.

- `UPDATE ... WHERE id=? AND status='planned'`
- si no afecta filas, se reporta `already_locked` o `stale_locked`
- `locked_at` se setea en DB
- no se usa `sending`
- no se usa `sent`

Ejemplo:

```json
{
  "ok": true,
  "status": "locked",
  "dryRun": false,
  "lockOnly": true,
  "locked_count": 1,
  "skipped_count": 0,
  "locked_records": [
    {
      "id": 42,
      "previous_status": "planned",
      "status": "locked",
      "dedupe_key": "brain-outbox-abc123",
      "locked_at": "2026-06-15T00:01:00.000Z"
    }
  ]
}
```

## sendLocked

`sendLocked=true` permite enviar desde filas `locked` de forma manual y autenticada.

- requiere `BRAIN_OUTBOX_WORKER_ENABLED=true`
- requiere `BRAIN_META_SEND_ENABLED=true`
- requiere `BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND=true`
- requiere `dryRun=false`
- requiere `lockOnly=false`
- solo procesa filas `status=locked`
- no actualiza casos por defecto; el refresh minimo requiere `BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND=true`
- no inserta outbound canonical por defecto; la persistencia canónica posterior requiere `BRAIN_PERSIST_CANONICAL_OUTBOUND=true`
- cada `sent_record` expone `canonical_persist_result`
- cada `sent_record` expone `case_update_result`

Ejemplo:

```json
{
  "ok": true,
  "status": "sent",
  "sendLocked": true,
  "sent_count": 1,
  "failed_count": 0,
  "skipped_count": 0,
  "sent_records": [
    {
      "outbox_id": 42,
      "previous_status": "sending",
      "status": "sent",
      "dedupe_key": "brain-outbox-abc123",
      "provider_message_id": "wamid....",
      "sent_at": "2026-06-15T00:02:00.000Z",
      "error_code": null,
      "error_message": null,
      "stale_locked": false,
      "canonical_persist_result": {
        "status": "skipped_by_flag",
        "message_id": null
      },
      "case_update_result": {
        "status": "skipped_by_flag",
        "case_id": 123,
        "updated_fields": []
      }
    }
  ],
  "failed_records": [],
  "warnings": []
}
```

Ejemplo `flags insufficient`:

```json
{
  "ok": false,
  "disabled": true,
  "status": "disabled",
  "reason": "real_send_disabled",
  "error_code": "real_send_disabled",
  "error_message": "Real send is disabled until both flags are enabled."
}
```

Ejemplo `failed`:

```json
{
  "ok": false,
  "status": "failed",
  "sendLocked": true,
  "sent_count": 0,
  "failed_count": 1,
  "skipped_count": 0,
  "sent_records": [],
  "failed_records": [
    {
      "outbox_id": 42,
      "previous_status": "sending",
      "status": "failed",
      "dedupe_key": "brain-outbox-abc123",
      "provider_message_id": null,
      "sent_at": null,
      "failed_at": "2026-06-15T00:02:00.000Z",
      "error_code": "meta_http_error",
      "error_message": "Meta Graph API HTTP 500",
      "stale_locked": false
    }
  ],
  "warnings": ["Meta Graph API HTTP 500"]
}
```

## canonical_persist

Despues de un `sent` exitoso, el worker puede persistir un mensaje outbound canónico en `n8n_conversation_messages` solo si `BRAIN_PERSIST_CANONICAL_OUTBOUND=true`.

- sigue apagado por defecto
- no se ejecuta si Meta no confirmó `sent`
- no se ejecuta si faltan `wa_id`, `phone_number_id` o `message_text`
- usa `provider_message_id` cuando existe
- si el identificador de Meta no viene expuesto, puede apoyarse en claves fallback del outbox cuando el schema legacy las soporta
- si la fila ya existe, devuelve `existing`
- si el schema solo permite una persistencia parcial o faltan columnas compatibles, devuelve `warning` o `skipped` sin romper el flujo de envío

Ejemplo con flag apagado:

```json
{
  "ok": true,
  "status": "sent",
  "sendLocked": true,
  "sent_count": 1,
  "failed_count": 0,
  "skipped_count": 0,
  "sent_records": [
    {
      "outbox_id": 42,
      "previous_status": "sending",
      "status": "sent",
      "dedupe_key": "brain-outbox-abc123",
      "provider_message_id": "wamid....",
      "sent_at": "2026-06-15T00:02:00.000Z",
      "error_code": null,
      "error_message": null,
      "stale_locked": false,
      "canonical_persist_result": {
        "status": "skipped_by_flag",
        "message_id": null
      }
    }
  ]
}
```

Ejemplo persistido:

```json
{
  "canonical_persist_result": {
    "status": "persisted",
    "message_id": 123
  }
}
```

Ejemplo existente:

```json
{
  "canonical_persist_result": {
    "status": "existing",
    "message_id": 123
  }
}
```

## case_update

Despues de un `sent` exitoso, el worker puede refrescar un resumen mínimo del caso en `n8n_conversation_cases` solo si `BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND=true`.

- sigue apagado por defecto
- no cambia `status`
- no cambia `lifecycle_status`
- no cierra ni reabre casos
- no hace handoff
- solo actualiza campos seguros si existen
- si falta `conversation_case_id`, devuelve `skipped_no_case_id`
- si `BRAIN_PERSIST_CANONICAL_OUTBOUND=true` y la persistencia canónica no quedó en `persisted` o `existing`, devuelve `skipped_no_canonical_message`
- `updated_fields` lista solo las columnas realmente tocadas

Ejemplo con flag apagado:

```json
{
  "case_update_result": {
    "status": "skipped_by_flag",
    "case_id": 123,
    "updated_fields": []
  }
}
```

Ejemplo actualizado:

```json
{
  "case_update_result": {
    "status": "updated",
    "case_id": 123,
    "updated_fields": ["updated_at", "last_message_at", "last_outbound_at", "last_message_id", "bot_replied", "final_action"]
  }
}
```

## stale_locked

Los registros `locked` con `locked_at` anterior a `NOW() - BRAIN_OUTBOX_WORKER_LOCK_SECONDS` se reportan como `stale_locked`.

- solo se reportan
- no se reciclan automaticamente
- no se fuerzan a `planned`
- no se convierten en `sending`

## Locking

Diseño de locking:

- `planned` es el unico estado elegible para bloqueo real en esta fase
- `locked_at` marca el inicio del lock
- `stale_locked` permite detectar locks vencidos sin romper idempotencia
- el worker debe evitar doble bloqueo con `WHERE id=? AND status='planned'`
- `failed_at` queda reservado para una fase futura de retry/failed

## Retry

Esta fase no implementa retry real, pero deja documentado el criterio futuro:

- max attempts futuro
- backoff futuro con jitter
- `failed` permanente para errores no recuperables
- reciclaje de stale locks solo cuando una fase posterior lo autorice explicitamente

## Transiciones permitidas

- `planned -> locked`
- `locked -> sending`
- `sending -> sent`
- `sending -> failed`
- `locked -> failed`
- `planned -> blocked`

## Estado de esta fase

P1I-005 implementa locking real y fail-closed. P1I-006 agrega el envio manual controlado desde filas `locked`, pero sigue sin automatizacion ni caminos productivos automaticos.

El worker real automatizado o con polling sigue deshabilitado; P1I-010 solo documenta la prueba manual end-to-end y no activa automatizacion.

## Guia manual end-to-end

La corrida manual completa de `processInbound -> planned -> locked -> sent/failed -> canonical/case update` esta documentada en `docs/brain-end-to-end-send-test.md`.

Ese flujo sigue siendo manual, autenticado y opt-in por flags. No habilita cron, polling ni ejecucion automatica.
