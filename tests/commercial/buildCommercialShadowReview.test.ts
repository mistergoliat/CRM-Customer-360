import assert from "node:assert/strict";
import test from "node:test";
import { buildCommercialShadowReview } from "../../lib/brain/commercial/review";
import { evaluateCommercialShadowResult } from "../../lib/brain/commercial/evaluation";
import { createFakeSalesAgentProvider, type SalesAgentFakeProviderBehavior } from "../../lib/brain/commercial/sales-agent/providers";
import { runCommercialShadowEvaluation } from "../../lib/brain/commercial/shadow/runCommercialShadowEvaluation";
import { makeCommercialShadowFlags, makeCommercialShadowInput } from "./fixtures";

const IDENTIFIERS = {
  correlationId: "corr-review-001",
  processInboundRunId: "process-inbound-001",
  salesAgentRunId: "sales-agent-001",
  caseId: 4821,
  conversationCaseId: 4821,
  waId: "56912345678",
  email: "cliente@example.com",
  phone: "+56912345678",
  idCustomer: 10045,
  idOrder: 20001,
  invoiceNumber: 30001
} as const;

async function buildAvailableReview(behavior: SalesAgentFakeProviderBehavior = "valid") {
  const result = await runCommercialShadowEvaluation({
    ...makeCommercialShadowInput({
      correlationId: IDENTIFIERS.correlationId,
      executionId: "exec-review-001",
      provider: createFakeSalesAgentProvider({ behavior }),
      shadowFlags: makeCommercialShadowFlags()
    }),
    metadata: {
      safeTraceId: "trace-review-001",
      token: "secret-token",
      rawWebhook: { hidden: true }
    }
  });

  const shadowResult = structuredClone(result) as Record<string, unknown>;
  const context = shadowResult.context as Record<string, unknown> | undefined;
  const runtimeResult = context?.runtimeResult as Record<string, unknown> | undefined;
  const policyResult = context?.policyResult as Record<string, unknown> | undefined;

  if (behavior === "invalid") {
    shadowResult.status = "failed_safe";
    if (runtimeResult) {
      runtimeResult.status = "validation_failed_safe";
      const resultPayload = runtimeResult.result as Record<string, unknown> | undefined;
      if (resultPayload) {
        resultPayload.outcome = "failed_safe";
        const decision = resultPayload.decision as Record<string, unknown> | undefined;
        if (decision) decision.requiresApproval = "blocked";
      }
      const validation = runtimeResult.validation as Record<string, unknown> | undefined;
      if (validation) validation.status = "failed_safe";
    }
    if (policyResult?.governedResult && typeof policyResult.governedResult === "object") {
      (policyResult.governedResult as Record<string, unknown>).outcome = "failed_safe";
    }
  }

  if (behavior === "hard_blocked_action" && policyResult) {
    policyResult.status = "blocked";
    policyResult.overallDecision = "blocked";
    policyResult.riskLevel = "blocked";
    policyResult.requiresApproval = "blocked";
    policyResult.appliedRules = ["POLICY-HARD-BLOCK"];
    policyResult.claimAssessments = [];
    policyResult.actionAssessments = [
      {
        status: "blocked",
        action: {
          type: "create_lead",
          reason: "Blocked for review coverage",
          confidence: "low",
          riskLevel: "blocked",
          requiresApproval: "blocked"
        },
        reason: "Hard blocked action"
      }
    ];
    policyResult.toolRequestAssessments = [];
    policyResult.entityProposalAssessments = [];
    policyResult.governedResult = {
      ...(policyResult.governedResult as Record<string, unknown> | undefined),
      outcome: "blocked_by_policy",
      proposedActions: [
        {
          type: "create_lead",
          reason: "Blocked for review coverage",
          confidence: "low",
          riskLevel: "blocked",
          requiresApproval: "blocked"
        }
      ]
    };
  }

  if (behavior === "sensitive_claim_without_evidence" && policyResult) {
    policyResult.status = "blocked";
    policyResult.overallDecision = "blocked";
    policyResult.riskLevel = "blocked";
    policyResult.requiresApproval = "blocked";
    policyResult.appliedRules = ["POLICY-CLAIM-BLOCK"];
    policyResult.claimAssessments = [
      {
        status: "blocked",
        claim: {
          type: "price",
          value: "999",
          evidence: [],
          evidenceSource: "customer_message",
          confidence: "low"
        },
        reason: "Sensitive claim without evidence",
        ruleIds: ["POLICY-CLAIM-BLOCK"]
      }
    ];
  }

  if (behavior === "valid_tool_request") {
    const toolRequest = {
      tool: "searchKnowledge",
      purpose: "lookup product details",
      status: "planned",
      requiredInputs: {},
      optionalInputs: {},
      urgency: "normal",
      blocking: false,
      reason: "Tool request coverage",
      expectedEvidence: ["knowledge_base"],
      fallbackDecision: "respond_now"
    };
    if (runtimeResult) {
      runtimeResult.toolRequests = [toolRequest];
    }
    if (policyResult) {
      policyResult.governedResult = {
        ...(policyResult.governedResult as Record<string, unknown> | undefined),
        toolRequests: [toolRequest]
      };
    }
  }

  return buildCommercialShadowReview({
    status: "available",
    identifiers: IDENTIFIERS,
    observedAt: result.observedAt,
    correlationId: IDENTIFIERS.correlationId,
    processInboundRunId: IDENTIFIERS.processInboundRunId,
    salesAgentRunId: IDENTIFIERS.salesAgentRunId,
    shadowResult: shadowResult as never,
    evaluationResult: evaluateCommercialShadowResult({
      sampleId: IDENTIFIERS.salesAgentRunId,
      timestamp: result.observedAt,
      scenario: "commercial-shadow-review",
      expectedTags: [],
      shadowResult: shadowResult as never
    }),
    warnings: ["review_fixture"],
    metadata: {
      safeTraceId: "trace-review-001",
      token: "secret-token",
      rawWebhook: { hidden: true }
    }
  });
}

test("maps a complete available observation", async () => {
  const review = await buildAvailableReview("valid");

  assert.equal(review.status, "available");
  assert.equal(review.identifiers.correlationId, IDENTIFIERS.correlationId);
  assert.equal(review.summary?.policyStatus, "requires_review");
  assert.equal(review.summary?.proposedOutcome, "response_proposed");
  assert.equal(review.summary?.governedOutcome, "response_proposed");
  assert.equal(review.summary?.proposedShouldRespondNow, true);
  assert.equal(review.summary?.governedShouldRespondNow, false);
  assert.equal(review.observability.provider, "fake-sales-agent-provider");
  assert.equal(review.invariants.violationDetected, false);
  assert.ok(review.warnings.includes("review_fixture"));
  assert.equal(Object.prototype.hasOwnProperty.call(review.metadata, "token"), false);
  assert.doesNotThrow(() => JSON.stringify(review));
});

test("marks failed_safe observations explicitly", async () => {
  const review = await buildAvailableReview("invalid");

  assert.equal(review.status, "available");
  assert.equal(review.summary?.runtimeStatus, "validation_failed_safe");
  assert.equal(review.summary?.governedOutcome, "failed_safe");
  assert.equal(review.evaluation.status, "failed_safe");
  assert.doesNotThrow(() => JSON.stringify(review));
});

test("distinguishes the agent proposal from the governed policy result", async () => {
  const review = await buildAvailableReview("hard_blocked_action");

  assert.equal(review.summary?.proposedOutcome, "response_proposed");
  assert.equal(review.summary?.policyStatus, "blocked");
  assert.equal(review.summary?.governedOutcome, "blocked_by_policy");
  assert.notStrictEqual(review.summary?.governedOutcome, review.summary?.proposedOutcome);
  assert.ok(review.actions.blocked.length > 0);
});

test("preserves blocked claims and blocked actions", async () => {
  const blockedClaimsReview = await buildAvailableReview("sensitive_claim_without_evidence");
  const blockedActionsReview = await buildAvailableReview("hard_blocked_action");

  assert.ok(blockedClaimsReview.claims.blocked.length > 0);
  assert.ok(blockedClaimsReview.claims.blocked.some((claim) => claim.status === "blocked"));
  assert.ok(blockedClaimsReview.claims.blocked.some((claim) => claim.type === "price"));
  assert.ok(blockedActionsReview.actions.blocked.length > 0);
  assert.ok(blockedActionsReview.actions.blocked.some((action) => action.status === "blocked"));
});

test("preserves blocked tool requests and tool availability", async () => {
  const review = await buildAvailableReview("valid_tool_request");

  assert.ok(review.toolRequests.proposed.length > 0);
  assert.equal(review.toolRequests.proposed[0]?.available, true);
  assert.ok(review.toolRequests.proposed[0] !== undefined);
  assert.doesNotThrow(() => JSON.stringify(review));
});

test("sanitizes metadata and preserves partial metrics", async () => {
  const review = await buildAvailableReview("valid");

  assert.equal(Object.prototype.hasOwnProperty.call(review.metadata, "rawWebhook"), false);
  assert.equal(review.observability.inputTokens, 128);
  assert.equal(review.observability.outputTokens, 256);
  assert.equal(review.observability.totalTokens, 384);
  assert.equal(review.observability.estimatedCost, 0);
  assert.doesNotThrow(() => JSON.stringify(review));
});

test("keeps undefined as unknown and zero as zero", async () => {
  const source = await runCommercialShadowEvaluation({
    ...makeCommercialShadowInput({
      correlationId: IDENTIFIERS.correlationId,
      executionId: "exec-review-002",
      provider: createFakeSalesAgentProvider({ behavior: "valid" }),
      shadowFlags: makeCommercialShadowFlags()
    })
  });
  const partial = structuredClone(source);
  if (partial.context?.runtimeResult?.result && typeof partial.context.runtimeResult.result === "object") {
    const runtimeResult = partial.context.runtimeResult.result as Record<string, unknown>;
    runtimeResult.responseProposal = {
      ...(runtimeResult.responseProposal as Record<string, unknown> | undefined),
      claims: undefined,
      questions: undefined
    };
    runtimeResult.proposedActions = undefined;
    runtimeResult.toolRequests = undefined;
    runtimeResult.entityProposals = undefined;
  }
  if (partial.context?.runtimeResult?.metrics && typeof partial.context.runtimeResult.metrics === "object") {
    const runtimeMetrics = partial.context.runtimeResult.metrics as Record<string, unknown>;
    runtimeMetrics.inputTokens = null;
    runtimeMetrics.outputTokens = 0;
  }
  partial.metrics.inputTokens = null;
  partial.metrics.outputTokens = 0;

  const rebuilt = buildCommercialShadowReview({
    status: "available",
    identifiers: IDENTIFIERS,
    observedAt: partial.observedAt,
    correlationId: IDENTIFIERS.correlationId,
    processInboundRunId: IDENTIFIERS.processInboundRunId,
    salesAgentRunId: IDENTIFIERS.salesAgentRunId,
    shadowResult: partial as never,
    evaluationResult: null,
    metadata: { safeTraceId: "trace-review-001" }
  });

  assert.equal(rebuilt.observability.inputTokens, null);
  assert.equal(rebuilt.observability.outputTokens, 0);
  assert.equal(rebuilt.observability.totalTokens, null);
  assert.equal(rebuilt.claims.detected.length, 0);
  assert.equal(rebuilt.actions.proposed.length, 0);
  assert.equal(rebuilt.toolRequests.proposed.length, 0);
});

test("returns not_found, disabled, and error states", () => {
  const notFound = buildCommercialShadowReview({
    status: "not_found",
    identifiers: IDENTIFIERS,
    reason: "No observation"
  });
  const disabled = buildCommercialShadowReview({
    status: "disabled",
    identifiers: IDENTIFIERS,
    reason: "Feature flag disabled"
  });
  const error = buildCommercialShadowReview({
    status: "error",
    identifiers: IDENTIFIERS,
    reason: "Read failed",
    error: new Error("Authorization: Bearer sk-test-123")
  });

  assert.equal(notFound.status, "not_found");
  assert.equal(disabled.status, "disabled");
  assert.equal(error.status, "error");
  assert.equal(error.error?.message.includes("sk-test-123"), false);
});

test("detects side effect invariants and remains deterministic", async () => {
  const first = await buildAvailableReview("valid");
  const second = await buildAvailableReview("valid");

  assert.deepEqual(first, second);
  assert.equal(first.invariants.shadow, true);
  assert.equal(first.invariants.dryRun, true);
  assert.equal(first.invariants.outboundExecuted, false);
  assert.equal(first.invariants.toolsExecuted, 0);
  assert.equal(first.invariants.commercialDbWrites, 0);
  assert.equal(first.invariants.leadCreated, false);
  assert.equal(first.invariants.opportunityCreated, false);
  assert.equal(first.invariants.caseMutated, false);
  assert.equal(first.invariants.controlsResponsePolicy, false);
});
