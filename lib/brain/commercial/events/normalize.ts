import type {
  AgentToolLoopCompletedRecordedPayload,
  AgentToolLoopConfigurationSource,
  AgentToolLoopTerminalReason,
  AutonomousTurnContinuityFailedRecordedPayload,
  AutonomousTurnDispositionRecordedPayload,
  CommercialEventSource,
  CommercialEventType,
  CommercialEventV1,
  CustomerIdentityCapabilityOutcomeRecordedPayload,
  CustomerIdentityResolutionMatchedBy,
  CustomerIdentityResolutionOutcome,
  CustomerIdentityResolutionPhase,
  CustomerIdentityResolutionRecordedPayload,
  CustomerIdentityResolver,
  CustomerOnboardingTransitionOperation,
  CustomerOnboardingTransitionRecordedPayload,
  CustomerSessionWarningRecordedPayload
} from "./types";
import {
  COMMERCIAL_EVENT_CONTRACT_NAME,
  COMMERCIAL_EVENT_SCHEMA_VERSION
} from "./types";
import {
  buildAgentToolLoopCompletedDedupeKey,
  buildAutonomousTurnContinuityFailedDedupeKey,
  buildAutonomousTurnDispositionDedupeKey,
  buildCommercialEventCorrelationId,
  buildCommercialEventId,
  buildCommercialStatusEventDedupeKey,
  buildCustomerIdentityCapabilityOutcomeDedupeKey,
  buildCustomerIdentityResolutionDedupeKey,
  buildCustomerOnboardingTransitionDedupeKey,
  buildCustomerSessionWarningDedupeKey,
  buildFollowUpDueCommercialEventDedupeKey,
  buildInboundCommercialEventDedupeKey,
  buildInternalCommandCommercialEventDedupeKey
} from "./dedupe";

const SENSITIVE_KEY_PATTERN = /authorization|api[-_]?key|token|secret|password|cookie|header|webhook/i;
const COMMERCIAL_EVENT_CAUSATION_ID_PATTERN = /^cevt_[a-f0-9]{32}$/i;

function nowIso() {
  return new Date().toISOString();
}

function assertPlainSerializable(value: unknown, path: string): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") {
    throw new Error(`commercial_event_non_serializable:${path}`);
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item, index) => assertPlainSerializable(item, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(record)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        throw new Error(`commercial_event_forbidden_key:${path}.${key}`);
      }
      if (typeof nestedValue === "undefined") continue;
      output[key] = assertPlainSerializable(nestedValue, `${path}.${key}`);
    }
    return output;
  }
  throw new Error(`commercial_event_non_serializable:${path}`);
}

function normalizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const normalized = assertPlainSerializable(value, "root");
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new Error("commercial_event_invalid_record");
  }
  return normalized as Record<string, unknown>;
}

function normalizeCommercialEventCausationId(value?: string | null) {
  const causationId = value?.trim() || null;
  if (!causationId) return null;
  if (!COMMERCIAL_EVENT_CAUSATION_ID_PATTERN.test(causationId)) {
    throw new Error(`commercial_event_invalid_causation_id:${causationId}`);
  }
  return causationId;
}

function buildBaseEvent(input: {
  eventType: CommercialEventType;
  source: CommercialEventSource;
  sourceEventId: string | null;
  dedupeKey: string;
  correlationId?: string | null;
  causationId?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  channel?: string | null;
  provider?: string | null;
  occurredAt?: string | null;
  receivedAt?: string | null;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): CommercialEventV1 {
  const dedupeKey = input.dedupeKey.trim();
  if (!dedupeKey) throw new Error("commercial_event_missing_dedupe_key");
  const sourceEventId = input.sourceEventId?.trim() || null;
  const occurredAt = input.occurredAt?.trim() || nowIso();
  const receivedAt = input.receivedAt?.trim() || nowIso();
  const payload = normalizeRecord(input.payload);
  const metadata = normalizeRecord(input.metadata ?? {});

  return {
    contractName: COMMERCIAL_EVENT_CONTRACT_NAME,
    schemaVersion: COMMERCIAL_EVENT_SCHEMA_VERSION,
    id: buildCommercialEventId(dedupeKey),
    eventType: input.eventType,
    source: input.source,
    sourceEventId,
    dedupeKey,
    correlationId: buildCommercialEventCorrelationId(input.eventType, input.source, sourceEventId, dedupeKey, input.correlationId),
    causationId: normalizeCommercialEventCausationId(input.causationId),
    customerId: input.customerId === undefined || input.customerId === null || input.customerId === "" ? null : String(input.customerId),
    conversationId: input.conversationId === undefined || input.conversationId === null || input.conversationId === "" ? null : String(input.conversationId),
    opportunityId: input.opportunityId === undefined || input.opportunityId === null || input.opportunityId === "" ? null : String(input.opportunityId),
    channel: input.channel?.trim() || null,
    provider: input.provider?.trim() || null,
    occurredAt,
    receivedAt,
    payload,
    metadata
  };
}

export function normalizeCommercialEventPayload(payload: Record<string, unknown>) {
  return normalizeRecord(payload);
}

export function normalizeCommercialEventMetadata(metadata: Record<string, unknown>) {
  return normalizeRecord(metadata);
}

export function normalizeMetaWhatsAppInboundCommercialEvent(input: {
  providerMessageId: string;
  phoneNumberId: string;
  externalSenderId: string;
  senderPhone: string | null;
  senderName: string | null;
  messageType: string;
  text: string;
  occurredAt: string;
  receivedAt?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  messageId?: string | number | null;
  correlationId?: string | null;
  causationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const providerMessageId = input.providerMessageId.trim();
  return buildBaseEvent({
    eventType: "customer_message_received",
    source: "meta_whatsapp",
    sourceEventId: providerMessageId,
    dedupeKey: buildInboundCommercialEventDedupeKey(providerMessageId),
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: "whatsapp",
    provider: "meta",
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt ?? undefined,
    payload: {
      providerMessageId,
      phoneNumberId: input.phoneNumberId.trim(),
      externalSenderId: input.externalSenderId.trim(),
      senderPhone: input.senderPhone,
      senderName: input.senderName,
      messageType: input.messageType.trim(),
      text: input.text,
      messageId: input.messageId === undefined || input.messageId === null ? null : String(input.messageId)
    },
    metadata: {
      eventKind: "native_whatsapp_inbound",
      channel: "whatsapp",
      provider: "meta",
      messageId: input.messageId === undefined || input.messageId === null ? null : String(input.messageId),
      ...normalizeCommercialEventMetadata(input.metadata ?? {})
    }
  });
}

export function normalizeMetaWhatsAppStatusCommercialEvent(input: {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  occurredAt: string;
  receivedAt?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  messageId?: string | number | null;
  correlationId?: string | null;
  causationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const providerMessageId = input.providerMessageId.trim();
  const status = input.status.trim();
  return buildBaseEvent({
    eventType: `outbound_message_${status}` as CommercialEventType,
    source: "meta_whatsapp",
    sourceEventId: providerMessageId,
    dedupeKey: buildCommercialStatusEventDedupeKey(providerMessageId, status),
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: "whatsapp",
    provider: "meta",
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt ?? undefined,
    payload: {
      providerMessageId,
      status,
      messageId: input.messageId === undefined || input.messageId === null ? null : String(input.messageId)
    },
    metadata: {
      eventKind: "meta_whatsapp_status",
      channel: "whatsapp",
      provider: "meta",
      messageId: input.messageId === undefined || input.messageId === null ? null : String(input.messageId),
      ...normalizeCommercialEventMetadata(input.metadata ?? {})
    }
  });
}

export function normalizeFollowUpDueCommercialEvent(input: {
  actionId: string;
  scheduledAt: string;
  occurredAt?: string | null;
  receivedAt?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  correlationId?: string | null;
  causationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const actionId = input.actionId.trim();
  const scheduledAt = input.scheduledAt.trim();
  return buildBaseEvent({
    eventType: "follow_up_due",
    source: "system_timer",
    sourceEventId: actionId,
    dedupeKey: buildFollowUpDueCommercialEventDedupeKey(actionId, scheduledAt),
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: null,
    provider: null,
    occurredAt: input.occurredAt ?? scheduledAt,
    receivedAt: input.receivedAt ?? undefined,
    payload: {
      actionId,
      scheduledAt
    },
    metadata: {
      eventKind: "follow_up_timer",
      ...normalizeCommercialEventMetadata(input.metadata ?? {})
    }
  });
}

export function normalizeInternalCommandCommercialEvent(input: {
  commandId: string;
  result: "completed" | "failed";
  occurredAt?: string | null;
  receivedAt?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  correlationId?: string | null;
  causationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const commandId = input.commandId.trim();
  const result = input.result.trim();
  return buildBaseEvent({
    eventType: result === "failed" ? "internal_command_failed" : "internal_command_completed",
    source: "internal_command",
    sourceEventId: commandId,
    dedupeKey: buildInternalCommandCommercialEventDedupeKey(commandId, result),
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: null,
    provider: null,
    occurredAt: input.occurredAt ?? nowIso(),
    receivedAt: input.receivedAt ?? undefined,
    payload: {
      commandId,
      result
    },
    metadata: {
      eventKind: "internal_command",
      ...normalizeCommercialEventMetadata(input.metadata ?? {})
    }
  });
}

// ACS-R1-04-T07. Identity/onboarding audit trail - descriptive evidence
// (release spec section on T07), never authoritative. source is always
// "internal_command": these events are produced by native-cycle server-side
// orchestration, never directly by the Meta webhook or a timer.

export function normalizeCustomerIdentityResolutionCommercialEvent(input: {
  messageId: string;
  phase: CustomerIdentityResolutionPhase;
  resolver: CustomerIdentityResolver;
  outcome: CustomerIdentityResolutionOutcome;
  matchedBy: CustomerIdentityResolutionMatchedBy;
  hasResolvedCustomer: boolean;
  occurredAt?: string | null;
  receivedAt?: string | null;
  correlationId?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
}) {
  const messageId = input.messageId.trim();
  const payload: CustomerIdentityResolutionRecordedPayload = {
    phase: input.phase,
    resolver: input.resolver,
    outcome: input.outcome,
    matchedBy: input.matchedBy,
    hasResolvedCustomer: input.hasResolvedCustomer
  };
  return buildBaseEvent({
    eventType: "customer_identity_resolution_recorded",
    source: "internal_command",
    sourceEventId: messageId,
    dedupeKey: buildCustomerIdentityResolutionDedupeKey(messageId, input.phase, input.resolver, input.outcome),
    correlationId: input.correlationId,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: "whatsapp",
    provider: null,
    occurredAt: input.occurredAt ?? undefined,
    receivedAt: input.receivedAt ?? undefined,
    payload: payload as unknown as Record<string, unknown>,
    metadata: { eventKind: "customer_identity_resolution" }
  });
}

export function normalizeCustomerOnboardingTransitionCommercialEvent(input: {
  conversationId: string;
  operation: CustomerOnboardingTransitionOperation;
  purpose: string;
  previousStatus: string | null;
  nextStatus: string;
  previousVersion: number | null;
  nextVersion: number;
  pendingFields: string[];
  collectedAvailability: CustomerOnboardingTransitionRecordedPayload["collectedAvailability"];
  hasResolvedCustomer: boolean;
  occurredAt?: string | null;
  receivedAt?: string | null;
  correlationId?: string | null;
  customerId?: string | number | null;
  opportunityId?: string | number | null;
}) {
  const conversationId = input.conversationId.trim();
  const payload: CustomerOnboardingTransitionRecordedPayload = {
    operation: input.operation,
    purpose: input.purpose,
    previousStatus: input.previousStatus,
    nextStatus: input.nextStatus,
    previousVersion: input.previousVersion,
    nextVersion: input.nextVersion,
    pendingFields: [...input.pendingFields],
    collectedAvailability: input.collectedAvailability,
    hasResolvedCustomer: input.hasResolvedCustomer
  };
  return buildBaseEvent({
    eventType: "customer_onboarding_transition_recorded",
    source: "internal_command",
    sourceEventId: null,
    dedupeKey: buildCustomerOnboardingTransitionDedupeKey(conversationId, input.nextVersion, input.operation),
    correlationId: input.correlationId,
    customerId: input.customerId ?? null,
    conversationId,
    opportunityId: input.opportunityId ?? null,
    channel: "whatsapp",
    provider: null,
    occurredAt: input.occurredAt ?? undefined,
    receivedAt: input.receivedAt ?? undefined,
    payload: payload as unknown as Record<string, unknown>,
    metadata: { eventKind: "customer_onboarding_transition" }
  });
}

export function normalizeCustomerIdentityCapabilityOutcomeCommercialEvent(input: {
  capability: CustomerIdentityCapabilityOutcomeRecordedPayload["capability"];
  executionPublicId: string;
  gatewayStatus: string;
  businessOutcome: string;
  retryable: boolean;
  stableErrorCode: string | null;
  occurredAt?: string | null;
  receivedAt?: string | null;
  correlationId?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  /** ACS-R1-04-T07 correlation only (release spec section 9) - the canonical loop's decisionId, when this turn already has one. Not part of the envelope schema (no dedicated column); carried in metadata only. */
  decisionId?: string | null;
}) {
  const executionPublicId = input.executionPublicId.trim();
  const payload: CustomerIdentityCapabilityOutcomeRecordedPayload = {
    capability: input.capability,
    executionPublicId,
    gatewayStatus: input.gatewayStatus,
    businessOutcome: input.businessOutcome,
    retryable: input.retryable,
    stableErrorCode: input.stableErrorCode
  };
  return buildBaseEvent({
    eventType: "customer_identity_capability_outcome_recorded",
    source: "internal_command",
    sourceEventId: executionPublicId,
    dedupeKey: buildCustomerIdentityCapabilityOutcomeDedupeKey(executionPublicId, input.businessOutcome),
    correlationId: input.correlationId,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: "whatsapp",
    provider: null,
    occurredAt: input.occurredAt ?? undefined,
    receivedAt: input.receivedAt ?? undefined,
    payload: payload as unknown as Record<string, unknown>,
    metadata: input.decisionId ? { eventKind: "customer_identity_capability_outcome", decisionId: input.decisionId } : { eventKind: "customer_identity_capability_outcome" }
  });
}

export function normalizeCustomerSessionWarningCommercialEvent(input: {
  messageId: string;
  phase: CustomerIdentityResolutionPhase;
  warningCode: string;
  executionPublicId?: string | null;
  occurredAt?: string | null;
  receivedAt?: string | null;
  correlationId?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  /** ACS-R1-04-T07 correlation only - see the identical note on the capability-outcome normalizer above. */
  decisionId?: string | null;
}) {
  const messageId = input.messageId.trim();
  const executionPublicId = input.executionPublicId?.trim() || null;
  const payload: CustomerSessionWarningRecordedPayload = {
    warningCode: input.warningCode,
    phase: input.phase,
    executionPublicId
  };
  return buildBaseEvent({
    eventType: "customer_session_warning_recorded",
    source: "internal_command",
    sourceEventId: messageId,
    dedupeKey: buildCustomerSessionWarningDedupeKey(messageId, input.phase, input.warningCode),
    correlationId: input.correlationId,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: "whatsapp",
    provider: null,
    occurredAt: input.occurredAt ?? undefined,
    receivedAt: input.receivedAt ?? undefined,
    payload: payload as unknown as Record<string, unknown>,
    metadata: input.decisionId ? { eventKind: "customer_session_warning", decisionId: input.decisionId } : { eventKind: "customer_session_warning" }
  });
}

// ACS-R1-05-T06.2. Canonical terminal-outcome event for a sales turn. One
// event per inbound message (dedupe key keyed only on inboundMessageId,
// never on the turn's outcome) - a retry/replay of the same turn resolves to
// the same row rather than a second one.

export function normalizeAutonomousTurnDispositionCommercialEvent(input: {
  inboundMessageId: string | null;
  correlationId?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  occurredAt?: string | null;
  receivedAt?: string | null;
  payload: AutonomousTurnDispositionRecordedPayload;
}) {
  const dedupeSourceId = (input.inboundMessageId ?? input.correlationId ?? "").trim();
  if (!dedupeSourceId) throw new Error("commercial_event_missing_dedupe_key");
  return buildBaseEvent({
    eventType: "autonomous_turn_disposition",
    source: "internal_command",
    sourceEventId: input.inboundMessageId,
    dedupeKey: buildAutonomousTurnDispositionDedupeKey(dedupeSourceId),
    correlationId: input.correlationId,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: "whatsapp",
    provider: null,
    occurredAt: input.occurredAt ?? undefined,
    receivedAt: input.receivedAt ?? undefined,
    payload: input.payload as unknown as Record<string, unknown>,
    metadata: { eventKind: "autonomous_turn_disposition" }
  });
}

export function normalizeAutonomousTurnContinuityFailedCommercialEvent(input: {
  inboundMessageId: string | null;
  reason: string;
  correlationId?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  occurredAt?: string | null;
  receivedAt?: string | null;
}) {
  const dedupeSourceId = (input.inboundMessageId ?? input.correlationId ?? "").trim();
  if (!dedupeSourceId) throw new Error("commercial_event_missing_dedupe_key");
  const payload: AutonomousTurnContinuityFailedRecordedPayload = {
    inboundMessageId: input.inboundMessageId,
    reason: input.reason
  };
  return buildBaseEvent({
    eventType: "autonomous_turn_continuity_failed",
    source: "internal_command",
    sourceEventId: input.inboundMessageId,
    dedupeKey: buildAutonomousTurnContinuityFailedDedupeKey(dedupeSourceId),
    correlationId: input.correlationId,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: "whatsapp",
    provider: null,
    occurredAt: input.occurredAt ?? undefined,
    receivedAt: input.receivedAt ?? undefined,
    payload: payload as unknown as Record<string, unknown>,
    metadata: { eventKind: "autonomous_turn_continuity_failed" }
  });
}

// ACS-R1-05.1-T02.1. One event per inbound message, same dedupe rationale as
// autonomous_turn_disposition above - a retry/replay resolves to the same row.

export function normalizeAgentToolLoopCompletedCommercialEvent(input: {
  inboundMessageId: string | null;
  terminalReason: AgentToolLoopTerminalReason;
  decisionCount: number;
  toolExecutionCount: number;
  toolsUsed: string[];
  finalMessagePresent: boolean;
  handoffReasonPresent: boolean;
  stepsSummary: AgentToolLoopCompletedRecordedPayload["stepsSummary"];
  configurationSource: AgentToolLoopConfigurationSource;
  configurationRecordId: number | null;
  configurationVersion: number | null;
  configurationHash: string | null;
  effectiveModel: string;
  effectiveTemperature: number;
  effectiveMaxOutputSize: number | null;
  effectiveTimeoutMs: number;
  effectiveMaxAgentStepsPerTurn: number;
  effectiveMaxToolCallsPerTurn: number;
  correlationId?: string | null;
  customerId?: string | number | null;
  conversationId?: string | number | null;
  opportunityId?: string | number | null;
  occurredAt?: string | null;
  receivedAt?: string | null;
}) {
  const dedupeSourceId = (input.inboundMessageId ?? input.correlationId ?? "").trim();
  if (!dedupeSourceId) throw new Error("commercial_event_missing_dedupe_key");
  const payload: AgentToolLoopCompletedRecordedPayload = {
    inboundMessageId: input.inboundMessageId,
    terminalReason: input.terminalReason,
    decisionCount: input.decisionCount,
    toolExecutionCount: input.toolExecutionCount,
    toolsUsed: [...input.toolsUsed],
    finalMessagePresent: input.finalMessagePresent,
    handoffReasonPresent: input.handoffReasonPresent,
    stepsSummary: input.stepsSummary.map((entry) => ({ ...entry })),
    configurationSource: input.configurationSource,
    configurationRecordId: input.configurationRecordId,
    configurationVersion: input.configurationVersion,
    configurationHash: input.configurationHash,
    effectiveModel: input.effectiveModel,
    effectiveTemperature: input.effectiveTemperature,
    effectiveMaxOutputSize: input.effectiveMaxOutputSize,
    effectiveTimeoutMs: input.effectiveTimeoutMs,
    effectiveMaxAgentStepsPerTurn: input.effectiveMaxAgentStepsPerTurn,
    effectiveMaxToolCallsPerTurn: input.effectiveMaxToolCallsPerTurn
  };
  return buildBaseEvent({
    eventType: "agent_tool_loop_completed",
    source: "internal_command",
    sourceEventId: input.inboundMessageId,
    dedupeKey: buildAgentToolLoopCompletedDedupeKey(dedupeSourceId),
    correlationId: input.correlationId,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    opportunityId: input.opportunityId ?? null,
    channel: "whatsapp",
    provider: null,
    occurredAt: input.occurredAt ?? undefined,
    receivedAt: input.receivedAt ?? undefined,
    payload: payload as unknown as Record<string, unknown>,
    metadata: { eventKind: "agent_tool_loop_completed" }
  });
}
