import { executeGovernedCapability } from "../capability-gateway/executeCapability";
import type { CapabilityGatewayContext } from "../capability-gateway/types";
import { buildToolObservation } from "../agent-loop/buildToolObservation";
import type { AgentLoopStepRecord, ToolObservation } from "../agent-loop/agentStepTypes";
import type { PlannedActionStep } from "./types";

/**
 * LLM-R1-T09A, Part 9 (CommercialActionPlanExecutor). Executes the
 * already-ordered plan sequentially (no parallelism, per the task's own
 * constraint) through the exact same Capability Gateway every capability in
 * this system already goes through (executeGovernedCapability) - no bypass
 * of governance, no bypass of evidence gates (the requirement resolver is
 * itself the evidence gate here: it only ever resolves PRODUCT from
 * RecentCatalogContext or an already-durable selection, never an invented
 * id - see requirementResolver.ts), no second/duplicated persistence path,
 * and projects every real result through the same buildToolObservation.ts
 * every other tool observation in this system uses - so a completed step
 * here is structurally indistinguishable from one the legacy Agent Tool Loop
 * would have produced, and the same downstream consumers (finalizer prompt,
 * Commercial Mutation Execution Guard, commercial_event recording) work
 * unmodified.
 *
 * Part 9 dependency rule: a step whose `dependsOnIntentIndex` names an
 * intent whose own step has not completed is never sent to the Gateway - it
 * is recorded as a "blocked" observation instead (never silently dropped,
 * never a fabricated success).
 */

export type ExecutedActionStep = {
  step: PlannedActionStep;
  observation: ToolObservation;
  /** true when this step never reached the Gateway because its dependency did not complete this turn. */
  skippedDependencyFailed: boolean;
};

export type ExecuteCommercialActionPlanResult = {
  executedSteps: ExecutedActionStep[];
  /** AgentLoopStepRecord-shaped, so the SAME finalization prompt/grounding rules (buildAgentStepPromptPackage.ts) apply unchanged - see runCommercialMultiIntentLoop.ts. */
  stepRecords: AgentLoopStepRecord[];
};

const DEPENDENCY_FAILED_ERROR_CODE = "multi_intent_dependency_failed";

export async function executeCommercialActionPlan(
  steps: PlannedActionStep[],
  gatewayContext: CapabilityGatewayContext
): Promise<ExecuteCommercialActionPlanResult> {
  const executedSteps: ExecutedActionStep[] = [];
  const stepRecords: AgentLoopStepRecord[] = [];
  const succeededIntentIndexes = new Set<number>();

  let stepIndex = 0;
  for (const step of steps) {
    const dependencyUnmet = step.dependsOnIntentIndex !== undefined && !succeededIntentIndexes.has(step.dependsOnIntentIndex);

    const observation: ToolObservation = dependencyUnmet
      ? { tool: step.capability, status: "blocked", errorCode: DEPENDENCY_FAILED_ERROR_CODE }
      : buildToolObservation(step.capability, await executeGovernedCapability(step.capability, step.arguments, gatewayContext));

    executedSteps.push({ step, observation, skippedDependencyFailed: dependencyUnmet });
    stepRecords.push({
      stepIndex,
      step: { type: "use_tool", tool: step.capability, arguments: step.arguments },
      governance: "authorized",
      observation,
      phase: "gathering"
    });
    stepIndex += 1;

    if (observation.status === "completed") succeededIntentIndexes.add(step.forIntentIndex);
  }

  return { executedSteps, stepRecords };
}
