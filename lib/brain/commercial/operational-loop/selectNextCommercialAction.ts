import type { CommercialPolicyApprovalRequirement, CommercialPolicyRiskLevel } from "../policy";
import type { SalesAgentConfidenceLevel, SalesAgentResult } from "../sales-agent/validationTypes";
import type { CommercialNextAction, CommercialOperationalNextActionSelectionInput } from "./types";

function confidenceOrLow(value: SalesAgentConfidenceLevel | null | undefined): SalesAgentConfidenceLevel {
  return value ?? "low";
}

function approvalOrBlocked(value: CommercialPolicyApprovalRequirement | "review" | "handoff" | null | undefined): CommercialPolicyApprovalRequirement {
  if (value === "review" || value === "handoff") return "operator_review";
  return value ?? "blocked";
}

function riskOrBlocked(value: CommercialPolicyRiskLevel | null | undefined): CommercialPolicyRiskLevel {
  return value ?? "blocked";
}

function buildAction(
  type: CommercialNextAction["type"],
  reason: string,
  input: CommercialOperationalNextActionSelectionInput,
  extras: Partial<Omit<CommercialNextAction, "type" | "reason" | "confidence" | "riskLevel" | "approvalRequirement" | "recommendedChannel" | "executable">> = {}
): CommercialNextAction {
  const confidence = confidenceOrLow(input.salesAgentResult?.analysis.confidence ?? input.salesAgentResult?.decision.confidence ?? "low");
  const approvalRequirement = approvalOrBlocked(input.commercialPolicyResult?.requiresApproval ?? input.salesAgentResult?.decision.requiresApproval ?? "blocked");
  const riskLevel = riskOrBlocked(input.commercialPolicyResult?.riskLevel ?? input.salesAgentResult?.analysis.riskLevel ?? "blocked");
  const recommendedChannel = input.resultingState.channel;

  return {
    type,
    reason,
    confidence,
    riskLevel,
    approvalRequirement,
    recommendedChannel,
    draftMessage: null,
    requiredInformation: [],
    blockedReasons: [],
    executable: false,
    ...extras
  };
}

function getDraftText(result: SalesAgentResult | null | undefined): string | null {
  const text = result?.responseProposal?.draftText;
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getQuestions(result: SalesAgentResult | null | undefined): string[] {
  const questions = result?.responseProposal?.questions;
  return Array.isArray(questions) ? questions.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function getMissingInformation(input: CommercialOperationalNextActionSelectionInput): string[] {
  const rationaleMissing = input.salesAgentResult?.rationale.missingInformation ?? [];
  const next = new Set<string>();
  for (const item of rationaleMissing) {
    if (typeof item === "string" && item.trim()) next.add(item);
  }
  for (const item of input.resultingState.missingRequirements ?? []) {
    const text = typeof item === "string" ? item : JSON.stringify(item);
    if (text.trim()) next.add(text);
  }
  return [...next];
}

export function selectNextCommercialAction(input: CommercialOperationalNextActionSelectionInput): CommercialNextAction {
  const policyStatus = input.commercialPolicyResult?.status ?? null;
  const approvalRequirement = input.commercialPolicyResult?.requiresApproval ?? input.salesAgentResult?.decision.requiresApproval ?? "blocked";
  const blockedByPolicy = policyStatus === "blocked" || approvalRequirement === "blocked";
  const requiresReview = approvalRequirement !== "none" && approvalRequirement !== "blocked";
  const missingInformation = getMissingInformation(input);
  const draftText = getDraftText(input.salesAgentResult);
  const questions = getQuestions(input.salesAgentResult);
  const terminalStatus = ["won", "lost", "cancelled", "archived"].includes(input.previousState?.status ?? input.resultingState.status);

  if (terminalStatus) {
    return buildAction("no_action", "Terminal opportunity state must not be advanced automatically.", input, {
      blockedReasons: ["terminal_state"]
    });
  }

  if (input.identityResolution.isAmbiguous) {
    return buildAction("escalate_to_operator", "Opportunity identity is ambiguous and requires human review.", input, {
      blockedReasons: ["identity_conflict"]
    });
  }

  if (input.resultingState.humanOwnerActive || requiresReview || input.salesAgentResult?.shouldRequestHuman) {
    return buildAction("escalate_to_operator", "Human ownership or approval is active for this opportunity.", input, {
      blockedReasons: input.resultingState.humanOwnerActive ? ["human_owner_active"] : ["approval_required"],
      draftMessage: draftText,
      requiredInformation: missingInformation.length > 0 ? missingInformation : questions
    });
  }

  if (input.resultingState.aiBlocked || blockedByPolicy) {
    return buildAction("no_action", "Commercial policy or AI blocking prevents autonomous action.", input, {
      blockedReasons: [
        ...(input.resultingState.aiBlocked ? ["ai_blocked"] : []),
        ...(blockedByPolicy ? ["policy_blocked"] : [])
      ]
    });
  }

  if (input.previousState?.status === "waiting_customer" && input.salesAgentResult?.outcome !== "response_proposed") {
    return buildAction("wait_for_customer", "The opportunity is already waiting for a customer reply.", input, {
      draftMessage: draftText,
      requiredInformation: missingInformation
    });
  }

  if (input.salesAgentResult?.outcome === "waiting_for_customer" || input.salesAgentResult?.decision.type === "wait_for_customer") {
    return buildAction("wait_for_customer", "The validated result says the system should wait for the customer.", input, {
      draftMessage: draftText,
      requiredInformation: missingInformation
    });
  }

  if (input.salesAgentResult?.outcome === "tool_required" || input.salesAgentResult?.decision.type === "request_tool") {
    return buildAction(
      missingInformation.length > 0 || questions.length > 0 ? "ask_clarifying_question" : "qualify",
      missingInformation.length > 0 || questions.length > 0
        ? "Missing information should be collected before advancing."
        : "The opportunity needs qualification before any further step.",
      input,
      {
        draftMessage: draftText,
        requiredInformation: missingInformation.length > 0 ? missingInformation : questions
      }
    );
  }

  if (input.salesAgentResult?.outcome === "insufficient_context" || input.salesAgentResult?.decision.type === "insufficient_context") {
    return buildAction("ask_clarifying_question", "The current commercial context is insufficient.", input, {
      draftMessage: draftText,
      requiredInformation: missingInformation.length > 0 ? missingInformation : questions
    });
  }

  if (input.salesAgentResult?.decision.type === "request_human") {
    return buildAction("escalate_to_operator", "The validated result explicitly requests human review.", input, {
      draftMessage: draftText,
      requiredInformation: missingInformation.length > 0 ? missingInformation : questions
    });
  }

  if (input.salesAgentResult?.responseProposal) {
    const intent = input.salesAgentResult.responseProposal.messageIntent;
    if (intent === "answer" || intent === "confirm") {
      return buildAction("respond", "The agent proposed an answer-ready response.", input, {
        draftMessage: draftText,
        requiredInformation: missingInformation.length > 0 ? missingInformation : questions
      });
    }
    if (intent === "clarify") {
      return buildAction("ask_clarifying_question", "The agent proposed a clarification response.", input, {
        draftMessage: draftText,
        requiredInformation: missingInformation.length > 0 ? missingInformation : questions
      });
    }
    if (intent === "quote") {
      return buildAction("prepare_quote", "The agent proposed a quote-oriented response.", input, {
        draftMessage: draftText,
        requiredInformation: missingInformation.length > 0 ? missingInformation : questions
      });
    }
    if (intent === "follow_up") {
      return buildAction("propose_followup", "The agent proposed a follow-up style response.", input, {
        draftMessage: draftText,
        requiredInformation: missingInformation.length > 0 ? missingInformation : questions
      });
    }
    if (intent === "handoff") {
      return buildAction("escalate_to_operator", "The agent proposed a human handoff.", input, {
        draftMessage: draftText,
        requiredInformation: missingInformation.length > 0 ? missingInformation : questions
      });
    }
    if (intent === "no_response") {
      return buildAction("wait_for_customer", "The agent proposed waiting for the customer.", input, {
        draftMessage: draftText,
        requiredInformation: missingInformation.length > 0 ? missingInformation : questions
      });
    }
    if (intent === "blocked") {
      return buildAction("no_action", "The response proposal is blocked.", input, {
        blockedReasons: ["policy_blocked"]
      });
    }
    if (intent === "reject") {
      return buildAction("close_as_lost_candidate", "The agent signaled a rejection-style outcome.", input, {
        draftMessage: draftText,
        requiredInformation: missingInformation.length > 0 ? missingInformation : questions
      });
    }
  }

  if (input.salesAgentResult?.decision.type === "respond_now" || input.salesAgentResult?.outcome === "response_proposed") {
    return buildAction("respond", "The validated result is response-ready.", input, {
      draftMessage: draftText,
      requiredInformation: missingInformation.length > 0 ? missingInformation : questions
    });
  }

  if (input.salesAgentResult?.outcome === "no_commercial_action" || input.salesAgentResult?.decision.type === "no_commercial_action") {
    return buildAction("no_action", "No governed commercial action was selected.", input, {
      draftMessage: draftText,
      requiredInformation: missingInformation.length > 0 ? missingInformation : questions
    });
  }

  if (input.salesAgentResult?.decision.type === "failed_safe" || input.salesAgentResult?.outcome === "failed_safe") {
    return buildAction("no_action", "The validated result failed safe.", input, {
      blockedReasons: ["failed_safe"]
    });
  }

  return buildAction("no_action", "No deterministic commercial action was selected.", input, {
    draftMessage: draftText,
    requiredInformation: missingInformation.length > 0 ? missingInformation : questions
  });
}
