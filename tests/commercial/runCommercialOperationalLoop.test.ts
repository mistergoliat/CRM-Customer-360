import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "../../lib/db";
import { createFakeSalesAgentProvider, type SalesAgentFakeProviderBehavior } from "../../lib/brain/commercial/sales-agent/providers/fakeSalesAgentProvider";
import {
  SALES_AGENT_CONTRACT_VERSION,
  SALES_AGENT_PROMPT_VERSION,
  SALES_AGENT_RUNTIME_VERSION
} from "../../lib/brain/commercial/sales-agent/runtimeTypes";
import { runCommercialShadowEvaluation } from "../../lib/brain/commercial/shadow/runCommercialShadowEvaluation";
import { runCommercialOperationalLoop } from "../../lib/brain/commercial/operational-loop/runCommercialOperationalLoop";
import { resolveOpportunityIdentity } from "../../lib/brain/commercial/operational-loop/resolveOpportunityIdentity";
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
import { makeCommercialShadowInput, makeNormalizedInboundMessage, makeBrainContextResolveResponse, FIXED_TIME } from "./fixtures";

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

function makeOperationalState(overrides: Partial<CommercialOperationalState> = {}): CommercialOperationalState {
  return {
    opportunityId: 1,
    opportunityKey: "opportunity:56912345678:quote_request:whatsapp:thread",
    customerCandidateId: null,
    customerMasterId: null,
    leadId: null,
    conversationCaseId: 4821,
    waId: "56912345678",
    channel: "whatsapp",
    primaryIntent: "quote_request",
    status: "engaged",
    stage: "discovery",
    temperature: "unknown",
    priority: "normal",
    currentSummary: null,
    requirements: [],
    missingRequirements: [],
    productInterests: [],
    objections: [],
    signals: [],
    lastCustomerMessageId: null,
    lastAgentDecisionId: null,
    waitingFor: null,
    nextActionType: null,
    nextActionDueAt: null,
    humanOwnerActive: false,
    aiBlocked: false,
    version: 1,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    lastActivityAt: FIXED_TIME,
    closedAt: null,
    previousDecision: null,
    ...overrides
  };
}

function buildIdentityInput(overrides: { serviceCode?: string; candidates?: CommercialOperationalState[] }) {
  const brainContext = makeBrainContextResolveResponse({
    case_context: {
      active_case: {
        conversation_case_id: 4821,
        active_case_key: "case-001",
        status: "open",
        lifecycle_status: "open",
        department: "ventas",
        service_code: overrides.serviceCode ?? "unknown",
        priority: "medium",
        requires_human: false,
        bot_replied: false,
        final_action: "continue",
        ai_blocked: false,
        wa_id: "56912345678",
        phone_number_id: "phone-001",
        id_order: 20001,
        id_customer: 10045,
        invoice_number: 30001,
        source_table: "n8n_cases",
        source_id: 4821,
        whatsapp_window_open: true,
        last_message_at: FIXED_TIME,
        created_at: FIXED_TIME,
        updated_at: FIXED_TIME,
        closed_at: null,
        raw_status: "open"
      },
      latest_case: null,
      open_cases: [],
      case_count: 1,
      waiting_human_case: false,
      closed_or_rejected_case: false,
      manual_operator_lock: false,
      last_case_status: "open",
      last_case_final_action: "continue"
    }
  });

  // Minimal fixture: resolveOpportunityIdentity only reads sourceSummary/salesAgentInput
  // off the commercial context, so a full CommercialContextBuilderResult isn't needed here.
  const commercialContext: any = {
    status: "complete",
    sourceSummary: {
      hasLatestCustomerMessage: true,
      hasLatestOutboundMessage: false,
      hasCustomerCandidate: false,
      hasCustomerReference: false,
      hasConversationHistory: false,
      hasCommercialEntity: false,
      orderContextAvailable: false,
      productServiceContextAvailable: false,
      humanOwnershipActive: false,
      aiBlocked: false,
      manualReplyActive: false,
      channel: "whatsapp",
      waId: "56912345678",
      conversationCaseId: 4821
    },
    salesAgentInput: null
  };

  return {
    inboundMessage: makeNormalizedInboundMessage(),
    brainContext,
    commercialContext,
    loadResult: {
      status: "loaded" as const,
      candidates: overrides.candidates ?? [],
      activeState: null,
      latestDecision: null,
      warnings: [],
      metadata: {}
    },
    currentTime: FIXED_TIME,
    correlationId: "corr-identity-001"
  };
}

test("two opportunities of different intents are not ambiguous - each resolves to its own", () => {
  const quoteOpportunity = makeOperationalState({ opportunityId: 1, opportunityKey: "opp-quote", primaryIntent: "quote_request", status: "engaged" });
  const maintenanceOpportunity = makeOperationalState({ opportunityId: 2, opportunityKey: "opp-maintenance", primaryIntent: "maintenance_request", status: "engaged" });

  const resultForQuote = resolveOpportunityIdentity(
    buildIdentityInput({ serviceCode: "quote_requested", candidates: [quoteOpportunity, maintenanceOpportunity] })
  );
  assert.equal(resultForQuote.isAmbiguous, false);
  assert.equal(resultForQuote.status, "continue_existing");
  assert.equal(resultForQuote.selectedOpportunityId, 1);

  const resultForMaintenance = resolveOpportunityIdentity(
    buildIdentityInput({ serviceCode: "maintenance", candidates: [quoteOpportunity, maintenanceOpportunity] })
  );
  assert.equal(resultForMaintenance.isAmbiguous, false);
  assert.equal(resultForMaintenance.status, "continue_existing");
  assert.equal(resultForMaintenance.selectedOpportunityId, 2);
});

test("two active opportunities of the same intent are still ambiguous", () => {
  const first = makeOperationalState({ opportunityId: 1, opportunityKey: "opp-quote-1", primaryIntent: "quote_request", status: "engaged" });
  const second = makeOperationalState({ opportunityId: 2, opportunityKey: "opp-quote-2", primaryIntent: "quote_request", status: "engaged" });

  const result = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "quote_requested", candidates: [first, second] }));

  assert.equal(result.isAmbiguous, true);
  assert.equal(result.status, "ambiguous");
  // Ambiguous never auto-acts, even though selectedState carries a candidate for context.
  assert.equal(result.selectedOpportunityId, null);
  assert.equal(result.opportunityId, null);
});

test("only terminal history for a new intent creates a new opportunity, not a reopen", () => {
  const terminal = makeOperationalState({ opportunityId: 1, opportunityKey: "opp-old-maintenance", primaryIntent: "maintenance_request", status: "won" });

  const result = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "quote_requested", candidates: [terminal] }));

  assert.equal(result.status, "create_new");
  assert.equal(result.isAmbiguous, false);
  assert.equal(result.selectedState, null);
});

test("terminal history matching the current intent is a possible reopen, not a blind reuse", () => {
  const terminal = makeOperationalState({ opportunityId: 1, opportunityKey: "opp-old-quote", primaryIntent: "quote_request", status: "won" });

  const result = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "quote_requested", candidates: [terminal] }));

  assert.equal(result.status, "possible_reopen");
  assert.equal(result.isTerminal, true);
  assert.equal(result.isAmbiguous, false);
  // Never auto-selected: reopening a closed opportunity requires an explicit decision.
  assert.equal(result.selectedState, null);
  assert.equal(result.selectedOpportunityId, null);
  assert.equal(result.metadata.reopenCandidateOpportunityId, 1);
});

test("unknown intent keeps legacy behavior: reuses the most recently active candidate regardless of intent", () => {
  const other = makeOperationalState({ opportunityId: 1, opportunityKey: "opp-other", primaryIntent: "maintenance_request", status: "engaged" });

  const result = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "unknown", candidates: [other] }));

  assert.equal(result.status, "continue_existing");
  assert.equal(result.selectedOpportunityId, 1);
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

// "persistence writes state and decision when enabled" exercises the real
// default storage (operational-loop/persistCommercialState.ts, withConnection
// -> lib/db.ts getPool()) rather than a fake - a genuine MariaDB pool
// connection is opened and never closed, leaving a live keep-alive socket
// that blocks the process from exiting. Release it the same way the
// DB-backed repository tests do.
after(async () => {
  await getPool().end();
});
