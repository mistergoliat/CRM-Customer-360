import type { CommercialContextCompleteness, CommercialContextWarning } from "./constants";
import type { SalesAgentRequestedMode, SalesAgentToolName, SalesAgentInput, SalesAgentPolicyContext } from "./salesAgentTypes";

export type CommercialContextSourceSummary = {
  sourceShape: string;
  supportedContextShape: boolean;
  channel: string | null;
  platform: string | null;
  department: string | null;
  conversationCaseId: string | number | null;
  waId: string | null;
  email: string | null;
  phone: string | null;
  idCustomer: string | number | null;
  idOrder: string | number | null;
  invoiceNumber: string | number | null;
  contactId: string | number | null;
  caseStatus: string | null;
  caseLifecycleStatus: string | null;
  humanOwnershipActive: boolean;
  aiBlocked: boolean;
  manualReplyActive: boolean;
  hasCustomerCandidate: boolean;
  hasCustomerReference: boolean;
  hasConversationHistory: boolean;
  hasLatestCustomerMessage: boolean;
  hasLatestOutboundMessage: boolean;
  leadAvailable: boolean;
  opportunityAvailable: boolean;
  hasCommercialEntity: boolean;
  commercialIntentLegacy: string | null;
  orderContextAvailable: boolean;
  productServiceContextAvailable: boolean;
  latestInboundAt: string | null;
  latestOutboundAt: string | null;
  recentMessagesCount: number;
  recentMessagesLimit: number;
};

export type CommercialContextBuilderMetadata = {
  version: string;
  generatedAt: string;
  currentTime: string;
  timezone: string;
  requestedMode: SalesAgentRequestedMode;
  availableCapabilities: SalesAgentToolName[];
  recentMessagesLimit: number;
  sanitized: boolean;
  sanitizedFields: string[];
  sourceShape: string;
  safeMetadata: Record<string, unknown>;
};

export type CommercialContextBuilderBaseResult = {
  salesAgentInput: SalesAgentInput | null;
  warnings: CommercialContextWarning[];
  sourceSummary: CommercialContextSourceSummary;
  completeness: CommercialContextCompleteness;
  metadata: CommercialContextBuilderMetadata;
};

export type CommercialContextBuilderSuccessResult = CommercialContextBuilderBaseResult & {
  status: "success";
  salesAgentInput: SalesAgentInput;
  completeness: Exclude<CommercialContextCompleteness, "insufficient">;
};

export type CommercialContextBuilderInsufficientResult = CommercialContextBuilderBaseResult & {
  status: "insufficient_context";
  completeness: "insufficient";
};

export type CommercialContextBuilderInvalidInputResult = CommercialContextBuilderBaseResult & {
  status: "invalid_input";
  salesAgentInput: null;
  completeness: "insufficient";
  errors: string[];
};

export type CommercialContextBuilderResult =
  | CommercialContextBuilderSuccessResult
  | CommercialContextBuilderInsufficientResult
  | CommercialContextBuilderInvalidInputResult;

export type CommercialContextBuilderInput = {
  brainContext: unknown;
  inboundMessage: unknown;
  requestedMode: SalesAgentRequestedMode;
  currentTime: string | Date;
  timezone: string;
  availableCapabilities: readonly SalesAgentToolName[];
  policyContext?: SalesAgentPolicyContext;
  metadata?: Record<string, unknown>;
};
