---
title: CRM Catalog Console V1.2.1 Secondary Commercial Donut
doc_id: crm-catalog-console-v1-2-1-secondary-commercial-donut
status: implemented_with_documented_debt
owner: product-engineering
updated_at: 2026-08-27
depends_on:
  - ./CRM-CATALOG-CONSOLE-V1.2-SCORE-VISUALS.md
tags:
  - catalog
  - crm-hub
  - read-only
---

# CRM Catalog Console V1.2.1 Secondary Commercial Donut

## 1. Objetivo

Completar la consistencia visual de `/catalog` para que las recomendaciones secundarias dentro de "Relacionados con este producto" muestren la misma lectura comercial compacta que el nivel 1: precio, stock, Commercial y Final.

## 2. Problema Detectado

V1.2 agrego el donut de `commercialScore` en las tarjetas de recomendacion de primer nivel, pero el nivel 2 conservaba una columna parcial con precio, stock y Final. Esa diferencia hacia mas lenta la comparacion de fuerza comercial entre relaciones directas y relaciones secundarias.

## 3. Cambio Aplicado

Se extrajo `RecommendationCommercialSummary` como subcomponente compartido para renderizar:

- precio;
- stock;
- donut `Commercial` desde `commercialScore`;
- `Final` desde `score`.

`RecommendationCard` usa el resumen compartido para nivel 1. `RelatedRecommendations` usa el mismo resumen en cada item secundario, con variante compacta de texto para mantener la card legible.

## 4. Consistencia Entre Nivel 1 y Nivel 2

Ambos niveles conservan la misma semantica:

- Commercial = `commercialScore`;
- Final = `score`.

El cambio no modifica lazy loading, cache de segundo nivel, selector de limite, backend, contratos ni scoring. El CRM sigue mostrando valores entregados por Catalog Service sin recalcularlos.

## 5. Componentes Modificados

- `components/catalog/RecommendationCommercialSummary.tsx`: nuevo resumen comercial reutilizable.
- `components/catalog/RecommendationCard.tsx`: reemplaza la columna inline por el resumen compartido.
- `components/catalog/RelatedRecommendations.tsx`: extrae `RelatedRecommendationItem` y usa el resumen compartido en nivel 2.
- `tests/catalog/catalogConsoleUi.test.ts`: agrega cobertura de mapping compartido, donut secundario, Final secundario y fallback `N/D`.

## 6. Tests

Cobertura agregada o extendida:

- resumen compartido renderiza precio, stock, Commercial y Final;
- item secundario renderiza donut Commercial;
- item secundario conserva Final;
- Commercial y Final no se reemplazan entre si;
- fallback `N/D` se mantiene en nivel 2 cuando `commercialScore` no es representable.

## 7. Deuda Restante

- Sin prueba visual de viewport/browser para medir densidad real del nivel 2; el stack actual queda cubierto con render server-side proporcional.
- Sin smoke real contra Catalog Service en esta tarea; no aplica porque no se tocaron backend ni contratos.

## Criterio de Salida

`CATALOG_CONSOLE_V1_2_1_COMPLETE_WITH_DOCUMENTED_DEBT`
