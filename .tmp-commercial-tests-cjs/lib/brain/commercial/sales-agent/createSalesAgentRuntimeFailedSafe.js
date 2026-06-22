"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSalesAgentRuntimeFailedSafe = createSalesAgentRuntimeFailedSafe;
const createFailedSafeResult_1 = require("./createFailedSafeResult");
function createSalesAgentRuntimeFailedSafe(input) {
    const result = (0, createFailedSafeResult_1.createFailedSafeResult)(input.validationContext, {
        issues: [...input.issues],
        reason: input.error.message,
        decisionType: input.decisionType
    });
    return {
        status: input.status,
        mode: input.mode,
        dryRun: input.dryRun,
        result,
        validation: input.validation,
        metrics: input.metrics,
        warnings: [...new Set([...input.warnings, ...result.warnings])],
        error: input.error,
        provider: input.provider,
        versions: input.versions,
        correlationId: input.correlationId ?? null,
        metadata: input.metadata,
        rawOutputPreview: input.rawOutputPreview
    };
}
