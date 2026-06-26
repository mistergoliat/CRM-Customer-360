# ADR-007: Failure Continuity, Escalation and Outcomes

## Estado

Accepted

## Contexto

El sistema debe atender 24/7 y nunca dejar al cliente abandonado por fallos del modelo, proveedor, tool, output, capability, datos, política o intervención humana.

## Decisión

Se separan fallo técnico, restricción, escalamiento, outcome y continuidad comercial.

## Restricciones versus fallos

Restricciones:

- unavailable;
- denied;
- requires_approval;
- missing_information;
- temporarily_blocked;
- invalid_arguments.

Producen replanteamiento o espera.

`failed` solo ocurre después de intentar una capability válida y autorizada.

## Continuidad

```text
retry limitado
→ proveedor/capability alternativa
→ mensaje seguro, cuando corresponda
→ escalamiento
→ acción humana
```

El sistema no pierde inbound, no cierra oportunidad por fallo técnico, no bloquea otras conversaciones, no deja caso sin owner y no promete plazos desconocidos.

## Escalation

Asigna a una entidad organizacional.

### Targets

- team;
- queue;
- role;
- user;
- external system.

### Categorías

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

- error recuperado: auditoría;
- error con derivación: visible en cola;
- falla repetida: incidente agrupado;
- falla sistémica: alerta crítica y circuit breaker.

## ActionOutcome

### Técnicos

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

## Cuarta iteración

1. detener replanning;
2. usar salida segura validada;
3. informar al cliente cuando corresponda;
4. crear escalamiento;
5. mantener oportunidad activa;
6. terminar ciclo como escalated;
7. generar visibilidad.

## Invariantes

1. Toda derivación tiene target.
2. Todo caso derivado tiene owner o queue.
3. `failed` no equivale a abandonado.
4. Oportunidad no se marca lost por fallo técnico.
5. Handoff exclusivo y aprobación puntual son distintos.
6. Acción puede tener múltiples outcomes.
7. Outcome técnico no reemplaza comercial.
8. Falla sistémica puede deshabilitar una capability, no todo el sistema.
9. Cliente recibe continuidad sin promesas inventadas.
10. IA puede retomar cuando humano libera el caso, salvo handoff exclusivo vigente.

## Criterio de validación

- falla de IA deriva sin bloquear otras conversaciones;
- toda escalación llega a una entidad;
- operador ve motivo, intentos y contexto;
- cliente no queda sin continuidad;
- outcomes disparan el siguiente ciclo.
