---
title: CRM Catalog Console V1.1 Relationship Explorer
doc_id: crm-catalog-console-v1-1-relationship-explorer
status: implemented_with_documented_debt
owner: product-engineering
updated_at: 2026-08-21
depends_on:
  - ./CRM-CATALOG-CONSOLE-V1.md
tags:
  - catalog
  - crm-hub
  - read-only
---

# CRM Catalog Console V1.1 Relationship Explorer

## Objective

Extender `/catalog` desde una consola de detalle + recomendaciones a un explorador read-only de relaciones comerciales en dos niveles:

- producto seleccionado -> recomendaciones directas;
- recomendacion directa -> productos relacionados con esa recomendacion.

La superficie sigue siendo de inspeccion. No persiste seleccion, no crea orden, no modifica Catalog Service, no envia `customer` y no presenta recomendaciones como personalizadas.

## Architecture

El CRM reutiliza el endpoint existente de contexto:

- `GET /api/catalog/products/:productId/context?limit=5|10|20`
- backend: `getCatalogConsoleProductContextWithLimit(productId, limit)`
- upstream: `SearchProducts V2` con `sourceProduct.productId` y `limit`

El route handler valida `limit` antes de llamar al cliente V2. El cliente V2 ya valida el rango `1..20`; la UI ofrece solo `5`, `10`, `20`.

## Lazy Loading

Las recomendaciones secundarias no se precargan. Cada tarjeta de nivel 1 abre una rama "Relacionados con este producto" y recien ahi llama:

```text
/api/catalog/products/{recommendedProductId}/context?limit=5
```

El cache vive en memoria del browser y usa key `productId:limit`. Solo se cachean respuestas `ok`; errores no se cachean para permitir retry.

## Max Depth

La profundidad maxima es 2:

- nivel 1: relacion directa con el producto seleccionado;
- nivel 2: relacion directa con una recomendacion de nivel 1.

El nivel 2 renderiza hojas. No existe boton para expandir un tercer nivel. Si un producto secundario coincide con el producto padre, se marca como `Producto padre`; no se filtra ni se interpreta como ciclo invalido.

## Contracts

Campos consumidos desde SearchProducts V2:

- `recommendations[].product`
- `recommendations[].rank`
- `recommendations[].score`
- `recommendations[].commercialScore`
- `recommendations[].affinityScore`
- `recommendations[].affinityConfidence`
- `recommendations[].commercialReason.label`
- `recommendations[].relationship.type`
- `recommendations[].relationship.reliability`
- `recommendations[].relationship.evidence`
- `recommendations[].warnings`
- `excluded[]`
- `statistics`
- `execution`
- `snapshot`

El CRM no recalcula score, no reordena, no filtra productos por copy comercial y no deriva transividad entre relaciones.

## Cache

El helper `createRelatedRecommendationsCache` garantiza:

- cero prefetch antes de abrir una rama;
- request por `productId` real de la recomendacion expandida;
- segundo open con mismo `productId:limit` usa cache;
- respuesta fallida no queda cacheada;
- `clear()` disponible si una pantalla futura necesita invalidacion explicita.

## Limit Selector

El selector principal ofrece `5`, `10`, `20` y default `5`. Al cambiarlo, se mantiene el producto seleccionado y se refresca el contexto con el nuevo limite. La rama secundaria queda fija en `5`.

## Truncation

La UI distingue:

- `shownCount`: cantidad renderizada;
- `statistics.recommendationsReturned`: recomendaciones disponibles en la respuesta;
- `truncatedByLimitCount`: cantidad de `excluded[]` cuyo `code` es exactamente `RESULT_LIMIT_TRUNCATION`.

Otros codigos de `excluded[]` no cuentan como truncacion por limite.

## Evidence

La evidencia avanzada muestra:

- joint count;
- confidence;
- lift;
- support;
- reliability;
- commercial score;
- final score;
- affinity score/confidence.

Las definiciones se presentan como ayuda operacional. `reliability`, `commercialScore` y `score` se muestran como valores entregados por Catalog Service; el CRM no inventa ni documenta formulas internas.

## Metric Definitions

- `joint count`: cantidad historica observada de compras conjuntas para esta relacion.
- `confidence`: proporcion de ocurrencias del producto origen que tambien incluyeron el producto recomendado.
- `lift`: multiplicador de asociacion contra una ocurrencia esperada de base.
- `support`: peso relativo de la relacion dentro del snapshot.
- `reliability`: senal de confiabilidad entregada por el motor.
- `commercial score`: score comercial entregado por Catalog Service.
- `final score`: score/ranking final entregado por Catalog Service.

## Errors

Un error en una rama secundaria no rompe el producto padre ni otras recomendaciones. Cada rama tiene estados propios: cerrado, loading, success, empty, error y retry.

Errores de detalle del producto padre siguen degradando igual que V1: si el detalle falla pero V2 trae `sourceProduct`, la vista puede renderizar contexto parcial.

## Security

La consola sigue detras de `requireOperator`. Las llamadas de recomendacion no incluyen `customer`, `context.customerId` ni datos personales. No hay side effects ni permisos delegados al LLM.

## Tests

Cobertura agregada:

- lazy cache sin prefetch;
- expand usa `productId` y `limit`;
- segundo load usa cache;
- error no se cachea y retry recupera;
- cache separa `productId:limit`;
- max depth fijado en 2;
- limite `20` pasa a V2;
- limite invalido retorna `invalid_limit`;
- truncation count usa solo `RESULT_LIMIT_TRUNCATION`;
- otros `excluded.code` no suman truncacion;
- evidencia/scoring se mapea desde V2;
- request de contexto mantiene ausencia de `customer`.

## Smoke

Smoke real objetivo:

- parent `1427`;
- rama secundaria candidata `437`;
- timeouts locales `CATALOG_SERVICE_TIMEOUT_MS=20000` y `CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS=20000`.

Resultado en este entorno:

- `1427`, limit `10`: `catalog_timeout`;
- `437`, limit `5`: `catalog_timeout`.

El smoke llego al cliente CRM pero Catalog Service no respondio dentro del timeout configurado. Queda como deuda operacional, no como bloqueo de contrato/UI.

## Debt

- No existe calibracion visual de calidad minima; la UI muestra lo que el motor responde.
- No se expone total elegible upstream si el contrato solo entrega respuesta y exclusiones.
- No hay persistencia de ramas abiertas ni historial de exploracion.
- No hay customer personalization en esta consola por diseno.
- Smoke real pendiente por timeout de Catalog Service desde este entorno.

## Future Recommendation Calibration

Variables posibles para una tarea futura, fuera de V1.1:

- minimum joint count;
- minimum lift;
- minimum reliability;
- source candidate limit;
- final response limit;
- score weighting;
- personalization weighting.

Debe distinguirse entre `snapshot eligibility` y `response limit`: el primero define que candidatos entran al universo evaluable del snapshot; el segundo define cuantos productos se devuelven al consumidor. Cambiar cualquiera de esos valores pertenece al Catalog Service/recommendation engine, no a esta consola read-only.
