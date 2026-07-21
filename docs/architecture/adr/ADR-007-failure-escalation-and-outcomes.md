---
title: ADR-007 - Failure Escalation and Outcomes
doc_id: adr-007-failure-escalation-and-outcomes
status: approved
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-08
source_of_truth_for:
  - failure escalation
  - outcomes
  - terminal behavior
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - adr
---
# ADR-007: Failure Continuity, Escalation and Outcomes

## Relaciones

- Gobernado por: [Autonomous Commerce PRD](../../product/autonomous-commerce-prd.md)
- Depende de: [ACTIVE_RELEASE](../../ACTIVE_RELEASE.md)
- Implementa: escalamiento de fallos, outcomes y continuidad comercial
- Evidencia: [CAPABILITY_MATRIX](../../CAPABILITY_MATRIX.md)
- Context pack: [ACS-R1-01.1](../../context-packs/ACS-R1-01.1.md)
- Reemplaza: none

## Estado

Accepted

## Contexto

El sistema debe atender 24/7 y nunca dejar al cliente abandonado por fallos del modelo, proveedor, tool, output, capability, datos, polÃ­tica o intervenciÃ³n humana.

## DecisiÃ³n

Se separan fallo tÃ©cnico, restricciÃ³n, escalamiento, outcome y continuidad comercial.

## Restricciones versus fallos

Restricciones:

- unavailable;
- denied;
- requires_approval;
- missing_information;
- temporarily_blocked;
- invalid_arguments.

Producen replanteamiento o espera.

`failed` solo ocurre despuÃ©s de intentar una capability vÃ¡lida y autorizada.

## Continuidad

```text
retry limitado
â†’ proveedor/capability alternativa
â†’ mensaje seguro, cuando corresponda
â†’ escalamiento
â†’ acciÃ³n humana
```

El sistema no pierde inbound, no cierra oportunidad por fallo tÃ©cnico, no bloquea otras conversaciones, no deja caso sin owner y no promete plazos desconocidos.

## Escalation

Asigna a una entidad organizacional.

### Targets

- team;
- queue;
- role;
- user;
- external system.

### CategorÃ­as

- sales;
- customer_service;
- post_sale;
- logistics;
- finance;
- human_resources;
- technical_support;
- policy_approval;
- technical_failure;
- other.

### Modes

- exclusive_handoff;
- approval_request;
- internal_consultation;
- technical_recovery.

### Lifecycle

```text
created
assigned
accepted
in_progress
resolved
cancelled
expired
```

## Visibilidad operativa

- error recuperado: auditorÃ­a;
- error con derivaciÃ³n: visible en cola;
- falla repetida: incidente agrupado;
- falla sistÃ©mica: alerta crÃ­tica y circuit breaker.

## ActionOutcome

### TÃ©cnicos

- queued;
- sent;
- delivered;
- read;
- failed.

### Comerciales

- customer_replied;
- information_obtained;
- product_interest_confirmed;
- objection_raised;
- objection_resolved;
- quote_created;
- quote_approved;
- quote_rejected;
- quote_sent;
- checkout_started;
- order_created;
- payment_completed;
- opportunity_advanced;
- opportunity_won;
- opportunity_lost.

### Temporales

- no_response_before_deadline;
- follow_up_due;
- action_expired.

### Humanos

- handoff_accepted;
- approval_granted;
- approval_rejected;
- operator_resolved.

Cada outcome puede generar un nuevo `CommercialEvent`.

## Cuarta iteraciÃ³n

1. detener replanning;
2. usar salida segura validada;
3. informar al cliente cuando corresponda;
4. crear escalamiento;
5. mantener oportunidad activa;
6. terminar ciclo como escalated;
7. generar visibilidad.

## Invariantes

1. Toda derivaciÃ³n tiene target.
2. Todo caso derivado tiene owner o queue.
3. `failed` no equivale a abandonado.
4. Oportunidad no se marca lost por fallo tÃ©cnico.
5. Handoff exclusivo y aprobaciÃ³n puntual son distintos.
6. AcciÃ³n puede tener mÃºltiples outcomes.
7. Outcome tÃ©cnico no reemplaza comercial.
8. Falla sistÃ©mica puede deshabilitar una capability, no todo el sistema.
9. Cliente recibe continuidad sin promesas inventadas.
10. IA puede retomar cuando humano libera el caso, salvo handoff exclusivo vigente.

## Criterio de validaciÃ³n

- falla de IA deriva sin bloquear otras conversaciones;
- toda escalaciÃ³n llega a una entidad;
- operador ve motivo, intentos y contexto;
- cliente no queda sin continuidad;
- outcomes disparan el siguiente ciclo.
