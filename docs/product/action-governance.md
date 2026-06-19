# Action Governance

P1Ka
Este documento describe la capa deterministica de Commercial Policy que opera sobre una salida del Sales Agent ya validada.

## Boundary

La secuencia contractual es:

```text
buildCommercialContext
  -> runSalesAgentDryRun
    -> provider
    -> rawOutput (unknown)
    -> validateSalesAgentOutput
  -> evaluateCommercialPolicy
```

La policy nunca ejecuta herramientas, nunca escribe DB, nunca envía outbound y nunca reemplaza al validator.

## Responsabilidad

Commercial Policy responde una sola pregunta:

`¿Esta propuesta comercial está permitida bajo las reglas del producto?`

No responde si el output está bien formado. Eso corresponde a `validateSalesAgentOutput()`.

## Resultados

La salida de policy conserva o bloquea:

- claims
- proposed actions
- tool requests
- entity proposals

El resultado puede quedar en:

- `allowed`
- `allowed_with_restrictions`
- `requires_review`
- `blocked`
- `failed_safe`

## Estado del roadmap

- `P1K-007A` DONE
- `P1K-007B` DONE
- `P1K-007C` DONE
- `P1K-007D` ACTIVE
- `P1K-007E` NEXT
- `P1K-007F` PENDING
- `P1K-011A` DONE
- `P1K-011B` DONE
- `P1K-012A` DONE
- `P1K-012B` NEXT
## Action lifecycle contract

La decision comercial valida vive primero como `next_action_json` dentro de `crm_agent_decisions`.

Eso basta cuando:

- solo se necesita mostrar recomendacion;
- no hay aprobacion persistente;
- no hay ejecucion futura;
- no hay scheduler ni outbox;
- no se requiere editar, aprobar o rechazar una accion como entidad durable.

Una entidad durable futura de accion solo se vuelve necesaria cuando exista necesidad real de:

- persistir aprobaciones o rechazos;
- programar ejecucion posterior;
- conectar la accion con `brain_message_outbox`;
- cancelar o replanificar follow-up;
- auditar lifecycle completo de la accion.

La secuencia conceptual es:

`Decision -> NextAction -> ProposedAction -> OperatorReview -> ApprovedAction -> ExecutableCommand -> ExecutionResult`

En `P1K-011A` no se implementa persistencia de acciones ni ejecucion.
En `P1K-011B` se agrega el planner puro de follow-up en dry-run, que puede sugerir seguimiento sin crear una accion durable.
En `P1K-012A` aparece `crm_agent_actions` como cola durable de acciones gobernadas, sin habilitar ejecucion ni outbox.

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
- crear campana borrador,
- explicar decision.

En el AI SDR MVP, estas acciones se interpretan como propuestas o internal tasks, no como ejecuciones autonomas de alto riesgo.

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

Para el operating model comercial, tambien requieren approval inicial los borradores que impliquen compromiso de precio, stock, despacho o fecha, aunque se presenten como quote draft.

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

## AI SDR governance notes

1. `answer_now` puede ejecutar solo respuestas bajo riesgo y dentro de policy.
2. `ask_clarifying_question` y `qualify_lead` son acciones internas de bajo riesgo.
3. `create_quote_draft` puede existir, pero el envio de cotizacion final requiere approval.
4. `propose_followup` y `schedule_followup` son gobernadas por estado, urgencia e intencion.
5. `escalate_to_operator` es la salida esperada cuando la confianza es baja o la accion es sensible.
6. `pause_contact`, `mark_stalled` y `mark_lost_candidate` son decisiones de estado, no de envio.
7. `recommend_products` y `suggest upsell/cross-sell` son permitidas solo como recomendacion o borrador.
8. `propose_whatsapp_followup` no equivale a ejecucion.
9. `phone_call` requiere aprobacion explicita del operador.
10. La identidad conflictiva bloquea follow-up sensible hacia afuera.
11. Varios intentos elevan el requisito de revision humana.
12. El follow-up no puede prometer descuentos, stock, despacho ni cotizacion final.

## Sales Agent governance notes

1. Las decisiones del Sales Agent son propuestas, no mutaciones.
2. Los claims sensibles requieren evidencia de una fuente o tool autorizada.
3. Tool request implica autorizacion del backend, no ejecucion garantizada.
4. Entity proposal no muta Lead ni Opportunity.
5. Cambios de alto riesgo requieren approval.
6. El Sales Agent no puede marcar `won` o `lost` sin evidencia autorizada.
7. El Sales Agent no puede inventar precio, stock, despacho, entrega o garantia.

## Operator Copilot governance notes

1. El Operator Copilot solo propone comandos; no ejecuta ni aprueba.
2. Todo `CommandProposal` debe salir en `dryRun=true` por defecto.
3. La aprobacion debe provenir de un humano autorizado dentro del HUB o de un flujo externo de governance.
4. Ningun comando propuesto por el Copilot puede saltarse governance.
5. Los hard blocks estructurales no pueden levantarse desde el Copilot.
6. La auditoria futura es obligatoria para cualquier aprobacion humana derivada del Copilot.
7. El Copilot no puede presentar Customer Candidate como Customer Master ni filtrar PII fuera de scope.
8. Si el contexto es stale, insuficiente o restringido, la salida debe degradar a `insufficient_context`, `access_restricted` o `failed_safe`.

## Next Best Action contract

Toda recomendacion comercial debe poder explicarse con:

- `current_state`
- `detected_signal`
- `recommended_action`
- `recommended_channel`
- `urgency`
- `confidence`
- `rationale`
- `requires_human_approval`

## Sandbox autonomy boundary

P1K-012C introduces a sandbox-only eligibility gate for autonomous WhatsApp replies.

That gate:

- requires exact-match whitelist in sandbox;
- stays read-only;
- never writes outbox;
- never calls Meta;
- never replaces policy or governance.

Future production autonomy must not depend on whitelist. It must depend on policy, risk, rollout and control operacional.

## Operational pattern

1. El agente propone.
2. La policy clasifica mode y approval.
3. Si hace falta, HUB aprueba.
4. Solo entonces se ejecuta la accion.
5. Todo queda en timeline y audit log.

## Runtime sequencing constraints

1. Ningun LLM puede decidir permisos, levantar hard blocks o autorizarse a si mismo.
2. El Contract Validator va antes de policy y governance.
3. Commercial Policy se aplica antes de que una propuesta sea visible al operador.
4. Follow-up Policy puede correr en dry-run y no requiere scheduler.
5. Operator Copilot consume salidas ya validadas; no aprueba ni ejecuta.
6. Execution Engine permanece deshabilitado hasta que governance, audit e idempotencia esten probados.
7. WhatsApp outbound no es el primer modo de ejecucion; primero van analysis, proposals y tareas internas reversibles.
