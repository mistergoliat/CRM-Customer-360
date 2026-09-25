---
title: CRM WebApp - Commercial Core Architecture Audit
doc_id: crm-commercial-core-architecture-audit
status: historical
created_at: 2026-09-25
commit: 28ab23dd495817240ed11dc455a6234affd80e82
type: read-only architecture audit
supersedes: []
tags:
  - audit
  - crm
  - commercial-core
---

# CRM WebApp - Commercial Core Architecture Audit

## 1. Executive verdict

**CONFIRMED (repositorio):** hay un núcleo comercial operativo parcial alrededor de crm_opportunities, decisiones, acciones del agente, solicitudes de conversación, perfiles de necesidad y estado de trabajo comercial. El runtime nativo de WhatsApp es la autoridad comercial habilitada por defecto; la interfaz de oportunidades consume un read model respaldado por MariaDB.

**CONFIRMED (repositorio) / INFERRED (comparación contra el modelo objetivo):** ninguna de las 16 primitivas evaluadas satisface por completo el modelo objetivo solicitado. Doce tienen una implementación parcial, heredada, implícita, sólo de runtime o como proyección. Cuatro no aparecen como primitivas comerciales de primera clase en las fuentes revisadas: Account/Organization, AccountContact, Acquisition/Attribution Event y Pipeline configurable. Esta cuenta mide correspondencia arquitectónica con el modelo objetivo, no cobertura de código.

**CONFIRMED:** Customer, External Identity, Opportunity, Need Profile, Quote Service, Order projection, Conversation, Commercial Work y Customer Lifecycle ya tienen una representación reconocible bajo nombres y owners distintos. No deben duplicarse antes de reconciliar contratos y ownership.

**INFERRED:** hoy puede mostrarse un inbox de oportunidades de sólo lectura y agruparse por el valor persistido de stage. No hay base suficiente para un Kanban comercial editable con ownership, etapas configurables, actividades humanas ni enlaces completos Quote → Order. El valor de presupuesto mostrado como valor estimado no es un importe de oportunidad persistido.

**UNVERIFIED:** no se leyó la RDS ni se consultó un servicio externo. La presencia de una migración en el repositorio no confirma que esté aplicada en producción; los datos, flags y rutas externas activos no se verificaron.

## 2. Evidence scope

- **CONFIRMED:** el checkout examinado fue develop, commit 28ab23dd495817240ed11dc455a6234affd80e82; el árbol de trabajo estaba limpio al comenzar.
- **CONFIRMED:** se revisaron los documentos rectores requeridos (AGENTS.md, docs/PRODUCT_NORTH_STAR.md, docs/ACTIVE_RELEASE.md, docs/ROADMAP.md), el mapa de ejecución de producto y los contratos/ADRs citados por ellos. Se hicieron búsquedas estáticas en migraciones, todos los archivos bajo lib/domains, lib/integrations y lib/brain/commercial para descubrir estado comercial persistido, todos los API routes, superficies Customers/Opportunities/Conversations/Cases/Dashboard, fixtures y documentación relacionada.
- **CONFIRMED:** R4 queda fuera de esta auditoría. Sólo se anotan dependencias comerciales visibles sobre estructuras R1/R2/R3; no se auditan Agent, Task, Run, Action, Receipt, Handoff, Approval ni Evaluation de R4.
- **CONFIRMED:** no se ejecutaron pruebas, build ni typecheck. No se ejecutó SQL ni consulta de sólo lectura contra una base; tampoco se llamó a Customer Service, Quote Service o PrestaShop.
- **UNVERIFIED:** estado físico de tablas y migraciones en RDS, filas reales, variables de entorno productivas, flags desplegados, endpoints externos, ownership operativo y vigencia de datos.
- **INFERRED:** una búsqueda sin resultados en el código revisado respalda “no encontrado en el repositorio”, no demuestra que una aplicación externa o una base fuera del checkout carezca de esa capacidad.
- **CONFIRMED:** la auditoría anterior de estado de la WebApp declara un baseline de commit 6816f94cdccc6315822abb3ae53ece1faa13bd79; es evidencia histórica anterior al commit auditado. Se prioriza el runtime actual y esta auditoría no modifica el documento anterior.

Etiquetas usadas en cada hallazgo:

| Etiqueta | Significado |
|---|---|
| CONFIRMED | Visible directamente en código, migración o contrato del repositorio en el commit auditado. No afirma despliegue. |
| INFERRED | Conclusión de una búsqueda estática acotada o comparación de estructuras; se indica el límite. |
| UNVERIFIED | Requiere consultar RDS, despliegue, servicio externo o configuración que no fue observada. |

## 3. Current commercial domain map

**CONFIRMED (repositorio):**

    Customer Service externo (autoridad declarada de identidad/master)
                  |
                  v
    master_customer local (proyección usada por el CRM)
                  |
       +----------+----------------------------+
       |                                       |
       v                                       v
    conversation                         customer_external_identity
       |                                  + identity evidence
       |
       +---- crm_conversation_requests ---- crm_opportunities
       |                |                        |
       |                |                        +-- crm_sales_need_profiles
       |                |                        +-- crm_agent_decisions
       |                |                        +-- crm_agent_actions
       |                |                        +-- crm_commercial_work
       |                |                        +-- created_quote locator
       |                |
       |                +-- crm_request_facts -- Quote Service (externo)
       |
       +---- customer lifecycle read model <---- events, actions, outcomes,
                                                quotes, orders and addresses

    PrestaShop ps_orders --> Customer 360 order projection by identity match
    crm_quotes            --> legacy local quote aggregate; not current quote owner

**INFERRED:** no Account/Organization root appears between a person-shaped identity and commercial work. The map is a repository-level relation map, not a complete ERD and not proof that all listed tables exist in the live RDS.

## 4. Canonical entity inventory

El estado de esta tabla expresa su relación con el modelo objetivo y su owner declarado. “Canónico” se refiere al dominio responsable según contratos vigentes; no implica que una tabla local sea una autoridad universal.

| Primitiva | Estado | Persistencia/representación observada | Owner declarado o efectivo |
|---|---|---|---|
| Customer / Person | EXISTS_PARTIAL | master_customer local y Customer 360 provisional | Customer Service para master; CRM lee proyección. Hay un writer local conflictivo descrito en §5. |
| Account / Organization | ABSENT | No se encontró entidad comercial estructurada | Sin owner persistente identificado |
| Contact / AccountContact | ABSENT | No se encontró relación Persona ↔ Organización | Sin owner persistente identificado |
| Customer Identity / External Identity | EXISTS_PARTIAL | customer_external_identity, estado de onboarding y evidence | Customer & Identity / Customer Service; CRM mantiene referencias/proyecciones |
| Acquisition / Attribution | ABSENT | Hay campos aislados de plataforma/canal y enums no persistidos | Sin entidad de adquisición identificada |
| Opportunity | EXISTS_PARTIAL | crm_opportunities y sus escritores del runtime comercial | Commercial Runtime |
| Pipeline | ABSENT | No se encontró entidad/configuración de pipeline | Sin owner/configuración identificados |
| Pipeline Stage | EXISTS_PARTIAL | stage VARCHAR y vocabularios TypeScript con transición hardcodeada | Commercial Runtime; semántica/configuración no unificada |
| Activity / Next Action / Task | EXISTS_PARTIAL / EXISTS_RUNTIME_ONLY | snapshot de siguiente acción, acciones de agente y Commercial Work | Commercial Runtime; no equivale a tarea humana general |
| Commercial Ownership / Assignment | EXISTS_PARTIAL | flags de oportunidad, owner de conversación y escalación por request | No hay owner/team comercial general |
| Need Profile | EXISTS_LEGACY | crm_sales_need_profiles durable, writer consultative heredado | Commercial Runtime declarado; escritura heredada default-off |
| Quote linkage | EXISTS_PARTIAL / DUPLICATED | Quote Service externo + locator en request facts + crm_quotes heredada | Quotes & Transactions / Quote Service |
| Order linkage | EXISTS_AS_PROJECTION | ps_orders / Customer 360 por identidad, sin lineage comercial | Sistema de pedidos externo / Quotes & Transactions |
| Conversation linkage | EXISTS_PARTIAL | FK de conversación a customer; request/work unen conversación y oportunidad | Conversation runtime / Commercial Runtime |
| Lifecycle / Timeline | EXISTS_AS_PROJECTION | eventos fuente y ensamblador Customer 360; timeline de oportunidad reducido | Analytics/read model; fuentes conservan owners propios |
| Commercial source/channel/segment | EXISTS_PARTIAL | platform_origin, channel, intent y customer_type libre | Datos con semánticas distintas; sin clasificación comercial canónica |

## 5. Customer / Person

- **CONFIRMED:** la migración migrations/006_master_customer_platform_origin.sql:4-11 crea master_customer con id autoincremental, firstname, lastname, email y platform_origin; email es único. Esa tabla no declara teléfono, RUT/tax ID, company name, tipo de persona/empresa, address, owner, lifecycle state, creation source ni timestamps.
- **CONFIRMED:** los repositorios locales consultan el subset id, nombre, email y platform_origin (lib/integrations/customer-master/customer-repository.ts). Customer 360 y las conversaciones usan el ID local como referencia/proyección. El contrato de Customer Service mantiene al servicio externo como autoridad de master; el gate de proyección de ACS verifica presencia local sin insertar ni actualizar esa proyección.
- **CONFIRMED:** hay una vía productiva distinta que permite insertar en master_customer: POST /api/customers pasa por isDbWriteEnabled() y llama createCustomer; el repositorio hace INSERT directo. DB_WRITE_ENABLED tiene default false en lib/write-access.ts:4-5.
- **INFERRED:** esa ruta contradice la frontera documental de Customer Service como único creador. El código confirma que la vía existe y está protegida por flag; no confirma que se haya ejecutado ni qué entorno la habilite.
- **UNVERIFIED:** semántica real de cada fila de master_customer. El esquema tiene forma de persona por nombres y email, pero no contiene person_type/is_company ni un contrato de representación de empresas. No se puede concluir si alguna fila actual representa una persona o si una empresa se codificó en esos campos.
- **CONFIRMED:** rut aparece en un tipo de perfil externo (lib/integrations/customer-profile/types.ts), no en master_customer. Fixtures con gimnasio, empresa o RUT no son evidencia de entidad productiva.
- **INFERRED:** el CRM actual puede renderizar una identidad de cliente provisional, pero la tabla no soporta por sí sola un Customer Master con provenance y lifecycle completos.

## 6. Account / Organization

- **INFERRED:** no se encontró tabla, FK, tipo o entidad de producción que modele Account, Organization, Company, Business, gimnasio, mayorista, reseller o institución tras búsquedas en migraciones, perfiles, oportunidades, direcciones, mirror de PrestaShop, quote snapshots, B2B y UI.
- **CONFIRMED:** el perfil externo contiene RUT y la Need Profile contiene customer_type, pero ninguno es una entidad Organization ni tiene relación a una organización.
- **CONFIRMED:** el mirror de PrestaShop examinado contiene customer individual y direcciones/pedidos; no apareció una relación estructurada Organization → Contacts.
- **INFERRED:** la empresa puede aparecer en texto libre, datos de perfil o fixtures, pero no está modelada como Account comercial independiente. No diseñar Account alrededor de un valor inferido de nombre, RUT o texto conversacional.

## 7. Contact relationships

- **INFERRED:** no se encontró una relación N:N Persona ↔ Organization, ni FK equivalente, ni role/title, contacto primario, billing, comercial o técnico.
- **CONFIRMED:** conversation.customer_id referencia un solo master_customer.id; eso modela la identidad asociada a una conversación, no una relación de contacto de cuenta.
- **INFERRED:** no se puede representar como relación de primera clase que un gimnasio o mayorista tenga varios contactos con responsabilidades distintas. No es una afirmación sobre lo que las fuentes externas puedan guardar.

## 8. Customer Identity

- **CONFIRMED:** customer_external_identity (migrations/010_native_whatsapp_identity_and_conversation_controls.sql:12-28) almacena customer_id, provider, identity type, external ID, normalized value y flag de verificación; tiene unicidad por (provider, external_id) y FK local hacia master_customer. migrations/024_reconcile_unresolved_customer_external_identity.sql permite customer_id = NULL para identidad sin resolver.
- **CONFIRMED:** el runtime nativo puede registrar identidad de WhatsApp resuelta o sin resolver. migrations/032_crm_customer_identity_evidence.sql agrega evidencia por señal y estado de conflicto, incluyendo WA ID, teléfono, email, PrestaShop ID, referencia de pedido y verificación manual; esto registra evidencia y no crea un segundo master.
- **CONFIRMED:** el resolver busca identidad de canal y teléfono normalizado, reporta conflicto cuando las señales discrepan o hay varios candidatos y no adivina; el vínculo a PrestaShop requiere una operación explícita.
- **CONFIRMED:** las capacidades de identidad llaman Customer Service y materializan una referencia/proyección local de PrestaShop. Un comentario de lib/domains/customer-identity/local-adapter.ts afirma que no existe writer de identidad PrestaShop, pero contradice el writer actual en lib/brain/commercial/capability-gateway/customerIdentityCapabilities.ts. Registrar el comentario como obsoleto frente al código actual.
- **INFERRED:** la identidad operativa provisional usa wa_id y señales externas; el Customer Master sigue siendo authority externa según contrato. customer_external_identity es persistencia local de vínculo/evidencia, no prueba de una nueva autoridad global.
- **UNVERIFIED:** estado desplegado de Customer Service, correspondencia de IDs y resolución real de perfiles.

## 9. Acquisition / Attribution

- **CONFIRMED:** master_customer.platform_origin es un único valor de plataforma con vocabulario prestashop, pos, whatsapp, instagram, facebook, hub, import, unknown (lib/domains/customers/platform-origin.ts). No guarda eventos ni fechas de touch.
- **CONFIRMED:** crm_opportunities tiene channel y primary_intent, pero no columnas de source, campaign, UTM, referrer, landing page, first touch o latest touch (migrations/004_ai_sdr_operational_loop.sql:4-46).
- **CONFIRMED:** LEAD_SOURCES/LeadSource existen en TypeScript, pero no hay entidad crm_leads ni una relación persistente que adjunte ese enum a Opportunity. lead_id es una cadena nullable sin FK.
- **INFERRED:** las búsquedas en persistencia comercial, eventos, datos de inbound y UI no encontraron un modelo productivo para Campaign/UTM/CTWA attribution o Acquisition Event. Ejemplos en marketing fixtures no acreditan atribución productiva.
- **CONFIRMED:** commercial_event.source identifica fuente de evento/runtime; crm_agent_actions.source es provenance de la acción; ninguna de esas columnas, por sí sola, expresa el origen de adquisición del cliente u oportunidad.
- **Conclusiones directas:**
  - **CONFIRMED:** hay una etiqueta gruesa de plataforma (platform_origin) y canal operativo de Opportunity.
  - **INFERRED:** no puede reconstruirse first touch, latest touch ni campaign con la persistencia comercial revisada.
  - **INFERRED:** el source de una oportunidad no está guardado como relación/atributo de adquisición identificado.
  - **UNVERIFIED:** fuentes de atribución de Meta, PrestaShop u otros sistemas externos fuera del repositorio.

## 10. Segmentation / Customer Type

- **CONFIRMED:** crm_sales_need_profiles.customer_type es nullable VARCHAR(191), sin enum ni FK (migrations/009_crm_sales_need_profiles.sql:4-43). No es atributo canónico de Customer.
- **CONFIRMED:** el motor consultative heredado infiere etiquetas desde expresiones de texto como gimnasio, empresa, particular o mayorista (lib/brain/commercial/sales-consultative/engine.ts).
- **CONFIRMED:** Customer Intelligence/RFM y audiencias de Marketing son filtros o agrupaciones de comportamiento; la superficie Customer Intelligence aparece como read-only y no define una taxonomía Customer Type.
- **INFERRED:** no existe taxonomía canónica Particular/Gimnasio/Mayorista/B2B/B2C. RFM, cluster, canal, fuente, disciplina y caso de uso deben mantenerse como conceptos separados.
- **UNVERIFIED:** cobertura y consistencia de valores en filas reales de crm_sales_need_profiles.

## 11. Opportunity

- **CONFIRMED:** migrations/004_ai_sdr_operational_loop.sql:4-46 crea crm_opportunities: ID, opportunity_key único, candidatos y referencias de customer/lead/case como strings, WA ID, channel, intent, status, stage, temperature/priority, resumen y varios JSON, mensajes/decisión, espera, siguiente acción, flags human_owner_active/ai_blocked, version y timestamps.
- **CONFIRMED:** no hay columnas/FKs de Account, acquisition source, importe/moneda, probabilidad, fecha esperada de cierre, lost reason, owner user/team, pipeline ID, quote ID u order ID en esa definición.
- **CONFIRMED:** customer_master_id, lead_id y conversation_case_id no tienen FK en esa tabla. conversation_case_id no es conversation_id.
- **CONFIRMED:** el writer nativo persistCommercialState y la continuidad por opportunity_key actualizan estado transaccional/versionado. resolveOpportunityIdentity deja ambigüedad de varias oportunidades activas sin selección arbitraria. El writer heredado consultative existe pero su flag productivo tiene default false según commercialCycleConfig.ts y docs/ACTIVE_RELEASE.md.
- **CONFIRMED:** la unicidad declarada es por opportunity_key, no por customer. El esquema permite varias filas por customer; la continuidad runtime aplica reglas para reutilizar o declarar ambigüedad.
- **CONFIRMED:** Status y Stage tienen listas tipadas separadas en TypeScript, pero la columna SQL es VARCHAR. El reducer y validador del runtime determinan transiciones/derivación en código, no desde configuración de Pipeline.
- **CONFIRMED:** el read model calcula el “valor estimado” desde presupuesto del perfil de necesidad (lib/domains/opportunities/service.ts); no es un valor comercial persistido en crm_opportunities.
- **INFERRED:** Opportunity es hoy un agregado operativo comercial válido para la continuidad del runtime, pero no el objeto completo del proceso de ventas target con account, attribution, ownership, pipeline configurable y lineage quote/order.
- **UNVERIFIED:** cardinalidad y calidad de registros reales, número actual de oportunidades por customer y si writers antiguos dejaron vocabularios mezclados.

## 12. Pipeline

- **INFERRED:** no se encontró tabla o configuración Pipeline/SalesPipeline, definición de múltiples pipelines, orden configurable de etapas ni relación pipeline-stage en el repositorio.
- **CONFIRMED:** la UI llama “Pipeline” al inbox de oportunidades, pero el servicio lee crm_opportunities y la pantalla representa filas tabulares; no es evidencia de una entidad Pipeline.
- **CONFIRMED:** hay listas de etapa/estado y validación de transiciones hardcodeadas. La columna stage no referencia un Pipeline.
- **INFERRED:** no hay board de pipeline editable ni stages configurables en el código revisado.

## 13. Stage taxonomy

**CONFIRMED:** los siguientes vocabularios aparecen en la implementación comercial. La DB guarda stage y status como texto libre; las listas canónicas abajo son TypeScript.

| Valor(es) | Entidad | Archivo/ubicación | Persistido | UI / semántica |
|---|---|---|---|---|
| new, engaged, qualifying, quote_pending, quote_ready_for_review, quote_sent, waiting_customer, followup_scheduled, negotiation, stalled, won, lost, cancelled, archived | Opportunity Status | lib/brain/commercial/constants.ts, lib/brain/commercial/types.ts | Sí, crm_opportunities.status VARCHAR | Estado operativo; no es Stage. |
| discovery, qualification, solution_fit, quotation, negotiation, closing, post_sale_handoff | Opportunity Stage actual | lib/brain/commercial/constants.ts, lib/brain/commercial/types.ts | Sí, crm_opportunities.stage VARCHAR | El runtime deriva/valida la etapa mediante reglas en código. |
| discovery, qualification, recommendation, objection_handling, purchase_intent, checkout_support, follow_up, won, lost, handoff | Legacy Sales Consultative Stage | lib/brain/commercial/sales-consultative/types.ts | Podía escribirse en la misma columna stage | Vocabulario heredado; writer actualmente default-off, pero filas históricas no verificadas. |
| new, contacted, engaged, qualifying, qualified, unqualified, converted, dormant, archived | Lead Status conceptual | lib/brain/commercial/constants.ts | No se encontró tabla Lead | Tipo/enums sin entidad persistida equivalente. |
| whatsapp_inbound, whatsapp_outbound, ecommerce, y otros LEAD_SOURCES del archivo | Lead Source conceptual | lib/brain/commercial/constants.ts | No se encontró vínculo persistido a Lead/Opportunity | No es platform_origin ni channel. |

- **CONFIRMED:** los helpers UI toneForStage reconocen valores legacy y marcan gris valores actuales como solution_fit, quotation, closing y post_sale_handoff; toneForStatus reconoce won/lost/archived/cancelled y ciertos términos genéricos, pero no da tono específico a la mayoría de statuses actuales.
- **CONFIRMED:** esto es una inconsistencia de vocabulario visual. No demuestra que el reducer esté incorrecto; sí muestra que UI y runtime no comparten una capa de labels/colors coherente.
- **INFERRED:** el Stage actual representa etapa en el runtime, pero su separación operativa de Status y su compatibilidad con datos heredados no están aseguradas por constraint SQL ni pipeline configuration.

## 14. Activity / Next Action

- **CONFIRMED:** Opportunity guarda next_action_type, next_action_due_at, waiting_for y last_activity_at; son campos de estado actual/snapshot, no un log completo de llamadas, emails, reuniones y resultados.
- **CONFIRMED:** crm_agent_actions guarda acciones comerciales gobernadas por runtime, con action type/status, scheduled_for, source, creador/aprobador y vínculos con Opportunity/decision. crm_action_executions y crm_action_outcomes registran ejecución y resultado.
- **CONFIRMED:** el scheduling de follow-up de crm_agent_actions es para schedule_followup y worker/dispatch de agente. ADR-003 separa acción aceptada, ejecución, resultado y outbox; no declara que cada acción sea una tarea humana general.
- **CONFIRMED:** crm_commercial_work y sus objectives/steps persisten trabajo y reintentos de runtime asociados a conversación/oportunidad. No modelan por sí mismos una actividad humana con participante, dueño, vencimiento y outcome comercial.
- **INFERRED:** no se encontró una entidad humana/genérica que represente CALL, EMAIL, WHATSAPP, MEETING, SEND_QUOTE, FOLLOW_UP o REVIEW y que relacione Customer + Account + Opportunity + owner + due date + outcome.
- **Respuesta:** existe scheduling y siguiente acción de runtime; no se confirmó un calendario de seguimiento humano independiente del agent runtime.

## 15. Human Ownership / Assignment

- **CONFIRMED:** Opportunity sólo tiene booleans human_owner_active y ai_blocked; no tiene owner_id, usuario, team o salesperson FK.
- **CONFIRMED:** el read model presenta labels derivados: “Human owner”, “AI blocked” o “AI SDR” (ownerForOpportunity en lib/domains/opportunities/service.ts); no lee el directorio de usuarios.
- **CONFIRMED:** Conversation tiene owner_type/owner_id y estado de control; esto es ownership de conversación, no asignación comercial de la cuenta/oportunidad. owner_id no tiene FK a un modelo de operadores en la migración revisada.
- **CONFIRMED:** crm_request_escalations puede guardar target de tipo team/queue/role/user/external system y assigned_operator_id, pero esa asignación pertenece a escalación de un request.
- **CONFIRMED:** en migraciones revisadas no se encontró un directorio productivo general de Users, Teams o Sales Reps. agent_id es actor runtime, no prueba de owner humano.
- **INFERRED:** existe takeover/handoff y asignación contextual en Conversation/Request, no Commercial Ownership general por Customer, Account u Opportunity.
- **UNVERIFIED:** modelo de usuarios/autorización externo no visible en estas tablas o en el servicio desplegado.

## 16. Need Profile

- **CONFIRMED:** crm_sales_need_profiles persiste use case, customer type libre, objetivos, requisitos/preferencias, budget min/max, espacio/ubicación, deadline, experiencia, urgencia/readiness, información faltante, mensaje fuente, JSON y profile_version (migrations/009_crm_sales_need_profiles.sql:4-43).
- **CONFIRMED:** puede referenciar opportunity_id con FK nullable y guarda opportunity_key; no hay unicidad por oportunidad, por lo que el esquema permite múltiples perfiles por oportunidad. La relación por opportunity_key es obligatoria como string.
- **CONFIRMED:** el writer consultative hace upsert del perfil e incrementa profile_version; actualiza estado en la fila, no conserva un historial append-only independiente por versión.
- **CONFIRMED:** la ruta de escritura consultative es heredada y su flag productivo tiene default false. T02.1 está en curso y T03 de la release activa sigue pendiente; el estado de hecho productivo debe tratarse como parcial, no como authority revalidada.
- **INFERRED:** sí es estado comercial durable en esquema, no sólo memoria de modelo. La procedencia y evolución durable son parciales por la actualización in-place y el writer heredado.
- **Decisión de auditoría:** incluir Need Profile en la futura composición de Commercial Work como fuente existente a evaluar; no crear un segundo perfil ni canonizar todavía customer_type.

## 17. Quote linkage

- **CONFIRMED:** existe un modelo local antiguo crm_quotes (migrations/020_crm_quotes.sql) con versiones/estados, items y referencias en columnas a request, conversación, oportunidad y customer; esas referencias no tienen FKs en la tabla.
- **CONFIRMED:** el contrato vigente identifica Quote Service como owner de quotes. docs/product/quote-input-assembly.md califica el repositorio y tabla locales anteriores como legacy frente al servicio externo.
- **CONFIRMED:** el camino nuevo invoca Quote Service vía adapter/port y persiste un locator bajo fact created_quote de crm_request_facts. El read model de dominio puede hidratar ese locator consultando Quote Service.
- **CONFIRMED:** existe una divergencia documental: docs/product/MVP_EXECUTION_MAP.md y docs/CAPABILITY_MATRIX.md clasifican quote creation/persistence como planned, mientras que el código actual incluye la integración Quote Service y el locator created_quote. Esto confirma wiring en el checkout, no que el servicio externo esté operativo ni que la capacidad haya pasado su aceptación; el estado de despliegue queda UNVERIFIED.
- **CONFIRMED:** la UI de Opportunity actualmente devuelve quote: null (lib/domains/opportunities/service.ts) y Customer 360 carga la tabla heredada local, no el nuevo locator.
- **INFERRED:** hay dos representaciones del concepto Quote en el repositorio, una legacy local y otra autoridad externa más locator local. No debe añadirse una tercera quote master.
- **CONFIRMED:** el locator actual expone la referencia activa por request/opportunity; los hechos superseded preservan historia de referencias. crm_quotes soporta versiones históricas locales, pero no es la lineage canónica nueva.
- **INFERRED:** no se encontró relación Account → Quote ni linkage visible completo Opportunity → Quote en la superficie CRM.
- **UNVERIFIED:** que Quote Service esté desplegado/configurado, su historial real o las relaciones de quotes de clientes actuales.

## 18. Order linkage

- **CONFIRMED:** Customer 360 consulta ps_orders por identidad de PrestaShop y/o email y los convierte a items de proyección. El repositorio mirror trata esos registros como lectura/discovery; el origen del pedido sigue siendo PrestaShop.
- **CONFIRMED:** no se encontró order_id en crm_opportunities, crm_quotes ni en el locator created_quote. crm_request_facts.order_identifier sirve para hechos de consulta de pedido y no demuestra conversión de venta de Opportunity.
- **INFERRED:** existe Customer → Order como proyección por match de identidad; no existe lineage persistido Opportunity → Order ni Quote → Order en el CRM revisado.
- **Respuesta:** no puede demostrarse Opportunity → Quote → Order con enlaces explícitos actuales; las asociaciones por customer/tiempo serían inferencias, no lineage comercial.
- **UNVERIFIED:** tablas/relaciones transaccionales externas que no se exponen al repositorio.

## 19. Conversation linkage

- **CONFIRMED:** conversation.customer_id tiene FK a master_customer.id (migrations/008_conversation_ai_runtime_core.sql).
- **CONFIRMED:** crm_opportunities.conversation_case_id es un string/indexado, sin FK a conversation.id; wa_id también es una clave de canal, no una FK de oportunidad.
- **CONFIRMED:** crm_conversation_requests relaciona por columnas conversation_id y opportunity_id y tiene FK de oportunidad; no declara FK a conversación. crm_commercial_work sí tiene FKs de conversación y oportunidad nullable.
- **CONFIRMED:** la tabla legacy customer_conversation_link relaciona casos/cliente, no reemplaza la entidad Conversation actual.
- **INFERRED:** Opportunity puede vincularse explícitamente a conversación mediante request/work joins; no tiene una relación directa y única opportunity.conversation_id. Una oportunidad puede recibir varias conversaciones/solicitudes.
- **INFERRED:** no se encontró vínculo Conversation → Account.

## 20. Lifecycle / Timeline

- **CONFIRMED:** commercial_event es un almacén durable de eventos con dedupe, source, source event ID, IDs textuales de customer/conversation/opportunity, provider, occurred_at, payload y metadata. No fuerza FK a los agregados.
- **CONFIRMED:** contrato Customer Lifecycle define timeline ensamblado como read model. Customer 360 agrega eventos de conversación, oportunidad, perfil, acción/outcome, quote, pedido, address y commercial event.
- **CONFIRMED:** la timeline de Opportunity en domains/opportunities/service.ts se construye con última actividad, decisión reciente, perfil actual y acciones recientes; no es un event ledger completo e incluye eventos de fuentes parciales.
- **INFERRED:** existe timeline Customer como proyección. No existe evidencia de una tabla CustomerLifecycleEvent canónica que duplique authorities fuente.
- **INFERRED:** el timeline actual de Opportunity es parcial; el de Account no existe porque Account no está modelado.
- **CONFIRMED:** audit log, event store comercial y timeline de negocio son conceptos distintos; el hecho de compartir identificadores/eventos no hace que el audit log sea timeline comercial.
- **UNVERIFIED:** eventos y cobertura que realmente existen en RDS y servicios externos.

## 21. Existing Kanban / UI

- **CONFIRMED:** /opportunities obtiene filas desde listOpportunities y las muestra en una tabla llamada “Pipeline”, con filtros de texto y paginación. La fuente declara datos reales del read model y muestra estado de disponibilidad.
- **CONFIRMED:** la página de detalle es read-only; enseña stage/status, valor derivado, owner label, profile, decisión, acciones, timeline resumido y advertencias.
- **CONFIRMED:** no se encontró API route de mutación de etapa ni superficie de columnas Kanban/drag-and-drop/optimistic update en las búsquedas de los API routes y Opportunities.
- **CONFIRMED:** el owner en la UI es un label calculado, y el quote del detalle es null.
- **INFERRED:** es posible construir una vista de sólo lectura agrupando filas por stage actual y mostrando “unknown” explícitamente; esto revelaría vocabulario heredado y campos faltantes.
- **INFERRED:** no es seguro implementar un Kanban editable a partir de la UI actual sin contrato de transición, reconciliación de stages, endpoint gobernado y owner/activity comerciales.
- **CONFIRMED:** la auditoría histórica de UX tiene un baseline anterior; las observaciones actuales de esta sección provienen del código en HEAD.

## 22. Persistence / RDS ownership map

La columna DB describe el destino indicado por el repositorio/contratos, no una inspección del host RDS.

| Entity | Table/store | DB | Owner | Writers observados | Readers observados | Canonical/projection |
|---|---|---|---|---|---|---|
| Customer master | Customer Service externo + master_customer | Servicio externo; proyección local MariaDB | Customer Service | Customer Service; además existe POST /api/customers gated que inserta localmente | Customer repository, Customer 360, Opportunity view | Servicio externo canónico según contrato; tabla local es proyección, aunque el writer local crea una contradicción |
| External identity/evidence | customer_external_identity, identity evidence/onboarding | MariaDB local | Customer & Identity / Commercial Runtime dentro de contratos | Inbound WhatsApp, identity capability y onboarding | Resolver, gate, Customer 360/read models | Estado de vínculo/evidencia local; no Customer Master |
| Opportunity | crm_opportunities | MariaDB | Commercial Runtime | Native operational loop y persistencia de estado; legacy consultative default-off | Opportunity domain/UI, Customer 360, analytics | Canónico para estado de oportunidad del runtime |
| Need Profile | crm_sales_need_profiles | MariaDB | Commercial Runtime declarado | Writer consultative heredado | Opportunity UI, runtime legacy/read model | Persistencia durable legacy; estado de writer actual no confirmado |
| Decisions | crm_agent_decisions | MariaDB | Commercial Runtime | Runtime comercial | Opportunity UI, analytics | Log de decisiones; no actividad/ownership |
| Agent actions/executions/outcomes | crm_agent_actions, executions, outcomes | MariaDB | Commercial Runtime / worker | Runtime y worker | UI, analytics, follow-up | Estado de acción de agente; no task humano general |
| Conversation/messages | conversation, conversation_message | MariaDB | Conversation runtime | Inbound/conversation runtime | Operator CRM, identity, lifecycle read model | Fuente local operativa según runtime |
| Requests/facts | crm_conversation_requests, crm_request_facts y eventos | MariaDB | Commercial Runtime | Runtime nativo | Capability gateway, Commercial Work, read models, quote locator | Runtime/request facts; no Pipeline |
| Commercial Work | crm_commercial_work, objectives, steps | MariaDB | Commercial Runtime | R2/native runtime workers | Runtime y superficies operativas | Agregado de ejecución comercial, no actividad humana |
| Quotes | Quote Service externo; locator en crm_request_facts; legado crm_quotes | Servicio externo + MariaDB local; DB del servicio no verificada | Quotes & Transactions / Quote Service | Quote Service adapter; writer local legacy | Commercial domain model; UI parcialmente no conectada | Servicio externo canónico; locator proyección; crm_quotes legacy |
| Orders | PrestaShop ps_orders / mirror | PrestaShop; mirror puede compartir pool MariaDB o DB dedicada | Sistema de pedidos externo | PrestaShop | Customer 360 / mirror repository | Externo canónico; CRM sólo lectura/proyección |
| Commercial events | commercial_event | MariaDB | Runtime/Analytics por contrato | Ingesta/runtime | Lifecycle/customer read model | Event evidence, no agregado Customer |
| Customer 360 / lifecycle | assembler y DTOs; sin customer_360 table | En memoria/read model sobre MariaDB y servicios | Operator CRM / Analytics projection | Assembler | Customers/Opportunity surfaces | EXISTS_AS_PROJECTION |
| Account, AccountContact, Acquisition, Pipeline config, human Activity | No se encontró store | No observado | No observado | No se encontró writer | No se encontró reader productivo | Ausente en fuentes examinadas |

- **CONFIRMED:** lib/db.ts conecta usando el resolvedor nombrado y configuración de MariaDB; ADR-009 declara MariaDB como persistencia operativa canónica para estado comercial y Brain.
- **CONFIRMED:** el mirror PrestaShop puede usar pool compartido por default o base dedicada pesas_productiva; compartir MariaDB no transfiere ownership a CRM.
- **UNVERIFIED:** tablas aplicadas, conexión productiva y filas actuales en RDS. Ninguna fila de esta tabla debe leerse como comprobación de producción.

## 23. Duplicate concepts and naming collisions

1. **CONFIRMED:** crm_quotes local y Quote Service externo representan el concepto Quote. El contrato vigente deja la tabla local como legacy y el servicio como owner; mantener esa distinción en vez de agregar otra entidad maestra.
2. **CONFIRMED:** crm_opportunities.next_action_*, crm_agent_actions, crm_commercial_work y crm_conversation_requests tienen campos que pueden sonar a tareas/actividad, pero sus responsabilidades son snapshot comercial, acción autónoma gobernada, trabajo de runtime y request de conversación respectivamente.
3. **CONFIRMED:** master_customer.platform_origin, crm_opportunities.channel, LEAD_SOURCES, commercial_event.source y crm_agent_actions.source usan nociones de “origen” distintas. No son intercambiables.
4. **CONFIRMED:** customer_type de Need Profile, RFM/cluster de Marketing, use case y channel representan clasificación distinta. No canonizar uno como reemplazo de todos.
5. **CONFIRMED:** Opportunity Status, Opportunity Stage, Sales Consultative Stage y request/action/work statuses comparten almacenamiento textual en algunos casos, pero no son un mismo lifecycle.
6. **CONFIRMED:** Customer 360 y timeline son agregados de lectura. No deben duplicar Customer, Order, Address, Conversation u Opportunity masters.

## 24. Legacy runtime contamination

Esta sección identifica dependencias R1/R2/R3 relevantes para el diseño del Commercial Core; no audita ni propone estructuras R4.

- **CONFIRMED:** crm_agent_actions es fuente aceptada de acción comercial de agente, con policy, aprobación, schedule, ejecución y outcomes separados. No convertirla en Activity humana genérica.
- **CONFIRMED:** crm_agent_decisions es historial de decisión, no timeline completo, asignación ni etapa de pipeline.
- **CONFIRMED:** crm_commercial_work/objectives/steps almacenan ejecución/reintentos de R2/runtime y tienen relaciones a conversación/oportunidad. No equivalen a Account, Pipeline ni calendario de vendedor.
- **CONFIRMED:** crm_conversation_requests.status describe una solicitud autónoma dentro de conversación; no es etapa de ventas.
- **CONFIRMED:** crm_sales_need_profiles conserva un writer de Sales Consultative heredado, actualmente deshabilitado por default, y contiene customer_type libre. No usar su taxonomía como contrato canónico sin reconciliar el estado de release.
- **CONFIRMED:** crm_quotes es quote aggregate local anterior. La ruta vigente usa Quote Service más un locator de request fact; no elevar ambos a authorities paralelas.
- **CONFIRMED:** crm_customer_onboarding de la migración 007 pertenece al flujo local legado; la migración 023 y contracts de ACS tienen estado de onboarding/identidad separado. No fusionar onboarding con Customer o Acquisition por coincidencia de nombre.
- **CONFIRMED:** n8n cases/queues y customer-case link son estructuras operativas heredadas, no el centro del dominio ni sustitutos de Opportunity.
- **INFERRED:** estos modelos sirven como fuentes/eventos/read models mientras el CRM futuro mantenga owners y límites explícitos; diseñar CRM Activity/Work encima de ellos sin separar semántica produciría duplicación de autoridad.

## 25. Gap matrix

| Primitive | Current state | Evidence | Missing | Decision |
|---|---|---|---|---|
| Customer / Person | EXISTS_PARTIAL | master_customer, external identity, Customer 360; writer local en conflicto | Tipo/provenance/lifecycle completos y consistencia de authority | No rediseñar identity; reconciliar writer local con owner Customer Service |
| Account / Organization | ABSENT | Búsqueda de tablas, tipos, FKs y B2B fields | Organization estructurada y relación comercial | Diseñar sólo con alcance autorizado |
| Contact / AccountContact | ABSENT | Sin Persona ↔ Organization, roles o cardinalidad | Vínculos y roles de contactos | Diseñar después de Account |
| Customer Identity | EXISTS_PARTIAL | External identity, unresolved rows, evidence, service resolver | Verificación operativa externa y contratos desplegados | Reutilizar contratos y persistencia existentes |
| Acquisition / Attribution | ABSENT | No entidad/event first/last-touch ni oportunidad-source | Evento, provenance, customer/opportunity link | Diseñar adquisición antes de atribuir datos retrospectivos |
| Opportunity | EXISTS_PARTIAL | Tabla, writer runtime, continuidad/version/status/stage | Account, owner, source, commercial value, quote/order lineage | Extender sólo mediante tarea/contrato explícito |
| Pipeline | ABSENT | No config/store; nombre UI es inbox | Pipeline owner, definition/configuration | No llamar Pipeline a una tabla o título UI |
| Pipeline Stage | EXISTS_PARTIAL | VARCHAR + tipos y transición hardcodeada + legacy values | Vocabulario compartido, compatibilidad y configuración | Reconciliar antes de Kanban editable |
| Activity / Next Action | EXISTS_PARTIAL / EXISTS_RUNTIME_ONLY | snapshot Opportunity + Agent Actions + Commercial Work | actividad humana genérica y outcomes vinculados | No reutilizar Action/Work como si fueran Activity |
| Human Ownership | EXISTS_PARTIAL | flags, Conversation owner y request escalation | usuario/team/sales rep y owner comercial estable | Diseñar assignment luego de aclarar directorio |
| Need Profile | EXISTS_LEGACY | Tabla y upsert in-place; writer legacy default-off | historia/provenance y estado del writer actual | Reusar/evaluar con T03; no duplicar perfil |
| Quote linkage | EXISTS_PARTIAL / DUPLICATED | Quote Service + locator + tabla legacy | Proyección conectada a UI y lineage Account/Opportunity | Mantener Quote Service como owner declarado |
| Order linkage | EXISTS_AS_PROJECTION | ps_orders por customer/email | referencias Quote/Opportunity → Order | Mantener orden externo y diseñar sólo link/proyección |
| Conversation linkage | EXISTS_PARTIAL | FK customer; request/work unen conversation/opp | relación directa contextual y Account | Conservar joins existentes; no usar case ID como conversation |
| Lifecycle / Timeline | EXISTS_AS_PROJECTION | commercial_event, assembler y timelines | cobertura de Opportunity/Account y quote locator | Extender proyecciones desde fuentes, sin duplicar masters |
| Source/channel/segment | EXISTS_PARTIAL | platform origin, channel, enums, tipo libre | semánticas canónicas separadas y persistidas | No combinar fuente, canal, segmento ni RFM |

## 26. Commercial Core readiness

| Superficie | Readiness en HEAD | Evidencia y límite |
|---|---|---|
| Customers | Parcial para consulta read-only | Customer 360 provisional y datos degradables; authority master externa y discrepancia del writer local |
| Accounts | No listo como dominio | No entity/contact model observado |
| Opportunities | Parcial para inbox y detalle read-only | crm_opportunities durable, continuidad runtime y read model; faltan account, owner/assignment y lineage |
| Pipeline / Kanban | Sólo visualización agrupada read-only posible | Stage actual puede agruparse, pero status/stage tienen drift; no hay pipeline configurable ni mutation API observada |
| Commercial Work | Existe como ejecución del runtime | crm_commercial_work tiene persistencia y relaciones; no ofrece por ello actividad/ownership humana completa |

**INFERRED:** se puede diseñar la siguiente superficie conceptual con evidencia suficiente para identificar boundaries, pero no implementar aún un CRM comercial editable sin decisiones explícitas para Account, Acquisition, Pipeline/Stage, assignment/Activity y relaciones quote/order. El read-only Kanban debe marcar etapas desconocidas y su carácter de proyección.

**CONFIRMED:** docs/ACTIVE_RELEASE.md mantiene ACS-R1-04 bloqueada por la ausencia de Customer Service desplegado para smoke y ACS-R1-05.1 en progreso en T02.1; T03 sigue pendiente. Esta auditoría no cierra ni cambia tareas/capabilities y no autoriza abrir otro release.

## 27. What must be designed next

Sólo primitivas ausentes o incompletas identificadas por esta auditoría:

1. **Account/Organization y AccountContact:** definición de empresa separada de persona y relación N:N con roles.
2. **Acquisition/Attribution:** distinguir origen del customer, first/latest touch, source de oportunidad, canal, source system y campaign/UTM; persistencia con provenance.
3. **Pipeline y Stage:** definir si hay uno o varios pipelines, ownership/configuración, orden/terminalidad y separación de Stage frente a Status; reconciliar valores runtime, legacy y UI.
4. **Commercial ownership y Activity humana:** identificar users/teams/sales reps, assignment a Opportunity/Account y actividad con due date/resultados; preservar diferencias frente a Agent Action/Commercial Work.
5. **Relaciones de conversión:** definir references de Opportunity ↔ Quote ↔ Order y Account ↔ Opportunity sin mover owners de Quote Service o del sistema de pedidos.
6. **Customer master write boundary:** resolver la discrepancia entre Customer Service como owner declarado y POST /api/customers local gated antes de construir más superficies de escritura.
7. **Timeline de oportunidad/cuenta:** completar read models desde fuentes existentes cuando haya contratos y IDs estables; no crear una segunda copia de sus agregados.

**CONFIRMED (proceso):** la secuencia es trabajo de diseño posterior a esta auditoría, sólo bajo alcance de release/tarea autorizado y tras respetar el bloqueo/secuencia actual. No constituye autorización de migraciones ni implementación.

## 28. What must NOT be redesigned

- Customer identity resolution y linking de Customer Service; mantener provisional el ID local y no inventar customer_master definitivo.
- crm_opportunities como agregado persistido actual de Commercial Runtime y su continuidad estable; extender según contrato, no reemplazar por Cases, Conversations o Work Queue.
- Opportunity status y transiciones del runtime como fuentes actuales de estado, aunque deban armonizarse con Stage.
- Conversation y customer lifecycle contracts; Customer 360 y timeline como read models.
- Quote Service como owner de Quote; created_quote como referencia local actual. Investigar la tabla local heredada sin promoverla de nuevo.
- PrestaShop como owner de Order y ps_orders como fuente/mirror de lectura.
- Distinción de ADR-003 entre decisión, acción aceptada, ejecución, outcome y outbox.
- Persistencia de Commercial Work como lifecycle del runtime; no convertirla en Task humana ni en Pipeline.
- Estados de onboarding/identidad de ACS; no mezclarlos con Acquisition, Account o estado comercial.
- No inferir Accounts/Customers reales a partir de fixtures o texto libre.

## 29. Recommended architecture sequence

1. Registrar este baseline documental como evidencia histórica; mantener intactos release, capability matrix y auditorías anteriores.
2. En una tarea autorizada posterior, resolver por evidencia operacional el writer local de Customer frente al owner Customer Service y confirmar contractualmente las tablas/migraciones que usa el entorno.
3. Cerrar el diseño de Account/Organization y sus Contacts antes de persistir relaciones empresa-persona u oportunidad-cuenta.
4. Diseñar Acquisition/Attribution con semánticas separadas y provenance, sin reinterpretar retroactivamente platform_origin ni source de runtime.
5. Reconciliar Status/Stage de runtime, Sales Consultative y UI; luego especificar pipeline/configuración y transiciones.
6. Definir el directorio/ownership comercial y Activity humana, conservando Agent Action, Commercial Work, Request y Channel Message como entidades distintas.
7. Acordar referencias de conversión Quote/Order con sus owners, proyectar esas referencias a Opportunity/Customer 360 y validar timeline.
8. Sólo entonces autorizar superficie Kanban editable y cambios persistentes; hasta ese momento, cualquier board es read-only y debe exponer faltantes.

### Respuestas directas a las 30 preguntas

1. **¿Existe Account/Organization?** No en las estructuras comerciales encontradas. **INFERRED.**
2. **¿Existe relación Account ↔ Person?** No se encontró FK ni relación equivalente. **INFERRED.**
3. **¿Puede una empresa tener varios contactos?** No como relación estructurada en el modelo revisado. **INFERRED.**
4. **¿Existe taxonomía Particular/Gimnasio/Mayorista?** No canónica; hay texto libre/inferencia legacy. **CONFIRMED** sobre esquema/type observado; ausencia global **INFERRED**.
5. **¿Dónde se guarda el origen real de un cliente?** platform_origin guarda una etiqueta de plataforma; no equivale a adquisición/first touch. El origen completo no está demostrado. **CONFIRMED / INFERRED.**
6. **¿platform_origin es suficiente o sólo legacy?** Es un campo existente pero insuficiente para attribution; la clasificación “legacy” no aplica como authority de adquisición. **CONFIRMED.**
7. **¿Existe First Touch?** No encontrado. **INFERRED.**
8. **¿Existe Latest Touch?** No encontrado como entidad/atributo de attribution; timestamps de conversación no son modelo latest-touch. **INFERRED.**
9. **¿Existe Opportunity Source?** No como campo/relación persistente; lead_id y channel no la reemplazan. **CONFIRMED / INFERRED.**
10. **¿Existe Campaign/UTM attribution?** No encontrada en persistencia comercial actual. **INFERRED.**
11. **¿Existe Pipeline?** No como entidad configurable. Hay una página titulada Pipeline. **CONFIRMED / INFERRED.**
12. **¿Existen Pipeline Stages configurables?** No; hay valores tipados y transición hardcodeada. **CONFIRMED.**
13. **¿Stage y Status están correctamente separados?** Existen campos/listas separados, pero comparten VARCHAR, hay stage legacy mezclado y UI desalineada. **CONFIRMED** que la separación es incompleta.
14. **¿Puede un Customer tener múltiples Opportunities?** El esquema lo permite; sólo opportunity_key es único. No se verificaron filas reales. **CONFIRMED / UNVERIFIED.**
15. **¿Puede una Opportunity pertenecer a un Account?** No existe relación Account en el modelo observado. **INFERRED.**
16. **¿Existe owner humano?** Hay flags/handoff/owners de Conversation y escalación; no un owner comercial estable de Opportunity. **CONFIRMED / INFERRED.**
17. **¿Existe Team?** No se encontró directorio comercial general; request escalation admite target team. **CONFIRMED / INFERRED.**
18. **¿Existe Activity/Next Action?** Hay snapshot de next action y acciones de agente; no Activity humana general. **CONFIRMED.**
19. **¿Puede calendarizarse seguimiento humano sin Agent Runtime?** No se encontró ese modelo. **INFERRED.**
20. **¿Need Profile es durable business state?** Sí, el schema lo persiste y versiona; writer actual es legacy/default-off y el historial es in-place. **CONFIRMED.**
21. **¿Existe multiple Quote lineage?** Sí en la tabla local legacy/versionada; el nuevo camino tiene servicio y hechos de referencia. La historia canónica externa no fue inspeccionada. **CONFIRMED / UNVERIFIED.**
22. **¿Puede trazarse Quote → Order?** No mediante enlaces explícitos encontrados. **INFERRED.**
23. **¿Conversation se vincula explícitamente a Opportunity?** Sí mediante request/work joins; no mediante FK directa en Opportunity. **CONFIRMED.**
24. **¿Existe timeline por Customer?** Sí como read model ensamblado. **CONFIRMED.**
25. **¿Existe timeline por Opportunity?** Sí, parcial, calculado desde fuentes recientes; no como event ledger completo. **CONFIRMED.**
26. **¿Qué tablas son realmente canónicas?** Por owner/contratos: crm_opportunities y fuentes de runtime comercial; conversation para conversación; Quote Service para Quote; PrestaShop para pedidos; Customer Service externo para master. La RDS productiva no fue verificada. **CONFIRMED / UNVERIFIED.**
27. **¿Qué tablas son proyecciones?** master_customer local, Customer 360/timeline, ps_orders cuando se consume como mirror, locator local de quote y read models de Operator CRM. **CONFIRMED** por contratos/código.
28. **¿Qué estructuras R1/R2/R3 deben quedar fuera del futuro diseño?** Agent actions/decisions/executions/outcomes, Commercial Work runtime, Conversation Requests, perfiles consultative legacy, quote aggregate legacy, onboarding/case/queue legacy; conservarlos como sus fuentes respectivas, sin renombrarlos Activity/Pipeline/Account. **CONFIRMED.**
29. **¿Podemos construir Kanban con primitives existentes?** Sólo una vista read-only agrupada por stage con limitaciones explícitas; no un Kanban editable completo. **INFERRED.**
30. **¿Qué falta antes de hacerlo?** Account/contact si aplica al producto; acquisition; stage/pipeline armonizado; mutation API gobernada; ownership/directorio y Activity humana; quote/order references; y reconciliar el writer local de Customer. **INFERRED**, sujeto a alcance de release.
