"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const react_1 = require("react");
const server_1 = require("react-dom/server");
const action_queue_1 = require("../../lib/brain/commercial/action-queue");
const review_1 = require("../../lib/brain/commercial/review");
const operator_pilot_1 = require("../../lib/brain/commercial/operator-pilot");
const case_detail_layout_1 = require("../../components/cases/case-detail-layout");
const CASE_ID = 4821;
const FIXED_TIME = "2026-06-17T12:00:00.000Z";
(0, node_test_1.default)("renders the chat-first three-column shell", () => {
    const markup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(case_detail_layout_1.CaseDetailShell, {
        sidebar: (0, react_1.createElement)("div", null, "Context Sidebar"),
        main: (0, react_1.createElement)("div", null, "WhatsApp Chat Main"),
        copilot: (0, react_1.createElement)("div", null, "AI SDR Copilot Panel")
    }));
    strict_1.default.ok(markup.includes("Context Sidebar"));
    strict_1.default.ok(markup.includes("WhatsApp Chat Main"));
    strict_1.default.ok(markup.includes("AI SDR Copilot Panel"));
    strict_1.default.ok(markup.includes("xl:grid-cols-[280px_minmax(0,1fr)_420px]"));
});
(0, node_test_1.default)("renders the AI SDR copilot with action queue and collapsed diagnostics", async () => {
    const review = (0, review_1.buildCommercialShadowReview)({
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
    const pilot = (0, operator_pilot_1.buildAiSdrOperatorPilotViewModel)({
        caseId: CASE_ID,
        commercialShadowReview: review
    });
    const actionQueue = await (0, action_queue_1.buildActionQueueViewModel)({
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
    const markup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(case_detail_layout_1.AiSdrCopilotPanel, { caseId: CASE_ID, pilot, actionQueue, review }));
    strict_1.default.ok(markup.includes("AI SDR Copilot"));
    strict_1.default.ok(markup.includes("Copiloto lateral read-only"));
    strict_1.default.ok(markup.includes("AI Action Queue"));
    strict_1.default.ok(markup.includes("Ver diagnóstico técnico"));
    strict_1.default.ok(markup.includes("Sin sugerencia disponible"));
    strict_1.default.ok(markup.includes("Borrador local no guardado"));
    strict_1.default.ok(markup.includes("disabled"));
});
