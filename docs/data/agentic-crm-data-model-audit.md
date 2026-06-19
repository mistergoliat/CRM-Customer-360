# 1. Resumen ejecutivo

El repositorio hoy combina cuatro capas de datos: `n8n_*` como legado operativo, `brain_message_outbox` y `ai_orchestrator_shadow_log` como infraestructura transitoria, y `crm_opportunities` / `crm_agent_decisions` como primera memoria durable del AI SDR. Antes estas tablas se habían propuesto como `commercial_*`; ese nombre ya no es el físico actual. No conviene crear una base de datos separada en esta etapa. La recomendación es mantener todo en `main_management` y consolidar el naming hacia prefijos `crm_` como convención estable. Las tablas realmente necesarias hoy son pocas: oportunidad comercial durable y decision log append-only. Todo lo demás debe esperar hasta que exista evidencia de uso operativo real. Mi recomendación final es detener nuevas migraciones de modelo, abrir una tarea documental de consolidación (`P1K-010B`) y tratar `commercial_*` solo como nombre histórico.

# 2. Estado actual del sistema

El sistema sigue siendo híbrido.

* El flujo legacy de casos y mensajes vive en `n8n_conversation_cases`, `n8n_conversation_messages`, `n8n_wa_inbound_messages` y la vista `n8n_vw_hub_cases`.
* `Customer Candidate` existe como puente de lectura, no como `customer_master` persistente.
* El AI SDR shadow ya existe y es read-only.
* El operational loop de P1K-009 ya introduce estado comercial durable y decision log.
* El operator pilot shell de P1K-010 es una superficie de lectura compacta sobre ese estado, no un ejecutor.
* `brain_message_outbox` sigue siendo una cola/transición controlada para mensajería.
* `hub_audit_log` es auditoría transversal del HUB.
* `ai_orchestrator_shadow_log` es observabilidad de shadow, no memoria comercial.

En términos de escritura:

* Escriben DB: el flujo legacy del HUB, el outbox, el shadow log, el operational loop cuando está habilitado y los handlers operativos ya existentes.
* Solo leen: el Brain Context, Customer Candidate, AI SDR shadow review, operator pilot, docs/contratos y la mayor parte del runtime comercial en modo dry-run.
* Son documentación o contratos: blueprint, operating model, sales-agent contract, operator-copilot contract, action-governance y los documentos de loop/pilot.

Observación importante: los archivos solicitados `docs/product/customer-identity-contract.md` y `docs/product/customer-identity-spec.md` no están bajo `docs/product/` en este repo; las rutas reales encontradas son `docs/customer-identity-contract.md` y `docs/customer-identity-spec.md`.

# 3. Inventario de tablas existentes o migraciones actuales

| Tabla | Fuente/migración | Propósito | Estado | Usada por | Riesgo |
| ----- | ---------------- | --------- | ------ | --------- | ------ |
| `n8n_conversation_cases` | Legacy / esquema existente del HUB | Caso conversacional y lifecycle operativo legacy | Existente, fuente de verdad transitoria | `lib/cases.ts`, `lib/brain/context/resolveContext.ts`, `lib/brain/messaging/caseUpdates.ts`, `lib/chats.ts`, docs de backend | Drift de esquema, acoplamiento a n8n, mezclar caso con entidad comercial |
| `n8n_conversation_messages` | Legacy / esquema existente del HUB | Mensajes conversacionales | Existente, fuente de lectura y escritura legacy | `lib/chats.ts`, `lib/brain/context/resolveContext.ts`, `lib/brain/messaging/outboundMessages.ts`, docs de outbox | Duplicación de semántica inbound/outbound, dependencia de esquema legacy |
| `n8n_wa_inbound_messages` | Legacy / esquema existente del HUB | Inbound WhatsApp normalizado | Existente, lectura principal de inbound | `lib/brain/context/resolveContext.ts`, `lib/customer-identity/sourceReaders.ts`, docs de identity | Identidad provisional y ruido de origen |
| `n8n_vw_hub_cases` | Vista legacy del HUB | Vista agregada para UI de casos | Existente, solo lectura | `lib/cases.ts`, `lib/chats.ts`, dashboard, UI de casos | Vista dependiente de columnas legacy |
| `brain_message_outbox` | `migrations/003_brain_message_outbox.sql` | Cola controlada para mensajes salientes | Existente, infraestructura transitoria | `lib/brain/messaging/outbox.ts`, `lib/brain/messaging/outboxWorker.ts`, docs de response executor | Puede confundirse con dominio comercial si se expande sin límites |
| `ai_orchestrator_shadow_log` | `migrations/002_ai_orchestrator_shadow_log.sql` | Observabilidad del shadow AI | Existente, observabilidad técnica | `lib/ai/orchestration/shadow-log.ts`, docs de shadow mode | Guarda payload crudo si se usa mal; no es memoria comercial |
| `hub_audit_log` | `migrations/001_hub_audit_log.sql` | Auditoría transversal del HUB | Existente, auditoría general | `lib/audit.ts`, flujos operativos del HUB | No debe absorber decisiones comerciales por comodidad |
| `crm_opportunities` | `migrations/004_ai_sdr_operational_loop.sql` | Estado comercial durable de oportunidad | Existente, primera tabla CRM durable | `lib/brain/commercial/operational-loop/*`, `lib/brain/processInbound.ts` | Riesgo de usarla como Case o Lead encubierto |
| `crm_agent_decisions` | `migrations/004_ai_sdr_operational_loop.sql` | Decision log append-only | Existente, evento/decisión operacional | `lib/brain/commercial/operational-loop/*` | Riesgo bajo si se mantiene append-only e inmutable |

Inventario complementario relevante:

| Tabla / vista | Fuente | Observación |
| --- | --- | --- |
| `n8n_vw_hub_cases` | Legacy | Adecuada para UI y lectura de caso, no para CRM durable |
| `hub_audit_log` | M01 | Auditoría útil, pero no sustituye decision log comercial |
| `brain_message_outbox` | M03 | Infraestructura de ejecución futura, no entidad comercial |
| `ai_orchestrator_shadow_log` | M02 | Diagnóstico de shadow, no memoria operacional |

# 4. Entidades de dominio

| Entidad | Qué representa | Tabla ahora sí/no | Motivo | Tabla recomendada |
| ------- | -------------- | ----------------- | ------ | ----------------- |
| Customer | Persona/empresa central del CRM | No todavía | Falta `customer_master` y identidad consolidada | Futuro `crm_customers` |
| Customer Identity | Llaves de identidad y matching | No todavía | Hoy la identidad es provisional y read-only | Futuro `crm_customer_identities` |
| Customer Candidate | Identidad provisional candidata | No todavía | Es un puente de lectura, no un master persistente | Read model / no tabla nueva |
| Lead | Interés comercial inicial | No todavía | El proyecto ya decidió no convertir conversas/cases en lead persistente hoy | Futuro `crm_leads` |
| Opportunity | Unidad comercial durable | Sí | Es la primera memoria comercial que realmente hace falta | `crm_opportunities` hoy |
| Conversation | Hilo conversacional | No | Ya existe en legacy; no debe convertirse en entidad comercial | Legacy `n8n_conversation_messages` / `n8n_conversation_cases` |
| Case | Caso operativo | No | No es entidad comercial | Legacy `n8n_conversation_cases` |
| Agent Decision | Decisión operacional inmutable | Sí | Necesaria para auditar reducción, policy y next action | `crm_agent_decisions` hoy |
| Agent Action / Command | Acción gobernada propuesta o preparada | No todavía | Hoy no hay ejecución ni approval persistente maduro | Futuro `crm_agent_actions` si aparece lifecycle real |
| Operator Review | Revisión humana | No todavía | La revisión vive como shell local y review viewmodel, no como persistencia | Futuro `crm_operator_reviews` |
| Follow-up Task | Tarea diferida de seguimiento | No todavía | Aún no existe scheduler ni executor real | Futuro `crm_followup_tasks` |
| Quote Draft | Borrador de cotización | No todavía | Se arriesga a crear semántica prematura | Futuro `crm_quote_drafts` |
| Tool Invocation | Llamada ejecutada a herramienta | No todavía | No hay tools comerciales ejecutables en esta fase | Futuro `crm_tool_invocations` |
| Outbox | Cola de envío controlado | Sí, pero no como dominio CRM | Ya existe como infraestructura de mensajería | `brain_message_outbox` |
| Audit/Event | Hecho trazable transversal | Sí, ya existe en forma general | Útil para HUB, no suficiente para CRM comercial | `hub_audit_log`, y más adelante eventos CRM si hacen falta |

# 5. Comparación entre modelo expandido y modelo mínimo

## Alternativa A — Modelo expandido

Tablas posibles:

* `crm_customers`
* `crm_customer_identities`
* `crm_customer_events`
* `crm_leads`
* `crm_opportunities`
* `crm_agent_decisions`
* `crm_operator_reviews`
* `crm_agent_commands`
* `crm_followup_tasks`
* `crm_agent_events`
* `crm_tool_invocations`

Ventajas:

* Normaliza mejor la separación entre identidad, negocio, revisión y ejecución.
* Facilita analítica y trazabilidad futura.
* Hace más fácil aislar permisos y lifecycle por entidad.

Desventajas:

* Demasiadas tablas para una fase donde el producto todavía no ejecuta autonomía.
* Mayor probabilidad de duplicar semántica entre decision, action, review y command.
* Riesgo alto de migraciones prematuras que luego haya que consolidar.
* Coste de mantener consistencia entre demasiados estados antes de tener ejecución real.

## Alternativa B — Modelo mínimo

Tablas posibles:

* `crm_opportunities`
* `crm_agent_decisions`
* `crm_agent_actions` solo si existe lifecycle de comando/revisión que realmente lo justifique

Ventajas:

* Mantiene el sistema pequeño y auditable.
* Encaja con la fase actual: propuesta, policy, reducción, decisión e historial.
* Reduce el riesgo de crear tablas decorativas.
* Permite construir memoria durable sin confundirla con ejecución.

Desventajas:

* Absorbe temporalmente algo de semántica de review, command y follow-up dentro de un núcleo pequeño.
* Requiere disciplina para no sobrecargar `crm_agent_decisions` con todo.

Conclusión: el modelo mínimo es el correcto ahora. Si después aparece un lifecycle real de aprobación/ejecución, entonces sí conviene introducir `crm_agent_actions`.

# 6. Tabla por tabla recomendada

## `crm_opportunities`

Propósito:

* Representar el estado comercial durable de una oportunidad.

Qué NO representa:

* No es Case.
* No es Conversation.
* No es Lead.
* No es Customer Master.

Columnas propuestas:

* `id`
* `opportunity_key`
* `customer_candidate_id`
* `customer_master_id`
* `lead_id`
* `conversation_case_id`
* `wa_id`
* `channel`
* `primary_intent`
* `status`
* `stage`
* `temperature`
* `priority`
* `current_summary`
* `requirements_json`
* `missing_requirements_json`
* `product_interests_json`
* `objections_json`
* `signals_json`
* `last_customer_message_id`
* `last_agent_decision_id`
* `waiting_for`
* `next_action_type`
* `next_action_due_at`
* `human_owner_active`
* `ai_blocked`
* `version`
* `created_at`
* `updated_at`
* `last_activity_at`
* `closed_at`

Índices y claves únicas:

* `UNIQUE(opportunity_key)`
* índices por `customer_candidate_id`, `wa_id`, `conversation_case_id`, `status`, `updated_at`, `last_activity_at`
* índices adicionales por `customer_master_id` y `lead_id` si se usan

Relación con legacy:

* Debe referenciar legacy solo de forma blanda o por IDs observados.
* No debe depender de que Case sea identidad comercial.

Relación con Customer futuro:

* Debe poder absorber `customer_master_id` sin cambiar su rol.

Riesgos:

* Crear una oportunidad por mensaje.
* Mezclar postventa y venta en una sola fila.
* Usarla como sustituto de Case.

## `crm_agent_decisions`

Propósito:

* Guardar cada reducción/decisión como registro inmutable y append-only.

Columnas propuestas:

* `id`
* `decision_id`
* `opportunity_id`
* `correlation_id`
* `process_inbound_run_id`
* `sales_agent_run_id`
* `message_id`
* `previous_status`
* `next_status`
* `previous_stage`
* `next_stage`
* `detected_signals_json`
* `state_changes_json`
* `missing_information_json`
* `next_action_json`
* `policy_status`
* `risk_level`
* `approval_requirement`
* `decision_status`
* `rationale`
* `warnings_json`
* `contract_version`
* `policy_version`
* `runtime_version`
* `created_at`

Índices y claves únicas:

* `UNIQUE(decision_id)`
* índices por `opportunity_id`, `correlation_id`, `process_inbound_run_id`, `sales_agent_run_id`, `message_id`, `created_at`

Idempotencia:

* `decision_id` debe impedir duplicación de la misma decisión.
* `message_id` y `correlation_id` ayudan a reintentos y trazabilidad.

Relación con opportunity:

* Siempre cuelga de una oportunidad concreta.
* No debe existir decisión comercial sin contexto de oportunidad.

Relación con message/case:

* Puede referenciar `message_id` y `conversation_case_id` como observación, no como identidad.

Riesgos:

* Sobrecargarlo con payloads enormes.
* Convertirlo en prompt log.
* Dejar de ser append-only.

## `crm_agent_actions`

Recomendación:

* No crearla todavía.

Razón:

* Hoy no existe un lifecycle real de comando/aprobación/ejecución que justifique una tercera tabla durable.
* La fase actual todavía está mejor servida por `crm_agent_decisions` más `brain_message_outbox` para el futuro canal de envío.

Si se crea más adelante, debería capturar:

* acción propuesta
* comando aprobado
* estado de ejecución
* vínculo con outbox y ejecución real

Pero hoy esa semántica todavía sería prematura.

# 7. Tablas que NO deben crearse todavía

| Tabla | Por qué parece útil | Por qué debe esperar | Cuándo crearla |
| ----- | ------------------- | -------------------- | -------------- |
| `crm_customers` | Centraliza la entidad cliente | Aún no existe `customer_master` consolidado | Cuando Customer Master deje de ser solo una promesa conceptual |
| `crm_customer_identities` | Resuelve llaves e identidades | Hoy la identidad sigue siendo provisional y read-only | Cuando haya matching durable y políticas de unión/desunión |
| `crm_customer_events` | Timeline unificado | Puede duplicar observabilidad ya existente sin valor inmediato | Cuando exista customer graph real y analítica de tiempo |
| `crm_leads` | Representa interés comercial inicial | En esta fase puede duplicar Opportunity o inventar semántica | Cuando el negocio defina lead como entidad operativa separada |
| `crm_operator_reviews` | Guarda evaluación humana | Hoy la revisión es local/shell y no debe persistir | Cuando exista pipeline de revisión persistida y agregación |
| `crm_followup_tasks` | Programa seguimientos | Todavía no hay scheduler ni ejecución real | Cuando exista follow-up gobernado y cancelable |
| `crm_agent_events` | Event stream del agente | Puede competir con decision log y audit log | Cuando haya necesidad real de event sourcing comercial |
| `crm_tool_invocations` | Audita herramientas | Todavía no hay tools comerciales ejecutables | Cuando las herramientas existan y se necesite auditoría de ejecución |
| `crm_quote_drafts` | Formaliza cotizaciones | Riesgo alto de prematuridad semántica | Cuando el quoting sea parte del loop operativo real |

# 8. Naming y ubicación

Recomendación explícita:

* Usar `main_management` como base principal por ahora.
* Estandarizar las tablas nuevas del dominio comercial con prefijo `crm_` si se crean a futuro.
* No abrir una base separada todavía.
* Mantener `commercial_*` como nombre transitorio actual mientras exista código y migración ya desplegados, pero planear una consolidación para decidir si se renombra o se mantiene como excepción.
* Evitar foreign keys rígidas hacia `n8n_*`; preferir referencias blandas o IDs observados mientras n8n siga siendo transitorio.
* No contaminar la base con esquemas paralelos innecesarios.

Conclusión práctica:

* Si no hay necesidad de mover datos hoy, no se crean nuevas tablas.
* Si el equipo decide consolidar nomenclatura, hacerlo una sola vez, no en entregas fragmentadas.

# 9. Flujo operacional con el modelo mínimo

## Inbound real

```text
inbound message
→ resolve context
→ load/create crm_opportunities
→ Sales Agent decision
→ Commercial Policy
→ insert crm_agent_decisions
→ update crm_opportunities
→ insert proposed action only if the future command lifecycle exists
→ legacy flow continues
```

## Operador aprueba

```text
operator approves/edits/rejects
→ update governed action state when that table exists
→ no send yet
```

## Ejecución futura

```text
approved action
→ brain_message_outbox
→ Meta send
→ canonical outbound
→ action executed
```

## Follow-up futuro

```text
governed action type=schedule_followup
→ scheduled_for
→ cancel if customer replied
→ later executor creates send action
```

Con el modelo mínimo, la operación diaria queda cubierta sin inventar todavía una capa de ejecución que no existe.

# 10. Riesgos de diseño

* Crear una oportunidad por cada mensaje.
* Duplicar `command`, `action`, `decision` y `review` como conceptos distintos sin necesidad.
* Mezclar postventa con venta nueva.
* Usar Case como Opportunity.
* Anticipar Customer Master antes de tiempo.
* Guardar JSON sin límites.
* Crear demasiadas tablas prematuras.
* Perder idempotencia en retries.
* Ejecutar sin approval.
* Programar follow-up sin cancelación por respuesta nueva.
* No poder auditar decisiones porque se guardó todo como texto libre.

# 11. Recomendación final

Recomendación concreta:

* Crear ahora **0 tablas nuevas** y **consolidar primero** el modelo existente.
* Tomar como núcleo durable actual a `crm_opportunities` y `crm_agent_decisions`.
* Mantener `brain_message_outbox` y `ai_orchestrator_shadow_log` como infraestructura transitoria, no como CRM core.
* No introducir base de datos separada.
* Si el equipo quiere cerrar naming antes de seguir, abrir una tarea documental y de consolidación: `P1K-010B — Agentic CRM Data Model Consolidation`.
* No avanzar a más migraciones hasta validar si el nombre final del núcleo durable será `commercial_*` o `crm_*`.
* Antes de tocar producción, validar: idempotencia, límites JSON, transición de estado, trazabilidad de decisión, y que no se use Case como identidad comercial.

Si hubiera que elegir un camino técnico único hoy, sería:

* mantener `main_management`,
* seguir con las tablas existentes,
* posponer `crm_agent_actions` y el resto de tablas del modelo expandido,
* y consolidar nomenclatura y fronteras en la siguiente tarea documental.

# 12. Próximo prompt sugerido

`P1K-010B — Agentic CRM Data Model Consolidation`

Prompt breve sugerido:

> Consolidar la nomenclatura y el inventario definitivo del modelo CRM agentic, decidir si `commercial_*` se mantiene o se migra a `crm_*`, y cerrar la lista mínima de tablas antes de nuevas migraciones.
