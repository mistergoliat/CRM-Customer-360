import type { BrainActionPolicy, BrainActionResolveRequest, BrainNormalizedAction } from "./types";

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isEmptyMessage(messageText: string) {
  return normalizeText(messageText).length === 0;
}

function hasAny(text: string, terms: string[]) {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function buildBlockedReasons(request: BrainActionResolveRequest) {
  const reasons: string[] = [];
  const signals = request.botEligibility?.signals;

  if (request.options.executeActions) reasons.push("execute_actions_disabled");
  if (signals?.suppression_active) reasons.push("suppression_active");
  if (signals?.active_human_case) reasons.push("active_human_case");
  if (signals?.recent_manual_reply) reasons.push("recent_manual_reply");
  if (signals?.closed_or_rejected_case) reasons.push("closed_or_rejected_case");
  if (signals?.manual_operator_lock) reasons.push("manual_operator_lock");
  if (request.contextSummary.partialContext) reasons.push("partial_context");

  return reasons;
}

function buildDecision(request: BrainActionResolveRequest, blockedReasons: string[]): BrainNormalizedAction["action"] {
  if (request.options.executeActions) return "blocked";

  const cleanMessage = normalizeText(request.messageText);
  if (isEmptyMessage(request.messageText)) return "no_action";

  const signals = request.botEligibility?.signals;
  if (signals?.suppression_active) return "blocked";
  if (signals?.active_human_case) return "needs_human_review";
  if (signals?.recent_manual_reply) return "needs_human_review";

  if (signals?.closed_or_rejected_case) return "continue_legacy";

  if (signals?.ambiguous_positive_reply_with_service_context) {
    return "needs_human_review";
  }

  if (request.botEligibility && !request.botEligibility.can_auto_reply) {
    return blockedReasons.length > 0 ? "blocked" : "needs_human_review";
  }

  if (request.serviceContext.service_code === "unknown" || request.contextSummary.partialContext) {
    return "context_only";
  }

  if (hasAny(cleanMessage, ["gracias", "ok", "okey", "dale", "si", "sí", "confirmo"]) && request.serviceContext.service_code !== "unknown") {
    return "needs_human_review";
  }

  return "continue_legacy";
}

export function resolveBrainResponsePolicy(request: BrainActionResolveRequest): BrainActionPolicy {
  const blocked_reasons = buildBlockedReasons(request);
  const decision = buildDecision(request, blocked_reasons);
  const botEligibility = request.botEligibility;
  const signals = botEligibility ? Object.entries(botEligibility.signals).filter(([, value]) => value).map(([key]) => key) : [];
  const canAutoReply = Boolean(botEligibility?.can_auto_reply) && decision !== "blocked" && decision !== "needs_human_review" && decision !== "no_action";
  const canHumanHandoff = Boolean(botEligibility?.can_human_handoff) && decision !== "blocked";
  const canCaseMutation = Boolean(botEligibility?.can_case_mutation) && decision === "continue_legacy";
  const continueLegacyFlow = decision !== "blocked" && decision !== "no_action";
  const shouldReply = decision === "continue_legacy" && canAutoReply;
  const requiresHuman = decision === "needs_human_review" || blocked_reasons.includes("active_human_case") || blocked_reasons.includes("recent_manual_reply");
  const confidence = request.contextSummary.identityConfidence > 0 ? request.contextSummary.identityConfidence : 0.5;

  return {
    policyId: `brain-action-policy-${request.requestId ?? request.messageId}`,
    decision,
    reason:
      decision === "blocked"
        ? blocked_reasons[0] ?? "Action policy blocked."
        : decision === "no_action"
          ? "Empty message or no actionable content."
          : decision === "needs_human_review"
            ? "Policy requires human review before action."
            : decision === "context_only"
              ? "Context is available but policy keeps this read-only."
              : "Policy allows legacy continuation for now.",
    blocked_reasons,
    can_auto_reply: canAutoReply,
    can_human_handoff: canHumanHandoff,
    can_case_mutation: canCaseMutation,
    continue_legacy_flow: continueLegacyFlow,
    should_reply: shouldReply,
    requires_human: requiresHuman,
    confidence,
    signals,
    suggested_next_step:
      decision === "blocked"
        ? "blocked_by_bot_eligibility"
        : decision === "needs_human_review"
          ? "needs_human_review"
          : decision === "context_only"
            ? "context_only"
            : "legacy_continue"
  };
}
