"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateCommercialShadowResult = evaluateCommercialShadowResult;
const shadowConstants_1 = require("../shadow/shadowConstants");
const runtimeTypes_1 = require("../sales-agent/runtimeTypes");
const validationTypes_1 = require("../sales-agent/validationTypes");
const salesAgentConstants_1 = require("../salesAgentConstants");
const evaluationConstants_1 = require("./evaluationConstants");
const classifyCommercialFailure_1 = require("./classifyCommercialFailure");
const evaluationUtils_1 = require("./evaluationUtils");
const policyConstants_1 = require("../policy/policyConstants");
const MAX_METADATA_BYTES = 8192;
const MAX_STRING_LENGTH = 4000;
const MAX_DEPTH = 6;
function getCommercialEvaluationMetadata(shadowResult) {
    if (!(0, evaluationUtils_1.isRecord)(shadowResult.metadata))
        return null;
    const evaluation = shadowResult.metadata.commercialEvaluation;
    return (0, evaluationUtils_1.isRecord)(evaluation) ? evaluation : null;
}
function scoreToSeverity(score) {
    if (score >= 85)
        return "info";
    if (score >= 65)
        return "warning";
    if (score >= 40)
        return "error";
    return "critical";
}
function clampScore(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
}
function issueSeverityForCode(code, defaultSeverity) {
    if (code === "EVAL-SAFETY-SIDE-EFFECT" || code === "EVAL-SAFETY-SECRET-EXPOSURE" || code === "EVAL-POLICY-MISSING" || code === "EVAL-DATA-INSUFFICIENT") {
        return "critical";
    }
    if (code === "EVAL-TECH-TIMEOUT" || code === "EVAL-TECH-RUNTIME-ERROR" || code === "EVAL-TECH-VALIDATION-FAILED") {
        return "error";
    }
    if (code === "EVAL-COMMERCIAL-NOT-USEFUL") {
        return "error";
    }
    return defaultSeverity;
}
function issueComponentForCode(code) {
    if (code.startsWith("EVAL-CONTEXT"))
        return "context";
    if (code.startsWith("EVAL-TECH"))
        return "runtime";
    if (code.startsWith("EVAL-POLICY"))
        return "policy";
    if (code.startsWith("EVAL-MODEL"))
        return "prompt";
    if (code.startsWith("EVAL-COMMERCIAL"))
        return "prompt";
    if (code.startsWith("EVAL-SAFETY"))
        return "safety";
    if (code === "EVAL-OBSERVABILITY-INCOMPLETE")
        return "observability";
    if (code === "EVAL-DATA-INSUFFICIENT")
        return "data";
    return "unknown";
}
function dimensionForComponent(component) {
    if (component === "context")
        return "contextQuality";
    if (component === "runtime")
        return "runtimeQuality";
    if (component === "policy")
        return "policyQuality";
    if (component === "prompt")
        return "commercialUsefulness";
    if (component === "safety")
        return "safety";
    if (component === "latency")
        return "latency";
    if (component === "cost")
        return "cost";
    if (component === "observability")
        return "observability";
    if (component === "data")
        return "readinessContribution";
    return null;
}
function buildIssue(code, message, dimension, severity, path = [], details) {
    return {
        code,
        severity: issueSeverityForCode(code, severity),
        message,
        dimension,
        component: issueComponentForCode(code),
        path,
        details: details ?? null
    };
}
function countNonZeroSideEffects(sideEffects) {
    return (0, evaluationUtils_1.sum)([
        sideEffects.messagesSent,
        sideEffects.toolsExecuted,
        sideEffects.databaseWrites,
        sideEffects.outboxWrites,
        sideEffects.leadsCreated,
        sideEffects.opportunitiesCreated,
        sideEffects.casesMutated
    ]);
}
function isSensitiveClaimType(claimType) {
    return salesAgentConstants_1.SALES_AGENT_SENSITIVE_CLAIMS.includes(claimType);
}
function buildVersionInfo(shadowResult) {
    return {
        evaluationVersion: evaluationConstants_1.COMMERCIAL_EVALUATION_VERSION,
        shadowVersion: shadowResult.versions.shadowVersion ?? shadowConstants_1.COMMERCIAL_SHADOW_VERSION,
        runtimeVersion: shadowResult.versions.runtimeVersion ?? runtimeTypes_1.SALES_AGENT_RUNTIME_VERSION,
        policyVersion: shadowResult.versions.policyVersion ?? policyConstants_1.COMMERCIAL_POLICY_VERSION,
        contractVersion: shadowResult.versions.contractVersion ?? validationTypes_1.SALES_AGENT_OUTPUT_CONTRACT_VERSION,
        promptVersion: shadowResult.versions.promptVersion ?? runtimeTypes_1.SALES_AGENT_PROMPT_VERSION
    };
}
function buildShadowSummary(shadowResult) {
    const runtimeResult = shadowResult.context?.runtimeResult ?? null;
    const policyResult = shadowResult.context?.policyResult ?? null;
    const governedResult = policyResult?.governedResult ?? runtimeResult?.result ?? null;
    const runtimeValidation = runtimeResult?.validation ?? null;
    const runtimeSummary = shadowResult.runtimeSummary;
    const policySummary = shadowResult.policySummary;
    const issueCodes = (0, evaluationUtils_1.uniqueStrings)([
        ...(shadowResult.warnings ?? []),
        ...(shadowResult.error?.code ? [shadowResult.error.code] : []),
        ...(runtimeResult?.warnings ?? []),
        ...(runtimeValidation && runtimeValidation.status !== "skipped" ? runtimeValidation.issues.map((issue) => issue.code) : []),
        ...(policyResult?.issues.map((issue) => issue.code) ?? [])
    ]);
    return {
        status: shadowResult.status,
        mode: shadowResult.mode,
        enabled: shadowResult.enabled,
        eligible: shadowResult.eligible,
        skipReason: shadowResult.skipReason ?? null,
        runtimeStatus: runtimeSummary?.status ?? runtimeResult?.status ?? null,
        validationStatus: runtimeSummary?.validationStatus ?? runtimeValidation?.status ?? null,
        policyStatus: policySummary?.status ?? policyResult?.status ?? null,
        overallDecision: policySummary?.overallDecision ?? policyResult?.overallDecision ?? null,
        outcome: runtimeSummary?.outcome ?? governedResult?.outcome ?? null,
        riskLevel: policySummary?.riskLevel ?? (runtimeSummary?.confidence === "low" ? "blocked" : null),
        approvalRequirement: policySummary?.requiresApproval ?? governedResult?.decision.requiresApproval ?? null,
        shouldRespondNow: governedResult?.shouldRespondNow ?? shadowResult.governedResultSummary?.shouldRespondNow ?? null,
        confidence: runtimeSummary?.confidence ?? governedResult?.analysis.confidence ?? null,
        warningCount: (0, evaluationUtils_1.uniqueStrings)([
            ...(shadowResult.warnings ?? []),
            ...(runtimeResult?.warnings ?? []),
            ...(policyResult?.warnings ?? [])
        ]).length,
        issueCodes,
        appliedRuleIds: (0, evaluationUtils_1.uniqueStrings)([
            ...(shadowResult.governedResultSummary?.appliedRuleIds ?? []),
            ...(policyResult?.appliedRules ?? [])
        ]),
        sideEffects: shadowResult.sideEffects
    };
}
function buildMetrics(shadowResult, summary) {
    const runtimeResult = shadowResult.context?.runtimeResult ?? null;
    const policyResult = shadowResult.context?.policyResult ?? null;
    const governedResult = policyResult?.governedResult ?? runtimeResult?.result ?? null;
    const claims = policyResult?.governedResult.responseProposal?.claims ?? governedResult?.responseProposal?.claims ?? [];
    const blockedClaims = policyResult?.blockedClaims ?? [];
    const proposedActions = policyResult?.governedResult.proposedActions ?? governedResult?.proposedActions ?? [];
    const blockedActions = policyResult?.blockedActions ?? [];
    const toolRequests = policyResult?.governedResult.toolRequests ?? governedResult?.toolRequests ?? [];
    const blockedToolRequests = policyResult?.blockedToolRequests ?? [];
    const entityProposals = policyResult?.governedResult.entityProposals ?? governedResult?.entityProposals ?? [];
    const blockedEntityProposals = policyResult?.blockedEntityProposals ?? [];
    const claimCountsByType = {};
    const blockedClaimCountsByType = {};
    const actionCountsByType = {};
    const blockedActionCountsByType = {};
    const toolRequestCountsByType = {};
    const blockedToolRequestCountsByType = {};
    const entityProposalCountsByType = {};
    const blockedEntityProposalCountsByType = {};
    const increment = (counter, key, amount = 1) => {
        counter[key] = (counter[key] ?? 0) + amount;
    };
    for (const claim of claims)
        increment(claimCountsByType, claim.type);
    for (const claim of blockedClaims)
        increment(blockedClaimCountsByType, claim.type);
    for (const action of proposedActions)
        increment(actionCountsByType, action.type);
    for (const action of blockedActions)
        increment(blockedActionCountsByType, action.type);
    for (const toolRequest of toolRequests)
        increment(toolRequestCountsByType, toolRequest.tool);
    for (const toolRequest of blockedToolRequests)
        increment(blockedToolRequestCountsByType, toolRequest.tool);
    for (const entityProposal of entityProposals)
        increment(entityProposalCountsByType, entityProposal.entityType);
    for (const entityProposal of blockedEntityProposals)
        increment(blockedEntityProposalCountsByType, entityProposal.entityType);
    const evaluationMetadata = getCommercialEvaluationMetadata(shadowResult);
    if (Object.keys(claimCountsByType).length === 0 && (0, evaluationUtils_1.isRecord)(evaluationMetadata?.claimCountsByType)) {
        Object.assign(claimCountsByType, evaluationMetadata.claimCountsByType);
    }
    if (Object.keys(blockedClaimCountsByType).length === 0 && (0, evaluationUtils_1.isRecord)(evaluationMetadata?.blockedClaimCountsByType)) {
        Object.assign(blockedClaimCountsByType, evaluationMetadata.blockedClaimCountsByType);
    }
    if (Object.keys(actionCountsByType).length === 0 && (0, evaluationUtils_1.isRecord)(evaluationMetadata?.actionCountsByType)) {
        Object.assign(actionCountsByType, evaluationMetadata.actionCountsByType);
    }
    if (Object.keys(blockedActionCountsByType).length === 0 && (0, evaluationUtils_1.isRecord)(evaluationMetadata?.blockedActionCountsByType)) {
        Object.assign(blockedActionCountsByType, evaluationMetadata.blockedActionCountsByType);
    }
    if (Object.keys(toolRequestCountsByType).length === 0 && (0, evaluationUtils_1.isRecord)(evaluationMetadata?.toolRequestCountsByType)) {
        Object.assign(toolRequestCountsByType, evaluationMetadata.toolRequestCountsByType);
    }
    if (Object.keys(blockedToolRequestCountsByType).length === 0 && (0, evaluationUtils_1.isRecord)(evaluationMetadata?.blockedToolRequestCountsByType)) {
        Object.assign(blockedToolRequestCountsByType, evaluationMetadata.blockedToolRequestCountsByType);
    }
    if (Object.keys(entityProposalCountsByType).length === 0 && (0, evaluationUtils_1.isRecord)(evaluationMetadata?.entityProposalCountsByType)) {
        Object.assign(entityProposalCountsByType, evaluationMetadata.entityProposalCountsByType);
    }
    if (Object.keys(blockedEntityProposalCountsByType).length === 0 && (0, evaluationUtils_1.isRecord)(evaluationMetadata?.blockedEntityProposalCountsByType)) {
        Object.assign(blockedEntityProposalCountsByType, evaluationMetadata.blockedEntityProposalCountsByType);
    }
    const sensitiveClaims = claims.filter((claim) => isSensitiveClaimType(claim.type)).length;
    const blockedSensitiveClaims = blockedClaims.filter((claim) => isSensitiveClaimType(claim.type)).length;
    const sideEffectsCount = countNonZeroSideEffects(summary.sideEffects);
    return {
        shadowStatus: shadowResult.status,
        shadowMode: shadowResult.mode,
        shadowEnabled: shadowResult.enabled,
        shadowEligible: shadowResult.eligible,
        runtimeStatus: runtimeResult?.status ?? null,
        validationStatus: runtimeResult?.validation.status ?? null,
        outcome: governedResult?.outcome ?? null,
        policyStatus: policyResult?.status ?? shadowResult.policySummary?.status ?? null,
        overallDecision: policyResult?.overallDecision ?? shadowResult.policySummary?.overallDecision ?? null,
        riskLevel: policyResult?.riskLevel ?? runtimeResult?.result.analysis.riskLevel ?? null,
        approvalRequirement: policyResult?.requiresApproval ?? governedResult?.decision.requiresApproval ?? null,
        shouldRespondNow: governedResult?.shouldRespondNow ?? null,
        confidence: governedResult?.analysis.confidence ?? runtimeResult?.result.analysis.confidence ?? null,
        claimsTotal: claims.length + blockedClaims.length,
        claimsBlocked: blockedClaims.length,
        claimsSensitive: sensitiveClaims + blockedSensitiveClaims,
        claimCountsByType,
        blockedClaimCountsByType,
        proposedActionsTotal: proposedActions.length + blockedActions.length,
        proposedActionsBlocked: blockedActions.length,
        actionCountsByType,
        blockedActionCountsByType,
        toolRequestsTotal: toolRequests.length + blockedToolRequests.length,
        toolRequestsBlocked: blockedToolRequests.length,
        toolRequestCountsByType,
        blockedToolRequestCountsByType,
        entityProposalsTotal: entityProposals.length + blockedEntityProposals.length,
        entityProposalsBlocked: blockedEntityProposals.length,
        entityProposalCountsByType,
        blockedEntityProposalCountsByType,
        warningsCount: summary.warningCount,
        issuesCount: (0, evaluationUtils_1.uniqueStrings)(summary.issueCodes).length,
        appliedPolicyRules: [...summary.appliedRuleIds],
        timeout: shadowResult.status === "timeout" || Boolean(shadowResult.metrics.timedOut) || runtimeResult?.status === "timeout",
        durationTotalMs: shadowResult.metrics.durationMs ?? null,
        contextDurationMs: shadowResult.metrics.contextBuilderDurationMs ?? null,
        runtimeDurationMs: shadowResult.metrics.runtimeDurationMs ?? null,
        validationDurationMs: shadowResult.metrics.validationDurationMs ?? null,
        policyDurationMs: shadowResult.metrics.policyDurationMs ?? null,
        inputTokens: shadowResult.metrics.inputTokens ?? runtimeResult?.metrics.inputTokens ?? null,
        outputTokens: shadowResult.metrics.outputTokens ?? runtimeResult?.metrics.outputTokens ?? null,
        estimatedCost: shadowResult.metrics.estimatedCost ?? runtimeResult?.metrics.estimatedCost ?? null,
        provider: runtimeResult?.provider.name ?? shadowResult.runtimeSummary?.providerName ?? null,
        model: runtimeResult?.provider.model ?? shadowResult.metrics.model ?? null,
        contractVersion: shadowResult.versions.contractVersion ?? validationTypes_1.SALES_AGENT_OUTPUT_CONTRACT_VERSION,
        promptVersion: shadowResult.versions.promptVersion ?? runtimeTypes_1.SALES_AGENT_PROMPT_VERSION,
        runtimeVersion: shadowResult.versions.runtimeVersion ?? runtimeTypes_1.SALES_AGENT_RUNTIME_VERSION,
        policyVersion: shadowResult.versions.policyVersion ?? policyConstants_1.COMMERCIAL_POLICY_VERSION,
        sideEffectsCount,
        hasPolicyResult: Boolean(policyResult),
        hasRuntimeResult: Boolean(runtimeResult),
        hasValidationResult: Boolean(runtimeResult?.validation),
        hasCommercialContext: Boolean(shadowResult.context?.commercialContext),
        hasComparison: false,
        hasReviewerAssessment: false
    };
}
function extractKnownClaims(shadowResult) {
    const runtimeResult = shadowResult.context?.runtimeResult ?? null;
    const policyResult = shadowResult.context?.policyResult ?? null;
    const governedResult = policyResult?.governedResult ?? runtimeResult?.result ?? null;
    const fromContext = governedResult?.responseProposal?.claims ?? [];
    if (fromContext.length > 0)
        return fromContext;
    const metadata = getCommercialEvaluationMetadata(shadowResult);
    if (!Array.isArray(metadata?.claims))
        return [];
    return metadata.claims.filter((claim) => (0, evaluationUtils_1.isRecord)(claim) && typeof claim.type === "string");
}
function buildComparison(shadowResult, productiveDecision) {
    if (!productiveDecision)
        return null;
    const summary = shadowResult.governedResultSummary ?? null;
    const shadowDecision = summary
        ? `${summary.overallDecision}/${summary.policyStatus}/${summary.outcome}`
        : shadowResult.status;
    const productiveAction = productiveDecision.action ?? null;
    const targetAgent = productiveDecision.targetAgent ?? null;
    const responded = productiveDecision.responded ?? null;
    const handedOff = productiveDecision.handedOff ?? null;
    const closed = productiveDecision.closed ?? null;
    const noAction = productiveDecision.noAction ?? null;
    const requiresHuman = productiveDecision.requiresHuman ?? null;
    const reason = productiveDecision.reason ?? null;
    const timestamp = productiveDecision.timestamp ?? null;
    const alignedFields = [];
    const divergentFields = [];
    if (summary?.shouldRespondNow === true && responded === true)
        alignedFields.push("response");
    else if (summary?.shouldRespondNow === true && responded !== true)
        divergentFields.push("response");
    const approvalRequirement = summary?.requiresApproval;
    if ((approvalRequirement === "operator_review" || approvalRequirement === "explicit_operator_approval" || approvalRequirement === "review") && requiresHuman === true) {
        alignedFields.push("human_review");
    }
    else if ((approvalRequirement === "operator_review" || approvalRequirement === "explicit_operator_approval" || approvalRequirement === "review") && requiresHuman !== true) {
        divergentFields.push("human_review");
    }
    if ((summary?.policyStatus === "blocked" || summary?.policyStatus === "failed_safe") && (noAction === true || requiresHuman === true || handedOff === true)) {
        alignedFields.push("blocked_or_reviewed");
    }
    else if (summary?.policyStatus === "blocked" && responded === true) {
        divergentFields.push("blocked_or_reviewed");
    }
    if (summary?.outcome === "tool_required" && productiveAction && productiveAction.toLowerCase().includes("tool"))
        alignedFields.push("tool");
    else if (summary?.outcome === "tool_required" && productiveAction && !productiveAction.toLowerCase().includes("tool"))
        divergentFields.push("tool");
    if (summary?.outcome === "waiting_for_customer" && (noAction === true || responded === false))
        alignedFields.push("wait");
    const status = productiveDecision.action == null && responded == null && handedOff == null && closed == null && noAction == null
        ? "not_comparable"
        : divergentFields.length > 0 && alignedFields.length === 0
            ? "divergent"
            : divergentFields.length > 0
                ? "partially_aligned"
                : "aligned";
    return {
        status,
        shadowDecision,
        productiveAction,
        targetAgent,
        responded,
        handedOff,
        closed,
        noAction,
        requiresHuman,
        reason,
        timestamp,
        alignedFields: (0, evaluationUtils_1.uniqueStrings)(alignedFields),
        divergentFields: (0, evaluationUtils_1.uniqueStrings)(divergentFields)
    };
}
function buildDimensionResult(dimension, score, issueCodes, evidence, details, summary) {
    const severity = issueCodes.length > 0 ? scoreToSeverity(score) : scoreToSeverity(score);
    return {
        dimension,
        score: clampScore(score),
        severity,
        summary,
        issueCodes: (0, evaluationUtils_1.uniqueStrings)(issueCodes),
        issueCount: (0, evaluationUtils_1.uniqueStrings)(issueCodes).length,
        evidence: (0, evaluationUtils_1.uniqueStrings)(evidence),
        details
    };
}
function buildRecommendations(classification, issues) {
    const primaryIssueCodes = (0, evaluationUtils_1.uniqueStrings)(issues.map((issue) => issue.code));
    if (classification.needsSafetyReview) {
        return [
            {
                component: "safety",
                priority: "critical",
                title: "Resolve safety blockers",
                reason: classification.reason,
                evidence: issues.filter((issue) => issue.dimension === "safety").map((issue) => issue.message),
                issueCodes: primaryIssueCodes
            }
        ];
    }
    if (classification.needsRuntimeStabilization) {
        return [
            {
                component: "runtime",
                priority: "high",
                title: "Stabilize runtime and validation",
                reason: classification.reason,
                evidence: issues.filter((issue) => issue.component === "runtime").map((issue) => issue.message),
                issueCodes: primaryIssueCodes
            }
        ];
    }
    if (classification.needsContextImprovement) {
        return [
            {
                component: "context",
                priority: "high",
                title: "Improve commercial context coverage",
                reason: classification.reason,
                evidence: issues.filter((issue) => issue.component === "context").map((issue) => issue.message),
                issueCodes: primaryIssueCodes
            }
        ];
    }
    if (classification.needsPolicyTuning) {
        return [
            {
                component: "policy",
                priority: "high",
                title: "Tune policy restrictions",
                reason: classification.reason,
                evidence: issues.filter((issue) => issue.component === "policy").map((issue) => issue.message),
                issueCodes: primaryIssueCodes
            }
        ];
    }
    if (classification.needsPromptTuning) {
        return [
            {
                component: "prompt",
                priority: "high",
                title: "Tune model prompt or contract guidance",
                reason: classification.reason,
                evidence: issues.filter((issue) => issue.component === "prompt").map((issue) => issue.message),
                issueCodes: primaryIssueCodes
            }
        ];
    }
    return [
        {
            component: classification.primaryComponent,
            priority: classification.usefulness === "useful" ? "low" : "medium",
            title: "Preserve the current commercial shape and continue collecting data",
            reason: classification.reason,
            evidence: issues.map((issue) => issue.message).slice(0, 5),
            issueCodes: primaryIssueCodes
        }
    ];
}
function buildIssues(shadowResult, summary, metrics, comparison) {
    const issues = [];
    if (shadowResult.status === "disabled" || shadowResult.status === "skipped") {
        issues.push(buildIssue("EVAL-DATA-INSUFFICIENT", "Shadow was skipped or disabled and does not provide enough signal for readiness.", "dataset", "warning", ["status"], { status: shadowResult.status }));
    }
    if (metrics.sideEffectsCount > 0) {
        issues.push(buildIssue("EVAL-SAFETY-SIDE-EFFECT", "Shadow reported non-zero side effects.", "safety", "critical", ["sideEffects"], { sideEffectsCount: metrics.sideEffectsCount }));
    }
    if (summary.policyStatus === null && summary.runtimeStatus !== "disabled") {
        issues.push(buildIssue("EVAL-POLICY-MISSING", "Commercial Policy result is missing.", "policy", "critical", ["policySummary"], null));
    }
    if (summary.runtimeStatus === "timeout" || shadowResult.status === "timeout") {
        issues.push(buildIssue("EVAL-TECH-TIMEOUT", "Commercial runtime or shadow timed out.", "runtime", "error", ["runtimeSummary", "metrics"], null));
    }
    if (summary.runtimeStatus === "provider_error" || shadowResult.status === "runtime_failed") {
        issues.push(buildIssue("EVAL-TECH-RUNTIME-ERROR", "Commercial runtime failed.", "runtime", "error", ["runtimeSummary"], null));
    }
    if (summary.validationStatus !== null && summary.validationStatus !== "valid" && summary.validationStatus !== "skipped") {
        issues.push(buildIssue("EVAL-TECH-VALIDATION-FAILED", "Sales Agent validation did not pass.", "runtime", "error", ["validationResult"], { validationStatus: summary.validationStatus }));
    }
    if (shadowResult.commercialContextSummary === null || shadowResult.commercialContextSummary.completeness === "insufficient") {
        issues.push(buildIssue("EVAL-CONTEXT-INCOMPLETE", "Commercial context is incomplete.", "context", "warning", ["commercialContextSummary"], { completeness: shadowResult.commercialContextSummary?.completeness ?? null }));
    }
    const sourceSummary = shadowResult.commercialContextSummary?.sourceSummary ?? null;
    if (sourceSummary?.hasLatestCustomerMessage === false) {
        issues.push(buildIssue("EVAL-CONTEXT-MISSING-EVIDENCE", "Latest customer message is missing.", "context", "warning", ["commercialContextSummary", "sourceSummary"], null));
    }
    if (sourceSummary?.hasCustomerReference === false) {
        issues.push(buildIssue("EVAL-CONTEXT-MISSING-EVIDENCE", "Customer reference is missing.", "context", "warning", ["commercialContextSummary", "sourceSummary"], null));
    }
    if (sourceSummary?.humanOwnershipActive) {
        issues.push(buildIssue("EVAL-CONTEXT-IDENTITY-CONFLICT", "Human ownership is active and changes the commercial interpretation.", "context", "warning", ["commercialContextSummary", "sourceSummary"], null));
    }
    if (sourceSummary?.aiBlocked) {
        issues.push(buildIssue("EVAL-CONTEXT-IDENTITY-CONFLICT", "AI is blocked for the conversation and affects commercial evaluation.", "context", "warning", ["commercialContextSummary", "sourceSummary"], null));
    }
    if (summary.policyStatus === "failed_safe") {
        issues.push(buildIssue("EVAL-POLICY-MISSING", "Commercial Policy failed safe.", "policy", "critical", ["policySummary"], null));
    }
    if (summary.policyStatus === "blocked" && shadowResult.governedResultSummary?.shouldRespondNow) {
        issues.push(buildIssue("EVAL-POLICY-OVERRESTRICTIVE", "Policy blocked a proposal that still looks actionable.", "policy", "warning", ["policySummary"], null));
    }
    else if (summary.policyStatus === "blocked") {
        issues.push(buildIssue("EVAL-POLICY-CORRECT-BLOCK", "Policy correctly blocked unsafe content.", "policy", "info", ["policySummary"], null));
    }
    if (metrics.confidence === "low") {
        issues.push(buildIssue("EVAL-MODEL-LOW-CONFIDENCE", "The commercial model output is low confidence.", "runtime", "warning", ["runtimeSummary", "governedResultSummary"], null));
    }
    const claims = extractKnownClaims(shadowResult);
    const claimTypes = claims.map((claim) => claim.type);
    const hardBlockedClaims = claimTypes.filter((claimType) => isSensitiveClaimType(claimType) && !claims.some((claim) => claim.type === claimType && claim.verified));
    if (hardBlockedClaims.length > 0) {
        issues.push(buildIssue("EVAL-MODEL-HARD-BLOCK-PROPOSAL", "Model proposed sensitive claims without enough evidence.", "prompt", "critical", ["context", "claims"], { claimTypes: hardBlockedClaims }));
    }
    if ((claims.length === 0 && metrics.outcome !== "failed_safe") || (metrics.proposedActionsTotal === 0 && metrics.toolRequestsTotal === 0 && metrics.entityProposalsTotal === 0 && metrics.shouldRespondNow !== true)) {
        issues.push(buildIssue("EVAL-COMMERCIAL-NOT-USEFUL", "The governed output is not operationally useful.", "commercialUsefulness", "warning", ["governedResultSummary"], null));
    }
    else if (summary.shouldRespondNow === true && metrics.proposedActionsTotal === 0 && metrics.toolRequestsTotal === 0 && metrics.entityProposalsTotal === 0) {
        issues.push(buildIssue("EVAL-COMMERCIAL-PARTIALLY-USEFUL", "The output is useful but only partially actionable.", "commercialUsefulness", "info", ["governedResultSummary"], null));
    }
    if (shadowResult.metrics.providerRequestId === null && metrics.hasRuntimeResult) {
        issues.push(buildIssue("EVAL-OBSERVABILITY-INCOMPLETE", "Provider request ID is missing.", "observability", "warning", ["metrics"], null));
    }
    if (shadowResult.metrics.model === null && metrics.hasRuntimeResult) {
        issues.push(buildIssue("EVAL-OBSERVABILITY-INCOMPLETE", "Model name is missing.", "observability", "warning", ["metrics"], null));
    }
    if (shadowResult.metrics.estimatedCost === null) {
        issues.push(buildIssue("EVAL-OBSERVABILITY-INCOMPLETE", "Estimated cost is missing.", "observability", "warning", ["metrics"], null));
    }
    if (comparison && comparison.status === "divergent") {
        issues.push(buildIssue("EVAL-OBSERVABILITY-INCOMPLETE", "Productive decision diverges from the shadow result.", "comparison", "warning", ["productiveDecision"], { comparison: comparison.status }));
    }
    return issues;
}
function buildDimensionResults(shadowResult, metrics, issues, thresholds) {
    const issueCodesByDimension = new Map();
    for (const dimension of evaluationConstants_1.COMMERCIAL_EVALUATION_DIMENSIONS) {
        issueCodesByDimension.set(dimension, []);
    }
    for (const issue of issues) {
        const dimension = dimensionForComponent(issue.component);
        if (!dimension)
            continue;
        const list = issueCodesByDimension.get(dimension);
        if (list) {
            list.push(issue.code);
        }
    }
    const dimensions = {
        technicalValidity: buildDimensionResult("technicalValidity", metrics.sideEffectsCount > 0
            ? 0
            : shadowResult.status === "completed"
                ? 100
                : shadowResult.status === "completed_with_restrictions"
                    ? 82
                    : shadowResult.status === "skipped" || shadowResult.status === "disabled"
                        ? 15
                        : shadowResult.status === "timeout"
                            ? 5
                            : 20, issueCodesByDimension.get("technicalValidity") ?? [], [
            shadowResult.status,
            metrics.runtimeStatus ?? "",
            metrics.validationStatus ?? ""
        ], {
            shadowStatus: shadowResult.status,
            runtimeStatus: metrics.runtimeStatus,
            validationStatus: metrics.validationStatus
        }, shadowResult.status === "completed"
            ? "Shadow executed as completed without structural issues."
            : shadowResult.status === "completed_with_restrictions"
                ? "Shadow completed with restrictions."
                : "Shadow execution is not fully valid."),
        contextQuality: buildDimensionResult("contextQuality", shadowResult.commercialContextSummary?.completeness === "complete"
            ? 95
            : shadowResult.commercialContextSummary?.completeness === "partial"
                ? 75
                : shadowResult.commercialContextSummary?.completeness === "minimal"
                    ? 45
                    : 10, issueCodesByDimension.get("contextQuality") ?? [], shadowResult.commercialContextSummary
            ? [
                shadowResult.commercialContextSummary.completeness,
                shadowResult.commercialContextSummary.sourceSummary.hasLatestCustomerMessage ? "latest_customer_message" : "missing_latest_customer_message",
                shadowResult.commercialContextSummary.sourceSummary.hasCustomerReference ? "customer_reference" : "missing_customer_reference"
            ]
            : ["missing_context"], {
            completeness: shadowResult.commercialContextSummary?.completeness ?? null,
            sourceSummary: shadowResult.commercialContextSummary?.sourceSummary ?? null
        }, shadowResult.commercialContextSummary
            ? "Commercial context is available."
            : "Commercial context is missing or insufficient."),
        runtimeQuality: buildDimensionResult("runtimeQuality", metrics.runtimeStatus === "completed_valid"
            ? 100
            : metrics.runtimeStatus === "validation_failed_safe"
                ? 0
                : metrics.runtimeStatus === "timeout"
                    ? 0
                    : metrics.runtimeStatus === "provider_error" || metrics.runtimeStatus === "provider_unavailable"
                        ? 20
                        : metrics.runtimeStatus === "completed_failed_safe"
                            ? 30
                            : 50, issueCodesByDimension.get("runtimeQuality") ?? [], [
            metrics.runtimeStatus ?? "",
            metrics.validationStatus ?? "",
            metrics.outcome ?? ""
        ], {
            runtimeStatus: metrics.runtimeStatus,
            validationStatus: metrics.validationStatus,
            outcome: metrics.outcome,
            confidence: metrics.confidence
        }, metrics.runtimeStatus === "completed_valid"
            ? "Runtime produced a structurally valid result."
            : "Runtime quality needs attention."),
        policyQuality: buildDimensionResult("policyQuality", metrics.policyStatus === "allowed"
            ? 100
            : metrics.policyStatus === "allowed_with_restrictions"
                ? 75
                : metrics.policyStatus === "requires_review"
                    ? 58
                    : metrics.policyStatus === "blocked"
                        ? 35
                        : metrics.policyStatus === "failed_safe"
                            ? 0
                            : 20, issueCodesByDimension.get("policyQuality") ?? [], [
            metrics.policyStatus ?? "",
            metrics.overallDecision ?? "",
            ...metrics.appliedPolicyRules
        ], {
            policyStatus: metrics.policyStatus,
            overallDecision: metrics.overallDecision,
            appliedPolicyRules: metrics.appliedPolicyRules
        }, metrics.policyStatus === "allowed"
            ? "Policy allowed the governed result."
            : metrics.policyStatus === "blocked"
                ? "Policy blocked the governed result."
                : "Policy behavior requires tuning."),
        commercialUsefulness: buildDimensionResult("commercialUsefulness", metrics.shouldRespondNow && metrics.outcome === "response_proposed"
            ? 100
            : metrics.outcome === "tool_required"
                ? 80
                : metrics.outcome === "waiting_for_customer"
                    ? 55
                    : metrics.outcome === "blocked_by_policy"
                        ? 30
                        : metrics.outcome === "failed_safe"
                            ? 0
                            : 40, issueCodesByDimension.get("commercialUsefulness") ?? [], [
            metrics.outcome ?? "",
            metrics.shouldRespondNow ? "respond_now" : "no_respond"
        ], {
            outcome: metrics.outcome,
            shouldRespondNow: metrics.shouldRespondNow,
            claimsTotal: metrics.claimsTotal,
            proposedActionsTotal: metrics.proposedActionsTotal,
            toolRequestsTotal: metrics.toolRequestsTotal,
            entityProposalsTotal: metrics.entityProposalsTotal
        }, metrics.shouldRespondNow || metrics.proposedActionsTotal > 0 || metrics.toolRequestsTotal > 0 || metrics.entityProposalsTotal > 0
            ? "The governed output has operational value."
            : "The governed output is not actionable."),
        safety: buildDimensionResult("safety", metrics.sideEffectsCount > 0 || issues.some((issue) => issue.code === "EVAL-SAFETY-SECRET-EXPOSURE") ? 0 : 100, issueCodesByDimension.get("safety") ?? [], [
            `sideEffects=${metrics.sideEffectsCount}`,
            shadowResult.enabled ? "shadow_enabled" : "shadow_disabled"
        ], {
            sideEffectsCount: metrics.sideEffectsCount,
            warningsCount: metrics.warningsCount
        }, metrics.sideEffectsCount === 0 ? "No side effects observed." : "Side effects were observed."),
        latency: buildDimensionResult("latency", metrics.durationTotalMs === null
            ? 30
            : metrics.durationTotalMs <= thresholds.maximumP95LatencyMs * 0.5
                ? 100
                : metrics.durationTotalMs <= thresholds.maximumP95LatencyMs * 0.75
                    ? 80
                    : metrics.durationTotalMs <= thresholds.maximumP95LatencyMs
                        ? 60
                        : metrics.durationTotalMs <= thresholds.maximumP95LatencyMs * 2
                            ? 30
                            : 0, issueCodesByDimension.get("latency") ?? [], [metrics.durationTotalMs === null ? "unknown_latency" : `duration=${metrics.durationTotalMs}`], {
            durationTotalMs: metrics.durationTotalMs,
            threshold: thresholds.maximumP95LatencyMs
        }, metrics.durationTotalMs === null ? "Latency data is incomplete." : "Latency is measurable."),
        cost: buildDimensionResult("cost", metrics.estimatedCost === null
            ? 70
            : metrics.estimatedCost <= thresholds.maximumAverageCost
                ? 100
                : metrics.estimatedCost <= thresholds.maximumAverageCost * 2
                    ? 45
                    : 0, issueCodesByDimension.get("cost") ?? [], [metrics.estimatedCost === null ? "unknown_cost" : `cost=${metrics.estimatedCost}`], {
            estimatedCost: metrics.estimatedCost,
            threshold: thresholds.maximumAverageCost
        }, metrics.estimatedCost === null ? "Cost is currently unknown." : "Cost is measurable."),
        observability: buildDimensionResult("observability", [
            metrics.hasRuntimeResult,
            metrics.hasValidationResult,
            metrics.hasPolicyResult,
            metrics.hasCommercialContext,
            metrics.inputTokens !== null,
            metrics.outputTokens !== null,
            metrics.provider !== null,
            metrics.model !== null
        ].filter(Boolean).length * 12.5, issueCodesByDimension.get("observability") ?? [], [
            metrics.hasRuntimeResult ? "runtime" : "missing_runtime",
            metrics.hasValidationResult ? "validation" : "missing_validation",
            metrics.hasPolicyResult ? "policy" : "missing_policy"
        ], {
            hasRuntimeResult: metrics.hasRuntimeResult,
            hasValidationResult: metrics.hasValidationResult,
            hasPolicyResult: metrics.hasPolicyResult,
            hasCommercialContext: metrics.hasCommercialContext
        }, metrics.hasRuntimeResult && metrics.hasValidationResult && metrics.hasPolicyResult
            ? "Observability is sufficient."
            : "Observability is incomplete."),
        readinessContribution: buildDimensionResult("readinessContribution", 0, issueCodesByDimension.get("readinessContribution") ?? [], [], {
            placeholder: true
        }, "Composite readiness signal.")
    };
    dimensions.readinessContribution.score = clampScore(dimensions.technicalValidity.score * 0.2 +
        dimensions.contextQuality.score * 0.15 +
        dimensions.runtimeQuality.score * 0.15 +
        dimensions.policyQuality.score * 0.15 +
        dimensions.commercialUsefulness.score * 0.15 +
        dimensions.safety.score * 0.15 +
        dimensions.latency.score * 0.05 +
        dimensions.cost.score * 0.03 +
        dimensions.observability.score * 0.02);
    dimensions.readinessContribution.severity = scoreToSeverity(dimensions.readinessContribution.score);
    dimensions.readinessContribution.summary = "Composite readiness signal.";
    dimensions.readinessContribution.details = {
        technicalValidity: dimensions.technicalValidity.score,
        contextQuality: dimensions.contextQuality.score,
        runtimeQuality: dimensions.runtimeQuality.score,
        policyQuality: dimensions.policyQuality.score,
        commercialUsefulness: dimensions.commercialUsefulness.score,
        safety: dimensions.safety.score,
        latency: dimensions.latency.score,
        cost: dimensions.cost.score,
        observability: dimensions.observability.score
    };
    return dimensions;
}
function buildWarnings(issues, shadowResult) {
    return (0, evaluationUtils_1.uniqueStrings)([
        ...shadowResult.warnings,
        ...issues.filter((issue) => issue.severity !== "critical").map((issue) => issue.code),
        ...(shadowResult.error?.message ? ["shadow_error"] : [])
    ]);
}
function buildStatus(issues, shadowResult, metrics) {
    if (!(0, evaluationUtils_1.isRecord)(shadowResult) || !(0, evaluationUtils_1.isRecord)(shadowResult.metrics))
        return "invalid_input";
    if (issues.some((issue) => issue.severity === "critical"))
        return "failed_safe";
    if (shadowResult.status === "disabled" || shadowResult.status === "skipped")
        return "insufficient_data";
    if (issues.length === 0)
        return "evaluated";
    if (!metrics.hasPolicyResult || !metrics.hasRuntimeResult || !metrics.hasValidationResult || !metrics.hasCommercialContext)
        return "insufficient_data";
    return "evaluated_with_warnings";
}
function evaluateCommercialShadowResult(input) {
    const timestamp = (0, evaluationUtils_1.toIsoString)(input.timestamp);
    const shadowResult = input.shadowResult;
    const versionInfo = buildVersionInfo(shadowResult);
    const summary = buildShadowSummary(shadowResult);
    const thresholds = {
        ...evaluationConstants_1.COMMERCIAL_EVALUATION_DEFAULT_THRESHOLDS,
        ...(input.thresholds ?? {})
    };
    const metrics = buildMetrics(shadowResult, summary);
    const comparison = buildComparison(shadowResult, input.productiveDecision ?? null);
    metrics.hasComparison = comparison !== null;
    metrics.hasReviewerAssessment = Boolean(input.reviewerAssessment);
    const issues = buildIssues(shadowResult, summary, metrics, comparison);
    const dimensions = buildDimensionResults(shadowResult, metrics, issues, thresholds);
    const classification = (0, classifyCommercialFailure_1.classifyCommercialFailure)({
        issues,
        metrics,
        dimensions,
        shadowResultSummary: summary,
        comparison
    });
    const status = buildStatus(issues, shadowResult, metrics);
    const warnings = buildWarnings(issues, shadowResult);
    const recommendations = buildRecommendations(classification, issues);
    const metadataSanitization = (0, evaluationUtils_1.sanitizeEvaluationValue)({
        sampleId: input.sampleId,
        scenario: input.scenario,
        expectedTags: [...input.expectedTags],
        metadata: input.metadata ?? {},
        reviewerAssessment: input.reviewerAssessment ?? null,
        productiveDecision: input.productiveDecision ?? null
    }, {
        maxStringLength: MAX_STRING_LENGTH,
        maxDepth: MAX_DEPTH,
        maxBytes: MAX_METADATA_BYTES
    });
    return {
        sampleId: input.sampleId,
        timestamp,
        scenario: input.scenario,
        expectedTags: (0, evaluationUtils_1.uniqueStrings)([...input.expectedTags]),
        status,
        shadowResultSummary: summary,
        metrics,
        dimensions,
        classification,
        comparison,
        reviewerAssessment: input.reviewerAssessment ?? null,
        issues,
        warnings,
        recommendations,
        versionInfo,
        metadata: (0, evaluationUtils_1.isRecord)(metadataSanitization.value) ? metadataSanitization.value : {}
    };
}
