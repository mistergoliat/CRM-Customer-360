import { resolveBrainResponsePolicy } from "../actions/responsePolicy";
import type { BrainActionPolicy } from "../actions/types";
import type { BrainContextPack, BrainContextPacks, BrainInputEvent } from "../context/types";
import type { BrainResolvedContext, BrainError, BrainValidationResult } from "../inbound/types";
import { makeBrainTraceId } from "../instructions";
import { getBrainAgentDefinition, isBrainAgentRunnable } from "./registry";
import { recordBrainAgentRun } from "./agentRunLog";
import { validateBrainAgentOutput } from "./validateAgentOutput";
import type {
  BrainAgentDefinition,
  BrainAgentRunOptions,
  BrainAgentRunResponse,
  BrainNormalizedAgentRunRequest,
  BrainAgentName,
  BrainAgentValidationResult
} from "./types";
import { runBrainModelAdapter } from "../models/modelAdapter";
import type { BrainToolRequest } from "../tools/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).toLowerCase() === "false") return false;
  return fallback;
}

function asNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function error(message: string, details?: Record<string, unknown>): BrainError {
  return {
    code: "INVALID_INPUT",
    message,
    retryable: true,
    details
  };
}

function parseOptions(input: unknown): BrainAgentRunOptions {
  const options = isRecord(input) ? input : {};
  return {
    dryRun: asBoolean(options.dryRun, true),
    executeActions: asBoolean(options.executeActions, false),
    debug: asBoolean(options.debug, false)
  };
}

function normalizeContextPack(input: unknown): BrainContextPack | null {
  if (!isRecord(input)) return null;
  return {
    agent: asString(input.agent) ?? "knowledge",
    available: asBoolean(input.available, false),
    confidence: asNumber(input.confidence, 0),
    reason: asString(input.reason) ?? "Context pack unavailable.",
    signals: Array.isArray(input.signals) ? input.signals.filter((item) => typeof item === "string") : [],
    recommended_action: asString(input.recommended_action) ?? "review",
    related_case_id: input.related_case_id === undefined ? null : (input.related_case_id as string | number | null),
    related_order_id: input.related_order_id === undefined ? null : (input.related_order_id as string | number | null)
  };
}

function normalizeInputEvent(input: unknown): BrainValidationResult<BrainInputEvent> {
  if (!isRecord(input)) {
    return { ok: false, value: null, errors: [error("inputEvent must be an object.")] };
  }

  const channel = asString(input.channel) === "whatsapp" ? "whatsapp" : null;
  const sourceText = asString(input.source);
  let source: BrainInputEvent["source"] | null = null;
  if (sourceText === "n8n_meta_webhook" || sourceText === "hub_preview" || sourceText === "manual_test" || sourceText === "system_job") {
    source = sourceText as BrainInputEvent["source"];
  }
  const waId = asString(input.wa_id);
  const phoneNumberId = asString(input.phone_number_id);
  const messageId = asString(input.message_id);
  const messageText = asString(input.message_text) ?? "";

  const errors: BrainError[] = [];
  if (!channel) errors.push(error("inputEvent.channel must be whatsapp."));
  if (!source) errors.push(error("inputEvent.source is required."));
  if (!waId) errors.push(error("inputEvent.wa_id is required."));
  if (!phoneNumberId) errors.push(error("inputEvent.phone_number_id is required."));
  if (!messageId) errors.push(error("inputEvent.message_id is required."));
  if (!messageText) errors.push(error("inputEvent.message_text is required."));

  if (errors.length > 0) return { ok: false, value: null, errors };

  return {
    ok: true,
    value: {
      channel: channel as BrainInputEvent["channel"],
      source: source as BrainInputEvent["source"],
      wa_id: waId as string,
      phone_number_id: phoneNumberId as string,
      message_id: messageId as string,
      message_text: messageText as string,
      conversation_case_id: input.conversation_case_id as string | number | undefined,
      id_order: input.id_order as string | number | undefined,
      id_customer: input.id_customer as string | number | undefined,
      invoice_number: input.invoice_number as string | number | undefined,
      source_workflow: asString(input.source_workflow) ?? undefined,
      source_node: asString(input.source_node) ?? undefined,
      received_at: asString(input.received_at) ?? undefined,
      dry_run: asBoolean(input.dry_run, true)
    },
    errors: []
  };
}

function normalizeContext(input: unknown): BrainValidationResult<BrainResolvedContext> {
  if (!isRecord(input)) {
    return { ok: false, value: null, errors: [error("context must be an object.")] };
  }

  const errors: BrainError[] = [];
  const status = asString(input.status) === "noop" ? "noop" : null;
  const sourceText = asString(input.source);
  let source: BrainResolvedContext["source"] | null = null;
  if (sourceText === "n8n_meta_webhook" || sourceText === "hub_preview" || sourceText === "manual_test" || sourceText === "system_job") {
    source = sourceText as BrainResolvedContext["source"];
  }
  const contextMode = asString(input.contextMode) === "standard" || asString(input.contextMode) === "recovery" ? asString(input.contextMode) : "minimal";
  const traceId = asString(input.traceId);
  const waId = asString(input.waId);
  const phoneNumberId = asString(input.phoneNumberId);
  const messageId = asString(input.messageId);
  const confidence = typeof input.confidence === "number" ? input.confidence : 0;

  if (!status) errors.push(error("context.status is required."));
  if (!source) errors.push(error("context.source is required."));
  if (!traceId) errors.push(error("context.traceId is required."));
  if (!waId) errors.push(error("context.waId is required."));
  if (!phoneNumberId) errors.push(error("context.phoneNumberId is required."));
  if (!messageId) errors.push(error("context.messageId is required."));

  if (errors.length > 0) return { ok: false, value: null, errors };

  return {
    ok: true,
    value: {
      status: status as BrainResolvedContext["status"],
      source: source as BrainResolvedContext["source"],
      contextMode: contextMode as BrainResolvedContext["contextMode"],
      traceId: traceId as string,
      waId: waId as string,
      phoneNumberId: phoneNumberId as string,
      messageId: messageId as string,
      conversationCaseId: input.conversationCaseId as string | number | undefined,
      customerRef: isRecord(input.customerRef) ? (input.customerRef as BrainResolvedContext["customerRef"]) : undefined,
      sourceWorkflow: asString(input.sourceWorkflow) ?? undefined,
      sourceNode: asString(input.sourceNode) ?? undefined,
      confidence,
      notes: Array.isArray(input.notes) ? input.notes.filter((item) => typeof item === "string") : [],
      warnings: Array.isArray(input.warnings) ? input.warnings.filter((item) => typeof item === "string") : []
    },
    errors: []
  };
}

function normalizeActionPolicy(input: unknown): BrainValidationResult<BrainActionPolicy> {
  if (!isRecord(input)) {
    return { ok: false, value: null, errors: [error("actionPolicy must be an object.")] };
  }

  const decision = asString(input.decision);
  const allowedDecision = decision === "continue_legacy" || decision === "context_only" || decision === "needs_human_review" || decision === "blocked" || decision === "no_action";
  const errors: BrainError[] = [];

  if (!allowedDecision) errors.push(error("actionPolicy.decision is invalid."));
  if (!asString(input.policyId)) errors.push(error("actionPolicy.policyId is required."));
  if (!asString(input.reason)) errors.push(error("actionPolicy.reason is required."));

  if (errors.length > 0) return { ok: false, value: null, errors };

  return {
    ok: true,
    value: {
      policyId: asString(input.policyId) as string,
      decision: decision as BrainActionPolicy["decision"],
      reason: asString(input.reason) as string,
      blocked_reasons: Array.isArray(input.blocked_reasons) ? input.blocked_reasons.filter((item) => typeof item === "string") : [],
      can_auto_reply: asBoolean(input.can_auto_reply, false),
      can_human_handoff: asBoolean(input.can_human_handoff, false),
      can_case_mutation: asBoolean(input.can_case_mutation, false),
      continue_legacy_flow: asBoolean(input.continue_legacy_flow, false),
      should_reply: asBoolean(input.should_reply, false),
      requires_human: asBoolean(input.requires_human, false),
      confidence: asNumber(input.confidence, 0),
      signals: Array.isArray(input.signals) ? input.signals.filter((item) => typeof item === "string") : [],
      suggested_next_step:
        asString(input.suggested_next_step) === "legacy_continue" ||
        asString(input.suggested_next_step) === "context_only" ||
        asString(input.suggested_next_step) === "blocked_by_bot_eligibility" ||
        asString(input.suggested_next_step) === "needs_human_review"
          ? (asString(input.suggested_next_step) as BrainActionPolicy["suggested_next_step"])
          : "context_only"
    },
    errors: []
  };
}

function normalizeContextPacks(input: unknown) {
  if (!isRecord(input)) return {};

  return {
    sales: normalizeContextPack(input.sales) ?? undefined,
    sac: normalizeContextPack(input.sac) ?? undefined,
    postventa: normalizeContextPack(input.postventa) ?? undefined,
    knowledge: normalizeContextPack(input.knowledge) ?? undefined,
    campaign: normalizeContextPack(input.campaign) ?? undefined
  };
}

export function normalizeBrainAgentRunRequest(input: unknown): BrainAgentValidationResult {
  if (!isRecord(input)) {
    return { ok: false, value: null, errors: [error("Request body must be an object.")] };
  }

  const errors: BrainError[] = [];
  const agentName = asString(input.agentName);
  const inputEventResult = normalizeInputEvent(input.inputEvent);
  const contextResult = normalizeContext(input.context);
  const actionPolicyResult = normalizeActionPolicy(input.actionPolicy);
  const options = parseOptions(input.options);

  if (!agentName) errors.push(error("agentName is required."));
  if (!inputEventResult.ok) errors.push(...inputEventResult.errors);
  if (!contextResult.ok) errors.push(...contextResult.errors);
  if (!actionPolicyResult.ok) errors.push(...actionPolicyResult.errors);
  if (options.executeActions) errors.push(error("executeActions=true is not allowed for agent runs.", { code: "ACTION_BLOCKED" }));

  const validAgentName =
    agentName === "knowledge" ||
    agentName === "sales" ||
    agentName === "sac" ||
    agentName === "postventa" ||
    agentName === "campaign" ||
    agentName === "supervisor"
      ? (agentName as BrainAgentName)
      : null;

  if (!validAgentName) errors.push(error("agentName is not registered."));

  if (errors.length > 0) {
    return { ok: false, value: null, errors };
  }

  return {
    ok: true,
    value: {
      agentName: validAgentName as BrainAgentName,
      inputEvent: inputEventResult.value as BrainInputEvent,
      context: contextResult.value as BrainResolvedContext,
      contextPacks: normalizeContextPacks(input.contextPacks),
      actionPolicy: actionPolicyResult.value as BrainActionPolicy,
      options,
      requestId: asString(input.requestId) ?? undefined
    },
    errors: []
  };
}

function buildBlockedResponse(
  request: BrainNormalizedAgentRunRequest,
  definition: BrainAgentDefinition,
  startedAt: number,
  reason: string,
  validationErrors: BrainError[],
  warnings: string[] = []
): BrainAgentRunResponse {
  const requestId = request.requestId ?? request.context.traceId ?? makeBrainTraceId({ source: request.context.source, messageId: request.context.messageId, waId: request.context.waId });
  return {
    ok: false,
    requestId,
    agentName: definition.name,
    agentVersion: definition.version,
    outputSchema: definition.outputSchema,
    decision: "blocked",
    message: reason,
    toolRequests: [],
    confidence: 0,
    safetyFlags: ["blocked", "mock_adapter", "read_only", "no_llm", "no_db_writes", "no_whatsapp"],
    draft: null,
    validationErrors,
    warnings,
    contextPacksUsed: [],
    metadata: {
      version: "brain.agent.runtime.v1",
      generatedAt: new Date().toISOString(),
      processingMs: Date.now() - startedAt,
      dryRun: request.options.dryRun,
      debug: request.options.debug,
      modelName: "disabled",
      modelVersion: "brain.model.disabled.v1",
      logStatus: "skipped"
    }
  };
}

function filterToolRequests(definition: BrainAgentDefinition, toolRequests: BrainToolRequest[]) {
  const allowed = new Set(definition.allowedTools);
  const filtered: BrainToolRequest[] = [];
  const warnings: string[] = [];

  for (const request of toolRequests) {
    if (!allowed.has(request.toolName)) {
      warnings.push(`Tool ${request.toolName} blocked because it is not allowed for agent ${definition.name}.`);
      filtered.push({
        ...request,
        status: "blocked",
        reason: `Tool ${request.toolName} is not allowed for agent ${definition.name}.`,
        blockedReasons: [...request.blockedReasons, "tool_not_allowed"]
      });
      continue;
    }

    filtered.push(request);
  }

  return { filtered, warnings };
}

export async function runAgent(input: unknown, startedAt = Date.now()): Promise<BrainAgentRunResponse> {
  const normalizedResult = normalizeBrainAgentRunRequest(input);
  if (!normalizedResult.ok) {
    const fallbackDefinition = getBrainAgentDefinition("knowledge");
    return buildBlockedResponse(
      {
        agentName: "knowledge",
        inputEvent: {
          channel: "whatsapp",
          source: "manual_test",
          wa_id: "unknown",
          phone_number_id: "unknown",
          message_id: "invalid-request",
          message_text: "",
          dry_run: true
        },
        context: {
          status: "noop",
          source: "manual_test",
          contextMode: "minimal",
          traceId: `brain-agent-${Date.now()}`,
          waId: "unknown",
          phoneNumberId: "unknown",
          messageId: "invalid-request",
          confidence: 0,
          notes: [],
          warnings: []
        },
        contextPacks: {},
        actionPolicy: resolveBrainResponsePolicy({
          requestId: `brain-agent-${Date.now()}`,
          source: "manual_test",
          waId: "unknown",
          phoneNumberId: "unknown",
          messageId: "invalid-request",
          messageText: "",
          contextSummary: {
            requestId: `brain-agent-${Date.now()}`,
            partialContext: true,
            waId: "unknown",
            phoneNumberId: "unknown",
            messageId: "invalid-request",
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
            botReason: "Invalid agent request.",
            contextPacksAvailable: [],
            warnings: ["Invalid agent request."]
          },
          botEligibility: null,
          serviceContext: {
            primary_service: "unknown",
            service_code: "unknown",
            source_domain: null,
            source_table: null,
            source_id: null,
            source_status: null,
            source_priority: null,
            suggested_agent: null,
            signals: []
          },
          options: {
            dryRun: true,
            executeActions: false,
            returnInstructionsForN8n: true,
            debug: false
          }
        }),
        options: {
          dryRun: true,
          executeActions: false,
          debug: false
        },
        requestId: `brain-agent-${Date.now()}`
      },
      fallbackDefinition,
      startedAt,
      normalizedResult.errors[0]?.message ?? "Invalid agent request.",
      normalizedResult.errors
    );
  }

  const request = normalizedResult.value;
  const definition = getBrainAgentDefinition(request.agentName);
  if (!definition) {
    return buildBlockedResponse(request, getBrainAgentDefinition("knowledge"), startedAt, "Agent is not registered.", [error("Agent is not registered.")]);
  }

  if (!definition.enabled || !isBrainAgentRunnable(definition.name)) {
    return buildBlockedResponse(
      request,
      definition,
      startedAt,
      `Agent ${definition.name} is not enabled for runtime execution yet.`,
      [error(`Agent ${definition.name} is not enabled for runtime execution yet.`)],
      ["agent_disabled"]
    );
  }

  const requestedContextPackKeys = Object.entries(request.contextPacks)
    .filter(([, pack]) => Boolean(pack && pack.available))
    .map(([key]) => key as keyof BrainContextPacks);
  const contextPacksUsed = requestedContextPackKeys.filter((key) => definition.allowedContextPacks.includes(key));
  const contextWarnings = requestedContextPackKeys
    .filter((key) => !definition.allowedContextPacks.includes(key))
    .map((key) => `Context pack ${key} is not allowed for agent ${definition.name} and was ignored.`);

  if (request.actionPolicy.decision === "blocked") {
    return buildBlockedResponse(
      request,
      definition,
      startedAt,
      request.actionPolicy.reason,
      [],
      [...contextWarnings, ...request.actionPolicy.blocked_reasons.map((reason) => `Policy blocked: ${reason}`)]
    );
  }

  if (request.agentName === "knowledge" && !request.options.dryRun) {
    return buildBlockedResponse(
      request,
      definition,
      startedAt,
      "Knowledge Agent is only runnable in dry-run mode.",
      [error("Knowledge Agent is only runnable in dry-run mode.")],
      ["dry_run_required"]
    );
  }

  const modelResult = await runBrainModelAdapter({
    agentName: definition.name,
    agentVersion: definition.version,
    inputEvent: request.inputEvent,
    context: request.context,
    contextPacks: request.contextPacks,
    actionPolicy: request.actionPolicy,
    options: request.options,
    allowedTools: definition.allowedTools,
    allowedContextPacks: definition.allowedContextPacks
  });

  const outputValidation = validateBrainAgentOutput(definition, modelResult.output);
  if (!outputValidation.ok) {
    return buildBlockedResponse(
      request,
      definition,
      startedAt,
      "Model adapter returned invalid output.",
      outputValidation.errors,
      [...contextWarnings, ...modelResult.warnings, ...modelResult.safetyFlags]
    );
  }

  const filteredToolRequests = filterToolRequests(definition, outputValidation.value.toolRequests);
  const warnings = [...contextWarnings, ...modelResult.warnings, ...filteredToolRequests.warnings];
  const safetyFlags = Array.from(new Set([...outputValidation.value.safetyFlags, ...modelResult.safetyFlags, ...(warnings.length > 0 ? ["warnings_present"] : [])]));
  const requestId = request.requestId ?? request.context.traceId ?? makeBrainTraceId({ source: request.context.source, messageId: request.context.messageId, waId: request.context.waId });
  const response: BrainAgentRunResponse = {
    ok: true,
    requestId,
    agentName: definition.name,
    agentVersion: definition.version,
    outputSchema: definition.outputSchema,
    decision: outputValidation.value.decision,
    message: outputValidation.value.message,
    toolRequests: filteredToolRequests.filtered,
    confidence: outputValidation.value.confidence,
    safetyFlags,
    draft: modelResult.draft ?? null,
    validationErrors: [],
    warnings,
    contextPacksUsed,
    metadata: {
      version: "brain.agent.runtime.v1",
      generatedAt: new Date().toISOString(),
      processingMs: Date.now() - startedAt,
      dryRun: request.options.dryRun,
      debug: request.options.debug,
      modelName: modelResult.modelName,
      modelVersion: modelResult.modelVersion,
      logStatus: "skipped"
    }
  };

  const logResult = await recordBrainAgentRun(response);
  response.metadata.logStatus = logResult.status;
  if (!logResult.ok) {
    response.warnings = [...response.warnings, logResult.reason];
  }

  return response;
}
