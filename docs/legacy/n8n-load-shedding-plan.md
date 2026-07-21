---
title: P1C - n8n Load Shedding & AI Runtime Extraction Plan
doc_id: n8n-load-shedding-plan
status: superseded
superseded_by: docs/n8n-brain-integration.md
version: "1.1.0"
owner: architecture
last_reviewed: 2026-07-21
source_of_truth_for: []
depends_on: []
supersedes: []
tags:
  - historical
---

# P1C - n8n Load Shedding & AI Runtime Extraction Plan

Documento tecnico para descargar n8n y mover ejecucion pesada de IA, routing y context building hacia backend propio sin romper la operacion actual del HUB.

## 1. Objetivo

n8n debe dejar de crecer como cerebro IA/core del sistema. El incidente donde el Docker se congelo al procesar una pregunta compleja confirma que los workflows largos, prompts extensos y ejecuciones pesadas deben salir gradualmente hacia un runtime versionado, auditable y testeable en el backend del HUB.

Este plan no implementa llamadas reales a LLM, no modifica schema DB, no reemplaza n8n de golpe y no cambia la preview actual.

## 2. Diagnostico n8n desde el repo

### Dependencias directas `n8n_*`

El HUB depende hoy de estas tablas/vistas:

- `n8n_vw_hub_cases`
- `n8n_conversation_cases`
- `n8n_conversation_messages`
- `n8n_wa_inbound_messages`
- `n8n_postventa_queue`
- `n8n_mantenciones_cardio_queue`

Archivos principales:

- `lib/cases.ts`: lista casos desde `n8n_vw_hub_cases`, lee timeline desde `n8n_conversation_messages` y fallback desde `n8n_wa_inbound_messages`, escribe outbound manual en ambas tablas.
- `lib/chats.ts`: lista chats y contexto desde `n8n_vw_hub_cases`.
- `lib/caseActions.ts`: ejecuta reply manual, cierre, reapertura, prioridad y bloqueo IA sobre tablas legacy.
- `lib/case-detail.ts`: lee colas legacy `n8n_postventa_queue` y `n8n_mantenciones_cardio_queue`.
- `lib/dashboard.ts`: calcula metricas desde `n8n_vw_hub_cases`, `n8n_wa_inbound_messages` y `n8n_conversation_messages`.
- `lib/system.ts`: health operacional apoyado en `n8n_vw_hub_cases` y mensajes recientes.
- `app/api/system/schema/route.ts`: expone introspeccion de tablas `n8n_*`.
- `app/(hub)/cases/page.tsx` y `app/(hub)/dashboard/page.tsx`: la UI comunica explicitamente que opera sobre vistas n8n.

### Supuestos actuales del HUB

El HUB asume que n8n o el universo `n8n_*` produce:

- estado del caso: `status`, `lifecycle_status`, `requires_human`, `priority`, `final_action`;
- routing y contexto: `department`, `service_code`, `case_topic`, `source_table`, `source_id`;
- timeline: inbound/outbound en `n8n_conversation_messages` y `n8n_wa_inbound_messages`;
- datos de contacto/identidad provisional: `wa_id`, `phone_number_id`, `id_customer`, `id_order`, `invoice_number`, `contact_id`;
- senales IA: `intent`, `last_intent`, `bot_replied`, `ai_blocked`, `final_action`;
- health/operacion: conteos de casos, inbound/outbound recientes y ventana WhatsApp.

### Logica que parece vivir fuera del repo en n8n

Los exports bajo `tmp/` y la documentacion de Sprint 1 muestran que la logica pesada vive en workflows n8n:

- normalizacion de input WhatsApp;
- resolucion de identidad provisional y recuperacion de caso activo;
- context building con queries amplias a mensajes, colas y casos;
- armado de prompts y payloads DeepSeek/LLM;
- router master para decidir workflow/agente destino;
- validacion y normalizacion de output de agentes;
- handoff humano;
- cierre automatico de casos;
- ejecucion de respuesta automatica;
- insercion de agent runs y trazas de decision;
- reglas keyword-based y overrides de riesgo/department/service.

Conclusion: el repo ya contiene la UI, acciones manuales y persistencia parcial, pero n8n sigue produciendo contexto, decision IA, routing, cierres automaticos y gran parte de los efectos operacionales.

## 3. Hipotesis de carga del crash n8n

Causas probables, basadas en la forma de los workflows exportados y el incidente reportado:

- Payloads grandes: los contextos incluyen objetos completos de `input_event`, `customer_context`, `case_context`, `service_context`, `business_context`, `conversation_context` y `resolver_meta`.
- Prompts/contexto excesivo: algunos nodos serializan contexto completo con `JSON.stringify(..., null, 2)` hacia el modelo.
- Execution logs pesados: si n8n guarda payloads completos por nodo, cada ejecucion IA multiplica almacenamiento y memoria.
- Workflows largos: router, agentes, validadores, handoff, cierre y respuesta se encadenan con mucho estado intermedio.
- Ramas con JSON grande: cada rama conserva copias de contexto y outputs, elevando memoria por ejecucion.
- Queries amplias: lecturas de historial y colas pueden devolver mas datos de los necesarios para una decision.
- LLM calls lentas: una llamada bloqueante deja ejecuciones abiertas y aumenta presion de workers.
- Falta de queue/worker separation: webhook, context builder, LLM y acciones pueden competir en el mismo runtime.
- Falta de timeout/hard limits: sin limites estrictos de input, output, tiempo y cantidad de mensajes, una pregunta compleja puede congelar la instancia.

## 4. Plan de contencion inmediata

Medidas para mantener n8n vivo mientras se migra:

- Limitar contexto: pasar al LLM solo los ultimos N mensajes relevantes, no objetos completos de tablas.
- Definir timeout LLM duro: fallar controlado si el modelo no responde dentro del umbral operativo.
- Reducir `max_tokens`: cada agente debe tener max output tokens explicito y bajo por defecto.
- Pruning de executions: limpiar ejecuciones antiguas y fallidas con payload completo.
- Desactivar logs exitosos pesados: conservar metadata, errores y trazas esenciales; evitar guardar todo el input/output en ejecuciones exitosas.
- Cortar payloads grandes: truncar `message_text`, historiales, `raw_model_output` y campos de contexto extensos.
- Fallback ante timeout: devolver handoff humano o `should_reply=false` con razon auditable, no reintentos infinitos.
- Separar workflows criticos: mantener webhook Meta y persistencia minima desacoplados de agentes pesados.
- Congelar crecimiento core: no agregar nuevos agentes, routers o context builders complejos en n8n.
- Limitar fan-out: evitar ramas paralelas que clonen el mismo contexto completo.
- Revisar queries: usar `LIMIT`, columnas explicitas y ventanas temporales cortas.
- Definir payload budget: presupuesto maximo por ejecucion para contexto serializado, por ejemplo 20-40 KB en P1C inicial.

## 5. Arquitectura de extraccion IA

### Endpoint futuro

`POST /api/ai/orchestrate`

Debe ser el punto de entrada versionado para que n8n delegue decision IA al backend sin ejecutar prompts ni agentes pesados localmente.

### Request

```json
{
  "wa_id": "569XXXXXXXX",
  "phone_number_id": "123456789",
  "message_id": "wamid.x",
  "message_text": "Hola, necesito ayuda con mi pedido",
  "conversation_case_id": 123,
  "source": "n8n_meta_webhook",
  "context_mode": "minimal | standard | recovery"
}
```

Campos:

- `wa_id`: obligatorio, identidad WhatsApp provisional.
- `phone_number_id`: obligatorio si se espera responder por Meta.
- `message_id`: obligatorio para idempotencia y trazabilidad.
- `message_text`: obligatorio, truncado por politica antes de construir prompts.
- `conversation_case_id`: opcional, permite usar contexto de caso existente.
- `source`: obligatorio, identifica origen de invocacion.
- `context_mode`: obligatorio, controla profundidad de contexto.

### Response: AI Decision Envelope

```json
{
  "intent": "consulta_general",
  "department": "SAC",
  "case_topic": "pedido",
  "final_action": "handoff_to_human",
  "requires_human": true,
  "should_reply": false,
  "reply_text": "",
  "summary_for_operator": "Cliente pide ayuda con su pedido; requiere revision humana.",
  "next_action": "assign_human",
  "confidence": 0.82,
  "reason_summary": "Contexto insuficiente para respuesta automatica segura."
}
```

Reglas del envelope:

- `reply_text` solo puede venir poblado si `should_reply=true` y `requires_human=false`.
- `confidence` debe estar normalizado entre `0` y `1`.
- `reason_summary` debe explicar la decision en lenguaje operativo breve.
- `summary_for_operator` debe ser seguro para mostrar en HUB.
- `final_action` debe mapear a comandos o estados conocidos, no texto libre.
- La respuesta debe ser validada antes de que n8n ejecute acciones downstream.

### Contratos internos sugeridos

- `AiOrchestrationRequest`: DTO de entrada.
- `AiDecisionEnvelope`: DTO de salida.
- `AiContextBundle`: contexto reducido construido desde DB.
- `AiRuntimeResult`: resultado interno con warnings, timing y fuente.
- `AgentActionLog`: contrato futuro de auditoria por decision.

## 6. Responsabilidades durante la transicion

### Queda temporalmente en n8n

- Webhook Meta transitorio.
- Normalizacion minima del evento inbound.
- Conectores externos que ya funcionan.
- Jobs simples de integracion.
- Fallback temporal ante error del backend.
- Fan-out controlado hacia workflows legacy no migrados.
- Persistencia legacy que aun no tenga adapter backend.

### Pasa al backend

- Context building con limites y columnas controladas.
- Prompt assembly versionado.
- Model call y timeout/hard limits.
- Validacion estricta del AI Decision Envelope.
- Response policy: decidir si responde, deriva, cierra o no hace nada.
- Case command: abrir, actualizar, cerrar, reabrir, handoff.
- Audit: trazas de decision, input reducido, output validado y error handling.
- Follow-up futuro, cuando exista modelo propio.

### Regla de compatibilidad

n8n debe llamar al backend y recibir una decision estructurada. Mientras existan workflows legacy, n8n puede seguir ejecutando conectores y efectos operacionales, pero no debe ampliar su responsabilidad como runtime IA.

## 7. Seguridad, limites y observabilidad

Requisitos minimos para cualquier implementacion posterior:

- Idempotencia por `message_id` y, si existe, `conversation_case_id`.
- Autenticacion maquina-a-maquina con `AI_ORCHESTRATION_API_TOKEN` enviado como `Authorization: Bearer <token>`.
- Timeout de orquestacion backend menor al timeout del webhook n8n.
- Max input length para `message_text`.
- Max context messages segun `context_mode`.
- Max output tokens por agente.
- Validacion de enum para `intent`, `department`, `final_action` y `next_action`.
- Logs de decision sin guardar payload completo innecesario.
- Registro de errores con `source`, `message_id`, `wa_id`, `case_id` y razon.
- Feature flag para activar n8n -> backend por agente o porcentaje.
- Fallback seguro: `requires_human=true`, `should_reply=false` cuando el runtime falla.

## 8. Roadmap por PRs pequenas

PR 1 - `docs/n8n-load-shedding-plan.md`

- Crear este plan.
- Actualizar backlog P1C.
- Sin codigo funcional.

PR 2 - Tipos AI orchestration request/response

- Crear tipos DTO para request/response.
- No llamar modelo.
- No tocar n8n workflows.
- Validar con `npm run typecheck`, `npm run build`, `npm run lint` si esta disponible.

PR 3 - Endpoint mock `/api/ai/orchestrate`

- Implementar endpoint que valida input y devuelve envelope seguro mock.
- Default: `requires_human=true`, `should_reply=false`.
- Sin llamadas reales a LLM.

PR 4 - Adapter para consumir legacy context desde DB

- Leer contexto reducido desde `n8n_vw_hub_cases` y mensajes recientes.
- Limitar columnas, cantidad de mensajes y payload final.
- No crear schema nuevo.

PR 5 - Validacion de AI Decision Envelope

- Implementar validador estricto.
- Rechazar o normalizar outputs incompletos.
- Agregar tests de contratos si el repo ya tiene test runner; si no, documentar fixtures.

PR 6 - Feature flag para que n8n llame backend

- Definir flag por workflow/agente.
- n8n llama `/api/ai/orchestrate` en vez de ejecutar IA para un flujo acotado.
- Mantener fallback legacy.

PR 7 - Mover un agente simple como prueba

- Migrar el agente de menor riesgo operacional.
- Mantener metricas comparables y rollback inmediato.
- No migrar ventas, SAC completo ni postventa completo en la primera prueba.

## 9. Backlog inicial P1C

- `TASK-P1C-001 n8n load shedding plan`: documento rector y medidas de contencion.
- `TASK-P1C-002 define AI orchestration endpoint contract`: tipos y contrato de entrada/salida.
- `TASK-P1C-003 implement mock AI orchestrator endpoint`: endpoint mock seguro sin LLM.
- `TASK-P1C-004 feature flag n8n to backend AI routing`: switch transitorio para delegar IA desde n8n.
- `TASK-P1C-005 migrate first low-risk agent out of n8n`: prueba controlada de migracion.

## 10. Riesgos

- Si n8n sigue guardando payloads completos, el alivio sera parcial aunque el modelo salga al backend.
- Si el backend replica contextos gigantes, el problema se mueve de lugar.
- Si no hay idempotencia por `message_id`, los reintentos pueden duplicar acciones.
- Si el feature flag no es por agente/ruta, el rollback sera demasiado grueso.
- Si el endpoint mock se conecta demasiado pronto a efectos reales, puede romper la preview.
- Si `customer_master` se asume antes de existir, se bloqueara la migracion por una entidad futura.

## 11. Siguiente PR recomendada

Siguiente PR: `TASK-P1C-002 define AI orchestration endpoint contract`.

Alcance recomendado:

- Crear solo tipos/contratos para `AiOrchestrationRequest` y `AiDecisionEnvelope`.
- Documentar enums permitidos.
- Sin endpoint, sin DB, sin modelo y sin workflows n8n.
- Validar `npm run typecheck`, `npm run build` y `npm run lint` si esta disponible.
