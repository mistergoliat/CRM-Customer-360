export const AGENT_TOOLSETS = ["sales", "orders", "maintenance", "post_sales", "customer_service"] as const;
export type AgentToolset = (typeof AGENT_TOOLSETS)[number];

export type AgentConversationStatus = "active" | "waiting_customer" | "handed_off" | "resolved" | "abandoned";

export type AgentKnownFact = {
  key: string;
  value: string;
  source: "customer_stated" | "tool_result" | "policy" | "persisted";
  observedAt: string;
};

export type AgentMissingInformation = {
  key: string;
  reason: string;
};

export type AgentHypothesis = {
  description: string;
  confidence: number;
};

export type AgentConstraint = {
  description: string;
  source: "policy" | "customer" | "capability";
};

export type AgentPendingAction = {
  id: string;
  type: string;
  summary: string;
  createdAt: string;
};

export type AgentCompletedAction = {
  id: string;
  type: string;
  summary: string;
  outcome: string;
  completedAt: string;
};

/**
 * Durable, persisted representation of one conversation's commercial state.
 * This is commercial truth (crm_agent_conversation_state), not an ai_* trace.
 */
export type AgentConversationState = {
  conversationId: number;
  opportunityId: number | null;
  customerGoal: string | null;
  conversationState: AgentConversationStatus;
  knownFacts: AgentKnownFact[];
  missingInformation: AgentMissingInformation[];
  activeHypotheses: AgentHypothesis[];
  constraints: AgentConstraint[];
  recommendedNextStep: string | null;
  pendingActions: AgentPendingAction[];
  completedActions: AgentCompletedAction[];
  unresolvedQuestions: string[];
  confidence: number;
  toolset: AgentToolset;
  humanOwnerActive: boolean;
  handoffMode: "exclusive_handoff" | "approval_request" | "internal_consultation" | null;
  turnCount: number;
  lastTurnCorrelationId: string | null;
  version: number;
};

export type AgentConversationStateInit = Partial<
  Pick<
    AgentConversationState,
    | "opportunityId"
    | "customerGoal"
    | "conversationState"
    | "knownFacts"
    | "missingInformation"
    | "activeHypotheses"
    | "constraints"
    | "recommendedNextStep"
    | "pendingActions"
    | "completedActions"
    | "unresolvedQuestions"
    | "confidence"
    | "toolset"
    | "humanOwnerActive"
    | "handoffMode"
  >
>;

export type AgentTurnInput = {
  conversationId: number;
  customerMasterId: number | null;
  conversationPublicId: string;
  messageText: string;
  messageId: number | string | null;
  correlationId: string;
  currentTime: string;
};

export type AgentToolCallRecord = {
  toolName: string;
  input: Record<string, unknown>;
  status: "ok" | "error" | "denied";
  output: unknown;
  durationMs: number;
};

export type AgentFinalDecision = "respond" | "respond_and_act" | "handoff" | "blocked_no_progress";

export type AgentTurnResult = {
  turnId: string;
  conversationId: number;
  correlationId: string;
  iterations: number;
  toolCalls: AgentToolCallRecord[];
  finalDecision: AgentFinalDecision;
  responseText: string | null;
  state: AgentConversationState;
  actionsCreated: string[];
  modelName: string;
  warnings: string[];
};
