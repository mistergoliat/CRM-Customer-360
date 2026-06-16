const data = $json || {};

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

function pickFirstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

const standardMessage = "Tu solicitud será procesada por un ejecutivo durante los siguientes horarios: 9:00 a 17:00 de lunes a viernes, gracias.";

const handoffReason = pickFirst(
  data.handoff_reason,
  data.handoff_guard?.reason,
  data.case_update?.handoff_reason,
  data.decision?.handoff_reason,
  data.internal_notification_policy?.reason,
  "out_of_scope"
);

const decision = asObject(data.decision);
const caseUpdate = asObject(data.case_update);
const inputEvent = asObject(data.input_event);
const customerContext = asObject(data.customer_context);
const serviceContext = asObject(data.service_context);
const businessContext = asObject(data.business_context);
const caseContext = asObject(data.case_context);
const conversationContext = asObject(data.conversation_context);
const notificationPolicy = asObject(data.internal_notification_policy);

const waId = pickFirst(
  data.wa_id,
  inputEvent.wa_id,
  inputEvent.phone_normalized,
  customerContext.phone,
  customerContext.phone_normalized,
  caseContext.wa_id
);

const phoneNumberId = pickFirst(
  data.phone_number_id,
  inputEvent.phone_number_id,
  caseContext.phone_number_id,
  serviceContext.phone_number_id,
  businessContext.phone_number_id,
  "1030337916832905"
);

const department = pickFirst(
  caseUpdate.department,
  data.handoff_guard?.handoff_department,
  inputEvent.department,
  "SAC"
);

const serviceCode = pickFirst(
  caseUpdate.service_code,
  data.final_case?.service_code,
  inputEvent.service_code,
  "organic_whatsapp"
);

const caseOriginType = pickFirst(
  caseUpdate.case_origin_type,
  data.final_case?.case_origin_type,
  inputEvent.case_origin_type,
  serviceCode
);

const conversationCaseId = pickFirstNumber(
  caseUpdate.conversation_case_id,
  caseContext.case_id,
  caseContext.conversation_case_id,
  data.final_case?.id,
  data.final_case?.conversation_case_id
);

const nextSteps = {
  ...(data.next_steps || {}),
  target_workflow: "OPS_Response_Executor",
  handoff_department: department
};

return [
  {
    json: {
      handoff_manager: {
        name: "OPS_Handoff_Manager",
        version: "0.7.0",
        mode: "real"
      },
      result: {
        success: true,
        case_id: conversationCaseId || null,
        notified: notificationPolicy.should_notify === true,
        internal_notification_sent: notificationPolicy.should_notify === true,
        internal_notification_reason: notificationPolicy.reason || null,
        customer_message_text: standardMessage,
        handoff_reason: handoffReason
      },
      handoff_reason: handoffReason,
      decision: {
        ...decision,
        action_type: "reply",
        requires_human: false,
        allowed_to_auto_reply: true,
        handoff_reason: handoffReason
      },
      message: {
        channel: "whatsapp",
        text: standardMessage,
        template_required: false
      },
      case_update: {
        ...caseUpdate,
        department,
        service_code: serviceCode,
        case_origin_type: caseOriginType,
        status: "human_required",
        handoff_reason: handoffReason
      },
      next_steps: nextSteps,
      safety: {
        ...(data.safety || {}),
        blocked: false,
        allowed_to_auto_reply: true,
        suppress_mail: true,
        suppress_handoff: true
      },
      input_event: {
        ...inputEvent,
        wa_id: waId,
        phone_normalized: waId,
        phone_number_id: phoneNumberId
      },
      customer_context: data.customer_context || {},
      service_context: data.service_context || {},
      business_context: data.business_context || {},
      case_context: data.case_context || {},
      conversation_context: conversationContext,
      raw_input: data.raw_input || data
    }
  }
];
