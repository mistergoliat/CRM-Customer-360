const current = $json || {};

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pickFirst(...values) {
  for (const value of values) {
    const v = clean(value);
    if (v) return v;
  }
  return "";
}

function pickFirstRaw(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function pickFirstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function normalizePhone(value) {
  return clean(value).replace(/\D/g, "");
}

function getNodeJson(nodeName) {
  try {
    return $(nodeName).item.json || {};
  } catch (e) {
    return {};
  }
}

const fromBuildContext = getNodeJson("Code - Build Context Resolver Input");
const fromPrepareInbound = getNodeJson("Code - Prepare Insert Inbound");
const fromRestoreInbound = getNodeJson("Code - Restore After Raw Inbound");
const fromCanonicalInbound = getNodeJson("Code - Prepare Insert Canonical Inbound");
const fromResolver = getNodeJson("Call 'WA_01_Context_Resolver'");
const fromRouter = getNodeJson("Call 'AI Orchestrator - Router Master2️⃣'");
const fromNormalizeSwitch = getNodeJson("Code - Normalize Action For Switch");
const fromAgentDispatcher = getNodeJson("Code - Agent Dispatcher");

const data = {
  ...fromPrepareInbound,
  ...fromRestoreInbound,
  ...fromCanonicalInbound,
  ...fromBuildContext,
  ...fromResolver,
  ...fromRouter,
  ...fromNormalizeSwitch,
  ...fromAgentDispatcher,
  ...current
};

const inputEvent = asObject(data.input_event || current.input_event || fromNormalizeSwitch.input_event || fromRouter.input_event || fromResolver.input_event || fromBuildContext.input_event || {});
const customerContext = asObject(data.customer_context || current.customer_context || fromNormalizeSwitch.customer_context || fromRouter.customer_context || fromResolver.customer_context || fromBuildContext.customer_context || {});
const caseContext = asObject(data.case_context || current.case_context || fromNormalizeSwitch.case_context || fromRouter.case_context || fromResolver.case_context || fromBuildContext.case_context || {});
const conversationContext = asObject(data.conversation_context || current.conversation_context || fromNormalizeSwitch.conversation_context || fromRouter.conversation_context || fromResolver.conversation_context || fromBuildContext.conversation_context || {});
const businessContext = asObject(data.business_context || current.business_context || fromNormalizeSwitch.business_context || fromRouter.business_context || fromResolver.business_context || fromBuildContext.business_context || {});
const classification = asObject(data.classification || current.classification || fromNormalizeSwitch.classification || fromRouter.classification || {});
const decision = asObject(data.decision || current.decision || fromNormalizeSwitch.decision || fromRouter.decision || {});
const caseUpdate = asObject(data.case_update || current.case_update || fromNormalizeSwitch.case_update || fromRouter.case_update || {});
const caseDecision = asObject(data.case_decision || current.case_decision || fromNormalizeSwitch.case_decision || fromRouter.case_decision || {});
const safety = asObject(data.safety || current.safety || fromNormalizeSwitch.safety || fromRouter.safety || {});
const raw = asObject(data.raw || current.raw || fromBuildContext.raw || {});
const originalMessage = asObject(raw.original_message || fromBuildContext.raw?.original_message || fromPrepareInbound || {});

const waId = normalizePhone(
  pickFirst(
    inputEvent.wa_id,
    inputEvent.phone_normalized,
    data.wa_id,
    data.phone_normalized,
    customerContext.phone,
    customerContext.phone_raw,
    caseContext.wa_id,
    raw.wa_id,
    raw.phone_normalized,
    originalMessage.wa_id,
    originalMessage.phone_normalized,
    fromPrepareInbound.wa_id,
    fromPrepareInbound.phone_normalized,
    fromRestoreInbound.wa_id,
    fromRestoreInbound.phone_normalized
  )
);

const phoneNormalized = normalizePhone(
  pickFirst(inputEvent.phone_normalized, data.phone_normalized, customerContext.phone, waId)
);

const providerMessageId = pickFirst(
  inputEvent.provider_message_id,
  data.provider_message_id,
  originalMessage.provider_message_id,
  fromPrepareInbound.provider_message_id,
  fromRestoreInbound.provider_message_id,
  fromCanonicalInbound.input_event?.provider_message_id
);

const contextMessageId = pickFirst(inputEvent.context_message_id, data.context_message_id, originalMessage.context_message_id, fromPrepareInbound.context_message_id, fromRestoreInbound.context_message_id) || null;
const messageText = pickFirst(inputEvent.message_text, data.message_text, data.message?.text, originalMessage.message_text, fromPrepareInbound.message_text, fromRestoreInbound.message_text);
const messageType = pickFirst(inputEvent.message_type, data.message_type, originalMessage.message_type, fromPrepareInbound.message_type, fromRestoreInbound.message_type, "text");
const contactName = pickFirst(inputEvent.contact_name, customerContext.full_name, data.contact_name, raw.contact_name, originalMessage.contact_name, fromPrepareInbound.contact_name, fromRestoreInbound.contact_name);
const phoneNumberId = pickFirst(inputEvent.phone_number_id, data.phone_number_id, raw.phone_number_id, originalMessage.phone_number_id, fromPrepareInbound.phone_number_id, fromRestoreInbound.phone_number_id);
const displayPhoneNumber = pickFirst(inputEvent.display_phone_number, data.display_phone_number, raw.display_phone_number, originalMessage.display_phone_number, fromPrepareInbound.display_phone_number, fromRestoreInbound.display_phone_number);
const receivedAt = pickFirst(inputEvent.received_at, data.received_at, raw.received_at, originalMessage.received_at, fromPrepareInbound.received_at, fromRestoreInbound.received_at, new Date().toISOString());

const idCustomer = pickFirstRaw(caseUpdate.id_customer, caseContext.id_customer, customerContext.id_customer, data.id_customer, originalMessage.id_customer);
const invoiceNumber = pickFirstRaw(caseUpdate.invoice_number, caseContext.invoice_number, customerContext.invoice_number, data.invoice_number, originalMessage.invoice_number);
const idOrder = pickFirstRaw(caseUpdate.id_order, caseContext.id_order, customerContext.last_order_id, data.id_order, originalMessage.id_order);
const sourceTable = pickFirst(caseUpdate.source_table, caseContext.source_table, data.source_table, originalMessage.source_table) || null;
const sourceId = pickFirstRaw(caseUpdate.source_id, caseContext.source_id, data.source_id, originalMessage.source_id);
const serviceCode = pickFirst(caseUpdate.service_code, caseDecision.service_code, caseContext.service_code, data.service_code, "organic_whatsapp");
const department = pickFirst(caseUpdate.department, caseDecision.department, caseContext.department, data.department, "SAC");
const caseTopic = pickFirst(caseUpdate.case_type, caseDecision.case_type, caseContext.case_topic, caseContext.case_type, data.case_type, data.intent, "consulta_general");
const customerKey = pickFirst(customerContext.customer_key, caseContext.customer_key, data.customer_key, idCustomer ? `prestashop:${idCustomer}` : "", waId ? `wa:${waId}` : "");
const caseThreadKey = pickFirst(caseContext.case_thread_key, data.case_thread_key, `thread:${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
const caseScopeKey = pickFirst(caseContext.case_scope_key, caseContext.active_scope_key, data.case_scope_key, data.active_scope_key, `${customerKey}|${serviceCode}|${caseTopic}|${caseThreadKey}`);
const conversationCaseId = pickFirstRaw(caseContext.conversation_case_id, caseContext.case_id, data.conversation_case_id, data.case_id);
const handoffReason = pickFirst(
  data.handoff_reason,
  data.case_update?.handoff_reason,
  data.decision?.handoff_reason,
  data.routing?.handoff_reason,
  data.recommended_action?.reason,
  data.switch_action?.reason,
  "out_of_scope"
);

const adapterDebug = {
  current_has_wa_id: !!waId,
  build_context_has_wa_id: !!normalizePhone(fromBuildContext.input_event?.wa_id || fromBuildContext.wa_id),
  prepare_inbound_has_wa_id: !!normalizePhone(fromPrepareInbound.wa_id),
  restore_inbound_has_wa_id: !!normalizePhone(fromRestoreInbound.wa_id),
  resolver_has_wa_id: !!normalizePhone(fromResolver.input_event?.wa_id || fromResolver.wa_id),
  router_has_wa_id: !!normalizePhone(fromRouter.input_event?.wa_id || fromRouter.wa_id),
  normalize_switch_has_wa_id: !!normalizePhone(fromNormalizeSwitch.input_event?.wa_id || fromNormalizeSwitch.wa_id),
  recovered_wa_id: waId || null,
  recovered_provider_message_id: providerMessageId || null
};

if (!waId || !providerMessageId) {
  return [
    {
      json: {
        ok: false,
        workflow: "WA_00_Webhook_Master",
        node: "Code - Build Handoff Manager Input",
        error: "handoff_adapter_missing_required_fields",
        missing_required_fields: [
          ...(!waId ? ["wa_id"] : []),
          ...(!providerMessageId ? ["provider_message_id"] : [])
        ],
        adapter_debug: adapterDebug,
        current_input: current,
        final_action: "no_action",
        action_type: "no_action",
        switch_action: {
          normalized_action: "no_action",
          send_to_executor: false,
          send_to_handoff: false,
          send_to_tool: false,
          send_to_agent: false,
          close_case: false,
          no_action: true,
          blocked_reason: "handoff_adapter_missing_required_fields"
        }
      }
    }
  ];
}

const handoffInput = {
  handoff_source: {
    source_workflow: "WA_00_Webhook_Master",
    source_node: "Code - Build Handoff Manager Input",
    created_at: new Date().toISOString(),
    contract_version: "0.1.1"
  },
  input_event: {
    ...(inputEvent || {}),
    event_type: pickFirst(inputEvent.event_type, "whatsapp_message"),
    channel: pickFirst(inputEvent.channel, "whatsapp"),
    platform: pickFirst(inputEvent.platform, "meta"),
    wa_id: waId,
    phone_normalized: phoneNormalized || waId,
    phone_number_id: phoneNumberId,
    display_phone_number: displayPhoneNumber,
    contact_name: contactName,
    message_text: messageText,
    message_type: messageType,
    provider_message_id: providerMessageId,
    context_message_id: contextMessageId,
    received_at: receivedAt,
    handoff_reason: handoffReason
  },
  customer_context: {
    ...(customerContext || {}),
    customer_key: customerKey || null,
    id_customer: idCustomer || customerContext.id_customer || null,
    full_name: customerContext.full_name || contactName || null,
    phone: customerContext.phone || phoneNormalized || waId || null,
    phone_raw: customerContext.phone_raw || waId || null,
    invoice_number: customerContext.invoice_number || invoiceNumber || null,
    last_order_id: customerContext.last_order_id || idOrder || null
  },
  case_context: {
    ...(caseContext || {}),
    conversation_case_id: conversationCaseId || null,
    case_id: conversationCaseId || null,
    customer_key: customerKey || null,
    case_scope_key: caseScopeKey || null,
    active_scope_key: caseScopeKey || null,
    case_thread_key: caseThreadKey || null,
    case_topic: caseTopic,
    service_code: serviceCode,
    department,
    source_table: sourceTable,
    source_id: sourceId || null,
    id_order: idOrder || null,
    id_customer: idCustomer || null,
    invoice_number: invoiceNumber || null,
    handoff_reason: handoffReason
  },
  conversation_context: { ...(conversationContext || {}) },
  business_context: { ...(businessContext || {}) },
  classification: { ...(classification || {}) },
  decision: {
    ...(decision || {}),
    action_type: "handoff_to_human",
    requires_human: true,
    allowed_to_auto_reply: false,
    handoff_reason: handoffReason
  },
  case_update: {
    ...(caseUpdate || {}),
    case_action: caseUpdate.case_action || "human_review",
    status: caseUpdate.status || "human_required",
    lifecycle_status: caseUpdate.lifecycle_status || "waiting_human",
    department,
    service_code: serviceCode,
    case_origin_type: caseUpdate.case_origin_type || "organic_whatsapp",
    case_type: caseTopic,
    priority: caseUpdate.priority || "normal",
    source_table: sourceTable,
    source_id: sourceId || null,
    id_order: idOrder || null,
    id_customer: idCustomer || null,
    invoice_number: invoiceNumber || null,
    suppress_mail: true,
    suppress_handoff: true,
    handoff_reason: handoffReason
  },
  safety: {
    ...(safety || {}),
    allowed_to_auto_reply: false,
    suppress_mail: true,
    suppress_handoff: true
  },
  final_action: "handoff_to_human",
  action_type: "handoff_to_human",
  requires_human: true,
  allowed_to_auto_reply: false,
  handoff_reason: handoffReason,
  wa_id: waId,
  phone_normalized: phoneNormalized || waId,
  phone_number_id: phoneNumberId,
  display_phone_number: displayPhoneNumber,
  contact_name: contactName,
  provider_message_id: providerMessageId,
  context_message_id: contextMessageId,
  message_text: messageText,
  message_type: messageType,
  received_at: receivedAt,
  customer_key: customerKey || null,
  conversation_case_id: conversationCaseId || null,
  case_id: conversationCaseId || null,
  case_scope_key: caseScopeKey || null,
  active_scope_key: caseScopeKey || null,
  case_thread_key: caseThreadKey || null,
  case_topic: caseTopic,
  department,
  service_code: serviceCode,
  source_table: sourceTable,
  source_id: sourceId || null,
  id_order: idOrder || null,
  id_customer: idCustomer || null,
  invoice_number: invoiceNumber || null,
  raw_input: data,
  adapter_debug: adapterDebug,
  handoff_contract_version: "0.1.1"
};

return [{ json: handoffInput }];
