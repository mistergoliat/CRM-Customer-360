---
title: CustomerRecommendationContext -> SearchProducts V2 request wiring
doc_id: integration-search-products-v2-request-wiring
status: implemented_not_wired
tags:
  - integration
  - catalog
  - recommendations
---
# CustomerRecommendationContext -> SearchProducts V2 request wiring

## Relaciones

- Implementa: `lib/brain/commercial/recommendation-context/buildSearchProductsV2Request.ts`,
  `lib/brain/commercial/recommendation-context/searchProductsV2RequestTypes.ts`.
- Consume (sin modificar): `CustomerRecommendationContext` (CP-R1-T10B2,
  `lib/brain/commercial/recommendation-context/types.ts`),
  `SearchProductsV2ClientRequest` (CP-R1-T10B5,
  `lib/catalog/search-products-v2/types.ts`).
- Task: `CP-R1-T10B6` - see
  `docs/releases/CP-R1-T10B6-identity-recommendation-context-wiring.md`.
- Reemplaza: none. No modifica `CustomerRecommendationContext`,
  `buildCustomerRecommendationContext`, ni el cliente HTTP T10B5.

## Alcance

Mapper puro: `CustomerRecommendationContext` + identidad/producto ya
resueltos -> `SearchProductsV2ClientRequest` + call context. No llama
Catalog Service, no registra capability, no toca el Agent Loop. El
resultado queda disponible para que una capability posterior (`CP-R1-T10B7`)
invoque `CatalogSearchProductsV2Client.searchProducts(...)`.

## Field mapping (CRM -> SearchProducts V2)

| Campo CRM | Campo SearchProducts V2 | Accion |
|---|---|---|
| `masterCustomerId` (de `recommendationContext.masterCustomerId` y/o el campo `masterCustomerId` de nivel superior - ver "Fuentes duplicadas" abajo) | `customer.customerId` | preservar como string, nunca `Number()` |
| `masterCustomerId` | `context.customerId` | preservar, siempre junto a `customer.customerId` |
| `sourceProduct.productId` (de `recommendationContext.recommendationIntent.sourceProduct` y/o el campo de nivel superior - ver "Fuentes duplicadas" abajo) | `sourceProduct.productId` | `number` -> `String(productId)`, `productId<=0`/no-entero/no-finito rechaza todo el mapper |
| `sourceProduct.combinationId` | `sourceProduct.combinationId` | `undefined`/`null`/`0` -> omitir (producto base); `>0` entero finito -> `String(combinationId)`; negativo/decimal/no-finito rechaza |
| `explicitRepurchaseRequested` (solo de `recommendationContext.recommendationIntent`, no existe equivalente de nivel superior) | `context.explicitRepurchaseProducts` | `true` -> `[sourceProduct]` (identidad exacta); `false` -> omitir |
| `explicitExcludedProducts` (union de `recommendationContext.recommendationIntent.explicitExcludedProducts` y el campo de nivel superior) | `context.excludedProducts` | normalizar cada entrada con el mismo helper de producto, deduplicar por identidad exacta, preservar orden de primera aparicion |
| `matchingPurchases`, `purchaseHistory`, `sourceProductHistory`, `capabilities`, `warnings` (del contexto) | ninguno | no mapeado - ownership/historial nunca producen preferencia ni recompra |
| preferencia por productos preferidos | `context.preferredProducts` | omitido deliberadamente en v1 - no hay fuente en `CustomerRecommendationContext` |
| `query` (input de nivel superior) | `query` | trim; vacio tras trim -> omitir; `>240` tras trim rechaza todo el mapper |
| `correlationId` (input de nivel superior) | header `x-correlation-id` via `callContext` | nunca en el body |
| `limit` (input de nivel superior) | `limit` | entero 1-20; omitir si no se especifica, nunca defaultear |
| `inStockOnly` (input de nivel superior) | `filters.inStockOnly` | boolean; omitir si no se especifica |

## Fuentes duplicadas: masterCustomerId y sourceProduct

`masterCustomerId` y `sourceProduct` se aceptan tanto dentro de
`recommendationContext` como en campos independientes del input, a
propósito: `recommendationContext` puede estar completamente ausente
(Customer Profile totalmente no disponible, ningún contexto pudo
construirse) mientras identidad/producto siguen siendo conocidos desde otra
parte del mismo turno ("modo genérico con producto conocido").

**Las fuentes duplicadas son compatibles solo cuando representan la misma
identidad normalizada; cualquier diferencia produce `skipped`.** Regla
exacta:

- **Ninguna fuente presente** -> el campo queda ausente (modo genérico para
  `masterCustomerId`; `source_product_missing` para `sourceProduct`, ya que
  ese campo es obligatorio).
- **Solo una fuente presente** -> se usa tal cual, validada normalmente.
- **Ambas fuentes presentes** -> cada una se normaliza de forma
  independiente primero (`masterCustomerId` vía la misma función de
  normalización; `sourceProduct` vía `toSearchProductsV2ProductIdentity`,
  comparado por identidad runtime exacta - `productId` + `combinationId`
  opcional, con `combinationId=0` normalizado a "ausencia" antes de
  comparar). Si cualquiera de las dos es inválida ->
  `invalid_customer_identity`/`source_product_invalid` (revisado antes que
  la comparación). Si ambas son válidas pero **distintas** después de
  normalizar -> `customer_identity_mismatch`/`source_product_mismatch` -
  ninguna se elige silenciosamente. Si coinciden -> se usa el valor
  normalizado y el mapper continúa normalmente.

`explicitExcludedProducts` es la única excepción a esta regla de
compatibilidad: ambas fuentes (la lista del contexto y la lista de nivel
superior) son legítimas simultáneamente y se combinan (unión, deduplicada) -
nunca se comparan para detectar una discrepancia.

## Normalizacion de identidad de producto

Un unico helper (`toSearchProductsV2ProductIdentity`) convierte cada
identidad de producto (source product, cada exclusion, la entrada de
recompra) - nunca disperso en otro lugar. `combinationId===0` (la misma
convencion que usa Customer Profile para "producto base, sin variante" en su
campo `productAttributeId`) se normaliza a "omitir", igual que `undefined`/
`null` - nunca se envia como el string literal `"0"`.

## Modo generico

Sin `masterCustomerId` valido (ausente, no invalido), el request se
construye igual, sin `customer` ni `context.customerId` -
`metadata.customerMode: "generic"`. Catalog Service entrega una
recomendacion generica, sin personalizacion. Esto no es un error - es un
resultado `status: "ready"` normal.

## Orden de validacion

Orden determinístico, documentado explícitamente en el codigo
(`buildSearchProductsV2Request.ts`):

1. normalizar/validar identidad de cliente (ambas fuentes si estan
   presentes);
2. detectar `customer_identity_mismatch`;
3. normalizar/validar identidad de producto fuente (ambas fuentes si estan
   presentes);
4. detectar `source_product_mismatch`;
5. validar `query`;
6. validar `correlationId`;
7. validar `limit`/`filters`;
8. procesar exclusiones (union + normalizacion + deduplicacion);
9. detectar contradiccion exclusion vs. recompra explicita;
10. construir el request.

Un mismatch de identidad de cliente se detecta antes que cualquier otra
validacion (incluida la contradiccion producto/exclusion) - si ambas
condiciones aplicarian simultaneamente, el mismatch de identidad gana.

## Contradicciones

Unica contradiccion detectada: el source product (objetivo de la recompra)
tambien aparece en las exclusiones, con `explicitRepurchaseRequested=true`.
Evaluada por identidad runtime exacta - excluir la variante mientras se
recompra la base (o viceversa) NO es una contradiccion, son identidades
distintas. Este reason (`contradictory_product_context`) es distinto de
`customer_identity_mismatch`/`source_product_mismatch` - representa una
contradiccion entre exclusion y recompra, no entre fuentes duplicadas de
identidad.

## Seguridad

Los `reason` publicos del resultado `skipped` son códigos cerrados
(`source_product_missing`, etc.) - nunca incluyen `masterCustomerId`, la
query completa, product IDs, ni PII. El mapper no loguea.

## Fuera de alcance

No llama a Catalog Service. No registra capability. No modifica el Agent
Loop, `recentCatalogContext`, `pendingCatalogAction`, el Sales Agent, ni
`CustomerRecommendationContext`/`buildCustomerRecommendationContext`
(CP-R1-T10B2). No resuelve `masterCustomerId` por email/telefono/DNI/nombre.
No implementa `preferredProducts` en v1.
