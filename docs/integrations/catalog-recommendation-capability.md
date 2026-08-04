---
title: Catalog Recommendation Capability - CRM orchestration
doc_id: integration-catalog-recommendation-capability
status: implemented_not_wired
tags:
  - integration
  - catalog
  - recommendations
  - capability
---
# Catalog Recommendation Capability - CRM orchestration

## Relaciones

- Implementa:
  `lib/brain/commercial/capabilities/catalog-recommendation/catalogRecommendationCapability.ts`,
  `lib/brain/commercial/capabilities/catalog-recommendation/types.ts`.
- Consume (sin modificar): `buildSearchProductsV2Request` (CP-R1-T10B6,
  `lib/brain/commercial/recommendation-context/buildSearchProductsV2Request.ts`),
  `CatalogSearchProductsV2Client` (CP-R1-T10B5,
  `lib/catalog/search-products-v2/httpCatalogSearchProductsV2Client.ts`),
  `CustomerRecommendationContext` (CP-R1-T10B2, solo lectura).
- Task: `CP-R1-T10B7` - see
  `docs/releases/CP-R1-T10B7-catalog-recommendation-capability.md`.
- Reemplaza: none. No modifica T10B2/T10B5/T10B6, el Agent Loop, el
  Capability Gateway (`lib/brain/commercial/capability-gateway`) ni el
  registro de capabilities del runtime multi-request
  (`lib/brain/commercial/capabilities/registry.ts`, sistema no relacionado
  que usa un `CapabilityDefinition` distinto - ver "Separacion capability
  interna vs tool adapter" abajo).

## Alcance

Capability de aplicacion, unico punto de orquestacion CRM para pedir
recomendaciones al Catalog Service: construye el request via T10B6, invoca
el cliente HTTP T10B5, clasifica el resultado en `completed` / `skipped` /
`failed`, y devuelve un resultado estructurado estable para una futura
integracion con el Agent Loop (`CP-R1-T10B8`). No selecciona un candidato,
no llama `get_product_details`, no persiste, no se registra como tool
publica del modelo.

## Separacion capability interna vs tool adapter

Este repo ya tiene una separacion formal entre:

- **Capability interna de aplicacion** (esta tarea): una funcion/objeto con
  `execute()` inyectado por dependencias, sin `inputSchema`, sin registro en
  ningun catalogo consultado por el Agent Tool Loop.
- **Tool adapter del modelo** (`CapabilityGatewayDefinition`,
  `lib/brain/commercial/capability-gateway/registry.ts`): expone
  `inputSchema`, se registra en `CAPABILITY_GATEWAY_REGISTRY`, y se alias a
  un nombre de tool LLM via `toolAliases.ts` (`resolveCapabilityNameForSalesAgentTool`)
  para que el Agent Tool Loop pueda ofrecerlo al modelo.

`CatalogRecommendationCapability` implementa solo la primera capa. No se
agrego ninguna entrada a `CAPABILITY_GATEWAY_REGISTRY` ni a `toolAliases.ts`
- eso, si se decide, es trabajo explicito de `CP-R1-T10B8`.

## Input contract

`CatalogRecommendationCapabilityInput`
(`lib/brain/commercial/capabilities/catalog-recommendation/types.ts`):

```ts
type CatalogRecommendationCapabilityInput = BuildSearchProductsV2RequestInput & {
  signal?: AbortSignal;
};
```

Reutiliza `BuildSearchProductsV2RequestInput` (T10B6) sin duplicar campos -
`masterCustomerId`, `sourceProduct`, `recommendationContext`, `query`,
`explicitExcludedProducts`, `correlationId`, `limit`, `inStockOnly` tienen
exactamente la semantica que T10B6 ya documenta. `signal` es la unica
adicion: transporte/cancelacion puro, nunca entra a
`buildSearchProductsV2Request` - se entrega solo al cliente T10B5.

## Result contract

```ts
type CatalogRecommendationCapabilityResult =
  | {
      status: "completed";
      customerMode: "identified" | "generic";
      recommendations: readonly SearchProductsV2Recommendation[];
      excluded: readonly SearchProductsV2Exclusion[];
      warnings: readonly SearchProductsV2Warning[];
      personalization: SearchProductsV2Personalization;
      execution: SearchProductsV2Execution;
      statistics: SearchProductsV2Statistics;
      snapshot: SearchProductsV2Snapshot;
      metadata: {
        explicitRepurchaseApplied: boolean;
        excludedProductCount: number;
        recommendationCount: number;
        degraded: boolean;
      };
    }
  | { status: "skipped"; reason: BuildSearchProductsV2RequestSkipReason }
  | { status: "failed"; error: CatalogRecommendationCapabilityError };
```

No existe un estado `completed_degraded` separado: `execution.degraded` (y
`metadata.degraded`, un espejo conveniente de ese mismo campo) es la unica
fuente de verdad para un resultado exitoso pero degradado - nunca se
introduce un segundo estado que pueda contradecirlo.

## Mapper skipped

Cuando `buildSearchProductsV2Request` devuelve `status: "skipped"`, la
capability devuelve `{status: "skipped", reason}` con el mismo
`BuildSearchProductsV2RequestSkipReason` (reexportado, nunca redefinido) y
**no invoca** `CatalogSearchProductsV2Client` - verificado por los 10 tests
dedicados (uno por cada `reason`) que aseveran `calls.length === 0`.

## Completed / empty / degraded

`recommendations: []` es `completed` con `metadata.recommendationCount: 0` -
nunca `skipped`/`failed`. `execution.degraded: true` con HTTP 200 es
`completed` con `metadata.degraded: true` - nunca reclasificado como error ni
reintentado. `customerMode` viene exclusivamente de
`buildResult.metadata.customerMode` (T10B6) - nunca inferido de nuevo desde
`response.personalization.customerId`; ambos datos pueden convivir sin
forzarse a coincidir (p. ej. `customerMode: "identified"` con
`personalization.applied: false`).

## Ownership

`SearchProductsV2Ownership` (por-recomendacion, opcional) se preserva sin
transformacion: presente permanece presente, ausente permanece ausente -
nunca se fabrica `previouslyPurchased: false` para una recomendacion que no
trae `ownership`. Ownership no modifica ranking (no se reordena por
ownership), no activa `metadata.explicitRepurchaseApplied` (ese campo viene
exclusivamente de T10B6, ver "Completed / empty / degraded" arriba) y no
activa ninguna personalizacion local - `personalization` sigue siendo
exactamente la que devuelve T10B5, nunca reinterpretada a partir de
`ownership`.

## Catalog client invocation

```ts
deps.catalogSearchProductsV2Client.searchProducts(buildResult.request, {
  correlationId: buildResult.callContext.correlationId,
  signal: input.signal
});
```

Sin revalidacion manual del request, sin mutacion, sin agregar
`customerId`/`correlationId` una segunda vez, sin `AbortController` propio,
sin retry - T10B5 ya administra timeout/cancelacion/un-solo-fetch-por-llamada.

## Cancellation

`input.signal` se entrega tal cual al call context del cliente T10B5
(`{correlationId, signal}`) - la capability no crea ningun
`AbortController` propio, no agrega listeners ni timers. Un `signal` ya
abortado es clasificado por T10B5 (`code: "aborted"`) antes de cualquier
`fetch`; `timeout` (limite interno de T10B5) y `aborted` (senal externa)
permanecen distintos siempre - la capability nunca reclasifica uno como el
otro, porque no toca `clientResult.error` en absoluto (lo reenvia tal
cual). El cliente se invoca como maximo una vez por `execute()` en
cualquier escenario de cancelacion.

## Concurrency

Cero estado mutable por instancia de la capability: el objeto retornado
por `createCatalogRecommendationCapability(deps)` solo cierra sobre `deps`
(de solo lectura) y cada `execute()` opera unicamente con variables
locales a esa llamada. `correlationId`, `signal` y `request` se construyen
de nuevo en cada `execute()` - nunca se comparten entre llamadas
concurrentes. No existe contaminacion entre ejecuciones: dos llamadas
simultaneas con distintos `correlationId`/`signal`/`sourceProduct` reciben
cada una exclusivamente su propio call context y su propia respuesta.

Importante: esta ausencia de contaminacion depende de que el cliente
inyectado tambien devuelva objetos frescos por ejecucion - ver
"Immutability" en
`docs/releases/CP-R1-T10B7-catalog-recommendation-capability.md` para el
detalle completo (la capability no clona la respuesta; la aislacion del
camino productivo la aporta T10B5, no esta capability).

## Error taxonomy

`CatalogRecommendationCapabilityError` es exactamente
`SearchProductsV2ClientError` (T10B5), reutilizado sin redefinir:
`configuration_error`, `invalid_request`, `timeout`, `aborted`,
`network_error`, `unauthorized`, `forbidden`, `rate_limited`,
`catalog_service_error`, `invalid_response_body`, `invalid_response_schema`,
`unexpected_http_status`. `SOURCE_PRODUCT_NOT_FOUND` (HTTP 404) /
`SOURCE_PRODUCT_INACTIVE` (HTTP 409) no son valores de `code` separados: T10B5
ya los expone como `code: "catalog_service_error"` con
`providerErrorCode: "SOURCE_PRODUCT_NOT_FOUND" | "SOURCE_PRODUCT_INACTIVE"` -
preservados verbatim, nunca reclasificados en una taxonomia nueva
incompatible. `message` siempre viene ya saneado por T10B5 (nunca un body/
header/stack crudo).

## Security

Los logs/errores nunca incluyen `masterCustomerId`, `customerId`, `query`,
`productId`/`combinationId`, request/response completos, API key, headers ni
PII - esta capability no agrega logging propio (ninguna otra capability de
este directorio lo hace directamente, ver
`lib/brain/commercial/capability-gateway/executeCapability.ts`,
`lib/brain/commercial/capabilities/executeReadCapability.ts` - no se
introduce un logger aislado solo para esta tarea). Los resultados exitosos si
pueden contener product IDs y datos de catalogo - son parte contractual del
dominio, no un leak.

## T10B5 integration

El cliente HTTP se inyecta (`CreateCatalogRecommendationCapabilityDeps.catalogSearchProductsV2Client`)
- nunca se crea uno nuevo por ejecucion, nunca se lee `process.env`
directamente. `createProductionCatalogRecommendationCapability()` reutiliza
`createCatalogSearchProductsV2Client()` (T10B5, on-demand/env-driven) - no
se llama en ningun bootstrap, no hay `fetch` en tiempo de import.

## Production factory

`createProductionCatalogRecommendationCapability()` delega enteramente en
T10B5: llama `createCatalogSearchProductsV2Client()` (la factory
productiva ya existente) y la inyecta en
`createCatalogRecommendationCapability(...)` - no duplica configuracion, no
lee `CATALOG_SERVICE_*` por su cuenta, no inventa una segunda taxonomia de
error (usa la misma de T10B5). No ejecuta `fetch` durante la construccion -
`createCatalogSearchProductsV2Client()` solo lee/valida configuracion de
entorno de forma sincrona y retorna un objeto cliente; si la configuracion
esta ausente retorna un cliente fail-closed (nunca lanza), consistente con
T10B5.

No registra ninguna tool ni tiene efecto sobre el Agent Loop. No esta
conectada todavia al runtime - ningun archivo fuera de este modulo la
importa ni la invoca (confirmado por grep). Queda exportada para que
`CP-R1-T10B8` decida cuando y como conectarla.

`CP-R1-T10B8` debe crear la capability **una sola vez, en un composition
root**, y reutilizar esa misma instancia para todas las ejecuciones -
`createProductionCatalogRecommendationCapability()` no memoiza nada
internamente (cada llamada construye un cliente y una capability nuevos),
asi que invocarla por turno/por mensaje seria correcto funcionalmente pero
desperdiciaria esa reconstruccion sin necesidad; no debe construirse por
turno.

## T10B6 integration

`buildSearchProductsV2Request` se reutiliza tal cual, sin copiar su logica
de validacion/normalizacion. El `signal` se mantiene deliberadamente fuera
de su input.

## Compatibility

`recentCatalogContext`/`pendingCatalogAction`
(`lib/brain/commercial/agent-loop/`) no fueron leidos ni modificados por esta
capability. Una futura `CP-R1-T10B8` decidira si/cuando el resultado
`completed` alimenta esos mecanismos - fuera de alcance aqui.

## Explicitly out of scope

Seleccion de candidato, `get_product_details`, presentacion narrativa,
persistencia (ninguna tabla `commercial_event`/`crm_agent_actions`/
`brain_message_outbox`/`conversation` es escrita), retry, cache, circuit
breaker, tool schema/registro publico, modificacion del Agent Loop o del
prompt, normalizacion "20 kg" -> "20kg", RFM, clustering, segmentacion,
busqueda libre de `sourceProduct`.

## Next task

`CP-R1-T10B8` - Sales Agent Tool Loop Integration.
