# AI SDR Implementation Blueprint

Este documento fija el tramo comercial del backend IA para P1K. No introduce runtime, prompts, endpoints ni writes.

## 1. Objetivo

Construir una capa deterministica que convierta el contexto de Brain + inbound en un `SalesAgentInput` seguro, estable y serializable.

La meta inmediata no es razonar ni responder, sino preparar un paquete comercial limpio para el futuro `Sales Agent Runtime`.

## 2. Estado actual

Ya existe:

- `Brain Context Engine`
- `Customer Candidate` de solo lectura bajo `customer_context.customer_candidate`
- contratos de Lead, Opportunity, Follow-up, Sales Agent y Operator Copilot en la capa de diseño
- resolución previa de contexto y normalizacion inbound

Todavia no existe:

- runtime de Sales Agent
- prompt comercial
- validator de output comercial
- persistencia comercial de Lead u Opportunity

## 3. P1K-007A

`P1K-007A` implementa `buildCommercialContext(input)` como adaptador puro.

Responsabilidades:

- leer Brain Context existente
- leer el inbound actual
- extraer referencias comerciales explicitas
- sanitizar payloads sensibles
- limitar historial reciente
- clasificar completitud sin inferir intencion de alto nivel
- devolver `SalesAgentInput` JSON serializable

Fuera de alcance:

- LLM
- tools
- DB
- prompts
- endpoints
- n8n
- outbox
- UI

## 4. Firma

```ts
buildCommercialContext(input: CommercialContextBuilderInput): CommercialContextBuilderResult
```

### Input

- `brainContext`
- `inboundMessage`
- `requestedMode`
- `currentTime`
- `timezone`
- `availableCapabilities`
- `policyContext?`
- `metadata?`

### Output

- `success`
- `insufficient_context`
- `invalid_input`

Cada salida expone:

- `salesAgentInput`
- `warnings`
- `sourceSummary`
- `completeness`
- `metadata`

## 5. Mapping

El builder extrae solo señales explicitamente observables.

### Identidad

- `customerCandidate`
- `conversationCaseId`
- `waId`
- `email`
- `phone`
- `idCustomer`
- `idOrder`
- `invoiceNumber`
- `contactId`

### Mensajeria

- `latest inbound message`
- `latest outbound message`
- `recent messages`
- `channel`
- `platform`
- `timestamps` relevantes

### Caso / operacion

- `department`
- `case status`
- `human ownership`
- `AI blocked`
- `manual reply`

### Comercial

- `commercial intent legacy`
- `order context`
- `product/service context`

### Señales estructurales permitidas

- `customer_message_present`
- `customer_candidate_available`
- `customer_reference_available`
- `order_reference_available`
- `product_service_context_available`
- `conversation_history_available`
- `human_owner_active`
- `ai_blocked`
- `manual_reply_active`
- `commercial_entity_available`

No se generan senales tipo:

- `high_intent`
- `objection_price`
- `readiness`
- `product_fit`

Esas corresponden al Sales Agent.

## 6. Lead y Opportunity

Durante esta fase:

- `lead` queda `undefined`
- `opportunity` queda `undefined`
- `missing_commercial_entity` se documenta como esperado

Esto evita convertir Case o Conversation en objetos comerciales persistentes antes de tiempo.

## 7. Completeness

La clasificacion usa cuatro niveles:

- `complete`
- `partial`
- `minimal`
- `insufficient`

Reglas base:

- sin mensaje customer relevante, el resultado debe caer en `insufficient`
- con mensaje pero sin contexto adicional, el resultado puede quedar en `minimal`
- con referencias, historial y candidato, puede subir a `partial` o `complete`

## 8. Warnings estables

El builder solo usa warnings estables:

- `missing_latest_customer_message`
- `missing_customer_reference`
- `missing_conversation_history`
- `missing_channel`
- `missing_commercial_entity`
- `stale_context`
- `identity_conflict`
- `ai_blocked`
- `human_owner_active`
- `unsupported_context_shape`
- `sanitization_applied`

## 9. Sanitizacion

No se expone:

- payload webhook crudo
- headers
- tokens
- credenciales
- objetos circulares
- BigInt crudo

El builder devuelve solo una copia segura y serializable.

## 10. Integracion futura

La integracion prevista, aun no implementada, es:

```text
processInbound
  -> resolveContext
  -> buildCommercialContext
  -> runSalesAgentDryRun
      -> provider
      -> rawOutput (unknown)
      -> validateSalesAgentOutput
  -> evaluateCommercialPolicy
  -> commercial evaluation
  -> shadow observation
  -> flujo productivo actual continúa sin cambios
```

`validateSalesAgentOutput` trata el output del modelo como `unknown`, aplica fail-closed y devuelve solo `valid`, `invalid` o `failed_safe`.
`evaluateCommercialPolicy` aplica la gobernanza deterministica posterior al validator.

Nada avanza hacia Policy, Governance o efectos operativos si la salida no pasa validacion estructural.
El shadow observa y registra, pero no controla la respuesta enviada ni introduce side effects.

Por ahora, el builder vive como pieza independiente para reducir riesgo y mantener la preview actual intacta.

## 11. Estado P1K

Estado actual del tramo comercial:

- `P1K-007A` DONE
- `P1K-007B` DONE
- `P1K-007C` DONE
- `P1K-007D` DONE
- `P1K-007E` DONE
- `P1K-007F` DONE

`P1K-007A` implementa `buildCommercialContext(...)` como adaptador puro.
`P1K-007B` implementa `validateSalesAgentOutput(...)` como boundary fail-closed para output desconocido.
`P1K-007C` implementa `runSalesAgentDryRun(...)` con provider inyectable, timeout y observabilidad.
`P1K-007D` implementa la `Commercial Policy` deterministica posterior al validator.
`P1K-007F` implementa la evaluación comercial visible, offline y sin activar automatización productiva.

## 12. Runtime y policy

La secuencia contractual actual es:

```text
processInbound
  -> resolveContext
  -> buildCommercialContext
  -> runSalesAgentDryRun
      -> provider
      -> rawOutput (unknown)
      -> validateSalesAgentOutput
  -> evaluateCommercialPolicy
  -> commercial evaluation
  -> shadow observation
  -> flujo productivo actual continúa sin cambios
```

`runSalesAgentDryRun` no ejecuta tools ni aplica policy.
`evaluateCommercialPolicy` no valida estructura, no ejecuta nada y solo gobierna si la propuesta comercial queda permitida, restringida, revisable o bloqueada.
`commercial evaluation` agrega trazabilidad offline y readiness sobre la salida ya observada, sin introducir side effects ni cambiar el flujo inbound.
`processInbound` incorpora el vertical comercial en modo shadow, sin side effects y sin alterar la respuesta actual del cliente.

## 13. Siguiente milestone

`P1K-007F` - `Commercial Evaluation` - DONE

La evaluación comercial visible queda cerrada como superficie read-only.
