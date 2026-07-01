import type { CommercialContextSourceSummary } from "../types";
import { COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES } from "../constants";
import { validateSalesAgentOutput } from "./validateSalesAgentOutput";
import { buildSalesAgentPromptPackage } from "./promptBuilder";
import { createSalesAgentRuntimeFailedSafe } from "./createSalesAgentRuntimeFailedSafe";
import {
  BRAIN_SALES_AGENT_ENABLED,
  BRAIN_SALES_AGENT_DRY_RUN,
  SALES_AGENT_CONTRACT_VERSION,
  SALES_AGENT_PROMPT_VERSION,
  SALES_AGENT_RUNTIME_DEFAULT_DRY_RUN,
  SALES_AGENT_RUNTIME_DEFAULT_ENABLED,
  SALES_AGENT_RUNTIME_DEFAULT_MODE,
  SALES_AGENT_RUNTIME_DEFAULT_TIMEOUT_MS,
  SALES_AGENT_RUNTIME_MAX_INPUT_CHARACTERS,
  SALES_AGENT_RUNTIME_MAX_OUTPUT_CHARACTERS,
  SALES_AGENT_RUNTIME_VERSION,
  SALES_AGENT_RUNTIME_WARNINGS,
  type SalesAgentPromptVersion,
  type SalesAgentRuntimeClock,
  type SalesAgentRuntimeError,
  type SalesAgentRuntimeInput,
  type SalesAgentRuntimeJsonRecord,
  type SalesAgentRuntimeJsonValue,
  type SalesAgentRuntimeMetadata,
  type SalesAgentRuntimeMetrics,
  type SalesAgentRuntimeMode,
  type SalesAgentRuntimeProviderSummary,
  type SalesAgentRuntimeResult,
  type SalesAgentRuntimeValidation,
  type SalesAgentRuntimeValidationSkipped,
  type SalesAgentRuntimeVersions
} from "./runtimeTypes";
import type { SalesAgentDecisionType, SalesAgentOutputValidationContext, SalesAgentOutputValidationIssue } from "./validationTypes";
import type { SalesAgentToolName } from "../salesAgentTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toIsoTimestamp(value: string | Date, clock?: SalesAgentRuntimeClock) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date(0).toISOString() : value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return clock ? clock.toISOString(clock.now()) : new Date(0).toISOString();
  }
  return parsed.toISOString();
}

function defaultClock(): SalesAgentRuntimeClock {
  return {
    now: () => Date.now(),
    toISOString: (value: number | Date) => {
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
    }
  };
}

function sanitizeErrorMessage(message: string) {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]+)\b/gi, "[redacted]")
    .replace(/\b(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
    .trim();
}

function isSensitiveKey(key: string) {
  return /authorization|api[-_]?key|token|secret|password|cookie|webhook|header/i.test(key);
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function toJsonValue(value: unknown, seen: WeakSet<object>): SalesAgentRuntimeJsonValue | null {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (Array.isArray(value)) {
    const output: SalesAgentRuntimeJsonValue[] = [];
    for (const item of value) {
      const next = toJsonValue(item, seen);
      if (next !== null) output.push(next);
    }
    return output;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }

  seen.add(value);
  const output: SalesAgentRuntimeJsonRecord = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSensitiveKey(key) || key === "__proto__" || key === "prototype" || key === "constructor") {
      continue;
    }

    const next = toJsonValue(nestedValue, seen);
    if (next !== null) {
      output[key] = next;
    }
  }

  return output;
}

function sanitizeJsonRecord(value: unknown) {
  const jsonValue = toJsonValue(value, new WeakSet<object>());
  const safe = isRecord(jsonValue) ? jsonValue : {};
  const inputString = safeJsonStringify(value);
  const outputString = safeJsonStringify(safe);
  return {
    value: safe,
    sanitized: inputString === null || outputString === null ? true : inputString !== outputString,
    bytes: outputString?.length ?? 0
  };
}

function sanitizePreview(value: unknown) {
  const jsonValue = toJsonValue(value, new WeakSet<object>());
  const inputString = safeJsonStringify(value);
  const outputString = safeJsonStringify(jsonValue);
  return {
    value: jsonValue,
    sanitized: inputString === null || outputString === null ? true : inputString !== outputString,
    bytes: outputString?.length ?? 0
  };
}

function uniqueWarnings(warnings: readonly string[]) {
  return [...new Set(warnings)].slice(0, SALES_AGENT_RUNTIME_WARNINGS.length);
}

function buildCommercialContextSummary(input: SalesAgentRuntimeInput["salesAgentInput"]): CommercialContextSourceSummary {
  return {
    sourceShape: "sales_agent_input",
    supportedContextShape: true,
    channel: input.channel,
    platform: input.platform,
    department: input.department,
    conversationCaseId: input.identity.conversationCaseId,
    waId: input.identity.waId,
    email: input.identity.email,
    phone: input.identity.phone,
    idCustomer: input.identity.idCustomer,
    idOrder: input.identity.idOrder,
    invoiceNumber: input.identity.invoiceNumber,
    contactId: input.identity.contactId,
    caseStatus: input.caseContext.status,
    caseLifecycleStatus: input.caseContext.lifecycleStatus,
    humanOwnershipActive: input.caseContext.humanOwnershipActive,
    aiBlocked: input.caseContext.aiBlocked,
    manualReplyActive: input.caseContext.manualReplyActive,
    hasCustomerCandidate: input.identity.customerCandidate !== null,
    hasCustomerReference: Boolean(input.identity.waId || input.identity.email || input.identity.phone || input.identity.idCustomer || input.identity.contactId),
    hasConversationHistory: input.messages.recentMessages.length > 0,
    hasLatestCustomerMessage: input.messages.latestInboundMessage !== null,
    hasLatestOutboundMessage: input.messages.latestOutboundMessage !== null,
    leadAvailable: input.commercial.lead !== undefined,
    opportunityAvailable: input.commercial.opportunity !== undefined,
    hasCommercialEntity: input.commercial.lead !== undefined || input.commercial.opportunity !== undefined,
    commercialIntentLegacy: input.commercial.commercialIntentLegacy,
    orderContextAvailable: input.commercial.orderContext !== null,
    productServiceContextAvailable: input.commercial.productServiceContext !== null,
    latestInboundAt: input.messages.latestInboundAt,
    latestOutboundAt: input.messages.latestOutboundAt,
    recentMessagesCount: input.messages.recentMessages.length,
    recentMessagesLimit: COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES
  };
}

function buildDefaultProviderSummary(provider: SalesAgentRuntimeInput["provider"]): SalesAgentRuntimeProviderSummary {
  return {
    name: provider?.name ?? "unavailable",
    version: provider?.version ?? null,
    model: null,
    requestId: null,
    finishReason: null
  };
}

function buildValidationSkipped(): SalesAgentRuntimeValidationSkipped {
  return {
    status: "skipped",
    result: null,
    warnings: [],
    issues: [],
    metadata: null
  };
}

function buildValidationContext(
  input: SalesAgentRuntimeInput,
  allowedCapabilities: readonly SalesAgentToolName[],
  strictValidation: boolean,
  currentTime: string,
  safeMetadata: Record<string, unknown>,
  contractVersion: string
): SalesAgentOutputValidationContext {
  return {
    expectedRunId: input.expectedRunId,
    contractVersion,
    allowedCapabilities,
    requestedMode: input.salesAgentInput.requestedMode,
    commercialContextSummary: buildCommercialContextSummary(input.salesAgentInput),
    currentTime,
    strictMode: strictValidation,
    metadata: safeMetadata
  };
}

function buildRuntimeMetadata(args: {
  runtimeMode: SalesAgentRuntimeMode;
  dryRun: boolean;
  enabled: boolean;
  strictValidation: boolean;
  promptPreviewIncluded: boolean;
  rawOutputCaptured: boolean;
  provider: SalesAgentRuntimeProviderSummary;
  validationStatus: SalesAgentRuntimeValidation["status"];
  safeMetadata: SalesAgentRuntimeJsonRecord;
  contractVersion: string;
  promptVersion: SalesAgentPromptVersion;
  promptPreview?: string | null;
}): SalesAgentRuntimeMetadata {
  return {
    runtimeVersion: SALES_AGENT_RUNTIME_VERSION,
    contractVersion: args.contractVersion,
    promptVersion: args.promptVersion,
    runtimeMode: args.runtimeMode,
    dryRun: args.dryRun,
    enabled: args.enabled,
    strictValidation: args.strictValidation,
    promptPreviewIncluded: args.promptPreviewIncluded,
    rawOutputCaptured: args.rawOutputCaptured,
    rawOutputTrusted: false,
    providerName: args.provider.name,
    providerVersion: args.provider.version,
    providerRequestId: args.provider.requestId,
    validationStatus: args.validationStatus,
    safeMetadata: args.safeMetadata,
    promptPreview: args.promptPreview
  };
}

function buildRuntimeFailure(args: {
  status: Exclude<SalesAgentRuntimeResult["status"], "completed_valid">;
  mode: SalesAgentRuntimeMode;
  dryRun: boolean;
  validationContext: SalesAgentOutputValidationContext;
  validation: SalesAgentRuntimeValidation;
  metrics: SalesAgentRuntimeMetrics;
  provider: SalesAgentRuntimeProviderSummary;
  versions: SalesAgentRuntimeVersions;
  metadata: SalesAgentRuntimeMetadata;
  error: SalesAgentRuntimeError;
  warnings: readonly string[];
  issues: readonly SalesAgentOutputValidationIssue[];
  decisionType?: SalesAgentDecisionType;
  correlationId?: string | null;
  rawOutputPreview?: SalesAgentRuntimeJsonValue | null;
}): SalesAgentRuntimeResult {
  return createSalesAgentRuntimeFailedSafe({
    status: args.status,
    mode: args.mode,
    dryRun: args.dryRun,
    validationContext: args.validationContext,
    validation: args.validation,
    metrics: args.metrics,
    provider: args.provider,
    versions: args.versions,
    metadata: args.metadata,
    error: args.error,
    warnings: args.warnings,
    issues: args.issues,
    decisionType: args.decisionType,
    correlationId: args.correlationId,
    rawOutputPreview: args.rawOutputPreview ?? null
  });
}

function classifyProviderError(error: unknown, provider: SalesAgentRuntimeProviderSummary, timedOut: boolean) {
  const rawMessage = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown provider error.";
  const message = sanitizeErrorMessage(rawMessage);

  if (timedOut) {
    return {
      status: "timeout" as const,
      code: "timeout" as const,
      message: message || "Provider timed out.",
      details: { providerName: provider.name }
    };
  }

  if (error instanceof Error && error.name === "AbortError") {
    return {
      status: "cancelled" as const,
      code: "cancelled" as const,
      message: message || "Provider invocation was cancelled.",
      details: { providerName: provider.name }
    };
  }

  const normalized = message.toLowerCase();
  if (normalized.includes("unavailable")) {
    return {
      status: "provider_unavailable" as const,
      code: "provider_unavailable" as const,
      message: message || "Provider is unavailable.",
      details: { providerName: provider.name }
    };
  }

  if (normalized.includes("unauthorized") || normalized.includes("authentication") || normalized.includes("api key") || normalized.includes("bearer")) {
    return {
      status: "provider_error" as const,
      code: "authentication_error" as const,
      message,
      details: { providerName: provider.name }
    };
  }

  if (normalized.includes("rate limit") || normalized.includes("429")) {
    return {
      status: "provider_error" as const,
      code: "rate_limit" as const,
      message,
      details: { providerName: provider.name }
    };
  }

  if (
    normalized.includes("network") ||
    normalized.includes("econnreset") ||
    normalized.includes("enotfound") ||
    normalized.includes("timed out") ||
    normalized.includes("fetch failed")
  ) {
    return {
      status: "provider_error" as const,
      code: "network_error" as const,
      message,
      details: { providerName: provider.name }
    };
  }

  if (normalized.includes("invalid response") || normalized.includes("malformed")) {
    return {
      status: "provider_error" as const,
      code: "invalid_response" as const,
      message,
      details: { providerName: provider.name }
    };
  }

  return {
    status: "provider_error" as const,
    code: "provider_error" as const,
    message: message || "Provider invocation failed.",
    details: { providerName: provider.name }
  };
}

async function invokeWithTimeout(
  provider: NonNullable<SalesAgentRuntimeInput["provider"]>,
  request: Parameters<NonNullable<SalesAgentRuntimeInput["provider"]>["invoke"]>[0],
  options: Parameters<NonNullable<SalesAgentRuntimeInput["provider"]>["invoke"]>[1],
  timeoutMs: number,
  externalAbortSignal: AbortSignal | null | undefined
) {
  const controller = new AbortController();
  let timedOut = false;

  const onAbort = () => controller.abort();
  if (externalAbortSignal) {
    if (externalAbortSignal.aborted) {
      controller.abort();
    } else {
      externalAbortSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const providerOutcome = Promise.resolve()
    .then(() => provider.invoke(request, { ...options, signal: controller.signal }))
    .then(
      (value) => ({ kind: "success" as const, value }),
      (error: unknown) => ({ kind: "error" as const, error })
    );

  const timeoutOutcome = new Promise<{ kind: "timeout" }>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve({ kind: "timeout" as const });
    }, Math.max(1, timeoutMs));

    controller.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
      },
      { once: true }
    );
  });

  try {
    const outcome = await Promise.race([providerOutcome, timeoutOutcome]);
    return { outcome, timedOut, aborted: controller.signal.aborted };
  } finally {
    if (externalAbortSignal) {
      externalAbortSignal.removeEventListener("abort", onAbort);
    }
    controller.abort();
  }
}

function validateProviderResponseShape(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(value, "rawOutput")) {
    return null;
  }
  return value as {
    rawOutput: unknown;
    model?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    estimatedCost?: number | null;
    providerRequestId?: string | null;
    finishReason?: string | null;
    metadata?: Record<string, unknown> | null;
  };
}

export async function runSalesAgentDryRun(input: SalesAgentRuntimeInput): Promise<SalesAgentRuntimeResult> {
  const clock = input.clock ?? defaultClock();
  const startedAtMs = clock.now();
  const startedAt = clock.toISOString(startedAtMs);
  const currentTime = toIsoTimestamp(input.currentTime, clock);
  const contractVersion = input.contractVersion ?? SALES_AGENT_CONTRACT_VERSION;
  const promptVersion = input.promptVersion ?? SALES_AGENT_PROMPT_VERSION;
  const runtimeMode = input.options.mode ?? SALES_AGENT_RUNTIME_DEFAULT_MODE;
  const enabled = input.options.enabled ?? SALES_AGENT_RUNTIME_DEFAULT_ENABLED;
  const dryRun = input.options.dryRun ?? SALES_AGENT_RUNTIME_DEFAULT_DRY_RUN;
  const strictValidation = input.options.strictValidation ?? true;
  const allowedCapabilities = input.options.allowedCapabilities ?? input.salesAgentInput.availableCapabilities;
  const timeoutMs = input.options.timeoutMs ?? SALES_AGENT_RUNTIME_DEFAULT_TIMEOUT_MS;
  const maxInputCharacters = input.options.maxInputCharacters ?? SALES_AGENT_RUNTIME_MAX_INPUT_CHARACTERS;
  const maxOutputCharacters = input.options.maxOutputCharacters ?? SALES_AGENT_RUNTIME_MAX_OUTPUT_CHARACTERS;
  const captureRawOutput = input.options.captureRawOutput ?? false;
  const includePromptPreview = input.options.includePromptPreview ?? false;
  const safeRuntimeMetadata = sanitizeJsonRecord(input.metadata ?? {}).value;
  const promptPackage = buildSalesAgentPromptPackage({
    salesAgentInput: input.salesAgentInput,
    contractVersion,
    promptVersion,
    runtimeMode,
    currentTime,
    allowedCapabilities,
    expectedRunId: input.expectedRunId ?? input.correlationId ?? null
  });
  const promptCharacters = promptPackage.promptText.length;
  const providerSummary = buildDefaultProviderSummary(input.provider);
  const versions: SalesAgentRuntimeVersions = {
    runtimeVersion: SALES_AGENT_RUNTIME_VERSION,
    contractVersion,
    promptVersion
  };
  const promptPreview = includePromptPreview ? promptPackage.promptText.slice(0, maxInputCharacters) : null;
  const metadata = buildRuntimeMetadata({
    runtimeMode,
    dryRun,
    enabled,
    strictValidation,
    promptPreviewIncluded: includePromptPreview,
    rawOutputCaptured: captureRawOutput,
    provider: providerSummary,
    validationStatus: "skipped",
    safeMetadata: {
      ...safeRuntimeMetadata,
      runtime: {
        mode: runtimeMode,
        dryRun,
        enabled,
        strictValidation
      }
    },
    contractVersion,
    promptVersion,
    promptPreview
  });

  if (promptCharacters > maxInputCharacters) {
    const validationContext = buildValidationContext(input, allowedCapabilities, strictValidation, currentTime, safeRuntimeMetadata, contractVersion);
    const metrics: SalesAgentRuntimeMetrics = {
      startedAt,
      completedAt: clock.toISOString(clock.now()),
      durationMs: clock.now() - startedAtMs,
      validationDurationMs: 0,
      inputCharacters: promptCharacters,
      timedOut: false,
      retryCount: 0
    };

    return buildRuntimeFailure({
      status: "invalid_input",
      mode: runtimeMode,
      dryRun,
      validationContext,
      validation: buildValidationSkipped(),
      metrics,
      provider: providerSummary,
      versions,
      metadata: {
        ...metadata,
        validationStatus: "skipped"
      },
      error: {
        code: "input_too_large",
        message: "Prompt input exceeded the configured maximum size.",
        providerName: providerSummary.name
      },
      warnings: ["input_too_large", "provider_not_called"],
      issues: [
        {
          code: "contract_incomplete",
          level: "fatal",
          message: "Prompt input exceeded the configured maximum size.",
          path: ["promptText"]
        }
      ],
      decisionType: "insufficient_context"
    });
  }

  if (runtimeMode !== "dry_run" && runtimeMode !== "fixture" && runtimeMode !== "shadow" && runtimeMode !== "live") {
    const validationContext = buildValidationContext(input, allowedCapabilities, strictValidation, currentTime, safeRuntimeMetadata, contractVersion);
    const metrics: SalesAgentRuntimeMetrics = {
      startedAt,
      completedAt: clock.toISOString(clock.now()),
      durationMs: clock.now() - startedAtMs,
      validationDurationMs: 0,
      inputCharacters: promptCharacters,
      timedOut: false,
      retryCount: 0
    };

    return buildRuntimeFailure({
      status: "invalid_input",
      mode: SALES_AGENT_RUNTIME_DEFAULT_MODE,
      dryRun,
      validationContext,
      validation: buildValidationSkipped(),
      metrics,
      provider: providerSummary,
      versions,
      metadata: {
        ...metadata,
        validationStatus: "skipped"
      },
      error: {
        code: "invalid_input",
        message: "Runtime mode is not supported.",
        providerName: providerSummary.name
      },
      warnings: ["invalid_input"],
      issues: [
        {
          code: "contract_incomplete",
          level: "fatal",
          message: "Runtime mode is not supported.",
          path: ["options", "mode"]
        }
      ],
      decisionType: "insufficient_context"
    });
  }

  const validationContext = buildValidationContext(input, allowedCapabilities, strictValidation, currentTime, safeRuntimeMetadata, contractVersion);

  if (!enabled) {
    const completedAt = clock.toISOString(clock.now());
    const metrics: SalesAgentRuntimeMetrics = {
      startedAt,
      completedAt,
      durationMs: clock.now() - startedAtMs,
      validationDurationMs: 0,
      inputCharacters: promptCharacters,
      timedOut: false,
      retryCount: 0
    };

    return buildRuntimeFailure({
      status: "disabled",
      mode: runtimeMode,
      dryRun,
      validationContext,
      validation: buildValidationSkipped(),
      metrics,
      provider: providerSummary,
      versions,
      metadata: {
        ...metadata,
        validationStatus: "skipped"
      },
      error: {
        code: "disabled",
        message: "Sales Agent runtime is disabled.",
        providerName: providerSummary.name
      },
      warnings: ["runtime_disabled", "provider_not_called"],
      issues: [
        {
          code: "contract_incomplete",
          level: "fatal",
          message: "Sales Agent runtime is disabled.",
          path: ["options", "enabled"]
        }
      ],
      decisionType: "insufficient_context"
    });
  }

  if (!input.provider) {
    const completedAt = clock.toISOString(clock.now());
    const metrics: SalesAgentRuntimeMetrics = {
      startedAt,
      completedAt,
      durationMs: clock.now() - startedAtMs,
      validationDurationMs: 0,
      inputCharacters: promptCharacters,
      timedOut: false,
      retryCount: 0
    };

    return buildRuntimeFailure({
      status: "provider_unavailable",
      mode: runtimeMode,
      dryRun,
      validationContext,
      validation: buildValidationSkipped(),
      metrics,
      provider: providerSummary,
      versions,
      metadata: {
        ...metadata,
        validationStatus: "skipped"
      },
      error: {
        code: "provider_unavailable",
        message: "Sales Agent provider is unavailable.",
        providerName: providerSummary.name
      },
      warnings: ["provider_unavailable", "provider_not_called"],
      issues: [
        {
          code: "contract_incomplete",
          level: "fatal",
          message: "Sales Agent provider is unavailable.",
          path: ["provider"]
        }
      ],
      decisionType: "insufficient_context"
    });
  }

  const providerRequest = {
    promptPackage,
    salesAgentInput: input.salesAgentInput,
    contractVersion,
    promptVersion,
    runtimeMode,
    requestedMode: input.salesAgentInput.requestedMode,
    allowedCapabilities,
    correlationId: input.correlationId ?? null,
    metadata: {
      ...safeRuntimeMetadata,
      runtime: {
        mode: runtimeMode,
        dryRun,
        enabled,
        strictValidation
      },
      prompt: {
        promptVersion,
        contractVersion
      }
    }
  };

  const providerInvokeOptions = {
    timeoutMs,
    currentTime,
    dryRun,
    strictValidation,
    metadata: safeRuntimeMetadata
  } as const;

  const providerStartedAt = clock.now();
  const invoked = await invokeWithTimeout(input.provider, providerRequest, providerInvokeOptions, timeoutMs, input.options.abortSignal ?? null);
  const providerDurationMs = clock.now() - providerStartedAt;
  const providerOutcome = invoked.outcome;
  const baseMetrics: SalesAgentRuntimeMetrics = {
    startedAt,
    completedAt: clock.toISOString(clock.now()),
    durationMs: clock.now() - startedAtMs,
    providerDurationMs,
    validationDurationMs: 0,
    model: null,
    inputTokens: null,
    outputTokens: null,
    estimatedCost: null,
    inputCharacters: promptCharacters,
    outputCharacters: 0,
    timedOut: invoked.timedOut,
    retryCount: 0,
    providerRequestId: null
  };

  if (providerOutcome.kind === "timeout") {
    const validation = buildValidationSkipped();
    const provider = {
      ...providerSummary,
      version: input.provider.version ?? null
    };
    const completionMetadata = buildRuntimeMetadata({
      ...metadata,
      provider,
      validationStatus: "skipped",
      safeMetadata: {
        ...metadata.safeMetadata,
        provider: {
          name: provider.name,
          version: provider.version,
          mode: runtimeMode
        }
      }
    });

    return buildRuntimeFailure({
      status: "timeout",
      mode: runtimeMode,
      dryRun,
      validationContext,
      validation,
      metrics: baseMetrics,
      provider,
      versions,
      metadata: completionMetadata,
      error: {
        code: "timeout",
        message: "Sales Agent provider timed out.",
        providerName: provider.name,
        providerVersion: provider.version
      },
      warnings: ["provider_timeout"],
      issues: [
        {
          code: "contract_incomplete",
          level: "fatal",
          message: "Sales Agent provider timed out.",
          path: ["provider"]
        }
      ],
      decisionType: "insufficient_context"
    });
  }

  if (providerOutcome.kind === "error") {
    const classification = classifyProviderError(providerOutcome.error, providerSummary, invoked.timedOut);
    const validation = buildValidationSkipped();
    const provider = {
      ...providerSummary,
      version: input.provider.version ?? null
    };
    const completionMetadata = buildRuntimeMetadata({
      ...metadata,
      provider,
      validationStatus: "skipped",
      safeMetadata: {
        ...metadata.safeMetadata,
        provider: {
          name: provider.name,
          version: provider.version,
          errorCode: classification.code
        }
      }
    });

    return buildRuntimeFailure({
      status: classification.status,
      mode: runtimeMode,
      dryRun,
      validationContext,
      validation,
      metrics: baseMetrics,
      provider,
      versions,
      metadata: completionMetadata,
      error: {
        code: classification.code,
        message: classification.message,
        providerName: provider.name,
        providerVersion: provider.version,
        details: classification.details
      },
      warnings: [classification.code],
      issues: [
        {
          code: "contract_incomplete",
          level: "fatal",
          message: classification.message,
          path: ["provider"]
        }
      ],
      decisionType: "insufficient_context"
    });
  }

  const response = validateProviderResponseShape(providerOutcome.value);
  if (!response) {
    const validation = buildValidationSkipped();
    const provider = {
      ...providerSummary,
      version: input.provider.version ?? null
    };
    const completionMetadata = buildRuntimeMetadata({
      ...metadata,
      provider,
      validationStatus: "skipped",
      safeMetadata: {
        ...metadata.safeMetadata,
        provider: {
          name: provider.name,
          version: provider.version,
          errorCode: "invalid_response"
        }
      }
    });

    return buildRuntimeFailure({
      status: "provider_error",
      mode: runtimeMode,
      dryRun,
      validationContext,
      validation,
      metrics: baseMetrics,
      provider,
      versions,
      metadata: completionMetadata,
      error: {
        code: "invalid_response",
        message: "Provider response shape is invalid.",
        providerName: provider.name,
        providerVersion: provider.version
      },
      warnings: ["provider_invalid_response"],
      issues: [
        {
          code: "contract_incomplete",
          level: "fatal",
          message: "Provider response shape is invalid.",
          path: ["provider"]
        }
      ],
      decisionType: "insufficient_context"
    });
  }

  const rawOutputSanitization = sanitizePreview(response.rawOutput);
  const rawOutputPreview = captureRawOutput ? rawOutputSanitization : null;
  const outputCharacters = rawOutputSanitization.bytes;
  baseMetrics.outputCharacters = outputCharacters;
  baseMetrics.inputTokens = response.inputTokens ?? null;
  baseMetrics.outputTokens = response.outputTokens ?? null;
  baseMetrics.estimatedCost = response.estimatedCost ?? null;
  baseMetrics.providerRequestId = response.providerRequestId ?? null;
  baseMetrics.model = response.model ?? null;

  const provider = {
    ...providerSummary,
    version: input.provider.version ?? null,
    model: response.model ?? null,
    requestId: response.providerRequestId ?? null,
    finishReason: response.finishReason ?? null
  };

  const validationStartedAt = clock.now();
  const validationResult = validateSalesAgentOutput(response.rawOutput, validationContext);
  const validationDurationMs = clock.now() - validationStartedAt;
  baseMetrics.validationDurationMs = validationDurationMs;

  const validationMetadata = validationResult.metadata;
  const validationSafeMetadata = sanitizeJsonRecord(validationMetadata.safeMetadata).value;
  const mergedSafeMetadata = {
    ...metadata.safeMetadata,
    provider: {
      name: provider.name,
      version: provider.version,
      model: provider.model,
      requestId: provider.requestId,
      finishReason: provider.finishReason
    },
    validation: validationSafeMetadata
  };

  const finalMetadata = buildRuntimeMetadata({
    ...metadata,
    provider,
    validationStatus: validationResult.status,
    safeMetadata: mergedSafeMetadata,
    promptPreview: includePromptPreview ? promptPackage.promptText.slice(0, maxInputCharacters) : null
  });

  if (validationResult.status !== "valid") {
    const fallbackIssue: SalesAgentOutputValidationIssue = {
      code: "contract_incomplete",
      level: "fatal",
      message: "Provider output failed validation.",
      path: ["rawOutput"]
    };
    const issues: readonly SalesAgentOutputValidationIssue[] = validationResult.issues.length > 0 ? validationResult.issues : [
      fallbackIssue
    ];
    const result = validationResult.result ?? undefined;
    const safeFailure = result ?? undefined;
    const runtimeResult = buildRuntimeFailure({
      status: "validation_failed_safe",
      mode: runtimeMode,
      dryRun,
      validationContext,
      validation: validationResult,
      metrics: baseMetrics,
      provider,
      versions,
      metadata: finalMetadata,
      error: {
        code: "validation_failed_safe",
        message: validationResult.issues[0]?.message ?? "Provider output failed validation.",
        providerName: provider.name,
        providerVersion: provider.version,
        details: {
          validationStatus: validationResult.status
        }
      },
      warnings: uniqueWarnings([
        "validation_failed_safe",
        ...(validationResult.warnings ?? []),
        ...(captureRawOutput ? ["raw_output_captured"] : [])
      ]),
      issues,
      decisionType: "insufficient_context",
      correlationId: input.correlationId ?? null,
      rawOutputPreview: rawOutputPreview ? rawOutputPreview.value : null
    });

    if (safeFailure) {
      runtimeResult.validation = validationResult;
    }
    return runtimeResult;
  }

  if (outputCharacters > maxOutputCharacters) {
    const runtimeResult = buildRuntimeFailure({
      status: "completed_failed_safe",
      mode: runtimeMode,
      dryRun,
      validationContext,
      validation: validationResult,
      metrics: baseMetrics,
      provider,
      versions,
      metadata: {
        ...finalMetadata,
        safeMetadata: {
          ...finalMetadata.safeMetadata,
          outputTooLarge: true
        }
      },
      error: {
        code: "invalid_response",
        message: "Provider output exceeded the configured maximum size.",
        providerName: provider.name,
        providerVersion: provider.version,
        details: {
          outputCharacters
        }
      },
      warnings: uniqueWarnings(["output_too_large", ...(captureRawOutput ? ["raw_output_captured"] : [])]),
      issues: [
        {
          code: "contract_incomplete",
          level: "fatal",
          message: "Provider output exceeded the configured maximum size.",
          path: ["rawOutput"]
        }
      ],
      decisionType: "insufficient_context",
      correlationId: input.correlationId ?? null,
      rawOutputPreview: rawOutputPreview ? rawOutputPreview.value : null
    });
    runtimeResult.validation = validationResult;
    return runtimeResult;
  }

  const result = validationResult.result;
  const completedAt = clock.toISOString(clock.now());
  const successMetrics: SalesAgentRuntimeMetrics = {
    ...baseMetrics,
    completedAt,
    durationMs: clock.now() - startedAtMs,
    validationDurationMs,
    providerRequestId: provider.requestId
  };

  return {
    status: "completed_valid",
    mode: runtimeMode,
    dryRun,
    result,
    validation: validationResult,
    metrics: successMetrics,
    warnings: uniqueWarnings([
      ...validationResult.warnings,
      ...(captureRawOutput ? ["raw_output_captured", "raw_output_sanitized"] : []),
      ...(includePromptPreview ? ["prompt_preview_included"] : [])
    ]),
    error: null,
    provider,
    versions,
    correlationId: input.correlationId ?? null,
    metadata: finalMetadata,
    rawOutputPreview: captureRawOutput ? (rawOutputPreview ? rawOutputPreview.value : null) : undefined
  };
}

export { BRAIN_SALES_AGENT_ENABLED, BRAIN_SALES_AGENT_DRY_RUN };
