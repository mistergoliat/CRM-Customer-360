import { COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES } from "../constants";
import type {
  CommercialContextBuilderInput,
  CommercialContextBuilderInvalidInputResult,
  CommercialContextBuilderResult,
} from "../types";
import type { CommercialContextCompleteness, CommercialContextWarning } from "../constants";
import type { SalesAgentInput, SalesAgentMessageSnapshot } from "../salesAgentTypes";
import {
  buildCommercialCaseContext,
  buildCommercialCommercialContext,
  buildCommercialIdentityContext,
  buildCommercialMessageContext,
  buildCommercialMetadata,
  buildCommercialSourceSummary,
  buildCommercialStructuralSignals,
  collectCommercialTimestampSignals,
  hasStaleCommercialContext,
  normalizeCommercialBrainContext,
  normalizeCommercialCurrentTime,
  normalizeCommercialInboundMessage,
  normalizeCommercialPolicyContext,
  sanitizeCommercialObject
} from "./adapters";

const COMMERCIAL_WARNING_VALUES = [
  "missing_latest_customer_message",
  "missing_customer_reference",
  "missing_conversation_history",
  "missing_channel",
  "missing_commercial_entity",
  "stale_context",
  "identity_conflict",
  "ai_blocked",
  "human_owner_active",
  "unsupported_context_shape",
  "sanitization_applied"
] as const;

function isWarning(value: string): value is CommercialContextWarning {
  return (COMMERCIAL_WARNING_VALUES as readonly string[]).includes(value);
}

function dedupeWarnings(values: string[]): CommercialContextWarning[] {
  const seen = new Set<CommercialContextWarning>();
  for (const value of values) {
    if (isWarning(value)) {
      seen.add(value);
    }
  }
  return [...seen];
}

function validateRequestedMode(value: unknown): value is SalesAgentInput["requestedMode"] {
  return value === "minimal" || value === "standard" || value === "recovery";
}

function validateCurrentTime(value: string | Date) {
  const normalized = normalizeCommercialCurrentTime(value);
  return normalized && !Number.isNaN(new Date(normalized).getTime()) ? normalized : null;
}

function normalizeWarnings(input: {
  channel: string | null;
  hasCustomerReference: boolean;
  hasConversationHistory: boolean;
  hasLatestCustomerMessage: boolean;
  missingCommercialEntity: boolean;
  hasCommercialEntity: boolean;
  humanOwnershipActive: boolean;
  aiBlocked: boolean;
  staleContext: boolean;
  identityConflict: boolean;
  supportedContextShape: boolean;
  sanitizationApplied: boolean;
}) {
  const warnings: string[] = [];
  if (!input.hasLatestCustomerMessage) warnings.push("missing_latest_customer_message");
  if (!input.hasCustomerReference) warnings.push("missing_customer_reference");
  if (!input.hasConversationHistory) warnings.push("missing_conversation_history");
  if (!input.channel) warnings.push("missing_channel");
  if (input.missingCommercialEntity) warnings.push("missing_commercial_entity");
  if (input.staleContext) warnings.push("stale_context");
  if (input.identityConflict) warnings.push("identity_conflict");
  if (input.aiBlocked) warnings.push("ai_blocked");
  if (input.humanOwnershipActive) warnings.push("human_owner_active");
  if (!input.supportedContextShape) warnings.push("unsupported_context_shape");
  if (input.sanitizationApplied) warnings.push("sanitization_applied");
  return dedupeWarnings(warnings);
}

function computeCompleteness(input: {
  hasLatestCustomerMessage: boolean;
  hasCustomerReference: boolean;
  hasConversationHistory: boolean;
  hasCustomerCandidate: boolean;
  hasCommercialEntity: boolean;
  supportedContextShape: boolean;
}): CommercialContextCompleteness {
  if (!input.supportedContextShape || !input.hasLatestCustomerMessage) {
    return "insufficient";
  }

  if (input.hasLatestCustomerMessage && input.hasCustomerReference && input.hasConversationHistory && input.hasCustomerCandidate && input.hasCommercialEntity) {
    return "complete";
  }

  if (input.hasLatestCustomerMessage && (input.hasCustomerCandidate || input.hasCustomerReference || input.hasConversationHistory || input.hasCommercialEntity)) {
    return "partial";
  }

  return "minimal";
}

function buildIdentityConflict(context: ReturnType<typeof normalizeCommercialBrainContext>["context"], inboundMessage: ReturnType<typeof normalizeCommercialInboundMessage>["message"]) {
  const groups = [
    [context.waId, inboundMessage?.waId, context.latestInboundMessage?.waId, context.latestOutboundMessage?.waId],
    [context.phoneNumberId, inboundMessage?.phoneNumberId, context.latestInboundMessage?.phoneNumberId, context.latestOutboundMessage?.phoneNumberId],
    [context.email],
    [context.idCustomer],
    [context.idOrder],
    [context.invoiceNumber]
  ];

  for (const values of groups) {
    const distinct = [...new Set(values.filter((value): value is string | number => value !== null && value !== undefined).map((value) => String(value)))];
    if (distinct.length > 1) return true;
  }

  return false;
}

function mergeMessages(
  currentInbound: ReturnType<typeof normalizeCommercialInboundMessage>["message"],
  recentMessages: SalesAgentMessageSnapshot[],
  latestOutbound: ReturnType<typeof normalizeCommercialBrainContext>["context"]["latestOutboundMessage"]
) {
  const combined = [
    ...(currentInbound ? [currentInbound] : []),
    ...recentMessages,
    ...(latestOutbound ? [latestOutbound] : [])
  ];

  const seen = new Set<string>();
  const deduped: typeof combined = [];
  for (const message of combined) {
    const key = [
      message.id ?? "",
      message.direction ?? "",
      message.text ?? "",
      message.occurredAt ?? message.createdAt ?? message.updatedAt ?? ""
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(message);
  }

  return deduped
    .slice()
    .sort((left, right) => {
      const leftStamp = new Date(left.occurredAt ?? left.updatedAt ?? left.createdAt ?? 0).getTime();
      const rightStamp = new Date(right.occurredAt ?? right.updatedAt ?? right.createdAt ?? 0).getTime();
      return rightStamp - leftStamp;
    })
    .slice(0, COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES);
}

function buildInvalidInputResult(message: string, sourceShape = "unsupported"): CommercialContextBuilderInvalidInputResult {
  return {
    status: "invalid_input",
    salesAgentInput: null,
    warnings: ["unsupported_context_shape"],
    sourceSummary: buildCommercialSourceSummary({
      sourceShape,
      supportedContextShape: false,
      channel: null,
      platform: null,
      department: null,
      conversationCaseId: null,
      waId: null,
      email: null,
      phone: null,
      idCustomer: null,
      idOrder: null,
      invoiceNumber: null,
      contactId: null,
      caseStatus: null,
      caseLifecycleStatus: null,
      humanOwnershipActive: false,
      aiBlocked: false,
      manualReplyActive: false,
      hasCustomerCandidate: false,
      hasCustomerReference: false,
      hasConversationHistory: false,
      hasLatestCustomerMessage: false,
      hasLatestOutboundMessage: false,
      leadAvailable: false,
      opportunityAvailable: false,
      hasCommercialEntity: false,
      commercialIntentLegacy: null,
      orderContextAvailable: false,
      productServiceContextAvailable: false,
      latestInboundAt: null,
      latestOutboundAt: null,
      recentMessagesCount: 0,
      recentMessagesLimit: COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES
    }),
    completeness: "insufficient",
    metadata: buildCommercialMetadata({
      sourceShape,
      requestedMode: "minimal",
      currentTime: new Date(0).toISOString(),
      timezone: "UTC",
      availableCapabilities: [],
      sanitized: false,
      sanitizedFields: [],
      safeMetadata: { invalidInputReason: message }
    }),
    errors: [message]
  };
}

export function buildCommercialContext(input: CommercialContextBuilderInput): CommercialContextBuilderResult {
  const currentTime = validateCurrentTime(input.currentTime);
  if (!currentTime) return buildInvalidInputResult("currentTime must be a valid ISO-serializable date.");
  if (!validateRequestedMode(input.requestedMode)) return buildInvalidInputResult("requestedMode is not supported.");
  if (!input.timezone || !input.timezone.trim()) return buildInvalidInputResult("timezone is required.");

  const normalizedContextResult = normalizeCommercialBrainContext(input.brainContext);
  const normalizedInbound = normalizeCommercialInboundMessage(input.inboundMessage);
  const normalizedContext = normalizedContextResult.context;
  const latestInboundMessage = normalizedInbound.message;
  const inputMetadataResult = sanitizeCommercialObject(input.metadata ?? null);
  const safeMetadata = {
    ...(inputMetadataResult.value ?? {}),
    ...normalizedContext.metadata
  };

  const hasLatestCustomerMessage = Boolean(latestInboundMessage?.text);
  const hasCustomerReference = normalizedContext.hasCustomerReference || Boolean(latestInboundMessage?.waId || latestInboundMessage?.phoneNumberId);
  const hasConversationHistory = normalizedContext.hasConversationHistory;
  const hasCommercialEntity = normalizedContext.hasCommercialEntity;
  const staleContext = hasStaleCommercialContext(
    currentTime,
    collectCommercialTimestampSignals({
      latestInboundAt: latestInboundMessage?.occurredAt ?? normalizedContext.latestInboundAt,
      latestOutboundAt: normalizedContext.latestOutboundAt,
      caseUpdatedAt: normalizedContext.latestOutboundAt
    })
  );
  const identityConflict = buildIdentityConflict(normalizedContext, latestInboundMessage);
  const warnings = normalizeWarnings({
    channel: normalizedInbound.message?.channel ?? normalizedContext.channel,
    hasCustomerReference,
    hasConversationHistory,
    hasLatestCustomerMessage,
    missingCommercialEntity: !normalizedContext.lead || !normalizedContext.opportunity,
    hasCommercialEntity,
    humanOwnershipActive: normalizedContext.humanOwnershipActive,
    aiBlocked: normalizedContext.aiBlocked,
    staleContext,
    identityConflict,
    supportedContextShape: normalizedContext.supportedContextShape,
    sanitizationApplied: normalizedContext.sanitizationApplied || normalizedInbound.sanitizationApplied || inputMetadataResult.applied
  });
  const allWarnings = dedupeWarnings([...normalizedContextResult.warnings, ...warnings]);

  const completeness = computeCompleteness({
    hasLatestCustomerMessage,
    hasCustomerReference,
    hasConversationHistory,
    hasCustomerCandidate: normalizedContext.hasCustomerCandidate,
    hasCommercialEntity,
    supportedContextShape: normalizedContext.supportedContextShape
  });

  const recentMessages = mergeMessages(latestInboundMessage, normalizedContext.recentMessages, normalizedContext.latestOutboundMessage);
  const mergedContext = {
    ...normalizedContext,
    recentMessages
  };

  const structuralSignals = buildCommercialStructuralSignals({
    hasLatestCustomerMessage,
    hasCustomerCandidate: mergedContext.hasCustomerCandidate,
    hasCustomerReference,
    hasConversationHistory,
    hasOrderReference: Boolean(mergedContext.idOrder || mergedContext.invoiceNumber || mergedContext.orderContext),
    hasProductServiceContext: Boolean(mergedContext.productServiceContext),
    humanOwnershipActive: mergedContext.humanOwnershipActive,
    aiBlocked: mergedContext.aiBlocked,
    manualReplyActive: mergedContext.manualReplyActive,
    hasCommercialEntity
  });

  const sourceSummary = buildCommercialSourceSummary({
    sourceShape: mergedContext.sourceShape,
    supportedContextShape: mergedContext.supportedContextShape,
    channel: normalizedInbound.message?.channel ?? mergedContext.channel,
    platform: normalizedInbound.message?.platform ?? mergedContext.platform,
    department: mergedContext.department,
    conversationCaseId: mergedContext.conversationCaseId,
    waId: normalizedInbound.message?.waId ?? mergedContext.waId,
    email: mergedContext.email,
    phone: mergedContext.phone,
    idCustomer: mergedContext.idCustomer,
    idOrder: mergedContext.idOrder,
    invoiceNumber: mergedContext.invoiceNumber,
    contactId: mergedContext.contactId,
    caseStatus: mergedContext.caseStatus,
    caseLifecycleStatus: mergedContext.caseLifecycleStatus,
    humanOwnershipActive: mergedContext.humanOwnershipActive,
    aiBlocked: mergedContext.aiBlocked,
    manualReplyActive: mergedContext.manualReplyActive,
    hasCustomerCandidate: mergedContext.hasCustomerCandidate,
    hasCustomerReference,
    hasConversationHistory,
    hasLatestCustomerMessage,
    hasLatestOutboundMessage: Boolean(mergedContext.latestOutboundMessage?.text),
    leadAvailable: Boolean(mergedContext.lead),
    opportunityAvailable: Boolean(mergedContext.opportunity),
    hasCommercialEntity,
    commercialIntentLegacy: mergedContext.commercialIntentLegacy,
    orderContextAvailable: Boolean(mergedContext.orderContext),
    productServiceContextAvailable: Boolean(mergedContext.productServiceContext),
    latestInboundAt: latestInboundMessage?.occurredAt ?? mergedContext.latestInboundAt,
    latestOutboundAt: mergedContext.latestOutboundAt,
    recentMessagesCount: mergedContext.recentMessages.length,
    recentMessagesLimit: COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES
  });

  const metadata = buildCommercialMetadata({
    sourceShape: mergedContext.sourceShape,
    requestedMode: input.requestedMode,
    currentTime,
    timezone: input.timezone,
    availableCapabilities: input.availableCapabilities,
    sanitized: mergedContext.sanitizationApplied || normalizedInbound.sanitizationApplied || inputMetadataResult.applied,
    sanitizedFields: [...mergedContext.sanitizedFields, ...normalizedInbound.sanitizedFields, ...inputMetadataResult.sanitizedFields],
    safeMetadata
  });

  const salesAgentInput = {
    requestedMode: input.requestedMode,
    currentTime,
    timezone: input.timezone,
    channel: normalizedInbound.message?.channel ?? mergedContext.channel,
    platform: normalizedInbound.message?.platform ?? mergedContext.platform,
    department: mergedContext.department,
    identity: buildCommercialIdentityContext(mergedContext),
    messages: buildCommercialMessageContext({
      latestInboundMessage,
      latestOutboundMessage: mergedContext.latestOutboundMessage,
      recentMessages: mergedContext.recentMessages,
      latestInboundAt: latestInboundMessage?.occurredAt ?? mergedContext.latestInboundAt,
      latestOutboundAt: mergedContext.latestOutboundAt
    }),
    caseContext: buildCommercialCaseContext(mergedContext),
    commercial: buildCommercialCommercialContext(mergedContext),
    structuralSignals,
    availableCapabilities: [...input.availableCapabilities],
    policyContext: normalizeCommercialPolicyContext(input.policyContext),
    customer360: mergedContext.customer360,
    customer360State: mergedContext.customer360State,
    metadata
  };

  if (allWarnings.includes("missing_latest_customer_message") || allWarnings.includes("unsupported_context_shape")) {
    return {
      status: "insufficient_context",
      salesAgentInput,
      warnings: allWarnings,
      sourceSummary,
      completeness: "insufficient",
      metadata
    };
  }

  if (completeness === "insufficient") {
    return {
      status: "insufficient_context",
      salesAgentInput,
      warnings: allWarnings,
      sourceSummary,
      completeness,
      metadata
    };
  }

  return {
    status: "success",
    salesAgentInput,
    warnings: allWarnings,
    sourceSummary,
    completeness,
    metadata
  };
}
