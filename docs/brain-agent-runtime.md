# Brain Agent Runtime

`Brain Agent Runtime` es la base comun para agentes vivos del backend. Se construye sobre el contexto, policy y action router ya existentes, pero no ejecuta side effects ni llama LLM real por defecto.

## Objetivo

- reemplazar shells repetidos de n8n con un runtime versionado
- separar definicion del agente, tools y modelo
- mantener trazabilidad y contratos estructurados
- preparar `knowledge` como primer agente backend controlado
- dejar `sales`, `sac`, `postventa`, `campaign` y `supervisor` registrados pero apagados

## Contrato principal

### `AgentDefinition`

- `name`
- `version`
- `purpose`
- `allowedContextPacks`
- `allowedTools`
- `outputSchema`
- `riskLevel`
- `defaultMode`
- `enabled`

### `BrainAgentRunRequest`

- `agentName`
- `inputEvent`
- `context`
- `contextPacks`
- `actionPolicy`
- `options`

### `BrainAgentRunResponse`

- `ok`
- `agentName`
- `agentVersion`
- `decision`
- `message`
- `toolRequests`
- `confidence`
- `safetyFlags`
- `validationErrors`
- `warnings`
- `draft`

## Registry inicial

- `knowledge` habilitado y runnable solo en dry-run
- `sales`, `sac`, `postventa`, `campaign` y `supervisor` registrados pero deshabilitados

## Tool registry inicial

Todos los tools son de solo lectura o no-op:

- `searchKnowledge`
- `getStaticBusinessInfo`
- `getKnowledgePolicy`
- `getConversationHistory`
- `getActiveCase`
- `searchProducts`
- `getProductStock`
- `getOrderByInvoice`
- `explainAgentDecision`

## Knowledge Agent

`knowledge` ya no es solo un shell mock:

- tiene prompt propio
- usa tools read-only propios
- valida un output estructurado propio
- corre en modo mock por defecto
- puede activar un camino real controlado con `BRAIN_ENABLE_REAL_MODEL=true`
- si faltan credenciales, falla cerrado y devuelve abstencion segura

El resultado de `knowledge` viaja como `draft` en el runtime general y como `agent_draft` en `processInbound`, pero no se usa para responder al cliente.

## Modelo

El adapter general sigue siendo seguro por defecto:

- no llama DeepSeek
- no llama OpenAI
- no escribe DB
- no envía WhatsApp
- decide de forma deterministica o delega a `knowledge` cuando corresponde

## Logging

`agentRunLog` existe como no-op. Se usa como punto de extension para un futuro `agent_runs` backend, pero hoy no escribe nada.

## Compatibilidad con n8n

Los workflows actuales que hoy envuelven `executeWorkflowTrigger -> Normalize Input -> HTTP Request -> Validate Output -> Build DeepSeek Payload -> Insert n8n_agent_runs -> Parse DeepSeek JSON -> Return Agent Result` se pueden migrar gradualmente a:

1. normalizar inbound
2. resolver contexto con Brain API
3. llamar `POST /api/brain/agents/run`
4. recibir un output estructurado
5. mantener `n8n_agent_runs` como legado mientras no exista logging backend aprobado

`POST /api/brain/process-inbound` puede llamar este runtime en modo `runAgentDryRun=true` solo para `knowledge`. En ese caso, la respuesta viaja como `agent_draft`, permanece observacional y no reemplaza el flujo legacy.

## Ejemplo: Knowledge Agent

### Request

```json
{
  "agentName": "knowledge",
  "inputEvent": {
    "channel": "whatsapp",
    "source": "n8n_meta_webhook",
    "wa_id": "56912345678",
    "phone_number_id": "123456789",
    "message_id": "wamid.demo",
    "message_text": "Quiero saber precio y stock",
    "dry_run": true
  },
  "context": {
    "status": "noop",
    "source": "n8n_meta_webhook",
    "contextMode": "minimal",
    "traceId": "trace-demo",
    "waId": "56912345678",
    "phoneNumberId": "123456789",
    "messageId": "wamid.demo",
    "confidence": 0.8,
    "notes": ["Contexto liviano"],
    "warnings": []
  },
  "contextPacks": {
    "knowledge": {
      "agent": "knowledge",
      "available": true,
      "confidence": 0.8,
      "reason": "Knowledge context available.",
      "signals": ["catalog"],
      "recommended_action": "reply",
      "related_case_id": null,
      "related_order_id": null
    }
  },
  "actionPolicy": {
    "policyId": "brain-action-policy-trace-demo",
    "decision": "continue_legacy",
    "reason": "Policy allows legacy continuation for now.",
    "blocked_reasons": [],
    "can_auto_reply": true,
    "can_human_handoff": true,
    "can_case_mutation": true,
    "continue_legacy_flow": true,
    "should_reply": true,
    "requires_human": false,
    "confidence": 0.8,
    "signals": [],
    "suggested_next_step": "legacy_continue"
  },
  "options": {
    "dryRun": true,
    "executeActions": false,
    "debug": false
  }
}
```

### Response

```json
{
  "ok": true,
  "agentName": "knowledge",
  "agentVersion": "brain.agent.knowledge.v2",
  "decision": "reply",
  "answer_type": "business_info",
  "message": "Atencion humana disponible Lunes a viernes 09:00 a 17:00.",
  "confidence": 0.86,
  "sources_used": ["static_business_info"],
  "safety_flags": ["read_only", "no_db_writes", "no_whatsapp", "no_llm"],
  "toolRequests": [
    {
      "toolName": "searchKnowledge",
      "status": "planned",
      "reason": "Search safe knowledge snippets relevant to the customer question.",
      "blockedReasons": [],
      "input": {
        "query": "Quiero saber precio y stock"
      }
    }
  ],
  "validationErrors": [],
  "warnings": [],
  "draft": null,
  "metadata": {
    "version": "brain.agent.knowledge.runtime.v1",
    "generatedAt": "2026-06-14T00:00:00.000Z",
    "processingMs": 12,
    "dryRun": true,
    "debug": false,
    "modelName": "mock",
    "modelVersion": "brain.model.mock.v2",
    "promptVersion": "brain.knowledge.prompt.v1",
    "runtimeMode": "mock"
  }
}
```

## Riesgos actuales

- solo `knowledge` esta activo
- el camino real sigue opt-in por flag y depende de credenciales externas
- no existe logging persistente de agente aprobado aun
- no hay mutaciones de caso ni WhatsApp desde esta capa
