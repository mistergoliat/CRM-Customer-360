import type { BrainActionPolicy } from "../../actions/types";
import type { BrainContextPack } from "../../context/types";
import type { BrainError, BrainResolvedContext, BrainValidationResult } from "../../inbound/types";
import type { BrainToolRequest } from "../../tools/types";

export const BRAIN_KNOWLEDGE_AGENT_NAME = "knowledge" as const;
export const BRAIN_KNOWLEDGE_AGENT_VERSION = "brain.agent.knowledge.v2" as const;
export const BRAIN_KNOWLEDGE_AGENT_PROMPT_VERSION = "brain.knowledge.prompt.v1" as const;
export const BRAIN_KNOWLEDGE_AGENT_OUTPUT_SCHEMA = "brain.agent.knowledge.output.v1" as const;

export const BRAIN_KNOWLEDGE_AGENT_DECISIONS = [
  "answer",
  "abstain",
  "handoff_recommended",
  "route_to_sales",
  "route_to_sac",
  "route_to_postventa"
] as const;
export type BrainKnowledgeAgentDecision = (typeof BRAIN_KNOWLEDGE_AGENT_DECISIONS)[number];

export const BRAIN_KNOWLEDGE_ANSWER_TYPES = [
  "business_info",
  "faq",
  "policy",
  "location",
  "payment",
  "generic",
  "none"
] as const;
export type BrainKnowledgeAnswerType = (typeof BRAIN_KNOWLEDGE_ANSWER_TYPES)[number];

export type BrainKnowledgeAgentToolName = "searchKnowledge" | "getStaticBusinessInfo" | "getKnowledgePolicy";

export type BrainKnowledgeAgentRunOptions = {
  dryRun: boolean;
  executeActions: boolean;
  debug: boolean;
};

export type BrainKnowledgeAgentRequest = {
  requestId?: string;
  inputEvent: {
    channel: "whatsapp";
    source: string;
    wa_id: string;
    phone_number_id: string;
    message_id: string;
    message_text: string;
    conversation_case_id?: string | number;
    id_order?: string | number;
    id_customer?: string | number;
    invoice_number?: string | number;
    source_workflow?: string;
    source_node?: string;
    received_at?: string;
    dry_run: boolean;
  };
  context: BrainResolvedContext;
  contextPack: BrainContextPack | null;
  actionPolicy: BrainActionPolicy;
  options: BrainKnowledgeAgentRunOptions;
};

export type BrainKnowledgeAgentOutput = {
  outputSchema: typeof BRAIN_KNOWLEDGE_AGENT_OUTPUT_SCHEMA;
  agentName: typeof BRAIN_KNOWLEDGE_AGENT_NAME;
  agentVersion: typeof BRAIN_KNOWLEDGE_AGENT_VERSION;
  decision: BrainKnowledgeAgentDecision;
  answer_type: BrainKnowledgeAnswerType;
  message: string;
  confidence: number;
  sources_used: string[];
  safety_flags: string[];
  tool_requests: BrainToolRequest[];
  warnings: string[];
};

export type BrainKnowledgeAgentRunResponse = BrainKnowledgeAgentOutput & {
  ok: boolean;
  requestId: string;
  validationErrors: BrainError[];
  metadata: {
    version: string;
    generatedAt: string;
    processingMs: number;
    dryRun: boolean;
    debug: boolean;
    modelName: string;
    modelVersion: string;
    promptVersion: typeof BRAIN_KNOWLEDGE_AGENT_PROMPT_VERSION;
    runtimeMode: "mock" | "real" | "disabled";
  };
};

export type BrainKnowledgeAgentValidationResult = BrainValidationResult<BrainKnowledgeAgentOutput>;
