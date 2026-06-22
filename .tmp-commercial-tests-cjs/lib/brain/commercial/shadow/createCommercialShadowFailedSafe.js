"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCommercialShadowFailedSafe = createCommercialShadowFailedSafe;
const adapters_1 = require("../context/adapters");
const policy_1 = require("../policy");
const runtimeTypes_1 = require("../sales-agent/runtimeTypes");
const shadowConstants_1 = require("./shadowConstants");
const ZERO_SIDE_EFFECTS = {
    messagesSent: 0,
    toolsExecuted: 0,
    databaseWrites: 0,
    outboxWrites: 0,
    leadsCreated: 0,
    opportunitiesCreated: 0,
    casesMutated: 0
};
function toIsoString(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
function uniqueWarnings(values) {
    return [...new Set(values)].filter((value) => Boolean(value));
}
function buildStage(stage, status, startedAt, completedAt, warnings = [], errorCode, counts) {
    return {
        stage,
        status,
        startedAt,
        completedAt,
        durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
        warnings: uniqueWarnings(warnings),
        errorCode: errorCode ?? null,
        version: shadowConstants_1.COMMERCIAL_SHADOW_VERSION,
        counts
    };
}
function createCommercialShadowFailedSafe(input) {
    const currentTime = toIsoString(input.input.currentTime);
    const safeMetadataResult = (0, adapters_1.sanitizeCommercialObject)(input.input.metadata ?? {});
    const safeMetadata = safeMetadataResult.value ?? {};
    const warnings = uniqueWarnings([
        ...(input.warnings ?? []),
        input.error?.code ?? "",
        input.error?.message ?? "",
        input.skipReason ?? ""
    ]);
    const stages = input.stages && input.stages.length > 0
        ? input.stages
        : [buildStage(input.failureStage, "failed_safe", currentTime, currentTime, warnings, input.error?.code ?? "failed_safe")];
    return {
        status: input.status,
        mode: input.input.options?.mode ?? "shadow",
        enabled: Boolean(input.input.shadowFlags.commercialShadowEnabled),
        eligible: input.eligible ?? true,
        skipReason: input.skipReason ?? null,
        correlationId: input.input.correlationId,
        executionId: input.input.executionId ?? null,
        commercialContextSummary: input.commercialContextSummary ?? null,
        runtimeSummary: input.runtimeSummary ?? null,
        policySummary: input.policySummary ?? null,
        governedResultSummary: input.governedResultSummary ?? null,
        stages,
        metrics: {
            startedAt: currentTime,
            completedAt: currentTime,
            durationMs: 0,
            eligibilityDurationMs: 0,
            contextBuilderDurationMs: 0,
            runtimeDurationMs: 0,
            validationDurationMs: 0,
            policyDurationMs: 0,
            overheadMs: 0,
            inputCharacters: JSON.stringify(input.input.inboundMessage).length,
            outputCharacters: 0,
            providerDurationMs: 0,
            model: null,
            inputTokens: null,
            outputTokens: null,
            estimatedCost: null,
            providerRequestId: null,
            timedOut: input.status === "timeout",
            warningsCount: warnings.length,
            ...input.metrics
        },
        warnings,
        error: input.error ?? null,
        versions: {
            shadowVersion: shadowConstants_1.COMMERCIAL_SHADOW_VERSION,
            contractVersion: input.input.contractVersion,
            promptVersion: input.input.promptVersion,
            policyVersion: input.input.policyVersion,
            runtimeVersion: runtimeTypes_1.SALES_AGENT_RUNTIME_VERSION
        },
        metadata: {
            ...safeMetadata,
            commercialShadow: {
                reason: input.reason,
                status: input.status,
                failureStage: input.failureStage,
                policyVersion: policy_1.COMMERCIAL_POLICY_VERSION,
                promptVersion: runtimeTypes_1.SALES_AGENT_PROMPT_VERSION,
                featureFlags: shadowConstants_1.COMMERCIAL_SHADOW_DEFAULT_FEATURE_FLAGS
            }
        },
        observedAt: currentTime,
        sideEffects: ZERO_SIDE_EFFECTS,
        executionDisposition: input.executionDisposition ?? "not_executed",
        telemetry: input.telemetry ?? [],
        context: input.context ?? null
    };
}
