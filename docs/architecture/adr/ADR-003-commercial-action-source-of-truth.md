---
title: ADR-003 - Commercial Action Source of Truth
doc_id: adr-003-commercial-action-source-of-truth
status: approved
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-08
source_of_truth_for:
  - commercial action source of truth
  - CRM action semantics
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - adr
---
# ADR-003: Commercial Action Source of Truth

## Relaciones

- Gobernado por: [Autonomous Commerce PRD](../../product/autonomous-commerce-prd.md)
- Depende de: [ACTIVE_RELEASE](../../ACTIVE_RELEASE.md)
- Implementa: `crm_agent_actions` como fuente de la accion comercial aceptada
- Evidencia: [CAPABILITY_MATRIX](../../CAPABILITY_MATRIX.md)
- Context pack: [ACS-R1-01.1](../../context-packs/ACS-R1-01.1.md)
- Reemplaza: none

## Estado

Accepted

## Contexto

El sistema distingue plan, propuesta, decisiÃ³n aceptada, acciÃ³n durable, intento tÃ©cnico y outcome.

## DecisiÃ³n

`crm_agent_actions` representa Ãºnicamente acciones comerciales aceptadas.

```text
AIProposal
â†’ CapabilityEvaluation
â†’ AcceptedCommercialDecision
â†’ CommercialAction
â†’ ActionExecution
â†’ ActionOutcome
```

Una propuesta rechazada no crea acciÃ³n.

## Tipos de acciÃ³n

- interna;
- contacto con cliente;
- tarea humana;
- aprobaciÃ³n;
- documento comercial;
- operaciÃ³n de canal.

## Lifecycle canÃ³nico

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

### Transiciones vÃ¡lidas

```text
proposed â†’ awaiting_approval | scheduled | ready | cancelled
awaiting_approval â†’ scheduled | ready | cancelled | expired
scheduled â†’ ready | cancelled | expired | blocked
ready â†’ executing | cancelled | blocked | expired
executing â†’ completed | failed | blocked
failed â†’ scheduled | ready | cancelled
blocked â†’ scheduled | ready | cancelled | expired
```

Terminales: `completed`, `cancelled`, `expired`.

## AcciÃ³n, ejecuciÃ³n, outbox y outcome

```text
CommercialAction 1 â†’ 0..N ActionExecutions
CommercialAction 1 â†’ 0..N OutboxItems
CommercialAction 1 â†’ 0..N ActionOutcomes
```

Un retry crea otra ejecuciÃ³n, no otra acciÃ³n.

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

`wait_for_customer`, `do_nothing` o `continue_observing` solo crean acciÃ³n si hay fecha, condiciÃ³n de despertar, timeout, responsabilidad o consecuencia posterior.

## Cotizaciones

```text
draft
â†’ pending_approval
â†’ approved
â†’ sent
```

La IA prepara; backend valida; humano aprueba inicialmente; sistema envÃ­a. Una modificaciÃ³n material crea nueva versiÃ³n.

## Disponibilidad versus reserva

El sistema consulta y comunica disponibilidad verificada. No reserva stock ni modifica inventario.

## Invariantes

1. Solo decisiÃ³n aceptada crea acciÃ³n.
2. Propuesta rechazada no crea acciÃ³n.
3. Retry tÃ©cnico no duplica acciÃ³n.
4. Outbox no es fuente comercial.
5. AprobaciÃ³n y ejecuciÃ³n son estados distintos.
6. CotizaciÃ³n no aprobada no se envÃ­a.
7. AcciÃ³n puede tener mÃºltiples outcomes.
8. UI de acciones se reconstruye desde `crm_agent_actions`.
9. AceptaciÃ³n del proveedor impide segundo efecto.
10. Reservas de stock quedan fuera de alcance.

## Criterio de validaciÃ³n

- acciÃ³n sin envÃ­o posible;
- retry sin nueva acciÃ³n;
- cotizaciÃ³n no aprobada no enviada;
- acciÃ³n terminal no ejecutada;
- mÃºltiples outcomes por acciÃ³n.
