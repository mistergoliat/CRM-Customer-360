---
title: SALES-AGENT-R3-QUOTE-CAPABILITY-EXPOSURE-V1
doc_id: sales-agent-r3-quote-capability-exposure-v1
status: implemented_smoke_pending
owner: commercial-runtime
updated_at: 2026-09-14
tags:
  - release
  - sales-agent
  - quote-service
---

# Quote capability exposure v1

## Resultado

Se exponen tres operaciones ya implementadas por Quote Service, sin copiar su
lógica en CRM:

- `get_quote` como `READ_TOOL`.
- `issue_quote` como `COMMERCIAL_ACTION`.
- `send_quote_email` como `COMMERCIAL_ACTION`.

La auditoría previa confirmó `MS-pesaschile-quote-service` en `main@4498c2f`:
emite documentos PDF/HTML durables, protege la emisión con versión e
idempotencia, crea solicitudes durables de email y devuelve `202` mientras la
entrega está pendiente. También soporta líneas `shipping`; CRM no habilita
esa asamblea todavía porque Carrier MS no entrega el metadata tributario
necesario.

## Contratos y límites

Las tres capabilities resuelven internamente el `created_quote` activo de la
oportunidad y consultan Quote Service fresco. El estado guardado en
`crm_request_facts.created_quote` solo localiza el quote y no es autoridad.

`issue_quote`:

- En `draft`, hace un `GET` inmediatamente antes de `POST /issue` y envía la
  versión fresca.
- En `issued`, `accepted`, `paid`, `cancelled` o `expired`, devuelve
  `completed/reused` sin mutar; para `issued` exige artefactos disponibles.
- Proyecta únicamente `quoteId`, `quoteNumber`, `quoteStatus`, `currency`,
  `total`, `validUntil` y metadata allowlisted de documentos.
- Produce `QUOTE_ISSUED` y, cuando corresponde, `QUOTE_DOCUMENT_AVAILABLE`.
- Nunca envía email o WhatsApp.

`get_quote` devuelve la misma información allowlisted, usando `status` para el
estado actual y sin side effect.

`send_quote_email`:

- Solo llama al servicio en `issued`/`accepted` con documento durable.
- Acepta `recipient` opcional únicamente si el snapshot fresco puede aportar
  email.
- Devuelve `deliveryId`, `deliveryStatus` y `recipient`.
- Un `202` se representa como `pending` y produce solo
  `QUOTE_EMAIL_DELIVERY_REQUESTED`; nunca se emite `EMAIL_SENT`.
- Fallos de email no cambian el quote ni crean HANDOFF automático.

Las claves de idempotencia se derivan de la operación, `quoteId` y, para email,
el recipient normalizado. No se agregaron tablas, workflows, phrase routing,
planner state, dependencias Meta ni envío de PDF por WhatsApp.

## Wiring

Archivos principales:

- `lib/brain/commercial/capability-gateway/{getQuoteCapability,issueQuoteCapability,sendQuoteEmailCapability}.ts`
  y `quoteLifecycleCapabilitySupport.ts`.
- `lib/brain/commercial/capability-gateway/{registry,types,index}.ts`.
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` y
  `agent-capability-exposure/types.ts`.
- `lib/brain/commercial/commercial-action-request/{types,actionCapabilityMapping,atlAdapter,workAdapter,index}.ts`.
- `lib/brain/commercial/work/{commercialWorkExecutor,retryPolicy,stepTypes,types,parallelStepConflictModel}.ts`.
- `lib/domains/quote-service/types.ts` y contratos de identidad de operación.

Las mutaciones de CommercialWork pasan por `CommercialActionRequest`, la
misma validación, identity gate, eventos de sesión y `executeGovernedCapability`
que el Agent Tool Loop. Los fallos transitorios se proyectan como
`WAITING_SYSTEM`/retry según la política existente; los permanentes quedan
como fallo durable y no como handoff inventado.

## Validación

- `tests/commercial/quoteLifecycleCapabilities.test.ts`: 9 pruebas puras.
- Regresión de exposición, semántica del pool y acciones gobernadas: 83
  pruebas en la corrida focalizada.
- `npm run typecheck`: OK.
- `git diff --check`: OK.

El smoke real contra Quote Service desplegado y la validación DB de
CommercialWork quedan pendientes: MariaDB no estaba disponible en este
entorno y no se presentaron datos ficticios como evidencia operacional.
