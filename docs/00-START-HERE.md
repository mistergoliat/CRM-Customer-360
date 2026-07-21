---
title: 00-START-HERE
doc_id: product-start-here
status: active
version: "3.0.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for:
  - vault entry point
  - documentation navigation
  - reading order
  - documentation state vocabulary
depends_on:
  - ../AGENTS.md
  - ../CLAUDE.md
  - ./PRODUCT_NORTH_STAR.md
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

## Lectura obligatoria

No leas todo el arbol en cada tarea. Lee lo que gobierna la tarea actual.

### Siempre

1. `AGENTS.md`.
2. `docs/PRODUCT_NORTH_STAR.md`.
3. `docs/ACTIVE_RELEASE.md`.

### Segun la tarea

- La especificacion de la release activa (referenciada desde `docs/ACTIVE_RELEASE.md`) - casi siempre necesaria si la tarea implementa o cierra trabajo de una release.
- `docs/ROADMAP.md` - si la tarea toca secuenciacion de releases o una dependencia externa en pausa.
- Los ADR y los contratos citados por la release spec o por la tarea - nunca el vault completo de contratos.
- `docs/CAPABILITY_MATRIX.md` - si la tarea cambia el estado tecnico real de una capability.
- `docs/product/MVP_EXECUTION_MAP.md` - solo si la tarea afecta ownership, dependencias entre workstreams o paralelizacion. No es lectura obligatoria para una tarea que no toca eso.
- `docs/product/autonomous-commerce-prd.md` - solo si la tarea cambia alcance o comportamiento de producto. `docs/PRODUCT_NORTH_STAR.md` ya cubre la vision condensada para el resto de las tareas.

Esta seccion reemplaza la lista fija anterior ("leer siempre PRD + ROADMAP + ACTIVE_RELEASE + MVP_EXECUTION_MAP + CAPABILITY_MATRIX + ADR + contratos"), que consumia contexto innecesario en tareas pequenas. El principio no cambia: cada agente lee lo que gobierna su tarea, no el vault completo.

## Estados documentales

Vocabulario unico. No usar categorias ambiguas ni mezclar dos estados en el mismo documento - si un documento tiene secciones vigentes y secciones historicas a la vez, debe dividirse.

| Estado | Significado |
| --- | --- |
| `canonical` | Fuente vigente de autoridad. |
| `active` | Documento operativo actualmente en uso. |
| `supporting` | Contexto util, no normativo. |
| `release-specific` | Valido dentro del alcance de una release. |
| `historical` | Evidencia del pasado, no normativa. |
| `superseded` | Reemplazado explicitamente; declara `superseded_by`. |
| `deprecated` | Aun referenciado en algun punto, pero debe dejar de usarse. |
| `dev-only` | Simulacion o herramienta interna, nunca arquitectura productiva. |

Un documento `superseded` o legacy P1/P2/P3 debe declarar `superseded_by` apuntando a un archivo real (`npm run docs:validate` lo exige para los snapshots P1/P2/P3 y es la convencion esperada para el resto).

Este vocabulario gobierna los documentos creados o migrados a partir de `docs/documentation-authority-cleanup` (2026-07-21) en adelante. La mayoria de los documentos del repositorio (ADR con `status: approved`, release specs con su propio vocabulario de lifecycle en `docs/ROADMAP.md`, contratos con `status: active`/`non-normative`, etc.) todavia usa vocabularios anteriores y no ha sido migrada. `npm run docs:validate` reporta esos valores como warnings informativos, no como errores - la reconciliacion completa es alcance de `docs/documentation-consolidation`, no de este documento. No leer esta seccion como si la migracion ya hubiera terminado.

## Documentos canonicos

- `AGENTS.md` y `CLAUDE.md`: reglas generales de agente.
- `docs/PRODUCT_NORTH_STAR.md`: vision condensada, modelo del AI Sales Agent, anti-patrones, criterio de alineamiento.
- `docs/product/autonomous-commerce-prd.md`: vision extendida, problema, alcance y limites del producto.
- `docs/ROADMAP.md`: unica secuencia normativa de releases ACS.
- `docs/ACTIVE_RELEASE.md`: puntero operativo de la release activa.
- `docs/releases/ACS-R1-04-customer-identity-onboarding.md`: especificacion de la release activa.
- `docs/product/MVP_EXECUTION_MAP.md`: workstreams, ownership, dependencias y paralelizacion (lectura condicional, ver arriba).
- `docs/CAPABILITY_MATRIX.md`: estado tecnico real de capacidades.
- `docs/architecture/adr/*.md`: decisiones arquitectonicas.
- `docs/capabilities/*.md`: contratos de capabilities.
- `docs/data/*.md`: contratos de datos (excepto los marcados `superseded` individualmente, ver abajo).
- `docs/integrations/*.md`: contratos de transporte e integracion.

## Documentos historicos, superseded o dev-only

No usar estos documentos como referencia de arquitectura vigente. Cada uno declara su propio `superseded_by` en su frontmatter.

- `docs/audits/*.md`: evidencia historica inmutable.
- `docs/product/autonomous-commerce-current-state.md`: snapshot historico del estado.
- `docs/product/autonomous-commerce-capability-map.md`: snapshot historico de capacidades.
- `docs/product/autonomous-commerce-roadmap.md`: snapshot historico de la secuencia previa.
- `docs/product/mvp-roadmap.md`: snapshot historico de labels P1/P2/P3.
- `docs/product/agent-capability-matrix.md`: snapshot historico de reparto multi-agente por departamento (`superseded_by: docs/product/MVP_EXECUTION_MAP.md`).
- `docs/verification/*.md`: evidencia historica o de verificacion.
- `docs/data/persistence-architecture-decision.md`: decision de persistencia (PostgreSQL/Supabase para el brain) nunca ejecutada; la realidad es MariaDB, ver `docs/CAPABILITY_MATRIX.md`.
- `docs/ai-orchestration-contract.md`, `docs/n8n-shadow-mode-integration.md`: contrato de envelope JSON monolitico y su guia de integracion, sin evidencia de uso en ninguna release ACS.
- `docs/brain-action-policy.md`, `docs/brain-agent-runtime.md`, `docs/brain-api-foundation.md`: router deterministico de policy y registro multi-agente por departamento (P1D/P1F), reemplazados por el Sales Agent + Capability Gateway.
- `docs/product/ai-sdr-execution-gate.md`, `docs/product/ai-sdr-operational-loop.md`: milestones P1K con listas de action types y semantica de ejecucion desactualizadas frente a `docs/CAPABILITY_MATRIX.md`.
- `docs/product/ai-sdr-autonomous-commercial-loop.md`: simulador in-memory de desarrollo (`dev-only`), nunca runtime productivo.

## Regla de uso

- `docs/PRODUCT_NORTH_STAR.md` manda sobre la interpretacion de la vision; el PRD la extiende, no la reemplaza.
- La release activa manda sobre la ejecucion.
- El roadmap resume la secuencia ACS.
- El MVP execution map describe paralelizacion y ownership, y solo se lee cuando la tarea lo requiere.
- La capability matrix describe el estado tecnico real.
- Las auditorias historicas no se usan como fuente normativa.
- Un documento `approved`/`accepted` en su frontmatter no es automaticamente vigente: verificar contra `docs/CAPABILITY_MATRIX.md` y la evidencia real antes de confiar en el.
- P1/P2/P3 son etiquetas historicas y no gobiernan ejecucion.
