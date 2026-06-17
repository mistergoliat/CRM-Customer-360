# MVP Roadmap

Este roadmap reemplaza la narrativa handoff-first por una secuencia centrada en Customer, governance y AI SDR.

## Secuencia estrategica

1. Cerrar infraestructura critica.
2. Formalizar el producto agentic y la gobernanza.
3. Construir el AI SDR MVP.
4. Elevar Customer 360 minimo.
5. Activar Operator Copilot.
6. Extender a AI Marketing.
7. Preparar Voice/Call Tool.

## Roadmap

| Milestone | Objetivo | Resultado esperado |
|---|---|---|
| `P1I-010 Controlled End-to-End Manual Backend Send Test` | Cerrar el ciclo tecnico manual de envio backend sin automatizarlo por defecto. | Queda validado el pipeline minimo de infraestructura y rollback. |
| `P1J-000 Agentic CRM Product Blueprint` | Congelar la vision de producto, limites y alcance. | Todo el equipo habla el mismo idioma: AI SDR + Agentic CRM + Customer 360. |
| `P1J-001-AUDIT Customer Identity Source Mapping & Ownership` | Mapear fuentes, ownership y precedencia antes de persistir master. | Existe un mapa claro de fuentes confiables, parciales, transicionales y manuales. |
| `P1J-001-READONLY Customer Candidate Resolver from existing sources` | Definir el puente read-only entre fuentes existentes y candidato CRM. | Existe un Customer Candidate Read Model sin writes ni merges destructivos. |
| `P1J-001 Customer Identity / Customer Master minimo` | Definir Customer Master, identity map, timeline minimo y reglas de merge. | Existe base tecnica de identidad lista para contract/spec y futura implementacion. |
| `P1J-002 Customer Opportunity / Intent model` | Separar intent, opportunity, follow-up y case. | El sistema deja de pensar solo en casos. |
| `P1J-003 Universal Agent Decision Contract` | Unificar la salida estructurada de todos los agentes. | Toda decision trae contexto, razon, riesgo, action mode y trace. |
| `P1J-004 Agent Capability Matrix` | Definir que puede hacer cada agente. | Hay fronteras claras entre sales, quote, follow-up, postventa, SAC y copilot. |
| `P1J-005 Action Governance Engine` | Definir approval, blocked, draft, internal task y send now low risk. | Las acciones sensibles quedan gobernadas y auditables. |
| `P1J-006 Approval Queue desde HUB` | Crear la capa operativa para aprobar acciones sensibles. | Los humanos aprueban desde HUB, no desde workflows dispersos. |
| `P1K-001 AI SDR Operating Model (DONE)` | Operating model comercial ya definido para inbound, outbound y follow-up gobernado. | Existe un modelo operativo claro de entidades, estados, senales, decisiones y supervision. |
| `P1K-002 Opportunity/Lead model contract (DONE)` | Contrato documental y TypeScript para lead y opportunity. | El backend puede razonar comercialmente sin depender de case-centric design. |
| `P1K-003 Follow-up decision policy (DONE)` | Politica documental y TypeScript del follow-up comercial contextual. | Las reglas de follow-up quedan gobernadas y auditables. |
| `P1K-004 Sales Agent contract (DONE)` | Contrato documental y TypeScript del Sales Agent. | Sales Agent queda listo como agente comercial que propone, analiza y explica sin ejecutar. |
| `P1K-005 Operator Copilot contract (DONE)` | Definir la interfaz operativa humana para revisar, aprobar y forzar seguimiento. | El operador puede supervisar, editar y preparar comandos gobernados sin ejecutar acciones. |
| `P1K-006 AI SDR Implementation Blueprint / Runtime Sequencing (ACTIVE)` | Definir el orden de activacion, enforcement points y rollout seguro del runtime agentic. | Existe un blueprint de implementacion para activar capacidades sin romper la preview ni la gobernanza. |
| `P1K-007 Primer vertical slice runtime read-only` | Activar el primer recorrido end-to-end en shadow mode sin envio ni mutacion. | El sistema puede analizar un inbound comercial y devolver resultados validos y auditables sin ejecutar. |
| `P1K-008 Operator review and approval slice` | Habilitar propuestas visibles y revision humana controlada. | El operador puede revisar propuestas y aprobar o rechazar comandos dry-run. |
| `P1K-009 Controlled internal task execution` | Ejecutar una accion de bajo riesgo con approval e idempotencia. | La primera ejecucion real es una tarea interna reversible y auditada. |
| `P1K-010 Controlled WhatsApp execution` | Habilitar envio WhatsApp aprobado manualmente. | El sistema envia solo cuando governance y approvals estan probados. |
| `P1K AI SDR MVP` | Activar el primer recorrido comercial real del producto. | WhatsApp + email operan inbound y outbound con approvals donde toca. |
| `P1L Customer 360 minimo` | Consolidar timeline, identity map, opportunities y approved actions. | Customer se vuelve el centro operativo estable. |
| `P1M Operator Copilot` | Dar visibilidad de decisiones, logs, costos, tools y errores. | El humano puede supervisar y probar cambios controlados. |
| `P2 AI Marketing` | Permitir investigacion y propuestas de campanas con approval. | El sistema propone campanas sin enviarlas automaticamente. |
| `P3 Voice/Call Tool` | Introducir llamadas como tool modular futura. | Llamadas quedan aisladas por riesgo y gobernanza. |

## Que cambia respecto del enfoque anterior

- `P1J` ya no es handoff-first.
- Handoff pasa a ser una accion gobernada dentro del modelo agentic.
- La prioridad posterior a `P1I` es Product + Governance foundation.
- `Customer` reemplaza a `case` como centro del modelo.
- `Work Queue` queda como vista operativa, no como verdad del sistema.

## Exit criteria por bloque

### P1J

- customer_master y identity map definidos,
- source mapping y ownership definidos,
- Customer Candidate Read Model definido,
- timeline minimo definido,
- rules de create/merge/confidence definidas,
- decision contract unificado,
- capability matrix publicada,
- governance de acciones definida,
- approval queue especificada.

### P1K

- AI SDR puede procesar inbound y outbound,
- el operating model comercial esta definido,
- lead y opportunity estan separados conceptualmente,
- el contrato Lead/Opportunity es la capa actual en trabajo,
- la politica Follow-up esta cerrada,
- el contrato Sales Agent es la etapa actual en trabajo,
- puede calificar y proponer,
- puede crear drafts y tareas internas,
- puede pedir aprobacion para acciones sensibles.

### P1L

- timeline minimo util,
- opportunity graph util,
- approved actions visibles,
- customer state navegable.

### P1M

- operadores ven decisiones, costos, tools y errores,
- existen pruebas controladas,
- el copilot explica antes de actuar.

### P2

- investigacion y draft de campanas sin envio directo,
- approval before send,
- trazabilidad de campanas y propuestas.

### P3

- voz queda como tool separada,
- aprobacion obligatoria para llamadas sensibles,
- logs y outcomes obligatorios.

