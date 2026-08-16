---
title: SALES-AGENT-R1-T3 - Create Quote Wiring Pre-Implementation Audit
doc_id: audit-sales-agent-r1-t3-create-quote-wiring
status: completed
owner: architecture
last_reviewed: 2026-08-15
source_of_truth_for:
  - pre-implementation design for wiring QuoteServicePort.createQuote into the Capability Gateway
depends_on:
  - ../integrations/quote-service-adapter.md
  - ../integrations/quote-input-assembly.md
  - ../audits/SALES-AGENT-R1-commercial-proposal-checkout-readiness-audit.md
  - ../releases/SALES-AGENT-R1-TASK-001-durable-handoff-fix.md
tags:
  - audit
  - sales-agent
  - quote-service
  - pre-implementation
---

# SALES-AGENT-R1-T3 - Create Quote Wiring Pre-Implementation Audit

Auditoria de solo lectura, sin cambios de codigo. Ejecutada contra
`develop` (incluye el fix de `TASK_001`, sin commit todavia). Objetivo:
resolver, antes de implementar, donde persistir la referencia al Quote real
creado (bloqueante identificado al arrancar T3) y confirmar el resto del
disefio contra lo que el codigo actual realmente soporta.

## 1. Resumen ejecutivo

**El bloqueo de persistencia tiene solucion sin migracion nueva.** El patron
ya establecido tres veces (`commercial_line_items` T13E.2,
`shipping_destination` T13D, `selected_shipping_option` T2.1) - una fila en
`crm_request_facts` (tabla generica ya existente, `migrations/017`) anclada
por `opportunity:<id>` (nunca por `crm_conversation_requests.request_id`,
runtime no canonico) con un `fact_key` propio - se extiende naturalmente a
un cuarto `fact_key`: `created_quote`. `crm_request_facts` no tiene FK a
`request_id` (es `VARCHAR(191)` opaco), y su unicidad es
`(request_id, fact_key)`, asi que este cuarto fact convive sin colision con
los otros tres.

**Hallazgo estructural que acota el alcance real de T3:** `assembleQuoteInput`
con `requireShipping: true` falla **siempre** hoy con
`shipping_tax_metadata_missing` (`assembleQuoteInput.ts:209-213`) - Carrier
MS no reporta metadata tributaria por opcion de envio, y Quote Service no
tiene ningun tipo de linea de shipping en su contrato
(`QUOTE_SERVICE_LINE_TYPES = ["product","service"]`, confirmado en
`lib/domains/quote-service/types.ts`). Esto **no es un problema de T3** -
es un gap ya documentado en `docs/integrations/quote-input-assembly.md`
("Shipping tax gap"). Consecuencia directa: **T3 solo puede conectar quotes
sin envio** (`requireShipping: false`, el default de
`AssembleQuoteInputInput`). Una quote con shipping queda bloqueada hasta que
ese gap se cierre por separado - no es parte de este alcance.

## 2. Diseno propuesto

### 2.1 Persistencia (sin migracion nueva)

```
lib/domains/created-quote/
  constants.ts   -> CREATED_QUOTE_FACT_KEY = "created_quote"
                     buildCreatedQuoteRequestAnchor(opportunityId) = `opportunity:${opportunityId}`
  types.ts       -> CreatedQuoteFactValue { quoteId, quoteNumber, status, currency,
                     assembledInputHash, selectionFactId, catalogResolvedAt,
                     idempotencyKey, createdAt }
  service.ts     -> getActiveCreatedQuoteForOpportunity(opportunityId)
                     setCreatedQuoteForOpportunity(...)  (mismo patron upsert-and-supersede)
```

`assembledInputHash` (SHA-256 del `QuoteServiceCreateQuoteInput` ya
ensamblado, mismo patron de `computeSalesAgentConfigurationHash`) y
`selectionFactId` (el `commercial_line_items.factId` activo al momento de
crear la quote) son los dos anclas de "sigue vigente" - mismo principio que
`selectionFactId`/`destinationFactId` en `selected-shipping-option`, nunca
una segunda regla de frescura inventada.

### 2.2 Idempotencia end-to-end

Quote Service exige `options.idempotencyKey` en `createQuote` y **no la
genera** (`docs/integrations/quote-service-adapter.md`, seccion
"Idempotencia": "el adapter nunca genera esta key - es responsabilidad del
caller"). Propuesta: `idempotencyKey = sha256(opportunityId + assembledInputHash)`
- mismo digest determinista que ya usa `persistAgentAction`
(`crm-agent-action-${hash}`) y `sales-agent-configuration/hash.ts`. Efecto:
dos llamadas con el MISMO input ensamblado (mismo carrito, mismo precio
observado) reusan la misma key -> Quote Service devuelve el mismo quote
(su propia semantica documentada); un input genuinamente distinto (el
cliente cambio de producto) produce una key distinta -> una quote nueva.

### 2.3 Flujo de la capability (`create_quote`)

```
1. checkAvailability(): QUOTE_SERVICE_BASE_URL configurado (mismo patron
   catalogUnavailable(port)) -> si no, "unavailable".
2. execute():
   a. Lee getActiveCreatedQuoteForOpportunity(opportunityId).
   b. Si existe y assembledInputHash coincide con un assembleQuoteInput()
      recien calculado -> devuelve la quote existente, CERO llamada HTTP
      nueva (evita crear una quote duplicada en Quote Service por un
      reintento del modelo).
   c. Si no existe, o el hash cambio (commercial_line_items se movio desde
      la ultima quote creada) -> assembleQuoteInput({ requireShipping: false, ... }).
      Un error de assembly (catalog_price_missing, customer_snapshot_incomplete,
      etc.) se mapea 1:1 a un ToolObservation "blocked"/"invalid_arguments",
      igual que el resto del Gateway - nunca se reintenta con datos
      inventados.
   d. createQuote(request, { idempotencyKey }) contra QuoteServicePort real.
   e. setCreatedQuoteForOpportunity(...) persiste la referencia (supersede
      la version anterior si habia una con hash distinto).
   f. Mapea las 9 QuoteServiceError.class a ToolObservation (mismo patron
      ya usado por calculateShippingCapability/mapCatalogErrorToOutcome -
      una tabla, nunca logica ad-hoc por caller).
```

### 2.4 Wiring en el loop (mecanico, ya con precedente exacto)

- `lib/brain/commercial/capability-gateway/createQuoteCapability.ts` (nuevo,
  mismo shape que `selectShippingOptionCapability.ts`).
- `registry.ts`: registrar la nueva capability (mismo patron que las 8
  existentes).
- `agent-loop/runAgentToolLoop.ts`: agregar `"create_quote"` a
  `AGENT_LOOP_TOOL_POOL` (linea 56-66).
- `agent-loop/buildToolObservation.ts`: proyeccion allowlisted del resultado
  (nunca el `QuoteServiceCreateQuoteInput` completo con datos de cliente de
  vuelta al modelo - solo `quoteId`/`quoteNumber`/`status`/`validUntil`,
  mismo criterio ya aplicado a `select_shipping_option`).
- `agent-loop/buildAgentStepPromptPackage.ts`: reglas de cuando el modelo
  puede invocarla (nunca antes de tener `commercial_line_items` reales,
  nunca inventar totales - mismas reglas de evidencia que el resto de tools
  mutating).

## 3. Decision de gobernanza (confirmada 2026-08-15)

`create_quote`: `authority: "autonomous"`, unicamente `createQuote` con
`status: "draft"` en Quote Service (nunca `issueQuote`/`sendQuoteEmail` en
esta tarea). Confirmado por el usuario - el corte mas chico y reversible: un
draft no llega al cliente todavia. `issueQuote`/`sendQuoteEmail`/interpretar
la decision del cliente quedan explicitamente fuera de T3 (ver seccion 4).

## 3.1. Decision abierta previa (resuelta arriba, mantenida como historial)

**Gobernanza (`governance.authority`)**: cada capability mutating declara
`authority: "autonomous"` o requiere aprobacion. `select_products`/
`set_shipping_destination`/`select_shipping_option` son `"autonomous"`
porque son reversibles y de bajo impacto (cambiar de opinion sobre un
producto no cuesta nada). **Crear una Quote real en un sistema externo es
distinto**: genera un documento con `validUntil`, potencialmente visible al
cliente por email (`sendQuoteEmail` es un endpoint separado, no cubierto
por este puerto todavia), y es el primer paso de TASK_004 en la auditoria
de checkout-readiness ("definir bien la interpretacion de aceptacion del
cliente... es el riesgo de diseno mas real"). `AGENTS.md` regla 7: "No
decisiones de permisos delegadas al LLM." Antes de implementar, hace falta
una decision explicita de producto: ¿`create_quote` es autonomo (el modelo
la crea sin pedir nada, como una cotizacion informativa/borrador), o
requiere que el runtime la dispare solo tras una condicion explicita (ej.
el cliente confirma que quiere una cotizacion formal)? Este documento
recomienda `authority: "autonomous"` con `status: "draft"` unicamente (nunca
`issueQuote`/`sendQuoteEmail` en esta misma tarea) como el corte mas chico
y reversible - pero es una llamada de producto, no puramente tecnica.

## 4. Alcance de T3 (propuesto)

**Incluye:**
- Persistencia `created_quote` (fact_key nuevo, sin migracion).
- Capability `create_quote` -> `QuoteServicePort.createQuote()` unicamente
  (`status: "draft"` en Quote Service - nunca `issueQuote`).
- Idempotencia real (mismo input ensamblado nunca crea dos quotes).
- Mapeo completo de errores de assembly + Quote Service a ToolObservation.
- Tests: unit (capability con `QuoteServicePort` real via servidor HTTP
  local, mismo patron de `httpQuoteServiceAdapter.test.ts`) + integracion
  real MariaDB para `created-quote/service.ts` (mismo patron
  `selectedShippingOption.test.ts`).

**No incluye (fuera de alcance, explicito):**
- Quotes con shipping (`requireShipping: true`) - bloqueado por el gap de
  metadata tributaria de Carrier MS, no relacionado a T3.
- `issueQuote`/`sendQuoteEmail`/`acceptQuote` - ciclo de vida posterior a
  la creacion, TASK_004+ de la auditoria de checkout-readiness.
- Visibilidad en el Hub de la quote creada (TASK_005 de esa misma
  auditoria).
- Interpretacion de la decision del cliente sobre la propuesta.

## 5. Validado contra codigo real (no supuesto)

- `crm_request_facts` sin FK a `request_id`, unicidad `(request_id, fact_key)`:
  confirmado en comentarios de `lib/domains/shipping-destination/constants.ts`
  y `lib/domains/selected-shipping-option/constants.ts`, ambos citando
  `migrations/017_crm_request_facts.sql`.
- `assembleQuoteInput({requireShipping:true})` siempre falla cerrado hoy:
  confirmado leyendo `lib/brain/commercial/quote-assembly/assembleQuoteInput.ts:190-214`
  directamente (no inferido del doc).
- `AGENT_LOOP_TOOL_POOL` y el punto de registro de capabilities: confirmado
  en `lib/brain/commercial/agent-loop/runAgentToolLoop.ts:56-66` y
  `capability-gateway/registry.ts`.
- `QuoteServicePort.createQuote` exige `idempotencyKey` provisto por el
  caller, nunca generado por el adapter: confirmado en
  `docs/integrations/quote-service-adapter.md` seccion "Idempotencia".

## 6. Siguiente paso

Confirmar la decision de gobernanza (seccion 3). Con eso resuelto, T3 es
implementable en una sola rama, sin bloqueos tecnicos nuevos: cero migracion,
patrones de persistencia/idempotencia/capability ya probados tres veces en
este mismo repo.
