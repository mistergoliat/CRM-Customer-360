const input = $json || {};

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.toLowerCase().trim();
    if (["true", "1", "yes", "si", "sí"].includes(v)) return true;
    if (["false", "0", "no"].includes(v)) return false;
  }
  return fallback;
}

function pickFirst(...values) {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
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

const raw = input.raw_input || input;

const inputEvent = asObject(input.input_event || raw.input_event || raw.message || {});
const serviceContext = asObject(input.service_context || raw.service_context || raw.business_context?.service_context || {});
const customerContext = asObject(input.customer_context || raw.customer_context || raw.customer || {});
const businessContext = asObject(input.business_context || raw.business_context || {});
const caseContext = asObject(input.case_context || raw.case_context || raw.active_case || {});
const caseUpdate = asObject(input.case_update || raw.case_update || {});
const decision = asObject(input.decision || raw.decision || {});
const message = asObject(input.message || raw.message || {});
const agent = asObject(input.agent || raw.agent || {});

const handoffReason = pickFirst(
  input.handoff_reason,
  raw.handoff_reason,
  inputEvent.handoff_reason,
  caseUpdate.handoff_reason,
  decision.handoff_reason,
  input.next_steps?.handoff_reason,
  "out_of_scope"
);

const waId = pickFirst(
  inputEvent.wa_id,
  inputEvent.phone_normalized,
  inputEvent.from,
  inputEvent.phone,
  raw.wa_id,
  raw.phone_normalized,
  raw.from,
  customerContext.phone,
  customerContext.phone_normalized,
  caseContext.wa_id
);

const phoneNormalized = pickFirst(
  inputEvent.phone_normalized,
  inputEvent.wa_id,
  raw.phone_normalized,
  raw.wa_id,
  customerContext.phone_normalized,
  customerContext.phone,
  caseContext.wa_id
);

const providerMessageId = pickFirst(
  inputEvent.provider_message_id,
  inputEvent.message_id,
  inputEvent.id,
  raw.provider_message_id,
  raw.message_id,
  raw.id
);

const contextMessageId = pickFirst(inputEvent.context_message_id, raw.context_message_id);

const messageText = pickFirst(
  inputEvent.message_text,
  inputEvent.text,
  message.text,
  raw.message_text,
  raw.text,
  raw.reply_text
);

const dominantService = pickFirst(
  serviceContext.dominant_service,
  serviceContext.service_code,
  caseUpdate.service_code,
  caseContext.service_code,
  raw.service_code
);

let serviceCode = pickFirst(
  caseUpdate.service_code,
  serviceContext.service_code,
  serviceContext.dominant_service,
  caseContext.service_code,
  raw.service_code,
  "organic_whatsapp"
);

if (serviceCode === "armado") serviceCode = "postventa_armado";
if (serviceCode === "mantencion" || serviceCode === "mantención") serviceCode = "postventa_mantencion";

const sourceTable = pickFirst(
  caseUpdate.source_table,
  serviceContext.source_table,
  caseContext.source_table,
  raw.source_table
) || null;

const sourceId = pickFirstNumber(
  caseUpdate.source_id,
  serviceContext.source_id,
  caseContext.source_id,
  raw.source_id
);

const idOrder = pickFirstNumber(
  caseUpdate.id_order,
  serviceContext.id_order,
  serviceContext.assembly_context?.[0]?.id_order,
  serviceContext.maintenance_context?.[0]?.id_order,
  caseContext.id_order,
  raw.id_order,
  customerContext.id_order,
  customerContext.last_order_id
);

const idCustomer = pickFirstNumber(
  caseUpdate.id_customer,
  serviceContext.id_customer,
  serviceContext.maintenance_context?.[0]?.id_customer,
  caseContext.id_customer,
  raw.id_customer,
  customerContext.id_customer
);

const invoiceNumber = pickFirstNumber(
  caseUpdate.invoice_number,
  serviceContext.invoice_number,
  serviceContext.maintenance_context?.[0]?.invoice_number,
  caseContext.invoice_number,
  raw.invoice_number,
  customerContext.invoice_number
);

let caseOriginType = pickFirst(
  caseUpdate.case_origin_type,
  serviceContext.case_origin_type,
  caseContext.case_origin_type,
  raw.case_origin_type
);

if (!caseOriginType) {
  if (serviceCode === "postventa_armado" || dominantService === "postventa_armado") {
    caseOriginType = "postventa_armado";
  } else if (serviceCode === "postventa_mantencion" || dominantService === "postventa_mantencion") {
    caseOriginType = "postventa_mantencion";
  } else if (sourceTable === "n8n_postventa_queue") {
    caseOriginType = "postventa_armado";
  } else if (sourceTable === "n8n_mantenciones_cardio_queue") {
    caseOriginType = "postventa_mantencion";
  } else if (serviceCode.includes("venta")) {
    caseOriginType = "ventas_whatsapp";
  } else if (serviceCode.includes("garantia")) {
    caseOriginType = "garantia";
  } else if (serviceCode.includes("reclamo")) {
    caseOriginType = "reclamo";
  } else {
    caseOriginType = "organic_whatsapp";
  }
}

const normalized = {
  agent: {
    name: pickFirst(agent.name, "UNKNOWN_AGENT"),
    version: pickFirst(agent.version, "0.1.0")
  },
  decision: {
    action_type: pickFirst(decision.action_type, raw.final_action, raw.recommended_next_action, "handoff_to_human"),
    requires_human: asBoolean(decision.requires_human, false) || asBoolean(raw.requires_human, false) || true,
    confidence: Number(decision.confidence ?? raw.confidence ?? 0),
    risk_level: pickFirst(decision.risk_level, raw.risk_level, "medium"),
    allowed_to_auto_reply: asBoolean(decision.allowed_to_auto_reply, false),
    handoff_reason: handoffReason
  },
  message: {
    channel: pickFirst(message.channel, "whatsapp"),
    text: messageText
  },
  case_update: {
    department: pickFirst(caseUpdate.department, raw.final_department, caseContext.department, "SAC"),
    priority: pickFirst(caseUpdate.priority, raw.case_priority, caseContext.priority, "normal"),
    case_type: pickFirst(caseUpdate.case_type, raw.final_intent, raw.ai_intent, caseContext.case_type, dominantService, "consulta_general"),
    service_code: serviceCode,
    case_origin_type: caseOriginType,
    status: pickFirst(caseUpdate.status, "human_required"),
    source_table: sourceTable,
    source_id: sourceId,
    id_order: idOrder,
    id_customer: idCustomer,
    invoice_number: invoiceNumber,
    handoff_reason: handoffReason
  },
  input_event: {
    wa_id: waId,
    phone_normalized: phoneNormalized,
    contact_name: pickFirst(inputEvent.contact_name, raw.contact_name, customerContext.full_name, customerContext.name, caseContext.contact_name),
    phone_number_id: pickFirst(inputEvent.phone_number_id, raw.phone_number_id),
    provider_message_id: providerMessageId,
    context_message_id: contextMessageId,
    message_type: pickFirst(inputEvent.message_type, raw.message_type, "text"),
    message_text: messageText,
    received_at: pickFirst(inputEvent.received_at, raw.received_at),
    timestamp: pickFirst(inputEvent.timestamp, raw.timestamp),
    handoff_reason: handoffReason
  },
  service_context: {
    ...serviceContext,
    dominant_service: dominantService || serviceCode,
    source_table: sourceTable,
    source_id: sourceId,
    case_origin_type: caseOriginType
  },
  customer_context: customerContext,
  business_context: businessContext,
  case_context: caseContext,
  tool_request: asObject(input.tool_request || raw.tool_request),
  events: asArray(input.events || raw.events),
  next_steps: asObject(input.next_steps || raw.next_steps),
  safety: asObject(input.safety || raw.safety),
  handoff_reason: handoffReason,
  raw_input: raw,
  validation: {
    can_create_case: !!waId,
    missing_required_fields: waId ? [] : ["wa_id"]
  }
};

return [{ json: normalized }];
