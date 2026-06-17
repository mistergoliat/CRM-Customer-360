import { SALES_AGENT_OUTPUT_CONTRACT_VERSION } from "./validationTypes";
import type {
  SalesAgentDecisionType,
  SalesAgentErrorCode,
  SalesAgentOutputValidationContext,
  SalesAgentOutputValidationIssue,
  SalesAgentResult
} from "./validationTypes";

type CreateFailedSafeResultInput = {
  issues?: SalesAgentOutputValidationIssue[];
  reason?: string;
  decisionType?: SalesAgentDecisionType;
};

function pickDecisionType(issues: SalesAgentOutputValidationIssue[], fallback: SalesAgentDecisionType): SalesAgentDecisionType {
  const codes = new Set(issues.map((issue) => issue.code));
  if (codes.has("missing_required_field") || codes.has("contract_incomplete") || codes.has("invalid_root")) {
    return "insufficient_context";
  }
  if (
    codes.has("run_id_mismatch") ||
    codes.has("unsupported_contract_version") ||
    codes.has("forbidden_key") ||
    codes.has("non_serializable_value") ||
    codes.has("hard_blocked_action") ||
    codes.has("sensitive_claim_without_evidence") ||
    codes.has("contradictory_decision")
  ) {
    return "blocked_by_policy";
  }
  return fallback;
}

function pickRiskLevel(issues: SalesAgentOutputValidationIssue[]) {
  return issues.some((issue) => issue.level === "fatal") ? "blocked" : "high";
}

function pickApprovalRequirement(issues: SalesAgentOutputValidationIssue[]) {
  return issues.some((issue) => issue.level === "fatal") ? "blocked" : "operator_review";
}

function pickErrorCode(issues: SalesAgentOutputValidationIssue[]): SalesAgentErrorCode {
  const codes = new Set(issues.map((issue) => issue.code));
  if (codes.has("run_id_mismatch")) return "run_id_mismatch";
  if (codes.has("unsupported_contract_version")) return "unsupported_contract_version";
  if (codes.has("forbidden_key")) return "invalid_output";
  if (codes.has("non_serializable_value")) return "invalid_output";
  if (codes.has("hard_blocked_action")) return "blocked_by_policy";
  return "invalid_output";
}

export function createFailedSafeResult(context: SalesAgentOutputValidationContext, input: CreateFailedSafeResultInput = {}): SalesAgentResult {
  const issues = input.issues ?? [];
  const reason = input.reason ?? (issues[0]?.message ?? "SalesAgent output failed validation.");
  const decisionType = input.decisionType ?? pickDecisionType(issues, "no_commercial_action");
  const riskLevel = pickRiskLevel(issues);
  const approvalRequirement = pickApprovalRequirement(issues);
  const errorCode = pickErrorCode(issues);
  const shouldRequestHuman = decisionType === "blocked_by_policy" || decisionType === "insufficient_context" || decisionType === "request_human";

  return {
    runId: context.expectedRunId ?? "failed-safe",
    contractVersion: context.contractVersion ?? SALES_AGENT_OUTPUT_CONTRACT_VERSION,
    outcome: "failed_safe",
    analysis: {
      summary: reason,
      qualificationState: "unknown",
      customerReadiness: "unknown",
      productFit: "unknown",
      confidence: "low",
      riskLevel,
      reasonCodes: issues.map((issue) => issue.code)
    },
    decision: {
      type: decisionType,
      reason,
      confidence: "low",
      riskLevel,
      requiresApproval: approvalRequirement,
      errorCode,
      reasonCodes: issues.map((issue) => issue.code),
      policyTags: ["fail_safe", "validation_block"]
    },
    shouldRespondNow: false,
    shouldRequestTool: false,
    shouldRequestHuman,
    shouldEvaluateFollowUp: false,
    proposedActions: [],
    toolRequests: [],
    entityProposals: [],
    responseProposal: null,
    evidence: [],
    policyAssessment: {
      status: "blocked",
      blocked: true,
      reason,
      confidence: "low",
      riskLevel,
      approvalRequirement,
      errorCode,
      reasonCodes: issues.map((issue) => issue.code),
      policyTags: ["fail_safe", "validation_block"]
    },
    warnings: [
      "failed_safe",
      ...issues.map((issue) => issue.code)
    ],
    rationale: {
      summary: reason,
      evidence: issues.map((issue) => issue.message),
      counterEvidence: [],
      assumptions: ["Output failed structural validation and was blocked closed."],
      riskFlags: issues.map((issue) => issue.code),
      missingInformation: issues.map((issue) => issue.path.join(".")),
      policyRulesApplied: ["sales_agent_output_validation_fail_closed"]
    },
    metadata: {
      failedSafe: true,
      issueCodes: issues.map((issue) => issue.code),
      generatedBy: "createFailedSafeResult"
    }
  };
}
