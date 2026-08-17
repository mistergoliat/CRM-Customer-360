import assert from "node:assert/strict";
import test from "node:test";
import { buildBenchmarkAuditArtifact, renderBenchmarkAuditMarkdown } from "@/lib/brain/commercial/agent-loop/benchmark/audit";
import { computeAggregateMetrics } from "@/lib/brain/commercial/agent-loop/benchmark/metrics";
import type { BenchmarkCase, BenchmarkRunSummary, BenchmarkTurnResult } from "@/lib/brain/commercial/agent-loop/benchmark/types";

const C09_CASE: BenchmarkCase = {
  caseId: "C09",
  description: "multi-intencion simple",
  customerMessage: "quiero 2 de la classic y saber cuanto sale el despacho a Ñuñoa",
  commercialContextSummary: {},
  groundTruth: {
    requiredTools: ["select_products"],
    forbiddenTools: [],
    expectedTerminalReason: "responded",
    notes: "Debe completar la seleccion y manejar honestamente la parte de despacho."
  },
  offlineScript: [{ kind: "respond", message: "placeholder" }]
};

function turn(overrides: Partial<BenchmarkTurnResult> = {}): BenchmarkTurnResult {
  return {
    caseId: "C09",
    runIndex: 0,
    totalElapsedMs: 400,
    providerCalls: [],
    score: {
      caseId: "C09",
      runIndex: 0,
      toolsUsed: [],
      requiredToolsCompleted: false,
      missingRequiredTools: ["select_products"],
      forbiddenToolInvoked: false,
      invokedForbiddenTools: [],
      toolArgumentsCorrect: false,
      terminalReasonCorrect: true,
      controlledToolFailureObserved: false,
      structuredFailureObserved: false,
      overallPass: false,
      notes: []
    },
    trace: {
      configuredMaxDecisions: 3,
      configuredMaxToolExecutions: 3,
      configuredTimeoutMs: 20000,
      decisionTrace: [
        {
          decisionIndex: 0,
          toolExecutionCountBeforeDecision: 0,
          remainingToolExecutions: 3,
          stepsRemaining: 3,
          modelStepType: "use_tool",
          selectedTool: "get_product_details",
          toolArguments: { productId: "31" },
          observationStatus: "completed",
          observationDataStatus: null,
          observationErrorCode: null,
          governance: "authorized",
          consumedToolBudget: true,
          blocked: false,
          duplicate: false,
          invalid: false,
          llmAttempts: []
        },
        {
          decisionIndex: 1,
          toolExecutionCountBeforeDecision: 1,
          remainingToolExecutions: 2,
          stepsRemaining: 2,
          modelStepType: "use_tool",
          selectedTool: "set_shipping_destination",
          toolArguments: { destination: "Ñuñoa" },
          observationStatus: "completed",
          observationDataStatus: "resolved",
          observationErrorCode: null,
          governance: "authorized",
          consumedToolBudget: true,
          blocked: false,
          duplicate: false,
          invalid: false,
          llmAttempts: []
        },
        {
          decisionIndex: 2,
          toolExecutionCountBeforeDecision: 2,
          remainingToolExecutions: 1,
          stepsRemaining: 1,
          modelStepType: "respond",
          selectedTool: null,
          toolArguments: null,
          observationStatus: null,
          observationDataStatus: null,
          observationErrorCode: null,
          governance: null,
          consumedToolBudget: false,
          blocked: false,
          duplicate: false,
          invalid: false,
          llmAttempts: []
        }
      ],
      orderedToolSequence: ["get_product_details", "set_shipping_destination"],
      selectProductsAttempted: false,
      selectProductsCompleted: false,
      setShippingDestinationAttempted: true,
      getProductDetailsAttempted: true,
      guardActivated: true,
      terminalReason: "responded",
      warnings: ["agent_loop_mutation_claim_blocked:agrego"],
      llmCallCount: 0,
      toolExecutionCount: 2,
      turnLatencyMs: 400,
      llmCallLatenciesMs: []
    },
    loop: {
      ran: true,
      terminalReason: "responded",
      steps: [
        {
          stepIndex: 0,
          phase: "gathering",
          governance: "authorized",
          step: { type: "use_tool", tool: "get_product_details", arguments: { productId: "31" } },
          observation: { tool: "get_product_details", status: "completed", data: { productId: "31" } }
        },
        {
          stepIndex: 1,
          phase: "gathering",
          governance: "authorized",
          step: { type: "use_tool", tool: "set_shipping_destination", arguments: { destination: "Ñuñoa" } },
          observation: { tool: "set_shipping_destination", status: "completed", data: { status: "resolved", destination: { communeId: 99, canonicalName: "Ñuñoa" } } }
        },
        {
          stepIndex: 2,
          phase: "gathering",
          governance: null,
          step: { type: "respond", message: "Perfecto, te dejé 2 unidades y el despacho a Ñuñoa sale listo." },
          observation: null
        }
      ],
      toolExecutionCount: 2,
      finalMessage: "Necesito un momento mas para confirmar tu seleccion antes de continuar - ¿puedes confirmarme nuevamente que producto y cantidad quieres?",
      handoffReason: null,
      warnings: ["agent_loop_mutation_claim_blocked:agrego"],
      finalPendingCatalogAction: null,
      llmCalls: []
    },
    ...overrides
  };
}

test("[T08F] buildBenchmarkAuditArtifact preserves raw model text before guard and classifies guard fallback as acceptable degradation", () => {
  const summary: BenchmarkRunSummary = {
    mode: "live",
    model: "deepseek-v4-flash",
    runsPerCase: 1,
    loopConfiguration: { maxDecisions: 3, maxToolExecutions: 3, timeoutMs: 20000 },
    startedAt: "2026-08-17T10:00:00.000Z",
    finishedAt: "2026-08-17T10:00:01.000Z",
    results: [turn()]
  };

  const artifact = buildBenchmarkAuditArtifact({
    summary,
    cases: [C09_CASE],
    aggregateMetrics: computeAggregateMetrics(summary.results),
    generatedAt: "2026-08-17T10:00:01.000Z"
  });

  const [record] = artifact.records;
  assert.equal(record.modelResponseBeforeRuntimeGuards, "Perfecto, te dejé 2 unidades y el despacho a Ñuñoa sale listo.");
  assert.equal(record.finalCustomerMessage, "Necesito un momento mas para confirmar tu seleccion antes de continuar - ¿puedes confirmarme nuevamente que producto y cantidad quieres?");
  assert.equal(record.auditClassification, "ACCEPTABLE_DEGRADATION");
  assert.equal(record.severity, "MEDIUM");
});

test("[T08F] renderBenchmarkAuditMarkdown includes the raw-vs-final response split", () => {
  const summary: BenchmarkRunSummary = {
    mode: "live",
    model: "deepseek-v4-flash",
    runsPerCase: 1,
    loopConfiguration: { maxDecisions: 3, maxToolExecutions: 3, timeoutMs: 20000 },
    startedAt: "2026-08-17T10:00:00.000Z",
    finishedAt: "2026-08-17T10:00:01.000Z",
    results: [turn()]
  };

  const artifact = buildBenchmarkAuditArtifact({
    summary,
    cases: [C09_CASE],
    aggregateMetrics: computeAggregateMetrics(summary.results),
    generatedAt: "2026-08-17T10:00:01.000Z"
  });

  const markdown = renderBenchmarkAuditMarkdown(artifact);
  assert.match(markdown, /MODEL RESPONSE BEFORE GUARDS:/);
  assert.match(markdown, /FINAL CUSTOMER RESPONSE:/);
  assert.match(markdown, /Perfecto, te dejé 2 unidades/);
  assert.match(markdown, /Necesito un momento mas para confirmar tu seleccion/);
});

test("[T08F] C09 scorer-pass runs that defer shipping honestly are classified as acceptable degradation with acceptable quality", () => {
  const summary: BenchmarkRunSummary = {
    mode: "live",
    model: "deepseek-v4-flash",
    runsPerCase: 1,
    loopConfiguration: { maxDecisions: 3, maxToolExecutions: 3, timeoutMs: 20000 },
    startedAt: "2026-08-17T10:00:00.000Z",
    finishedAt: "2026-08-17T10:00:01.000Z",
    results: [
      turn({
        score: {
          caseId: "C09",
          runIndex: 0,
          toolsUsed: ["get_product_details", "set_shipping_destination", "select_products"],
          requiredToolsCompleted: true,
          missingRequiredTools: [],
          forbiddenToolInvoked: false,
          invokedForbiddenTools: [],
          toolArgumentsCorrect: true,
          terminalReasonCorrect: true,
          controlledToolFailureObserved: false,
          structuredFailureObserved: false,
          overallPass: true,
          notes: []
        },
        trace: {
          configuredMaxDecisions: 3,
          configuredMaxToolExecutions: 3,
          configuredTimeoutMs: 20000,
          decisionTrace: [],
          orderedToolSequence: ["get_product_details", "set_shipping_destination", "select_products"],
          selectProductsAttempted: true,
          selectProductsCompleted: true,
          setShippingDestinationAttempted: true,
          getProductDetailsAttempted: true,
          guardActivated: false,
          terminalReason: "responded",
          warnings: [],
          llmCallCount: 0,
          toolExecutionCount: 3,
          turnLatencyMs: 400,
          llmCallLatenciesMs: []
        },
        loop: {
          ran: true,
          terminalReason: "responded",
          steps: [
            {
              stepIndex: 0,
              phase: "gathering",
              governance: "authorized",
              step: { type: "use_tool", tool: "get_product_details", arguments: { productId: "31" } },
              observation: { tool: "get_product_details", status: "completed", data: { productId: "31" } }
            },
            {
              stepIndex: 1,
              phase: "gathering",
              governance: "authorized",
              step: { type: "use_tool", tool: "set_shipping_destination", arguments: { destination: "Ñuñoa" } },
              observation: { tool: "set_shipping_destination", status: "completed", data: { status: "resolved", destination: { communeId: 99, canonicalName: "Ñuñoa" } } }
            },
            {
              stepIndex: 2,
              phase: "gathering",
              governance: "authorized",
              step: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 2 }] } },
              observation: { tool: "select_products", status: "completed", data: { status: "completed" } }
            },
            {
              stepIndex: 3,
              phase: "finalization",
              governance: null,
              step: { type: "respond", message: "Perfecto, te dejé 2 unidades de la Barra Olimpica Classic 20kg. Ahora calculo el despacho a Ñuñoa." },
              observation: null
            }
          ],
          toolExecutionCount: 3,
          finalMessage: "Perfecto, te dejé 2 unidades de la Barra Olimpica Classic 20kg. Ahora calculo el despacho a Ñuñoa.",
          handoffReason: null,
          warnings: [],
          finalPendingCatalogAction: null,
          llmCalls: []
        }
      })
    ]
  };

  const artifact = buildBenchmarkAuditArtifact({
    summary,
    cases: [C09_CASE],
    aggregateMetrics: computeAggregateMetrics(summary.results),
    generatedAt: "2026-08-17T10:00:01.000Z"
  });

  const [record] = artifact.records;
  assert.equal(record.auditClassification, "ACCEPTABLE_DEGRADATION");
  assert.equal(record.severity, "MEDIUM");
  assert.equal(record.responseQuality, "ACCEPTABLE");
});
