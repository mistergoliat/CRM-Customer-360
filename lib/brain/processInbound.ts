import { buildBrainInstructions } from "./actions/buildInstructions";
import { resolveBrainAction } from "./actions/actionRouter";
import type { BrainActionResolveRequest } from "./actions/types";
import { runAgent } from "./agents/runAgent";
import type { BrainAgentRunResponse } from "./agents/types";
import { resolveBackendBrainContext, resolveBrainContext } from "./context/resolveContext";
import type { BrainBotEligibility, BrainContextResolveResponse } from "./context/types";
import { adaptBrainInboundToContextRequest } from "./context/legacyAdapters";
import { buildFallbackBrainInboundRequest, normalizeBrainInboundRequest } from "./inbound/normalize";
import { evaluateBrainExecution } from "./messaging/responseExecutor";
import { createOutboxPlannedRecord } from "./messaging/outbox";
import type { BrainExecutionSource, BrainExecuteRequest } from "./messaging/types";
import { makeBrainRequestId } from "./instructions";
import type { BrainActionPolicy, BrainNormalizedAction } from "./actions/types";
import { runCustomerOnboardingLoop } from "./commercial/customer-onboarding";
import {
  buildCommercialShadowFeatureFlags,
  buildCommercialLoopFeatureFlags,
  buildCommercialBridgeFeatureFlags,
  buildCommercialCyclePolicyFlags,
  buildCommercialCycleTimeouts,
  buildCommercialSalesAgentDryRun
} from "./commercial/config/commercialCycleConfig";
import { createCommercialShadowFailedSafe } from "./commercial/shadow/createCommercialShadowFailedSafe";
import { runCommercialShadowEvaluation } from "./commercial/shadow/runCommercialShadowEvaluation";
import { evaluateCommercialShadowResult } from "./commercial/evaluation";
import { createPrestashopProductRepository, createSalesConsultativeOperationsRepository, runSalesConsultativeService } from "./commercial/sales-consultative";
import { runCommercialOperationalLoop } from "./commercial/operational-loop";
import { runCommercialExecutionBridge } from "./commercial/execution-bridge";
import { COMMERCIAL_POLICY_VERSION } from "./commercial/policy";
import type { CommercialShadowFeatureFlags, CommercialShadowInput, CommercialShadowResult } from "./commercial/shadow";
import type { CommercialOperationalLoopFeatureFlags, CommercialOperationalLoopInput, CommercialOperationalLoopResult } from "./commercial/operational-loop";
import type { CommercialExecutionBridgeFeatureFlags, CommercialExecutionBridgeResult } from "./commercial/execution-bridge";
import {
  SALES_AGENT_CONTRACT_VERSION,
  SALES_AGENT_PROMPT_VERSION,
  SALES_AGENT_RUNTIME_DEFAULT_MODE
} from "./commercial/sales-agent/runtimeTypes";
import type {
  BrainContextSummary,
  BrainError,
  BrainInboundOutboxPlanResult,
  BrainNormalizedProcessInboundRequest,
  BrainInstructions,
  BrainProcessInboundResponse,
  BrainResolvedContext
} from "./inbound/types";
import { safeQueryRows } from "@/lib/db";

type BrainProcessInboundCommercialShadowDependencies = {
  commercialShadowHook?: (input: CommercialShadowInput) => Promise<CommercialShadowResult>;
  commercialShadowFlags?: Partial<CommercialShadowFeatureFlags>;
};

type BrainProcessInboundCommercialOperationalLoopDependencies = {
  commercialOperationalLoopHook?: (input: CommercialOperationalLoopInput) => Promise<CommercialOperationalLoopResult>;
  commercialOperationalLoopFlags?: Partial<CommercialOperationalLoopFeatureFlags>;
  runAfterSalesConsultative?: boolean;
};

type BrainProcessInboundCommercialExecutionBridgeDependencies = {
  commercialExecutionBridgeHook?: typeof runCommercialExecutionBridge;
  commercialExecutionBridgeFlags?: Partial<CommercialExecutionBridgeFeatureFlags>;
};

export type BrainProcessInboundDependencies = {
  resolveBackendBrainContext?: typeof resolveBackendBrainContext;
  resolveBrainAction?: typeof resolveBrainAction;
  commercialShadow?: BrainProcessInboundCommercialShadowDependencies;
  commercialOperationalLoop?: BrainProcessInboundCommercialOperationalLoopDependencies;
  commercialExecutionBridge?: BrainProcessInboundCommercialExecutionBridgeDependencies;
  abortSignal?: AbortSignal | null;
};

function mergeUniqueStrings(...groups: Array<string[] | undefined>): string[] {
  const values = new Set<string>();
  for (const group of groups) {
    for (const value of group ?? []) {
      if (typeof value === "string" && value.trim()) values.add(value);
    }
  }
  return [...values];
}

type BrainErrorLike = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

function mergeBrainErrors(...groups: Array<Array<BrainErrorLike> | undefined>): BrainError[] {
  const values = new Map<string, BrainError>();
  for (const group of groups) {
    for (const error of group ?? []) {
      const key = `${error.code}:${error.message}`;
      if (!values.has(key)) {
        values.set(key, {
          code: error.code as BrainError["code"],
          message: error.message,
          retryable: error.retryable,
          details: error.details
        });
      }
    }
  }
  return [...values.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asLooseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

function getProcessInboundPersistOutboxPlanRequested(input: unknown): boolean {
  if (!isRecord(input)) return false;
  const options = isRecord(input.options) ? input.options : null;
  return asLooseBoolean(options?.persistOutboxPlan);
}

function getProcessInboundOutboxPlanEnabled(): boolean {
  return process.env.BRAIN_PROCESS_INBOUND_ALLOW_OUTBOX_PLAN === "true";
}

function canAutoReplyForInboundOutboxPlan(actionPolicy: BrainActionPolicy): boolean {
  const policy = actionPolicy as BrainActionPolicy & { allowedToAutoReply?: boolean };
  return Boolean(policy.allowedToAutoReply ?? actionPolicy.can_auto_reply);
}

function mapInboundSourceToExecutionSource(source: BrainNormalizedProcessInboundRequest["source"]): BrainExecutionSource {
  if (source === "n8n_meta_webhook") return "n8n";
  if (source === "hub_preview") return "operator";
  if (source === "manual_test") return "operator";
  return "brain";
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldRunSalesConsultativeFlow(request: BrainNormalizedProcessInboundRequest, contextResponse: BrainContextResolveResponse) {
  const text = normalizeText(request.messageText);
  const salesKeywords = [
    "producto",
    "catalogo",
    "catálogo",
    "precio",
    "stock",
    "disponible",
    "comprar",
    "cotizar",
    "cotizacion",
    "cotización",
    "recomienda",
    "recomendacion",
    "recomendación",
    "alternativa",
    "presupuesto",
    "espacio",
    "medidas",
    "dimensiones",
    "compatibilidad",
    "envio",
    "envío",
    "despacho",
    "checkout",
    "pago",
    "garantia",
    "garantía",
    "objecion",
    "objeción",
    "comparar",
    "seguimiento",
    "urgente",
    "negocio",
    "empresa",
    "gimnasio",
    "box"
  ];

  if (salesKeywords.some((keyword) => text.includes(keyword))) return true;
  if (contextResponse.service_context.primary_service === "sales") return true;
  return false;
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseNumberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseIdValue(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && String(parsed) === trimmed ? parsed : trimmed;
  }
  return null;
}

async function loadConsultativeOpportunity(request: BrainNormalizedProcessInboundRequest, contextResponse: BrainContextResolveResponse) {
  const waId = request.waId ?? contextResponse.customer_context.wa_id ?? null;
  const conversationCaseId = request.conversationCaseId ?? contextResponse.case_context.active_case?.conversation_case_id ?? null;
  const customerMasterId = request.customerRef?.idCustomer ?? contextResponse.customer_context.id_customer ?? null;
  const leadId = request.customerRef?.idOrder ?? null;

  const queries: Array<{ sql: string; params: unknown[] }> = [];
  if (waId) {
    queries.push({
      sql: "SELECT * FROM crm_opportunities WHERE wa_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1",
      params: [waId]
    });
  }
  if (conversationCaseId) {
    queries.push({
      sql: "SELECT * FROM crm_opportunities WHERE conversation_case_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1",
      params: [conversationCaseId]
    });
  }
  if (customerMasterId) {
    queries.push({
      sql: "SELECT * FROM crm_opportunities WHERE customer_master_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1",
      params: [customerMasterId]
    });
  }
  if (leadId) {
    queries.push({
      sql: "SELECT * FROM crm_opportunities WHERE lead_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1",
      params: [leadId]
    });
  }

  for (const query of queries) {
    const result = await safeQueryRows<Record<string, unknown>>(query.sql, query.params);
    if (!result.ok || result.rows.length === 0) continue;
    const row = result.rows[0];
    return {
      id: parseIdValue(row.id),
      opportunityKey: String(row.opportunity_key ?? ""),
      status: String(row.status ?? "new"),
      stage: row.stage ? String(row.stage) : null,
      primaryIntent: String(row.primary_intent ?? "product_recommendation"),
      currentSummary: row.current_summary ? String(row.current_summary) : null,
      nextActionType: row.next_action_type ? String(row.next_action_type) : null,
      nextActionDueAt: row.next_action_due_at ? String(row.next_action_due_at) : null,
      waitingFor: row.waiting_for ? String(row.waiting_for) : null,
      humanOwnerActive: Boolean(row.human_owner_active),
      aiBlocked: Boolean(row.ai_blocked),
      customerCandidateId: parseIdValue(row.customer_candidate_id),
      customerMasterId: parseIdValue(row.customer_master_id),
      leadId: parseIdValue(row.lead_id),
      conversationCaseId: parseIdValue(row.conversation_case_id),
      waId: row.wa_id ? String(row.wa_id) : null,
      requirements: parseJsonArray(row.requirements_json),
      missingRequirements: parseJsonArray(row.missing_requirements_json),
      productInterests: parseJsonArray(row.product_interests_json),
      objections: parseJsonArray(row.objections_json) as never[],
      signals: parseJsonArray(row.signals_json)
        .map((item) => (typeof item === "string" ? item : null))
        .filter((item): item is string => Boolean(item)),
      version: Number(row.version ?? 1),
      lastActivityAt: String(row.last_activity_at ?? row.updated_at ?? new Date().toISOString()),
      closedAt: row.closed_at ? String(row.closed_at) : null
    };
  }

  return null;
}

async function loadExistingSalesNeedProfile(request: BrainNormalizedProcessInboundRequest, contextResponse: BrainContextResolveResponse, opportunityKey: string | null) {
  const waId = request.waId ?? contextResponse.customer_context.wa_id ?? null;
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  if (opportunityKey) {
    queries.push({
      sql: "SELECT * FROM crm_sales_need_profiles WHERE opportunity_key = ? ORDER BY updated_at DESC, id DESC LIMIT 1",
      params: [opportunityKey]
    });
  }
  if (waId) {
    queries.push({
      sql: "SELECT * FROM crm_sales_need_profiles WHERE wa_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1",
      params: [waId]
    });
  }

  for (const query of queries) {
    const result = await safeQueryRows<Record<string, unknown>>(query.sql, query.params);
    if (!result.ok || result.rows.length === 0) continue;
    const row = result.rows[0];
    return {
      useCase: row.use_case ? String(row.use_case) : null,
      customerType: row.customer_type ? String(row.customer_type) : null,
      goals: parseJsonArray(row.goals_json)
        .map((item) => (typeof item === "string" ? item : null))
        .filter((item): item is string => Boolean(item)),
      requiredFeatures: parseJsonArray(row.required_features_json)
        .map((item) => (typeof item === "string" ? item : null))
        .filter((item): item is string => Boolean(item)),
      preferredFeatures: parseJsonArray(row.preferred_features_json)
        .map((item) => (typeof item === "string" ? item : null))
        .filter((item): item is string => Boolean(item)),
      budgetMin: parseNumberOrNull(row.budget_min),
      budgetMax: parseNumberOrNull(row.budget_max),
      availableSpace: (() => {
        const value = parseJsonObject(row.available_space_json);
        if (!value) return null;
        return {
          width: parseNumberOrNull(value.width),
          height: parseNumberOrNull(value.height),
          length: parseNumberOrNull(value.length),
          unit: typeof value.unit === "string" ? value.unit : null
        };
      })(),
      location: (() => {
        const value = parseJsonObject(row.location_json);
        if (!value) return null;
        return {
          country: typeof value.country === "string" ? value.country : null,
          region: typeof value.region === "string" ? value.region : null,
          city: typeof value.city === "string" ? value.city : null,
          address: typeof value.address === "string" ? value.address : null
        };
      })(),
      deliveryDeadline: row.delivery_deadline ? String(row.delivery_deadline) : null,
      experienceLevel: row.experience_level ? String(row.experience_level) : null,
      purchaseUrgency: row.purchase_urgency ? String(row.purchase_urgency) : null,
      decisionReadiness: row.decision_readiness ? String(row.decision_readiness) : null,
      missingInformation: parseJsonArray(row.missing_information_json)
        .map((item) => (typeof item === "string" ? item : null))
        .filter((item): item is string => Boolean(item)),
      lastUpdatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString())
    };
  }

  return null;
}

function buildSkippedOutboxPlanResult(status: "skipped_by_flag" | "skipped_by_policy", reason: string): BrainInboundOutboxPlanResult {
  return {
    status,
    existing: false,
    outbox_id: null,
    dedupe_key: null,
    reason
  };
}

function buildWarningOutboxPlanResult(reason: string, warning: string): BrainInboundOutboxPlanResult {
  return {
    status: "warning",
    existing: false,
    outbox_id: null,
    dedupe_key: null,
    reason,
    warning
  };
}

function buildPersistedOutboxPlanResult(
  persistResult: Awaited<ReturnType<typeof createOutboxPlannedRecord>>
): BrainInboundOutboxPlanResult {
  if (persistResult.ok) {
    return {
      status: persistResult.existing ? "existing" : "planned",
      existing: persistResult.existing,
      outbox_id: persistResult.row.id ?? null,
      dedupe_key: persistResult.row.dedupe_key,
      reason: persistResult.existing ? null : persistResult.warning ?? null,
      warning: persistResult.existing ? null : persistResult.warning ?? null
    };
  }

  return buildWarningOutboxPlanResult("outbox_plan_persist_failed", persistResult.warning);
}

function buildFallbackPolicy(requestId: string, reason: string, blockedReasons: string[]): BrainActionPolicy {
  return {
    policyId: `brain-action-policy-${requestId}`,
    decision: "blocked",
    reason,
    blocked_reasons: blockedReasons,
    can_auto_reply: false,
    can_human_handoff: false,
    can_case_mutation: false,
    continue_legacy_flow: false,
    should_reply: false,
    requires_human: true,
    confidence: 0,
    signals: [],
    suggested_next_step: "blocked_by_bot_eligibility"
  };
}

function buildFallbackNormalizedAction(reason: string, blockedReasons: string[]): BrainNormalizedAction {
  return {
    action: "blocked",
    final_action: "blocked",
    should_reply: false,
    should_continue_legacy_flow: false,
    requires_human: true,
    blocked: true,
    allow_auto_reply: false,
    allow_human_handoff: false,
    allow_case_mutation: false,
    reason,
    blocked_reasons: blockedReasons,
    signals: []
  };
}

function buildContextSummary(
  requestId: string,
  request: BrainNormalizedProcessInboundRequest,
  contextResponse: BrainContextResolveResponse | null
): BrainContextSummary {
  const resolverIdentity = contextResponse?.resolver_identity;
  const caseContext = contextResponse?.case_context;
  const conversationContext = contextResponse?.conversation_context;
  const serviceContext = contextResponse?.service_context;
  const botEligibility = contextResponse?.bot_eligibility;
  const contextPacks = contextResponse?.context_packs;

  return {
    requestId,
    partialContext: contextResponse ? contextResponse.partial_context : true,
    waId: request.waId,
    phoneNumberId: request.phoneNumberId,
    messageId: request.messageId,
    conversationCaseId: request.conversationCaseId,
    identityType: resolverIdentity?.identity_type ?? "unknown",
    identityConfidence: resolverIdentity?.confidence ?? 0,
    activeCaseId: caseContext?.active_case?.conversation_case_id ?? null,
    activeCaseStatus: caseContext?.active_case?.status ?? null,
    caseCount: caseContext?.case_count ?? 0,
    messageCount: conversationContext?.message_count ?? 0,
    primaryService: serviceContext?.primary_service ?? "unknown",
    serviceCode: serviceContext?.service_code ?? "unknown",
    botEligible: Boolean(botEligibility?.eligible),
    botRecommendedMode: botEligibility?.recommended_mode ?? "review",
    botReason: botEligibility?.reason ?? "Context unavailable.",
    contextPacksAvailable: contextPacks
      ? Object.entries(contextPacks)
          .filter(([, pack]) => Boolean(pack.available))
          .map(([key]) => key)
      : [],
    warnings: mergeUniqueStrings(contextResponse?.warnings)
  };
}

function buildFailedContextSummary(request: BrainNormalizedProcessInboundRequest, requestId: string, warnings: string[]): BrainContextSummary {
  return {
    requestId,
    partialContext: true,
    waId: request.waId,
    phoneNumberId: request.phoneNumberId,
    messageId: request.messageId,
    conversationCaseId: request.conversationCaseId,
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
    botReason: warnings[0] ?? "Inbound validation failed.",
    contextPacksAvailable: [],
    warnings
  };
}

function buildBrainContextDebugPayload(
  request: BrainNormalizedProcessInboundRequest,
  contextResponse: BrainContextResolveResponse | null,
  context: BrainResolvedContext
) {
  return {
    input: {
      channel: request.channel,
      source: request.source,
      waId: request.waId,
      phoneNumberId: request.phoneNumberId,
      messageId: request.messageId,
      messageText: request.messageText,
      conversationCaseId: request.conversationCaseId ?? null,
      options: request.options
    },
    context,
    resolver: contextResponse
  };
}

function toExecutionActionPolicy(actionPolicy: BrainActionPolicy) {
  return {
    allowedToAutoReply: actionPolicy.can_auto_reply,
    can_auto_reply: actionPolicy.can_auto_reply,
    requiresHuman: actionPolicy.requires_human,
    requires_human: actionPolicy.requires_human,
    blockedReasons: actionPolicy.blocked_reasons,
    blocked_reasons: actionPolicy.blocked_reasons,
    canAutoReply: actionPolicy.can_auto_reply,
    canHumanHandoff: actionPolicy.can_human_handoff,
    canCaseMutation: actionPolicy.can_case_mutation,
    continueLegacyFlow: actionPolicy.continue_legacy_flow,
    reason: actionPolicy.reason
  };
}

function toExecutionBotEligibility(botEligibility: BrainBotEligibility | null, contextSummary: BrainContextSummary) {
  if (!botEligibility) return undefined;
  const signals = botEligibility.signals;
  return {
    canAutoReply: botEligibility.can_auto_reply,
    can_auto_reply: botEligibility.can_auto_reply,
    requiresHuman: botEligibility.recommended_mode === "human",
    requires_human: botEligibility.recommended_mode === "human",
    blockedReasons: botEligibility.blockers,
    blocked_reasons: botEligibility.blockers,
    suppressionActive: signals.suppression_active,
    suppression_active: signals.suppression_active,
    recentManualReply: signals.recent_manual_reply,
    recent_manual_reply: signals.recent_manual_reply,
    activeHumanLock: signals.manual_operator_lock,
    active_human_lock: signals.manual_operator_lock,
    manualOperatorLock: signals.manual_operator_lock,
    manual_operator_lock: signals.manual_operator_lock,
    activeHumanCase: signals.active_human_case,
    active_human_case: signals.active_human_case,
    openCaseWaitingHuman: signals.open_case_waiting_human,
    open_case_waiting_human: signals.open_case_waiting_human,
    activeCaseId: contextSummary.activeCaseId
  };
}

function shouldBuildExecutionPlan(
  request: BrainNormalizedProcessInboundRequest,
  actionResponse: Awaited<ReturnType<typeof resolveBrainAction>>,
  agentDraft: BrainAgentRunResponse["draft"] | null,
  contextResponse: BrainContextResolveResponse,
  contextSummary: BrainContextSummary
) {
  if (!request.options.buildExecutionPlanDryRun) return false;
  if (request.options.executeActions) return false;
  if (request.options.dryRun !== true) return false;
  if (!agentDraft || agentDraft.decision !== "answer") return false;
  if (!actionResponse.action_policy.can_auto_reply) return false;
  if (contextResponse.bot_eligibility && !contextResponse.bot_eligibility.can_auto_reply) return false;
  if (contextSummary.warnings.some((warning) => warning.toLowerCase().includes("invalid"))) return false;
  return true;
}

function buildExecutionPlanPreview(
  request: BrainNormalizedProcessInboundRequest,
  actionResponse: Awaited<ReturnType<typeof resolveBrainAction>>,
  agentDraft: NonNullable<BrainAgentRunResponse["draft"]>,
  contextSummary: BrainContextSummary,
  contextResponse: BrainContextResolveResponse
) {
  const executionRequest: BrainExecuteRequest = {
    source: "brain",
    dryRun: true,
    executeActions: false,
    action: {
      type: "send_whatsapp_message",
      source: "brain",
      payload: {
        waId: request.waId,
        phoneNumberId: request.phoneNumberId,
        messageText: agentDraft.message
      }
    },
    actionPolicy: toExecutionActionPolicy(actionResponse.action_policy),
    botEligibility: toExecutionBotEligibility(contextResponse.bot_eligibility, contextSummary),
    context: {
      waId: request.waId,
      phoneNumberId: request.phoneNumberId,
      messageId: request.messageId,
      conversationCaseId: request.conversationCaseId,
      messageText: agentDraft.message,
      sourceWorkflow: request.sourceWorkflow,
      sourceNode: request.sourceNode
    },
    metadata: {
      requestId: contextSummary.requestId
    }
  };

  return evaluateBrainExecution(executionRequest);
}

function buildFailClosedResponse(
  request: BrainNormalizedProcessInboundRequest,
  normalized: BrainNormalizedProcessInboundRequest | null,
  startedAt: number,
  errors: BrainError[],
  reason: string,
  blockedReasons: string[]
): BrainProcessInboundResponse {
  const requestId = makeBrainRequestId(request);
  const context = resolveBrainContext(request);
  const contextSummary = buildFailedContextSummary(request, requestId, errors.map((error) => error.message));
  const actionPolicy = buildFallbackPolicy(requestId, reason, blockedReasons);
  const normalizedAction = buildFallbackNormalizedAction(reason, blockedReasons);
  const instructions = buildBrainInstructions(
    request,
    context,
    { valid: false, failClosedReason: reason },
    {
      contextSummary,
      botEligibility: null,
      contextPacksAvailable: [],
      suggestedNextStep: actionPolicy.suggested_next_step,
      actionPolicy,
      normalizedAction,
      blockedReasons
    }
  );

  return {
    ok: false,
    requestId,
    channel: request.channel,
    source: request.source,
    normalized,
    context,
    context_summary: contextSummary,
    bot_eligibility: null,
    context_packs_available: [],
    suggested_next_step: actionPolicy.suggested_next_step,
    action_policy: actionPolicy,
    normalized_action: normalizedAction,
    blocked_reasons: blockedReasons,
    context_debug: undefined,
    agent_draft: null,
    execution_plan: null,
    instructions,
    warnings: errors.map((error) => error.message),
    errors,
    adapters: {
      aiOrchestrator: {
        status: "skipped",
        decisionId: null,
        reason
      },
      commercialOperationalLoop: null
    },
    metadata: {
      version: "brain.process-inbound.v2",
      generatedAt: new Date().toISOString(),
      processingMs: Date.now() - startedAt,
      dryRun: request.options.dryRun,
      executeActions: false,
      returnInstructionsForN8n: request.options.returnInstructionsForN8n,
      debug: request.options.debug
    }
  };
}

function buildActionRequest(
  request: BrainNormalizedProcessInboundRequest,
  requestId: string,
  contextSummary: BrainContextSummary,
  contextResponse: BrainContextResolveResponse
): BrainActionResolveRequest {
  return {
    requestId,
    source: request.source,
    waId: request.waId,
    phoneNumberId: request.phoneNumberId,
    messageId: request.messageId,
    messageText: request.messageText,
    conversationCaseId: request.conversationCaseId,
    contextSummary,
    botEligibility: contextResponse.bot_eligibility,
    serviceContext: contextResponse.service_context,
    options: {
      dryRun: request.options.dryRun,
      executeActions: false,
      returnInstructionsForN8n: request.options.returnInstructionsForN8n,
      debug: request.options.debug
    }
  };
}

function buildAgentRequest(
  request: BrainNormalizedProcessInboundRequest,
  requestId: string,
  contextResponse: BrainContextResolveResponse,
  actionResponse: Awaited<ReturnType<typeof resolveBrainAction>>
) {
  return {
    agentName: "knowledge" as const,
    requestId,
    inputEvent: {
      channel: request.channel,
      source: request.source,
      wa_id: request.waId,
      phone_number_id: request.phoneNumberId,
      message_id: request.messageId,
      message_text: request.messageText,
      conversation_case_id: request.conversationCaseId,
      id_order: request.customerRef?.idOrder ?? request.conversationCaseId,
      id_customer: request.customerRef?.idCustomer,
      invoice_number: request.customerRef?.invoiceNumber,
      source_workflow: request.sourceWorkflow,
      source_node: request.sourceNode,
      received_at: request.receivedAt,
      dry_run: true
    },
    context: {
      status: "noop" as const,
      source: request.source,
      contextMode: request.contextMode,
      traceId: requestId,
      waId: request.waId,
      phoneNumberId: request.phoneNumberId,
      messageId: request.messageId,
      conversationCaseId: request.conversationCaseId,
      customerRef: request.customerRef,
      sourceWorkflow: request.sourceWorkflow,
      sourceNode: request.sourceNode,
      confidence: contextResponse.resolver_identity.confidence,
      notes: contextResponse.resolver_identity.notes,
      warnings: contextResponse.warnings
    },
    contextPacks: contextResponse.context_packs,
    actionPolicy: actionResponse.action_policy,
    options: {
      dryRun: true,
      executeActions: false,
      debug: request.options.debug
    }
  };
}

function shouldRunKnowledgeAgent(
  request: BrainNormalizedProcessInboundRequest,
  actionResponse: Awaited<ReturnType<typeof resolveBrainAction>>,
  contextResponse: BrainContextResolveResponse
): boolean {
  if (!request.options.dryRun) return false;
  if (request.options.executeActions) return false;
  if (!request.options.runAgentDryRun) return false;
  if (request.options.preferredAgent && request.options.preferredAgent !== "knowledge") return false;

  const normalizedAction = actionResponse.normalized_action.action;
  if (normalizedAction === "blocked" || normalizedAction === "no_action") return false;

  const suggestedNextStep = actionResponse.action_policy.suggested_next_step;
  const serviceContext = contextResponse.service_context;
  const botEligibility = contextResponse.bot_eligibility;
  const criticalBlockers = new Set([
    "manual_operator_lock",
    "active_human_case",
    "suppression_active",
    "recent_manual_reply",
    "open_case_waiting_human"
  ]);
  const hasCriticalBlocker =
    Boolean(botEligibility) &&
    botEligibility !== null &&
    (botEligibility.recommended_mode === "human" ||
      botEligibility.blockers.some((blocker) => criticalBlockers.has(blocker)) ||
      botEligibility.signals.manual_operator_lock ||
      botEligibility.signals.active_human_case ||
      botEligibility.signals.suppression_active ||
      botEligibility.signals.recent_manual_reply ||
      botEligibility.signals.open_case_waiting_human);

  if (hasCriticalBlocker) return false;
  if (suggestedNextStep === "context_only") return true;
  if (serviceContext.primary_service === "knowledge") return true;
  return request.options.preferredAgent === "knowledge";
}

async function maybePersistInboundOutboxPlan(
  request: BrainNormalizedProcessInboundRequest,
  actionResponse: Awaited<ReturnType<typeof resolveBrainAction>>,
  agentDraft: BrainAgentRunResponse["draft"] | null,
  contextResponse: BrainContextResolveResponse,
  persistOutboxPlanRequested: boolean
): Promise<{ result: BrainInboundOutboxPlanResult; warnings: string[] }> {
  if (!getProcessInboundOutboxPlanEnabled()) {
    return { result: buildSkippedOutboxPlanResult("skipped_by_flag", "BRAIN_PROCESS_INBOUND_ALLOW_OUTBOX_PLAN=false"), warnings: [] };
  }
  if (!request.options.dryRun) {
    return { result: buildSkippedOutboxPlanResult("skipped_by_policy", "dryRun=true is required."), warnings: [] };
  }
  if (request.options.executeActions) {
    return { result: buildSkippedOutboxPlanResult("skipped_by_policy", "executeActions=false is required."), warnings: [] };
  }
  if (!request.options.runAgentDryRun) {
    return { result: buildSkippedOutboxPlanResult("skipped_by_policy", "runAgentDryRun=true is required."), warnings: [] };
  }
  if (!persistOutboxPlanRequested) {
    return { result: buildSkippedOutboxPlanResult("skipped_by_policy", "persistOutboxPlan=true is required."), warnings: [] };
  }
  if (!agentDraft) {
    return { result: buildSkippedOutboxPlanResult("skipped_by_policy", "agent_draft is required."), warnings: [] };
  }
  if (agentDraft.decision !== "answer") {
    return { result: buildSkippedOutboxPlanResult("skipped_by_policy", "agent_draft.decision must be answer."), warnings: [] };
  }
  if (!agentDraft.message || !agentDraft.message.trim()) {
    return { result: buildSkippedOutboxPlanResult("skipped_by_policy", "agent_draft.message is required."), warnings: [] };
  }
  if (!canAutoReplyForInboundOutboxPlan(actionResponse.action_policy)) {
    return { result: buildSkippedOutboxPlanResult("skipped_by_policy", "action_policy.allowedToAutoReply=false"), warnings: [] };
  }
  if (!contextResponse.bot_eligibility?.can_auto_reply) {
    return { result: buildSkippedOutboxPlanResult("skipped_by_policy", "bot_eligibility.canAutoReply=false"), warnings: [] };
  }

  const normalizedAction = actionResponse.normalized_action.action;
  if (normalizedAction === "blocked" || normalizedAction === "no_action" || normalizedAction === "needs_human_review") {
    return {
      result: buildSkippedOutboxPlanResult("skipped_by_policy", `normalized_action=${normalizedAction} is not eligible.`),
      warnings: []
    };
  }

  const persistResult = await createOutboxPlannedRecord({
    dedupeKeyInput: {
      source: mapInboundSourceToExecutionSource(request.source),
      actionType: "send_whatsapp_message",
      channel: "whatsapp",
      waId: request.waId,
      phoneNumberId: request.phoneNumberId,
      conversationCaseId: request.conversationCaseId,
      messageText: agentDraft.message,
      sourceRequestId: request.messageId
    },
    status: "planned",
    source: request.source,
    sourceRequestId: request.messageId,
    sourceAgentName: agentDraft.agentName,
    sourceAgentVersion: agentDraft.agentVersion,
    waId: request.waId,
    phoneNumberId: request.phoneNumberId,
    conversationCaseId: request.conversationCaseId ?? null,
    messageText: agentDraft.message,
    metaPayloadJson: {
      model_version: "brain.process-inbound.outbox-plan.v1",
      source: request.source,
      requestId: request.messageId,
      channel: request.channel,
      waId: request.waId,
      phoneNumberId: request.phoneNumberId,
      conversationCaseId: request.conversationCaseId ?? null,
      messageText: agentDraft.message,
      agentDecision: agentDraft.decision,
      actionPolicyAllowedToAutoReply: canAutoReplyForInboundOutboxPlan(actionResponse.action_policy),
      botEligibilityCanAutoReply: contextResponse.bot_eligibility?.can_auto_reply ?? null,
      normalizedAction
    }
  });

  const result = buildPersistedOutboxPlanResult(persistResult);
  const warnings = result.warning ? [result.warning] : [];
  return { result, warnings };
}

function buildValidResponse(
  request: BrainNormalizedProcessInboundRequest,
  startedAt: number,
  contextResponse: BrainContextResolveResponse,
  actionResponse: Awaited<ReturnType<typeof resolveBrainAction>>,
  agentDraft: BrainAgentRunResponse["draft"] | null,
  executionPlan: BrainProcessInboundResponse["execution_plan"],
  outboxPlanResult: BrainInboundOutboxPlanResult | null,
  outboxPlanWarnings: string[] = [],
  commercialShadowResult: CommercialShadowResult | null = null,
  commercialOperationalLoopResult: CommercialOperationalLoopResult | null = null,
  commercialExecutionBridgeResult: CommercialExecutionBridgeResult | null = null,
  customerOnboardingResult: Awaited<ReturnType<typeof runCustomerOnboardingLoop>> | null = null,
  salesConsultativeResult: Awaited<ReturnType<typeof runSalesConsultativeService>>["result"] | null = null
): BrainProcessInboundResponse {
  const requestId = makeBrainRequestId(request);
  const context = resolveBrainContext(request);
  const contextSummary = buildContextSummary(requestId, request, contextResponse);
  const safeActionPolicy = {
    ...actionResponse.action_policy,
    continue_legacy_flow: true
  };
  const safeNormalizedAction = {
    ...actionResponse.normalized_action,
    should_continue_legacy_flow: true
  };
  const safeInstructions = {
    ...actionResponse.instructions,
    continueLegacyFlow: true,
    actionPolicy: safeActionPolicy,
    normalizedAction: safeNormalizedAction,
    steps: actionResponse.instructions.steps as BrainInstructions["steps"]
  } satisfies BrainInstructions;
  const warnings = mergeUniqueStrings(
    contextSummary.warnings,
    contextResponse.warnings,
    actionResponse.warnings,
    outboxPlanWarnings,
    commercialOperationalLoopResult?.warnings ?? [],
    commercialExecutionBridgeResult?.warnings ?? [],
    request.options.debug ? [] : ["Full context payload is hidden unless debug=true."]
  );
  const errors = mergeBrainErrors(contextResponse.errors, actionResponse.errors);

  return {
    ok: true,
    requestId,
    channel: request.channel,
    source: request.source,
    normalized: request,
    context,
    context_summary: contextSummary,
    bot_eligibility: contextResponse.bot_eligibility,
    context_packs_available: contextSummary.contextPacksAvailable,
    suggested_next_step: actionResponse.action_policy.suggested_next_step,
    action_policy: safeActionPolicy,
    normalized_action: safeNormalizedAction,
    blocked_reasons: actionResponse.blocked_reasons,
    context_debug: request.options.debug ? buildBrainContextDebugPayload(request, contextResponse, context) : undefined,
    agent_draft: agentDraft,
    execution_plan: executionPlan,
    outbox_plan_result: outboxPlanResult,
    instructions: safeInstructions,
    warnings,
    errors,
    adapters: {
      aiOrchestrator: {
        status: "deferred",
        decisionId: actionResponse.request_id,
        reason: "AI orchestrator remains deferred while the backend response policy and action router stay read-only."
      },
      commercialShadow: commercialShadowResult,
      commercialOperationalLoop: commercialOperationalLoopResult,
      commercialExecutionBridge: commercialExecutionBridgeResult,
      customerOnboarding: customerOnboardingResult,
      salesConsultative: salesConsultativeResult
    },
    metadata: {
      version: "brain.process-inbound.v2",
      generatedAt: new Date().toISOString(),
      processingMs: Date.now() - startedAt,
      dryRun: request.options.dryRun,
      executeActions: false,
      returnInstructionsForN8n: request.options.returnInstructionsForN8n,
      debug: request.options.debug
    }
  };
}

function readEnvFlag(name: string, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function buildCommercialShadowFlags(input: BrainProcessInboundCommercialShadowDependencies | undefined): CommercialShadowFeatureFlags {
  return buildCommercialShadowFeatureFlags(input?.commercialShadowFlags);
}

function buildCommercialOperationalLoopFlags(
  input: BrainProcessInboundCommercialOperationalLoopDependencies | undefined
): CommercialOperationalLoopFeatureFlags {
  return buildCommercialLoopFeatureFlags(input?.commercialOperationalLoopFlags);
}

function shouldRunCommercialAutonomyAfterConsultative(input: BrainProcessInboundCommercialOperationalLoopDependencies | undefined) {
  return input?.runAfterSalesConsultative ?? readEnvFlag("BRAIN_COMMERCIAL_AUTONOMY_AFTER_CONSULTATIVE_ENABLED", false);
}

function parseEnvCsv(name: string, fallback: string[] = []) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildCommercialExecutionBridgeFlags(
  input: BrainProcessInboundCommercialExecutionBridgeDependencies | undefined
): CommercialExecutionBridgeFeatureFlags {
  return buildCommercialBridgeFeatureFlags(input?.commercialExecutionBridgeFlags);
}

function buildCommercialOperationalLoopInput(
  request: BrainNormalizedProcessInboundRequest,
  contextResponse: BrainContextResolveResponse,
  commercialShadowResult: CommercialShadowResult | null,
  startedAt: number,
  correlationId: string,
  featureFlags: CommercialOperationalLoopFeatureFlags
): CommercialOperationalLoopInput | null {
  if (!commercialShadowResult) return null;

  const commercialEvaluationResult = evaluateCommercialShadowResult({
    sampleId: correlationId,
    timestamp: new Date(startedAt).toISOString(),
    scenario: "process_inbound_operational_loop",
    expectedTags: [],
    shadowResult: commercialShadowResult,
    metadata: request.metadata ?? {},
    currentTime: new Date(startedAt).toISOString()
  });

  return {
    inboundMessage: request,
    brainContext: contextResponse,
    commercialContext: commercialShadowResult.context?.commercialContext ?? null,
    salesAgentResult: commercialShadowResult.context?.runtimeResult?.result ?? null,
    commercialPolicyResult: commercialShadowResult.context?.policyResult ?? null,
    commercialEvaluationResult,
    commercialShadowResult,
    currentTime: new Date(startedAt).toISOString(),
    correlationId: request.messageId,
    processInboundRunId: request.messageId,
    salesAgentRunId: commercialShadowResult.context?.runtimeResult?.result?.runId ?? null,
    featureFlags,
    mode: "shadow",
    contractVersion: commercialShadowResult.versions.contractVersion ?? null,
    policyVersion: commercialShadowResult.versions.policyVersion ?? null,
    runtimeVersion: commercialShadowResult.versions.runtimeVersion ?? null,
    promptVersion: commercialShadowResult.versions.promptVersion ?? null,
    evaluationVersion: commercialEvaluationResult.versionInfo.evaluationVersion,
    metadata: {
      requestId: correlationId,
      correlationId,
      shadowStatus: commercialShadowResult.status
    }
  };
}

function buildCustomerOnboardingDraft(responseText: string, customerOnboardingResult: Awaited<ReturnType<typeof runCustomerOnboardingLoop>>) {
  return {
    outputSchema: "brain.agent.knowledge.output.v1",
    agentName: "knowledge",
    agentVersion: "brain.agent.customer-onboarding.v1",
    decision: "answer" as const,
    answer_type: "generic" as const,
    message: responseText,
    confidence: customerOnboardingResult.decision.confidence,
    sources_used: ["customer_onboarding"],
    safety_flags: ["customer_onboarding", ...(customerOnboardingResult.warnings.length > 0 ? ["warnings_present"] : [])],
    tool_requests: [],
    warnings: customerOnboardingResult.warnings
  };
}

function buildCommercialShadowInput(
  request: BrainNormalizedProcessInboundRequest,
  contextResponse: BrainContextResolveResponse,
  startedAt: number,
  flags: CommercialShadowFeatureFlags,
  abortSignal: AbortSignal | null = null
): CommercialShadowInput {
  const salesAgentDryRun = buildCommercialSalesAgentDryRun();
  const salesAgentMode = salesAgentDryRun ? "dry_run" : SALES_AGENT_RUNTIME_DEFAULT_MODE;
  const { shadowTimeoutMs, contextTimeoutMs, runtimeTimeoutMs, policyTimeoutMs } = buildCommercialCycleTimeouts();

  return {
    inboundMessage: request,
    brainContext: contextResponse,
    correlationId: makeBrainRequestId(request),
    executionId: null,
    currentTime: new Date(startedAt).toISOString(),
    timezone: "UTC",
    requestedMode: request.contextMode,
    options: {
      timeoutMs: shadowTimeoutMs,
      contextTimeoutMs,
      runtimeTimeoutMs,
      policyTimeoutMs
    },
    policyContext: undefined,
    provider: null,
    runtimeOptions: {
      enabled: true,
      mode: salesAgentMode,
      timeoutMs: runtimeTimeoutMs,
      maxInputCharacters: 20000,
      maxOutputCharacters: 12000,
      strictValidation: true,
      allowedCapabilities: [],
      captureRawOutput: false,
      includePromptPreview: false,
      dryRun: salesAgentDryRun,
      abortSignal
    },
    policyFlags: buildCommercialCyclePolicyFlags(true),
    shadowFlags: flags,
    contractVersion: SALES_AGENT_CONTRACT_VERSION,
    promptVersion: SALES_AGENT_PROMPT_VERSION,
    policyVersion: COMMERCIAL_POLICY_VERSION,
    allowedCapabilities: [],
    metadata: request.metadata,
    abortSignal
  };
}

function sanitizeCommercialShadowErrorMessage(message: string) {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]+)\b/gi, "[redacted]")
    .replace(/\b(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
    .trim();
}

export async function processInbound(input: unknown, startedAt = Date.now(), dependencies: BrainProcessInboundDependencies = {}): Promise<BrainProcessInboundResponse> {
  const normalizedResult = normalizeBrainInboundRequest(input);
  if (!normalizedResult.ok) {
    const fallbackRequest = buildFallbackBrainInboundRequest(input);
    return buildFailClosedResponse(
      fallbackRequest,
      null,
      startedAt,
      normalizedResult.errors,
      normalizedResult.errors[0]?.message ?? "Invalid inbound request.",
      ["invalid_input"]
    );
  }

  const request = normalizedResult.value;
  const resolveContext = dependencies.resolveBackendBrainContext ?? resolveBackendBrainContext;
  const resolveAction = dependencies.resolveBrainAction ?? resolveBrainAction;
  const commercialShadowHook = dependencies.commercialShadow?.commercialShadowHook ?? runCommercialShadowEvaluation;
  const commercialShadowFlags = buildCommercialShadowFlags(dependencies.commercialShadow);
  const commercialOperationalLoopHook =
    dependencies.commercialOperationalLoop?.commercialOperationalLoopHook ?? runCommercialOperationalLoop;
  const commercialOperationalLoopFlags = buildCommercialOperationalLoopFlags(dependencies.commercialOperationalLoop);
  const commercialAutonomyAfterConsultativeEnabled = shouldRunCommercialAutonomyAfterConsultative(dependencies.commercialOperationalLoop);
  const commercialExecutionBridgeHook =
    dependencies.commercialExecutionBridge?.commercialExecutionBridgeHook ?? runCommercialExecutionBridge;
  const commercialExecutionBridgeFlags = buildCommercialExecutionBridgeFlags(dependencies.commercialExecutionBridge);

  if (request.options.executeActions) {
    return buildFailClosedResponse(
      request,
      request,
      startedAt,
      [
        {
          code: "ACTION_BLOCKED",
          message: "executeActions=true is not allowed in processInbound.",
          retryable: false
        }
      ],
      "executeActions=true is not allowed in processInbound.",
      ["execute_actions_disabled"]
    );
  }

  const contextRequest = adaptBrainInboundToContextRequest(request);
  const contextResponse = await resolveContext(contextRequest, startedAt);
  const requestId = makeBrainRequestId(request);
  const contextSummary = buildContextSummary(requestId, request, contextResponse);
  let commercialShadowResult: CommercialShadowResult | null = null;
  let commercialOperationalLoopResult: CommercialOperationalLoopResult | null = null;
  let commercialExecutionBridgeResult: CommercialExecutionBridgeResult | null = null;
  let customerOnboardingResult: Awaited<ReturnType<typeof runCustomerOnboardingLoop>> | null = null;
  if (commercialShadowFlags.commercialShadowEnabled) {
    try {
      commercialShadowResult = await commercialShadowHook(buildCommercialShadowInput(request, contextResponse, startedAt, commercialShadowFlags, dependencies.abortSignal ?? null));
    } catch (error) {
      const message = error instanceof Error ? sanitizeCommercialShadowErrorMessage(error.message) : "Commercial shadow hook failed.";
      commercialShadowResult = createCommercialShadowFailedSafe({
        input: buildCommercialShadowInput(request, contextResponse, startedAt, commercialShadowFlags, dependencies.abortSignal ?? null),
        status: "failed_safe",
        failureStage: "shadow_complete",
        reason: "Commercial shadow hook failed.",
        warnings: ["shadow_result_sanitized"],
        eligible: true,
        executionDisposition: "discard_after_observation",
        error: {
          code: error instanceof Error && error.name ? error.name : "unknown_error",
          message,
          stage: "shadow_complete",
          details: {}
        }
      });
    }
  }
  const actionRequest = buildActionRequest(request, requestId, contextSummary, contextResponse);
  const actionResponse = await resolveAction(actionRequest, startedAt);
  let agentDraft: BrainAgentRunResponse["draft"] | null = null;
  let executionPlan: BrainProcessInboundResponse["execution_plan"] = null;
  let outboxPlanResult: BrainInboundOutboxPlanResult | null = null;
  let outboxPlanWarnings: string[] = [];
  const persistOutboxPlanRequested = getProcessInboundPersistOutboxPlanRequested(input);
  let salesConsultativeResult: Awaited<ReturnType<typeof runSalesConsultativeService>>["result"] | null = null;

  if (shouldRunKnowledgeAgent(request, actionResponse, contextResponse)) {
    try {
      const agentRequest = buildAgentRequest(request, requestId, contextResponse, actionResponse);
      const agentResponse = await runAgent(agentRequest, startedAt);
      agentDraft = agentResponse.draft ?? null;
      if (!agentResponse.ok) {
        actionResponse.warnings.push(`Knowledge Agent dry-run returned ok=false: ${agentResponse.message}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Knowledge Agent dry-run failed.";
      actionResponse.warnings.push(message);
    }
  }

  try {
    customerOnboardingResult = await runCustomerOnboardingLoop({
      conversationCaseId: request.conversationCaseId ?? contextResponse.case_context?.active_case?.conversation_case_id ?? null,
      waId: request.waId ?? contextResponse.customer_context?.wa_id ?? null,
      messageId: request.messageId ?? null,
      messageText: request.messageText,
      currentTime: new Date(startedAt).toISOString(),
      correlationId: request.messageId,
      brainContext: contextResponse as unknown as Record<string, unknown>,
      writeEnabled: process.env.DB_WRITE_ENABLED === "true",
      source: request.source
    });

    if (customerOnboardingResult.responseText) {
      const onboardingDraft = buildCustomerOnboardingDraft(customerOnboardingResult.responseText, customerOnboardingResult);
      agentDraft = onboardingDraft as unknown as BrainAgentRunResponse["draft"];
      if (customerOnboardingResult.decision.requiresHumanApproval) {
        actionResponse.warnings.push("customer_onboarding_handoff_required");
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Customer onboarding loop failed.";
    actionResponse.warnings.push(message);
  }

  if (shouldRunSalesConsultativeFlow(request, contextResponse)) {
    try {
      const consultativeOpportunity = await loadConsultativeOpportunity(request, contextResponse);
      const existingProfile = await loadExistingSalesNeedProfile(request, contextResponse, consultativeOpportunity?.opportunityKey ?? null);
      const consultativeRun = await runSalesConsultativeService(
        {
        currentTime: new Date(startedAt).toISOString(),
        messageText: request.messageText,
        customerContext: {
          waId: request.waId ?? contextResponse.customer_context.wa_id ?? null,
          phoneNumberId: request.phoneNumberId ?? contextResponse.input_event.phone_number_id ?? null,
          email: request.customerRef?.email ?? contextResponse.customer_context.email ?? null,
          phone: request.customerRef?.phone ?? null,
          idCustomer: request.customerRef?.idCustomer ?? contextResponse.customer_context.id_customer ?? null,
          idOrder: request.customerRef?.idOrder ?? contextResponse.customer_context.id_order ?? null,
          invoiceNumber: request.customerRef?.invoiceNumber ?? contextResponse.customer_context.invoice_number ?? null,
          contactId: request.customerRef?.contactId ?? contextResponse.customer_context.contact_id ?? null
        },
        opportunity: consultativeOpportunity,
        existingProfile,
        recentInteractions: contextResponse.conversation_context.recent_messages.map((message) => ({
          id: message.message_id ?? null,
          direction: message.direction ?? "unknown",
          text: message.message_text ?? null,
          occurredAt: message.occurred_at ?? message.created_at ?? null,
          source: message.source_table ?? null
        })),
        productRepository: createPrestashopProductRepository(),
        operationsRepository: createSalesConsultativeOperationsRepository(),
        currentStageHint: null,
        metadata: request.metadata ?? null
        },
        {
          requestId
        }
      );
      salesConsultativeResult = consultativeRun.result;
      if (consultativeRun.dispatchWarnings.length > 0) {
        actionResponse.warnings.push(...consultativeRun.dispatchWarnings);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sales consultative flow failed.";
      actionResponse.warnings.push(message);
      salesConsultativeResult = null;
    }
  }

  if (agentDraft && shouldBuildExecutionPlan(request, actionResponse, agentDraft, contextResponse, contextSummary)) {
    const executionPlanResponse = buildExecutionPlanPreview(request, actionResponse, agentDraft, contextSummary, contextResponse);
    executionPlan = executionPlanResponse.execution_plan;
    if (!executionPlanResponse.ok) {
      actionResponse.warnings.push(...executionPlanResponse.warnings);
    }
  }

  const outboxPlanAttempt = await maybePersistInboundOutboxPlan(
    request,
    actionResponse,
    agentDraft,
    contextResponse,
    persistOutboxPlanRequested
  );
  outboxPlanResult = outboxPlanAttempt.result;
  outboxPlanWarnings = outboxPlanAttempt.warnings;

  if (commercialOperationalLoopFlags.commercialOperationalLoopEnabled && (!salesConsultativeResult || commercialAutonomyAfterConsultativeEnabled)) {
    const commercialOperationalLoopInput = buildCommercialOperationalLoopInput(
      request,
      contextResponse,
      commercialShadowResult,
      startedAt,
      requestId,
      commercialOperationalLoopFlags
    );
    if (commercialOperationalLoopInput) {
      try {
        commercialOperationalLoopResult = await commercialOperationalLoopHook(commercialOperationalLoopInput);
      } catch (error) {
        const message = error instanceof Error ? sanitizeCommercialShadowErrorMessage(error.message) : "Commercial operational loop failed.";
        actionResponse.warnings.push(message);
        commercialOperationalLoopResult = null;
      }
    }
  }

  if (commercialExecutionBridgeFlags.actionQueueEnabled && (!salesConsultativeResult || commercialAutonomyAfterConsultativeEnabled)) {
    try {
      commercialExecutionBridgeResult = await commercialExecutionBridgeHook({
        operationalLoopResult: commercialOperationalLoopResult,
        currentTime: new Date(startedAt).toISOString(),
        timezone: "UTC",
        featureFlags: commercialExecutionBridgeFlags,
        sandboxWaIds: parseEnvCsv("BRAIN_AUTONOMOUS_TEST_WA_IDS"),
        allowedActionTypes: parseEnvCsv("BRAIN_AUTONOMOUS_ALLOWED_ACTION_TYPES", ["send_whatsapp_reply", "request_more_context"]),
        maxRiskLevel: process.env.BRAIN_AUTONOMOUS_MAX_RISK_LEVEL?.trim() || "low"
      });
    } catch (error) {
      const message = error instanceof Error ? sanitizeCommercialShadowErrorMessage(error.message) : "Commercial execution bridge failed.";
      actionResponse.warnings.push(message);
      commercialExecutionBridgeResult = {
        status: "failed",
        enabled: true,
        action: null,
        actionPersistence: null,
        sandboxEvaluation: null,
        executionGate: null,
        warnings: ["commercial_execution_bridge_failed"],
        error: message,
        sideEffects: {
          actionWritten: false,
          outboxWritten: false,
          messageSent: false,
          metaCalled: false,
          workerTriggered: false
        }
      };
    }
  }

  return buildValidResponse(
    request,
    startedAt,
    contextResponse,
    actionResponse,
    agentDraft,
    executionPlan,
    outboxPlanResult,
    outboxPlanWarnings,
    commercialShadowResult,
    commercialOperationalLoopResult,
    commercialExecutionBridgeResult,
    customerOnboardingResult,
    salesConsultativeResult
  );
}
