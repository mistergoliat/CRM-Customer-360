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
const ActionQueuePanel_1 = require("../../components/cases/ai-sdr/action-queue/ActionQueuePanel");
const FIXED_TIME = "2026-06-17T12:00:00.000Z";
const CASE_ID = 4821;
function makeCaseRow(overrides = {}) {
    return {
        id: CASE_ID,
        conversation_case_id: CASE_ID,
        wa_id: "56912345678",
        status: "open",
        department: "ventas",
        priority: "high",
        last_message_at: FIXED_TIME,
        updated_at: FIXED_TIME,
        last_inbound_text: "Hola, quiero cotizar una banca",
        last_outbound_text: "Hola, te ayudamos",
        ...overrides
    };
}
function makePersistedRow(overrides = {}) {
    return {
        id: 11,
        action_id: "action-001",
        idempotency_key: "crm-agent-action:test-001",
        opportunity_id: 42,
        decision_id: "decision-001",
        decision_row_id: 1,
        conversation_case_id: CASE_ID,
        message_id: "msg-001",
        wa_id: "56912345678",
        channel: "whatsapp",
        action_type: "send_whatsapp_reply",
        status: "proposed",
        risk_level: "low",
        approval_requirement: "operator_review",
        draft_payload_json: { text: "Hola" },
        final_payload_json: null,
        execution_payload_json: null,
        draft_message: "Hola",
        final_message: null,
        scheduled_for: null,
        expires_at: null,
        attempt_number: 1,
        max_attempts: 3,
        block_reasons_json: [],
        cancel_reason: null,
        failure_reason: null,
        policy_status: "allowed",
        policy_notes_json: ["note"],
        source: "ai_sdr",
        created_by: "ai",
        approved_by: null,
        approved_at: null,
        executed_at: null,
        cancelled_at: null,
        outbox_message_id: null,
        lifecycle_version: "brain.commercial.action-queue.v1",
        policy_version: "brain.commercial.policy.v1",
        runtime_version: "brain.commercial.runtime.v1",
        created_at: FIXED_TIME,
        updated_at: FIXED_TIME,
        ...overrides
    };
}
function makeAdapter(options) {
    return {
        async hasTable() {
            return options.tableExists;
        },
        async queryRows() {
            if (options.error)
                throw options.error;
            return (options.rows ?? []);
        }
    };
}
function makeNextActionOperationalResult() {
    return {
        status: "completed",
        observedAt: FIXED_TIME,
        resultingState: {
            status: "engaged",
            stage: "qualification",
            temperature: "warm",
            priority: "high",
            currentSummary: "Faltan datos para continuar.",
            waitingFor: "customer_reply"
        },
        selectedNextAction: {
            type: "ask_clarifying_question",
            reason: "Faltan datos para continuar.",
            confidence: "high",
            riskLevel: "low",
            approvalRequirement: "none",
            recommendedChannel: "whatsapp",
            draftMessage: "Hola, para ayudarte mejor me faltan algunos datos.",
            requiredInformation: ["product", "comuna"],
            blockedReasons: [],
            executable: false
        },
        decisionRecord: {
            nextAction: {
                type: "ask_clarifying_question"
            }
        }
    };
}
(0, node_test_1.default)("maps persisted actions into an available queue", async () => {
    const viewModel = await (0, action_queue_1.buildActionQueueViewModel)({
        caseId: CASE_ID,
        caseRow: makeCaseRow(),
        sourceQueue: null,
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        adapter: makeAdapter({ tableExists: true, rows: [makePersistedRow()] })
    });
    strict_1.default.equal(viewModel.status, "available");
    strict_1.default.equal(viewModel.origin, "persisted");
    strict_1.default.equal(viewModel.actions.length, 1);
    strict_1.default.equal(viewModel.actions[0].persisted, true);
    strict_1.default.equal(viewModel.actions[0].executable, false);
    strict_1.default.equal(viewModel.actions[0].source, "crm_agent_actions");
    strict_1.default.doesNotThrow(() => JSON.stringify(viewModel));
});
(0, node_test_1.default)("falls back to next_action_json preview when the table is missing", async () => {
    const viewModel = await (0, action_queue_1.buildActionQueueViewModel)({
        caseId: CASE_ID,
        caseRow: makeCaseRow({ last_inbound_text: null, last_outbound_text: null }),
        commercialOperationalResult: makeNextActionOperationalResult(),
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        adapter: makeAdapter({ tableExists: false })
    });
    strict_1.default.equal(viewModel.status, "preview_only");
    strict_1.default.equal(viewModel.origin, "preview");
    strict_1.default.equal(viewModel.diagnostics.tableAvailable, false);
    strict_1.default.equal(viewModel.diagnostics.usedPreviewFallback, true);
    strict_1.default.ok(viewModel.actions.some((item) => item.source === "next_action_json"));
    strict_1.default.ok(viewModel.actions.every((item) => item.persisted === false));
    strict_1.default.ok(viewModel.actions.every((item) => item.executable === false));
});
(0, node_test_1.default)("returns unavailable when the table is missing and no preview exists", async () => {
    const viewModel = await (0, action_queue_1.buildActionQueueViewModel)({
        caseId: CASE_ID,
        caseRow: makeCaseRow({ wa_id: null, last_inbound_text: null }),
        sourceQueue: null,
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        adapter: makeAdapter({ tableExists: false })
    });
    strict_1.default.equal(viewModel.status, "unavailable");
    strict_1.default.equal(viewModel.origin, "none");
    strict_1.default.equal(viewModel.actions.length, 0);
    strict_1.default.equal(viewModel.diagnostics.tableAvailable, false);
});
(0, node_test_1.default)("returns error safely when permissions are denied", async () => {
    const viewModel = await (0, action_queue_1.buildActionQueueViewModel)({
        caseId: CASE_ID,
        caseRow: makeCaseRow(),
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        adapter: makeAdapter({
            tableExists: true,
            error: new Error("SELECT command denied to user 'writer'@'%' using password: secret")
        })
    });
    strict_1.default.equal(viewModel.status, "error");
    strict_1.default.equal(viewModel.diagnostics.permissionError, true);
    strict_1.default.ok(viewModel.error?.includes("secret") === false);
    strict_1.default.ok(viewModel.error?.includes("password") === false);
});
(0, node_test_1.default)("builds a preview from the follow-up planner", async () => {
    const viewModel = await (0, action_queue_1.buildActionQueueViewModel)({
        caseId: CASE_ID,
        caseRow: makeCaseRow({
            last_inbound_text: "Hola, quiero cotizar una banca para entrenar en casa"
        }),
        sourceQueue: {
            id_order: 20001,
            id_customer: 10045,
            phone_normalized: "56912345678",
            last_intent: "quote_request",
            last_inbound_text: "Hola, quiero cotizar una banca para entrenar en casa",
            last_inbound_at: FIXED_TIME,
            last_outbound_text: null,
            updated_at: FIXED_TIME,
            created_at: FIXED_TIME,
            status: "open",
            estado_caso: "open",
            requeriere_contacto_humano: 0
        },
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        adapter: makeAdapter({ tableExists: false })
    });
    strict_1.default.equal(viewModel.status, "preview_only");
    strict_1.default.ok(viewModel.actions.some((item) => item.source === "follow_up_planner"));
    strict_1.default.ok(viewModel.actions.every((item) => item.executable === false));
});
(0, node_test_1.default)("shows an empty state when nothing exists", async () => {
    const viewModel = await (0, action_queue_1.buildActionQueueViewModel)({
        caseId: CASE_ID,
        caseRow: makeCaseRow({ wa_id: null, last_inbound_text: null, last_outbound_text: null }),
        sourceQueue: null,
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        adapter: makeAdapter({ tableExists: true, rows: [] })
    });
    strict_1.default.equal(viewModel.status, "empty");
    strict_1.default.equal(viewModel.origin, "none");
    strict_1.default.equal(viewModel.actions.length, 0);
});
(0, node_test_1.default)("renders the read-only action queue panel with disabled controls", async () => {
    const viewModel = await (0, action_queue_1.buildActionQueueViewModel)({
        caseId: CASE_ID,
        caseRow: makeCaseRow(),
        commercialOperationalResult: makeNextActionOperationalResult(),
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        adapter: makeAdapter({ tableExists: false })
    });
    const markup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(ActionQueuePanel_1.ActionQueuePanel, { caseId: CASE_ID, actionQueue: viewModel }));
    strict_1.default.ok(markup.includes("AI Action Queue"));
    strict_1.default.ok(markup.includes("Aprobar"));
    strict_1.default.ok(markup.includes("Editar"));
    strict_1.default.ok(markup.includes("Cancelar"));
    strict_1.default.ok(markup.includes("Enviar"));
    strict_1.default.ok(markup.includes("Programar"));
    strict_1.default.ok(markup.includes("disabled"));
    strict_1.default.ok(markup.includes("executable false"));
});
