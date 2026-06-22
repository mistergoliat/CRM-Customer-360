"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCommercialShadowReview = buildCommercialShadowReview;
const adapters_1 = require("../context/adapters");
const policyConstants_1 = require("../policy/policyConstants");
const runtimeTypes_1 = require("../sales-agent/runtimeTypes");
const shadowConstants_1 = require("../shadow/shadowConstants");
const COMMERCIAL_SHADOW_REVIEW_BUILDER_VERSION = "brain.commercial.review.v1";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function toIsoString(value) {
    if (value === null || value === undefined || value === "")
        return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function asText(value, maxLength = 4000) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed)
            return null;
        return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }
    return null;
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
}
function sanitizeErrorMessage(value) {
    const text = asText(value, 1000) ?? "Commercial shadow review failed.";
    return text
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
        .replace(/\b(sk-[A-Za-z0-9_-]+)\b/gi, "[redacted]")
        .replace(/\b(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]");
}
function sanitizeMetadata(metadata) {
    const sanitized = (0, adapters_1.sanitizeCommercialObject)(metadata ?? {});
    return {
        value: sanitized.value ?? {},
        applied: sanitized.applied,
        sanitizedFields: sanitized.sanitizedFields
    };
}
function buildIdentifiers(input) {
    return {
        correlationId: input.correlationId ?? null,
        processInboundRunId: input.processInboundRunId ?? null,
        salesAgentRunId: input.salesAgentRunId ?? null,
        caseId: input.identifiers.caseId,
        conversationCaseId: input.identifiers.conversationCaseId,
        waId: input.identifiers.waId,
        email: input.identifiers.email,
        phone: input.identifiers.phone,
        idCustomer: input.identifiers.idCustomer,
        idOrder: input.identifiers.idOrder,
        invoiceNumber: input.identifiers.invoiceNumber
    };
}
function createEmptyInvariants() {
    return {
        shadow: true,
        dryRun: true,
        outboundExecuted: false,
        toolsExecuted: 0,
        commercialDbWrites: 0,
        leadCreated: false,
        opportunityCreated: false,
        caseMutated: false,
        controlsResponsePolicy: false,
        violationDetected: false,
        violations: []
    };
}
function mapClaim(claim, status, reason) {
    return {
        status,
        type: claim.type,
        value: asText(claim.value, 2000),
        verified: claim.verified,
        confidence: claim.confidence,
        evidenceSource: claim.evidenceSource,
        evidenceSummary: asText(claim.evidenceSummary, 2000),
        evidenceReference: asText(claim.evidenceReference, 500),
        expiresAt: toIsoString(claim.expiresAt),
        reason
    };
}
function mapAction(action, status, reason) {
    return {
        status,
        type: action.type,
        priority: action.priority,
        confidence: action.confidence,
        riskLevel: action.riskLevel,
        requiresApproval: action.requiresApproval,
        reason: asText(action.reason, 2000),
        blockedReason: status === "blocked" ? reason : null,
        policyTags: uniqueStrings(action.policyTags ?? []),
        expiresAt: toIsoString(action.expiresAt),
        idempotencyHint: asText(action.idempotencyHint, 500)
    };
}
function mapToolRequest(request, status, available, reason) {
    return {
        status,
        tool: request.tool,
        purpose: asText(request.purpose, 2000),
        available,
        blocking: Boolean(request.blocking),
        reason: status === "blocked" ? reason ?? asText(request.reason, 2000) : asText(request.reason, 2000),
        urgency: request.urgency,
        statusLabel: request.status,
        fallbackDecision: request.fallbackDecision,
        expectedEvidence: uniqueStrings(request.expectedEvidence ?? []),
        requiredInputs: isRecord(request.requiredInputs) ? (0, adapters_1.sanitizeCommercialObject)(request.requiredInputs).value ?? {} : {}
    };
}
function mapEntityProposal(proposal, status, reason) {
    return {
        status,
        entityType: proposal.entityType,
        confidence: proposal.confidence,
        requiresApproval: proposal.requiresApproval,
        reason: asText(proposal.reason, 2000),
        blockedReason: status === "blocked" ? reason : null,
        policyTags: uniqueStrings(proposal.policyTags ?? []),
        expiresAt: toIsoString(proposal.expiresAt),
        idempotencyHint: asText(proposal.idempotencyHint, 500),
        proposedChangeKeys: isRecord(proposal.proposedChanges) ? uniqueStrings(Object.keys(proposal.proposedChanges)) : []
    };
}
function mapPolicyIssues(issues) {
    return issues.map((issue) => ({
        code: issue.code,
        level: issue.level,
        message: asText(issue.message, 2000) ?? "",
        path: uniqueStrings(issue.path),
        ruleId: issue.ruleId ?? null,
        details: isRecord(issue.details) ? (0, adapters_1.sanitizeCommercialObject)(issue.details).value ?? {} : null
    }));
}
function buildPolicyTrace(policyResult, evaluationResult, shadowResult) {
    const blockedRuleIds = policyResult
        ? uniqueStrings([
            ...policyResult.claimAssessments.flatMap((assessment) => (assessment.status === "blocked" ? assessment.ruleIds : [])),
            ...policyResult.actionAssessments.flatMap((assessment) => (assessment.status === "blocked" ? assessment.ruleIds : [])),
            ...policyResult.toolRequestAssessments.flatMap((assessment) => (assessment.status === "blocked" ? assessment.ruleIds : [])),
            ...policyResult.entityProposalAssessments.flatMap((assessment) => (assessment.status === "blocked" ? assessment.ruleIds : []))
        ])
        : [];
    const hardBlocks = policyResult
        ? uniqueStrings([
            ...blockedRuleIds,
            ...policyResult.issues.filter((issue) => issue.level === "error" || issue.level === "fatal").map((issue) => issue.code)
        ])
        : [];
    return {
        appliedRuleIds: policyResult ? uniqueStrings(policyResult.appliedRules) : [],
        hardBlocks,
        warnings: policyResult ? uniqueStrings(policyResult.warnings) : [],
        issues: policyResult ? mapPolicyIssues(policyResult.issues) : [],
        versions: {
            contractVersion: policyResult?.metadata.contractVersion ?? null,
            policyVersion: policyResult?.metadata.policyVersion ?? policyConstants_1.COMMERCIAL_POLICY_VERSION,
            runtimeVersion: shadowResult.versions.runtimeVersion ?? null,
            promptVersion: shadowResult.versions.promptVersion ?? null,
            evaluationVersion: evaluationResult?.versionInfo.evaluationVersion ?? null
        }
    };
}
function buildSummary(shadowResult, policyResult) {
    const runtimeResult = shadowResult.context?.runtimeResult ?? null;
    const governedResult = policyResult?.governedResult ?? runtimeResult?.result ?? null;
    const proposedResult = runtimeResult?.result ?? null;
    return {
        shadowStatus: shadowResult.status,
        runtimeStatus: runtimeResult?.status ?? null,
        validationStatus: runtimeResult?.validation.status ?? null,
        proposedOutcome: proposedResult?.outcome ?? null,
        governedOutcome: governedResult?.outcome ?? null,
        proposedConfidence: proposedResult?.analysis.confidence ?? null,
        governedConfidence: governedResult?.analysis.confidence ?? null,
        proposedResponse: asText(proposedResult?.responseProposal?.draftText, 2000),
        governedResponse: asText(governedResult?.responseProposal?.draftText, 2000),
        proposedShouldRespondNow: proposedResult?.shouldRespondNow ?? null,
        governedShouldRespondNow: governedResult?.shouldRespondNow ?? null,
        policyStatus: policyResult?.status ?? shadowResult.policySummary?.status ?? null,
        overallDecision: policyResult?.overallDecision ?? shadowResult.policySummary?.overallDecision ?? null,
        riskLevel: policyResult?.riskLevel ?? governedResult?.analysis.riskLevel ?? proposedResult?.analysis.riskLevel ?? null,
        approvalRequirement: policyResult?.requiresApproval ?? governedResult?.decision.requiresApproval ?? proposedResult?.decision.requiresApproval ?? null,
        claimsCount: proposedResult?.responseProposal?.claims?.length ?? 0,
        blockedClaimsCount: policyResult?.blockedClaims?.length ?? 0,
        actionsCount: proposedResult?.proposedActions?.length ?? 0,
        blockedActionsCount: policyResult?.blockedActions?.length ?? 0,
        toolRequestsCount: proposedResult?.toolRequests?.length ?? 0,
        blockedToolRequestsCount: policyResult?.blockedToolRequests?.length ?? 0,
        entityProposalsCount: proposedResult?.entityProposals?.length ?? 0,
        blockedEntityProposalsCount: policyResult?.blockedEntityProposals?.length ?? 0
    };
}
function buildObservability(shadowResult, evaluationResult) {
    const runtimeResult = shadowResult.context?.runtimeResult ?? null;
    const runtimeTokensIn = shadowResult.metrics.inputTokens ?? runtimeResult?.metrics.inputTokens ?? null;
    const runtimeTokensOut = shadowResult.metrics.outputTokens ?? runtimeResult?.metrics.outputTokens ?? null;
    const totalTokens = runtimeTokensIn !== null && runtimeTokensOut !== null ? runtimeTokensIn + runtimeTokensOut : null;
    return {
        totalLatencyMs: shadowResult.metrics.durationMs ?? null,
        contextLatencyMs: shadowResult.metrics.contextBuilderDurationMs ?? null,
        providerLatencyMs: shadowResult.metrics.providerDurationMs ?? runtimeResult?.metrics.providerDurationMs ?? null,
        runtimeLatencyMs: shadowResult.metrics.runtimeDurationMs ?? null,
        validationLatencyMs: shadowResult.metrics.validationDurationMs ?? null,
        policyLatencyMs: shadowResult.metrics.policyDurationMs ?? null,
        inputTokens: runtimeTokensIn,
        outputTokens: runtimeTokensOut,
        totalTokens,
        estimatedCost: shadowResult.metrics.estimatedCost ?? runtimeResult?.metrics.estimatedCost ?? null,
        currency: shadowResult.metrics.estimatedCost === null ? null : "USD",
        provider: runtimeResult?.provider.name ?? shadowResult.runtimeSummary?.providerName ?? null,
        model: shadowResult.metrics.model ?? runtimeResult?.provider.model ?? null,
        timeout: shadowResult.status === "timeout" || Boolean(shadowResult.metrics.timedOut),
        providerFailure: shadowResult.error?.code ??
            (runtimeResult?.status === "provider_unavailable"
                ? "provider_unavailable"
                : runtimeResult?.status === "provider_error"
                    ? "provider_error"
                    : runtimeResult?.status === "timeout"
                        ? "timeout"
                        : null),
        readinessStatus: evaluationResult?.status ?? null,
        readinessDecision: null,
        usefulness: evaluationResult?.classification.usefulness ?? null,
        comparisonStatus: evaluationResult?.comparison?.status ?? null
    };
}
function buildEvaluation(shadowResult, evaluationResult) {
    const status = shadowResult.status === "failed_safe" ? "failed_safe" : evaluationResult?.status ?? null;
    const reportStatus = status ?? (evaluationResult ? evaluationResult.status : null);
    return {
        status,
        readinessDecision: null,
        usefulness: evaluationResult?.classification.usefulness ?? null,
        comparisonStatus: evaluationResult?.comparison?.status ?? null,
        reportSummary: evaluationResult?.warnings?.length ? `${reportStatus} (${evaluationResult.warnings.length} warnings)` : reportStatus
    };
}
function buildAvailableWarnings(inputWarnings, shadowResult, policyResult, evaluationResult) {
    return uniqueStrings([
        ...(inputWarnings ?? []),
        ...shadowResult.warnings,
        ...(shadowResult.error?.code ? [shadowResult.error.code] : []),
        ...(policyResult?.warnings ?? []),
        ...(evaluationResult?.warnings ?? [])
    ]);
}
function buildAvailableInvariants(shadowResult) {
    const violations = [
        ...(shadowResult.sideEffects.messagesSent !== 0 ? ["messages_sent"] : []),
        ...(shadowResult.sideEffects.toolsExecuted !== 0 ? ["tools_executed"] : []),
        ...(shadowResult.sideEffects.databaseWrites !== 0 ? ["database_writes"] : []),
        ...(shadowResult.sideEffects.outboxWrites !== 0 ? ["outbox_writes"] : []),
        ...(shadowResult.sideEffects.leadsCreated !== 0 ? ["leads_created"] : []),
        ...(shadowResult.sideEffects.opportunitiesCreated !== 0 ? ["opportunities_created"] : []),
        ...(shadowResult.sideEffects.casesMutated !== 0 ? ["cases_mutated"] : []),
        ...(shadowResult.sideEffects.messagesSent !== 0 ||
            shadowResult.sideEffects.toolsExecuted !== 0 ||
            shadowResult.sideEffects.databaseWrites !== 0 ||
            shadowResult.sideEffects.outboxWrites !== 0 ||
            shadowResult.sideEffects.leadsCreated !== 0 ||
            shadowResult.sideEffects.opportunitiesCreated !== 0 ||
            shadowResult.sideEffects.casesMutated !== 0
            ? ["zero_side_effect_invariant_broken"]
            : [])
    ];
    return {
        shadow: true,
        dryRun: true,
        outboundExecuted: false,
        toolsExecuted: 0,
        commercialDbWrites: 0,
        leadCreated: false,
        opportunityCreated: false,
        caseMutated: false,
        controlsResponsePolicy: false,
        violationDetected: violations.length > 0,
        violations: uniqueStrings(violations)
    };
}
function buildAvailableMetadata(input, shadowResult, policyResult, evaluationResult) {
    const sanitized = sanitizeMetadata(input.metadata ?? null);
    return {
        ...sanitized.value,
        review: {
            builderVersion: COMMERCIAL_SHADOW_REVIEW_BUILDER_VERSION,
            sourceStatus: input.status,
            shadowVersion: shadowResult.versions.shadowVersion ?? shadowConstants_1.COMMERCIAL_SHADOW_VERSION,
            runtimeVersion: shadowResult.versions.runtimeVersion ?? runtimeTypes_1.SALES_AGENT_RUNTIME_VERSION,
            policyVersion: shadowResult.versions.policyVersion ?? policyConstants_1.COMMERCIAL_POLICY_VERSION,
            promptVersion: shadowResult.versions.promptVersion ?? runtimeTypes_1.SALES_AGENT_PROMPT_VERSION,
            evaluationVersion: evaluationResult?.versionInfo.evaluationVersion ?? null,
            hasPolicyResult: Boolean(policyResult),
            hasEvaluationResult: Boolean(evaluationResult),
            sanitized: sanitized.applied,
            sanitizedFields: sanitized.sanitizedFields
        }
    };
}
function buildUnavailableMetadata(input) {
    const sanitized = sanitizeMetadata(input.metadata ?? null);
    return {
        ...sanitized.value,
        review: {
            builderVersion: COMMERCIAL_SHADOW_REVIEW_BUILDER_VERSION,
            sourceStatus: input.status,
            reason: "reason" in input ? input.reason ?? null : null,
            sanitized: sanitized.applied,
            sanitizedFields: sanitized.sanitizedFields
        }
    };
}
function buildUnavailableReview(input) {
    const warnings = uniqueStrings([...(input.warnings ?? [])]);
    return {
        status: input.status,
        observedAt: toIsoString(input.observedAt ?? null),
        identifiers: buildIdentifiers(input),
        summary: null,
        claims: { detected: [], allowed: [], blocked: [] },
        actions: { proposed: [], blocked: [] },
        toolRequests: { proposed: [], blocked: [] },
        entityProposals: { proposed: [], blocked: [] },
        policy: {
            appliedRuleIds: [],
            hardBlocks: [],
            warnings: [],
            issues: [],
            versions: {
                contractVersion: null,
                policyVersion: null,
                runtimeVersion: null,
                promptVersion: null,
                evaluationVersion: null
            }
        },
        observability: {
            totalLatencyMs: null,
            contextLatencyMs: null,
            providerLatencyMs: null,
            runtimeLatencyMs: null,
            validationLatencyMs: null,
            policyLatencyMs: null,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            estimatedCost: null,
            currency: null,
            provider: null,
            model: null,
            timeout: null,
            providerFailure: null,
            readinessStatus: null,
            readinessDecision: null,
            usefulness: null,
            comparisonStatus: null
        },
        evaluation: {
            status: null,
            readinessDecision: null,
            usefulness: null,
            comparisonStatus: null,
            reportSummary: null
        },
        invariants: createEmptyInvariants(),
        warnings,
        error: null,
        metadata: buildUnavailableMetadata(input)
    };
}
function buildErrorReview(input) {
    const warnings = uniqueStrings([...(input.warnings ?? [])]);
    const error = input.error
        ? {
            code: input.reason ? "read_error" : "unknown_error",
            message: sanitizeErrorMessage(input.error),
            stage: input.reason ?? null
        }
        : {
            code: "read_error",
            message: input.reason ? sanitizeErrorMessage(input.reason) : "Commercial shadow review failed to load.",
            stage: input.reason ?? null
        };
    return {
        status: "error",
        observedAt: toIsoString(input.observedAt ?? null),
        identifiers: buildIdentifiers(input),
        summary: null,
        claims: { detected: [], allowed: [], blocked: [] },
        actions: { proposed: [], blocked: [] },
        toolRequests: { proposed: [], blocked: [] },
        entityProposals: { proposed: [], blocked: [] },
        policy: {
            appliedRuleIds: [],
            hardBlocks: [],
            warnings: [],
            issues: [],
            versions: {
                contractVersion: null,
                policyVersion: null,
                runtimeVersion: null,
                promptVersion: null,
                evaluationVersion: null
            }
        },
        observability: {
            totalLatencyMs: null,
            contextLatencyMs: null,
            providerLatencyMs: null,
            runtimeLatencyMs: null,
            validationLatencyMs: null,
            policyLatencyMs: null,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            estimatedCost: null,
            currency: null,
            provider: null,
            model: null,
            timeout: null,
            providerFailure: null,
            readinessStatus: null,
            readinessDecision: null,
            usefulness: null,
            comparisonStatus: null
        },
        evaluation: {
            status: null,
            readinessDecision: null,
            usefulness: null,
            comparisonStatus: null,
            reportSummary: null
        },
        invariants: createEmptyInvariants(),
        warnings,
        error,
        metadata: buildUnavailableMetadata(input)
    };
}
function mapClaimArrays(shadowResult, policyResult) {
    const runtimeClaims = shadowResult.context?.runtimeResult?.result.responseProposal?.claims ?? [];
    const governedClaims = policyResult?.governedResult.responseProposal?.claims ?? [];
    const blockedAssessments = policyResult?.claimAssessments.filter((assessment) => assessment.status === "blocked") ?? [];
    const blockedClaims = blockedAssessments.map((assessment) => mapClaim(assessment.claim, "blocked", assessment.reason));
    return {
        detected: runtimeClaims.map((claim) => mapClaim(claim, "detected", null)),
        allowed: governedClaims.map((claim) => mapClaim(claim, "allowed", null)),
        blocked: blockedClaims
    };
}
function mapActionArrays(shadowResult, policyResult) {
    const runtimeActions = shadowResult.context?.runtimeResult?.result.proposedActions ?? [];
    const governedActions = policyResult?.governedResult.proposedActions ?? [];
    const blockedAssessments = policyResult?.actionAssessments.filter((assessment) => assessment.status === "blocked") ?? [];
    const blockedActions = blockedAssessments.map((assessment) => mapAction(assessment.action, "blocked", assessment.reason));
    return {
        proposed: governedActions.length > 0 ? governedActions.map((action) => mapAction(action, "allowed", null)) : runtimeActions.map((action) => mapAction(action, "detected", null)),
        blocked: blockedActions
    };
}
function mapToolRequestArrays(shadowResult, policyResult) {
    const runtimeToolRequests = shadowResult.context?.runtimeResult?.result.toolRequests ?? [];
    const governedToolRequests = policyResult?.governedResult.toolRequests ?? [];
    const blockedAssessments = policyResult?.toolRequestAssessments.filter((assessment) => assessment.status === "blocked") ?? [];
    const blockedToolRequests = blockedAssessments.map((assessment) => mapToolRequest(assessment.toolRequest, "blocked", false, assessment.reason));
    return {
        proposed: governedToolRequests.length > 0
            ? governedToolRequests.map((request) => mapToolRequest(request, "allowed", true, null))
            : runtimeToolRequests.map((request) => mapToolRequest(request, "detected", null, null)),
        blocked: blockedToolRequests
    };
}
function mapEntityProposalArrays(shadowResult, policyResult) {
    const runtimeEntityProposals = shadowResult.context?.runtimeResult?.result.entityProposals ?? [];
    const governedEntityProposals = policyResult?.governedResult.entityProposals ?? [];
    const blockedAssessments = policyResult?.entityProposalAssessments.filter((assessment) => assessment.status === "blocked") ?? [];
    const blockedEntityProposals = blockedAssessments.map((assessment) => mapEntityProposal(assessment.entityProposal, "blocked", assessment.reason));
    return {
        proposed: governedEntityProposals.length > 0
            ? governedEntityProposals.map((proposal) => mapEntityProposal(proposal, "allowed", null))
            : runtimeEntityProposals.map((proposal) => mapEntityProposal(proposal, "detected", null)),
        blocked: blockedEntityProposals
    };
}
function buildAvailableReview(input) {
    const shadowResult = input.shadowResult;
    const policyResult = shadowResult.context?.policyResult ?? null;
    const evaluationResult = input.evaluationResult ?? null;
    const summary = buildSummary(shadowResult, policyResult);
    const claims = mapClaimArrays(shadowResult, policyResult);
    const actions = mapActionArrays(shadowResult, policyResult);
    const toolRequests = mapToolRequestArrays(shadowResult, policyResult);
    const entityProposals = mapEntityProposalArrays(shadowResult, policyResult);
    const observability = buildObservability(shadowResult, evaluationResult);
    const evaluation = buildEvaluation(shadowResult, evaluationResult);
    const policy = buildPolicyTrace(policyResult, evaluationResult, shadowResult);
    const warnings = buildAvailableWarnings(input.warnings, shadowResult, policyResult, evaluationResult);
    const invariants = buildAvailableInvariants(shadowResult);
    const metadata = buildAvailableMetadata(input, shadowResult, policyResult, evaluationResult);
    return {
        status: "available",
        observedAt: toIsoString(input.observedAt ?? shadowResult.observedAt ?? null),
        identifiers: buildIdentifiers(input),
        summary,
        claims,
        actions,
        toolRequests,
        entityProposals,
        policy,
        observability,
        evaluation,
        invariants,
        warnings,
        error: shadowResult.error
            ? {
                code: shadowResult.error.code,
                message: sanitizeErrorMessage(shadowResult.error.message),
                stage: shadowResult.error.stage
            }
            : null,
        metadata
    };
}
function buildCommercialShadowReview(input) {
    if (input.status === "available") {
        return buildAvailableReview(input);
    }
    if (input.status === "error") {
        return buildErrorReview(input);
    }
    return buildUnavailableReview(input);
}
