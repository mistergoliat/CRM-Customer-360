# Agentic CRM Blueprint

## Vision

El producto objetivo de este repo es un AI SDR + Agentic CRM para ecommerce conversacional.

El sistema debe:

- captar y calificar leads desde WhatsApp y email,
- investigar contexto de clientes y contactos,
- proponer siguientes acciones comerciales,
- ejecutar acciones de bajo riesgo con control,
- pedir aprobacion humana para acciones sensibles desde el HUB,
- dejar trazabilidad completa de decisiones, tools, costos y resultados,
- evolucionar hacia SaaS y luego AaaS sin reescribir el nucleo.

## Phase alignment

El repositorio esta alineado asi:

- `P1K` esta `ACCEPTED AND CLOSED`.
- `P1L` es `Production Foundation`.
- `P1M` es `CRM Product Experience`.

P1M usa la UI como herramienta de discovery para validar read models, jerarquias operativas y contratos faltantes antes de fijar nueva persistencia o ejecucion.

## Que es

1. Una plataforma de ventas asistidas y autonomia comercial.
2. Un CRM operacional agentic con Customer 360 como nucleo.
3. Un sistema de agentes especializados para vender, seguir, recomendar, analizar y coordinar acciones.
4. Una capa de supervision humana desde HUB para aprobar o bloquear acciones sensibles.
5. Un producto multicanal con WhatsApp y email como canales iniciales.

## Que no es

1. No es un chatbot de WhatsApp.
2. No es un sistema de tickets.
3. No es un case management first.
4. No depende de Work Queue o Work Item como entidad central.
5. No es marketing automation completo en la primera etapa.
6. No es un reemplazo total de n8n en una sola pasada.

## Producto principal

El producto principal es AI SDR.

AI SDR debe cubrir:

- inbound: capturar consultas entrantes y convertirlas en oportunidades,
- outbound: contactar, dar seguimiento y reactivar conversaciones,
- calificacion: extraer intencion, urgencia, producto, presupuesto y contexto,
- propuesta: sugerir cotizacion, agenda, follow-up o derivacion,
- supervision: pedir aprobacion cuando el riesgo operativo lo exija.

El detalle operativo vigente vive en `docs/PRODUCT_NORTH_STAR.md` y `docs/product/sales-agent-contract.md` (el modelo original de este parrafo, `ai-sdr-operating-model.md`, quedo historico en `docs/archive/`).

## Base paralela necesaria

La base paralela del producto es AI CRM Operacional.

AI CRM Operacional existe para:

- consolidar identidad,
- ordenar timeline,
- registrar conversaciones, intents, oportunidades y acciones,
- mantener customer state util para decisiones de ventas y postventa,
- servir de base para aprobaciones y auditoria.

AI CRM Operacional no reemplaza al AI SDR. Lo habilita.

## AI Marketing

AI Marketing es un modulo futuro.

No debe ser el foco inicial del producto, pero si debe quedar previsto para:

- investigacion de audiencias,
- propuestas de campañas,
- drafts de mensajes y secuencias,
- experimentacion con segmentacion y lifecycle,
- aprobacion humana antes de envio.

## Customer 360 como nucleo

Customer es la entidad central.

Todo lo demas debe colgar desde Customer:

- identities,
- conversations,
- intents,
- opportunities,
- quotes,
- follow-ups,
- cases,
- campaigns,
- agent decisions,
- approved actions,
- timeline events.

Customer 360 aqui significa una vista operativa unificada del cliente para vender y operar, no una promesa de master data final.

El Customer 360 definitivo depende de `customer_master`. Antes de eso, el sistema opera con identidad provisional y Customer Candidate.

Durante P1M, el Customer 360 provisional puede construirse como experiencia visual read-only para descubrir gaps de identidad, timeline y relaciones comerciales sin fingir un master persistente.

La secuencia real de activacion vive en `docs/ROADMAP.md` y `docs/ACTIVE_RELEASE.md` (el blueprint original de este parrafo, `ai-sdr-implementation-blueprint.md`, quedo historico en `docs/archive/` - su secuencia P1K no gobierna la activacion real).

## Canales iniciales

1. WhatsApp.
2. Email.

WhatsApp es el canal prioritario para entrada y follow-up.

Email es el canal util para:

- enriquecer identidad,
- enviar propuestas,
- resumir decisiones,
- escalar follow-up de menor urgencia.

## Inbound y outbound

El sistema debe operar en ambos sentidos:

- Inbound: el cliente inicia la interaccion.
- Outbound: el sistema o un agente inicia o retoma la conversacion con una razon comercial clara.

Inbound y outbound no son pipelines separados. Son dos modos de la misma operacion sobre Customer.

## Agentes principales

### Supervisor Agent

Coordina, prioriza, audita y decide si una tarea puede ejecutarse, quedar en borrador o exigir aprobacion.

### Sales Agent

Capta lead, califica, identifica oportunidad y propone siguientes pasos comerciales.

### Quote Agent

Prepara cotizaciones, valida supuestos y solicita aprobacion cuando la cotizacion implique riesgo o cambios sensibles.

### Follow-up Agent

Propone y ejecuta seguimientos, recordatorios y reactivaciones segun contexto, ventana y prioridad.

### Marketing Research Agent

Investiga clientes, segmentos, señales y oportunidades de campana, pero no envía sin aprobacion.

### Campaign Agent

Redacta borradores de campanas, secuencias y mensajes para aprobacion humana.

### Postventa Agent

Resuelve requerimientos de postventa de bajo riesgo y deriva lo sensible.

### SAC Agent

Clasifica y prepara respuestas de atencion al cliente con limites estrictos de riesgo.

### Knowledge Agent

Responde preguntas, busca contexto y ayuda a reducir incertidumbre operacional.

### Operator Copilot

Interfaz para humanos dentro del HUB que explica decisiones, logs, costos, tools, errores y recomendaciones.

Su foco inicial es revisar el AI SDR, no administrar tickets.

### Call/Voice Tool futura

Tool modular futura para llamadas de voz. Debe tratarse como una capability sensible y separada.

## Niveles de autonomia

La meta de largo plazo es autonomia nivel 5.

Para MVP, el objetivo operativo es nivel 2 a 4 con aprobacion humana para acciones sensibles.

| Nivel | Descripcion |
|---|---|
| 0 | Solo observa y reporta. |
| 1 | Redacta borradores y recomendaciones. |
| 2 | Ejecuta acciones internas de bajo riesgo con revision humana previa para lo sensible. |
| 3 | Ejecuta acciones de bajo riesgo y pide aprobacion solo para umbrales o cambios relevantes. |
| 4 | Opera con supervision humana, escalando solo excepciones, cambios sensibles o rutas prohibidas. |
| 5 | Autonomia completa futura con policy y auditoria estrictas. |

## Evolucion a SaaS y AaaS

La evolucion esperada es:

1. Producto interno operativo para PesasChile.
2. Plataforma reusable para otras operaciones ecommerce.
3. SaaS con configuracion por cliente, canal y politica.
4. AaaS con agentes configurables, herramientas versionadas y supervision.

Para llegar ahi, el producto debe quedar basado en:

- contratos estructurados,
- permisos por capability,
- acciones gobernadas,
- trazabilidad completa,
- identidad migrable,
- integracion desacoplada con n8n.

La primera capa reusable para escalar a SaaS/AaaS es el operating model comercial, no la UI ni el case flow.

La UI de P1M es una capa de modelado y validacion del producto, no el lugar donde se resuelven los side effects productivos.

