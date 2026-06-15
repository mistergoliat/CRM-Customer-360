import type { BrainContextMode, BrainError, BrainInboundSource, BrainNormalizedProcessInboundRequest, BrainValidationResult } from "../inbound/types";
import { makeBrainRequestId } from "../instructions";
import { buildBrainInstructions } from "./buildInstructions";
import { resolveBrainResponsePolicy } from "./responsePolicy";
import type {
  BrainActionKind,
  BrainActionResolveOptions,
  BrainActionResolveRequest,
  BrainActionResolveResponse,
  BrainNormalizedAction
} from "./types";

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

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).toLowerCase() === "false") return false;
  return fallback;
}

function error(message: string, details?: Record<string, unknown>): BrainError {
  return {
    code: "INVALID_INPUT" as const,
    message,
    retryable: true,
    details
  };
}

function normalizeOptions(input: unknown): BrainActionResolveOptions {
  const options = isRecord(input) ? input : {};
  return {
    dryRun: asBoolean(options.dryRun, true),
    executeActions: asBoolean(options.executeActions, false),
    returnInstructionsForN8n: asBoolean(options.returnInstructionsForN8n, true),
    debug: asBoolean(options.debug, false)
  };
}

function normalizeDecision(input: unknown) {
  if (!isRecord(input)) return undefined;
  return {
    intent: asString(input.intent) ?? undefined,
    department: asString(input.department) ?? undefined,
    caseTopic: asString(input.caseTopic) ?? undefined,
    finalAction: asString(input.finalAction) ?? undefined,
    requiresHuman: asBoolean(input.requiresHuman, false),
    shouldReply: asBoolean(input.shouldReply, false),
    replyText: asString(input.replyText) ?? undefined,
    confidence: typeof input.confidence === "number" ? input.confidence : undefined
  };
}

function normalizeSource(value: unknown): BrainInboundSource {
  return value === "n8n_meta_webhook" || value === "hub_preview" || value === "manual_test" || value === "system_job" ? value : "manual_test";
}

function normalizeContextMode(value: unknown): BrainContextMode {
  return value === "standard" || value === "recovery" ? value : "minimal";
}

function normalizeServiceContext(input: unknown): BrainActionResolveRequest["serviceContext"] | null {
  if (!isRecord(input)) return null;
  return {
    primary_service: (asString(input.primary_service) ?? "unknown") as BrainActionResolveRequest["serviceContext"]["primary_service"],
    service_code: asString(input.service_code) ?? "unknown",
    source_domain: asString(input.source_domain) ?? null,
    source_table: asString(input.source_table) ?? null,
    source_id: asOptionalStringOrNumber(input.source_id) ?? null,
    source_status: asString(input.source_status) ?? null,
    source_priority: asString(input.source_priority) ?? null,
    suggested_agent: asString(input.suggested_agent) ?? null,
    signals: Array.isArray(input.signals) ? input.signals.filter((item) => typeof item === "string") : []
  };
}

function normalizeContextSummary(input: unknown): BrainActionResolveRequest["contextSummary"] | null {
  if (!isRecord(input)) return null;
  return {
    requestId: asString(input.requestId) ?? `brain-action-${Date.now()}`,
    partialContext: asBoolean(input.partialContext, true),
    waId: asString(input.waId) ?? "unknown",
    phoneNumberId: asString(input.phoneNumberId) ?? "unknown",
    messageId: asString(input.messageId) ?? "invalid-request",
    conversationCaseId: asOptionalStringOrNumber(input.conversationCaseId),
    identityType: asString(input.identityType) ?? "unknown",
    identityConfidence: typeof input.identityConfidence === "number" ? input.identityConfidence : 0,
    activeCaseId: asOptionalStringOrNumber(input.activeCaseId) ?? null,
    activeCaseStatus: asString(input.activeCaseStatus) ?? null,
    caseCount: typeof input.caseCount === "number" ? input.caseCount : 0,
    messageCount: typeof input.messageCount === "number" ? input.messageCount : 0,
    primaryService: asString(input.primaryService) ?? "unknown",
    serviceCode: asString(input.serviceCode) ?? "unknown",
    botEligible: asBoolean(input.botEligible, false),
    botRecommendedMode: asString(input.botRecommendedMode) === "bot" || asString(input.botRecommendedMode) === "human" ? (asString(input.botRecommendedMode) as "bot" | "human") : "review",
    botReason: asString(input.botReason) ?? "Action context unavailable.",
    contextPacksAvailable: Array.isArray(input.contextPacksAvailable) ? input.contextPacksAvailable.filter((item) => typeof item === "string") : [],
    warnings: Array.isArray(input.warnings) ? input.warnings.filter((item) => typeof item === "string") : []
  };
}

export function normalizeBrainActionResolveRequest(input: unknown): BrainValidationResult<BrainActionResolveRequest> {
  if (!isRecord(input)) {
    return { ok: false, value: null, errors: [error("Request body must be an object.")] };
  }

  const errors = [];
  const waId = asString(input.waId);
  const phoneNumberId = asString(input.phoneNumberId);
  const messageId = asString(input.messageId);
  const messageText = asString(input.messageText) ?? "";
  const contextSummary = normalizeContextSummary(input.contextSummary ?? input.context_summary);
  const botEligibility = isRecord(input.botEligibility) ? input.botEligibility : isRecord(input.bot_eligibility) ? input.bot_eligibility : null;
  const serviceContext = normalizeServiceContext(input.serviceContext ?? input.service_context);

  if (!waId) errors.push(error("waId is required."));
  if (!phoneNumberId) errors.push(error("phoneNumberId is required."));
  if (!messageId) errors.push(error("messageId is required."));
  if (!contextSummary) errors.push(error("contextSummary is required."));
  if (!serviceContext) errors.push(error("serviceContext is required."));

  if (errors.length > 0) {
    return { ok: false, value: null, errors };
  }

  return {
    ok: true,
    value: {
      requestId: asString(input.requestId) ?? undefined,
      source: normalizeSource(input.source),
      waId: waId as string,
      phoneNumberId: phoneNumberId as string,
      messageId: messageId as string,
      messageText: messageText as string,
      conversationCaseId: asOptionalStringOrNumber(input.conversationCaseId),
      contextSummary: contextSummary as BrainActionResolveRequest["contextSummary"],
      botEligibility: botEligibility as BrainActionResolveRequest["botEligibility"],
      serviceContext: serviceContext as BrainActionResolveRequest["serviceContext"],
      options: normalizeOptions(input.options),
      decision: normalizeDecision(input.decision)
    },
    errors: []
  };
}

function makeNormalizedAction(action: BrainActionKind, reason: string, blockedReasons: string[], blocked: boolean): BrainNormalizedAction {
  return {
    action,
    final_action: action,
    should_reply: action === "continue_legacy",
    should_continue_legacy_flow: action !== "blocked" && action !== "no_action",
    requires_human: action === "needs_human_review",
    blocked,
    allow_auto_reply: false,
    allow_human_handoff: false,
    allow_case_mutation: false,
    reason,
    blocked_reasons: blockedReasons,
    signals: []
  };
}

function makeSyntheticProcessInboundRequest(request: BrainActionResolveRequest): BrainNormalizedProcessInboundRequest {
  return {
    channel: "whatsapp",
    source: request.source,
    contextMode: normalizeContextMode(undefined),
    waId: request.waId,
    phoneNumberId: request.phoneNumberId,
    messageId: request.messageId,
    messageText: request.messageText,
    conversationCaseId: request.conversationCaseId,
    customerRef: undefined,
    options: {
      dryRun: request.options.dryRun,
      executeActions: false,
      returnInstructionsForN8n: request.options.returnInstructionsForN8n,
      debug: request.options.debug,
      runAgentDryRun: false,
      buildExecutionPlanDryRun: false
    },
    metadata: {}
  };
}

function makeFallbackContextSummary(requestId: string): BrainActionResolveRequest["contextSummary"] {
  return {
    requestId,
    partialContext: true,
    waId: "unknown",
    phoneNumberId: "unknown",
    messageId: "invalid-request",
    conversationCaseId: undefined,
    identityType: "unknown",
    identityConfidence: 0,
    activeCaseId: null,
    activeCaseStatus: null,
    caseCount: 0,
    messageCount: 0,
    primaryService: "unknown",
    serviceCode: "unknown",
    botEligible: false,
    botRecommendedMode: "review",
    botReason: "Invalid action request.",
    contextPacksAvailable: [],
    warnings: ["Invalid action request."]
  };
}

function makeFallbackServiceContext() {
  return {
    primary_service: "unknown" as BrainActionResolveRequest["serviceContext"]["primary_service"],
    service_code: "unknown",
    source_domain: null,
    source_table: null,
    source_id: null,
    source_status: null,
    source_priority: null,
    suggested_agent: null,
    signals: []
  };
}

function buildActionResponse(
  request: BrainActionResolveRequest,
  decision: BrainActionKind,
  reason: string,
  blockedReasons: string[],
  policyBlocked: boolean,
  ok: boolean,
  startedAt: number,
  errors: BrainError[]
): BrainActionResolveResponse {
  const requestId = request.requestId ?? makeBrainRequestId({
    source: request.source,
    channel: "whatsapp",
    waId: request.waId,
    phoneNumberId: request.phoneNumberId,
    messageId: request.messageId,
    messageText: request.messageText
  });
  const contextSummary = request.contextSummary;
  const policy = resolveBrainResponsePolicy(request);
  const normalizedAction = makeNormalizedAction(decision, reason, blockedReasons, policyBlocked);
  const syntheticInbound = makeSyntheticProcessInboundRequest(request);
  const syntheticContext = {
    status: "noop" as const,
    source: request.source,
    contextMode: "minimal" as const,
    traceId: requestId,
    waId: request.waId,
    phoneNumberId: request.phoneNumberId,
    messageId: request.messageId,
    confidence: contextSummary.identityConfidence,
    notes: contextSummary.warnings.slice(0, 3),
    warnings: contextSummary.warnings.slice(0, 3)
  };
  const instructions = buildBrainInstructions(
    syntheticInbound,
    syntheticContext,
    { valid: !request.options.executeActions, failClosedReason: request.options.executeActions ? "executeActions=true is not allowed." : undefined },
    {
      contextSummary,
      actionPolicy: policy,
      normalizedAction,
      blockedReasons: policy.blocked_reasons,
      botEligibility: request.botEligibility,
      contextPacksAvailable: contextSummary.contextPacksAvailable,
      suggestedNextStep: policy.suggested_next_step
    }
  );

  return {
    ok,
    request_id: requestId,
    context_summary: contextSummary,
    bot_eligibility: request.botEligibility,
    service_context: request.serviceContext,
    action_policy: policy,
    normalized_action: normalizedAction,
    blocked_reasons: blockedReasons,
    warnings: contextSummary.warnings.slice(0, 5),
    errors: request.options.executeActions
      ? [
          {
            code: "ACTION_BLOCKED",
            message: "executeActions=true is not allowed in the Brain action resolver.",
            retryable: false
          }
        ]
      : errors,
    instructions,
    metadata: {
      version: "brain.action.policy.v1",
      generatedAt: new Date().toISOString(),
      processingMs: Date.now() - startedAt,
      dryRun: request.options.dryRun,
      executeActions: false,
      returnInstructionsForN8n: request.options.returnInstructionsForN8n,
      debug: request.options.debug
    }
  };
}

export async function resolveBrainAction(input: unknown, startedAt = Date.now()): Promise<BrainActionResolveResponse> {
  const normalizedResult = normalizeBrainActionResolveRequest(input);
  if (!normalizedResult.ok) {
    const fallbackRequestId = `brain-action-${Date.now()}`;
    const fallbackSummary = makeFallbackContextSummary(fallbackRequestId);
    const fallbackRequest: BrainActionResolveRequest = {
      requestId: fallbackRequestId,
      source: "manual_test",
      waId: "unknown",
      phoneNumberId: "unknown",
      messageId: "invalid-request",
      messageText: "",
      contextSummary: fallbackSummary,
      botEligibility: null,
      serviceContext: makeFallbackServiceContext(),
      options: {
        dryRun: true,
        executeActions: false,
        returnInstructionsForN8n: true,
        debug: false
      }
    };
    return buildActionResponse(
      fallbackRequest,
      "blocked",
      normalizedResult.errors[0]?.message ?? "Invalid action request.",
      ["invalid_input"],
      true,
      false,
      startedAt,
      normalizedResult.errors
    );
  }

  const request = normalizedResult.value;
  const policy = resolveBrainResponsePolicy(request);
  return buildActionResponse(
    request,
    policy.decision,
    policy.reason,
    policy.blocked_reasons,
    policy.decision === "blocked",
    normalizedResult.ok && !request.options.executeActions,
    startedAt,
    []
  );
}
