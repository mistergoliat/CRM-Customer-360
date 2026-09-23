# CRM Web App — Current State Audit

**Fecha de auditoría:** 2026-09-23
**Repositorio:** `CRM-Customer-360`
**Rama:** `develop`
**Commit base:** `6816f94cdccc6315822abb3ae53ece1faa13bd79`
**Estado inicial:** limpio, sin cambios locales
**Naturaleza:** auditoría documental, estática y read-only

## 0. Alcance, método y límites

Esta auditoría responde a la fase “CRM Web App — Current State”. El objetivo es describir qué existe hoy, qué es reutilizable y qué debe pasar por la fase futura de definición de producto. No define una nueva UI ni autoriza cambios funcionales.

Se revisaron:

- `AGENTS.md`, `docs/PRODUCT_NORTH_STAR.md` y `docs/ACTIVE_RELEASE.md`.
- `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `app/layout.tsx` y `app/globals.css`.
- Todas las páginas `app/**/page.tsx`: 41.
- Todas las rutas `app/api/**/route.ts`: 60.
- El shell, navegación y primitivas compartidas en `components/`.
- Servicios/read models/adapters en `lib/`.
- El runtime de agentes bajo `lib/brain/` y sus endpoints.
- La evidencia visual disponible en `docs/product/ui-reference/current/`.

La revisión visual usa como continuidad las capturas existentes etiquetadas por el propio repositorio como superficies reales anteriores a P1M. No se levantó un servidor, no se ejecutó una nueva prueba de navegador y no se generaron capturas nuevas. Por eso los hallazgos de responsive, foco, densidad y accesibilidad son inspección de código más evidencia histórica, no una certificación visual de runtime.

No se modificaron UI, backend, base de datos, esquema, auth, rutas, configuración de despliegue ni release state. Los únicos cambios de esta fase son los dos documentos solicitados.

## 1. Resumen ejecutivo

CRM-Customer-360 ya tiene una aplicación web operativa, pero no una superficie homogénea. Conviven cuatro niveles de madurez:

1. **Operación nativa y relativamente real:** conversaciones, clientes, oportunidades, acciones, dashboard y parte de casos. Estos módulos leen tablas/read models propios y exponen estados reales, aunque con herencia legacy y sin un modelo común de autorización.
2. **Capacidades externas con buenos contratos de consumo:** catálogo, audiencias, Customer Intelligence y Marketing Copilot. Son los mejores ejemplos de una UI que muestra origen, límites, loading/error/empty y estado de solo lectura.
3. **Superficies preview/fixture:** gran parte de Marketing, Analítica, Integraciones y Configuración. Son útiles como exploración de producto y lenguaje visual, pero no deben interpretarse como capacidades disponibles.
4. **Superficies legacy o técnico-operativas:** casos, WhatsApp, audit, AI SDR simulator, API docs, configuración/seguimiento del agente y varias rutas ocultas. Contienen conceptos valiosos, pero mezclan producto, implementación y runtime.

La recomendación principal no es rehacer todo. El núcleo de operación, el patrón de evidencia/proveniencia y el modelo de Customer 360 tienen valor. La prioridad es separar mental models: Inbox/Conversaciones, After-sales/Casos, Commercial Work/Oportunidades, Agent Activity/Actions, Customer/Identity, Marketing, Analytics y Platform/Admin. El runtime y la ejecución de agentes deben alinearse con R4; CRM debe conservar la experiencia humana de supervisión, aprobación, auditoría y operación.

### Lo que está mejor resuelto

- Los read models nativos y servicios de dominio ya ofrecen seams razonables para reemplazar consultas directas.
- Catálogo, Audiencias, Customer Intelligence y Marketing Copilot son buenos referentes de estados explícitos, límites, origen, warning, retry y solo lectura.
- Conversations y Customers hacen visible la provisionalidad de la identidad y la ausencia de órdenes/cotizaciones/facturas, en vez de inventar datos.
- Actions aporta un modelo de gobernanza de acciones: riesgo, aprobación, evidencia, elegibilidad y guardrails.
- La arquitectura de shell es simple de seguir y el contrato de API suele pasar por `requireOperator`.

### Riesgos estructurales

- No existe un modelo real de usuarios, equipos, roles, permisos ni ownership; hay autenticación simple y un único concepto de operador.
- La navegación mezcla superficies de operación, preview, developer y plataforma, mientras que varias rutas valiosas están ocultas u huérfanas.
- Estados y lenguaje son inconsistentes: `open`, `closed`, `human_required`, `requires_human`, `requires_review`, `Esperando cliente`, `AI SDR`, `SalesNeedProfile`, `read-only` y `Preview` conviven sin un registro central.
- Dashboard, Cases y Audit tienen acoplamiento directo a SQL/tablas o legado; el caso más fuerte es `/audit` importando `safeQueryRows` directamente desde la página.
- El cliente muestra botones y controles de búsqueda global que no tienen comportamiento real: Topbar search es `readOnly`, los controles de usuario/notificaciones/ayuda son inertes y varias acciones están deshabilitadas.
- La apariencia de settings/integrations/analytics/marketing es convincente aunque los datos son fixture; el badge ayuda, pero el riesgo de confusión persiste.
- El shell es desktop-first: Sidebar solo aparece desde `lg`, no hay navegación móvil global y varios workspace dependen de columnas sticky/fijas.

## 2. Baseline técnico y stack

| Aspecto | Estado actual | Evidencia |
|---|---|---|
| Framework | Next.js `^15.3.0`, App Router | `package.json` |
| UI | React/React DOM `^19.0.0` | `package.json` |
| Lenguaje | TypeScript `^5.7.3`, `strict`, alias `@/*` | `package.json`, `tsconfig.json` |
| Estilos | Tailwind `^3.4.17`, PostCSS, clases propias | `tailwind.config.ts`, `app/globals.css` |
| Tipografía | Hanken Grotesk | `app/layout.tsx`, `tailwind.config.ts` |
| Iconos | Material Symbols cargado desde Google | `app/layout.tsx`, `components/ui/Icon.tsx` |
| Persistencia | MySQL/MariaDB mediante `mysql2` y servicios SQL | `package.json`, `lib/db.ts`, `lib/domains/**` |
| Integraciones | Meta/WhatsApp, catálogo externo, Customer Profile/Audiences, Marketing Copilot | `README.md`, `lib/**`, `app/api/**` |
| Gráficos | Sin librería dedicada; barras CSS/SVG y visuales propios | `components/p1m/ChartCard.tsx`, `CommercialScoreDonut` |
| Estado cliente | React local; sin Zustand/Redux/query cache | `package.json`, componentes `use client` |
| Output | `standalone` | `next.config.ts` |
| Tests/scripts | scripts de build, typecheck, lint, migrations, workers y suites existentes | `package.json` |

### Tokens visuales observados

`tailwind.config.ts` define `background #f9f9ff`, `hub-canvas #f3f4f6`, superficies claras, `on-surface #151c27`, `primary #bd0039`, `primary-container #e61e4d`, sidebar `#1f2937`, `sidebar-soft #2a313d` y `error #ba1a1a`. Hay tipografía, radius, spacing y shadows custom.

`globals.css` aporta clases `hub-card`, `hub-input`, `hub-textarea`, `hub-button` y `hub-table`, además de gradientes radiales globales. No hay dark mode, sistema de motion, focus-visible transversal ni un set de primitives de input/select/button/modal/drawer/toast.

### Conteo de superficie

- 41 archivos `page.tsx`.
- 39 páginas dentro de `app/(hub)` y 2 fuera: `/` y `/login`.
- 7 páginas dinámicas: actions, cases, conversations, customers, opportunities, marketing automations y marketing campaigns.
- 60 `route.ts` bajo `app/api`.
- 112 archivos bajo `components`.
- 828 archivos bajo `lib`; 632 bajo `lib/brain`.

## 3. North Star y frontera con R4

La documentación normativa del CRM establece que la oportunidad es el objeto comercial central, que la identidad sigue siendo provisional hasta existir un `customer_master` autoritativo y que el modelo propone mientras el backend valida y gobierna. La interfaz debe reflejar provenance, frescura, completitud y estados parciales.

El repositorio, sin embargo, aún contiene un runtime amplio bajo `lib/brain/**`: cognición, loop de agente, capabilities, providers, runtime, commercial work, follow-up workers, agent sessions, outbox y transporte. También expone 17 endpoints bajo `/api/brain/**` y `/api/ai/orchestrate`.

### Propiedad inequívoca de CRM

- Operación humana de conversaciones y casos.
- Directorio/profiling de clientes e identidad provisional.
- Oportunidades, cotizaciones y read models comerciales.
- UI de marketing, audiencias, customer intelligence y analítica de negocio.
- Supervisión humana de agentes: configuración de alto nivel, aprobación, intervención, auditoría y explicación.
- Estado de plataforma visible al operador, siempre que venga de contratos estables.

### Candidatos claros para R4 Core o servicios de plataforma

- `lib/brain/**` y sus semánticas de ejecución, capabilities, providers, loops, sessions y workers.
- `/api/brain/**` como APIs de ejecución/runtime; CRM puede mantener un adapter/supervision API.
- `lib/ai/orchestration/**` y `/api/ai/orchestrate`.
- Semántica de receipts, policy, approval, handoff, schedule, evaluation y ejecución durable.
- Las partes de `SalesAgentConfigurationWorkspace` que definan runtime, providers y contratos, no la experiencia de operador.

### Regla de frontera

CRM no debe importar runtime interno de R4 ni escribir tablas internas de R4. R4 no debe absorber conceptos específicos como `Quote`, `Cart`, `Opportunity`, `Campaign`, `Product` o `Payment`. El puente futuro debe ser contractual: Agent, Task, Run, Goal, Artifact, Observation, Capability, Action, Receipt, Policy, Schedule, Consultation, Approval, Handoff y Evaluation.

## 4. Sitemap actual

### Shell visible en navegación

```text
Operación
├─ Centro                         /dashboard
├─ Conversaciones [Preview]      /conversations
└─ Casos                          /cases

CRM
├─ Clientes [Preview]             /customers
├─ Oportunidades [Preview]        /opportunities
└─ Acciones [Preview]             /actions

Crecimiento
└─ Marketing [Preview]           /marketing

Inteligencia
├─ Catálogo                       /catalog
├─ Audiencias                     /audiences
├─ Configura al agente            /agents/sales/configuration
├─ Seguimientos del agente        /agents/sales/follow-ups
└─ Analítica [Preview]            /analytics

Sistema
├─ Integraciones [Partial]       /integrations
└─ Configuración [Partial]        /settings
```

La navegación vive principalmente en `lib/modules.ts` y `components/layout/Sidebar.tsx`. La sidebar es `hidden ... lg:flex`; no hay menú móvil global. `MarketingNav` añade Resumen, Inteligencia, Copilot, Segmentos, Campañas, Automatizaciones, Plantillas y Rendimiento.

### Rutas visibles, ocultas y huérfanas

| Estado | Rutas | Observación |
|---|---|---|
| Visibles | `/dashboard`, `/conversations`, `/cases`, `/customers`, `/opportunities`, `/actions`, `/marketing`, `/catalog`, `/audiences`, `/agents/sales/configuration`, `/agents/sales/follow-ups`, `/analytics`, `/integrations`, `/settings` | Son el recorrido principal del operador. Varias llevan badge Preview/Partial. |
| Ocultas | `/whatsapp`, `/customer-master`, `/agents`, `/audit`, `/chats`, `/mailing`, `/system` | Existen en código, pero no forman parte del menú actual. `chats`, `mailing` y `system` redirigen. |
| Huérfana | `/knowledge` | Página accesible por URL, no aparece en `modules.ts`. |
| Developer | `/dev/ai-sdr-simulator`, `/dev/api-docs` | No deben formar parte de la navegación de CRM usuario final. |
| Redirecciones | `/` → `/dashboard`; `/chats` → `/conversations`; `/mailing` → `/marketing`; `/system` → `/integrations` | Compatibilidad/legacy, no superficies nuevas. |
| Auth | `/login` | Formulario de sesión token-based. |

## 5. Inventario completo de páginas

La siguiente tabla distingue el propósito de la ruta y su nivel de producto. “Real” significa que consume un read model o backend, no que toda la experiencia esté completa.

### Operación y CRM

| Ruta | Usuario principal | Entidad / datos | Estado actual | Decisión |
|---|---|---|---|---|
| `/dashboard` | Operador/líder | conversaciones, clientes, oportunidades, acciones, runtime | Real, agregado y denso | REDESIGN |
| `/conversations` | Operador | `conversation`, thread, cliente | Real nativo, listado + panel seleccionado | REDESIGN |
| `/conversations/[id]` | Operador/supervisor | thread, contexto cliente/comercial, acciones IA | Real nativo, controls y reply gobernados | REDESIGN |
| `/cases` | Soporte/operador | `n8n_vw_hub_cases` y mensajes | Parcial/legacy, filtros y paginación | REDESIGN |
| `/cases/[id]` | Soporte/supervisor | caso, thread, AI SDR, reply | Parcial/legacy con shell técnico | REDESIGN |
| `/customers` | Operador/comercial | `master_customer` provisional | Real, directorio + perfil lateral | KEEP + POLISH |
| `/customers/[id]` | Operador/comercial | Customer 360 ensamblado | Real, snapshot con provenance y gaps | KEEP + POLISH |
| `/opportunities` | Comercial | `crm_opportunities` | Real, listado + panel seleccionado | KEEP + POLISH |
| `/opportunities/[id]` | Comercial/supervisor | oportunidad, profile, quote, actions | Real/partial, sin flujo completo de quote/order | KEEP + POLISH |
| `/actions` | Operador/supervisor | `crm_agent_actions` | Real, read-only governance queue | KEEP + POLISH |
| `/actions/[id]` | Supervisor | acción, evidencia, guardrails, lifecycle | Real, lectura detallada | KEEP + POLISH |
| `/audit` | Supervisor/compliance | `hub_audit_log` | Real, acceso directo SQL, oculta | KEEP + POLISH |
| `/whatsapp` | Operador técnico | inbound/outbound Meta/casos | Legacy, parcial, sin broadcast/templates | REMOVE |
| `/customer-master` | Admin/comercial | master customer proyectado | Placeholder no conectado | REMOVE |

### Inteligencia, agentes y desarrollo

| Ruta | Usuario principal | Entidad / datos | Estado actual | Decisión |
|---|---|---|---|---|
| `/catalog` | Comercial/operador | productos, stock, precio, recomendaciones | Real externo, read-only y bien acotado | KEEP + POLISH |
| `/audiences` | Marketing/comercial | schema, definición, evaluación, export | Real externo, backend autoritativo | KEEP + POLISH |
| `/analytics` | Líder/analista | commercial/service/marketing/AI/data quality | Fixture, visualización propia | BUILD |
| `/knowledge` | Operador/admin | conocimiento | Fixture/orphan, sin capability real | REMOVE |
| `/agents` | Admin/supervisor | orchestration/RAG/automation | Placeholder planificado | REMOVE |
| `/agents/sales/configuration` | Supervisor/admin | configuración del agente sales | Real, write gated y validación | REFACTOR |
| `/agents/sales/follow-ups` | Supervisor/operador técnico | observabilidad de follow-ups | Real, técnica y separada | REFACTOR |
| `/dev/ai-sdr-simulator` | Developer/QA | simulación y flags AI SDR | Developer/operator mixed | REMOVE |
| `/dev/api-docs` | Developer | Swagger API | Developer tool | REMOVE |

### Marketing, plataforma y legacy

| Ruta | Usuario principal | Entidad / datos | Estado actual | Decisión |
|---|---|---|---|---|
| `/marketing` | Marketing | resumen | Fixture preview | BUILD |
| `/marketing/copilot` | Marketing/analista | sesión y respuestas Copilot | Real externo, read-only | KEEP + POLISH |
| `/marketing/customer-intelligence` | Marketing/analista | overview, RFM, clusters, intersections | Real externo, varios endpoints | KEEP + POLISH |
| `/marketing/segments` | Marketing | segmentos | Fixture preview | BUILD |
| `/marketing/campaigns` | Marketing | campañas | Fixture preview | BUILD |
| `/marketing/campaigns/new` | Marketing | builder de campaña | Fixture, controls deshabilitados | BUILD |
| `/marketing/campaigns/[id]` | Marketing | detalle de campaña | Fixture, builder visual | BUILD |
| `/marketing/automations` | Marketing | automatizaciones | Fixture preview | BUILD |
| `/marketing/automations/[id]` | Marketing | builder de automatización | Fixture, controls deshabilitados | BUILD |
| `/marketing/templates` | Marketing | templates | Fixture preview | BUILD |
| `/marketing/performance` | Marketing/analista | performance | Fixture preview | BUILD |
| `/integrations` | Admin/supervisor | integraciones, salud, capacidad | Fixture; health backend no conectado a la página | REPLACE |
| `/settings` | Admin | usuario, roles, SSO, 2FA, flags | Fixture; no es auth/roles real | REPLACE |
| `/chats` | Legacy operador | alias de conversaciones | Redirección | REMOVE |
| `/mailing` | Legacy marketing | alias de marketing | Redirección | REMOVE |
| `/system` | Legacy admin | alias de integraciones | Redirección | REMOVE |

### Entradas fuera del shell

| Ruta | Estado |
|---|---|
| `/` | Redirige a `/dashboard`. |
| `/login` | Formulario token-based; no hay User/Team/Role model. |

## 6. Inventario API y comportamiento que condiciona frontend

Hay 60 rutas API. La lista completa, agrupada por dominio, es la siguiente:

| Área | Endpoints |
|---|---|
| Auth | `/api/auth/login` |
| AI | `/api/ai/orchestrate` |
| Audiences | `/api/audiences/schema`, `/api/audiences/evaluate`, `/api/audiences/export` |
| Brain | `/api/brain/actions/resolve`, `/api/brain/agents/run`, `/api/brain/agents/sales/configuration`, `/api/brain/agents/sales/configuration/[id]`, `/api/brain/agents/sales/configuration/[id]/archive`, `/api/brain/agents/sales/configuration/[id]/clone`, `/api/brain/agents/sales/configuration/[id]/publish`, `/api/brain/agents/sales/configuration/effective`, `/api/brain/agents/sales/configuration/validate`, `/api/brain/agents/sales/follow-ups`, `/api/brain/agents/sales/follow-ups/[actionId]`, `/api/brain/agents/sales/follow-ups/summary`, `/api/brain/context/resolve`, `/api/brain/execute`, `/api/brain/messaging/send-test`, `/api/brain/outbox/worker`, `/api/brain/process-inbound` |
| Cases | `/api/cases/[id]/block-ai`, `/api/cases/[id]/close`, `/api/cases/[id]/priority`, `/api/cases/[id]/reopen`, `/api/cases/[id]/reply` |
| Catalog | `/api/catalog/products/search`, `/api/catalog/products/[productId]/context` |
| Chats legacy | `/api/chats`, `/api/chats/[caseId]`, `/api/chats/[caseId]/messages` |
| Conversations | `/api/conversations`, `/api/conversations/[id]`, `/api/conversations/[id]/autonomous`, `/api/conversations/[id]/control`, `/api/conversations/[id]/messages`, `/api/conversations/[id]/reply`, `/api/conversations/[id]/requests` |
| Customers | `/api/customers`, `/api/customers/[id]`, `/api/customers/[id]/360` |
| Developer | `/api/dev/ai-sdr-simulator` |
| Escalations | `/api/escalations` |
| WhatsApp | `/api/integrations/whatsapp/webhook` |
| Marketing Copilot | `/api/marketing/copilot`, `/api/marketing/copilot/sessions`, `/api/marketing/copilot/sessions/[sessionId]`, `/api/marketing/copilot/sessions/[sessionId]/messages`, `/api/marketing/copilot/sessions/[sessionId]/refresh`, `/api/marketing/copilot/sessions/[sessionId]/reset`, `/api/marketing/copilot/sessions/[sessionId]/export` |
| Customer Intelligence | `/api/marketing/customer-intelligence/dashboard/context`, `/api/marketing/customer-intelligence/dashboard/overview`, `/api/marketing/customer-intelligence/dashboard/rfm`, `/api/marketing/customer-intelligence/dashboard/clusters`, `/api/marketing/customer-intelligence/dashboard/intersections` |
| System | `/api/system/capabilities`, `/api/system/health`, `/api/system/schema` |

### Controles transaccionales actuales

- `middleware.ts` protege rutas dinámicas salvo `_next`, favicon, login, login API y webhook de WhatsApp.
- `lib/auth.ts` usa `SESSION_SECRET` y cookie HMAC `hub_session` con TTL de 12 horas; también existe `x-admin-bypass-token`.
- `requireOperator` establece un acceso binario de operador; no resuelve rol, equipo, ownership ni permiso de PII.
- `DB_WRITE_ENABLED` funciona como gate global de escrituras.
- Conversations tiene control de take/release/pause/close/reopen y reply, con writer gate.
- Cases tiene reply/close/reopen/priority/block AI.
- Customer create es POST real y auditado, pero está gateado.
- Agent configuration tiene validate/publish/archive/clone, con feedback de concurrencia.
- Catalog, Audiences, Customer Intelligence y Copilot son principalmente read-only desde CRM.

## 7. Auditoría por superficie

### 7.1 Dashboard

`/dashboard` combina métricas de conversaciones, clientes, oportunidades, acciones, outbox/decisions, salud runtime, shortcuts y source map. `lib/dashboard.ts` ejecuta múltiples consultas de existencia/count y health checks en paralelo.

**Valor:** excelente vista de disponibilidad operativa y de qué fuentes alimentan cada módulo.
**Problema:** es un dashboard syndrome: inbox, pipeline, governance, customer directory, runtime y calidad compiten por atención.
**Datos:** reales/partial; usa `conversation`, `master_customer`, `crm_opportunities`, `crm_agent_actions`, `brain_message_outbox`, `crm_agent_decisions` y legacy `n8n_vw_hub_cases`.
**Decisión:** `REDESIGN` como rol/arquitectura de información; conservar los read models y el patrón de source map.

### 7.2 Conversations

La lista consume `lib/domains/conversations`, usa `q` y `page` y abre un panel secundario para el primer seleccionado. El detalle carga thread, contexto del cliente, oportunidad, estado autónomo y acciones.

**Valor:** es el mejor punto de partida para Inbox: thread, ownership humano/IA, control explícito, reply gobernado, customer context, provenance y estados no disponibles. `ConversationWorkspace` adapta el contexto a drawer en viewport pequeño.
**Problema:** lista + panel seleccionado + detalle dedicado duplican mental model. La nomenclatura AI/ownerType/human handoff no está centralizada.
**Datos:** real nativo, con faltantes honestos para órdenes/cotizaciones/facturas.
**Decisión:** `REDESIGN` para separar Inbox de workspace y fijar ownership; conservar controles y evidencia.

### 7.3 Cases

Cases consume `n8n_vw_hub_cases` mediante `lib/domains/cases`. El detalle combina contexto, conversación, AI SDR copilot, reply, acciones y paneles técnicos. La evidencia histórica `docs/product/ui-reference/current/01...06` muestra la superficie anterior a P1M, incluidos errores de columnas, auditoría ausente y leakage técnico.

**Valor:** after-sales/support continuity, prioridad, cierre/reapertura, reply y block AI.
**Problema:** solapa Conversations, depende de legacy, mezcla soporte con AI runtime y expone implementación al operador.
**Datos:** parcial/legacy; el badge de writer disabled es correcto.
**Decisión:** `REDESIGN` como futuro After-sales, con refactor técnico de la fuente; conservar evidencia, historial y guardrails.

### 7.4 Customers / Customer 360

Customers usa `master_customer` como identidad provisional y un snapshot ensamblado por `lib/domains/customer-360`. Muestra linked identities, conversaciones, mensajes, oportunidades, profiles, actions/outcomes, quotes, projected orders, addresses, lifecycle, freshness y completeness.

**Valor:** no inventa una identidad definitiva; declara freshness, completeness, source y warnings. El perfil 360 es una buena read model compuesta.
**Problema:** “Customer 360” puede sonar a Customer Master definitivo aunque la propia norma dice que la identidad sigue provisional. Falta un modelo de permisos de PII.
**Datos:** real/partial, con varias fuentes.
**Decisión:** `KEEP + POLISH`; mantener el modelo de provisionalidad y mejorar IA, ownership y semantics cuando exista Customer Master.

### 7.5 Opportunities

Oportunidades usa `crm_opportunities`, búsqueda `q`, paginación y un panel seleccionado más detalle dedicado. El detalle enlaza Need Profile, timeline, decision, quote, copilot evidence y actions.

**Valor:** se acerca al objeto central del CRM y permite conectar contexto comercial con acciones.
**Problema:** duplicación list/detail; quote/order/shipping aún no forman un flujo completo; stage/ownership no están expresados en un vocabulario común.
**Datos:** reales, pero parciales.
**Decisión:** `KEEP + POLISH`; es base para Commercial Work.

### 7.6 Actions

Actions lee `crm_agent_actions` y muestra status, risk, approval, origin, schedule, owner, preview, rationale, evidence, eligibility, guardrails y missing. No ofrece bulk approval/execution desde la UI.

**Valor:** el mejor puente entre IA, operación y gobernanza.
**Problema:** está aislado; necesita relacionarse con conversación, oportunidad, run/receipt y audit. No debe evolucionar hacia botón genérico de automatización sin contrato R4.
**Datos:** real y read-only.
**Decisión:** `KEEP + POLISH`.

### 7.7 Catalog

`CatalogConsole` consume `/api/catalog/products/search` y `/context` mediante un adapter de `lib/catalog`. Usa búsqueda con mínimo de dos caracteres, debounce de 350 ms, abort controller, límite 10, columna de resultados sticky, detalle seleccionado, precio/stock/availability, recomendaciones lazy y warnings/retry.

**Valor:** es la referencia más fuerte para una read-only surface: límites, provenance, disponibilidad y estados explícitos.
**Problema:** el patrón visual debe convertirse en primitive reusable y la nomenclatura comercial debe alinearse con Opportunity/Quote.
**Datos:** real externo, condicionado por `CATALOG_SERVICE_BASE_URL/API_KEY`.
**Decisión:** `KEEP + POLISH`.

### 7.8 Marketing

Resumen, segmentos, campañas, automations, templates y performance usan `lib/p1m/read-models` y fixtures. `SurfaceBadge kind="fixture"` y `Preview` comunican que no hay backend de producto. Campaign/Automation builders son previews con controles de envío/governance deshabilitados.

**Valor:** existe vocabulario de producto y una posible jerarquía de marketing.
**Problema:** la riqueza visual puede confundirse con disponibilidad; no hay capability real en la mayor parte del módulo.
**Datos:** fixture.
**Decisión:** `BUILD` para capacidades reales; reutilizar conceptos, copy y exploraciones solo como input.

### 7.9 Marketing Copilot

`MarketingCopilotWorkspace` usa sesiones, mensajes, refresh, reset, export y delete. Configuración: `MARKETING_COPILOT_ENABLED`, backend base URL, token interno y timeout. Expone prompts sugeridos, sesión/turn continuity, provenance pinned, read-only, errores normalizados y export XLSX.

**Valor:** patrón fuerte para un copilot de negocio seguro y auditable.
**Problema:** estado cliente grande y sesión efímera; el UI no debe importar providers ni runtime R4.
**Datos:** real externo cuando está habilitado.
**Decisión:** `KEEP + POLISH`; reutilizar su contrato de provenance y observabilidad.

### 7.10 Customer Intelligence y Audiences

Customer Intelligence carga context, overview, RFM, clusters e intersections; mantiene selección local de segmento/cluster y puede pasar población a Marketing Copilot. Audiences carga schema, compila `AudienceDefinitionV1`, evalúa, preview y exporta CSV/XLSX; el backend es autoritativo y CRM no persiste la audiencia.

**Valor:** buenas capabilities de analytics/marketing con contratos externos, selección y export.
**Problema:** densidad y JSON técnico en UI; falta un lenguaje común de filtros/poblaciones y permiso de PII. El código de export advierte que confiar en campos client-side no es suficiente.
**Datos:** reales externos, si flags/tokens están habilitados.
**Decisión:** `KEEP + POLISH`.

### 7.11 Agents y developer surfaces

Sales Agent Configuration es una UI real de configuración/validación/publicación, pero contiene decisiones de runtime que deben alinearse con R4. Follow-ups es observabilidad útil, aunque técnica. AI SDR Simulator y API Docs son herramientas de developer/QA.

**Decisión:** configuración y follow-ups `REFACTOR` hacia una superficie de supervisión basada en contratos R4; simulator y docs `REMOVE` del producto CRM final, conservándolos fuera del recorrido de usuario.

### 7.12 Analytics, Integrations y Settings

Analytics es fixture y mezcla comercial, service, marketing, AI, calidad de datos, operadores e integraciones. Integrations es fixture aunque hay health endpoints. Settings es fixture e incluye user/roles/SSO/2FA/encryption/version/flags sin primitives reales de auth/authorization.

**Riesgo:** estas páginas podrían dar falsa sensación de capacidades operativas.
**Decisión:** Analytics `BUILD`; Integrations y Settings `REPLACE` por superficies reales de Platform/Admin cuando existan contratos y permisos.

## 8. Datos, fuentes y read models

| Surface | Fuente principal | Provenance / completeness | Observación de acoplamiento |
|---|---|---|---|
| Dashboard | tablas nativas + `n8n_vw_hub_cases` + health/config | source map y estados de salud | Alto: SQL, existencia de tablas/campos y legado en `lib/dashboard.ts`. |
| Conversations | `conversation`, messages, autonomy, `master_customer` | estado real, faltantes explícitos | Medio: servicios de dominio; write controls en APIs. |
| Cases | `n8n_vw_hub_cases`, chats, mensajes | parcial/legacy, writer disabled | Alto: vista legacy y contrato de caso. |
| Customers | `master_customer`, identities | provisional, freshness/completeness | Medio/alto: joins y resolver legacy. |
| Customer 360 | conversaciones, messages, opportunities, profiles, actions/outcomes, quotes/orders/addresses/lifecycle | secciones con status/source/warnings | Medio: buena read model; autoridad distribuida. |
| Opportunities | `crm_opportunities`, profiles, quote, actions | real/partial | Medio: enums de backend llegan a UI. |
| Actions | `crm_agent_actions` | evidence/risk/guardrails/missing | Medio: falta vínculo estable con Run/Receipt. |
| Catalog | servicio externo Catalog | availability, stock, public link, warnings | Bajo/medio: adapter HTTP claro. |
| Audiences | Customer Profile Audience Workspace | schema/evaluation/export autoritativos | Bajo/medio: permiso PII aún pendiente. |
| Customer Intelligence | endpoints externos de dashboard | contexto/overview/segmentos | Bajo/medio: varios requests en cliente. |
| Marketing Copilot | backend externo de sesiones | provenance, status de provider | Bajo/medio: proxy/control plane. |
| Marketing preview | fixtures P1M | explícitamente fixture | Bajo técnicamente; producto no disponible. |
| Analytics/Settings/Integrations | fixtures P1M | badge fixture/partial | Bajo técnicamente; riesgo de interpretación. |
| Audit | `hub_audit_log` | limitado a últimas 200 filas | Alto: SQL directo desde page. |

## 9. Arquitectura de componentes y patrones reutilizables

### Primitivas existentes

`PageHeader`, `StatCard`, `StatusChip`, `DataTable`, `AuditTable`, `EmptyState`, `ErrorState`, `HealthStatusCard`, `Icon`, `ModulePreview`, `SectionCard`, `ChartCard`, `InfoGrid`, `SurfaceBadge`, `TabStrip` y `WorkspaceShell` forman una base pequeña y entendible.

### Patrones que conviene conservar

- `SurfaceBadge` para distinguir real, fixture, preview, read-only y not available.
- Empty/error/loading/warning states explícitos y no datos inventados.
- Workspace list/detail con contexto, cuando el objeto realmente lo justifique.
- Provenance, freshness, completeness y source maps.
- `WorkspaceShell`/drawer contextual, con cuidado de no duplicar list + preview + detail.
- `DataTable` como wrapper semántico inicial, antes de ampliarlo con comportamiento.
- Debounced search, abort controller, límites, retry y lazy context de Catalog.
- Session continuity, suggested prompts, provenance y export de Copilot.
- Risk, approval, eligibility, evidence, guardrails y missing de Actions.

### Gaps de primitives

- No existe Input/Select/Button/Modal/Drawer/Toast/Skeleton compartido.
- No existe un contrato común de form validation, dirty state, save/cancel, autosave u optimistic update.
- No existe data grid común con sorting, filtros, paginación, bulk, column visibility, keyboard navigation o virtualization.
- No existe global command palette aunque Topbar presenta `⌘K`.
- No existe permission denied/offline/service unavailable global.
- Loading es texto inline salvo algunos `loading.tsx`; no hay skeleton system.

## 10. Búsqueda, filtros y tablas

### Búsqueda observada

- Global search: visual y `readOnly`; no ejecuta consulta.
- Conversations: `q` por URL; detalle carga thread y older messages con `before`.
- Customers: `search` y `page` por URL.
- Opportunities/Actions: `q` y `page` por URL.
- Cases: búsqueda/filtros por URL.
- Follow-ups: varios filtros por URL.
- Catalog: estado local + búsqueda server-side con debounce.
- Audiences/Customer Intelligence: estado local para selección/segmentos.
- Marketing fixtures: chips y filtros visuales, sin capability de búsqueda comparable.

La URL es reproducible en varios listados, pero el comportamiento no es consistente. No hay fuzzy/global/semantic search. No hay persistencia en cookie o DB.

### Tablas

Hay `DataTable` compartido en dashboard, conversations, cases, customers, audit, WhatsApp y audience preview; Actions/Follow-ups y varias páginas marketing usan tablas nativas. La paginación existe de forma manual en cases, opportunities, actions y follow-ups; conversaciones/clientes exponen page en APIs pero la experiencia de navegación es incompleta en los fragmentos revisados. No hay sorting, column resize/visibility, bulk actions ni grid keyboard model común.

## 11. Formularios, mutaciones y estados

Se usan clases `hub-input` y controles ad hoc. `CustomerCreateForm` tiene campos controlados, required, email type, error handling y POST auditado. `SalesAgentConfigurationWorkspace` muestra el patrón más maduro: validación, operaciones de configuración y feedback de concurrencia. Audience Builder aporta validación schema-driven.

Reply/composer de Conversations y Cases repiten parte de la lógica y gatean escrituras. Los builders de Marketing son fixtures deshabilitados.

No hay patrón transversal para:

- dirty state y navegación con cambios no guardados;
- autosave o optimistic update;
- cancel/undo;
- toast/notification de éxito/error;
- permisos de campo o de PII;
- manejo único de conflicto de concurrencia.

## 12. Responsive y accesibilidad

### Responsive

| Área | Evaluación | Evidencia |
|---|---|---|
| Shell global | Parcial | Sidebar solo desde `lg`; no mobile nav. |
| Conversations | Buena en contexto, parcial en shell | drawer contextual responsive, pero workspace/lista es desktop-first. |
| Catalog | Buena/parcial | una columna fuera de `xl`, sticky solo en desktop. |
| Cases | Parcial a desktop-only | shell de tres columnas y alturas fijas. |
| Dashboard/listas | Parcial | grids responsive, falta navegación móvil y grid behavior común. |
| Copilot/CI | Parcial | columnas `xl`/`2xl`, min-heights y JSON técnico. |
| Marketing builders | Parcial | preview visual, muchas dependencias de desktop. |

### Accesibilidad observada

Fortalezas: `nav`, `main`, headings, labels explícitos en Catalog/login, botones/enlaces semánticos, algunos `aria-label`, `aria-hidden` para iconos y submit con teclado.

Gaps: inputs de búsqueda/filtros sin labels consistentes; `DataTable` sin caption/headers scope común; algunos icon buttons no tienen nombre suficiente; overlay de drawer usa `div onClick` sin modelo de teclado; no hay focus-visible global claro; estados dependen a veces de color; labels técnicos/uppercase reducen claridad; disabled controls no siempre explican la razón; JSON en `<pre>` expone detalle técnico.

No se afirma conformidad WCAG.

## 13. Errores, loading, empty, partial y permisos

`EmptyState`, `ErrorState`, SurfaceBadge y warnings son una buena base. Catalog, Copilot, Audience y Customer Intelligence manejan loading/error/retry/degraded en forma específica; Conversations tiene `loading.tsx`, thread empty/error y load older.

Faltan:

- skeleton compartido;
- toast y confirmación consistente;
- error boundary global y taxonomy de errores;
- estados offline/service unavailable/permission denied;
- jerarquía común para partial data;
- mensaje común cuando una capacidad está deshabilitada por flag/config/permiso.

El permiso hoy suele manifestarse como 401, error de endpoint o botón disabled. Eso no reemplaza un modelo de autorización.

## 14. Estados y lenguaje de producto

`lib/status.ts` solo cubre algunos canonical statuses; varias pantallas implementan `tone` local. Se mezclan estados técnicos en inglés con copy en español y términos de producto: `human_required`, `requires_human`, `requires_review`, `open`, `closed`, `Quote pending`, `Esperando cliente`, `AI SDR`, `SalesNeedProfile`, `read-only`, `Preview`.

**Hallazgo:** `StatusChip` centraliza tonos, pero no centraliza label, definición, icono, transición, actor responsable ni categoría. El color semántico tampoco está totalmente separado del color de marca; por ejemplo, algunos cards usan `primary-container` para error.

**Necesidad futura:** un status registry interno → label localizado → semantic tone → icon → explicación → permisos/transiciones. Esta auditoría no diseña ese registro.

## 15. Identidad visual y brand integration

La identidad actual es reconocible: “PesasChile HUB”, icono Material Symbols `hub`, badge “P1M”, lenguaje “AI Operations”, Hanken Grotesk, crimson/pink como primary, sidebar navy y superficies claras.

La integración es parcial:

- no se identificó un logo asset en `public`;
- no hay set formal de brand assets ni templates de email;
- Material Symbols depende de Google en layout;
- colores slate/emerald/sky/amber/red aparecen junto al palette custom;
- hay colores raw/ad hoc en casos y shadows;
- no hay dark mode ni sistema de motion;
- no hay reglas centralizadas para semantic color vs brand color.

La recomendación es preservar tokens y tipografía existentes como evidencia, pero no convertir los previews P1M en “brand system” sin una definición posterior.

## 16. Observabilidad de agentes y disposición para R4

### Ya existe

- `crm_agent_actions` con lifecycle, risk, approval, owner, schedule, evidence, eligibility y guardrails.
- follow-up observability con list/detail/summary.
- Sales Agent Configuration con validate/publish/archive/clone/effective.
- `brain_message_outbox`, decisions, autonomous state y health checks visibles en algunos puntos.
- audit log real, aunque con acceso directo SQL y límite de 200 filas.
- Conversations explicita ownership y capacidad de pause/take/release.

### Falta para una UI verdaderamente durable

- IDs y contratos estables para Agent/Task/Run/Goal/Artifact/Observation/Action/Receipt.
- enlace uniforme entre propuesta, aprobación, ejecución, resultado y error.
- handoff humano y ownership como primer-class, no solo status.
- execution timeline durable y queryable.
- policy decision explicable sin exponer chain-of-thought.
- capability/permission model del operador.
- correlation IDs, retries, idempotency y state transitions consistentes.
- evaluación del agente visible como resultado estructurado.

### Riesgo de llevar el runtime actual a CRM

La presencia de `lib/brain/**` y `/api/brain/**` hace posible que UI y runtime crezcan acoplados. El futuro rediseño debe mantener CRM como control plane/observability/supervision y R4 como execution plane genérico. El Copilot de Marketing puede seguir siendo una capability de negocio consumida por contrato; no debe convertirse en import directo de R4.

## 17. Deuda y riesgos priorizados

| Prioridad | Tema | Impacto | Evidencia / por qué importa |
|---|---|---|---|
| P0 | Autorización real | Riesgo de seguridad y PII | `requireOperator` es binario; no User/Team/Role/Permission; export advierte sobre confiar en cliente. |
| P0 | Frontera CRM/R4 | Riesgo arquitectónico y de gobernanza | `lib/brain/**`, `/api/brain/**` y orchestration viven dentro del CRM. |
| P0 | Verdad de fixtures | Riesgo de decisión/expectativa | Marketing, Analytics, Integrations y Settings parecen completos pero usan fixtures. |
| P1 | Separar mental models | Impacto alto en adopción | Dashboard, Conversations/Cases y list + panel + detail duplican contexto. |
| P1 | Estado y copy | Confusión operativa | Enums técnicos y labels no centralizados. |
| P1 | Acoplamiento SQL/legacy | Coste y fragilidad | `lib/dashboard.ts`, página Audit, Cases y Customer services. |
| P1 | Mobile/accessibility | Alcance y operación | Sidebar desktop-only, overlays sin keyboard, labels/captions inconsistentes. |
| P1 | Data grid/form primitives | Velocidad y coherencia | Cada módulo implementa búsqueda, tabla y feedback a su manera. |
| P2 | Command palette/global search | Productividad | `⌘K` visual sin comportamiento; no hay búsqueda global. |
| P2 | Brand system | Coherencia visual | tokens existen, pero semantics/ad hoc colors divergen. |
| P2 | Developer surfaces | Claridad de producto | simulator/API docs/legacy paths coexisten con navegación de operador. |

## 18. Reuse map

### Reutilizar directamente

- `SurfaceBadge`, `EmptyState`, `ErrorState`, `StatusChip` como base, con ampliación controlada.
- `Icon`, `PageHeader`, `SectionCard`, `InfoGrid`, `TabStrip`, `WorkspaceShell`.
- Catálogo: búsqueda debounced, abort, límites, detail context, availability/stock, retry/warnings.
- Copilot: session/turn continuity, suggested prompts, provenance pinning, refresh/reset/export.
- Customer 360: freshness/completeness/source/warnings y provisional identity.
- Actions: evidence/risk/approval/eligibility/guardrails/missing.
- Servicios/read models de dominios como seams, no sus consultas directas en UI.

### Reutilizar solo como referencia conceptual

- Dashboard y Analytics: categorías y métricas, no su layout denso ni fixtures.
- Marketing builders: vocabulario de campañas/automation y estados de governance, no datos/controles simulados.
- Cases: continuidad, prioridad, reply y AI assist, no el shell legacy ni leakage técnico.
- Sales Agent Configuration/Follow-ups: necesidades de supervisión, no runtime interno ni enums sin contrato.
- WhatsApp: canal y trazabilidad, no página standalone.

### No trasladar al futuro CRM web

- Fixture numbers, fake health/capacity/SSO/2FA/deployment/version.
- `hub_session` como autorización final.
- Import directo de `lib/brain`/providers/runtime.
- SQL desde páginas de producto.
- Enums técnicos sin copy/semantics.
- Developer tools en la navegación de operador.
- Botones deshabilitados sin motivo o controles decorativos (`⌘K`, notifications, help).

## 19. Clasificación maestra

Las decisiones son únicamente: `KEEP`, `KEEP + POLISH`, `REFACTOR`, `REDESIGN`, `REPLACE`, `REMOVE`, `BUILD`.

| Superficie / concepto | Decisión | Motivo corto |
|---|---|---|
| Shell global | REDESIGN | Base simple, pero IA, mobile nav y product boundaries insuficientes. |
| Dashboard | REDESIGN | Mucho valor, demasiados mental models juntos. |
| Conversations + detail | REDESIGN | Mantener evidencia/controls, separar Inbox y context workspace. |
| Cases + detail | REDESIGN | Mantener after-sales evidence, retirar legacy/technical leakage. |
| Customers + Customer 360 | KEEP + POLISH | Read model y provisional identity son buenos. |
| Opportunities | KEEP + POLISH | Base correcta para Commercial Work. |
| Actions | KEEP + POLISH | Governance read model fuerte. |
| Audit | KEEP + POLISH | Fuente real; necesita adapter, filtros y contexto. |
| Catalog | KEEP + POLISH | Mejor patrón read-only/externo existente. |
| Audiences | KEEP + POLISH | Capability externa con contrato y export. |
| Customer Intelligence | KEEP + POLISH | Datos reales; densidad y PII por mejorar. |
| Marketing Copilot | KEEP + POLISH | Buen control plane y provenance. |
| Marketing fixtures | BUILD | Conservar conceptos, construir verdad backend. |
| Analytics fixture | BUILD | Necesita definiciones y datos reales. |
| Integrations fixture | REPLACE | Debe consumir salud/capabilities reales. |
| Settings fixture | REPLACE | No debe simular auth/roles/security. |
| Agent Configuration | REFACTOR | Mantener supervisión, mover runtime contracts a R4. |
| Follow-ups | REFACTOR | Mantener observabilidad, normalizar Agent/Run/Action. |
| `/agents` placeholder | REMOVE | No capability actual; evitar promesa vacía. |
| `/dev/ai-sdr-simulator` | REMOVE | Developer/QA, fuera del producto CRM. |
| `/dev/api-docs` | REMOVE | Developer tool, fuera del shell operador. |
| WhatsApp standalone | REMOVE | Absorber como canal dentro de Inbox/Platform. |
| Customer Master standalone | REMOVE | Integrar como evolución de Identity/Customers. |
| Knowledge fixture/orphan | REMOVE | Sin capability real ni lugar claro actual. |
| Legacy redirects | REMOVE | Mantener compatibilidad temporal, no nueva UX. |

## 20. Backlog de investigación para la siguiente fase

Antes de diseñar pantallas nuevas conviene resolver, en este orden:

1. Modelo de User/Team/Role/Permission/PII y ownership.
2. Contrato CRM ↔ R4 para Agent/Task/Run/Action/Receipt/Approval/Handoff/Evaluation.
3. Definición de mental models y navegación objetivo.
4. Status registry y taxonomy de errores/partial data.
5. Fuente autoritativa de Customer Master e identidad.
6. Contractos reales de Marketing, Analytics, Integrations y Settings.
7. Primitives de grid, forms, feedback, drawer/modal, responsive y accessibility.
8. Estrategia de búsqueda global/command palette.
9. Criterios de retiro de legacy y de permanencia de developer tools.
10. Browser QA real sobre los flujos priorizados.

## 21. Cambios realizados y validación

Cambios de esta auditoría:

- Añadido `docs/product/CRM_WEBAPP_CURRENT_STATE_AUDIT.md`.
- Añadido `docs/product/CRM_WEBAPP_REDESIGN_INPUTS.md`.

No se modificaron código de UI, backend, base de datos, esquema, auth, rutas, dependencias, build/deploy, release state, commit ni push.

Validación prevista: `git diff --check` y revisión de `git status --short` sobre los dos archivos documentales.
