import assert from "node:assert/strict";
import test from "node:test";
import { buildArtifactFiles } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/artifacts";
import type { BenchmarkE2EArtifactBundle } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/types";

// SALES-AGENT-R3-P7.4-N: artifact output is deterministic and schema-valid.

function bundle(): BenchmarkE2EArtifactBundle {
  return {
    manifest: {
      gitSha: "abc123",
      corpusVersion: "r3-commercial-e2e.v1",
      startedAt: "2026-09-17T00:00:00.000Z",
      environmentHealth: { status: "READY", checkedAt: "t", dependencies: [] },
      modelConfig: { mode: "offline", provider: "benchmark-offline-scripted-provider", model: "benchmark-offline-model", temperature: null, maxOutputTokens: null, maxModelRetries: null, thinking: null, maxDecisions: 3, maxToolExecutions: 2, timeoutMs: 30000 },
      flags: {
        agentTurnInputShadowEnabled: true,
        commercialWorkKernelEnabled: true,
        commercialProposalShadowEnabled: true,
        commercialObjectiveReconciliationEnabled: true,
        capabilityEligibilityShadowEnabled: true,
        capabilityEligibilityInputEnabled: true,
        openTurnExecutionEnabled: false,
        harnessAlignedMessageModelEnabled: false,
        persistentSessionCognitionEnabled: true,
        sessionCompactionEnabled: false,
        liveTurnAssimilationEnabled: false,
        legacyCommercialWorkRuntimeReachable: false
      },
      benchmarkOverrides: {},
      notReproducibleInHarness: [],
      runsPerCase: 1,
      caseCount: 1
    },
    runs: [
      {
        benchmarkRunId: "run-1",
        caseId: "E01",
        runOrdinal: 0,
        executionMode: "STUBBED",
        startedAt: "t0",
        finishedAt: "t1",
        initialState: null,
        turns: [],
        finalState: null,
        outcome: { status: "PASS", expectationResults: {}, forbiddenViolations: [], failure: null }
      },
      {
        benchmarkRunId: "run-2",
        caseId: "E02",
        runOrdinal: 0,
        executionMode: "STUBBED",
        startedAt: "t0",
        finishedAt: "t1",
        initialState: null,
        turns: [],
        finalState: null,
        outcome: { status: "FAIL", expectationResults: { quoteExists: false }, forbiddenViolations: [], failure: { caseId: "E02", runOrdinal: 0, category: "MODEL_REASONING", reason: "x", causalTrace: [] } }
      }
    ],
    summary: {
      runCompletionRate: 1,
      commercialOutcomeCompletionRate: null,
      correctObjectiveBehaviorRate: null,
      correctToolSelectionRate: null,
      validArgumentsRate: null,
      gatewayCompletionRate: null,
      gatewayRejectionRate: null,
      unnecessaryRequestionRate: null,
      duplicateToolCallRate: null,
      ungroundedMutationClaimRate: null,
      quoteConversionRate: null,
      outboxCompletionRate: null,
      blockedRequestCoherenceRate: null,
      averageToolCallsPerRun: null,
      p50DecisionsPerRun: null,
      p95DecisionsPerRun: null,
      terminalReasonDistribution: { responded: 2 },
      commercialProgression: { objectiveStarted: 0, objectivePreserved: 0, objectiveReplacedCorrectly: 0, selectionCreated: 0, destinationCreated: 0, shippingCalculated: 0, quoteCreated: 0, quoteRetrieved: 0, finalCommercialOutcomeQuoteExists: 0 },
      toolBehavior: { requestedCapabilities: 0, gatewayCompleted: 0, gatewayRejected: 0, invalidArguments: 0, duplicateCalls: 0, blockedAtTurnStartRequests: 0, blockedThenRelevantEvidence: 0, blockedWithoutRelevantEvidence: 0 },
      eligibilityCoherence: { eligibleThenCompleted: 0, eligibleThenRejected: 0, blockedThenCompleted: 0, blockedThenRejected: 0 },
      conversational: { unnecessaryRequestionCount: 0, greetingRepetitionCount: 0, ungroundedQuoteClaimCount: 0, ungroundedMutationClaimCount: 0, responseAfterSuccessfulToolCount: 0 },
      legacy: { simpleToolSelectionPassRate: null, argumentValidityPassRate: null, mutationGroundingPassRate: null }
    },
    failures: [{ caseId: "E02", runOrdinal: 0, category: "MODEL_REASONING", reason: "x", causalTrace: [] }]
  };
}

test("P7.4-N: produces exactly the four documented artifact files", () => {
  const files = buildArtifactFiles(bundle());
  assert.deepEqual(Object.keys(files).sort(), ["failures.json", "manifest.json", "runs.jsonl", "summary.json"]);
});

test("P7.4-N: manifest.json/summary.json/failures.json are valid, parseable JSON", () => {
  const files = buildArtifactFiles(bundle());
  assert.doesNotThrow(() => JSON.parse(files["manifest.json"]));
  assert.doesNotThrow(() => JSON.parse(files["summary.json"]));
  assert.doesNotThrow(() => JSON.parse(files["failures.json"]));
});

test("P7.4-N: runs.jsonl has exactly one JSON object per line, one line per run", () => {
  const files = buildArtifactFiles(bundle());
  const lines = files["runs.jsonl"].split("\n");
  assert.equal(lines.length, 2);
  for (const line of lines) {
    const parsed = JSON.parse(line) as { caseId: string };
    assert.ok(typeof parsed.caseId === "string");
  }
});

test("P7.4-N: output is deterministic - the same bundle produces byte-identical files", () => {
  const first = buildArtifactFiles(bundle());
  const second = buildArtifactFiles(bundle());
  assert.deepEqual(first, second);
});

test("P7.4-N: manifest carries git SHA, corpus version, environment health and flags for reproducibility", () => {
  const files = buildArtifactFiles(bundle());
  const manifest = JSON.parse(files["manifest.json"]) as Record<string, unknown>;
  assert.equal(manifest.gitSha, "abc123");
  assert.equal(manifest.corpusVersion, "r3-commercial-e2e.v1");
  assert.ok(manifest.environmentHealth);
  assert.ok(manifest.flags);
});
