"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeScenario = executeScenario;
const buildScenarioReport_1 = require("./buildScenarioReport");
const constants_1 = require("./constants");
const executeScenarioStep_1 = require("./executeScenarioStep");
const inMemoryScenarioRuntime_1 = require("./inMemoryScenarioRuntime");
const validateScenarioDefinition_1 = require("./validateScenarioDefinition");
function cloneDefinition(value) {
    return structuredClone(value);
}
function pickTenantId(scenario) {
    return String(scenario.steps[0]?.input.tenantId ?? "tenant-scenario-simulator");
}
function buildInitialStateHash(scenario) {
    return JSON.stringify({
        runtimeSeed: scenario.initialState.runtimeSeed,
        configuration: scenario.initialState.configuration
    });
}
function isScenarioValidationResult(value) {
    return value.ok === true;
}
async function executeScenario(scenario, dependencies = {}) {
    const normalizedScenario = cloneDefinition(scenario);
    const validation = (0, validateScenarioDefinition_1.validateScenarioDefinition)(normalizedScenario);
    const startedAt = normalizedScenario.steps[0]?.now ?? "1970-01-01T00:00:00.000Z";
    const completedAtFallback = normalizedScenario.steps.at(-1)?.now ?? startedAt;
    if (!isScenarioValidationResult(validation)) {
        const invalidResult = {
            runId: (0, constants_1.buildScenarioRunId)({
                scenarioId: normalizedScenario.scenarioId,
                stepCount: normalizedScenario.steps.length,
                tenantId: pickTenantId(normalizedScenario),
                initialStateHash: buildInitialStateHash(normalizedScenario)
            }),
            scenarioId: normalizedScenario.scenarioId,
            scenarioName: normalizedScenario.name,
            scenarioCategory: normalizedScenario.category,
            status: "invalid",
            steps: [],
            summary: {
                totalSteps: 0,
                passedSteps: 0,
                failedSteps: 0,
                totalExpectations: normalizedScenario.expectations.length,
                passedExpectations: 0,
                failedExpectations: normalizedScenario.expectations.length,
                totalInvariants: 0,
                passedInvariants: 0,
                failedInvariants: 0
            },
            finalSnapshot: new inMemoryScenarioRuntime_1.InMemoryScenarioRuntime().getSnapshot(),
            report: {
                scenario: {
                    id: normalizedScenario.scenarioId,
                    name: normalizedScenario.name,
                    category: normalizedScenario.category
                },
                result: {
                    status: "invalid",
                    durationLogicalMs: 0
                },
                steps: [],
                failures: validation.errors.map((error) => ({
                    stepId: error.path.split(".")[0] || "scenario",
                    code: error.code,
                    messageSafe: error.messageSafe
                }))
            },
            startedAt,
            completedAt: completedAtFallback
        };
        return invalidResult;
    }
    const runtime = dependencies.runtime ??
        new inMemoryScenarioRuntime_1.InMemoryScenarioRuntime({
            opportunities: normalizedScenario.initialState.runtimeSeed.opportunities,
            decisions: normalizedScenario.initialState.runtimeSeed.decisions,
            actions: normalizedScenario.initialState.runtimeSeed.actions,
            outbox: normalizedScenario.initialState.runtimeSeed.outbox,
            deliveryResults: normalizedScenario.initialState.runtimeSeed.deliveryResults,
            auditEvents: normalizedScenario.initialState.runtimeSeed.auditEvents
        }, dependencies.failureMode ?? "none");
    const steps = [];
    const continueOnStepFailure = dependencies.continueOnStepFailure ?? false;
    let currentStatus = "passed";
    let passedSteps = 0;
    let failedSteps = 0;
    let passedExpectations = 0;
    let failedExpectations = 0;
    let passedInvariants = 0;
    let failedInvariants = 0;
    for (const [index, step] of normalizedScenario.steps.entries()) {
        const stepResult = await (0, executeScenarioStep_1.executeScenarioStep)(normalizedScenario, step, index, runtime, dependencies);
        steps.push(stepResult);
        passedSteps += stepResult.passed ? 1 : 0;
        failedSteps += stepResult.passed ? 0 : 1;
        passedExpectations += stepResult.expectationResults.filter((item) => item.passed).length;
        failedExpectations += stepResult.expectationResults.filter((item) => !item.passed).length;
        passedInvariants += stepResult.invariantResults.filter((item) => item.passed).length;
        failedInvariants += stepResult.invariantResults.filter((item) => !item.passed).length;
        if (!stepResult.passed) {
            currentStatus = currentStatus === "passed" ? "partially_passed" : currentStatus;
            if (!continueOnStepFailure)
                break;
        }
        if (stepResult.loopResult.status === "failed") {
            currentStatus = "failed";
            if (!continueOnStepFailure)
                break;
        }
    }
    if (steps.length === 0) {
        currentStatus = "invalid";
    }
    else if (currentStatus === "passed" && failedSteps > 0) {
        currentStatus = passedSteps > 0 ? "partially_passed" : "failed";
    }
    else if (currentStatus === "partially_passed" && failedSteps === 0) {
        currentStatus = "passed";
    }
    const finalSnapshot = runtime.getSnapshot();
    const result = {
        runId: (0, constants_1.buildScenarioRunId)({
            scenarioId: normalizedScenario.scenarioId,
            stepCount: normalizedScenario.steps.length,
            tenantId: pickTenantId(normalizedScenario),
            initialStateHash: buildInitialStateHash(normalizedScenario)
        }),
        scenarioId: normalizedScenario.scenarioId,
        scenarioName: normalizedScenario.name,
        scenarioCategory: normalizedScenario.category,
        status: currentStatus,
        steps,
        summary: {
            totalSteps: normalizedScenario.steps.length,
            passedSteps,
            failedSteps,
            totalExpectations: normalizedScenario.expectations.length,
            passedExpectations,
            failedExpectations,
            totalInvariants: passedInvariants + failedInvariants,
            passedInvariants,
            failedInvariants
        },
        finalSnapshot,
        report: {
            scenario: {
                id: normalizedScenario.scenarioId,
                name: normalizedScenario.name,
                category: normalizedScenario.category
            },
            result: {
                status: currentStatus,
                durationLogicalMs: Math.max(0, new Date(completedAtFallback).getTime() - new Date(startedAt).getTime())
            },
            steps: steps.map((step) => ({
                stepId: step.stepId,
                title: step.title,
                status: step.passed ? "passed" : "failed",
                loopStatus: step.loopResult.status,
                actionType: typeof step.loopResult.action === "object" && step.loopResult.action !== null && "actionType" in step.loopResult.action
                    ? String(step.loopResult.action.actionType ?? null)
                    : null,
                actionStatus: step.loopResult.reconciliation.actionStatusAfter,
                outboxStatus: step.loopResult.outbox.workerResult?.status ?? null,
                deliveryStatus: step.loopResult.reconciliation.deliveryStatus,
                followUpDecision: step.loopResult.followUp.schedulingResult?.decision ?? step.followUpReplay?.schedulingResult?.decision ?? null,
                expectationsPassed: step.expectationResults.filter((item) => item.passed).length,
                expectationsFailed: step.expectationResults.filter((item) => !item.passed).length,
                invariantsFailed: step.invariantResults.filter((item) => !item.passed).length
            })),
            failures: steps.flatMap((step) => [
                ...step.expectationResults.filter((item) => !item.passed).map((item) => ({
                    stepId: step.stepId,
                    code: item.expectationId,
                    messageSafe: item.messageSafe
                })),
                ...step.invariantResults.filter((item) => !item.passed).map((item) => ({
                    stepId: step.stepId,
                    code: item.invariantId,
                    messageSafe: item.message
                }))
            ])
        },
        startedAt,
        completedAt: steps.at(-1)?.loopResult.completedAt ?? completedAtFallback
    };
    result.report = (0, buildScenarioReport_1.buildScenarioReport)(result);
    return result;
}
