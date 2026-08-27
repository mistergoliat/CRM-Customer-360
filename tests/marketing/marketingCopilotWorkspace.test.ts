import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingCopilotWorkspace, ResponseBody } from "@/components/marketing/MarketingCopilotWorkspace";
import { normalizeCopilotTurn, type CustomerIntelligenceCopilotSessionTurnResponse } from "@/lib/marketing/customerIntelligenceCopilot";

test("marketing copilot workspace renders as a conversational workspace, not a demo form", () => {
  const html = renderToStaticMarkup(React.createElement(MarketingCopilotWorkspace, { data: { quickReplies: ["Agregar canal"] } }));

  assert.match(html, /Workspace conversacional/);
  assert.match(html, /Nuevo chat/);
  assert.match(html, /Pregunta\.\.\./);
  assert.match(html, /Cuantos clientes hay en cada cluster\?/);
  assert.match(html, /Provenance/);
  assert.match(html, /Actualizar datos/);
  assert.doesNotMatch(html, /Checklist demo/);
  assert.doesNotMatch(html, /Datos de demostraci/);
  assert.doesNotMatch(html, /Exportar XLSX/);
  assert.doesNotMatch(html, /Agregar canal/);
});

test("marketing copilot response renderer shows provenance-ready answered state and exportable query ids", () => {
  const html = renderToStaticMarkup(React.createElement(ResponseBody, { response: answeredTurn() }));

  assert.match(html, /Hay 123 clientes/);
  assert.match(html, /Filas/);
  assert.match(html, /q1/);
  assert.match(html, /openai_compatible:model/);
});

test("marketing copilot response renderer distinguishes clarification, unsupported, and provider failures", () => {
  const clarification = renderToStaticMarkup(React.createElement(ResponseBody, { response: terminalTurn("clarification_required", "Define si quieres clientes activos o totales.") }));
  const unsupported = renderToStaticMarkup(React.createElement(ResponseBody, { response: terminalTurn("unsupported_data", "No hay datos de carrito.") }));
  const providerFailure = renderToStaticMarkup(React.createElement(ResponseBody, { response: terminalTurn("answer_generation_failed", "Modelo no disponible.") }));

  assert.match(clarification, /Necesito una precision/);
  assert.match(unsupported, /No puedo responder con los datos disponibles/);
  assert.match(providerFailure, /Error temporal del modelo/);
});

function answeredTurn(): CustomerIntelligenceCopilotSessionTurnResponse {
  return {
    sessionId: "00000000-0000-4000-8000-000000000001",
    turnId: "00000000-0000-4000-8000-000000000002",
    queryIds: ["q1"],
    sourceQueryIds: [],
    status: "answered",
    answer: "Hay 123 clientes distribuidos en 4 clusters.",
    analysis: {
      contractVersion: "customer-intelligence-copilot-v1",
      analysisPlanVersion: "customer-intelligence-copilot-analysis-plan-v1",
      queryCount: 1,
      queryPlanHashes: ["hash-1"],
      resultRowCount: 4,
      executionDurationMs: 23,
      plannerModel: "openai_compatible:model",
      answerModel: "openai_compatible:model"
    },
    provenance: {
      featureSnapshot: { snapshotId: "1001", referenceTime: "2026-08-20T00:00:00.000Z", featureVersion: "features-v1", populationPolicyVersion: "population-v1" },
      rfmSnapshot: null,
      clusterSnapshot: null,
      population: { featurePopulation: 123, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 123, rfmCoveragePct: 0, clusterCoveragePct: 0 },
      contractVersion: "customer-intelligence-read-model-v1"
    }
  };
}

function terminalTurn(status: "clarification_required" | "unsupported_data" | "answer_generation_failed", message: string): CustomerIntelligenceCopilotSessionTurnResponse {
  return {
    sessionId: "00000000-0000-4000-8000-000000000001",
    turnId: "00000000-0000-4000-8000-000000000002",
    queryIds: [],
    sourceQueryIds: [],
    status,
    message,
    contractVersion: "customer-intelligence-copilot-v1"
  };
}

function answeredFromContextTurn(answer: string): CustomerIntelligenceCopilotSessionTurnResponse {
  return {
    sessionId: "00000000-0000-4000-8000-000000000001",
    turnId: "00000000-0000-4000-8000-000000000003",
    queryIds: [],
    sourceQueryIds: ["q1"],
    status: "answered_from_context",
    finalResponseState: "success",
    answer,
    analysis: {
      contractVersion: "customer-intelligence-copilot-v1",
      analysisPlanVersion: "customer-intelligence-copilot-analysis-plan-v1",
      finalResponseState: "success",
      sourceQueryIds: ["q1"],
      resultRowCount: 4,
      plannerModel: "openai_compatible:model",
      answerModel: "openai_compatible:model"
    },
    provenance: {
      featureSnapshot: { snapshotId: "1001", referenceTime: "2026-08-20T00:00:00.000Z", featureVersion: "features-v1", populationPolicyVersion: "population-v1" },
      rfmSnapshot: null,
      clusterSnapshot: null,
      population: { featurePopulation: 123, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 123, rfmCoveragePct: 0, clusterCoveragePct: 0 },
      contractVersion: "customer-intelligence-read-model-v1"
    }
  };
}

function respondedDirectlyTurn(answer: string): CustomerIntelligenceCopilotSessionTurnResponse {
  return {
    sessionId: "00000000-0000-4000-8000-000000000001",
    turnId: "00000000-0000-4000-8000-000000000004",
    queryIds: [],
    sourceQueryIds: [],
    status: "responded_directly",
    finalResponseState: "success",
    answer,
    analysis: {
      contractVersion: "customer-intelligence-copilot-v1",
      decisionVersion: "customer-intelligence-conversation-decision-v1",
      decisionAction: "respond_directly",
      orchestratorModel: "openai_compatible:model",
      finalResponseState: "success"
    },
    provenance: {
      featureSnapshot: { snapshotId: "1001", referenceTime: "2026-08-20T00:00:00.000Z", featureVersion: "features-v1", populationPolicyVersion: "population-v1" },
      rfmSnapshot: null,
      clusterSnapshot: null,
      population: { featurePopulation: 123, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 123, rfmCoveragePct: 0, clusterCoveragePct: 0 },
      contractVersion: "customer-intelligence-read-model-v1"
    }
  };
}

function degradedSuccessTurn(answer: string): CustomerIntelligenceCopilotSessionTurnResponse {
  const base = answeredFromContextTurn(answer);
  return {
    ...base,
    status: "answered",
    finalResponseState: "degraded_success",
    analysis: {
      contractVersion: "customer-intelligence-copilot-v1",
      analysisPlanVersion: "customer-intelligence-copilot-analysis-plan-v1",
      finalResponseState: "degraded_success",
      queryCount: 1,
      queryPlanHashes: ["hash-1"],
      resultRowCount: 4,
      executionDurationMs: 23,
      plannerModel: "openai_compatible:model",
      answerModel: null,
      synthesisFallbackUsed: true
    }
  } as CustomerIntelligenceCopilotSessionTurnResponse;
}

function emptySuccessTurn(): CustomerIntelligenceCopilotSessionTurnResponse {
  return respondedDirectlyTurn("");
}

test("normalizeCopilotTurn extracts text for every non-fatal status", () => {
  assert.equal(normalizeCopilotTurn(answeredTurn()).text, "Hay 123 clientes distribuidos en 4 clusters.");
  assert.equal(normalizeCopilotTurn(answeredFromContextTurn("Del cluster anterior.")).text, "Del cluster anterior.");
  assert.equal(normalizeCopilotTurn(respondedDirectlyTurn("Todo en pesos chilenos / CLP.")).text, "Todo en pesos chilenos / CLP.");
  assert.equal(normalizeCopilotTurn(terminalTurn("clarification_required", "Define el criterio.")).text, "Define el criterio.");
  assert.equal(normalizeCopilotTurn(degradedSuccessTurn("Respuesta con fallback.")).text, "Respuesta con fallback.");
  assert.equal(normalizeCopilotTurn(degradedSuccessTurn("x")).finalResponseState, "degraded_success");
});

test("normalizeCopilotTurn treats an empty non-fatal payload as a contract error, never a silent empty success", () => {
  const normalized = normalizeCopilotTurn(emptySuccessTurn());
  assert.equal(normalized.contractError, true);
  assert.equal(normalized.finalResponseState, "failure");
  assert.ok(normalized.text.length > 0);
});

test("marketing copilot renders responded_directly turns with visible text (regression for the empty RESPONDIDO card)", () => {
  const html = renderToStaticMarkup(React.createElement(ResponseBody, { response: respondedDirectlyTurn("Todo en esta conversacion esta en pesos chilenos / CLP.") }));
  assert.match(html, /pesos chilenos \/ CLP/);
});

test("marketing copilot renders answered_from_context and degraded_success turns with visible text", () => {
  const contextHtml = renderToStaticMarkup(React.createElement(ResponseBody, { response: answeredFromContextTurn("Respuesta desde contexto previo.") }));
  const degradedHtml = renderToStaticMarkup(React.createElement(ResponseBody, { response: degradedSuccessTurn("Respuesta de respaldo determinista.") }));
  assert.match(contextHtml, /Respuesta desde contexto previo\./);
  assert.match(degradedHtml, /Respuesta de respaldo determinista\./);
});

test("marketing copilot never renders an empty successful card - an empty payload surfaces as an error state instead", () => {
  const html = renderToStaticMarkup(React.createElement(ResponseBody, { response: emptySuccessTurn() }));
  assert.match(html, /Respuesta sin contenido/);
  assert.doesNotMatch(html, /<p class="whitespace-pre-wrap text-body-lg text-on-surface"><\/p>/);
});
