# P1M Visual Screen Map

Mapa de rutas, referencias canónicas y estado visual del CRM P1M.

## Convenciones

- `current/` preserva continuidad con el producto existente.
- `p1m-concepts/` define la dirección visual canónica futura.
- `fixture-backed` significa que la pantalla renderiza con datos locales tipados.
- `read-only` significa que la superficie no ejecuta side effects.
- `preview` significa que los controles existen solo como shell visual.

## Mapa

| Module | Route | Canonical image | View type | Data source | Status |
| --- | --- | --- | --- | --- | --- |
| Shell | global | `docs/product/ui-reference/p1m-concepts/00-shell/00-app-shell-reference.png` | App shell | UI tokens + navigation config | implemented |
| Operation | `/dashboard` | `docs/product/ui-reference/p1m-concepts/01-operations/01-operational-home.png` | Operational home | local fixtures | fixture-backed |
| Operation | `/conversations` | `docs/product/ui-reference/p1m-concepts/01-operations/02-conversations-inbox.png` | Inbox | local fixtures | fixture-backed |
| Operation | `/conversations/[id]` | `docs/product/ui-reference/p1m-concepts/01-operations/03-conversation-workspace.png` | Workspace | local fixtures | fixture-backed |
| Operation | `/cases` | `docs/product/ui-reference/current/02-current-cases-inbox.png` | Inbox | existing read model + DB | partial |
| Operation | `/cases/[id]` | `docs/product/ui-reference/current/03-current-case-detail-full.png` | Case workspace | existing read model + DB | partial |
| CRM | `/customers` | `docs/product/ui-reference/p1m-concepts/02-crm/01-customers-directory.png` | Directory | local fixtures | fixture-backed |
| CRM | `/customers/[id]` | `docs/product/ui-reference/p1m-concepts/02-crm/02-customer-profile.png` | Profile | local fixtures | fixture-backed |
| CRM | `/opportunities` | `docs/product/ui-reference/p1m-concepts/02-crm/03-opportunities-inbox.png` | Inbox | local fixtures | fixture-backed |
| CRM | `/opportunities/[id]` | `docs/product/ui-reference/p1m-concepts/02-crm/04-opportunity-workspace.png` | Workspace | local fixtures | fixture-backed |
| CRM | `/actions` | `docs/product/ui-reference/p1m-concepts/02-crm/05-actions-queue.png` | Queue | local fixtures | fixture-backed |
| Growth | `/marketing` | `docs/product/ui-reference/p1m-concepts/03-marketing/01-marketing-overview.png` | Overview | local fixtures | fixture-backed |
| Growth | `/marketing/copilot` | `docs/product/ui-reference/p1m-concepts/03-marketing/02-marketing-copilot-workspace.png` | Copilot workspace | local fixtures | fixture-backed |
| Growth | `/marketing/campaigns/new` | `docs/product/ui-reference/p1m-concepts/03-marketing/03-campaign-builder.png` | Builder | local fixtures | preview |
| Growth | `/marketing/segments` | `docs/product/ui-reference/p1m-concepts/03-marketing/04-segments-directory.png` | Directory | local fixtures | fixture-backed |
| Growth | `/marketing/automations/[id]` | `docs/product/ui-reference/p1m-concepts/03-marketing/05-automation-builder.png` | Builder | local fixtures | preview |
| Intelligence | `/knowledge` | `docs/product/ui-reference/p1m-concepts/04-intelligence/01-knowledge-library-and-article.png` | Master-detail | local fixtures | fixture-backed |
| Intelligence | `/analytics` | `docs/product/ui-reference/p1m-concepts/04-intelligence/02-analytics-overview.png` | Dashboard | local fixtures | fixture-backed |
| System | `/integrations` | `docs/product/ui-reference/p1m-concepts/05-system/01-integrations.png` | Health board | local fixtures | fixture-backed |
| System | `/settings` | `docs/product/ui-reference/p1m-concepts/05-system/02-settings.png` | Settings board | local fixtures | fixture-backed |

## Notes

- `/chats`, `/mailing` y `/system` quedaron como redirecciones legacy.
- Las vistas de `current/` se usan como referencia de continuidad para Cases.
- Las nuevas pantallas de P1M están aisladas de side effects reales.
