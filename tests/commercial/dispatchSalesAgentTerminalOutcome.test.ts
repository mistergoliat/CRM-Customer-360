import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import {
  dispatchSalesAgentFallback,
  SALES_AGENT_FALLBACK_DISPATCHER_VERSION
} from "@/lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentFallback";
import {
  dispatchSalesAgentHardHandoff,
  classifyHardHandoffEligibility,
  SALES_AGENT_HARD_HANDOFF_DISPATCHER_VERSION
} from "@/lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentHardHandoff";
import { dispatchSalesAgentTerminalOutcome } from "@/lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentTerminalOutcome";
import type { AgentLoopResult } from "@/lib/brain/commercial/agent-loop/agentStepTypes";

/**
 * SALES-AGENT-R3-V1.6. Unit-level coverage of the three new R3-native
 * terminal-dispatch primitives (dispatchSalesAgentFallback.ts,
 * dispatchSalesAgentHardHandoff.ts, dispatchSalesAgentTerminalOutcome.ts) -
 * never re-proves what tests/commercial/dispatchSalesAgentResponse.test.ts
 * ([D1]-[D10]) already covers for the "responded" path, or what
 * tests/commercial/runSalesAgentRuntimeCycle.test.ts ([RC1]-[RC9]) already
 * covers at the full-cycle routing-seam level. Same local dev DB credentials
 * those files already establish.
 */
Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: ""
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures - test results already reported
  }
});

async function withEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = { ...process.env };
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    process.env = previous;
  }
}

const R1_FLAGS_FALSE = {
  BRAIN_AGENT_ACTION_QUEUE_ENABLED: "false",
  BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "false",
  BRAIN_EXECUTION_GATE_ENABLED: "false",
  BRAIN_OUTBOX_BRIDGE_ENABLED: "false",
  BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "false",
  BRAIN_AUTONOMOUS_REPLY_ENABLED: "false"
};

async function insertConversation(): Promise<number> {
  const [result] = await getPool().execute(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type, ai_enabled, human_owner_active, last_inbound_at)
     VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0, UTC_TIMESTAMP())`,
    [randomUUID(), `phone-${randomUUID()}`, "56900003333"]
  );
  return Number((result as { insertId: number }).insertId);
}

async function loadConversation(conversationId: number) {
  const [rows] = await getPool().execute("SELECT status, ai_enabled, human_owner_active FROM conversation WHERE id = ?", [conversationId]);
  return (rows as Record<string, unknown>[])[0] as { status: string; ai_enabled: number; human_owner_active: number };
}

async function closeConversation(conversationId: number) {
  await getPool().execute("UPDATE conversation SET status = 'closed' WHERE id = ?", [conversationId]);
}

async function countOutboxRowsByDedupeKey(dedupeKey: string) {
  const [rows] = await getPool().execute("SELECT id FROM brain_message_outbox WHERE dedupe_key = ?", [dedupeKey]);
  return (rows as unknown[]).length;
}

async function loadOutboxRowByDedupeKey(dedupeKey: string) {
  const [rows] = await getPool().execute(
    "SELECT id, status, source, source_agent_name, source_agent_version, wa_id, conversation_case_id, message_text, meta_payload_json FROM brain_message_outbox WHERE dedupe_key = ? LIMIT 1",
    [dedupeKey]
  );
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return null;
  const rawMeta = row.meta_payload_json;
  const meta = typeof rawMeta === "string" ? JSON.parse(rawMeta) : (rawMeta as Record<string, unknown> | null);
  return { ...row, meta_payload_json: meta } as {
    id: number;
    status: string;
    source: string | null;
    source_agent_name: string | null;
    source_agent_version: string | null;
    wa_id: string | null;
    conversation_case_id: number | string | null;
    message_text: string | null;
    meta_payload_json: Record<string, unknown> | null;
  };
}

async function countAgentActionsForConversation(conversationId: number) {
  const [rows] = await getPool().execute("SELECT id FROM crm_agent_actions WHERE conversation_case_id = ?", [String(conversationId)]);
  return (rows as unknown[]).length;
}

async function loadLatestTerminalDispatchEvent(inboundMessageId: string) {
  const rows = await safeQueryRows<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_event WHERE event_type = 'sales_agent_runtime_terminal_dispatched' AND source_event_id = ? ORDER BY id DESC LIMIT 1",
    [inboundMessageId]
  );
  assert.ok(rows.ok, rows.ok ? "" : rows.error);
  const raw = rows.rows[0]?.payload_json;
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

const COMMERCIAL_NEED = { productQuery: null, usage: null, budgetMax: null, currency: null };

function fallbackDedupeKey(conversationId: number, inboundMessageId: string, terminalReason: string) {
  return `sales-agent-r3:${conversationId}:${inboundMessageId}:fallback:${terminalReason}`;
}

function handoffDedupeKey(conversationId: number, inboundMessageId: string) {
  return `sales-agent-r3:${conversationId}:${inboundMessageId}:handoff`;
}

function baseLoop(overrides: Partial<AgentLoopResult> = {}): AgentLoopResult {
  return {
    ran: true,
    terminalReason: "timeout",
    steps: [],
    toolExecutionCount: 0,
    finalMessage: null,
    handoffReason: null,
    warnings: [],
    finalPendingCatalogAction: null,
    llmCalls: [],
    ...overrides
  };
}

// --- classifyHardHandoffEligibility (pure) ---

test("[H1] classifyHardHandoffEligibility: eligible reason codes match exactly and as a prefix", () => {
  assert.equal(classifyHardHandoffEligibility("customer_requested_human").eligible, true);
  assert.equal(classifyHardHandoffEligibility("policy_requires_human").eligible, true);
  assert.equal(classifyHardHandoffEligibility("customer_requested_human: quiere hablar con un supervisor").eligible, true);
  assert.equal(classifyHardHandoffEligibility("CUSTOMER_REQUESTED_HUMAN").eligible, true, "case-insensitive");
});

test("[H2] classifyHardHandoffEligibility: ordinary free text and empty reasons are never eligible", () => {
  const ambiguous = classifyHardHandoffEligibility("no puedo ayudar con esto ahora mismo");
  assert.equal(ambiguous.eligible, false);
  assert.equal((ambiguous as { reason: string }).reason, "ambiguous_handoff_reason");

  const empty = classifyHardHandoffEligibility(null);
  assert.equal(empty.eligible, false);
  assert.equal((empty as { reason: string }).reason, "hard_handoff_not_eligible");
});

// --- dispatchSalesAgentFallback ---

test("[F1] timeout/provider_unavailable/invalid_output/max_steps_exceeded each dispatch a deterministic fallback, never a crm_agent_actions row", async () => {
  const cases: Array<{ terminalReason: "timeout" | "provider_unavailable" | "invalid_output" | "max_steps_exceeded" }> = [
    { terminalReason: "timeout" },
    { terminalReason: "provider_unavailable" },
    { terminalReason: "invalid_output" },
    { terminalReason: "max_steps_exceeded" }
  ];

  for (const { terminalReason } of cases) {
    const conversationId = await insertConversation();
    const inboundMessageId = `fb-${terminalReason}-${conversationId}`;

    await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
      const result = await dispatchSalesAgentFallback({
        conversationId,
        conversationCaseId: conversationId,
        opportunityId: null,
        waId: "56900003333",
        inboundMessageId,
        correlationId: `fb-corr-${conversationId}`,
        currentTime: "2026-08-31T15:00:00.000Z",
        humanOwnerActive: false,
        aiBlocked: false,
        terminalReason,
        commercialNeed: COMMERCIAL_NEED
      });

      assert.equal(result.status, "dispatched", terminalReason);
      assert.equal(result.outboxWritten, true, terminalReason);
      assert.ok(result.messageSent, terminalReason);

      const row = await loadOutboxRowByDedupeKey(fallbackDedupeKey(conversationId, inboundMessageId, terminalReason));
      assert.ok(row, terminalReason);
      assert.equal(row!.source_agent_version, SALES_AGENT_FALLBACK_DISPATCHER_VERSION, terminalReason);
      assert.equal(await countAgentActionsForConversation(conversationId), 0, terminalReason);
    });
  }
});

test("[F2] fallback governance: humanOwnerActive/aiBlocked/disabled killswitch all block, no outbox row", async () => {
  const conversationId = await insertConversation();

  const blocked1 = await dispatchSalesAgentFallback({
    conversationId,
    conversationCaseId: conversationId,
    opportunityId: null,
    waId: "56900003333",
    inboundMessageId: `fb-block-${conversationId}`,
    currentTime: "2026-08-31T15:00:00.000Z",
    humanOwnerActive: true,
    aiBlocked: false,
    terminalReason: "timeout",
    commercialNeed: COMMERCIAL_NEED
  });
  assert.equal(blocked1.status, "skipped");
  assert.equal(blocked1.reason, "human_owner_active");

  // The R3 killswitch defaults off in this process (no BRAIN_AUTONOMOUS_RESPONSES_ENABLED set here).
  const blocked2 = await dispatchSalesAgentFallback({
    conversationId,
    conversationCaseId: conversationId,
    opportunityId: null,
    waId: "56900003333",
    inboundMessageId: `fb-block2-${conversationId}`,
    currentTime: "2026-08-31T15:00:00.000Z",
    humanOwnerActive: false,
    aiBlocked: false,
    terminalReason: "timeout",
    commercialNeed: COMMERCIAL_NEED
  });
  assert.equal(blocked2.status, "skipped");
  assert.equal(blocked2.reason, "autonomous_responses_disabled");
});

test("[F3] R1 bridge flags irrelevant: fallback still dispatches with all six flags false", async () => {
  const conversationId = await insertConversation();
  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true", ...R1_FLAGS_FALSE }, async () => {
    const result = await dispatchSalesAgentFallback({
      conversationId,
      conversationCaseId: conversationId,
      opportunityId: null,
      waId: "56900003333",
      inboundMessageId: `fb-r1-${conversationId}`,
      currentTime: "2026-08-31T15:00:00.000Z",
      humanOwnerActive: false,
      aiBlocked: false,
      terminalReason: "max_steps_exceeded",
      commercialNeed: COMMERCIAL_NEED
    });
    assert.equal(result.status, "dispatched");
  });
});

test("[F4] duplicate fallback dispatch: exactly one outbox row", async () => {
  const conversationId = await insertConversation();
  const inboundMessageId = `fb-dup-${conversationId}`;

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const first = await dispatchSalesAgentFallback({
      conversationId,
      conversationCaseId: conversationId,
      opportunityId: null,
      waId: "56900003333",
      inboundMessageId,
      currentTime: "2026-08-31T15:00:00.000Z",
      humanOwnerActive: false,
      aiBlocked: false,
      terminalReason: "timeout",
      commercialNeed: COMMERCIAL_NEED
    });
    const second = await dispatchSalesAgentFallback({
      conversationId,
      conversationCaseId: conversationId,
      opportunityId: null,
      waId: "56900003333",
      inboundMessageId,
      currentTime: "2026-08-31T15:00:00.000Z",
      humanOwnerActive: false,
      aiBlocked: false,
      terminalReason: "timeout",
      commercialNeed: COMMERCIAL_NEED
    });

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(await countOutboxRowsByDedupeKey(fallbackDedupeKey(conversationId, inboundMessageId, "timeout")), 1);
  });
});

// --- dispatchSalesAgentHardHandoff ---

test("[HH1] eligible handoff: durable ownership transfer + exactly one acknowledgement, AI disabled", async () => {
  const conversationId = await insertConversation();
  const inboundMessageId = `hh-${conversationId}`;

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const result = await dispatchSalesAgentHardHandoff({
      conversationId,
      conversationCaseId: conversationId,
      opportunityId: null,
      waId: "56900003333",
      inboundMessageId,
      currentTime: "2026-08-31T15:00:00.000Z",
      handoffReason: "customer_requested_human",
      commercialNeed: COMMERCIAL_NEED
    });

    assert.equal(result.eligible, true);
    assert.equal(result.ownershipTransferred, true);
    assert.equal(result.status, "dispatched");
    assert.ok(result.messageSent);

    const conversation = await loadConversation(conversationId);
    assert.equal(Number(conversation.ai_enabled), 0);
    assert.equal(Number(conversation.human_owner_active), 1);

    assert.equal(await countOutboxRowsByDedupeKey(handoffDedupeKey(conversationId, inboundMessageId)), 1);
    assert.equal(await countAgentActionsForConversation(conversationId), 0);
  });
});

test("[HH2] ambiguous/non-eligible handoff: no ownership transfer, dispatcher reports not_eligible without touching the DB", async () => {
  const conversationId = await insertConversation();
  const result = await dispatchSalesAgentHardHandoff({
    conversationId,
    conversationCaseId: conversationId,
    opportunityId: null,
    waId: "56900003333",
    inboundMessageId: `hh-ambig-${conversationId}`,
    currentTime: "2026-08-31T15:00:00.000Z",
    handoffReason: "no logro resolver esto, no tengo la informacion",
    commercialNeed: COMMERCIAL_NEED
  });

  assert.equal(result.eligible, false);
  assert.equal(result.ownershipTransferred, false);
  assert.equal(result.status, "not_eligible");
  assert.equal(result.reason, "ambiguous_handoff_reason");

  const conversation = await loadConversation(conversationId);
  assert.equal(Number(conversation.ai_enabled), 1, "ownership must remain with the AI");
  assert.equal(Number(conversation.human_owner_active), 0);
});

test("[HH3] eligible handoff on an already-closed conversation: no ownership transfer, no outbox row", async () => {
  const conversationId = await insertConversation();
  await closeConversation(conversationId);

  const result = await dispatchSalesAgentHardHandoff({
    conversationId,
    conversationCaseId: conversationId,
    opportunityId: null,
    waId: "56900003333",
    inboundMessageId: `hh-closed-${conversationId}`,
    currentTime: "2026-08-31T15:00:00.000Z",
    handoffReason: "policy_requires_human",
    commercialNeed: COMMERCIAL_NEED
  });

  assert.equal(result.eligible, true);
  assert.equal(result.ownershipTransferred, false);
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "conversation_closed");
});

test("[HH4] eligible handoff with the R3 killswitch off: ownership still transfers, only the acknowledgement is skipped", async () => {
  const conversationId = await insertConversation();

  const result = await dispatchSalesAgentHardHandoff({
    conversationId,
    conversationCaseId: conversationId,
    opportunityId: null,
    waId: "56900003333",
    inboundMessageId: `hh-killswitch-${conversationId}`,
    currentTime: "2026-08-31T15:00:00.000Z",
    handoffReason: "customer_requested_human",
    commercialNeed: COMMERCIAL_NEED
  });

  assert.equal(result.eligible, true);
  assert.equal(result.ownershipTransferred, true, "ownership transfer is unconditional once eligible - never gated behind messaging governance");
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "autonomous_responses_disabled");
  assert.equal(result.outboxWritten, false);

  const conversation = await loadConversation(conversationId);
  assert.equal(Number(conversation.ai_enabled), 0);
  assert.equal(Number(conversation.human_owner_active), 1);
});

test("[HH5] duplicate eligible handoff processing: idempotent ownership transfer, exactly one acknowledgement", async () => {
  const conversationId = await insertConversation();
  const inboundMessageId = `hh-dup-${conversationId}`;

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const first = await dispatchSalesAgentHardHandoff({
      conversationId,
      conversationCaseId: conversationId,
      opportunityId: null,
      waId: "56900003333",
      inboundMessageId,
      currentTime: "2026-08-31T15:00:00.000Z",
      handoffReason: "customer_requested_human",
      commercialNeed: COMMERCIAL_NEED
    });
    const second = await dispatchSalesAgentHardHandoff({
      conversationId,
      conversationCaseId: conversationId,
      opportunityId: null,
      waId: "56900003333",
      inboundMessageId,
      currentTime: "2026-08-31T15:00:00.000Z",
      handoffReason: "customer_requested_human",
      commercialNeed: COMMERCIAL_NEED
    });

    assert.equal(first.eligible, true);
    assert.equal(first.duplicate, false);
    assert.equal(second.eligible, true);
    assert.equal(second.duplicate, true);
    assert.equal(await countOutboxRowsByDedupeKey(handoffDedupeKey(conversationId, inboundMessageId)), 1);

    const conversation = await loadConversation(conversationId);
    assert.equal(Number(conversation.ai_enabled), 0);
    assert.equal(Number(conversation.human_owner_active), 1);
  });
});

test("[HH6] R1 bridge flags irrelevant to hard handoff ownership transfer or acknowledgement", async () => {
  const conversationId = await insertConversation();
  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true", ...R1_FLAGS_FALSE }, async () => {
    const result = await dispatchSalesAgentHardHandoff({
      conversationId,
      conversationCaseId: conversationId,
      opportunityId: null,
      waId: "56900003333",
      inboundMessageId: `hh-r1-${conversationId}`,
      currentTime: "2026-08-31T15:00:00.000Z",
      handoffReason: "policy_requires_human",
      commercialNeed: COMMERCIAL_NEED
    });
    assert.equal(result.ownershipTransferred, true);
    assert.equal(result.status, "dispatched");
  });
});

// --- dispatchSalesAgentTerminalOutcome (router) ---

test("[T1] router: responded delegates to dispatchSalesAgentResponse (dispatchKind=responded, ownershipTransferred=false)", async () => {
  const conversationId = await insertConversation();
  const inboundMessageId = `t1-${conversationId}`;

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const outcome = await dispatchSalesAgentTerminalOutcome({
      conversationId,
      conversationCaseId: conversationId,
      opportunityId: null,
      waId: "56900003333",
      inboundMessageId,
      correlationId: `t1-corr-${conversationId}`,
      currentTime: "2026-08-31T15:00:00.000Z",
      humanOwnerActive: false,
      aiBlocked: false,
      loop: baseLoop({ terminalReason: "responded", finalMessage: "Hola, aqui tienes tu respuesta." }),
      commercialNeed: COMMERCIAL_NEED
    });

    assert.equal(outcome.dispatchKind, "responded");
    assert.equal(outcome.ownershipTransferred, false);
    assert.equal(outcome.status, "dispatched");
    assert.equal(outcome.outboxWritten, true);

    const event = await loadLatestTerminalDispatchEvent(inboundMessageId);
    assert.ok(event);
    assert.equal(event!.dispatchKind, "responded");
    assert.equal(event!.terminalReason, "responded");
    assert.equal(event!.ownershipTransferred, false);
  });
});

test("[T2] router: eligible handoff (dispatchKind=hard_handoff, ownershipTransferred=true)", async () => {
  const conversationId = await insertConversation();
  const inboundMessageId = `t2-${conversationId}`;

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const outcome = await dispatchSalesAgentTerminalOutcome({
      conversationId,
      conversationCaseId: conversationId,
      opportunityId: null,
      waId: "56900003333",
      inboundMessageId,
      correlationId: `t2-corr-${conversationId}`,
      currentTime: "2026-08-31T15:00:00.000Z",
      humanOwnerActive: false,
      aiBlocked: false,
      loop: baseLoop({ terminalReason: "handoff", handoffReason: "customer_requested_human" }),
      commercialNeed: COMMERCIAL_NEED
    });

    assert.equal(outcome.dispatchKind, "hard_handoff");
    assert.equal(outcome.ownershipTransferred, true);
    assert.equal(outcome.status, "dispatched");

    const event = await loadLatestTerminalDispatchEvent(inboundMessageId);
    assert.ok(event);
    assert.equal(event!.dispatchKind, "hard_handoff");
    assert.equal(event!.ownershipTransferred, true);
  });
});

test("[T3] router: ambiguous handoff (dispatchKind=fallback, reason=ambiguous_handoff_reason, ownershipTransferred=false)", async () => {
  const conversationId = await insertConversation();
  const inboundMessageId = `t3-${conversationId}`;

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const outcome = await dispatchSalesAgentTerminalOutcome({
      conversationId,
      conversationCaseId: conversationId,
      opportunityId: null,
      waId: "56900003333",
      inboundMessageId,
      correlationId: `t3-corr-${conversationId}`,
      currentTime: "2026-08-31T15:00:00.000Z",
      humanOwnerActive: false,
      aiBlocked: false,
      loop: baseLoop({ terminalReason: "handoff", handoffReason: "no puedo resolver esto todavia" }),
      commercialNeed: COMMERCIAL_NEED
    });

    assert.equal(outcome.dispatchKind, "fallback");
    assert.equal(outcome.reason, "ambiguous_handoff_reason");
    assert.equal(outcome.ownershipTransferred, false);
    assert.equal(outcome.outboxWritten, true, "the customer still gets a neutral message, never silence");

    const conversation = await loadConversation(conversationId);
    assert.equal(Number(conversation.ai_enabled), 1);

    const event = await loadLatestTerminalDispatchEvent(inboundMessageId);
    assert.ok(event);
    assert.equal(event!.dispatchKind, "fallback");
    assert.equal(event!.terminalReason, "handoff");
    assert.equal(event!.reason, "ambiguous_handoff_reason");
    assert.equal(event!.ownershipTransferred, false);
  });
});

test("[T4] router: technical failure (dispatchKind=fallback, reason=dispatched)", async () => {
  const conversationId = await insertConversation();
  const inboundMessageId = `t4-${conversationId}`;

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const outcome = await dispatchSalesAgentTerminalOutcome({
      conversationId,
      conversationCaseId: conversationId,
      opportunityId: null,
      waId: "56900003333",
      inboundMessageId,
      correlationId: `t4-corr-${conversationId}`,
      currentTime: "2026-08-31T15:00:00.000Z",
      humanOwnerActive: false,
      aiBlocked: false,
      loop: baseLoop({ terminalReason: "provider_unavailable" }),
      commercialNeed: COMMERCIAL_NEED
    });

    assert.equal(outcome.dispatchKind, "fallback");
    assert.equal(outcome.reason, "dispatched");
    assert.equal(outcome.ownershipTransferred, false);
    assert.equal(outcome.outboxWritten, true);
  });
});

test("[T5] router: takeover race - a human takeover recorded mid-turn (after the turn-start snapshot) still blocks a fallback dispatch", async () => {
  const conversationIdFallback = await insertConversation();
  await getPool().execute("UPDATE conversation SET human_owner_active = 1, ai_enabled = 0 WHERE id = ?", [conversationIdFallback]);

  await withEnv({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" }, async () => {
    const outcome = await dispatchSalesAgentTerminalOutcome({
      conversationId: conversationIdFallback,
      conversationCaseId: conversationIdFallback,
      opportunityId: null,
      waId: "56900003333",
      inboundMessageId: `t5-fb-${conversationIdFallback}`,
      currentTime: "2026-08-31T15:00:00.000Z",
      // Turn-start snapshot is stale (said false/false) - the transactional
      // recheck inside dispatchGovernedSalesAgentMessage must still block.
      humanOwnerActive: false,
      aiBlocked: false,
      loop: baseLoop({ terminalReason: "timeout" }),
      commercialNeed: COMMERCIAL_NEED
    });
    assert.equal(outcome.status, "skipped");
    assert.equal(outcome.reason, "human_owner_active");
    assert.equal(outcome.outboxWritten, false);
  });
});
