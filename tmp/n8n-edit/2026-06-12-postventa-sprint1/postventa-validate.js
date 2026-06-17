const data = $json || {};

const normalizedInput = data.normalized_input || {};
const agentConfig = data.agent_config || {};

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:()[\]{}"']/g, "")
    .replace(/\s+/g, " ");
}

function hasAny(text, terms) {
  const t = normalizeText(text);
  return terms.some(term => t.includes(normalizeText(term)));
}

function bool(value, fallback = false) {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

function normalizeAction(value) {
  const v = clean(value).toLowerCase();

  if (["reply", "send_reply", "send_to_executor"].includes(v)) return "reply";
  if (["ask_missing_data", "ask_for_data", "request_missing_data"].includes(v)) return "ask_missing_data";
  if (["handoff", "handoff_to_human", "human_review", "send_to_handoff", "requires_human"].includes(v)) return "handoff_to_human";
  if (["tool_request", "request_tool", "request_quote_tool", "create_quote", "quote_tool"].includes(v)) return "tool_request";
  if (["close", "close_case", "close_candidate"].includes(v)) return "close_case";
  if (["none", "noop", "no_action"].includes(v)) return "no_action";

  return "reply";
}

function normalizeRisk(value, fallback = "medium") {
  const v = clean(value).toLowerCase();
  if (["low", "medium", "high"].includes(v)) return v;
  return fallback;
}

const exactOutOfScopeHandoffText = "Tu solicitud será procesada por un ejecutivo durante los siguientes horarios: 9:00 a 17:00 de lunes a viernes, gracias.";

function buildPostventaFallbackText(serviceCode, actionType, originalMessageText) {
  const normalizedService = normalizeText(serviceCode);
  const normalizedMessage = normalizeText(originalMessageText);

  if (actionType === "handoff_to_human") {
    return "Gracias, ya dejé registrada tu solicitud para revisión y coordinación del equipo correspondiente.";
  }

  if (normalizedService === "postventa_armado") {
    if (normalizedMessage.includes("direccion") || normalizedMessage.includes("dirección")) {
      return "Para ayudarte con el armado, compárteme además la comuna y el producto o número de orden asociado.";
    }

    return "Para ayudarte con el armado, indícame la comuna, la dirección y el producto o número de orden asociado.";
  }

  if (normalizedService === "postventa_mantencion") {
    return "Para revisar la mantención, indícame el equipo o modelo, la comuna y una breve descripción de lo que ocurre.";
  }

  return "Para avanzar con tu solicitud, cuéntame un poco más del equipo y qué necesitas revisar.";
}

const inputEvent = asObject(normalizedInput.input_event);
const customerContext = asObject(normalizedInput.customer_context);
const serviceContext = asObject(normalizedInput.service_context);
const caseContext = asObject(normalizedInput.case_context);
const classification = asObject(normalizedInput.classification);
const orch = asObject(normalizedInput.orchestrator_decision);
const orchCase = asObject(normalizedInput.case_decision || orch.case_decision);

const outDecision = asObject(data.decision);
const outMessage = asObject(data.message);
const outCase = asObject(data.case_update);
const outTool = asObject(data.tool_request);
const outNext = asObject(data.next_steps);
const outSafety = asObject(data.safety);

const agentName = pickFirst(
  data.agent?.name,
  "UNKNOWN_AGENT"
);

const version = pickFirst(
  data.agent?.version,
  agentConfig.version,
  "0.4.0"
);

const originalMessageText = pickFirst(
  inputEvent.message_text,
  inputEvent.text,
  normalizedInput.message?.text
);

const combinedText = [
  originalMessageText,
  outMessage.text,
  JSON.stringify(classification),
  JSON.stringify(outCase),
  JSON.stringify(serviceContext)
].join(" ");

const complaintTerms = [
  "reclamo",
  "molesto",
  "mala experiencia",
  "pesima",
  "pésima",
  "horrible",
  "defectuoso",
  "defectuosa",
  "danado",
  "dañado",
  "danada",
  "dañada",
  "roto",
  "rota",
  "garantia",
  "garantía",
  "devolucion",
  "devolución",
  "reembolso",
  "cambio",
  "sernac",
  "demanda",
  "abogado",
  "legal",
  "estafa"
];

const outOfScopeTerms = [
  "catalogo",
  "catálogo",
  "precio",
  "valor",
  "cotizacion",
  "cotización",
  "stock",
  "disponibilidad",
  "comprar",
  "compra",
  "vendedor",
  "vendedora",
  "ventas",
  "garantia",
  "garantía",
  "devolucion",
  "devolución",
  "reembolso",
  "sernac",
  "abogado",
  "legal",
  "humano",
  "ejecutivo",
  "supervisor",
  "persona"
];

let actionType = normalizeAction(
  outDecision.action_type ||
  data.action_type ||
  outNext.target_workflow ||
  agentConfig.default_action
);

let riskLevel = normalizeRisk(
  outDecision.risk_level ||
  classification.risk_level,
  "medium"
);

let confidence = clamp01(
  outDecision.confidence ??
  classification.confidence,
  0.85
);

let department = pickFirst(
  outCase.department,
  orchCase.department,
  agentConfig.department,
  "Postventa"
);

let serviceCode = pickFirst(
  outCase.service_code,
  orchCase.service_code,
  serviceContext.dominant_service,
  serviceContext.service_code,
  caseContext.service_code,
  agentConfig.service_code,
  "postventa_general"
);

let caseOriginType = pickFirst(
  outCase.case_origin_type,
  orchCase.case_origin_type,
  serviceContext.case_origin_type,
  agentConfig.case_origin_type,
  serviceCode
);

let caseType = pickFirst(
  outCase.case_type,
  orchCase.case_type,
  serviceContext.case_type,
  classification.intent,
  agentConfig.case_type,
  "postventa_general"
);

let priority = pickFirst(
  outCase.priority,
  orchCase.priority,
  agentConfig.priority,
  "normal"
).toLowerCase();

let messageText = clean(outMessage.text || data.response_text || "");

const normalizedMessage = normalizeText(originalMessageText);
const normalizedService = normalizeText(serviceCode);
const messageSuggestsArmado = hasAny(normalizedMessage, ["armado", "armar", "instalacion", "instalación"]);
const messageSuggestsMantencion = hasAny(normalizedMessage, ["mantencion", "mantención", "mantenimiento", "ruido", "falla", "falla tecnica", "fallo", "revision", "revisión"]);
const complaintDetected = hasAny(combinedText, complaintTerms);
const outOfScopeDetected =
  hasAny(normalizedMessage, outOfScopeTerms) &&
  !messageSuggestsArmado &&
  !messageSuggestsMantencion;

if (normalizedService === "postventa_armado" || messageSuggestsArmado) {
  serviceCode = "postventa_armado";
  caseOriginType = "postventa_armado";
  caseType = "coordinacion_armado";
  department = "Postventa";
}

if (normalizedService === "postventa_mantencion" || messageSuggestsMantencion) {
  serviceCode = "postventa_mantencion";
  caseOriginType = "postventa_mantencion";
  caseType = "coordinacion_mantencion";
  department = "Postventa";
}

if (
  serviceCode !== "postventa_armado" &&
  serviceCode !== "postventa_mantencion" &&
  serviceCode !== "postventa_general"
) {
  serviceCode = "postventa_general";
  caseOriginType = "postventa_general";
  caseType = caseType || "postventa_general";
  department = department || "Postventa";
}

if (complaintDetected) {
  department = "SAC";
  serviceCode = hasAny(combinedText, ["garantia", "garantía"]) ? "garantia" : "reclamo";
  caseOriginType = serviceCode;
  caseType = serviceCode;
  priority = "high";
  riskLevel = "high";
  actionType = "handoff_to_human";
}

if (
  actionType !== "handoff_to_human" &&
  outOfScopeDetected
) {
  actionType = "handoff_to_human";
  riskLevel = riskLevel === "high" ? "high" : "medium";
}

const toolRequired = bool(outTool.required, false) || actionType === "tool_request";
let toolName = outTool.tool_name ?? null;

if (toolRequired) {
  actionType = "tool_request";
  if (!toolName) {
    toolName = "quote_tool";
  }
}

if ((actionType === "reply" || actionType === "ask_missing_data") && !messageText) {
  messageText = buildPostventaFallbackText(serviceCode, actionType, originalMessageText);
}

if (actionType === "reply" && confidence < 0.75) {
  actionType = "handoff_to_human";
  riskLevel = riskLevel === "low" ? "medium" : riskLevel;
}

if (actionType === "ask_missing_data" && confidence < 0.75) {
  actionType = "handoff_to_human";
  riskLevel = riskLevel === "low" ? "medium" : riskLevel;
}

let requiresHuman =
  actionType === "handoff_to_human" ||
  riskLevel === "high";

const allowedToAutoReply =
  ["reply", "ask_missing_data"].includes(actionType) &&
  !requiresHuman &&
  riskLevel !== "high" &&
  confidence >= 0.75 &&
  !!messageText;

if (["reply", "ask_missing_data"].includes(actionType) && !allowedToAutoReply) {
  actionType = "handoff_to_human";
  requiresHuman = true;
}

if (actionType === "handoff_to_human" && !messageText) {
  messageText = buildPostventaFallbackText(serviceCode, actionType, originalMessageText);
}

if (actionType === "handoff_to_human" && outOfScopeDetected && !complaintDetected) {
  messageText = exactOutOfScopeHandoffText;
}

let status = "open";
if (requiresHuman) status = "human_required";
if (actionType === "tool_request") status = "pending_tool";
if (actionType === "close_case") status = "closed";
if (actionType === "no_action") status = pickFirst(outCase.status, caseContext.status, "open");

const targetWorkflow =
  actionType === "reply" || actionType === "ask_missing_data"
    ? "OPS_Response_Executor"
    : actionType === "handoff_to_human"
      ? "OPS_Handoff_Manager"
      : actionType === "tool_request"
        ? "OPS_Tool_Dispatcher"
        : actionType === "close_case"
          ? "OPS_Case_Closer"
          : "NOOP";

const handoffDepartment =
  actionType === "handoff_to_human"
    ? department
    : null;

const blocked =
  !allowedToAutoReply &&
  ["reply", "ask_missing_data"].includes(actionType);

const blockedReason = blocked
  ? pickFirst(
      outSafety.blocked_reason,
      data._parse_error ? "invalid_json" : "",
      riskLevel === "high" ? "high_risk" : "",
      "auto_reply_not_allowed"
    )
  : null;

const sourceTable = pickFirst(
  outCase.source_table,
  orchCase.source_table,
  serviceContext.source_table,
  caseContext.source_table
) || null;

const sourceId = pickFirstNumber(
  outCase.source_id,
  orchCase.source_id,
  serviceContext.source_id,
  caseContext.source_id
);

const idOrder = pickFirstNumber(
  outCase.id_order,
  orchCase.id_order,
  serviceContext.id_order,
  serviceContext.assembly_context?.[0]?.id_order,
  serviceContext.maintenance_context?.[0]?.id_order,
  caseContext.id_order,
  customerContext.id_order,
  customerContext.last_order_id
);

const idCustomer = pickFirstNumber(
  outCase.id_customer,
  orchCase.id_customer,
  serviceContext.id_customer,
  serviceContext.assembly_context?.[0]?.id_customer,
  serviceContext.maintenance_context?.[0]?.id_customer,
  caseContext.id_customer,
  customerContext.id_customer,
  customerContext.customer_id
);

const invoiceNumber = pickFirstNumber(
  outCase.invoice_number,
  orchCase.invoice_number,
  serviceContext.invoice_number,
  serviceContext.assembly_context?.[0]?.invoice_number,
  serviceContext.maintenance_context?.[0]?.invoice_number,
  caseContext.invoice_number,
  customerContext.invoice_number
);

const canonical = {
  agent: {
    name: agentName,
    version
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
    text: messageText,
    template_required: bool(outMessage.template_required, false)
  },

  case_update: {
    case_action: actionType === "close_case" ? "close" : "open_or_continue",
    department,
    service_code: serviceCode,
    case_origin_type: caseOriginType,
    case_type: caseType,
    priority,
    status,
    source_table: sourceTable,
    source_id: sourceId,
    id_order: idOrder,
    id_customer: idCustomer,
    invoice_number: invoiceNumber
  },

  tool_request: {
    required: actionType === "tool_request",
    tool_name: actionType === "tool_request" ? toolName : null,
    input: actionType === "tool_request" ? asObject(outTool.input) : {}
  },

  next_steps: {
    target_workflow: targetWorkflow,
    schedule_followup: bool(outNext.schedule_followup, false),
    handoff_department: handoffDepartment
  },

  safety: {
    blocked,
    blocked_reason: blockedReason,
    allowed_to_auto_reply: allowedToAutoReply,
    suppress_mail: actionType === "handoff_to_human" ? false : true,
    suppress_handoff: actionType === "handoff_to_human" ? false : true
  },

  _validation_error: false,
  _validated_at: new Date().toISOString(),
  normalized_input: normalizedInput,

  raw_model_output: {
    ...data,
    normalized_input: undefined,
    agent_config: undefined
  }
};

if (data._parse_error) {
  canonical._parse_error = true;
  canonical._parse_error_message = data._parse_error_message || "invalid_json";
}

return [{ json: canonical }];
