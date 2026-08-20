import type { CommercialWork, CommercialWorkBlocker, CommercialWorkProjectionMetrics } from "./types";

export function deriveCommercialWorkMetrics(work: Pick<CommercialWork, "objectives" | "steps" | "blockers">): CommercialWorkProjectionMetrics {
  return {
    objectiveCount: work.objectives.length,
    readyStepCount: work.steps.filter((step) => step.status === "READY").length,
    waitingCustomerObjectiveCount: work.objectives.filter((objective) => objective.status === "WAITING_CUSTOMER").length,
    waitingSystemStepCount: work.steps.filter((step) => step.status === "WAITING_SYSTEM" || step.status === "RETRY_SCHEDULED").length,
    blockerCount: work.blockers.length
  };
}

export function deriveCommercialWorkStatus(input: Pick<CommercialWork, "objectives" | "steps" | "blockers">): CommercialWork["status"] {
  if (input.blockers.some((blocker) => blocker.code === "HUMAN_OWNER_ACTIVE" || blocker.code === "AI_DISABLED")) return "HANDOFF";
  if (input.objectives.length === 0) return "COMPLETED";
  if (input.objectives.every((objective) => objective.status === "CANCELLED")) return "CANCELLED";
  if (input.objectives.every((objective) => objective.status === "SUPERSEDED")) return "SUPERSEDED";
  if (input.objectives.some((objective) => objective.status === "FAILED") || input.steps.some((step) => step.status === "FAILED")) return "FAILED";
  if (input.objectives.some((objective) => objective.status === "WAITING_CUSTOMER") || input.steps.some((step) => step.status === "WAITING_CUSTOMER")) {
    return "WAITING_CUSTOMER";
  }
  if (input.objectives.some((objective) => objective.status === "WAITING_SYSTEM") || input.steps.some((step) => step.status === "WAITING_SYSTEM" || step.status === "RETRY_SCHEDULED")) {
    return "WAITING_SYSTEM";
  }
  if (input.objectives.every((objective) => objective.status === "COMPLETED" || objective.status === "CANCELLED" || objective.status === "SUPERSEDED")) {
    return "COMPLETED";
  }
  return "ACTIVE";
}

/**
 * SALES-AGENT-R2-A11.1, Part 7. Every step in deriveCommercialWorkSteps.ts
 * copies `blockers: [...objective.blockers]` onto itself (by design - a
 * step-level consumer should not have to cross-reference its objective) -
 * naively concatenating objective blockers and step blockers therefore
 * double-counts every objective-level blocker once directly and once via
 * each step that owns it. Identity here matches how blockers are already
 * located elsewhere in this codebase (e.g. deriveCommercialWorkSteps.ts's
 * own `objective.blockers.find((item) => item.code === ...)`): code +
 * source + objectiveId + stepId. First occurrence wins.
 */
export function dedupeCommercialWorkBlockers(blockers: readonly CommercialWorkBlocker[]): CommercialWorkBlocker[] {
  const seen = new Set<string>();
  const result: CommercialWorkBlocker[] = [];
  for (const item of blockers) {
    const key = `${item.code}|${item.source}|${item.objectiveId ?? ""}|${item.stepId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function collectCommercialWorkBlockers(input: Pick<CommercialWork, "objectives" | "steps">, conversationBlockers: CommercialWorkBlocker[] = []): CommercialWorkBlocker[] {
  const blockers: CommercialWorkBlocker[] = [...conversationBlockers];
  for (const objective of input.objectives) blockers.push(...objective.blockers);
  for (const step of input.steps) blockers.push(...step.blockers);
  return dedupeCommercialWorkBlockers(blockers);
}
