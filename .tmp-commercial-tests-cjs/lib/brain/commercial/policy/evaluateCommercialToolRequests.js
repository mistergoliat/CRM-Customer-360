"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateCommercialToolRequests = evaluateCommercialToolRequests;
const salesAgentConstants_1 = require("../salesAgentConstants");
const policyUtils_1 = require("./policyUtils");
function toolRuleId(toolName) {
    if (toolName === "searchKnowledge" || toolName === "getStaticBusinessInfo" || toolName === "getKnowledgePolicy") {
        return "POLICY-TOOL-CAPABILITY-ALLOWLIST";
    }
    if (toolName === "getConversationHistory")
        return "POLICY-TOOL-CAPABILITY-ALLOWLIST";
    if (toolName === "getActiveCase")
        return "POLICY-TOOL-CAPABILITY-ALLOWLIST";
    if (toolName === "searchProducts")
        return "POLICY-TOOL-CAPABILITY-ALLOWLIST";
    if (toolName === "getProductStock")
        return "POLICY-TOOL-CAPABILITY-ALLOWLIST";
    if (toolName === "getOrderByInvoice")
        return "POLICY-TOOL-CAPABILITY-ALLOWLIST";
    return "POLICY-GOVERNANCE-APPROVAL";
}
function isToolAllowed(toolName, allowedCapabilities) {
    return salesAgentConstants_1.SALES_AGENT_TOOL_NAMES.includes(toolName) && allowedCapabilities.includes(toolName);
}
function evaluateToolRequest(input, index) {
    const toolRequest = input.salesAgentResult.toolRequests[index];
    const issues = [];
    const ruleIds = [toolRuleId(toolRequest.tool)];
    const allowed = isToolAllowed(toolRequest.tool, input.allowedCapabilities);
    const executionClaimed = (0, policyUtils_1.hasSensitiveBlockedText)(toolRequest.purpose) || (0, policyUtils_1.hasSensitiveBlockedText)(toolRequest.reason);
    const needsApproval = toolRequest.blocking || toolRequest.status === "blocked" || toolRequest.status === "planned";
    let status = "allowed";
    let decision = "allow";
    let approvalRequirement = needsApproval ? "operator_review" : "none";
    let riskLevel = toolRequest.blocking ? "high" : "low";
    let unavailable = false;
    if (!allowed) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("tool_not_allowed", "Tool request is not allowed by the current capability allowlist.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "error"));
        status = "blocked";
        approvalRequirement = "blocked";
        riskLevel = "blocked";
        unavailable = true;
        decision = "remove";
    }
    else if (toolRequest.status === "blocked") {
        issues.push((0, policyUtils_1.buildPolicyIssue)("tool_unavailable", "Tool request is already blocked by the model output.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "warning"));
        status = "blocked";
        approvalRequirement = "blocked";
        riskLevel = "high";
        unavailable = true;
        decision = "remove";
    }
    else if (executionClaimed) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("tool_execution_claimed", "Tool request appears to claim execution or completion.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "fatal"));
        status = "blocked";
        approvalRequirement = "blocked";
        riskLevel = "blocked";
        unavailable = true;
        decision = "remove";
    }
    else if (toolRequest.blocking && !input.featureFlags.allowToolRequests) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("tool_unavailable", "Blocking tool requests are disabled by policy flags.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "error"));
        status = "blocked";
        approvalRequirement = "blocked";
        riskLevel = "high";
        unavailable = true;
        decision = "remove";
    }
    else if (toolRequest.blocking) {
        status = "review";
        approvalRequirement = "operator_review";
        riskLevel = "high";
        decision = "allow_with_approval";
        issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Blocking tool request requires operator review.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "info"));
    }
    else if (!input.featureFlags.allowToolRequests) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Tool requests are disabled by policy flags.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "warning"));
        status = "review";
        approvalRequirement = "operator_review";
        riskLevel = "medium";
        decision = "downgrade_to_review";
    }
    else {
        status = "allowed";
        approvalRequirement = "none";
        riskLevel = "low";
        decision = "allow";
    }
    if (toolRequest.optionalInputs && (0, policyUtils_1.hasSensitiveBlockedText)(JSON.stringify(toolRequest.optionalInputs))) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("tool_execution_claimed", "Tool request optional inputs contain execution-like claims.", ["toolRequests", String(index)], ruleIds[0], { tool: toolRequest.tool }, "warning"));
        if (status === "allowed") {
            status = "review";
        }
        approvalRequirement = (0, policyUtils_1.maxApproval)(approvalRequirement, "operator_review");
        riskLevel = (0, policyUtils_1.maxRisk)(riskLevel, "medium");
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
        ruleIds: (0, policyUtils_1.uniqueRuleIds)(ruleIds),
        issues,
        reason: issues[0]?.message ?? "Tool request complies with policy.",
        unavailable
    };
}
function evaluateCommercialToolRequests(input) {
    const assessments = input.salesAgentResult.toolRequests.map((_, index) => evaluateToolRequest(input, index));
    const blockedToolRequests = assessments.filter((assessment) => assessment.status === "blocked").map((assessment) => assessment.toolRequest);
    const keptToolRequests = assessments.filter((assessment) => assessment.status !== "blocked").map((assessment) => assessment.toolRequest);
    const issues = assessments.flatMap((assessment) => assessment.issues);
    const warnings = (0, policyUtils_1.uniqueStrings)(issues.filter((issue) => issue.level === "warning").map((issue) => issue.code));
    let riskLevel = "low";
    let requiresApproval = "none";
    const appliedRules = new Set();
    for (const assessment of assessments) {
        riskLevel = (0, policyUtils_1.maxRisk)(riskLevel, assessment.riskLevel);
        requiresApproval = (0, policyUtils_1.maxApproval)(requiresApproval, assessment.approvalRequirement);
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
