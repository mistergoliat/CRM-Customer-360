# Brain Action Policy

`Brain Action Policy` es la capa deterministica que resuelve si un inbound puede seguir por legacy, si requiere revision humana o si debe quedar bloqueado. No llama LLM, no escribe DB y no ejecuta WhatsApp.

## Endpoint

`POST /api/brain/actions/resolve`

Autenticacion soportada:

- `Authorization: Bearer <AI_ORCHESTRATION_API_TOKEN>`
- sesion de operador valida para pruebas internas

## Contrato minimo

Request:

- `source`
- `waId`
- `phoneNumberId`
- `messageId`
- `messageText`
- `contextSummary`
- `botEligibility`
- `serviceContext`
- `options.dryRun`
- `options.executeActions` siempre debe quedar en `false`
- `options.returnInstructionsForN8n`
- `options.debug`

Response:

- `action_policy`
- `normalized_action`
- `blocked_reasons`
- `warnings`
- `errors`
- `instructions`

## Reglas canonicas

- `executeActions=true` bloquea la solicitud.
- Mensaje vacio produce `no_action`.
- `suppression_active` bloquea.
- `active_human_case` produce `needs_human_review`.
- `recent_manual_reply` produce `needs_human_review`.
- `closed_or_rejected_case` mantiene `continue_legacy`.
- `ambiguous_positive_reply_with_service_context` produce `needs_human_review`.
- Si no hay bloqueo, el resultado suele ser `continue_legacy` o `context_only` segun contexto.

## Mapeo desde n8n

- `AI_AGENT_ResponsePolicy` -> `resolveBrainResponsePolicy()`
- `Code - Normalize Bot Reply Text` -> normalizacion de texto dentro de `responsePolicy.ts`
- `Code - Normalize Action For Switch` -> `normalized_action`
- `Switch Action` -> `action_policy.decision`
- `Code - Agent Dispatcher` -> `instructions.actions`
- `OPS_Response_Executor / Validate Auto Reply Rules` -> `botEligibility`, `blocked_reasons`, `continueLegacyFlow`

## Ejemplos operativos

### Auto reply bloqueado por manual reply

- `recent_manual_reply=true`
- `normalized_action=needs_human_review`
- `continueLegacyFlow=false`

### Suppression activa

- `suppression_active=true`
- `normalized_action=blocked`
- `blocked_reasons` incluye `suppression_active`

### Mensaje vacio

- `messageText=""`
- `normalized_action=no_action`
- `should_reply=false`

### Caso humano activo

- `active_human_case=true`
- `normalized_action=needs_human_review`
- `requires_human=true`

### Contexto limpio

- sin blockers
- `normalized_action=continue_legacy`
- `continueLegacyFlow=true`

## Uso por `process-inbound`

`POST /api/brain/process-inbound` resuelve primero contexto y despues policy/action. El resultado de esta capa se entrega a n8n como instrucciones estructuradas, pero no se ejecuta nada desde backend.

