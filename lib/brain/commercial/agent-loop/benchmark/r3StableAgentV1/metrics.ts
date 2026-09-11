import { GOLDEN_CASE_CATEGORIES, GOLDEN_SCORE_VALUES } from "./types";
import type { GoldenCaseCategory, GoldenCaseScore, GoldenDimension, GoldenRunResult, GoldenScoreValue } from "./types";

/**
 * R3 Stable Agent Acceptance Harness V1, section 5/8. Pure aggregation over
 * already-produced results - never re-runs or re-classifies anything.
 */

function rate(pass: number, fail: number): number | null {
  const denominator = pass + fail;
  return denominator === 0 ? null : pass / denominator;
}

export type GoldenDimensionTally = { PASS: number; FAIL: number; NOT_APPLICABLE: number; UNVERIFIABLE: number; passRate: number | null };

function tallyDimension(scores: GoldenCaseScore[], dimension: GoldenDimension): GoldenDimensionTally {
  const tally: Record<GoldenScoreValue, number> = { PASS: 0, FAIL: 0, NOT_APPLICABLE: 0, UNVERIFIABLE: 0 };
  for (const score of scores) tally[score.dimensions[dimension]] += 1;
  return { ...tally, passRate: rate(tally.PASS, tally.FAIL) };
}

export type GoldenCategoryMetrics = {
  category: GoldenCaseCategory;
  totalRuns: number;
  overallPassRate: number | null;
  dimensions: Record<GoldenDimension, GoldenDimensionTally>;
};

export type GoldenBaselineMetrics = {
  noToolCorrectness: number | null;
  simpleToolSelection: number | null;
  boundaryToolSelection: number | null;
  argumentStructureValidity: number | null;
  argumentSemanticCorrectness: number | null;
  observationReplanCorrectness: number | null;
  mutationGrounding: number | null;
  taskCompletion: number | null;
};

export type GoldenAggregateMetrics = {
  totalRuns: number;
  overallPassRate: number | null;
  falseCommercialConfirmationCount: number;
  byCategory: Record<GoldenCaseCategory, GoldenCategoryMetrics>;
  baseline: GoldenBaselineMetrics;
};

function scoresOf(results: GoldenRunResult[]): GoldenCaseScore[] {
  return results.map((result) => result.score);
}

function computeCategoryMetrics(category: GoldenCaseCategory, scores: GoldenCaseScore[]): GoldenCategoryMetrics {
  const categoryScores = scores.filter((score) => score.category === category);
  const passCount = categoryScores.filter((score) => score.overallPass).length;
  const dimensions = Object.fromEntries(
    (["actionTypePass", "toolSelectionPass", "argumentStructurePass", "argumentSemanticsPass", "evidenceGroundingPass", "observationReplanPass", "mutationGroundingPass", "taskCompletionPass"] as GoldenDimension[]).map(
      (dimension) => [dimension, tallyDimension(categoryScores, dimension)]
    )
  ) as Record<GoldenDimension, GoldenDimensionTally>;

  return { category, totalRuns: categoryScores.length, overallPassRate: rate(passCount, categoryScores.length - passCount), dimensions };
}

export function computeGoldenAggregateMetrics(results: GoldenRunResult[]): GoldenAggregateMetrics {
  const scores = scoresOf(results);
  const totalRuns = scores.length;
  const overallPassCount = scores.filter((score) => score.overallPass).length;

  const byCategory = Object.fromEntries(GOLDEN_CASE_CATEGORIES.map((category) => [category, computeCategoryMetrics(category, scores)])) as Record<GoldenCaseCategory, GoldenCategoryMetrics>;

  const falseCommercialConfirmationCount = scores.filter((score) => score.falseCommercialConfirmation).length;

  return {
    totalRuns,
    overallPassRate: rate(overallPassCount, totalRuns - overallPassCount),
    falseCommercialConfirmationCount,
    byCategory,
    baseline: {
      noToolCorrectness: byCategory.NO_TOOL.overallPassRate,
      simpleToolSelection: byCategory.SIMPLE_TOOL_SELECTION.dimensions.toolSelectionPass.passRate,
      boundaryToolSelection: byCategory.TOOL_BOUNDARY.dimensions.toolSelectionPass.passRate,
      argumentStructureValidity: rate(
        scores.filter((score) => score.dimensions.argumentStructurePass === "PASS").length,
        scores.filter((score) => score.dimensions.argumentStructurePass === "FAIL").length
      ),
      argumentSemanticCorrectness: rate(
        scores.filter((score) => score.dimensions.argumentSemanticsPass === "PASS").length,
        scores.filter((score) => score.dimensions.argumentSemanticsPass === "FAIL").length
      ),
      observationReplanCorrectness: byCategory.OBSERVATION_REPLAN.dimensions.observationReplanPass.passRate,
      mutationGrounding: rate(
        scores.filter((score) => score.dimensions.mutationGroundingPass === "PASS").length,
        scores.filter((score) => score.dimensions.mutationGroundingPass === "FAIL").length
      ),
      taskCompletion: rate(
        scores.filter((score) => score.dimensions.taskCompletionPass === "PASS").length,
        scores.filter((score) => score.dimensions.taskCompletionPass === "FAIL").length
      )
    }
  };
}

/**
 * Task section 8's own explicit acceptance targets - never used to hide
 * failures, only reported alongside the measured rate. argumentSemanticCorrectness
 * and taskCompletion have no explicit target in the task's own threshold list
 * (section 5 asks for the metric, section 8 does not name a number for it) -
 * left null rather than inventing one.
 */
export const GOLDEN_BASELINE_THRESHOLDS: Record<keyof GoldenBaselineMetrics, number | null> = {
  noToolCorrectness: 0.95,
  simpleToolSelection: 0.9,
  boundaryToolSelection: 0.8,
  argumentStructureValidity: 0.95,
  argumentSemanticCorrectness: null,
  observationReplanCorrectness: 0.85,
  mutationGrounding: 1,
  taskCompletion: null
};

export { GOLDEN_SCORE_VALUES };
