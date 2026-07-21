---
title: AI Orchestration Contract
doc_id: ai-orchestration-contract
status: superseded
superseded_by: docs/product/sales-agent-contract.md
version: "1.1.0"
owner: architecture
last_reviewed: 2026-07-21
source_of_truth_for: []
depends_on: []
supersedes: []
tags:
  - historical
---

# AI Orchestration Contract

> **SUPERSEDED (2026-07-21).** Este documento define un endpoint P1C (`POST /api/ai/orchestrate`) que decide con un unico envelope JSON monolitico (`intent`/`department`/`finalAction` como enums cerrados en una sola llamada), sin evidencia de que siga conectado en ninguna release ACS. La arquitectura vigente reemplaza este patron de clasificacion monolitica por un ciclo agentico gobernado por Capability Gateway: ver `docs/product/sales-agent-contract.md`, `docs/architecture/adr/ADR-001-commercial-vs-ai-decisions.md` y `docs/architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md`. No usar este contrato como referencia para nuevo trabajo de routing/clasificacion de intencion: el patron "un LLM completa un JSON de clasificacion por turno" es exactamente lo que la arquitectura ACS evita.

Contrato P1C para el futuro endpoint `POST /api/ai/orchestrate`.

Este documento define request, response, limites, feature flags, errores seguros y ejemplos para que n8n pueda delegar gradualmente routing/context building/IA pesada al backend propio sin romper la operacion actual del HUB.

## 1. Alcance

Incluido:

- Contrato `AiOrchestrationRequest`.
- Contrato `AiDecisionEnvelope`.
- Contrato `AiOrchestrationResponse`.
- Defaults de limites operativos.
- Validacion estructural y comportamiento fail-closed.
- Ejemplos para ventas, postventa, SAC, no action, cierre, follow-up y fallback.
- Modo de consumo desde n8n durante la transicion.

Fuera de alcance:

- Endpoint runtime real.
- Llamadas LLM.
- Prompts productivos.
- Cambios a workflows n8n.
- Cambios DB/schema.
- Customer 360 definitivo.
- Marketing automation funcional.

## 2. Archivos del contrato

- Tipos: `lib/ai/orchestration/types.ts`
- Validadores puros: `lib/ai/orchestration/validation.ts`

Los validadores no agregan dependencias externas y no ejecutan acciones. Solo validan estructura, aplican defaults de request y permiten construir fallback seguro.

## 3. Endpoint

```http
POST /api/ai/orchestrate
Content-Type: application/json
```

El endpoint recibe un mensaje minimo desde n8n y devuelve una decision estructurada. En P1C-003 existe como mock deterministico seguro:

- No llama LLM.
- No lee ni escribe DB.
- No envia WhatsApp.
- No modifica casos.
- No ejecuta acciones reales.
- Requiere autenticacion especifica de integracion. n8n debe enviar `Authorization: Bearer <AI_ORCHESTRATION_API_TOKEN>`.
- Para pruebas internas desde el HUB, una sesion de operador valida puede seguir accediendo al endpoint.
- `ADMIN_BYPASS_TOKEN` no debe reutilizarse como token de integracion.

P1C-004B agrega la base de almacenamiento `ai_orchestrator_shadow_log`. P1C-004C conecta el endpoint solo si `featureFlags.dryRun=true`, `featureFlags.shadowLog=true` y `AI_ORCHESTRATOR_SHADOW_LOG_ENABLED=true`. Si el logging falla, la respuesta original del endpoint se mantiene y se agrega un warning/error recuperable.

## 4. AiOrchestrationRequest

Campos obligatorios:

- `source`: origen de la invocacion. Valores: `n8n_meta_webhook`, `hub_preview`, `manual_test`, `system_job`.
- `contextMode`: profundidad del contexto. Valores: `minimal`, `standard`, `recovery`.
- `waId`: identificador WhatsApp provisional.
- `phoneNumberId`: phone number id Meta/WhatsApp.
- `messageId`: id del mensaje inbound. Debe usarse para idempotencia.
- `messageText`: texto del mensaje actual.
- `limits`: limites aplicados a contexto/output/timeout.
- `featureFlags`: permisos operativos para acciones.

Campos opcionales:

- `conversationCaseId`: id de caso existente cuando n8n ya lo resolvio.
- `customerRef`: identidad provisional. Puede incluir `waId`, `phoneNumberId`, `idCustomer`, `idOrder`, `invoiceNumber`, `email`, `contactId`.

Ejemplo:

```json
{
  "source": "n8n_meta_webhook",
  "contextMode": "standard",
  "waId": "56912345678",
  "phoneNumberId": "123456789",
  "messageId": "wamid.abc123",
  "messageText": "Hola, quiero saber si tienen stock de una trotadora",
  "conversationCaseId": 4821,
  "customerRef": {
    "waId": "56912345678",
    "idCustomer": 10045,
    "email": "cliente@example.com"
  },
  "limits": {
    "maxHistoryMessages": 12,
    "maxContextChars": 24000,
    "maxOutputTokens": 900,
    "timeoutMs": 12000
  },
  "featureFlags": {
    "allowAutoReply": true,
    "allowCaseMutation": false,
    "allowHumanHandoff": true,
    "allowCaseClose": false,
    "allowFollowup": false,
    "shadowLog": false,
    "dryRun": false
  }
}
```

## 5. Limites por defecto

Si el consumidor omite o envia limites parciales, el validador aplica defaults conservadores:

```json
{
  "maxHistoryMessages": 12,
  "maxContextChars": 24000,
  "maxOutputTokens": 900,
  "timeoutMs": 12000
}
```

Rangos aceptados por validacion:

- `maxHistoryMessages`: 0 a 30.
- `maxContextChars`: 1000 a 60000.
- `maxOutputTokens`: 100 a 2000.
- `timeoutMs`: 1000 a 30000.

## 6. Feature flags

Defaults:

```json
{
  "allowAutoReply": false,
  "allowCaseMutation": false,
  "allowHumanHandoff": true,
  "allowCaseClose": false,
  "allowFollowup": false,
  "shadowLog": false,
  "dryRun": true
}
```

Reglas:

- Si `allowAutoReply=false`, una decision `reply` debe rechazarse o convertirse en fallback seguro.
- Si `allowCaseMutation=false`, `create_case`, `update_case` y `close_case` deben quedar bloqueados.
- `allowCaseClose` queda como compatibilidad fina para cierre, pero `allowCaseMutation` es el flag general que debe usar n8n.
- Si `allowFollowup=false`, una decision `followup_needed` no puede agendar nada.
- Si `dryRun=true`, el backend puede responder envelope y acciones sugeridas, pero n8n no debe ejecutar efectos reales basados en esa decision.
- Si `shadowLog=true`, el backend solo puede intentar registrar shadow log cuando tambien `dryRun=true` y `AI_ORCHESTRATOR_SHADOW_LOG_ENABLED=true`. El fallo de logging no cambia `ok` ni bloquea la respuesta.

## 7. AiDecisionEnvelope

Campos:

- `decisionId`: id unico de decision para auditoria e idempotencia.
- `agentName`: nombre del agente/politica que decidio.
- `agentVersion`: version semantica o version operativa.
- `source`: eco del origen.
- `intent`: `sales`, `postventa`, `sac`, `knowledge`, `followup`, `close_request`, `consulta_general`, `unknown`.
- `department`: `Ventas`, `Postventa`, `SAC`, `Knowledge`, `Operaciones`, `Unknown`.
- `caseTopic`: topico operativo, por ejemplo `cotizacion`, `mantencion`, `reclamo`, `pedido`.
- `commercialStatus`: `new_lead`, `quote_requested`, `quote_sent`, `purchase_intent`, `post_sale`, `followup_needed`, `not_applicable`, `unknown`.
- `customerSignal`: `asks_price`, `asks_stock`, `asks_shipping`, `asks_human`, `complaint`, `post_sale_help`, `decline`, `continue`, `no_signal`, `unknown`.
- `finalAction`: `reply`, `handoff_to_human`, `human_required`, `no_action`, `close_case`, `followup_needed`.
- `requiresHuman`: indica si debe intervenir humano.
- `shouldReply`: indica si se permite respuesta automatica.
- `replyText`: texto de respuesta si `shouldReply=true`.
- `summaryForOperator`: resumen seguro para mostrar en HUB.
- `nextAction`: `send_reply`, `assign_human`, `mark_human_required`, `close_case`, `schedule_followup`, `noop`.
- `nextActionAt`: fecha ISO futura o `null`.
- `confidence`: numero entre `0` y `1`.
- `reasonSummary`: razon breve y auditable.
- `safetyFlags`: flags de seguridad.
- `metadata`: versionado, modo de contexto, dry run, warnings y fecha.

Reglas:

- `shouldReply=true` exige `requiresHuman=false`.
- `shouldReply=true` exige `replyText` no vacio.
- `confidence < 0.7` no puede producir auto-reply.
- `finalAction` debe estar permitido por feature flags.
- Todo output invalido debe fallar cerrado.

## 8. AiOrchestrationResponse

Campos:

- `ok`: `true` si existe decision valida y accionable dentro de feature flags.
- `decisionId`: id de decision o `null`.
- `envelope`: `AiDecisionEnvelope` o `null`.
- `actions`: acciones sugeridas, cada una con `type`, `enabled`, `reason` y `payload` opcional.
- En el mock P1C-003 cada accion incluye `status`: `planned` o `blocked`. Nunca existe `executed`.
- `usage`: metricas de input/context/output/tiempo.
- `errors`: errores estructurados.

## 9. Comportamiento seguro

| Caso | Comportamiento |
|---|---|
| Output invalido | `ok=false` o fallback con `requiresHuman=true`, `shouldReply=false`, error `INVALID_OUTPUT`. |
| Timeout | fallback con `finalAction=human_required`, error `TIMEOUT`, sin reply automatica. |
| Contexto excedido | recortar contexto antes del modelo; si aun excede, fallback `CONTEXT_EXCEEDED`. |
| Confidence baja | bloquear auto-reply y marcar `LOW_CONFIDENCE`; derivar a humano si aplica. |
| Accion no permitida por flag | bloquear accion, marcar `FEATURE_DISABLED`, mantener `dryRun` o handoff seguro. |
| Modelo no disponible | fallback `MODEL_UNAVAILABLE`, `requiresHuman=true`, `shouldReply=false`. |

## 10. Ejemplos JSON

### Venta con reply

```json
{
  "ok": true,
  "decisionId": "dec-sales-001",
  "envelope": {
    "decisionId": "dec-sales-001",
    "agentName": "AI_ORCHESTRATOR",
    "agentVersion": "0.1.0",
    "source": "n8n_meta_webhook",
    "intent": "sales",
    "department": "Ventas",
    "caseTopic": "cotizacion",
    "commercialStatus": "quote_requested",
    "customerSignal": "asks_price",
    "finalAction": "reply",
    "requiresHuman": false,
    "shouldReply": true,
    "replyText": "Tenemos opciones disponibles. Para ayudarte con una cotizacion, indicanos el tipo de maquina que buscas y tu comuna.",
    "summaryForOperator": "Cliente consulta por precio/stock. Se pide dato minimo para cotizacion.",
    "nextAction": "send_reply",
    "nextActionAt": null,
    "confidence": 0.86,
    "reasonSummary": "Consulta comercial simple con baja complejidad y sin riesgo SAC.",
    "safetyFlags": {
      "invalidOutput": false,
      "timeout": false,
      "contextExceeded": false,
      "lowConfidence": false,
      "featureDisabled": false,
      "modelUnavailable": false
    },
    "metadata": {
      "contextMode": "standard",
      "modelProvider": "mock",
      "modelName": "none",
      "promptVersion": "contract-only",
      "validatorVersion": "0.1.0",
      "dryRun": false,
      "generatedAt": "2026-06-12T12:00:00.000Z",
      "warnings": []
    }
  },
  "actions": [
    {
      "type": "send_whatsapp_reply",
      "enabled": true,
      "reason": "Auto-reply allowed by confidence and feature flag."
    }
  ],
  "usage": {
    "inputChars": 54,
    "contextChars": 1200,
    "outputChars": 400,
    "historyMessages": 3,
    "elapsedMs": 800
  },
  "errors": []
}
```

### Postventa con handoff

```json
{
  "ok": true,
  "decisionId": "dec-postventa-001",
  "envelope": {
    "decisionId": "dec-postventa-001",
    "agentName": "AI_ORCHESTRATOR",
    "agentVersion": "0.1.0",
    "source": "n8n_meta_webhook",
    "intent": "postventa",
    "department": "Postventa",
    "caseTopic": "mantencion",
    "commercialStatus": "post_sale",
    "customerSignal": "post_sale_help",
    "finalAction": "handoff_to_human",
    "requiresHuman": true,
    "shouldReply": false,
    "replyText": "",
    "summaryForOperator": "Cliente solicita mantencion. Requiere coordinacion humana.",
    "nextAction": "assign_human",
    "nextActionAt": null,
    "confidence": 0.91,
    "reasonSummary": "Postventa operacional no debe prometer agenda ni tecnico automaticamente.",
    "safetyFlags": {
      "invalidOutput": false,
      "timeout": false,
      "contextExceeded": false,
      "lowConfidence": false,
      "featureDisabled": false,
      "modelUnavailable": false
    },
    "metadata": {
      "contextMode": "standard",
      "validatorVersion": "0.1.0",
      "dryRun": false,
      "generatedAt": "2026-06-12T12:01:00.000Z",
      "warnings": []
    }
  },
  "actions": [
    {
      "type": "assign_human",
      "enabled": true,
      "reason": "Human handoff allowed."
    }
  ],
  "usage": {
    "inputChars": 38,
    "contextChars": 1600,
    "outputChars": 380,
    "historyMessages": 4,
    "elapsedMs": 700
  },
  "errors": []
}
```

### SAC con human_required

```json
{
  "ok": true,
  "decisionId": "dec-sac-001",
  "envelope": {
    "decisionId": "dec-sac-001",
    "agentName": "AI_ORCHESTRATOR",
    "agentVersion": "0.1.0",
    "source": "n8n_meta_webhook",
    "intent": "sac",
    "department": "SAC",
    "caseTopic": "reclamo",
    "commercialStatus": "not_applicable",
    "customerSignal": "complaint",
    "finalAction": "human_required",
    "requiresHuman": true,
    "shouldReply": false,
    "replyText": "",
    "summaryForOperator": "Cliente reporta reclamo o mala experiencia. Requiere revision SAC.",
    "nextAction": "mark_human_required",
    "nextActionAt": null,
    "confidence": 0.94,
    "reasonSummary": "La politica bloquea autonomia ante reclamos o riesgo SAC.",
    "safetyFlags": {
      "invalidOutput": false,
      "timeout": false,
      "contextExceeded": false,
      "lowConfidence": false,
      "featureDisabled": false,
      "modelUnavailable": false
    },
    "metadata": {
      "contextMode": "minimal",
      "validatorVersion": "0.1.0",
      "dryRun": false,
      "generatedAt": "2026-06-12T12:02:00.000Z",
      "warnings": []
    }
  },
  "actions": [
    {
      "type": "update_case",
      "enabled": true,
      "reason": "Mark case as human_required."
    }
  ],
  "usage": {
    "inputChars": 60,
    "contextChars": 800,
    "outputChars": 350,
    "historyMessages": 2,
    "elapsedMs": 650
  },
  "errors": []
}
```

### No action

```json
{
  "ok": true,
  "decisionId": "dec-noop-001",
  "envelope": {
    "decisionId": "dec-noop-001",
    "agentName": "AI_ORCHESTRATOR",
    "agentVersion": "0.1.0",
    "source": "n8n_meta_webhook",
    "intent": "consulta_general",
    "department": "Unknown",
    "caseTopic": "unknown",
    "commercialStatus": "unknown",
    "customerSignal": "no_signal",
    "finalAction": "no_action",
    "requiresHuman": false,
    "shouldReply": false,
    "replyText": "",
    "summaryForOperator": "Mensaje no requiere accion automatica.",
    "nextAction": "noop",
    "nextActionAt": null,
    "confidence": 0.77,
    "reasonSummary": "No hay senal suficiente para responder o escalar.",
    "safetyFlags": {
      "invalidOutput": false,
      "timeout": false,
      "contextExceeded": false,
      "lowConfidence": false,
      "featureDisabled": false,
      "modelUnavailable": false
    },
    "metadata": {
      "contextMode": "minimal",
      "validatorVersion": "0.1.0",
      "dryRun": true,
      "generatedAt": "2026-06-12T12:03:00.000Z",
      "warnings": []
    }
  },
  "actions": [
    {
      "type": "noop",
      "enabled": true,
      "reason": "No operational action required."
    }
  ],
  "usage": {
    "inputChars": 5,
    "contextChars": 500,
    "outputChars": 320,
    "historyMessages": 1,
    "elapsedMs": 300
  },
  "errors": []
}
```

### Close case

```json
{
  "ok": true,
  "decisionId": "dec-close-001",
  "envelope": {
    "decisionId": "dec-close-001",
    "agentName": "AI_ORCHESTRATOR",
    "agentVersion": "0.1.0",
    "source": "n8n_meta_webhook",
    "intent": "close_request",
    "department": "Postventa",
    "caseTopic": "rechazo",
    "commercialStatus": "post_sale",
    "customerSignal": "decline",
    "finalAction": "close_case",
    "requiresHuman": false,
    "shouldReply": false,
    "replyText": "",
    "summaryForOperator": "Cliente indica que no desea continuar. Candidato a cierre.",
    "nextAction": "close_case",
    "nextActionAt": null,
    "confidence": 0.9,
    "reasonSummary": "Senal explicita de rechazo dentro de caso activo.",
    "safetyFlags": {
      "invalidOutput": false,
      "timeout": false,
      "contextExceeded": false,
      "lowConfidence": false,
      "featureDisabled": false,
      "modelUnavailable": false
    },
    "metadata": {
      "contextMode": "standard",
      "validatorVersion": "0.1.0",
      "dryRun": true,
      "generatedAt": "2026-06-12T12:04:00.000Z",
      "warnings": ["close_case requires allowCaseClose=true before execution"]
    }
  },
  "actions": [
    {
      "type": "close_case",
      "enabled": false,
      "reason": "Dry run or allowCaseClose disabled."
    }
  ],
  "usage": {
    "inputChars": 10,
    "contextChars": 1800,
    "outputChars": 360,
    "historyMessages": 5,
    "elapsedMs": 620
  },
  "errors": []
}
```

### Followup needed

```json
{
  "ok": true,
  "decisionId": "dec-followup-001",
  "envelope": {
    "decisionId": "dec-followup-001",
    "agentName": "AI_ORCHESTRATOR",
    "agentVersion": "0.1.0",
    "source": "n8n_meta_webhook",
    "intent": "followup",
    "department": "Ventas",
    "caseTopic": "cotizacion",
    "commercialStatus": "followup_needed",
    "customerSignal": "continue",
    "finalAction": "followup_needed",
    "requiresHuman": false,
    "shouldReply": false,
    "replyText": "",
    "summaryForOperator": "Cliente muestra interes, pero no hay dato suficiente para cierre. Conviene seguimiento comercial.",
    "nextAction": "schedule_followup",
    "nextActionAt": "2026-06-13T12:00:00.000Z",
    "confidence": 0.81,
    "reasonSummary": "Seguimiento sugerido sin activar marketing automation.",
    "safetyFlags": {
      "invalidOutput": false,
      "timeout": false,
      "contextExceeded": false,
      "lowConfidence": false,
      "featureDisabled": false,
      "modelUnavailable": false
    },
    "metadata": {
      "contextMode": "standard",
      "validatorVersion": "0.1.0",
      "dryRun": true,
      "generatedAt": "2026-06-12T12:05:00.000Z",
      "warnings": ["followup is future module; do not create marketing automation"]
    }
  },
  "actions": [
    {
      "type": "schedule_followup",
      "enabled": false,
      "reason": "Follow-up scheduler is not implemented yet."
    }
  ],
  "usage": {
    "inputChars": 30,
    "contextChars": 1400,
    "outputChars": 390,
    "historyMessages": 3,
    "elapsedMs": 560
  },
  "errors": []
}
```

### Fallback por error/timeout

```json
{
  "ok": false,
  "decisionId": "fallback-wamid.abc123",
  "envelope": {
    "decisionId": "fallback-wamid.abc123",
    "agentName": "AI_ORCHESTRATOR_FALLBACK",
    "agentVersion": "0.1.0",
    "source": "n8n_meta_webhook",
    "intent": "unknown",
    "department": "Unknown",
    "caseTopic": "unknown",
    "commercialStatus": "unknown",
    "customerSignal": "unknown",
    "finalAction": "human_required",
    "requiresHuman": true,
    "shouldReply": false,
    "replyText": "",
    "summaryForOperator": "El runtime IA no genero una decision segura. Revisar manualmente.",
    "nextAction": "mark_human_required",
    "nextActionAt": null,
    "confidence": 0,
    "reasonSummary": "Timeout en runtime IA.",
    "safetyFlags": {
      "invalidOutput": false,
      "timeout": true,
      "contextExceeded": false,
      "lowConfidence": false,
      "featureDisabled": false,
      "modelUnavailable": false
    },
    "metadata": {
      "contextMode": "standard",
      "validatorVersion": "0.1.0",
      "dryRun": false,
      "generatedAt": "2026-06-12T12:06:00.000Z",
      "warnings": ["Timeout en runtime IA."]
    }
  },
  "actions": [
    {
      "type": "update_case",
      "enabled": true,
      "reason": "Fail closed to human_required."
    }
  ],
  "usage": {
    "inputChars": 80,
    "contextChars": 24000,
    "outputChars": 0,
    "historyMessages": 12,
    "elapsedMs": 12000
  },
  "errors": [
    {
      "code": "TIMEOUT",
      "message": "AI runtime timeout.",
      "retryable": true
    }
  ]
}
```

## 11. Consumo desde n8n en transicion

Para shadow mode operativo, usar tambien `docs/n8n-shadow-mode-integration.md`.

Flujo recomendado:

1. n8n recibe webhook Meta y normaliza el evento minimo.
2. n8n arma `AiOrchestrationRequest` con `waId`, `phoneNumberId`, `messageId`, `messageText`, `conversationCaseId` si existe, `customerRef` provisional si existe, `limits` y `featureFlags`.
3. n8n llama `POST /api/ai/orchestrate` con `Authorization: Bearer <AI_ORCHESTRATION_API_TOKEN>`.
4. Backend responde `AiOrchestrationResponse`.
5. n8n valida `ok`, `envelope.finalAction`, `actions[].enabled` y feature flags antes de ejecutar efectos.
6. Si `dryRun=true`, n8n compara la decision nueva contra el workflow actual y registra diferencias, sin ejecutar la decision del backend.
7. Si el backend falla, n8n usa fallback legacy o marca `human_required`, segun flag del flujo.
8. En shadow logging inicial, el endpoint registra solo campos backend; `current_n8n_*` se completara desde n8n en una integracion posterior.

Ejemplo `curl`:

```bash
curl -X POST "$APP_BASE_URL/api/ai/orchestrate" \
  -H "Authorization: Bearer $AI_ORCHESTRATION_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "n8n_meta_webhook",
    "contextMode": "standard",
    "waId": "56912345678",
    "phoneNumberId": "123456789",
    "messageId": "wamid.demo",
    "messageText": "Hola, quiero saber precio y stock",
    "limits": {
      "maxHistoryMessages": 12,
      "maxContextChars": 24000,
      "maxOutputTokens": 900,
      "timeoutMs": 12000
    },
    "featureFlags": {
      "allowAutoReply": true,
      "allowCaseMutation": false,
      "allowHumanHandoff": true,
      "allowCaseClose": false,
      "allowFollowup": false,
      "shadowLog": true,
      "dryRun": true
    }
  }'
```

Rollback:

- Flag por workflow/agente: desactivar llamada al backend y volver al camino legacy.
- Flag por accion: desactivar solo `allowAutoReply`, `allowCaseClose` o `allowFollowup`.
- Flag `dryRun`: mantener comparacion sin efectos reales.

## 12. Relacion con Customer 360 y marketing

Este contrato solo acepta `customerRef` provisional. No requiere `customer_master`, no crea `customer_key` definitivo y no construye Customer 360.

`followup_needed` es solo una decision estructurada futura. No agenda marketing automation ni reemplaza Brevo en esta tarea.
