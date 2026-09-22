import type { ContinuityAuditRunResult } from "./runContinuityAudit";
import type { ContinuityConversationLabel, ContinuityTurnTrace } from "./types";
import { CONTINUITY_CONVERSATION_LABELS } from "./types";

/**
 * P7.13 (task sections 40-41/48-49/53). Deterministic aggregate metrics and
 * the preregistered signal, computed the same way regardless of what the
 * numbers turn out to be - never tuned after seeing a run's result (section
 * 44: "no tocar durante ejecución").
 */

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function bucketOf(localIndex: number, planLength: number): "early" | "middle" | "late" {
  const fraction = localIndex / planLength;
  if (fraction < 0.25) return "early";
  if (fraction < 0.75) return "middle";
  return "late";
}

export type ContinuityDepthBucketMetrics = {
  bucket: string;
  turns: number;
  toolComplianceRate: number | null;
  reQuestionRate: number | null;
  regreetingRate: number | null;
  falseSuccessRate: number | null;
  avgProviderInputTokens: number | null;
};

export function computeDepthBuckets(turns: readonly ContinuityTurnTrace[], planLengths: Record<ContinuityConversationLabel, number>): ContinuityDepthBucketMetrics[] {
  const buckets = ["early", "middle", "late"] as const;
  return buckets.map((bucket) => {
    const inBucket = turns.filter((turn) => bucketOf(turn.localIndex, planLengths[turn.conversation]) === bucket);
    const actionable = inBucket.filter((turn) => turn.toolCalls.length > 0 || turn.category.includes("PROBE"));
    const toolCompliant = inBucket.filter((turn) => turn.toolCalls.length > 0);
    const tokens = inBucket.map((turn) => turn.providerCalls[turn.providerCalls.length - 1]?.inputTokens ?? null).filter((value): value is number => value !== null);
    return {
      bucket,
      turns: inBucket.length,
      toolComplianceRate: rate(toolCompliant.length, actionable.length),
      reQuestionRate: rate(inBucket.filter((turn) => turn.missingFactKind !== null).length, inBucket.length),
      regreetingRate: rate(inBucket.filter((turn) => turn.regreeted).length, inBucket.length),
      falseSuccessRate: rate(inBucket.filter((turn) => turn.falseSuccessClaim).length, inBucket.length),
      avgProviderInputTokens: tokens.length > 0 ? tokens.reduce((sum, value) => sum + value, 0) / tokens.length : null
    };
  });
}

export type ContinuitySummary = {
  totals: {
    turns: number;
    modelCalls: number;
    toolCalls: number;
    compactionCount: number;
    cumulativeInputTokens: number;
    cumulativeOutputTokens: number;
  };
  factSurvivalRate: number | null;
  reQuestionRate: number | null;
  regreetingRate: number | null;
  objectiveResetRate: number | null;
  falseSuccessRate: number | null;
  crossConversationLeak: boolean;
  durableToDrmConsistencyRate: number | null;
  depthBuckets: ContinuityDepthBucketMetrics[];
  perConversation: Record<ContinuityConversationLabel, { turns: number; compactions: number; failures: number }>;
  preregisteredSignal: string;
  preregisteredSignalReason: string;
};

export function buildContinuitySummary(result: ContinuityAuditRunResult): ContinuitySummary {
  const { allTurns, failures, compactionEvents } = result;
  const planLengths = Object.fromEntries(CONTINUITY_CONVERSATION_LABELS.map((label) => [label, result.plans[label].length])) as Record<ContinuityConversationLabel, number>;

  const modelCalls = allTurns.reduce((sum, turn) => sum + turn.providerCalls.length, 0);
  const toolCalls = allTurns.reduce((sum, turn) => sum + turn.toolCalls.length, 0);
  const inputTokens = allTurns.reduce((sum, turn) => sum + turn.providerCalls.reduce((s, call) => s + (call.inputTokens ?? 0), 0), 0);
  const outputTokens = allTurns.reduce((sum, turn) => sum + turn.providerCalls.reduce((s, call) => s + (call.outputTokens ?? 0), 0), 0);

  const survivalChecks = allTurns.flatMap((turn) => {
    const plan = result.plans[turn.conversation][turn.localIndex];
    return plan.factsThatMustSurvive.map((factKey) => turn.durableFactsAfter[factKey] !== null && turn.durableFactsAfter[factKey] !== undefined);
  });
  const factSurvivalRate = rate(survivalChecks.filter(Boolean).length, survivalChecks.length);

  const reQuestionProbes = allTurns.filter((turn) => turn.probe?.probeType === "RE_QUESTION");
  const reQuestionFailures = failures.filter((failure) => failure.category === "MODEL_REASKED_VISIBLE_FACT");
  const reQuestionRate = rate(reQuestionFailures.length, reQuestionProbes.length);

  const regreetingRate = rate(allTurns.filter((turn) => turn.regreeted).length, allTurns.length);
  const objectiveResetRate = rate(failures.filter((failure) => failure.category === "OBJECTIVE_RESET").length, allTurns.filter((turn) => turn.probe?.probeType === "OBJECTIVE_SURVIVAL").length);
  const falseSuccessRate = rate(allTurns.filter((turn) => turn.falseSuccessClaim).length, allTurns.filter((turn) => turn.terminalReason === "responded").length);

  const crossConversationLeak = allTurns.some((turn) => turn.invariantChecks.some((check) => check.name === "crossConversationIsolation" && !check.ok));
  const consistencyChecks = allTurns.flatMap((turn) => turn.invariantChecks.filter((check) => check.name === "durableToDrmDestinationConsistency"));
  const durableToDrmConsistencyRate = rate(consistencyChecks.filter((check) => check.ok).length, consistencyChecks.length);

  const depthBuckets = computeDepthBuckets(allTurns, planLengths);
  const earlyCompliance = depthBuckets.find((bucket) => bucket.bucket === "early")?.toolComplianceRate ?? null;
  const lateCompliance = depthBuckets.find((bucket) => bucket.bucket === "late")?.toolComplianceRate ?? null;
  const earlyReQuestion = depthBuckets.find((bucket) => bucket.bucket === "early")?.reQuestionRate ?? null;
  const lateReQuestion = depthBuckets.find((bucket) => bucket.bucket === "late")?.reQuestionRate ?? null;

  const perConversation = Object.fromEntries(
    CONTINUITY_CONVERSATION_LABELS.map((label) => [
      label,
      {
        turns: result.turnsByConversation[label].length,
        compactions: compactionEvents.filter((event) => event.conversation === label).length,
        failures: failures.filter((failure) => failure.conversation === label).length
      }
    ])
  ) as Record<ContinuityConversationLabel, { turns: number; compactions: number; failures: number }>;

  const criticalFailures = failures.filter((failure) => failure.severity === "CRITICAL");
  const compactionLossEvents = compactionEvents.filter((event) => event.factLost.length > 0);
  const toolComplianceDropPp = earlyCompliance !== null && lateCompliance !== null ? (earlyCompliance - lateCompliance) * 100 : null;
  const reQuestionRisePp = earlyReQuestion !== null && lateReQuestion !== null ? (lateReQuestion - earlyReQuestion) * 100 : null;
  const materialDecay = (toolComplianceDropPp !== null && toolComplianceDropPp >= 20) || (reQuestionRisePp !== null && reQuestionRisePp >= 20);

  let preregisteredSignal: string;
  let preregisteredSignalReason: string;
  if (crossConversationLeak || criticalFailures.some((failure) => failure.category === "SOURCE_FACT_MISSING" || failure.category === "AGENT_INPUT_LOSS")) {
    preregisteredSignal = "R3_CONTEXT_PIPELINE_FAILURE";
    preregisteredSignalReason = "facts disappeared/changed between durable state and the provider-visible context";
  } else if (compactionLossEvents.length > 0) {
    preregisteredSignal = "R3_COMPACTION_LOSS";
    preregisteredSignalReason = `current commercial truth lost from the summary coinciding with a compaction (${compactionLossEvents.length} event(s))`;
  } else if (materialDecay) {
    preregisteredSignal = "R3_MODEL_POLICY_DEGRADATION";
    preregisteredSignalReason = `provider-visible truth/tool surfaces stayed correct, but tool compliance/re-question rate degraded with depth (compliance drop=${toolComplianceDropPp?.toFixed(1)}pp, re-question rise=${reQuestionRisePp?.toFixed(1)}pp)`;
  } else if (criticalFailures.length === 0 && factSurvivalRate !== null && factSurvivalRate >= 0.99) {
    preregisteredSignal = "R3_CONTINUITY_STABLE";
    preregisteredSignalReason = "0 critical continuity failures, fact retention stable, no material behavioral decay by depth";
  } else {
    preregisteredSignal = "MIXED_CONTINUITY_FAILURE";
    preregisteredSignalReason = "multiple layers show degradation without a single dominant cause";
  }

  return {
    totals: { turns: allTurns.length, modelCalls, toolCalls, compactionCount: compactionEvents.length, cumulativeInputTokens: inputTokens, cumulativeOutputTokens: outputTokens },
    factSurvivalRate,
    reQuestionRate,
    regreetingRate,
    objectiveResetRate,
    falseSuccessRate,
    crossConversationLeak,
    durableToDrmConsistencyRate,
    depthBuckets,
    perConversation,
    preregisteredSignal,
    preregisteredSignalReason
  };
}
