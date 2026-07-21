---
title: Backend Capability Map
doc_id: backend-capability-map
status: historical
superseded_by: docs/CAPABILITY_MATRIX.md
version: "1.1.0"
owner: architecture
last_reviewed: 2026-07-21
source_of_truth_for: []
depends_on: []
supersedes: []
tags:
  - historical
---

# Backend Capability Map

> **HISTORICAL (2026-07-21).** Snapshot de modulos del HUB en P1M. Declara `opportunities`/`actions` como `fixture`, pero ambos son hoy tablas reales con escritura gobernada (`crm_opportunities`, `crm_agent_actions`) segun `docs/CAPABILITY_MATRIX.md`, que es la fuente de verdad vigente del estado tecnico real. Este documento describe el estado de la UI del HUB en un momento pasado, no el dominio comercial actual.

| Module | Capability | Source | Adapter | Mode | Status |
| ------ | ---------- | ------ | ------- | ---- | ------ |
| dashboard | Health and modular runtime overview | `getSystemCapabilities()` | runtime registry | `partial` | active |
| conversations | Inbox and detail timeline | `n8n_vw_hub_cases`, `n8n_conversation_messages`, `n8n_wa_inbound_messages` | `legacy-n8n/conversation-repository` | `real` | active |
| cases | Case list and timeline | `n8n_vw_hub_cases` | `legacy-n8n/case-repository` | `real` | active |
| customers | Canonical customer list/detail/create with `platform_origin` | `master_customer` | `customer-master/customer-repository` | `real` | active |
| opportunities | Read-only fixture projection | fixture | p1m fixtures | `fixture` | active |
| actions | Read-only partial projection | fixture + legacy view models | p1m fixtures | `partial` | active |
| marketing | Read-only fixture projection | fixture | p1m fixtures | `fixture` | active |
| knowledge | Read-only fixture projection | fixture | p1m fixtures | `fixture` | active |
| analytics | Mixed metrics | real + fixture | p1m fixtures + runtime metrics | `partial` | active |
| integrations | Runtime health and connected sources | `hub_audit_log`, DB health, n8n health | runtime registry | `partial` | active |

## Notes

- No second identity system was created.
- `master_customer` is treated as canonical for Customer CRUD.
- `platform_origin` is treated as account provenance, not identity.
- n8n remains the legacy backend for conversation/case continuity.
