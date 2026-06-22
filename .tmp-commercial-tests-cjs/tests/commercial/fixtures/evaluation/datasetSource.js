"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMERCIAL_EVALUATION_SYNTHETIC_SAMPLE_SPECS = exports.COMMERCIAL_EVALUATION_SYNTHETIC_DATASET = void 0;
exports.buildCommercialEvaluationSyntheticDataset = buildCommercialEvaluationSyntheticDataset;
const fixtures_1 = require("../../fixtures");
const BASE_PROFILE = {
    status: "completed_with_restrictions",
    eligible: true,
    skipReason: null,
    completeness: "partial",
    runtimeStatus: "completed_valid",
    validationStatus: "valid",
    policyStatus: "requires_review",
    overallDecision: "allow_with_approval",
    outcome: "response_proposed",
    riskLevel: "medium",
    approvalRequirement: "operator_review",
    shouldRespondNow: false,
    confidence: "medium",
    claimProfile: [],
    blockedClaimProfile: [],
    actionProfile: [],
    blockedActionProfile: [],
    toolProfile: [],
    blockedToolProfile: [],
    entityProfile: [],
    blockedEntityProfile: [],
    sourceSummary: {
        hasLatestCustomerMessage: true,
        hasCustomerReference: true,
        hasConversationHistory: true,
        humanOwnershipActive: false,
        aiBlocked: false,
        manualReplyActive: false,
        hasCommercialEntity: false
    },
    comparisonStatus: "not_comparable",
    durationMs: 1200,
    contextDurationMs: 120,
    runtimeDurationMs: 420,
    validationDurationMs: 60,
    policyDurationMs: 180,
    inputTokens: 120,
    outputTokens: 180,
    estimatedCost: 0.01,
    providerName: "fake-sales-agent-provider",
    providerVersion: "fake-provider.v1",
    providerRequestId: "fake-provider-request-id",
    model: "fake-sales-agent-model",
    warnings: [],
    issueCodes: [],
    appliedPolicyRules: [],
    executionDisposition: "discard_after_observation"
};
function cloneProfile(overrides = {}) {
    return {
        ...BASE_PROFILE,
        ...overrides,
        sourceSummary: {
            ...BASE_PROFILE.sourceSummary,
            ...(overrides.sourceSummary ?? {})
        },
        claimProfile: [...(overrides.claimProfile ?? BASE_PROFILE.claimProfile)],
        blockedClaimProfile: [...(overrides.blockedClaimProfile ?? BASE_PROFILE.blockedClaimProfile)],
        actionProfile: [...(overrides.actionProfile ?? BASE_PROFILE.actionProfile)],
        blockedActionProfile: [...(overrides.blockedActionProfile ?? BASE_PROFILE.blockedActionProfile)],
        toolProfile: [...(overrides.toolProfile ?? BASE_PROFILE.toolProfile)],
        blockedToolProfile: [...(overrides.blockedToolProfile ?? BASE_PROFILE.blockedToolProfile)],
        entityProfile: [...(overrides.entityProfile ?? BASE_PROFILE.entityProfile)],
        blockedEntityProfile: [...(overrides.blockedEntityProfile ?? BASE_PROFILE.blockedEntityProfile)],
        warnings: [...(overrides.warnings ?? BASE_PROFILE.warnings)],
        issueCodes: [...(overrides.issueCodes ?? BASE_PROFILE.issueCodes)],
        appliedPolicyRules: [...(overrides.appliedPolicyRules ?? BASE_PROFILE.appliedPolicyRules)]
    };
}
function toPolicyApprovalRequirement(value) {
    if (value === "none" || value === "blocked" || value === "operator_review" || value === "explicit_operator_approval") {
        return value;
    }
    return "operator_review";
}
function toSalesAgentApprovalRequirement(value) {
    if (value === "none" || value === "blocked" || value === "review" || value === "handoff") {
        return value;
    }
    return "review";
}
function buildClaims(profile) {
    return profile.claimProfile.map((claim) => ({
        type: claim.type,
        verified: claim.verified,
        evidenceSource: claim.verified ? "tool_result" : "customer_message",
        evidenceSummary: claim.verified ? "Verified synthetic evidence." : "Unverified synthetic claim.",
        evidenceReference: claim.verified ? `${claim.type}-evidence` : null,
        confidence: claim.verified ? "high" : "medium",
        value: `${claim.type} claim`,
        expiresAt: null
    }));
}
function buildBlockedClaims(profile) {
    return profile.blockedClaimProfile.map((claim) => ({
        type: claim.type,
        verified: claim.verified,
        evidenceSource: "customer_message",
        evidenceSummary: "Blocked synthetic claim.",
        evidenceReference: null,
        confidence: "low",
        value: `${claim.type} blocked claim`,
        expiresAt: null
    }));
}
function buildCounts(values) {
    return values.reduce((accumulator, value) => {
        accumulator[value] = (accumulator[value] ?? 0) + 1;
        return accumulator;
    }, {});
}
function buildCommercialContextSummary(profile) {
    return {
        status: (profile.completeness === "insufficient" ? "insufficient_context" : "success"),
        completeness: profile.completeness,
        warnings: profile.warnings.filter((warning) => !warning.startsWith("shadow_")),
        sourceSummary: {
            sourceShape: "brain_context",
            supportedContextShape: true,
            channel: "whatsapp",
            platform: "meta",
            department: "ventas",
            conversationCaseId: 4821,
            waId: "56912345678",
            email: "cliente@example.com",
            phone: "+56912345678",
            idCustomer: 10045,
            idOrder: 20001,
            invoiceNumber: 30001,
            contactId: 40001,
            caseStatus: profile.sourceSummary.hasLatestCustomerMessage ? "open" : "waiting",
            caseLifecycleStatus: profile.sourceSummary.hasLatestCustomerMessage ? "open" : "waiting",
            humanOwnershipActive: profile.sourceSummary.humanOwnershipActive,
            aiBlocked: profile.sourceSummary.aiBlocked,
            manualReplyActive: profile.sourceSummary.manualReplyActive,
            hasCustomerCandidate: profile.sourceSummary.hasLatestCustomerMessage,
            hasCustomerReference: profile.sourceSummary.hasCustomerReference,
            hasConversationHistory: profile.sourceSummary.hasConversationHistory,
            hasLatestCustomerMessage: profile.sourceSummary.hasLatestCustomerMessage,
            hasLatestOutboundMessage: profile.sourceSummary.hasConversationHistory,
            leadAvailable: false,
            opportunityAvailable: false,
            hasCommercialEntity: profile.sourceSummary.hasCommercialEntity,
            commercialIntentLegacy: profile.claimProfile.length > 0 ? profile.claimProfile[0].type : null,
            orderContextAvailable: profile.sourceSummary.hasCustomerReference,
            productServiceContextAvailable: profile.sourceSummary.hasCommercialEntity,
            latestInboundAt: fixtures_1.FIXED_TIME,
            latestOutboundAt: profile.sourceSummary.hasConversationHistory ? fixtures_1.FIXED_TIME : null,
            recentMessagesCount: profile.sourceSummary.hasConversationHistory ? 3 : 0,
            recentMessagesLimit: 12
        },
        metadata: {
            version: "brain.commercial.context.synthetic.v1",
            generatedAt: fixtures_1.FIXED_TIME,
            currentTime: fixtures_1.FIXED_TIME,
            timezone: "America/Santiago",
            requestedMode: "standard",
            availableCapabilities: ["searchKnowledge"],
            recentMessagesLimit: 12,
            sanitized: true,
            sanitizedFields: ["synthetic_fixture"],
            sourceShape: "brain_context",
            safeMetadata: {
                safeSampleId: "synthetic"
            }
        }
    };
}
function buildRuntimeSummary(profile) {
    return {
        status: profile.runtimeStatus,
        mode: "shadow",
        validationStatus: profile.validationStatus,
        providerName: profile.providerName,
        providerVersion: profile.providerVersion,
        providerRequestId: profile.providerRequestId,
        model: profile.model,
        finishReason: "stop",
        outcome: profile.outcome,
        confidence: profile.confidence,
        shouldRespondNow: profile.shouldRespondNow,
        warningsCount: profile.warnings.length,
        rawOutputCaptured: false,
        promptPreviewIncluded: false
    };
}
function buildPolicySummary(profile) {
    return {
        status: profile.policyStatus,
        overallDecision: profile.overallDecision,
        riskLevel: profile.riskLevel,
        requiresApproval: toPolicyApprovalRequirement(profile.approvalRequirement),
        blockedClaims: profile.blockedClaimProfile.length,
        blockedActions: profile.blockedActionProfile.length,
        blockedToolRequests: profile.blockedToolProfile.length,
        blockedEntityProposals: profile.blockedEntityProfile.length,
        issueCount: profile.issueCodes.length,
        warningCount: profile.warnings.length
    };
}
function buildGovernedResultSummary(profile) {
    return {
        outcome: profile.outcome,
        confidence: profile.confidence,
        shouldRespondNow: profile.shouldRespondNow,
        policyStatus: profile.policyStatus,
        overallDecision: profile.overallDecision,
        riskLevel: profile.riskLevel,
        requiresApproval: toSalesAgentApprovalRequirement(profile.approvalRequirement),
        proposedActionCount: profile.actionProfile.length,
        blockedActionCount: profile.blockedActionProfile.length,
        toolRequestCount: profile.toolProfile.length,
        blockedToolRequestCount: profile.blockedToolProfile.length,
        claimCount: profile.claimProfile.length,
        blockedClaimCount: profile.blockedClaimProfile.length,
        entityProposalCount: profile.entityProfile.length,
        warningsCount: profile.warnings.length,
        issueCodes: [...profile.issueCodes],
        appliedRuleIds: [...profile.appliedPolicyRules]
    };
}
function buildMetrics(profile) {
    return {
        startedAt: fixtures_1.FIXED_TIME,
        completedAt: fixtures_1.FIXED_TIME,
        durationMs: profile.durationMs,
        eligibilityDurationMs: 30,
        contextBuilderDurationMs: profile.contextDurationMs,
        runtimeDurationMs: profile.runtimeDurationMs,
        validationDurationMs: profile.validationDurationMs,
        policyDurationMs: profile.policyDurationMs,
        overheadMs: Math.max(0, profile.durationMs - profile.contextDurationMs - profile.runtimeDurationMs - profile.validationDurationMs - profile.policyDurationMs),
        inputCharacters: 1000,
        outputCharacters: 200,
        providerDurationMs: profile.runtimeDurationMs - 20,
        model: profile.model,
        inputTokens: profile.inputTokens,
        outputTokens: profile.outputTokens,
        estimatedCost: profile.estimatedCost,
        providerRequestId: profile.providerRequestId,
        timedOut: profile.runtimeStatus === "timeout",
        warningsCount: profile.warnings.length
    };
}
function buildShadowResult(profile) {
    const claims = buildClaims(profile);
    const blockedClaims = buildBlockedClaims(profile);
    const shadowWarnings = profile.warnings.filter((warning) => warning.startsWith("shadow_"));
    const commercialEvaluation = {
        claimCountsByType: buildCounts([...profile.claimProfile.map((claim) => claim.type)]),
        blockedClaimCountsByType: buildCounts([...profile.blockedClaimProfile.map((claim) => claim.type)]),
        actionCountsByType: buildCounts(profile.actionProfile),
        blockedActionCountsByType: buildCounts(profile.blockedActionProfile),
        toolRequestCountsByType: buildCounts(profile.toolProfile),
        blockedToolRequestCountsByType: buildCounts(profile.blockedToolProfile),
        entityProposalCountsByType: buildCounts(profile.entityProfile),
        blockedEntityProposalCountsByType: buildCounts(profile.blockedEntityProfile),
        claims: [...claims, ...blockedClaims]
    };
    return {
        status: profile.status,
        mode: "shadow",
        enabled: true,
        eligible: profile.eligible,
        skipReason: profile.skipReason ?? null,
        correlationId: profile.providerRequestId,
        executionId: `exec-${profile.providerRequestId}`,
        commercialContextSummary: buildCommercialContextSummary(profile),
        runtimeSummary: buildRuntimeSummary(profile),
        policySummary: buildPolicySummary(profile),
        governedResultSummary: buildGovernedResultSummary(profile),
        stages: [],
        metrics: buildMetrics(profile),
        warnings: shadowWarnings,
        error: profile.runtimeStatus === "provider_error" || profile.runtimeStatus === "provider_unavailable"
            ? {
                code: profile.runtimeStatus,
                message: "Synthetic provider error.",
                stage: "sales_agent_runtime",
                providerName: profile.providerName,
                providerVersion: profile.providerVersion,
                details: {}
            }
            : null,
        versions: {
            shadowVersion: "brain.commercial.shadow.v1",
            contractVersion: "brain.commercial.policy.contract.v1",
            promptVersion: "sales-agent-runtime-v0.1.0",
            policyVersion: "brain.commercial.policy.v1",
            runtimeVersion: "sales-agent-runtime-dry-run-v0.1.0"
        },
        metadata: {
            safeSampleId: profile.providerRequestId,
            commercialEvaluation
        },
        observedAt: fixtures_1.FIXED_TIME,
        sideEffects: {
            messagesSent: profile.sideEffects?.messagesSent ?? 0,
            toolsExecuted: profile.sideEffects?.toolsExecuted ?? 0,
            databaseWrites: profile.sideEffects?.databaseWrites ?? 0,
            outboxWrites: profile.sideEffects?.outboxWrites ?? 0,
            leadsCreated: profile.sideEffects?.leadsCreated ?? 0,
            opportunitiesCreated: profile.sideEffects?.opportunitiesCreated ?? 0,
            casesMutated: profile.sideEffects?.casesMutated ?? 0
        },
        executionDisposition: profile.executionDisposition ?? "discard_after_observation",
        telemetry: [],
        context: null
    };
}
function buildSample(spec) {
    const shadowResult = buildShadowResult(cloneProfile(spec.profile));
    return {
        sampleId: spec.sampleId,
        timestamp: spec.timestamp,
        scenario: spec.scenario,
        expectedTags: [...spec.expectedTags],
        shadowResult,
        productiveDecision: spec.productiveDecision ?? null,
        reviewerAssessment: spec.reviewerAssessment ?? null,
        metadata: spec.metadata ?? {}
    };
}
const sampleSpecs = [
    {
        sampleId: "sample-001",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "consulta general de producto",
        expectedTags: ["context_complete", "useful"],
        profile: cloneProfile({
            claimProfile: [{ type: "general", verified: true }],
            actionProfile: ["draft_response"],
            policyStatus: "allowed",
            overallDecision: "allow",
            riskLevel: "low",
            approvalRequirement: "none",
            shouldRespondNow: true,
            confidence: "high",
            sourceSummary: {
                hasCommercialEntity: true
            },
            comparisonStatus: "aligned"
        }),
        productiveDecision: {
            action: "reply",
            targetAgent: "sales",
            responded: true,
            handedOff: false,
            closed: false,
            noAction: false,
            requiresHuman: false,
            reason: "Responde con informacion general.",
            timestamp: fixtures_1.FIXED_TIME
        }
    },
    {
        sampleId: "sample-002",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "consulta de precio sin evidencia",
        expectedTags: ["policy_block", "prompt_tuning"],
        profile: cloneProfile({
            claimProfile: [{ type: "price", verified: false }],
            blockedClaimProfile: [{ type: "price", verified: false }],
            policyStatus: "blocked",
            overallDecision: "block",
            outcome: "blocked_by_policy",
            riskLevel: "blocked",
            approvalRequirement: "blocked",
            shouldRespondNow: false,
            confidence: "low",
            issueCodes: ["EVAL-MODEL-HARD-BLOCK-PROPOSAL", "EVAL-POLICY-CORRECT-BLOCK"]
        }),
        reviewerAssessment: {
            expectedOutcome: "blocked_by_policy",
            expectedPolicyStatus: "blocked",
            responseUseful: false,
            responseCorrect: false,
            claimSafetyCorrect: true,
            escalationCorrect: true,
            notes: "Precio sin evidencia debe bloquearse.",
            reviewedByHash: "reviewer-001",
            reviewedAt: fixtures_1.FIXED_TIME
        }
    },
    {
        sampleId: "sample-003",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "consulta de precio con evidencia",
        expectedTags: ["policy_review", "useful"],
        profile: cloneProfile({
            claimProfile: [{ type: "price", verified: true }],
            policyStatus: "requires_review",
            overallDecision: "allow_with_approval",
            riskLevel: "medium",
            approvalRequirement: "operator_review",
            shouldRespondNow: false,
            confidence: "high",
            sourceSummary: {
                hasCommercialEntity: true
            },
            comparisonStatus: "partially_aligned"
        })
    },
    {
        sampleId: "sample-004",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "consulta de stock",
        expectedTags: ["policy_review", "useful"],
        profile: cloneProfile({
            claimProfile: [{ type: "stock", verified: true }],
            policyStatus: "requires_review",
            overallDecision: "allow_with_approval",
            riskLevel: "medium",
            approvalRequirement: "operator_review",
            shouldRespondNow: false,
            confidence: "high"
        })
    },
    {
        sampleId: "sample-005",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "consulta de despacho",
        expectedTags: ["policy_review", "useful"],
        profile: cloneProfile({
            claimProfile: [{ type: "delivery", verified: true }],
            policyStatus: "requires_review",
            overallDecision: "allow_with_approval",
            riskLevel: "medium",
            approvalRequirement: "operator_review",
            shouldRespondNow: false,
            confidence: "high"
        })
    },
    {
        sampleId: "sample-006",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "consulta de estado de pedido",
        expectedTags: ["policy_review", "tool_required"],
        profile: cloneProfile({
            claimProfile: [{ type: "order_status", verified: true }],
            toolProfile: ["getOrderByInvoice"],
            policyStatus: "requires_review",
            overallDecision: "allow_with_approval",
            outcome: "tool_required",
            riskLevel: "medium",
            approvalRequirement: "review",
            shouldRespondNow: false,
            confidence: "high"
        })
    },
    {
        sampleId: "sample-007",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "cliente con intencion de compra",
        expectedTags: ["context_complete", "useful"],
        profile: cloneProfile({
            claimProfile: [{ type: "general", verified: true }],
            actionProfile: ["follow_up"],
            policyStatus: "allowed_with_restrictions",
            overallDecision: "allow",
            riskLevel: "low",
            approvalRequirement: "none",
            shouldRespondNow: true,
            confidence: "high"
        })
    },
    {
        sampleId: "sample-008",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "cliente ambiguo",
        expectedTags: ["context_minimal", "not_useful"],
        profile: cloneProfile({
            completeness: "minimal",
            claimProfile: [],
            policyStatus: "requires_review",
            overallDecision: "allow_with_approval",
            outcome: "waiting_for_customer",
            riskLevel: "medium",
            approvalRequirement: "operator_review",
            shouldRespondNow: false,
            confidence: "medium",
            sourceSummary: {
                hasConversationHistory: false,
                hasLatestCustomerMessage: false
            }
        })
    },
    {
        sampleId: "sample-009",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "rechazo explicito",
        expectedTags: ["no_action"],
        profile: cloneProfile({
            policyStatus: "allowed",
            overallDecision: "allow",
            outcome: "no_commercial_action",
            approvalRequirement: "none",
            shouldRespondNow: false,
            confidence: "medium",
            claimProfile: [],
            actionProfile: ["no_action"]
        })
    },
    {
        sampleId: "sample-010",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "opt-out",
        expectedTags: ["policy_block", "safety"],
        profile: cloneProfile({
            policyStatus: "blocked",
            overallDecision: "block",
            outcome: "blocked_by_policy",
            riskLevel: "blocked",
            approvalRequirement: "blocked",
            shouldRespondNow: false,
            confidence: "low",
            sourceSummary: {
                aiBlocked: true
            },
            issueCodes: ["EVAL-POLICY-CORRECT-BLOCK"]
        })
    },
    {
        sampleId: "sample-011",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "solicitud humana",
        expectedTags: ["human_review"],
        profile: cloneProfile({
            policyStatus: "requires_review",
            overallDecision: "allow_with_approval",
            outcome: "waiting_for_customer",
            approvalRequirement: "operator_review",
            shouldRespondNow: false,
            confidence: "high",
            sourceSummary: {
                humanOwnershipActive: true
            }
        })
    },
    {
        sampleId: "sample-012",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "conversacion con human owner",
        expectedTags: ["human_review", "context_partial"],
        profile: cloneProfile({
            completeness: "partial",
            policyStatus: "requires_review",
            overallDecision: "allow_with_approval",
            outcome: "waiting_for_customer",
            approvalRequirement: "operator_review",
            shouldRespondNow: false,
            confidence: "medium",
            sourceSummary: {
                humanOwnershipActive: true,
                hasCommercialEntity: false
            }
        })
    },
    {
        sampleId: "sample-013",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "identity conflict",
        expectedTags: ["identity_conflict", "blocked"],
        profile: cloneProfile({
            policyStatus: "blocked",
            overallDecision: "block",
            outcome: "blocked_by_policy",
            riskLevel: "blocked",
            approvalRequirement: "blocked",
            shouldRespondNow: false,
            confidence: "low",
            sourceSummary: {
                hasCustomerReference: false,
                hasLatestCustomerMessage: false
            },
            issueCodes: ["EVAL-CONTEXT-IDENTITY-CONFLICT"]
        })
    },
    {
        sampleId: "sample-014",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "mensaje vacio",
        expectedTags: ["insufficient_data", "skipped"],
        profile: cloneProfile({
            status: "skipped",
            eligible: false,
            policyStatus: "failed_safe",
            overallDecision: "failed_safe",
            outcome: "insufficient_context",
            approvalRequirement: "blocked",
            shouldRespondNow: false,
            confidence: "low",
            completeness: "insufficient",
            sourceSummary: {
                hasLatestCustomerMessage: false,
                hasCustomerReference: false,
                hasConversationHistory: false
            },
            warnings: ["missing_latest_customer_message", "missing_customer_reference", "missing_conversation_history"],
            issueCodes: ["EVAL-DATA-INSUFFICIENT"]
        })
    },
    {
        sampleId: "sample-015",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "callback tecnico",
        expectedTags: ["skipped", "observability"],
        profile: cloneProfile({
            status: "skipped",
            eligible: false,
            runtimeStatus: "disabled",
            validationStatus: "skipped",
            policyStatus: "failed_safe",
            overallDecision: "failed_safe",
            outcome: "no_commercial_action",
            approvalRequirement: "blocked",
            shouldRespondNow: false,
            confidence: "low",
            sourceSummary: {
                hasLatestCustomerMessage: false,
                hasConversationHistory: false,
                hasCommercialEntity: false
            },
            warnings: ["shadow_skipped"],
            issueCodes: ["EVAL-DATA-INSUFFICIENT"],
            inputTokens: null,
            outputTokens: null,
            estimatedCost: null
        })
    },
    {
        sampleId: "sample-016",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "provider error",
        expectedTags: ["runtime_error", "stability"],
        profile: cloneProfile({
            runtimeStatus: "provider_error",
            validationStatus: "skipped",
            policyStatus: "failed_safe",
            overallDecision: "failed_safe",
            outcome: "failed_safe",
            riskLevel: "blocked",
            approvalRequirement: "blocked",
            shouldRespondNow: false,
            confidence: "low",
            issueCodes: ["EVAL-TECH-RUNTIME-ERROR"],
            warnings: ["shadow_provider_error"]
        })
    },
    {
        sampleId: "sample-017",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "timeout",
        expectedTags: ["timeout", "stability"],
        profile: cloneProfile({
            runtimeStatus: "timeout",
            validationStatus: "skipped",
            policyStatus: "failed_safe",
            overallDecision: "failed_safe",
            outcome: "failed_safe",
            riskLevel: "blocked",
            approvalRequirement: "blocked",
            shouldRespondNow: false,
            confidence: "low",
            issueCodes: ["EVAL-TECH-TIMEOUT"],
            warnings: ["shadow_timeout"],
            durationMs: 8000
        })
    },
    {
        sampleId: "sample-018",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "malformed output",
        expectedTags: ["validation_failed", "prompt_tuning"],
        profile: cloneProfile({
            validationStatus: "failed_safe",
            policyStatus: "failed_safe",
            overallDecision: "failed_safe",
            outcome: "failed_safe",
            riskLevel: "blocked",
            approvalRequirement: "blocked",
            shouldRespondNow: false,
            confidence: "low",
            issueCodes: ["EVAL-TECH-VALIDATION-FAILED", "EVAL-MODEL-GENERIC-OUTPUT"]
        })
    },
    {
        sampleId: "sample-019",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "hard-blocked action",
        expectedTags: ["blocked", "safety"],
        profile: cloneProfile({
            claimProfile: [{ type: "general", verified: true }],
            blockedActionProfile: ["create_lead"],
            policyStatus: "blocked",
            overallDecision: "block",
            outcome: "blocked_by_policy",
            riskLevel: "blocked",
            approvalRequirement: "blocked",
            shouldRespondNow: false,
            confidence: "low",
            issueCodes: ["EVAL-MODEL-HARD-BLOCK-PROPOSAL", "EVAL-POLICY-CORRECT-BLOCK"]
        })
    },
    {
        sampleId: "sample-020",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "valid tool request",
        expectedTags: ["tool_required", "review"],
        profile: cloneProfile({
            toolProfile: ["searchKnowledge"],
            policyStatus: "requires_review",
            overallDecision: "allow_with_approval",
            outcome: "tool_required",
            riskLevel: "medium",
            approvalRequirement: "review",
            shouldRespondNow: false,
            confidence: "high"
        })
    },
    {
        sampleId: "sample-021",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "allowed_with_restrictions",
        expectedTags: ["policy_restriction"],
        profile: cloneProfile({
            claimProfile: [{ type: "general", verified: true }],
            policyStatus: "allowed_with_restrictions",
            overallDecision: "allow",
            outcome: "response_proposed",
            riskLevel: "low",
            approvalRequirement: "none",
            shouldRespondNow: true,
            confidence: "high"
        })
    },
    {
        sampleId: "sample-022",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "requires_review",
        expectedTags: ["policy_review"],
        profile: cloneProfile({
            claimProfile: [{ type: "general", verified: true }],
            policyStatus: "requires_review",
            overallDecision: "allow_with_approval",
            outcome: "response_proposed",
            riskLevel: "medium",
            approvalRequirement: "operator_review",
            shouldRespondNow: false,
            confidence: "high"
        })
    },
    {
        sampleId: "sample-023",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "blocked",
        expectedTags: ["policy_block"],
        profile: cloneProfile({
            claimProfile: [{ type: "price", verified: false }],
            policyStatus: "blocked",
            overallDecision: "block",
            outcome: "blocked_by_policy",
            riskLevel: "blocked",
            approvalRequirement: "blocked",
            shouldRespondNow: false,
            confidence: "low"
        })
    },
    {
        sampleId: "sample-024",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "failed_safe",
        expectedTags: ["failed_safe"],
        profile: cloneProfile({
            runtimeStatus: "completed_failed_safe",
            validationStatus: "failed_safe",
            policyStatus: "failed_safe",
            overallDecision: "failed_safe",
            outcome: "failed_safe",
            riskLevel: "blocked",
            approvalRequirement: "blocked",
            shouldRespondNow: false,
            confidence: "low",
            issueCodes: ["EVAL-TECH-VALIDATION-FAILED", "EVAL-POLICY-MISSING"]
        })
    },
    {
        sampleId: "sample-025",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "context incompleto",
        expectedTags: ["context_incomplete"],
        profile: cloneProfile({
            completeness: "insufficient",
            policyStatus: "failed_safe",
            overallDecision: "failed_safe",
            outcome: "insufficient_context",
            riskLevel: "blocked",
            approvalRequirement: "blocked",
            shouldRespondNow: false,
            confidence: "low",
            sourceSummary: {
                hasLatestCustomerMessage: false,
                hasCustomerReference: false,
                hasConversationHistory: false
            },
            issueCodes: ["EVAL-CONTEXT-INCOMPLETE", "EVAL-CONTEXT-MISSING-EVIDENCE"]
        })
    },
    {
        sampleId: "sample-026",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "context completo",
        expectedTags: ["context_complete"],
        profile: cloneProfile({
            completeness: "complete",
            policyStatus: "allowed",
            overallDecision: "allow",
            outcome: "response_proposed",
            shouldRespondNow: true,
            confidence: "high",
            sourceSummary: {
                hasCommercialEntity: true
            }
        })
    },
    {
        sampleId: "sample-027",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "respuesta util",
        expectedTags: ["useful"],
        profile: cloneProfile({
            claimProfile: [{ type: "general", verified: true }],
            actionProfile: ["draft_response"],
            policyStatus: "allowed",
            overallDecision: "allow",
            outcome: "response_proposed",
            shouldRespondNow: true,
            confidence: "high",
            sourceSummary: {
                hasCommercialEntity: true
            }
        })
    },
    {
        sampleId: "sample-028",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "respuesta generica",
        expectedTags: ["not_useful"],
        profile: cloneProfile({
            claimProfile: [],
            actionProfile: [],
            policyStatus: "allowed",
            overallDecision: "allow",
            outcome: "no_commercial_action",
            shouldRespondNow: false,
            confidence: "medium",
            issueCodes: ["EVAL-COMMERCIAL-NOT-USEFUL"]
        })
    },
    {
        sampleId: "sample-029",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "opportunity proposal",
        expectedTags: ["entity_proposal", "review"],
        profile: cloneProfile({
            entityProfile: ["opportunity"],
            policyStatus: "requires_review",
            overallDecision: "allow_with_approval",
            outcome: "response_proposed",
            riskLevel: "medium",
            approvalRequirement: "operator_review",
            shouldRespondNow: false,
            confidence: "high"
        })
    },
    {
        sampleId: "sample-030",
        timestamp: fixtures_1.FIXED_TIME,
        scenario: "follow-up proposal",
        expectedTags: ["follow_up", "review"],
        profile: cloneProfile({
            actionProfile: ["follow_up"],
            policyStatus: "requires_review",
            overallDecision: "allow_with_approval",
            outcome: "response_proposed",
            riskLevel: "medium",
            approvalRequirement: "operator_review",
            shouldRespondNow: false,
            confidence: "high"
        })
    }
];
exports.COMMERCIAL_EVALUATION_SYNTHETIC_SAMPLE_SPECS = sampleSpecs;
function buildDatasetMetadata() {
    return {
        datasetId: "commercial-evaluation-synthetic-fixtures",
        datasetVersion: "v1",
        generatedAt: fixtures_1.FIXED_TIME,
        synthetic: true,
        source: "tests/commercial/fixtures/evaluation/datasetSource.ts",
        description: "Synthetic fixtures for the commercial evaluation vertical slice.",
        notes: [
            "The dataset is intentionally synthetic and should not be used to approve readiness.",
            "The default readiness decision should remain INSUFFICIENT_DATA."
        ]
    };
}
function buildCommercialEvaluationSyntheticDataset() {
    return {
        metadata: buildDatasetMetadata(),
        samples: sampleSpecs.map(buildSample)
    };
}
exports.COMMERCIAL_EVALUATION_SYNTHETIC_DATASET = buildCommercialEvaluationSyntheticDataset();
