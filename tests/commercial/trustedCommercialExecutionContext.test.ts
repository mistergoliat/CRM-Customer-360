import assert from "node:assert/strict";
import test from "node:test";
import { resolveTrustedCommercialExecutionContext } from "@/lib/brain/commercial/sales-agent-runtime/salesAgentRuntime";
import type { PersistedCommercialWork } from "@/lib/brain/commercial/work/persistenceTypes";

// SALES-AGENT-R3-P7.1 (Trusted Execution Context). Pure unit tests for
// resolveTrustedCommercialExecutionContext - the function salesAgentRuntime.ts
// uses to derive workId/workVersion/objectiveId/objectiveType from the same
// work the P3.5 kernel already resolved. No DB, no HTTP, no LLM: this
// function's only input is a work-shaped object, so every case here is
// deterministic and instant.

type WorkFixture = Pick<PersistedCommercialWork, "publicId" | "version" | "objectives">;

function objective(overrides: Partial<PersistedCommercialWork["objectives"][number]> = {}): PersistedCommercialWork["objectives"][number] {
  return {
    objectiveId: "objective-1",
    type: "QUOTE",
    status: "PENDING",
    origin: "customer_requested",
    inputs: {},
    resolvedInputs: {},
    missingRequirements: [],
    supersedesObjectiveIds: [],
    evidence: [],
    blockers: [],
    ...overrides
  };
}

test("P7.1-F: no work (undefined) yields a fully null context", () => {
  const result = resolveTrustedCommercialExecutionContext(undefined);
  assert.deepEqual(result, { workId: null, workVersion: null, objectiveId: null, objectiveType: null });
});

test("P7.1-F: no work (null) yields a fully null context - never a sentinel string", () => {
  const result = resolveTrustedCommercialExecutionContext(null);
  assert.deepEqual(result, { workId: null, workVersion: null, objectiveId: null, objectiveType: null });
  assert.notEqual(result.workId, "unknown");
  assert.notEqual(result.workId, "none");
});

test("P7.1-E: work without an active objective carries workId/workVersion, objective fields null", () => {
  const work: WorkFixture = { publicId: "cw-1", version: 3, objectives: [] };
  const result = resolveTrustedCommercialExecutionContext(work);
  assert.deepEqual(result, { workId: "cw-1", workVersion: 3, objectiveId: null, objectiveType: null });
});

test("P7.1-E: work whose only objective is terminal still carries workId/workVersion, objective fields null", () => {
  const work: WorkFixture = { publicId: "cw-2", version: 5, objectives: [objective({ objectiveId: "objective-done", status: "COMPLETED" })] };
  const result = resolveTrustedCommercialExecutionContext(work);
  assert.deepEqual(result, { workId: "cw-2", workVersion: 5, objectiveId: null, objectiveType: null });
});

test("P7.1-C/D: work with an active objective attaches workId, workVersion, objectiveId and objectiveType", () => {
  const work: WorkFixture = {
    publicId: "cw-3",
    version: 7,
    objectives: [objective({ objectiveId: "objective-quote-1", type: "QUOTE", status: "PENDING" })]
  };
  const result = resolveTrustedCommercialExecutionContext(work);
  assert.deepEqual(result, { workId: "cw-3", workVersion: 7, objectiveId: "objective-quote-1", objectiveType: "QUOTE" });
});

test("P7.1-C/D: among multiple non-terminal objectives, the lowest objectiveId wins (reuses selectActiveObjective's own tie-break)", () => {
  const work: WorkFixture = {
    publicId: "cw-4",
    version: 1,
    objectives: [
      objective({ objectiveId: "objective-b", type: "SELECT_PRODUCTS", status: "PENDING" }),
      objective({ objectiveId: "objective-a", type: "QUOTE", status: "PENDING" })
    ]
  };
  const result = resolveTrustedCommercialExecutionContext(work);
  assert.equal(result.objectiveId, "objective-a");
  assert.equal(result.objectiveType, "QUOTE");
});

test("P7.1-A/B: the function has no parameter for model-supplied data - extra properties on a work-like object are never read as trusted fields", () => {
  // Structural proof: resolveTrustedCommercialExecutionContext's signature
  // only accepts a work-shaped Pick<...>. There is no `arguments`/`step`
  // parameter for a spoofed workId/objectiveId to travel through. This test
  // documents that even a maliciously-shaped object (extra keys a compromised
  // caller might smuggle in) is ignored beyond publicId/version/objectives.
  const spoofAttempt = {
    publicId: "cw-real",
    version: 9,
    objectives: [objective({ objectiveId: "objective-real", type: "QUOTE" })],
    // Not part of WorkFixture's type - simulates a caller trying to smuggle
    // model-controlled data alongside the trusted work object.
    arguments: { workId: "fake-spoofed-work-id", objectiveId: "fake-spoofed-objective-id" }
  } as WorkFixture & { arguments: Record<string, unknown> };

  const result = resolveTrustedCommercialExecutionContext(spoofAttempt);
  assert.equal(result.workId, "cw-real");
  assert.equal(result.objectiveId, "objective-real");
  assert.notEqual(result.workId, "fake-spoofed-work-id");
  assert.notEqual(result.objectiveId, "fake-spoofed-objective-id");
});
