---
title: Quote Service Adapter - HTTP boundary to the external Quote Service
doc_id: integration-quote-service-adapter
status: implemented_not_wired
tags:
  - integration
  - quote-service
  - shipping
  - sales-agent
---
# Quote Service Adapter - HTTP boundary to the external Quote Service

## Relaciones

- Implementa: `lib/domains/quote-service/{types,errors,ports,index}.ts`
  (contrato/tipos/puerto), `lib/integrations/quote-service/{config,httpQuoteServiceAdapter,index}.ts`
  (adapter HTTP real + factory).
- Consume (sin modificar): el servicio externo `MS-pesaschile-quote-service`
  (contrato real leido directamente de su codigo fuente - `src/http/routes/quote-route.ts`,
  `src/domain/*.ts`, README - nunca inferido/adivinado).
- No modifica: `lib/brain/commercial/quotes/repository.ts` (el motor `crm_quotes`
  legacy, desconectado, sistema distinto sin relacion con este adapter),
  ninguna capability del Capability Gateway, `AGENT_LOOP_TOOL_POOL`,
  `commercial_line_items`, `shipping_destination`, ningun runtime conversacional.
- Tambien consume (sin modificar, lectura de contrato real): `Catalog Service`
  (repo hermano `MS-pesaschile-catalog-service`) para el campo `taxRate` -
  ver "Modelo contractual" abajo.
- Task: `SALES-AGENT-R1-T1` (adapter inicial), `SALES-AGENT-R1-T1.1` (alineacion
  de contrato: identidad externa `externalSource`/`externalVariantId` en
  Quote Service, `taxRate` en Catalog Service V1).

## Alcance

Frontera HTTP tipada y testeada entre CRM y el Quote Service externo ya
operativo. **T1 no expone el Quote Service al Sales Agent todavia** - no hay
capability registrada, no hay tool, no hay assembler que lea
`commercial_line_items`/`shipping_destination`/Catalog Service para construir
un request. Este documento describe exclusivamente el adapter.

## Configuracion

```env
QUOTE_SERVICE_BASE_URL=
QUOTE_SERVICE_AUTH_TOKEN=
QUOTE_SERVICE_TIMEOUT_MS=5000
```

`readQuoteServiceConfig()` (`lib/integrations/quote-service/config.ts`) sigue
exactamente el mismo patron que `CATALOG_SERVICE_BASE_URL`/`CARRIER_SERVICE_BASE_URL`:
ausencia de `QUOTE_SERVICE_BASE_URL`/`QUOTE_SERVICE_AUTH_TOKEN` devuelve `null`
(no configurado) - no existe un flag `_ENABLED` separado, la presencia de
config *es* la señal de habilitacion, consistente con el resto del repo. No
hay wiring productivo todavia que dependa de esto (T1 no tiene caller), asi
que el "fail-fast" real ocurrira naturalmente cuando una tarea futura llame a
`createQuoteServicePort()` y reciba `null`.

## Puerto (`QuoteServicePort`)

```ts
interface QuoteServicePort {
  createQuote(input, options: {idempotencyKey}): Promise<QuoteServiceResult<QuoteServiceQuote>>;
  updateDraft(input, options): Promise<QuoteServiceResult<QuoteServiceQuote>>;
  issueQuote(input, options): Promise<QuoteServiceResult<QuoteServiceQuote>>;
  sendQuoteEmail(input, options): Promise<QuoteServiceResult<QuoteServiceDelivery>>;
  getQuote(quoteId): Promise<QuoteServiceResult<QuoteServiceQuote>>;
  getQuoteByNumber(quoteNumber): Promise<QuoteServiceResult<QuoteServiceQuote>>;
  getQuoteDelivery(quoteId, deliveryId): Promise<QuoteServiceResult<QuoteServiceDelivery>>;
  listQuoteDeliveries(quoteId, query?): Promise<QuoteServiceResult<QuoteServiceDeliveryList>>;
}
```

Deliberadamente no incluye `acceptQuote`/`markQuotePaid`/`cancelQuote`/`expireQuote`/
`createRevision`/`listQuotes`/`getQuoteDocuments`/`getQuoteAuditEvents` - los
ocho endpoints reales corresponden 1:1 al alcance pedido a T1
(`create`/`updateDraft`/`issue`/`sendEmail`/`getQuote`/`getQuoteByNumber`/
`getQuoteDelivery`/`listQuoteDeliveries`); los demas endpoints ya existen en
el servicio real (confirmados leyendo `src/http/routes/quote-route.ts`) pero
quedan fuera de este puerto hasta una tarea que los necesite - ver "Endpoints
reales no cubiertos" abajo.

## Auth

`Authorization: Bearer <QUOTE_SERVICE_AUTH_TOKEN>` en cada llamada (el
servicio real exige esto en todo `/v1/quotes...`, confirmado en
`src/http/service-auth.ts`). El token nunca se loggea ni aparece en un error
retornado - `sanitizeMessage()` redacta cualquier patron `Bearer <token>`/
`Authorization: ...` antes de construir un `QuoteServiceError` (test dedicado:
"the auth token never appears in a returned error message").

## Idempotencia

Cada mutacion (`createQuote`/`updateDraft`/`issueQuote`/`sendQuoteEmail`)
exige `options.idempotencyKey: string`, transportado literalmente como header
`Idempotency-Key`. El adapter nunca genera esta key - es responsabilidad del
caller (una tarea futura de capability/application layer). El servicio real
persiste idempotencia en su propia base (README "Idempotency") - una repeticion
exacta de key+payload responde con el resultado original; key igual con
payload distinto responde `409 idempotency_key_reused_with_different_payload`.
Ninguna operacion de lectura (`getQuote*`, `listQuoteDeliveries`) envia este
header.

## Correlacion

El contrato real no expone ningun header HTTP de correlacion - solo el campo
de negocio `source.correlationId` dentro del body de cada mutacion (parte de
`QuoteServiceSourceRef`, ya requerido por el esquema). Este adapter **no
inventa** un header `X-Correlation-Id` (a diferencia del adapter de Catalog
Service, que si usa `x-correlation-id` porque ese es el contrato real de ese
otro servicio) - transporta correlacion unicamente donde el Quote Service
realmente la lee.

## Timeout

`AbortController` + `setTimeout(config.timeoutMs)`, exactamente una llamada
HTTP fisica por invocacion - sin reintento dentro del adapter (la politica de
reintento pertenece a quien gobierne la llamada, nunca a esta capa de
transporte; mismo principio ya aplicado a `httpCatalogAdapter.ts`/
`httpCarrierServiceAdapter.ts`/`http-adapter.ts` de customer-service). Un
timeout se distingue de una falla de red generica (`class: "timeout"` vs
`class: "upstream_unavailable"`).

## Money

`quantity`/`unitPrice`/`taxRate`/todos los totales viajan como `string`
decimal, nunca `number` - el adapter nunca los parsea, redondea ni calcula.
El tipo TypeScript (`QuoteServiceLineInput.quantity: string`, etc.) hace la
conversion accidental a `float` un error de compilacion, no solo una
convencion documental.

## Mapeo de errores

`{error:{code,message,details?}}` real (confirmado en `src/http/errors.ts`)
se traduce a `QuoteServiceError{class, code, message, httpStatus, details?, retryable}`.
`class` es un enum cerrado de 9 valores (`auth`/`validation`/`not_found`/
`conflict`/`invalid_transition`/`upstream_unavailable`/`timeout`/
`malformed_response`/`not_configured`); `code` preserva el codigo real
verbatim (sanitizado) para que un caller que necesite distinguir, por
ejemplo, `idempotency_key_reused_with_different_payload` de
`optimistic_concurrency_conflict` (ambos `class: "conflict"`) pueda hacerlo
sin que este adapter le oculte informacion real. Un `code` que esta tabla no
reconoce (una adicion futura del lado del servicio) cae a un fallback por
rango de status HTTP, nunca se descarta ni rompe el adapter.

Ver `lib/domains/quote-service/errors.ts` para la tabla completa
codigo→clase, extraida integramente de `README.md`/`src/http/errors.ts`/
`src/domain/errors.ts`/`src/application/quote/errors.ts` del servicio real.

## Modelo contractual (SALES-AGENT-R1-T1.1)

```text
Catalog Service   identifica y precia: productId + combinationId + amount + taxIncluded + taxRate
CRM (commercial_line_items)  selecciona: identidad + quantity (durable, nunca precio/tax cacheado)
Quote Service     snapshotea:  identidad externa + description + quantity + precio comercial + metadata tributaria (inmutable al emitir)
```

Semantica PesasChile para la identidad externa: `externalSource="catalog_service"`,
`externalItemId=productId`, `externalVariantId=combinationId` - transportados
verbatim, nunca concatenados (`"545:31"` nunca aparece en este repo), nunca
parseados heuristicamente. Ninguno de los tres es un FK, ninguno participa del
calculo, ninguno se muestra en el PDF/email (`sku` es la unica referencia
tecnica visible, decision preexistente del Quote Service).

## Gaps conocidos

1. **Identidad de producto** - **cerrado en T1.1**. El Quote Service ahora
   tiene `externalSource`/`externalVariantId` explicitos junto a
   `externalItemId` (migracion aditiva `000004_quote_line_external_identity.cjs`,
   nullable, sin reescritura de datos historicos). `QuoteServiceLineInput`/
   `QuoteServiceLine` de este adapter transportan los tres campos. **Lo que
   sigue pendiente para T2**: el mapping real `commercial_line_items ->
   {externalSource, externalItemId, externalVariantId}` no existe - este
   adapter solo sabe transportar los campos, no construirlos.
2. **IVA/`taxRate`** - **cerrado en T1.1 del lado de fuente**. Catalog
   Service V1 ahora expone `pricing.taxRate` (aditivo, migracion 0 - solo
   Zod schema + tipos, sin cambio de DB en Catalog) - la misma tasa
   configurada (`config.pricing.taxRate`, fuente unica) que V2/commercial-truth
   ya exponian. `CatalogProductPrice.taxRate: number | null` en este repo lo
   parsea. **Lo que sigue pendiente para T2**: el assembler debe decidir
   fail-closed que hacer si `taxRate`/`taxIncluded` llegan `null` para una
   linea de producto vendible (el contrato lo permite explicitamente - ver
   Quote Service README seccion IVA - pero el enforcement en si es tarea de
   T2, no de este adapter).
3. **`crm_quotes` vs Quote Service**: son dos sistemas de cotizacion sin
   relacion (`lib/brain/commercial/quotes/repository.ts` es el motor legacy
   desconectado, acoplado a `crm_conversation_requests`; este adapter apunta
   al servicio externo real). No se decide aqui cual reemplaza a cual - fuera
   de alcance de T1/T1.1.

## Endpoints reales no cubiertos por este puerto

Confirmados reales en `src/http/routes/quote-route.ts` del servicio, no
envueltos por `QuoteServicePort` (deliberado, ver "Alcance"):
`POST /:quoteId/accept`, `POST /:quoteId/mark-paid`, `POST /:quoteId/cancel`,
`POST /:quoteId/expire`, `POST /:quoteId/revisions`, `GET /v1/quotes`
(listado con filtros), `GET /:quoteId/documents`, `GET /:quoteId/audit`,
`GET /v1/documents/:documentRef` (descarga de artefacto).

## Tests

`tests/integrations/httpQuoteServiceAdapter.test.ts` - servidor HTTP local
real (`http.createServer`), nunca mocks de `fetch`. Cubre forma exacta de
request (URL/metodo/headers/body) para las 4 mutaciones + 4 lecturas, mapeo
de las 9 clases de error contra envelopes reales capturados del codigo del
servicio, seguridad de secretos (token nunca en un error), `readQuoteServiceConfig`,
transporte verbatim de `externalSource`/`externalItemId`/`externalVariantId`
(presentes, ausentes, y `null` de una linea sin identidad de catalogo), y la
regresion anti-doble-IVA ("tax-included catalog price is not taxed twice").
`tests/catalog/httpCatalogAdapter.test.ts` cubre `taxRate` presente/ausente en
`getProductDetails`.
