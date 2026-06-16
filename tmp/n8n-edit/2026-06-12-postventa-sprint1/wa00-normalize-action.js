const input = $json || {};

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function bool(value, fallback = false) {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

const decision = input.decision || {};
const message = input.message || {};
const caseUpdate = input.case_update || {};
const toolRequest = input.tool_request || {};
const nextSteps = input.next_steps || {};
const safety = input.safety || {};
const routing = input.routing || {};
const recommendedAction = input.recommended_action || {};

const actionTypeRaw = clean(
  decision.action_type ||
  input.action_type ||
  input.final_action ||
  input.action ||
  recommendedAction.action_type ||
  ""
).toLowerCase();

const targetWorkflow = clean(
  nextSteps.target_workflow ||
  input.target_workflow ||
  input.route_to ||
  routing.target_workflow ||
  ""
);

const targetAgent = clean(
  input.target_agent ||
  routing.target_agent ||
  routing.agent ||
  recommendedAction.target_agent ||
  decision.target_agent ||
  ""
);

const messageText = clean(
  message.text ||
  input.message_text ||
  input.response_text ||
  ""
);

const requiresHuman =
  bool(decision.requires_human, false) ||
  bool(input.requires_human, false);

const allowedToAutoReply =
  bool(decision.allowed_to_auto_reply, false) ||
  bool(safety.allowed_to_auto_reply, false) ||
  bool(input.allowed_to_auto_reply, false);

let normalizedAction = "no_action";
let reason = "default_no_action";
let sendToAgent = false;

if (
  actionTypeRaw === "send_to_agent" ||
  actionTypeRaw === "route_to_agent" ||
  actionTypeRaw === "agent_dispatch" ||
  targetAgent.startsWith("AI_AGENT_")
) {
  normalizedAction = "send_to_agent";
  reason = "agent_dispatch_required";
  sendToAgent = true;
}

else if (
  toolRequest.required === true ||
  actionTypeRaw === "tool_request" ||
  targetWorkflow === "OPS_Tool_Dispatcher"
) {
  normalizedAction = "tool_request";
  reason = "tool_request_required";
}

else if (
  actionTypeRaw === "close_case" ||
  actionTypeRaw === "close" ||
  caseUpdate.case_action === "close" ||
  targetWorkflow === "OPS_Case_Closer"
) {
  normalizedAction = "close_case";
  reason = "close_case_requested";
}

else if (
  actionTypeRaw === "handoff_to_human" ||
  actionTypeRaw === "human_review" ||
  actionTypeRaw === "handoff" ||
  requiresHuman === true ||
  targetWorkflow === "OPS_Handoff_Manager"
) {
  normalizedAction = "send_to_handoff";
  reason = "human_required";
}

else if (
  ["reply", "ask_missing_data"].includes(actionTypeRaw) &&
  allowedToAutoReply === true &&
  messageText.length > 0
) {
  normalizedAction = "send_to_executor";
  reason = actionTypeRaw === "ask_missing_data"
    ? "ask_missing_data_allowed"
    : "auto_reply_allowed";
}

else {
  normalizedAction = "no_action";

  if (["reply", "ask_missing_data"].includes(actionTypeRaw) && !messageText) {
    reason = `${actionTypeRaw}_without_message_text`;
  } else if (["reply", "ask_missing_data"].includes(actionTypeRaw) && !allowedToAutoReply) {
    reason = `${actionTypeRaw}_not_allowed_to_auto_reply`;
  } else if (!actionTypeRaw) {
    reason = "missing_action_type";
  } else {
    reason = "unmatched_action_type";
  }
}

return [
  {
    json: {
      ...input,

      switch_action: {
        normalized_action: normalizedAction,

        send_to_agent: sendToAgent,
        send_to_executor: normalizedAction === "send_to_executor",
        send_to_handoff: normalizedAction === "send_to_handoff",
        tool_request: normalizedAction === "tool_request",
        close_case: normalizedAction === "close_case",
        no_action: normalizedAction === "no_action",

        raw_action_type: actionTypeRaw || null,
        target_workflow: targetWorkflow || null,
        target_agent: targetAgent || null,
        reason,
        normalized_at: new Date().toISOString()
      }
    }
  }
];
