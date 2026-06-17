import type { BrainToolName } from "../tools/types";
import { SALES_AGENT_REQUESTED_MODES, SALES_AGENT_STRUCTURAL_SIGNALS } from "./salesAgentConstants";

export type SerializableId = string | number | null;
export type SalesAgentRequestedMode = (typeof SALES_AGENT_REQUESTED_MODES)[number];
export type SalesAgentToolName = BrainToolName;
export type SalesAgentStructuralSignal = (typeof SALES_AGENT_STRUCTURAL_SIGNALS)[number];

export type SalesAgentMessageDirection = "inbound" | "outbound" | "manual" | "system";

export type SalesAgentMessageSnapshot = {
  id: SerializableId;
  direction: SalesAgentMessageDirection | null;
  text: string | null;
  occurredAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  messageType: string | null;
  finalAction: string | null;
  status: string | null;
  intent: string | null;
  department: string | null;
  channel: string | null;
  platform: string | null;
  waId: string | null;
  phoneNumberId: string | null;
  conversationCaseId: SerializableId;
  source: string | null;
};

export type SalesAgentIdentityContext = {
  conversationCaseId: SerializableId;
  waId: string | null;
  phoneNumberId: string | null;
  email: string | null;
  phone: string | null;
  idCustomer: SerializableId;
  idOrder: SerializableId;
  invoiceNumber: SerializableId;
  contactId: SerializableId;
  customerCandidate: Record<string, unknown> | null;
};

export type SalesAgentMessageContext = {
  latestInboundMessage: SalesAgentMessageSnapshot | null;
  latestOutboundMessage: SalesAgentMessageSnapshot | null;
  recentMessages: SalesAgentMessageSnapshot[];
  latestInboundAt: string | null;
  latestOutboundAt: string | null;
};

export type SalesAgentCaseContext = {
  status: string | null;
  lifecycleStatus: string | null;
  department: string | null;
  humanOwnershipActive: boolean;
  aiBlocked: boolean;
  manualReplyActive: boolean;
};

export type SalesAgentCommercialContext = {
  commercialIntentLegacy: string | null;
  orderContext: Record<string, unknown> | null;
  productServiceContext: Record<string, unknown> | null;
  lead?: Record<string, unknown> | undefined;
  opportunity?: Record<string, unknown> | undefined;
};

export type SalesAgentPolicyContext = {
  policyId?: string;
  source?: string;
  dryRun?: boolean;
  allowAutoReply?: boolean;
  allowHumanHandoff?: boolean;
  allowCaseMutation?: boolean;
  allowCaseClose?: boolean;
  allowFollowup?: boolean;
  continueLegacyFlow?: boolean;
  blockedReasons?: string[];
  notes?: string[];
};

export type SalesAgentInput = {
  requestedMode: SalesAgentRequestedMode;
  currentTime: string;
  timezone: string;
  channel: string | null;
  platform: string | null;
  department: string | null;
  identity: SalesAgentIdentityContext;
  messages: SalesAgentMessageContext;
  caseContext: SalesAgentCaseContext;
  commercial: SalesAgentCommercialContext;
  structuralSignals: SalesAgentStructuralSignal[];
  availableCapabilities: SalesAgentToolName[];
  policyContext?: SalesAgentPolicyContext;
  metadata: Record<string, unknown>;
};

