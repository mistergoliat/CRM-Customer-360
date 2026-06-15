# Brain Knowledge Agent

`Knowledge Agent` es el primer agente backend real/controlado de PesasChile AI Hub.

## Objetivo

- responder solo preguntas de conocimiento general y politica publica del negocio
- abstenerse o derivar cuando la consulta exija datos operativos no confiables
- permanecer read-only, sin WhatsApp, sin DB writes y sin mutaciones de caso
- servir como base para migrar el shell correspondiente de n8n

## Alcance

El agente cubre:

- horario de atencion
- ubicacion y retiro cuando existan datos seguros
- medios de pago cuando existan datos seguros
- FAQ y politicas generales
- preguntas de conocimiento general dentro de la base segura disponible

El agente debe abstenerse o derivar cuando detecta:

- reclamo
- garantia
- devolucion
- estado de pedido
- armado
- mantencion
- compra o cotizacion
- precio o stock sin fuente confiable
- solicitud explicita de humano

## Contrato de salida

### `decision`

- `answer`
- `abstain`
- `handoff_recommended`
- `route_to_sales`
- `route_to_sac`
- `route_to_postventa`

### `answer_type`

- `business_info`
- `faq`
- `policy`
- `location`
- `payment`
- `generic`
- `none`

### Campos obligatorios

- `agentName`
- `agentVersion`
- `decision`
- `answer_type`
- `message`
- `confidence`
- `sources_used`
- `safety_flags`
- `tool_requests`
- `warnings`

## Prompt / system instruction

El prompt del agente vive en `lib/brain/agents/knowledge/prompt.ts`.

Puntos clave:

- no inventar stock, precio, descuentos, garantias ni estados de pedido
- no prometer plazos o resultados no documentados
- no ejecutar acciones
- no responder fuera del alcance seguro
- si la confianza cae, abstenerse o derivar

## Tools read-only

Las herramientas seguras del agente son:

- `searchKnowledge`
- `getStaticBusinessInfo`
- `getKnowledgePolicy`

Implementacion inicial:

- `searchKnowledge` hace matching simple sobre FAQs seguras
- `getStaticBusinessInfo` expone solo info estatica segura
- `getKnowledgePolicy` devuelve las reglas del agente

## Modo mock vs real

El agente funciona en modo mock por defecto.

Flag:

- `BRAIN_ENABLE_REAL_MODEL=false` por defecto

Cuando el flag esta activo:

- el runtime intenta usar un endpoint OpenAI-compatible configurado por `BRAIN_MODEL_API_URL`
- si faltan credenciales o el provider no responde, el agente falla cerrado y devuelve una salida segura de abstencion
- si el output del provider no valida, la respuesta se bloquea y se reporta como invalida

## Ejemplos

### Answer

Consulta: `Cual es el horario de atencion?`

Respuesta esperada:

- `decision=answer`
- `answer_type=business_info`
- `sources_used=["static_business_info"]`

### Abstain

Consulta: `Tienen stock del modelo X?`

Respuesta esperada:

- `decision=route_to_sales` o `abstain`
- `answer_type=none`
- `safety_flags` sin promesas operativas

### Handoff recommended

Consulta: `Necesito hablar con una persona`

Respuesta esperada:

- `decision=handoff_recommended`
- `answer_type=none`
- `sources_used=["knowledge_policy"]`

## Integracion con `processInbound`

`processInbound` puede transportar `agent_draft` para observacion, pero ese draft no se usa para responder al cliente ni para mutar casos.

La respuesta productiva sigue controlada por la pipeline legacy hasta que la siguiente fase habilite reemplazo real.
