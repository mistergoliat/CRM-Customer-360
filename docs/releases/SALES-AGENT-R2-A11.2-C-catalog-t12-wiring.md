# SALES-AGENT-R2-A11.2-C - Catalog T12 Wiring for search_products

## 1. Wiring anterior

`search_products` (Capability Gateway, single registration shared by CommercialWork R2, the legacy Agent Tool Loop, and the deterministic ACS-R1-01.1 fallback runtime) called `CatalogPort.searchProducts()`, which hit the legacy `GET /v1/products/search`. That endpoint's token-fallback retrieval treated the Spanish filler word "de" as a mandatory literal SQL token, so "discos olimpicos de 20kg" returned 0 results ([[sales-agent-r2-a11-2-catalog-audit]]). `buildCommercialWorkProjection.ts`'s `applyObjectiveState` then re-derived `resolved/ambiguous/not_found` by counting `items.length` itself (0/1/N), duplicating a decision the Catalog Service's `resolve-product-intent` endpoint (T12) already makes with synonyms, unit normalization and explicit-constraint ranking.

## 2. Wiring nuevo

`search_products` now calls `POST /api/v2/catalog/resolve-product-intent` (T12) via a new `CatalogPort.resolveProductIntent()` method. `buildCommercialWorkProjection.ts` reads T12's `resolution.status` (`resolved | clarification_required | no_match`) directly instead of counting candidates.

```
Objective SELECT_PRODUCTS/CHANGE_QUANTITY, sin items resueltos
       |
   SEARCH_PRODUCTS (capabilityName: "search_products", backend -> T12)
       |
   productIntent.resolution.status
   +---------------------+---------------------------+---------------------------+
 resolved            clarification_required        no_match              (malformed payload)
   |                       |                           |                         |
 items[] auto            WAITING_CUSTOMER,          WAITING_CUSTOMER,         FAILED
 (READY,                 PRODUCT_AMBIGUOUS           PRODUCT_NOT_FOUND         (system-owned,
 SELECT_PRODUCTS         (real candidates w/                                    contract
 continua)               price when T12 has one)                                violation)
```

Precondición operativa: T12 delega su propio retrieval en el mismo `CatalogApplicationService.searchProducts` que respalda el endpoint legacy, así que hereda el mismo bug de stopwords a menos que A11.2-B (fix de stopwords en `MS-pesaschile-catalog-service`, ver Parte 13) esté aplicado. C sola no resuelve "discos olimpicos de 20kg" sin B.

## 3. Decisión sobre CatalogPort (Parte 3/4)

Se evaluaron dos opciones para el shape del método:

**Opción descartada**: exponer T12 como una capability nueva (`resolve_product_intent`), separada de `search_products`. Se descartó porque la tarea la reserva solo para el caso en que R2 necesite `search_products` y T12 como responsabilidades distintas - no se encontró esa necesidad; T12 es estrictamente el reemplazo del backend de la misma responsabilidad ("resolver un `productReference` de cliente en candidatos reales").

**Opción elegida**: `CatalogPort` gana un método nuevo, `resolveProductIntent()`, sin tocar `searchProducts()` en absoluto. `searchProductsCapability` (Gateway) es el único llamador que cambia, de `port.searchProducts()` a `port.resolveProductIntent()`.

Razón para no colapsar todo en un solo método: `CatalogPort.searchProducts()` tiene un consumer directo fuera del Gateway - `lib/catalog/consoleService.ts` (consola admin de catálogo) - que espera el shape legacy (`CatalogSearchResult`) y sigue apuntando a `/v1/products/search`. Cambiar `searchProducts()` habría roto ese consumer sin necesidad.

## 4. Compatibilidad legacy (Parte 11)

El hallazgo central de esta tarea: `search_products` es una **única** capability registrada en `CAPABILITY_GATEWAY_REGISTRY`, consumida por tres runtimes distintos desde el mismo registro (no hay tres implementaciones):

1. CommercialWork R2 (`commercialWorkExecutor.ts`, este slice).
2. El Agent Tool Loop legacy (`runAgentToolLoop.ts`, vía `executeGovernedCapability("search_products", ...)`).
3. El runtime determinista más antiguo (`runNativeAutonomousCycle.ts` -> `buildCatalogGroundedMessage.ts` -> `rankCatalogSearchResults.ts`), activo cuando ambos flags de runtime están apagados.

Cambiar el backend de `search_products` a T12 afecta a los tres. Para no romper (2) y (3), `searchProductsCapabilityDataFromProductIntent()` (`registry.ts`) construye el `data` de salida como:

```ts
type SearchProductsCapabilityData = CatalogSearchResult & { productIntent: ProductIntentResolutionResult };
```

- `query`/`items[]`/`provenance` (el shape legacy exacto, `CatalogSearchResultItem` byte-for-byte) se **derivan** de `productIntent.candidates` - nunca una segunda búsqueda ni una segunda lista independiente. `items[].matchType` se aproxima desde `candidate.reasons[]` (mapeo best-effort: `EXACT_REFERENCE_MATCH -> exact_sku`, `EXACT_NAME_MATCH -> exact_name`, `NAME_TOKEN_MATCH`/`SYNONYM_MATCH -> partial_name`, resto -> `description`) solo para que `rankCatalogSearchResults.ts` (runtime 3) siga teniendo una señal de re-ordenamiento razonable - T12 ya entrega los candidatos ordenados por score, este mapeo no reimplementa ranking, es una reetiqueta.
- `productIntent` (el resultado T12 crudo, sin diluir) es el único campo que `buildCommercialWorkProjection.ts` lee para R2.

Verificado en vivo con test real (no solo tipos): `tests/agent-loop/runAgentToolLoop.test.ts` (102 tests, runtime 2), `tests/native/catalogCapabilityCycle.test.ts` + `tests/native/catalogConversationFlow.test.ts` (runtime 3), `tests/agent-loop/recommendCatalogProductsAgentLoopIntegration.test.ts` (evidence gate de `recommend_catalog_products`/`get_product_details` sobre observaciones de `search_products`) - los tres corren en verde contra un mock HTTP real que ahora sirve T12 en vez del endpoint legacy, sin cambiar ninguna aserción de negocio existente.

`consoleService.ts` (admin catalog console) no se tocó - sigue llamando `catalogPort.searchProducts()` -> `/v1/products/search` directamente, nunca pasa por el Gateway.

## 5. Mapping de T12 resolution (Parte 6)

`buildCommercialWorkProjection.ts`'s `applyObjectiveState`, rama `SELECT_PRODUCTS`/`CHANGE_QUANTITY`:

- `resolved`: `objective.inputs.items` se puebla desde `resolution.sourceProduct` (nunca inventado - si T12 marca `resolved` sin `sourceProduct`, el parser rechaza el payload como inválido, ver abajo), `objective.status = READY`.
- `clarification_required`: `objective.status = WAITING_CUSTOMER`, `missingRequirements: ["PRODUCT_AMBIGUOUS"]` (nombre preservado, sin churn), `objective.inputs.productCandidates` puebla desde `productIntent.candidates` (hasta 5), incluyendo `price` cuando T12 lo trae.
- `no_match`: `objective.status = WAITING_CUSTOMER`, `missingRequirements: ["PRODUCT_NOT_FOUND"]` (sin cambio de mensaje).
- Fallo técnico real (HTTP retryable/no retryable) del capability: sin cambio - `WAITING_SYSTEM`/`FAILED` según `error.retryable`, nunca `WAITING_CUSTOMER` (Parte 12/13, comportamiento preexistente).
- Payload `productIntent` ausente o estructuralmente irreconocible dentro de una ejecución `completed` (contract violation real, nunca esperado en operación normal post-C): `FAILED`, system-owned - nunca se interpreta como pregunta al cliente.

El parser (`parseProductIntentResolution`) es deliberadamente defensivo (nunca confía ciegamente en JSON persistido) y valida el invariante de T12 "`resolved` siempre trae `sourceProduct`" tanto en el adaptador HTTP (`httpCatalogAdapter.ts#parseProductIntentResponse`, rechaza la respuesta con `invalid_response` si se viola en vivo) como en la proyección (rechaza el payload persistido si se viola al releer desde `crm_capability_executions`).

## 6. Evidence (Parte 10)

Sin tabla ni columna nueva. `crm_capability_executions.responseSummaryJson` ya persistía el `data` completo del capability - ahora ese `data` incluye `productIntent` (query/resolution/candidates con price/stock/publicLink/score/reasons/clarification/statistics/warnings) tal como T12 lo devolvió, además de `items[]`/`query`/`provenance` para compatibilidad legacy. `requestSummaryJson` no cambió (`{query, limit}`), así que `latestSearchProductsExecution`'s match por `requestSummaryJson.query` sigue funcionando sin cambios.

## 7. Continuation cross-turn (Parte 8)

Sin cambios en `RecentCatalogContext`/`requirementResolver.ts`. `productsFromSearchProducts` (`recentCatalogContext.ts`) solo necesita `payload.items[].productId`/`.name`/`.combinationId` opcional - exactamente lo que la vista de compatibilidad ya provee. `resolveProductRequirement` (fuzzy-match sobre `RecentCatalogContext`) es el mismo mecanismo de antes de A11.2-C.

## 8. Same-round safety (Parte 7)

Sin cambios en `deriveCommercialWorkSteps.ts`/`commercialWorkExecutor.ts`. El mecanismo que evita que `SELECT_PRODUCTS` corra en la misma ronda con items vacíos (`MISSING_PRODUCT_EVIDENCE` fuera del whitelist de `canAutoActivateStep`) es independiente de la forma de la respuesta - solo depende de que `applyObjectiveState` sea quien interpreta el resultado del search en la SIGUIENTE ronda de proyección, lo cual sigue siendo cierto. Verificado con `tests/commercial/commercialWorkWaitingCustomerReactivation.test.ts` (WCP01/WCP02, WC01-WC12) y la suite completa de `commercialWorkExecutor.test.ts`/`commercialWorkProjection.test.ts`.

## 9. Tests

- `tests/catalog/httpCatalogAdapter.test.ts`: CATC01 (resolved, price/stock/publicLink/score/reasons preservados), CATC02 (clarification_required, dimension/options), CATC03 (no_match como resultado completo), CATC04 (503 retryable), CATC05 (422 invalid_response no retryable), más 400/`resolved` sin `sourceProduct` rechazado/request body exacto.
- `tests/commercial/capabilityGateway.test.ts`: `search_products` ahora golpea `POST /api/v2/catalog/resolve-product-intent` (verificado por path+method reales), `responseSummaryJson.productIntent`/`items` persistidos correctamente vía DB real.
- `tests/commercial/commercialWorkProjection.test.ts`: CW09b1-b5 actualizados a fixtures T12 (siguen en verde, sin cambiar sus aserciones), + CATC05 (payload malformado -> FAILED), CATC06 (price preservado en candidatos ambiguos), CATC14 (reproyección estable).
- `tests/commercial/buildCommercialWorkFinalizerMessage.test.ts` (nuevo): CATC07 (clarificación con 3 candidatos reales, precio mostrado cuando existe, nunca inventado).
- `tests/commercial/commercialWorkWaitingCustomerReactivation.test.ts`: fixtures de DB real actualizadas a T12 (WCP01/WCP02 - same-round/continuation regression, CATC09/CATC14 equivalentes).
- `tests/commercial/commercialWorkSemanticCompleteness.test.ts`: fixture `seedProductSearchEvidence` actualizada a T12 (Part 6/7 y sus dependientes en cascada).
- Legacy/runtime 2-3 (CATC10): `tests/agent-loop/runAgentToolLoop.test.ts` (102 tests), `tests/agent-loop/recommendCatalogProductsAgentLoopIntegration.test.ts` (24 tests), `tests/native/catalogCapabilityCycle.test.ts`, `tests/native/catalogConversationFlow.test.ts`, `tests/e2e/reactiveTurnRestartRecovery.e2e.test.ts` - mocks actualizados al endpoint T12, cero cambio de aserciones de negocio.
- `lib/brain/commercial/agent-loop/benchmark/environment.ts`: fixture HTTP compartida del benchmark actualizada con una rama T12 (siempre ambiguo entre los 2 productos fixture, igual que el GET legacy que ignoraba el query text).

## 10. Live smoke (Parte 13)

Ejecutado contra el Catalog Service local real (`C:\Users\Goli\Pesas Chile\MS\MS-Stock\services`, `npm run dev`, puerto 4010, RDS read-only `pc_consultor`/`pesas_productiva`, apagado al terminar - cero escrituras) con el fix de stopwords de A11.2-B presente. **Corrección post-cierre (2026-08-24)**: al momento de este smoke, A11.2-B estaba en el working tree local sin commitear; horas más tarde, ese mismo día, A11.2-B se commiteó y pusheó a `origin/main` de `MS-pesaschile-catalog-service` (`b60b624 fix(catalog): ignore stopwords in token fallback`, verificado - `main` local y `origin/main` coinciden exactamente en ese commit, working tree limpio). El smoke local sigue siendo evidencia válida del comportamiento (mismo código, ahora además commiteado), pero **no** es evidencia de que ese commit esté desplegado en el Catalog Service de producción - ver Parte 12:

| Query | `resolution.status` | Resultado |
|---|---|---|
| "discos olimpicos de 20kg" (frase literal reportada) | `clarification_required` | productId 1499, precio $73.990, publicLink real - ya NO `no_match` |
| "disco olimpico 20kg" | `clarification_required` | idem |
| "barra classic" | `clarification_required`, score 0.74 | productId 1171, precio $79.990 |
| "producto inexistente xyz" | `no_match` | 0 candidatos, confidence 0 |

Confirma que B+C combinados resuelven el bug reportado (WA01). C sola, sin B, seguiría dando `no_match` para la primera query (T12 hereda el retrieval compartido).

## 11. Riesgos/deuda

- El fix de stopwords (A11.2-B) ya está commiteado y pusheado a `origin/main` de `MS-pesaschile-catalog-service` (`b60b624`, verificado 2026-08-24) - esta tarea no lo tocó (fuera de alcance, repo ajeno), solo confirma su estado. La única precondición real pendiente es que ese commit esté **desplegado** en el Catalog Service de producción antes del smoke owner-only final de A11.2-C (Parte 12) - commiteado en `main` no implica desplegado.
- `matchType`/`availability` derivados de `productIntent` para el shape legacy son aproximaciones (best-effort), no una reimplementación exacta del legacy `matchType` original - aceptable porque ningún consumer legacy depende de exactitud fina en ese campo (confirmado leyendo cada consumer real: `buildToolObservation.ts` no lo lee, `rankCatalogSearchResults.ts` lo usa solo como tie-breaker secundario sobre un orden que T12 ya entrega razonablemente bueno).
- A11.2-D (exponer explícitamente price/stock de T12 en el evidence "sin nuevo step") no se implementó como slice separado - su necesidad mínima ya quedó cubierta dentro de A11.2-C (Parte 6/9 lo exigían para el criterio de aceptación de esta misma tarea: `productCandidates[].price` y el mensaje de clarificación con precio real). No hay gap adicional conocido que justifique un A11.2-D separado hoy.
- `G4` (ranking T12 para queries genéricas de una palabra, ej. "una barra" prioriza mal accesorios sobre el producto principal) es deuda documentada en A11.2 original, dentro del propio Catalog Service - no corregible desde CRM sin duplicar lógica de ranking (prohibido explícitamente).

## 12. Secuencia de despliegue

Estado por componente (verificado 2026-08-24):

| Componente | Tarea | Estado |
|---|---|---|
| `MS-pesaschile-catalog-service` | A11.2-B (fix de stopwords) | `main`/`origin/main` en `b60b624` - commiteado y pusheado. **Pendiente: despliegue a producción.** |
| `CRM-Customer-360` | A11.4 (SELECT_SHIPPING_OPTION) | Mergeado en `develop` (PR #100). |
| `CRM-Customer-360` | A11.2-C (este cambio) | Commit `35a3c41`, branch `feat/sales-agent-r2-a11-2-c-catalog-t12-wiring` - PR abierto contra `develop`. |

Precondición real (única): **A11.2-B debe estar desplegado en el Catalog Service de producción antes del smoke final de A11.2-C** - estar en `main` no basta. Orden obligatorio:

1. Confirmar/ejecutar el despliegue de `MS-pesaschile-catalog-service` (`main@b60b624` o posterior) al entorno de producción real.
2. Desplegar `CRM-Customer-360` con A11.2-C (este cambio, una vez mergeado).
3. Reiniciar ambos runtimes.
4. Smoke owner-only con el caso WA01 ("2 discos olimpicos de 20kg" o equivalente) contra el entorno real desplegado.

Desplegar C sin que B ya esté en el Catalog Service de producción dejaría el bug reportado sin resolver: T12 hereda el retrieval compartido y seguiría devolviendo `no_match` para la frase literal (Parte 1.5.1 del audit original). No hace falta más desarrollo de catálogo después de este merge - el siguiente trabajo es despliegue controlado B->C y la prueba owner-only WA01, no otro fix de código. A11.2-D no se abre como tarea separada - su evidencia mínima (price/stock en `productCandidates`, mensaje de clarificación con precio) ya quedó cubierta dentro de A11.2-C (Parte 5/9).

## Veredicto

**A11_2_C_CATALOG_T12_WIRING_VALIDATED**

R2 ya no depende de `/v1/products/search` para resolver `productReference` (criterio 1); `search_products` consume T12 (criterio 2); `resolved`/`clarification_required`/`no_match` mapean a los tres outcomes requeridos con evidencia real, sin invención (criterios 3-5); fallos técnicos siguen `WAITING_SYSTEM`/`FAILED`, nunca `WAITING_CUSTOMER` (criterio 6); no se pierde evidencia crítica - price/stock/publicLink/score/reasons/clarification se persisten completos vía `productIntent` (criterio 7); restart/reprojection funciona (criterio 8, CATC14); continuación cross-turn funciona sin cambios (criterio 9); Agent Tool Loop y el runtime determinista más antiguo siguen funcionando, verificado con sus propias suites reales, no solo tipos (criterio 10); el bug same-round de A11.1 no se reintrodujo (criterio 11, WCP01/WCP02 en verde); no se duplicó lógica de catálogo en CRM - todo mapeo es DTO shaping sobre un resultado ya calculado por el Catalog Service (criterio 12).

No se declara operacionalización owner-only (`A11_OWNER_ONLY_OPERATIONAL`) - fuera de alcance de este slice.
