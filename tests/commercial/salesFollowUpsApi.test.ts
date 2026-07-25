import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after } from "node:test";
import { NextRequest } from "next/server";
import { getPool, safeExecute, safeQueryRows } from "@/lib/db";

// Real MariaDB, real crm_test - same convention as salesAgentConfigurationApi.test.ts.
// Exercises the Route Handlers directly (NextRequest -> exported GET), never
// mocked, so requireOperator + the read-only domain services all run for real.
// ACS-R1-05.1-T02.4: read-only observability - these tests never assert on a
// write path because there isn't one to assert on.
Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  SESSION_SECRET: "session-secret-for-tests",
  ADMIN_BYPASS_TOKEN: "admin-bypass-token-for-tests"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

const AUTH_HEADERS = { "x-admin-bypass-token": "admin-bypass-token-for-tests" };
const TEST_TAG = `fu-api-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
let seedCounter = 0;

function uniqueSuffix() {
  seedCounter += 1;
  return `${TEST_TAG}-${seedCounter}`;
}

function toMysqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function seedConversation(): Promise<{ id: number; waId: string }> {
  const suffix = uniqueSuffix();
  const waId = `569${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const publicId = crypto.randomUUID();
  const insert = await safeExecute(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id) VALUES (?, 'whatsapp', 'meta', ?, ?)`,
    [publicId, `pnid-${suffix}`, waId]
  );
  assert.ok(insert.ok, insert.ok ? "" : insert.error);
  const row = await safeQueryRows<{ id: number }>(`SELECT id FROM conversation WHERE public_id = ? LIMIT 1`, [publicId]);
  return { id: row.rows[0].id, waId };
}

async function seedOpportunity(input: { waId: string; conversationId: number; status?: string; stage?: string }): Promise<number> {
  const opportunityKey = `opp-${uniqueSuffix()}`;
  const insert = await safeExecute(
    `INSERT INTO crm_opportunities (
       opportunity_key, wa_id, conversation_case_id, status, stage,
       requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json
     ) VALUES (?, ?, ?, ?, ?, '[]', '[]', '[]', '[]', '{}')`,
    [opportunityKey, input.waId, String(input.conversationId), input.status ?? "new", input.stage ?? null]
  );
  assert.ok(insert.ok, insert.ok ? "" : insert.error);
  const row = await safeQueryRows<{ id: number }>(`SELECT id FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1`, [opportunityKey]);
  return row.rows[0].id;
}

type SeedFollowUpInput = {
  opportunityId?: number | null;
  conversationId?: number | null;
  waId?: string | null;
  status: string;
  attemptNumber?: number;
  maxAttempts?: number;
  scheduledFor?: Date | null;
  cancelReason?: string | null;
  failureReason?: string | null;
  followupConfigurationSource?: string | null;
  followupConfigurationVersion?: number | null;
  blockReasonsJson?: string[];
  updatedAt?: Date;
  createdAt?: Date;
};

async function seedFollowUpAction(input: SeedFollowUpInput): Promise<string> {
  const actionId = `followup-${uniqueSuffix()}`;
  const updatedAt = input.updatedAt ?? new Date();
  const createdAt = input.createdAt ?? new Date();
  const insert = await safeExecute(
    `INSERT INTO crm_agent_actions (
       action_id, idempotency_key, opportunity_id, conversation_case_id, wa_id, channel,
       action_type, status, attempt_number, max_attempts, scheduled_for,
       cancel_reason, failure_reason, followup_configuration_source, followup_configuration_version,
       block_reasons_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'whatsapp', 'schedule_followup', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actionId,
      actionId,
      input.opportunityId ?? null,
      input.conversationId ?? null,
      input.waId ?? null,
      input.status,
      input.attemptNumber ?? 1,
      input.maxAttempts ?? 1,
      input.scheduledFor ? toMysqlDateTime(input.scheduledFor) : null,
      input.cancelReason ?? null,
      input.failureReason ?? null,
      input.followupConfigurationSource ?? null,
      input.followupConfigurationVersion ?? null,
      JSON.stringify(input.blockReasonsJson ?? []),
      toMysqlDateTime(createdAt),
      toMysqlDateTime(updatedAt)
    ]
  );
  assert.ok(insert.ok, insert.ok ? "" : insert.error);
  return actionId;
}

/** Best-effort outbox correlation fixture - mirrors the real path: a follow-up execution re-enters the cycle with correlationId=`followup:<actionId>:<ms>`, persisted on crm_agent_decisions.correlation_id, and the resulting send_whatsapp_reply action carries that decision_id + outbox_message_id. */
async function seedCorrelatedReply(followUpActionId: string, opportunityId: number): Promise<void> {
  const suffix = uniqueSuffix();
  const decisionId = `decision-${suffix}`;
  const correlationId = `followup:${followUpActionId}:${Date.now()}${suffix}`;

  const decisionInsert = await safeExecute(
    `INSERT INTO crm_agent_decisions (
       decision_id, opportunity_id, correlation_id, next_status, detected_signals_json, state_changes_json,
       missing_information_json, next_action_json, policy_status, risk_level, approval_requirement,
       decision_status, rationale, warnings_json
     ) VALUES (?, ?, ?, 'active', '[]', '[]', '[]', '{}', 'allowed', 'low', 'none', 'completed', 'test fixture', '[]')`,
    [decisionId, opportunityId, correlationId]
  );
  assert.ok(decisionInsert.ok, decisionInsert.ok ? "" : decisionInsert.error);

  const dedupeKey = `dedupe-${suffix}`;
  const outboxInsert = await safeExecute(`INSERT INTO brain_message_outbox (dedupe_key, status, sent_at) VALUES (?, 'sent', NOW())`, [dedupeKey]);
  assert.ok(outboxInsert.ok, outboxInsert.ok ? "" : outboxInsert.error);
  const outboxRow = await safeQueryRows<{ id: number }>(`SELECT id FROM brain_message_outbox WHERE dedupe_key = ? LIMIT 1`, [dedupeKey]);
  const outboxMessageId = outboxRow.rows[0].id;

  const replyActionId = `reply-${suffix}`;
  const replyInsert = await safeExecute(
    `INSERT INTO crm_agent_actions (action_id, idempotency_key, decision_id, action_type, status, outbox_message_id)
     VALUES (?, ?, ?, 'send_whatsapp_reply', 'executed', ?)`,
    [replyActionId, replyActionId, decisionId, outboxMessageId]
  );
  assert.ok(replyInsert.ok, replyInsert.ok ? "" : replyInsert.error);
}

/** mysql2 returns MAX(updated_at) as a Date instance, not a string - two
 * separate SELECTs never return the same Date object even when they
 * represent the identical instant, so comparing them with a reference-equality
 * assertion (assert.equal under node:assert/strict aliases to strictEqual)
 * always fails. Normalizing to an ISO string here makes the snapshot
 * comparable by value at the call site. */
function toComparableTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function snapshotFollowUpActionsState(): Promise<{ total: number; maxUpdatedAt: string | null }> {
  const result = await safeQueryRows<{ total: number; max_updated_at: unknown }>(
    `SELECT COUNT(*) AS total, MAX(updated_at) AS max_updated_at FROM crm_agent_actions WHERE action_id LIKE ?`,
    [`followup-${TEST_TAG}%`]
  );
  if (!result.ok) return { total: 0, maxUpdatedAt: null };
  const row = result.rows[0];
  return { total: Number(row?.total ?? 0), maxUpdatedAt: toComparableTimestamp(row?.max_updated_at) };
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

test("[FUA1] GET /follow-ups/summary without a session is rejected", async () => {
  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/summary/route");
  const response = await GET(new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups/summary")));
  assert.equal(response.status, 401);
});

test("[FUA2] GET /follow-ups without a session is rejected", async () => {
  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/route");
  const response = await GET(new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups")));
  assert.equal(response.status, 401);
});

test("[FUA3] GET /follow-ups/[actionId] without a session is rejected", async () => {
  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/[actionId]/route");
  const response = await GET(new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups/anything")), {
    params: Promise.resolve({ actionId: "anything" })
  });
  assert.equal(response.status, 401);
});

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

test("[FUS1] GET /follow-ups/summary rejects an invalid range", async () => {
  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/summary/route");
  const response = await GET(
    new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups/summary?range=90d", { headers: AUTH_HEADERS }))
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "invalid_range");
});

test("[FUS2] GET /follow-ups/summary counts a seeded requires_review row", async () => {
  const conversation = await seedConversation();
  const opportunityId = await seedOpportunity({ waId: conversation.waId, conversationId: conversation.id });
  await seedFollowUpAction({ opportunityId, conversationId: conversation.id, waId: conversation.waId, status: "requires_review" });

  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/summary/route");
  const response = await GET(new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups/summary?range=24h", { headers: AUTH_HEADERS })));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.summary.requiresReview >= 1);
});

// ---------------------------------------------------------------------------
// paginación + límite máximo
// ---------------------------------------------------------------------------

test("[FUL1] GET /follow-ups paginates and clamps an excessive limit to the fixed maximum", async () => {
  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/route");
  const response = await GET(
    new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups?limit=999999&page=1", { headers: AUTH_HEADERS }))
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.limit, 100);
});

test("[FUL2] GET /follow-ups rejects a malformed page/limit", async () => {
  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/route");
  const badPage = await GET(new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups?page=0", { headers: AUTH_HEADERS })));
  assert.equal(badPage.status, 400);
  const badLimit = await GET(new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups?limit=-5", { headers: AUTH_HEADERS })));
  assert.equal(badLimit.status, 400);
});

// ---------------------------------------------------------------------------
// filtros + masking server-side
// ---------------------------------------------------------------------------

test("[FUL3] GET /follow-ups filters by opportunityId and masks wa_id server-side", async () => {
  const conversation = await seedConversation();
  const opportunityId = await seedOpportunity({ waId: conversation.waId, conversationId: conversation.id });
  await seedFollowUpAction({ opportunityId, conversationId: conversation.id, waId: conversation.waId, status: "planned", scheduledFor: new Date() });

  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/route");
  const response = await GET(
    new NextRequest(new Request(`http://127.0.0.1/api/brain/agents/sales/follow-ups?opportunityId=${opportunityId}`, { headers: AUTH_HEADERS }))
  );
  assert.equal(response.status, 200);
  const bodyText = await response.text();
  assert.ok(!bodyText.includes(conversation.waId), "full wa_id must never be serialized in the response");
  const body = JSON.parse(bodyText);
  assert.ok(body.items.length >= 1);
  assert.ok(body.items.every((item: { waIdMasked: string | null }) => item.waIdMasked === null || item.waIdMasked.startsWith("********")));
});

test("[FUL4] GET /follow-ups rejects an invalid criticality value", async () => {
  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/route");
  const response = await GET(new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups?criticality=bogus", { headers: AUTH_HEADERS })));
  assert.equal(response.status, 400);
});

// ---------------------------------------------------------------------------
// planned vencido / executing stale / missing schedule / missing configuration
// ---------------------------------------------------------------------------

test("[FUC1] planned_overdue flags a planned row scheduled more than 15 minutes ago", async () => {
  const overdueActionId = await seedFollowUpAction({ status: "planned", scheduledFor: new Date(Date.now() - 20 * 60_000) });
  await seedFollowUpAction({ status: "planned", scheduledFor: new Date(Date.now() - 5 * 60_000) });

  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/route");
  const response = await GET(
    new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups?criticality=planned_overdue&limit=100", { headers: AUTH_HEADERS }))
  );
  const body = await response.json();
  const actionIds = body.items.map((item: { actionId: string }) => item.actionId);
  assert.ok(actionIds.includes(overdueActionId));
});

test("[FUC2] executing_stale flags an executing row idle past the production 300s threshold", async () => {
  const staleActionId = await seedFollowUpAction({ status: "executing", updatedAt: new Date(Date.now() - 400_000) });

  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/route");
  const response = await GET(
    new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups?criticality=executing_stale&limit=100", { headers: AUTH_HEADERS }))
  );
  const body = await response.json();
  const actionIds = body.items.map((item: { actionId: string }) => item.actionId);
  assert.ok(actionIds.includes(staleActionId));
});

test("[FUC3] missing_schedule flags a planned row with scheduled_for = NULL", async () => {
  const actionId = await seedFollowUpAction({ status: "planned", scheduledFor: null });

  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/route");
  const response = await GET(
    new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups?criticality=missing_schedule&limit=100", { headers: AUTH_HEADERS }))
  );
  const body = await response.json();
  const actionIds = body.items.map((item: { actionId: string }) => item.actionId);
  assert.ok(actionIds.includes(actionId));
});

test("[FUC4] missing_configuration badge applies when followup_configuration_source is NULL", async () => {
  const actionId = await seedFollowUpAction({ status: "blocked", followupConfigurationSource: null });

  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/[actionId]/route");
  const response = await GET(new NextRequest(new Request(`http://127.0.0.1/api/brain/agents/sales/follow-ups/${actionId}`, { headers: AUTH_HEADERS })), {
    params: Promise.resolve({ actionId })
  });
  const body = await response.json();
  assert.equal(body.detail.configurationSnapshot.source, null);
});

test("[FUC5] requires_review renders the exact approved copy and has no approval route in this API", async () => {
  const actionId = await seedFollowUpAction({ status: "requires_review" });

  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/route");
  const response = await GET(
    new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups?status=requires_review&limit=100", { headers: AUTH_HEADERS }))
  );
  const body = await response.json();
  const item = body.items.find((entry: { actionId: string }) => entry.actionId === actionId);
  assert.ok(item);
  assert.equal(item.statusLabel, "Requiere revisión — sin flujo de aprobación disponible");
});

// ---------------------------------------------------------------------------
// detalle: 404, errores sanitizados / injection-safety
// ---------------------------------------------------------------------------

test("[FUD1] GET /follow-ups/[actionId] returns 404 for an unknown action id", async () => {
  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/[actionId]/route");
  const unknownId = `unknown-${uniqueSuffix()}`;
  const response = await GET(new NextRequest(new Request(`http://127.0.0.1/api/brain/agents/sales/follow-ups/${unknownId}`, { headers: AUTH_HEADERS })), {
    params: Promise.resolve({ actionId: unknownId })
  });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error, "not_found");
  assert.ok(!JSON.stringify(body).match(/sql|ER_|mysql/i));
});

test("[FUD2] GET /follow-ups/[actionId] with SQL-meta characters is parameterized safely and never leaks a raw DB error", async () => {
  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/[actionId]/route");
  const maliciousId = "a'); DROP TABLE crm_agent_actions;--";
  const response = await GET(
    new NextRequest(new Request(`http://127.0.0.1/api/brain/agents/sales/follow-ups/${encodeURIComponent(maliciousId)}`, { headers: AUTH_HEADERS })),
    { params: Promise.resolve({ actionId: encodeURIComponent(maliciousId) }) }
  );
  assert.equal(response.status, 404);
  const stillThere = await safeQueryRows(`SELECT 1 FROM crm_agent_actions LIMIT 1`);
  assert.ok(stillThere.ok);
});

// ---------------------------------------------------------------------------
// correlación outbox: correlacionado / ausente / ambigua
// ---------------------------------------------------------------------------

test("[FUO1] outbox correlation: correlated reply resolves to kind=correlated", async () => {
  const conversation = await seedConversation();
  const opportunityId = await seedOpportunity({ waId: conversation.waId, conversationId: conversation.id });
  const actionId = await seedFollowUpAction({ opportunityId, conversationId: conversation.id, waId: conversation.waId, status: "executed" });
  await seedCorrelatedReply(actionId, opportunityId);

  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/[actionId]/route");
  const response = await GET(new NextRequest(new Request(`http://127.0.0.1/api/brain/agents/sales/follow-ups/${actionId}`, { headers: AUTH_HEADERS })), {
    params: Promise.resolve({ actionId })
  });
  const body = await response.json();
  assert.equal(body.detail.outboxCorrelation.kind, "correlated");
  assert.equal(typeof body.detail.outboxCorrelation.outboxMessageId, "number");
});

test("[FUO2] outbox correlation: no matching reply resolves to kind=none, never an error", async () => {
  const actionId = await seedFollowUpAction({ status: "executed" });

  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/[actionId]/route");
  const response = await GET(new NextRequest(new Request(`http://127.0.0.1/api/brain/agents/sales/follow-ups/${actionId}`, { headers: AUTH_HEADERS })), {
    params: Promise.resolve({ actionId })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.detail.outboxCorrelation.kind, "none");
  assert.equal(body.detail.technicalHistoryAvailable, false);
  assert.equal(body.detail.technicalHistoryMessage, "Historial técnico detallado no disponible");
});

test("[FUO3] outbox correlation: two matching replies resolve to kind=ambiguous, never guessed", async () => {
  const conversation = await seedConversation();
  const opportunityId = await seedOpportunity({ waId: conversation.waId, conversationId: conversation.id });
  const actionId = await seedFollowUpAction({ opportunityId, conversationId: conversation.id, waId: conversation.waId, status: "executed" });
  await seedCorrelatedReply(actionId, opportunityId);
  await seedCorrelatedReply(actionId, opportunityId);

  const { GET } = await import("@/app/api/brain/agents/sales/follow-ups/[actionId]/route");
  const response = await GET(new NextRequest(new Request(`http://127.0.0.1/api/brain/agents/sales/follow-ups/${actionId}`, { headers: AUTH_HEADERS })), {
    params: Promise.resolve({ actionId })
  });
  const body = await response.json();
  assert.equal(body.detail.outboxCorrelation.kind, "ambiguous");
  assert.equal(body.detail.outboxCorrelation.candidateCount, 2);
});

// ---------------------------------------------------------------------------
// cero escrituras: hitting every GET repeatedly never mutates crm_agent_actions
// ---------------------------------------------------------------------------

test("[FUW1] repeated GET calls across all three routes never write to crm_agent_actions", async () => {
  const conversation = await seedConversation();
  const opportunityId = await seedOpportunity({ waId: conversation.waId, conversationId: conversation.id });
  const actionId = await seedFollowUpAction({ opportunityId, conversationId: conversation.id, waId: conversation.waId, status: "planned", scheduledFor: new Date() });

  const before = await snapshotFollowUpActionsState();

  const { GET: summaryGet } = await import("@/app/api/brain/agents/sales/follow-ups/summary/route");
  const { GET: listGet } = await import("@/app/api/brain/agents/sales/follow-ups/route");
  const { GET: detailGet } = await import("@/app/api/brain/agents/sales/follow-ups/[actionId]/route");

  for (let i = 0; i < 5; i += 1) {
    await summaryGet(new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups/summary", { headers: AUTH_HEADERS })));
    await listGet(new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/follow-ups", { headers: AUTH_HEADERS })));
    await detailGet(new NextRequest(new Request(`http://127.0.0.1/api/brain/agents/sales/follow-ups/${actionId}`, { headers: AUTH_HEADERS })), {
      params: Promise.resolve({ actionId })
    });
  }

  const after = await snapshotFollowUpActionsState();
  assert.equal(after.total, before.total);
  assert.equal(after.maxUpdatedAt, before.maxUpdatedAt);
});
