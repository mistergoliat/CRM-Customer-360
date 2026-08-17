import type { CommercialLineItem, CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import type { CreatedQuote } from "@/lib/domains/created-quote";
import type { SelectedShippingOption } from "@/lib/domains/selected-shipping-option";
import type { ShippingDestination } from "@/lib/domains/shipping-destination";
import type { PendingCommercialIntentRecord } from "../multi-intent/types";
import type { CommercialObjectiveStatus, CommercialWorkStatus, CommercialWorkStepStatus } from "./statuses";
import type { CommercialObjectiveType } from "./objectiveTypes";
import type { CommercialWorkStepCapability, CommercialWorkStepType } from "./stepTypes";

export type CommercialTrigger =
  | {
      type: "CUSTOMER_MESSAGE";
      conversationId: number;
      opportunityId: number | null;
      sourceMessageId: number | null;
      sourceMessageSequence?: number | null;
    }
  | {
      type: "FOLLOW_UP_DUE";
      actionId: number;
      conversationId?: number | null;
      opportunityId?: number | null;
    }
  | {
      type: "WORK_RETRY_DUE";
      commercialWorkId: string;
      stepId: string;
    }
  | {
      type: "SYSTEM_EVENT";
      eventType: string;
      correlationId: string;
      conversationId?: number | null;
      opportunityId?: number | null;
    }
  | {
      type: "HANDOFF";
      conversationId: number;
      opportunityId?: number | null;
    };

export type CommercialObjectiveOrigin = "customer_requested" | "system_generated" | "operator_requested" | "projection_seed";

export type CommercialObjectiveSeed =
  | {
      kind?: "objective";
      seedId?: string;
      type: CommercialObjectiveType;
      origin?: CommercialObjectiveOrigin;
      inputs?: CommercialObjectiveInputs;
    }
  | {
      kind: "cancel";
      seedId?: string;
      targetType?: CommercialObjectiveType | "selection" | "destination" | "shipping" | "quote";
      reason?: string;
    };

export type CommercialObjectiveInputs = {
  query?: string;
  productReference?: string;
  quantity?: number;
  items?: CommercialLineItem[];
  productEvidenceAvailable?: boolean;
  destinationText?: string;
  communeId?: number;
  canonicalDestinationName?: string;
  optionIndex?: number;
};

export type CommercialObjectiveResolvedInputs = {
  commercialLineItemsFactId?: string;
  shippingDestinationFactId?: string;
  selectedShippingOptionFactId?: string;
  createdQuoteFactId?: string;
  shippingCalculationExecutionId?: string;
};

export type CommercialMissingRequirement =
  | "PRODUCT"
  | "PRODUCT_EVIDENCE"
  | "QUANTITY"
  | "DESTINATION"
  | "SELECTION"
  | "SHIPPING"
  | "QUOTE";

export type CommercialEvidenceRef = {
  kind: "request_fact" | "capability_execution" | "commercial_event" | "agent_action" | "conversation_state";
  id?: string | number;
  factType?: "commercial_line_items" | "shipping_destination" | "selected_shipping_option" | "created_quote" | "pending_commercial_intents";
  capabilityName?: string;
  status?: string;
  stale?: boolean;
  reason?: string;
};

export type CommercialWorkBlockerCode =
  | "MISSING_PRODUCT"
  | "MISSING_PRODUCT_EVIDENCE"
  | "MISSING_QUANTITY"
  | "MISSING_DESTINATION"
  | "MISSING_SELECTION"
  | "MISSING_SHIPPING"
  | "CAPABILITY_UNAVAILABLE"
  | "WAITING_CUSTOMER"
  | "WAITING_SYSTEM"
  | "HUMAN_OWNER_ACTIVE"
  | "AI_DISABLED"
  | "SUPERSEDED"
  | "UNSUPPORTED"
  | "CANCELLED"
  | "STALE_EVIDENCE";

export type CommercialWorkBlockerSource = "work" | "objective" | "step" | "conversation";

export type CommercialWorkBlocker = {
  code: CommercialWorkBlockerCode;
  source: CommercialWorkBlockerSource;
  objectiveId?: string;
  stepId?: string;
  evidence?: CommercialEvidenceRef[];
};

export type CommercialWorkDependency =
  | { type: "FACT_CONFIRMED"; factType: "commercial_line_items" | "shipping_destination" | "selected_shipping_option" | "created_quote" }
  | { type: "CAPABILITY_EVIDENCE"; capabilityName: CommercialWorkStepCapability }
  | { type: "CUSTOMER_INPUT"; requirement: CommercialMissingRequirement }
  | { type: "STEP_COMPLETED"; stepId: string }
  | { type: "CONVERSATION_AUTONOMY_ALLOWED" };

export type CommercialObjective = {
  objectiveId: string;
  type: CommercialObjectiveType;
  status: CommercialObjectiveStatus;
  origin: CommercialObjectiveOrigin;
  inputs: CommercialObjectiveInputs;
  resolvedInputs: CommercialObjectiveResolvedInputs;
  missingRequirements: CommercialMissingRequirement[];
  supersedesObjectiveIds: string[];
  evidence: CommercialEvidenceRef[];
  blockers: CommercialWorkBlocker[];
};

export type CommercialWorkStep = {
  stepId: string;
  objectiveIds: string[];
  type: CommercialWorkStepType;
  status: CommercialWorkStepStatus;
  dependencies: CommercialWorkDependency[];
  capabilityName: CommercialWorkStepCapability | null;
  input: CommercialObjectiveInputs;
  evidence: CommercialEvidenceRef[];
  blockers: CommercialWorkBlocker[];
  retryable: boolean;
  retryCandidate: boolean;
  idempotencyKey: string | null;
  attemptCount: number;
  maxAttempts: number | null;
  nextAttemptAt: string | null;
  startedAt: string | null;
  lastAttemptAt: string | null;
  lockOwner: string | null;
  lockUntil: string | null;
};

export type CommercialCapabilityExecutionProjection = {
  id?: number | string;
  publicId: string;
  capabilityName: CommercialWorkStepCapability | "search_company_knowledge" | string;
  executionStatus: "completed" | "missing_information" | "denied" | "requires_approval" | "temporarily_blocked" | "invalid_arguments" | "failed" | "not_executed";
  retryable?: boolean;
  errorCode?: string | null;
  responseSummaryJson?: Record<string, unknown> | null;
  completedAt?: string | null;
};

export type CommercialConversationProjection = {
  id: number;
  humanOwnerActive: boolean;
  aiEnabled: boolean;
  status?: string | null;
};

export type CommercialOpportunityProjection = {
  id: number | null;
  status?: string | null;
};

export type CommercialWorkProjectionInput = {
  trigger: CommercialTrigger;
  conversation: CommercialConversationProjection;
  opportunity?: CommercialOpportunityProjection | null;
  objectiveSeeds?: CommercialObjectiveSeed[];
  pendingCommercialIntents?: PendingCommercialIntentRecord[];
  commercialLineItems?: CommercialLineItemSelection | null;
  shippingDestination?: ShippingDestination | null;
  selectedShippingOption?: SelectedShippingOption | null;
  createdQuote?: CreatedQuote | null;
  recentCapabilityExecutions?: CommercialCapabilityExecutionProjection[];
  recentCommercialEvents?: CommercialEvidenceRef[];
  now?: string | Date;
};

export type CommercialWork = {
  id: string;
  projectionVersion: 1;
  opportunityId: number | null;
  conversationId: number;
  sourceMessageId: number | null;
  trigger: CommercialTrigger;
  status: CommercialWorkStatus;
  objectives: CommercialObjective[];
  steps: CommercialWorkStep[];
  blockers: CommercialWorkBlocker[];
  derivedAt: string;
  metrics: CommercialWorkProjectionMetrics;
};

export type CommercialWorkProjectionMetrics = {
  objectiveCount: number;
  readyStepCount: number;
  waitingCustomerObjectiveCount: number;
  waitingSystemStepCount: number;
  blockerCount: number;
};
