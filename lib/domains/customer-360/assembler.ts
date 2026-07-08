import { CUSTOMER_360_CONTRACT_NAME, CUSTOMER_360_SCHEMA_VERSION, type Customer360ActionItem, type Customer360AddressItem, type Customer360CommercialEventItem, type Customer360ConversationItem, type Customer360MessageItem, type Customer360OpportunityItem, type Customer360OutcomeItem, type Customer360ProfileItem, type Customer360QuoteItem, type Customer360Section, type CustomerLifecycleEvent, type LifecycleEventAssembler } from "./types";

function compareIsoDesc(left: string | null, right: string | null) {
  const leftTime = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
  const rightTime = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;
  return rightTime - leftTime;
}

function sortEvents(items: CustomerLifecycleEvent[]) {
  return [...items].sort((left, right) => compareIsoDesc(left.occurredAt, right.occurredAt) || left.eventId.localeCompare(right.eventId));
}

function buildConversationEvents(customerId: string, items: Customer360ConversationItem[]): CustomerLifecycleEvent[] {
  return items.flatMap((conversation) => {
    const events: CustomerLifecycleEvent[] = [];
    if (conversation.lastInboundAt) {
      events.push({
        contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
        schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
        eventId: `conversation:${conversation.conversationId}:last_inbound`,
        eventType: "message_received",
        source: "conversation",
        entityType: "conversation",
        entityId: conversation.conversationId,
        customerId,
        occurredAt: conversation.lastInboundAt,
        summary: `Ultimo inbound en conversacion ${conversation.publicId}`,
        severity: "low",
        metadata: {
          publicId: conversation.publicId,
          channel: conversation.channel,
          provider: conversation.provider
        }
      });
    }
    if (conversation.lastOutboundAt) {
      events.push({
        contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
        schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
        eventId: `conversation:${conversation.conversationId}:last_outbound`,
        eventType: "message_sent",
        source: "conversation",
        entityType: "conversation",
        entityId: conversation.conversationId,
        customerId,
        occurredAt: conversation.lastOutboundAt,
        summary: `Ultimo outbound en conversacion ${conversation.publicId}`,
        severity: "low",
        metadata: {
          publicId: conversation.publicId,
          channel: conversation.channel,
          provider: conversation.provider
        }
      });
    }
    if (conversation.lastMessageAt) {
      events.push({
        contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
        schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
        eventId: `conversation:${conversation.conversationId}:last_message`,
        eventType: "conversation_updated",
        source: "conversation",
        entityType: "conversation",
        entityId: conversation.conversationId,
        customerId,
        occurredAt: conversation.lastMessageAt,
        summary: `Conversacion ${conversation.publicId} actualizada`,
        severity: "low",
        metadata: {
          publicId: conversation.publicId,
          status: conversation.status,
          messageCount: conversation.messageCount
        }
      });
    }
    return events;
  });
}

function buildMessageEvents(customerId: string, items: Customer360MessageItem[]): CustomerLifecycleEvent[] {
  return items.map((message) => ({
    contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
    schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
    eventId: `message:${message.messageId}`,
    eventType: message.direction === "outbound" ? "message_sent" : "message_received",
    source: "conversation_message",
    entityType: "message",
    entityId: message.messageId,
    customerId,
    occurredAt: message.occurredAt ?? new Date(0).toISOString(),
    summary: message.bodyPreview ? `${message.direction}: ${message.bodyPreview}` : `Mensaje ${message.direction}`,
    severity: "low",
    metadata: {
      conversationId: message.conversationId,
      publicId: message.publicId,
      senderType: message.senderType,
      messageType: message.messageType,
      status: message.status,
      providerMessageId: message.providerMessageId
    }
  }));
}

function buildOpportunityEvents(customerId: string, items: Customer360OpportunityItem[]): CustomerLifecycleEvent[] {
  return items.flatMap((opportunity) => {
    const events: CustomerLifecycleEvent[] = [
      {
        contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
        schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
        eventId: `opportunity:${opportunity.opportunityId}`,
        eventType: "opportunity_snapshot",
        source: "crm_opportunities",
        entityType: "opportunity",
        entityId: opportunity.opportunityId,
        customerId,
        occurredAt: opportunity.lastActivityAt ?? new Date(0).toISOString(),
        summary: `Oportunidad ${opportunity.opportunityKey} en estado ${opportunity.status}`,
        severity: "medium",
        metadata: {
          stage: opportunity.stage,
          primaryIntent: opportunity.primaryIntent,
          priority: opportunity.priority,
          temperature: opportunity.temperature,
          nextActionType: opportunity.nextActionType,
          nextActionDueAt: opportunity.nextActionDueAt
        }
      }
    ];
    if (opportunity.nextActionDueAt) {
      events.push({
        contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
        schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
        eventId: `opportunity:${opportunity.opportunityId}:next_action`,
        eventType: "next_action_due",
        source: "crm_opportunities",
        entityType: "opportunity",
        entityId: opportunity.opportunityId,
        customerId,
        occurredAt: opportunity.nextActionDueAt,
        summary: `Siguiente accion ${opportunity.nextActionType ?? "pendiente"}`,
        severity: "medium",
        metadata: {
          opportunityKey: opportunity.opportunityKey
        }
      });
    }
    return events;
  });
}

function buildProfileEvents(customerId: string, items: Customer360ProfileItem[]): CustomerLifecycleEvent[] {
  return items.map((profile) => ({
    contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
    schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
    eventId: `profile:${profile.profileId}`,
    eventType: "profile_updated",
    source: "crm_sales_need_profiles",
    entityType: "profile",
    entityId: profile.profileId,
    customerId,
    occurredAt: profile.lastUpdatedAt ?? new Date(0).toISOString(),
    summary: profile.useCase ? `Perfil ${profile.useCase}` : `Perfil comercial ${profile.profileKey}`,
    severity: "low",
    metadata: {
      opportunityKey: profile.opportunityKey,
      decisionReadiness: profile.decisionReadiness,
      purchaseUrgency: profile.purchaseUrgency,
      missingInformation: profile.missingInformation
    }
  }));
}

function buildActionEvents(customerId: string, items: Customer360Section<Customer360ActionItem>["items"]): CustomerLifecycleEvent[] {
  return items.map((action) => ({
    contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
    schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
    eventId: `action:${action.actionId}`,
    eventType:
      action.status === "completed"
        ? "action_completed"
        : action.status === "failed"
          ? "action_failed"
          : action.status === "scheduled"
            ? "action_scheduled"
            : "action_snapshot",
    source: "crm_agent_actions",
    entityType: "action",
    entityId: action.actionId,
    customerId,
    occurredAt: action.scheduledFor ?? new Date(0).toISOString(),
    summary: `${action.actionType} (${action.status})`,
    severity: action.status === "failed" ? "medium" : "low",
    metadata: {
      riskLevel: action.riskLevel,
      approvalRequirement: action.approvalRequirement,
      expiresAt: action.expiresAt,
      sourceRef: action.sourceRef
    }
  }));
}

function buildOutcomeEvents(customerId: string, items: Customer360Section<Customer360OutcomeItem>["items"]): CustomerLifecycleEvent[] {
  return items.map((outcome) => ({
    contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
    schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
    eventId: `outcome:${outcome.outcomeId}`,
    eventType: `action_${outcome.outcomeType}`,
    source: "crm_action_outcomes",
    entityType: "outcome",
    entityId: outcome.outcomeId,
    customerId,
    occurredAt: outcome.occurredAt,
    summary: `Outcome ${outcome.outcomeType} para action ${outcome.actionId}`,
    severity: outcome.outcomeType === "failed" ? "medium" : "low",
    metadata: {
      providerMessageId: outcome.providerMessageId,
      sourceRef: outcome.sourceRef
    }
  }));
}

function buildQuoteEvents(customerId: string, items: Customer360Section<Customer360QuoteItem>["items"]): CustomerLifecycleEvent[] {
  return items.flatMap((quote) => {
    const events: CustomerLifecycleEvent[] = [
      {
        contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
        schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
        eventId: `quote:${quote.quoteId}`,
        eventType: "quote_snapshot",
        source: "crm_quotes",
        entityType: "quote",
        entityId: quote.quoteId,
        customerId,
        occurredAt: quote.createdAt,
        summary: `Cotizacion ${quote.quoteId} version ${quote.version} (${quote.status})`,
        severity: "low",
        metadata: {
          requestId: quote.requestId,
          opportunityId: quote.opportunityId,
          total: quote.total,
          currency: quote.currency
        }
      }
    ];
    if (quote.sentAt) {
      events.push({
        contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
        schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
        eventId: `quote:${quote.quoteId}:sent`,
        eventType: "quote_sent",
        source: "crm_quotes",
        entityType: "quote",
        entityId: quote.quoteId,
        customerId,
        occurredAt: quote.sentAt,
        summary: `Cotizacion ${quote.quoteId} enviada`,
        severity: "low",
        metadata: { requestId: quote.requestId }
      });
    }
    if (quote.decidedAt) {
      events.push({
        contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
        schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
        eventId: `quote:${quote.quoteId}:decided`,
        eventType: `quote_${quote.status}`,
        source: "crm_quotes",
        entityType: "quote",
        entityId: quote.quoteId,
        customerId,
        occurredAt: quote.decidedAt,
        summary: `Cotizacion ${quote.quoteId} ${quote.status}`,
        severity: "low",
        metadata: { requestId: quote.requestId }
      });
    }
    return events;
  });
}

function buildAddressEvents(customerId: string, items: Customer360Section<Customer360AddressItem>["items"]): CustomerLifecycleEvent[] {
  return items.flatMap((address) => {
    const events: CustomerLifecycleEvent[] = [
      {
        contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
        schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
        eventId: `address:${address.addressId}`,
        eventType: "address_added",
        source: "customer_addresses",
        entityType: "address",
        entityId: address.addressId,
        customerId,
        occurredAt: address.createdAt,
        summary: `${address.addressLabel ?? "Direccion"} agregada`,
        severity: "low",
        metadata: {
          isDefault: address.isDefault,
          isActive: address.isActive
        }
      }
    ];
    if (address.isDefault) {
      events.push({
        contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
        schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
        eventId: `address:${address.addressId}:default`,
        eventType: "address_defaulted",
        source: "customer_addresses",
        entityType: "address",
        entityId: address.addressId,
        customerId,
        occurredAt: address.updatedAt,
        summary: `${address.addressLabel ?? "Direccion"} marcada como default`,
        severity: "low",
        metadata: {
          isActive: address.isActive
        }
      });
    }
    return events;
  });
}

function buildCommercialEvents(customerId: string, items: Customer360CommercialEventItem[]): CustomerLifecycleEvent[] {
  return items.map((event) => ({
    contractName: CUSTOMER_360_CONTRACT_NAME as "Customer360Snapshot",
    schemaVersion: CUSTOMER_360_SCHEMA_VERSION,
    eventId: `commercial:${event.eventId}`,
    eventType: event.eventType,
    source: event.source,
    entityType: "commercial_event",
    entityId: event.eventId,
    customerId,
    occurredAt: event.occurredAt,
    summary: event.summary,
    severity: "low",
    metadata: {
      correlationId: event.correlationId,
      conversationId: event.conversationId,
      opportunityId: event.opportunityId,
      sourceRef: event.sourceRef
    }
  }));
}

export const createLifecycleEventAssembler: () => LifecycleEventAssembler = () => {
  return ({ customerId, profile, addresses, now }) => {
    const events = sortEvents([
      ...buildConversationEvents(customerId, profile.sections.conversations.items),
      ...buildMessageEvents(customerId, profile.sections.messages.items),
      ...buildOpportunityEvents(customerId, profile.sections.opportunities.items),
      ...buildProfileEvents(customerId, profile.sections.profiles.items),
      ...buildActionEvents(customerId, profile.sections.actions.items),
      ...buildOutcomeEvents(customerId, profile.sections.outcomes.items),
      ...buildQuoteEvents(customerId, profile.sections.quotes.items),
      ...buildAddressEvents(customerId, addresses.items),
      ...buildCommercialEvents(customerId, profile.sections.commercialEvents.items)
    ]);

    return {
      state: events.length > 0 ? "real" : "partial",
      source: "lifecycle_event_assembler",
      lastUpdatedAt: events[0]?.occurredAt ?? null,
      warnings: profile.warnings.length > 0 ? [...new Set(profile.warnings)] : [],
      total: events.length,
      items: events.map((event) => ({
        ...event,
        metadata: {
          ...event.metadata,
          assembledAt: now.toISOString()
        }
      }))
    };
  };
};
