import {
  AI_ACTION_TYPES,
  AI_ACTION_STATUSES,
  AI_COMMERCIAL_STATUSES,
  AI_CONTEXT_MODES,
  AI_CUSTOMER_SIGNALS,
  AI_DEPARTMENTS,
  AI_ERROR_CODES,
  AI_FINAL_ACTIONS,
  AI_INTENTS,
  AI_NEXT_ACTIONS,
  AI_SOURCES,
  DEFAULT_AI_ORCHESTRATION_FEATURE_FLAGS,
  DEFAULT_AI_ORCHESTRATION_LIMITS,
  type AiDecisionEnvelope,
  type AiError,
  type AiErrorCode,
  type AiOrchestrationFeatureFlags,
  type AiOrchestrationLimits,
  type AiOrchestrationRequest,
  type AiOrchestrationResponse,
  type AiPlannedAction,
  type AiSafetyFlags,
  type AiUsage
} from "./types";

export type AiValidationResult<T> =
  | { ok: true; value: T; errors: [] }
  | { ok: false; value: null; errors: AiError[] };

const MIN_CONFIDENCE_FOR_AUTOMATION = 0.7;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asOptionalStringOrNumber(value: unknown): string | number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" || typeof value === "number") return value;
  return undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = asFiniteNumber(value);
  if (numberValue === null) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numberValue)));
}

function error(code: AiErrorCode, message: string, details?: Record<string, unknown>): AiError {
  return { code, message, retryable: ["TIMEOUT", "MODEL_UNAVAILABLE", "UNHANDLED_ERROR"].includes(code), details };
}

function parseLimits(value: unknown): AiOrchestrationLimits {
  const limits = isRecord(value) ? value : {};
  return {
    maxHistoryMessages: boundedInt(
      limits.maxHistoryMessages,
      DEFAULT_AI_ORCHESTRATION_LIMITS.maxHistoryMessages,
      0,
      30
    ),
    maxContextChars: boundedInt(limits.maxContextChars, DEFAULT_AI_ORCHESTRATION_LIMITS.maxContextChars, 1000, 60000),
    maxOutputTokens: boundedInt(limits.maxOutputTokens, DEFAULT_AI_ORCHESTRATION_LIMITS.maxOutputTokens, 100, 2000),
    timeoutMs: boundedInt(limits.timeoutMs, DEFAULT_AI_ORCHESTRATION_LIMITS.timeoutMs, 1000, 30000)
  };
}

function parseFeatureFlags(value: unknown): AiOrchestrationFeatureFlags {
  const flags = isRecord(value) ? value : {};
  const allowCaseMutation = asBoolean(
    flags.allowCaseMutation,
    asBoolean(flags.allowCaseClose, DEFAULT_AI_ORCHESTRATION_FEATURE_FLAGS.allowCaseMutation)
  );
  return {
    allowAutoReply: asBoolean(flags.allowAutoReply, DEFAULT_AI_ORCHESTRATION_FEATURE_FLAGS.allowAutoReply),
    allowCaseMutation,
    allowHumanHandoff: asBoolean(flags.allowHumanHandoff, DEFAULT_AI_ORCHESTRATION_FEATURE_FLAGS.allowHumanHandoff),
    allowCaseClose: asBoolean(flags.allowCaseClose, allowCaseMutation),
    allowFollowup: asBoolean(flags.allowFollowup, DEFAULT_AI_ORCHESTRATION_FEATURE_FLAGS.allowFollowup),
    shadowLog: asBoolean(flags.shadowLog, DEFAULT_AI_ORCHESTRATION_FEATURE_FLAGS.shadowLog),
    dryRun: asBoolean(flags.dryRun, DEFAULT_AI_ORCHESTRATION_FEATURE_FLAGS.dryRun)
  };
}

export function validateAiOrchestrationRequest(input: unknown): AiValidationResult<AiOrchestrationRequest> {
  if (!isRecord(input)) {
    return { ok: false, value: null, errors: [error("INVALID_INPUT", "Request body must be an object.")] };
  }

  const errors: AiError[] = [];
  const limits = parseLimits(input.limits);
  const featureFlags = parseFeatureFlags(input.featureFlags);
  const source = isOneOf(AI_SOURCES, input.source) ? input.source : null;
  const contextMode = isOneOf(AI_CONTEXT_MODES, input.contextMode) ? input.contextMode : null;
  const waId = asString(input.waId);
  const phoneNumberId = asString(input.phoneNumberId);
  const messageId = asString(input.messageId);
  const messageText = asString(input.messageText);

  if (!source) errors.push(error("INVALID_INPUT", "source is required or invalid."));
  if (!contextMode) errors.push(error("INVALID_INPUT", "contextMode is required or invalid."));
  if (!waId) errors.push(error("INVALID_INPUT", "waId is required."));
  if (!phoneNumberId) errors.push(error("INVALID_INPUT", "phoneNumberId is required."));
  if (!messageId) errors.push(error("INVALID_INPUT", "messageId is required."));
  if (!messageText) errors.push(error("INVALID_INPUT", "messageText is required."));
  if (messageText && messageText.length > limits.maxContextChars) {
    errors.push(error("CONTEXT_EXCEEDED", "messageText exceeds maxContextChars.", { maxContextChars: limits.maxContextChars }));
  }

  if (errors.length > 0) return { ok: false, value: null, errors };

  const customerRef = isRecord(input.customerRef)
    ? {
        waId: asOptionalString(input.customerRef.waId),
        phoneNumberId: asOptionalString(input.customerRef.phoneNumberId),
        idCustomer: asOptionalStringOrNumber(input.customerRef.idCustomer),
        idOrder: asOptionalStringOrNumber(input.customerRef.idOrder),
        invoiceNumber: asOptionalStringOrNumber(input.customerRef.invoiceNumber),
        email: asOptionalString(input.customerRef.email),
        contactId: asOptionalStringOrNumber(input.customerRef.contactId)
      }
    : undefined;

  return {
    ok: true,
    value: {
      source: source!,
      contextMode: contextMode!,
      waId: waId as string,
      phoneNumberId: phoneNumberId as string,
      messageId: messageId as string,
      messageText: messageText as string,
      conversationCaseId: asOptionalStringOrNumber(input.conversationCaseId),
      customerRef,
      limits,
      featureFlags
    },
    errors: []
  };
}

function validateSafetyFlags(value: unknown): value is AiSafetyFlags {
  return (
    isRecord(value) &&
    typeof value.invalidOutput === "boolean" &&
    typeof value.timeout === "boolean" &&
    typeof value.contextExceeded === "boolean" &&
    typeof value.lowConfidence === "boolean" &&
    typeof value.featureDisabled === "boolean" &&
    typeof value.modelUnavailable === "boolean"
  );
}

export function validateAiDecisionEnvelope(
  input: unknown,
  _featureFlags: AiOrchestrationFeatureFlags = DEFAULT_AI_ORCHESTRATION_FEATURE_FLAGS
): AiValidationResult<AiDecisionEnvelope> {
  void _featureFlags;

  if (!isRecord(input)) {
    return { ok: false, value: null, errors: [error("INVALID_OUTPUT", "Envelope must be an object.")] };
  }

  const errors: AiError[] = [];
  const confidence = asFiniteNumber(input.confidence);

  if (!asString(input.decisionId)) errors.push(error("INVALID_OUTPUT", "decisionId is required."));
  if (!asString(input.agentName)) errors.push(error("INVALID_OUTPUT", "agentName is required."));
  if (!asString(input.agentVersion)) errors.push(error("INVALID_OUTPUT", "agentVersion is required."));
  if (!isOneOf(AI_SOURCES, input.source)) errors.push(error("INVALID_OUTPUT", "source is invalid."));
  if (!isOneOf(AI_INTENTS, input.intent)) errors.push(error("INVALID_OUTPUT", "intent is invalid."));
  if (!isOneOf(AI_DEPARTMENTS, input.department)) errors.push(error("INVALID_OUTPUT", "department is invalid."));
  if (!asString(input.caseTopic)) errors.push(error("INVALID_OUTPUT", "caseTopic is required."));
  if (!isOneOf(AI_COMMERCIAL_STATUSES, input.commercialStatus)) {
    errors.push(error("INVALID_OUTPUT", "commercialStatus is invalid."));
  }
  if (!isOneOf(AI_CUSTOMER_SIGNALS, input.customerSignal)) errors.push(error("INVALID_OUTPUT", "customerSignal is invalid."));
  if (!isOneOf(AI_FINAL_ACTIONS, input.finalAction)) errors.push(error("INVALID_OUTPUT", "finalAction is invalid."));
  if (typeof input.requiresHuman !== "boolean") errors.push(error("INVALID_OUTPUT", "requiresHuman must be boolean."));
  if (typeof input.shouldReply !== "boolean") errors.push(error("INVALID_OUTPUT", "shouldReply must be boolean."));
  if (typeof input.replyText !== "string") errors.push(error("INVALID_OUTPUT", "replyText must be string."));
  if (!asString(input.summaryForOperator)) errors.push(error("INVALID_OUTPUT", "summaryForOperator is required."));
  if (!isOneOf(AI_NEXT_ACTIONS, input.nextAction)) errors.push(error("INVALID_OUTPUT", "nextAction is invalid."));
  if (!(input.nextActionAt === null || typeof input.nextActionAt === "string")) {
    errors.push(error("INVALID_OUTPUT", "nextActionAt must be string or null."));
  }
  if (confidence === null || confidence < 0 || confidence > 1) {
    errors.push(error("INVALID_OUTPUT", "confidence must be a number between 0 and 1."));
  }
  if (!asString(input.reasonSummary)) errors.push(error("INVALID_OUTPUT", "reasonSummary is required."));
  if (!validateSafetyFlags(input.safetyFlags)) errors.push(error("INVALID_OUTPUT", "safetyFlags is invalid."));
  if (!isRecord(input.metadata)) errors.push(error("INVALID_OUTPUT", "metadata is required."));

  if (input.shouldReply === true && input.requiresHuman === true) {
    errors.push(error("INVALID_OUTPUT", "shouldReply cannot be true when requiresHuman is true."));
  }
  if (input.shouldReply === true && !asString(input.replyText)) {
    errors.push(error("INVALID_OUTPUT", "replyText is required when shouldReply is true."));
  }
  if (confidence !== null && confidence < MIN_CONFIDENCE_FOR_AUTOMATION && input.shouldReply === true) {
    errors.push(error("LOW_CONFIDENCE", "Low confidence cannot produce an automatic reply.", { confidence }));
  }

  if (errors.length > 0) return { ok: false, value: null, errors };

  return { ok: true, value: input as AiDecisionEnvelope, errors: [] };
}

function validateUsage(value: unknown): value is AiUsage {
  return (
    isRecord(value) &&
    typeof value.inputChars === "number" &&
    typeof value.contextChars === "number" &&
    typeof value.outputChars === "number" &&
    typeof value.historyMessages === "number" &&
    typeof value.elapsedMs === "number"
  );
}

function validateAction(value: unknown): value is AiPlannedAction {
  return (
    isRecord(value) &&
    isOneOf(AI_ACTION_TYPES, value.type) &&
    isOneOf(AI_ACTION_STATUSES, value.status) &&
    typeof value.enabled === "boolean" &&
    typeof value.reason === "string"
  );
}

function validateErrorList(value: unknown): value is AiError[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isRecord(item) && isOneOf(AI_ERROR_CODES, item.code) && typeof item.message === "string")
  );
}

export function validateAiOrchestrationResponse(
  input: unknown,
  featureFlags: AiOrchestrationFeatureFlags = DEFAULT_AI_ORCHESTRATION_FEATURE_FLAGS
): AiValidationResult<AiOrchestrationResponse> {
  if (!isRecord(input)) {
    return { ok: false, value: null, errors: [error("INVALID_OUTPUT", "Response must be an object.")] };
  }

  const errors: AiError[] = [];
  if (typeof input.ok !== "boolean") errors.push(error("INVALID_OUTPUT", "ok must be boolean."));
  if (!(input.decisionId === null || typeof input.decisionId === "string")) {
    errors.push(error("INVALID_OUTPUT", "decisionId must be string or null."));
  }
  if (input.envelope !== null) {
    const envelopeResult = validateAiDecisionEnvelope(input.envelope, featureFlags);
    if (!envelopeResult.ok) errors.push(...envelopeResult.errors);
  }
  if (!Array.isArray(input.actions) || !input.actions.every(validateAction)) {
    errors.push(error("INVALID_OUTPUT", "actions is invalid."));
  }
  if (!validateUsage(input.usage)) errors.push(error("INVALID_OUTPUT", "usage is invalid."));
  if (!validateErrorList(input.errors)) errors.push(error("INVALID_OUTPUT", "errors is invalid."));
  if (input.ok === true && input.envelope === null) errors.push(error("INVALID_OUTPUT", "ok response requires envelope."));
  if (input.ok === false && Array.isArray(input.errors) && input.errors.length === 0) {
    errors.push(error("INVALID_OUTPUT", "failed response requires at least one error."));
  }

  if (errors.length > 0) return { ok: false, value: null, errors };
  return { ok: true, value: input as AiOrchestrationResponse, errors: [] };
}

export function buildSafeFallbackEnvelope(
  request: AiOrchestrationRequest,
  fallbackReason: AiErrorCode,
  reasonSummary: string
): AiDecisionEnvelope {
  return {
    decisionId: `fallback-${request.messageId}`,
    agentName: "AI_ORCHESTRATOR_FALLBACK",
    agentVersion: "0.1.0",
    source: request.source,
    intent: "unknown",
    department: "Unknown",
    caseTopic: "unknown",
    commercialStatus: "unknown",
    customerSignal: "unknown",
    finalAction: "human_required",
    requiresHuman: true,
    shouldReply: false,
    replyText: "",
    summaryForOperator: "El runtime IA no genero una decision segura. Revisar manualmente.",
    nextAction: "mark_human_required",
    nextActionAt: null,
    confidence: 0,
    reasonSummary,
    safetyFlags: {
      invalidOutput: fallbackReason === "INVALID_OUTPUT",
      timeout: fallbackReason === "TIMEOUT",
      contextExceeded: fallbackReason === "CONTEXT_EXCEEDED",
      lowConfidence: fallbackReason === "LOW_CONFIDENCE",
      featureDisabled: fallbackReason === "FEATURE_DISABLED",
      modelUnavailable: fallbackReason === "MODEL_UNAVAILABLE"
    },
    metadata: {
      contextMode: request.contextMode,
      validatorVersion: "0.1.0",
      dryRun: request.featureFlags.dryRun,
      generatedAt: new Date().toISOString(),
      warnings: [reasonSummary]
    }
  };
}
