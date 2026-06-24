# P1M UI Implementation Status

Estado de implementación visual por superficie principal.

| Screen | Status | Notes |
| --- | --- | --- |
| Shell | implemented | Sidebar, topbar y layout global alineados al sistema visual objetivo. |
| `/dashboard` | implemented | Home operacional con métricas, prioridad, AI SDR y salud. |
| `/conversations` | implemented | Inbox con panel lateral y navegación a workspace. |
| `/conversations/[id]` | implemented | Workspace con chat, contexto y copilot. |
| `/cases` | partial | Conserva el dominio existente; sigue apoyado en datos de producción. |
| `/cases/[id]` | partial | Conserva el dominio existente; mantiene flujo de caso independiente. |
| `/customers` | implemented | Directorio provisional de Customer Candidate. |
| `/customers/[id]` | implemented | Perfil provisional con tabs visuales. |
| `/opportunities` | implemented | Inbox de pipeline con panel lateral. |
| `/opportunities/[id]` | implemented | Workspace con cotización, timeline y copilot. |
| `/actions` | implemented | Cola global read-only/preview. |
| `/actions/[id]` | implemented | Detalle interno de acción en cola. |
| `/marketing` | implemented | Overview del módulo de crecimiento. |
| `/marketing/copilot` | implemented | Copilot conversacional para campañas. |
| `/marketing/segments` | implemented | Directorio de segmentos y panel lateral. |
| `/marketing/campaigns/new` | preview | Builder visual sin ejecución real. |
| `/marketing/campaigns/[id]` | preview | Builder visual para campaña existente. |
| `/marketing/automations/[id]` | preview | Workflow builder sin motor real. |
| `/knowledge` | implemented | Biblioteca de conocimiento con artículo. |
| `/analytics` | implemented | Dashboard transversal de BI. |
| `/integrations` | implemented | Salud y sincronización de integraciones. |
| `/settings` | implemented | Gobernanza, roles, flags y seguridad. |

## Resumen

- Pantallas principales P1M: implementadas.
- Controles sensibles: bloqueados o preview-only.
- Side effects productivos nuevos: ninguno.
- Fixtures: separadas de producción.

## Pendientes

- Reemplazar fixtures por read models reales cuando exista backend.
- Completar la experiencia productiva de Cases sin mezclarla con Conversations.
