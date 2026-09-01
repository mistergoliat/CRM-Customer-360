import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import test from "node:test";

/**
 * SALES-AGENT-R3-V1.7 static authority tests. Same shape and rationale as
 * tests/commercial/salesAgentRuntimeR3NativeDispatchAuthority.test.ts (V1.6)
 * and tests/commercial/legacySalesConsultativeRuntimeAuthority.test.ts: no
 * runtime behavior exercised here, only source text - proving the V1.7
 * audit's own primary architectural findings hold by construction, not just
 * by today's suite passing.
 *
 * V1.6 already proved runSalesAgentRuntimeCycle.ts + its 5 dispatch files
 * have zero reference to the four core R1 identifiers. This file widens that
 * proof to:
 *   - the WHOLE lib/brain/commercial/sales-agent-runtime/ directory (not
 *     just the 5 hand-picked files - also covers salesAgentRuntime.ts and
 *     index.ts), against a broader identifier list (CommercialWork,
 *     multi-request, multi-intent, legacy sales-consultative, the R1
 *     continuity fallback dispatcher, and the ATL-only cycle wrapper);
 *   - the exact, narrow shape of the one real import edge R3 has into
 *     autonomy-sandbox (a pure digit-normalization helper - see the V1.7
 *     release doc's "transitive-dependency findings" section for why this is
 *     classified as a neutral shared helper, not legacy contamination);
 *   - the branch-precedence order inside runNativeAutonomousCycle.ts;
 *   - that ensureAutonomousSalesTurnContinuity.ts's own R3 branch can never
 *     reach the R1 continuity-fallback dispatcher (dispatchFallbackAction.ts,
 *     which imports action-queue/autonomy-sandbox/execution-gate).
 */

const ROOT = resolve(process.cwd());
const R3_DIR = "lib/brain/commercial/sales-agent-runtime";

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

function listFilesUnder(relDir: string): string[] {
  const abs = resolve(ROOT, relDir);
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    out.push(toPosix(join(relDir, entry.name)));
  }
  return out.sort();
}

function readSource(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf8");
}

const R3_RUNTIME_FILES = listFilesUnder(R3_DIR);

// Extends V1.6's FORBIDDEN_R1_IDENTIFIERS with every other runtime/dispatch
// path this audit traced (CommercialWork, multi-request, multi-intent,
// legacy sales-consultative, the R1 continuity-fallback dispatcher, and the
// ATL-only native cycle wrapper - none of these are ever reachable from R3).
const FORBIDDEN_IDENTIFIERS = [
  "dispatchAgentLoopResponse",
  "persistAgentAction",
  "evaluateAgentActionForSandbox",
  "executeActionThroughGate",
  "buildSandboxAutonomyConfig",
  "SqlExecutionUnitOfWork",
  "runCommercialWorkInboundCycle",
  "dispatchCommercialWorkResponse",
  "runMultiRequestAutonomousCycle",
  "runCommercialMultiIntentLoop",
  "runSalesConsultativeService",
  "dispatchFallbackAction",
  "runNativeAgentToolLoopCycle"
];

/** Strips single-line `//` comments so a doc comment that merely names a forbidden identifier for context (e.g. index.ts's barrel documentation) does not fail the scan below - only real code references count. */
function stripComments(source: string): string {
  // Block comments first (JSDoc included), then line comments. Normalize
  // CRLF first: a trailing "\r" left on each line after a plain split("\n")
  // makes a `$`-anchored regex fail to match at all (position right before
  // "\r" is never "end of string" without a trailing-\r-aware pattern) -
  // this repo's .ts files are CRLF, so this is not hypothetical.
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlockComments
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\/\/.*/, ""))
    .join("\n");
}

test("[ISO1] every file in lib/brain/commercial/sales-agent-runtime/ has zero code reference to any other-runtime/R1 identifier", () => {
  assert.ok(R3_RUNTIME_FILES.length >= 8, "sanity check: the directory listing must not be empty/broken");
  for (const relPath of R3_RUNTIME_FILES) {
    const source = stripComments(readSource(relPath));
    for (const identifier of FORBIDDEN_IDENTIFIERS) {
      assert.doesNotMatch(source, new RegExp(`\\b${identifier}\\b`), `${relPath} must not reference ${identifier}`);
    }
  }
});

test("[ISO2] sales-agent-runtime/** never imports action-queue or execution-gate (zero exception, unlike autonomy-sandbox below)", () => {
  for (const relPath of R3_RUNTIME_FILES) {
    const source = readSource(relPath);
    assert.doesNotMatch(source, /from ["'][^"']*\/action-queue["']/, `${relPath} must not import action-queue`);
    assert.doesNotMatch(source, /from ["'][^"']*\/execution-gate["']/, `${relPath} must not import execution-gate`);
  }
});

test("[ISO3] the only autonomy-sandbox import anywhere in sales-agent-runtime/** is the neutral normalizeWaIdDigits helper", () => {
  const importLine = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*\/autonomy-sandbox["'];?/g;
  const filesWithImport: string[] = [];
  for (const relPath of R3_RUNTIME_FILES) {
    const source = readSource(relPath);
    for (const match of source.matchAll(importLine)) {
      filesWithImport.push(relPath);
      const specifiers = match[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      assert.deepEqual(
        specifiers,
        ["normalizeWaIdDigits"],
        `${relPath} imports from autonomy-sandbox but not exactly { normalizeWaIdDigits } (found: ${specifiers.join(", ")}) - ` +
          "any other symbol (evaluateAgentActionForSandbox, buildSandboxAutonomyConfig, SandboxAutonomyAgentActionContext, ...) " +
          "would reintroduce the R1 action-lifecycle evaluation logic into R3's dispatch boundary"
      );
    }
  }
  // This is a known, documented, narrow exception (see the V1.7 release doc's
  // transitive-dependency findings) - not a hard requirement that it be
  // exactly zero files, but it must never silently grow beyond the two known
  // dispatch files without this test being updated deliberately.
  assert.deepEqual(
    filesWithImport.sort(),
    ["lib/brain/commercial/sales-agent-runtime/dispatchGovernedSalesAgentMessage.ts", "lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentHardHandoff.ts"].sort(),
    "the set of R3 files importing from autonomy-sandbox changed - update this test deliberately if that is intended"
  );
});

test("[ISO4] runNativeAutonomousCycle.ts checks CommercialWork, then multi-request, then Agent Tool Loop, then SalesAgentRuntime, in that order", () => {
  const source = readSource("lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts");
  const commercialWorkIndex = source.indexOf("if (commercialWorkEnabled) {");
  const multiRequestIndex = source.indexOf("if (multiRequestEnabled) {");
  const agentToolLoopIndex = source.indexOf("if (agentToolLoopEnabled) {");
  const salesAgentRuntimeIndex = source.indexOf("if (salesAgentRuntimeEnabled) {");

  for (const [label, index] of [
    ["commercialWorkEnabled", commercialWorkIndex],
    ["multiRequestEnabled", multiRequestIndex],
    ["agentToolLoopEnabled", agentToolLoopIndex],
    ["salesAgentRuntimeEnabled", salesAgentRuntimeIndex]
  ] as const) {
    assert.notEqual(index, -1, `expected to find the branch-entry guard for ${label}`);
  }

  assert.ok(commercialWorkIndex < multiRequestIndex, "CommercialWork must be checked before multi-request");
  assert.ok(multiRequestIndex < agentToolLoopIndex, "multi-request must be checked before the Agent Tool Loop");
  assert.ok(agentToolLoopIndex < salesAgentRuntimeIndex, "the Agent Tool Loop must be checked before SalesAgentRuntime - R3 is always the lowest-priority pilot branch");
});

test("[ISO5] ensureAutonomousSalesTurnContinuity.ts's own R3 branch (cycle.salesAgentRuntime) never reaches the R1 continuity-fallback dispatcher", () => {
  const relPath = "lib/brain/commercial/continuity/ensureAutonomousSalesTurnContinuity.ts";
  const source = readSource(relPath);

  const branchStart = source.indexOf("if (cycle.salesAgentRuntime) {");
  assert.notEqual(branchStart, -1, "expected to find the cycle.salesAgentRuntime branch");
  const branchEnd = source.indexOf("const loop = cycle.loop;", branchStart);
  assert.notEqual(branchEnd, -1, "expected to find the start of the legacy-pipeline disposition logic that follows the R3 branch");
  assert.ok(branchEnd > branchStart, "the legacy-pipeline marker must appear after the R3 branch starts");

  const r3BranchSource = source.slice(branchStart, branchEnd);
  assert.doesNotMatch(r3BranchSource, /dispatchFallbackAction/, "the R3 branch must never call dispatchFallbackAction (the R1 action-queue/autonomy-sandbox/execution-gate fallback path)");

  // Sanity check: dispatchFallbackAction must still be a real, used import in
  // this file (for the legacy pipeline's own fallback below) - otherwise the
  // assertion above would be vacuously true because the identifier vanished
  // from the file entirely, not because the R3 branch specifically avoids it.
  assert.match(source, /dispatchFallbackAction/, "sanity check: this file's legacy branch must still reference dispatchFallbackAction");
  const afterR3Branch = source.slice(branchEnd);
  assert.match(afterR3Branch, /dispatchFallbackAction\(/, "sanity check: dispatchFallbackAction must be called somewhere after the R3 branch (the legacy pipeline's own fallback)");
});
