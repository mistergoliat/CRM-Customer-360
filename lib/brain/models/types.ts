import type { BrainActionPolicy } from "../actions/types";
import type { BrainContextPacks } from "../context/types";
import type { BrainResolvedContext } from "../inbound/types";
import type { BrainAgentDecision, BrainAgentOutputEnvelope, BrainAgentRunRequest } from "../agents/types";
import type { BrainKnowledgeAgentRunResponse } from "../agents/knowledge";
import type { BrainToolName } from "../tools/types";

export type BrainModelName = "mock" | "real" | "disabled";

export type BrainModelAdapterRequest = Pick<
  BrainAgentRunRequest,
  "agentName" | "inputEvent" | "context" | "contextPacks" | "actionPolicy" | "options"
> & {
  agentVersion: string;
  allowedTools: BrainToolName[];
  allowedContextPacks: (keyof BrainContextPacks)[];
};

export type BrainModelAdapterResponse = {
  ok: boolean;
  modelName: BrainModelName;
  modelVersion: string;
  output: BrainAgentOutputEnvelope;
  draft?: BrainKnowledgeAgentRunResponse | null;
  warnings: string[];
  safetyFlags: string[];
};

export type BrainModelAdapterContext = {
  decision: BrainAgentDecision;
  context: BrainResolvedContext;
  actionPolicy: BrainActionPolicy;
};
