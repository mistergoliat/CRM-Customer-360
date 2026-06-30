# P1M UI Implementation Status

Estado de implementación visual por superficie principal tras la segunda pasada de P1M.

| Ruta | Imagen canónica | Implementación | Fidelidad | Estado |
| ---- | --------------- | -------------- | --------- | ------ |
| Shell | `docs/product/ui-reference/p1m-concepts/00-shell/00-app-shell-reference.png` | Sidebar, topbar y layout global con navegación consolidada. | Alta | Acceptable MVP |
| `/dashboard` | `docs/product/ui-reference/p1m-concepts/01-operations/01-operational-home.png` | Centro operacional denso con KPIs, prioridades, actividad, pipeline y salud. | Alta | Acceptable MVP |
| `/conversations` | `docs/product/ui-reference/p1m-concepts/01-operations/02-conversations-inbox.png` | Inbox con filtros, tabla densa y panel lateral. | Alta | Acceptable MVP |
| `/conversations/[id]` | `docs/product/ui-reference/p1m-concepts/01-operations/03-conversation-workspace.png` | Workspace chat-first con contexto, attachments y Copilot. | Alta | Acceptable MVP |
| `/cases` | `docs/product/ui-reference/current/02-current-cases-inbox.png` | Continúa sobre datos operativos reales y composición existente. | Media | Partial |
| `/cases/[id]` | `docs/product/ui-reference/current/03-current-case-detail-full.png` | Mantiene dominio de caso separado y flujo de escritura bloqueado. | Media | Partial |
| `/customers` | `docs/product/ui-reference/p1m-concepts/02-crm/01-customers-directory.png` | Directorio provisional con LTV, riesgo y panel seleccionado. | Alta | Acceptable MVP |
| `/customers/[id]` | `docs/product/ui-reference/p1m-concepts/02-crm/02-customer-profile.png` | Perfil provisional con tabs, timeline y metadatos. | Alta | Acceptable MVP |
| `/opportunities` | `docs/product/ui-reference/p1m-concepts/02-crm/03-opportunities-inbox.png` | Inbox de pipeline con filtros, tabla y panel lateral. | Alta | Acceptable MVP |
| `/opportunities/[id]` | `docs/product/ui-reference/p1m-concepts/02-crm/04-opportunity-workspace.png` | Workspace con timeline, cotización y Copilot lateral. | Alta | Acceptable MVP |
| `/actions` | `docs/product/ui-reference/p1m-concepts/02-crm/05-actions-queue.png` | Cola global con tabla densa y detalle lateral. | Alta | Acceptable MVP |
| `/marketing` | `docs/product/ui-reference/p1m-concepts/03-marketing/01-marketing-overview.png` | Overview con campañas, segmentos, templates, automations y performance. | Alta | Acceptable MVP |
| `/marketing/copilot` | `docs/product/ui-reference/p1m-concepts/03-marketing/02-marketing-copilot-workspace.png` | Workspace conversacional con estado local del draft. | Alta | Acceptable MVP |
| `/marketing/segments` | `docs/product/ui-reference/p1m-concepts/03-marketing/04-segments-directory.png` | Directorio y detalle de segmentos con más densidad. | Alta | Acceptable MVP |
| `/marketing/campaigns` | `docs/product/ui-reference/p1m-concepts/03-marketing/03-campaign-builder.png` | Listado real con acceso a builder y detalle rápido. | Alta | Acceptable MVP |
| `/marketing/campaigns/new` | `docs/product/ui-reference/p1m-concepts/03-marketing/03-campaign-builder.png` | Builder visual sin ejecución real. | Alta | Acceptable MVP |
| `/marketing/campaigns/[id]` | `docs/product/ui-reference/p1m-concepts/03-marketing/03-campaign-builder.png` | Builder para campaña existente con preview. | Alta | Acceptable MVP |
| `/marketing/automations` | `docs/product/ui-reference/p1m-concepts/03-marketing/05-automation-builder.png` | Listado de automatizaciones con acceso al builder. | Alta | Acceptable MVP |
| `/marketing/automations/[id]` | `docs/product/ui-reference/p1m-concepts/03-marketing/05-automation-builder.png` | Builder visual con canvas, biblioteca e inspector. | Alta | Acceptable MVP |
| `/marketing/templates` | `docs/product/ui-reference/p1m-concepts/03-marketing/03-campaign-builder.png` | Biblioteca visual de plantillas. | Media | Acceptable MVP |
| `/marketing/performance` | `docs/product/ui-reference/p1m-concepts/03-marketing/01-marketing-overview.png` | Dashboard de rendimiento con gráficos y tablas. | Media | Acceptable MVP |
| `/knowledge` | `docs/product/ui-reference/p1m-concepts/04-intelligence/01-knowledge-library-and-article.png` | Master-detail rico con artículo completo. | Alta | Acceptable MVP |
| `/analytics` | `docs/product/ui-reference/p1m-concepts/04-intelligence/02-analytics-overview.png` | Dashboard analítico con gráficos, tablas y scorecards. | Alta | Acceptable MVP |
| `/integrations` | `docs/product/ui-reference/p1m-concepts/05-system/01-integrations.png` | Estado y detalle lateral de integraciones. | Alta | Acceptable MVP |
| `/settings` | `docs/product/ui-reference/p1m-concepts/05-system/02-settings.png` | Gobernanza, flags, canales y seguridad en modo read-only. | Alta | Acceptable MVP |

## Resumen

- Pantallas principales P1M: cubiertas con navegación real.
- Marketing ya no depende de hashes para cambiar de sección.
- Cases se mantiene separado y sin reemplazo por fixtures.
- Side effects productivos nuevos: ninguno.
- Migrations nuevas: cero.

## Pendientes

- Reemplazar fixtures por read models reales cuando exista backend.
- Completar la experiencia productiva de Cases sin mezclarla con Conversations.
