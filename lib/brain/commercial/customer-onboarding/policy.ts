import type { AiSdrOperationalDecision, CustomerOnboardingAction, ToolRiskLevel } from "./types";

export type CustomerOnboardingPolicyDecision = {
  allowed: boolean;
  requiresCustomerConfirmation: boolean;
  requiresHumanApproval: boolean;
  riskLevel: ToolRiskLevel;
  reason: string;
  policyTags: string[];
};

export function assessCustomerOnboardingToolPolicy(action: CustomerOnboardingAction, options: { customerConfirmed: boolean; conflict: boolean; dbWriteEnabled: boolean }): CustomerOnboardingPolicyDecision {
  if (options.conflict) {
    return {
      allowed: false,
      requiresCustomerConfirmation: false,
      requiresHumanApproval: true,
      riskLevel: "high",
      reason: "Identity conflict requires human review.",
      policyTags: ["identity_conflict"]
    };
  }

  if (action === "lookup_customer" || action === "ask_email" || action === "load_customer_context" || action === "continue_sales_flow") {
    return {
      allowed: true,
      requiresCustomerConfirmation: false,
      requiresHumanApproval: false,
      riskLevel: "low",
      reason: "Read-only onboarding step allowed.",
      policyTags: ["read_only"]
    };
  }

  if (action === "offer_customer_creation") {
    return {
      allowed: true,
      requiresCustomerConfirmation: false,
      requiresHumanApproval: false,
      riskLevel: "low",
      reason: "Offering creation is a low risk informational step.",
      policyTags: ["offer_creation"]
    };
  }

  if (action === "link_customer") {
    return {
      allowed: true,
      requiresCustomerConfirmation: false,
      requiresHumanApproval: false,
      riskLevel: "low",
      reason: "Exact link is allowed when identity is unique.",
      policyTags: ["exact_link"]
    };
  }

  if (action === "create_customer") {
    return {
      allowed: options.customerConfirmed,
      requiresCustomerConfirmation: true,
      requiresHumanApproval: false,
      riskLevel: "medium",
      reason: options.customerConfirmed ? "Explicit customer confirmation received." : "Creation requires explicit confirmation.",
      policyTags: ["customer_confirmation"]
    };
  }

  return {
    allowed: false,
    requiresCustomerConfirmation: false,
    requiresHumanApproval: true,
    riskLevel: "high",
    reason: "Onboarding action is not permitted by policy.",
    policyTags: ["blocked"]
  };
}

export function buildOperationalDecision(input: {
  intent: string;
  action: CustomerOnboardingAction;
  tool: AiSdrOperationalDecision["tool"];
  args?: Record<string, unknown>;
  requiresCustomerConfirmation?: boolean;
  requiresHumanApproval?: boolean;
  confidence?: number;
  reason: string;
  policyTags?: string[];
}): AiSdrOperationalDecision {
  return {
    intent: input.intent,
    action: input.action,
    tool: input.tool,
    arguments: input.args ?? {},
    requiresCustomerConfirmation: input.requiresCustomerConfirmation ?? false,
    requiresHumanApproval: input.requiresHumanApproval ?? false,
    confidence: input.confidence ?? 0.5,
    reason: input.reason,
    policyTags: input.policyTags ?? []
  };
}
