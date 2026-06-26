# ADR-002: AI Runtime and Observability Boundary

## Estado

Accepted

## Contexto

Las tablas `ai_*` deben registrar trazabilidad, diagnóstico, reanudación técnica y deliberación de IA sin convertirse en una segunda verdad comercial.

La memoria comercial durable pertenece a `crm_*`, `conversation`, `conversation_message` y `master_customer`.

## Problema

Sin frontera estricta, `ai_*` puede transformarse en:

- segunda máquina de estados;
- memoria paralela del cliente;
- fuente duplicada de oportunidades;
- cola de acciones no gobernada.

## Decisión

`ai_*` es runtime técnico y observabilidad. No controla el negocio.

### `ai_agent_execution`

Registra modelo, proveedor, inicio, término, estado, latencia, tokens, errores, schema version, correlation ID y commercial cycle ID.

### `ai_agent_decision`

Registra propuestas u outputs estructurados del modelo, no decisiones comerciales aceptadas.

### `ai_tool_execution`

Registra:

```text
requested
→ validated
→ authorized
→ executing
→ succeeded | failed | timed_out | rejected
```

Debe distinguir solicitud, autorización y ejecución.

### `ai_conversation_state`

Solo puede ser checkpoint técnico temporal:

- iteración actual;
- propuesta pendiente;
- tool pendiente;
- restricción recibida;
- retry;
- replanteamiento;
- cursor de ejecución.

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

La dirección futura recomendada es renombrarlo conceptualmente a `ai_execution_checkpoint`.

## Control de solicitudes

```text
Capability Gateway
→ Policy Validation
→ Domain Validation
→ Command Execution
```

`ai_*` registra el proceso; no autoriza por sí mismo.

## Estados de evaluación

- `available`
- `unavailable`
- `denied`
- `requires_approval`
- `missing_information`
- `temporarily_blocked`
- `invalid_arguments`
- `failed`

Solo `failed` representa error técnico posterior a una capability válida y autorizada.

## Invariantes

1. El core comercial opera sin leer `ai_*`.
2. `ai_conversation_state` es reconstruible o prescindible.
3. Ningún campo `ai_*` reemplaza una entidad CRM.
4. Toda ejecución se correlaciona con ciclo y evento.
5. Prompts y outputs respetan privacidad y retención.
6. No se almacenan credenciales.
7. La retención es configurable.
8. El simulador no es owner arquitectónico.
9. El owner es `AI Runtime / Observability`.
10. Una tool rechazada no se registra como ejecutada.

## Continuidad ante fallos

```text
fallo técnico
→ retry limitado
→ alternativa disponible
→ escalamiento
```

El fallo no bloquea otras conversaciones, no borra el evento, no cierra la oportunidad y no crea acciones comerciales falsas.

## Consecuencias

### Positivas

- trazabilidad técnica;
- replanteamiento sin contaminar CRM;
- runtime reemplazable;
- mejor diagnóstico.

### Negativas

- correlación cruzada;
- costo de almacenamiento;
- necesidad de políticas de retención.

## Criterio de validación

- CRM sin `ai_*`;
- propuesta rechazada visible técnicamente;
- estado comercial no reconstruido desde `ai_conversation_state`;
- falla técnica visible y con continuidad.
