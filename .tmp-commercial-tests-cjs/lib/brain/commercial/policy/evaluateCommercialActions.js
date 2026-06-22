"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateCommercialActions = evaluateCommercialActions;
const salesAgentConstants_1 = require("../salesAgentConstants");
const policyUtils_1 = require("./policyUtils");
function isBlockedAction(actionType) {
    return salesAgentConstants_1.SALES_AGENT_BLOCKED_ACTIONS.includes(actionType);
}
function actionRuleId(actionType) {
    if (actionType === "send_whatsapp_message")
        return "POLICY-OUTBOUND-OPTOUT";
    if (actionType === "follow_up")
        return "POLICY-FOLLOWUP-RECENT-REPLY";
    if (actionType === "request_human_review")
        return "POLICY-GOVERNANCE-APPROVAL";
    if (actionType === "request_tool")
        return "POLICY-TOOL-CAPABILITY-ALLOWLIST";
    if (isBlockedAction(actionType))
        return "POLICY-ACTION-HARD-BLOCK";
    return "POLICY-GOVERNANCE-APPROVAL";
}
function evaluateAction(input, actionIndex, seenKeys) {
    const action = input.salesAgentResult.proposedActions[actionIndex];
    const key = (0, policyUtils_1.stableStringifyJson)({
        type: action.type,
        priority: action.priority,
        confidence: action.confidence,
        riskLevel: action.riskLevel,
        requiresApproval: action.requiresApproval,
        reason: action.reason,
        payload: action.payload,
        dependencies: action.dependencies,
        policyTags: action.policyTags,
        expiresAt: action.expiresAt ?? null,
        idempotencyHint: action.idempotencyHint ?? null
    });
    const issues = [];
    const ruleIds = [actionRuleId(action.type)];
    let status = "allowed";
    let decision = "allow";
    let riskLevel = action.riskLevel;
    let approvalRequirement = action.requiresApproval === "blocked" ? "blocked" : "none";
    let duplicateOf = null;
    let hardBlocked = false;
    if (seenKeys.has(key)) {
        duplicateOf = seenKeys.get(key) ?? null;
        issues.push((0, policyUtils_1.buildPolicyIssue)("duplicate_action", "Duplicate proposed action removed.", ["proposedActions", String(actionIndex)], ruleIds[0], { duplicateOf }, "warning"));
        status = "blocked";
        riskLevel = "medium";
        approvalRequirement = "none";
        hardBlocked = true;
        decision = "remove";
    }
    else if (isBlockedAction(action.type)) {
        if (action.type === "create_lead") {
            issues.push((0, policyUtils_1.buildPolicyIssue)("hard_blocked_action", "Action is hard blocked by policy.", ["proposedActions", String(actionIndex)], ruleIds[0], { actionType: action.type }, "fatal"));
            hardBlocked = true;
        }
        else {
            issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Action is blocked by policy and removed from execution.", ["proposedActions", String(actionIndex)], ruleIds[0], { actionType: action.type }, "error"));
        }
        status = "blocked";
        riskLevel = "blocked";
        approvalRequirement = "blocked";
        decision = "remove";
    }
    else if (action.expiresAt && new Date(action.expiresAt).getTime() <= new Date(input.currentTime).getTime()) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("expired_action", "Action expired before policy evaluation.", ["proposedActions", String(actionIndex)], ruleIds[0], { expiresAt: action.expiresAt }, "fatal"));
        status = "blocked";
        riskLevel = "high";
        approvalRequirement = "blocked";
        decision = "remove";
    }
    else if (action.type === "send_whatsapp_message") {
        if (!input.featureFlags.allowOutboundProposals || !input.channelContext.outboundAllowed) {
            issues.push((0, policyUtils_1.buildPolicyIssue)("outbound_blocked", "Outbound proposals are blocked by policy or channel context.", ["proposedActions", String(actionIndex)], ruleIds[0], { actionType: action.type }, "error"));
            status = "blocked";
            riskLevel = "blocked";
            approvalRequirement = "blocked";
            decision = "remove";
        }
        else if (input.channelContext.optOut || input.channelContext.aiBlocked || input.channelContext.identityConflict) {
            const code = input.channelContext.optOut ? "opt_out_active" : input.channelContext.aiBlocked ? "ai_blocked" : "identity_conflict";
            issues.push((0, policyUtils_1.buildPolicyIssue)(code, "Outbound proposal is blocked by channel policy.", ["proposedActions", String(actionIndex)], ruleIds[0], { actionType: action.type }, "fatal"));
            status = "blocked";
            riskLevel = "blocked";
            approvalRequirement = "blocked";
            decision = "remove";
        }
        else {
            status = "review";
            riskLevel = "high";
            approvalRequirement = "explicit_operator_approval";
            decision = "allow_with_approval";
            issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Outbound message proposal requires explicit approval.", ["proposedActions", String(actionIndex)], ruleIds[0], { actionType: action.type }, "info"));
        }
    }
    else if (action.type === "draft_response") {
        if (!input.featureFlags.allowDraftReplies) {
            issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Draft responses are disabled by policy flags.", ["proposedActions", String(actionIndex)], ruleIds[0], { actionType: action.type }, "warning"));
            status = "review";
            riskLevel = "medium";
            approvalRequirement = "operator_review";
            decision = "downgrade_to_review";
        }
        else {
            decision = "allow";
        }
    }
    else if (action.type === "request_tool") {
        if (!input.featureFlags.allowToolRequests) {
            issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Tool requests are disabled by policy flags.", ["proposedActions", String(actionIndex)], ruleIds[0], { actionType: action.type }, "warning"));
            status = "review";
            riskLevel = "medium";
            approvalRequirement = "operator_review";
            decision = "downgrade_to_review";
        }
        else {
            status = "review";
            riskLevel = "medium";
            approvalRequirement = "operator_review";
            decision = "allow_with_approval";
        }
    }
    else if (action.type === "request_human_review") {
        if (!input.featureFlags.allowOperatorReviewRequests) {
            issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Human review requests are disabled by policy flags.", ["proposedActions", String(actionIndex)], ruleIds[0], { actionType: action.type }, "warning"));
            status = "review";
            riskLevel = "medium";
            approvalRequirement = "operator_review";
            decision = "downgrade_to_review";
        }
        else {
            status = "review";
            riskLevel = "medium";
            approvalRequirement = "operator_review";
            decision = "allow_with_approval";
        }
    }
    else if (action.type === "follow_up") {
        if (!input.featureFlags.allowFollowUpEvaluation) {
            issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Follow-up evaluation is disabled by policy flags.", ["proposedActions", String(actionIndex)], ruleIds[0], { actionType: action.type }, "warning"));
            status = "review";
            riskLevel = "medium";
            approvalRequirement = "operator_review";
            decision = "downgrade_to_review";
        }
        else if (input.channelContext.optOut || input.channelContext.aiBlocked || input.channelContext.identityConflict || input.channelContext.humanOwnerActive || input.channelContext.recentCustomerReply) {
            const code = input.channelContext.optOut
                ? "opt_out_active"
                : input.channelContext.aiBlocked
                    ? "ai_blocked"
                    : input.channelContext.identityConflict
                        ? "identity_conflict"
                        : input.channelContext.humanOwnerActive
                            ? "human_owner_active"
                            : "recent_customer_reply";
            issues.push((0, policyUtils_1.buildPolicyIssue)(code, "Follow-up is blocked by channel policy.", ["proposedActions", String(actionIndex)], ruleIds[0], { actionType: action.type }, "error"));
            status = "blocked";
            riskLevel = "blocked";
            approvalRequirement = "blocked";
            decision = "remove";
        }
        else {
            status = "review";
            riskLevel = "medium";
            approvalRequirement = "operator_review";
            decision = "allow_with_approval";
            issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Follow-up proposal requires operator review.", ["proposedActions", String(actionIndex)], ruleIds[0], { actionType: action.type }, "info"));
        }
    }
    else if (action.type === "no_action") {
        decision = "allow";
    }
    else {
        decision = "allow";
    }
    if ((0, policyUtils_1.hasSensitiveBlockedText)(action.reason) || (0, policyUtils_1.hasSensitiveBlockedText)(action.type)) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Action text claims execution or completion and requires review.", ["proposedActions", String(actionIndex)], ruleIds[0], { actionType: action.type }, "warning"));
        if (status === "allowed") {
            status = "review";
        }
        approvalRequirement = (0, policyUtils_1.maxApproval)(approvalRequirement, "operator_review");
        decision = decision === "allow" ? "allow_with_approval" : decision;
        riskLevel = (0, policyUtils_1.maxRisk)(riskLevel, "medium");
    }
    if (!seenKeys.has(key) && decision !== "remove") {
        seenKeys.set(key, actionIndex);
    }
    return {
        index: actionIndex,
        action,
        status,
        decision,
        approvalRequirement,
        riskLevel,
        ruleIds: (0, policyUtils_1.uniqueRuleIds)(ruleIds),
        issues,
        reason: issues[0]?.message ?? "Action complies with policy.",
        duplicateOf,
        hardBlocked
    };
}
function evaluateCommercialActions(input) {
    const assessments = [];
    const keptActions = [];
    const blockedActions = [];
    const issues = [];
    const seenKeys = new Map();
    for (let index = 0; index < input.salesAgentResult.proposedActions.length; index += 1) {
        const assessment = evaluateAction(input, index, seenKeys);
        assessments.push(assessment);
        issues.push(...assessment.issues);
        if (assessment.status === "blocked") {
            blockedActions.push(assessment.action);
        }
        else {
            keptActions.push(assessment.action);
        }
    }
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
        keptActions,
        blockedActions,
        assessments,
        issues,
        warnings,
        appliedRules: [...appliedRules],
        riskLevel,
        requiresApproval
    };
}
