import assert from "node:assert/strict";
import test from "node:test";
import { createFakeSalesAgentProvider } from "../../lib/brain/commercial/sales-agent/providers/fakeSalesAgentProvider";
import { runCommercialShadowEvaluation } from "../../lib/brain/commercial/shadow/runCommercialShadowEvaluation";
import { COMMERCIAL_SHADOW_DEFAULT_FEATURE_FLAGS } from "../../lib/brain/commercial/shadow/shadowConstants";
import { makeBrainContextResolveResponse, makeCommercialPolicyFlags, makeCommercialShadowFlags, makeCommercialShadowInput, makeInboundRequest, makeNormalizedInboundMessage, FIXED_TIME } from "./fixtures";
import { SALES_AGENT_CONTRACT_VERSION, SALES_AGENT_PROMPT_VERSION, SALES_AGENT_RUNTIME_VERSION } from "../../lib/brain/commercial/sales-agent/runtimeTypes";
import type { CommercialShadowInput, CommercialShadowResult } from "../../lib/brain/commercial/shadow";
import type { SalesAgentRuntimeClock } from "../../lib/brain/commercial/sales-agent/runtimeTypes";

function makeAdvancingClock(stepMs: number): SalesAgentRuntimeClock {
  let current = 0;
  return {
    now: () => {
      current += stepMs;
      return current;
    },
    toISOString: (value) => {
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
    }
  };
}

function makeValidRawOutput(overrides: Record<string, unknown> = {}) {
  return {
    runId: "corr-001",
    contractVersion: SALES_AGENT_CONTRACT_VERSION,
    outcome: "response_proposed",
    analysis: {
      summary: "Consulta de producto con intencion comercial.",
      qualificationState: "qualified",
      customerReadiness: "ready",
      productFit: "good",
      confidence: "high",
      riskLevel: "low",
      reasonCodes: ["customer_message_present"]
    },
    decision: {
      type: "respond_now",
      reason: "Se puede responder.",
      confidence: "high",
      riskLevel: "low",
      requiresApproval: "none",
      errorCode: "none",
      reasonCodes: ["customer_message_present"],
      policyTags: ["commercial_reply"]
    },
    shouldRespondNow: true,
    shouldRequestTool: false,
    shouldRequestHuman: false,
    shouldEvaluateFollowUp: false,
    proposedActions: [],
    toolRequests: [],
    entityProposals: [],
    responseProposal: {
      messageIntent: "answer",
      draftText: "Hola, te comparto la informacion solicitada.",
      language: "es",
      tone: "friendly",
      questions: [],
      claims: [],
      disclaimers: [],
      requiresApproval: "none",
      blockedClaims: [],
      confidence: "high"
    },
    evidence: [
      {
        source: "customer_message",
        summary: "Solicitud comercial explicita.",
        verified: true,
        confidence: "high",
        reference: "msg-001",
        capturedAt: FIXED_TIME,
        expiresAt: null
      }
    ],
    policyAssessment: {
      status: "allowed",
      blocked: false,
      reason: "Sin bloqueo.",
      confidence: "high",
      riskLevel: "low",
      approvalRequirement: "none",
      errorCode: "none",
      reasonCodes: [],
      policyTags: ["commercial_reply"]
    },
    warnings: [],
    rationale: {
      summary: "Resumen operacional breve.",
      evidence: ["Mensaje inbound del cliente."],
      counterEvidence: [],
      assumptions: [],
      riskFlags: [],
      missingInformation: [],
      policyRulesApplied: ["fail_closed_validation"]
    },
    metadata: {
      traceId: "trace-001"
    },
    ...overrides
  };
}

function makeShadowResult(overrides: Partial<CommercialShadowResult> = {}): CommercialShadowResult {
  return {
    status: "completed",
    mode: "shadow",
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
      startedAt: FIXED_TIME,
      completedAt: FIXED_TIME,
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
      contractVersion: SALES_AGENT_CONTRACT_VERSION,
      promptVersion: SALES_AGENT_PROMPT_VERSION,
      policyVersion: "brain.commercial.policy.v1",
      runtimeVersion: "sales-agent-runtime-dry-run-v0.1.0"
    },
    metadata: {
      safeTraceId: "trace-001"
    },
    observedAt: FIXED_TIME,
    sideEffects: {
      messagesSent: 0,
      toolsExecuted: 0,
      databaseWrites: 0,
      outboxWrites: 0,
      leadsCreated: 0,
      opportunitiesCreated: 0,
      casesMutated: 0
    },
    executionDisposition: "observe_only",
    telemetry: [],
    context: null,
    ...overrides
  };
}

function makeInput(overrides: Partial<CommercialShadowInput> = {}): CommercialShadowInput {
  return makeCommercialShadowInput({
    ...overrides,
    shadowFlags: overrides.shadowFlags ?? makeCommercialShadowFlags(),
    policyFlags: overrides.policyFlags ?? makeCommercialPolicyFlags()
  });
}

function makeStableResult(result: CommercialShadowResult) {
  return {
    ...result,
    metadata: {
      ...result.metadata,
      generatedAt: undefined
    },
    telemetry: result.telemetry.map((event) => ({
      ...event,
      durationMs: event.durationMs
    }))
  };
}

test("shadow disabled does not call the provider", async () => {
  let invoked = 0;
  const provider = {
    name: "spy-provider",
    version: "spy.v1",
    async invoke() {
      invoked += 1;
      return {
        rawOutput: makeValidRawOutput(),
        model: "spy-model",
        inputTokens: 1,
        outputTokens: 1,
        estimatedCost: 0,
        providerRequestId: "spy-request",
        finishReason: "stop",
        metadata: {}
      };
    }
  };

  const result = await runCommercialShadowEvaluation(
    makeInput({
      shadowFlags: {
        ...COMMERCIAL_SHADOW_DEFAULT_FEATURE_FLAGS,
        commercialShadowEnabled: false
      },
      provider: provider as never
    })
  );

  assert.equal(invoked, 0);
  assert.equal(result.status, "disabled");
  assert.equal(result.enabled, false);
  assert.equal(result.executionDisposition, "not_executed");
});

test("completed shadow keeps zero side effects and stable versions", async () => {
  const result = await runCommercialShadowEvaluation(makeInput());

  assert.equal(result.status, "completed_with_restrictions");
  assert.equal(result.executionDisposition, "discard_after_observation");
  assert.deepEqual(result.sideEffects, {
    messagesSent: 0,
    toolsExecuted: 0,
    databaseWrites: 0,
    outboxWrites: 0,
    leadsCreated: 0,
    opportunitiesCreated: 0,
    casesMutated: 0
  });
  assert.equal(result.runtimeSummary?.status, "completed_valid");
  assert.equal(result.policySummary?.status !== "failed_safe", true);
  assert.equal(result.runtimeSummary?.rawOutputCaptured, false);
  assert.equal(result.runtimeSummary?.promptPreviewIncluded, false);
  assert.equal(result.versions.shadowVersion, "brain.commercial.shadow.v1");
  assert.equal(result.versions.contractVersion, SALES_AGENT_CONTRACT_VERSION);
  assert.equal(result.versions.promptVersion, SALES_AGENT_PROMPT_VERSION);
  assert.equal(result.versions.policyVersion, "brain.commercial.policy.v1");
  assert.equal(result.versions.runtimeVersion, SALES_AGENT_RUNTIME_VERSION);
  assert.deepEqual(
    result.stages.map((stage) => stage.stage),
    ["eligibility", "context_builder", "sales_agent_runtime", "commercial_policy"]
  );
});

test("returns context_failed when the builder cannot produce context", async () => {
  const result = await runCommercialShadowEvaluation(
    makeInput({
      brainContext: {} as never,
      requestedMode: "bogus" as never
    })
  );

  assert.equal(result.status, "context_failed");
  assert.equal(result.eligible, true);
  assert.equal(result.executionDisposition, "not_executed");
  assert.equal(result.error?.stage, "context_builder");
});

test("returns skipped when the inbound is not eligible", async () => {
  const result = await runCommercialShadowEvaluation(
    makeInput({
      inboundMessage: makeNormalizedInboundMessage({
        channel: "sms"
      }) as never
    })
  );

  assert.equal(result.status, "skipped");
  assert.equal(result.skipReason, "unsupported_channel");
  assert.equal(result.executionDisposition, "not_executed");
});

test("reports review policy outcomes", async () => {
  const commercialEntityContext = {
    ...makeBrainContextResolveResponse(),
    lead: {
      id: 1
    },
    opportunity: {
      id: 2
    }
  } as never;

  const allowed = await runCommercialShadowEvaluation(
    makeInput({
      brainContext: commercialEntityContext
    })
  );
  const review = await runCommercialShadowEvaluation(
    makeInput({
      brainContext: commercialEntityContext,
      provider: createFakeSalesAgentProvider({ behavior: "valid_tool_request" }) as never,
      shadowFlags: {
        ...makeCommercialShadowFlags({ commercialShadowAllowRealProvider: true })
      }
    })
  );

  assert.equal(allowed.policySummary?.status, "requires_review");
  assert.equal(review.policySummary?.status, "requires_review");
});

test("returns runtime_failed for invalid output and provider unavailable", async () => {
  const invalidOutput = await runCommercialShadowEvaluation(
    makeInput({
      brainContext: {
        ...makeBrainContextResolveResponse(),
        lead: {
          id: 1
        },
        opportunity: {
          id: 2
        }
      } as never,
      provider: createFakeSalesAgentProvider({ behavior: "invalid" }) as never,
      shadowFlags: {
        ...makeCommercialShadowFlags({ commercialShadowAllowRealProvider: true })
      }
    })
  );
  const providerUnavailable = await runCommercialShadowEvaluation(
    makeInput({
      brainContext: {
        ...makeBrainContextResolveResponse(),
        lead: {
          id: 1
        },
        opportunity: {
          id: 2
        }
      } as never,
      provider: createFakeSalesAgentProvider({ behavior: "provider_unavailable" }) as never,
      shadowFlags: {
        ...makeCommercialShadowFlags({ commercialShadowAllowRealProvider: true })
      }
    })
  );

  assert.equal(invalidOutput.status, "runtime_failed");
  assert.equal(invalidOutput.runtimeSummary?.status, "validation_failed_safe");
  assert.equal(providerUnavailable.status, "runtime_failed");
  assert.equal(providerUnavailable.runtimeSummary?.status, "provider_unavailable");
});

test("returns policy_failed when policy contract versions mismatch", async () => {
  const result = await runCommercialShadowEvaluation(
    makeInput({
      policyVersion: "brain.commercial.policy.v9"
    })
  );

  assert.equal(result.status, "policy_failed");
  assert.equal(result.policySummary?.status, "failed_safe");
});

test("times out when the overall budget is exceeded", async () => {
  const result = await runCommercialShadowEvaluation(
    makeInput({
      options: {
        timeoutMs: 1
      },
      clock: makeAdvancingClock(100),
      provider: createFakeSalesAgentProvider({ behavior: "valid" }) as never
    })
  );

  assert.equal(result.status, "timeout");
  assert.ok(result.warnings.includes("shadow_timeout"));
  assert.ok(result.warnings.includes("shadow_latency_budget_exceeded"));
});

test("cancels before executing when the abort signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  let invoked = 0;
  const provider = {
    name: "spy-provider",
    async invoke() {
      invoked += 1;
      return {
        rawOutput: makeValidRawOutput(),
        model: "spy-model"
      };
    }
  };

  const result = await runCommercialShadowEvaluation(
    makeInput({
      abortSignal: controller.signal,
      provider: provider as never
    })
  );

  assert.equal(invoked, 0);
  assert.equal(result.status, "cancelled");
  assert.equal(result.executionDisposition, "not_executed");
});

test("blocks a provider when real provider use is disabled", async () => {
  let invoked = 0;
  const spyProvider = {
    name: "spy-provider",
    async invoke() {
      invoked += 1;
      return {
        rawOutput: makeValidRawOutput(),
        model: "spy-model"
      };
    }
  };

  const result = await runCommercialShadowEvaluation(
    makeInput({
      provider: spyProvider as never,
      shadowFlags: {
        ...makeCommercialShadowFlags({ commercialShadowAllowRealProvider: false })
      }
    })
  );

  assert.equal(invoked, 0);
  assert.equal(result.runtimeSummary?.providerName, "fake-sales-agent-provider");
});

test("sanitizes metadata, remains serializable and deterministic", async () => {
  const metadata: Record<string, unknown> = {
    safeTraceId: "trace-001",
    token: "secret-token",
    headers: {
      authorization: "Bearer hidden"
    },
    orderId: 9007199254740993n,
    when: new Date(FIXED_TIME),
    map: new Map([["k", "v"]]),
    set: new Set(["v"])
  };
  const input = makeInput({
    metadata
  });
  const before = structuredClone(input);
  const first = await runCommercialShadowEvaluation(input);
  const second = await runCommercialShadowEvaluation(makeInput({ metadata }));

  assert.deepEqual(input, before);
  assert.equal(Object.prototype.hasOwnProperty.call(first.metadata, "token"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first.metadata, "headers"), false);
  assert.equal(typeof first.metadata.orderId, "string");
  assert.equal(first.runtimeSummary?.rawOutputCaptured, false);
  assert.equal(first.runtimeSummary?.promptPreviewIncluded, false);
  assert.doesNotThrow(() => JSON.stringify(first));
  assert.deepEqual(makeStableResult(first), makeStableResult(second));
});

test("captures safe telemetry and stage metrics", async () => {
  const result = await runCommercialShadowEvaluation(makeInput());

  assert.ok(result.telemetry.length > 0);
  assert.ok(result.telemetry.every((event) => event.sideEffects.messagesSent === 0 && event.sideEffects.toolsExecuted === 0));
  assert.ok(result.stages.every((stage) => stage.durationMs >= 0));
});
