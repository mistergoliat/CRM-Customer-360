---
title: recommend_catalog_products - Agent Tool Loop exposure and observation
doc_id: integration-recommend-catalog-products-agent-tool
status: implemented_exposed_not_activated
tags:
  - integration
  - catalog
  - recommendations
  - agent-tool-loop
---
# recommend_catalog_products - Agent Tool Loop exposure and observation

## Purpose

Expone la capability interna `recommend_catalog_products` (registrada en el
Capability Gateway desde `CP-R1-T10B8B`, invisible al modelo hasta ahora) al
Agent Tool Loop nativo, y proyecta su resultado como una observacion
estructurada, acotada y segura para la siguiente decision del modelo. Tarea:
`CP-R1-T10B8C` - ver
`docs/releases/CP-R1-T10B8C-recommendation-tool-exposure-observation.md`.

## Existing layers

Cadena real, sin capas nuevas:

```
Agent Tool Loop (runAgentToolLoop.ts)
  -> tool publica "recommend_catalog_products" (AGENT_LOOP_TOOL_POOL)
  -> executeGovernedCapability (sin cambios)
  -> Gateway Adapter recommendCatalogProductsCapability (CP-R1-T10B8B, sin
     cambios de logica - solo su description es ahora model-facing)
  -> CatalogRecommendationCapability (CP-R1-T10B7, sin cambios)
  -> buildSearchProductsV2Request (CP-R1-T10B6, sin cambios)
  -> CatalogSearchProductsV2Client (CP-R1-T10B5, sin cambios)
  -> CapabilityExecutionOutcome / CapabilityGatewayResult (sin cambios)
  -> buildToolObservation.ts (CP-R1-T10B8C, caso nuevo para esta tool)
  -> observacion estructurada devuelta al modelo
```

## Tool name

`recommend_catalog_products`, agregada como quinto elemento de
`AGENT_LOOP_TOOL_POOL` (`lib/brain/commercial/agent-loop/runAgentToolLoop.ts`).
El pool pasa de `["search_products", "get_product_details",
"search_company_knowledge", "explore_catalog"]` a esos cuatro mas
`"recommend_catalog_products"` - ningun nombre previo se modifico ni se
elimino. No se agrego a `toolAliases.ts`, `BrainToolName`,
`SalesAgentToolName`, ni a ningun pipeline legacy - la exposicion existe
exclusivamente en el Agent Tool Loop moderno.

## Model-visible input

Se reutiliza tal cual el `inputSchema` real ya definido en
`CP-R1-T10B8B` (`RECOMMEND_CATALOG_PRODUCTS_INPUT_SCHEMA`,
`catalogRecommendationGatewayAdapter.ts`) - unica fuente canonica, la misma
que `execute()` interpreta en runtime (via `parseRecommendCatalogProductsInput`).
`buildToolDescriptions()` la lee desde `CapabilityGatewayDefinition.inputSchema`,
igual que para las otras cuatro tools; no se declaro un segundo schema para
el Agent Loop.

```ts
{
  sourceProduct: { productId: number; combinationId?: number },
  query?: string,
  explicitRepurchaseRequested?: boolean,
  excludedProducts?: { productId: number; combinationId?: number }[],
  limit?: number,
  inStockOnly?: boolean
}
```

`additionalProperties: false`, `sourceProduct` es el unico campo top-level
requerido. Compatibilidad schema/runtime: cada campo que el schema declara es
procesado por el parser real (`parseRecommendCatalogProductsInput`), y cada
campo que el parser acepta esta declarado en el schema - verificado con test
dedicado (`recommendCatalogProductsToolExposure.test.ts`).

### Gap de formato conocido: sin `integer`/`minimum` en `productId`/`combinationId`

El schema actual expone `sourceProduct.productId`/`sourceProduct.combinationId`
(y su espejo dentro de `excludedProducts[]`) como `{type:"number"}` - sin
`type:"integer"` ni `minimum:1`. Esto es una decision deliberada de esta
tarea (T10B8C reutiliza el schema real de T10B8B sin modificarlo, per
seccion 32 de su propia especificacion), no un descuido: la defensa efectiva
contra un `productId`/`combinationId` no entero o no positivo es el parser
runtime (`parseRecommendCatalogProductsInput`, T10B8B) mas T10B6
(`buildSearchProductsV2Request`), que rechazan esos valores como
`source_product_invalid` (skipped, seguro - nunca un crash, nunca tratado
como valido) - verificado end-to-end
(`recommendCatalogProductsAgentLoopIntegration.test.ts`, `sourceProduct.productId:-1`
-> `status:"skipped", reason:"source_product_invalid"`). El modelo nunca
obtiene acceso a identidad ni a campos internos a traves de este gap (ver
"Internal fields omitted" arriba) - el gap es puramente de estrictez de
formato en el schema visible, no de seguridad ni de correctitud funcional.
`CP-R1-T10B8D` agregara validacion de **evidencia** (que el `productId`
haya sido realmente observado este turno) - un problema distinto y mas
profundo que el formato basico del numero, y no resuelto por endurecer este
schema.

Si una tarea futura decide endurecer este schema (`type:"integer",
minimum:1`), debe hacerlo como cambio cross-task explicito sobre T10B8B
(nunca silencioso), repetir la suite completa de T10B8B, y confirmar que el
schema endurecido sigue siendo exactamente compatible con lo que el parser
runtime acepta/rechaza - nunca introducir una discrepancia entre ambos.

## Internal fields omitted

El schema nunca declara (y `parseRecommendCatalogProductsInput` rechaza como
`unsupported_field` si el modelo los envia): `masterCustomerId`, `customerId`,
`customerMode`, `recommendationContext`, `correlationId`, `signal`,
`ownership`, `purchasedProducts`, `apiKey`. La identidad se resuelve
exclusivamente desde `context.trustedCustomerSession` (server-side, nunca
desde el input del modelo).

## Tool description

Descripcion nueva, model-facing (reemplaza el texto interno
`"Internal: ... via SearchProducts V2. Not yet exposed to the model."` de
`CP-R1-T10B8B` - unico campo tocado de ese archivo en esta tarea, ver el
release doc para el detalle de por que):

> Recommend catalog products related to an already-identified source
> product. Requires sourceProduct.productId and, optionally,
> sourceProduct.combinationId - it does not search from free text (use
> search_products or explore_catalog for that), and should be used after
> search_products or get_product_details already identified a productId.
> Works without an identified customer. Set explicitRepurchaseRequested to
> true only when the customer expresses current intent to buy that same
> product again. excludedProducts lists products to exclude from the current
> recommendations. The result is a set of candidates, not confirmed
> commercial facts - use get_product_details before presenting price, stock,
> or a link for any recommended product.

No menciona `masterCustomerId`, Customer Profile, nombres de microservicios,
endpoints, API keys, detalles del Gateway ni retries - verificado con test.

## Gateway execution

`processUseToolStep` (sin cambios) enruta el `use_tool` hacia
`executeGovernedCapability("recommend_catalog_products", input, context)`,
el mismo camino que las otras cuatro tools. No existe handler paralelo, no se
llama directamente a `CatalogRecommendationCapability`/T10B6/T10B5/fetch, y
`maxRetries=0` (definido en `CP-R1-T10B8B`) se respeta sin retries
adicionales agregados por esta tarea.

## Completed observation

`buildToolObservation` gana dos funciones nuevas exclusivas de esta tool
(`projectRecommendCatalogProductsCompleted`/`...Failed`), invocadas antes del
switch generico compartido por las otras cuatro tools - nunca lo alteran.

Forma real emitida (anidada en `data`, igual que toda otra tool de este
archivo - `{tool, status, data}` es el envoltorio comun; la "forma
conceptual" de la tarea no exige un envoltorio literal distinto por tool):

```ts
{
  tool: "recommend_catalog_products",
  status: "completed",
  data: {
    customerMode: "identified" | "generic",
    degraded: boolean,
    recommendationCount: number,       // total real (metadata.recommendationCount, antes de truncar)
    recommendations: [
      {
        productId: string,
        combinationId?: string,
        name: string,
        rank: number,
        score: number,
        reasons: string[],             // codigos SearchProductsV2ReasonCode, max 5
        ownership?: {
          previouslyPurchased: boolean,
          exactVariantPreviouslyPurchased: boolean,
          totalOrderCount?: number,
          lastPurchasedAt?: string
        }
      }
      // max 5 candidatos, orden preservado, nunca re-rankeado ni deduplicado
    ],
    warnings: [ { code: string; productId?: string; combinationId?: string } ], // max 10
    personalization: { applied: boolean; reason?: string }
  }
}
```

Nunca incluye: `excluded` completo, `execution`/`statistics`/`snapshot`
completos, `correlationId`, `masterCustomerId`, `customerId`, raw response,
headers, API key. Nada se re-rankea ni se deduplica.

## Empty observation

`recommendations: []` produce `status:"completed"` con `recommendations: []`
y `recommendationCount: 0` - nunca `failed`/`skipped`/`unavailable`, nunca
una busqueda automatica ni una respuesta inventada. Fallout natural de la
proyeccion generica (no requiere una rama especial).

## Degraded observation

`execution.degraded=true` (T10B5/T10B7) se proyecta como `data.degraded:
true` manteniendo `status:"completed"` y los candidatos validos - nunca se
convierte en error, nunca oculta warnings relevantes (siguen en
`data.warnings`), nunca expone `degradationReasons` internos (provider
internals).

## Skipped observation

`CP-R1-T10B8B` mapea un `BuildSearchProductsV2RequestSkipReason` (T10B6) como
`CapabilityGatewayResult.status="completed"` con
`data.status="skipped", data.reason=<reason>`. `buildToolObservation` lo
detecta explicitamente (`data.status === "skipped"`) **antes** de entrar al
switch generico, para nunca colapsar en `{status:"completed",
recommendations:[]}`:

```ts
{ tool: "recommend_catalog_products", status: "skipped", reason: "<reason>" }
```

`reason` es exactamente uno de los diez valores de
`BUILD_SEARCH_PRODUCTS_V2_REQUEST_SKIP_REASONS` (T10B6):
`source_product_missing`, `source_product_invalid`, `source_product_mismatch`,
`invalid_customer_identity`, `customer_identity_mismatch`,
`contradictory_product_context`, `invalid_excluded_product`, `invalid_query`,
`invalid_correlation_id`, `invalid_limit`. Nunca marcado `retryable`, nunca
produce handoff. `TOOL_OBSERVATION_STATUSES` (`agentStepTypes.ts`) gano el
valor `"skipped"` para esto - exclusivo de esta tool.

## Failed observation

```ts
{
  tool: "recommend_catalog_products",
  status: "failed",
  errorCode: string,          // el "code" cerrado de SearchProductsV2ClientErrorCode
  retryable: boolean,
  providerErrorCode?: string  // solo cuando el servicio real lo reporto (p.ej. SOURCE_PRODUCT_NOT_FOUND/INACTIVE)
}
```

Se reutilizo el campo `errorCode` ya existente en `ToolObservation` (en vez
de introducir un segundo nombre `code` solo para esta tool) por consistencia
con las otras cuatro tools, que ya usan `errorCode` para lo mismo - la "forma
conceptual" de la tarea es semantica, no un contrato de nombres literal.
Nunca incluye `message`, `sourceProduct`, `query`, `excludedProducts`,
`httpStatus` (sin precedente en ninguna observacion existente del
repositorio), headers, API key ni stack - verificado con test.

## Ownership

Evidencia historica neutral, pasada verbatim cuando el resultado upstream la
incluye (`previouslyPurchased`, `exactVariantPreviouslyPurchased`,
`totalOrderCount`, `lastPurchasedAt` - `firstPurchasedAt` se omite, no esta
en la forma conceptual de la tarea). Nunca fabricada cuando esta ausente,
nunca transformada en exclusion/preferencia, nunca altera `rank`. La unica
senal de recompra sigue siendo `explicitRepurchaseRequested` en el input.

## Personalization

`{applied, reason?}` pasado tal cual desde `SearchProductsV2Personalization`
- nunca se incluye su `customerId`. `customerMode` (`identified`/`generic`)
viene exclusivamente del resultado real de T10B7/T10B8B, nunca inferido
desde `personalization`.

## Generic mode

`identity_unresolved` en `trustedCustomerSession.masterCustomerIdentity`
(T10B8A) nunca bloquea ni produce handoff - se ve como ejecucion generica
normal (`customerMode: "generic"`), exactamente como ya hacia
`CP-R1-T10B8B` para llamadas internas.

## Payload limits

Maximo 5 candidatos (`recommendationCount` preserva el total real, sin flag
`truncated` - no hay precedente de ese campo en ninguna observacion existente
del repositorio), maximo 5 `reasons` por candidato, maximo 10 warnings a
nivel de resultado. Nunca se trunca `productId`/`combinationId`/codigos de
warning. Nunca se re-rankea ni se deduplica.

## Security

Verificado con test (`recommendCatalogProductsToolExposure.test.ts`): el
schema visible nunca expone identidad; la descripcion nunca revela
arquitectura interna; la observacion nunca contiene `masterCustomerId`; el
`failed` nunca incluye el input completo ni un mensaje sensible; los
`productId`/`combinationId` en observaciones exitosas son datos de dominio y
estan permitidos.

## Persistence

Sin cambios. La ejecucion queda en `crm_capability_executions` via el
Gateway existente (`request_summary_json`/`response_summary_json` ya
excluian `masterCustomerId`/`customerId` desde `CP-R1-T10B8B`, sin tocar en
esta tarea). El Agent Tool Loop persiste `agent_tool_loop_completed` con su
flujo existente; `AgentToolLoopStepSummary.observationStatus`
(`lib/brain/commercial/events/types.ts`) gano el valor `"skipped"` (mismo
patron "union espejo, sin import cruzado" ya usado en ese archivo) para que
un step `recommend_catalog_products` skipped se pueda resumir sin perder
tipo - sin tabla, columna, `commercial_event` adicional, cache ni outbox
nuevos.

## Agent Loop visibility

`recommend_catalog_products` es ahora visible en `AGENT_LOOP_TOOL_POOL` y en
`buildToolDescriptions()`. Sigue ausente del pipeline legacy
(`toolAliases.ts`/`BrainToolName`/`SalesAgentToolName` sin cambios,
verificado con test).

## Known continuity gap

`sourceProduct` **no** se valida todavia contra `recentCatalogContext`: el
modelo puede enviar un `productId` sintacticamente valido que nunca fue
observado en este turno, y el Gateway lo procesara igual (la validez de
negocio - existencia, actividad - la resuelve T10B6/el servicio real, nunca
esta tarea). `recentCatalogContext.ts` y `pendingCatalogAction.ts` quedan
intactos, sin tocar. No hay continuidad automatica a `get_product_details`:
el modelo debe decidir explicitamente llamarlo para verificar precio/stock/
link antes de presentar un producto recomendado. Esta brecha es deliberada y
queda para `CP-R1-T10B8D`.

### Mitigacion actual: Agent Tool Loop apagado por flag

`BRAIN_AGENT_TOOL_LOOP_ENABLED=false` es el default auditado
(`.env.example`, `commercialCycleConfig.ts#buildAgentToolLoopFeatureFlags`).
Mientras ese flag siga en `false`, `runNativeAgentToolLoopCycle` - y por lo
tanto `recommend_catalog_products` - **no se ejecuta en el runtime activo**
(`runNativeAutonomousCycle.ts`, gate en `agentToolLoopEnabled` antes de
entrar a esa rama). Esto mitiga temporalmente el gap de continuidad de
arriba: hoy no hay un camino productivo real por el que un `sourceProduct`
no observado o una recomendacion sin `pendingCatalogAction` lleguen a un
cliente real. Esta mitigacion **no reemplaza `CP-R1-T10B8D`** - es un
apagador binario de todo el loop, no una validacion. Antes de habilitar el
Agent Tool Loop en produccion (flag en `true`) deben existir, como minimo:

- validacion de `sourceProduct` contra evidencia observada
  (`recentCatalogContext`);
- `recentCatalogContext` alimentado por las recomendaciones de esta tool;
- `pendingCatalogAction` para la continuidad de la recomendacion;
- continuidad automatica/guiada a `get_product_details` antes de presentar
  precio/stock/link.

## Explicitly out of scope

Validacion de `sourceProduct` contra evidencia observada,
`recentCatalogContext`, `pendingCatalogAction`, continuidad automatica a
`get_product_details`, consumo/renovacion de acciones pendientes, seleccion
final de candidato, prompt comercial completo (reglas de cuando usar la tool,
cuantas alternativas presentar, lenguaje comercial), activacion productiva
del Agent Tool Loop, modificaciones a `CatalogRecommendationCapability`
(T10B7), al Gateway Adapter (T10B8B, salvo la unica correccion de
`description` documentada arriba), a T10B8A, T10B6 o T10B5.

## Next task

`CP-R1-T10B8D` - Source Product Evidence and Recommendation Continuity.
