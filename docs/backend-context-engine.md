# Backend Context Engine

## Objetivo

Portar la lógica de `WA_01_Context_Resolver` desde n8n hacia un módulo backend testeable, read-only y migrable.

El endpoint base es `POST /api/brain/context/resolve`.

## Contrato

### Request

- `channel`: `whatsapp`
- `source`: origen del evento
- `waId`
- `phoneNumberId`
- `messageId`
- `messageText`
- `conversationCaseId?`
- `idOrder?`
- `idCustomer?`
- `invoiceNumber?`
- `customerRef?`
- `options.dryRun`
- `options.maxMessages`
- `options.maxAgentRuns`
- `options.maxCases`
- `options.includePostventa`
- `options.includeAgentRuns`

### Response

El response devuelve:

- `input_event`
- `resolver_identity`
- `customer_context`
- `case_context`
- `conversation_context`
- `business_context`
- `service_context`
- `bot_eligibility`
- `context_packs`
- `warnings`
- `errors`
- `partial_context`
- `metadata`

### Consumo desde `process-inbound`

`POST /api/brain/process-inbound` llama internamente a este resolver y consume una vista liviana:

- `context_summary`
- `bot_eligibility`
- `context_packs_available`
- `suggested_next_step`

El payload completo del resolver solo se expone cuando `options.debug=true`.

## Lecturas legacy

El resolver lee de forma acotada y read-only desde:

- `n8n_conversation_cases`
- `n8n_wa_inbound_messages`
- `n8n_conversation_messages`
- `n8n_wa_contact_suppression`
- `n8n_agent_runs`
- `n8n_postventa_queue`
- `n8n_mantenciones_cardio_queue`
- `ps_orders` cuando existe y tiene columnas compatibles

No hay writes, no hay mutaciones de caso y no hay llamadas a LLM.

## Mapeo WA_01 -> backend

### `input_event`

Se construye desde el request normalizado, conservando `wa_id`, `phone_number_id`, `message_id`, `message_text`, `source` y flags de ejecución.

### `resolver_identity`

Se resuelve con identidad provisional. Prioridad:

1. `conversation_case_id`
2. `id_order`
3. `id_customer`
4. `invoice_number`
5. `wa_id`
6. fallback provisional

### `customer_context`

Se arma con identidad provisional, supresión, último inbound, último outbound, último reply manual y conteo de casos abiertos.

### `case_context`

Se deriva desde `n8n_conversation_cases` con reglas de estado legacy normalizadas. El resolver conserva estados antiguos como `waiting_customer`, `waiting_company`, `human_required`, `waiting_human`, `archived` y `rejected` como compatibilidad histórica.

### `conversation_context`

Se compone de mensajes recientes de `n8n_wa_inbound_messages` y `n8n_conversation_messages`, más `n8n_agent_runs` si la opción está habilitada.

### `business_context`

Se alimenta desde colas legacy de postventa y órdenes PrestaShop cuando están disponibles.

### `service_context`

Se infiere por señales de caso, cola y contexto comercial. No depende de `customer_master`.

### `bot_eligibility`

Se bloquea o degrada por:

- lock manual
- caso humano activo
- supresión activa
- reply manual reciente
- caso abierto esperando humano
- caso cerrado o rechazado
- reply positiva ambigua con contexto de servicio

### `context_packs`

Se generan packs por agente:

- Sales
- SAC
- Postventa
- Knowledge
- Campaign

## Thin client

`process-inbound` no debe depender del payload completo del resolver para su flujo normal. La vista resumida debe ser suficiente para:

- decidir si continúa el flujo legacy
- bloquear por elegibilidad del bot
- marcar revisión humana
- comparar en futuras fases con shadow mode

## Límites operativos

- `maxMessages` default: `12`
- `maxAgentRuns` default: `5`
- `maxCases` default: `5`

Las consultas están acotadas por identidad y límite. No se permiten SELECTs amplios sin filtro útil.

## Limitaciones conocidas

- No existe `customer_master`.
- La identidad es provisional y migrable.
- El resolver depende de columnas legacy observadas; si un entorno cambia nombres o tipos, el resultado puede ser parcial.
- El módulo no ejecuta acciones, no escribe DB y no reemplaza todavía a n8n productivo.

## Riesgos

- Drift de schema legacy.
- Estados legacy ambiguos entre `waiting_customer`, `waiting_company` y `human_required`.
- Falta de columnas compatibles en tablas antiguas.
- Interpretaciones distintas entre n8n y backend si el workflow legacy cambia antes de la migración.
