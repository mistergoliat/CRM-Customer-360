# PesasChile AI Hub - Phase 0 Architecture Transition

## Arquitectura actual

La arquitectura actual es hibrida:

1. Next.js con UI propia del HUB.
2. MySQL/MariaDB como base de datos operativa.
3. Meta Graph API para envio de WhatsApp server-side.
4. n8n como productor y poseedor actual del modelo de datos operativo.
5. El HUB lee vistas y tablas `n8n_*` para renderizar casos, mensajes, health y auditoria.

## Dependencia actual de `n8n_*`

Hoy el HUB depende de estas estructuras observadas en el repo:

1. `n8n_vw_hub_cases`
2. `n8n_conversation_cases`
3. `n8n_conversation_messages`
4. `n8n_wa_inbound_messages`
5. `n8n_postventa_queue`
6. `n8n_mantenciones_cardio_queue`

Estas tablas y vistas sostienen:

1. Listado de casos.
2. Detalle y timeline.
3. Inbox operativo.
4. Metricas de dashboard.
5. Acciones manuales con trazabilidad.
6. Compatibilidad legacy de colas operativas.

## Flujo actual

1. Un mensaje entra por WhatsApp / Meta y termina reflejado en el universo n8n.
2. n8n produce o actualiza el modelo operativo en tablas y vistas `n8n_*`.
3. El HUB consulta esas estructuras para mostrar inbox, dashboard y detalle de caso.
4. La respuesta manual sale server-side directo a Meta Graph API.
5. Luego la app intenta persistir outbound y audit log en DB.
6. Algunas acciones de caso actualizan lifecycle y estado en `n8n_conversation_cases`.

## Que queda temporalmente en n8n

1. Ingestiones externas.
2. Conectores con sistemas terceros.
3. Orquestacion transitoria.
4. Jobs temporales que aun no valga la pena migrar.
5. Fan-out de integraciones mientras se estabiliza el backend propio.

## Que debe migrar al backend propio

1. Decisiones de routing.
2. Estado de caso.
3. Persistencia de comandos operativos.
4. Normalizacion de outputs IA.
5. Auditoria operacional.
6. Scheduler de follow-up.
7. Reglas de handoff humano.
8. Contratos de identidad provisional.

## Entidades que existen hoy

1. Case.
2. Conversation Message.
3. WhatsApp Inbound Message.
4. Inbox Chat Item.
5. Audit Event.
6. Health Item.
7. Legacy Queue Detail.

## Entidades futuras

1. Customer Master.
2. Customer Key.
3. Agent Registry.
4. Prompt Registry.
5. Follow-up Task.
6. Campaign.
7. Audience Segment.
8. Deliverability Event.
9. Knowledge Item.

## Estrategia de transicion n8n -> backend

### Principio

No reescribir todo. Extraer primero la logica core que ya no debe vivir como workflow.

### Orden recomendado

1. Blindar auth, logging y validacion.
2. Formalizar DTOs de salida y eventos.
3. Mover transiciones criticas de caso al backend.
4. Mover la persistencia auditable de acciones.
5. Mover routing y normalizacion IA.
6. Mover follow-up y automatizaciones.
7. Dejar n8n como capa de integracion y orquestacion auxiliar.

## Roadmap tecnico

### P0 - Estabilizacion

1. Documentacion rectora.
2. Secretos obligatorios y fallback cerrado.
3. Validacion basica reproducible.
4. Claridad entre preview y produccion operacional.
5. Repositorio alineado a Fase 0.

### P1 - Refactor minimo

1. Unificar paneles y componentes duplicados.
2. Normalizar contratos de chat y case.
3. Reducir polling y queries repetidas.
4. Centralizar audit y acciones de caso.
5. Preparar envelopes estructurados para IA.

### P2 - Migracion desde n8n

1. Extraer routing y handoff.
2. Extraer scheduler de seguimiento.
3. Extraer persistencia de eventos operacionales.
4. Introducir versionado de reglas y prompts.
5. Consolidar identidad provisional para futura migracion a `customer_master`.

## Decisiones confirmadas del diagnostico

1. La UI es propia.
2. La fuente de verdad operativa sigue en `n8n_*`.
3. n8n ya no debe ser tratado como cerebro final del producto.
4. El HUB puede operar manualmente con Meta y DB.
5. Customer 360 definitivo queda fuera de Fase 0.
6. La identidad provisional debe basarse en `wa_id` y campos cercanos, no en una entidad maestra todavia inexistente.
7. La preview actual no debe romperse.

## Backlog inicial de estabilizacion

1. Blindar auth para no depender de secretos por defecto.
2. Migrar el lint a una ejecucion no interactiva.
3. Alinear scripts de validacion.
4. Definir contratos versionados de outputs IA.
5. Consolidar escritura auditable de acciones criticas.
6. Reducir ambiguedad entre paneles legacy y paneles activos.
7. Documentar el alcance exacto de cada modulo.

## Linea roja

No construir Customer 360 definitivo, no crear nuevas tablas por impulso y no mover toda la logica fuera de n8n en una sola iteracion.
