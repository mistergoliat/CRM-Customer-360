# ADR-005: Catalog Boundary

## Estado

Accepted

## Decisión

```text
Commercial Domain
→ CatalogService
→ PrestashopCatalogAdapter | SnapshotCatalogAdapter | futuros adapters
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

Puede incluir cantidad, ubicación, lead time, fuente y timestamp. Disponibilidad no equivale a reserva.

### Dimensions

Distingue assembled y packaged, con unidades.

### CompatibilityResult

Incluye `compatible: true | false | unknown`, razones, restricciones y evidencia.

### CatalogContext

Incluye tenant, shop, customer, channel, locale, currency, quantity y fecha efectiva.

### Provenance

Todo dato crítico incluye source, retrieved_at, freshness y quality/confidence.

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

## Semántica de unknown

```text
unknown ≠ false
unknown ≠ zero
unknown ≠ out_of_stock
```

- precio unknown no se comunica;
- disponibilidad unknown no se presenta como stock;
- dimensiones unknown no permiten afirmar compatibilidad;
- compatibilidad unknown obliga a preguntar, advertir o escalar.

## Snapshot local

Se adopta `SnapshotCatalogAdapter` para desarrollo offline y tests determinísticos. No es fuente productiva.

## Facultades derivadas

Debe soportar recomendación, comparación, alternativa, cross-sell, upsell, bundles, carrito, cotización, checkout y reactivación por stock/precio.

## Límites

La IA no puede inventar productos, precio, disponibilidad, compatibilidad ni reserva.

## Invariantes

1. Dominio sin SQL PrestaShop.
2. Engine depende de `CatalogService`.
3. Producto y variante separados.
4. Precio con moneda y vigencia.
5. Disponibilidad con estado explícito.
6. Dimensiones con unidades.
7. Compatibilidad con evidencia.
8. Unknown se conserva.
9. Snapshot y PrestaShop cumplen el mismo contrato.
10. Reserva fuera de alcance.

## Criterio de validación

- motor funciona con ambos adapters;
- precio unknown no se comunica;
- variante con precio/stock propios;
- dominio no conoce tablas PrestaShop.
