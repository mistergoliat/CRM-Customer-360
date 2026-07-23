import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows, safeExecute, safeQueryRows } from "@/lib/db";
import {
  archiveConfiguration,
  createDraftConfiguration,
  loadPublishedPesasChileConfiguration,
  publishDraftConfiguration,
  type SalesAgentFollowUpConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";
import { resolveFollowUpSchedulingContext, type FollowUpSchedulingLoopContext } from "@/lib/brain/commercial/execution-bridge";
import { loadFollowUpAttemptHistory, buildFollowUpSequenceKey } from "@/lib/brain/commercial/followup/loadFollowUpAttemptHistory";
import { persistAgentAction } from "@/lib/brain/commercial/action-queue";
import type { CrmAgentAction } from "@/lib/brain/commercial/action-queue";

// Real MariaDB, real crm_test - same convention as salesAgentConfiguration.test.ts / runFollowupTick.test.ts.
Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function randomWaId() {
  return `569${String(Date.now()).slice(-9)}${Math.floor(Math.random() * 9)}`;
}

// crm_agent_actions.opportunity_id has a FK to crm_opportunities(id) - any
// fixture that actually inserts a row needs a real opportunity, not a
// synthetic id. Mirrors salesConsultativeFollowUpRepository.test.ts's
// seedOpportunity helper.
async function seedOpportunity(): Promise<number> {
  const opportunityKey = `test-followup-continuity-${uniqueSuffix()}`;
  await queryRows(
    `INSERT INTO crm_opportunities (
        opportunity_key, wa_id, channel, primary_intent, status, stage,
        requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json
      ) VALUES (?, ?, 'whatsapp', 'product_inquiry', 'engaged', 'recommendation', '[]', '[]', '[]', '[]', '[]')`,
    [opportunityKey, randomWaId()]
  );
  const row = await safeQueryRows<{ id: number }>("SELECT id FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1", [opportunityKey]);
  assert.ok(row.ok && row.rows[0]?.id, row.ok ? "missing seeded opportunity id" : row.error);
  return row.rows[0]!.id;
}

async function clearActivePublication() {
  const active = await loadPublishedPesasChileConfiguration();
  if (active) await archiveConfiguration(active.id);
}

const PROMPT_FIELDS = {
  agentName: "Valentina",
  companyName: "PesasChile",
  role: "Asesora comercial",
  companyDescription: "Vendemos equipamiento de gimnasio.",
  customInstructions: "",
  prohibitedPhrases: []
};

async function publishFollowUpConfiguration(followUpConfiguration: SalesAgentFollowUpConfiguration) {
  await clearActivePublication();
  const draft = await createDraftConfiguration({
    name: `followup-continuity-${uniqueSuffix()}`,
    configuration: { ...PROMPT_FIELDS, followUpConfiguration },
    createdBy: "test-suite"
  });
  return publishDraftConfiguration({ id: draft.id });
}

const ENABLED_CONFIG: SalesAgentFollowUpConfiguration = {
  enabled: true,
  maxAttempts: 2,
  attemptDelaysMinutes: [60, 1440],
  allowedWindow: {
    timezone: "America/Santiago",
    startHour: 9,
    endHour: 19,
    allowedWeekdays: [1, 2, 3, 4, 5]
  },
  maxOpportunityAgeDays: 30
};

function buildFollowUpAction(overrides: Partial<CrmAgentAction> & { followUpSequenceKey: string }): CrmAgentAction {
  return {
    id: null,
    actionId: `crm-agent-action-${uniqueSuffix()}`,
    idempotencyKey: `crm-agent-action:${uniqueSuffix()}`,
    opportunityId: null,
    decisionId: null,
    decisionRowId: null,
    conversationCaseId: null,
    messageId: null,
    waId: "56900000001",
    channel: "whatsapp",
    actionType: "schedule_followup",
    status: "planned",
    riskLevel: "low",
    approvalRequirement: "none",
    draftPayload: null,
    finalPayload: null,
    executionPayload: null,
    draftMessage: "Hola, seguimos disponibles",
    finalMessage: null,
    scheduledFor: "2026-03-02T15:00:00.000Z",
    expiresAt: null,
    attemptNumber: 1,
    maxAttempts: 2,
    blockReasons: [],
    cancelReason: null,
    failureReason: null,
    policyStatus: "allowed",
    policyNotes: [],
    source: "ai_sdr",
    createdBy: "ai",
    approvedBy: null,
    approvedAt: null,
    executedAt: null,
    cancelledAt: null,
    outboxMessageId: null,
    lifecycleVersion: "brain.commercial.action-lifecycle.v1",
    policyVersion: null,
    runtimeVersion: null,
    createdAt: "2026-03-02T14:00:00.000Z",
    updatedAt: null,
    ...overrides
  };
}

async function persistReal(action: CrmAgentAction) {
  return persistAgentAction({
    action,
    currentTime: action.createdAt ?? new Date().toISOString(),
    featureFlags: { queueEnabled: true, persistenceEnabled: true }
  });
}

// validateAgentAction rejects any live write that arrives already in a
// terminal status (execution_not_enabled_in_p1k_012a) - a "historical" row
// used only to seed attempt-continuity state must instead be inserted as a
// normal planned row through the real write path and then advanced to its
// terminal status with a direct SQL update, exactly like
// runFollowupTick.test.ts's setActionState helper.
async function seedHistoricalFollowUpAction(action: CrmAgentAction): Promise<void> {
  const terminalStatus = action.status;
  const insertResult = await persistReal({ ...action, status: "planned" });
  assert.equal(insertResult.status, "inserted", `failed to seed historical row: ${JSON.stringify(insertResult)}`);
  if (terminalStatus === "planned") return;
  const update = await safeExecute("UPDATE crm_agent_actions SET status = ?, updated_at = UTC_TIMESTAMP(3) WHERE action_id = ?", [
    terminalStatus,
    action.actionId
  ]);
  assert.ok(update.ok, update.ok ? "" : update.error);
}

// ---------------------------------------------------------------------------
// resolveFollowUpSchedulingContext - the core scheduling decision
// ---------------------------------------------------------------------------

test("[FS1] no published configuration -> safe default (disabled) -> follow_up_disabled, never a fabricated schedule", async () => {
  await clearActivePublication();
  const loop: FollowUpSchedulingLoopContext = { resultingState: { opportunityId: `opp-${uniqueSuffix()}`, conversationCaseId: null } };
  const result = await resolveFollowUpSchedulingContext(loop, "2026-03-02T14:00:00.000Z");
  assert.equal(result.scheduledFor, null);
  assert.deepEqual(result.additionalBlockReasons, ["follow_up_disabled"]);
  assert.equal(result.followUpConfigurationSource, "safe_default");
});

test("[FS2] an enabled published configuration computes a real, non-null schedule for attempt 1", async () => {
  const published = await publishFollowUpConfiguration(ENABLED_CONFIG);
  const loop: FollowUpSchedulingLoopContext = { resultingState: { opportunityId: `opp-${uniqueSuffix()}`, conversationCaseId: null } };
  const result = await resolveFollowUpSchedulingContext(loop, "2026-03-02T14:00:00.000Z");
  assert.equal(result.additionalBlockReasons.length, 0);
  assert.ok(result.scheduledFor, "expected a real scheduled_for");
  assert.equal(result.scheduledFor, "2026-03-02T15:00:00.000Z"); // 14:00 + 60min, already inside the window
  assert.equal(result.attemptNumber, 1);
  assert.equal(result.maxAttempts, 2);
  assert.equal(result.followUpConfigurationSource, "published");
  assert.equal(result.followUpConfigurationId, published.id);
  assert.equal(result.followUpConfigurationVersion, published.version);
  assert.equal(result.followUpConfigurationHash, published.configurationHash);
});

test("[FS3] attempt continuity: a second proposal for the SAME opportunity computes attempt 2 from attempt 1's own scheduled_for", async () => {
  await publishFollowUpConfiguration(ENABLED_CONFIG);
  const opportunityId = await seedOpportunity();
  const sequenceKey = buildFollowUpSequenceKey(opportunityId, null)!;

  // Seed attempt 1 as already executed (consumed a real attempt) with a known scheduledFor.
  await seedHistoricalFollowUpAction(
    buildFollowUpAction({
      followUpSequenceKey: sequenceKey,
      opportunityId,
      status: "executed",
      attemptNumber: 1,
      maxAttempts: 2,
      scheduledFor: "2026-03-02T15:00:00.000Z"
    })
  );

  const loop: FollowUpSchedulingLoopContext = { resultingState: { opportunityId, conversationCaseId: null } };
  const result = await resolveFollowUpSchedulingContext(loop, "2026-03-05T10:00:00.000Z");
  assert.equal(result.attemptNumber, 2);
  // delays[1] = 1440min (24h) from attempt 1's OWN scheduledFor (15:00 Mon) - never from "now" (Thursday).
  assert.equal(result.scheduledFor, "2026-03-03T15:00:00.000Z");
});

test("[FS4] max attempts reached blocks scheduling a further attempt", async () => {
  await publishFollowUpConfiguration(ENABLED_CONFIG); // maxAttempts: 2
  const opportunityId = await seedOpportunity();
  const sequenceKey = buildFollowUpSequenceKey(opportunityId, null)!;

  await seedHistoricalFollowUpAction(
    buildFollowUpAction({ followUpSequenceKey: sequenceKey, opportunityId, status: "failed", attemptNumber: 2, maxAttempts: 2 })
  );

  const loop: FollowUpSchedulingLoopContext = { resultingState: { opportunityId, conversationCaseId: null } };
  const result = await resolveFollowUpSchedulingContext(loop, "2026-03-05T10:00:00.000Z");
  assert.equal(result.scheduledFor, null);
  assert.deepEqual(result.additionalBlockReasons, ["max_attempts_reached"]);
});

test("[FS5] an opportunity older than maxOpportunityAgeDays is blocked, based on created_at (age), never activity", async () => {
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, maxOpportunityAgeDays: 5 });
  const loop: FollowUpSchedulingLoopContext = {
    resultingState: {
      opportunityId: `opp-${uniqueSuffix()}`,
      conversationCaseId: null,
      createdAt: "2026-02-01T00:00:00.000Z" // ~30 days before the reference "now" below
    }
  };
  const result = await resolveFollowUpSchedulingContext(loop, "2026-03-05T10:00:00.000Z");
  assert.equal(result.scheduledFor, null);
  assert.deepEqual(result.additionalBlockReasons, ["opportunity_too_old"]);
});

test("[FS6] an active row already exists for the sequence -> persistAgentAction reuses it, never a second active row", async () => {
  await publishFollowUpConfiguration(ENABLED_CONFIG);
  const opportunityId = await seedOpportunity();
  const sequenceKey = buildFollowUpSequenceKey(opportunityId, null)!;

  const first = buildFollowUpAction({ followUpSequenceKey: sequenceKey, opportunityId, status: "planned" });
  const firstResult = await persistReal(first);
  assert.equal(firstResult.status, "inserted");

  const second = buildFollowUpAction({ followUpSequenceKey: sequenceKey, opportunityId, status: "planned", scheduledFor: "2026-03-04T15:00:00.000Z" });
  const secondResult = await persistReal(second);
  assert.equal(secondResult.status, "duplicate_ignored");
  assert.equal(secondResult.action.actionId, first.actionId, "must reuse the existing active row, never create a second one");

  const rows = await queryRows<{ count: number }>(
    "SELECT COUNT(*) as count FROM crm_agent_actions WHERE followup_sequence_key = ? AND status IN ('planned','requires_review','executing')",
    [sequenceKey]
  );
  assert.equal(Number(rows[0].count), 1, "at most one active row per sequence, enforced end to end");
});

test("[FS7] once the active row is terminal, a new attempt for the same sequence is allowed", async () => {
  await publishFollowUpConfiguration(ENABLED_CONFIG);
  const opportunityId = await seedOpportunity();
  const sequenceKey = buildFollowUpSequenceKey(opportunityId, null)!;

  const first = buildFollowUpAction({ followUpSequenceKey: sequenceKey, opportunityId, status: "executed", attemptNumber: 1 });
  await seedHistoricalFollowUpAction(first);

  const second = buildFollowUpAction({ followUpSequenceKey: sequenceKey, opportunityId, status: "planned", attemptNumber: 2 });
  const secondResult = await persistReal(second);
  assert.equal(secondResult.status, "inserted", "a terminal first attempt must never block a genuinely new attempt");
});

// ---------------------------------------------------------------------------
// loadFollowUpAttemptHistory - continuity key precedence (decision 5)
// ---------------------------------------------------------------------------

test("[FS8] loadFollowUpAttemptHistory scopes by opportunity_id when known, never falls back to conversation_case_id", async () => {
  const opportunityId = await seedOpportunity();
  const conversationCaseId = 999999;
  const sequenceKey = buildFollowUpSequenceKey(opportunityId, null)!;
  await seedHistoricalFollowUpAction(
    buildFollowUpAction({ followUpSequenceKey: sequenceKey, opportunityId, conversationCaseId, status: "executed", attemptNumber: 1 })
  );

  const byOpportunity = await loadFollowUpAttemptHistory({ opportunityId, conversationCaseId: null });
  assert.equal(byOpportunity.maxConsumedAttemptNumber, 1);

  // A DIFFERENT opportunity sharing the same conversationCaseId must never see this history.
  const otherOpportunityId = await seedOpportunity();
  const differentOpportunity = await loadFollowUpAttemptHistory({ opportunityId: otherOpportunityId, conversationCaseId });
  assert.equal(differentOpportunity.maxConsumedAttemptNumber, 0);
});

test("[FS9] loadFollowUpAttemptHistory falls back to conversation_case_id only when opportunity_id is absent", async () => {
  const conversationCaseId = Number(`${Date.now()}`.slice(-8));
  const sequenceKey = buildFollowUpSequenceKey(null, conversationCaseId)!;
  await seedHistoricalFollowUpAction(
    buildFollowUpAction({ followUpSequenceKey: sequenceKey, opportunityId: null, conversationCaseId, status: "executed", attemptNumber: 1 })
  );

  const history = await loadFollowUpAttemptHistory({ opportunityId: null, conversationCaseId });
  assert.equal(history.maxConsumedAttemptNumber, 1);
  assert.equal(history.sequenceKey, `followup-case-${conversationCaseId}`);
});

test("[FS10] neither identity known -> no sequence key, no continuity tracked (degrades safely, never throws)", async () => {
  const history = await loadFollowUpAttemptHistory({ opportunityId: null, conversationCaseId: null });
  assert.equal(history.sequenceKey, null);
  assert.equal(history.activeRow, null);
  assert.equal(history.maxConsumedAttemptNumber, 0);
});
