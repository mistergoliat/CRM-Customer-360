# ADR-003: Commercial Action Source of Truth

## Estado

Accepted

## Contexto

El sistema distingue plan, propuesta, decisión aceptada, acción durable, intento técnico y outcome.

## Decisión

`crm_agent_actions` representa únicamente acciones comerciales aceptadas.

```text
AIProposal
→ CapabilityEvaluation
→ AcceptedCommercialDecision
→ CommercialAction
→ ActionExecution
→ ActionOutcome
```

Una propuesta rechazada no crea acción.

## Tipos de acción

- interna;
- contacto con cliente;
- tarea humana;
- aprobación;
- documento comercial;
- operación de canal.

## Lifecycle canónico

```text
proposed
awaiting_approval
scheduled
ready
executing
completed
cancelled
expired
blocked
failed
```

### Transiciones válidas

```text
proposed → awaiting_approval | scheduled | ready | cancelled
awaiting_approval → scheduled | ready | cancelled | expired
scheduled → ready | cancelled | expired | blocked
ready → executing | cancelled | blocked | expired
executing → completed | failed | blocked
failed → scheduled | ready | cancelled
blocked → scheduled | ready | cancelled | expired
```

Terminales: `completed`, `cancelled`, `expired`.

## Acción, ejecución, outbox y outcome

```text
CommercialAction 1 → 0..N ActionExecutions
CommercialAction 1 → 0..N OutboxItems
CommercialAction 1 → 0..N ActionOutcomes
```

Un retry crea otra ejecución, no otra acción.

`brain_message_outbox` es transporte, no verdad comercial.

## Idempotencia

Scope recomendado:

```text
tenant
+ opportunity
+ action_type
+ logical_purpose
+ planning_epoch
```

La clave la genera dominio/command handler, no el proveedor.

## Acciones no durables

`wait_for_customer`, `do_nothing` o `continue_observing` solo crean acción si hay fecha, condición de despertar, timeout, responsabilidad o consecuencia posterior.

## Cotizaciones

```text
draft
→ pending_approval
→ approved
→ sent
```

La IA prepara; backend valida; humano aprueba inicialmente; sistema envía. Una modificación material crea nueva versión.

## Disponibilidad versus reserva

El sistema consulta y comunica disponibilidad verificada. No reserva stock ni modifica inventario.

## Invariantes

1. Solo decisión aceptada crea acción.
2. Propuesta rechazada no crea acción.
3. Retry técnico no duplica acción.
4. Outbox no es fuente comercial.
5. Aprobación y ejecución son estados distintos.
6. Cotización no aprobada no se envía.
7. Acción puede tener múltiples outcomes.
8. UI de acciones se reconstruye desde `crm_agent_actions`.
9. Aceptación del proveedor impide segundo efecto.
10. Reservas de stock quedan fuera de alcance.

## Criterio de validación

- acción sin envío posible;
- retry sin nueva acción;
- cotización no aprobada no enviada;
- acción terminal no ejecutada;
- múltiples outcomes por acción.
