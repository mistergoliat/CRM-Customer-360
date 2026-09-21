import type { BenchmarkE2EFlagsConfig } from "../r3CommercialE2E/types";
import { AUTONOMOUS_PROMPT_VERSION, buildAutonomousStepPromptPackage } from "./autonomousPrompt";

/**
 * SALES-AGENT-R3-P7.8. The complete definition of the A/B difference. Every
 * other input of a run (case, fixtures, identity, model, provider config,
 * timeouts, loop budgets, message model, open-turn, DB, tools, Gateway) is
 * built once by the runner and is identical for both variants.
 */
export const AB_VARIANT_IDS = ["A_HYBRID", "B_AUTONOMOUS"] as const;
export type AbVariantId = (typeof AB_VARIANT_IDS)[number];

export type AbVariantDefinition = {
  id: AbVariantId;
  label: string;
  /** undefined = the production hybrid buildAgentStepPromptPackage (the loop's default), untouched. */
  promptBuilder: typeof buildAutonomousStepPromptPackage | undefined;
  promptVersion: string;
  /** The ONLY flags that differ between the variants - all three are cognitive-layer switches. */
  flagOverrides: Partial<BenchmarkE2EFlagsConfig>;
  cognition: {
    /** P6.3 vista `capabilityEligibility` rendered to the model. */
    eligibilityInfluencedCognition: boolean;
    /** P4: the model is asked to emit a CommercialProposal on terminal steps. */
    commercialProposalRequestedFromModel: boolean;
    /** P5: proposal -> durable objective reconciliation runs. */
    objectiveReconciliationRuns: boolean;
    /** P6.2 post-P5 shadow event is still recorded for telemetry in both variants (never read by cognition). */
    eligibilityShadowTelemetry: boolean;
  };
};

export const AB_VARIANTS: Readonly<Record<AbVariantId, AbVariantDefinition>> = {
  A_HYBRID: {
    id: "A_HYBRID",
    label: "Hybrid R3 (P7.7 state): DRM + P6.3 eligibility view + P4 proposal + P5 + hybrid prompt policy",
    promptBuilder: undefined,
    promptVersion: "hybrid-current@P7.7",
    flagOverrides: {},
    cognition: { eligibilityInfluencedCognition: true, commercialProposalRequestedFromModel: true, objectiveReconciliationRuns: true, eligibilityShadowTelemetry: true }
  },
  B_AUTONOMOUS: {
    id: "B_AUTONOMOUS",
    label: "Autonomous DeepSeek harness: minimal prompt, same tools/Gateway/state; P4/P5/P6-view removed from the critical path",
    promptBuilder: buildAutonomousStepPromptPackage,
    promptVersion: AUTONOMOUS_PROMPT_VERSION,
    flagOverrides: {
      capabilityEligibilityInputEnabled: false,
      commercialProposalShadowEnabled: false,
      commercialObjectiveReconciliationEnabled: false
    },
    cognition: { eligibilityInfluencedCognition: false, commercialProposalRequestedFromModel: false, objectiveReconciliationRuns: false, eligibilityShadowTelemetry: true }
  }
};

export function resolveVariantFlags(base: BenchmarkE2EFlagsConfig, variant: AbVariantId): BenchmarkE2EFlagsConfig {
  return { ...base, ...AB_VARIANTS[variant].flagOverrides };
}

/** Keys whose value differs between the two variants' effective flags - the machine-checkable statement of "only the cognitive layer changed". */
export function diffVariantFlags(base: BenchmarkE2EFlagsConfig): string[] {
  const a = resolveVariantFlags(base, "A_HYBRID");
  const b = resolveVariantFlags(base, "B_AUTONOMOUS");
  return (Object.keys(a) as (keyof BenchmarkE2EFlagsConfig)[]).filter((key) => a[key] !== b[key]).map(String);
}
