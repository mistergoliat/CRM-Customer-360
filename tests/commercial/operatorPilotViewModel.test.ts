import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CommercialShadowReviewViewModel } from "../../lib/brain/commercial/review";
import { buildAiSdrOperatorPilotViewModel } from "../../lib/brain/commercial/operator-pilot";
import { AiSdrOperatorPilotPanel } from "../../components/cases/ai-sdr/operator-pilot/AiSdrOperatorPilotPanel";

const CASE_ID = 4821;

function makeReview(status: CommercialShadowReviewViewModel["status"], overrides: Partial<CommercialShadowReviewViewModel> = {}): CommercialShadowReviewViewModel {
  const base: CommercialShadowReviewViewModel = {
    status,
    observedAt: "2026-06-17T12:00:00.000Z",
    identifiers: {
      correlationId: "corr-operator-pilot-001",
      processInboundRunId: "process-operator-pilot-001",
      salesAgentRunId: "sales-operator-pilot-001",
      caseId: CASE_ID,
      conversationCaseId: CASE_ID,
      waId: "56912345678",
      email: "cliente@example.com",
      phone: "+56912345678",
      idCustomer: 10045,
      idOrder: 20001,
      invoiceNumber: 30001
    },
    summary:
      status === "available"
        ? {
            shadowStatus: "completed",
            runtimeStatus: "completed_valid",
            validationStatus: "valid",
            proposedOutcome: "response_proposed",
            governedOutcome: "response_proposed",
            proposedConfidence: "high",
            governedConfidence: "high",
            proposedResponse: "Hola, te podemos ayudar.",
            governedResponse: "Hola, te podemos ayudar.",
            proposedShouldRespondNow: true,
            governedShouldRespondNow: true,
            policyStatus: "allowed",
            overallDecision: "allow",
            riskLevel: "low",
            approvalRequirement: "none",
            claimsCount: 0,
            blockedClaimsCount: 0,
            actionsCount: 0,
            blockedActionsCount: 0,
            toolRequestsCount: 0,
            blockedToolRequestsCount: 0,
            entityProposalsCount: 0,
            blockedEntityProposalsCount: 0
          }
        : null,
    claims: { detected: [], allowed: [], blocked: [] },
    actions: { proposed: [], blocked: [] },
    toolRequests: { proposed: [], blocked: [] },
    entityProposals: { proposed: [], blocked: [] },
    policy: {
      appliedRuleIds: ["POLICY-001"],
      hardBlocks: [],
      warnings: [],
      issues: [],
      versions: {
        contractVersion: "commercial.policy.v1",
        policyVersion: "commercial.policy.v1",
        runtimeVersion: "brain.commercial.runtime.v1",
        promptVersion: "sales-agent-runtime-v0.1.0",
        evaluationVersion: "brain.commercial.evaluation.v1"
      }
    },
    observability: {
      totalLatencyMs: 123,
      contextLatencyMs: 10,
      providerLatencyMs: 20,
      runtimeLatencyMs: 30,
      validationLatencyMs: 5,
      policyLatencyMs: 7,
      inputTokens: 111,
      outputTokens: 222,
      totalTokens: 333,
      estimatedCost: 0.12,
      currency: "USD",
      provider: "fake-sales-agent-provider",
      model: "fake-sales-agent",
      timeout: false,
      providerFailure: null,
      readinessStatus: "evaluated",
      readinessDecision: null,
      usefulness: null,
      comparisonStatus: null
    },
    evaluation: {
      status: "evaluated",
      readinessDecision: "READY_FOR_CONTROLLED_PILOT",
      usefulness: "useful",
      comparisonStatus: "aligned",
      reportSummary: "evaluated"
    },
    invariants: {
      shadow: true,
      dryRun: true,
      outboundExecuted: false,
      toolsExecuted: 0,
      commercialDbWrites: 0,
      leadCreated: false,
      opportunityCreated: false,
      caseMutated: false,
      controlsResponsePolicy: false,
      violationDetected: false,
      violations: []
    },
    warnings: [],
    error: null,
    metadata: {
      source: "fixture",
      safeTraceId: "safe-operator-pilot"
    }
  };

  return {
    ...base,
    ...overrides,
    identifiers: overrides.identifiers ?? base.identifiers,
    summary: overrides.summary ?? base.summary,
    claims: overrides.claims ?? base.claims,
    actions: overrides.actions ?? base.actions,
    toolRequests: overrides.toolRequests ?? base.toolRequests,
    entityProposals: overrides.entityProposals ?? base.entityProposals,
    policy: overrides.policy ?? base.policy,
    observability: overrides.observability ?? base.observability,
    evaluation: overrides.evaluation ?? base.evaluation,
    invariants: overrides.invariants ?? base.invariants,
    warnings: overrides.warnings ?? base.warnings,
    error: overrides.error ?? base.error,
    metadata: overrides.metadata ?? base.metadata
  };
}

function makeOperationalResult(overrides: Record<string, unknown> = {}) {
  return {
    status: "completed",
    observedAt: "2026-06-17T12:30:00.000Z",
    resultingState: {
      status: "engaged",
      stage: "qualification",
      temperature: "warm",
      priority: "high",
      currentSummary: "Necesita producto y comuna.",
      waitingFor: "customer_reply",
      missingRequirements: ["product", "comuna"]
    },
    selectedNextAction: {
      type: "ask_clarifying_question",
      label: "Pedir contexto",
      reason: "Faltan datos para continuar.",
      confidence: 0.82,
      riskLevel: "low",
      approvalRequirement: "none",
      recommendedChannel: "whatsapp",
      draftMessage: "Hola, para ayudarte, dime que producto necesitas armar y en que comuna estas.",
      executable: false,
      blockedReasons: ["policy_blocked"],
      requiredInformation: ["product", "comuna"]
    },
    decisionRecord: {
      decisionStatus: "recorded",
      nextAction: {
        type: "ask_clarifying_question",
        label: "Pedir contexto"
      }
    },
    warnings: ["operational_loop_fixture"],
    ...overrides
  };
}

test("maps an available operational result into the operator pilot view model", () => {
  const review = makeReview("available");
  const viewModel = buildAiSdrOperatorPilotViewModel({
    caseId: CASE_ID,
    caseRow: {
      metadata: {
        token: "secret-token",
        rawWebhook: { hidden: true }
      }
    },
    commercialShadowReview: review,
    commercialOperationalResult: makeOperationalResult()
  });

  assert.equal(viewModel.status, "available");
  assert.equal(viewModel.commercialState?.status, "engaged");
  assert.equal(viewModel.commercialState?.stage, "qualification");
  assert.equal(viewModel.nextAction?.type, "ask_clarifying_question");
  assert.equal(viewModel.nextAction?.executable, false);
  assert.equal(viewModel.operatorControls.canApprove, false);
  assert.equal(viewModel.operatorControls.canReject, false);
  assert.ok(viewModel.knownInformation.some((item) => item.label === "Estado comercial"));
  assert.ok(viewModel.missingInformation.some((item) => item.key === "product"));
  assert.ok(viewModel.missingInformation.some((item) => item.key === "comuna"));
  assert.ok((viewModel.nextAction?.draftMessage ?? "").length <= 903);
  assert.equal(JSON.stringify(viewModel).includes("secret-token"), false);
  assert.doesNotThrow(() => JSON.stringify(viewModel));
});

test("maps a partial shadow fallback and keeps executable false", () => {
  const review = makeReview("available");
  const viewModel = buildAiSdrOperatorPilotViewModel({
    caseId: CASE_ID,
    commercialShadowReview: review
  });

  assert.equal(viewModel.status, "waiting_for_operational_loop");
  assert.equal(viewModel.commercialState?.status, "waiting_for_operational_loop");
  assert.equal(viewModel.nextAction?.executable ?? false, false);
  assert.ok(viewModel.knownInformation.length > 0);
  assert.ok(viewModel.missingInformation.length > 0);
});

test("returns not_found, disabled, and error states", () => {
  const notFound = buildAiSdrOperatorPilotViewModel({
    caseId: CASE_ID,
    commercialShadowReview: makeReview("not_found")
  });
  const disabled = buildAiSdrOperatorPilotViewModel({
    caseId: CASE_ID,
    commercialShadowReview: makeReview("disabled")
  });
  const error = buildAiSdrOperatorPilotViewModel({
    caseId: CASE_ID,
    commercialShadowReview: makeReview("error", {
      error: {
        code: "read_error",
        message: "Authorization: Bearer sk-test-123",
        stage: "read"
      }
    })
  });

  assert.equal(notFound.status, "not_found");
  assert.equal(disabled.status, "disabled");
  assert.equal(error.status, "error");
  assert.equal(error.error?.includes("sk-test-123"), false);
});

test("truncates long drafts and preserves blocked reasons", () => {
  const viewModel = buildAiSdrOperatorPilotViewModel({
    caseId: CASE_ID,
    commercialShadowReview: makeReview("available"),
    commercialOperationalResult: makeOperationalResult({
      selectedNextAction: {
        type: "respond",
        label: "Responder",
        reason: "Long draft coverage",
        confidence: 0.91,
        riskLevel: "low",
        approvalRequirement: "none",
        recommendedChannel: "whatsapp",
        draftMessage: `${"Hola ".repeat(250)}`,
        executable: false,
        blockedReasons: ["policy_blocked", "approval_required"],
        requiredInformation: []
      }
    })
  });

  assert.equal(viewModel.nextAction?.blockedReasons.includes("policy_blocked"), true);
  assert.equal(viewModel.nextAction?.executable, false);
  assert.ok((viewModel.nextAction?.draftMessage ?? "").length <= 903);
});

test("renders the operator pilot panel and blocked controls", () => {
  const review = makeReview("available");
  const viewModel = buildAiSdrOperatorPilotViewModel({
    caseId: CASE_ID,
    commercialShadowReview: review,
    commercialOperationalResult: makeOperationalResult()
  });
  const markup = renderToStaticMarkup(createElement(AiSdrOperatorPilotPanel, { caseId: CASE_ID, pilot: viewModel }));

  assert.ok(markup.includes("AI SDR Operator Pilot"));
  assert.ok(markup.includes("Borrador local no guardado"));
  assert.ok(markup.includes("Piloto controlado"));
  assert.ok(markup.includes("disabled"));
  assert.ok(markup.includes("Ver diagnostico tecnico"));
});

test("renders empty, disabled, and error states without breaking the panel", () => {
  const notFound = buildAiSdrOperatorPilotViewModel({
    caseId: CASE_ID,
    commercialShadowReview: makeReview("not_found")
  });
  const disabled = buildAiSdrOperatorPilotViewModel({
    caseId: CASE_ID,
    commercialShadowReview: makeReview("disabled")
  });
  const error = buildAiSdrOperatorPilotViewModel({
    caseId: CASE_ID,
    commercialShadowReview: makeReview("error", {
      error: {
        code: "read_error",
        message: "Authorization: Bearer sk-test-123",
        stage: "read"
      }
    })
  });

  const notFoundMarkup = renderToStaticMarkup(createElement(AiSdrOperatorPilotPanel, { caseId: CASE_ID, pilot: notFound }));
  const disabledMarkup = renderToStaticMarkup(createElement(AiSdrOperatorPilotPanel, { caseId: CASE_ID, pilot: disabled }));
  const errorMarkup = renderToStaticMarkup(createElement(AiSdrOperatorPilotPanel, { caseId: CASE_ID, pilot: error }));

  assert.ok(notFoundMarkup.includes("No existe una vista operacional AI SDR"));
  assert.ok(disabledMarkup.includes("Piloto deshabilitado"));
  assert.ok(errorMarkup.includes("Error seguro"));
  assert.equal(errorMarkup.includes("sk-test-123"), false);
});
