---
title: n8n Shadow Mode Integration
doc_id: n8n-shadow-mode-integration
status: superseded
superseded_by: docs/ACTIVE_RELEASE.md
version: "1.1.0"
owner: architecture
last_reviewed: 2026-07-21
source_of_truth_for: []
depends_on: []
supersedes: []
tags:
  - historical
---

# n8n Shadow Mode Integration

> **SUPERSEDED (2026-07-21).** Esta guia operativa conecta n8n al endpoint `POST /api/ai/orchestrate`, marcado `superseded` en `docs/ai-orchestration-contract.md`. Sin evidencia de que este camino de integracion siga vivo en ninguna release ACS. La integracion real vigente de WhatsApp/n8n hacia el runtime nativo se describe en `docs/ACTIVE_RELEASE.md` y `docs/n8n-brain-integration.md` (que a su vez documenta, en su seccion de correccion, el incidente real de doble autoridad de escritura que este patron de "shadow mode" permitio sin que nadie lo supiera). No usar esta guia como instructivo operativo para nueva integracion n8n.

Guia operativa para que n8n llame `POST /api/ai/orchestrate` en paralelo al flujo productivo actual, sin cambiar respuesta al cliente ni estado de caso.

## 1. Objetivo

Shadow mode permite comparar la decision del backend AI Orchestrator contra la decision actual de n8n antes de delegar IA/routing real.

Reglas de esta fase:

- n8n sigue siendo productivo.
- Backend AI Orchestrator corre con `dryRun=true`.
- La respuesta del backend se registra y compara.
- La decision del backend no envia WhatsApp.
- La decision del backend no cierra, deriva, crea ni actualiza casos.
- La decision del backend no reemplaza la respuesta del workflow actual.

## 2. Variables requeridas en n8n

Configurar como variables/credenciales seguras en n8n:

| Variable | Valor esperado | Uso |
|---|---|---|
| `AI_ORCHESTRATOR_ENABLED` | `true` o `false` | Controla si n8n llama al backend. |
| `AI_ORCHESTRATOR_SHADOW_MODE` | `true` o `false` | Controla si la respuesta backend es solo comparativa. |
| `AI_ORCHESTRATOR_URL` | `https://hub.pesaschile.cl/api/ai/orchestrate` | URL del endpoint backend. |
| `AI_ORCHESTRATION_API_TOKEN` | secreto largo, no reutilizado | Token M2M para `Authorization: Bearer`. |
| `AI_ORCHESTRATOR_SHADOW_LOG_ENABLED` | `false` por defecto | Variable backend. Permite escritura en `ai_orchestrator_shadow_log` solo si el request tambien envia `dryRun=true` y `shadowLog=true`. |

Valores iniciales recomendados:

```text
AI_ORCHESTRATOR_ENABLED=true
AI_ORCHESTRATOR_SHADOW_MODE=true
AI_ORCHESTRATOR_URL=https://hub.pesaschile.cl/api/ai/orchestrate
AI_ORCHESTRATION_API_TOKEN=<secret>
AI_ORCHESTRATOR_SHADOW_LOG_ENABLED=false
```

## 3. Feature Flag Behavior

| `AI_ORCHESTRATOR_ENABLED` | `AI_ORCHESTRATOR_SHADOW_MODE` | Comportamiento |
|---|---|---|
| `false` | `true` | Llama backend y no usa respuesta. Modo util para pruebas tecnicas con flag productivo apagado. |
| `true` | `true` | Backend decide, n8n mantiene flujo actual y compara. Modo recomendado MVP. |
| `true` | `false` | Backend reemplaza flujo actual solo en agente autorizado. No habilitar sin tarea posterior y rollback probado. |
| `false` | `false` | No llama backend. Flujo n8n legacy puro. |

Implementacion recomendada en n8n:

- Usar `AI_ORCHESTRATOR_SHADOW_MODE=true` para forzar `featureFlags.dryRun=true`.
- No leer `actions[].enabled` para ejecutar efectos mientras shadow mode este activo.
- Aunque `enabled=true` por error, shadow mode debe bloquear toda ejecucion downstream basada en backend.

## 4. HTTP Request Node

Metodo:

```text
POST
```

URL:

```text
{{$env.AI_ORCHESTRATOR_URL}}
```

Headers exactos:

```json
{
  "Authorization": "Bearer {{$env.AI_ORCHESTRATION_API_TOKEN}}",
  "Content-Type": "application/json"
}
```

Timeout recomendado:

```text
8000 ms
```

Razon:

- Debe ser menor que el timeout total del webhook/productive workflow.
- El endpoint mock no llama LLM, por lo que 8s es suficiente.
- Cuando exista runtime real, el backend debe seguir teniendo timeout interno menor al timeout n8n.

Retry policy recomendada:

- Reintentos automaticos: `0` en el camino productivo inicial.
- Si n8n necesita retry tecnico, maximo `1` retry con backoff corto y solo si no bloquea el flujo productivo.
- Nunca reintentar antes de responder al cliente si eso aumenta latencia del flujo actual.
- Si falla, continuar workflow legacy.

## 5. Payload exacto

Body JSON para HTTP Request node:

```json
{
  "source": "n8n_meta_webhook",
  "contextMode": "standard",
  "waId": "{{$json.input_event?.wa_id || $json.wa_id || $json.phone_normalized || ''}}",
  "phoneNumberId": "{{$json.input_event?.phone_number_id || $json.phone_number_id || ''}}",
  "messageId": "{{$json.input_event?.provider_message_id || $json.provider_message_id || $json.message_id || ''}}",
  "messageText": "{{$json.input_event?.message_text || $json.message_text || $json.text || ''}}",
  "conversationCaseId": "{{$json.case_context?.conversation_case_id || $json.case_context?.case_id || $json.conversation_case_id || undefined}}",
  "customerRef": {
    "waId": "{{$json.input_event?.wa_id || $json.wa_id || $json.phone_normalized || ''}}",
    "phoneNumberId": "{{$json.input_event?.phone_number_id || $json.phone_number_id || ''}}",
    "idCustomer": "{{$json.customer_context?.id_customer || $json.case_context?.id_customer || undefined}}",
    "idOrder": "{{$json.customer_context?.last_order_id || $json.case_context?.id_order || undefined}}",
    "invoiceNumber": "{{$json.customer_context?.invoice_number || $json.case_context?.invoice_number || undefined}}",
    "email": "{{$json.customer_context?.email || undefined}}",
    "contactId": "{{$json.contact_id || $json.customer_context?.contact_id || undefined}}"
  },
  "limits": {
    "maxHistoryMessages": 8,
    "maxContextChars": 12000,
    "maxOutputTokens": 600,
    "timeoutMs": 7000
  },
  "featureFlags": {
    "allowAutoReply": false,
    "allowCaseMutation": false,
    "allowHumanHandoff": true,
    "allowCaseClose": false,
    "allowFollowup": false,
    "shadowLog": true,
    "dryRun": true
  }
}
```

Notas:

- `dryRun` debe ser `true` mientras `AI_ORCHESTRATOR_SHADOW_MODE=true`.
- `shadowLog=true` solo solicita logging; el backend escribe un registro unicamente si `AI_ORCHESTRATOR_SHADOW_LOG_ENABLED=true`.
- `allowCaseMutation` debe ser `false` en shadow mode.
- `allowAutoReply` debe ser `false` en shadow mode si se quiere evitar que una accion aparezca como ejecutable.
- El payload debe ser minimo. No enviar `business_context` completo, historial completo ni outputs raw de otros agentes.

## 6. Backend failure handling

Si el HTTP Request falla por timeout, 401/403, 5xx o red:

1. No interrumpir el workflow actual.
2. Continuar con decision legacy n8n.
3. Registrar error tecnico de shadow mode.
4. No enviar mensaje adicional al cliente por este fallo.
5. No marcar caso como error por este fallo.

Registro minimo del fallo:

```json
{
  "shadow_status": "backend_error",
  "error_type": "timeout | auth | http_error | network_error",
  "workflow": "{{$workflow.name}}",
  "execution_id": "{{$execution.id}}",
  "provider_message_id": "{{$json.input_event?.provider_message_id || $json.provider_message_id || ''}}"
}
```

## 7. Handling `ok=false`

Si backend responde `ok=false`:

1. Tratar la respuesta como observacion comparativa, no como fallo productivo.
2. Guardar `errors[]`, `decisionId`, `envelope.finalAction` si existe.
3. Continuar con decision legacy n8n.
4. No ejecutar `actions`.
5. No enviar `replyText`.

Casos esperados:

- `INVALID_INPUT`: payload n8n incompleto.
- `CONTEXT_EXCEEDED`: payload demasiado grande.
- `FEATURE_DISABLED`: accion bloqueada por flags.
- `INVALID_OUTPUT`: fallback seguro del backend.

## 8. Comparacion backend vs n8n actual

Comparar despues de que n8n tenga su decision actual normalizada.

Campos backend:

- `envelope.intent`
- `envelope.department`
- `envelope.caseTopic`
- `envelope.commercialStatus`
- `envelope.customerSignal`
- `envelope.finalAction`
- `envelope.requiresHuman`
- `envelope.shouldReply`
- `envelope.nextAction`
- `envelope.confidence`
- `actions[].type`
- `actions[].status`
- `errors[].code`

Campos n8n legacy sugeridos:

- `decision.action_type`
- `case_update.department`
- `case_update.case_type`
- `case_update.service_code`
- `case_update.status`
- `decision.requires_human`
- `decision.allowed_to_auto_reply`
- `next_steps.target_workflow`
- `safety.blocked_reason`
- `classification.intent`
- `route_confidence`

Resultado comparativo sugerido:

```json
{
  "shadow_compare": {
    "same_department": true,
    "same_handoff": true,
    "same_reply_policy": false,
    "same_final_action": false,
    "backend_final_action": "human_required",
    "legacy_final_action": "reply",
    "backend_confidence": 0.86,
    "legacy_confidence": 0.72,
    "review_required": true,
    "review_reason": "reply_policy_mismatch"
  }
}
```

Mismatches que deben revisarse primero:

- Backend dice `requiresHuman=true`, legacy responde automatico.
- Backend dice `department=SAC`, legacy envia a Ventas o Postventa.
- Backend dice `close_case`, legacy continua conversacion.
- Backend `confidence < 0.7`, legacy auto-responde.
- Backend `ok=false` recurrente por payload invalido.

## 9. Como evitar impacto al cliente

Reglas obligatorias en shadow mode:

- No usar `envelope.replyText` para responder.
- No usar `actions` para ejecutar writes.
- No cambiar `target_workflow` legacy con base en backend.
- No cambiar `case_update` legacy con base en backend.
- No bloquear handoff legacy si backend falla.
- No agregar ramas que esperen al backend antes de la respuesta productiva si sube latencia.
- No enviar al cliente mensajes de error del backend.

Patron recomendado:

1. Duplicar item para shadow mode o ejecutar llamada en rama lateral.
2. Guardar resultado shadow.
3. Reunirlo solo para logging/comparacion.
4. Mantener salida productiva del workflow desde rama legacy.

## 10. Almacenamiento de resultados

### Opcion A: temporal en execution/log n8n

Guardar respuesta backend y comparacion dentro del execution data de n8n.

Ventajas:

- No requiere schema DB.
- Implementacion rapida.
- Adecuado para primeras pruebas controladas.

Desventajas:

- Aumenta peso de executions.
- Dificulta analisis historico.
- Puede agravar el problema de carga si se guarda payload completo.

Recomendacion: no usar como storage principal. Solo sirve para depuracion puntual y de bajo volumen.

### Opcion B: tabla `ai_orchestrator_shadow_log`

Tabla dedicada para auditoria y analisis.

Migracion creada:

```text
migrations/002_ai_orchestrator_shadow_log.sql
```

SQL:

```sql
CREATE TABLE IF NOT EXISTS ai_orchestrator_shadow_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  wa_id VARCHAR(40) NULL,
  phone_number_id VARCHAR(80) NULL,
  message_id VARCHAR(180) NOT NULL,
  conversation_case_id BIGINT NULL,

  backend_decision_id VARCHAR(120) NULL,
  backend_intent VARCHAR(80) NULL,
  backend_department VARCHAR(80) NULL,
  backend_final_action VARCHAR(80) NULL,
  backend_requires_human TINYINT(1) NULL,
  backend_should_reply TINYINT(1) NULL,
  backend_confidence DECIMAL(5,4) NULL,
  backend_ok TINYINT(1) NOT NULL DEFAULT 0,
  backend_error VARCHAR(500) NULL,

  current_n8n_intent VARCHAR(80) NULL,
  current_n8n_department VARCHAR(80) NULL,
  current_n8n_final_action VARCHAR(80) NULL,

  matched_intent TINYINT(1) NULL,
  matched_department TINYINT(1) NULL,
  matched_final_action TINYINT(1) NULL,

  latency_ms INT UNSIGNED NULL,
  raw_request_json JSON NULL,
  raw_response_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_ai_shadow_message_id (message_id),
  INDEX idx_ai_shadow_wa_created (wa_id, created_at),
  INDEX idx_ai_shadow_case_created (conversation_case_id, created_at),
  INDEX idx_ai_shadow_backend_decision (backend_decision_id),
  INDEX idx_ai_shadow_created_at (created_at)
);
```

Helper preparado, no conectado aun al endpoint:

```text
lib/ai/orchestration/shadow-log.ts
```

Contrato del helper:

- Recibe `ShadowLogInput`.
- Inserta solo si la tabla existe.
- Trunca `rawRequestJson` y `rawResponseJson` a `12000` caracteres por defecto.
- Si falla, devuelve `{ ok: false, error }`.
- No lanza error fatal al flujo productivo.

Recomendacion MVP y produccion: usar Opcion B. Es preferible a execution logs porque n8n ya esta bajo presion operacional.

### Opcion C: `hub_audit_log`

Registrar evento `ai_orchestrator_shadow_result` en `hub_audit_log` si la tabla soporta payload JSON suficiente.

Ventajas:

- Reutiliza auditoria existente.
- Mejor que execution logs si ya hay trazabilidad operacional.

Desventajas:

- Puede mezclar auditoria humana/casos con telemetria comparativa de IA.
- Puede requerir adapter para no inflar eventos.
- No ideal para consultas analiticas frecuentes.

Recomendacion intermedia: usar Opcion C solo si se necesita visibilidad desde HUB antes de exponer consultas sobre `ai_orchestrator_shadow_log`.

## 10.1 Politica de retencion

Reglas iniciales:

- No guardar payloads completos por defecto.
- Guardar `raw_request_json` y `raw_response_json` solo truncados.
- Mantener columnas comparativas normalizadas como fuente principal de analisis.
- Borrar registros antiguos de alto volumen.

Retention recomendada para MVP:

```sql
DELETE FROM ai_orchestrator_shadow_log
WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
```

Retention recomendada cuando suba el volumen:

- Mantener 7 a 14 dias de `raw_request_json`/`raw_response_json`.
- Mantener 30 a 90 dias de columnas normalizadas si el volumen lo permite.
- Evaluar particion por fecha si la tabla crece mas alla de la operacion del HUB.

Importante: desde `TASK-P1C-004C`, el endpoint `/api/ai/orchestrate` puede escribir en esta tabla solo cuando se cumplen las tres condiciones: `featureFlags.dryRun=true`, `featureFlags.shadowLog=true` y `AI_ORCHESTRATOR_SHADOW_LOG_ENABLED=true`.

La escritura inicial registra campos backend y deja `current_n8n_intent`, `current_n8n_department` y `current_n8n_final_action` en `NULL`. Esos campos se poblaran desde n8n en una integracion posterior, cuando el workflow envie o persista su decision legacy normalizada.

## 11. Rollback

Rollback inmediato:

```text
AI_ORCHESTRATOR_ENABLED=false
AI_ORCHESTRATOR_SHADOW_MODE=false
AI_ORCHESTRATOR_SHADOW_LOG_ENABLED=false
```

Rollback parcial:

```text
AI_ORCHESTRATOR_ENABLED=true
AI_ORCHESTRATOR_SHADOW_MODE=true
```

Reglas:

- Si sube latencia o fallan auth/timeouts, apagar `AI_ORCHESTRATOR_ENABLED`.
- Si el backend responde pero hay demasiados mismatches, mantener shadow y no pasar a replace mode.
- Si se detecta payload demasiado grande, reducir `maxHistoryMessages` y `maxContextChars`.
- No borrar el camino legacy mientras exista shadow mode.

## 12. Checklist de prueba

Antes de activar en cualquier workflow:

- `AI_ORCHESTRATION_API_TOKEN` configurado en backend y n8n.
- `AI_ORCHESTRATOR_URL` apunta a `/api/ai/orchestrate`.
- HTTP Request usa `Authorization: Bearer`.
- `dryRun=true`.
- `shadowLog=true` solo si se quiere persistir resultado shadow.
- `AI_ORCHESTRATOR_SHADOW_LOG_ENABLED=true` solo en ambientes donde la migracion `002_ai_orchestrator_shadow_log.sql` ya fue aplicada.
- `allowCaseMutation=false`.
- `allowAutoReply=false` para primera prueba.
- Timeout HTTP Request configurado en 8000 ms o menos.
- Backend failure continua flujo legacy.
- `ok=false` continua flujo legacy.
- Resultado backend no alimenta nodos de WhatsApp, handoff, cierre ni DB writes.
- Comparacion registra campos minimos.
- Payload no incluye contexto completo ni raw workflow data.
- Prueba con venta, postventa, SAC, cierre, no action y backend error.

Casos minimos:

| Caso | Texto | Esperado backend | Esperado productivo |
|---|---|---|---|
| Venta | `quiero saber precio y stock` | `intent=sales`, `finalAction=human_required` si `allowAutoReply=false` | n8n legacy responde/deriva segun flujo actual. |
| Postventa | `necesito mantencion` | `department=Postventa`, handoff o human required | n8n legacy sigue igual. |
| SAC | `tengo un reclamo con mi pedido` | `department=SAC`, `requiresHuman=true` | n8n legacy sigue igual. |
| Cierre | `no gracias` | `finalAction=close_case`, action bloqueada por `allowCaseMutation=false` | n8n legacy sigue igual. |
| No action | `ok` sin contexto | `finalAction=no_action` | n8n legacy sigue igual. |
| Error backend | token invalido o URL invalida | error registrado | n8n legacy sigue igual. |

## 13. Decision de avance

Estado recomendado despues de esta tarea:

- `TASK-P1C-004B`: `DONE`.
- `TASK-P1C-004C`: `DONE`.
- Siguiente tarea: conectar la decision legacy de n8n a `current_n8n_*` para calcular comparacion real por `intent`, `department` y `final_action`.

No pasar a `enabled=true + shadow=false` hasta tener almacenamiento de resultados, metricas de comparacion y rollback probado.
