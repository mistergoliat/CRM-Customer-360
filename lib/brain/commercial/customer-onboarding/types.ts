import type { PlatformOrigin } from "@/lib/domains/customers/platform-origin";
import type { CustomerDetailReadModel } from "@/lib/domains/customers/types";

export type CustomerOnboardingState =
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

export type CustomerOnboardingAction =
  | "ask_email"
  | "lookup_customer"
  | "offer_customer_creation"
  | "create_customer"
  | "link_customer"
  | "load_customer_context"
  | "continue_sales_flow"
  | "handoff"
  | "no_action";

export type CustomerOnboardingToolName =
  | "lookup_customer_by_email"
  | "create_customer"
  | "link_customer_to_conversation"
  | "get_customer_context";

export type ToolRiskLevel = "low" | "medium" | "high";

export type AiSdrOperationalDecision = {
  intent: string;
  action: CustomerOnboardingAction;
  tool: CustomerOnboardingToolName | null;
  arguments: Record<string, unknown>;
  requiresCustomerConfirmation: boolean;
  requiresHumanApproval: boolean;
  confidence: number;
  reason: string;
  policyTags: string[];
};

export type CustomerLookupResult =
  | {
      status: "found";
      customer: CustomerDetailReadModel["customer"];
      warnings: string[];
    }
  | {
      status: "not_found";
      normalizedEmail: string;
      warnings: string[];
    }
  | {
      status: "conflict";
      candidates: CustomerDetailReadModel["customer"][];
      warnings: string[];
    };

export type CustomerConversationLinkResult =
  | {
      status: "confirmed";
      link: CustomerConversationLinkRecord;
      warnings: string[];
    }
  | {
      status: "already_linked";
      link: CustomerConversationLinkRecord;
      warnings: string[];
    }
  | {
      status: "conflict";
      link: CustomerConversationLinkRecord | null;
      warnings: string[];
    }
  | {
      status: "unavailable";
      warnings: string[];
    };

export type CustomerOnboardingCustomerContext = {
  customer: CustomerDetailReadModel["customer"] | null;
  recentConversations: Array<{ id: string; label: string; href: string; meta: string }>;
  openCases: Array<{ id: string; label: string; href: string; meta: string }>;
  recentOrders: Array<{ id: string; label: string; href: string; meta: string }>;
  warnings: string[];
  dataQuality: {
    status: "valid" | "partial" | "unavailable" | "error";
    warnings: string[];
    source: string;
  };
};

export type CustomerOnboardingContext = {
  conversationCaseId: string | number | null;
  waId: string | null;
  messageText: string;
  normalizedMessage: string;
  messageId: string | null;
  emails: string[];
  emailStatus: "absent" | "single" | "ambiguous";
  confirmationStatus: "explicit" | "implicit" | "negative" | "absent";
  currentState: CustomerOnboardingStateRecord | null;
  currentLink: CustomerConversationLinkRecord | null;
  customerContext: CustomerOnboardingCustomerContext | null;
  platformOrigin: PlatformOrigin | null;
  pendingAction: CustomerOnboardingAction | null;
};

export type CustomerConversationLinkRecord = {
  id: number | null;
  customerId: string;
  conversationCaseId: string;
  linkStatus: "confirmed" | "rejected" | "unlinked";
  linkSource: "ai_sdr" | "operator" | "system";
  confidence: "high" | "medium" | "low";
  linkedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CustomerOnboardingStateRecord = {
  id: number | null;
  conversationCaseId: string;
  waId: string | null;
  state: CustomerOnboardingState;
  pendingAction: CustomerOnboardingAction | null;
  pendingCustomerConfirmation: boolean;
  email: string | null;
  firstname: string | null;
  lastname: string | null;
  customerId: string | null;
  customerPlatformOrigin: PlatformOrigin | null;
  linkStatus: string | null;
  lastDecisionId: string | null;
  lastToolName: CustomerOnboardingToolName | null;
  lastToolStatus: string | null;
  lastToolResult: Record<string, unknown> | null;
  lastResponseText: string | null;
  reason: string | null;
  confidence: number | null;
  warnings: string[];
  context: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CustomerOnboardingToolRun<TStatus extends string, TPayload> = {
  tool: CustomerOnboardingToolName;
  status: TStatus;
  request: Record<string, unknown>;
  result: TPayload;
  warnings: string[];
};

export type CustomerOnboardingRunInput = {
  conversationCaseId: string | number | null;
  waId: string | null;
  messageId: string | null;
  messageText: string;
  currentTime: string | Date;
  correlationId: string;
  brainContext?: Record<string, unknown> | null;
  writeEnabled?: boolean;
  source?: string;
};

export type CustomerOnboardingRunResult = {
  ok: boolean;
  state: CustomerOnboardingStateRecord | null;
  decision: AiSdrOperationalDecision;
  toolRuns: Array<
    | CustomerOnboardingToolRun<"requested", Record<string, unknown>>
    | CustomerOnboardingToolRun<"executed", Record<string, unknown>>
    | CustomerOnboardingToolRun<"failed", Record<string, unknown>>
    | CustomerOnboardingToolRun<"blocked", Record<string, unknown>>
  >;
  responseText: string | null;
  warnings: string[];
  errors: string[];
  customer: CustomerDetailReadModel["customer"] | null;
  customerContext: CustomerOnboardingCustomerContext | null;
  dataQuality: {
    status: "valid" | "partial" | "unavailable" | "error";
    warnings: string[];
    source: string;
  };
  link: CustomerConversationLinkRecord | null;
  persisted: boolean;
  auditEvents: string[];
  metadata: Record<string, unknown>;
};
