# CRM Web App — Redesign Inputs

**Propósito:** entregar a la siguiente fase un input de producto y arquitectura de información basado en el estado real del repositorio.
**No es:** una especificación visual, una solución de componentes ni una autorización de implementación.
**Fuente:** `docs/product/CRM_WEBAPP_CURRENT_STATE_AUDIT.md`, inspección de código a `6816f94cdccc6315822abb3ae53ece1faa13bd79`.

## 1. Decisión marco

La futura CRM Web App debe consolidar operación humana, contexto comercial y supervisión gobernada de agentes en un solo producto entendible. No debe tratar todas las páginas actuales como módulos equivalentes ni trasladar fixtures o runtime interno al nuevo diseño.

La estrategia recomendada es:

- preservar los read models y patrones de evidencia que ya funcionan;
- separar mental models que hoy conviven en Dashboard, Conversations, Cases y Agent surfaces;
- construir capacidades reales donde hoy hay fixtures;
- mantener CRM como experiencia de operación/control plane y R4 como execution plane genérico;
- hacer que la UI exprese siempre fuente, frescura, completitud, permisos y estado de capacidad.

## 2. Verdades que el diseño debe respetar

1. La identidad de cliente es provisional hasta que exista un `customer_master` autoritativo.
2. Una vista 360 puede ser un read model ensamblado y no una fuente de verdad única.
3. El modelo propone; el backend valida, gobierna y ejecuta.
4. Una acción propuesta no equivale a una acción ejecutada.
5. Un fixture, preview o partial no puede presentarse como capacidad productiva.
6. El usuario debe poder distinguir humano, IA, sistema, pendiente de aprobación y no disponible.
7. El contexto de R4 se consume mediante contratos; la UI no importa runtime, providers ni tablas internas.
8. La ausencia de órdenes, cotizaciones o facturas es un estado legítimo y debe expresarse sin inventar datos.

## 3. Usuarios y trabajos principales

### Operador de conversaciones

- Encontrar conversaciones que requieren atención.
- Entender el cliente y el contexto comercial sin abandonar el thread.
- Responder, tomar/liberar, pausar, cerrar o reabrir con permiso explícito.
- Saber si la IA actuó, propuso o quedó bloqueada.

### Soporte / after-sales

- Continuar un caso con historial y prioridad.
- Responder o escalar con trazabilidad.
- Distinguir dato de caso, sugerencia de AI SDR y decisión humana.

### Comercial

- Trabajar una oportunidad con cliente, need profile, cotización y acciones relacionadas.
- Consultar catálogo con stock/precio/disponibilidad actual.
- Entender siguiente mejor acción y qué evidencia la justifica.

### Supervisor de operaciones

- Ver colas, salud, ownership, riesgos, acciones pendientes y handoffs.
- Aprobar, rechazar, pausar o investigar acciones según políticas.
- Auditar qué ocurrió y con qué fuente.

### Marketing / analista

- Entender poblaciones, segmentos, RFM, clusters y performance.
- Usar Copilot con provenance y exportar resultados.
- Crear campañas/automatizaciones solo cuando existan backend, permisos y governance reales.

### Admin / platform operator

- Gestionar integraciones, capacidades, configuración y permisos reales.
- Ver salud y límites sin depender de fixtures.

## 4. Mental models que deben separarse

Esta separación es una hipótesis de producto a validar, no un sitemap final:

```text
Operate
├─ Inbox / Conversations
├─ After-sales / Cases
└─ Commercial Work / Opportunities

Understand
├─ Customers / Identity
├─ Catalog
├─ Marketing / Audiences
└─ Analytics

Supervise
├─ Agent Activity / Actions
├─ Approvals / Handoffs
├─ Audit / Receipts
└─ Platform Health
```

Dashboard debe dejar de ser el contenedor por defecto de todas estas cosas. Puede ser una vista de trabajo configurable o un resumen operacional, pero no debe mezclar inbox, pipeline, runtime, customer directory y platform health sin jerarquía clara.

## 5. Disposición de superficies actuales

| Superficie actual | Uso como input futuro |
|---|---|
| Dashboard | Reutilizar métricas, source map y health contracts; rediseñar propósito y densidad. |
| Conversations | Reutilizar thread, ownership, controls, customer context y partial states; separar lista, workspace y contexto. |
| Cases | Reutilizar historial, prioridad, reply y evidencia; retirar shell legacy y leakage técnico. |
| Customers/360 | Mantener provisional identity, freshness, completeness, source y warnings. |
| Opportunities | Mantener como base de Commercial Work; completar relación con quote/order/action. |
| Actions | Mantener como governance read model; conectarlo con Agent/Task/Run/Receipt. |
| Catalog | Adoptar como referencia de búsqueda/detail, límites, availability y retry. |
| Audiences | Mantener contrato externo, compilación, evaluación y export; formalizar permisos de PII. |
| Customer Intelligence | Mantener capacidades reales; simplificar densidad y payload técnico. |
| Marketing Copilot | Mantener session/provenance/read-only/export; no acoplarlo a R4 runtime. |
| Marketing previews | Usarlos como exploración de vocabulario; construir backend/product truth después. |
| Analytics | Redefinir métricas, ownership y fuentes antes de reconstruir gráficos. |
| Integrations | Reemplazar fixture por capabilities/health reales. |
| Settings | Reemplazar fixture por auth/authorization/admin reales. |
| Agent Configuration | Mantener experiencia de supervisión; mover semántica de runtime a contrato R4. |
| Follow-ups | Mantener observabilidad; normalizar entidades y estados. |
| Audit | Mantener como producto; esconder SQL y dar filtros, scope y links de evidencia. |
| WhatsApp | Tratarlo como canal, no como módulo paralelo. |
| Customer Master | Tratarlo como evolución de Identity/Customers, no página independiente. |
| Developer tools | Mantener fuera del shell de usuario final. |

## 6. Shell, navegación y contexto

La próxima definición debe decidir explícitamente:

- qué ve un operador, un supervisor, marketing, comercial y admin;
- qué se filtra por permiso, equipo, ownership y environment;
- qué significa `Preview`, `Partial`, `Read-only`, `Unavailable` y `Fixture`;
- cómo se llega a una acción, a su evidencia y a su resultado;
- cómo se evita duplicar el mismo objeto en panel lateral, detalle y drawer.

El shell actual aporta logo verbal, Hanken Grotesk, Material Symbols, sidebar oscura, superficies claras y tokens crimson/navy. Es una base de continuidad, no un brand system completo. La definición visual deberá conservar el reconocimiento sin asumir que todos los colores ad hoc actuales son semánticamente correctos.

## 7. Flujo prioritario a validar

El flujo de mayor valor para el siguiente diseño es una intervención operacional completa:

```text
Encontrar trabajo
  → abrir conversación/caso/oportunidad
  → leer contexto y provenance
  → entender propuesta/acción de IA
  → validar permiso, policy y missing data
  → intervenir o aprobar
  → ejecutar mediante backend gobernado
  → recibir receipt/resultado
  → dejar audit trail y siguiente ownership
```

La pantalla no debe ocultar la diferencia entre:

- sugerencia y ejecución;
- acción elegible y acción aprobada;
- acción aprobada y acción confirmada;
- ownership de IA y ownership humano;
- dato disponible y dato todavía no conectado.

## 8. Contratos y entidades que la UI necesita

### CRM

- Customer / provisional identity / linked identity.
- Conversation / Case / Channel / Message.
- Opportunity / Need Profile / Quote / Order reference.
- Campaign / Audience / Segment / Template.
- Action / approval / outcome / audit event.

### R4

- Agent, Task, Run, Goal, Artifact, Observation.
- Capability, Action, Receipt, Policy.
- Schedule, Consultation, Approval, Handoff, Evaluation.

La UI futura debe tener IDs, timestamps, actor/source, status, provenance, policy result y links de navegación estables. No debe recibir chain-of-thought ni inferir éxito desde un botón optimista.

## 9. Frontera CRM ↔ R4

### CRM conserva

- contexto de cliente, conversación y oportunidad;
- copy, navegación y experiencia humana;
- decisión de cuándo presentar una propuesta de agente;
- intervención, aprobación y escalamiento según permisos;
- representación de receipt, outcome, error, audit y evaluation;
- analytics y marketing de dominio.

### R4 posee

- loop de agente, providers, capabilities y ejecución durable;
- policy enforcement genérico;
- tasks/runs/receipts/handoffs/evaluations;
- retries, idempotency, schedule y state transitions genéricas;
- persistencia interna del runtime.

### No llevar al contrato

- SQL o tablas internas del otro sistema;
- imports de `lib/brain` desde componentes CRM;
- `Quote`, `Cart`, `Opportunity`, `Campaign`, `Product` o `Payment` dentro de R4 Core;
- copy de UI como si fuera un enum de runtime;
- datos fixture como fallback silencioso.

## 10. Estados de producto requeridos

Toda superficie relevante debe poder representar, como mínimo:

- loading inicial y refresh;
- empty legítimo;
- no disponible por fuente o capability;
- partial por datos incompletos;
- stale por freshness;
- error recuperable con retry;
- permission denied;
- conflict/concurrency;
- read-only;
- preview/fixture, separado visualmente de real;
- success con evidencia del resultado.

Para acciones y agentes agregar:

- proposed;
- requires review;
- approved;
- queued;
- running;
- succeeded;
- failed;
- blocked by policy;
- handed off;
- expired/cancelled.

La fase siguiente debe definir labels, tonos semánticos, iconos, copy y transiciones en un registry único. `StatusChip` actual es un punto de partida, no el contrato final.

## 11. Primitives y patrones a formalizar

Sin implementar todavía, la siguiente fase debería evaluar primitives compartidas para:

- Input, Select, Combobox y date/filter control con label, hint y error;
- Button con loading, disabled reason y confirmación;
- Modal, Drawer y focus trap accesibles;
- Toast/notification y inline feedback;
- Skeleton, ErrorState, EmptyState, PartialState y PermissionState;
- Data grid con URL filters, sort, pagination, bulk, column visibility y keyboard model;
- Evidence/Provenance block;
- Status registry;
- Read-only / Preview / Fixture badge;
- Timeline de thread/action/run/audit;
- Customer context panel sin duplicación entre superficies.

Los componentes existentes `PageHeader`, `DataTable`, `ErrorState`, `EmptyState`, `SurfaceBadge`, `WorkspaceShell`, Catalog patterns y Copilot patterns son candidatos de base.

## 12. Search, filters y navegación reproducible

Requisitos de investigación:

- diferenciar búsqueda global de búsqueda por módulo;
- decidir si `⌘K` será command palette real o debe eliminarse;
- conservar filtros operativos en URL cuando el estado sea compartible;
- documentar qué filtros son locales, persistentes o por permiso;
- definir fuzzy/semantic search solo con fuente y límites claros;
- permitir volver a una lista conservando query, page y selection;
- no cargar datos sensibles solo porque el usuario conoce un ID;
- asociar resultados con entidad, source, freshness y permission.

Catalog prueba que debounce, abort, límites y resultados condicionados funcionan bien. Ese patrón puede informar la futura búsqueda, pero no implica que toda búsqueda deba ser client-side.

## 13. Formularios y mutaciones

La siguiente fase debe especificar:

- quién puede editar cada campo;
- qué cambios requieren approval;
- cuándo aparece dirty state;
- qué significa cancel, undo, retry y duplicate submit;
- cómo se informa conflicto de concurrencia;
- cuándo se permite optimistic update;
- qué queda en audit y con qué actor;
- cómo se bloquea PII en exports y previews.

`CustomerCreateForm`, Audience Builder y Sales Agent Configuration aportan casos reales distintos. No conviene forzar un único patrón de guardado sin clasificar primero configuración, operación, reply, aprobación y export.

## 14. Responsive y accesibilidad como requisito de producto

La definición debe incluir mobile y no limitarse a que el grid haga wrap. Puntos a resolver:

- navegación móvil global, no solo esconder Sidebar;
- estrategia para list/detail en viewport angosto;
- drawer con focus trap, escape, focus return y teclado;
- tablas que puedan convertirse en cards o filas navegables;
- labels, captions, scope, descriptions y error associations;
- focus-visible y contraste de semantic statuses;
- no depender exclusivamente de color o uppercase técnico;
- explicar por qué un control está disabled;
- anunciar loading/error/success para screen readers.

No existe evidencia de conformidad WCAG actual; debe planificarse una revisión específica.

## 15. Content y lenguaje

El producto debe escoger un vocabulario único y mantener copy en español operativo cuando el usuario sea hispanohablante, dejando nombres técnicos solo en disclosure. El futuro registry debe resolver, por ejemplo:

| Concepto actual | Decisión que falta |
|---|---|
| `human_required` / `requires_human` | Un concepto visible: requiere intervención humana. |
| `requires_review` / approval | Diferenciar revisión, aprobación y ejecución. |
| `AI SDR` / agent | Definir si es rol, capability, agente o worker. |
| `open` / `closed` | Asignar a Conversation, Case, Action y Opportunity por separado. |
| `Preview` / `Fixture` / `Partial` | Diferenciar producto futuro, datos simulados y backend incompleto. |
| `read-only` | Explicar si es por diseño, permiso o falta de writer. |
| `Esperando cliente` | Relacionarlo con actor y transición, no solo tono. |

## 16. Datos y provenance visibles

Cada módulo debe poder responder en UI:

- ¿de dónde viene este dato?
- ¿cuándo fue actualizado?
- ¿es definitivo, provisional, calculado o sugerido?
- ¿qué campos faltan?
- ¿qué fuente falló?
- ¿quién puede verlo o modificarlo?
- ¿qué parte viene de una integración externa?

Customer 360, Catalog, Copilot y Actions ya tienen piezas reutilizables. Dashboard y Audit necesitan extraer la misma lógica desde sus consultas directas.

## 17. Observabilidad y trust model

Una futura superficie Agent Activity/Audit debe priorizar:

- timeline de propuesta → approval → run → receipt → outcome;
- actor y ownership en cada transición;
- correlation ID y links a entidad CRM;
- policy decision y missing prerequisites;
- retry/cancel/expired sin prometer ejecución;
- evaluación y calidad como resultado estructurado;
- logs técnicos en disclosure, no en el camino principal;
- no almacenar ni mostrar chain-of-thought.

El actual Actions detail es el mejor punto de partida conceptual. Follow-ups, outbox y autonomous state deben integrarse solo mediante contratos estables.

## 18. Priorización de la siguiente fase

### P0 — decisiones bloqueantes

- modelo de autorización, equipos, ownership y PII;
- contrato CRM ↔ R4;
- definición de superficies reales versus fixture;
- fuente de identidad y Customer Master;
- taxonomy de estados y errores.

### P1 — diseño de experiencia

- arquitectura de información y mental models;
- flujo Inbox/After-sales/Commercial Work;
- Agent Activity/Actions/Audit;
- grid/forms/feedback primitives;
- responsive/accessibility;
- búsqueda global y filtros reproducibles.

### P2 — maduración

- brand system formal;
- performance/virtualization si las cargas lo justifican;
- analytics real y marketing productivo;
- consolidación de legacy redirects y developer surface packaging.

## 19. Preguntas abiertas que requieren decisión humana

1. ¿Qué roles y equipos existen realmente en la primera versión autorizada?
2. ¿Qué acciones puede aprobar cada rol y cuáles requieren segunda aprobación?
3. ¿Qué significa “owner” cuando la acción fue propuesta por IA pero ejecutada por un humano?
4. ¿Qué fuentes de identidad pueden vincularse automáticamente y cuáles requieren confirmación?
5. ¿Cuál es el sistema autoritativo de oportunidades, quotes, orders y lifecycle?
6. ¿Marketing será un módulo operativo en esta fase o seguirá como roadmap?
7. ¿Qué debe quedar visible para operadores respecto de R4 y qué debe ser disclosure técnico?
8. ¿Cuál es la política de retención/export de PII y audit?
9. ¿Qué dispositivos y navegadores son parte del soporte oficial?
10. ¿Qué métricas de adopción y calidad validan que el rediseño mejoró la operación?

## 20. Criterios de aceptación para el diseño posterior

La siguiente fase debería demostrar, al menos:

- un operador puede encontrar y resolver una conversación sin perder contexto;
- un soporte puede diferenciar caso, thread y sugerencia de IA;
- un comercial puede avanzar una oportunidad con catálogo y evidencia;
- un supervisor puede entender y gobernar una acción completa;
- cada estado parcial/error/permission/fixture tiene copy y comportamiento claros;
- no se presenta un fixture como dato real;
- no se depende de imports ni tablas internas de R4;
- la navegación móvil y keyboard path están definidos;
- la fuente/frescura/completitud de datos se mantiene visible;
- los conceptos de usuario no dependen de enums técnicos sin traducción;
- los flujos críticos dejan audit trail y receipt/outcome verificable.

## 21. Entregables sugeridos para la fase siguiente

1. Mapa de información validado con usuarios por rol.
2. Contract matrix CRM ↔ R4.
3. Status/error/provenance registry.
4. Permission and PII matrix.
5. Flujos de Inbox, After-sales, Commercial Work y Agent Activity.
6. Inventario de primitives con criterios de accesibilidad.
7. Browser QA plan y fixtures de prueba explícitos.
8. Plan de retiro de legacy/redirects/developer surfaces.
9. Decisión de qué previews pasan a BUILD y con qué backend.
10. Roadmap aprobado antes de modificar código.

## 22. Guardrails de implementación

Mientras no se apruebe la siguiente fase:

- no diseñar ni implementar pantallas nuevas por inferencia;
- no mover `lib/brain` a R4 por refactor oportunista;
- no inventar usuarios, roles, métricas, health states o datos comerciales;
- no convertir fixtures en fallback silencioso;
- no ampliar permisos por conveniencia de UI;
- no agregar infraestructura sin necesidad demostrada;
- cada cambio de producto debe incluir evaluación y evidencia de estados reales.
