# Agent Capability Matrix

Esta matriz define el reparto funcional inicial del sistema agentic. La implementacion puede ser gradual, pero la semantica de capacidades debe mantenerse estable.

## Matrix

| Agent | Objetivo | Capacidades | Tools permitidas | Acciones autonomas | Acciones que requieren aprobacion | Acciones prohibidas | Fase |
|---|---|---|---|---|---|---|---|
| Supervisor Agent | Coordinar, priorizar y gobernar la operacion | Evaluar riesgo, enrutar tareas, validar policy, decidir draft vs execute | Read-only customer context, decision logs, approval queue, audit log | Clasificar prioridad, asignar work item, explicar decision, bloquear acciones | Aprobar acciones sensibles segun policy | Enviar directamente acciones sensibles sin policy | P1J/P1M |
| Sales Agent | Convertir interes en oportunidad | Calificar lead, resumir contexto, proponer siguiente paso, detectar urgencia | Customer timeline, conversation summary, opportunity draft, FAQ knowledge | Clasificar intencion, pedir datos faltantes, crear oportunidad, sugerir follow-up | Cotizacion formal, descuento, stock, agenda definitiva | Inventar precio, stock o condiciones | P1K |
| Quote Agent | Preparar cotizaciones | Armar borradores, comparar opciones, calcular condiciones, resumir supuestos | Product catalog read, pricing rules read, timeline, quote draft tool | Crear borrador, pedir aprobacion, explicar diferencias | Aplicar descuento, confirmar stock, confirmar despacho, confirmar fecha de entrega, enviar cotizacion formal | Confirmar disponibilidad o precio sin fuente | P1K |
| Follow-up Agent | Ejecutar seguimiento comercial | Priorizar proximos pasos, reactivar conversaciones, preparar recordatorios | Timeline, task queue, WhatsApp draft, email draft, approval queue | Sugerir follow-up, crear tarea interna, redactar borrador | Envio de follow-up sensible, cambios de orden, acciones que afecten pedido | Hacer spam o secuencias sin consentimiento | P1K/P1L |
| Marketing Research Agent | Investigar clientes, segmentos y oportunidades | Analizar señales, detectar cohortes, proponer audiencias y campanas | Customer data read, timeline, campaign history, external research tools when approved | Crear borrador de insight, proponer segmento, crear borrador de campana | Lanzar campaign final, activar audiencia, enviar masivo | Activar campañas sin aprobacion | P2 |
| Campaign Agent | Redactar y preparar campanas | Generar copy, secuencias, variantes y planes | Campaign draft tool, audience draft tool, content templates | Crear borrador, explicar rationale, preparar A/B ideas | Envio masivo, activacion de segmento, cambios de consentimiento | Enviar sin approval gate | P2 |
| Postventa Agent | Resolver postventa de bajo riesgo | Atender dudas de uso, estado, seguimiento, devolucion simple guiada | Order read, shipment read, timeline, knowledge base, approval queue | Responder FAQ bajo riesgo, pedir datos faltantes, crear tarea interna | Resolver reclamo sensible, ofrecer compensacion, rechazar garantia, modificar/cancelar pedido, emitir devolucion | Tomar decisiones de compensacion o garantia sin aprobacion | P1K/P1L |
| SAC Agent | Atencion al cliente y reclamos | Clasificar reclamos, identificar severidad, proponer respuesta o derivacion | Customer timeline, case history, policy rules, approval queue | Clasificar intencion, responder FAQ bajo riesgo, pedir datos faltantes | Resolver reclamo sensible, ofrecer compensacion, rechazar garantia, modificar/cancelar pedido, emitir devolucion | Prometer resoluciones sin fuente | P1K/P1L |
| Knowledge Agent | Reducir incertidumbre y apoyar decisiones | Buscar contexto, responder preguntas, citar fuentes internas | Read-only customer context, knowledge base, docs, safe search | Responder FAQ bajo riesgo, explicar decision, resumir logs | Ninguna accion sensible sin aprobacion explicita | Mutar casos o pedidos, inventar datos, enviar mensajes sensibles | P1K |
| Operator Copilot | Dar control a humanos dentro del HUB | Explicar decisions, mostrar logs, costos, tools, errores, riesgos y recomendaciones | Decision logs, approval queue, tool trace, usage/cost telemetry, replay sandbox | Comparar drafts, explicar diferencias, proponer cambios controlados | Aprobar o bloquear acciones sensibles segun policy operativa | Ejecutar acciones ocultas o sin trazabilidad | P1M |
| Call/Voice Tool futura | Habilitar llamadas asistidas | Orquestar llamadas, capture de outcome, transcription hooks, call notes | Telephony provider, transcription, call log, approval queue | Ninguna al inicio salvo preparar draft de llamada | Llamar por telefono, grabar, resumir y registrar outcome si la policy lo permite | Llamadas automaticas no aprobadas, outreach masivo por voz | P3 |

## Lectura operativa

- Los agentes de ventas y soporte pueden operar con autonomia acotada.
- Las acciones que alteran dinero, stock, pedidos, despacho o reputacion deben quedar gobernadas.
- Operator Copilot no compite con los agentes; los vuelve auditablemente manejables.
- Call/Voice debe tratarse como la capability mas sensible del MVP ampliado.

