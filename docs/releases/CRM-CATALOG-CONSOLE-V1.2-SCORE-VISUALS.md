---
title: CRM Catalog Console V1.2 Score Visuals
doc_id: crm-catalog-console-v1-2-score-visuals
status: implemented_with_documented_debt
owner: product-engineering
updated_at: 2026-08-27
depends_on:
  - ./CRM-CATALOG-CONSOLE-V1.1-RELATIONSHIP-EXPLORER.md
  - ../architecture/adr/ADR-005-catalog-boundary.md
tags:
  - catalog
  - crm-hub
  - read-only
---

# CRM Catalog Console V1.2 Score Visuals

## 1. Objetivo

Refinar la lectura comercial de `/catalog` sin cambiar arquitectura, contratos, scoring ni el recommendation engine. La consola sigue siendo read-only y conserva la ruta:

```text
Browser
-> CRM backend/API
-> Catalog Service
```

## 2. Cambios de UI

- El panel del producto seleccionado mantiene visibles nombre, identidad, precio, stock, estado y link publico.
- La descripcion pasa a un bloque colapsable cerrado por defecto.
- Cada tarjeta de recomendacion reorganiza su columna comercial derecha con precio, stock, Commercial y Final.
- `commercialScore` ahora tiene un donut compacto SVG/CSS, sin dependencia de charting.
- `score` se mantiene visible como Final.

## 3. Descripcion colapsable

El bloque "Descripcion del producto" se renderiza solo cuando `product.description` existe. Si no hay descripcion, la consola no muestra fallback textual ni ocupa espacio extra. El componente usa `<details>` sin atributo `open`, por lo que aparece cerrado por defecto.

## 4. Visualizacion de Commercial Score

`components/catalog/CommercialScoreDonut.tsx` recibe el valor crudo y lo normaliza para presentacion. El contrato por defecto espera decimal `0..1`, que es la forma entregada por SearchProducts V2. El componente tambien soporta escala `percent` de forma explicita para reutilizacion futura.

Valores invalidos, nulos o no finitos muestran `N/D`. Valores fuera de rango se clampan a `0..100` para que el SVG no rompa layout.

## 5. Semantica de Commercial vs Final

- Commercial: puntaje comercial entregado por Catalog Service para la relacion historica/comercial.
- Final: puntaje final de ranking entregado por Catalog Service.

El CRM no recalcula ninguno de los dos y no afirma que Commercial sea probabilidad de compra.

## 6. Accesibilidad

El donut no depende solo del color:

- muestra porcentaje como texto visible;
- mantiene la etiqueta visible `Commercial`;
- expone `aria-label` con el puntaje comercial;
- usa el valor textual `N/D` cuando no hay valor representable.

## 7. Tests

Cobertura agregada en `tests/catalog/catalogConsoleUi.test.ts`:

- descripcion colapsada por defecto cuando existe;
- descripcion omitida cuando no existe;
- donut con porcentaje visible;
- normalizacion de escala percent, null/undefined y valores fuera de rango;
- card de recomendacion conserva Commercial y Final como puntajes separados;
- guard de copy para no introducir "probabilidad" en la UI de scoring.

## 8. Deudas

- Sin test visual de viewport/browser para medir altura de cards; se cubre con render server-side proporcional al stack actual.
- Sin smoke real contra Catalog Service desde este entorno en esta tarea; V1/V1.1 ya documentan timeouts operacionales previos.
- La semantica fina del peso relativo entre `commercialScore` y `score` sigue siendo autoridad de Catalog Service, no de esta consola.

## Criterio de salida

`CATALOG_CONSOLE_V1_2_COMPLETE_WITH_DOCUMENTED_DEBT`
