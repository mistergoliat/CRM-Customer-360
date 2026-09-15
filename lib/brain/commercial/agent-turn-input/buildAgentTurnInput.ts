import type {
  CommercialCatalogProductProjection,
  CommercialDomainReadModel,
  CommercialFreshness,
  CommercialReadEvidence
} from "../domain-read-model";
import type { CommercialWorkBlocker } from "../work";
import type {
  AgentActiveObjective,
  AgentCapabilityExposure,
  AgentCatalogHydration,
  AgentCaseBlocker,
  AgentCaseState,
  AgentCommercialState,
  AgentConversationContext,
  AgentCustomerContext,
  AgentCustomerProfile,
  AgentExecutionPolicy,
  AgentFreshnessState,
  AgentQuote,
  AgentRelevantEvidence,
  AgentShipping,
  AgentShippingOption,
  AgentTurnInput,
  BuildAgentTurnInputInput
} from "./types";

function mapFreshness(freshness: CommercialFreshness, missing = false): AgentFreshnessState {
  if (missing) return "MISSING";
  if (freshness.state === "CURRENT" || freshness.state === "STALE" || freshness.state === "UNKNOWN") return freshness.state;
  // SUPERSEDED/HISTORICAL are evidence states, never current commercial state.
  return "UNKNOWN";
}

function mapBlockers(blockers: readonly CommercialWorkBlocker[]): AgentCaseBlocker[] {
  return blockers.map((blocker) => ({ code: blocker.code, source: blocker.source }));
}

function mapCaseState(readModel: CommercialDomainReadModel): AgentCaseState {
  const current = readModel.case;
  return {
    caseId: current.caseId,
    conversationId: current.conversationId,
    opportunityId: current.opportunityId,
    workId: current.workId,
    workVersion: current.workVersion,
    status: current.status,
    blockers: mapBlockers(current.blockers)
  };
}

function mapActiveObjective(readModel: CommercialDomainReadModel): AgentActiveObjective | null {
  const objective = readModel.objective;
  if (!objective) return null;
  return {
    objectiveId: objective.objectiveId,
    type: objective.type,
    status: objective.status,
    missingRequirements: [...objective.missingRequirements],
    blockers: mapBlockers(objective.blockers)
  };
}

function mapProduct(product: CommercialCatalogProductProjection): AgentCatalogHydration | null {
  if (product.freshness.state === "SUPERSEDED" || product.freshness.state === "HISTORICAL") return null;
  return {
    name: product.name,
    sku: product.sku,
    price: product.price
      ? {
          amount: product.price.amount,
          currency: product.price.currency
        }
      : null,
    availability: product.availability,
    stockQuantity: product.stockQuantity,
    weightKg: product.weightKg,
    freshness: mapFreshness(product.freshness)
  };
}

function mapCommercialState(readModel: CommercialDomainReadModel): AgentCommercialState {
  const cart = readModel.cart;
  const items = cart.items.map((item) => {
    const product = item.product ? mapProduct(item.product) : null;
    return {
      productId: item.productId,
      combinationId: item.combinationId,
      quantity: item.quantity,
      product,
      freshness: mapFreshness(item.freshness, item.product !== null && product === null)
    };
  });

  const destination = readModel.destination && readModel.destination.freshness.state !== "SUPERSEDED" && readModel.destination.freshness.state !== "HISTORICAL"
    ? {
        communeId: readModel.destination.communeId,
        canonicalName: readModel.destination.canonicalName,
        freshness: mapFreshness(readModel.destination.freshness)
      }
    : null;

  const shipping = readModel.shipping;
  const selectedOption: AgentShippingOption | null = shipping.state === "CURRENT" && shipping.selection
    ? {
        optionIndex: shipping.selection.optionIndex,
        carrierName: shipping.selection.carrierName,
        serviceType: shipping.selection.serviceType,
        totalCost: shipping.selection.totalCost,
        estimatedDelivery: shipping.selection.estimatedDelivery
      }
    : null;
  const agentShipping: AgentShipping = {
    status: shipping.state,
    selectedOption,
    freshness: mapFreshness(shipping.freshness, shipping.state === "MISSING")
  };

  const quote = readModel.quote && readModel.quote.freshness.state !== "SUPERSEDED" && readModel.quote.freshness.state !== "HISTORICAL"
    ? mapQuote(readModel.quote)
    : null;

  return {
    cart: {
      items,
      freshness: mapFreshness(cart.freshness, cart.factId === null && cart.items.length === 0)
    },
    destination,
    shipping: agentShipping,
    quote
  };
}

function mapQuote(quote: NonNullable<CommercialDomainReadModel["quote"]>): AgentQuote {
  return {
    quoteId: quote.quoteId,
    quoteNumber: quote.quoteNumber,
    status: quote.status,
    currency: quote.currency,
    total: quote.total,
    validUntil: quote.validUntil,
    version: quote.version,
    grounding: quote.grounding,
    freshness: mapFreshness(quote.freshness)
  };
}

function mapCustomerProfile(profile: CommercialDomainReadModel["customer"]["profile"]): AgentCustomerProfile | null {
  if (!profile || profile.status !== "AVAILABLE") return null;
  return {
    status: "AVAILABLE",
    retrievedAt: profile.retrievedAt,
    relationshipSummary: profile.relationshipSummary
      ? {
          conversationCount: profile.relationshipSummary.conversationCount,
          opportunityCount: profile.relationshipSummary.opportunityCount,
          quoteCount: profile.relationshipSummary.quoteCount,
          orderCount: profile.relationshipSummary.orderCount,
          lastActivityAt: profile.relationshipSummary.lastActivityAt
        }
      : null
  };
}

function mapCustomerContext(readModel: CommercialDomainReadModel): AgentCustomerContext {
  return {
    identity: {
      status: readModel.customer.status,
      identityLevel: readModel.customer.identityLevel,
      hasResolvedCustomer: readModel.customer.hasResolvedCustomer,
      verificationRequired: readModel.customer.verificationRequired
    },
    profile: mapCustomerProfile(readModel.customer.profile)
  };
}

function mapEvidence(evidence: readonly CommercialReadEvidence[]): AgentRelevantEvidence[] {
  return evidence.map((item) => ({
    kind: item.kind,
    status: item.status,
    source: item.source,
    capturedAt: item.capturedAt,
    summary: item.summary
  }));
}

function cloneConversationContext(context: AgentConversationContext): AgentConversationContext {
  return {
    compactSummary: context.compactSummary,
    recentMessages: context.recentMessages.map((message) => ({
      role: message.role,
      text: message.text,
      occurredAt: message.occurredAt
    })),
    sessionVersion: context.sessionVersion,
    continuity: {
      isFirstConversationalTurn: context.continuity.isFirstConversationalTurn,
      hasPriorAssistantMessages: context.continuity.hasPriorAssistantMessages,
      hasPriorCustomerMessages: context.continuity.hasPriorCustomerMessages
    }
  };
}

function cloneCapabilities(capabilities: readonly AgentCapabilityExposure[]): AgentCapabilityExposure[] {
  return capabilities.map((capability) => ({
    name: capability.name,
    sideEffect: capability.sideEffect,
    availability: capability.availability,
    useWhen: capability.useWhen,
    preconditions: [...capability.preconditions]
  }));
}

function cloneExecutionPolicy(policy: AgentExecutionPolicy): AgentExecutionPolicy {
  return {
    identityLevel: policy.identityLevel,
    humanOwner: policy.humanOwner,
    aiBlocked: policy.aiBlocked,
    allowedSensitiveActions: [...policy.allowedSensitiveActions],
    handoff: { allowedReasons: [...policy.handoff.allowedReasons] }
  };
}

/**
 * Pure P1 compiler. Every value is projected from already-settled inputs;
 * this function performs no domain reads, capability calls, provider calls or
 * text interpretation.
 */
export function buildAgentTurnInput(input: BuildAgentTurnInputInput): AgentTurnInput {
  return {
    caseState: mapCaseState(input.domainReadModel),
    activeObjective: mapActiveObjective(input.domainReadModel),
    commercialState: mapCommercialState(input.domainReadModel),
    customerContext: mapCustomerContext(input.domainReadModel),
    currentTurn: {
      inboundMessageId: input.currentTurn.inboundMessageId,
      channel: input.currentTurn.channel,
      text: input.currentTurn.text,
      occurredAt: input.currentTurn.occurredAt,
      correlationId: input.currentTurn.correlationId
    },
    conversationContext: cloneConversationContext(input.conversationContext),
    relevantEvidence: mapEvidence(input.domainReadModel.evidence),
    capabilities: cloneCapabilities(input.capabilities ?? []),
    executionPolicy: cloneExecutionPolicy(input.executionPolicy)
  };
}
