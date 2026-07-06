import type { ConversationRequestDomain, ConversationRequestStatus } from "../conversation-request";
import type { RequestLinkStrategy, ResponseRequirementKind, TurnIntentOperation, TurnPlanStatus } from "./constants";

export type ProposedRequestFact = {
  factKey: string;
  value: unknown;
  confidence: number;
  sourceMessageId: string | null;
};

export type DetectedTurnIntent = {
  /** Stable within the persisted plan: creation_key = sha256(turnPlanId + detectionId). */
  detectionId: string;
  rawIntent: string;
  canonicalIntent: string;
  domain: ConversationRequestDomain;
  confidence: number;
  suggestedOperation: TurnIntentOperation;
  candidateRequestId: string | null;
  extractedFacts: ProposedRequestFact[];
};

export type RequestOperation = {
  detectionId: string;
  operation: "create" | "continue" | "modify" | "reopen" | "cancel" | "mention";
  requestId: string | null;
  intentType: string;
  intentDomain: ConversationRequestDomain;
  strategy: RequestLinkStrategy;
  confidence: number;
  reasonCode: string;
};

export type ProposedTurnAction = {
  actionType: string;
  reason: string;
  riskLevel: "low" | "medium" | "high" | "blocked";
  payload: Record<string, unknown> | null;
};

export type RequestPlan = {
  requestId: string;
  missingFacts: string[];
  proposedActions: ProposedTurnAction[];
  expectedEvents: string[];
  desiredStatus: Extract<ConversationRequestStatus, "active" | "waiting_customer" | "waiting_system" | "waiting_human"> | null;
};

export type ResponseRequirement = {
  requestId: string;
  kind: ResponseRequirementKind;
  summary: string;
};

export type TurnPlanExecutionBudget = {
  maxReadActions: number;
  maxMutationActions: number;
  maxExternalCalls: number;
  deadlineMs: number;
};

export type TurnPlan = {
  contractName: "TurnPlan";
  schemaVersion: "1.0.0";
  detections: DetectedTurnIntent[];
  requestOperations: RequestOperation[];
  proposedFacts: ProposedRequestFact[];
  requestPlans: RequestPlan[];
  responseRequirements: ResponseRequirement[];
  executionBudget: TurnPlanExecutionBudget;
};

export type TurnPlanRecord = {
  turnPlanId: string;
  correlationId: string;
  conversationId: number;
  inboundMessageId: string;
  plannerSchemaVersion: string;
  inputHash: string;
  status: TurnPlanStatus;
  plan: TurnPlan;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PersistTurnPlanInput = {
  correlationId: string;
  conversationId: number;
  inboundMessageId: string;
  inputHash: string;
  plan: TurnPlan;
};

export type PersistTurnPlanResult =
  | { ok: true; status: "created" | "duplicate"; record: TurnPlanRecord }
  | { ok: false; status: "error"; record: null; warning: string };

export type MarkTurnPlanResult =
  | { ok: true; status: "updated"; record: TurnPlanRecord }
  | { ok: false; status: "conflict" | "not_found" | "error"; record: TurnPlanRecord | null; warning: string };
