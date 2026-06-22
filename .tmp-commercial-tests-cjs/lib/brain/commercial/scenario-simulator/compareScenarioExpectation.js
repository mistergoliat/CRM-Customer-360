"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareScenarioExpectation = compareScenarioExpectation;
const constants_1 = require("./constants");
function getCurrentActionStatus(stepResult) {
    return stepResult.loopResult.reconciliation.actionStatusAfter ?? null;
}
function getCurrentOutboxStatus(stepResult) {
    return stepResult.loopResult.outbox.workerResult?.status ?? null;
}
function getCurrentDeliveryStatus(stepResult) {
    return stepResult.loopResult.reconciliation.deliveryStatus ?? null;
}
function getCurrentFollowUpDecision(stepResult) {
    return stepResult.loopResult.followUp.schedulingResult?.decision ?? stepResult.followUpReplay?.schedulingResult?.decision ?? null;
}
function getPathValue(stepResult, path) {
    switch (path) {
        case "loop.status":
            return stepResult.loopResult.status;
        case "loop.finalStage":
            return stepResult.loopResult.finalStage;
        case "action.status":
            return getCurrentActionStatus(stepResult);
        case "outbox.status":
            return getCurrentOutboxStatus(stepResult);
        case "delivery.status":
            return getCurrentDeliveryStatus(stepResult);
        case "followUp.schedulingResult.decision":
            return getCurrentFollowUpDecision(stepResult);
        case "followUp.mutationPlan.planType":
            return stepResult.loopResult.followUp.mutationPlan?.planType ?? stepResult.followUpReplay?.mutationPlan?.planType ?? null;
        case "runtime.actions.count":
            return stepResult.nextSnapshot.actions.length;
        case "runtime.outbox.count":
            return stepResult.nextSnapshot.outbox.length;
        case "runtime.audit.count":
            return stepResult.nextSnapshot.auditEvents.length;
        case "sideEffects.realMessageSent":
            return stepResult.loopResult.sideEffects.realMessageSent;
        case "sideEffects.metaCalled":
            return stepResult.loopResult.sideEffects.metaCalled;
        case "sideEffects.realDatabaseWritten":
            return stepResult.loopResult.sideEffects.realDatabaseWritten;
        case "sideEffects.realOutboxWritten":
            return stepResult.loopResult.sideEffects.realOutboxWritten;
        case "sideEffects.schedulerTriggered":
            return stepResult.loopResult.sideEffects.schedulerTriggered;
        case "report.result.status":
            return null;
        default:
            return null;
    }
}
function compareValues(actual, expected, operator) {
    switch (operator) {
        case "equals":
            return Object.is(actual, expected);
        case "not_equals":
            return !Object.is(actual, expected);
        case "contains":
            if (Array.isArray(actual))
                return actual.includes(expected);
            if (typeof actual === "string" || typeof expected === "string")
                return String(actual ?? "").includes(String(expected ?? ""));
            return false;
        case "exists":
            return actual !== null && actual !== undefined;
        case "not_exists":
            return actual === null || actual === undefined;
        case "greater_than":
            return Number(actual) > Number(expected);
        case "less_than":
            return Number(actual) < Number(expected);
    }
}
function compareScenarioExpectation(expectation, stepResult, runtimeSnapshot) {
    const path = expectation.path;
    const pathAllowed = constants_1.SCENARIO_ALLOWED_PATHS.includes(path);
    const actual = pathAllowed ? getPathValue(stepResult, path) : undefined;
    const passed = pathAllowed ? compareValues(actual, expectation.expected, expectation.operator) : false;
    const messageSafe = passed
        ? "Expectation passed."
        : (0, constants_1.sanitizeScenarioText)(`${expectation.expectationId} failed at ${path}. Expected ${JSON.stringify(expectation.expected)} but got ${JSON.stringify(actual)}.`, 220) ?? "Expectation failed.";
    const resultId = (0, constants_1.buildScenarioExpectationResultId)({
        runId: stepResult.loopResult.runId,
        stepId: stepResult.stepId,
        expectationId: expectation.expectationId,
        operator: expectation.operator,
        path
    });
    void runtimeSnapshot;
    return {
        resultId,
        expectationId: expectation.expectationId,
        stepId: expectation.stepId,
        type: expectation.type,
        path,
        operator: expectation.operator,
        expected: expectation.expected,
        actual,
        passed,
        messageSafe
    };
}
