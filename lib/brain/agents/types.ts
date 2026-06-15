import type { BrainActionPolicy } from "../actions/types";
import type { BrainContextPacks, BrainInputEvent } from "../context/types";
import type { BrainResolvedContext, BrainError, BrainValidationResult } from "../inbound/types";
import type { BrainToolName, BrainToolRequest } from "../tools/types";
import type { BrainKnowledgeAgentRunResponse } from "./knowledge";

export const BRAIN_AGENT_NAMES = ["knowledge", "sales", "sac", "postventa", "campaign", "supervisor"] as const;
export type BrainAgentName = (typeof BRAIN_AGENT_NAMES)[number];

export type BrainAgentRiskLevel = "low" | "medium" | "high";
export type BrainAgentRuntimeMode = "mock" | "disabled";
export type BrainAgentDecision = "reply" | "research" | "handoff" | "no_action" | "blocked";
export type BrainAgentSafetyFlag = string;

export type BrainAgentRunOptions = {
  dryRun: boolean;
  executeActions: boolean;
  debug: boolean;
};

export const DEFAULT_BRAIN_AGENT_RUN_OPTIONS: BrainAgentRunOptions = {
  dryRun: true,
  executeActions: false,
  debug: false
};

export type BrainAgentDefinition = {
  name: BrainAgentName;
  version: string;
  purpose: string;
  allowedContextPacks: (keyof BrainContextPacks)[];
  allowedTools: BrainToolName[];
  outputSchema: string;
  riskLevel: BrainAgentRiskLevel;
  defaultMode: BrainAgentRuntimeMode;
  enabled: boolean;
};

export type BrainAgentRunRequest = {
  agentName: BrainAgentName;
  inputEvent: BrainInputEvent;
  context: BrainResolvedContext;
  contextPacks: Partial<BrainContextPacks>;
  actionPolicy: BrainActionPolicy;
  options: BrainAgentRunOptions;
  requestId?: string;
};

export type BrainAgentOutputEnvelope = {
  outputSchema: string;
  agentName: BrainAgentName;
  agentVersion: string;
  decision: BrainAgentDecision;
  message: string;
  toolRequests: BrainToolRequest[];
  confidence: number;
  safetyFlags: BrainAgentSafetyFlag[];
};

export type BrainAgentRunResponse = BrainAgentOutputEnvelope & {
  ok: boolean;
  requestId: string;
  draft?: BrainKnowledgeAgentRunResponse | null;
  validationErrors: BrainError[];
  warnings: string[];
  contextPacksUsed: (keyof BrainContextPacks)[];
  metadata: {
    version: string;
    generatedAt: string;
    processingMs: number;
    dryRun: boolean;
    debug: boolean;
    modelName: string;
    modelVersion: string;
    logStatus: "skipped" | "recorded" | "failed";
  };
};

export type BrainNormalizedAgentRunRequest = {
  agentName: BrainAgentName;
  inputEvent: BrainInputEvent;
  context: BrainResolvedContext;
  contextPacks: Partial<BrainContextPacks>;
  actionPolicy: BrainActionPolicy;
  options: BrainAgentRunOptions;
  requestId?: string;
};

export type BrainAgentValidationResult = BrainValidationResult<BrainNormalizedAgentRunRequest>;
