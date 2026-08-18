import type { R2AggregateMetrics } from "./metrics";
import type { R2ScenarioScore } from "./types";

export const R2_VERDICTS = ["R2_CORE_VALIDATED", "R2_CORE_VALIDATED_A07_DB_PENDING", "R2_CORE_PARTIAL", "R2_ARCHITECTURE_NOT_VALIDATED"] as const;
export type R2Verdict = (typeof R2_VERDICTS)[number];

export type R2ScenarioOutcome = "PASS" | "FAIL" | "BLOCKED_BY_A07_DB_VALIDATION";

export type R2VerdictInput = {
  /** One entry per corpus scenario id (e.g. "R2-01".."R2-12"). */
  scenarioOutcomes: Record<string, R2ScenarioOutcome>;
  metrics: R2AggregateMetrics;
};

export type R2VerdictResult = {
  verdict: R2Verdict;
  /** Each gate criterion and whether it held - the deliverable doc's closing block reads straight off this. */
  gates: Array<{ criterion: string; passed: boolean; detail: string }>;
};

function scenarioPassed(outcomes: Record<string, R2ScenarioOutcome>, id: string): boolean {
  return outcomes[id] === "PASS";
}

function rateIsZero(value: number | null): boolean {
  return value === 0;
}

/**
 * SALES-AGENT-R2-A07.5, Part 10. Pure - takes already-computed scenario
 * outcomes and aggregate metrics, decides nothing about how they were
 * produced. R2-10/R2-11 BLOCKED_BY_A07_DB_VALIDATION downgrades the verdict
 * to R2_CORE_VALIDATED_A07_DB_PENDING rather than failing the whole gate -
 * per the task's own instruction, a missing A07 DB smoke does not invalidate
 * A03-A06.
 */
export function computeR2Verdict(input: R2VerdictInput): R2VerdictResult {
  const { scenarioOutcomes, metrics } = input;

  const gates: Array<{ criterion: string; passed: boolean; detail: string }> = [
    { criterion: "A03/A04 durable state (R2-01)", passed: scenarioPassed(scenarioOutcomes, "R2-01"), detail: "Simple selection persists and completes durably." },
    { criterion: "A05 multi-step execution (R2-02, C09 equivalent)", passed: scenarioPassed(scenarioOutcomes, "R2-02"), detail: "Selection+destination+shipping represented/completed without depending on a legacy tool budget." },
    { criterion: "A06 retry continuation (R2-05)", passed: scenarioPassed(scenarioOutcomes, "R2-05"), detail: "Temporarily-blocked calculate_shipping recovers via a later worker tick, zero customer input, zero LLM calls." },
    { criterion: "A06 restart/crash recovery (R2-06)", passed: scenarioPassed(scenarioOutcomes, "R2-06"), detail: "A crash after create_quote's real side effect recovers via evidence repair, zero duplicate quote." },
    { criterion: "lostCommercialWorkRate = 0%", passed: rateIsZero(metrics.architecture.lostCommercialWorkRate), detail: `observed ${metrics.architecture.lostCommercialWorkRate ?? "null"}` },
    { criterion: "unbackedCommercialMutationClaimRate = 0%", passed: rateIsZero(metrics.architecture.unbackedCommercialMutationClaimRate), detail: `observed ${metrics.architecture.unbackedCommercialMutationClaimRate ?? "null"}` },
    { criterion: "duplicateSideEffectRate = 0%", passed: rateIsZero(metrics.architecture.duplicateSideEffectRate), detail: `observed ${metrics.architecture.duplicateSideEffectRate ?? "null"}` },
    { criterion: "staleEvidenceExecutionRate = 0%", passed: rateIsZero(metrics.architecture.staleEvidenceExecutionRate), detail: `observed ${metrics.architecture.staleEvidenceExecutionRate ?? "null"}` },
    { criterion: "C09 required objectives durably represented (R2-02)", passed: scenarioPassed(scenarioOutcomes, "R2-02"), detail: "SELECT_PRODUCTS/SET_DESTINATION/GET_SHIPPING_QUOTE all reach a durably-safe status same-cycle." },
    { criterion: "Missing-destination continuation (R2-03/R2-04)", passed: scenarioPassed(scenarioOutcomes, "R2-03") && scenarioPassed(scenarioOutcomes, "R2-04"), detail: "A follow-up turn resumes/correlates the same CommercialWork, selection never lost." },
    { criterion: "Correction/supersession invalidation (R2-08)", passed: scenarioPassed(scenarioOutcomes, "R2-08"), detail: "A quantity correction supersedes the prior selection and invalidates stale downstream shipping evidence." },
    { criterion: "Quote idempotency/recovery (R2-06/R2-09)", passed: scenarioPassed(scenarioOutcomes, "R2-06") && scenarioPassed(scenarioOutcomes, "R2-09"), detail: "create_quote never duplicates under retry, reload or crash recovery." },
    { criterion: "Ambiguity fails closed (R2-07)", passed: scenarioPassed(scenarioOutcomes, "R2-07"), detail: "Zero guessed product; WAITING_CUSTOMER with grounded candidates." },
    { criterion: "Handoff/AI-disabled stop (R2-12)", passed: scenarioPassed(scenarioOutcomes, "R2-12"), detail: "No further autonomous execution once human ownership/AI-disabled applies." }
  ];

  const coreGate = gates.every((gate) => gate.passed);

  const a07Outcomes = [scenarioOutcomes["R2-10"], scenarioOutcomes["R2-11"]];
  const a07Blocked = a07Outcomes.some((outcome) => outcome === "BLOCKED_BY_A07_DB_VALIDATION");
  const a07Passed = a07Outcomes.every((outcome) => outcome === "PASS");
  gates.push(
    { criterion: "Objective-aware follow-up scheduled/sent (R2-10)", passed: scenarioOutcomes["R2-10"] === "PASS", detail: scenarioOutcomes["R2-10"] ?? "not run" },
    { criterion: "Stale follow-up cancellation (R2-11)", passed: scenarioOutcomes["R2-11"] === "PASS", detail: scenarioOutcomes["R2-11"] ?? "not run" }
  );

  let verdict: R2Verdict;
  if (!coreGate) {
    const corePassCount = gates.slice(0, 14).filter((gate) => gate.passed).length;
    verdict = corePassCount === 0 ? "R2_ARCHITECTURE_NOT_VALIDATED" : "R2_CORE_PARTIAL";
  } else if (a07Blocked) {
    verdict = "R2_CORE_VALIDATED_A07_DB_PENDING";
  } else if (a07Passed) {
    verdict = "R2_CORE_VALIDATED";
  } else {
    // A07 DB was available but a scenario actually failed - a real A07 regression, not a pending-infrastructure gap.
    verdict = "R2_CORE_PARTIAL";
  }

  return { verdict, gates };
}
