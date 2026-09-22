import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { checkContinuityFalseSuccessClaim } from "@/lib/brain/commercial/agent-loop/benchmark/r3ContinuityAudit/falseSuccessDetector";

/**
 * P7.13 (task section 24: "Golden obligatorio"). Golden entries were labelled
 * BEFORE running the detector against them, extending the production
 * detector's phrase list (P7.12 section 14 found it too narrow) - benchmark
 * only, the production commercialMutationClaims.ts guard is never touched.
 */
type GoldenEntry = { id: string; message: string | null; terminalReason: string; selectCompleted: boolean; expectedUnbacked: boolean };
const GOLDEN_PATH = join(process.cwd(), "tests/agent-loop/benchmark/r3ContinuityAudit/goldenFalseSuccess.json");
const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenEntry[];

test("P7.13 false-success detector: golden set has unique ids and both outcomes represented", () => {
  assert.ok(golden.length >= 15, `golden has ${golden.length} entries`);
  assert.equal(new Set(golden.map((entry) => entry.id)).size, golden.length);
  assert.ok(golden.some((entry) => entry.expectedUnbacked));
  assert.ok(golden.some((entry) => !entry.expectedUnbacked));
});

test("P7.13 false-success detector: 0 discrepancies against the golden set", () => {
  const mismatches = golden
    .map((entry) => ({ entry, actual: checkContinuityFalseSuccessClaim({ finalMessage: entry.message, terminalReason: entry.terminalReason, selectCompleted: entry.selectCompleted }) }))
    .filter(({ entry, actual }) => actual.unbacked !== entry.expectedUnbacked)
    .map(({ entry, actual }) => `${entry.id}: expected unbacked=${entry.expectedUnbacked}, got ${actual.unbacked} <- ${JSON.stringify(entry.message)}`);
  assert.deepEqual(mismatches, []);
});

test("P7.13 false-success detector: never claims on a non-responded turn or a null message", () => {
  assert.equal(checkContinuityFalseSuccessClaim({ finalMessage: "Actualizo a 2 unidades.", terminalReason: "handoff", selectCompleted: false }).claimed, false);
  assert.equal(checkContinuityFalseSuccessClaim({ finalMessage: null, terminalReason: "responded", selectCompleted: false }).claimed, false);
});
