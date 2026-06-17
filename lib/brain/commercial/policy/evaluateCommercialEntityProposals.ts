import {
  SALES_AGENT_ALLOWED_LEAD_PROPOSED_CHANGE_KEYS,
  SALES_AGENT_ALLOWED_OPPORTUNITY_PROPOSED_CHANGE_KEYS
} from "../salesAgentConstants";
import type {
  CommercialPolicyApprovalRequirement,
  CommercialPolicyDecision,
  CommercialPolicyEntityProposalAssessment,
  CommercialPolicyEntityProposalsEvaluationResult,
  CommercialPolicyInput,
  CommercialPolicyIssue,
  CommercialPolicyRiskLevel,
  CommercialPolicyRuleId
} from "./policyTypes";
import {
  COMMERCIAL_POLICY_HIGH_IMPACT_ENTITY_FIELDS,
  COMMERCIAL_POLICY_TERMINAL_OPPORTUNITY_STATUSES
} from "./policyConstants";
import {
  buildPolicyIssue,
  isTerminalOpportunityStatus,
  maxApproval,
  maxRisk,
  uniqueStrings,
  uniqueRuleIds
} from "./policyUtils";

function allowedKeysForEntityType(entityType: "lead" | "opportunity") {
  return entityType === "lead" ? SALES_AGENT_ALLOWED_LEAD_PROPOSED_CHANGE_KEYS : SALES_AGENT_ALLOWED_OPPORTUNITY_PROPOSED_CHANGE_KEYS;
}

function proposalRuleId(entityType: "lead" | "opportunity") {
  return entityType === "lead" ? "POLICY-GOVERNANCE-APPROVAL" : "POLICY-ENTITY-TERMINAL-STATE";
}

function hasStrongEvidence(input: CommercialPolicyInput, proposalIndex: number) {
  const proposal = input.salesAgentResult.entityProposals[proposalIndex];
  return proposal.evidence.some((evidence) => {
    return (
      evidence.verified &&
      (evidence.source === "tool_result" ||
        evidence.source === "operator_input" ||
        evidence.source === "policy_context" ||
        evidence.source === "order_context" ||
        evidence.source === "product_service_context")
    );
  });
}

function isCustomerMasterMutation(proposedChanges: Record<string, unknown>) {
  return Object.keys(proposedChanges).some((key) => /customer.*master|customer_key|identity|merge|master_id/i.test(key));
}

function evaluateEntityProposal(input: CommercialPolicyInput, index: number): CommercialPolicyEntityProposalAssessment {
  const entityProposal = input.salesAgentResult.entityProposals[index];
  const issues: CommercialPolicyIssue[] = [];
  const ruleIds: CommercialPolicyRuleId[] = [proposalRuleId(entityProposal.entityType)];
  const allowedKeys = new Set<string>([...allowedKeysForEntityType(entityProposal.entityType)]);
  const proposedChangeKeys = Object.keys(entityProposal.proposedChanges);
  const invalidKeys = proposedChangeKeys.filter((key) => !allowedKeys.has(key));
  const terminalTransition =
    isTerminalOpportunityStatus(entityProposal.proposedChanges.status) ||
    (typeof entityProposal.proposedChanges.status === "string" && COMMERCIAL_POLICY_TERMINAL_OPPORTUNITY_STATUSES.includes(entityProposal.proposedChanges.status as never));
  const customerMasterMutation = isCustomerMasterMutation(entityProposal.proposedChanges);
  const highImpact = proposedChangeKeys.some((key) => COMMERCIAL_POLICY_HIGH_IMPACT_ENTITY_FIELDS.includes(key as never));
  const strongEvidence = hasStrongEvidence(input, index);

  let status: CommercialPolicyEntityProposalAssessment["status"] = "allowed";
  let decision: CommercialPolicyDecision = "allow";
  let approvalRequirement: CommercialPolicyApprovalRequirement = highImpact ? "operator_review" : "none";
  let riskLevel: CommercialPolicyRiskLevel = highImpact ? "medium" : "low";

  if (!input.featureFlags.allowEntityProposals) {
    issues.push(
      buildPolicyIssue("action_requires_approval", "Entity proposals are disabled by policy flags.", ["entityProposals", String(index)], ruleIds[0], { entityType: entityProposal.entityType }, "warning")
    );
    status = "review";
    approvalRequirement = "operator_review";
    riskLevel = "medium";
    decision = "downgrade_to_review";
  } else if (customerMasterMutation) {
    issues.push(
      buildPolicyIssue("customer_master_mutation_blocked", "Entity proposal attempts to mutate customer master-like identifiers.", ["entityProposals", String(index)], ruleIds[0], { entityType: entityProposal.entityType }, "fatal")
    );
    status = "blocked";
    approvalRequirement = "blocked";
    riskLevel = "blocked";
    decision = "remove";
  } else if (invalidKeys.length > 0) {
    issues.push(
      buildPolicyIssue("invalid_entity_proposal", "Entity proposal contains fields outside the approved contract.", ["entityProposals", String(index)], ruleIds[0], { invalidKeys }, "error")
    );
    status = "blocked";
    approvalRequirement = "blocked";
    riskLevel = "blocked";
    decision = "remove";
  } else if (terminalTransition && !strongEvidence) {
    issues.push(
      buildPolicyIssue("terminal_transition_requires_evidence", "Terminal transition requires authorized evidence.", ["entityProposals", String(index)], ruleIds[0], { entityType: entityProposal.entityType }, "fatal")
    );
    status = "blocked";
    approvalRequirement = "blocked";
    riskLevel = "blocked";
    decision = "remove";
  } else if (terminalTransition && strongEvidence) {
    status = "review";
    approvalRequirement = "explicit_operator_approval";
    riskLevel = "high";
    decision = "allow_with_approval";
    issues.push(
      buildPolicyIssue("action_requires_approval", "Terminal transition requires explicit approval.", ["entityProposals", String(index)], ruleIds[0], { entityType: entityProposal.entityType }, "info")
    );
  } else if (highImpact) {
    status = "review";
    approvalRequirement = "operator_review";
    riskLevel = "medium";
    decision = "allow_with_approval";
    issues.push(
      buildPolicyIssue("action_requires_approval", "High-impact entity proposal requires operator review.", ["entityProposals", String(index)], ruleIds[0], { entityType: entityProposal.entityType }, "info")
    );
  } else {
    decision = "allow";
  }

  if (entityProposal.requiresApproval === "blocked") {
    status = "blocked";
    approvalRequirement = "blocked";
    riskLevel = "blocked";
    decision = "remove";
  } else if (entityProposal.requiresApproval === "operator_review" && status === "allowed") {
    status = "review";
    approvalRequirement = "operator_review";
    riskLevel = maxRisk(riskLevel, "medium");
    decision = "allow_with_approval";
  }

  if (entityProposal.entityType === "opportunity" && typeof entityProposal.proposedChanges.status === "string") {
    if (COMMERCIAL_POLICY_TERMINAL_OPPORTUNITY_STATUSES.includes(entityProposal.proposedChanges.status as never) && !strongEvidence) {
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
    ruleIds: uniqueRuleIds(ruleIds),
    issues,
    reason: issues[0]?.message ?? "Entity proposal complies with policy.",
    terminalTransition,
    customerMasterMutation
  };
}

export function evaluateCommercialEntityProposals(input: CommercialPolicyInput): CommercialPolicyEntityProposalsEvaluationResult {
  const assessments = input.salesAgentResult.entityProposals.map((_, index) => evaluateEntityProposal(input, index));
  const blockedEntityProposals = assessments.filter((assessment) => assessment.status === "blocked").map((assessment) => assessment.entityProposal);
  const keptEntityProposals = assessments.filter((assessment) => assessment.status !== "blocked").map((assessment) => assessment.entityProposal);
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
