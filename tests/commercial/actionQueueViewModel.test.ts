import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildActionQueueViewModel } from "../../lib/brain/commercial/action-queue";
import type { AgentActionQueueDatabaseAdapter } from "../../lib/brain/commercial/action-queue";
import { ActionQueuePanel } from "../../components/cases/ai-sdr/action-queue/ActionQueuePanel";

const FIXED_TIME = "2026-06-17T12:00:00.000Z";
const CASE_ID = 4821;

function makeCaseRow(overrides: Record<string, unknown> = {}) {
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

function makePersistedRow(overrides: Record<string, unknown> = {}) {
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

function makeAdapter(options: {
  tableExists: boolean;
  rows?: Record<string, unknown>[];
  error?: Error | null;
}): AgentActionQueueDatabaseAdapter {
  return {
    async hasTable() {
      return options.tableExists;
    },
    async queryRows() {
      if (options.error) throw options.error;
      return (options.rows ?? []) as never;
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

test("maps persisted actions into an available queue", async () => {
  const viewModel = await buildActionQueueViewModel({
    caseId: CASE_ID,
    caseRow: makeCaseRow(),
    sourceQueue: null,
    currentTime: FIXED_TIME,
    timezone: "America/Santiago",
    adapter: makeAdapter({ tableExists: true, rows: [makePersistedRow()] })
  });

  assert.equal(viewModel.status, "available");
  assert.equal(viewModel.origin, "persisted");
  assert.equal(viewModel.actions.length, 1);
  assert.equal(viewModel.actions[0].persisted, true);
  assert.equal(viewModel.actions[0].executable, false);
  assert.equal(viewModel.actions[0].source, "crm_agent_actions");
  assert.doesNotThrow(() => JSON.stringify(viewModel));
});

test("falls back to next_action_json preview when the table is missing", async () => {
  const viewModel = await buildActionQueueViewModel({
    caseId: CASE_ID,
    caseRow: makeCaseRow({ last_inbound_text: null, last_outbound_text: null }),
    commercialOperationalResult: makeNextActionOperationalResult(),
    currentTime: FIXED_TIME,
    timezone: "America/Santiago",
    adapter: makeAdapter({ tableExists: false })
  });

  assert.equal(viewModel.status, "preview_only");
  assert.equal(viewModel.origin, "preview");
  assert.equal(viewModel.diagnostics.tableAvailable, false);
  assert.equal(viewModel.diagnostics.usedPreviewFallback, true);
  assert.ok(viewModel.actions.some((item) => item.source === "next_action_json"));
  assert.ok(viewModel.actions.every((item) => item.persisted === false));
  assert.ok(viewModel.actions.every((item) => item.executable === false));
});

test("returns unavailable when the table is missing and no preview exists", async () => {
  const viewModel = await buildActionQueueViewModel({
    caseId: CASE_ID,
    caseRow: makeCaseRow({ wa_id: null, last_inbound_text: null }),
    sourceQueue: null,
    currentTime: FIXED_TIME,
    timezone: "America/Santiago",
    adapter: makeAdapter({ tableExists: false })
  });

  assert.equal(viewModel.status, "unavailable");
  assert.equal(viewModel.origin, "none");
  assert.equal(viewModel.actions.length, 0);
  assert.equal(viewModel.diagnostics.tableAvailable, false);
});

test("returns error safely when permissions are denied", async () => {
  const viewModel = await buildActionQueueViewModel({
    caseId: CASE_ID,
    caseRow: makeCaseRow(),
    currentTime: FIXED_TIME,
    timezone: "America/Santiago",
    adapter: makeAdapter({
      tableExists: true,
      error: new Error("SELECT command denied to user 'writer'@'%' using password: secret")
    })
  });

  assert.equal(viewModel.status, "error");
  assert.equal(viewModel.diagnostics.permissionError, true);
  assert.ok(viewModel.error?.includes("secret") === false);
  assert.ok(viewModel.error?.includes("password") === false);
});

test("builds a preview from the follow-up planner", async () => {
  const viewModel = await buildActionQueueViewModel({
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

  assert.equal(viewModel.status, "preview_only");
  assert.ok(viewModel.actions.some((item) => item.source === "follow_up_planner"));
  assert.ok(viewModel.actions.every((item) => item.executable === false));
});

test("shows an empty state when nothing exists", async () => {
  const viewModel = await buildActionQueueViewModel({
    caseId: CASE_ID,
    caseRow: makeCaseRow({ wa_id: null, last_inbound_text: null, last_outbound_text: null }),
    sourceQueue: null,
    currentTime: FIXED_TIME,
    timezone: "America/Santiago",
    adapter: makeAdapter({ tableExists: true, rows: [] })
  });

  assert.equal(viewModel.status, "empty");
  assert.equal(viewModel.origin, "none");
  assert.equal(viewModel.actions.length, 0);
});

test("renders the read-only action queue panel with disabled controls", async () => {
  const viewModel = await buildActionQueueViewModel({
    caseId: CASE_ID,
    caseRow: makeCaseRow(),
    commercialOperationalResult: makeNextActionOperationalResult(),
    currentTime: FIXED_TIME,
    timezone: "America/Santiago",
    adapter: makeAdapter({ tableExists: false })
  });

  const markup = renderToStaticMarkup(createElement(ActionQueuePanel, { caseId: CASE_ID, actionQueue: viewModel }));
  assert.ok(markup.includes("AI Action Queue"));
  assert.ok(markup.includes("Aprobar"));
  assert.ok(markup.includes("Editar"));
  assert.ok(markup.includes("Cancelar"));
  assert.ok(markup.includes("Enviar"));
  assert.ok(markup.includes("Programar"));
  assert.ok(markup.includes("disabled"));
  assert.ok(markup.includes("executable false"));
});
