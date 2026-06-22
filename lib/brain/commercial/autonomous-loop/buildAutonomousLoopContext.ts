import type { BrainContextResolveResponse } from "../../context/types";
import type { BrainNormalizedProcessInboundRequest } from "../../inbound/types";
import { buildSandboxAutonomyConfig, type SandboxAutonomyAgentActionContext, type SandboxAutonomyConfig } from "../autonomy-sandbox";
import type { CommercialContextBuilderResult, CommercialContextSourceSummary } from "../types";
import type {
  CommercialOperationalDecisionRecord,
  CommercialOperationalLoadStateResult,
  CommercialOperationalLoopFeatureFlags,
  CommercialOperationalLoopInput,
  CommercialOperationalState
} from "../operational-loop";
import type { CommercialPolicyApprovalRequirement, CommercialPolicyResult, CommercialPolicyRiskLevel, CommercialPolicyStatus } from "../policy";
import type {
  SalesAgentAnalysis,
  SalesAgentApprovalRequirement,
  SalesAgentDecision,
  SalesAgentOutcome,
  SalesAgentPolicyAssessment,
  SalesAgentResult,
  SalesAgentResponseProposal,
  SalesAgentRationale
} from "../sales-agent/validationTypes";
import type { CommercialEvaluationResult } from "../evaluation";
import type { CommercialShadowResult } from "../shadow";
import type { CommercialShadowFeatureFlags, CommercialShadowInput } from "../shadow/shadowTypes";
import type { SalesAgentRequestedMode, SalesAgentToolName } from "../salesAgentTypes";
import type { ExecutionGateConfig } from "../execution-gate";
import type { OutboxWorkerConfig } from "../../messaging/outbox-worker";
import type { WhatsAppTransportConfig } from "../../messaging/whatsapp-transport";
import type { AutonomousCommercialLoopInput } from "./types";
import { cloneDeep, maskAutonomousLoopWaId } from "./constants";

const AUTONOMOUS_LOOP_TIMEZONE = "America/Santiago";
const AUTONOMOUS_LOOP_PHONE_NUMBER_ID = "autonomous-loop-phone";
const AUTONOMOUS_LOOP_GRAPH_BASE_URL = "https://graph." + "facebook.com";
const AUTONOMOUS_LOOP_GRAPH_API_VERSION = "v25.0";
const AUTONOMOUS_LOOP_ACCESS_TOKEN = "sandbox-token";

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function buildCommercialContextSourceSummary(input: AutonomousCommercialLoopInput): CommercialContextSourceSummary {
  const hasOutbound = asText(input.commercialContext.lastOutboundAt) !== null;
  const hasInbound = asText(input.commercialContext.lastInboundAt) !== null;
  const hasHumanMessage = asText(input.commercialContext.lastHumanMessageAt) !== null;
  const hasCommercialEntity = input.commercialContext.opportunityId !== null || input.caseContext.caseId !== null;
  const commercialIntentLegacy =
    /precio|quote|cotiz|stock/i.test(input.inbound.text) ? "quote_request" : /seguimiento|follow/i.test(input.inbound.text) ? "followup" : "general_information";

  return {
    sourceShape: "autonomous_loop",
    supportedContextShape: true,
    channel: "whatsapp",
    platform: "whatsapp",
    department: input.caseContext.department,
    conversationCaseId: input.caseContext.caseId,
    waId: input.inbound.waId,
    email: null,
    phone: null,
    idCustomer: null,
    idOrder: null,
    invoiceNumber: null,
    contactId: null,
    caseStatus: input.caseContext.status,
    caseLifecycleStatus: input.caseContext.lifecycleStatus,
    humanOwnershipActive: input.caseContext.humanOwnerActive,
    aiBlocked: input.caseContext.aiBlocked,
    manualReplyActive: hasHumanMessage,
    hasCustomerCandidate: true,
    hasCustomerReference: true,
    hasConversationHistory: hasInbound || hasOutbound,
    hasLatestCustomerMessage: hasInbound,
    hasLatestOutboundMessage: hasOutbound,
    leadAvailable: false,
    opportunityAvailable: input.commercialContext.opportunityId !== null,
    hasCommercialEntity,
    commercialIntentLegacy,
    orderContextAvailable: false,
    productServiceContextAvailable: true,
    latestInboundAt: input.commercialContext.lastInboundAt ?? input.inbound.receivedAt,
    latestOutboundAt: input.commercialContext.lastOutboundAt,
    recentMessagesCount: 1,
    recentMessagesLimit: 12
  };
}

function buildSalesAgentResult(input: AutonomousCommercialLoopInput): SalesAgentResult {
  const forcedActionType = asText(input.scenario.forceActionType);
  const forcedDecision = asText(input.scenario.forceDecision);
  const baseMessageIntent: SalesAgentResponseProposal["messageIntent"] =
    forcedActionType === "schedule_followup"
      ? "follow_up"
      : forcedActionType === "request_more_context"
        ? "clarify"
        : forcedActionType === "take_over_case"
          ? "handoff"
          : forcedActionType === "send_whatsapp_reply"
            ? "answer"
            : /seguimiento|follow/i.test(input.inbound.text)
              ? "follow_up"
              : /precio|quote|cotiz|stock/i.test(input.inbound.text)
                ? "answer"
                : "clarify";

  const decisionType: SalesAgentDecision["type"] =
    forcedDecision === "request_human" || input.caseContext.humanOwnerActive || input.caseContext.requiresHuman
      ? "request_human"
      : forcedDecision === "failed_safe"
        ? "failed_safe"
        : forcedDecision === "no_commercial_action"
          ? "no_commercial_action"
          : baseMessageIntent === "follow_up"
            ? "respond_now"
            : baseMessageIntent === "clarify"
              ? "respond_now"
              : "respond_now";

  const outcome: SalesAgentOutcome =
    decisionType === "request_human"
      ? "insufficient_context"
      : decisionType === "failed_safe"
        ? "failed_safe"
        : decisionType === "no_commercial_action"
          ? "no_commercial_action"
          : baseMessageIntent === "follow_up"
            ? "response_proposed"
            : "response_proposed";

  const responseProposal: SalesAgentResponseProposal = {
    messageIntent: baseMessageIntent,
    draftText:
      baseMessageIntent === "follow_up"
        ? "Te contactaremos con el siguiente paso comercial."
        : baseMessageIntent === "clarify"
          ? "Necesito algunos datos adicionales para ayudarte mejor."
          : "Gracias por tu mensaje. Vamos a revisarlo.",
    language: "es",
    tone: "helpful",
    questions: baseMessageIntent === "clarify" ? ["producto", "cantidad"] : [],
    claims: [],
    disclaimers: [],
    requiresApproval: input.caseContext.humanOwnerActive || input.caseContext.requiresHuman ? "operator_review" : "none",
    blockedClaims: [],
    confidence: "high"
  };

  const analysis = {
    summary: "Synthetic commercial analysis for autonomous loop orchestration.",
    qualificationState: "qualified",
    customerReadiness: "medium",
    productFit: "good",
    confidence: "high",
    riskLevel: (input.scenario.forceRiskLevel ?? "low") as SalesAgentResult["analysis"]["riskLevel"],
    reasonCodes: ["synthetic"]
  } as unknown as SalesAgentAnalysis;

  const decision: SalesAgentDecision = {
    type: decisionType as SalesAgentResult["decision"]["type"],
    reason: forcedDecision === "request_human" ? "Synthetic human review request." : "Synthetic decision for loop orchestration.",
    confidence: "high",
    riskLevel: (input.scenario.forceRiskLevel ?? "low") as SalesAgentResult["decision"]["riskLevel"],
    requiresApproval: (input.scenario.forceApprovalRequirement ?? "none") as SalesAgentApprovalRequirement,
    errorCode: null,
    reasonCodes: ["synthetic"],
    policyTags: [] as never[]
  };

  const rationale: SalesAgentRationale = {
    summary: "Synthetic rationale.",
    evidence: ["synthetic"],
    counterEvidence: [],
    assumptions: ["synthetic"],
    riskFlags: input.caseContext.aiBlocked ? ["ai_blocked"] : [],
    missingInformation: baseMessageIntent === "clarify" ? ["product", "quantity"] : [],
    policyRulesApplied: ["synthetic"]
  };

  const policyAssessment = {
    status: input.caseContext.humanOwnerActive || input.caseContext.aiBlocked || input.caseContext.requiresHuman || forcedDecision === "blocked" ? "blocked" : "allowed",
    blocked: input.caseContext.humanOwnerActive || input.caseContext.aiBlocked || input.caseContext.requiresHuman || forcedDecision === "blocked",
    reason: "Synthetic policy assessment.",
    confidence: "high",
    riskLevel: (input.scenario.forceRiskLevel ?? "low") as SalesAgentResult["policyAssessment"]["riskLevel"],
    approvalRequirement: (input.scenario.forceApprovalRequirement ?? "none") as SalesAgentApprovalRequirement,
    errorCode: null,
    reasonCodes: ["synthetic"],
    policyTags: [] as never[]
  } as unknown as SalesAgentPolicyAssessment;

  return {
    runId: `sales-agent:${input.correlationId}`,
    contractVersion: "brain.commercial.sales-agent.v1",
    outcome,
    analysis,
    decision,
    shouldRespondNow: baseMessageIntent !== "follow_up" && !input.caseContext.humanOwnerActive && !input.caseContext.aiBlocked,
    shouldRequestTool: false,
    shouldRequestHuman: input.caseContext.humanOwnerActive || input.caseContext.aiBlocked || input.caseContext.requiresHuman || forcedDecision === "request_human",
    shouldEvaluateFollowUp: baseMessageIntent === "follow_up",
    proposedActions: [],
    toolRequests: [],
    entityProposals: [],
    responseProposal,
    evidence: [],
    policyAssessment,
    warnings: [],
    rationale,
    metadata: {
      synthetic: true,
      correlationId: input.correlationId
    }
  };
}

function buildCommercialPolicyResult(input: AutonomousCommercialLoopInput, salesAgentResult: SalesAgentResult): CommercialPolicyResult {
  const blocked = input.caseContext.humanOwnerActive || input.caseContext.aiBlocked || input.caseContext.requiresHuman || input.scenario.forceDecision === "blocked";
  const requiresApproval = (input.scenario.forceApprovalRequirement ?? "none") as CommercialPolicyApprovalRequirement;
  const status: CommercialPolicyStatus = blocked ? "blocked" : requiresApproval !== "none" ? "requires_review" : "allowed";
  const overallDecision = blocked ? "block" : requiresApproval !== "none" ? "allow_with_approval" : "allow";
  const riskLevel = (input.scenario.forceRiskLevel ?? "low") as CommercialPolicyRiskLevel;

  return {
    status,
    overallDecision,
    riskLevel,
    requiresApproval,
    originalResultReference: {
      runId: salesAgentResult.runId,
      contractVersion: salesAgentResult.contractVersion,
      outcome: salesAgentResult.outcome,
      decisionType: salesAgentResult.decision.type
    },
    governedResult: cloneDeep(salesAgentResult),
    claimAssessments: [],
    actionAssessments: [],
    toolRequestAssessments: [],
    entityProposalAssessments: [],
    blockedClaims: [],
    blockedActions: [],
    blockedToolRequests: [],
    blockedEntityProposals: [],
    appliedRules: ["synthetic"],
    issues: [],
    warnings: [],
    summary: {
      originalOutcome: salesAgentResult.outcome,
      governedOutcome: salesAgentResult.outcome,
      allowedClaims: 0,
      blockedClaims: 0,
      allowedActions: 0,
      blockedActions: 0,
      allowedToolRequests: 0,
      blockedToolRequests: 0,
      allowedEntityProposals: 0,
      blockedEntityProposals: 0,
      reviewRequired: requiresApproval !== "none",
      blocked,
      notes: ["synthetic"]
    },
    metadata: {
      policyVersion: "brain.commercial.policy.v1",
      contractVersion: "brain.commercial.policy.v1",
      currentTime: input.now,
      validatedAt: input.now,
      allowedCapabilities: ["searchKnowledge", "getConversationHistory", "searchProducts", "getProductStock", "getOrderByInvoice"],
      featureFlags: {
        commercialPolicyEnabled: true,
        allowDraftReplies: true,
        allowToolRequests: true,
        allowEntityProposals: true,
        allowFollowUpEvaluation: true,
        allowInternalTasks: true,
        allowQuoteDraftRequests: true,
        allowOperatorReviewRequests: true,
        allowSensitiveClaims: false,
        allowOutboundProposals: true
      },
      issueCount: 0,
      warningCount: 0,
      appliedRuleCount: 1,
      sanitized: true,
      sanitizedFields: [],
      safeMetadata: {
        synthetic: true
      },
      commercialContext: {
        synthetic: true
      }
    }
  } as unknown as CommercialPolicyResult;
}

function buildCommercialEvaluationResult(input: AutonomousCommercialLoopInput, salesAgentResult: SalesAgentResult, policyResult: CommercialPolicyResult): CommercialEvaluationResult {
  return {
    sampleId: `sample:${input.correlationId}`,
    timestamp: input.now,
    scenario: "autonomous_loop",
    expectedTags: ["synthetic"],
    status: "completed",
    shadowResultSummary: {
      status: "completed",
      mode: "fixture",
      enabled: true,
      eligible: true,
      skipReason: null,
      runtimeStatus: "valid",
      validationStatus: "valid",
      policyStatus: policyResult.status,
      overallDecision: policyResult.overallDecision,
      outcome: salesAgentResult.outcome,
      riskLevel: policyResult.riskLevel,
      approvalRequirement: policyResult.requiresApproval,
      shouldRespondNow: salesAgentResult.shouldRespondNow,
      confidence: salesAgentResult.analysis.confidence,
      warningCount: 0,
      issueCodes: [],
      appliedRuleIds: ["synthetic"],
      sideEffects: {
        messagesSent: 0,
        toolsExecuted: 0,
        databaseWrites: 0,
        outboxWrites: 0,
        leadsCreated: 0,
        opportunitiesCreated: 0,
        casesMutated: 0
      }
    },
    metrics: {
      shadowStatus: "completed",
      shadowMode: "fixture",
      shadowEnabled: true,
      shadowEligible: true,
      runtimeStatus: "valid",
      validationStatus: "valid",
      outcome: salesAgentResult.outcome,
      policyStatus: policyResult.status,
      overallDecision: policyResult.overallDecision,
      riskLevel: policyResult.riskLevel,
      approvalRequirement: policyResult.requiresApproval,
      shouldRespondNow: salesAgentResult.shouldRespondNow,
      confidence: salesAgentResult.analysis.confidence,
      claimsTotal: 0,
      claimsBlocked: 0,
      claimsSensitive: 0,
      claimCountsByType: {},
      blockedClaimCountsByType: {},
      proposedActionsTotal: 0,
      proposedActionsBlocked: 0,
      actionCountsByType: {},
      blockedActionCountsByType: {},
      toolRequestsTotal: 0,
      toolRequestsBlocked: 0,
      toolRequestCountsByType: {},
      blockedToolRequestCountsByType: {},
      entityProposalsTotal: 0,
      entityProposalsBlocked: 0,
      entityProposalCountsByType: {},
      blockedEntityProposalCountsByType: {},
      warningsCount: 0,
      issuesCount: 0,
      appliedPolicyRules: ["synthetic"],
      timeout: false,
      durationTotalMs: 1,
      contextDurationMs: 1,
      runtimeDurationMs: 1,
      validationDurationMs: 1,
      policyDurationMs: 1,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      provider: "synthetic",
      model: "synthetic",
      contractVersion: "brain.commercial.evaluation.v1",
      promptVersion: "brain.commercial.sales-agent.prompt.v1" as never,
      runtimeVersion: "brain.commercial.sales-agent.runtime.v1",
      policyVersion: "brain.commercial.policy.v1",
      sideEffectsCount: 0,
      hasPolicyResult: true,
      hasRuntimeResult: true,
      hasValidationResult: true,
      hasCommercialContext: true,
      hasComparison: true,
      hasReviewerAssessment: false
    },
    dimensions: {} as never,
    classification: {
      usefulness: "useful",
      primaryComponent: "runtime",
      primaryDimension: "dataset",
      primaryIssueCode: null,
      severity: "info",
      reason: "Synthetic evaluation result.",
      readinessContributionScore: 1,
      needsPolicyTuning: false,
      needsPromptTuning: false,
      needsContextImprovement: false,
      needsRuntimeStabilization: false,
      needsSafetyReview: false
    },
    comparison: {
      status: "aligned",
      shadowDecision: "respond",
      productiveAction: "respond",
      targetAgent: "sales_agent",
      responded: true,
      handedOff: false,
      closed: false,
      noAction: false,
      requiresHuman: false,
      reason: "Synthetic evaluation comparison.",
      timestamp: input.now,
      alignedFields: ["synthetic"],
      divergentFields: []
    },
    reviewerAssessment: null,
    issues: [],
    warnings: [],
    recommendations: [],
    versionInfo: {
      evaluationVersion: "brain.commercial.evaluation.v1",
      shadowVersion: "brain.commercial.shadow.v1",
      runtimeVersion: "brain.commercial.sales-agent.runtime.v1",
      policyVersion: "brain.commercial.policy.v1",
      contractVersion: "brain.commercial.sales-agent.v1",
      promptVersion: "brain.commercial.sales-agent.prompt.v1" as never
    },
    metadata: {
      synthetic: true
    }
  } as unknown as CommercialEvaluationResult;
}

function buildCommercialShadowResult(
  input: AutonomousCommercialLoopInput,
  commercialContext: CommercialContextBuilderResult,
  salesAgentResult: SalesAgentResult,
  policyResult: CommercialPolicyResult
): CommercialShadowResult {
  return {
    status: "completed",
    mode: "fixture",
    enabled: true,
    eligible: true,
    skipReason: null,
    correlationId: input.correlationId,
    executionId: `shadow:${input.correlationId}`,
    commercialContextSummary: {
      status: commercialContext.status,
      completeness: commercialContext.completeness,
      warnings: commercialContext.warnings,
      sourceSummary: commercialContext.sourceSummary,
      metadata: commercialContext.metadata
    },
    runtimeSummary: {
      status: "valid",
      mode: "dry_run",
      validationStatus: "valid",
      providerName: "synthetic",
      providerVersion: "synthetic",
      providerRequestId: null,
      model: "synthetic",
      finishReason: "stop",
      outcome: salesAgentResult.outcome,
      confidence: salesAgentResult.analysis.confidence,
      shouldRespondNow: salesAgentResult.shouldRespondNow,
      warningsCount: 0,
      rawOutputCaptured: false,
      promptPreviewIncluded: false
    },
    policySummary: {
      status: policyResult.status,
      overallDecision: policyResult.overallDecision,
      riskLevel: policyResult.riskLevel,
      requiresApproval: policyResult.requiresApproval,
      blockedClaims: 0,
      blockedActions: 0,
      blockedToolRequests: 0,
      blockedEntityProposals: 0,
      issueCount: 0,
      warningCount: 0
    },
    governedResultSummary: {
      outcome: salesAgentResult.outcome,
      confidence: salesAgentResult.analysis.confidence,
      shouldRespondNow: salesAgentResult.shouldRespondNow,
      policyStatus: policyResult.status,
      overallDecision: policyResult.overallDecision,
      riskLevel: policyResult.riskLevel,
      requiresApproval: policyResult.requiresApproval as SalesAgentApprovalRequirement,
      proposedActionCount: 0,
      blockedActionCount: 0,
      toolRequestCount: 0,
      blockedToolRequestCount: 0,
      claimCount: 0,
      blockedClaimCount: 0,
      entityProposalCount: 0,
      warningsCount: 0,
      issueCodes: [],
      appliedRuleIds: ["synthetic"]
    },
    stages: [],
    metrics: {
      startedAt: input.now,
      completedAt: input.now,
      durationMs: 1,
      eligibilityDurationMs: 1,
      contextBuilderDurationMs: 1,
      runtimeDurationMs: 1,
      validationDurationMs: 1,
      policyDurationMs: 1,
      overheadMs: 0,
      inputCharacters: JSON.stringify(input).length,
      outputCharacters: 0,
      providerDurationMs: 1,
      model: "synthetic",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      providerRequestId: null,
      timedOut: false,
      warningsCount: 0
    },
    warnings: [],
    error: null,
    versions: {
      shadowVersion: "brain.commercial.shadow.v1",
      contractVersion: "brain.commercial.sales-agent.v1",
      promptVersion: "brain.commercial.sales-agent.prompt.v1" as never,
      policyVersion: "brain.commercial.policy.v1",
      runtimeVersion: "brain.commercial.sales-agent.runtime.v1"
    },
    metadata: {
      synthetic: true
    },
    observedAt: input.now,
    sideEffects: {
      messagesSent: 0,
      toolsExecuted: 0,
      databaseWrites: 0,
      outboxWrites: 0,
      leadsCreated: 0,
      opportunitiesCreated: 0,
      casesMutated: 0
    },
    executionDisposition: "observe_only",
    telemetry: [],
    context: {
      inboundMessage: cloneDeep({
        channel: "whatsapp",
        source: "autonomous_loop",
        contextMode: "standard",
        waId: input.inbound.waId,
        phoneNumberId: AUTONOMOUS_LOOP_PHONE_NUMBER_ID,
        messageId: input.inbound.messageId,
        messageText: input.inbound.text,
        conversationCaseId: input.caseContext.caseId,
        customerRef: {
          waId: input.inbound.waId,
          phoneNumberId: AUTONOMOUS_LOOP_PHONE_NUMBER_ID
        },
        options: {
          dryRun: true,
          executeActions: false,
          returnInstructionsForN8n: true,
          debug: false,
          runAgentDryRun: false,
          buildExecutionPlanDryRun: false
        },
        receivedAt: input.inbound.receivedAt,
        sourceWorkflow: "autonomous-loop",
        sourceNode: "orchestrator",
        metadata: {
          correlationId: input.correlationId,
          tenantId: input.tenantId
        }
      }),
      brainContext: cloneDeep({
        customer_context: {
          wa_id: input.inbound.waId,
          phone_number_id: AUTONOMOUS_LOOP_PHONE_NUMBER_ID,
          contact_name: input.inbound.contactName,
          email: null,
          contact_id: null,
          id_customer: null,
          id_order: null,
          invoice_number: null,
          suppression_active: false,
          hard_suppression: false,
          suppression_reason: null,
          blocked_until: null,
          last_inbound_at: input.commercialContext.lastInboundAt ?? input.inbound.receivedAt,
          last_outbound_at: input.commercialContext.lastOutboundAt,
          last_manual_reply_at: input.commercialContext.lastHumanMessageAt,
          open_cases_count: 1,
          active_case_id: input.caseContext.caseId,
          active_case_status: input.caseContext.status,
          latest_case_status: input.caseContext.status
        },
        case_context: {
          active_case: {
            conversation_case_id: input.caseContext.caseId,
            active_case_key: input.commercialContext.opportunityKey ?? `opportunity-${input.correlationId}`,
            status: input.caseContext.status ?? "open",
            lifecycle_status: input.caseContext.lifecycleStatus ?? "open",
            department: input.caseContext.department,
            service_code: "quote_requested",
            priority: input.caseContext.priority ?? "normal",
            requires_human: input.caseContext.requiresHuman,
            bot_replied: false,
            final_action: "continue",
            ai_blocked: input.caseContext.aiBlocked,
            wa_id: input.inbound.waId,
            phone_number_id: AUTONOMOUS_LOOP_PHONE_NUMBER_ID,
            id_order: null,
            id_customer: null,
            invoice_number: null,
            source_table: "autonomous_loop",
            source_id: input.caseContext.caseId,
            whatsapp_window_open: true,
            last_message_at: input.inbound.receivedAt,
            created_at: input.inbound.receivedAt,
            updated_at: input.inbound.receivedAt,
            closed_at: null,
            raw_status: input.caseContext.status ?? "open"
          },
          latest_case: null,
          open_cases: [],
          case_count: 1,
          waiting_human_case: input.caseContext.requiresHuman,
          closed_or_rejected_case: false,
          manual_operator_lock: input.caseContext.humanOwnerActive,
          last_case_status: input.caseContext.status ?? "open",
          last_case_final_action: "continue"
        },
        conversation_context: {
          recent_messages: [],
          recent_inbound_messages: [],
          recent_outbound_messages: [],
          recent_manual_replies: [],
          recent_agent_runs: [],
          message_count: 1,
          last_inbound_at: input.commercialContext.lastInboundAt ?? input.inbound.receivedAt,
          last_outbound_at: input.commercialContext.lastOutboundAt,
          last_manual_reply_at: input.commercialContext.lastHumanMessageAt
        },
        business_context: {
          ps_orders: [],
          postventa_queue: null,
          mantenciones_queue: null,
          context_mode: "standard",
          dry_run: true,
          include_postventa: true,
          include_agent_runs: true
        },
        service_context: {
          primary_service: "sales",
          service_code: "quote_requested",
          source_domain: "sales",
          source_table: "autonomous_loop",
          source_id: input.caseContext.caseId,
          source_status: input.caseContext.status,
          source_priority: input.caseContext.priority,
          suggested_agent: "sales_agent",
          signals: ["customer_message_present"]
        }
      }),
      commercialContext: commercialContext as never,
      salesAgentInput: null,
      runtimeResult: {
        result: salesAgentResult,
        status: "completed",
        mode: "dry_run",
        warnings: [],
        metadata: {
          synthetic: true
        }
      } as never,
      validationResult: {
        status: "valid",
        warnings: [],
        errors: []
      } as never,
      policyResult: policyResult as never
    }
  } as unknown as CommercialShadowResult;
}

function buildFeatureFlags(input: AutonomousCommercialLoopInput): CommercialOperationalLoopFeatureFlags {
  return {
    commercialOperationalLoopEnabled: input.configuration.operationalLoopEnabled,
    commercialStatePersistenceEnabled: false
  };
}

function buildCommercialContext(input: AutonomousCommercialLoopInput): CommercialContextBuilderResult {
  const sourceSummary = buildCommercialContextSourceSummary(input);
  return {
    status: "success",
    salesAgentInput: {
      identity: {
        waId: input.inbound.waId,
        conversationCaseId: input.caseContext.caseId
      },
      commercial: {
        opportunity: {
          id: input.commercialContext.opportunityId,
          opportunityId: input.commercialContext.opportunityId,
          opportunityKey: input.commercialContext.opportunityKey,
          status: input.commercialContext.opportunityStatus,
          stage: input.commercialContext.opportunityStage
        }
      }
    } as never,
    warnings: [],
    sourceSummary,
    completeness: "complete",
    metadata: {
      version: "brain.commercial.context.builder.v1",
      generatedAt: input.now,
      currentTime: input.now,
      timezone: AUTONOMOUS_LOOP_TIMEZONE,
      requestedMode: "standard" as SalesAgentRequestedMode,
      availableCapabilities: [
        "searchKnowledge",
        "getConversationHistory",
        "searchProducts",
        "getProductStock",
        "getOrderByInvoice"
      ] as SalesAgentToolName[],
      recentMessagesLimit: 12,
      sanitized: true,
      sanitizedFields: [],
      sourceShape: "autonomous_loop",
      safeMetadata: {
        synthetic: true
      }
    }
  };
}

function buildBrainContext(input: AutonomousCommercialLoopInput): BrainContextResolveResponse {
  return {
    ok: true,
    request_id: `brain:${input.correlationId}`,
    partial_context: false,
    input_event: {
      channel: "whatsapp",
      source: "n8n_meta_webhook",
      wa_id: input.inbound.waId,
      phone_number_id: AUTONOMOUS_LOOP_PHONE_NUMBER_ID,
      message_id: input.inbound.messageId,
      message_text: input.inbound.text,
      conversation_case_id: input.caseContext.caseId,
      received_at: input.inbound.receivedAt,
      dry_run: true
    } as never,
    resolver_identity: {
      provisional: true,
      identity_type: "wa_id",
      identity_key: input.inbound.waId,
      confidence: 0.95,
      wa_id: input.inbound.waId,
      phone_number_id: AUTONOMOUS_LOOP_PHONE_NUMBER_ID,
      conversation_case_id: input.caseContext.caseId,
      notes: ["synthetic"]
    } as never,
    customer_context: {
      wa_id: input.inbound.waId,
      phone_number_id: AUTONOMOUS_LOOP_PHONE_NUMBER_ID,
      contact_name: input.inbound.contactName,
      email: null,
      contact_id: null,
      id_customer: null,
      id_order: null,
      invoice_number: null,
      suppression_active: false,
      hard_suppression: false,
      suppression_reason: null,
      blocked_until: null,
      last_inbound_at: input.commercialContext.lastInboundAt ?? input.inbound.receivedAt,
      last_outbound_at: input.commercialContext.lastOutboundAt,
      last_manual_reply_at: input.commercialContext.lastHumanMessageAt,
      open_cases_count: 1,
      active_case_id: input.caseContext.caseId,
      active_case_status: input.caseContext.status,
      latest_case_status: input.caseContext.status
    } as never,
    case_context: {
      active_case: {
        conversation_case_id: input.caseContext.caseId,
        active_case_key: input.commercialContext.opportunityKey ?? `opportunity-${input.correlationId}`,
        status: input.caseContext.status ?? "open",
        lifecycle_status: input.caseContext.lifecycleStatus ?? "open",
        department: input.caseContext.department,
        service_code: "quote_requested",
        priority: input.caseContext.priority ?? "normal",
        requires_human: input.caseContext.requiresHuman,
        bot_replied: false,
        final_action: "continue",
        ai_blocked: input.caseContext.aiBlocked,
        wa_id: input.inbound.waId,
        phone_number_id: AUTONOMOUS_LOOP_PHONE_NUMBER_ID,
        id_order: null,
        id_customer: null,
        invoice_number: null,
        source_table: "autonomous_loop",
        source_id: input.caseContext.caseId,
        whatsapp_window_open: true,
        last_message_at: input.inbound.receivedAt,
        created_at: input.inbound.receivedAt,
        updated_at: input.inbound.receivedAt,
        closed_at: null,
        raw_status: input.caseContext.status ?? "open"
      },
      latest_case: null,
      open_cases: [],
      case_count: 1,
      waiting_human_case: input.caseContext.requiresHuman,
      closed_or_rejected_case: false,
      manual_operator_lock: input.caseContext.humanOwnerActive,
      last_case_status: input.caseContext.status ?? "open",
      last_case_final_action: "continue"
    } as never,
    conversation_context: {
      recent_messages: [],
      recent_inbound_messages: [],
      recent_outbound_messages: [],
      recent_manual_replies: [],
      recent_agent_runs: [],
      message_count: 1,
      last_inbound_at: input.commercialContext.lastInboundAt ?? input.inbound.receivedAt,
      last_outbound_at: input.commercialContext.lastOutboundAt,
      last_manual_reply_at: input.commercialContext.lastHumanMessageAt
    } as never,
    business_context: {
      ps_orders: [],
      postventa_queue: null,
      mantenciones_queue: null,
      context_mode: "standard",
      dry_run: true,
      include_postventa: true,
      include_agent_runs: true
    } as never,
    service_context: {
      primary_service: "sales",
      service_code: "quote_requested",
      source_domain: "sales",
      source_table: "autonomous_loop",
      source_id: input.caseContext.caseId,
      source_status: input.caseContext.status,
      source_priority: input.caseContext.priority,
      suggested_agent: "sales_agent",
      signals: ["customer_message_present"]
    } as never,
    warnings: [],
    errors: [],
    metadata: {
      version: "brain.context.resolve.v1",
      generatedAt: input.now,
      processingMs: 1,
      dryRun: true,
      maxMessages: 12,
      maxAgentRuns: 5,
      sanitized: true,
      sanitizedFields: [],
      safeTraceId: `trace:${input.correlationId}`
    },
    context_packs: {
      sales: {
        agent: "sales",
        available: true,
        confidence: 0.95,
        reason: "Synthetic autonomous loop context.",
        signals: ["customer_message_present"],
        recommended_action: "answer",
        related_case_id: input.caseContext.caseId,
        related_order_id: null
      },
      sac: {
        agent: "sac",
        available: false,
        confidence: 0.1,
        reason: "Synthetic autonomous loop context.",
        signals: [],
        recommended_action: "noop",
        related_case_id: null,
        related_order_id: null
      },
      postventa: {
        agent: "postventa",
        available: false,
        confidence: 0.1,
        reason: "Synthetic autonomous loop context.",
        signals: [],
        recommended_action: "noop",
        related_case_id: null,
        related_order_id: null
      },
      knowledge: {
        agent: "knowledge",
        available: true,
        confidence: 0.8,
        reason: "Synthetic autonomous loop context.",
        signals: [],
        recommended_action: "context_only",
        related_case_id: input.caseContext.caseId,
        related_order_id: null
      },
      campaign: {
        agent: "campaign",
        available: false,
        confidence: 0.1,
        reason: "Synthetic autonomous loop context.",
        signals: [],
        recommended_action: "noop",
        related_case_id: null,
        related_order_id: null
      }
    },
    bot_eligibility: {
      eligible: !input.caseContext.humanOwnerActive && !input.caseContext.aiBlocked && !input.caseContext.requiresHuman,
      recommended_mode: "bot",
      confidence: 0.95,
      reason: "Synthetic autonomous loop context.",
      blockers: [],
      can_auto_reply: true,
      can_human_handoff: true,
      can_case_mutation: false,
      signals: {
        manual_operator_lock: input.caseContext.humanOwnerActive,
        active_human_case: input.caseContext.humanOwnerActive,
        suppression_active: false,
        recent_manual_reply: false,
        open_case_waiting_human: input.caseContext.requiresHuman,
        closed_or_rejected_case: false,
        ambiguous_positive_reply_with_service_context: false
      }
    } as never
  } as never;
}

function buildEvaluationResult(input: AutonomousCommercialLoopInput, salesAgentResult: SalesAgentResult, policyResult: CommercialPolicyResult): CommercialEvaluationResult {
  return buildCommercialEvaluationResult(input, salesAgentResult, policyResult);
}

function buildShadowFlags(input: AutonomousCommercialLoopInput): CommercialShadowFeatureFlags {
  return {
    commercialShadowEnabled: input.configuration.operationalLoopEnabled,
    commercialRuntimeEnabled: true,
    commercialPolicyEnabled: true,
    commercialShadowCaptureMetrics: true,
    commercialShadowCaptureResult: true,
    commercialShadowCaptureWarnings: true,
    commercialShadowIncludePromptPreview: false,
    commercialShadowIncludeRawOutputPreview: false,
    commercialShadowFailOpenForInbound: true,
    commercialShadowAllowRealProvider: false
  } as CommercialShadowFeatureFlags;
}

function buildShadowInput(input: AutonomousCommercialLoopInput, context: CommercialContextBuilderResult, salesAgentResult: SalesAgentResult, policyResult: CommercialPolicyResult): CommercialShadowInput {
  return {
    inboundMessage: buildBrainContext(input).input_event as never,
    brainContext: buildBrainContext(input),
    correlationId: input.correlationId,
    executionId: `shadow:${input.correlationId}`,
    currentTime: input.now,
    timezone: AUTONOMOUS_LOOP_TIMEZONE,
    requestedMode: "standard",
    policyContext: null,
    provider: null,
    runtimeOptions: {
      enabled: true,
      mode: "dry_run",
      timeoutMs: 250,
      maxInputCharacters: 20000,
      maxOutputCharacters: 12000,
      strictValidation: true,
      allowedCapabilities: ["searchKnowledge", "getConversationHistory", "searchProducts", "getProductStock", "getOrderByInvoice"],
      captureRawOutput: false,
      includePromptPreview: false,
      dryRun: true,
      abortSignal: null
    },
    policyFlags: {
      commercialPolicyEnabled: true,
      allowDraftReplies: true,
      allowToolRequests: true,
      allowEntityProposals: true,
      allowFollowUpEvaluation: true,
      allowInternalTasks: true,
      allowQuoteDraftRequests: true,
      allowOperatorReviewRequests: true,
      allowSensitiveClaims: false,
      allowOutboundProposals: true
    },
    shadowFlags: buildShadowFlags(input),
    contractVersion: "brain.commercial.sales-agent.v1",
    promptVersion: "brain.commercial.sales-agent.prompt.v1" as never,
    policyVersion: "brain.commercial.policy.v1",
    allowedCapabilities: ["searchKnowledge", "getConversationHistory", "searchProducts", "getProductStock", "getOrderByInvoice"],
    metadata: {
      synthetic: true
    },
    abortSignal: null
  } as unknown as CommercialShadowInput;
}

function buildLoadStateFromSnapshot(snapshot: import("./types").AutonomousLoopRuntimeSnapshot): CommercialOperationalLoadStateResult {
  const activeState = snapshot.opportunities.length > 0 ? (snapshot.opportunities[snapshot.opportunities.length - 1].source as CommercialOperationalState) : null;
  const latestDecision = snapshot.decisions.length > 0 ? (snapshot.decisions[snapshot.decisions.length - 1].source as CommercialOperationalDecisionRecord) : null;

  return {
    status: activeState ? "loaded" : "not_found",
    candidates: activeState ? [cloneDeep(activeState)] : [],
    activeState: activeState ? cloneDeep(activeState) : null,
    latestDecision: latestDecision ? cloneDeep(latestDecision) : null,
    warnings: [],
    metadata: {
      synthetic: true
    }
  } as CommercialOperationalLoadStateResult;
}

function buildOperationalLoopStorage(snapshot: import("./types").AutonomousLoopRuntimeSnapshot) {
  return {
    async loadCommercialState() {
      return buildLoadStateFromSnapshot(snapshot);
    },
    async persistCommercialState(input: {
      resultingState: CommercialOperationalState;
      decisionRecord: CommercialOperationalDecisionRecord;
    }) {
      return {
        status: "skipped",
        opportunityWritten: false,
        decisionWritten: false,
        opportunityId: input.resultingState.opportunityId ?? null,
        opportunityKey: input.resultingState.opportunityKey,
        decisionId: input.decisionRecord.decisionId,
        version: input.resultingState.version,
        createdAt: input.decisionRecord.createdAt,
        warnings: ["commercial_state_persistence_disabled"],
        reason: "Commercial state persistence is disabled."
      } as const;
    }
  };
}

export function buildAutonomousLoopContext(
  input: AutonomousCommercialLoopInput,
  snapshot: import("./types").AutonomousLoopRuntimeSnapshot
): {
  commercialContext: CommercialContextBuilderResult;
  salesAgentResult: SalesAgentResult;
  commercialPolicyResult: CommercialPolicyResult;
  commercialEvaluationResult: CommercialEvaluationResult;
  brainContext: BrainContextResolveResponse;
  inboundMessage: BrainNormalizedProcessInboundRequest;
  commercialShadowResult: CommercialShadowResult;
  operationalLoopInput: CommercialOperationalLoopInput;
  sandboxContext: SandboxAutonomyAgentActionContext;
  sandboxConfig: SandboxAutonomyConfig;
  executionGateConfig: ExecutionGateConfig;
  outboxConfig: OutboxWorkerConfig;
  transportConfig: WhatsAppTransportConfig;
} {
  const commercialContext = buildCommercialContext(input);
  const salesAgentResult = buildSalesAgentResult(input);
  const commercialPolicyResult = buildCommercialPolicyResult(input, salesAgentResult);
  const commercialEvaluationResult = buildEvaluationResult(input, salesAgentResult, commercialPolicyResult);
  const brainContext = buildBrainContext(input);
  const inboundMessage = brainContext.input_event as never as BrainNormalizedProcessInboundRequest;
  const commercialShadowResult = buildCommercialShadowResult(input, commercialContext, salesAgentResult, commercialPolicyResult);

  const operationalLoopInput: CommercialOperationalLoopInput = {
    inboundMessage,
    brainContext,
    commercialContext,
    salesAgentResult,
    commercialPolicyResult,
    commercialEvaluationResult,
    commercialShadowResult,
    currentTime: input.now,
    correlationId: input.correlationId,
    processInboundRunId: `process-inbound:${input.correlationId}`,
    salesAgentRunId: salesAgentResult.runId,
    featureFlags: buildFeatureFlags(input),
    mode: "fixture",
    contractVersion: salesAgentResult.contractVersion,
    policyVersion: "brain.commercial.policy.v1",
    runtimeVersion: "brain.commercial.sales-agent.runtime.v1",
    promptVersion: "brain.commercial.sales-agent.prompt.v1" as never,
    evaluationVersion: "brain.commercial.evaluation.v1",
    metadata: {
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      synthetic: true
    },
    abortSignal: null,
    storage: buildOperationalLoopStorage(snapshot) as never
  };

  const sandboxContext: SandboxAutonomyAgentActionContext = {
    now: input.now,
    caseId: input.caseContext.caseId === null ? null : String(input.caseContext.caseId),
    caseStatus: input.caseContext.status,
    lifecycleStatus: input.caseContext.lifecycleStatus,
    humanOwnerActive: input.caseContext.humanOwnerActive,
    aiBlocked: input.caseContext.aiBlocked,
    requiresHuman: input.caseContext.requiresHuman,
    policyStatus: commercialPolicyResult.status,
    conflictingActionExists: false
  };

  const sandboxConfig = buildSandboxAutonomyConfig({
    sandboxEnabled: input.configuration.sandboxAutonomyEnabled,
    autonomousReplyEnabled: input.configuration.autonomousReplyEnabled,
    whitelistedWaIds: [...input.configuration.whitelistedWaIds],
    allowedActionTypes: ["send_whatsapp_reply", "request_more_context"],
    maxRiskLevel: input.scenario.forceRiskLevel ?? "low"
  });

  const executionGateConfig: ExecutionGateConfig = {
    executionGateEnabled: input.configuration.executionGateEnabled,
    outboxBridgeEnabled: input.configuration.outboxBridgeEnabled,
    sandboxModeRequired: input.configuration.sandboxRequired
  };

  const outboxConfig: OutboxWorkerConfig = {
    workerEnabled: input.configuration.outboxWorkerEnabled,
    transportEnabled: input.configuration.messageTransportEnabled,
    workerId: `autonomous-worker:${input.tenantId}`,
    batchSize: 1,
    leaseSeconds: 60,
    defaultMaxAttempts: 3,
    baseRetrySeconds: 30,
    maxRetrySeconds: 3600,
    retryJitterEnabled: false,
    recoverExpiredLeases: false,
    sandboxRequired: input.configuration.sandboxRequired
  };

  const transportConfig: WhatsAppTransportConfig = {
    enabled: input.configuration.messageTransportEnabled,
    sandbox: true,
    graphBaseUrl: AUTONOMOUS_LOOP_GRAPH_BASE_URL,
    graphApiVersion: AUTONOMOUS_LOOP_GRAPH_API_VERSION,
    phoneNumberId: AUTONOMOUS_LOOP_PHONE_NUMBER_ID,
    accessToken: AUTONOMOUS_LOOP_ACCESS_TOKEN,
    timeoutMs: 10_000,
    allowedRecipients: [...input.configuration.whitelistedWaIds],
    requireExactWhitelistMatch: true,
    maxTextLength: 800
  };

  return {
    commercialContext,
    salesAgentResult,
    commercialPolicyResult,
    commercialEvaluationResult,
    brainContext,
    inboundMessage,
    commercialShadowResult,
    operationalLoopInput,
    sandboxContext,
    sandboxConfig,
    executionGateConfig,
    outboxConfig,
    transportConfig
  };
}

export function buildAutonomousLoopStorage(snapshot: import("./types").AutonomousLoopRuntimeSnapshot) {
  return buildOperationalLoopStorage(snapshot);
}
