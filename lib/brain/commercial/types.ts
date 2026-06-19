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

export type LeadId = string;
export type OpportunityId = string;

export type LeadStatus =
  | "new"
  | "contacted"
  | "engaged"
  | "qualifying"
  | "qualified"
  | "unqualified"
  | "converted"
  | "dormant"
  | "archived";

export type OpportunityStatus =
  | "new"
  | "engaged"
  | "qualifying"
  | "quote_pending"
  | "quote_ready_for_review"
  | "quote_sent"
  | "waiting_customer"
  | "followup_scheduled"
  | "negotiation"
  | "stalled"
  | "won"
  | "lost"
  | "cancelled"
  | "archived";

export type OpportunityStage =
  | "discovery"
  | "qualification"
  | "solution_fit"
  | "quotation"
  | "negotiation"
  | "closing"
  | "post_sale_handoff";

export type LeadSource =
  | "whatsapp_inbound"
  | "whatsapp_outbound"
  | "ecommerce"
  | "pos"
  | "manual_hub"
  | "referral"
  | "campaign"
  | "email"
  | "phone_call"
  | "appsheet_import"
  | "legacy_import"
  | "unknown";

export type CommercialIntent =
  | "product_inquiry"
  | "product_recommendation"
  | "price_request"
  | "stock_request"
  | "quote_request"
  | "delivery_request"
  | "discount_request"
  | "bulk_purchase"
  | "equipment_project"
  | "maintenance_request"
  | "assembly_request"
  | "post_sale_request"
  | "general_information"
  | "unknown";

export type CommercialSignal =
  | "replied"
  | "no_reply"
  | "left_on_seen"
  | "high_intent"
  | "medium_intent"
  | "low_intent"
  | "asks_price"
  | "asks_stock"
  | "asks_delivery"
  | "asks_discount"
  | "asks_quote"
  | "shares_requirements"
  | "shares_budget"
  | "shares_deadline"
  | "objection_price"
  | "objection_timing"
  | "objection_trust"
  | "objection_product_fit"
  | "human_requested"
  | "purchase_confirmed"
  | "rejection_explicit"
  | "conversation_inactive";

export type CommercialPriority = "low" | "normal" | "high" | "urgent";

export type CommercialTemperature = "cold" | "warm" | "hot" | "unknown";

export type CommercialConfidence = "high" | "medium" | "low";

export type CommercialValueEstimate =
  | {
      mode: "exact";
      currency: string;
      amount: number;
    }
  | {
      mode: "range";
      currency: string;
      minimum: number;
      maximum: number;
    }
  | {
      mode: "unknown";
      currency?: string | null;
      note?: string | null;
    };

export type CommercialActorReference = {
  id: string;
  type:
    | "agent"
    | "operator"
    | "team"
    | "queue"
    | "human"
    | "external_system"
    | "unknown";
  displayName?: string | null;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export type CommercialChannelReference = {
  channel:
    | "whatsapp"
    | "email"
    | "web"
    | "phone"
    | "pos"
    | "hub"
    | "campaign"
    | "legacy"
    | "unknown";
  threadId?: string | null;
  messageId?: string | null;
  conversationCaseId?: string | number | null;
  source?: LeadSource;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export type OpportunityProductInterest = {
  productId?: string | null;
  productReference?: string | null;
  productNameSnapshot: string;
  category?: string | null;
  requestedQuantity?: number | null;
  confidence: CommercialConfidence;
  source: LeadSource;
  notes?: string | null;
};

export type OpportunityRequirement =
  | {
      type: "budget";
      value: CommercialValueEstimate;
      confidence: CommercialConfidence;
      source: LeadSource;
      notes?: string | null;
    }
  | {
      type: "quantity";
      value: number;
      confidence: CommercialConfidence;
      source: LeadSource;
      notes?: string | null;
    }
  | {
      type: "dimensions";
      value: {
        width?: number | null;
        height?: number | null;
        length?: number | null;
        unit?: string | null;
      };
      confidence: CommercialConfidence;
      source: LeadSource;
      notes?: string | null;
    }
  | {
      type: "location";
      value: {
        country?: string | null;
        region?: string | null;
        city?: string | null;
        address?: string | null;
      };
      confidence: CommercialConfidence;
      source: LeadSource;
      notes?: string | null;
    }
  | {
      type: "deliveryDeadline";
      value: string;
      confidence: CommercialConfidence;
      source: LeadSource;
      notes?: string | null;
    }
  | {
      type: "useCase";
      value: string;
      confidence: CommercialConfidence;
      source: LeadSource;
      notes?: string | null;
    }
  | {
      type: "installationRequired";
      value: boolean;
      confidence: CommercialConfidence;
      source: LeadSource;
      notes?: string | null;
    }
  | {
      type: "maintenanceRequired";
      value: boolean;
      confidence: CommercialConfidence;
      source: LeadSource;
      notes?: string | null;
    }
  | {
      type: "preferredChannel";
      value: CommercialChannelReference["channel"];
      confidence: CommercialConfidence;
      source: LeadSource;
      notes?: string | null;
    }
  | {
      type: "custom";
      key: string;
      value: string | number | boolean | null;
      confidence: CommercialConfidence;
      source: LeadSource;
      notes?: string | null;
    };

export type OpportunityObjectionType =
  | "price"
  | "timing"
  | "trust"
  | "stock"
  | "delivery"
  | "product_fit"
  | "approval_required"
  | "competitor"
  | "unknown";

export type OpportunityObjectionStatus =
  | "open"
  | "acknowledged"
  | "addressed"
  | "resolved"
  | "reopened"
  | "closed";

export type OpportunityObjection = {
  type: OpportunityObjectionType;
  description: string;
  status: OpportunityObjectionStatus;
  detectedAt: string;
  source: LeadSource;
  confidence: CommercialConfidence;
  resolvedAt?: string | null;
};

export type OpportunityStateTransition = {
  from: OpportunityStatus;
  to: OpportunityStatus;
  reason: string;
  source: LeadSource | "brain";
  detectedAt: string;
  requiresEvidence?: boolean;
  requiresApproval?: boolean;
  notes?: string | null;
};

export type OpportunityContext = {
  leadId?: LeadId | null;
  customerMasterId?: string | null;
  customerCandidateId?: string | null;
  conversationCaseId?: string | number | null;
  channel?: CommercialChannelReference | null;
  quoteDraftId?: string | null;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export type LeadReadModel = {
  id: LeadId;
  customerMasterId?: string | null;
  customerCandidateId?: string | null;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  waId?: string | null;
  source: LeadSource;
  status: LeadStatus;
  commercialTemperature: CommercialTemperature;
  primaryIntent?: CommercialIntent | null;
  signals: CommercialSignal[];
  firstSeenAt: string;
  lastInteractionAt?: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export type OpportunityReadModel = {
  id: OpportunityId;
  leadId?: LeadId | null;
  customerMasterId?: string | null;
  customerCandidateId?: string | null;
  title: string;
  status: OpportunityStatus;
  stage?: OpportunityStage | null;
  primaryIntent: CommercialIntent;
  priority: CommercialPriority;
  commercialTemperature: CommercialTemperature;
  estimatedValue?: CommercialValueEstimate | null;
  currency: string;
  probability?: number | null;
  productInterests: OpportunityProductInterest[];
  requirements: OpportunityRequirement[];
  objections: OpportunityObjection[];
  signals: CommercialSignal[];
  source: LeadSource;
  assignedActor?: CommercialActorReference | null;
  conversationReferences: CommercialChannelReference[];
  currentNextBestAction?: {
    currentState: OpportunityStatus;
    detectedSignal?: CommercialSignal | null;
    recommendedAction: string;
    recommendedChannel: CommercialChannelReference["channel"];
    urgency: CommercialPriority;
    confidence: CommercialConfidence;
    rationale: string;
    requiresHumanApproval: boolean;
  } | null;
  nextFollowUpAt?: string | null;
  lastInteractionAt?: string | null;
  wonAt?: string | null;
  lostAt?: string | null;
  lostReason?: OpportunityLostReason | null;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export type OpportunityLostReason =
  | "price"
  | "no_response"
  | "chose_competitor"
  | "unavailable_stock"
  | "delivery_timing"
  | "product_not_suitable"
  | "budget_unavailable"
  | "postponed"
  | "duplicate"
  | "invalid_lead"
  | "explicit_rejection"
  | "unknown";
