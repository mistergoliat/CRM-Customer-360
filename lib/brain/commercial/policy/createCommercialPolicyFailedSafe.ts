import { createFailedSafeResult } from "../sales-agent/createFailedSafeResult";
import { SALES_AGENT_OUTPUT_CONTRACT_VERSION } from "../sales-agent/validationTypes";
import type { SalesAgentOutputValidationContext } from "../sales-agent/validationTypes";
import type {
  CommercialPolicyFailedSafeReason,
  CommercialPolicyInput,
  CommercialPolicyIssue,
  CommercialPolicyMetadata,
  CommercialPolicyResult
} from "./policyTypes";
import {
  COMMERCIAL_POLICY_CONTRACT_VERSION,
  COMMERCIAL_POLICY_VERSION
} from "./policyConstants";
import {
  buildPolicyIssue,
  cloneSalesAgentResult,
  sanitizePolicyRecord,
  uniqueStrings
} from "./policyUtils";

function buildValidationContext(input: CommercialPolicyInput): SalesAgentOutputValidationContext {
  return {
    expectedRunId: input.salesAgentResult.runId,
    contractVersion: SALES_AGENT_OUTPUT_CONTRACT_VERSION,
    allowedCapabilities: input.allowedCapabilities,
    requestedMode: input.salesAgentResult.decision.type === "request_tool" ? "standard" : "minimal",
    commercialContextSummary: null,
    currentTime: input.currentTime,
    strictMode: true,
    metadata: input.metadata ?? {}
  };
}

function buildPolicyMetadata(input: CommercialPolicyInput, issues: CommercialPolicyIssue[], safeMetadata: Record<string, unknown>): CommercialPolicyMetadata {
  const sanitized = sanitizePolicyRecord({
    ...safeMetadata,
    policyVersion: input.policyVersion,
    contractVersion: input.contractVersion,
    commercialPolicyEnabled: input.featureFlags.commercialPolicyEnabled
  });

  return {
    policyVersion: input.policyVersion,
    contractVersion: input.contractVersion,
    currentTime: typeof input.currentTime === "string" ? input.currentTime : input.currentTime.toISOString(),
    validatedAt: typeof input.currentTime === "string" ? input.currentTime : input.currentTime.toISOString(),
    allowedCapabilities: [...input.allowedCapabilities],
    featureFlags: { ...input.featureFlags },
    issueCount: issues.length + sanitized.issues.length,
    warningCount: issues.filter((issue) => issue.level === "warning").length + sanitized.issues.filter((issue) => issue.level === "warning").length,
    appliedRuleCount: 1,
    sanitized: sanitized.sanitized || sanitized.issues.length > 0,
    sanitizedFields: sanitized.sanitizedFields,
    safeMetadata: sanitized.value,
    commercialContext: sanitizePolicyRecord(input.commercialContext ?? {}).value
  };
}

export function createCommercialPolicyFailedSafe(
  input: CommercialPolicyInput,
  reason: CommercialPolicyFailedSafeReason,
  issues: CommercialPolicyIssue[] = []
): CommercialPolicyResult {
  const validationContext = buildValidationContext(input);
  const salesAgentFailedSafe = createFailedSafeResult(validationContext, {
    issues: issues.length > 0 ? issues.map((issue) => ({
      code: "unknown_issue",
      level: issue.level === "fatal" ? "fatal" : issue.level,
      message: issue.message,
      path: issue.path
    })) : undefined,
    reason: reason === "policy_disabled" ? "Commercial policy is disabled." : reason === "policy_version_mismatch" ? "Commercial policy version mismatch." : reason === "policy_context_missing" ? "Commercial policy context is missing." : "Commercial policy failed safe.",
    decisionType: "blocked_by_policy"
  });

  const governedResult = cloneSalesAgentResult(salesAgentFailedSafe);
  governedResult.warnings = uniqueStrings([
    ...governedResult.warnings,
    "commercial_policy_failed_safe",
    reason,
    ...issues.map((issue) => issue.code)
  ]);
  governedResult.metadata = {
    ...governedResult.metadata,
    commercialPolicy: {
      version: COMMERCIAL_POLICY_VERSION,
      contractVersion: COMMERCIAL_POLICY_CONTRACT_VERSION,
      reason,
      issues: issues.map((issue) => issue.code)
    }
  };

  const metadata = buildPolicyMetadata(input, issues, {
    reason,
    issues: issues.map((issue) => issue.code)
  });

  return {
    status: "failed_safe",
    overallDecision: "failed_safe",
    riskLevel: "blocked",
    requiresApproval: "blocked",
    originalResultReference: {
      runId: input.salesAgentResult.runId,
      contractVersion: input.salesAgentResult.contractVersion,
      outcome: input.salesAgentResult.outcome,
      decisionType: input.salesAgentResult.decision.type
    },
    governedResult,
    claimAssessments: [],
    actionAssessments: [],
    toolRequestAssessments: [],
    entityProposalAssessments: [],
    blockedClaims: [],
    blockedActions: [],
    blockedToolRequests: [],
    blockedEntityProposals: [],
    appliedRules: ["POLICY-GOVERNANCE-FAIL-CLOSED"],
    issues: issues.length > 0 ? issues : [buildPolicyIssue("failed_safe", "Commercial policy failed safe.", [], "POLICY-GOVERNANCE-FAIL-CLOSED", { reason }, "fatal")],
    warnings: uniqueStrings(["commercial_policy_failed_safe", reason, ...issues.map((issue) => issue.code)]),
    summary: {
      originalOutcome: input.salesAgentResult.outcome,
      governedOutcome: governedResult.outcome,
      allowedClaims: 0,
      blockedClaims: 0,
      allowedActions: 0,
      blockedActions: 0,
      allowedToolRequests: 0,
      blockedToolRequests: 0,
      allowedEntityProposals: 0,
      blockedEntityProposals: 0,
      reviewRequired: false,
      blocked: true,
      notes: [reason]
    },
    metadata
  };
}
