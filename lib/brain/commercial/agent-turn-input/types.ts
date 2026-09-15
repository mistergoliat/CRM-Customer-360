import type { CommercialChannelReference } from "../types";
import type {
  CommercialDomainReadModel,
  CommercialFreshnessState,
  CommercialQuoteGrounding,
  CommercialShippingState
} from "../domain-read-model";
import type { CatalogAvailabilityStatus } from "@/lib/catalog";
import type { QuoteServiceQuote } from "@/lib/domains/quote-service";
import type { CommercialWorkStatus } from "../work";

/** The provider-neutral cognitive input contract consumed by the future R3 Harness. */
export const AGENT_TURN_INPUT_CONTRACT_NAME = "AgentTurnInput" as const;
export const AGENT_TURN_INPUT_SCHEMA_VERSION = "1" as const;

export const AGENT_FRESHNESS_STATES = ["CURRENT", "STALE", "MISSING", "UNKNOWN"] as const;
export type AgentFreshnessState = (typeof AGENT_FRESHNESS_STATES)[number];

export type AgentChannel = CommercialChannelReference["channel"];

export type AgentCaseBlocker = {
  readonly code: string;
  readonly source: string;
};

export type AgentCaseState = {
  readonly caseId: string;
  readonly conversationId: number;
  readonly opportunityId: number | null;
  readonly workId: string | null;
  readonly workVersion: number | null;
  readonly status: CommercialWorkStatus | "NOT_CREATED";
  readonly blockers: readonly AgentCaseBlocker[];
};

export type AgentActiveObjective = {
  readonly objectiveId: string;
  readonly type: string;
  readonly status: string;
  readonly missingRequirements: readonly string[];
  readonly blockers: readonly AgentCaseBlocker[];
};

export type AgentProductPrice = {
  readonly amount: number | null;
  readonly currency: string | null;
};

/** Allowlisted Catalog fields only; descriptions, variants, links and provenance stay outside v1. */
export type AgentCatalogHydration = {
  readonly name: string;
  readonly sku: string | null;
  readonly price: AgentProductPrice | null;
  readonly availability: CatalogAvailabilityStatus;
  readonly stockQuantity: number | null;
  readonly weightKg: number | null;
  readonly freshness: AgentFreshnessState;
};

export type AgentCartItem = {
  readonly productId: string;
  readonly combinationId: string | null;
  readonly quantity: number;
  readonly product: AgentCatalogHydration | null;
  readonly freshness: AgentFreshnessState;
};

export type AgentCart = {
  readonly items: readonly AgentCartItem[];
  readonly freshness: AgentFreshnessState;
};

export type AgentDestination = {
  readonly communeId: number;
  readonly canonicalName: string;
  readonly freshness: AgentFreshnessState;
};

export type AgentShippingOption = {
  readonly optionIndex: number;
  readonly carrierName: string;
  readonly serviceType: string;
  readonly totalCost: number;
  readonly estimatedDelivery: string;
};

export type AgentShipping = {
  readonly status: CommercialShippingState;
  readonly selectedOption: AgentShippingOption | null;
  readonly alternatives?: readonly AgentShippingOption[];
  readonly freshness: AgentFreshnessState;
};

export type AgentQuote = {
  readonly quoteId: string;
  readonly quoteNumber: string | null;
  readonly status: QuoteServiceQuote["status"] | null;
  readonly currency: string | null;
  readonly total: string | null;
  readonly validUntil: string | null;
  readonly version: number | null;
  readonly grounding: CommercialQuoteGrounding;
  readonly freshness: AgentFreshnessState;
};

export type AgentCommercialState = {
  readonly cart: AgentCart;
  readonly destination: AgentDestination | null;
  readonly shipping: AgentShipping;
  readonly quote: AgentQuote | null;
};

export type AgentCustomerIdentity = {
  readonly status: string;
  readonly identityLevel: string | null;
  readonly hasResolvedCustomer: boolean;
  readonly verificationRequired: boolean;
};

export type AgentCustomerProfile = {
  readonly status: "AVAILABLE";
  readonly retrievedAt: string | null;
  readonly relationshipSummary: {
    readonly conversationCount: number | null;
    readonly opportunityCount: number | null;
    readonly quoteCount: number | null;
    readonly orderCount: number | null;
    readonly lastActivityAt: string | null;
  } | null;
};

export type AgentCustomerContext = {
  readonly identity: AgentCustomerIdentity;
  readonly profile: AgentCustomerProfile | null;
};

export type AgentCurrentTurn = {
  readonly inboundMessageId: string;
  readonly channel: AgentChannel;
  readonly text: string;
  readonly occurredAt: string;
  readonly correlationId: string | null;
};

export type AgentConversationMessage = {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly occurredAt: string | null;
};

export type AgentConversationContinuity = {
  readonly isFirstConversationalTurn: boolean;
  readonly hasPriorAssistantMessages: boolean;
  readonly hasPriorCustomerMessages: boolean;
};

export type AgentConversationContext = {
  readonly compactSummary: string | null;
  readonly recentMessages: readonly AgentConversationMessage[];
  readonly sessionVersion: string | number | null;
  readonly continuity: AgentConversationContinuity;
};

export type AgentRelevantEvidence = {
  readonly kind: string;
  readonly status: CommercialFreshnessState;
  readonly source: string;
  readonly capturedAt: string | null;
  readonly summary: string;
};

export type AgentCapabilityAvailability = "AVAILABLE" | "BLOCKED";

export type AgentCapabilityExposure = {
  readonly name: string;
  readonly sideEffect: boolean;
  readonly availability: AgentCapabilityAvailability;
  readonly useWhen: string;
  readonly preconditions: readonly string[];
};

export type AgentExecutionPolicy = {
  readonly identityLevel: string;
  readonly humanOwner: boolean;
  readonly aiBlocked: boolean;
  readonly allowedSensitiveActions: readonly string[];
  readonly handoff: {
    readonly allowedReasons: readonly string[];
  };
};

export type AgentTurnInput = {
  readonly caseState: AgentCaseState;
  readonly activeObjective: AgentActiveObjective | null;
  readonly commercialState: AgentCommercialState;
  readonly customerContext: AgentCustomerContext;
  readonly currentTurn: AgentCurrentTurn;
  readonly conversationContext: AgentConversationContext;
  readonly relevantEvidence: readonly AgentRelevantEvidence[];
  readonly capabilities: readonly AgentCapabilityExposure[];
  readonly executionPolicy: AgentExecutionPolicy;
};

/** Inputs are already-read projections. The builder intentionally owns no I/O dependency. */
export type BuildAgentTurnInputInput = {
  readonly domainReadModel: CommercialDomainReadModel;
  readonly currentTurn: AgentCurrentTurn;
  readonly conversationContext: AgentConversationContext;
  readonly capabilities?: readonly AgentCapabilityExposure[];
  readonly executionPolicy: AgentExecutionPolicy;
};

/** Alias kept for callers that name the argument after the builder rather than the output contract. */
export type AgentTurnInputBuilderInput = BuildAgentTurnInputInput;
