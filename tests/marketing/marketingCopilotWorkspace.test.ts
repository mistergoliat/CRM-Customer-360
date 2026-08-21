import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingCopilotWorkspace, ResponseBody } from "@/components/marketing/MarketingCopilotWorkspace";
import type { CustomerIntelligenceCopilotSessionTurnResponse } from "@/lib/marketing/customerIntelligenceCopilot";

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
