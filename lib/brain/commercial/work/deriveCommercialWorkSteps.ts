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

/**
 * A CANCELLED/SUPERSEDED objective must still produce its step, terminal
 * status forced - skipping it here (the old behavior) leaves a same-typed
 * step from an EARLIER turn's still-active objective orphaned at whatever
 * status it last had in the DB (steps are never deleted, only upserted from
 * whatever a projection's own steps array contains). A later turn's executor
 * pass can then find that orphaned step's dependencies newly satisfied for
 * unrelated reasons and reactivate/re-execute it - a real, reproducible
 * duplicate-execution risk this benchmark's R2-04 (turn-continuation)
 * exposed. Forcing the terminal status here, in the same projection that
 * decided the objective is terminal, closes the orphan at the source.
 */
function terminalOr(objective: CommercialObjective, computed: CommercialWorkStep["status"]): CommercialWorkStep["status"] {
  return objective.status === "CANCELLED" || objective.status === "SUPERSEDED" ? objective.status : computed;
}

export function deriveCommercialWorkSteps(objectives: readonly CommercialObjective[]): CommercialWorkStep[] {
  const steps: CommercialWorkStep[] = [];

  for (const objective of objectives) {
    const stepPrefix = `${objective.objectiveId}:step`;
    switch (objective.type) {
      case "DISCOVER_PRODUCTS":
        steps.push(
          makeStep({
            stepId: `${stepPrefix}:SEARCH_PRODUCTS`,
            objectiveIds: [objective.objectiveId],
            type: "SEARCH_PRODUCTS",
            status: terminalOr(objective, objective.status === "COMPLETED" ? "COMPLETED" : "READY"),
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
            status: terminalOr(objective, objective.status === "WAITING_CUSTOMER" ? "WAITING_CUSTOMER" : objective.status === "COMPLETED" ? "COMPLETED" : "READY"),
            dependencies: [{ type: "CUSTOMER_INPUT", requirement: "PRODUCT" }],
            capabilityName: "recommend_catalog_products",
            input: objective.inputs,
            evidence: [...objective.evidence],
            blockers: [...objective.blockers]
          })
        );
        break;
      case "SELECT_PRODUCTS":
      case "CHANGE_QUANTITY": {
        // SALES-AGENT-R2-A11.1, Part 2. A READY objective with a
        // productReference but no resolved items yet needs a real catalog
        // search before SELECT_PRODUCTS can run - applyObjectiveState only
        // reaches READY-with-no-items when latestSearchProductsExecution
        // found nothing matching this exact reference yet (never READY on a
        // bare unresolved reference otherwise). SELECT_PRODUCTS then depends
        // on that step COMPLETING, reusing the same generic
        // STEP_COMPLETED/activateUnblockedSteps reactivation mechanism
        // CALCULATE_SHIPPING already relies on for FACT_CONFIRMED deps -
        // no new engine behavior, just a new dependency edge.
        const needsSearch = objective.status === "READY" && !objective.inputs.items?.length && Boolean(objective.inputs.productReference);
        if (needsSearch) {
          const searchStepId = `${stepPrefix}:SEARCH_PRODUCTS`;
          steps.push(
            makeStep({
              stepId: searchStepId,
              objectiveIds: [objective.objectiveId],
              type: "SEARCH_PRODUCTS",
              status: "READY",
              dependencies: [],
              capabilityName: "search_products",
              input: objective.inputs,
              evidence: [...objective.evidence],
              blockers: []
            })
          );
          steps.push(
            makeStep({
              stepId: `${stepPrefix}:SELECT_PRODUCTS`,
              objectiveIds: [objective.objectiveId],
              type: "SELECT_PRODUCTS",
              status: "BLOCKED",
              dependencies: [{ type: "STEP_COMPLETED", stepId: searchStepId }],
              capabilityName: "select_products",
              input: objective.inputs,
              evidence: [...objective.evidence],
              // SALES-AGENT-R2-A11.1, Part 2. commercialWorkExecutor.ts's
              // activateUnblockedSteps auto-flips ANY BLOCKED step with empty
              // blockers straight to READY the instant its STEP_COMPLETED
              // dependency is satisfied - within the SAME executor pass that
              // just ran SEARCH_PRODUCTS, before a fresh projection round
              // ever gets to interpret the search result into
              // objective.inputs.items. Left at blockers: [], this step would
              // run select_products with empty items one full round early
              // (reproduced live: search completes, this step reactivates
              // immediately, calls select_products with items: [], capability
              // fails, objective reads FAILED). MISSING_PRODUCT_EVIDENCE is
              // not in canAutoActivateStep's allow-list, so this step only
              // ever becomes READY/WAITING_CUSTOMER through the NEXT fresh
              // buildCommercialWorkProjection round, by which point
              // applyObjectiveState has already turned the search result into
              // real items (or a real WAITING_CUSTOMER/WAITING_SYSTEM
              // objective status) and re-derives this step's status from
              // that, correctly, via the plain (non-needsSearch) branch below.
              blockers: [blocker("MISSING_PRODUCT_EVIDENCE", "step", objective.objectiveId, `${stepPrefix}:SELECT_PRODUCTS`)]
            })
          );
          break;
        }
        steps.push(
          makeStep({
            stepId: `${stepPrefix}:SELECT_PRODUCTS`,
            objectiveIds: [objective.objectiveId],
            type: "SELECT_PRODUCTS",
            status: terminalOr(
              objective,
              objective.status === "COMPLETED"
                ? "COMPLETED"
                : objective.status === "WAITING_CUSTOMER"
                  ? "WAITING_CUSTOMER"
                  : objective.status === "BLOCKED"
                    ? "BLOCKED"
                    : "READY"
            ),
            dependencies: [{ type: "CUSTOMER_INPUT", requirement: "PRODUCT" }],
            capabilityName: "select_products",
            input: objective.inputs,
            evidence: [...objective.evidence],
            blockers: [...objective.blockers]
          })
        );
        break;
      }
      case "SET_DESTINATION":
        steps.push(
          makeStep({
            stepId: `${stepPrefix}:SET_SHIPPING_DESTINATION`,
            objectiveIds: [objective.objectiveId],
            type: "SET_SHIPPING_DESTINATION",
            status: terminalOr(
              objective,
              objective.status === "COMPLETED" ? "COMPLETED" : objective.status === "WAITING_CUSTOMER" ? "WAITING_CUSTOMER" : "READY"
            ),
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
            status: terminalOr(
              objective,
              objective.status === "COMPLETED"
                ? "COMPLETED"
                : objective.status === "WAITING_SYSTEM"
                  ? "WAITING_SYSTEM"
                  : objective.status === "WAITING_CUSTOMER"
                    ? "WAITING_CUSTOMER"
                    : blocked
                      ? "BLOCKED"
                      : "READY"
            ),
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
      case "SELECT_SHIPPING_OPTION": {
        // SALES-AGENT-R2-A11.4. Mirrors the SELECT_PRODUCTS/CHANGE_QUANTITY
        // needsSearch chain above: applyObjectiveState computes BLOCKED +
        // MISSING_SHIPPING specifically when shipping evidence is stale or
        // missing (never for any other reason - MISSING_SELECTION/
        // MISSING_DESTINATION are separate blocker codes handled by the
        // plain branch below). The old dependency here,
        // {type:"CAPABILITY_EVIDENCE", capabilityName:"calculate_shipping"},
        // was structurally unsatisfiable: GET_SHIPPING_QUOTE and
        // SELECT_SHIPPING_OPTION share the "shipping" supersession family
        // (deriveCommercialObjectives.ts), so a live SELECT_SHIPPING_OPTION
        // objective always means any prior GET_SHIPPING_QUOTE (the only
        // producer of a calculate_shipping step) was already SUPERSEDED -
        // no real turn ever has both a COMPLETED calculate_shipping step and
        // a live SELECT_SHIPPING_OPTION objective in the same work. Deriving
        // a CALCULATE_SHIPPING step from THIS objective instead - the same
        // capability, same dependencies GET_SHIPPING_QUOTE's own case uses -
        // lets a single objective refresh its own evidence and then proceed,
        // entirely within the same turn's reprojection rounds.
        const needsRecalculation = objective.status === "BLOCKED" && objective.blockers.some((item) => item.code === "MISSING_SHIPPING");
        if (needsRecalculation) {
          const calcStepId = `${stepPrefix}:CALCULATE_SHIPPING`;
          steps.push(
            makeStep({
              stepId: calcStepId,
              objectiveIds: [objective.objectiveId],
              type: "CALCULATE_SHIPPING",
              status: "READY",
              dependencies: [
                { type: "FACT_CONFIRMED", factType: "commercial_line_items" },
                { type: "FACT_CONFIRMED", factType: "shipping_destination" }
              ],
              capabilityName: "calculate_shipping",
              input: objective.inputs,
              evidence: [...objective.evidence],
              blockers: []
            })
          );
          steps.push(
            makeStep({
              stepId: `${stepPrefix}:SELECT_SHIPPING_OPTION`,
              objectiveIds: [objective.objectiveId],
              type: "SELECT_SHIPPING_OPTION",
              status: "BLOCKED",
              dependencies: [{ type: "STEP_COMPLETED", stepId: calcStepId }],
              capabilityName: "select_shipping_option",
              input: objective.inputs,
              evidence: [...objective.evidence],
              // MISSING_SHIPPING is deliberately not in canAutoActivateStep's
              // whitelist - this step only reactivates via the NEXT fresh
              // buildCommercialWorkProjection round (once applyObjectiveState
              // has re-resolved optionReference against the fresh
              // calculate_shipping result), never the same-round
              // activateUnblockedSteps pass right after the calc step
              // completes - same safety property needsSearch's
              // MISSING_PRODUCT_EVIDENCE blocker relies on above.
              blockers: [blocker("MISSING_SHIPPING", "step", objective.objectiveId, `${stepPrefix}:SELECT_SHIPPING_OPTION`)]
            })
          );
          break;
        }
        steps.push(
          makeStep({
            stepId: `${stepPrefix}:SELECT_SHIPPING_OPTION`,
            objectiveIds: [objective.objectiveId],
            type: "SELECT_SHIPPING_OPTION",
            status: terminalOr(
              objective,
              objective.status === "COMPLETED"
                ? "COMPLETED"
                : objective.status === "BLOCKED"
                  ? "BLOCKED"
                  : objective.status === "WAITING_CUSTOMER"
                    ? "WAITING_CUSTOMER"
                    : "READY"
            ),
            dependencies: [
              { type: "FACT_CONFIRMED", factType: "commercial_line_items" },
              { type: "FACT_CONFIRMED", factType: "shipping_destination" }
            ],
            capabilityName: "select_shipping_option",
            input: objective.inputs,
            evidence: [...objective.evidence],
            blockers: [...objective.blockers]
          })
        );
        break;
      }
      case "CREATE_QUOTE":
        steps.push(
          makeStep({
            stepId: `${stepPrefix}:CREATE_QUOTE`,
            objectiveIds: [objective.objectiveId],
            type: "CREATE_QUOTE",
            status: terminalOr(objective, objective.status === "COMPLETED" ? "COMPLETED" : objective.status === "BLOCKED" ? "BLOCKED" : "READY"),
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
            status: terminalOr(objective, objective.status === "COMPLETED" ? "COMPLETED" : "READY"),
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
