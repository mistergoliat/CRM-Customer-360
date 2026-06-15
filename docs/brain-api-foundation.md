# Brain API Foundation

`Brain API` es la base del backend que recibira el inbound conversacional normalizado desde n8n y, mas adelante, desde Meta directo.

## Objetivo

Crear un skeleton seguro para `POST /api/brain/process-inbound` que:

- valida campos minimos
- responde rapido
- falla cerrado
- devuelve instrucciones estructuradas para n8n
- no ejecuta WhatsApp, LLM, mutaciones de caso ni writes de DB

## Estado actual

En P1D, el endpoint funciona como adaptador puro:

- recibe el evento normalizado
- normaliza defaults
- resuelve contexto como `noop`
- construye instrucciones estructuradas
- conserva el flujo legacy de n8n

No reemplaza aun el webhook productivo de n8n.

## Extension P1F

En P1F, `POST /api/brain/process-inbound` sigue sin ejecutar side effects, pero ahora:

- resuelve contexto backend real mediante `POST /api/brain/context/resolve`
- deriva `context_summary` liviano
- resuelve `action_policy` y `normalized_action` mediante la capa deterministica de backend
- bloquea `executeActions=true`
- preserva `continueLegacyFlow` segun policy

La politica de respuesta y el router de accion viven en `docs/brain-action-policy.md` y en `POST /api/brain/actions/resolve`.

## Request

Autenticacion inicial:

- `Authorization: Bearer <AI_ORCHESTRATION_API_TOKEN>`

El endpoint reutiliza el guard existente de integraciones internas mientras n8n siga siendo el consumidor principal.

Campos minimos obligatorios:

- `channel`
- `waId`
- `phoneNumberId`
- `messageId`
- `messageText`

Opciones soportadas:

- `dryRun`
- `executeActions`
- `returnInstructionsForN8n`
- `runAgentDryRun`
- `preferredAgent` (`knowledge` por ahora)
- `persistOutboxPlan` habilita, solo bajo flag de entorno, la creacion de una fila `planned` en `brain_message_outbox` para uso posterior del worker. No envia WhatsApp ni bloquea el flujo legacy.

Defaults actuales:

- `dryRun=true`
- `executeActions=false`
- `returnInstructionsForN8n=true`
- `debug=false`
- `runAgentDryRun=false`
- `buildExecutionPlanDryRun=false`
- `preferredAgent` no definido
- `persistOutboxPlan=false`

`executeActions=true` sigue bloqueado en P1D. El endpoint devuelve una respuesta estructurada, pero no ejecuta acciones reales ni muta casos.

En P1F, `process-inbound` y `actions/resolve` deben seguir operando como capas read-only. `instructions.executeActions` permanece en `false` y `continueLegacyFlow` ya no se asume incondicionalmente.

## Response

La respuesta incluye:

- `ok`
- `requestId`
- `normalized`
- `context`
- `context_summary`
- `bot_eligibility`
- `context_packs_available`
- `suggested_next_step`
- `agent_draft` cuando `runAgentDryRun=true`
- `instructions`
- `outbox_plan_result` cuando `persistOutboxPlan=true` y el gate estricto permite crear o reutilizar un plan `planned`
- `warnings`
- `errors`
- `adapters`
- `metadata`

`instructions` es el contrato que n8n puede leer para la siguiente fase de migracion.

`agent_draft` existe solo cuando `runAgentDryRun=true` y hoy corresponde al Knowledge Agent backend. Es observacional y no cambia la respuesta al cliente.

`context_summary` es la vista liviana para thin client. El contexto completo del resolver backend solo se expone cuando `options.debug=true`.

`action_policy` y `normalized_action` son el contrato estable para reemplazar la logica dispersa de policy/switch/dispatcher de n8n sin side effects.

`execution_plan` es opcional y aparece cuando `options.buildExecutionPlanDryRun=true`. Representa solo un preview del Response Executor; nunca es ejecutable en P1I.

Cuando `runAgentDryRun=true`, `process-inbound` puede invocar el `Knowledge Agent` mock solo para observacion. Ese draft se expone como `agent_draft` y no se usa para responder al cliente ni para mutar casos.

## Como lo llamara n8n

Patron recomendado:

1. El workflow inbound normaliza el mensaje.
2. N8n llama `POST /api/brain/process-inbound`.
3. El backend devuelve instrucciones y contexto minimo.
4. N8n mantiene el camino legacy productivo.
5. N8n usa shadow o compare mode solo cuando la fase siguiente lo autorice.
6. Si n8n pide `executeActions=true`, el backend responde fail-closed y no ejecuta nada.
7. Si `debug=false`, el backend no expone el payload completo del resolver.
8. Si `buildExecutionPlanDryRun=true`, el backend puede adjuntar un `execution_plan` de observacion sin side effects.
9. Si `persistOutboxPlan=true` y `BRAIN_PROCESS_INBOUND_ALLOW_OUTBOX_PLAN=true`, `processInbound` puede crear o reutilizar una fila `planned` en `brain_message_outbox` usando el `agent_draft` aprobado por policy. Eso no envia WhatsApp, no bloquea el worker y no cambia casos.

## Outbox planning controlado

P1I-009 agrega un camino estrictamente opt-in para dejar preparado el mensaje saliente en la outbox sin ejecutar envios:

- requiere `dryRun=true`
- requiere `executeActions=false`
- requiere `runAgentDryRun=true`
- requiere `persistOutboxPlan=true`
- requiere `BRAIN_PROCESS_INBOUND_ALLOW_OUTBOX_PLAN=true`
- requiere `agent_draft.decision === "answer"`
- requiere `agent_draft.message` no vacio
- requiere `action_policy.can_auto_reply === true`
- requiere `bot_eligibility.can_auto_reply === true`
- requiere `normalized_action.action` distinto de `blocked`, `no_action` y `needs_human_review`

El resultado aparece en `outbox_plan_result` con estados como `skipped_by_flag`, `skipped_by_policy`, `planned`, `existing` o `warning`. El flujo legacy sigue activo y `continueLegacyFlow` permanece en `true`.

Ejemplo de request:

```json
{
  "channel": "whatsapp",
  "source": "n8n_meta_webhook",
  "waId": "56912345678",
  "phoneNumberId": "123456789",
  "messageId": "wamid.demo",
  "messageText": "Hola, quiero saber precio y stock",
  "conversationCaseId": 4821,
  "customerRef": {
    "waId": "56912345678",
    "idCustomer": 10045,
    "email": "cliente@example.com"
  },
  "options": {
    "dryRun": true,
    "executeActions": false,
    "returnInstructionsForN8n": true
  }
}
```

Ejemplo de response:

```json
{
  "ok": true,
  "requestId": "brain-1f4cc3c1b9b8d7d0",
  "channel": "whatsapp",
  "source": "n8n_meta_webhook",
  "instructions": {
    "version": "brain.instructions.v1",
    "dryRun": true,
    "executeActions": false,
    "returnInstructionsForN8n": true,
    "continueLegacyFlow": true,
    "steps": [
      {
        "id": "continue-legacy-flow",
        "kind": "continue_legacy_flow",
        "status": "planned",
        "target": "n8n",
        "enabled": true,
        "reason": "Keep the legacy workflow in control while P1D remains in foundation mode."
      }
    ]
  }
}
```

## Que reemplaza de n8n

Esta base prepara la salida progresiva de:

- webhook master
- context resolver
- AI orchestrator
- switch action
- case engine
- response policy
- response executor

## Que queda pendiente

- conectar resolucion real de contexto
- integrar decision IA real cuando corresponda
- mover mutaciones de caso a un backend versionado
- conectar logging operacional y comparacion shadow
- definir el adaptador final para replace mode
- documentar y ejecutar la corrida manual end-to-end del backend de envio en `docs/brain-end-to-end-send-test.md`

## Riesgos

- no existe todavia mutacion real de casos
- no existe ejecucion real de acciones
- no existe lectura de DB para resolver contexto
- no se debe interpretar como reemplazo total de n8n
