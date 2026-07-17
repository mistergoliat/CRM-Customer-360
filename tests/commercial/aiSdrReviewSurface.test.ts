import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCommercialShadowReview } from "../../lib/brain/commercial/review";
import { evaluateCommercialShadowResult } from "../../lib/brain/commercial/evaluation";
import { createFakeSalesAgentProvider } from "../../lib/brain/commercial/sales-agent/providers";
import { runCommercialShadowEvaluation } from "../../lib/brain/commercial/shadow/runCommercialShadowEvaluation";
import { makeCommercialShadowFlags, makeCommercialShadowInput } from "./fixtures";
import { AiSdrReviewPanel } from "../../components/cases/ai-sdr/AiSdrReviewPanel";
import { AiSdrHumanEvaluationDraft, buildCommercialHumanEvaluationDraftPreview } from "../../components/cases/ai-sdr/AiSdrHumanEvaluationDraft";

const IDENTIFIERS = {
  correlationId: "corr-ui-001",
  processInboundRunId: "process-ui-001",
  salesAgentRunId: "sales-ui-001",
  caseId: 4821,
  conversationCaseId: 4821,
  waId: "56912345678",
  email: "cliente@example.com",
  phone: "+56912345678",
  idCustomer: 10045,
  idOrder: 20001,
  invoiceNumber: 30001
} as const;

async function buildAvailableReview(behavior: "valid" | "invalid" | "hard_blocked_action" | "sensitive_claim_without_evidence" | "valid_tool_request" = "valid") {
  const result = await runCommercialShadowEvaluation({
    ...makeCommercialShadowInput({
      correlationId: IDENTIFIERS.correlationId,
      executionId: "exec-ui-001",
      provider: createFakeSalesAgentProvider({ behavior }),
      shadowFlags: makeCommercialShadowFlags()
    })
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
    policyResult.actionAssessments = [
      {
        status: "blocked",
        action: {
          type: "create_lead",
          reason: "Blocked for UI coverage",
          confidence: "low",
          riskLevel: "blocked",
          requiresApproval: "blocked"
        },
        reason: "Hard blocked action"
      }
    ];
    policyResult.governedResult = {
      ...(policyResult.governedResult as Record<string, unknown> | undefined),
      outcome: "blocked_by_policy"
    };
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
      scenario: "commercial-shadow-review-ui",
      expectedTags: [],
      shadowResult: shadowResult as never
    }),
    metadata: {
      safeTraceId: "trace-ui-001"
    }
  });
}

test("renders the available AI SDR surface", async () => {
  const review = await buildAvailableReview("valid");
  const markup = renderToStaticMarkup(createElement(AiSdrReviewPanel, { caseId: IDENTIFIERS.caseId, review }));

  assert.ok(markup.includes("AI SDR"));
  assert.ok(markup.includes("Claims"));
  assert.ok(markup.includes("Acciones y tools"));
  assert.ok(markup.includes("Policy y trazabilidad"));
  assert.ok(markup.includes("Observabilidad"));
  assert.ok(markup.includes("Side effects"));
  assert.ok(markup.includes("Borrador local no guardado"));
  assert.ok(markup.includes("Preparar evaluación"));
});

test("renders empty, disabled, and error states", () => {
  const notFound = buildCommercialShadowReview({
    status: "not_found",
    identifiers: IDENTIFIERS
  });
  const disabled = buildCommercialShadowReview({
    status: "disabled",
    identifiers: IDENTIFIERS
  });
  const error = buildCommercialShadowReview({
    status: "error",
    identifiers: IDENTIFIERS,
    reason: "Read failed",
    error: new Error("Authorization: Bearer sk-test-123")
  });

  const notFoundMarkup = renderToStaticMarkup(createElement(AiSdrReviewPanel, { caseId: IDENTIFIERS.caseId, review: notFound }));
  const disabledMarkup = renderToStaticMarkup(createElement(AiSdrReviewPanel, { caseId: IDENTIFIERS.caseId, review: disabled }));
  const errorMarkup = renderToStaticMarkup(createElement(AiSdrReviewPanel, { caseId: IDENTIFIERS.caseId, review: error }));

  assert.ok(notFoundMarkup.includes("No existe una observación AI SDR"));
  assert.ok(disabledMarkup.includes("AI SDR deshabilitado"));
  assert.ok(errorMarkup.includes("Error seguro"));
  assert.ok(errorMarkup.includes("sk-test-123") === false);
});

test("renders failed_safe and policy blocked distinctions", async () => {
  const failedSafeReview = await buildAvailableReview("invalid");
  const blockedReview = await buildAvailableReview("hard_blocked_action");

  const failedSafeMarkup = renderToStaticMarkup(createElement(AiSdrReviewPanel, { caseId: IDENTIFIERS.caseId, review: failedSafeReview }));
  const blockedMarkup = renderToStaticMarkup(createElement(AiSdrReviewPanel, { caseId: IDENTIFIERS.caseId, review: blockedReview }));

  assert.ok(failedSafeMarkup.includes("failed_safe"));
  assert.ok(blockedMarkup.includes("Policy bloqueó la salida"));
});

test("builds a local evaluation preview without persistence", async () => {
  const review = await buildAvailableReview("valid");
  const preview = buildCommercialHumanEvaluationDraftPreview({
    caseId: IDENTIFIERS.caseId,
    review,
    preparedAt: "2026-06-17T12:00:00.000Z",
    form: {
      responseUseful: "yes",
      responseCorrect: "no",
      policyTooRestrictive: "unreviewed",
      missingContext: "yes",
      expectedOutcome: "Respuesta útil y segura",
      comments: "Sin persistencia"
    }
  });

  assert.equal(preview.caseId, IDENTIFIERS.caseId);
  assert.equal(preview.responseUseful, true);
  assert.equal(preview.responseCorrect, false);
  assert.equal(preview.policyTooRestrictive, null);
  assert.equal(preview.missingContext, true);
  // ACS-R1-05-T06.2: see buildCommercialShadowReview.test.ts - the "valid"
  // fixture's normal inbound message no longer forces requires_review via
  // recentCustomerReply alone (evaluateCommercialPolicy.ts computeChannelSignals).
  assert.equal(preview.reviewSummary.policyStatus, "allowed");
  assert.doesNotThrow(() => JSON.stringify(preview));

  const markup = renderToStaticMarkup(createElement(AiSdrHumanEvaluationDraft, { caseId: IDENTIFIERS.caseId, review }));
  assert.ok(markup.includes("Respuesta útil"));
  assert.ok(markup.includes("Respuesta correcta"));
  assert.ok(markup.includes("policy too restrictive") === false);
});
