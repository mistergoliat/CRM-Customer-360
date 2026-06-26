# Catalog Boundary

Este módulo implementa la frontera de catálogo exigida por `ADR-005`.

## Propósito

El dominio comercial no debe conocer tablas de PrestaShop ni depender de transporte, SQL o estructuras legacy. Su única dependencia de lectura es `CatalogService`.

La secuencia esperada es:

```text
Commercial Domain -> CatalogService -> SnapshotCatalogAdapter -> PrestashopCatalogAdapter
```

## Contratos principales

Los tipos centrales viven en [`lib/catalog/types.ts`](../../lib/catalog/types.ts):

- `Product`
- `ProductVariant`
- `Money`
- `ProductPrice`
- `Availability`
- `ProductDimensions`
- `Dimensions`
- `CompatibilityResult`
- `CatalogContext`
- `Provenance`
- `UnknownCatalogValue`
- `ProductRelation`
- `CatalogUrl`
- `ProductSearchResult`

## Implementación

### `SnapshotCatalogAdapter`

[`lib/catalog/snapshotCatalogAdapter.ts`](../../lib/catalog/snapshotCatalogAdapter.ts)

- determinístico;
- no productivo;
- útil para desarrollo offline y pruebas contractuales;
- conserva `unknown`, `freshness` y `provenance`;
- separa producto y variante;
- soporta precios, disponibilidad, dimensiones, compatibilidad, relaciones y URLs.

### `PrestashopCatalogAdapter`

[`lib/catalog/prestashopCatalogAdapter.ts`](../../lib/catalog/prestashopCatalogAdapter.ts)

- read-only;
- sin inventario;
- sin reservas;
- sin checkout;
- sin descuentos;
- sin side effects;
- no expone SQL al dominio;
- conserva `unknown` cuando la evidencia no alcanza;
- diferencia ausencia técnica de dato comercial.

## Contexto

[`CatalogContext`](../../lib/catalog/types.ts) transporta la información mínima para resolver catálogo de forma reproducible:

- tenant;
- shop;
- customer;
- channel;
- locale;
- currency;
- quantity;
- effective date.

## Semántica de `unknown`

La frontera protege que `unknown` no colapse en:

- `false`;
- `0`;
- `out_of_stock`;
- `discontinued`;
- `nonexistent`.

Eso se valida con tests contractuales y con el adapter read-only.

## Fixtures y contrato

La suite de contrato vive en:

- [`tests/catalog/catalog-contract.test.ts`](../../tests/catalog/catalog-contract.test.ts)
- [`tests/catalog/catalog-architecture.test.ts`](../../tests/catalog/catalog-architecture.test.ts)

La cobertura incluye:

- búsqueda determinística;
- separación entre producto y variante;
- precio con moneda, vigencia y procedencia;
- disponibilidad explícita y desconocida;
- dimensiones con unidades;
- compatibilidad `true`, `false` y `unknown`;
- URLs comerciales;
- freshness;
- contexto por tienda y por moneda;
- degrades seguros ante fallos de infraestructura;
- ausencia de side effects;
- ausencia de referencias directas a tablas PrestaShop desde el dominio.

## Integración actual

El consumidor comercial de catálogo debe entrar por:

[`lib/brain/commercial/sales-consultative/catalogRepository.ts`](../../lib/brain/commercial/sales-consultative/catalogRepository.ts)

Ese bridge delega en `CatalogService` y evita SQL directo en el dominio comercial.

