---
title: 00-START-HERE
doc_id: product-start-here
status: active
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
source_of_truth_for:
  - vault entry point
  - documentation navigation
  - reading order
depends_on:
  - ../AGENTS.md
  - ../CLAUDE.md
  - ./ACTIVE_RELEASE.md
  - ./releases/README.md
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

1. `AGENTS.md` o `CLAUDE.md` de la raiz.
2. `docs/00-START-HERE.md`.
3. `docs/ACTIVE_RELEASE.md`.
4. La release activa.
5. Los ADR y contratos relacionados.
6. `docs/CAPABILITY_MATRIX.md`.

## Documentos canonicos

- `AGENTS.md` y `CLAUDE.md`: reglas normativas de trabajo.
- `docs/00-START-HERE.md`: entrada documental y orden de lectura.
- `docs/ACTIVE_RELEASE.md`: tablero operativo de la release activa.
- `docs/releases/ACS-R1-04-customer-identity-onboarding.md`: release activa.
- `docs/releases/README.md`: indice de releases.
- `docs/ROADMAP.md`: secuencia resumida de releases.
- `docs/CAPABILITY_MATRIX.md`: estado tecnico real de capacidades.
- `docs/architecture/adr/*.md`: decisiones arquitectonicas.
- `docs/capabilities/*.md`: contratos de capabilities.
- `docs/data/*.md`: contratos de datos.

## Documentos historicos

- `docs/audits/*.md`: snapshots historicos inmutables.
- `docs/product/autonomous-commerce-current-state.md`: snapshot historico del estado.
- `docs/product/autonomous-commerce-capability-map.md`: mapa historico de capacidades.
- `docs/verification/*.md`: evidencia historica o de verificacion.

## Documentos actualizables

- `docs/ACTIVE_RELEASE.md`.
- `docs/releases/ACS-R1-04-customer-identity-onboarding.md`.
- `docs/releases/README.md`.
- `docs/ROADMAP.md`.
- `docs/CAPABILITY_MATRIX.md`.
- `AGENTS.md` y `CLAUDE.md` cuando cambie el flujo obligatorio.

## Regla de uso

- La release activa manda sobre la planificacion.
- La roadmap resume la secuencia.
- La capability matrix describe el estado tecnico real.
- Las auditorias historicas no se usan como fuente normativa.
