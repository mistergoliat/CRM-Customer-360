import { SALES_AGENT_TOOL_NAMES } from "../salesAgentConstants";
import type {
  CommercialPolicyApprovalRequirement,
  CommercialPolicyDecision,
  CommercialPolicyInput,
  CommercialPolicyIssue,
  CommercialPolicyRiskLevel,
  CommercialPolicyRuleId,
  CommercialPolicyToolRequestAssessment,
  CommercialPolicyToolRequestsEvaluationResult
} from "./policyTypes";
import { buildPolicyIssue, hasSensitiveBlockedText, maxApproval, maxRisk, uniqueRuleIds, uniqueStrings } from "./policyUtils";

function toolRuleId(toolName: string): CommercialPolicyRuleId {
  if (toolName === "searchKnowledge" || toolName === "getStaticBusinessInfo" || toolName === "getKnowledgePolicy") {
    return "POLICY-TOOL-CAPABILITY-ALLOWLIST";
  }
  if (toolName === "getConversationHistory") return "POLICY-TOOL-CAPABILITY-ALLOWLIST";
  if (toolName === "getActiveCase") return "POLICY-TOOL-CAPABILITY-ALLOWLIST";
  if (toolName === "searchProducts") return "POLICY-TOOL-CAPABILITY-ALLOWLIST";
  if (toolName === "getProductStock") return "POLICY-TOOL-CAPABILITY-ALLOWLIST";
  if (toolName === "getOrderByInvoice") return "POLICY-TOOL-CAPABILITY-ALLOWLIST";
  return "POLICY-GOVERNANCE-APPROVAL";
}

function isToolAllowed(toolName: string, allowedCapabilities: readonly string[]) {
  return SALES_AGENT_TOOL_NAMES.includes(toolName as never) && allowedCapabilities.includes(toolName);
}

function evaluateToolRequest(input: CommercialPolicyInput, index: number): CommercialPolicyToolRequestAssessment {
  const toolRequest = input.salesAgentResult.toolRequests[index];
  const issues: CommercialPolicyIssue[] = [];
  const ruleIds: CommercialPolicyRuleId[] = [toolRuleId(toolRequest.tool)];
  const allowed = isToolAllowed(toolRequest.tool, input.allowedCapabilities);
  const executionClaimed = hasSensitiveBlockedText(toolRequest.purpose) || hasSensitiveBlockedText(toolRequest.reason);
  const needsApproval = toolRequest.blocking || toolRequest.status === "blocked" || toolRequest.status === "planned";

  let status: CommercialPolicyToolRequestAssessment["status"] = "allowed";
  let decision: CommercialPolicyDecision = "allow";
  let approvalRequirement: CommercialPolicyApprovalRequirement = needsApproval ? "operator_review" : "none";
  let riskLevel: CommercialPolicyRiskLevel = toolRequest.blocking ? "high" : "low";
  let unavailable = false;

  if (!allowed) {
    issues.push(
      buildPolicyIssue("tool_not_allowed", "Tool request is not allowed by the current capability allowlist.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "error")
    );
    status = "blocked";
    approvalRequirement = "blocked";
    riskLevel = "blocked";
    unavailable = true;
    decision = "remove";
  } else if (toolRequest.status === "blocked") {
    issues.push(
      buildPolicyIssue("tool_unavailable", "Tool request is already blocked by the model output.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "warning")
    );
    status = "blocked";
    approvalRequirement = "blocked";
    riskLevel = "high";
    unavailable = true;
    decision = "remove";
  } else if (executionClaimed) {
    issues.push(
      buildPolicyIssue("tool_execution_claimed", "Tool request appears to claim execution or completion.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "fatal")
    );
    status = "blocked";
    approvalRequirement = "blocked";
    riskLevel = "blocked";
    unavailable = true;
    decision = "remove";
  } else if (toolRequest.blocking && !input.featureFlags.allowToolRequests) {
    issues.push(
      buildPolicyIssue("tool_unavailable", "Blocking tool requests are disabled by policy flags.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "error")
    );
    status = "blocked";
    approvalRequirement = "blocked";
    riskLevel = "high";
    unavailable = true;
    decision = "remove";
  } else if (toolRequest.blocking) {
    status = "review";
    approvalRequirement = "operator_review";
    riskLevel = "high";
    decision = "allow_with_approval";
    issues.push(
      buildPolicyIssue("action_requires_approval", "Blocking tool request requires operator review.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "info")
    );
  } else if (!input.featureFlags.allowToolRequests) {
    issues.push(
      buildPolicyIssue("action_requires_approval", "Tool requests are disabled by policy flags.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "warning")
    );
    status = "review";
    approvalRequirement = "operator_review";
    riskLevel = "medium";
    decision = "downgrade_to_review";
  } else {
    status = "allowed";
    approvalRequirement = "none";
    riskLevel = "low";
    decision = "allow";
  }

  if (toolRequest.optionalInputs && hasSensitiveBlockedText(JSON.stringify(toolRequest.optionalInputs))) {
    issues.push(
      buildPolicyIssue("tool_execution_claimed", "Tool request optional inputs contain execution-like claims.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "warning")
    );
    if (status === "allowed") {
      status = "review";
    }
    approvalRequirement = maxApproval(approvalRequirement, "operator_review");
    riskLevel = maxRisk(riskLevel, "medium");
    if (decision === "allow") {
      decision = "allow_with_approval";
    }
  }

  return {
    index,
    toolRequest,
    status,
    decision,
    approvalRequirement,
    riskLevel,
    ruleIds: uniqueRuleIds(ruleIds),
    issues,
    reason: issues[0]?.message ?? "Tool request complies with policy.",
    unavailable
  };
}

export function evaluateCommercialToolRequests(input: CommercialPolicyInput): CommercialPolicyToolRequestsEvaluationResult {
  const assessments = input.salesAgentResult.toolRequests.map((_, index) => evaluateToolRequest(input, index));
  const blockedToolRequests = assessments.filter((assessment) => assessment.status === "blocked").map((assessment) => assessment.toolRequest);
  const keptToolRequests = assessments.filter((assessment) => assessment.status !== "blocked").map((assessment) => assessment.toolRequest);
  const issues = assessments.flatMap((assessment) => assessment.issues);
  const warnings = uniqueStrings(issues.filter((issue) => issue.level === "warning").map((issue) => issue.code));

  let riskLevel: CommercialPolicyRiskLevel = "low";
  let requiresApproval: CommercialPolicyApprovalRequirement = "none";
  const appliedRules = new Set<CommercialPolicyRuleId>();

  for (const assessment of assessments) {
    riskLevel = maxRisk(riskLevel, assessment.riskLevel);
    requiresApproval = maxApproval(requiresApproval, assessment.approvalRequirement);
    for (const ruleId of assessment.ruleIds) {
      appliedRules.add(ruleId);
    }
  }

  return {
    keptToolRequests,
    blockedToolRequests,
    assessments,
    issues,
    warnings,
    appliedRules: [...appliedRules],
    riskLevel,
    requiresApproval
  };
}
