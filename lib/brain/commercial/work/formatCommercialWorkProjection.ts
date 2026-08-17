import type { CommercialWork } from "./types";

export function formatCommercialWorkProjection(work: CommercialWork): string {
  const lines = [
    "CommercialWork",
    `status=${work.status}`,
    `id=${work.id}`,
    "",
    "Objectives:",
    ...(work.objectives.length === 0 ? ["- none"] : work.objectives.map((objective) => `- ${objective.type} ${objective.status}`)),
    "",
    "Steps:",
    ...(work.steps.length === 0 ? ["- none"] : work.steps.map((step) => `- ${step.type} ${step.status}`)),
    "",
    "Blockers:",
    ...(work.blockers.length === 0 ? ["- none"] : work.blockers.map((blocker) => `- ${blocker.code}${blocker.objectiveId ? ` objective=${blocker.objectiveId}` : ""}${blocker.stepId ? ` step=${blocker.stepId}` : ""}`))
  ];
  return lines.join("\n");
}
