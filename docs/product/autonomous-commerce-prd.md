---
title: PRD - Sistema Autonomo de Gestion Comercial para E-commerce
doc_id: product-autonomous-commerce-prd
status: approved
version: "1.0.0"
owner: product
last_reviewed: 2026-07-09
source_of_truth_for:
  - product vision
  - scope
  - commercial principles
depends_on: []
supersedes: []
tags:
  - product
---

# PRD — Sistema Autónomo de Gestión Comercial para E-commerce

**Estado:** Borrador rector
**Versión:** 0.1
**Producto:** Autonomous Commerce System
**Nombre interno actual:** AI SDR / CRM Customer 360
**Fecha:** Junio de 2026

---

## 1. Resumen ejecutivo

El producto es un sistema autónomo de gestión comercial para empresas de e-commerce, diseñado para operar 24/7 y asumir progresivamente una parte sustancial de las funciones realizadas actualmente por vendedores, supervisores comerciales y equipos de seguimiento.

Este producto corresponde a la segunda evolución del AI SDR desarrollado en el proyecto. La primera etapa demostró capacidades de conversación, recomendación, persistencia comercial y mensajería. La segunda etapa transforma esas capacidades en un ciclo autónomo y continuo de gestión de oportunidades, acciones y resultados.

No es un chatbot, un asistente de respuestas ni un clasificador de mensajes.

El sistema debe observar eventos comerciales, comprender al cliente, mantener el estado durable de cada oportunidad, determinar la siguiente mejor acción, ejecutar acciones mediante herramientas controladas, medir resultados y actualizar continuamente su estrategia hasta que la oportunidad sea ganada, perdida, pausada o escalada.

La conversación es una interfaz del sistema. WhatsApp será el primer canal productivo, pero la arquitectura debe admitir posteriormente email, llamadas, webchat y otros canales sin reemplazar el núcleo comercial.

El sistema debe operar sobre datos verificables y herramientas determinísticas. La inteligencia artificial podrá interpretar lenguaje, razonar sobre contexto, seleccionar estrategias y redactar respuestas, pero no será fuente de verdad ni podrá ejecutar efectos arbitrarios.

---

# 2. Problema

Los equipos comerciales de e-commerce presentan limitaciones estructurales:

* cobertura restringida a horarios laborales;
* tiempos de respuesta variables;
* pérdida de oportunidades sin seguimiento;
* recomendaciones inconsistentes;
* conocimiento comercial distribuido entre personas;
* baja trazabilidad de decisiones;
* seguimiento manual y poco disciplinado;
* dependencia excesiva de vendedores individuales;
* dificultad para atender simultáneamente grandes volúmenes;
* fragmentación entre mensajería, CRM, catálogo, órdenes y postventa;
* escasa capacidad de medir qué estrategias comerciales funcionan;
* altos costos de crecimiento del equipo comercial.

Los chatbots convencionales no resuelven este problema porque operan principalmente bajo el paradigma:

```text
mensaje → respuesta
```

Ese paradigma no administra oportunidades, no persigue resultados, no conserva una estrategia comercial durable y no evalúa el efecto de sus acciones.

---

# 3. Visión del producto

Construir un sistema comercial autónomo que pueda administrar una cartera de clientes y oportunidades de forma continua.

El paradigma central será:

```text
evento comercial
→ comprensión del cliente y la oportunidad
→ evaluación del estado
→ definición de estrategia
→ selección de próxima acción
→ ejecución
→ observación del resultado
→ actualización del estado comercial
→ repetición
```

El sistema debe llegar progresivamente a:

* responder consultas comerciales las 24 horas;
* descubrir necesidades;
* calificar clientes;
* recomendar productos;
* comparar alternativas;
* gestionar objeciones;
* realizar cross-sell y upsell;
* preparar cotizaciones;
* entregar enlaces de compra;
* hacer seguimiento;
* reactivar oportunidades;
* conducir al checkout;
* cerrar ventas;
* identificar oportunidades perdidas;
* escalar excepciones;
* coordinar comunicaciones por diferentes canales;
* realizar llamadas comerciales en etapas posteriores.

---

# 4. Objetivo estratégico

Reducir de forma significativa la dependencia de atención comercial humana en operaciones repetitivas, frecuentes y gobernables, manteniendo o mejorando:

* velocidad de respuesta;
* tasa de conversión;
* consistencia comercial;
* cobertura horaria;
* calidad de recomendación;
* disciplina de seguimiento;
* trazabilidad;
* experiencia del cliente.

El sistema debe permitir que los equipos humanos se concentren en:

* negociaciones excepcionales;
* clientes de alto valor;
* conflictos;
* acuerdos especiales;
* reclamos;
* decisiones no autorizadas;
* relaciones comerciales complejas.

---

# 5. Principios del producto

## 5.1 La oportunidad es el centro

El sistema no administra solamente mensajes. Administra oportunidades comerciales.

Cada mensaje, llamada, acción y resultado debe interpretarse en relación con:

* cliente;
* necesidad;
* oportunidad;
* etapa;
* estrategia;
* siguiente acción;
* resultado esperado.

## 5.2 La conversación es un canal

WhatsApp, email, webchat y voz son interfaces del mismo núcleo.

El núcleo no debe depender de conceptos específicos como:

* `wamid`;
* `phone_number_id`;
* payloads Meta;
* templates de WhatsApp;
* IDs de una plataforma determinada.

Estos conceptos pertenecen a adaptadores de canal.

## 5.3 El CRM es memoria durable

El CRM debe conservar:

* identidad;
* contexto;
* perfil de necesidad;
* oportunidades;
* productos considerados;
* objeciones;
* acciones;
* decisiones;
* resultados;
* acuerdos;
* preferencias;
* historial resumido.

El modelo de IA no debe ser utilizado como memoria principal.

## 5.4 Los datos del negocio son determinísticos

El sistema no puede inventar:

* productos;
* precios;
* stock;
* dimensiones;
* compatibilidades;
* descuentos;
* promociones;
* fechas de entrega;
* políticas;
* condiciones comerciales.

Estos datos deben obtenerse mediante tools conectadas a fuentes verificables.

## 5.5 Los efectos deben estar gobernados

Toda acción que produzca un efecto debe pasar por:

```text
decisión
→ validación
→ comando
→ ejecución
→ auditoría
```

La IA no debe escribir directamente en tablas, llamar APIs externas arbitrariamente ni enviar mensajes fuera de los límites establecidos.

## 5.6 Toda acción debe ser evaluable

Cada acción debe registrar:

* por qué se eligió;
* qué resultado se esperaba;
* qué herramienta se utilizó;
* qué ocurrió;
* si avanzó la oportunidad;
* qué estrategia debe aplicarse después.

---

# 6. Usuarios y actores

## 6.1 Cliente final

Persona que:

* consulta productos;
* compara;
* solicita información;
* compra;
* responde seguimientos;
* requiere apoyo comercial.

## 6.2 Operador comercial humano

Usuario que:

* revisa conversaciones;
* toma control;
* interviene en excepciones;
* aprueba acciones restringidas;
* modifica oportunidades;
* corrige errores;
* supervisa al agente.

## 6.3 Supervisor comercial

Usuario que:

* monitorea desempeño;
* revisa estrategias;
* configura políticas;
* analiza oportunidades;
* interviene en operaciones de alto valor;
* evalúa métricas y errores.

## 6.4 Administrador de negocio

Usuario que configura:

* catálogo;
* fuentes de datos;
* políticas;
* promociones;
* horarios;
* límites de autonomía;
* canales;
* reglas de escalamiento.

## 6.5 Sistema autónomo

Actor que:

* observa eventos;
* comprende contexto;
* propone o ejecuta acciones;
* actualiza CRM;
* programa seguimientos;
* mide resultados;
* escala cuando corresponde.

---

# 7. Trabajos comerciales que debe asumir

## 7.1 Recepción y clasificación

El sistema debe:

* recibir eventos de distintos canales;
* identificar al cliente;
* recuperar o crear conversación;
* determinar si la intención es comercial;
* distinguir venta, consulta, postventa, reclamo y solicitud humana;
* detectar mensajes duplicados;
* correlacionar eventos con oportunidades existentes.

## 7.2 Recuperación de contexto

Debe recuperar:

* información general del cliente;
* compras anteriores;
* conversaciones relevantes;
* oportunidades abiertas;
* necesidades conocidas;
* objeciones anteriores;
* productos considerados;
* acciones pendientes;
* resultados recientes.

## 7.3 Descubrimiento

Debe determinar:

* qué quiere conseguir el cliente;
* qué producto o categoría necesita;
* para qué lo utilizará;
* presupuesto;
* restricciones de espacio;
* ubicación;
* urgencia;
* nivel de experiencia;
* características requeridas;
* características preferidas;
* quién toma la decisión;
* qué información falta.

## 7.4 Calificación

Debe evaluar:

* claridad de necesidad;
* disposición de compra;
* ajuste entre necesidad y catálogo;
* presupuesto;
* urgencia;
* valor comercial potencial;
* complejidad;
* necesidad de intervención humana.

## 7.5 Recomendación

Debe:

* buscar productos reales;
* aplicar filtros duros;
* excluir incompatibilidades;
* comparar opciones;
* seleccionar recomendación principal;
* seleccionar alternativa;
* explicar diferencias;
* reconocer limitaciones;
* recomendar complementos relevantes;
* realizar upsell cuando exista beneficio demostrable.

## 7.6 Manejo de objeciones

Debe abordar:

* precio;
* costo de despacho;
* espacio;
* stock;
* plazo;
* calidad;
* compatibilidad;
* confianza;
* competidores;
* necesidad de aprobación;
* indecisión;
* postergación;
* falta de información.

## 7.7 Avance hacia compra

Debe poder:

* entregar precio;
* calcular despacho;
* proporcionar condiciones;
* preparar cotización;
* crear enlace de checkout;
* confirmar selección;
* solicitar datos necesarios;
* conducir al siguiente paso;
* escalar excepciones.

## 7.8 Seguimiento

Debe:

* definir si corresponde seguimiento;
* decidir momento y canal;
* crear acción;
* adaptar contenido;
* limitar frecuencia;
* cancelar ante respuesta;
* detenerse ante rechazo;
* modificar estrategia según resultados;
* reactivar oportunidades dormidas.

## 7.9 Cierre

Debe identificar:

* venta ganada;
* venta perdida;
* oportunidad dormida;
* oportunidad pausada;
* oportunidad duplicada;
* necesidad de una oportunidad nueva.

## 7.10 Supervisión y escalamiento

Debe escalar ante:

* solicitud humana;
* identidad ambigua;
* reclamo;
* garantía;
* devolución;
* descuento no autorizado;
* precio inconsistente;
* falta de información crítica;
* cliente molesto;
* riesgo reputacional;
* falla repetida de tools;
* negociación especial;
* operación de alto valor definida por política.

---

# 8. Alcance funcional por etapas

## Etapa 1 — Vendedor autónomo por WhatsApp

Debe incluir:

* inbound nativo de Meta;
* identidad;
* conversación;
* mensajes;
* contexto;
* descubrimiento;
* recomendación;
* objeciones;
* oportunidades;
* acciones;
* outbound;
* follow-up;
* handoff;
* timeline;
* auditoría.

## Etapa 2 — Gestión comercial ampliada

Debe incluir:

* cotizaciones;
* checkout;
* cálculo de despacho;
* promociones;
* recuperación de carritos;
* reactivación;
* supervisión de cartera;
* priorización de oportunidades.

## Etapa 3 — Omnicanal

Debe incluir:

* email;
* llamadas;
* webchat;
* coordinación entre canales;
* continuidad de contexto.

## Etapa 4 — Optimización comercial

Debe incluir:

* evaluación de estrategias;
* experimentos controlados;
* priorización por probabilidad;
* asignación dinámica de autonomía;
* recomendaciones de mejora a supervisores.

---

# 9. Fuera de alcance inicial

No debe implementarse inicialmente:

* negociación libre de descuentos;
* modificación arbitraria de precios;
* devolución de dinero;
* cancelación automática de pedidos;
* resolución autónoma de garantías;
* promesas logísticas no verificadas;
* reserva de stock sin integración transaccional;
* autoaprendizaje sin supervisión;
* modificación automática de políticas;
* llamadas comerciales antes de estabilizar el ciclo por texto;
* reemplazo total de humanos para excepciones.

---

# 10. Ciclo autónomo comercial

## 10.1 Observe

Consume eventos:

* mensaje recibido;
* respuesta;
* mensaje leído;
* mensaje fallido;
* acción vencida;
* cambio de stock;
* cambio de precio;
* pedido creado;
* pedido pagado;
* pedido cancelado;
* oportunidad sin actividad;
* llamada terminada;
* intervención humana.

## 10.2 Understand

Construye una interpretación de:

* identidad;
* intención;
* necesidad;
* etapa;
* objeciones;
* contexto;
* señales de compra;
* contradicciones;
* riesgos;
* información faltante.

## 10.3 Evaluate

Evalúa:

* grado de ajuste;
* disposición;
* valor potencial;
* urgencia;
* riesgo de abandono;
* necesidad de tools;
* nivel de autonomía permitido;
* próxima acción posible.

## 10.4 Plan

Determina:

* objetivo del ciclo;
* estrategia;
* tools;
* siguiente mejor acción;
* canal;
* momento;
* condiciones de cancelación;
* resultado esperado.

## 10.5 Act

Ejecuta:

* pregunta;
* respuesta;
* recomendación;
* comparación;
* cotización;
* link;
* actualización CRM;
* seguimiento;
* escalamiento;
* llamada futura.

## 10.6 Measure

Observa:

* respuesta;
* silencio;
* lectura;
* avance;
* rechazo;
* compra;
* error;
* handoff;
* cancelación;
* conversión.

## 10.7 Update

Actualiza:

* oportunidad;
* perfil;
* conversación;
* objeciones;
* acciones;
* estrategia;
* prioridad;
* resumen;
* siguiente ciclo.

---

# 11. Modelo de estados

## 11.1 Conversación

```text
open
waiting_customer
waiting_system
waiting_human
closed
```

La conversación representa el estado del intercambio, no el estado comercial.

## 11.2 Oportunidad

```text
new
discovery
qualified
recommended
considering
purchase_intent
checkout
won
lost
dormant
```

## 11.3 Objetivo del ciclo

```text
understand_request
recover_context
collect_missing_information
clarify_ambiguity
qualify
recommend
compare
handle_objection
advance_purchase
schedule_follow_up
recover_opportunity
handoff
```

## 11.4 Acción

```text
proposed
scheduled
executing
completed
cancelled
expired
blocked
failed
```

## 11.5 Ejecución del agente

```text
created
running
waiting_tool
completed
failed
cancelled
escalated
```

Todos los contratos documentados en este PRD se persisten y versionan con `contractName` y `schemaVersion` en los envelopes reales.

---

# 12. Next Best Action

Cada ciclo debe producir como máximo una siguiente acción principal.

Tipos iniciales:

```text
ask_question
provide_information
recommend_product
recommend_alternative
compare_products
offer_bundle
handle_objection
calculate_shipping
prepare_quote
send_checkout_link
schedule_follow_up
send_follow_up
wait_for_customer
handoff
close_won
close_lost
pause
```

Contrato conceptual:

```ts
interface NextBestAction {
  type: string;
  objective: string;
  rationaleSummary: string;
  channel: string | null;
  dueAt: string | null;
  requiredTools: string[];
  preconditions: string[];
  cancellationConditions: string[];
  successCriteria: string[];
  idempotencyKey: string;
  approvalRequirement: "none" | "policy" | "human";
}
```

---

# 13. Estrategias comerciales

La IA selecciona y propone una estrategia según contexto; el Brain valida schema, datos, capabilities, políticas y factibilidad de ejecución, y la IA replantea cuando corresponde.

## 13.1 Exploratory discovery

Uso:

* necesidad vaga;
* cliente nuevo;
* información insuficiente.

Objetivo:

* descubrir problema y restricciones críticas.

## 13.2 Fast qualification

Uso:

* cliente directo;
* producto claro;
* urgencia alta.

Objetivo:

* obtener lo mínimo necesario para avanzar.

## 13.3 Consultative recommendation

Uso:

* necesidad compleja;
* varias opciones posibles;
* inversión relevante.

Objetivo:

* recomendar en función del uso, restricciones y valor.

## 13.4 Budget-focused recommendation

Uso:

* sensibilidad a precio;
* presupuesto explícito.

Objetivo:

* maximizar ajuste dentro de presupuesto.

## 13.5 Premium justification

Uso:

* cliente busca durabilidad, capacidad o uso intensivo.

Objetivo:

* justificar diferencia con atributos reales.

## 13.6 Comparison assistance

Uso:

* cliente compara productos.

Objetivo:

* reducir complejidad y mostrar trade-offs.

## 13.7 Objection recovery

Uso:

* objeción explícita o implícita.

Objetivo:

* comprender causa, responder y ofrecer alternativa.

## 13.8 Purchase acceleration

Uso:

* intención de compra alta.

Objetivo:

* eliminar fricción y conducir a checkout.

## 13.9 Low-pressure follow-up

Uso:

* cliente indeciso o temporalmente inactivo.

Objetivo:

* recuperar conversación sin generar presión excesiva.

## 13.10 Dormant opportunity recovery

Uso:

* oportunidad sin actividad durante un plazo definido.

Objetivo:

* determinar si cambió la necesidad y recuperar interés.

## 13.11 Human escalation

Uso:

* excepción, conflicto o restricción de autoridad.

Objetivo:

* transferir contexto completo sin perder continuidad.

---

# 14. Catálogo de tools

Cada tool debe tener:

* propósito;
* inputs;
* outputs;
* fuente;
* autorización;
* validaciones;
* idempotencia;
* errores;
* side effects;
* auditoría;
* estado de implementación.

## 14.1 Cliente y contexto

```text
resolve_customer
get_customer_context
get_recent_interactions
get_purchase_history
get_customer_preferences
get_active_opportunities
get_pending_actions
save_customer_fact
save_need_profile
```

## 14.2 Catálogo

```text
search_products
get_product_details
get_product_price
get_product_stock
get_product_dimensions
get_product_compatibility
compare_products
get_related_products
get_product_url
```

## 14.3 Condiciones comerciales

```text
calculate_shipping
get_delivery_estimate
get_payment_options
get_active_promotions
get_commercial_policy
prepare_quote
create_checkout_link
```

## 14.4 Oportunidades

```text
create_opportunity
update_opportunity
change_opportunity_stage
record_product_interest
record_objection
mark_won
mark_lost
pause_opportunity
reactivate_opportunity
```

## 14.5 Acciones

```text
create_follow_up
reschedule_follow_up
cancel_follow_up
complete_action
schedule_call
cancel_contact_action
create_escalation
request_human_handoff
```

## 14.6 Comunicación

```text
queue_whatsapp_message
queue_email
place_sales_call
transfer_to_human
```

Las tools no implementadas no pueden registrarse como disponibles.

---

# 15. Matriz de autoridad

## Puede ejecutar autónomamente

* recuperar contexto;
* consultar catálogo;
* preguntar;
* recomendar productos verificados;
* comparar;
* informar precios oficiales;
* informar stock;
* registrar necesidad;
* registrar objeción;
* crear o actualizar oportunidad;
* crear seguimiento;
* crear escalamiento;
* enviar seguimiento permitido;
* entregar link oficial;
* escalar.

## Requiere política explícita

* preparar cotización;
* aplicar promoción existente;
* calcular despacho;
* cerrar ganada;
* cerrar perdida;
* reactivar;
* contactar de forma proactiva;
* programar llamada.

## Requiere aprobación humana

* descuento especial;
* modificación de precio;
* excepción logística;
* compensación;
* compromiso contractual;
* reserva manual de stock;
* negociación de alto valor;
* cierre de conflicto.

## Prohibido inicialmente

* inventar productos o datos;
* ejecutar SQL;
* modificar políticas;
* cancelar pedidos;
* devolver dinero;
* resolver garantías;
* enviar mensajes fuera de consentimiento o política;
* contactar indefinidamente;
* cerrar reclamos automáticamente.

---

# 16. Niveles de autonomía

## Nivel 0 — Observación

Analiza y registra. No actúa.

## Nivel 1 — Copiloto

Propone respuesta, estrategia y acciones.

## Nivel 2 — Autonomía segura

Ejecuta:

* descubrimiento;
* consultas;
* recomendaciones;
* CRM;
* seguimiento;
* enlaces;
* handoff.

## Nivel 3 — Gestión comercial autónoma

Administra oportunidades completas dentro de políticas.

## Nivel 4 — Omnicanal

Coordina:

* WhatsApp;
* email;
* voz;
* webchat;
* reactivación multicanal.

---

# 17. Contexto y memoria

## 17.1 Datos durables

* identidad;
* compras;
* oportunidades;
* perfil;
* objeciones;
* productos considerados;
* acciones;
* resultados;
* preferencias;
* consentimientos.

## 17.2 Contexto reciente

* mensajes recientes;
* productos discutidos;
* preguntas pendientes;
* recomendaciones;
* respuestas recientes.

## 17.3 Resumen acumulado

* historia comercial;
* evolución;
* acuerdos;
* restricciones;
* razones de pérdida;
* riesgos.

## 17.4 Evidencia

Cada dato derivado debe poder incluir:

* fuente;
* timestamp;
* confianza;
* referencia.

El sistema no debe cargar el historial completo en cada ciclo ni depender de una memoria efímera del modelo.

---

# 18. Arquitectura conceptual

```text
Canales
  WhatsApp
  Email
  Voz
  Webchat
       ↓
Adaptadores de entrada
       ↓
Eventos comerciales normalizados
       ↓
Ciclo comercial autónomo
       ↓
Contexto + oportunidad + estrategia
       ↓
Tools verificadas
       ↓
Comandos de dominio
       ↓
CRM + acciones + outbox
       ↓
Adaptadores de salida
       ↓
Resultados y medición
```

## Separación obligatoria

### IA

Responsable de:

* interpretación;
* ambigüedad;
* razonamiento contextual;
* selección estratégica;
* planificación;
* comparación;
* redacción.

### Backend

Responsable de:

* datos;
* tools;
* permisos;
* validaciones;
* estados;
* persistencia;
* idempotencia;
* auditoría;
* side effects;
* transporte.

---

# 19. Modelo de datos actual

El núcleo local actual incluye:

```text
master_customer
conversation
conversation_message
crm_opportunities
crm_sales_need_profiles
crm_agent_decisions
crm_agent_actions
brain_message_outbox
ai_agent_execution
ai_agent_decision
ai_tool_execution
ai_conversation_state
hub_audit_log
```

## Fuente de verdad

| Responsabilidad      | Fuente                    |
| -------------------- | ------------------------- |
| Cliente              | `master_customer`         |
| Conversación         | `conversation`            |
| Mensajes             | `conversation_message`    |
| Oportunidad          | `crm_opportunities`       |
| Perfil comercial     | `crm_sales_need_profiles` |
| Decisión comercial   | `crm_agent_decisions`     |
| Acción               | `crm_agent_actions`       |
| Transporte / outbound| `brain_message_outbox`    |
| Ejecución técnica IA | `ai_agent_execution`      |
| Decisión técnica IA  | `ai_agent_decision`       |
| Tool execution       | `ai_tool_execution`       |
| Estado de IA         | `ai_conversation_state`   |
| Auditoría            | `hub_audit_log`           |

Debe definirse una frontera explícita entre:

```text
crm_agent_decisions
ai_agent_decision
```

La primera debe representar la decisión comercial durable.

La segunda debe representar la ejecución técnica del agente.

`brain_message_outbox` es una capa de transporte y despacho, no la verdad comercial de la acción.

## 19.1 Planificación y gobernanza de capacidades

El ciclo autónomo puede generar un plan amplio antes de aceptar una sola acción principal por ciclo.

## `AIPlan`

- assessment;
- objetivo;
- estrategia;
- acción principal;
- alternativas;
- capabilities;
- outcomes esperados;
- condiciones de replanteamiento;
- stop conditions;
- escalamiento;
- reactivación;
- evidencia;
- idempotencia.

## `CapabilityEvaluation`

Estados observables:

- `available`
- `unavailable`
- `denied`
- `requires_approval`
- `missing_information`
- `temporarily_blocked`
- `invalid_arguments`
- `failed`

La capability gateway informa disponibilidad y restricciones; no decide la estrategia comercial por sí sola.

## 19.2 Continuidad ante fallos

El sistema debe distinguir:

- restricción;
- fallo técnico;
- replanteamiento;
- escalamiento;
- outcome.

Un fallo técnico no debe cerrar una oportunidad por sí mismo ni detener otras conversaciones.

---

# 20. WhatsApp

WhatsApp será el primer canal real.

## Inbound

```text
Meta
→ webhook nativo
→ evento normalizado
→ conversación y mensaje
→ ciclo autónomo
```

## Outbound

```text
acción comercial
→ outbox
→ worker
→ adapter Meta
→ estado
→ timeline
```

El núcleo no debe depender directamente de Meta.

Debe manejar:

* idempotencia;
* mensajes duplicados;
* estados `sent`, `delivered`, `read`, `failed`;
* ventana de mensajería;
* templates;
* allowlists de prueba;
* bloqueo;
* handoff;
* reintentos.

---

# 21. Llamadas futuras

La voz debe utilizar el mismo ciclo.

```text
acción: realizar llamada
→ validar consentimiento y horario
→ preparar contexto y objetivo
→ iniciar llamada
→ conversación
→ transcripción
→ resultado
→ actualización CRM
→ próxima acción
```

No se debe implementar voz antes de estabilizar:

* contexto;
* oportunidades;
* estrategias;
* tools;
* acciones;
* medición;
* escalamiento.

---

# 22. UI mínima

La UI debe permitir:

## Conversaciones

* ver mensajes;
* estados de entrega;
* cliente;
* canal;
* estado IA;
* handoff;
* bloqueo.

## Oportunidad

* etapa;
* productos;
* valor estimado;
* perfil;
* objeciones;
* estrategia;
* próxima acción;
* resultado esperado.

## Acciones

* pendientes;
* programadas;
* ejecutadas;
* canceladas;
* fallidas;
* vencidas.

## Supervisión

* decisiones;
* tools;
* evidencias;
* errores;
* resultados;
* intervención humana.

La UI no debe presentar fixtures o previews como capacidades reales.

---

# 23. Métricas

## 23.1 Comerciales

* conversión;
* ingresos;
* ticket promedio;
* tiempo hasta compra;
* progresión de etapa;
* recuperación de oportunidades;
* tasa de seguimiento efectivo.

## 23.2 Operativas

* tiempo de primera respuesta;
* latencia;
* disponibilidad;
* errores;
* retries;
* duplicados;
* tool failures.

## 23.3 Calidad

* recomendaciones válidas;
* datos incorrectos;
* productos incompatibles;
* respuestas corregidas;
* handoff;
* satisfacción;
* reclamos.

## 23.4 Seguridad y gobernanza

* contactos fuera de política;
* descuentos no autorizados;
* promesas inválidas;
* acciones bloqueadas;
* opt-outs;
* frecuencia excesiva.

---

# 24. Requerimientos funcionales prioritarios

## RF-01 — Ingesta nativa

El sistema debe persistir eventos inbound de forma idempotente.

## RF-02 — Identidad

Debe resolver o crear un cliente sin depender de tablas legacy.

## RF-03 — Memoria

Debe conservar contexto entre turnos y reinicios.

## RF-04 — Oportunidad

Debe crear, recuperar y actualizar una única oportunidad lógica.

## RF-05 — Perfil

Debe persistir necesidades, restricciones y preferencias.

## RF-06 — Next Best Action

Debe determinar una acción principal por ciclo.

## RF-07 — Tools

Debe consultar datos verificables mediante contratos controlados.

## RF-08 — Recomendación

Debe recomendar solo productos válidos.

## RF-09 — Objeciones

Debe detectar, registrar y responder objeciones.

## RF-10 — Seguimiento

Debe programar, ejecutar, cancelar y auditar follow-ups.

## RF-11 — Outbound

Debe enviar mediante outbox y adapters.

## RF-12 — Handoff

Debe suspender autonomía y transferir contexto.

## RF-13 — Medición

Debe relacionar acción, resultado y progresión comercial.

## RF-14 — UI

Debe permitir operar y supervisar el sistema sin herramientas técnicas.

## RF-15 — Independencia de legacy

Debe funcionar sin n8n, vistas legacy ni base Amazon.

---

# 25. Requerimientos no funcionales

* idempotencia;
* trazabilidad;
* auditabilidad;
* recuperación después de fallos;
* aislamiento entre clientes;
* consistencia transaccional;
* seguridad de credenciales;
* fail-closed para side effects;
* límites de reintentos;
* timeouts;
* observabilidad;
* versionado de contratos;
* protección contra mensajes duplicados;
* capacidad de reinicio sin pérdida de contexto.

---

# 26. Primer vertical productivo

## Alcance

Venta consultiva de productos mediante WhatsApp.

## Flujo

```text
cliente consulta
→ sistema identifica
→ crea oportunidad
→ descubre necesidad
→ consulta catálogo
→ recomienda
→ registra interés
→ maneja objeción
→ selecciona próxima acción
→ responde
→ realiza seguimiento
→ observa respuesta
→ actualiza estrategia
```

## Conversación mínima

### Turno 1

> Busco una jaula para entrenar en casa.

Resultado:

* intención comercial;
* oportunidad;
* perfil;
* pregunta de descubrimiento.

### Turno 2

> Tengo poco espacio y máximo 500 mil.

Resultado:

* presupuesto y espacio persistidos;
* productos filtrados;
* recomendación principal y alternativa.

### Turno 3

> Está muy cara.

Resultado:

* objeción;
* alternativa;
* trade-off.

### Turno 4

> Lo voy a pensar.

Resultado:

* seguimiento programado;
* pausa correcta.

### Turno 5

Respuesta antes del seguimiento o silencio.

Resultado:

* cancelación o ejecución;
* actualización de la oportunidad.

---

# 27. Criterio de producto funcional

El primer vertical se considera funcional cuando:

1. opera desde WhatsApp real;
2. utiliza MariaDB local;
3. no consulta legacy;
4. persiste inbound;
5. resuelve cliente;
6. mantiene conversación;
7. conserva contexto;
8. crea y reutiliza oportunidad;
9. mantiene perfil;
10. recomienda productos reales;
11. maneja objeciones;
12. selecciona una próxima acción;
13. crea follow-up;
14. cancela ante respuesta;
15. ejecuta ante silencio;
16. persiste outbound;
17. actualiza estados;
18. muestra timeline;
19. permite handoff;
20. sobrevive reinicios;
21. evita duplicados;
22. registra decisiones, tools y resultados.

---

# 28. Roadmap historico

La secuencia P1/P2/P3 de esta seccion es historica. La roadmap normativa actual vive en [docs/ROADMAP.md](../ROADMAP.md) y la paralelizacion de trabajo vive en [MVP_EXECUTION_MAP.md](MVP_EXECUTION_MAP.md).

## Fase 1 — Núcleo nativo

* identidad;
* conversaciones;
* mensajes;
* oportunidades;
* perfiles;
* acciones;
* outbox;
* auditoría.

## Fase 2 — Ciclo autónomo

* eventos;
* estado;
* estrategia;
* next best action;
* resultados.

## Fase 3 — Catálogo de tools

* fuentes;
* contratos;
* validaciones;
* ejecución;
* auditoría.

## Fase 4 — Estrategia comercial

* descubrimiento;
* recomendación;
* objeciones;
* cierre;
* seguimiento.

## Fase 5 — IA gobernada

* interpretación;
* planificación;
* comparación;
* redacción;
* outputs estructurados.

## Fase 6 — WhatsApp productivo

* inbound;
* outbound;
* estados;
* templates;
* políticas;
* handoff.

## Fase 7 — UI comercial

* conversaciones;
* oportunidades;
* acciones;
* supervisión;
* métricas.

## Fase 8 — Autonomía ampliada

* checkout;
* promociones;
* cotizaciones;
* reactivación;
* priorización.

## Fase 9 — Omnicanal

* email;
* llamadas;
* webchat.

---

# 29. Riesgos principales

## Riesgo: convertirlo en chatbot

Mitigación:

* diseñar alrededor de oportunidades, acciones y resultados.

## Riesgo: falsa autonomía

Mitigación:

* exigir evidencia end-to-end, no archivos, contratos o mocks.

## Riesgo: respuestas inteligentes con datos incorrectos

Mitigación:

* tools verificadas y validación antes del envío.

## Riesgo: automatizar spam

Mitigación:

* políticas de contacto, cancelación, opt-out y medición.

## Riesgo: exceso de reglas rígidas

Mitigación:

* backend determinístico para control; IA para interpretación y estrategia.

## Riesgo: IA sin límites

Mitigación:

* command boundaries, autorización, auditoría y fail-closed.

## Riesgo: arquitectura dependiente de PesasChile

Mitigación:

* adapters para canales, catálogo, órdenes y clientes.

## Riesgo: múltiples runtimes paralelos

Mitigación:

* un único ciclo productivo y clasificación explícita de código experimental.

---

# 30. Reglas para desarrollo con agentes de código

Codex, Claude Code u otros agentes deben respetar:

1. No describir contratos como capacidades funcionales.
2. No considerar un test puro equivalente a un flujo productivo.
3. No crear runtimes paralelos.
4. No agregar tools sin implementación real.
5. No introducir dependencias legacy.
6. No centrar el diseño en mensajes.
7. No crear efectos externos desde repositories.
8. No habilitar side effects por defecto.
9. No utilizar mocks como fuente de verdad.
10. No ampliar alcance sin actualizar este PRD.
11. Toda feature debe declarar:

    * trabajo comercial;
    * estado afectado;
    * tool;
    * comando;
    * resultado esperado;
    * medición;
    * criterio de aceptación.
12. Todo cambio debe indicar si pertenece a:

    * núcleo productivo;
    * adapter;
    * infraestructura;
    * simulación;
    * dev-only;
    * legacy;
    * deprecated.

---

# 31. Preguntas que todo diseño debe responder

Antes de implementar una capacidad debe quedar claro:

* ¿Qué evento la activa?
* ¿Qué sabe el sistema?
* ¿Qué información le falta?
* ¿Qué oportunidad afecta?
* ¿Qué objetivo intenta lograr?
* ¿Qué estrategia utiliza?
* ¿Qué tool necesita?
* ¿Quién autoriza?
* ¿Qué efecto produce?
* ¿Cómo se evita duplicar?
* ¿Qué resultado espera?
* ¿Cómo mide el resultado?
* ¿Cuándo cancela?
* ¿Cuándo escala?
* ¿Qué queda persistido?

---

# 32. Definición final del producto

El producto es un sistema autónomo de gestión comercial para e-commerce que observa eventos, mantiene contexto y oportunidades, selecciona estrategias, ejecuta acciones mediante herramientas verificadas, mide resultados y continúa operando hasta lograr una venta, determinar una pérdida, pausar la oportunidad o transferirla a una persona.

WhatsApp es el primer canal.

La inteligencia artificial será un componente de interpretación y estrategia.

El CRM será la memoria.

Las tools serán las capacidades operativas.

El backend será el sistema de control.

Las oportunidades, acciones y resultados serán la unidad central del producto.
