---
title: 00-START-HERE
doc_id: product-start-here
status: active
version: "2.0.0"
owner: product
last_reviewed: 2026-07-09
source_of_truth_for:
  - vault entry point
  - documentation navigation
  - reading order
depends_on:
  - ../AGENTS.md
  - ../CLAUDE.md
  - ./product/MVP_EXECUTION_MAP.md
  - ./ROADMAP.md
  - ./ACTIVE_RELEASE.md
  - ./CAPABILITY_MATRIX.md
supersedes: []
tags:
  - product
  - release
  - adr
  - capability
  - data-contract
  - audit
  - verification
  - non-normative
---

# 00-START-HERE

Este es el punto de entrada de la vault documental.

## Orden obligatorio de lectura

1. `AGENTS.md`.
2. `docs/00-START-HERE.md`.
3. `docs/product/autonomous-commerce-prd.md`.
4. `docs/ROADMAP.md`.
5. `docs/ACTIVE_RELEASE.md`.
6. La especificacion de la release activa.
7. `docs/product/MVP_EXECUTION_MAP.md`.
8. Los ADR citados por la release o tarea.
9. Los contratos citados por la tarea.
10. `docs/CAPABILITY_MATRIX.md`.

## Documentos canonicos

- `AGENTS.md` y `CLAUDE.md`: reglas generales de agente.
- `docs/product/autonomous-commerce-prd.md`: vision, problema, alcance y limites del producto.
- `docs/ROADMAP.md`: unica secuencia normativa de releases ACS.
- `docs/ACTIVE_RELEASE.md`: puntero operativo de la release activa.
- `docs/releases/ACS-R1-04-customer-identity-onboarding.md`: especificacion de la release activa.
- `docs/product/MVP_EXECUTION_MAP.md`: workstreams, ownership, dependencias y paralelizacion.
- `docs/CAPABILITY_MATRIX.md`: estado tecnico real de capacidades.
- `docs/architecture/adr/*.md`: decisiones arquitectonicas.
- `docs/capabilities/*.md`: contratos de capabilities.
- `docs/data/*.md`: contratos de datos.
- `docs/integrations/*.md`: contratos de transporte e integracion.

## Documentos historicos

- `docs/audits/*.md`: evidencia historica inmutable.
- `docs/product/autonomous-commerce-current-state.md`: snapshot historico del estado.
- `docs/product/autonomous-commerce-capability-map.md`: snapshot historico de capacidades.
- `docs/product/autonomous-commerce-roadmap.md`: snapshot historico de la secuencia previa.
- `docs/product/mvp-roadmap.md`: snapshot historico de labels P1/P2/P3.
- `docs/verification/*.md`: evidencia historica o de verificacion.

## Regla de uso

- La release activa manda sobre la ejecucion.
- El roadmap resume la secuencia ACS.
- El MVP execution map describe paralelizacion y ownership.
- La capability matrix describe el estado tecnico real.
- Las auditorias historicas no se usan como fuente normativa.
- P1/P2/P3 son etiquetas historicas y no gobiernan ejecucion.
