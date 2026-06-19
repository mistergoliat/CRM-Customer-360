import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildActionQueueViewModel } from "../../lib/brain/commercial/action-queue";
import { buildCommercialShadowReview } from "../../lib/brain/commercial/review";
import { buildAiSdrOperatorPilotViewModel } from "../../lib/brain/commercial/operator-pilot";
import { AiSdrCopilotPanel, CaseDetailShell } from "../../components/cases/case-detail-layout";

const CASE_ID = 4821;
const FIXED_TIME = "2026-06-17T12:00:00.000Z";

test("renders the chat-first three-column shell", () => {
  const markup = renderToStaticMarkup(
    createElement(CaseDetailShell, {
      sidebar: createElement("div", null, "Context Sidebar"),
      main: createElement("div", null, "WhatsApp Chat Main"),
      copilot: createElement("div", null, "AI SDR Copilot Panel")
    })
  );

  assert.ok(markup.includes("Context Sidebar"));
  assert.ok(markup.includes("WhatsApp Chat Main"));
  assert.ok(markup.includes("AI SDR Copilot Panel"));
  assert.ok(markup.includes("xl:grid-cols-[280px_minmax(0,1fr)_420px]"));
});

test("renders the AI SDR copilot with action queue and collapsed diagnostics", async () => {
  const review = buildCommercialShadowReview({
    status: "not_found",
    identifiers: {
      correlationId: "corr-layout-001",
      processInboundRunId: "process-layout-001",
      salesAgentRunId: "sales-layout-001",
      caseId: CASE_ID,
      conversationCaseId: CASE_ID,
      waId: "56912345678",
      email: "cliente@example.com",
      phone: "+56912345678",
      idCustomer: 10045,
      idOrder: 20001,
      invoiceNumber: 30001
    }
  });

  const pilot = buildAiSdrOperatorPilotViewModel({
    caseId: CASE_ID,
    commercialShadowReview: review
  });

  const actionQueue = await buildActionQueueViewModel({
    caseId: CASE_ID,
    caseRow: {
      id: CASE_ID,
      conversation_case_id: CASE_ID,
      wa_id: "56912345678",
      status: "open",
      priority: "high",
      department: "ventas",
      last_inbound_text: "Hola, quiero cotizar una banca para entrenar en casa",
      last_outbound_text: null,
      updated_at: FIXED_TIME,
      last_message_at: FIXED_TIME
    },
    sourceQueue: null,
    currentTime: FIXED_TIME,
    timezone: "America/Santiago",
    adapter: {
      async hasTable() {
        return false;
      }
    }
  });

  const markup = renderToStaticMarkup(createElement(AiSdrCopilotPanel, { caseId: CASE_ID, pilot, actionQueue, review }));

  assert.ok(markup.includes("AI SDR Copilot"));
  assert.ok(markup.includes("Copiloto lateral read-only"));
  assert.ok(markup.includes("AI Action Queue"));
  assert.ok(markup.includes("Ver diagnóstico técnico"));
  assert.ok(markup.includes("Sin sugerencia disponible"));
  assert.ok(markup.includes("Borrador local no guardado"));
  assert.ok(markup.includes("disabled"));
});
