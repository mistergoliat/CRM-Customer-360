# Action Governance

## Objetivo

Definir como un agente propone, clasifica, bloquea o ejecuta acciones dentro del CRM agentic.

La gobernanza existe para asegurar:

- trazabilidad,
- control de riesgo,
- aprobacion humana donde corresponda,
- separacion entre propuesta y ejecucion,
- continuidad entre HUB, Brain API y n8n durante la transicion.

## Conceptos base

### Agent Capability

Capacidad funcional declarada de un agente. Ejemplo: redactar borrador, clasificar intencion, crear oportunidad, sugerir follow-up.

### Tool Permission

Permiso concreto para usar una tool. Una capability puede requerir varias tools, y una tool puede estar permitida para una sola fase o agente.

### Proposed Action

Accion concreta sugerida por un agente. Puede ser de borrador, interna, de envio o de bloqueo.

### Execution Mode

Modo de ejecucion permitido para esa propuesta.

### Approval Requirement

Regla que determina si una persona debe aprobar la accion antes de ejecutarla.

### Forbidden Action

Accion que no se puede ejecutar en ninguna condicion de la fase actual.

## Execution modes

| Mode | Significado | Regla |
|---|---|---|
| `observe_only` | Solo observa y reporta. | No cambia estado ni envia nada. |
| `draft_only` | Genera borrador. | No puede salir al cliente ni mutar el core. |
| `internal_task` | Crea tarea interna o registro operativo. | No impacta al cliente final. |
| `requires_approval` | Propone ejecucion pero exige aprobacion humana. | No ejecuta hasta approval. |
| `send_now_low_risk` | Puede enviar de inmediato si el riesgo es bajo y la policy lo permite. | Solo para acciones expresamente habilitadas. |
| `blocked` | Prohibido. | Debe registrarse el motivo y no continuar. |

## Initial allowed actions

Estas acciones pueden existir desde el inicio sin approval para el caso correcto o en modo seguro.

- clasificar intencion,
- responder FAQ bajo riesgo,
- pedir datos faltantes,
- crear borrador,
- crear tarea interna,
- crear oportunidad,
- sugerir follow-up,
- crear campaña borrador,
- explicar decision.

## Actions requiring approval initially

Estas acciones deben pasar por aprobacion humana en el MVP.

- aplicar descuento,
- confirmar stock,
- confirmar despacho,
- confirmar fecha de entrega,
- enviar cotizacion formal,
- agendar servicio definitivo,
- llamar por telefono,
- enviar campana masiva,
- resolver reclamo sensible,
- ofrecer compensacion,
- rechazar garantia,
- modificar pedido,
- cancelar pedido,
- emitir devolucion.

## Governance rules

1. Ninguna capability implica envio automatico por defecto.
2. Toda action proposal debe traer `reason`, `risk_level`, `source`, `target`, `confidence` y `required_approval`.
3. Una tool puede estar permitida pero la accion seguir requiriendo approval.
4. Si la policy no puede clasificar el riesgo, el resultado debe ser `blocked` o `requires_approval`.
5. Las acciones sensibles deben quedar registradas aunque se rechacen.
6. No se deben usar workflows n8n para decidir permisos de agente.
7. La aprobacion humana debe vivir en HUB, no en un texto libre de chat.

## Example mapping

| Proposed Action | Mode esperado | Approval |
|---|---|---|
| Clasificar mensaje inbound | `internal_task` | No |
| Redactar respuesta FAQ | `draft_only` | No |
| Crear oportunidad | `internal_task` | No |
| Sugerir follow-up | `draft_only` | No |
| Enviar cotizacion formal | `requires_approval` | Si |
| Aplicar descuento | `requires_approval` | Si |
| Confirmar stock | `requires_approval` | Si |
| Confirmar despacho | `requires_approval` | Si |
| Llamar por telefono | `requires_approval` | Si |
| Enviar campana masiva | `requires_approval` | Si |
| Rechazar garantia | `requires_approval` | Si |
| Emitir devolucion | `requires_approval` | Si |

## Forbidden actions

Las siguientes acciones son forbidden si no existe una policy clara, aprobacion explicita y tool readiness:

- prometer stock no verificado,
- inventar fecha de entrega,
- inventar precio,
- modificar pedido sin aprobacion,
- cancelar pedido sin aprobacion,
- enviar masivo sin consentimiento y approval,
- ejecutar llamada sin tool habilitada,
- alterar permisos de agente desde flujo n8n,
- usar Work Queue como fuente maestra de negocio.

## Operational pattern

1. El agente propone.
2. La policy clasifica mode y approval.
3. Si hace falta, HUB aprueba.
4. Solo entonces se ejecuta la accion.
5. Todo queda en timeline y audit log.

