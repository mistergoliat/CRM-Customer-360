"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScenarioReport = buildScenarioReport;
const constants_1 = require("./constants");
function isoMs(value) {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
}
function buildDurationLogicalMs(result) {
    if (result.steps.length === 0)
        return 0;
    const started = isoMs(result.startedAt);
    const completed = isoMs(result.completedAt);
    if (completed >= started)
        return completed - started;
    return Math.max(...result.steps.map((step) => Math.max(0, isoMs(step.loopResult.completedAt) - isoMs(step.loopResult.startedAt))));
}
function buildScenarioReport(result) {
    const failures = result.steps.flatMap((step) => [
        ...step.expectationResults
            .filter((expectation) => !expectation.passed)
            .map((expectation) => ({
            stepId: step.stepId,
            code: `expectation_${expectation.expectationId}`,
            messageSafe: expectation.messageSafe
        })),
        ...step.invariantResults
            .filter((invariant) => !invariant.passed)
            .map((invariant) => ({
            stepId: step.stepId,
            code: invariant.invariantId,
            messageSafe: invariant.message
        }))
    ]);
    const report = {
        scenario: {
            id: result.scenarioId,
            name: result.scenarioName,
            category: result.scenarioCategory
        },
        result: {
            status: result.status,
            durationLogicalMs: buildDurationLogicalMs(result)
        },
        steps: result.steps.map((step) => ({
            stepId: step.stepId,
            title: (0, constants_1.sanitizeScenarioText)(step.title) ?? step.title,
            status: step.passed ? "passed" : "failed",
            loopStatus: step.loopResult.status,
            actionType: typeof step.loopResult.action === "object" && step.loopResult.action !== null && "actionType" in step.loopResult.action ? String(step.loopResult.action.actionType ?? null) : null,
            actionStatus: step.loopResult.reconciliation.actionStatusAfter,
            outboxStatus: step.loopResult.outbox.workerResult?.status ?? null,
            deliveryStatus: step.loopResult.reconciliation.deliveryStatus,
            followUpDecision: step.loopResult.followUp.schedulingResult?.decision ?? step.followUpReplay?.schedulingResult?.decision ?? null,
            expectationsPassed: step.expectationResults.filter((item) => item.passed).length,
            expectationsFailed: step.expectationResults.filter((item) => !item.passed).length,
            invariantsFailed: step.invariantResults.filter((item) => !item.passed).length
        })),
        failures
    };
    void (0, constants_1.buildScenarioReportId)({
        runId: result.runId,
        scenarioId: result.scenarioId,
        status: result.status,
        completedAt: result.completedAt
    });
    return report;
}
