const data = $json || {};

const allowedIntents = [
  "greeting",
  "quote_request",
  "purchase_advice",
  "product_availability",
  "shipping_question",
  "order_status",
  "complaint",
  "warranty",
  "return_or_exchange",
  "postventa_armado",
  "postventa_mantencion",
  "postventa_general",
  "campaign_response",
  "review_response",
  "human_request",
  "thanks_or_closure",
  "customer_rejection",
  "opt_out",
  "spam_or_irrelevant",
  "unknown"
];

const allowedAgents = [
  "AI_AGENT_Quote",
  "AI_AGENT_Sales",
  "AI_AGENT_SAC",
  "AI_AGENT_Postventa",
  "AI_AGENT_Campaign",
  "AI_AGENT_Knowledge",
  "AI_AGENT_GENERAL",
  "executor",
  "OPS_Handoff_Manager",
  "OPS_Case_Closer",
  "OPS_Tool_Request",
  "noop",
  "quote_agent",
  "sales_agent",
  "sac_agent",
  "postventa_agent",
  "campaign_agent",
  "knowledge_agent",
  "general_agent",
  "human_review"
];

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:()[\]{}"']/g, "")
    .replace(/\s+/g, " ");
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asBool(value, fallback = false) {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

function clamp01(value, fallback = 0.8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function pickFirst(...values) {
  for (const value of values) {
    const v = clean(value);
    if (v) return v;
  }
  return "";
}

function pickFirstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function includesAny(text, terms) {
  const t = normalizeText(text);
  return terms.some((term) => t.includes(normalizeText(term)));
}

function normalizeTargetAgent(value) {
  const v = clean(value);
  const map = {
    quote_agent: "AI_AGENT_Quote",
    sales_agent: "AI_AGENT_Sales",
    sac_agent: "AI_AGENT_SAC",
    postventa_agent: "AI_AGENT_Postventa",
    campaign_agent: "AI_AGENT_Campaign",
    knowledge_agent: "AI_AGENT_Knowledge",
    general_agent: "AI_AGENT_SAC",
    human_review: "OPS_Handoff_Manager",
    AI_AGENT_Quote: "AI_AGENT_Quote",
    AI_AGENT_Sales: "AI_AGENT_Sales",
    AI_AGENT_SAC: "AI_AGENT_SAC",
    AI_AGENT_Postventa: "AI_AGENT_Postventa",
    AI_AGENT_Campaign: "AI_AGENT_Campaign",
    AI_AGENT_Knowledge: "AI_AGENT_Knowledge",
    AI_AGENT_GENERAL: "AI_AGENT_SAC",
    OPS_Handoff_Manager: "OPS_Handoff_Manager",
    OPS_Case_Closer: "OPS_Case_Closer",
    OPS_Tool_Request: "OPS_Tool_Request",
    executor: "executor",
    noop: "noop"
  };

  return map[v] || "AI_AGENT_SAC";
}

function normalizeIntent(value) {
  const v = normalizeText(value);
  const map = {
    greeting: "greeting",
    saludo: "greeting",
    quote_request: "quote_request",
    cotizacion: "quote_request",
    cotizar: "quote_request",
    purchase_advice: "purchase_advice",
    product_availability: "product_availability",
    shipping_question: "shipping_question",
    order_status: "order_status",
    complaint: "complaint",
    reclamo: "complaint",
    warranty: "warranty",
    garantia: "warranty",
    return_or_exchange: "return_or_exchange",
    devolucion: "return_or_exchange",
    postventa_armado: "postventa_armado",
    armado: "postventa_armado",
    postventa_mantencion: "postventa_mantencion",
    mantencion: "postventa_mantencion",
    mantenimiento: "postventa_mantencion",
    postventa_general: "postventa_general",
    campaign_response: "campaign_response",
    review_response: "review_response",
    human_request: "human_request",
    thanks_or_closure: "thanks_or_closure",
    customer_rejection: "customer_rejection",
    opt_out: "opt_out",
    spam_or_irrelevant: "spam_or_irrelevant",
    unknown: "unknown"
  };

  return map[v] || "unknown";
}

function normalizeRisk(value) {
  const v = normalizeText(value);
  if (["low", "bajo"].includes(v)) return "low";
  if (["medium", "medio", "moderate"].includes(v)) return "medium";
  if (["high", "alto"].includes(v)) return "high";
  return "medium";
}

function normalizeService(value) {
  const v = normalizeText(value);
  if (!v) return "unknown";
  if (["postventa_armado", "armado"].includes(v)) return "postventa_armado";
  if (["postventa_mantencion", "mantencion", "mantenimiento"].includes(v)) return "postventa_mantencion";
  if (v.includes("postventa")) return "postventa_general";
  if (["campaign", "campana", "campaña", "campaign_response"].includes(v)) return "campaign";
  if (["knowledge", "faq", "documentacion", "documentación"].includes(v)) return "knowledge";
  if (["garantia", "reclamo", "devolucion", "warranty", "complaint", "sac"].includes(v)) return "sac";
  if (["quote", "cotizacion", "cotización"].includes(v)) return "quote";
  if (["sales", "ventas", "asesoria_compra", "purchase_advice", "product_availability"].includes(v)) return "sales";
  return v;
}

function mapServiceToAgent(service) {
  const normalized = normalizeService(service);
  if (["postventa_armado", "postventa_mantencion", "postventa_general"].includes(normalized)) return "AI_AGENT_Postventa";
  if (normalized === "campaign") return "AI_AGENT_Campaign";
  if (normalized === "knowledge") return "AI_AGENT_Knowledge";
  if (normalized === "quote") return "AI_AGENT_Quote";
  if (normalized === "sales") return "AI_AGENT_Sales";
  if (normalized === "sac") return "AI_AGENT_SAC";
  return null;
}

function buildSwitchAction({
  route = false,
  execute = false,
  handoff = false,
  close = false,
  noop = false,
  suppressMail = true,
  suppressHandoff = true,
  blockedReason = null
}) {
  return {
    should_route_to_agent: route,
    should_execute_response: execute,
    should_handoff: handoff,
    should_close_case: close,
    should_noop: noop,
    should_suppress_mail: suppressMail,
    should_suppress_handoff: suppressHandoff,
    blocked_reason: blockedReason
  };
}

const rawInput = asObject(data.raw_input);
const inputEvent = asObject(data.input_event || rawInput.input_event);
const customerContext = asObject(data.customer_context || rawInput.customer_context);
const caseContext = asObject(data.case_context || rawInput.case_context);
const conversationContext = asObject(data.conversation_context || rawInput.conversation_context);
const businessContext = asObject(data.business_context || rawInput.business_context);
const serviceContext = asObject(data.service_context || rawInput.service_context);
const resolverMeta = asObject(data.resolver_meta || rawInput.resolver_meta);

const rawIntent = pickFirst(
  data.classification?.intent,
  data.intent,
  data.raw_model_output?.intent,
  data.raw_model_output?.classification?.intent
);

const intentNormalized = normalizeIntent(rawIntent);
const schemaInvalidIntent = !!rawIntent && normalizeText(rawIntent) !== "unknown" && intentNormalized === "unknown";

let intent = intentNormalized;
let targetAgent = normalizeTargetAgent(
  pickFirst(
    data.classification?.target_agent,
    data.routing?.target_agent,
    data.routing?.next_workflow,
    data.target_agent
  )
);

let riskLevel = normalizeRisk(
  pickFirst(
    data.classification?.risk_level,
    data.risk_level,
    "medium"
  )
);

let confidence = clamp01(
  data.classification?.confidence ?? data.confidence,
  0.82
);

const currentText = normalizeText(
  inputEvent.message_text ||
  inputEvent.text ||
  businessContext.current_message_flags?.current_message_text
);

const dominantService = normalizeService(
  pickFirst(
    serviceContext.dominant_service,
    serviceContext.service_code,
    caseContext.service_code,
    caseContext.case_origin_type,
    data.case_decision?.service_code
  )
);

const currentMessageType = normalizeText(inputEvent.message_type || "text");
const isGreetingOnly =
  currentMessageType === "text" &&
  ["hola", "holaa", "hola hola", "buenas", "buena", "buen dia", "buenos dias", "buenas tardes", "buenas noches"].includes(currentText);

const isWeakContinuation =
  isGreetingOnly ||
  ["si", "sÃ­", "ok", "oka", "oki", "dale", "me interesa", "perfecto", "quiero", "lo quiero", "me sirve", "listo"].includes(currentText) ||
  ["button", "interactive", "list_reply"].includes(currentMessageType);

const isExplicitDecline = ["no gracias", "no, gracias", "no me interesa", "paso", "por ahora no", "no quiero"].includes(currentText);
const isLegalRisk = includesAny(currentText, ["sernac", "demanda", "abogado", "legal", "denuncia", "estafa", "funa", "accidente", "lesion", "lesiÃ³n"]);
const isHumanRequest = includesAny(currentText, ["quiero hablar con una persona", "quiero hablar con alguien", "quiero hablar con humano", "necesito hablar con alguien", "necesito hablar con una persona", "ejecutivo", "supervisor", "operador"]);
const isComplaint = includesAny(currentText, ["reclamo", "garantia", "garantÃ­a", "devolucion", "devoluciÃ³n", "reembolso", "daÃ±ado", "danado", "roto", "mala experiencia"]);
const isQuoteIntent = includesAny(currentText, ["cotizar", "cotizacion", "cotizaciÃ³n", "presupuesto", "valor"]);
const isCommercialIntent = includesAny(currentText, ["catalogo", "catÃ¡logo", "stock", "precio", "disponibilidad", "producto", "productos", "comprar", "maquina", "mÃ¡quina", "banca", "rack", "barra", "disco", "mancuerna", "mancuernas"]);

const sourceTable = normalizeText(
  pickFirst(serviceContext.source_table, caseContext.source_table, data.case_update?.source_table)
);

const hasPostventaContext =
  ["postventa_armado", "postventa_mantencion", "postventa_general"].includes(dominantService) ||
  ["postventa_armado", "postventa_mantencion", "postventa_general"].includes(normalizeService(caseContext.service_code)) ||
  ["postventa_armado", "postventa_mantencion", "postventa_general"].includes(normalizeService(caseContext.case_origin_type)) ||
  ["postventa_armado", "postventa_mantencion", "postventa_general"].includes(normalizeService(serviceContext.case_origin_type)) ||
  sourceTable === "n8n_postventa_queue" ||
  sourceTable === "n8n_mantenciones_cardio_queue";

const conversationCaseId = pickFirstNumber(
  caseContext.conversation_case_id,
  caseContext.case_id
);

const hasActiveCase =
  !!conversationCaseId &&
  !["closed", "archived", "resolved"].includes(normalizeText(caseContext.status)) &&
  !["closed", "archived"].includes(normalizeText(caseContext.lifecycle_status));

const manualLockActive =
  asBool(resolverMeta.manual_lock_active, false) ||
  asBool(caseContext.manual_lock_active, false);

const operatorActive =
  asBool(resolverMeta.operator_active, false) ||
  asBool(caseContext.operator_active, false);

const botCanContinue =
  resolverMeta.bot_can_continue !== false &&
  resolverMeta.bot_can_continue !== "false";

const recommendedBotMode = normalizeText(resolverMeta.recommended_bot_mode);

let actionType = "route_to_agent";
let blockedReason = null;
let decisionReason = "model_routing";
let requiresHuman = false;
let allowedToAutoReply = false;
let handoffReason = null;

if (!botCanContinue || manualLockActive || operatorActive || recommendedBotMode === "operator_locked") {
  intent = intentNormalized;
  targetAgent = "noop";
  actionType = "no_action";
  requiresHuman = true;
  blockedReason = "operator_or_manual_lock_active";
  decisionReason = "operational_lock";
}
else if (isExplicitDecline) {
  intent = "customer_rejection";
  targetAgent = "OPS_Case_Closer";
  actionType = "close_candidate";
  riskLevel = "low";
  confidence = Math.max(confidence, 0.9);
  decisionReason = "customer_rejection";
}
else if (isLegalRisk || isHumanRequest) {
  intent = "human_request";
  targetAgent = "OPS_Handoff_Manager";
  actionType = "send_to_handoff";
  riskLevel = isLegalRisk ? "high" : "medium";
  confidence = Math.max(confidence, 0.9);
  requiresHuman = true;
  handoffReason = isLegalRisk ? "legal_high_risk" : "human_request";
  blockedReason = handoffReason;
  decisionReason = handoffReason;
}
else if (isComplaint) {
  intent = "complaint";
  targetAgent = "AI_AGENT_SAC";
  actionType = "route_to_agent";
  riskLevel = "medium";
  confidence = Math.max(confidence, 0.86);
  decisionReason = "sac_context_or_request";
}
else if (schemaInvalidIntent) {
  targetAgent = "OPS_Handoff_Manager";
  actionType = "send_to_handoff";
  requiresHuman = true;
  allowedToAutoReply = false;
  riskLevel = "medium";
  handoffReason = "invalid_intent";
  blockedReason = "invalid_intent";
  decisionReason = "invalid_intent";
}
else if (hasPostventaContext) {
  intent =
    dominantService === "postventa_armado"
      ? "postventa_armado"
      : dominantService === "postventa_mantencion"
        ? "postventa_mantencion"
        : "postventa_general";
  targetAgent = "AI_AGENT_Postventa";
  actionType = "route_to_agent";
  riskLevel = riskLevel === "high" ? "high" : "medium";
  confidence = Math.max(confidence, 0.86);
  decisionReason = isWeakContinuation ? "postventa_continuity" : "postventa_domain_priority";
}
else if (intent === "unknown" && !isGreetingOnly) {
  targetAgent = "OPS_Handoff_Manager";
  actionType = "send_to_handoff";
  requiresHuman = true;
  allowedToAutoReply = false;
  riskLevel = "medium";
  handoffReason = "out_of_scope";
  blockedReason = "out_of_scope";
  decisionReason = "out_of_scope";
}
else if (isQuoteIntent) {
  intent = "quote_request";
  targetAgent = "AI_AGENT_Quote";
  actionType = "route_to_agent";
  riskLevel = "low";
  confidence = Math.max(confidence, 0.84);
  decisionReason = "explicit_quote_request";
}
else if (isCommercialIntent) {
  intent = intent === "unknown" ? "purchase_advice" : intent;
  targetAgent = "AI_AGENT_Sales";
  actionType = "route_to_agent";
  riskLevel = "low";
  confidence = Math.max(confidence, 0.82);
  decisionReason = "commercial_request";
}
else if (hasPostventaContext && isWeakContinuation) {
  targetAgent = "AI_AGENT_Postventa";
  actionType = "route_to_agent";
  confidence = Math.max(confidence, 0.84);
  decisionReason = "contextual_continuity";
}
else if (!allowedAgents.includes(targetAgent)) {
  targetAgent = hasPostventaContext ? (mapServiceToAgent(dominantService) || "AI_AGENT_Postventa") : "OPS_Handoff_Manager";
  actionType = hasPostventaContext ? "route_to_agent" : "send_to_handoff";
  if (!hasPostventaContext) {
    requiresHuman = true;
    handoffReason = handoffReason || "out_of_scope";
    blockedReason = blockedReason || "out_of_scope";
    decisionReason = decisionReason || "out_of_scope";
  } else {
    decisionReason = "normalized_invalid_target";
  }
}

if (!allowedIntents.includes(intent)) {
  intent = "unknown";
}

if (!["low", "medium", "high"].includes(riskLevel)) {
  riskLevel = "medium";
}

let nextWorkflow = null;
let finalAction = null;
let switchAction = null;

if (actionType === "no_action") {
  nextWorkflow = null;
  finalAction = "no_action";
  switchAction = buildSwitchAction({
    route: false,
    execute: false,
    handoff: false,
    close: false,
    noop: true,
    suppressMail: true,
    suppressHandoff: true,
    blockedReason
  });
}

if (actionType === "close_candidate") {
  nextWorkflow = "OPS_Case_Closer";
  finalAction = "close_candidate";
  switchAction = buildSwitchAction({
    route: false,
    execute: false,
    handoff: false,
    close: true,
    noop: false,
    suppressMail: true,
    suppressHandoff: true,
    blockedReason
  });
}

if (actionType === "route_to_agent") {
  nextWorkflow = targetAgent;
  finalAction = "route_to_agent";
  switchAction = buildSwitchAction({
    route: true,
    execute: false,
    handoff: false,
    close: false,
    noop: false,
    suppressMail: true,
    suppressHandoff: true,
    blockedReason
  });
}

if (actionType === "send_to_handoff") {
  nextWorkflow = "OPS_Handoff_Manager";
  finalAction = "handoff_to_human";
  switchAction = buildSwitchAction({
    route: false,
    execute: false,
    handoff: true,
    close: false,
    noop: false,
    suppressMail: false,
    suppressHandoff: false,
    blockedReason
  });
}

const department = pickFirst(
  data.case_decision?.department,
  data.case_update?.department,
  caseContext.department,
  targetAgent === "AI_AGENT_Postventa" ? "Postventa" : "",
  targetAgent === "AI_AGENT_Sales" || targetAgent === "AI_AGENT_Quote" ? "Ventas" : "",
  targetAgent === "OPS_Handoff_Manager" && isComplaint ? "SAC" : "",
  "SAC"
);

const serviceCode = pickFirst(
  data.case_decision?.service_code,
  data.case_update?.service_code,
  serviceContext.service_code,
  serviceContext.dominant_service,
  caseContext.service_code,
  dominantService === "unknown" ? "organic_whatsapp" : dominantService
);

const caseOriginType = pickFirst(
  data.case_decision?.case_origin_type,
  data.case_update?.case_origin_type,
  serviceContext.case_origin_type,
  serviceCode || "organic_whatsapp"
);

const caseType = pickFirst(
  data.case_decision?.case_type,
  data.case_update?.case_type,
  caseContext.case_type,
  caseContext.case_topic,
  intent === "unknown" ? "consulta_general" : intent
);

const priority = pickFirst(
  data.case_decision?.priority,
  data.case_update?.priority,
  caseContext.priority,
  riskLevel === "high" ? "high" : "normal"
);

const caseAction =
  actionType === "close_candidate"
    ? "close_candidate"
    : actionType === "no_action"
      ? "keep_current"
      : hasActiveCase
        ? "continue_case"
        : "open_or_continue";

const caseStatusForUpdate =
  actionType === "send_to_handoff"
    ? "human_required"
    : actionType === "close_candidate"
      ? "closed"
      : hasActiveCase
        ? caseContext.status || "open"
        : "open";

const result = {
  orchestrator: {
    name: "AI_00_Orchestrator",
    version: "0.8.0"
  },
  classification: {
    intent,
    confidence,
    target_agent: targetAgent,
    risk_level: riskLevel,
    requires_human: requiresHuman
  },
  decision: {
    action_type: actionType,
    requires_human: requiresHuman,
    confidence,
    risk_level: riskLevel,
    allowed_to_auto_reply: allowedToAutoReply
  },
  message: {
    channel: "whatsapp",
    text: null,
    template_required: false
  },
  case_decision: {
    case_action: caseAction,
    department,
    service_code: serviceCode,
    case_origin_type: caseOriginType,
    case_type: caseType,
    priority
  },
  case_update: {
    case_action: caseAction,
    department,
    service_code: serviceCode,
    case_origin_type: caseOriginType,
    case_type: caseType,
    priority,
    status: caseStatusForUpdate,
    close_reason: actionType === "close_candidate" ? caseType : null,
    suppress_mail: switchAction.should_suppress_mail,
    suppress_handoff: switchAction.should_suppress_handoff,
    do_not_contact: false,
    rejection_detected: isExplicitDecline,
    handoff_reason: handoffReason,
    source_table: pickFirst(serviceContext.source_table, caseContext.source_table) || null,
    source_id: pickFirstNumber(serviceContext.source_id, caseContext.source_id),
    id_order: pickFirstNumber(serviceContext.id_order, caseContext.id_order, customerContext.last_order_id),
    id_customer: pickFirstNumber(serviceContext.id_customer, caseContext.id_customer, customerContext.id_customer, customerContext.customer_id),
    invoice_number: pickFirstNumber(serviceContext.invoice_number, caseContext.invoice_number, customerContext.invoice_number)
  },
  missing_data: asArray(data.missing_data),
  recommended_action: {
    action_type: actionType,
    reason: decisionReason
  },
  routing: {
    target_agent: targetAgent,
    next_workflow: nextWorkflow,
    fallback_workflow: actionType === "send_to_handoff" ? "OPS_Handoff_Manager" : null,
    handoff_reason: handoffReason
  },
  safety: {
    allowed_to_auto_reply: allowedToAutoReply,
    blocked_reason: blockedReason,
    suppress_mail: switchAction.should_suppress_mail,
    suppress_handoff: switchAction.should_suppress_handoff,
    do_not_contact: false
  },
  switch_action: switchAction,
  target_agent: targetAgent,
  next_workflow: nextWorkflow,
  route_to: nextWorkflow,
  routing_target: targetAgent,
  final_action: finalAction,
  action_type: actionType,
  requires_human: requiresHuman,
  allowed_to_auto_reply: allowedToAutoReply,
  intent,
  department,
  service_code: serviceCode,
  case_origin_type: caseOriginType,
  case_type: caseType,
  priority,
  risk_level: riskLevel,
  handoff_reason: handoffReason,
  explicit_intent_shift: pickFirst(data.explicit_intent_shift, null),
  is_simple_greeting: isGreetingOnly,
  is_customer_rejection: isExplicitDecline,
  is_hard_opt_out: includesAny(currentText, ["no me escriban mas", "no me escribas mas", "dejen de escribirme", "eliminar mi numero", "borrar mi numero", "no quiero que me contacten", "stop"]),
  is_customer_thanks_or_closure: includesAny(currentText, ["gracias", "muchas gracias", "quedamos listos", "estamos listos", "listo gracias", "eso era", "eso seria", "era eso", "no necesito nada mas", "no me interesa", "ya no me interesa"]),
  input_event: inputEvent,
  service_context: serviceContext,
  customer_context: customerContext,
  business_context: businessContext,
  case_context: caseContext,
  conversation_context: conversationContext,
  risk_flags: asArray(data.risk_flags || businessContext.risk_flags),
  manual_reply_policy: asObject(data.manual_reply_policy || conversationContext.manual_reply_policy || {
    has_manual_reply_any: false,
    has_manual_reply_same_case: false,
    has_manual_reply_same_thread: false,
    manual_reply_blocks_bot: false,
    last_manual_reply_at: null,
    minutes_since_last_manual_reply: null,
    block_reason: null,
    source: "default"
  }),
  router_consistency: {
    has_active_case: hasActiveCase,
    has_postventa_context: hasPostventaContext,
    is_greeting_only: isGreetingOnly,
    manual_reply_blocks_bot: asBool(conversationContext.manual_reply, false),
    legacy_manual_reply_seen: asBool(conversationContext.manual_reply, false),
    lifecycle_inconsistent: false,
    decision_reason: decisionReason
  },
  resolver_meta: asObject(data.resolver_meta),
  _validation_error: false,
  _return_orchestrator_result_at: new Date().toISOString(),
  raw_input: rawInput,
  raw_model_output: data.raw_model_output || data._raw_model_output || data
};

return [{ json: result }];
