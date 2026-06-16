# Customer Operating Model

## Principio central

Customer es la entidad central del modelo operativo.

Todo lo importante debe poder resolverse desde Customer:

- quien es,
- como se identifica,
- que conversaciones tiene,
- que intenciones muestra,
- que oportunidades existen,
- que cotizaciones se generaron,
- que follow-ups estan pendientes,
- que casos o reclamos existen,
- que campañas recibio,
- que decisiones tomo un agente,
- que acciones fueron aprobadas,
- que eventos quedaron en su timeline.

## Identidad primaria

Cuando existe email util, email es la primary identity del Customer.

Si no existe email, la identidad provisional debe apoyarse en la mejor clave disponible, normalmente:

1. `wa_id`
2. `phone`
3. `id_customer` PrestaShop
4. `id_order`
5. `invoice_number`
6. `contact_id`
7. futuros ids de AppSheet

Esto no crea un Customer Master definitivo. Solo define una estrategia de resolucion operativa hasta que exista `customer_master`.

## Identity map

Cada Customer puede tener multiples identidades.

| Identidad | Rol | Uso principal |
|---|---|---|
| `email` | Primary identity cuando existe | Unificacion comercial y contacto multicanal. |
| `wa_id` | Anchor inicial frecuente | Ingreso por WhatsApp e identidad provisional. |
| `phone` | Identidad de soporte | Normalizacion y matching parcial. |
| `id_customer` | Identidad ecommerce | Cruce con PrestaShop / MariaDB. |
| `id_order` | Identidad de transaccion | Contexto de compra y postventa. |
| `invoice_number` | Identidad documental | Soporte, conciliacion y trazabilidad. |
| `contact_id` | Identidad externa | Integraciones y fuentes futuras. |
| AppSheet ids futuros | Identidad extendida | Migracion futura sin romper el nucleo. |

## Customer timeline

El timeline de Customer es la secuencia canonica de eventos observables y decisiones relevantes.

Debe incluir, como minimo:

- inbound messages,
- outbound messages,
- conversations,
- intent changes,
- opportunity changes,
- quote drafts and approvals,
- follow-up tasks,
- case events,
- campaign events,
- agent decisions,
- approved actions,
- manual operator actions.

El timeline no debe depender de una sola fuente ni de una sola entidad legacy.

## Customer opportunity and intent graph

Customer no es una ficha estatica. Es un grafo operacional.

### Nodos principales

- Customer
- Identity
- Conversation
- Intent
- Opportunity
- Quote
- Follow-up
- Case
- Campaign
- Agent Decision
- Approved Action
- Timeline Event

### Relaciones

- Un Customer puede tener muchas Conversations.
- Una Conversation puede expresar uno o varios Intents.
- Un Intent puede abrir o actualizar una Opportunity.
- Una Opportunity puede generar Quotes y Follow-ups.
- Una Case puede coexistir con una Opportunity, pero no reemplazarla.
- Un Campaign puede impactar multiples Customers.
- Un Agent Decision puede proponer acciones, pero no ejecutarlas por si sola.
- Un Approved Action es el paso que valida una accion sensible antes de ejecucion.

## Diferencias canonicas

| Concepto | Definicion | No es |
|---|---|---|
| Customer | Entidad central con identidad, contexto y estado comercial. | No es un caso, ni una conversacion, ni una cola. |
| Conversation | Intercambio de mensajes en un canal y ventana concreta. | No es la identidad del cliente. |
| Opportunity | Oportunidad comercial concreta y medible. | No es una simple intencion ni un mensaje aislado. |
| Quote | Propuesta formal o borrador de precio/condicion. | No es un chat, ni un caso, ni una campaña. |
| Follow-up | Proxima accion comercial o de atencion a ejecutar. | No es un estado final. |
| Case | Incidencia, reclamo, soporte o flujo de resolucion. | No es el centro del producto. |
| Campaign | Secuencia o accion de marketing orientada a segmento. | No es una oportunidad individual. |
| Agent Decision | Salida estructurada de un agente con razon y policy. | No es una accion ejecutada por defecto. |
| Work Queue | Vista operativa de tareas pendientes. | No es la entidad maestra del modelo. |

## Work Queue como vista operativa

Work Queue y Work Item existen solo como vista operativa.

Sirven para:

- priorizar pendientes,
- asignar responsables,
- revisar aprobaciones,
- ordenar tareas internas.

No deben ser el centro deterministico del sistema ni reemplazar a Customer.

## Operational layers

### Layer 1: Identity

Resolver quien es el Customer.

### Layer 2: Conversation

Entender que esta pasando en el canal.

### Layer 3: Intent

Clasificar la necesidad o senal comercial.

### Layer 4: Opportunity

Convertir la senal en una oportunidad accionable.

### Layer 5: Decision and governance

Determinar que puede hacer un agente, que debe quedar en borrador y que requiere aprobacion.

### Layer 6: Approved execution

Ejecutar lo aprobado y registrar el evento en timeline.

## Princpios de modelado

1. Customer primero.
2. Identity map antes que Customer Master definitivo.
3. Conversations, intents y opportunities como entidades separadas.
4. Cases como subdominio operacional, no como centro.
5. Work Queue como vista, no como verdad.
6. Timeline como auditabilidad operacional.
7. Agent Decision y Approved Action como entidades obligatorias para trazabilidad.

