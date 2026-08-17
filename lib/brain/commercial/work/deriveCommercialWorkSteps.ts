import type { CommercialObjective, CommercialWorkBlocker, CommercialWorkStep } from "./types";

function blocker(code: CommercialWorkBlocker["code"], source: CommercialWorkBlocker["source"], objectiveId: string, stepId?: string): CommercialWorkBlocker {
  return { code, source, objectiveId, ...(stepId ? { stepId } : {}) };
}

function makeStep(
  input: Omit<
    CommercialWorkStep,
    "retryable" | "retryCandidate" | "idempotencyKey" | "attemptCount" | "maxAttempts" | "nextAttemptAt" | "startedAt" | "lastAttemptAt" | "lockOwner" | "lockUntil"
  > &
    Partial<
      Pick<
        CommercialWorkStep,
        "retryable" | "retryCandidate" | "idempotencyKey" | "attemptCount" | "maxAttempts" | "nextAttemptAt" | "startedAt" | "lastAttemptAt" | "lockOwner" | "lockUntil"
      >
    >
): CommercialWorkStep {
  return {
    retryable: input.retryable ?? false,
    retryCandidate: input.retryCandidate ?? false,
    idempotencyKey: input.idempotencyKey ?? null,
    attemptCount: input.attemptCount ?? 0,
    maxAttempts: input.maxAttempts ?? null,
    nextAttemptAt: input.nextAttemptAt ?? null,
    startedAt: input.startedAt ?? null,
    lastAttemptAt: input.lastAttemptAt ?? null,
    lockOwner: input.lockOwner ?? null,
    lockUntil: input.lockUntil ?? null,
    ...input
  };
}

export function deriveCommercialWorkSteps(objectives: readonly CommercialObjective[]): CommercialWorkStep[] {
  const steps: CommercialWorkStep[] = [];

  for (const objective of objectives) {
    if (objective.status === "CANCELLED" || objective.status === "SUPERSEDED") {
      continue;
    }

    const stepPrefix = `${objective.objectiveId}:step`;
    switch (objective.type) {
      case "DISCOVER_PRODUCTS":
        steps.push(
          makeStep({
            stepId: `${stepPrefix}:SEARCH_PRODUCTS`,
            objectiveIds: [objective.objectiveId],
            type: "SEARCH_PRODUCTS",
            status: objective.status === "COMPLETED" ? "COMPLETED" : "READY",
            dependencies: [],
            capabilityName: "search_products",
            input: objective.inputs,
            evidence: [...objective.evidence],
            blockers: []
          })
        );
        break;
      case "COMPARE_PRODUCTS":
      case "RECOMMEND_PRODUCTS":
        steps.push(
          makeStep({
            stepId: `${stepPrefix}:RECOMMEND_PRODUCTS`,
            objectiveIds: [objective.objectiveId],
            type: "RECOMMEND_PRODUCTS",
            status: objective.status === "WAITING_CUSTOMER" ? "WAITING_CUSTOMER" : objective.status === "COMPLETED" ? "COMPLETED" : "READY",
            dependencies: [{ type: "CUSTOMER_INPUT", requirement: "PRODUCT" }],
            capabilityName: "recommend_catalog_products",
            input: objective.inputs,
            evidence: [...objective.evidence],
            blockers: [...objective.blockers]
          })
        );
        break;
      case "SELECT_PRODUCTS":
      case "CHANGE_QUANTITY":
        steps.push(
          makeStep({
            stepId: `${stepPrefix}:SELECT_PRODUCTS`,
            objectiveIds: [objective.objectiveId],
            type: "SELECT_PRODUCTS",
            status:
              objective.status === "COMPLETED"
                ? "COMPLETED"
                : objective.status === "WAITING_CUSTOMER"
                  ? "WAITING_CUSTOMER"
                  : objective.status === "BLOCKED"
                    ? "BLOCKED"
                    : "READY",
            dependencies: [{ type: "CUSTOMER_INPUT", requirement: "PRODUCT" }],
            capabilityName: "select_products",
            input: objective.inputs,
            evidence: [...objective.evidence],
            blockers: [...objective.blockers]
          })
        );
        break;
      case "SET_DESTINATION":
        steps.push(
          makeStep({
            stepId: `${stepPrefix}:SET_SHIPPING_DESTINATION`,
            objectiveIds: [objective.objectiveId],
            type: "SET_SHIPPING_DESTINATION",
            status:
              objective.status === "COMPLETED"
                ? "COMPLETED"
                : objective.status === "WAITING_CUSTOMER"
                  ? "WAITING_CUSTOMER"
                  : "READY",
            dependencies: [{ type: "CUSTOMER_INPUT", requirement: "DESTINATION" }],
            capabilityName: "set_shipping_destination",
            input: objective.inputs,
            evidence: [...objective.evidence],
            blockers: [...objective.blockers]
          })
        );
        break;
      case "GET_SHIPPING_QUOTE": {
        const stepId = `${stepPrefix}:CALCULATE_SHIPPING`;
        const blocked = objective.blockers.find((item) => item.code === "MISSING_SELECTION" || item.code === "MISSING_DESTINATION" || item.code === "WAITING_CUSTOMER");
        steps.push(
          makeStep({
            stepId,
            objectiveIds: [objective.objectiveId],
            type: "CALCULATE_SHIPPING",
            status:
              objective.status === "COMPLETED"
                ? "COMPLETED"
                : objective.status === "WAITING_SYSTEM"
                  ? "WAITING_SYSTEM"
                  : objective.status === "WAITING_CUSTOMER"
                    ? "WAITING_CUSTOMER"
                    : blocked
                      ? "BLOCKED"
                      : "READY",
            dependencies: [
              { type: "FACT_CONFIRMED", factType: "commercial_line_items" },
              { type: "FACT_CONFIRMED", factType: "shipping_destination" }
            ],
            capabilityName: "calculate_shipping",
            input: objective.inputs,
            evidence: [...objective.evidence],
            blockers: blocked ? [blocker(blocked.code, "step", objective.objectiveId, stepId)] : [...objective.blockers],
            retryable: objective.status === "WAITING_SYSTEM",
            retryCandidate: objective.status === "WAITING_SYSTEM"
          })
        );
        break;
      }
      case "SELECT_SHIPPING_OPTION":
        steps.push(
          makeStep({
            stepId: `${stepPrefix}:SELECT_SHIPPING_OPTION`,
            objectiveIds: [objective.objectiveId],
            type: "SELECT_SHIPPING_OPTION",
            status:
              objective.status === "COMPLETED"
                ? "COMPLETED"
                : objective.status === "BLOCKED"
                  ? "BLOCKED"
                  : objective.status === "WAITING_CUSTOMER"
                    ? "WAITING_CUSTOMER"
                    : "READY",
            dependencies: [{ type: "CAPABILITY_EVIDENCE", capabilityName: "calculate_shipping" }],
            capabilityName: "select_shipping_option",
            input: objective.inputs,
            evidence: [...objective.evidence],
            blockers: [...objective.blockers]
          })
        );
        break;
      case "CREATE_QUOTE":
        steps.push(
          makeStep({
            stepId: `${stepPrefix}:CREATE_QUOTE`,
            objectiveIds: [objective.objectiveId],
            type: "CREATE_QUOTE",
            status: objective.status === "COMPLETED" ? "COMPLETED" : objective.status === "BLOCKED" ? "BLOCKED" : "READY",
            dependencies: [{ type: "FACT_CONFIRMED", factType: "commercial_line_items" }],
            capabilityName: "create_quote",
            input: objective.inputs,
            evidence: [...objective.evidence],
            blockers: [...objective.blockers]
          })
        );
        break;
      case "HANDOFF":
        steps.push(
          makeStep({
            stepId: `${stepPrefix}:HANDOFF`,
            objectiveIds: [objective.objectiveId],
            type: "HANDOFF",
            status: objective.status === "COMPLETED" ? "COMPLETED" : "READY",
            dependencies: [],
            capabilityName: null,
            input: objective.inputs,
            evidence: [...objective.evidence],
            blockers: []
          })
        );
        break;
    }
  }

  return steps;
}
