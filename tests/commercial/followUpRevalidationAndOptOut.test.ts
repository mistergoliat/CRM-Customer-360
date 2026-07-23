import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows, safeExecute, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { runFollowupTick, revalidateFollowUpConfiguration, type FollowUpCandidate } from "@/lib/brain/commercial/followup/runFollowupTick";
import { detectExplicitOptOutCommand, isCustomerOptedOut, recordCustomerOptOut } from "@/lib/brain/commercial/optOutStore";
import {
  archiveConfiguration,
  createDraftConfiguration,
  loadPublishedPesasChileConfiguration,
  publishDraftConfiguration,
  type SalesAgentFollowUpConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";
import { SALES_AGENT_CONFIGURATION_TABLE } from "@/lib/brain/commercial/sales-agent-configuration/constants";
import type { runNativeAutonomousCycle, NativeAutonomousCycleResult } from "@/lib/brain/commercial/native-cycle";

// Real MariaDB, real crm_test - same convention as runFollowupTick.test.ts /
// followUpSequenceContinuity.test.ts.
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
  BRAIN_META_SEND_ENABLED: "false",
  BRAIN_OUTBOX_WORKER_ENABLED: "false",
  BRAIN_PERSIST_CANONICAL_OUTBOUND: "true",
  BRAIN_SALES_AGENT_ENABLED: "false",
  BRAIN_COMMERCIAL_SHADOW_ENABLED: "false",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

const fakeCycleRunner: typeof runNativeAutonomousCycle = async (): Promise<NativeAutonomousCycleResult> => ({
  ran: true,
  shadow: null,
  loop: null,
  bridge: null,
  warnings: []
});

async function seedConversation(): Promise<{ id: number; publicId: string; waId: string }> {
  const waId = `5699${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("revalidation-seed")}`,
    phoneNumberId: `phone-${uniqueSuffix("pnid")}`,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Revalidation Test",
    messageType: "text",
    text: "Hola",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.equal(result.duplicate, false);
  return { id: result.conversationId as number, publicId: result.conversationPublicId as string, waId };
}

async function seedOpportunity(waId: string, createdAt?: Date): Promise<void> {
  const opportunityKey = `test-revalidation-${uniqueSuffix("opp")}`;
  await queryRows(
    `INSERT INTO crm_opportunities (
        opportunity_key, wa_id, channel, primary_intent, status, stage,
        requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json, created_at
      ) VALUES (?, ?, 'whatsapp', 'product_inquiry', 'engaged', 'recommendation', '[]', '[]', '[]', '[]', '[]', ?)`,
    [opportunityKey, waId, (createdAt ?? new Date()).toISOString().slice(0, 19).replace("T", " ")]
  );
}

async function scheduleFollowUpAction(input: {
  conversationId: number;
  waId: string;
  scheduledFor?: Date;
  attemptNumber?: number;
  maxAttempts?: number;
  followUpConfigurationSource?: string | null;
}): Promise<string> {
  const actionId = `action-${uniqueSuffix("followup")}`;
  const scheduledFor = input.scheduledFor ?? new Date(Date.now() - 60_000);
  const createdAt = new Date(Date.now() + 2000);
  const insert = await safeExecute(
    `INSERT INTO crm_agent_actions (
        action_id, idempotency_key, conversation_case_id, wa_id, channel,
        action_type, status, draft_message, scheduled_for, attempt_number, max_attempts,
        followup_configuration_source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'whatsapp', 'schedule_followup', 'planned', ?, ?, ?, ?, ?, ?, ?)`,
    [
      actionId,
      actionId,
      input.conversationId,
      input.waId,
      "¿Seguimos con tu cotización?",
      scheduledFor.toISOString().slice(0, 19).replace("T", " "),
      input.attemptNumber ?? 1,
      input.maxAttempts ?? 3,
      input.followUpConfigurationSource ?? null,
      createdAt.toISOString().slice(0, 19).replace("T", " "),
      createdAt.toISOString().slice(0, 19).replace("T", " ")
    ]
  );
  assert.ok(insert.ok, insert.ok ? "" : insert.error);
  return actionId;
}

async function loadAction(actionId: string) {
  const result = await safeQueryRows<{ status: string; cancel_reason: string | null; failure_reason: string | null; scheduled_for: string | null }>(
    "SELECT status, cancel_reason, failure_reason, scheduled_for FROM crm_agent_actions WHERE action_id = ? LIMIT 1",
    [actionId]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows[0] ?? null;
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
    name: `revalidation-${uniqueSuffix("cfg")}`,
    configuration: { ...PROMPT_FIELDS, followUpConfiguration },
    createdBy: "test-suite"
  });
  return publishDraftConfiguration({ id: draft.id });
}

const ENABLED_CONFIG: SalesAgentFollowUpConfiguration = {
  enabled: true,
  maxAttempts: 3,
  attemptDelaysMinutes: [60, 1440, 4320],
  allowedWindow: { timezone: "America/Santiago", startHour: 9, endHour: 19, allowedWeekdays: [1, 2, 3, 4, 5] },
  maxOpportunityAgeDays: 30
};

function buildCandidate(overrides: Partial<FollowUpCandidate> & { wa_id: string }): FollowUpCandidate {
  return {
    id: 0,
    action_id: `candidate-${uniqueSuffix("id")}`,
    conversation_case_id: null,
    scheduled_for: null,
    draft_message: null,
    status: "executing",
    attempt_number: 1,
    max_attempts: 3,
    followup_configuration_source: "published",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// optOutStore - detectExplicitOptOutCommand (decision 11)
// ---------------------------------------------------------------------------

test("[OO1] detectExplicitOptOutCommand recognizes explicit unsubscribe commands, case/accent/punctuation-insensitive", () => {
  assert.equal(detectExplicitOptOutCommand("STOP"), true);
  assert.equal(detectExplicitOptOutCommand("stop"), true);
  assert.equal(detectExplicitOptOutCommand("Baja!"), true);
  assert.equal(detectExplicitOptOutCommand("Cancelar Suscripción"), true);
  assert.equal(detectExplicitOptOutCommand("  date de baja  "), true);
  assert.equal(detectExplicitOptOutCommand("NO ME ESCRIBAS MAS."), true);
});

test("[OO2] detectExplicitOptOutCommand never treats an ordinary commercial objection as an opt-out", () => {
  assert.equal(detectExplicitOptOutCommand("no"), false);
  assert.equal(detectExplicitOptOutCommand("No gracias"), false);
  assert.equal(detectExplicitOptOutCommand("no me interesa"), false);
  assert.equal(detectExplicitOptOutCommand("no por ahora"), false);
  assert.equal(detectExplicitOptOutCommand("¿cuánto cuesta el envío?"), false);
  assert.equal(detectExplicitOptOutCommand(""), false);
  assert.equal(detectExplicitOptOutCommand("   "), false);
});

// ---------------------------------------------------------------------------
// optOutStore - recordCustomerOptOut / isCustomerOptedOut (decision 11)
// ---------------------------------------------------------------------------

test("[OO3] recordCustomerOptOut then isCustomerOptedOut reports true; an unrelated wa_id stays false", async () => {
  const waId = `569${uniqueSuffix("oo3")}`.slice(0, 20);
  assert.equal(await isCustomerOptedOut(waId), false);
  const record = await recordCustomerOptOut({ waId, reason: "explicit_customer_command" });
  assert.equal(record.ok, true);
  assert.equal(await isCustomerOptedOut(waId), true);
  assert.equal(await isCustomerOptedOut(`different-${waId}`), false);
});

test("[OO4] recordCustomerOptOut is idempotent - recording the same wa_id twice never errors and stays one opt-out", async () => {
  const waId = `569${uniqueSuffix("oo4")}`.slice(0, 20);
  const first = await recordCustomerOptOut({ waId, reason: "explicit_customer_command" });
  const second = await recordCustomerOptOut({ waId, reason: "explicit_customer_command" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const rows = await queryRows<{ count: number }>("SELECT COUNT(*) as count FROM crm_customer_opt_outs WHERE wa_id = ?", [waId]);
  assert.equal(Number(rows[0].count), 1);
});

// ---------------------------------------------------------------------------
// revalidateFollowUpConfiguration (decision 13)
// ---------------------------------------------------------------------------

test("[RV1] revalidateFollowUpConfiguration cancels when the CURRENT published config is disabled, even if it was enabled at scheduling time", async () => {
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, enabled: false });
  const result = await revalidateFollowUpConfiguration(buildCandidate({ wa_id: `569${uniqueSuffix("rv1")}`.slice(0, 20) }));
  assert.deepEqual(result, { outcome: "cancel", reason: "follow_up_disabled" });
});

test("[RV2] revalidateFollowUpConfiguration cancels when the row's attempt_number exceeds the CURRENT config's maxAttempts", async () => {
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, maxAttempts: 1, attemptDelaysMinutes: [60] });
  const result = await revalidateFollowUpConfiguration(
    buildCandidate({ wa_id: `569${uniqueSuffix("rv2")}`.slice(0, 20), attempt_number: 2 })
  );
  assert.deepEqual(result, { outcome: "cancel", reason: "max_attempts_reached" });
});

test("[RV3] revalidateFollowUpConfiguration cancels when the opportunity is older than the CURRENT config's maxOpportunityAgeDays", async () => {
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, maxOpportunityAgeDays: 5 });
  const waId = `569${uniqueSuffix("rv3")}`.slice(0, 20);
  const oldCreatedAt = new Date(Date.now() - 30 * 86_400_000);
  await seedOpportunity(waId, oldCreatedAt);
  const result = await revalidateFollowUpConfiguration(buildCandidate({ wa_id: waId }));
  assert.deepEqual(result, { outcome: "cancel", reason: "opportunity_too_old" });
});

test("[RV4] revalidateFollowUpConfiguration proceeds when the opportunity is within the CURRENT config's maxOpportunityAgeDays", async () => {
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, maxOpportunityAgeDays: 30 });
  const waId = `569${uniqueSuffix("rv4")}`.slice(0, 20);
  await seedOpportunity(waId, new Date());
  const result = await revalidateFollowUpConfiguration(buildCandidate({ wa_id: waId }), "2026-03-02T14:00:00.000Z"); // Monday, inside the window
  assert.deepEqual(result, { outcome: "proceed" });
});

test("[RV5] revalidateFollowUpConfiguration reschedules (never cancels) when due outside the CURRENT allowed window", async () => {
  await publishFollowUpConfiguration(ENABLED_CONFIG); // 09:00-19:00 Mon-Fri America/Santiago
  const waId = `569${uniqueSuffix("rv5")}`.slice(0, 20);
  const now = "2026-03-07T14:00:00.000Z"; // Saturday, always outside the Mon-Fri window
  const result = await revalidateFollowUpConfiguration(buildCandidate({ wa_id: waId }), now);
  assert.equal(result.outcome, "reschedule");
  if (result.outcome === "reschedule") {
    assert.equal(result.reason, "outside_allowed_window");
    assert.ok(new Date(result.scheduledFor).getTime() >= new Date(now).getTime(), "must never move earlier than now");
  }
});

test("[RV6] revalidateFollowUpConfiguration is a technical_failure (never a cancel) when the published row is structurally corrupted", async () => {
  const published = await publishFollowUpConfiguration(ENABLED_CONFIG);
  try {
    await queryRows(`UPDATE ${SALES_AGENT_CONFIGURATION_TABLE} SET configuration_json = ? WHERE id = ?`, [JSON.stringify({}), published.id]);
    const result = await revalidateFollowUpConfiguration(buildCandidate({ wa_id: `569${uniqueSuffix("rv6")}`.slice(0, 20) }));
    assert.deepEqual(result, { outcome: "technical_failure", reason: "configuration_unavailable" });
  } finally {
    await queryRows(`UPDATE ${SALES_AGENT_CONFIGURATION_TABLE} SET configuration_json = ? WHERE id = ?`, [
      JSON.stringify(published.configuration),
      published.id
    ]);
  }
});

// ---------------------------------------------------------------------------
// runFollowupTick integration - opt-out gate + config-aware revalidation (decisions 11/13)
// ---------------------------------------------------------------------------

test("[RT1] a customer with a recorded opt-out never gets the follow-up executed, even though everything else qualifies", async () => {
  await publishFollowUpConfiguration(ENABLED_CONFIG);
  const conversation = await seedConversation();
  await recordCustomerOptOut({ waId: conversation.waId, reason: "explicit_customer_command" });
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId, followUpConfigurationSource: "published" });

  let calls = 0;
  const cycleRunner: typeof runNativeAutonomousCycle = async (...args) => {
    calls += 1;
    return fakeCycleRunner(...args);
  };

  const tick = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner });
  assert.equal(calls, 0, "the cycle runner must never be invoked for an opted-out customer");
  assert.ok(tick.cancelled.some((c) => c.actionId === actionId && c.reason === "customer_opted_out"));
  const row = await loadAction(actionId);
  assert.equal(row?.status, "cancelled");
  assert.equal(row?.cancel_reason, "customer_opted_out");
});

test("[RT2] a config-sourced row is cancelled when the CURRENT published config has since been disabled", async () => {
  await publishFollowUpConfiguration(ENABLED_CONFIG);
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId, followUpConfigurationSource: "published" });

  // The config changes AFTER scheduling, before the tick revalidates it.
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, enabled: false });

  let calls = 0;
  const cycleRunner: typeof runNativeAutonomousCycle = async (...args) => {
    calls += 1;
    return fakeCycleRunner(...args);
  };
  const tick = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner });
  assert.equal(calls, 0);
  assert.ok(tick.cancelled.some((c) => c.actionId === actionId && c.reason === "follow_up_disabled"));
});

test("[RT3] a legacy/unsourced row (followup_configuration_source = NULL) is never revalidated against config - it keeps executing even while the published config is disabled", async () => {
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, enabled: false });
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId, followUpConfigurationSource: null });

  let calls = 0;
  const cycleRunner: typeof runNativeAutonomousCycle = async (...args) => {
    calls += 1;
    return fakeCycleRunner(...args);
  };
  const tick = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner });
  assert.equal(calls, 1, "an unsourced row must run exactly like pre-T02.3D behavior, ignoring the (disabled) published config");
  assert.deepEqual(tick.executed, [actionId]);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "executed");
});

/** The current weekday in America/Santiago, 0=Sunday..6=Saturday - same convention as SalesAgentFollowUpConfiguration.allowedWindow.allowedWeekdays. */
function currentSantiagoWeekday(): number {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", weekday: "short" }).format(new Date());
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[label] ?? 1;
}

test("[RT4] a config-sourced row due outside the CURRENT allowed window is rescheduled, never executed or cancelled", async () => {
  // A single allowed weekday that deliberately excludes today (America/Santiago) -
  // "now" is therefore always outside the window, deterministically,
  // regardless of when this test actually runs.
  const excludedToday = (currentSantiagoWeekday() + 1) % 7;
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, allowedWindow: { ...ENABLED_CONFIG.allowedWindow, allowedWeekdays: [excludedToday] } });
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId, followUpConfigurationSource: "published" });

  let calls = 0;
  const cycleRunner: typeof runNativeAutonomousCycle = async (...args) => {
    calls += 1;
    return fakeCycleRunner(...args);
  };
  const tick = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner });
  assert.equal(calls, 0, "the cycle runner must never be invoked while outside the allowed window");
  assert.ok(tick.rescheduled.some((r) => r.actionId === actionId));
  const row = await loadAction(actionId);
  assert.equal(row?.status, "planned");
  assert.ok(row?.scheduled_for, "a rescheduled row must carry a real, non-null scheduled_for");
});
