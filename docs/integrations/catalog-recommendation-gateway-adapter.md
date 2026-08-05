---
title: Catalog Recommendation Gateway Adapter - Capability Gateway integration
doc_id: integration-catalog-recommendation-gateway-adapter
status: implemented_not_wired
tags:
  - integration
  - catalog
  - recommendations
  - capability-gateway
---
# Catalog Recommendation Gateway Adapter - Capability Gateway integration

## Relaciones

- Implementa:
  `lib/brain/commercial/capability-gateway/catalogRecommendationGatewayAdapter.ts`.
- Modifica (wiring minimo): `lib/brain/commercial/capability-gateway/registry.ts`
  (agrega la entrada al array `CAPABILITY_GATEWAY_REGISTRY`),
  `lib/brain/commercial/capability-gateway/index.ts` (re-exporta el factory,
  el singleton y el reset de test).
- Consume (sin modificar): `CatalogRecommendationCapability` (CP-R1-T10B7,
  `lib/brain/commercial/capabilities/catalog-recommendation/`),
  `CatalogSearchProductsV2Client` (CP-R1-T10B5, vía T10B7),
  `MasterCustomerIdentityResolution`/`trustedCustomerSession` (CP-R1-T10B8A,
  `lib/brain/commercial/native-cycle/customer-session/types.ts`).
- Consume (modificado minimamente por esta tarea, correccion de revision):
  `buildSearchProductsV2Request` (CP-R1-T10B6) - un campo top-level nuevo,
  aditivo, ver "Explicit repurchase" abajo y el release doc.
- Task: `CP-R1-T10B8B` - ver
  `docs/releases/CP-R1-T10B8B-catalog-recommendation-gateway-adapter.md`.
- Reemplaza: none. No modifica T10B5/T10B7/T10B8A, el Agent Loop, los
  prompts, ni `toolAliases.ts`/`BrainToolName`.

## Alcance

Adapter interno del Capability Gateway (`recommend_catalog_products`) que
permite ejecutar recomendaciones de catalogo via
`executeGovernedCapability` - auditado, persistido y gobernado por retries
igual que cualquier otra capability - sin exponerlo todavia al modelo (no
esta en `AGENT_LOOP_TOOL_POOL`, no tiene tool alias, no tiene `inputSchema`
consumible por el prompt).

## Gateway definition

```ts
export function recommendCatalogProductsCapability(
  getCapability: () => CatalogRecommendationCapability
): CapabilityGatewayDefinition
```

Mismo patron DI-factory que `searchProductsCapability(getPort)` en
`registry.ts`. `capability: "recommend_catalog_products"`,
`governance: { sideEffect: "read_only", authority: "autonomous", riskClass:
"low" }`, `maxRetries: 0`. **Correccion de revision**: ahora si tiene
`inputSchema` (JSON Schema draft-07 subset, mismo estilo que
`SEARCH_PRODUCTS_INPUT_SCHEMA`) - el Gateway nunca lo consulta para validar
`execute()` (confirmado leyendo `executeCapability.ts`: ninguna capability
tiene ese gate), y `buildToolDescriptions()` solo itera
`AGENT_LOOP_TOOL_POOL` (verificado por test), asi que agregar el schema no
expone la capability al modelo - existe solo para documentacion/reuso
agent-facing futuro.

Registrada en `CAPABILITY_GATEWAY_REGISTRY`:

```ts
recommendCatalogProductsCapability(getSharedCatalogRecommendationCapability)
```

## Input

```ts
type RecommendCatalogProductsGatewayInput = {
  sourceProduct: { productId: number; combinationId?: number | null };
  query?: string | null;
  explicitRepurchaseRequested?: boolean;
  excludedProducts?: readonly { productId: number; combinationId?: number | null }[];
  limit?: number;
  inStockOnly?: boolean;
};
```

Parser estricto y allowlisted (`parseRecommendCatalogProductsInput`) - el
validador real en runtime, independiente del `inputSchema` (el Gateway nunca
lo usa para gatear `execute()`): solo esas 6 claves top-level son aceptadas;
cualquier otra (incluyendo `masterCustomerId`, `customerId`, `customerMode`,
`recommendationContext`, `correlationId`, `signal`, `ownership`,
`purchasedProducts`, `apiKey`, o cualquier campo desconocido) es rechazada
como `invalid_arguments` / `errorCode: "unsupported_field"` antes de tocar
T10B7. `sourceProduct` es obligatorio y se valida solo estructuralmente aqui
(tipo/forma) - la validez de negocio (positividad, `combinationId===0`,
mismatches) la resuelve T10B6, nunca duplicada en este adapter.
`explicitRepurchaseRequested` se valida por tipo (boolean) y **se reenvia
verbatim** a T10B7 (correccion de revision - ver "Explicit repurchase"
abajo); nunca se infiere si el caller lo omite.

## Explicit repurchase

`explicitRepurchaseRequested=true` + `sourceProduct` valido se reenvia a
T10B7 en **ambos** modos (identificado y generico), produciendo
`request.context.explicitRepurchaseProducts=[sourceProduct]`. Esto requirio
un cambio minimo, aditivo, en T10B6
(`lib/brain/commercial/recommendation-context/searchProductsV2RequestTypes.ts` /
`buildSearchProductsV2Request.ts`): un campo top-level nuevo
`explicitRepurchaseRequested?: boolean` en `BuildSearchProductsV2RequestInput`,
mezclado por OR con el campo ya existente dentro de
`recommendationContext.recommendationIntent.explicitRepurchaseRequested` -
exactamente el mismo patron dual top-level/nested-merged que
`explicitExcludedProducts` ya usaba. T10B7 no requirio cambios (su input es
una interseccion de tipos). Ver "Explicit repurchase audit" en el release
doc para la auditoria completa (por que el diseño anterior forzaba modo
identificado, por que este es el cambio minimo correcto en la capa
propietaria). Una contradiccion (`sourceProduct` tambien en
`excludedProducts`) sigue produciendo `skipped: "contradictory_product_context"`,
verificado con la cadena real end-to-end.

## Trusted identity

```ts
const resolution = context.trustedCustomerSession?.masterCustomerIdentity;
const masterCustomerId = resolution?.status === "resolved" ? resolution.masterCustomerId : undefined;
```

`status: "resolved"` -> `masterCustomerId` exacto de
`resolution.masterCustomerId`. Cualquier otro caso (los 7 `identity_unresolved`
reasons, o sesion ausente) -> `masterCustomerId: undefined`, modo generico.
`identity.customerId` nunca se usa como fallback.

## Non-blocking generic mode

`identity_unresolved` (cualquier reason) o sesion ausente nunca produce
`unavailable`, `denied`, `requires_approval`, ni un `failed` tecnico causado
por el estado de identidad - siempre invoca T10B7 en modo generico.

## Adapter mapping

`CatalogRecommendationCapabilityResult` -> `CapabilityExecutionOutcome`:

- `completed` -> `status: "completed"`, `data: {status:"completed",
  customerMode, recommendations, excluded, warnings, personalization,
  execution, statistics, snapshot, metadata}` - passthrough exacto, sin
  ordenar/filtrar/deduplicar/seleccionar candidato.
- `skipped` -> `status: "completed"`, `data: {status:"skipped", reason}`
  (el union real `CapabilityGatewayExecutionStatus` no tiene miembro
  `blocked` - se uso la alternativa explicitamente preferida por la tarea),
  `retryable: false`, nunca reintentado, nunca re-llamado.
- `failed` (= `SearchProductsV2ClientError`, T10B5) -> `status: "failed"`,
  `data: {status:"failed", code, retryable, message, httpStatus?,
  providerErrorCode?}`, `errorCode: code` - `message` ya viene sanitizado por
  T10B5; nunca incluye `masterCustomerId`/`query`/`sourceProduct`/
  `excludedProducts`/request-response bodies/headers/API key.

## Availability

```ts
async checkAvailability() {
  try {
    const config = readHttpCatalogSearchProductsV2ClientConfig();
    return config === null
      ? { status: "unavailable", reason: "catalog_search_products_v2_not_configured" }
      : { status: "available", reason: null };
  } catch {
    return { status: "unavailable", reason: "catalog_search_products_v2_not_configured" };
  }
}
```

Chequeo local, sincrono, reutilizando el reader de configuracion exportado
por T10B5 - sin `fetch`, sin DB, sin leer identidad. Responde "¿esta
configurado SearchProducts V2?", nunca "¿el cliente esta identificado?".

## Governance / Retry ownership

`{ sideEffect: "read_only", authority: "autonomous", riskClass: "low" }`,
`maxRetries: 0` - T10B5 hace exactamente una llamada HTTP fisica por
invocacion sin retry propio, T10B7 tampoco reintenta; duplicar una
recomendacion ante un fallo transitorio produciria un segundo set de
recomendaciones potencialmente distinto para el mismo turno, asi que se
prefiere `retryable: true` y dejar la decision a una capa de politica
superior (mismo criterio que `search_company_knowledge`, la otra capability
de este Gateway con `maxRetries: 0`).

## Correlation / Cancellation

`context.correlationId` (nunca aceptado desde el input del caller) se
forwarda como `correlationId` a T10B7 -> T10B6 lo normaliza en
`callContext.correlationId` -> T10B5 lo mapea al header `x-correlation-id`,
nunca al body. `CapabilityGatewayContext` no expone `AbortSignal` alguno -
este adapter no inventa un `AbortController` propio; el unico limite de
tiempo real es el timeout interno de T10B5
(`CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS`).

## Production instance

Singleton lazy a nivel de modulo (mismo patron que `getSharedCatalogPort` en
`registry.ts`):

```ts
let cachedCapability: CatalogRecommendationCapability | undefined;
export function getSharedCatalogRecommendationCapability(): CatalogRecommendationCapability {
  if (!cachedCapability) cachedCapability = createProductionCatalogRecommendationCapability();
  return cachedCapability;
}
export function resetCatalogRecommendationCapabilityForTests() { cachedCapability = undefined; }
```

Construido una sola vez, en el primer uso (nunca al importar), fail-closed
via el cliente `configuration_error` que T10B5 ya provee cuando falta
configuracion (nunca lanza, nunca hace fetch). Auditado (correccion de
revision): sin `await` interno, por lo que dos llamadas "concurrentes" no
pueden entrelazarse bajo el modelo de un solo hilo de JS (test de regresion
agregado igual); el registry guarda el getter, no una instancia resuelta -
`execute()` llama `getCapability()` en cada invocacion, asi que nunca captura
una referencia obsoleta tras un reset (verificado con un test que alterna
sin-configurar -> configurado sobre la misma `CapabilityGatewayDefinition`
resuelta una sola vez); `resetCatalogRecommendationCapabilityForTests` se
exporta desde el mismo barrel productivo que las otras tres funciones reset
equivalentes de este directorio (`resetCapabilityGatewayCatalogPortForTests`,
`resetCustomerServicePortForTests`, `resetOnboardingServiceForTests`) -
consistente con la convencion existente del repo, no una desviacion.

## Persistence

Sin `buildRequestSummary`/`buildResponseSummary` propios - el fallback del
Gateway (persistir `input`/`outcome.data` crudos) ya es seguro por
construccion: el `input` crudo del caller nunca puede contener
`masterCustomerId` (rechazado como `unsupported_field`), y el `data` que
este adapter produce (completed/skipped/failed) tampoco lo incluye nunca.

## Integration DB isolation

`executeGovernedCapability` siempre escribe en `crm_capability_executions` -
no existe un seam de inyeccion de dependencias para esa escritura hoy
(`lib/db.ts`/`repository.ts` confirmados sin uno), y agregar uno solo para
un test seria modificar produccion para acomodar el test (prohibido). Los
tests de integracion de esta tarea usan en su lugar un helper local al
archivo de test (`executeWithFakePersistence`) que replica exactamente la
orquestacion de `executeGovernedCapability` (resolucion real de la
definicion, `checkAvailability` real, `execute` real con el mismo loop de
retry, mismo fallback de `buildRequestSummary`/`buildResponseSummary`) pero
cambia la escritura final a MySQL por un array en memoria - cero produccion
tocada, cero MariaDB requerida, mismo comportamiento real de
T10B7/T10B6/T10B5 y del servidor HTTP local ejercitado en cada test.

## Security

`masterCustomerId` resuelto nunca aparece en `data`/`errorCode`/`evidence`
de la salida ni en la fila persistida de `crm_capability_executions`
(verificado con `JSON.stringify` de la salida completa y de la fila
persistida). `trustedCustomerSession` nunca se serializa - solo se lee
`.masterCustomerIdentity.status`/`.masterCustomerId`.

## Concurrency

Cero estado mutable por ejecucion - el unico estado a nivel de modulo es el
singleton cacheado (stateless: cliente/capability, no datos por-llamada).
Verificado con dos `execute()` concurrentes (uno identificado, uno generico,
`correlationId`/`sourceProduct` distintos) sin contaminacion cruzada.

## Agent Loop visibility

No se agrego a `AGENT_LOOP_TOOL_POOL`, `toolAliases.ts`, `BrainToolName` ni al
prompt. `batch_get_products` es el precedente existente de este mismo repo
para "registrada en el Gateway, deliberadamente fuera del pool".

## Explicitly out of scope

Exposicion al modelo (`AGENT_LOOP_TOOL_POOL`, tool alias, prompts,
`buildToolObservation` - el `inputSchema` ahora presente no cambia esto,
ver "Gateway definition"), `recentCatalogContext`, `pendingCatalogAction`,
resolucion de `sourceProduct` desde evidencia observada, continuacion a
`get_product_details`, seleccion de candidato, Customer Profile directo,
construccion de un `CustomerRecommendationContext` (parcial o completo -
`explicitRepurchaseRequested` ahora se reenvia via el campo top-level de
T10B6, nunca via un context fabricado), `AbortSignal`/cancelacion real (el
contexto del Gateway no expone una), modificaciones a T10B5/T10B7/T10B8A.
T10B6 recibio un cambio minimo y aditivo (correccion de revision, ver
release doc) - unica excepcion.

## Next task

`CP-R1-T10B8C` - Recommendation Tool Exposure and Observation.
