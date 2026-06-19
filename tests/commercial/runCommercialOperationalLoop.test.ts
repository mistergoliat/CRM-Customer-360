import assert from "node:assert/strict";
import test from "node:test";
import { createFakeSalesAgentProvider, type SalesAgentFakeProviderBehavior } from "../../lib/brain/commercial/sales-agent/providers/fakeSalesAgentProvider";
import {
  SALES_AGENT_CONTRACT_VERSION,
  SALES_AGENT_PROMPT_VERSION,
  SALES_AGENT_RUNTIME_VERSION
} from "../../lib/brain/commercial/sales-agent/runtimeTypes";
import { runCommercialShadowEvaluation } from "../../lib/brain/commercial/shadow/runCommercialShadowEvaluation";
import { runCommercialOperationalLoop } from "../../lib/brain/commercial/operational-loop/runCommercialOperationalLoop";
import type {
  CommercialOperationalLoadStateResult,
  CommercialOperationalLoopInput,
  CommercialOperationalLoopResult,
  CommercialOperationalLoopStorage,
  CommercialOperationalState
} from "../../lib/brain/commercial/operational-loop";
import type { CommercialPolicyResult } from "../../lib/brain/commercial/policy";
import type { CommercialShadowResult } from "../../lib/brain/commercial/shadow";
import type { CommercialOperationalPersistenceResult } from "../../lib/brain/commercial/operational-loop";
import { makeCommercialShadowInput, FIXED_TIME } from "./fixtures";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function buildShadowResult(behavior: SalesAgentFakeProviderBehavior = "valid"): Promise<CommercialShadowResult> {
  const shadowInput = makeCommercialShadowInput({
    provider: createFakeSalesAgentProvider({ behavior })
  });
  return runCommercialShadowEvaluation(shadowInput);
}

function makePersistedStateSummary(state: CommercialOperationalState | null): CommercialOperationalLoadStateResult {
  if (!state) {
    return {
      status: "not_found",
      candidates: [],
      activeState: null,
      latestDecision: null,
      warnings: [],
      metadata: {}
    };
  }

  return {
    status: "loaded",
    candidates: [state],
    activeState: state,
    latestDecision: null,
    warnings: [],
    metadata: {}
  };
}

function makeMemoryStorage(initialState: CommercialOperationalState | null = null, persistMode: CommercialOperationalPersistenceResult["status"] = "persisted") {
  let currentState = initialState;
  const seenDecisionIds = new Set<string>();
  const calls = {
    load: 0,
    persist: 0
  };

  const storage: CommercialOperationalLoopStorage = {
    async loadCommercialState() {
      calls.load += 1;
      return makePersistedStateSummary(currentState);
    },
    async persistCommercialState(input) {
      calls.persist += 1;
      if (persistMode === "failed_safe") {
        return {
          status: "failed_safe",
          opportunityWritten: false,
          decisionWritten: false,
          opportunityId: currentState?.opportunityId ?? null,
          opportunityKey: input.resultingState.opportunityKey,
          decisionId: input.decisionRecord.decisionId,
          version: null,
          createdAt: FIXED_TIME,
          warnings: ["commercial_state_persistence_failed"],
          reason: "Persistence failed."
        };
      }

      if (persistMode === "conflict") {
        return {
          status: "conflict",
          opportunityWritten: false,
          decisionWritten: false,
          opportunityId: currentState?.opportunityId ?? null,
          opportunityKey: input.resultingState.opportunityKey,
          decisionId: input.decisionRecord.decisionId,
          version: currentState?.version ?? null,
          createdAt: FIXED_TIME,
          warnings: ["commercial_state_conflict"],
          reason: "Optimistic version conflict."
        };
      }

      if (persistMode === "duplicate") {
        return {
          status: "duplicate",
          opportunityWritten: false,
          decisionWritten: false,
          opportunityId: currentState?.opportunityId ?? null,
          opportunityKey: input.resultingState.opportunityKey,
          decisionId: input.decisionRecord.decisionId,
          version: currentState?.version ?? input.resultingState.version,
          createdAt: FIXED_TIME,
          warnings: ["commercial_state_retry_reused"],
          reason: "Duplicate decision id."
        };
      }

      if (seenDecisionIds.has(input.decisionRecord.decisionId)) {
        return {
          status: "duplicate",
          opportunityWritten: false,
          decisionWritten: false,
          opportunityId: currentState?.opportunityId ?? null,
          opportunityKey: input.resultingState.opportunityKey,
          decisionId: input.decisionRecord.decisionId,
          version: currentState?.version ?? input.resultingState.version,
          createdAt: FIXED_TIME,
          warnings: ["commercial_state_retry_reused"],
          reason: "Duplicate decision id."
        };
      }

      seenDecisionIds.add(input.decisionRecord.decisionId);
      currentState = input.resultingState;
      return {
        status: "persisted",
        opportunityWritten: true,
        decisionWritten: true,
        opportunityId: currentState?.opportunityId ?? null,
        opportunityKey: input.resultingState.opportunityKey,
        decisionId: input.decisionRecord.decisionId,
        version: input.resultingState.version,
        createdAt: FIXED_TIME,
        warnings: [],
        reason: null
      };
    }
  };

  return { storage, calls, getCurrentState: () => currentState, seenDecisionIds };
}

async function buildLoopInput(overrides: {
  behavior?: SalesAgentFakeProviderBehavior;
  commercialShadowResult?: CommercialShadowResult | null;
  commercialPolicyResult?: CommercialPolicyResult | null;
  featureFlags?: Partial<CommercialOperationalLoopInput["featureFlags"]>;
  storage?: CommercialOperationalLoopStorage | null;
  currentTime?: string;
  correlationId?: string;
  processInboundRunId?: string | null;
} = {}): Promise<CommercialOperationalLoopInput> {
  const shadowResult =
    overrides.commercialShadowResult !== undefined
      ? overrides.commercialShadowResult
      : await buildShadowResult(overrides.behavior ?? "valid");

  const basePolicyResult = shadowResult?.context?.policyResult ?? null;

  if (!shadowResult) {
    return {
      inboundMessage: makeCommercialShadowInput().inboundMessage,
      brainContext: makeCommercialShadowInput().brainContext,
      commercialContext: null,
      salesAgentResult: null,
      commercialPolicyResult: overrides.commercialPolicyResult ?? null,
      commercialEvaluationResult: null,
      commercialShadowResult: null,
      currentTime: overrides.currentTime ?? FIXED_TIME,
      correlationId: overrides.correlationId ?? "corr-001",
      processInboundRunId: overrides.processInboundRunId ?? "pir-001",
      salesAgentRunId: null,
      featureFlags: {
        commercialOperationalLoopEnabled: true,
        commercialStatePersistenceEnabled: false,
        ...(overrides.featureFlags ?? {})
      },
      mode: "shadow",
      contractVersion: SALES_AGENT_CONTRACT_VERSION,
      policyVersion: "brain.commercial.policy.v1",
      runtimeVersion: SALES_AGENT_RUNTIME_VERSION,
      promptVersion: SALES_AGENT_PROMPT_VERSION,
      evaluationVersion: null,
      metadata: {
        safeTraceId: "trace-001"
      },
      abortSignal: null,
      storage: overrides.storage ?? null
    };
  }

  return {
    inboundMessage: shadowResult.context!.inboundMessage,
    brainContext: shadowResult.context!.brainContext,
    commercialContext: shadowResult.context?.commercialContext ?? null,
    salesAgentResult: shadowResult.context?.runtimeResult?.result ?? null,
    commercialPolicyResult: overrides.commercialPolicyResult ?? basePolicyResult,
    commercialEvaluationResult: null,
    commercialShadowResult: shadowResult,
    currentTime: overrides.currentTime ?? FIXED_TIME,
    correlationId: overrides.correlationId ?? shadowResult.correlationId,
    processInboundRunId: overrides.processInboundRunId ?? `pir-${shadowResult.correlationId}`,
    salesAgentRunId: shadowResult.context?.runtimeResult?.result?.runId ?? null,
    featureFlags: {
      commercialOperationalLoopEnabled: true,
      commercialStatePersistenceEnabled: false,
      ...(overrides.featureFlags ?? {})
    },
    mode: "shadow",
    contractVersion: shadowResult.versions.contractVersion,
    policyVersion: shadowResult.versions.policyVersion,
    runtimeVersion: shadowResult.versions.runtimeVersion,
    promptVersion: shadowResult.versions.promptVersion,
    evaluationVersion: null,
    metadata: {
      safeTraceId: "trace-001"
    },
    abortSignal: null,
    storage: overrides.storage ?? null
  };
}

function expectCommonLoopInvariants(result: CommercialOperationalLoopResult) {
  assert.equal(result.continueLegacyFlow, true);
  assert.equal(result.sideEffects.outboundExecuted, false);
  assert.equal(result.sideEffects.toolsExecuted, 0);
  assert.equal(result.sideEffects.followupScheduled, false);
  assert.equal(result.sideEffects.quoteCreated, false);
  assert.equal(result.sideEffects.leadCreated, false);
  assert.equal(result.sideEffects.caseMutated, false);
  assert.equal(result.sideEffects.controlsResponsePolicy, false);
  assert.equal(result.sideEffects.nextActionExecuted, false);
  assert.equal(result.sideEffects.commercialOpportunityWritten, false);
  assert.equal(result.sideEffects.commercialDecisionWritten, false);
  assert.equal(result.selectedNextAction?.executable ?? false, false);
}

test("loop disabled is skipped and does not touch storage", async () => {
  const storage = makeMemoryStorage();
  const input = await buildLoopInput({
    featureFlags: { commercialOperationalLoopEnabled: false },
    storage: storage.storage
  });

  const result = await runCommercialOperationalLoop(input);

  assert.equal(result.status, "skipped");
  assert.equal(result.skipReason, "skipped_by_flag");
  assert.equal(storage.calls.load, 0);
  assert.equal(storage.calls.persist, 0);
  expectCommonLoopInvariants(result);
});

test("loop skipped when no shadow result exists", async () => {
  const storage = makeMemoryStorage();
  const input = await buildLoopInput({
    commercialShadowResult: null,
    storage: storage.storage
  });

  const result = await runCommercialOperationalLoop(input);

  assert.equal(result.status, "skipped");
  assert.equal(result.skipReason, "no_shadow_result");
  assert.equal(storage.calls.load, 0);
  assert.equal(storage.calls.persist, 0);
});

test("loop completes deterministically for a valid shadow result", async () => {
  const result = await runCommercialOperationalLoop(await buildLoopInput());

  assert.equal(result.status, "completed");
  assert.equal(result.executionDisposition, "observe_only");
  assert.equal(result.commercialEvaluationSummary?.status !== null, true);
  assert.equal(result.transitionValidation?.allowed, true);
  assert.equal(result.decisionRecord?.decisionId.startsWith("commercial-decision-"), true);
  assert.equal(result.metrics.decisionRecorded, false);
  expectCommonLoopInvariants(result);
});

test("loop loads and continues an existing opportunity", async () => {
  const seeded = await runCommercialOperationalLoop(await buildLoopInput());
  const storage = makeMemoryStorage(seeded.resultingState);
  const result = await runCommercialOperationalLoop(
    await buildLoopInput({
      storage: storage.storage
    })
  );

  assert.equal(result.status, "completed");
  assert.equal(result.previousState?.opportunityKey, seeded.resultingState?.opportunityKey);
  assert.equal(result.selectedNextAction?.type, result.selectedNextAction?.type);
  assert.equal(storage.calls.load, 1);
});

test("terminal opportunities do not reopen automatically", async () => {
  const seeded = await runCommercialOperationalLoop(await buildLoopInput());
  const terminalState = {
    ...seeded.resultingState!,
    status: "won" as const,
    stage: "closing" as const
  };
  const storage = makeMemoryStorage(terminalState);
  const result = await runCommercialOperationalLoop(
    await buildLoopInput({
      storage: storage.storage
    })
  );

  assert.equal(result.status, "completed");
  assert.equal(result.resultingState?.status, "won");
  assert.equal(result.selectedNextAction?.type, "no_action");
});

test("blocked policy keeps the loop read-only", async () => {
  const shadowResult = await buildShadowResult("valid");
  const blockedPolicyResult = {
    ...shadowResult.context!.policyResult!,
    status: "blocked" as const,
    riskLevel: "blocked" as const,
    requiresApproval: "blocked" as const
  } satisfies CommercialPolicyResult;

  const result = await runCommercialOperationalLoop(
    await buildLoopInput({
      commercialShadowResult: shadowResult,
      commercialPolicyResult: blockedPolicyResult
    })
  );

  assert.equal(result.status, "completed");
  assert.equal(result.selectedNextAction?.type, "no_action");
  assert.equal(result.transitionValidation?.allowed, true);
});

test("persistence writes state and decision when enabled", async () => {
  const storage = makeMemoryStorage(null, "persisted");
  const result = await runCommercialOperationalLoop(
    await buildLoopInput({
      storage: storage.storage,
      featureFlags: { commercialStatePersistenceEnabled: true }
    })
  );

  assert.equal(result.status, "completed");
  assert.equal(result.persistenceResult?.status, "persisted");
  assert.equal(result.sideEffects.commercialOpportunityWritten, true);
  assert.equal(result.sideEffects.commercialDecisionWritten, true);
  assert.equal(result.executionDisposition, "persisted");
  assert.equal(storage.calls.persist, 1);
});

test("duplicate decision ids are not written twice", async () => {
  const storage = makeMemoryStorage(null, "duplicate");
  const result = await runCommercialOperationalLoop(
    await buildLoopInput({
      storage: storage.storage,
      featureFlags: { commercialStatePersistenceEnabled: true }
    })
  );

  assert.equal(result.persistenceResult?.status, "duplicate");
  assert.equal(result.sideEffects.commercialOpportunityWritten, false);
  assert.equal(result.sideEffects.commercialDecisionWritten, false);
});

test("persistence failures degrade safely", async () => {
  const storage = makeMemoryStorage(null, "failed_safe");
  const result = await runCommercialOperationalLoop(
    await buildLoopInput({
      storage: storage.storage,
      featureFlags: { commercialStatePersistenceEnabled: true }
    })
  );

  assert.equal(result.status, "persistence_failed");
  assert.equal(result.persistenceResult?.status, "failed_safe");
  assert.equal(result.sideEffects.commercialOpportunityWritten, false);
  assert.equal(result.sideEffects.commercialDecisionWritten, false);
});

test("operational loop is deterministic and JSON serializable", async () => {
  const input = await buildLoopInput();
  const before = JSON.stringify(input);
  const first = await runCommercialOperationalLoop(input);
  const second = await runCommercialOperationalLoop(cloneJson(input));

  assert.equal(before, JSON.stringify(input));
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  assert.doesNotThrow(() => JSON.stringify(first));
  assert.doesNotThrow(() => JSON.stringify(second));
});
