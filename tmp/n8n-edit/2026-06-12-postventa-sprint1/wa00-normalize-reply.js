const input = $json || {};

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function includesAny(text, terms) {
  const t = lower(text);
  return terms.some(term => t.includes(term));
}

const agent = asObject(input.agent);
const decision = asObject(input.decision);
const message = asObject(input.message);
const caseUpdate = asObject(input.case_update);
const safety = asObject(input.safety);
const inputEvent = asObject(input.input_event);
const conversationContext = asObject(input.conversation_context);
const serviceContext = asObject(input.service_context);
const caseContext = asObject(input.case_context);
const businessContext = asObject(input.business_context);

let text = clean(message.text);
const currentMessage = clean(
  inputEvent.message_text ||
  inputEvent.text ||
  businessContext.current_message_flags?.current_message_text
);

const currentText = lower(currentMessage);
const agentName = clean(agent.name);

const lastMessages = asArray(conversationContext.last_messages);

const hasPriorConversation =
  lastMessages.length > 0;

const hasPriorOutbound = lastMessages.some(m => {
  const direction = lower(m.direction || m.message_direction || m.role);
  return direction.includes("outbound") || direction.includes("assistant") || direction.includes("bot");
});

const messageType = lower(inputEvent.message_type);

const isButtonOrInteractive =
  messageType === "button" ||
  messageType === "interactive" ||
  messageType === "list_reply";

const positiveButtonTexts = [
  "me interesa",
  "sí",
  "si",
  "si por favor",
  "sí por favor",
  "dale",
  "ok",
  "perfecto",
  "quiero",
  "quiero coordinar",
  "lo quiero",
  "me sirve"
];

const negativeButtonTexts = [
  "no gracias",
  "no, gracias",
  "no me interesa",
  "paso",
  "por ahora no",
  "no quiero"
];

const greetingTexts = [
  "hola",
  "holaa",
  "hola hola",
  "buenas",
  "buena",
  "buen dia",
  "buen día",
  "buenos dias",
  "buenos días",
  "buenas tardes",
  "buenas noches"
];

const sacTerms = [
  "reclamo",
  "garantía",
  "garantia",
  "devolución",
  "devolucion",
  "reembolso",
  "cambio",
  "fallo",
  "falla",
  "dañado",
  "dañada",
  "roto",
  "rota",
  "no funciona",
  "problema con mi pedido",
  "pedido atrasado",
  "despacho",
  "entrega"
];

const commercialTerms = [
  "ventas",
  "cotizar",
  "cotización",
  "cotizacion",
  "comprar",
  "precio",
  "valor",
  "stock",
  "disponibilidad",
  "producto",
  "máquina",
  "maquina",
  "mancuernas",
  "barra",
  "disco",
  "rack",
  "banca",
  "polea"
];

const isGreetingOnly = greetingTexts.includes(currentText);
const isPositiveButton = positiveButtonTexts.includes(currentText);
const isNegativeButton = negativeButtonTexts.includes(currentText);
const currentIsSac = includesAny(currentText, sacTerms);
const currentIsCommercial = includesAny(currentText, commercialTerms);
const normalizedService = lower(
  serviceContext.dominant_service ||
  serviceContext.service_code ||
  caseContext.service_code
);

const shouldSuppressGreeting =
  hasPriorConversation ||
  hasPriorOutbound ||
  isButtonOrInteractive ||
  isPositiveButton ||
  isNegativeButton ||
  !isGreetingOnly;

const shouldSuppressReclamoMention =
  agentName === "AI_AGENT_SAC" &&
  !currentIsSac &&
  (
    isGreetingOnly ||
    currentIsCommercial ||
    isPositiveButton ||
    isButtonOrInteractive
  );

function stripLeadingGreeting(value) {
  let out = clean(value);

  out = out.replace(/^¡?\s*hola\s+[a-záéíóúñü]+[!,.:\s-]*/i, "");
  out = out.replace(/^¡?\s*hola[!,.:\s-]*/i, "");
  out = out.replace(/^¡?\s*buenas\s+tardes[!,.:\s-]*/i, "");
  out = out.replace(/^¡?\s*buenos\s+d[ií]as[!,.:\s-]*/i, "");
  out = out.replace(/^¡?\s*buenas\s+noches[!,.:\s-]*/i, "");
  out = out.replace(/^¡?\s*buenas[!,.:\s-]*/i, "");
  out = out.replace(/^bienvenido\s+de\s+nuevo[!,.:\s-]*/i, "");
  out = out.replace(/^bienvenida\s+de\s+nuevo[!,.:\s-]*/i, "");
  out = out.replace(/^claro[,.:\s-]*/i, "Claro. ");
  out = out.replace(/\s+/g, " ").trim();

  return out;
}

function removeReclamoMention(value) {
  let out = clean(value);

  out = out.replace(/veo que tienes un reclamo abierto con nosotros[,.]?\s*/ig, "");
  out = out.replace(/veo que tienes un reclamo abierto[,.]?\s*/ig, "");
  out = out.replace(/tienes un reclamo abierto con nosotros[,.]?\s*/ig, "");
  out = out.replace(/tienes un reclamo abierto[,.]?\s*/ig, "");
  out = out.replace(/para revisar los antecedentes[,.]?\s*/ig, "");
  out = out.replace(/podrías indicarme el número de tu pedido o factura[,.]?\s*/ig, "");
  out = out.replace(/\s+/g, " ").trim();

  return out;
}

if (text && shouldSuppressGreeting) {
  text = stripLeadingGreeting(text);
}

if (text && shouldSuppressReclamoMention) {
  text = removeReclamoMention(text);
}

if (!text && ["reply", "ask_missing_data"].includes(decision.action_type)) {
  if (normalizedService === "postventa_armado") {
    text = "Para ayudarte con el armado, indícame la comuna, la dirección y el producto o número de orden asociado.";
  } else if (normalizedService === "postventa_mantencion") {
    text = "Para revisar la mantención, indícame el equipo o modelo, la comuna y una breve descripción de lo que ocurre.";
  } else if (normalizedService === "postventa_general") {
    text = "Para avanzar con tu solicitud, cuéntame el equipo y qué necesitas revisar.";
  } else if (currentIsCommercial) {
    text = "Cuéntame qué producto necesitas cotizar o qué uso le quieres dar, y te oriento.";
  } else if (isGreetingOnly) {
    text = "¿En qué te puedo ayudar?";
  } else if (isPositiveButton) {
    text = "Perfecto. Cuéntame qué necesitas y te ayudo a revisarlo.";
  } else {
    text = "Cuéntame más detalles para ayudarte.";
  }
}

/*
  Política especial para botones.
  No cambia acción todavía, solo marca intención conversacional para que otros nodos puedan usarla.
*/
const templateReplyPolicy = {
  is_button_or_interactive: isButtonOrInteractive,
  is_positive_button: isPositiveButton,
  is_negative_button: isNegativeButton,
  current_message: currentMessage,
  suppress_greeting: shouldSuppressGreeting,
  suppress_reclamo_mention: shouldSuppressReclamoMention
};

return [
  {
    json: {
      ...input,

      message: {
        ...message,
        text
      },

      speech_policy: {
        has_prior_conversation: hasPriorConversation,
        has_prior_outbound: hasPriorOutbound,
        current_is_greeting_only: isGreetingOnly,
        current_is_commercial: currentIsCommercial,
        current_is_sac: currentIsSac,
        suppress_greeting: shouldSuppressGreeting,
        suppress_reclamo_mention: shouldSuppressReclamoMention,
        normalized_at: new Date().toISOString()
      },

      template_reply_policy: templateReplyPolicy,

      safety: {
        ...safety,
        suppress_mail: safety.suppress_mail !== false,
        suppress_handoff: safety.suppress_handoff !== false
      }
    }
  }
];
