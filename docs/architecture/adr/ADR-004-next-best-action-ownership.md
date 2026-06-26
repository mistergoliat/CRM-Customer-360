# ADR-004: Next Best Action Ownership

## Estado

Accepted

## Decisión

- `crm_agent_actions`: fuente primaria de la acción aceptada y ejecutable.
- `crm_agent_decisions.next_action_json`: evidencia histórica de propuesta/intención.
- `crm_opportunities.next_action_*`: read model reconstruible.

## AIPlan y acción principal

La IA puede proponer plan, acción principal, alternativas, intenciones futuras y dependencias.

El Brain acepta como máximo una acción principal por ciclo.

Pueden coexistir acciones secundarias:

- cotización pendiente;
- follow-up futuro;
- tarea humana;
- consulta interna.

## Proyección mínima

```text
next_action_id
next_action_type
next_action_due_at
next_action_status
next_action_version
```

Como mínimo debe existir `next_action_id`.

## Regla de unicidad

Máximo una acción primaria activa por:

```text
tenant + opportunity + planning_epoch
```

## Selección determinística

1. no terminal;
2. no cancelada;
3. no bloqueada permanentemente;
4. precondiciones satisfechas;
5. `is_primary = true`;
6. prioridad;
7. `due_at`;
8. `created_at`;
9. ID como desempate.

## Cancelación, completitud, expiración y bloqueo

- Cancelar: cancelar acción durable, seleccionar siguiente y reconstruir proyección.
- Completar: registrar outcome, marcar completed y disparar nuevo ciclo si corresponde.
- Expirar: deja de ser next action, genera outcome temporal y replanteamiento/escalamiento.
- Bloqueo temporal: puede conservarse secundaria sin impedir otra acción ejecutable.

## Consistencia

Persistencia de acción y proyección en la misma transacción cuando sea posible.

Debe existir rebuild determinístico desde `crm_agent_actions`.

## Invariantes

1. Propuesta IA no es acción ejecutable.
2. Acción aceptada sí puede ser next action.
3. Oportunidad no es fuente editable.
4. Una primaria activa por planning epoch.
5. Secundarias pueden coexistir.
6. Terminal no se proyecta.
7. Proyección reconstruible.
8. Edición real en `crm_agent_actions`.

## Criterio de validación

- cancelar cambia proyección;
- rebuild reproduce proyección;
- vencida no sigue como next action;
- secundarias coexistentes sin duplicar principal.
