"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFollowUpDecision = buildFollowUpDecision;
function uniqueReasons(reasons) {
    const output = [];
    for (const reason of reasons) {
        if (!output.includes(reason)) {
            output.push(reason);
        }
    }
    return output;
}
function buildFollowUpDecision(input) {
    const reasons = uniqueReasons(input.reasons);
    const warnings = [...new Set(input.warnings ?? [])];
    return {
        decision: input.decision,
        actionable: input.decision === "ready",
        actionId: input.actionId,
        reasons,
        warnings,
        originalScheduledFor: input.originalScheduledFor,
        effectiveScheduledFor: input.effectiveScheduledFor,
        nextScheduledFor: input.nextScheduledFor,
        timing: input.timing,
        retry: input.retry,
        sideEffects: {
            actionUpdated: false,
            actionInserted: false,
            outboxWritten: false,
            messageSent: false,
            workerTriggered: false
        }
    };
}
