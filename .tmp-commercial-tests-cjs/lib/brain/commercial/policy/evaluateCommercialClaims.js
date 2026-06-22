"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateCommercialClaims = evaluateCommercialClaims;
const policyConstants_1 = require("./policyConstants");
const policyUtils_1 = require("./policyUtils");
function claimRuleId(claimType) {
    switch (claimType) {
        case "price":
            return "POLICY-CLAIM-PRICE-EVIDENCE";
        case "stock":
            return "POLICY-CLAIM-STOCK-FRESHNESS";
        case "delivery":
        case "dispatch":
            return "POLICY-CLAIM-DELIVERY-COMMITMENT";
        case "promotion":
            return "POLICY-CLAIM-DISCOUNT-APPROVAL";
        case "order_status":
            return "POLICY-CLAIM-ORDER-STATUS-SOURCE";
        default:
            return "POLICY-GOVERNANCE-APPROVAL";
    }
}
function freshnessForClaim(claim, evidence, currentTimeMs, volatility) {
    const explicitExpiry = claim.expiresAt ? (0, policyUtils_1.parseTime)(claim.expiresAt) : 0;
    if (explicitExpiry > 0 && explicitExpiry <= currentTimeMs) {
        return "stale";
    }
    const candidate = evidence.find((entry) => entry.expiresAt || entry.capturedAt) ?? null;
    if (!candidate) {
        return volatility === "stable" ? "unknown" : "stale";
    }
    const evidenceExpiry = candidate.expiresAt ? (0, policyUtils_1.parseTime)(candidate.expiresAt) : 0;
    if (evidenceExpiry > 0 && evidenceExpiry <= currentTimeMs) {
        return "stale";
    }
    const capturedAt = candidate.capturedAt ? (0, policyUtils_1.parseTime)(candidate.capturedAt) : 0;
    if (capturedAt <= 0) {
        return volatility === "stable" ? "unknown" : "stale";
    }
    const age = currentTimeMs - capturedAt;
    if (age <= policyConstants_1.COMMERCIAL_POLICY_RECENT_EVIDENCE_MAX_AGE_MS) {
        return "fresh";
    }
    if (age <= policyConstants_1.COMMERCIAL_POLICY_SEMI_VOLATILE_MAX_AGE_MS) {
        return "recent";
    }
    return "stale";
}
function approvalForClaim(claimType, freshness, volatility) {
    if (freshness === "stale")
        return "operator_review";
    if (claimType === "delivery" || claimType === "dispatch")
        return "explicit_operator_approval";
    if (claimType === "promotion")
        return "explicit_operator_approval";
    if (volatility === "highly_volatile")
        return "operator_review";
    if (volatility === "volatile" && freshness !== "fresh")
        return "operator_review";
    return "none";
}
function evaluateClaim(input, index, currentTimeMs) {
    const claim = input.salesAgentResult.responseProposal?.claims[index];
    if (!claim) {
        return {
            index,
            claim: {
                type: "general",
                value: "",
                evidenceSource: "customer_message",
                evidenceSummary: "",
                verified: false,
                confidence: "low",
                expiresAt: null
            },
            status: "blocked",
            decision: "remove",
            approvalRequirement: "blocked",
            riskLevel: "blocked",
            ruleIds: ["POLICY-GOVERNANCE-FAIL-CLOSED"],
            issues: [
                (0, policyUtils_1.buildPolicyIssue)("invalid_input", "Claim is missing from the validated result.", ["responseProposal", "claims", String(index)], "POLICY-GOVERNANCE-FAIL-CLOSED", null, "fatal")
            ],
            reason: "Claim is missing from the validated result.",
            volatility: "stable",
            freshness: "unknown",
            sensitive: false
        };
    }
    const volatility = (policyConstants_1.COMMERCIAL_POLICY_CLAIM_VOLATILITY_MAP[claim.type] ??
        (0, policyUtils_1.claimVolatilityForType)(claim.type));
    const freshness = freshnessForClaim(claim, input.salesAgentResult.evidence.filter((evidence) => evidence.source === claim.evidenceSource), currentTimeMs, volatility);
    const issues = [];
    const ruleIds = [claimRuleId(claim.type)];
    const sensitive = (0, policyUtils_1.isSensitiveClaimType)(claim.type);
    const sourceAllowed = (0, policyUtils_1.isStrongEvidenceSource)(claim.evidenceSource);
    const confidenceIsLow = claim.confidence === "low";
    const approval = approvalForClaim(claim.type, freshness, volatility);
    let decision = "allow";
    let status = "allowed";
    let risk = "low";
    let requiresApproval = approval;
    if (sensitive && !input.featureFlags.allowSensitiveClaims) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("sensitive_claim_blocked", "Sensitive claims are disabled by policy flags.", ["responseProposal", "claims", String(index)], ruleIds[0], { claimType: claim.type }, "warning"));
        status = "blocked";
        risk = "blocked";
        requiresApproval = "blocked";
        decision = "remove";
    }
    else if (sensitive && !sourceAllowed) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("claim_source_not_authorized", "Claim evidence source is not authorized for sensitive claims.", ["responseProposal", "claims", String(index)], ruleIds[0], { evidenceSource: claim.evidenceSource }, "error"));
        status = "blocked";
        risk = "blocked";
        requiresApproval = "blocked";
        decision = "remove";
    }
    else if (sensitive && !claim.verified) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("evidence_unverified", "Sensitive claim is not verified.", ["responseProposal", "claims", String(index)], ruleIds[0], { claimType: claim.type }, "error"));
        status = "blocked";
        risk = "blocked";
        requiresApproval = "blocked";
        decision = "remove";
    }
    else if (sensitive && freshness === "stale") {
        issues.push((0, policyUtils_1.buildPolicyIssue)("evidence_stale", "Sensitive claim evidence is stale.", ["responseProposal", "claims", String(index)], ruleIds[0], { claimType: claim.type }, "warning"));
        status = "review";
        risk = "high";
        requiresApproval = approval === "explicit_operator_approval" ? "explicit_operator_approval" : "operator_review";
        decision = "downgrade_to_review";
    }
    else if ((0, policyUtils_1.isSensitiveClaimType)(claim.type) && !claim.verified) {
        issues.push((0, policyUtils_1.buildPolicyIssue)("evidence_unverified", "Claim is not verified.", ["responseProposal", "claims", String(index)], ruleIds[0], { claimType: claim.type }, "warning"));
        status = "review";
        risk = "medium";
        requiresApproval = "operator_review";
        decision = "downgrade_to_review";
    }
    else if (sensitive && freshness === "unknown" && volatility !== "stable") {
        issues.push((0, policyUtils_1.buildPolicyIssue)("evidence_missing", "Sensitive claim lacks freshness evidence.", ["responseProposal", "claims", String(index)], ruleIds[0], { claimType: claim.type }, "warning"));
        status = "review";
        risk = volatility === "highly_volatile" ? "high" : "medium";
        requiresApproval = approval === "explicit_operator_approval" ? "explicit_operator_approval" : "operator_review";
        decision = "downgrade_to_review";
    }
    else if (claim.type === "delivery" || claim.type === "dispatch" || claim.type === "promotion") {
        status = "review";
        risk = "high";
        requiresApproval = "explicit_operator_approval";
        decision = "allow_with_approval";
        issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Sensitive commercial claim requires explicit approval.", ["responseProposal", "claims", String(index)], ruleIds[0], { claimType: claim.type }, "info"));
    }
    else if (volatility !== "stable" && freshness !== "fresh") {
        status = "review";
        risk = volatility === "highly_volatile" ? "high" : "medium";
        requiresApproval = approval === "none" ? "operator_review" : approval;
        decision = "allow_with_approval";
    }
    else if (confidenceIsLow) {
        status = "review";
        risk = "medium";
        requiresApproval = "operator_review";
        decision = "allow_with_approval";
        issues.push((0, policyUtils_1.buildPolicyIssue)("action_requires_approval", "Low confidence claim requires review.", ["responseProposal", "claims", String(index)], ruleIds[0], { claimType: claim.type }, "info"));
    }
    else {
        decision = "allow";
    }
    return {
        index,
        claim,
        status,
        decision,
        approvalRequirement: requiresApproval,
        riskLevel: risk,
        ruleIds: (0, policyUtils_1.uniqueRuleIds)(ruleIds),
        issues,
        reason: issues[0]?.message ?? "Claim complies with policy.",
        volatility,
        freshness,
        sensitive
    };
}
function evaluateCommercialClaims(input) {
    const currentTimeMs = (0, policyUtils_1.parseTime)(input.currentTime);
    const claims = input.salesAgentResult.responseProposal?.claims ?? [];
    const assessments = claims.map((_, index) => evaluateClaim(input, index, currentTimeMs));
    const blockedClaims = assessments.filter((assessment) => assessment.status === "blocked").map((assessment) => assessment.claim);
    const keptClaims = assessments.filter((assessment) => assessment.status !== "blocked").map((assessment) => assessment.claim);
    const issues = assessments.flatMap((assessment) => assessment.issues);
    const warnings = (0, policyUtils_1.uniqueStrings)(assessments.flatMap((assessment) => assessment.issues.filter((issue) => issue.level === "warning").map((issue) => issue.code)));
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
        keptClaims,
        blockedClaims,
        assessments,
        issues,
        warnings,
        appliedRules: [...appliedRules],
        riskLevel,
        requiresApproval
    };
}
