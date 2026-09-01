import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

/**
 * SALES-AGENT-R3-V1.6 static authority test. Same shape as
 * tests/commercial/legacySalesConsultativeRuntimeAuthority.test.ts and
 * tests/commercial/followUpRuntimeAuthority.test.ts: no runtime behavior
 * exercised here, only source text - proving the V1.6 task's own primary
 * architectural acceptance criterion holds by construction, not just by
 * today's test suite passing: runSalesAgentRuntimeCycle.ts (the one dispatch
 * call site SalesAgentRuntime uses) can never silently regain a reference to
 * the R1 action-lifecycle stack (dispatchAgentLoopResponse -> persistAgentAction
 * -> autonomy-sandbox -> execution-gate).
 */

const ROOT = resolve(process.cwd());
const CYCLE_FILE = "lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts";

function readSource(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf8");
}

const FORBIDDEN_R1_IDENTIFIERS = ["dispatchAgentLoopResponse", "persistAgentAction", "evaluateAgentActionForSandbox", "executeActionThroughGate"];

test("runSalesAgentRuntimeCycle.ts contains no import or reference to any R1 action-lifecycle identifier", () => {
  const source = readSource(CYCLE_FILE);
  for (const identifier of FORBIDDEN_R1_IDENTIFIERS) {
    assert.doesNotMatch(source, new RegExp(`\\b${identifier}\\b`), `${CYCLE_FILE} must not reference ${identifier}`);
  }
});

test("runSalesAgentRuntimeCycle.ts's only dispatch call site is the R3-native terminal outcome router", () => {
  const source = readSource(CYCLE_FILE);
  assert.match(source, /dispatchSalesAgentTerminalOutcome/, `${CYCLE_FILE} must call dispatchSalesAgentTerminalOutcome`);
});

test("the R3-native terminal dispatch boundary itself has no reference to any R1 action-lifecycle identifier", () => {
  const r3Files = [
    "lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentTerminalOutcome.ts",
    "lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentFallback.ts",
    "lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentHardHandoff.ts",
    "lib/brain/commercial/sales-agent-runtime/dispatchGovernedSalesAgentMessage.ts",
    "lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentResponse.ts"
  ];
  for (const relPath of r3Files) {
    const source = readSource(relPath);
    for (const identifier of FORBIDDEN_R1_IDENTIFIERS) {
      assert.doesNotMatch(source, new RegExp(`\\b${identifier}\\b`), `${relPath} must not reference ${identifier}`);
    }
  }
});
