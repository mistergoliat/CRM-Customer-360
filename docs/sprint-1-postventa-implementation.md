# Sprint 1 MVP Postventa

Documento ajustado con lectura dinamica real de n8n API sobre los workflows activos al momento de esta revision:

- `AI Orchestrator - Router Master2️⃣` (`id=eBpLMvSbYoCpw4kR`)
- `AI_AGENT_Postventa` (`id=LzIMwJOonu1MUxqP`)

Este repo no versiona los workflows n8n, por lo que la implementacion queda documentada aqui como contenido listo para pegar en n8n, sin tocar `OPS_Response_Executor`, `OPS_Response_Executor_SendWhatsApp`, `OPS_Handoff_Manager`, `OPS_Case_Closer`, `WA_01_Context_Resolver`, `Sales`, `Knowledge` ni `Campaign`.

## 1. Lista exacta de nodos a modificar

Lectura dinamica de los workflows activos muestra que Sprint 1 debe tocar solo estos cuatro nodos:

1. Workflow `AI Orchestrator - Router Master2️⃣` -> nodo `Code - Build DeepSeek Payload`
2. Workflow `AI Orchestrator - Router Master2️⃣` -> nodo `Code - Validate Output`
3. Workflow `AI_AGENT_Postventa` -> nodo `Code - Build DeepSeek Payload`
4. Workflow `AI_AGENT_Postventa` -> nodo `Code - Validate Output`

No es necesario tocar en Sprint 1:

1. `Code - Normalize Input` en ambos workflows, porque ya normaliza bien el input.
2. `Code - Return Orchestrator Result`, porque ya preserva metadata operativa para downstream.
3. `Code - Return Agent Result`, porque ya preserva `input_event`, `customer_context`, `case_context`, `service_context`, `business_context`, `conversation_context` y `resolver_meta`.

Hallazgos relevantes de la lectura dinamica:

1. El Router actual ya tiene una instruccion de enrutamiento, pero `Code - Validate Output` sigue metiendo override fuerte por listas de terminos y reglas keyword-based.
2. `AI_AGENT_Postventa` hoy viene configurado para derivar a humano por defecto en armado/mantencion, lo que contradice el objetivo de Sprint 1 de cerrar conversacion postventa dentro del agente.

## 2. Codigo completo solo para esos nodos

### Nodo 1: `AI Orchestrator - Router Master2️⃣` -> `Code - Build DeepSeek Payload`

Tipo sugerido: nodo LLM con salida JSON estructurada.

`System Prompt`

```text
Eres el Router Master del MVP Postventa.

Tu unica funcion es decidir quien debe evaluar el mensaje. No respondes al cliente, no resuelves negocio y no haces handoff final.

Politica obligatoria:
1. El Router decide quien evalua.
2. Si el contexto dominante es armado o mantencion, debes mandar a AI_AGENT_Postventa.
3. Si el mensaje es ambiguo pero viene de template o caso postventa, debes mandar a AI_AGENT_Postventa.
4. Si el cliente rechaza continuar en un hilo postventa activo, puedes mandar a OPS_Case_Closer.
5. No debes resolver por diccionario ni por keyword sola. Debes usar el mensaje y el contexto completo.
6. No debes generar texto para el cliente.
7. Debes preservar intactos estos objetos: input_event, customer_context, case_context, service_context, business_context, conversation_context, resolver_meta.

Senales de contexto postventa que pesan fuerte:
- source_table o source_domain de colas postventa/mantencion
- service_code o service_context asociados a armado o mantencion
- template reciente de postventa
- caso abierto de continuidad postventa
- historial conversacional del mismo caso de armado o mantencion

Cuando el mensaje sea ambiguo, prioriza el contexto por sobre la literalidad.

Devuelve solo JSON valido con esta estructura exacta:
{
  "router_action": "route",
  "target_workflow": "AI_AGENT_Postventa | OPS_Case_Closer | NO_ROUTE",
  "route_confidence": "high | medium | low",
  "dominant_context": "postventa_armado | postventa_mantencion | postventa_general | non_postventa | unknown",
  "message_ambiguity": "ambiguous | clear",
  "detected_customer_signal": "continue | decline | ask_info | ask_catalog | ask_sales | ask_human | unknown",
  "route_reason": "string",
  "should_reply": false,
  "input_event": {},
  "customer_context": {},
  "case_context": {},
  "service_context": {},
  "business_context": {},
  "conversation_context": {},
  "resolver_meta": {}
}
```

`User Prompt`

```text
Evalua este mensaje y su contexto.

Mensaje cliente:
{{ $json.input_event?.message_text ?? $json.input_event?.text ?? $json.message_text ?? $json.text ?? "" }}

Contexto:
{{ JSON.stringify({
  input_event: $json.input_event ?? {},
  customer_context: $json.customer_context ?? {},
  case_context: $json.case_context ?? {},
  service_context: $json.service_context ?? {},
  business_context: $json.business_context ?? {},
  conversation_context: $json.conversation_context ?? {},
  resolver_meta: $json.resolver_meta ?? {}
}, null, 2) }}
```

`JSON Schema`

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "router_action": {
      "type": "string",
      "enum": ["route"]
    },
    "target_workflow": {
      "type": "string",
      "enum": ["AI_AGENT_Postventa", "OPS_Case_Closer", "NO_ROUTE"]
    },
    "route_confidence": {
      "type": "string",
      "enum": ["high", "medium", "low"]
    },
    "dominant_context": {
      "type": "string",
      "enum": ["postventa_armado", "postventa_mantencion", "postventa_general", "non_postventa", "unknown"]
    },
    "message_ambiguity": {
      "type": "string",
      "enum": ["ambiguous", "clear"]
    },
    "detected_customer_signal": {
      "type": "string",
      "enum": ["continue", "decline", "ask_info", "ask_catalog", "ask_sales", "ask_human", "unknown"]
    },
    "route_reason": {
      "type": "string"
    },
    "should_reply": {
      "type": "boolean"
    },
    "input_event": {
      "type": "object"
    },
    "customer_context": {
      "type": "object"
    },
    "case_context": {
      "type": "object"
    },
    "service_context": {
      "type": "object"
    },
    "business_context": {
      "type": "object"
    },
    "conversation_context": {
      "type": "object"
    },
    "resolver_meta": {
      "type": "object"
    }
  },
  "required": [
    "router_action",
    "target_workflow",
    "route_confidence",
    "dominant_context",
    "message_ambiguity",
    "detected_customer_signal",
    "route_reason",
    "should_reply",
    "input_event",
    "customer_context",
    "case_context",
    "service_context",
    "business_context",
    "conversation_context",
    "resolver_meta"
  ]
}
```

### Nodo 2: `AI Orchestrator - Router Master2️⃣` -> `Code - Validate Output`

Tipo sugerido: nodo `Code`.

```javascript
const itemsOut = [];

for (const item of items) {
  const ai = item.json ?? {};

  const transport = {
    input_event: ai.input_event ?? {},
    customer_context: ai.customer_context ?? {},
    case_context: ai.case_context ?? {},
    service_context: ai.service_context ?? {},
    business_context: ai.business_context ?? {},
    conversation_context: ai.conversation_context ?? {},
    resolver_meta: ai.resolver_meta ?? {}
  };

  const dominantContext = [
    "postventa_armado",
    "postventa_mantencion",
    "postventa_general",
    "non_postventa",
    "unknown"
  ].includes(ai.dominant_context)
    ? ai.dominant_context
    : "unknown";

  const detectedCustomerSignal = [
    "continue",
    "decline",
    "ask_info",
    "ask_catalog",
    "ask_sales",
    "ask_human",
    "unknown"
  ].includes(ai.detected_customer_signal)
    ? ai.detected_customer_signal
    : "unknown";

  let targetWorkflow = ai.target_workflow;

  if (!["AI_AGENT_Postventa", "OPS_Case_Closer", "NO_ROUTE"].includes(targetWorkflow)) {
    if (detectedCustomerSignal === "decline") {
      targetWorkflow = "OPS_Case_Closer";
    } else if (dominantContext.startsWith("postventa")) {
      targetWorkflow = "AI_AGENT_Postventa";
    } else {
      targetWorkflow = "NO_ROUTE";
    }
  }

  itemsOut.push({
    json: {
      router_action: "route",
      target_workflow: targetWorkflow,
      route_confidence: ["high", "medium", "low"].includes(ai.route_confidence) ? ai.route_confidence : "medium",
      dominant_context: dominantContext,
      message_ambiguity: ["ambiguous", "clear"].includes(ai.message_ambiguity) ? ai.message_ambiguity : "clear",
      detected_customer_signal: detectedCustomerSignal,
      route_reason: String(ai.route_reason ?? "").trim() || "route_reason_missing_from_model",
      should_reply: false,
      ...transport
    }
  });
}

return itemsOut;
```

### Nodo 3: `AI_AGENT_Postventa` -> `Code - Build DeepSeek Payload`

Tipo sugerido: nodo LLM con salida JSON estructurada.

`System Prompt`

```text
Eres AI_AGENT_Postventa, el nucleo conversacional del MVP de Postventa para Armados y Mantenciones.

Tu funcion es conversar naturalmente dentro del alcance de armado y mantencion, pedir datos faltantes sin arbol rigido y dejar el caso listo para revision o coordinacion humana cuando ya exista informacion suficiente.

Politica obligatoria:
1. Tu decides inside_scope u out_of_scope.
2. Conversas naturalmente si el caso es de armado o mantencion.
3. Si sale de alcance, debes devolver handoff_to_human y el mensaje exacto:
"Tu solicitud sera procesada por un ejecutivo durante los siguientes horarios: 9:00 a 17:00 de lunes a viernes, gracias."
4. No debes saludar si ya existe conversacion previa.
5. No debes prometer tecnico, fecha exacta, precio, garantia ni resolucion final.
6. Debes preservar intactos estos objetos: input_event, customer_context, case_context, service_context, business_context, conversation_context, resolver_meta.

Alcance inside_scope:
- armado
- mantencion
- continuidad natural de un caso de armado o mantencion
- aclaraciones operativas basicas para poder revisar o coordinar el caso

Alcance out_of_scope:
- catalogo
- ventas
- stock
- precio
- cotizacion
- garantia
- devoluciones
- reclamos legales
- campañas
- knowledge general
- cualquier solicitud fuera de armado o mantencion
- cualquier solicitud explicita de hablar con un humano

Reglas de conversacion:
- Si faltan datos, pide solo los datos faltantes mas utiles para avanzar.
- Si el cliente ya dio informacion, no la pidas de nuevo.
- Si ya existe historial, responde en continuidad directa, sin saludo.
- Si todavia falta informacion critica, el estado es needs_more_data.
- Si ya hay informacion suficiente para revision o coordinacion, el estado es ready_for_human_processing.
- Si esta fuera de alcance, el estado es out_of_scope y needs_handoff=true.

Datos utiles por defecto para armado o mantencion cuando no existan en contexto:
- comuna
- direccion
- producto, maquina o modelo
- descripcion breve de la necesidad o falla
- identificador comercial si existe: id_order o invoice_number
- disponibilidad horaria de referencia, sin prometer fecha

Devuelve solo JSON valido con esta estructura exacta:
{
  "decision": "inside_scope | needs_more_data | ready_for_human_processing | out_of_scope",
  "inside_scope": true,
  "scope": "armado | mantencion | postventa_general | out_of_scope",
  "needs_handoff": false,
  "handoff_target": "none | human_postventa",
  "reply_text": "string",
  "missing_data": ["string"],
  "collected_data": {
    "comuna": null,
    "direccion": null,
    "producto_o_modelo": null,
    "descripcion": null,
    "id_order": null,
    "invoice_number": null,
    "disponibilidad": null
  },
  "ready_for_human_processing": false,
  "case_summary": "string",
  "input_event": {},
  "customer_context": {},
  "case_context": {},
  "service_context": {},
  "business_context": {},
  "conversation_context": {},
  "resolver_meta": {}
}
```

`User Prompt`

```text
Evalua y responde segun el alcance de Postventa.

Mensaje cliente:
{{ $json.input_event?.message_text ?? $json.input_event?.text ?? $json.message_text ?? $json.text ?? "" }}

Contexto:
{{ JSON.stringify({
  input_event: $json.input_event ?? {},
  customer_context: $json.customer_context ?? {},
  case_context: $json.case_context ?? {},
  service_context: $json.service_context ?? {},
  business_context: $json.business_context ?? {},
  conversation_context: $json.conversation_context ?? {},
  resolver_meta: $json.resolver_meta ?? {}
}, null, 2) }}
```

`JSON Schema`

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "decision": {
      "type": "string",
      "enum": ["inside_scope", "needs_more_data", "ready_for_human_processing", "out_of_scope"]
    },
    "inside_scope": {
      "type": "boolean"
    },
    "scope": {
      "type": "string",
      "enum": ["armado", "mantencion", "postventa_general", "out_of_scope"]
    },
    "needs_handoff": {
      "type": "boolean"
    },
    "handoff_target": {
      "type": "string",
      "enum": ["none", "human_postventa"]
    },
    "reply_text": {
      "type": "string"
    },
    "missing_data": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "collected_data": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "comuna": {
          "type": ["string", "null"]
        },
        "direccion": {
          "type": ["string", "null"]
        },
        "producto_o_modelo": {
          "type": ["string", "null"]
        },
        "descripcion": {
          "type": ["string", "null"]
        },
        "id_order": {
          "type": ["string", "null"]
        },
        "invoice_number": {
          "type": ["string", "null"]
        },
        "disponibilidad": {
          "type": ["string", "null"]
        }
      },
      "required": [
        "comuna",
        "direccion",
        "producto_o_modelo",
        "descripcion",
        "id_order",
        "invoice_number",
        "disponibilidad"
      ]
    },
    "ready_for_human_processing": {
      "type": "boolean"
    },
    "case_summary": {
      "type": "string"
    },
    "input_event": {
      "type": "object"
    },
    "customer_context": {
      "type": "object"
    },
    "case_context": {
      "type": "object"
    },
    "service_context": {
      "type": "object"
    },
    "business_context": {
      "type": "object"
    },
    "conversation_context": {
      "type": "object"
    },
    "resolver_meta": {
      "type": "object"
    }
  },
  "required": [
    "decision",
    "inside_scope",
    "scope",
    "needs_handoff",
    "handoff_target",
    "reply_text",
    "missing_data",
    "collected_data",
    "ready_for_human_processing",
    "case_summary",
    "input_event",
    "customer_context",
    "case_context",
    "service_context",
    "business_context",
    "conversation_context",
    "resolver_meta"
  ]
}
```

### Nodo 4: `AI_AGENT_Postventa` -> `Code - Validate Output`

Tipo sugerido: nodo `Code`.

```javascript
const EXACT_HANDOFF_MESSAGE = "Tu solicitud sera procesada por un ejecutivo durante los siguientes horarios: 9:00 a 17:00 de lunes a viernes, gracias.";

function stripGreetingIfNeeded(text, conversationContext) {
  const hasHistory =
    Boolean(conversationContext?.has_prior_messages) ||
    Number(conversationContext?.message_count ?? 0) > 1 ||
    Boolean(conversationContext?.is_continuation);

  if (!hasHistory) return String(text ?? "").trim();

  return String(text ?? "")
    .replace(/^(hola|hola,|hola\\.|buenas|buenas tardes|buen dia|buen d[ií]a|estimado[a]?)[\\s,!.-]*/i, "")
    .trim();
}

const itemsOut = [];

for (const item of items) {
  const ai = item.json ?? {};

  const transport = {
    input_event: ai.input_event ?? {},
    customer_context: ai.customer_context ?? {},
    case_context: ai.case_context ?? {},
    service_context: ai.service_context ?? {},
    business_context: ai.business_context ?? {},
    conversation_context: ai.conversation_context ?? {},
    resolver_meta: ai.resolver_meta ?? {}
  };

  let decision = ["inside_scope", "needs_more_data", "ready_for_human_processing", "out_of_scope"].includes(ai.decision)
    ? ai.decision
    : "needs_more_data";

  let insideScope = Boolean(ai.inside_scope);
  let needsHandoff = Boolean(ai.needs_handoff);
  let handoffTarget = ai.handoff_target === "human_postventa" ? "human_postventa" : "none";
  let scope = ["armado", "mantencion", "postventa_general", "out_of_scope"].includes(ai.scope)
    ? ai.scope
    : "postventa_general";
  let replyText = String(ai.reply_text ?? "").trim();
  const missingData = Array.isArray(ai.missing_data) ? ai.missing_data.map((v) => String(v)) : [];
  const collectedData = ai.collected_data && typeof ai.collected_data === "object"
    ? {
        comuna: ai.collected_data.comuna ?? null,
        direccion: ai.collected_data.direccion ?? null,
        producto_o_modelo: ai.collected_data.producto_o_modelo ?? null,
        descripcion: ai.collected_data.descripcion ?? null,
        id_order: ai.collected_data.id_order ?? null,
        invoice_number: ai.collected_data.invoice_number ?? null,
        disponibilidad: ai.collected_data.disponibilidad ?? null
      }
    : {
        comuna: null,
        direccion: null,
        producto_o_modelo: null,
        descripcion: null,
        id_order: null,
        invoice_number: null,
        disponibilidad: null
      };

  if (decision === "out_of_scope" || needsHandoff) {
    decision = "out_of_scope";
    insideScope = false;
    needsHandoff = true;
    handoffTarget = "human_postventa";
    scope = "out_of_scope";
    replyText = EXACT_HANDOFF_MESSAGE;
  } else {
    replyText = stripGreetingIfNeeded(replyText, transport.conversation_context);
  }

  if (!replyText) {
    replyText = "Para poder ayudarte mejor, necesito algunos datos adicionales de tu solicitud.";
  }

  itemsOut.push({
    json: {
      decision,
      inside_scope: insideScope,
      scope,
      needs_handoff: needsHandoff,
      handoff_target: handoffTarget,
      reply_text: replyText,
      missing_data: missingData,
      collected_data: collectedData,
      ready_for_human_processing: decision === "ready_for_human_processing",
      case_summary: String(ai.case_summary ?? "").trim(),
      ...transport
    }
  });
}

return itemsOut;
```

## 3. Output esperado de Router

### Caso: `Me interesa` con contexto armado

```json
{
  "router_action": "route",
  "target_workflow": "AI_AGENT_Postventa",
  "route_confidence": "high",
  "dominant_context": "postventa_armado",
  "message_ambiguity": "ambiguous",
  "detected_customer_signal": "continue",
  "route_reason": "Mensaje ambiguo, pero el caso activo y el contexto dominante corresponden a postventa de armado.",
  "should_reply": false
}
```

### Caso: `Ok` con contexto mantencion

```json
{
  "router_action": "route",
  "target_workflow": "AI_AGENT_Postventa",
  "route_confidence": "high",
  "dominant_context": "postventa_mantencion",
  "message_ambiguity": "ambiguous",
  "detected_customer_signal": "continue",
  "route_reason": "Mensaje ambiguo dentro de un hilo de mantencion; corresponde continuidad postventa.",
  "should_reply": false
}
```

### Caso: `No gracias`

```json
{
  "router_action": "route",
  "target_workflow": "OPS_Case_Closer",
  "route_confidence": "high",
  "dominant_context": "postventa_general",
  "message_ambiguity": "clear",
  "detected_customer_signal": "decline",
  "route_reason": "El cliente rechazo continuar en el hilo postventa activo.",
  "should_reply": false
}
```

### Caso: `Donde veo el catalogo` en hilo postventa

```json
{
  "router_action": "route",
  "target_workflow": "AI_AGENT_Postventa",
  "route_confidence": "high",
  "dominant_context": "postventa_general",
  "message_ambiguity": "clear",
  "detected_customer_signal": "ask_catalog",
  "route_reason": "Aunque consulta por catalogo, el hilo dominante es postventa y Postventa debe decidir inside_scope u out_of_scope.",
  "should_reply": false
}
```

## 4. Output esperado de `AI_AGENT_Postventa`

### Solicitud dentro de alcance

Ejemplo: `Necesito coordinar el armado de mi maquina`.

```json
{
  "decision": "needs_more_data",
  "inside_scope": true,
  "scope": "armado",
  "needs_handoff": false,
  "handoff_target": "none",
  "reply_text": "Perfecto, para avanzar con tu solicitud de armado necesito que me indiques la comuna, la direccion y el producto o modelo que debemos revisar.",
  "missing_data": ["comuna", "direccion", "producto_o_modelo"],
  "collected_data": {
    "comuna": null,
    "direccion": null,
    "producto_o_modelo": null,
    "descripcion": "solicitud de armado",
    "id_order": null,
    "invoice_number": null,
    "disponibilidad": null
  },
  "ready_for_human_processing": false,
  "case_summary": "Cliente solicita armado. Aun faltan datos operativos basicos para revision."
}
```

### Solicitud fuera de alcance

Ejemplo: `Donde veo el catalogo`.

```json
{
  "decision": "out_of_scope",
  "inside_scope": false,
  "scope": "out_of_scope",
  "needs_handoff": true,
  "handoff_target": "human_postventa",
  "reply_text": "Tu solicitud sera procesada por un ejecutivo durante los siguientes horarios: 9:00 a 17:00 de lunes a viernes, gracias.",
  "missing_data": [],
  "collected_data": {
    "comuna": null,
    "direccion": null,
    "producto_o_modelo": null,
    "descripcion": "consulta de catalogo",
    "id_order": null,
    "invoice_number": null,
    "disponibilidad": null
  },
  "ready_for_human_processing": false,
  "case_summary": "Consulta fuera de alcance de armado o mantencion. Corresponde handoff humano."
}
```

### Datos faltantes

Ejemplo: `La maquina hace ruido`.

```json
{
  "decision": "needs_more_data",
  "inside_scope": true,
  "scope": "mantencion",
  "needs_handoff": false,
  "handoff_target": "none",
  "reply_text": "Para revisar tu solicitud de mantencion necesito que me indiques el modelo o maquina, la comuna y una breve descripcion de desde cuando ocurre el ruido.",
  "missing_data": ["producto_o_modelo", "comuna", "descripcion"],
  "collected_data": {
    "comuna": null,
    "direccion": null,
    "producto_o_modelo": null,
    "descripcion": "la maquina hace ruido",
    "id_order": null,
    "invoice_number": null,
    "disponibilidad": null
  },
  "ready_for_human_processing": false,
  "case_summary": "Caso dentro de alcance de mantencion, pero faltan datos para dejarlo listo."
}
```

### Listo para revision o coordinacion

Ejemplo: cliente ya entrego comuna, direccion, modelo, descripcion y disponibilidad.

```json
{
  "decision": "ready_for_human_processing",
  "inside_scope": true,
  "scope": "mantencion",
  "needs_handoff": false,
  "handoff_target": "none",
  "reply_text": "Gracias, ya deje registrada la informacion para revision y coordinacion. Si necesitas agregar algun antecedente adicional, puedes escribir por aqui.",
  "missing_data": [],
  "collected_data": {
    "comuna": "Providencia",
    "direccion": "Av. Ejemplo 123",
    "producto_o_modelo": "Bicicleta Spinning X1",
    "descripcion": "ruido en pedal izquierdo hace 2 semanas",
    "id_order": "45821",
    "invoice_number": null,
    "disponibilidad": "jornada tarde"
  },
  "ready_for_human_processing": true,
  "case_summary": "Caso de mantencion con datos suficientes para revision o coordinacion humana, sin prometer fecha."
}
```

## 5. Riesgos del cambio

1. Si el workflow real hoy espera otros nombres de campos downstream, el contrato nuevo puede no acoplar perfecto aunque la semantica sea correcta.
2. Como Sprint 1 no toca `OPS_Handoff_Manager` ni `OPS_Case_Closer`, cualquier fragilidad actual en esos flujos sigue viva.
3. El strip de saludo es intencionalmente minimo; puede no cubrir todas las variantes de apertura.
4. Si `conversation_context` llega pobre o inconsistente, el modelo puede perder continuidad y pedir datos ya entregados.
5. Si `service_context` o `case_context` no identifican bien armado vs mantencion, el Router puede caer en `postventa_general`.
6. El handoff exacto queda blindado, pero la tipificacion fina del motivo de derivacion queda para Sprint 2 o 3.

## 6. Pruebas minimas para ejecutar en n8n

1. `Me interesa` con `service_context.scope=armado` y caso postventa abierto.
Resultado esperado: Router -> `AI_AGENT_Postventa`; Postventa -> `needs_more_data` o continuidad natural sin saludo.

2. `Ok` con `service_context.scope=mantencion` y historial previo.
Resultado esperado: Router -> `AI_AGENT_Postventa`; respuesta sin saludo.

3. `No gracias` en hilo postventa activo.
Resultado esperado: Router -> `OPS_Case_Closer`.

4. `Donde veo el catalogo` en hilo postventa.
Resultado esperado: Router -> `AI_AGENT_Postventa`; Postventa -> `out_of_scope` con mensaje exacto de handoff.

5. `La maquina hace ruido` sin modelo, comuna ni direccion.
Resultado esperado: Postventa -> `needs_more_data` con solicitud natural de datos faltantes.

6. Caso de mantencion con modelo, comuna, direccion, descripcion y disponibilidad ya presentes en contexto.
Resultado esperado: Postventa -> `ready_for_human_processing`.

7. Hilo con `conversation_context.message_count > 1`.
Resultado esperado: ninguna respuesta de Postventa debe iniciar con saludo.

8. Validacion de transporte.
Resultado esperado: `input_event`, `customer_context`, `case_context`, `service_context`, `business_context`, `conversation_context` y `resolver_meta` salen intactos desde Router y desde Postventa.
