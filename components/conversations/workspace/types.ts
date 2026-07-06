import type { AiControlMode, ConversationThreadMessage } from "@/lib/domains/conversations/thread";
import type { ConversationAutonomousState } from "@/lib/domains/conversations/autonomous-state";
import type { CustomerDetailReadModel } from "@/lib/domains/customers";

export type ConversationHeaderData = {
  conversationPublicId: string;
  contactName: string | null;
  waId: string | null;
  channel: string;
  status: string;
  ownerType: string | null;
  priority: string;
  windowOpen: boolean;
  controlMode: AiControlMode;
  closed: boolean;
  writeEnabled: boolean;
};

export type ConversationSummaryContext = {
  status: string;
  priority: string;
  owner: string | null;
  department: string | null;
  windowOpen: boolean;
  summary: string | null;
  intent: string | null;
  waitingFor: string | null;
  nextActionType: string | null;
  nextActionDueAt: string | null;
};

export type ConversationCustomerContext = {
  resolutionStatus: string;
  name: string | null;
  waId: string | null;
  email: string | null;
  platformOrigin: string | null;
  customerId: string | null;
};

export type ConversationCommercialContext = {
  opportunity: {
    opportunityKey: string;
    status: string;
    stage: string | null;
    currentSummary: string | null;
  } | null;
  salesNeedProfile: {
    useCase: string | null;
    customerType: string | null;
    budgetMin: number | null;
    budgetMax: number | null;
    purchaseUrgency: string | null;
    decisionReadiness: string | null;
    experienceLevel: string | null;
    missingInformation: string[];
  } | null;
};

export type ConversationWorkspaceData = {
  header: ConversationHeaderData;
  messages: ConversationThreadMessage[];
  threadError: string | null;
  truncated: boolean;
  writeEnabled: boolean;
  canReply: boolean;
  context: {
    summary: ConversationSummaryContext;
    customer: ConversationCustomerContext;
    commercial: ConversationCommercialContext;
    autonomous: ConversationAutonomousState;
    customerDetail: CustomerDetailReadModel | null;
  };
};
