import { buildAgentActionFromFollowUpPlan } from "./buildAgentAction";
import type { BuildAgentActionFromFollowUpPlanInput, CrmAgentAction } from "./types";

export function mapFollowUpPlanToAgentAction(input: BuildAgentActionFromFollowUpPlanInput): CrmAgentAction {
  return buildAgentActionFromFollowUpPlan(input);
}

