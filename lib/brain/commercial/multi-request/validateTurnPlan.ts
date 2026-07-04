import { CONVERSATION_REQUEST_DOMAINS } from "../conversation-request";
import { REQUEST_LINK_STRATEGIES, TURN_INTENT_OPERATIONS } from "./constants";
import type { TurnPlan } from "./turnPlanTypes";

export type TurnPlanValidationIssue = {
  code:
    | "invalid_contract"
    | "duplicate_detection_id"
    | "invalid_detection"
    | "operation_without_detection"
    | "operation_missing_request_id"
    | "invalid_operation"
    | "invalid_budget";
  message: string;
  path: string[];
};

export type TurnPlanValidationResult = {
  valid: boolean;
  issues: TurnPlanValidationIssue[];
};

/**
 * Structural validation before persisting: a plan that references detections
 * that do not exist, or operations that need a request id and lack one, must
 * never reach the database. Fail-closed: any issue rejects the whole plan.
 */
export function validateTurnPlan(plan: TurnPlan): TurnPlanValidationResult {
  const issues: TurnPlanValidationIssue[] = [];

  if (plan.contractName !== "TurnPlan" || plan.schemaVersion !== "1.0.0") {
    issues.push({ code: "invalid_contract", message: "Plan is not a TurnPlan 1.0.0 contract.", path: ["contractName"] });
  }

  const detectionIds = new Set<string>();
  plan.detections.forEach((detection, index) => {
    if (!detection.detectionId?.trim()) {
      issues.push({ code: "invalid_detection", message: "Detection is missing detectionId.", path: ["detections", String(index)] });
      return;
    }
    if (detectionIds.has(detection.detectionId)) {
      issues.push({ code: "duplicate_detection_id", message: `Duplicate detectionId ${detection.detectionId}.`, path: ["detections", String(index)] });
    }
    detectionIds.add(detection.detectionId);
    if (!(CONVERSATION_REQUEST_DOMAINS as readonly string[]).includes(detection.domain)) {
      issues.push({ code: "invalid_detection", message: `Unknown domain ${detection.domain}.`, path: ["detections", String(index), "domain"] });
    }
    if (!(TURN_INTENT_OPERATIONS as readonly string[]).includes(detection.suggestedOperation)) {
      issues.push({ code: "invalid_detection", message: `Unknown suggestedOperation ${detection.suggestedOperation}.`, path: ["detections", String(index), "suggestedOperation"] });
    }
    if (!Number.isFinite(detection.confidence) || detection.confidence < 0 || detection.confidence > 1) {
      issues.push({ code: "invalid_detection", message: "Detection confidence must be within [0, 1].", path: ["detections", String(index), "confidence"] });
    }
  });

  plan.requestOperations.forEach((operation, index) => {
    if (!detectionIds.has(operation.detectionId)) {
      issues.push({
        code: "operation_without_detection",
        message: `Operation references unknown detectionId ${operation.detectionId}.`,
        path: ["requestOperations", String(index)]
      });
    }
    if (operation.operation !== "create" && !operation.requestId?.trim()) {
      issues.push({
        code: "operation_missing_request_id",
        message: `Operation ${operation.operation} requires a requestId.`,
        path: ["requestOperations", String(index), "requestId"]
      });
    }
    if (operation.operation === "create" && operation.requestId) {
      issues.push({
        code: "invalid_operation",
        message: "A create operation must not carry a preexisting requestId.",
        path: ["requestOperations", String(index), "requestId"]
      });
    }
    if (!(REQUEST_LINK_STRATEGIES as readonly string[]).includes(operation.strategy)) {
      issues.push({ code: "invalid_operation", message: `Unknown strategy ${operation.strategy}.`, path: ["requestOperations", String(index), "strategy"] });
    }
  });

  const budget = plan.executionBudget;
  if (
    !budget ||
    !Number.isInteger(budget.maxReadActions) ||
    budget.maxReadActions < 0 ||
    !Number.isInteger(budget.maxMutationActions) ||
    budget.maxMutationActions < 0 ||
    !Number.isInteger(budget.maxExternalCalls) ||
    budget.maxExternalCalls < 0 ||
    !Number.isInteger(budget.deadlineMs) ||
    budget.deadlineMs <= 0
  ) {
    issues.push({ code: "invalid_budget", message: "Execution budget values must be non-negative integers with a positive deadline.", path: ["executionBudget"] });
  }

  return { valid: issues.length === 0, issues };
}
