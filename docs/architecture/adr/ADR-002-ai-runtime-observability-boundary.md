---
title: ADR-002 - AI Runtime Observability Boundary
doc_id: adr-002-ai-runtime-observability-boundary
status: approved
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-08
source_of_truth_for:
  - AI runtime observability
  - technical execution boundary
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - adr
---
# ADR-002: AI Runtime and Observability Boundary

## Relaciones

- Gobernado por: [Autonomous Commerce PRD](../../product/autonomous-commerce-prd.md)
- Depende de: [ACTIVE_RELEASE](../../ACTIVE_RELEASE.md)
- Implementa: frontera entre runtime tecnico y observabilidad de IA
- Evidencia: [CAPABILITY_MATRIX](../../CAPABILITY_MATRIX.md)
- Context pack: [ACS-R1-01.1](../../context-packs/ACS-R1-01.1.md)
- Reemplaza: none

## Estado

Accepted

## Contexto

Las tablas `ai_*` deben registrar trazabilidad, diagnÃ³stico, reanudaciÃ³n tÃ©cnica y deliberaciÃ³n de IA sin convertirse en una segunda verdad comercial.

La memoria comercial durable pertenece a `crm_*`, `conversation`, `conversation_message` y `master_customer`.

## Problema

Sin frontera estricta, `ai_*` puede transformarse en:

- segunda mÃ¡quina de estados;
- memoria paralela del cliente;
- fuente duplicada de oportunidades;
- cola de acciones no gobernada.

## DecisiÃ³n

`ai_*` es runtime tÃ©cnico y observabilidad. No controla el negocio.

### `ai_agent_execution`

Registra modelo, proveedor, inicio, tÃ©rmino, estado, latencia, tokens, errores, schema version, correlation ID y commercial cycle ID.

### `ai_agent_decision`

Registra propuestas u outputs estructurados del modelo, no decisiones comerciales aceptadas.

### `ai_tool_execution`

Registra:

```text
requested
â†’ validated
â†’ authorized
â†’ executing
â†’ succeeded | failed | timed_out | rejected
```

Debe distinguir solicitud, autorizaciÃ³n y ejecuciÃ³n.

### `ai_conversation_state`

Solo puede ser checkpoint tÃ©cnico temporal:

- iteraciÃ³n actual;
- propuesta pendiente;
- tool pendiente;
- restricciÃ³n recibida;
- retry;
- replanteamiento;
- cursor de ejecuciÃ³n.

No puede contener como verdad:

- etapa de oportunidad;
- perfil de necesidad;
- objeciones durables;
- next best action;
- ownership;
- handoff;
- consentimiento;
- historial comercial;
- precio o disponibilidad;
- acciones pendientes.

La direcciÃ³n futura recomendada es renombrarlo conceptualmente a `ai_execution_checkpoint`.

## Control de solicitudes

```text
Capability Gateway
â†’ Policy Validation
â†’ Domain Validation
â†’ Command Execution
```

`ai_*` registra el proceso; no autoriza por sÃ­ mismo.

## Estados de evaluaciÃ³n

- `available`
- `unavailable`
- `denied`
- `requires_approval`
- `missing_information`
- `temporarily_blocked`
- `invalid_arguments`
- `failed`

Solo `failed` representa error tÃ©cnico posterior a una capability vÃ¡lida y autorizada.

## Invariantes

1. El core comercial opera sin leer `ai_*`.
2. `ai_conversation_state` es reconstruible o prescindible.
3. NingÃºn campo `ai_*` reemplaza una entidad CRM.
4. Toda ejecuciÃ³n se correlaciona con ciclo y evento.
5. Prompts y outputs respetan privacidad y retenciÃ³n.
6. No se almacenan credenciales.
7. La retenciÃ³n es configurable.
8. El simulador no es owner arquitectÃ³nico.
9. El owner es `AI Runtime / Observability`.
10. Una tool rechazada no se registra como ejecutada.

## Continuidad ante fallos

```text
fallo tÃ©cnico
â†’ retry limitado
â†’ alternativa disponible
â†’ escalamiento
```

El fallo no bloquea otras conversaciones, no borra el evento, no cierra la oportunidad y no crea acciones comerciales falsas.

## Consecuencias

### Positivas

- trazabilidad tÃ©cnica;
- replanteamiento sin contaminar CRM;
- runtime reemplazable;
- mejor diagnÃ³stico.

### Negativas

- correlaciÃ³n cruzada;
- costo de almacenamiento;
- necesidad de polÃ­ticas de retenciÃ³n.

## Criterio de validaciÃ³n

- CRM sin `ai_*`;
- propuesta rechazada visible tÃ©cnicamente;
- estado comercial no reconstruido desde `ai_conversation_state`;
- falla tÃ©cnica visible y con continuidad.
