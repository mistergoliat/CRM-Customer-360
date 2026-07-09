---
title: Context packs
doc_id: context-pack-index
status: active
version: "1.0.0"
owner: product
last_reviewed: 2026-07-08
source_of_truth_for:
  - context pack registry
  - agent reading packs
depends_on:
  - ../ACTIVE_RELEASE.md
supersedes: []
tags:
  - context-pack
  - product
---

# Context packs

Indice de packs de contexto. No duplica specs ni auditorias; solo define que debe leerse antes de modificar cada incremento.

| Context pack | Incremento | Objetivo | Estado |
|---|---|---|---|
| [ACS-R1-01.1](ACS-R1-01.1.md) | `ACS-R1-01.1-capability-gateway-hardening` | Harden del capability gateway y catalog boundary | active |
| [ACS-R1-03](ACS-R1-03.md) | `ACS-R1-03-customer-360` | Customer 360 read model y preparacion de acceptance | implemented_pending_acceptance |

## Regla operativa

Antes de modificar un incremento, el agente debe resolver el pack correspondiente y leer los documentos obligatorios en el orden declarado por ese pack.
