import { classifyStepSafety, isReadOnlyStep, stepsConflict } from "./parallelStepConflictModel";
import type { CommercialWorkStep } from "./types";

/**
 * SALES-AGENT-R2-A09, Part 2/11. The execution-wave primitive: given a list
 * of steps already proven READY and dependency-satisfied (the same filter
 * commercialWorkExecutor.ts's selectNextReadyStep already applies - this
 * function never re-derives dependency satisfaction, only conflicts among
 * steps that already cleared it), choose the maximal safe subset that may
 * execute concurrently this round.
 *
 * Deterministic, no LLM, no I/O. Pure function of its input.
 */

export type ExecutionWaveDecisionReason =
  | "parallel_safe"
  | "primary_step"
  | "deferred_mutating"
  | "deferred_write_conflict"
  | "deferred_unknown_governance"
  | "deferred_max_parallelism"
  | "deferred_parallel_execution_disabled";

export type ExecutionWaveDecision = {
  stepId: string;
  decision: ExecutionWaveDecisionReason;
  conflictsWithStepId?: string;
};

export type BuildSafeExecutionWaveInput = {
  /** Already READY + dependency-satisfied, sorted by the caller's own priority/stepId order - the first entry is what pre-A09 sequential execution would have picked alone. */
  readyCandidates: readonly CommercialWorkStep[];
  parallelExecutionEnabled: boolean;
  maxParallelSteps: number;
};

export type BuildSafeExecutionWaveResult = {
  /** 1..N steps to execute this round, in stable order (Part 15's deterministic result-application order reuses this same order). */
  wave: CommercialWorkStep[];
  deferred: CommercialWorkStep[];
  decisions: ExecutionWaveDecision[];
};

export function buildSafeExecutionWave(input: BuildSafeExecutionWaveInput): BuildSafeExecutionWaveResult {
  const [primary, ...rest] = input.readyCandidates;
  if (!primary) return { wave: [], deferred: [], decisions: [] };

  // Part 5/13. Flag OFF (or nothing beyond the primary step to consider) is
  // byte-for-byte the pre-A09 behavior: exactly one step, the same one
  // selectNextReadyStep would have picked.
  if (!input.parallelExecutionEnabled) {
    return {
      wave: [primary],
      deferred: [...rest],
      decisions: [
        { stepId: primary.stepId, decision: "primary_step" },
        ...rest.map((step): ExecutionWaveDecision => ({ stepId: step.stepId, decision: "deferred_parallel_execution_disabled" }))
      ]
    };
  }

  const decisions: ExecutionWaveDecision[] = [{ stepId: primary.stepId, decision: "primary_step" }];
  const wave: CommercialWorkStep[] = [primary];
  const deferred: CommercialWorkStep[] = [];

  // Part 5/22. A mutating primary step never gains parallel siblings in this
  // policy - the wave is just that one step, identical to sequential mode.
  // Only a read_only primary step is ever eligible to be widened.
  const primaryEligible = isReadOnlyStep(primary);

  for (const candidate of rest) {
    if (wave.length >= Math.max(1, input.maxParallelSteps)) {
      deferred.push(candidate);
      decisions.push({ stepId: candidate.stepId, decision: "deferred_max_parallelism" });
      continue;
    }
    if (!primaryEligible) {
      deferred.push(candidate);
      decisions.push({ stepId: candidate.stepId, decision: "deferred_mutating" });
      continue;
    }
    const candidateSafety = classifyStepSafety(candidate);
    if (candidateSafety !== "read_only") {
      deferred.push(candidate);
      decisions.push({ stepId: candidate.stepId, decision: candidateSafety === "mutating" ? "deferred_mutating" : "deferred_unknown_governance" });
      continue;
    }
    const conflict = wave.find((waveStep) => stepsConflict(waveStep, candidate));
    if (conflict) {
      deferred.push(candidate);
      decisions.push({ stepId: candidate.stepId, decision: "deferred_write_conflict", conflictsWithStepId: conflict.stepId });
      continue;
    }
    wave.push(candidate);
    decisions.push({ stepId: candidate.stepId, decision: "parallel_safe" });
  }

  return { wave, deferred, decisions };
}
