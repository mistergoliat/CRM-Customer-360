import {
  DEFAULT_BRAIN_PROCESS_INBOUND_OPTIONS,
  type BrainChannel,
  type BrainContextMode,
  type BrainCustomerRef,
  type BrainError,
  type BrainInboundSource,
  type BrainNormalizedProcessInboundRequest,
  type BrainProcessInboundOptions,
  type BrainValidationResult
} from "./types";

const DEFAULT_BRAIN_MAX_MESSAGE_TEXT_CHARS = 24000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function error(message: string, details?: Record<string, unknown>): BrainError {
  return {
    code: "INVALID_INPUT",
    message,
    retryable: true,
    details
  };
}

function parseSource(value: unknown): BrainInboundSource {
  if (value === "hub_preview" || value === "manual_test" || value === "system_job") return value;
  return "n8n_meta_webhook";
}

function parseContextMode(value: unknown): BrainContextMode {
  if (value === "standard" || value === "recovery") return value;
  return "minimal";
}

function parseOptions(value: unknown): BrainProcessInboundOptions {
  const options = isRecord(value) ? value : {};
  return {
    dryRun: asBoolean(options.dryRun, DEFAULT_BRAIN_PROCESS_INBOUND_OPTIONS.dryRun),
    executeActions: asBoolean(options.executeActions, DEFAULT_BRAIN_PROCESS_INBOUND_OPTIONS.executeActions),
    returnInstructionsForN8n: asBoolean(
      options.returnInstructionsForN8n,
      DEFAULT_BRAIN_PROCESS_INBOUND_OPTIONS.returnInstructionsForN8n
    ),
    debug: asBoolean(options.debug, DEFAULT_BRAIN_PROCESS_INBOUND_OPTIONS.debug),
    runAgentDryRun: asBoolean(options.runAgentDryRun, DEFAULT_BRAIN_PROCESS_INBOUND_OPTIONS.runAgentDryRun),
    buildExecutionPlanDryRun: asBoolean(
      options.buildExecutionPlanDryRun,
      DEFAULT_BRAIN_PROCESS_INBOUND_OPTIONS.buildExecutionPlanDryRun
    ),
    preferredAgent: options.preferredAgent === "knowledge" ? "knowledge" : undefined
  };
}

function parseCustomerRef(value: unknown): BrainCustomerRef | undefined {
  if (!isRecord(value)) return undefined;
  return {
    waId: asString(value.waId) ?? undefined,
    phoneNumberId: asString(value.phoneNumberId) ?? undefined,
    idCustomer: asOptionalStringOrNumber(value.idCustomer),
    idOrder: asOptionalStringOrNumber(value.idOrder),
    invoiceNumber: asOptionalStringOrNumber(value.invoiceNumber),
    email: asString(value.email) ?? undefined,
    contactId: asOptionalStringOrNumber(value.contactId)
  };
}

export function normalizeBrainInboundRequest(input: unknown): BrainValidationResult<BrainNormalizedProcessInboundRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      value: null,
      errors: [error("Request body must be an object.")]
    };
  }

  const errors: BrainError[] = [];
  const channel = asString(input.channel) === "whatsapp" ? "whatsapp" : null;
  const source = parseSource(input.source);
  const contextMode = parseContextMode(input.contextMode);
  const waId = asString(input.waId);
  const phoneNumberId = asString(input.phoneNumberId);
  const messageId = asString(input.messageId);
  const messageText = asString(input.messageText);

  if (!channel) errors.push(error("channel must be whatsapp."));
  if (!waId) errors.push(error("waId is required."));
  if (!phoneNumberId) errors.push(error("phoneNumberId is required."));
  if (!messageId) errors.push(error("messageId is required."));
  if (!messageText) errors.push(error("messageText is required."));
  if (messageText && messageText.length > DEFAULT_BRAIN_MAX_MESSAGE_TEXT_CHARS) {
    errors.push(error("messageText exceeds max allowed length.", { maxMessageTextChars: DEFAULT_BRAIN_MAX_MESSAGE_TEXT_CHARS }));
  }

  if (errors.length > 0) {
    return { ok: false, value: null, errors };
  }

  return {
    ok: true,
    value: {
      channel: channel as BrainChannel,
      source,
      contextMode,
      waId: waId as string,
      phoneNumberId: phoneNumberId as string,
      messageId: messageId as string,
      messageText: messageText as string,
      conversationCaseId: asOptionalStringOrNumber(input.conversationCaseId),
      customerRef: parseCustomerRef(input.customerRef),
      options: parseOptions(input.options),
      receivedAt: asString(input.receivedAt) ?? undefined,
      sourceWorkflow: asString(input.sourceWorkflow) ?? undefined,
      sourceNode: asString(input.sourceNode) ?? undefined,
      metadata: isRecord(input.metadata) ? input.metadata : {}
    },
    errors: []
  };
}

export function buildFallbackBrainInboundRequest(input: unknown): BrainNormalizedProcessInboundRequest {
  const record = isRecord(input) ? input : {};
  const waId = asString(record.waId) ?? "unknown";
  const phoneNumberId = asString(record.phoneNumberId) ?? "unknown";
  const messageId = asString(record.messageId) ?? "invalid-request";
  const messageText = asString(record.messageText) ?? "";

  return {
    channel: "whatsapp",
    source: parseSource(record.source),
    contextMode: parseContextMode(record.contextMode),
    waId,
    phoneNumberId,
    messageId,
    messageText,
    conversationCaseId: asOptionalStringOrNumber(record.conversationCaseId),
    customerRef: parseCustomerRef(record.customerRef),
    options: parseOptions(record.options),
    receivedAt: asString(record.receivedAt) ?? undefined,
    sourceWorkflow: asString(record.sourceWorkflow) ?? undefined,
    sourceNode: asString(record.sourceNode) ?? undefined,
    metadata: isRecord(record.metadata) ? record.metadata : {}
  };
}
