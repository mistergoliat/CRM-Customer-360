import type { PlatformOrigin } from "@/lib/domains/customers/platform-origin";
import type { CustomerDetailReadModel } from "@/lib/domains/customers/types";

export type LocalAiSdrState =
  | "unresolved"
  | "email_requested"
  | "email_received"
  | "customer_found"
  | "customer_not_found"
  | "creation_offered"
  | "creation_confirmed"
  | "customer_created"
  | "customer_linked"
  | "completed"
  | "blocked"
  | "handoff";

export type LocalAiSdrAction =
  | "ask_email"
  | "lookup_customer"
  | "offer_customer_creation"
  | "create_customer"
  | "link_customer"
  | "load_customer_context"
  | "continue_sales_flow"
  | "handoff"
  | "no_action";

export type LocalAiSdrToolName =
  | "lookup_customer_by_email"
  | "create_customer"
  | "link_customer_to_conversation"
  | "get_customer_context";

export type LocalAiSdrDecision = {
  intent: string;
  action: LocalAiSdrAction;
  tool: LocalAiSdrToolName | null;
  arguments: Record<string, unknown>;
  requiresCustomerConfirmation: boolean;
  requiresHumanApproval: boolean;
  confidence: number;
  reason: string;
  policyTags: string[];
};

export type LocalAiSdrConversationState = {
  state: LocalAiSdrState;
  pendingAction: LocalAiSdrAction | null;
  email: string | null;
  firstname: string | null;
  lastname: string | null;
  customerId: string | null;
  customerEmail: string | null;
  customerName: string | null;
  customerPlatformOrigin: PlatformOrigin | null;
  linkStatus: "linked" | "already_linked" | "conflict" | "unavailable" | null;
  lastDecisionId: string | null;
  lastToolName: LocalAiSdrToolName | null;
  lastToolStatus: string | null;
  lastToolResult: Record<string, unknown> | null;
  lastResponseText: string | null;
  reason: string | null;
  confidence: number | null;
  warnings: string[];
  context: Record<string, unknown>;
};

export type LocalAiSdrConversationSummary = {
  publicId: string;
  waId: string | null;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPlatformOrigin: PlatformOrigin | null;
  state: LocalAiSdrState;
  pendingAction: LocalAiSdrAction | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  updatedAt: string | null;
  messageCount: number;
  warnings: string[];
};

export type LocalAiSdrMessage = {
  id: string;
  providerMessageId: string | null;
  direction: "inbound" | "outbound";
  senderType: string;
  messageType: string;
  body: string;
  status: string | null;
  createdAt: string | null;
  source: string;
};

export type LocalAiSdrExecution = {
  publicId: string;
  status: string;
  triggerType: string;
  executionMode: string;
  agentType: string;
  startedAt: string;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type LocalAiSdrToolExecution = {
  publicId: string;
  toolName: string;
  status: string;
  idempotencyKey: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type LocalAiSdrDetail = {
  conversation: LocalAiSdrConversationSummary | null;
  messages: LocalAiSdrMessage[];
  state: LocalAiSdrConversationState;
  customer: CustomerDetailReadModel["customer"] | null;
  latestExecution: LocalAiSdrExecution | null;
  latestDecision: {
    publicId: string;
    intent: string;
    action: LocalAiSdrAction;
    tool: LocalAiSdrToolName | null;
    confidence: number | null;
    reason: string | null;
    policyTags: string[];
    arguments: Record<string, unknown>;
  } | null;
  latestToolExecution: LocalAiSdrToolExecution | null;
  dataQuality: {
    status: "valid" | "partial" | "unavailable" | "error";
    warnings: string[];
    source: string;
  };
  warnings: string[];
};

export type LocalAiSdrOverview = {
  conversations: LocalAiSdrConversationSummary[];
  selectedConversationId: string | null;
  selectedConversation: LocalAiSdrDetail | null;
  writeEnabled: boolean;
  executionMode: string;
  warnings: string[];
};

export type LocalAiSdrTurnInput = {
  conversationId?: string | null;
  waId?: string | null;
  externalContactId?: string | null;
  channelAccountId?: string | null;
  messageText: string;
  messageId?: string | null;
  currentTime?: string | Date;
  idempotencyKey?: string | null;
};

export type LocalAiSdrTurnResult = {
  ok: boolean;
  conversationId: string;
  responseText: string | null;
  decision: LocalAiSdrDecision;
  state: LocalAiSdrConversationState;
  customer: CustomerDetailReadModel["customer"] | null;
  detail: LocalAiSdrDetail | null;
  warnings: string[];
  errors: string[];
};
