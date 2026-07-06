# P1M Operational Harness Acceptance

Este documento define la lista de aceptación mínima para considerar operativo el harness autónomo de P1M.

## Objetivo

Los módulos que deben quedar operativos son:

- `Dashboard`
- `Conversations`
- `Cases`
- `Customers`
- `Opportunities`
- `Actions`

Estos módulos forman la superficie mínima para observar, navegar y gobernar el estado del sistema autónomo.

## Reglas globales

- No se permiten datos hardcoded presentados como reales.
- Toda sección visible debe venir de backend, read model, repository o API interna.
- Si falta backend real, la UI debe degradar explícitamente con estado vacío, warning o unavailable.
- Fixtures solo se permiten para scaffolding temporal claramente identificado.
- La UI no debe contener lógica sensible de dominio ni side effects.
- Cada módulo debe poder fallar de forma aislada sin romper el resto del shell.

## Definición de aceptación por módulo

### Dashboard

Fuente esperada:

- Read model de dashboard en backend.
- Agregados operativos desde conversations, cases, customers, opportunities, actions y audit.

Aceptación:

- El home operacional muestra KPIs reales o degradados explícitamente.
- Las tarjetas de actividad, salud y prioridades se resuelven desde backend.
- Los accesos rápidos a `Conversations`, `Cases`, `Customers`, `Opportunities` y `Actions` apuntan a rutas reales.
- No hay contadores ni listas estáticas embebidas en el componente.
- Si una fuente falla, la sección afectada muestra warning sin romper el resto del dashboard.

### Conversations

Fuente esperada:

- Read model de conversaciones.
- API de conversación individual.
- Ruta autónoma para detalle operativo y acciones del sistema.

Aceptación:

- El inbox lista conversaciones reales o un empty state explícito.
- Los filtros, prioridad y ventana WhatsApp se resuelven desde backend.
- El workspace respeta la referencia canónica de P1M: sidebar de contexto, chat central y Copilot lateral.
- El detalle carga timeline, contexto, historial y acciones desde APIs o read models.
- La cabecera de conversación muestra canal, estado, origen y acciones de operador desde backend.
- El chat muestra mensajes con dirección, estado, timestamp y fuente de timeline.
- Los mensajes proyectados de delivery deben reflejar `sent`, `delivered`, `read` o `failed` si el backend los conoce.
- El composer debe existir como shell de operador y degradar explícitamente si la escritura no está habilitada.
- Los modos de composición `Responder` y `Nota interna` deben venir de estado real o de un shell claramente identificado.
- Los adjuntos, si se muestran, deben venir de backend; si no existe backend, la sección debe quedar como `No disponible`.
- El panel de Copilot debe mostrar señal detectada, recomendación, razón, faltantes, confianza, riesgo y queue de acciones desde backend.
- El bloque de diagnóstico debe estar colapsado por defecto y basarse en datos reales.
- No existen mensajes, estados, badges, tabs o métricas hardcoded.
- No se permite usar fixtures locales para simular historial, copilot o queue si el módulo está marcado como operativo.

Gap explícito a cerrar antes de darlo por aceptado:

- Vista de `attachments` o assets conversacionales con fuente real.
- Fuente real para notas internas si el concepto las requiere.
- Tabs de `Conversación`, `Detalles`, `Registros` e `Historial` con data real, no solo navegación visual.
- Estado visual de operator controls y review proposal conectado al backend.

### Cases

Fuente esperada:

- Repository o read model de casos.
- Vista operativa actual mientras el backend definitivo madura.

Aceptación:

- El listado de casos proviene de backend y no de fixtures locales.
- El detalle del caso muestra timeline, estado, contexto y acciones gobernadas.
- Las primitivas operativas del caso usan endpoints reales.
- El módulo mantiene separación conceptual respecto de Conversations.
- Cualquier dependencia legacy debe quedar encapsulada en el backend, no en la UI.

### Customers

Fuente esperada:

- `master_customer` y sus APIs o repositories asociados.
- Read model de identidad provisional donde aplique.

Aceptación:

- El directorio lista clientes reales.
- El detalle muestra perfil, origen, actividad y relaciones desde backend.
- La identidad provisional queda claramente diferenciada de Customer Master.
- No se inventan campos de scoring, LTV, riesgo o segmentación si no existen en backend.
- La creación/edición, si está habilitada, usa endpoints reales y validación real.

### Opportunities

Fuente esperada:

- `crm_opportunities`.
- Read model u orquestación comercial del backend.

Aceptación:

- El inbox de oportunidades lista oportunidades reales.
- El detalle muestra etapa, contexto, timeline y estado comercial desde backend.
- La vista no muta etapas directamente si no existe backend para ello.
- Cotización, estado y acciones del workspace se conectan a datos reales.
- No hay pipeline simulado ni etapas hardcoded.

### Actions

Fuente esperada:

- `crm_agent_actions`.
- `crm_action_executions`.
- `crm_action_outcomes`.
- Gate de ejecución/autorización del backend.

Aceptación:

- La cola lista acciones reales pendientes, planificadas, ejecutadas o bloqueadas.
- El detalle de acción muestra estado, justificación, resultado y trazabilidad.
- Los botones de aprobar, ejecutar o resolver solo aparecen si existe backend para esa transición.
- No se muestran side effects ficticios ni estados locales inventados.
- La UI refleja exactamente si la acción está bloqueada, pendiente o ejecutada.

## Checklist de conversation workspace

Antes de considerar `Conversations/[id]` como terminado, deben estar presentes y conectados:

- sidebar con cliente, identidad, sistemas fuente, vinculaciones y notas operativas;
- encabezado con estado de conversación, canal, origen y acciones principales;
- timeline con mensajes inbound, outbound y system con delivery state;
- tabs o sub-vistas canónicas del workspace;
- composer con reply y nota interna;
- adjuntos o estado explícito de no disponibilidad;
- Copilot lateral con recommendation, reasoning, missing info y queue;
- diagnóstico colapsado y read-only;
- empty states y warnings por cada sección;
- ningún contenido funcional hardcoded.

## Mapeo mínimo de backend

### Dashboard

- `GET /api/system/capabilities`
- `getDashboardData()` o read model equivalente

### Conversations

- `GET /api/conversations`
- `GET /api/conversations/[id]`
- `GET /api/conversations/[id]/autonomous`
- `buildNativeCommercialContext(...)` para contexto operativo del workspace
- `buildCommercialShadowReview(...)` para observabilidad y diagnostico
- `buildAiSdrOperatorPilotViewModel(...)` para el panel de Copilot
- `buildActionQueueViewModel(...)` para la cola de acciones vinculadas

### Cases

- `GET /api/cases`
- `GET /api/cases/[id]`
- Endpoints de operación del caso: reply, close, reopen, priority, block-ai

### Customers

- `GET /api/customers`
- `GET /api/customers/[id]`
- `POST /api/customers` solo si la escritura está habilitada

### Opportunities

- `GET /api/opportunities`
- `GET /api/opportunities/[id]`
- Endpoints de mutación solo si la transición comercial está definida

### Actions

- `GET /api/actions`
- `GET /api/actions/[id]`
- Endpoint de gate/approval/execution cuando exista

## Criterio de cierre

El harness se considera operativo cuando:

- los seis módulos anteriores cargan con datos reales o degradación explícita;
- no existen hardcodes funcionales en las secciones visibles;
- cada módulo lee de su backend correspondiente;
- dashboard, conversaciones, casos, clientes, oportunidades y acciones permiten ver el estado operativo del sistema autónomo de forma coherente.
