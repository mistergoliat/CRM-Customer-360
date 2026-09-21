/**
 * SALES-AGENT-R3-P7.8-R. Re-analyzes an already-recorded batch (no model call, no DB) with both quantity-request
 * detectors, leaving the pre-registered files (summary.json / comparison.json, "legacy" detector) untouched and
 * writing summary.corrected.json / comparison.corrected.json ("strict" detector) next to them.
 *
 *   npx tsx scripts/r3-true-ab-reanalyze.ts benchmark-results/<true-ab-run-dir>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareArms, computeTrueArmMetrics, TRUE_ARM_IDS, type TrueArmId, type TrueArmMetrics, type TrueRunRecord } from "../lib/brain/commercial/agent-loop/benchmark/r3TrueAB/trueAnalysis";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: r3-true-ab-reanalyze.ts <benchmark-results/true-ab-run-dir>");
  process.exit(1);
}

const records = readFileSync(join(dir, "runs.jsonl"), "utf8").split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as TrueRunRecord);
const original = JSON.parse(readFileSync(join(dir, "comparison.json"), "utf8")) as Record<string, unknown>;

const build = (detector: "legacy" | "strict") => Object.fromEntries(TRUE_ARM_IDS.map((arm) => [arm, computeTrueArmMetrics(arm, records, detector)])) as Record<TrueArmId, TrueArmMetrics>;
const legacy = build("legacy");
const strict = build("strict");
const legacyComparison = compareArms(legacy);
const strictComparison = compareArms(strict);

writeFileSync(join(dir, "summary.corrected.json"), JSON.stringify(strict, null, 2), "utf8");
writeFileSync(
  join(dir, "comparison.corrected.json"),
  JSON.stringify(
    {
      ...strictComparison,
      complexity: original.complexity,
      toolSurfaces: original.toolSurfaces,
      measurementCorrection: {
        what: "Quantity-request detector. The pre-registered (legacy) pattern matched any 'unidades' plus any question, so a link offer after 'Quedan 15 unidades disponibles' counted as asking for the quantity. The strict detector requires a question that asks how many / which quantity. It was validated against a manual reading of all 54 Q- replies (no disagreement) and is applied identically to every arm. No run was repeated.",
        preRegisteredSignal: legacyComparison.architectureSignal.signal,
        correctedSignal: strictComparison.architectureSignal.signal,
        preRegisteredFixedCohortProgress: Object.fromEntries(TRUE_ARM_IDS.map((arm) => [arm, legacy[arm].commercialProgressFixedCohortRate])),
        correctedFixedCohortProgress: Object.fromEntries(TRUE_ARM_IDS.map((arm) => [arm, strict[arm].commercialProgressFixedCohortRate])),
        preRegisteredQMinusRequestQuantity: Object.fromEntries(TRUE_ARM_IDS.map((arm) => [arm, legacy[arm].qMinus.requestQuantityRateWhenMissing])),
        correctedQMinusRequestQuantity: Object.fromEntries(TRUE_ARM_IDS.map((arm) => [arm, strict[arm].qMinus.requestQuantityRateWhenMissing]))
      }
    },
    null,
    2
  ),
  "utf8"
);

const R = (x: { numerator: number; denominator: number }) => `${x.numerator}/${x.denominator}`;
for (const arm of TRUE_ARM_IDS) {
  console.log(`${arm.padEnd(22)} fixed(legacy)=${R(legacy[arm].commercialProgressFixedCohortRate)} fixed(strict)=${R(strict[arm].commercialProgressFixedCohortRate)}  grounded(strict)=${R(strict[arm].commercialProgressAfterGroundingRate)}  Q-ask(strict)=${R(strict[arm].qMinus.requestQuantityRateWhenMissing)}`);
}
console.log(`signal: pre-registered=${legacyComparison.architectureSignal.signal}  corrected=${strictComparison.architectureSignal.signal}`);
