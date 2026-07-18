import { COMMERCIAL_POLICY_CONTRACT_VERSION, COMMERCIAL_POLICY_VERSION } from "./policyConstants";
import { createCommercialPolicyFailedSafe } from "./createCommercialPolicyFailedSafe";
import { evaluateCommercialActions } from "./evaluateCommercialActions";
import { evaluateCommercialClaims } from "./evaluateCommercialClaims";
import { evaluateCommercialCommitmentGrounding } from "./evaluateCommercialCommitmentGrounding";
import { evaluateCommercialEntityProposals } from "./evaluateCommercialEntityProposals";
import { evaluateCommercialToolRequests } from "./evaluateCommercialToolRequests";
import type {
  CommercialPolicyApprovalRequirement,
  CommercialPolicyDecision,
  CommercialPolicyInput,
  CommercialPolicyIssue,
  CommercialPolicyMetadata,
  CommercialPolicyResult,
  CommercialPolicyRuleId,
  CommercialPolicyStatus
} from "./policyTypes";
import { buildPolicyIssue, cloneSalesAgentResult, isPlainRecord, maxApproval, maxRisk, parseTime, sanitizePolicyRecord, uniqueRuleIds, uniqueStrings } from "./policyUtils";

function isValidCurrentTime(value: string | Date) {
  return parseTime(value) > 0;
}

function mapApprovalToSalesAgentApproval(requirement: CommercialPolicyApprovalRequirement) {
  if (requirement === "blocked") return "blocked";
  if (requirement === "explicit_operator_approval") return "operator_review";
  if (requirement === "operator_review") return "operator_review";
  return "none";
}

function buildStatus(
  blockedCount: number,
  reviewCount: number,
  hasFatalIssue: boolean,
  hasAllowedContent: boolean,
  channelReview: boolean,
  channelBlock: boolean
): CommercialPolicyStatus {
  if (channelBlock) return "blocked";
  if (hasFatalIssue) return "blocked";
  if (blockedCount > 0 && !hasAllowedContent && reviewCount === 0) return "blocked";
  if (reviewCount > 0 || channelReview) return "requires_review";
  if (blockedCount > 0 && hasAllowedContent) return "allowed_with_restrictions";
  return "allowed";
}

function buildOverallDecision(status: CommercialPolicyStatus, requiresApproval: CommercialPolicyApprovalRequirement): CommercialPolicyDecision {
  if (status === "failed_safe") return "failed_safe";
  if (status === "blocked") return "block";
  if (status === "requires_review") return requiresApproval === "none" ? "downgrade_to_review" : "allow_with_approval";
  if (status === "allowed_with_restrictions") return requiresApproval === "none" ? "allow" : "allow_with_approval";
  return requiresApproval === "none" ? "allow" : "allow_with_approval";
}

function computeChannelSignals(input: CommercialPolicyInput) {
  const channel = input.channelContext;
  const channelBlock = Boolean(channel.optOut || channel.aiBlocked || channel.identityConflict);
  /**
   * ACS-R1-05-T06.2: `recentCustomerReply` is sourced upstream from
   * `hasLatestCustomerMessage` (buildCommercialContext.ts), which is
   * computed from the very inbound message this reactive turn is
   * currently processing - so including it here made every reactive turn
   * force `requires_review` on its own response ("the message blocks
   * itself"). It intentionally does not participate in gating the governed
   * result of the turn being processed right now. The flag itself is left
   * untouched on `channelContext` so `evaluateCommercialActions.ts` can
   * still use it to cancel a pending proactive follow-up when the customer
   * has already replied - that consumer is unaffected by this change.
   *
   * ACS-R1-05-T06.2 (second correction, section 10 - investigated and
   * reverted): `quietHoursActive` was briefly removed from this gate on the
   * theory that it could wrongly gate the reactive turn, mirroring
   * `recentCustomerReply` above. That theory does not hold: the reactive
   * path's own channel-context builder
   * (shadow/runCommercialShadowEvaluation.ts#buildChannelContext) already
   * hardcodes `quietHoursActive: false` unconditionally - the reactive
   * turn never receives a real quiet-hours signal here in the first place.
   * The ONLY real caller that passes a live `quietHoursActive` value into
   * `evaluateCommercialPolicy` is `sales-consultative/followUpDispatchPolicy.ts`,
   * which is the proactive follow-up dispatch gate and legitimately needs
   * `channelReview` to include it. Removing it broke that gate
   * (`followUpDispatchPolicy.test.ts`, "[7] quiet hours -> decision
   * require_review") without fixing anything real for the reactive turn -
   * kept here, unchanged from the original T06.2 close.
   */
  const channelReview = Boolean(channel.humanOwnerActive || channel.quietHoursActive || channel.manualApprovalRequired);
  return { channelBlock, channelReview };
}

function buildPolicyMetadata(
  input: CommercialPolicyInput,
  issues: CommercialPolicyIssue[],
  warnings: readonly string[]
): CommercialPolicyMetadata {
  const sanitizedMetadata = sanitizePolicyRecord(input.metadata ?? {});
  const sanitizedCommercialContext = sanitizePolicyRecord(input.commercialContext ?? {});
  return {
    policyVersion: input.policyVersion,
    contractVersion: input.contractVersion,
    currentTime: typeof input.currentTime === "string" ? input.currentTime : input.currentTime.toISOString(),
    validatedAt: typeof input.currentTime === "string" ? input.currentTime : input.currentTime.toISOString(),
    allowedCapabilities: [...input.allowedCapabilities],
    featureFlags: { ...input.featureFlags },
    issueCount: issues.length + sanitizedMetadata.issues.length + sanitizedCommercialContext.issues.length,
    warningCount: warnings.length,
    appliedRuleCount: 0,
    sanitized: sanitizedMetadata.sanitized || sanitizedCommercialContext.sanitized || sanitizedMetadata.issues.length > 0 || sanitizedCommercialContext.issues.length > 0,
    sanitizedFields: uniqueStrings([...sanitizedMetadata.sanitizedFields, ...sanitizedCommercialContext.sanitizedFields]),
    safeMetadata: {
      ...sanitizedMetadata.value,
      commercialContext: sanitizedCommercialContext.value
    },
    commercialContext: sanitizedCommercialContext.value
  };
}

function buildSummary(
  originalOutcome: CommercialPolicyResult["summary"]["originalOutcome"],
  governedOutcome: CommercialPolicyResult["summary"]["governedOutcome"],
  claimBlocked: number,
  actionBlocked: number,
  toolBlocked: number,
  entityBlocked: number,
  reviewRequired: boolean,
  blocked: boolean,
  notes: string[]
) {
  return {
    originalOutcome,
    governedOutcome,
    allowedClaims: 0,
    blockedClaims: claimBlocked,
    allowedActions: 0,
    blockedActions: actionBlocked,
    allowedToolRequests: 0,
    blockedToolRequests: toolBlocked,
    allowedEntityProposals: 0,
    blockedEntityProposals: entityBlocked,
    reviewRequired,
    blocked,
    notes
  };
}

export function evaluateCommercialPolicy(input: CommercialPolicyInput): CommercialPolicyResult {
  const inputRecord = isPlainRecord(input) ? input : null;
  if (!inputRecord || !isPlainRecord(inputRecord.salesAgentResult) || !isPlainRecord(inputRecord.channelContext) || !isPlainRecord(inputRecord.featureFlags)) {
    const fallbackInput = {
      salesAgentResult: inputRecord && isPlainRecord(inputRecord.salesAgentResult)
        ? inputRecord.salesAgentResult
        : {
            runId: "failed-safe",
            contractVersion: COMMERCIAL_POLICY_CONTRACT_VERSION,
            outcome: "failed_safe",
            analysis: {
              summary: "Invalid input.",
              qualificationState: "unknown",
              customerReadiness: "unknown",
              productFit: "unknown",
              confidence: "low",
              riskLevel: "blocked",
              reasonCodes: []
            },
            decision: {
              type: "failed_safe",
              reason: "Invalid input.",
              confidence: "low",
              riskLevel: "blocked",
              requiresApproval: "blocked",
              errorCode: "invalid_output",
              reasonCodes: [],
              policyTags: []
            },
            shouldRespondNow: false,
            shouldRequestTool: false,
            shouldRequestHuman: true,
            shouldEvaluateFollowUp: false,
            proposedActions: [],
            toolRequests: [],
            entityProposals: [],
            responseProposal: null,
            evidence: [],
            policyAssessment: {
              status: "blocked",
              blocked: true,
              reason: "Invalid input.",
              confidence: "low",
              riskLevel: "blocked",
              approvalRequirement: "blocked",
              errorCode: "invalid_output",
              reasonCodes: [],
              policyTags: []
            },
            warnings: [],
            rationale: {
              summary: "Invalid input.",
              evidence: [],
              counterEvidence: [],
              assumptions: [],
              riskFlags: [],
              missingInformation: [],
              policyRulesApplied: []
            },
            metadata: {}
          },
      currentTime: inputRecord?.currentTime ?? new Date(0),
      contractVersion: inputRecord?.contractVersion ?? COMMERCIAL_POLICY_CONTRACT_VERSION,
      policyVersion: inputRecord?.policyVersion ?? COMMERCIAL_POLICY_VERSION,
      allowedCapabilities: inputRecord?.allowedCapabilities ?? [],
      commercialContext: inputRecord?.commercialContext ?? {},
      channelContext: inputRecord?.channelContext ?? {
        channel: null,
        available: false,
        outboundAllowed: false,
        manualApprovalRequired: false,
        optOut: false,
        quietHoursActive: false,
        humanOwnerActive: false,
        aiBlocked: false,
        identityConflict: false,
        recentCustomerReply: false,
        recentHumanContact: false
      },
      featureFlags: inputRecord?.featureFlags ?? {
        commercialPolicyEnabled: false,
        allowDraftReplies: false,
        allowToolRequests: false,
        allowEntityProposals: false,
        allowFollowUpEvaluation: false,
        allowInternalTasks: false,
        allowQuoteDraftRequests: false,
        allowOperatorReviewRequests: false,
        allowSensitiveClaims: false,
        allowOutboundProposals: false
      },
      metadata: inputRecord?.metadata ?? {}
    } as CommercialPolicyInput;

    return createCommercialPolicyFailedSafe(
      fallbackInput,
      "invalid_input",
      [
        buildPolicyIssue("invalid_input", "Commercial policy input is not a valid object.", [], "POLICY-GOVERNANCE-FAIL-CLOSED", null, "fatal")
      ]
    );
  }

  if (!isValidCurrentTime(input.currentTime)) {
    return createCommercialPolicyFailedSafe(input, "invalid_input", [
      buildPolicyIssue("invalid_input", "Commercial policy currentTime is not valid.", ["currentTime"], "POLICY-GOVERNANCE-FAIL-CLOSED", null, "fatal")
    ]);
  }

  if (input.contractVersion !== COMMERCIAL_POLICY_CONTRACT_VERSION || input.policyVersion !== COMMERCIAL_POLICY_VERSION) {
    return createCommercialPolicyFailedSafe(input, "policy_version_mismatch", [
      buildPolicyIssue(
        "policy_version_mismatch",
        "Commercial policy version or contract version mismatch.",
        ["policyVersion"],
        "POLICY-VERSION-MISMATCH",
        {
          expectedPolicyVersion: COMMERCIAL_POLICY_VERSION,
          expectedContractVersion: COMMERCIAL_POLICY_CONTRACT_VERSION,
          receivedPolicyVersion: input.policyVersion,
          receivedContractVersion: input.contractVersion
        },
        "fatal"
      )
    ]);
  }

  if (!input.featureFlags.commercialPolicyEnabled) {
    return createCommercialPolicyFailedSafe(input, "policy_disabled", [
      buildPolicyIssue(
        "policy_disabled",
        "Commercial policy is disabled by feature flags.",
        ["featureFlags", "commercialPolicyEnabled"],
        "POLICY-DISABLED",
        null,
        "fatal"
      )
    ]);
  }

  const salesAgentResult = cloneSalesAgentResult(input.salesAgentResult);
  const claimEvaluation = evaluateCommercialClaims(input);
  const actionEvaluation = evaluateCommercialActions(input);
  const toolRequestEvaluation = evaluateCommercialToolRequests(input);
  const entityProposalEvaluation = evaluateCommercialEntityProposals(input);
  const channelSignals = computeChannelSignals(input);

  /**
   * ACS-R1-05-T06.2 (P1 correction, hardened in the second correction pass):
   * a claim only counts as grounding evidence for the draft-text scan below
   * when its own assessment came back fully "allowed" (verified, fresh,
   * strong source for sensitive types) - a claim under review or already
   * blocked is not evidence. Carries `value` (not just `type`) through so
   * grounding can match the concrete figure named in the draft against the
   * concrete figure the claim actually attests, not merely the claim type -
   * see evaluateCommercialCommitmentGrounding.ts for why type-only matching
   * was insufficient (a verified price claim about one product could
   * previously ground an unrelated price statement about a different one).
   */
  const groundedClaims = claimEvaluation.assessments
    .filter((assessment) => assessment.status === "allowed")
    .map((assessment) => ({ type: assessment.claim.type, value: assessment.claim.value }));
  const commitmentGrounding = evaluateCommercialCommitmentGrounding(
    input.salesAgentResult.responseProposal?.draftText ?? null,
    groundedClaims
  );

  const issues: CommercialPolicyIssue[] = [
    ...claimEvaluation.issues,
    ...actionEvaluation.issues,
    ...toolRequestEvaluation.issues,
    ...entityProposalEvaluation.issues,
    ...commitmentGrounding.issues
  ];

  const warnings = uniqueStrings([
    ...claimEvaluation.warnings,
    ...actionEvaluation.warnings,
    ...toolRequestEvaluation.warnings,
    ...entityProposalEvaluation.warnings,
    ...commitmentGrounding.warnings,
    ...(channelSignals.channelBlock ? ["outbound_blocked"] : []),
    /**
     * ACS-R1-05-T06.2: each review cause is reported by its own real name -
     * never collapsed into a single generic "human_owner_active" warning
     * when the actual trigger was quiet hours or a manual-approval flag.
     */
    ...(input.channelContext.humanOwnerActive ? ["human_owner_active"] : []),
    ...(input.channelContext.quietHoursActive ? ["quiet_hours_active"] : []),
    ...(input.channelContext.manualApprovalRequired ? ["manual_approval_required"] : [])
  ]);

  const channelIssues: CommercialPolicyIssue[] = [];
  if (input.channelContext.optOut) {
    channelIssues.push(
      buildPolicyIssue("opt_out_active", "Outbound proposal is blocked by opt-out state.", ["channelContext", "optOut"], "POLICY-OUTBOUND-OPTOUT", null, "fatal")
    );
  }
  if (input.channelContext.aiBlocked) {
    channelIssues.push(
      buildPolicyIssue("ai_blocked", "Outbound proposal is blocked because AI is disabled for this channel.", ["channelContext", "aiBlocked"], "POLICY-OUTBOUND-AI-BLOCKED", null, "fatal")
    );
  }
  if (input.channelContext.identityConflict) {
    channelIssues.push(
      buildPolicyIssue("identity_conflict", "Outbound proposal is blocked because of an identity conflict.", ["channelContext", "identityConflict"], "POLICY-OUTBOUND-IDENTITY-CONFLICT", null, "fatal")
    );
  }
  if (input.channelContext.humanOwnerActive) {
    channelIssues.push(
      buildPolicyIssue("human_owner_active", "Human owner is active and requires review.", ["channelContext", "humanOwnerActive"], "POLICY-OUTBOUND-HUMAN-OWNER", null, "warning")
    );
  }
  if (input.channelContext.quietHoursActive) {
    channelIssues.push(
      buildPolicyIssue("quiet_hours_active", "Quiet hours are active and require review.", ["channelContext", "quietHoursActive"], "POLICY-OUTBOUND-QUIET-HOURS", null, "warning")
    );
  }
  if (input.channelContext.manualApprovalRequired) {
    channelIssues.push(
      buildPolicyIssue("manual_approval_required", "Manual approval is required for this channel state.", ["channelContext", "manualApprovalRequired"], "POLICY-OUTBOUND-MANUAL-APPROVAL", null, "warning")
    );
  }

  const channelAppliedRules: CommercialPolicyRuleId[] = [];
  if (channelSignals.channelBlock) channelAppliedRules.push("POLICY-OUTBOUND-OPTOUT");
  if (input.channelContext.humanOwnerActive) channelAppliedRules.push("POLICY-OUTBOUND-HUMAN-OWNER");
  if (input.channelContext.quietHoursActive) channelAppliedRules.push("POLICY-OUTBOUND-QUIET-HOURS");
  if (input.channelContext.manualApprovalRequired) channelAppliedRules.push("POLICY-OUTBOUND-MANUAL-APPROVAL");

  const appliedRules: CommercialPolicyRuleId[] = uniqueRuleIds([
    ...claimEvaluation.appliedRules,
    ...actionEvaluation.appliedRules,
    ...toolRequestEvaluation.appliedRules,
    ...entityProposalEvaluation.appliedRules,
    ...commitmentGrounding.appliedRules,
    ...channelAppliedRules
  ]);

  const blockedClaims = [...claimEvaluation.blockedClaims];
  const blockedActions = [...actionEvaluation.blockedActions];
  const blockedToolRequests = [...toolRequestEvaluation.blockedToolRequests];
  const blockedEntityProposals = [...entityProposalEvaluation.blockedEntityProposals];
  const allIssues = [...issues, ...channelIssues];
  const hasFatalIssue = allIssues.some((issue) => issue.level === "fatal");

  const keptClaims = claimEvaluation.keptClaims;
  const keptActions = actionEvaluation.keptActions;
  const keptToolRequests = toolRequestEvaluation.keptToolRequests;
  const keptEntityProposals = entityProposalEvaluation.keptEntityProposals;

  if (salesAgentResult.responseProposal) {
    const blockedClaimTypes = Array.from(
      new Set([
        ...salesAgentResult.responseProposal.blockedClaims,
        ...blockedClaims.map((claim) => claim.type)
      ])
    ) as typeof salesAgentResult.responseProposal.blockedClaims;
    salesAgentResult.responseProposal = {
      ...salesAgentResult.responseProposal,
      claims: keptClaims,
      blockedClaims: blockedClaimTypes
    };
  }

  salesAgentResult.proposedActions = keptActions;
  salesAgentResult.toolRequests = keptToolRequests;
  salesAgentResult.entityProposals = keptEntityProposals;

  const hasAllowedContent =
    keptClaims.length > 0 ||
    keptActions.length > 0 ||
    keptToolRequests.length > 0 ||
    keptEntityProposals.length > 0 ||
    salesAgentResult.responseProposal !== null;
  const blockedCount = blockedClaims.length + blockedActions.length + blockedToolRequests.length + blockedEntityProposals.length;
  const reviewCount =
    claimEvaluation.assessments.filter((assessment) => assessment.status === "review").length +
    actionEvaluation.assessments.filter((assessment) => assessment.status === "review").length +
    toolRequestEvaluation.assessments.filter((assessment) => assessment.status === "review").length +
    entityProposalEvaluation.assessments.filter((assessment) => assessment.status === "review").length;

  const status = buildStatus(
    blockedCount,
    reviewCount,
    hasFatalIssue,
    hasAllowedContent,
    channelSignals.channelReview || commitmentGrounding.requiresReview,
    channelSignals.channelBlock
  );
  /**
   * ACS-R1-05-T06.2 (second correction, section 8): `commitmentGrounding`
   * must carry the same authority into `requiresApproval` that it already
   * carries into `status` (via the `buildStatus` call below) - otherwise
   * `crm_agent_decisions`/`crm_agent_actions` could persist
   * `policy_status: "requires_review"` next to `approval_requirement: "none"`,
   * an internally incoherent audit trail even though the turn still
   * escalates correctly via `shouldRequestHuman`.
   */
  const requiresApproval = maxApproval(
    maxApproval(claimEvaluation.requiresApproval, actionEvaluation.requiresApproval),
    maxApproval(
      toolRequestEvaluation.requiresApproval,
      maxApproval(entityProposalEvaluation.requiresApproval, commitmentGrounding.requiresReview ? "operator_review" : "none")
    )
  );
  const riskLevel = maxRisk(
    maxRisk(claimEvaluation.riskLevel, actionEvaluation.riskLevel),
    maxRisk(toolRequestEvaluation.riskLevel, entityProposalEvaluation.riskLevel)
  );

  const overallDecision = buildOverallDecision(status, requiresApproval);

  if (status === "blocked") {
    salesAgentResult.outcome = "blocked_by_policy";
    salesAgentResult.shouldRespondNow = false;
    salesAgentResult.shouldRequestTool = false;
    salesAgentResult.shouldRequestHuman = true;
    salesAgentResult.shouldEvaluateFollowUp = false;
    salesAgentResult.responseProposal = null;
    salesAgentResult.proposedActions = [];
    salesAgentResult.toolRequests = [];
    salesAgentResult.entityProposals = [];
    salesAgentResult.decision = {
      ...salesAgentResult.decision,
      type: "blocked_by_policy",
      reason: "Commercial policy blocked the proposal.",
      confidence: "low",
      riskLevel: "blocked",
      requiresApproval: "blocked",
      errorCode: "blocked_by_policy",
      reasonCodes: [...appliedRules],
      policyTags: uniqueStrings([...salesAgentResult.decision.policyTags, "commercial_policy_blocked"])
    };
    salesAgentResult.policyAssessment = {
      ...salesAgentResult.policyAssessment,
      status: "blocked",
      blocked: true,
      reason: "Commercial policy blocked the proposal.",
      confidence: "low",
      riskLevel: "blocked",
      approvalRequirement: "blocked",
      errorCode: "blocked_by_policy",
      reasonCodes: [...appliedRules],
      policyTags: uniqueStrings([...salesAgentResult.policyAssessment.policyTags, "commercial_policy_blocked"])
    };
  } else if (status === "requires_review") {
    salesAgentResult.shouldRespondNow = false;
    salesAgentResult.shouldRequestHuman = true;
    salesAgentResult.shouldRequestTool = keptToolRequests.length > 0;
    salesAgentResult.shouldEvaluateFollowUp = false;
    salesAgentResult.decision = {
      ...salesAgentResult.decision,
      type: "request_human",
      reason: "Commercial policy requires operator review.",
      confidence: "medium",
      riskLevel: riskLevel === "blocked" ? "blocked" : riskLevel,
      requiresApproval: mapApprovalToSalesAgentApproval(requiresApproval),
      errorCode: "none",
      reasonCodes: [...appliedRules],
      policyTags: uniqueStrings([...salesAgentResult.decision.policyTags, "commercial_policy_review"])
    };
    salesAgentResult.policyAssessment = {
      ...salesAgentResult.policyAssessment,
      status: "review",
      blocked: false,
      reason: "Commercial policy requires operator review.",
      confidence: "medium",
      riskLevel: riskLevel === "blocked" ? "high" : riskLevel,
      approvalRequirement: mapApprovalToSalesAgentApproval(requiresApproval),
      errorCode: "none",
      reasonCodes: [...appliedRules],
      policyTags: uniqueStrings([...salesAgentResult.policyAssessment.policyTags, "commercial_policy_review"])
    };
  } else {
    salesAgentResult.shouldRespondNow = salesAgentResult.responseProposal !== null ? salesAgentResult.shouldRespondNow : false;
    salesAgentResult.shouldRequestTool = keptToolRequests.length > 0;
    salesAgentResult.shouldRequestHuman = requiresApproval !== "none";
    salesAgentResult.shouldEvaluateFollowUp = salesAgentResult.shouldEvaluateFollowUp && !channelSignals.channelBlock;
    salesAgentResult.decision = {
      ...salesAgentResult.decision,
      type: salesAgentResult.decision.type === "blocked_by_policy" ? "no_commercial_action" : salesAgentResult.decision.type,
      reason: salesAgentResult.decision.reason,
      confidence: salesAgentResult.decision.confidence,
      riskLevel: riskLevel === "blocked" ? "high" : riskLevel,
      requiresApproval: mapApprovalToSalesAgentApproval(requiresApproval),
      errorCode: salesAgentResult.decision.errorCode,
      reasonCodes: uniqueStrings([...salesAgentResult.decision.reasonCodes, ...appliedRules]),
      policyTags: uniqueStrings([...salesAgentResult.decision.policyTags, "commercial_policy_governed"])
    };
    salesAgentResult.policyAssessment = {
      ...salesAgentResult.policyAssessment,
      status: requiresApproval === "none" ? "allowed" : "review",
      blocked: false,
      reason: "Commercial policy governed the proposal.",
      confidence: "medium",
      riskLevel: riskLevel === "blocked" ? "high" : riskLevel,
      approvalRequirement: mapApprovalToSalesAgentApproval(requiresApproval),
      errorCode: "none",
      reasonCodes: uniqueStrings([...salesAgentResult.policyAssessment.reasonCodes, ...appliedRules]),
      policyTags: uniqueStrings([...salesAgentResult.policyAssessment.policyTags, "commercial_policy_governed"])
    };
  }

  salesAgentResult.analysis = {
    ...salesAgentResult.analysis,
    riskLevel: riskLevel === "blocked" ? "high" : riskLevel,
    reasonCodes: uniqueStrings([...salesAgentResult.analysis.reasonCodes, ...appliedRules])
  };
  salesAgentResult.warnings = uniqueStrings([
    ...salesAgentResult.warnings,
    ...warnings,
    ...(blockedCount > 0 ? ["commercial_policy_blocked_items"] : []),
    ...(reviewCount > 0 ? ["commercial_policy_review_items"] : [])
  ]);
  salesAgentResult.rationale = {
    ...salesAgentResult.rationale,
    policyRulesApplied: uniqueStrings([...salesAgentResult.rationale.policyRulesApplied, ...appliedRules]),
    riskFlags: uniqueStrings([...salesAgentResult.rationale.riskFlags, ...(blockedCount > 0 ? ["commercial_policy_blocked_items"] : []), ...(reviewCount > 0 ? ["commercial_policy_review_items"] : [])])
  };
  salesAgentResult.metadata = {
    ...salesAgentResult.metadata,
    commercialPolicy: {
      version: input.policyVersion,
      contractVersion: input.contractVersion,
      status,
      overallDecision,
      requiresApproval,
      riskLevel,
      blockedCount,
      reviewCount,
      appliedRules
    }
  };

  const metadata = buildPolicyMetadata(input, allIssues, warnings);
  metadata.appliedRuleCount = appliedRules.length;

  const summary = buildSummary(
    input.salesAgentResult.outcome,
    salesAgentResult.outcome,
    blockedClaims.length,
    blockedActions.length,
    blockedToolRequests.length,
    blockedEntityProposals.length,
    status === "requires_review",
    status === "blocked",
    [
      ...(status === "blocked" ? ["commercial_policy_blocked"] : []),
      ...(status === "requires_review" ? ["commercial_policy_review"] : []),
      ...(blockedCount > 0 ? ["blocked_items_removed"] : []),
      ...(reviewCount > 0 ? ["review_items_retained"] : [])
    ]
  );
  summary.allowedClaims = status === "blocked" ? 0 : keptClaims.length;
  summary.allowedActions = status === "blocked" ? 0 : keptActions.length;
  summary.allowedToolRequests = status === "blocked" ? 0 : keptToolRequests.length;
  summary.allowedEntityProposals = status === "blocked" ? 0 : keptEntityProposals.length;

  return {
    status,
    overallDecision,
    riskLevel,
    requiresApproval,
    originalResultReference: {
      runId: input.salesAgentResult.runId,
      contractVersion: input.salesAgentResult.contractVersion,
      outcome: input.salesAgentResult.outcome,
      decisionType: input.salesAgentResult.decision.type
    },
    governedResult: salesAgentResult,
    claimAssessments: claimEvaluation.assessments,
    actionAssessments: actionEvaluation.assessments,
    toolRequestAssessments: toolRequestEvaluation.assessments,
    entityProposalAssessments: entityProposalEvaluation.assessments,
    blockedClaims,
    blockedActions,
    blockedToolRequests,
    blockedEntityProposals,
    appliedRules,
    issues: allIssues,
    warnings,
    summary,
    metadata
  };
}
