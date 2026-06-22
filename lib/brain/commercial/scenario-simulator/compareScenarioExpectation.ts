import { buildScenarioExpectationResultId, SCENARIO_ALLOWED_PATHS, sanitizeScenarioText } from "./constants";
import type { ScenarioExpectation, ScenarioExpectationResult, ScenarioStepResult } from "./types";

function getCurrentActionStatus(stepResult: ScenarioStepResult): string | null {
  return stepResult.loopResult.reconciliation.actionStatusAfter ?? null;
}

function getCurrentOutboxStatus(stepResult: ScenarioStepResult): string | null {
  return stepResult.loopResult.outbox.workerResult?.status ?? null;
}

function getCurrentDeliveryStatus(stepResult: ScenarioStepResult): string | null {
  return stepResult.loopResult.reconciliation.deliveryStatus ?? null;
}

function getCurrentFollowUpDecision(stepResult: ScenarioStepResult): string | null {
  return stepResult.loopResult.followUp.schedulingResult?.decision ?? stepResult.followUpReplay?.schedulingResult?.decision ?? null;
}

function getPathValue(stepResult: ScenarioStepResult, path: string): unknown {
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

function compareValues(actual: unknown, expected: unknown, operator: ScenarioExpectation["operator"]): boolean {
  switch (operator) {
    case "equals":
      return Object.is(actual, expected);
    case "not_equals":
      return !Object.is(actual, expected);
    case "contains":
      if (Array.isArray(actual)) return actual.includes(expected as never);
      if (typeof actual === "string" || typeof expected === "string") return String(actual ?? "").includes(String(expected ?? ""));
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

export function compareScenarioExpectation(
  expectation: ScenarioExpectation,
  stepResult: ScenarioStepResult,
  runtimeSnapshot: ScenarioStepResult["nextSnapshot"]
): ScenarioExpectationResult {
  const path = expectation.path;
  const pathAllowed = (SCENARIO_ALLOWED_PATHS as readonly string[]).includes(path);
  const actual = pathAllowed ? getPathValue(stepResult, path) : undefined;
  const passed = pathAllowed ? compareValues(actual, expectation.expected, expectation.operator) : false;
  const messageSafe = passed
    ? "Expectation passed."
    : sanitizeScenarioText(
        `${expectation.expectationId} failed at ${path}. Expected ${JSON.stringify(expectation.expected)} but got ${JSON.stringify(actual)}.`,
        220
      ) ?? "Expectation failed.";
  const resultId = buildScenarioExpectationResultId({
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
