"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateCommercialEntityProposals = evaluateCommercialEntityProposals;
const salesAgentConstants_1 = require("../salesAgentConstants");
const policyConstants_1 = require("./policyConstants");
const policyUtils_1 = require("./policyUtils");
function allowedKeysForEntityType(entityType) {
    return entityType === "lead" ? salesAgentConstants_1.SALES_AGENT_ALLOWED_LEAD_PROPOSED_CHANGE_KEYS : salesAgentConstants_1.SALES_AGENT_ALLOWED_OPPORTUNITY_PROPOSED_CHANGE_KEYS;
}
function proposalRuleId(entityType) {
    return entityType === "lead" ? "POLICY-GOVERNANCE-APPROVAL" : "POLICY-ENTITY-TERMINAL-STATE";
}
function hasStrongEvidence(input, proposalIndex) {
    const proposal = input.salesAgentResult.entityProposals[proposalIndex];
    return proposal.evidence.some((evidence) => {
        return (evidence.verified &&
            (evidence.source === "tool_result" ||
                evidence.source === "operator_input" ||
                evidence.source === "policy_context" ||
                evidence.source === "order_context" ||
                evidence.source === "product_service_context"));
    });
}
function isCustomerMasterMutation(proposedChanges) {
    return Object.keys(proposedChanges).some((key) => /customer.*master|customer_key|identity|merge|master_id/i.test(key));
}
function evaluateEntityProposal(input, index) {
    const entityProposal = input.salesAgentResult.entityProposals[index];
    const issues = [];
    const ruleIds = [proposalRuleId(entityProposal.entityType)];
    const allowedKeys = new Set([...allowedKeysForEntityType(entityProposal.entityType)]);
    const proposedChangeKeys = Object.keys(entityProposal.proposedChanges);
    const invalidKeys = proposedChangeKeys.filter((key) => !allowedKeys.has(key));
    const terminalTransition = (0, policyUtils_1.isTerminalOpportunityStatus)(entityProposal.proposedChanges.status) ||
        (typeof entityProposal.proposedChanges.status === "string" && policyConstants_1.COMMERCIAL_POLICY_TERMINAL_OPPORTUNITY_STATUSES.includes(entityProposal.proposedChanges.status));
    const customerMasterMutation = isCustomerMasterMutation(entityProposal.proposedChanges);
    const highImpact = proposedChangeKeys.some((key) => policyConstants_1.COMMERCIAL_POLICY_HIGH_IMPACT_ENTITY_FIELDS.includes(key));
    const strongEvidence = hasStrongEvidence(input, index);
    let status = "allowed";
    let decision = "allow";
    let approvalRequirement = highImpact ? "operator_review" : "none";
    let riskLevel = highImpact ? "medium" : "low";
    if (!input.featureFlags.allowEntityProposals) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Entity proposals are disabled by policy flags.", ["entityProposals", String(index)], ruleIds[0], { entityType: entityProposal.entityType }, "warning"));
        status = "review";
        approvalRequirement = "operator_review";
        riskLevel = "medium";
        decision = "downgrade_to_review";
    }
    else if (customerMasterMutation) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("customer_master_mutation_blocked", "Entity proposal attempts to mutate customer master-like identifiers.", ["entityProposals", String(index)], ruleIds[0], { entityType: entityProposal.entityType }, "fatal"));
        status = "blocked";
        approvalRequirement = "blocked";
        riskLevel = "blocked";
        decision = "remove";
    }
    else if (invalidKeys.length > 0) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("invalid_entity_proposal", "Entity proposal contains fields outside the approved contract.", ["entityProposals", String(index)], ruleIds[0], { invalidKeys }, "error"));
        status = "blocked";
        approvalRequirement = "blocked";
        riskLevel = "blocked";
        decision = "remove";
    }
    else if (terminalTransition && !strongEvidence) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("terminal_transition_requires_evidence", "Terminal transition requires authorized evidence.", ["entityProposals", String(index)], ruleIds[0], { entityType: entityProposal.entityType }, "fatal"));
        status = "blocked";
        approvalRequirement = "blocked";
        riskLevel = "blocked";
        decision = "remove";
    }
    else if (terminalTransition && strongEvidence) {
        status = "review";
        approvalRequirement = "explicit_operator_approval";
        riskLevel = "high";
        decision = "allow_with_approval";
        issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Terminal transition requires explicit approval.", ["entityProposals", String(index)], ruleIds[0], { entityType: entityProposal.entityType }, "info"));
    }
    else if (highImpact) {
        status = "review";
        approvalRequirement = "operator_review";
        riskLevel = "medium";
        decision = "allow_with_approval";
        issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "High-impact entity proposal requires operator review.", ["entityProposals", String(index)], ruleIds[0], { entityType: entityProposal.entityType }, "info"));
    }
    else {
        decision = "allow";
    }
    if (entityProposal.requiresApproval === "blocked") {
        status = "blocked";
        approvalRequirement = "blocked";
        riskLevel = "blocked";
        decision = "remove";
    }
    else if (entityProposal.requiresApproval === "operator_review" && status === "allowed") {
        status = "review";
        approvalRequirement = "operator_review";
        riskLevel = (0, policyUtils_1.maxRisk)(riskLevel, "medium");
        decision = "allow_with_approval";
    }
    if (entityProposal.entityType === "opportunity" && typeof entityProposal.proposedChanges.status === "string") {
        if (policyConstants_1.COMMERCIAL_POLICY_TERMINAL_OPPORTUNITY_STATUSES.includes(entityProposal.proposedChanges.status) && !strongEvidence) {
            status = "blocked";
            approvalRequirement = "blocked";
            riskLevel = "blocked";
            decision = "remove";
        }
    }
    return {
        index,
        entityProposal,
        status,
        decision,
        approvalRequirement,
        riskLevel,
        ruleIds: (0, policyUtils_1.uniqueRuleIds)(ruleIds),
        issues,
        reason: issues[0]?.message ?? "Entity proposal complies with policy.",
        terminalTransition,
        customerMasterMutation
    };
}
function evaluateCommercialEntityProposals(input) {
    const assessments = input.salesAgentResult.entityProposals.map((_, index) => evaluateEntityProposal(input, index));
    const blockedEntityProposals = assessments.filter((assessment) => assessment.status === "blocked").map((assessment) => assessment.entityProposal);
    const keptEntityProposals = assessments.filter((assessment) => assessment.status !== "blocked").map((assessment) => assessment.entityProposal);
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
        keptEntityProposals,
        blockedEntityProposals,
        assessments,
        issues,
        warnings,
        appliedRules: [...appliedRules],
        riskLevel,
        requiresApproval
    };
}
