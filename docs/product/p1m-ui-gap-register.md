# P1M UI Gap Register

Registro de huecos detectados durante la implementación visual P1M.

| Gap | Route / Surface | Source system | Backend required | Write required | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Conversation inbox real-time feed | `/conversations` | WhatsApp / Brain | Inbox read model and polling adapter | No | High | Hoy la bandeja es fixture-backed. |
| Conversation workspace persistence | `/conversations/[id]` | WhatsApp / Brain | Message timeline, notes, action queue | Yes | High | Composer permanece disabled. |
| Customer identity resolution | `/customers` | PrestaShop / WhatsApp / Email | Identity graph and merge logic | Yes | High | Sigue siendo Customer Candidate. |
| Customer master | `/customers/[id]` | Future master data | `customer_master` and merge policies | Yes | High | Prohibido inventarlo en P1M. |
| Opportunity state sync | `/opportunities` | PrestaShop / CRM Brain | Opportunity repository and stage transitions | Yes | High | La UI no muta etapas. |
| Action execution gate | `/actions` | Brain / Scheduler | Execution gate and persistence | Yes | High | Controles permanecen bloqueados. |
| Marketing campaign execution | `/marketing/campaigns/*` | Marketing backend | Draft, approval, scheduling, send | Yes | High | Solo preview en esta fase. |
| Marketing automation engine | `/marketing/automations/*` | Workflow engine | Trigger, wait, branch, suppression | Yes | High | Canvas visual sin motor real. |
| Knowledge read model | `/knowledge` | Docs / RAG source | Versioned article store | No | Medium | Actualmente fixture-backed. |
| Analytics data warehouse | `/analytics` | BI / warehouse | Aggregation layer and KPIs | No | Medium | Métricas de demostración. |
| Integrations health API | `/integrations` | PrestaShop / SAP / Meta | Status aggregation endpoint | No | Medium | Estado simulado por fixtures. |
| Settings persistence | `/settings` | Auth / config service | User, role, flag and policy storage | Yes | High | Solo lectura visual hoy. |

## Principios

- No resolver gaps con datos ficticios presentados como reales.
- No mezclar write paths en superficies de exploración visual.
- No convertir Case en el centro del dominio de CRM.
