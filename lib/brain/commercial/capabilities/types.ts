export const CAPABILITY_RISK_LEVELS = ["read", "low_mutation", "mutation"] as const;
export type CapabilityRiskLevel = (typeof CAPABILITY_RISK_LEVELS)[number];

export const CAPABILITY_EXECUTION_STATUSES = ["succeeded", "unavailable", "invalid_input", "failed"] as const;
export type CapabilityExecutionStatus = (typeof CAPABILITY_EXECUTION_STATUSES)[number];

export type CapabilityExecutionResult = {
  capability: string;
  status: CapabilityExecutionStatus;
  /** Verified data only - an unavailable source yields null, never invented values. */
  data: Record<string, unknown> | null;
  warning: string | null;
};

export type CapabilityDefinition = {
  capability: string;
  description: string;
  riskLevel: CapabilityRiskLevel;
  /**
   * false = declared but with no real source of truth yet; executing it
   * returns `unavailable` explicitly. A capability is never faked as working.
   */
  implemented: boolean;
  execute(input: Record<string, unknown>): Promise<CapabilityExecutionResult>;
};
