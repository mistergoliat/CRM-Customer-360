import assert from "node:assert/strict";
import test from "node:test";
import { processInbound } from "../../lib/brain/processInbound";
import { runCommercialShadowEvaluation } from "../../lib/brain/commercial/shadow/runCommercialShadowEvaluation";
import { makeBrainActionResolveResponse, makeBrainContextResolveResponse, makeCommercialShadowFlags, makeInboundRequest } from "./fixtures";
import type { BrainProcessInboundResponse } from "../../lib/brain/inbound/types";
import type { CommercialShadowResult } from "../../lib/brain/commercial/shadow";

function pickComparableResponse(result: BrainProcessInboundResponse) {
  return {
    ok: result.ok,
    requestId: result.requestId,
    channel: result.channel,
    source: result.source,
    suggested_next_step: result.suggested_next_step,
    action_policy: result.action_policy,
    normalized_action: result.normalized_action,
    blocked_reasons: result.blocked_reasons,
    instructions: {
      version: result.instructions.version,
      continueLegacyFlow: result.instructions.continueLegacyFlow,
      suggestedNextStep: result.instructions.suggestedNextStep
    },
    warnings: result.warnings,
    errors: result.errors,
    aiOrchestrator: result.adapters.aiOrchestrator.status
  };
}

function makeShadowHookResult(status: CommercialShadowResult["status"]): CommercialShadowResult {
  return {
    ...(awaitedShadowTemplate as CommercialShadowResult),
    status,
    executionDisposition: status === "completed" ? "observe_only" : "discard_after_observation"
  };
}

const awaitedShadowTemplate: CommercialShadowResult = {
  status: "completed" as const,
  mode: "shadow" as const,
  enabled: true,
  eligible: true,
  skipReason: null,
  correlationId: "corr-001",
  executionId: "exec-001",
  commercialContextSummary: null,
  runtimeSummary: null,
  policySummary: null,
  governedResultSummary: null,
  stages: [],
  metrics: {
    startedAt: "2026-06-17T12:00:00.000Z",
    completedAt: "2026-06-17T12:00:00.000Z",
    durationMs: 0,
    eligibilityDurationMs: 0,
    contextBuilderDurationMs: 0,
    runtimeDurationMs: 0,
    validationDurationMs: 0,
    policyDurationMs: 0,
    overheadMs: 0,
    inputCharacters: 1,
    outputCharacters: 1,
    providerDurationMs: 0,
    model: null,
    inputTokens: null,
    outputTokens: null,
    estimatedCost: null,
    providerRequestId: null,
    timedOut: false,
    warningsCount: 0
  },
  warnings: [],
  error: null,
  versions: {
    shadowVersion: "brain.commercial.shadow.v1",
    contractVersion: "sales-agent-output-contract-v1",
    promptVersion: "sales-agent-runtime-v0.1.0",
    policyVersion: "brain.commercial.policy.v1",
    runtimeVersion: "sales-agent-runtime-dry-run-v0.1.0"
  },
  metadata: {},
  observedAt: "2026-06-17T12:00:00.000Z",
  sideEffects: {
    messagesSent: 0,
    toolsExecuted: 0,
    databaseWrites: 0,
    outboxWrites: 0,
    leadsCreated: 0,
    opportunitiesCreated: 0,
    casesMutated: 0
  },
  executionDisposition: "observe_only" as const,
  telemetry: [],
  context: null
};

function makeProcessInboundDeps(shadowHook?: (input: Parameters<typeof runCommercialShadowEvaluation>[0]) => Promise<CommercialShadowResult>) {
  let contextCalls = 0;
  let actionCalls = 0;
  let shadowCalls = 0;

  const resolveBackendBrainContext = async () => {
    contextCalls += 1;
    return makeBrainContextResolveResponse();
  };

  const resolveBrainAction = async () => {
    actionCalls += 1;
    return makeBrainActionResolveResponse();
  };

  const commercialShadowHook = async (input: Parameters<typeof runCommercialShadowEvaluation>[0]) => {
    shadowCalls += 1;
    if (shadowHook) {
      return shadowHook(input);
    }
    return runCommercialShadowEvaluation(input);
  };

  return {
    resolveBackendBrainContext,
    resolveBrainAction,
    commercialShadow: {
      commercialShadowHook,
      commercialShadowFlags: makeCommercialShadowFlags()
    },
    counters: {
      get contextCalls() {
        return contextCalls;
      },
      get actionCalls() {
        return actionCalls;
      },
      get shadowCalls() {
        return shadowCalls;
      }
    }
  };
}

test("shadow disabled does not invoke the shadow hook", async () => {
  const deps = makeProcessInboundDeps(async () => {
    throw new Error("should not be called");
  });
  const request = makeInboundRequest();

  const result = await processInbound(request, Date.parse("2026-06-17T12:00:00.000Z"), {
    resolveBackendBrainContext: deps.resolveBackendBrainContext,
    resolveBrainAction: deps.resolveBrainAction,
    commercialShadow: {
      commercialShadowHook: deps.commercialShadow.commercialShadowHook,
      commercialShadowFlags: {
        ...makeCommercialShadowFlags(),
        commercialShadowEnabled: false
      }
    }
  });

  assert.equal(deps.counters.shadowCalls, 0);
  assert.equal(result.adapters.commercialShadow, null);
  assert.equal(result.ok, true);
});

test("shadow enabled observes the commercial result without changing the product response", async () => {
  const deps = makeProcessInboundDeps();
  const request = makeInboundRequest();
  const startedAt = Date.parse("2026-06-17T12:00:00.000Z");

  const disabledResult = await processInbound(request, startedAt, {
    resolveBackendBrainContext: deps.resolveBackendBrainContext,
    resolveBrainAction: deps.resolveBrainAction,
    commercialShadow: {
      commercialShadowHook: deps.commercialShadow.commercialShadowHook,
      commercialShadowFlags: {
        ...makeCommercialShadowFlags(),
        commercialShadowEnabled: false
      }
    }
  });

  const enabledResult = await processInbound(request, startedAt, {
    resolveBackendBrainContext: deps.resolveBackendBrainContext,
    resolveBrainAction: deps.resolveBrainAction,
    commercialShadow: {
      commercialShadowHook: deps.commercialShadow.commercialShadowHook,
      commercialShadowFlags: makeCommercialShadowFlags()
    }
  });

  assert.ok((enabledResult.adapters.commercialShadow as CommercialShadowResult | null)?.status);
  assert.equal(deps.counters.shadowCalls > 0, true);
  assert.deepEqual(pickComparableResponse(enabledResult), pickComparableResponse(disabledResult));
  assert.equal(enabledResult.adapters.commercialShadow?.correlationId, enabledResult.requestId);
});

test("shadow hook failures do not break inbound", async () => {
  const deps = makeProcessInboundDeps(async () => {
    throw new Error("Authorization: Bearer sk-test-123");
  });

  const result = await processInbound(makeInboundRequest(), Date.parse("2026-06-17T12:00:00.000Z"), {
    resolveBackendBrainContext: deps.resolveBackendBrainContext,
    resolveBrainAction: deps.resolveBrainAction,
    commercialShadow: {
      commercialShadowHook: deps.commercialShadow.commercialShadowHook,
      commercialShadowFlags: makeCommercialShadowFlags()
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.adapters.commercialShadow?.status, "failed_safe");
  assert.equal(result.adapters.commercialShadow?.error?.message.includes("sk-test-123"), false);
});

test("shadow timeout summaries do not alter inbound", async () => {
  const deps = makeProcessInboundDeps(async () =>
    makeShadowHookResult("timeout")
  );

  const result = await processInbound(makeInboundRequest(), Date.parse("2026-06-17T12:00:00.000Z"), {
    resolveBackendBrainContext: deps.resolveBackendBrainContext,
    resolveBrainAction: deps.resolveBrainAction,
    commercialShadow: {
      commercialShadowHook: deps.commercialShadow.commercialShadowHook,
      commercialShadowFlags: makeCommercialShadowFlags()
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.adapters.commercialShadow?.status, "timeout");
  assert.equal(result.adapters.commercialShadow?.sideEffects.messagesSent, 0);
});
