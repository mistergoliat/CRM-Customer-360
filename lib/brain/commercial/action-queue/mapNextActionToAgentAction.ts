import { buildAgentActionFromNextAction } from "./buildAgentAction";
import type { BuildAgentActionFromNextActionInput, CrmAgentAction } from "./types";

export function mapNextActionToAgentAction(input: BuildAgentActionFromNextActionInput): CrmAgentAction {
  return buildAgentActionFromNextAction(input);
}

