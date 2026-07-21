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
- `docs/archive/autonomous-commerce-current-state.md`: snapshot historico del estado.
- `docs/archive/autonomous-commerce-capability-map.md`: snapshot historico de capacidades.
- `docs/archive/autonomous-commerce-roadmap.md`: snapshot historico de la secuencia previa.
- `docs/archive/mvp-roadmap.md`: snapshot historico de labels P1/P2/P3.
- `docs/archive/agent-capability-matrix.md`: snapshot historico de reparto multi-agente por departamento (`superseded_by: docs/product/MVP_EXECUTION_MAP.md`).
- `docs/archive/backend-capability-map.md`: snapshot historico de modulos UI P1M.
- `docs/verification/*.md`: evidencia historica o de verificacion.
- `docs/data/persistence-architecture-decision.md`: decision de persistencia (PostgreSQL/Supabase para el brain) nunca ejecutada; la realidad es MariaDB, ver `docs/CAPABILITY_MATRIX.md`.
- `docs/legacy/ai-orchestration-contract.md`, `docs/legacy/n8n-shadow-mode-integration.md`: contrato de envelope JSON monolitico y su guia de integracion, sin evidencia de uso en ninguna release ACS.
- `docs/legacy/brain-action-policy.md`, `docs/legacy/brain-agent-runtime.md`, `docs/legacy/brain-api-foundation.md`: router deterministico de policy y registro multi-agente por departamento (P1D/P1F), reemplazados por el Sales Agent + Capability Gateway.
- `docs/legacy/`: diseños abandonados con evidencia historica unica (Postgres/Supabase, orquestador P1C, identidad P1J/PR-43). `docs/archive/`: snapshots y milestones cerrados sin autoridad (roadmaps previos, capability maps previos, reportes de aceptacion). Ninguno de los dos directorios es fuente normativa ni forma parte de la lectura obligatoria - ver `AGENTS.md`.
- Familia de identidad P1J/PR-43 (superseded, en `docs/legacy/`, ver `superseded_by` de cada uno): `customer-identity-contract.md`, `customer-identity-source-mapping.md`, `customer-identity-spec.md`, `customer-identity-validation.md`, `architecture-customer-identity-onboarding.md`, `product-customer-identity-onboarding.md` - todos reemplazados por `docs/data/customer-onboarding-identity-contract.md` y `docs/data/customer-creation-linking-authority-contract.md`.
- Familia P1K descubierta por el gate de `docs/documentation-consolidation` (historical/dev-only, ver `superseded_by` de cada uno, todos en `docs/archive/`): `ai-sdr-action-queue-ui.md`, `ai-sdr-operator-pilot.md`, `backlog.md`, `agentic-crm-data-model-audit.md`, `ai-sdr-operating-model.md`, `ai-sdr-operational-loop.md`, `ai-sdr-execution-gate.md`, `ai-sdr-autonomous-commercial-loop.md`, `ai-sdr-autonomy-sandbox.md`, `ai-sdr-implementation-blueprint.md`, `autonomous-commerce-integration-handoff.md`, `p1k-final-acceptance-report.md`.

Esta lista deja de ser exhaustiva a partir de aqui: el frontmatter de cada documento (`status`, `superseded_by`) es la fuente de verdad real; `npm run docs:validate` reporta cualquier `status` fuera del vocabulario de 8 estados como warning legacy, sea o no que este indice lo mencione.

## Regla de uso

- `docs/PRODUCT_NORTH_STAR.md` manda sobre la interpretacion de la vision; el PRD la extiende, no la reemplaza.
- La release activa manda sobre la ejecucion.
- El roadmap resume la secuencia ACS.
- El MVP execution map describe paralelizacion y ownership, y solo se lee cuando la tarea lo requiere.
- La capability matrix describe el estado tecnico real.
- Las auditorias historicas no se usan como fuente normativa.
- `docs/legacy/` y `docs/archive/` quedan fuera de la lectura normal y de la autoridad documental: no citar un documento de esos directorios como base para una decision de arquitectura nueva, solo como evidencia historica puntual.
- Un documento `approved`/`accepted` en su frontmatter no es automaticamente vigente: verificar contra `docs/CAPABILITY_MATRIX.md` y la evidencia real antes de confiar en el.
- P1/P2/P3 son etiquetas historicas y no gobiernan ejecucion.
