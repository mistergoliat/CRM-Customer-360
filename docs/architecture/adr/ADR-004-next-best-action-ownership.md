---
title: ADR-004 - Next Best Action Ownership
doc_id: adr-004-next-best-action-ownership
status: approved
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-08
source_of_truth_for:
  - next best action ownership
  - commercial planning ownership
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - adr
---
# ADR-004: Next Best Action Ownership

## Relaciones

- Gobernado por: [Autonomous Commerce PRD](../../product/autonomous-commerce-prd.md)
- Depende de: [ACTIVE_RELEASE](../../ACTIVE_RELEASE.md)
- Implementa: propiedad de la next best action en `crm_agent_actions`
- Evidencia: [CAPABILITY_MATRIX](../../CAPABILITY_MATRIX.md)
- Context pack: [ACS-R1-01.1](../../context-packs/ACS-R1-01.1.md)
- Reemplaza: none

## Estado

Accepted

## DecisiÃ³n

- `crm_agent_actions`: fuente primaria de la acciÃ³n aceptada y ejecutable.
- `crm_agent_decisions.next_action_json`: evidencia histÃ³rica de propuesta/intenciÃ³n.
- `crm_opportunities.next_action_*`: read model reconstruible.

## AIPlan y acciÃ³n principal

La IA puede proponer plan, acciÃ³n principal, alternativas, intenciones futuras y dependencias.

El Brain acepta como mÃ¡ximo una acciÃ³n principal por ciclo.

Pueden coexistir acciones secundarias:

- cotizaciÃ³n pendiente;
- follow-up futuro;
- tarea humana;
- consulta interna.

## ProyecciÃ³n mÃ­nima

```text
next_action_id
next_action_type
next_action_due_at
next_action_status
next_action_version
```

Como mÃ­nimo debe existir `next_action_id`.

## Regla de unicidad

MÃ¡ximo una acciÃ³n primaria activa por:

```text
tenant + opportunity + planning_epoch
```

## SelecciÃ³n determinÃ­stica

1. no terminal;
2. no cancelada;
3. no bloqueada permanentemente;
4. precondiciones satisfechas;
5. `is_primary = true`;
6. prioridad;
7. `due_at`;
8. `created_at`;
9. ID como desempate.

## CancelaciÃ³n, completitud, expiraciÃ³n y bloqueo

- Cancelar: cancelar acciÃ³n durable, seleccionar siguiente y reconstruir proyecciÃ³n.
- Completar: registrar outcome, marcar completed y disparar nuevo ciclo si corresponde.
- Expirar: deja de ser next action, genera outcome temporal y replanteamiento/escalamiento.
- Bloqueo temporal: puede conservarse secundaria sin impedir otra acciÃ³n ejecutable.

## Consistencia

Persistencia de acciÃ³n y proyecciÃ³n en la misma transacciÃ³n cuando sea posible.

Debe existir rebuild determinÃ­stico desde `crm_agent_actions`.

## Invariantes

1. Propuesta IA no es acciÃ³n ejecutable.
2. AcciÃ³n aceptada sÃ­ puede ser next action.
3. Oportunidad no es fuente editable.
4. Una primaria activa por planning epoch.
5. Secundarias pueden coexistir.
6. Terminal no se proyecta.
7. ProyecciÃ³n reconstruible.
8. EdiciÃ³n real en `crm_agent_actions`.

## Criterio de validaciÃ³n

- cancelar cambia proyecciÃ³n;
- rebuild reproduce proyecciÃ³n;
- vencida no sigue como next action;
- secundarias coexistentes sin duplicar principal.
