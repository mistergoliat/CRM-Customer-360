function getNodeJson(nodeName) {
  try {
    return $(nodeName).item.json || {};
  } catch (e) {
    return {};
  }
}

function isNonEmptyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function pickFirst(...values) {
  for (const value of values) {
    const v = clean(value);
    if (v) return v;
  }
  return "";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const fromPrepareRun = getNodeJson("Code - Prepare n8n_agent_runs Insert");
const fromValidate = getNodeJson("Code - Validate Output");
const fromParse = getNodeJson("Code - Parse DeepSeek JSON");

const item =
  isNonEmptyObject(fromPrepareRun)
    ? fromPrepareRun
    : isNonEmptyObject(fromValidate)
      ? fromValidate
      : isNonEmptyObject(fromParse)
        ? fromParse
        : ($json || {});

const normalizedInput = asObject(
  item.normalized_input ||
  item.raw_model_output?.normalized_input ||
  item.raw_input ||
  {}
);

const inputEvent = asObject(normalizedInput.input_event);
const customerContext = asObject(normalizedInput.customer_context);
const caseContext = asObject(normalizedInput.case_context);
const serviceContext = asObject(normalizedInput.service_context);
const businessContext = asObject(normalizedInput.business_context);
const conversationContext = asObject(normalizedInput.conversation_context);
const resolverMeta = asObject(normalizedInput.resolver_meta);

const handoffReason = pickFirst(
  item.handoff_reason,
  item.routing?.handoff_reason,
  item.case_update?.handoff_reason,
  item.recommended_action?.reason,
  item.safety?.blocked_reason,
  null
);

const finalOutput = {
  ...item,
  handoff_reason: handoffReason || null,

  input_event: {
    ...inputEvent,
    wa_id: pickFirst(
      inputEvent.wa_id,
      inputEvent.phone_normalized,
      customerContext.phone,
      customerContext.phone_normalized,
      caseContext.wa_id
    ),
    phone_normalized: pickFirst(
      inputEvent.phone_normalized,
      inputEvent.wa_id,
      customerContext.phone_normalized,
      customerContext.phone,
      caseContext.wa_id
    ),
    phone_number_id: pickFirst(
      inputEvent.phone_number_id,
      caseContext.phone_number_id,
      serviceContext.phone_number_id,
      businessContext.phone_number_id
    ) || null,
    contact_name: pickFirst(
      inputEvent.contact_name,
      customerContext.full_name,
      customerContext.name,
      caseContext.contact_name
    ),
    provider_message_id: pickFirst(
      inputEvent.provider_message_id,
      inputEvent.message_id,
      inputEvent.id
    ),
    context_message_id: pickFirst(inputEvent.context_message_id),
    message_type: pickFirst(inputEvent.message_type, "text"),
    message_text: pickFirst(inputEvent.message_text, inputEvent.text),
    received_at: pickFirst(inputEvent.received_at),
    timestamp: pickFirst(inputEvent.timestamp),
    conversation_message_id: inputEvent.conversation_message_id ?? null
  },

  customer_context: customerContext,
  case_context: caseContext,
  service_context: serviceContext,
  business_context: businessContext,
  conversation_context: conversationContext,
  resolver_meta: resolverMeta
};

return [{ json: finalOutput }];
