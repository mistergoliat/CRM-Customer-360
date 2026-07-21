---
title: ADR-005 - Catalog Boundary
doc_id: adr-005-catalog-boundary
status: approved
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-08
source_of_truth_for:
  - catalog boundary
  - product catalog access
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - adr
---
# ADR-005: Catalog Boundary

## Relaciones

- Gobernado por: [Autonomous Commerce PRD](../../product/autonomous-commerce-prd.md)
- Depende de: [ACTIVE_RELEASE](../../ACTIVE_RELEASE.md)
- Implementa: boundary para `CatalogService`
- Evidencia: [CAPABILITY_MATRIX](../../CAPABILITY_MATRIX.md)
- Context pack: [ACS-R1-01.1](../../context-packs/ACS-R1-01.1.md)
- Reemplaza: none

## Estado

Accepted

## DecisiÃ³n

```text
Commercial Domain
â†’ CatalogService
â†’ PrestashopCatalogAdapter | SnapshotCatalogAdapter | futuros adapters
```

## Modelo de dominio

### Product

Familia comercial.

### ProductVariant

Unidad vendible o SKU. Precio, disponibilidad, URL y atributos pueden pertenecer a la variante.

### Money

```ts
interface Money {
  amount: number;
  currency: string;
}
```

### ProductPrice

Incluye list price, sale price, effective price, moneda, impuestos, vigencia, fuente, timestamp y producto/variante.

### Availability

```text
in_stock
out_of_stock
backorder
preorder
discontinued
unknown
```

Puede incluir cantidad, ubicaciÃ³n, lead time, fuente y timestamp. Disponibilidad no equivale a reserva.

### Dimensions

Distingue assembled y packaged, con unidades.

### CompatibilityResult

Incluye `compatible: true | false | unknown`, razones, restricciones y evidencia.

### CatalogContext

Incluye tenant, shop, customer, channel, locale, currency, quantity y fecha efectiva.

### Provenance

Todo dato crÃ­tico incluye source, retrieved_at, freshness y quality/confidence.

## Interfaz conceptual

```ts
interface CatalogService {
  searchProducts(query, context): Promise<ProductSearchResult>;
  getProduct(productId, context): Promise<Product | null>;
  getVariant(variantId, context): Promise<ProductVariant | null>;
  getPrice(subjectId, context): Promise<ProductPrice | UnknownCatalogValue>;
  getAvailability(subjectId, context): Promise<Availability>;
  getDimensions(subjectId, context): Promise<ProductDimensions | UnknownCatalogValue>;
  getCompatibility(input, context): Promise<CompatibilityResult>;
  getRelatedProducts(subjectId, context): Promise<ProductRelation[]>;
  getCommercialUrl(subjectId, context): Promise<CatalogUrl | UnknownCatalogValue>;
}
```

## SemÃ¡ntica de unknown

```text
unknown â‰  false
unknown â‰  zero
unknown â‰  out_of_stock
```

- precio unknown no se comunica;
- disponibilidad unknown no se presenta como stock;
- dimensiones unknown no permiten afirmar compatibilidad;
- compatibilidad unknown obliga a preguntar, advertir o escalar.

## Snapshot local

Se adopta `SnapshotCatalogAdapter` para desarrollo offline y tests determinÃ­sticos. No es fuente productiva.

## Facultades derivadas

Debe soportar recomendaciÃ³n, comparaciÃ³n, alternativa, cross-sell, upsell, bundles, carrito, cotizaciÃ³n, checkout y reactivaciÃ³n por stock/precio.

## LÃ­mites

La IA no puede inventar productos, precio, disponibilidad, compatibilidad ni reserva.

## Invariantes

1. Dominio sin SQL PrestaShop.
2. Engine depende de `CatalogService`.
3. Producto y variante separados.
4. Precio con moneda y vigencia.
5. Disponibilidad con estado explÃ­cito.
6. Dimensiones con unidades.
7. Compatibilidad con evidencia.
8. Unknown se conserva.
9. Snapshot y PrestaShop cumplen el mismo contrato.
10. Reserva fuera de alcance.

## Criterio de validaciÃ³n

- motor funciona con ambos adapters;
- precio unknown no se comunica;
- variante con precio/stock propios;
- dominio no conoce tablas PrestaShop.
