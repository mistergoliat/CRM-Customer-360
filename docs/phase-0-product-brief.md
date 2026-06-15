# PesasChile AI Hub - Phase 0 Product Brief

## Nombre del producto

PesasChile AI Hub

## Vision

Construir una plataforma propia para atencion comercial, gestion de casos, seguimiento comercial, marketing automation e inteligencia operacional basada en IA, con capacidad de reemplazar progresivamente Zenvia y luego Brevo.

## Objetivos

1. Centralizar la operacion conversacional de WhatsApp en el HUB.
2. Gestionar casos con trazabilidad y estados claros.
3. Permitir routing humano e IA con reglas auditables.
4. Preparar el motor de seguimiento comercial.
5. Evolucionar hacia automatizacion comercial y marketing sin depender del core de n8n.
6. Construir una base lista para Customer Master futuro, pero sin implementarlo aun.

## Modulos del producto

### 1. Inbox / Conversational Hub

Bandeja operativa para ver conversaciones, priorizar trabajo y navegar contextos de caso.

### 2. Case Management

Gestion de ciclo de vida del caso: apertura, reapertura, cierre, prioridad, bloqueo de IA y trazabilidad.

### 3. AI Routing & Agents

Enrutamiento por intencion, agente, contexto y handoff humano.

### 4. Commercial Follow-up Engine

Motor de seguimiento comercial y postventa para tareas, recordatorios y secuencias futuras.

### 5. Customer 360 provisional

Vista temporal basada en identidad parcial. No es la version definitiva.

### 6. Marketing Automation futura

Capacidad posterior para reemplazar gradualmente Brevo.

### 7. Agent Control Center

Centro de control para agentes, prompts, reglas y configuracion operacional.

### 8. Intelligence & Dashboards

Paneles de salud, volumen, actividad, casos prioritarios y trazabilidad.

## KPIs

1. Tiempo de primera respuesta.
2. Tiempo de resolucion de caso.
3. Tasa de handoff humano.
4. Tasa de casos abiertos vs cerrados.
5. Tasa de respuesta manual dentro de ventana WhatsApp.
6. Volumen inbound y outbound por dia.
7. Casos prioritarios pendientes.
8. Casos con dato minimo suficiente para revision humana.
9. Tasa de errores de envio Meta.
10. Eventos auditablemente registrados por accion operativa.

## Entidades conceptuales

### Entidades actuales

1. Conversation Case
2. Conversation Message
3. WhatsApp Inbound Message
4. Audit Event
5. Inbox Item
6. System Health Item
7. Legacy Operational Queue

### Identidad provisional

1. `wa_id`
2. `phone_number_id`
3. `id_customer`
4. `id_order`
5. `invoice_number`
6. `email`
7. `contact_id`

### Entidades futuras

1. `customer_master`
2. `customer_key`
3. Agent Profile
4. Prompt Version
5. Follow-up Task
6. Campaign
7. Audience Segment
8. Knowledge Item
9. Deliverability Event

## Que reemplaza Zenvia

PesasChile AI Hub debe absorber progresivamente:

1. Inbox operativo de WhatsApp.
2. Lectura de conversaciones y contexto.
3. Respuesta manual con trazabilidad.
4. Caso y handoff humano.
5. Clasificacion y seguimiento operativo.

## Que reemplazara Brevo despues

Mas adelante el HUB debe absorber:

1. Segmentation comercial.
2. Automatizaciones y secuencias.
3. Templates y mensajes comerciales.
4. Tracking de entregabilidad.
5. Seguimiento postventa y lifecycle marketing.

## Que queda fuera por ahora

1. Customer 360 definitivo.
2. Memoria comercial completa.
3. `customer_master` real.
4. Marketing automation funcional completa.
5. Reescritura total de n8n.
6. Reemplazo total de toda la infraestructura actual en una sola fase.
7. Feature aislada que no mapee a modulo, entidad o KPI.

## Principio rector de Fase 0

Todo lo que se construya desde ahora debe poder migrar despues a un modelo unificado de identidad y a un backend propio sin perder trazabilidad ni romper la preview actual.
