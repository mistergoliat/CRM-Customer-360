/**
 * Hand-written OpenAPI 3.0 document for every route under app/api/**.
 * Not auto-generated: most routes here predate typed request/response
 * schemas (Zod, etc.), so introspecting them would need a bigger rewrite
 * than writing this by hand. Keep it in sync when a route's shape changes.
 *
 * Served only through the /dev/api-docs page (Swagger UI), gated by the
 * same operator session as the rest of the HUB (middleware.ts).
 */

export const OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "PesasChile CRM HUB - API interna",
    version: "1.0.0",
    description:
      "Explorador de los endpoints reales de app/api/**. 'Try it out' funciona porque el navegador ya manda la cookie hub_session tras el login del HUB - no hace falta pegar ningun token. Los endpoints marcados con ⚠️ mutan datos reales o pueden enviar mensajes; usalos con la misma cautela que en produccion."
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "hub_session",
        description: "Sesion de operador (login en /login) o header x-admin-bypass-token."
      }
    }
  },
  security: [{ cookieAuth: [] }],
  tags: [
    { name: "Auth", description: "Login del HUB." },
    { name: "System", description: "Salud, schema y capabilities del sistema." },
    { name: "Conversations", description: "Conversaciones nativas de WhatsApp (fuente real)." },
    { name: "Multi-Request Runtime", description: "Runtime multi-request (PR #32/#33): requests por conversacion, escalaciones." },
    { name: "Cases", description: "Casos legacy (n8n_conversation_cases)." },
    { name: "Chats", description: "Bandeja de chats legacy." },
    { name: "Customers", description: "Clientes (master_customer)." },
    { name: "Brain / AI Orchestration", description: "Capa de integracion IA usada por n8n. ⚠️ varios de estos ejecutan logica real o llaman al LLM." },
    { name: "Integrations", description: "Webhook de WhatsApp (Meta)." },
    { name: "Dev Tools", description: "Herramientas de desarrollo local." }
  ],
  paths: {
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Iniciar sesion de operador",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { token: { type: "string" } }, required: ["token"] }, example: { token: "<ADMIN_BYPASS_TOKEN>" } } }
        },
        responses: {
          "200": { description: "Sesion creada (set-cookie hub_session)." },
          "401": { description: "Token invalido." },
          "500": { description: "SESSION_SECRET / ADMIN_BYPASS_TOKEN no configurados." }
        }
      }
    },

    "/api/system/health": {
      get: { tags: ["System"], summary: "Estado de salud del sistema (DB, n8n, flags)", responses: { "200": { description: "OK" } } }
    },
    "/api/system/schema": {
      get: { tags: ["System"], summary: "Lista de tablas reales presentes en la base de datos activa", responses: { "200": { description: "{ tables: [...] }" } } }
    },
    "/api/system/capabilities": {
      get: { tags: ["System"], summary: "Estado por modulo (real/partial/fixture/disabled) del runtime del HUB", responses: { "200": { description: "OK" } } }
    },

    "/api/conversations": {
      get: {
        tags: ["Conversations"],
        summary: "Listar conversaciones nativas",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "q", in: "query", schema: { type: "string" }, description: "Busca por contacto, public_id, nombre o email." }
        ],
        responses: { "200": { description: "OK" } }
      }
    },
    "/api/conversations/{id}": {
      get: {
        tags: ["Conversations"],
        summary: "Detalle de una conversacion por public_id",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, example: "conv-xxxxxxxxxxxxxxxxxxxx" }],
        responses: { "200": { description: "OK" }, "404": { description: "conversation_not_found" } }
      }
    },
    "/api/conversations/{id}/messages": {
      get: {
        tags: ["Conversations"],
        summary: "Timeline paginado de mensajes (merge conversation_message + outbox)",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "before", in: "query", schema: { type: "string" }, description: "Cursor: created_at del mensaje mas antiguo ya cargado." },
          { name: "limit", in: "query", schema: { type: "integer" } }
        ],
        responses: { "200": { description: "OK" }, "404": { description: "conversation_not_found" } }
      }
    },
    "/api/conversations/{id}/autonomous": {
      get: {
        tags: ["Conversations"],
        summary: "Estado autonomo de la conversacion (ai_enabled, human_owner_active, oportunidad, acciones)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" }, "404": { description: "conversation_not_found" } }
      }
    },
    "/api/conversations/{id}/control": {
      post: {
        tags: ["Conversations"],
        summary: "⚠️ Tomar/soltar/pausar/cerrar/reabrir el control de la conversacion",
        description: "Transicion real de ownership IA/operador. Requiere DB_WRITE_ENABLED.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { action: { type: "string", enum: ["take", "release", "pause", "close", "reopen"] }, operatorName: { type: "string", nullable: true } }, required: ["action"] }
            }
          }
        },
        responses: { "200": { description: "OK" }, "400": { description: "invalid_action" }, "403": { description: "escritura deshabilitada" }, "404": { description: "conversation_not_found" }, "409": { description: "transicion invalida" } }
      }
    },
    "/api/conversations/{id}/reply": {
      post: {
        tags: ["Conversations"],
        summary: "⚠️ Responder manualmente como operador (toma control y envia por Meta si esta habilitado)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" }, operatorName: { type: "string", nullable: true } }, required: ["text"] } } }
        },
        responses: { "200": { description: "sent" }, "409": { description: "window_closed u otra transicion invalida" }, "502": { description: "fallo el envio" } }
      }
    },

    "/api/conversations/{id}/requests": {
      get: {
        tags: ["Multi-Request Runtime"],
        summary: "Estado por ConversationRequest de la conversacion (facts, quote, escalacion, aplazados, follow-ups, trail)",
        description: "Solo tiene datos si BRAIN_REQUEST_TRACKING_ENABLED=true estuvo activo cuando se proceso el inbound.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "conversationPublicId" }],
        responses: { "200": { description: "OK" }, "404": { description: "conversation_not_found" } }
      }
    },
    "/api/escalations": {
      get: {
        tags: ["Multi-Request Runtime"],
        summary: "Cola de escalaciones abiertas (a lo mas una por request)",
        parameters: [
          { name: "targetType", in: "query", schema: { type: "string", enum: ["team", "queue", "role", "user", "external_system"] } },
          { name: "targetId", in: "query", schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" } }
      }
    },

    "/api/cases/{id}/reply": {
      post: {
        tags: ["Cases"],
        summary: "⚠️ Responder un caso legacy (envia WhatsApp real si esta habilitado)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { message_text: { type: "string" } }, required: ["message_text"] } } } },
        responses: { "200": { description: "OK" }, "500": { description: "error interno" } }
      }
    },
    "/api/cases/{id}/close": {
      post: {
        tags: ["Cases"],
        summary: "⚠️ Cerrar un caso legacy",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { reason: { type: "string" } } } } } },
        responses: { "200": { description: "OK" } }
      }
    },
    "/api/cases/{id}/reopen": {
      post: { tags: ["Cases"], summary: "⚠️ Reabrir un caso legacy", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } }
    },
    "/api/cases/{id}/priority": {
      post: {
        tags: ["Cases"],
        summary: "⚠️ Cambiar prioridad de un caso legacy",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { priority: { type: "string" } }, required: ["priority"] } } } },
        responses: { "200": { description: "OK" } }
      }
    },
    "/api/cases/{id}/block-ai": {
      post: { tags: ["Cases"], summary: "⚠️ Bloquear/desbloquear la IA en un caso legacy", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } }
    },

    "/api/chats": {
      get: {
        tags: ["Chats"],
        summary: "Listar bandeja de chats legacy",
        parameters: [{ name: "page", in: "query", schema: { type: "integer", default: 1 } }, { name: "q", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "OK" } }
      }
    },
    "/api/chats/{caseId}": {
      get: { tags: ["Chats"], summary: "Detalle de un chat legacy por caseId", parameters: [{ name: "caseId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "404": { description: "Caso no encontrado" } } }
    },
    "/api/chats/{caseId}/messages": {
      get: { tags: ["Chats"], summary: "Mensajes de un chat legacy", parameters: [{ name: "caseId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } }
    },

    "/api/customers": {
      get: {
        tags: ["Customers"],
        summary: "Listar clientes (master_customer)",
        parameters: [
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "page_size", in: "query", schema: { type: "integer", default: 25 } }
        ],
        responses: { "200": { description: "OK" } }
      },
      post: {
        tags: ["Customers"],
        summary: "⚠️ Crear un cliente real",
        description: "Requiere DB_WRITE_ENABLED=true. Header opcional Idempotency-Key.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { firstname: { type: "string" }, lastname: { type: "string" }, email: { type: "string" }, platformOrigin: { type: "string" } },
                required: ["firstname", "lastname", "email", "platformOrigin"]
              }
            }
          }
        },
        responses: { "201": { description: "Creado" }, "409": { description: "escritura deshabilitada / conflicto" } }
      }
    },
    "/api/customers/{id}": {
      get: { tags: ["Customers"], summary: "Detalle de un cliente", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "404": { description: "customer_not_found" } } }
    },

    "/api/brain/process-inbound": {
      post: {
        tags: ["Brain / AI Orchestration"],
        summary: "Adaptador de inbound para n8n (dry-run por defecto, no ejecuta acciones reales salvo flags explicitos)",
        description: "Auth: sesion de operador O Authorization: Bearer <AI_ORCHESTRATION_API_TOKEN>.",
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { "200": { description: "OK" } }
      }
    },
    "/api/brain/context/resolve": {
      post: { tags: ["Brain / AI Orchestration"], summary: "Resolver contexto comercial (read-only)", requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "200": { description: "OK" } } }
    },
    "/api/brain/actions/resolve": {
      post: { tags: ["Brain / AI Orchestration"], summary: "Resolver policy de respuesta + router de accion (deterministico, sin LLM)", requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "200": { description: "OK" }, "400": { description: "invalid payload" } } }
    },
    "/api/brain/agents/run": {
      post: { tags: ["Brain / AI Orchestration"], summary: "⚠️ Ejecutar un agente registrado (puede llamar al LLM real segun flags)", requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "200": { description: "OK" } } }
    },
    "/api/brain/execute": {
      post: { tags: ["Brain / AI Orchestration"], summary: "Resolver un plan de ejecucion (dry-run; rechaza executeActions=true)", requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "200": { description: "OK" } } }
    },
    "/api/brain/outbox/worker": {
      post: { tags: ["Brain / AI Orchestration"], summary: "⚠️ Planificar/ejecutar un tick del worker de outbox", requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "200": { description: "OK" } } }
    },
    "/api/brain/messaging/send-test": {
      post: {
        tags: ["Brain / AI Orchestration"],
        summary: "⚠️⚠️ Envia un WhatsApp REAL si BRAIN_META_SEND_ENABLED y la allowlist lo permiten",
        description: "Protegido por los mismos guardrails que el outbox (allowlist BRAIN_AUTONOMOUS_TEST_WA_IDS). No usar sin confirmar los flags primero.",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { waId: { type: "string" }, phoneNumberId: { type: "string" }, text: { type: "string" } } } } } },
        responses: { "200": { description: "OK" } }
      }
    },
    "/api/ai/orchestrate": {
      post: {
        tags: ["Brain / AI Orchestration"],
        summary: "Endpoint legacy de orquestacion IA para n8n (shadow mode / mock envelope)",
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { "200": { description: "OK" } }
      }
    },

    "/api/integrations/whatsapp/webhook": {
      get: {
        tags: ["Integrations"],
        summary: "Verificacion de suscripcion de Meta (hub.challenge)",
        security: [],
        parameters: [
          { name: "hub.mode", in: "query", schema: { type: "string" } },
          { name: "hub.verify_token", in: "query", schema: { type: "string" } },
          { name: "hub.challenge", in: "query", schema: { type: "string" } }
        ],
        responses: { "200": { description: "challenge devuelto" }, "403": { description: "verification_failed" } }
      },
      post: {
        tags: ["Integrations"],
        summary: "⚠️ Webhook real de inbound/status de WhatsApp - dispara el ciclo autonomo",
        security: [],
        description: "Sin x-admin-bypass-token: se autentica solo (HMAC x-hub-signature-256 en produccion). Un POST aca es un mensaje de cliente real entrando al sistema.",
        requestBody: { content: { "application/json": { schema: { type: "object" }, example: { entry: [{ changes: [{ value: { metadata: { phone_number_id: "..." }, messages: [{ id: "wamid...", from: "56900000000", type: "text", text: { body: "hola" } }] } }] }] } } } },
        responses: { "200": { description: "OK" }, "401": { description: "firma invalida (solo si META_WHATSAPP_APP_SECRET esta configurado)" } }
      }
    },

    "/api/dev/ai-sdr-simulator": {
      get: {
        tags: ["Dev Tools"],
        summary: "Overview del simulador local de AI SDR (motor separado, no es el runtime autonomo nativo)",
        parameters: [{ name: "conversationId", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "OK" } }
      },
      post: {
        tags: ["Dev Tools"],
        summary: "Crear conversacion de prueba o correr un turno en el simulador local",
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object", properties: { action: { type: "string", enum: ["create-conversation", "turn"] }, messageText: { type: "string" } }, required: ["action"] }
            }
          }
        },
        responses: { "200": { description: "OK" }, "201": { description: "conversacion creada" }, "400": { description: "invalid_action / message_text_required" } }
      }
    }
  }
} as const;
