---
title: SALES-AGENT-R1-T3 - Create Quote Wiring
doc_id: sales-agent-r1-t3-create-quote-wiring
status: implemented_pending_real_db_validation
tags:
  - release
  - sales-agent
  - quote-service
  - fix
---

# SALES-AGENT-R1-T3 - Create Quote Wiring

Fecha: 2026-08-15.

## 1. Objetivo

Conectar el Quote Service real al Sales Agent: registrar la capability que
llama `QuoteServicePort.createQuote()` en el Capability Gateway y exponerla
al `AGENT_LOOP_TOOL_POOL`, usando el output ya validado del Quote Input
Assembler (`SALES-AGENT-R1-T2`). Precedido por
`docs/audits/SALES-AGENT-R1-T3-create-quote-wiring-audit.md` (diseno
pre-implementacion, gobernanza confirmada por el usuario: `authority:
"autonomous"`, solo `status: "draft"`, nunca `issueQuote`/`sendQuoteEmail`).

## 2. Cambio implementado

### 2.1 Persistencia (sin migracion nueva)

`lib/domains/created-quote/{constants,types,service,index}.ts` - cuarto
`fact_key` (`created_quote`) sobre el mismo `crm_request_facts` anclado por
`opportunity:<id>` que ya usan `commercial_line_items`/
`shipping_destination`/`selected_shipping_option`. Guarda
`quoteId`/`quoteNumber`/`status`/`currency`/`total`/`validUntil` mas dos
anclas: `selectionFactId` (el `commercial_line_items.factId` vigente cuando
se creo la quote - unico criterio de "sigue siendo la misma quote") e
`idempotencyKey` (la key real enviada a Quote Service, conservada para
trazabilidad).

### 2.2 Capability (`create_quote`)

`lib/brain/commercial/capability-gateway/createQuoteCapability.ts`. Toma
cero argumentos del modelo (mismo patron que `calculate_shipping`). Flujo:

1. `checkAvailability`: `unavailable` si `QUOTE_SERVICE_BASE_URL`/`QUOTE_SERVICE_AUTH_TOKEN`
   no estan configurados.
2. `execute`: sin `opportunityId` activo -> `denied`. Sin `QuoteServicePort`
   -> `temporarily_blocked` (retryable).
3. `assembleQuoteInput({requireShipping: false, ...})` - **nunca
   `requireShipping: true`**: `assembleQuoteInput.ts:190-214` falla siempre
   cerrado hoy con `shipping_tax_metadata_missing` (Carrier MS no reporta
   metadata tributaria por opcion de envio, Quote Service no tiene tipo de
   linea "shipping" en su contrato) - un gap real, preexistente, ajeno a
   T3, documentado en `docs/integrations/quote-input-assembly.md`. Un
   error de assembly se mapea 1:1 a una salida informativa
   (`completed(code, details)`) o a un fallo tecnico
   (`catalog_unavailable`/`missing_opportunity`/`invalid_quantity`), nunca
   se reintenta con datos inventados.
4. **Reuso antes de cualquier llamada HTTP**: si ya existe un
   `created_quote` activo para la oportunidad y su `selectionFactId`
   coincide con el `commercial_line_items.factId` vigente, se devuelve esa
   quote (`status: "reused"`) sin tocar Quote Service. Solo si el carrito
   cambio desde la ultima quote creada se procede a crear una nueva.
5. `idempotencyKey = sha256("create-quote:<opportunityId>:<selectionFactId>")`
   (primeros 32 caracteres hex) - determinista por carrito, nunca generado
   al azar. Dos llamadas para el MISMO carrito comparten la misma key;
   Quote Service devuelve la quote original en vez de crear una duplicada
   (su propia semantica documentada de idempotencia).
6. Exito -> persiste la referencia (`setCreatedQuoteForOpportunity`) y
   devuelve `{status: "created", quoteId, quoteNumber, quoteStatus,
   currency, total, validUntil}`.
7. Fallo de Quote Service -> las 9 clases de error (`auth`/`validation`/
   `not_found`/`conflict`/`invalid_transition`/`upstream_unavailable`/
   `timeout`/`malformed_response`/`not_configured`) se mapean a
   `temporarily_blocked` (retryable, solo `upstream_unavailable`/`timeout`)
   o `failed` (todo el resto) - nunca un reintento automatico de un
   conflicto o error de validacion.
8. Fallo al persistir la referencia DESPUES de un `createQuote` exitoso ->
   `temporarily_blocked`, retryable: la quote ya existe en Quote Service
   bajo esa `idempotencyKey`, asi que un reintento la recupera en vez de
   duplicarla.

### 2.3 Wiring

- `registry.ts`: `create_quote` registrado en `CAPABILITY_GATEWAY_REGISTRY`.
- `runAgentToolLoop.ts`: `"create_quote"` agregado a `AGENT_LOOP_TOOL_POOL`.
- `buildToolObservation.ts`: proyeccion `projectCreateQuote` - pass-through
  del `data` ya acotado a nivel de capability (nunca el
  `QuoteServiceCreateQuoteInput`/`customerSnapshot` completos).
- Prompt (`buildAgentStepPromptPackage.ts`): **sin bloque de reglas
  dedicado** - mismo precedente que `select_shipping_option` (T2.1, el tool
  mutating mas reciente antes de este), que tampoco tiene uno. La
  `description` de la capability es la guia que el modelo recibe.

## 3. Alcance

**Incluye**: creacion de quote borrador (`status: "draft"` en Quote
Service) para el camino producto-sin-envio, idempotencia real, reuso sin
duplicar, mapeo completo de errores.

**No incluye** (confirmado en la auditoria previa, seccion 4):
`requireShipping: true` (bloqueado por el gap de metadata tributaria, no
relacionado a T3), `issueQuote`/`sendQuoteEmail`/`acceptQuote` (ciclo de
vida posterior), visibilidad en el Hub, interpretacion de la decision del
cliente sobre la propuesta.

## 4. Correccion durante implementacion

`completed(status, extra)` (helper interno de `createQuoteCapability.ts`,
mismo patron que `calculateShippingCapability.ts`) construye
`{status, ...extra}`. La primera version de `extra` incluia una clave
`status` propia (el estado de la quote en Quote Service, ej. `"draft"`) que
sobreescribia el `status` del wrapper (`"created"`/`"reused"`) por orden de
spread - un bug real detectado al escribir el test de integracion (la
aserción `deepEqual` esperada nunca hubiera podido pasar). Corregido
renombrando el campo a `quoteStatus` en ambas ramas (`created`/`reused`) y
en `buildToolObservation.ts`'s comentario.

## 5. Tests

- `tests/domains/createdQuote.test.ts` (nuevo, DB-free via dependencias
  inyectables, mismo patron que `selectedShippingOption.test.ts`) - 5/5 en
  verde en esta sesion: creacion, rehidratacion, "sin quote aun" -> null,
  superseding al cambiar `selectionFactId` (exactamente una fila activa),
  fallo de persistencia nunca reporta exito falso.
- `tests/commercial/createQuoteCapability.test.ts` (nuevo, requiere DB real
  para `crm_opportunities`/`master_customer`/`commercial_line_items` - mismo
  patron que `selectShippingOptionCapability.test.ts`/
  `calculateShippingCapability.test.ts`, `QuoteServicePort` inyectado como
  fake, sin servidor HTTP real necesario). **No corrio en esta sesion**
  (Docker no disponible - ver seccion 6). Cubre: registro en el Gateway y
  en `AGENT_LOOP_TOOL_POOL`; sin oportunidad activa -> `denied`; Quote
  Service no configurado -> `unavailable`/`temporarily_blocked`; sin
  `commercial_line_items` -> `completed` informativo; creacion exitosa con
  persistencia verificada; una segunda llamada con el mismo carrito
  reutiliza sin llamar a Quote Service de nuevo (`createCallCount === 1`);
  un conflicto de Quote Service se mapea a `failed` sin persistir nada.

Regresion verificada sin DB: subset
`tests/agent-loop/runNativeAgentToolLoopCycleConfigurationFailure.test.ts` +
`tests/agent-loop/runAgentToolLoop.test.ts` + `tests/domains/createdQuote.test.ts`
(107 tests) - 105 pass / 2 fail. Los 2 fallos (`[T08D-2]`, `[T08D-3]`) son
identicos al baseline sin este cambio (confirmado con `git stash` + re-run).
Un tercer fallo nuevo (`I0 - el pool conserva las tools previas...`, una
lista golden de `AGENT_LOOP_TOOL_POOL`) aparecio y se corrigio agregando
`create_quote` a la lista esperada - mismo patron de mantenimiento de
golden values que `CP-R1-T11H.1` ya documento para los prompt lengths.

`npx tsc --noEmit` -> limpio. `npm run lint` -> 0 errores, 34 warnings
preexistentes.

## 6. Limitacion conocida: sin validacion real contra MariaDB

Igual que `SALES-AGENT-R1-TASK-001-durable-handoff-fix.md`:
`tests/commercial/createQuoteCapability.test.ts` no pudo ejecutarse en esta
sesion por falta de Docker/MariaDB en este entorno (el usuario confirmo que
Docker Desktop en esta maquina requiere reset/reinstalacion). Queda
pendiente, bloqueada por el entorno, no por el codigo.

## 7. Criterio de cierre final

Pasa a `validated` cuando, contra MariaDB real:

1. `tests/commercial/createQuoteCapability.test.ts` corre en verde
   (los 7 casos, incluida la aserción de reuso `createCallCount === 1`).
2. `tests/domains/selectedShippingOption.test.ts`/
   `tests/domains/commercialLineItems.test.ts` siguen en verde (sin
   regresion sobre `crm_request_facts`, que este fix reutiliza sin
   modificar el schema).
3. Un smoke manual contra un `QUOTE_SERVICE_BASE_URL` real (sandbox o
   productivo) confirma que `create_quote` crea una quote real y que una
   segunda invocacion para el mismo carrito la reutiliza - primera
   verificacion end-to-end contra el servicio externo real para este
   camino (T1 ya tiene esa verificacion para el adapter en aislamiento,
   nunca para el flujo completo del agente).

## 8. Riesgos y deuda

- Mismo gap documental que `TASK-001`: no reconciliado en
  `docs/ACTIVE_RELEASE.md` (SALES-AGENT-R1 fuera de la jerarquia ACS
  rastreada ahi).
- El gap de shipping tax metadata (Carrier MS / Quote Service) sigue
  abierto, documentado, fuera de alcance.
- Sin smoke contra un Quote Service real desplegado - toda la validacion de
  esta tarea es contra un `QuoteServicePort` fake inyectado.

## 9. Siguiente tarea

Segun la auditoria previa (seccion 4, "No incluye"): visibilidad de la
quote en el Hub (lectura de la oportunidad), o decidir el mecanismo de
`issueQuote`/interpretacion de aceptacion del cliente - ambas requieren
decision de producto explicita antes de implementar, mismo criterio ya
aplicado en esta sesion.
