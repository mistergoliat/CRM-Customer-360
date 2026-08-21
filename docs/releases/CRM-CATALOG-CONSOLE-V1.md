---
title: CRM Catalog Console V1
doc_id: crm-catalog-console-v1
status: release-specific
tags:
  - catalog
  - crm
  - admin-console
---

# CRM-CATALOG-CONSOLE-V1

## 1. Objetivo

Crear una consola administrativa read-only dentro de CRM-Customer-360 para buscar productos, seleccionar uno y ver en una misma vista su detalle comercial y sus recomendaciones basadas en evidencia historica del Catalog Service.

## 2. Arquitectura final

```text
Browser
-> /api/catalog/products/*
-> lib/catalog/consoleService.ts
-> CatalogPort / CatalogSearchProductsV2Client
-> MS-pesaschile-catalog-service
```

El browser nunca llama directo a Catalog Service y nunca recibe `CATALOG_SERVICE_API_KEY`.

## 3. Archivos modificados

- `lib/catalog/consoleService.ts`: boundary server-side para busqueda, contexto de producto, mapeo DTO y errores.
- `app/api/catalog/products/search/route.ts`: route handler autenticado para busqueda.
- `app/api/catalog/products/[productId]/context/route.ts`: route handler autenticado para detalle + recomendaciones.
- `components/catalog/CatalogConsole.tsx`: UI master-detail con debounce, loading, empty y error states.
- `app/(hub)/catalog/page.tsx`: pagina App Router de la consola.
- `lib/modules.ts`: entrada visible `Catalogo` en navegacion.
- `tests/catalog/consoleService.test.ts`: tests dirigidos de mapping, validacion y degradacion.

## 4. Contratos usados

- `GET /v1/products/search?q=<query>` via `CatalogPort.searchProducts`.
- `GET /v1/products/:productId` via `CatalogPort.getProductDetails`.
- `POST /api/v2/recommendations/search-products` via `CatalogSearchProductsV2Client.searchProducts`.

Request V2 usado por la consola:

```json
{
  "sourceProduct": {
    "productId": "<id>"
  },
  "limit": 5
}
```

No se envia `customer`.

## 5. Variables de entorno

Reutiliza las existentes:

- `CATALOG_SERVICE_BASE_URL`
- `CATALOG_SERVICE_API_KEY`
- `CATALOG_SERVICE_TIMEOUT_MS`
- `CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS`

No se agrega ninguna variable `NEXT_PUBLIC_*`.

## 6. Comportamiento de busqueda

La UI ejecuta busqueda con debounce de 350 ms y minimo 2 caracteres. El backend valida query no vacia, maximo 120 caracteres, limita resultados y llama a `CatalogPort.searchProducts` con `includeOutOfStock: true`.

La busqueda muestra `productId`, nombre, referencia y stock cuando el contrato lo trae. Precio no se inventa en resultados, porque el contrato local de `GET /v1/products/search` no expone precio.

## 7. Comportamiento de seleccion

Seleccionar un resultado dispara automaticamente una sola operacion logica desde el browser:

```text
GET /api/catalog/products/:productId/context
```

Internamente CRM resuelve en paralelo `getProductDetails` y SearchProducts V2 para permitir degradacion parcial si falla el bloque de recomendaciones.

## 8. Comportamiento de recomendaciones

Se muestran hasta 5 recomendaciones. Cada recomendacion incluye rank, producto, referencia, precio, stock, disponibilidad, score, commercialScore, motivo comercial y evidencia desplegable (`jointCount`, `confidence`, `lift`, `reliability`, `support`).

`recommendations: []` se trata como estado vacio exitoso, no como error.

## 9. Manejo de errores

La consola distingue:

- Catalog Service no configurado.
- Catalog Service no disponible.
- Timeout.
- Credenciales rechazadas por Catalog Service.
- Producto no encontrado.
- Respuesta de contrato invalida.
- Recomendaciones vacias.
- Fallo del recommendation engine.

Si el detalle carga pero V2 falla, la UI conserva el detalle y degrada solo el bloque de recomendaciones.

## 10. Seguridad

- `x-api-key` vive solo en adapters server-side.
- Las rutas API requieren `requireOperator`.
- `productId` se restringe a IDs numericos para evitar path injection contra el adapter V1.
- Query se normaliza y limita antes del request.
- Los errores devueltos al browser usan taxonomia local; no se reenvian headers, stack traces, bodies crudos ni secrets.

## 11. Tests

Tests agregados:

- Validacion de query sin llamada upstream.
- Busqueda sin precio inventado.
- Contexto llama V2 sin `customer`.
- Recomendaciones vacias como estado exitoso.
- Detalle visible cuando falla V2.
- Rechazo de `productId` invalido.
- Mapeo de unauthorized upstream como `502`, distinto de auth del browser.

## 12. Smoke test

Smoke real previsto:

1. Configurar `CATALOG_SERVICE_BASE_URL=http://127.0.0.1:4010` y `CATALOG_SERVICE_API_KEY`.
2. Abrir `/catalog`.
3. Buscar `banda`.
4. Seleccionar `productId=10`.
5. Ver producto fuente con precio y stock.
6. Ver recomendaciones reales, posiblemente incluyendo `9`, `8`, `11`, `1341`, `1340` segun snapshot vigente.

No se hardcodean esos productos.

Resultado en este entorno:

- `.env` tiene `CATALOG_SERVICE_BASE_URL=http://127.0.0.1:4010` y `CATALOG_SERVICE_API_KEY` configurada.
- Smoke desde `lib/catalog/consoleService.ts` con `query=banda` y `productId=10` no completo: ambas operaciones devolvieron `catalog_timeout`.
- No se imprimio la API key ni se hizo llamada browser -> Catalog Service directa.

## 13. Deuda explicita

- `GET /v1/products/search` no trae precio en el contrato local; por eso el precio aparece solo despues de seleccionar.
- La consola usa dos llamadas server-side para contexto (`detail` + V2) para soportar degradacion parcial. Si Catalog Service expone luego un endpoint de contexto completo, esta capa puede compactarse.
- No hay smoke real confirmado en este commit: el intento local contra `127.0.0.1:4010` termino en timeout.

## 14. Exclusiones de V1

- Pack builder.
- Persistencia de packs.
- Bundles.
- Escritura en PrestaShop.
- Customer Affinity.
- RFM.
- Recomendaciones por LLM.
- Administracion de Catalog Service.
- Reload de relationship snapshot.
- CRUD de productos, stock o precios.
