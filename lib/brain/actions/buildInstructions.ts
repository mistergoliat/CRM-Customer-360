import { BRAIN_INSTRUCTIONS_VERSION } from "../instructions";
import type {
  BrainBotEligibility,
  BrainInstruction,
  BrainInstructions,
  BrainContextSummary,
  BrainNormalizedProcessInboundRequest,
  BrainResolvedContext,
  BrainSuggestedNextStep
} from "../inbound/types";
import type { BrainActionPolicy, BrainInstructionAction, BrainNormalizedAction } from "./types";

export type BrainInstructionBuildState = {
  valid: boolean;
  failClosedReason?: string;
};

export type BrainInstructionBuildEnrichment = {
  contextSummary: BrainContextSummary;
  botEligibility: BrainBotEligibility | null;
  contextPacksAvailable: string[];
  suggestedNextStep: BrainSuggestedNextStep;
  actionPolicy: BrainActionPolicy;
  normalizedAction: BrainNormalizedAction;
  blockedReasons: string[];
};

function makeInstruction(
  id: string,
  kind: BrainInstruction["kind"],
  status: BrainInstruction["status"],
  target: BrainInstruction["target"],
  enabled: boolean,
  reason: string,
  payload?: Record<string, unknown>
): BrainInstruction {
  return {
    id,
    kind,
    status,
    target,
    enabled,
    reason,
    payload
  };
}

export function buildBrainInstructions(
  request: BrainNormalizedProcessInboundRequest,
  context: BrainResolvedContext,
  state: BrainInstructionBuildState,
  enrichment?: BrainInstructionBuildEnrichment
): BrainInstructions {
  const canReturnInstructions = request.options.returnInstructionsForN8n;
  const continueLegacyFlow = enrichment?.actionPolicy?.continue_legacy_flow ?? true;
  const canSuggestShadowCall = canReturnInstructions && request.options.dryRun && state.valid && continueLegacyFlow;
  const blockedReason = state.failClosedReason ?? "Brain foundation is observational only.";
  const contextSummary = enrichment?.contextSummary ?? {
    requestId: context.traceId,
    partialContext: false,
    waId: request.waId,
    phoneNumberId: request.phoneNumberId,
    messageId: request.messageId,
    conversationCaseId: request.conversationCaseId,
    identityType: "unknown",
    identityConfidence: context.confidence,
    activeCaseId: null,
    activeCaseStatus: null,
    caseCount: 0,
    messageCount: 0,
    primaryService: "unknown",
    serviceCode: "unknown",
    botEligible: false,
    botRecommendedMode: "review",
    botReason: "Context summary unavailable.",
    contextPacksAvailable: [],
    warnings: []
  };
  const actionPolicy =
    enrichment?.actionPolicy ??
    ({
      policyId: `brain-action-policy-${context.traceId}`,
      decision: "context_only",
      reason: "Action policy unavailable.",
      blocked_reasons: [],
      can_auto_reply: false,
      can_human_handoff: false,
      can_case_mutation: false,
      continue_legacy_flow: true,
      should_reply: false,
      requires_human: false,
      confidence: context.confidence,
      signals: [],
      suggested_next_step: "context_only"
    } satisfies BrainActionPolicy);
  const normalizedAction =
    enrichment?.normalizedAction ??
    ({
      action: "context_only",
      final_action: "context_only",
      should_reply: false,
      should_continue_legacy_flow: true,
      requires_human: false,
      blocked: false,
      allow_auto_reply: false,
      allow_human_handoff: false,
      allow_case_mutation: false,
      reason: "Action normalization unavailable.",
      blocked_reasons: [],
      signals: []
    } satisfies BrainNormalizedAction);
  const blockedReasons = enrichment?.blockedReasons ?? [];
  const actions: BrainInstructionAction[] = [
    {
      id: "brain-action-router",
      action: normalizedAction.action,
      status: normalizedAction.blocked ? "blocked" : "planned",
      target: "backend",
      enabled: false,
      reason: normalizedAction.reason,
      blocked_reasons: normalizedAction.blocked_reasons,
      payload: {
        actionPolicy,
        normalizedAction,
        blockedReasons
      }
    }
  ];

  const steps: BrainInstruction[] = [
    makeInstruction(
      "continue-legacy-flow",
      "continue_legacy_flow",
      continueLegacyFlow ? "planned" : "blocked",
      "n8n",
      continueLegacyFlow,
      continueLegacyFlow
        ? "Keep the legacy workflow in control while P1D remains in foundation mode."
        : "Legacy flow paused by response policy.",
      {
        legacyFlowPreserved: true,
        continueLegacyFlow,
        source: request.source,
        channel: request.channel,
        messageId: request.messageId
      }
    ),
    makeInstruction(
      "record-observation",
      "record_observation",
      "planned",
      "n8n",
      canReturnInstructions,
      canReturnInstructions
        ? "Return structured instructions to n8n for logging and later comparison."
        : "returnInstructionsForN8n=false removed the detailed observation payload.",
      {
        traceId: context.traceId,
        waId: request.waId,
        phoneNumberId: request.phoneNumberId,
        conversationCaseId: request.conversationCaseId ?? null
      }
    ),
    makeInstruction(
      "resolve-action-policy",
      "noop",
      "planned",
      "backend",
      true,
      "Resolve deterministic response policy and router state without side effects.",
      {
        policyId: actionPolicy.policyId,
        decision: actionPolicy.decision,
        blockedReasons,
        suggestedNextStep: actionPolicy.suggested_next_step
      }
    ),
    makeInstruction(
      "shadow-ai-orchestrator",
      "shadow_ai_orchestrator_call",
      canSuggestShadowCall ? "planned" : "blocked",
      "n8n",
      canSuggestShadowCall,
      canSuggestShadowCall
        ? "n8n can later use this instruction to invoke /api/ai/orchestrate in shadow mode."
        : blockedReason,
      {
        endpoint: "/api/ai/orchestrate",
        dryRun: true,
        executeActions: false,
        returnInstructionsForN8n: true,
        waId: request.waId,
        phoneNumberId: request.phoneNumberId,
        messageId: request.messageId,
        conversationCaseId: request.conversationCaseId ?? null
      }
    )
  ];

  return {
    version: BRAIN_INSTRUCTIONS_VERSION,
    dryRun: request.options.dryRun,
    executeActions: request.options.executeActions,
    returnInstructionsForN8n: request.options.returnInstructionsForN8n,
    continueLegacyFlow,
    contextSummary,
    actionPolicy,
    normalizedAction,
    blockedReasons,
    contextPacksAvailable: enrichment?.contextPacksAvailable ?? [],
    botEligibility: enrichment?.botEligibility ?? null,
    suggestedNextStep: enrichment?.suggestedNextStep ?? "context_only",
    actions,
    steps
  };
}
