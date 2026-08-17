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

export function collectCommercialWorkBlockers(input: Pick<CommercialWork, "objectives" | "steps">, conversationBlockers: CommercialWorkBlocker[] = []): CommercialWorkBlocker[] {
  const blockers: CommercialWorkBlocker[] = [...conversationBlockers];
  for (const objective of input.objectives) blockers.push(...objective.blockers);
  for (const step of input.steps) blockers.push(...step.blockers);
  return blockers;
}
