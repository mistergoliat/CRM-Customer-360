import assert from "node:assert/strict";
import test from "node:test";
import { runCapabilityEligibilityShadow } from "@/lib/brain/commercial/capability-eligibility";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import { createInMemoryAgentSessionStore } from "@/lib/brain/commercial/agent-session/inMemoryAgentSessionStore";
import type { AgentLoopProvider, AgentLoopProviderRequest } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import type { CommercialContextSnapshot } from "@/lib/brain/commercial/context/buildNativeCommercialContext";
import { makeCommercialFreshness, type CommercialDomainReadModel } from "@/lib/brain/commercial/domain-read-model";
import { recordCommercialCapabilityEligibilityEvaluatedEvent } from "@/lib/brain/commercial/events/service";
import {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
  type ResolvedSalesAgentConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";
import {
  runSalesAgentRuntimeCycle,
  type RunSalesAgentRuntimeCycleInput
} from "@/lib/brain/commercial/sales-agent-runtime";
import type { DispatchSalesAgentTerminalOutcomeResult } from "@/lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentTerminalOutcome";
import type { PersistedCommercialWork } from "@/lib/brain/commercial/work/persistenceTypes";

const NOW = "2026-09-16T12:00:00.000Z";

function freshness(state: "CURRENT" | "STALE" | "SUPERSEDED" | "HISTORICAL" | "UNKNOWN") {
  return makeCommercialFreshness({ state, source: "p6-c-test" });
}

function buildReadModel(input: {
  selection?: "CURRENT" | "STALE";
  quote?: "CURRENT" | "STALE" | "UNKNOWN" | "missing";
} = {}): CommercialDomainReadModel {
  const selection = input.selection ?? "CURRENT";
  const quote = input.quote ?? "CURRENT";
  return {
    case: { caseId: "case-p6-c", conversationId: 101, opportunityId: 501, workId: "cw-p6-c", workVersion: 4, status: "ACTIVE", blockers: [], freshness: freshness("CURRENT") },
    objective: null,
    cart: {
      factId: "selection-1",
      updatedAt: NOW,
      items: [{ productId: "product-1", combinationId: null, quantity: 1, product: null, freshness: freshness(selection) }],
      freshness: freshness(selection)
    },
    destination: null,
    shipping: { state: "MISSING", selection: null, calculation: null, freshness: freshness("CURRENT") },
    quote:
      quote === "missing"
        ? null
        : {
            quoteId: "quote-1",
            quoteNumber: "Q-1",
            status: "draft",
            currency: "CLP",
            total: "10000",
            validUntil: "2026-10-16T12:00:00.000Z",
            version: 1,
            selectionFactId: "selection-1",
            freshness: freshness(quote),
            grounding: quote === "CURRENT" ? "CURRENT_FOR_KNOWN_ANCHORS" : quote === "STALE" ? "STALE" : "UNKNOWN"
          },
    customer: { status: "identified", identityLevel: "LEVEL_2_MASTER_RESOLVED", hasResolvedCustomer: true, verificationRequired: false, profile: null },
    conversation: { conversationId: 101, sessionVersion: null },
    evidence: []
  };
}

function buildSnapshot(): CommercialContextSnapshot {
  return {
    contractName: "CommercialContext",
    schemaVersion: "1.0",
    status: "success",
    completeness: "minimal",
    customer: null,
    conversation: { id: "101", publicId: "conv-p6-c", channel: "whatsapp", provider: "meta", externalContactId: "56900001111", status: "open", aiEnabled: true, humanOwnerActive: false, lastMessageAt: null },
    recentMessages: [],
    opportunity: { id: 501, status: "open", stage: null, conversationCaseId: null },
    needProfile: null,
    actions: [],
    signals: { hasCustomer: false, hasOpportunity: true, hasNeedProfile: false, hasRecentMessages: false, humanOwnerActive: false, aiBlocked: false, staleContext: false, identityConflict: false },
    identityConflict: null,
    shippingDestination: null,
    commercialLineItems: null,
    availableCapabilities: [],
    warnings: [],
    customer360: null,
    customer360State: "not_requested",
    customerSession: null,
    metadata: { source: "native_mariadb", conversationPublicId: "conv-p6-c", currentTime: NOW }
  } as unknown as CommercialContextSnapshot;
}

function buildConfiguration(): ResolvedSalesAgentConfiguration {
  return {
    source: "safe_default",
    scopeKey: SALES_AGENT_CONFIGURATION_SCOPE,
    recordId: null,
    version: null,
    configurationHash: null,
    configuration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    effectiveModelConfiguration: SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
    effectiveLoopConfiguration: SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
    effectiveFollowUpConfiguration: SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT
  };
}

function buildWork(overrides: Partial<PersistedCommercialWork> = {}): PersistedCommercialWork {
  return {
    id: "work-p6-c",
    projectionVersion: 1,
    opportunityId: 501,
    conversationId: 101,
    sourceMessageId: null,
    sourceSequence: null,
    lastReconciledSequence: null,
    previousWorkPublicId: null,
    supersedesWorkPublicId: null,
    trigger: { type: "SYSTEM_EVENT", eventType: "p6_c_test", correlationId: "corr-p6-c", conversationId: 101, opportunityId: 501 },
    status: "ACTIVE",
    objectives: [],
    steps: [],
    blockers: [],
    derivedAt: NOW,
    metrics: { objectiveCount: 0, readyStepCount: 0, waitingCustomerObjectiveCount: 0, waitingSystemStepCount: 0, blockerCount: 0 },
    publicId: "cw-p6-c",
    correlationKey: "corr-key-p6-c",
    version: 4,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    ...overrides
  };
}

function quoteObjective(objectiveId = "cwo-p6-c-quote"): PersistedCommercialWork["objectives"][number] {
  return { objectiveId, type: "QUOTE", status: "PENDING" } as PersistedCommercialWork["objectives"][number];
}

const DISPATCH_SKIPPED: DispatchSalesAgentTerminalOutcomeResult = {
  attempted: false,
  dispatchKind: "responded",
  outboxWritten: false,
  outboxId: null,
  duplicate: false,
  status: "skipped",
  reason: "autonomous_responses_disabled",
  ownershipTransferred: false,
  messageSent: null,
  warnings: []
};

function successfulEvent() {
  return { ok: true as const, status: "created" as const, event: {} as never };
}

function providerFor(proposal: unknown | undefined) {
  const base = createFakeAgentLoopProvider({ script: [{ type: "respond", message: "Respuesta estable", ...(proposal === undefined ? {} : { commercialProposal: proposal }) }] });
  const inputs: AgentLoopProviderRequest[] = [];
  let calls = 0;
  const provider: AgentLoopProvider = {
    ...base,
    async invoke(request, options) {
      calls += 1;
      inputs.push(structuredClone(request));
      return base.invoke(request, options);
    }
  };
  return { provider, inputs, calls: () => calls };
}

const QUOTE_START_PROPOSAL = {
  schemaVersion: "1" as const,
  objective: { kind: "QUOTE" as const, operation: "START" as const, confidence: "HIGH" as const },
  requestedOutcome: "QUOTE_CREATION" as const,
  requirementSignals: [],
  evidenceCodes: [],
  ambiguity: { present: false, reasonCode: null }
};

type EligibilityEventInput = Parameters<typeof recordCommercialCapabilityEligibilityEvaluatedEvent>[0];

function buildCycleInput(input: {
  provider: AgentLoopProvider;
  readModel?: CommercialDomainReadModel;
  work?: PersistedCommercialWork | null;
  capabilityEligibilityShadowEnabled?: boolean;
  commercialProposalShadowEnabled?: boolean;
  commercialObjectiveReconciliationEnabled?: boolean;
  kernelFailure?: boolean;
  applyWork?: PersistedCommercialWork;
  eligibilityRecorder?: (event: EligibilityEventInput) => Promise<ReturnType<typeof successfulEvent>>;
  runEligibility?: NonNullable<RunSalesAgentRuntimeCycleInput["runCapabilityEligibilityShadowFn"]>;
}): RunSalesAgentRuntimeCycleInput {
  const eventOk = async () => successfulEvent();
  return {
    conversationId: 101,
    conversationPublicId: "conv-p6-c",
    customerMasterId: null,
    waId: "56900001111",
    phoneNumberId: "phone-p6-c",
    messageId: "wamid.p6-c",
    inboundMessageId: "wamid.p6-c",
    correlationId: "corr-p6-c",
    currentTime: NOW,
    customerMessage: "quiero una cotizacion",
    snapshot: buildSnapshot(),
    provider: input.provider,
    resolvedSalesAgentConfiguration: buildConfiguration(),
    sessionStore: createInMemoryAgentSessionStore(),
    agentTurnInputShadowEnabled: input.readModel !== undefined,
    buildAgentTurnInputShadowDomainReadModel: input.readModel === undefined ? undefined : async () => input.readModel!,
    commercialWorkKernelEnabled: input.kernelFailure || input.work !== undefined,
    ensureCommercialWorkCaseFn: input.kernelFailure
      ? async () => ({ result: "FAILED" as const, error: new Error("p6_c_kernel_failure") })
      : input.work === undefined
        ? undefined
        : async () => ({ result: "EXISTING" as const, work: input.work! }),
    commercialProposalShadowEnabled: input.commercialProposalShadowEnabled ?? false,
    commercialObjectiveReconciliationEnabled: input.commercialObjectiveReconciliationEnabled ?? false,
    applyCommercialObjectiveReconciliationDecisionFn: input.applyWork === undefined ? undefined : async () => input.applyWork!,
    capabilityEligibilityShadowEnabled: input.capabilityEligibilityShadowEnabled ?? false,
    dispatchSalesAgentTerminalOutcomeFn: async () => DISPATCH_SKIPPED,
    recordAgentToolLoopCompletedCommercialEventFn: eventOk,
    recordCommercialWorkKernelResolvedEventFn: eventOk,
    recordCommercialObjectiveReconciliationDecidedEventFn: eventOk,
    recordCommercialObjectiveReconciledEventFn: eventOk,
    recordCommercialProposalShadowBuiltEventFn: eventOk,
    recordCommercialCapabilityEligibilityEvaluatedEventFn: input.eligibilityRecorder ?? eventOk,
    runCapabilityEligibilityShadowFn: input.runEligibility
  };
}

function runtimeComparable(result: Awaited<ReturnType<typeof runSalesAgentRuntimeCycle>>) {
  return {
    status: result.runtime.status,
    responseText: result.runtime.responseText,
    reason: result.runtime.reason,
    finalPendingCatalogAction: result.runtime.finalPendingCatalogAction,
    commercialProposal: result.runtime.commercialProposal,
    providerCallCount: result.runtime.providerCallCount,
    toolCalls: result.runtime.toolCalls,
    agentTurnInputShadow: result.agentTurnInputShadow,
    dispatch: result.dispatch
  };
}

test("P6-C1/C8/C9: OFF is inert and leaves provider input, P2 observation, runtime, and dispatch unchanged", async () => {
  const readModel = buildReadModel();
  const work = buildWork();
  let offEvaluations = 0;
  let offEvents = 0;
  const offProvider = providerFor(undefined);
  const offInput = buildCycleInput({
    provider: offProvider.provider,
    readModel,
    work,
    runEligibility: async (shadowInput) => {
      offEvaluations += 1;
      return runCapabilityEligibilityShadow(shadowInput);
    },
    eligibilityRecorder: async () => {
      offEvents += 1;
      return successfulEvent();
    }
  });
  let offDrmBuilds = 0;
  const offDrmBuilder = offInput.buildAgentTurnInputShadowDomainReadModel!;
  offInput.buildAgentTurnInputShadowDomainReadModel = async () => {
    offDrmBuilds += 1;
    return offDrmBuilder();
  };
  const off = await runSalesAgentRuntimeCycle(offInput);

  const onProvider = providerFor(undefined);
  const onInput = buildCycleInput({
    provider: onProvider.provider,
    readModel,
    work,
    capabilityEligibilityShadowEnabled: true
  });
  let onDrmBuilds = 0;
  const onDrmBuilder = onInput.buildAgentTurnInputShadowDomainReadModel!;
  onInput.buildAgentTurnInputShadowDomainReadModel = async () => {
    onDrmBuilds += 1;
    return onDrmBuilder();
  };
  const on = await runSalesAgentRuntimeCycle(onInput);

  assert.equal(offEvaluations, 0);
  assert.equal(offEvents, 0);
  assert.equal(offDrmBuilds, 1);
  assert.equal(onDrmBuilds, 1, "P6 must not construct or adapt another DRM");
  assert.equal(offProvider.calls(), onProvider.calls());
  assert.deepEqual(offProvider.inputs, onProvider.inputs);
  assert.deepEqual(runtimeComparable(off), runtimeComparable(on));
});

test("P6-C2/C3/C7/C10/C11/C12: ON evaluates and records once with post-P5 work, without tool execution", async () => {
  const workBefore = buildWork();
  const workAfter = buildWork({
    version: 5,
    objectives: [quoteObjective()]
  });
  const readModel = buildReadModel();
  const capturedEvents: EligibilityEventInput[] = [];
  let evaluations = 0;
  let observedReadModel: CommercialDomainReadModel | null = null;
  let observedWork: object | null | undefined = null;
  const trackedProvider = providerFor(QUOTE_START_PROPOSAL);
  const result = await runSalesAgentRuntimeCycle(buildCycleInput({
    provider: trackedProvider.provider,
    readModel,
    work: workBefore,
    capabilityEligibilityShadowEnabled: true,
    commercialProposalShadowEnabled: true,
    commercialObjectiveReconciliationEnabled: true,
    applyWork: workAfter,
    runEligibility: async (shadowInput) => {
      evaluations += 1;
      observedReadModel = shadowInput.domainReadModel;
      observedWork = shadowInput.work;
      return runCapabilityEligibilityShadow(shadowInput);
    },
    eligibilityRecorder: async (event) => {
      capturedEvents.push(event);
      return successfulEvent();
    }
  }));

  assert.equal(evaluations, 1);
  assert.equal(observedReadModel, readModel, "P6 must reuse the exact P2 DRM instance");
  assert.equal(observedWork, workAfter, "P6 must observe the in-memory post-P5 work instance");
  assert.equal(capturedEvents.length, 1);
  assert.equal(capturedEvents[0]!.payload.workVersion, 5);
  assert.equal(capturedEvents[0]!.payload.objectiveType, "QUOTE");
  assert.ok(capturedEvents[0]!.payload.eligibleCapabilityNames.includes("create_quote"));
  assert.ok(capturedEvents[0]!.payload.eligibleCapabilityNames.includes("get_quote"));
  assert.equal(result.runtime.toolCalls, 0);
  assert.deepEqual(result.runtime.commercialProposal, QUOTE_START_PROPOSAL);
  assert.deepEqual(workBefore, buildWork(), "P6/P5 test seams must not mutate workBefore");
  assert.equal(trackedProvider.calls(), 1);
  assert.deepEqual(Object.keys(capturedEvents[0]!.payload).sort(), ["blockedCapabilities", "eligibleCapabilityNames", "metadataVersion", "objectiveType", "schemaVersion", "workId", "workVersion"]);
});

test("P6-C4: null proposal preserves and evaluates the existing durable QUOTE objective", async () => {
  const activeQuote = buildWork({ objectives: [quoteObjective("cwo-existing")] });
  const capturedEvents: EligibilityEventInput[] = [];
  const result = await runSalesAgentRuntimeCycle(buildCycleInput({
    provider: providerFor(undefined).provider,
    readModel: buildReadModel(),
    work: activeQuote,
    capabilityEligibilityShadowEnabled: true,
    commercialProposalShadowEnabled: true,
    commercialObjectiveReconciliationEnabled: true,
    applyWork: activeQuote,
    eligibilityRecorder: async (event) => {
      capturedEvents.push(event);
      return successfulEvent();
    }
  }));

  assert.equal(result.runtime.commercialProposal, null);
  assert.equal(capturedEvents[0]!.payload.objectiveType, "QUOTE");
  assert.equal(capturedEvents[0]!.payload.workVersion, activeQuote.version);
});

test("P6-C5/C6: absent DRM or absent kernel work causes no P6 evaluation, event, or reconstruction", async () => {
  for (const scenario of [
    { readModel: undefined, work: buildWork() },
    { readModel: buildReadModel(), kernelFailure: true }
  ]) {
    let evaluations = 0;
    let events = 0;
    const on = await runSalesAgentRuntimeCycle(buildCycleInput({
      provider: providerFor(undefined).provider,
      ...scenario,
      capabilityEligibilityShadowEnabled: true,
      runEligibility: async (shadowInput) => {
        evaluations += 1;
        return runCapabilityEligibilityShadow(shadowInput);
      },
      eligibilityRecorder: async () => {
        events += 1;
        return successfulEvent();
      }
    }));
    const off = await runSalesAgentRuntimeCycle(buildCycleInput({
      provider: providerFor(undefined).provider,
      ...scenario
    }));
    assert.equal(evaluations, 0);
    assert.equal(events, 0);
    assert.deepEqual(runtimeComparable(on), runtimeComparable(off));
  }
});

test("P6-C13/C14: integrated snapshot blocks stale quote and stale selection without adding shipping prerequisites", async () => {
  const staleQuoteEvents: EligibilityEventInput[] = [];
  await runSalesAgentRuntimeCycle(buildCycleInput({
    provider: providerFor(undefined).provider,
    readModel: buildReadModel({ quote: "STALE" }),
    work: buildWork({ objectives: [quoteObjective("cwo-quote")] }),
    capabilityEligibilityShadowEnabled: true,
    eligibilityRecorder: async (event) => {
      staleQuoteEvents.push(event);
      return successfulEvent();
    }
  }));
  assert.deepEqual(staleQuoteEvents[0]!.payload.blockedCapabilities.find((entry) => entry.capability === "get_quote")?.reasonCodes, ["QUOTE_NOT_CURRENT"]);

  const unknownQuoteEvents: EligibilityEventInput[] = [];
  await runSalesAgentRuntimeCycle(buildCycleInput({
    provider: providerFor(undefined).provider,
    readModel: buildReadModel({ quote: "UNKNOWN" }),
    work: buildWork({ objectives: [quoteObjective("cwo-quote")] }),
    capabilityEligibilityShadowEnabled: true,
    eligibilityRecorder: async (event) => {
      unknownQuoteEvents.push(event);
      return successfulEvent();
    }
  }));
  assert.deepEqual(unknownQuoteEvents[0]!.payload.blockedCapabilities.find((entry) => entry.capability === "get_quote")?.reasonCodes, ["QUOTE_NOT_CURRENT"]);

  const staleSelectionEvents: EligibilityEventInput[] = [];
  await runSalesAgentRuntimeCycle(buildCycleInput({
    provider: providerFor(undefined).provider,
    readModel: buildReadModel({ selection: "STALE" }),
    work: buildWork({ objectives: [quoteObjective("cwo-quote")] }),
    capabilityEligibilityShadowEnabled: true,
    eligibilityRecorder: async (event) => {
      staleSelectionEvents.push(event);
      return successfulEvent();
    }
  }));
  const blocked = staleSelectionEvents[0]!.payload.blockedCapabilities;
  assert.deepEqual(blocked.find((entry) => entry.capability === "create_quote")?.reasonCodes, ["SELECTION_NOT_CURRENT"]);
  assert.ok(blocked.find((entry) => entry.capability === "calculate_shipping")?.reasonCodes.includes("SELECTION_NOT_CURRENT"));
});

test("P6-C15: eligibility telemetry failure is isolated from the terminal response", async () => {
  let telemetryAttempts = 0;
  const base = await runSalesAgentRuntimeCycle(buildCycleInput({
    provider: providerFor(undefined).provider,
    readModel: buildReadModel(),
    work: buildWork({ objectives: [quoteObjective("cwo-quote")] })
  }));
  const failed = await runSalesAgentRuntimeCycle(buildCycleInput({
    provider: providerFor(undefined).provider,
    readModel: buildReadModel(),
    work: buildWork({ objectives: [quoteObjective("cwo-quote")] }),
    capabilityEligibilityShadowEnabled: true,
    eligibilityRecorder: async () => {
      telemetryAttempts += 1;
      throw new Error("p6_telemetry_failure");
    }
  }));
  assert.deepEqual(runtimeComparable(failed), runtimeComparable(base));
  assert.equal(telemetryAttempts, 1);
});
