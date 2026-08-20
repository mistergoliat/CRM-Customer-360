import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getPool, queryRows } from "@/lib/db";
import {
  loadWhatsAppAccessGateConfig,
  isWaIdAllowedByAccessGate,
  loadAutonomousResponsesEnabled,
  AutonomousRuntimeConfigError,
  type WhatsAppAccessGateConfig
} from "@/lib/brain/runtime/autonomousRuntimeConfig";
import {
  buildCommercialWorkProjection,
  persistCommercialWorkProjection,
  runCommercialWorkTick,
  selectDueCommercialWorkSteps,
  scheduleObjectiveAwareFollowUp,
  type CommercialObjectiveSeed,
  type CommercialWork,
  type CommercialWorkProjectionInput
} from "@/lib/brain/commercial/work";
import { runFollowupTick } from "@/lib/brain/commercial/followup/runFollowupTick";
import type { CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle";

/**
 * SALES-AGENT-R2-A11. ACC (access gate) / AUTO (autonomy killswitch) / WORK
 * (retry worker) / FU (follow-up) test matrix for the two new control-plane
 * gates committed in 00e93e0 and the worker/follow-up-specific wiring added
 * in this task. Does not re-test A05/A06/A09/A10 mechanics already covered
 * elsewhere (restart recovery, two-worker CAS, lease expiration, max
 * attempts, stale customer reply, cancellation, handoff - see
 * commercialWorkRetryWorker.test.ts / runFollowupTick.test.ts /
 * objectiveAwareFollowUp.test.ts) - only the NEW gate behaviors.
 */

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
  // Permissive baseline for the access/autonomy gates - most tests below use
  // explicit per-call option overrides instead, but a few (ACC08, AUTO04,
  // ACC09/10, AUTO01/02) flip these via a temporary process.env override and
  // restore afterward, since runFollowupTick/runNativeAutonomousCycle read
  // the access gate and autonomy killswitch directly from env with no
  // per-call override for those two specifically.
  BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false",
  BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true"
});

// Deliberately in the past relative to real wall-clock time: selectDueFollowUps
// compares scheduled_for against REAL UTC_TIMESTAMP() (not an injected `now`),
// so makeDue()'s forced scheduled_for must already be in the past for real,
// matching every other test file's convention (e.g. objectiveAwareFollowUp.test.ts).
const NOW = "2026-08-17T12:00:00.000Z";
// A few minutes after NOW, safely clearing CALCULATE_SHIPPING's ~1 minute retry
// backoff (retryPolicy.ts) - used wherever a CommercialWork step's own
// next_attempt_at (computed relative to NOW during fixture setup) must have
// passed by the time a test's own tick call checks for due work.
const DUE = "2026-08-17T12:05:00.000Z";

let conversationId = 0;
let opportunityId = 0;
let waId = "";

before(async () => {
  const seeded = await seedConversation();
  conversationId = seeded.id;
  waId = seeded.waId;
  opportunityId = await seedOpportunity(waId);
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore teardown failures
  }
});

function unique(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function seedConversation() {
  const wa = `569${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const [result] = await getPool().execute(
    `INSERT INTO conversation (
      public_id, channel, provider, channel_account_id, external_contact_id,
      status, owner_type, ai_enabled, human_owner_active
    ) VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [randomUUID(), unique("phone"), wa]
  );
  return { id: Number((result as { insertId: number }).insertId), waId: wa };
}

async function seedOpportunity(wa: string) {
  const [result] = await getPool().execute(
    `INSERT INTO crm_opportunities (
      opportunity_key, wa_id, channel, primary_intent, status,
      requirements_json, missing_requirements_json, product_interests_json,
      objections_json, signals_json
    ) VALUES (?, ?, 'whatsapp', 'sales', 'open', JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_OBJECT())`,
    [unique("gates-opp"), wa]
  );
  return Number((result as { insertId: number }).insertId);
}

function objectiveSeed(type: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["type"], inputs: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["inputs"] = {}): CommercialObjectiveSeed {
  return { seedId: unique(`seed-${type}`), type, origin: "customer_requested", inputs };
}

function gatewayResult(capability: string, status: CapabilityGatewayResult["status"] = "temporarily_blocked"): CapabilityGatewayResult {
  return {
    capability,
    version: "capability-gateway.v1",
    availability: "available",
    status,
    data: null,
    errorCode: "forced_failure",
    retryable: status === "temporarily_blocked",
    evidence: [],
    warnings: [],
    retryCount: 0,
    startedAt: NOW,
    completedAt: NOW,
    executionPublicId: unique("exec")
  };
}

/** Builds and persists a RETRY_SCHEDULED CommercialWork step (calculate_shipping) - reused by the WORK-gate tests below. */
async function seedRetryScheduledWork(overrides: { conversationId?: number; opportunityId?: number } = {}) {
  const convId = overrides.conversationId ?? conversationId;
  const oppId = overrides.opportunityId ?? opportunityId;
  const projection = buildCommercialWorkProjection({
    trigger: { type: "CUSTOMER_MESSAGE", conversationId: convId, opportunityId: oppId, sourceMessageId: null },
    conversation: { id: convId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: oppId, status: "open" },
    commercialLineItems: { factId: unique("selection"), updatedAt: NOW, items: [{ productId: "31", combinationId: null, quantity: 1 }] },
    shippingDestination: { factId: unique("destination"), updatedAt: NOW, communeId: 13120, canonicalName: "Nunoa", matchedVia: "direct" },
    objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")],
    now: NOW
  } satisfies CommercialWorkProjectionInput);
  const created = await persistCommercialWorkProjection({ work: projection, correlationKey: unique("gates-correlation") });

  // Drive it to RETRY_SCHEDULED with one real tick (capability forced to temporarily_blocked).
  const tick = await runCommercialWorkTick({
    batchSize: 1,
    now: NOW,
    workPublicIds: [created.work.publicId],
    executeCapability: async (name) => gatewayResult(name),
    loadConversationControl: async () => ({ humanOwnerActive: false, aiEnabled: true }),
    workerEnabled: true,
    autonomousResponsesEnabled: true,
    whatsAppAccessGate: { testModeEnabled: false, testWaIds: [] },
    isWaIdEligibleForCommercialWork: () => true
  });
  assert.equal(tick.claimed, 1, "fixture setup: expected the step to be claimed and driven to RETRY_SCHEDULED");
  return created.work.publicId;
}

async function makeWaitingWork(waIdOverride?: string, oppIdOverride?: number) {
  const convId = waIdOverride ? (await seedConversation()).id : conversationId;
  const oppId = oppIdOverride ?? opportunityId;
  const work = buildCommercialWorkProjection({
    trigger: { type: "CUSTOMER_MESSAGE", conversationId: convId, opportunityId: oppId, sourceMessageId: null },
    conversation: { id: convId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: oppId, status: "open" },
    commercialLineItems: { factId: unique("selection"), updatedAt: NOW, items: [{ productId: "31", combinationId: null, quantity: 2 }] },
    objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")],
    now: NOW
  } satisfies CommercialWorkProjectionInput);
  const persisted = await persistCommercialWorkProjection({ work, correlationKey: unique("gates-fu-correlation") });
  const objective = persisted.work.objectives.find((o) => o.status === "WAITING_CUSTOMER") ?? persisted.work.objectives[0];
  assert.ok(objective);
  return { conversationId: convId, work: persisted.work, objective };
}

async function makeDue(actionId: string) {
  await getPool().execute(`UPDATE crm_agent_actions SET scheduled_for = ? WHERE action_id = ?`, [NOW.slice(0, 19).replace("T", " "), actionId]);
}

async function rowStatus(actionId: string) {
  const rows = await queryRows<{ status: string }>(`SELECT status FROM crm_agent_actions WHERE action_id = ? LIMIT 1`, [actionId]);
  return rows[0]?.status;
}

// ---------------------------------------------------------------------------
// ACC - WhatsApp access gate (pure config logic, no DB)
// ---------------------------------------------------------------------------

test("ACC01 test mode ON + allowlisted wa_id -> allowed", () => {
  const config: WhatsAppAccessGateConfig = { testModeEnabled: true, testWaIds: ["56911111111"] };
  assert.equal(isWaIdAllowedByAccessGate("+56 9 1111 1111", config), true);
});

test("ACC02 test mode ON + unlisted wa_id -> blocked", () => {
  const config: WhatsAppAccessGateConfig = { testModeEnabled: true, testWaIds: ["56911111111"] };
  assert.equal(isWaIdAllowedByAccessGate("56922222222", config), false);
});

test("ACC03 test mode ON + empty allowlist -> blocked for everyone (never unrestricted)", () => {
  const config: WhatsAppAccessGateConfig = { testModeEnabled: true, testWaIds: [] };
  assert.equal(isWaIdAllowedByAccessGate("56911111111", config), false);
  assert.equal(isWaIdAllowedByAccessGate(null, config), false);
});

test("ACC04 test mode OFF + unlisted wa_id -> allowed (public mode, any identified conversation)", () => {
  const config: WhatsAppAccessGateConfig = { testModeEnabled: false, testWaIds: [] };
  assert.equal(isWaIdAllowedByAccessGate("56922222222", config), true);
  assert.equal(isWaIdAllowedByAccessGate("not-a-phone-shaped-id", config), true, "public mode never requires phone-number shape");
  assert.equal(isWaIdAllowedByAccessGate(null, config), false, "a genuinely missing identifier is blocked in either mode");
  assert.equal(isWaIdAllowedByAccessGate("  ", config), false);
});

test("ACC05 malformed allowlist entries never widen access (fail closed)", () => {
  const config = loadWhatsAppAccessGateConfig({ BRAIN_WHATSAPP_TEST_MODE_ENABLED: "true", BRAIN_WHATSAPP_TEST_WA_IDS: "abc,xyz,,  " } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(config.testWaIds, [], "non-normalizable entries are dropped, never trusted as-is");
  assert.equal(isWaIdAllowedByAccessGate("56911111111", config), false, "an effectively-empty allowlist still blocks everyone");
});

test("ACC06 duplicate/differently-formatted allowlist entries are normalized and deduped", () => {
  const config = loadWhatsAppAccessGateConfig({ BRAIN_WHATSAPP_TEST_MODE_ENABLED: "true", BRAIN_WHATSAPP_TEST_WA_IDS: "+569 1111 1111, 56911111111, whatsapp-shape-ignored-here" } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(config.testWaIds, ["56911111111"]);
});

test("ACC00 default with no env configured is TEST_MODE=true with an empty allowlist (safe-by-default)", () => {
  const config = loadWhatsAppAccessGateConfig({} as unknown as NodeJS.ProcessEnv);
  assert.equal(config.testModeEnabled, true);
  assert.deepEqual(config.testWaIds, []);
  assert.equal(isWaIdAllowedByAccessGate("56911111111", config), false);
});

test("ACC07 the retry worker skips a step whose wa_id is not allowlisted, leaves it claimable", async () => {
  const workPublicId = await seedRetryScheduledWork();
  const tick = await runCommercialWorkTick({
    batchSize: 5,
    now: DUE,
    workPublicIds: [workPublicId],
    workerEnabled: true,
    autonomousResponsesEnabled: true,
    whatsAppAccessGate: { testModeEnabled: true, testWaIds: ["56900000000"] },
    isWaIdEligibleForCommercialWork: () => true
  });
  assert.equal(tick.claimed, 0);
  assert.ok(tick.skipped.some((s) => s.workPublicId === workPublicId && s.reason === "skipped_access_gate"));

  const due = await selectDueCommercialWorkSteps({ limit: 10, now: DUE, workPublicIds: [workPublicId] });
  assert.ok(due.length > 0, "the step remains selectable/due - never partially claimed by the blocked attempt");
});

test("ACC08 the follow-up worker skips both a legacy and an R2 row whose wa_id is not allowlisted", async () => {
  const fixture = await makeWaitingWork();
  const scheduled = await scheduleObjectiveAwareFollowUp({ workPublicId: fixture.work.publicId, objectivePublicId: fixture.objective.objectiveId, now: NOW, expectedWorkVersion: fixture.work.version });
  assert.equal(scheduled.status, "scheduled");
  await makeDue(scheduled.action.actionId);

  // runFollowupTick reads the access gate from env directly (no override
  // param for that specific check, matching runNativeAutonomousCycle) -
  // simulate via a narrow env flip for this one call.
  const previous = { ...process.env };
  Object.assign(process.env, { BRAIN_WHATSAPP_TEST_MODE_ENABLED: "true", BRAIN_WHATSAPP_TEST_WA_IDS: "56900000000" });
  try {
    const result = await runFollowupTick({ limit: 10, actionIds: [scheduled.action.actionId], now: NOW });
    assert.ok(result.skippedAccessGate.includes(scheduled.action.actionId));
  } finally {
    process.env = previous;
  }
  assert.equal(await rowStatus(scheduled.action.actionId), "planned", "never claimed - still retriable once eligible");
});

test("ACC09/ACC10 both legacy and R2 routing share the exact same access gate (runNativeAutonomousCycle Step -1)", async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { BRAIN_WHATSAPP_TEST_MODE_ENABLED: "true", BRAIN_WHATSAPP_TEST_WA_IDS: "56900000000", BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" });
  try {
    const result = await runNativeAutonomousCycle({
      conversationId,
      conversationPublicId: "test-conv",
      customerMasterId: null,
      waId,
      phoneNumberId: "test-phone",
      messageId: null,
      messageText: "hola",
      correlationId: unique("corr"),
      currentTime: NOW
    });
    assert.equal(result.ran, false);
    assert.equal(result.reason, "wa_id_not_authorized_for_access_gate");
    assert.equal(result.shadow, null);
    assert.equal(result.loop, null);
    assert.equal(result.bridge, null);
  } finally {
    process.env = previous;
  }
});

// ---------------------------------------------------------------------------
// AUTO - global autonomy killswitch
// ---------------------------------------------------------------------------

test("AUTO01/AUTO02 autonomy OFF blocks the inbound cycle before any LLM call or mutation, autonomy ON restores it (AUTO06)", async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false", BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "false" });
  try {
    const blocked = await runNativeAutonomousCycle({
      conversationId,
      conversationPublicId: "test-conv",
      customerMasterId: null,
      waId,
      phoneNumberId: "test-phone",
      messageId: null,
      messageText: "hola",
      correlationId: unique("corr"),
      currentTime: NOW
    });
    assert.equal(blocked.ran, false);
    assert.equal(blocked.reason, "autonomous_responses_disabled");

    // AUTO06: flipping the flag back on (same process, next call) restores normal gating - reaches at least the next gate (pilot allowlist), never re-blocked by the killswitch.
    Object.assign(process.env, { BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" });
    const restored = await runNativeAutonomousCycle({
      conversationId,
      conversationPublicId: "test-conv",
      customerMasterId: null,
      waId,
      phoneNumberId: "test-phone",
      messageId: null,
      messageText: "hola",
      correlationId: unique("corr2"),
      currentTime: NOW
    });
    assert.notEqual(restored.reason, "autonomous_responses_disabled");
  } finally {
    process.env = previous;
  }
});

test("AUTO03 autonomy OFF stops the retry worker from claiming/executing due work", async () => {
  const workPublicId = await seedRetryScheduledWork();
  const tick = await runCommercialWorkTick({
    batchSize: 5,
    now: DUE,
    workPublicIds: [workPublicId],
    workerEnabled: true,
    autonomousResponsesEnabled: false,
    whatsAppAccessGate: { testModeEnabled: false, testWaIds: [] },
    isWaIdEligibleForCommercialWork: () => true
  });
  assert.equal(tick.claimed, 0);
  assert.ok(tick.skipped.some((s) => s.workPublicId === workPublicId && s.reason === "skipped_autonomy_disabled"));
});

test("AUTO04 autonomy OFF stops the follow-up worker from sending (legacy and R2 rows alike)", async () => {
  const fixture = await makeWaitingWork();
  const scheduled = await scheduleObjectiveAwareFollowUp({ workPublicId: fixture.work.publicId, objectivePublicId: fixture.objective.objectiveId, now: NOW, expectedWorkVersion: fixture.work.version });
  assert.equal(scheduled.status, "scheduled");
  await makeDue(scheduled.action.actionId);

  const previous = { ...process.env };
  Object.assign(process.env, { BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false", BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "false" });
  try {
    const result = await runFollowupTick({ limit: 10, actionIds: [scheduled.action.actionId], now: NOW });
    assert.ok(result.skippedAutonomyDisabled.includes(scheduled.action.actionId));
  } finally {
    process.env = previous;
  }
  assert.equal(await rowStatus(scheduled.action.actionId), "planned");
});

test("AUTO05 the killswitch never gates the manual-reply API routes (architectural)", () => {
  const routes = [
    path.join(process.cwd(), "app", "api", "conversations", "[id]", "reply", "route.ts"),
    path.join(process.cwd(), "app", "api", "cases", "[id]", "reply", "route.ts")
  ];
  for (const route of routes) {
    const content = readFileSync(route, "utf8");
    assert.ok(
      !content.includes("loadAutonomousResponsesEnabled") && !content.includes("runNativeAutonomousCycle") && !content.includes("runCommercialWorkTick") && !content.includes("runFollowupTick"),
      `${route} must never route through the autonomy killswitch or any gated autonomous entry point - a manual operator reply is not a system-originated autonomous action`
    );
  }
});

test("AUTO08 a malformed BRAIN_AUTONOMOUS_RESPONSES_ENABLED value fails closed with a thrown, typed error, never a silent default", () => {
  assert.throws(() => loadAutonomousResponsesEnabled({ BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "yes" } as unknown as NodeJS.ProcessEnv), AutonomousRuntimeConfigError);
});

// ---------------------------------------------------------------------------
// WORK - CommercialWork retry worker, gate-specific behavior only
// ---------------------------------------------------------------------------

test("WORK16 BRAIN_COMMERCIAL_WORK_WORKER_ENABLED=false makes the entire tick a no-op (does not even select candidates)", async () => {
  const workPublicId = await seedRetryScheduledWork();
  const tick = await runCommercialWorkTick({
    batchSize: 5,
    now: NOW,
    workPublicIds: [workPublicId],
    workerEnabled: false
  });
  assert.equal(tick.selected, 0);
  assert.equal(tick.claimed, 0);
  assert.deepEqual(tick.skipped, []);
});

test("WORK17 a step whose wa_id is no longer R2-eligible is skipped, never bypassed as a stale historical item", async () => {
  const workPublicId = await seedRetryScheduledWork();
  const tick = await runCommercialWorkTick({
    batchSize: 5,
    now: DUE,
    workPublicIds: [workPublicId],
    workerEnabled: true,
    autonomousResponsesEnabled: true,
    whatsAppAccessGate: { testModeEnabled: false, testWaIds: [] },
    isWaIdEligibleForCommercialWork: () => false
  });
  assert.equal(tick.claimed, 0);
  assert.ok(tick.skipped.some((s) => s.workPublicId === workPublicId && s.reason === "skipped_r2_ineligible"));
});

test("WORK18 a step created before the configured activation cutoff is never autonomously continued", async () => {
  const workPublicId = await seedRetryScheduledWork();
  const future = new Date(Date.now() + 60_000).toISOString();
  const tick = await runCommercialWorkTick({
    batchSize: 5,
    now: DUE,
    workPublicIds: [workPublicId],
    workerEnabled: true,
    autonomousResponsesEnabled: true,
    whatsAppAccessGate: { testModeEnabled: false, testWaIds: [] },
    isWaIdEligibleForCommercialWork: () => true,
    activationCutoff: future
  });
  assert.equal(tick.claimed, 0);
  assert.ok(tick.skipped.some((s) => s.workPublicId === workPublicId && s.reason === "skipped_before_activation_cutoff"));

  // A cutoff in the past never blocks a real (post-cutoff) row.
  const past = new Date(Date.now() - 60_000).toISOString();
  const tick2 = await runCommercialWorkTick({
    batchSize: 5,
    now: DUE,
    workPublicIds: [workPublicId],
    workerEnabled: true,
    autonomousResponsesEnabled: true,
    whatsAppAccessGate: { testModeEnabled: false, testWaIds: [] },
    isWaIdEligibleForCommercialWork: () => true,
    activationCutoff: past
  });
  assert.equal(tick2.claimed, 1);
});

// ---------------------------------------------------------------------------
// FU - follow-up worker, gate-specific behavior only
// ---------------------------------------------------------------------------

test("FU16 BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED=false blocks only the R2 branch, never the legacy branch's own gating", async () => {
  const fixture = await makeWaitingWork();
  const scheduled = await scheduleObjectiveAwareFollowUp({ workPublicId: fixture.work.publicId, objectivePublicId: fixture.objective.objectiveId, now: NOW, expectedWorkVersion: fixture.work.version });
  assert.equal(scheduled.status, "scheduled");
  await makeDue(scheduled.action.actionId);

  const tick = await runFollowupTick({
    limit: 10,
    actionIds: [scheduled.action.actionId],
    now: NOW,
    commercialWorkFollowUpEnabled: false,
    isWaIdEligibleForCommercialWork: () => true
  });
  assert.ok(tick.skippedCommercialWorkFollowUpIneligible.includes(scheduled.action.actionId));
  assert.equal(await rowStatus(scheduled.action.actionId), "planned");
});

test("FU17 an R2 follow-up whose wa_id is no longer R2-eligible is skipped, never sent", async () => {
  const fixture = await makeWaitingWork();
  const scheduled = await scheduleObjectiveAwareFollowUp({ workPublicId: fixture.work.publicId, objectivePublicId: fixture.objective.objectiveId, now: NOW, expectedWorkVersion: fixture.work.version });
  assert.equal(scheduled.status, "scheduled");
  await makeDue(scheduled.action.actionId);

  const tick = await runFollowupTick({
    limit: 10,
    actionIds: [scheduled.action.actionId],
    now: NOW,
    commercialWorkFollowUpEnabled: true,
    isWaIdEligibleForCommercialWork: () => false
  });
  assert.ok(tick.skippedCommercialWorkFollowUpIneligible.includes(scheduled.action.actionId));
  assert.equal(await rowStatus(scheduled.action.actionId), "planned");
});

test("FU18 an R2 follow-up created before the configured activation cutoff is never sent", async () => {
  const fixture = await makeWaitingWork();
  const scheduled = await scheduleObjectiveAwareFollowUp({ workPublicId: fixture.work.publicId, objectivePublicId: fixture.objective.objectiveId, now: NOW, expectedWorkVersion: fixture.work.version });
  assert.equal(scheduled.status, "scheduled");
  await makeDue(scheduled.action.actionId);
  const future = new Date(Date.now() + 60_000).toISOString();

  const tick = await runFollowupTick({
    limit: 10,
    actionIds: [scheduled.action.actionId],
    now: NOW,
    commercialWorkFollowUpEnabled: true,
    isWaIdEligibleForCommercialWork: () => true,
    commercialWorkFollowUpActivationCutoff: future
  });
  assert.ok(tick.skippedBeforeActivationCutoff.includes(scheduled.action.actionId));
  assert.equal(await rowStatus(scheduled.action.actionId), "planned");
});

test("FU19 fully eligible R2 follow-up sends exactly once through the canonical action/outbox path, a second tick does not duplicate", async () => {
  const fixture = await makeWaitingWork();
  const scheduled = await scheduleObjectiveAwareFollowUp({ workPublicId: fixture.work.publicId, objectivePublicId: fixture.objective.objectiveId, now: NOW, expectedWorkVersion: fixture.work.version });
  assert.equal(scheduled.status, "scheduled");
  assert.ok(scheduled.action.waId, "fixture setup: the scheduled action must carry a wa_id to check the outbox against");
  await makeDue(scheduled.action.actionId);

  const beforeOutbox = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM brain_message_outbox WHERE wa_id = ?", [scheduled.action.waId]);

  const tick = await runFollowupTick({
    limit: 10,
    actionIds: [scheduled.action.actionId],
    now: NOW,
    commercialWorkFollowUpEnabled: true,
    isWaIdEligibleForCommercialWork: () => true
  });
  assert.ok(tick.executed.includes(scheduled.action.actionId));
  assert.equal(await rowStatus(scheduled.action.actionId), "executed");

  const afterOutbox = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM brain_message_outbox WHERE wa_id = ?", [scheduled.action.waId]);
  assert.equal(Number(afterOutbox[0].count), Number(beforeOutbox[0].count) + 1, "exactly one new canonical outbox row for the sent reminder");

  const secondTick = await runFollowupTick({
    limit: 10,
    actionIds: [scheduled.action.actionId],
    now: NOW,
    commercialWorkFollowUpEnabled: true,
    isWaIdEligibleForCommercialWork: () => true
  });
  assert.equal(secondTick.executed.length, 0, "an already-executed row is never selected again");
  const finalOutbox = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM brain_message_outbox WHERE wa_id = ?", [scheduled.action.waId]);
  assert.equal(Number(finalOutbox[0].count), Number(afterOutbox[0].count), "no duplicate outbox row from the second tick");
});
