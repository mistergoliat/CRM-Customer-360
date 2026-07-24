import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows, resetPoolForTests, safeExecute, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { runFollowupTick, revalidateFollowUpConfiguration, type FollowUpCandidate } from "@/lib/brain/commercial/followup/runFollowupTick";
import {
  checkCustomerOptOutStatus,
  detectExplicitOptInCommand,
  detectExplicitOptOutCommand,
  recordCustomerOptIn,
  recordCustomerOptOut
} from "@/lib/brain/commercial/optOutStore";
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

function uniqueWaId(label: string) {
  return `569${uniqueSuffix(label)}`.slice(0, 20);
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

/** Returns the seeded crm_opportunities.id - the canonical identity revalidateFollowUpConfiguration's age check now reads. */
async function seedOpportunity(waId: string, createdAt?: Date, conversationCaseId?: number | null): Promise<number> {
  const opportunityKey = `test-revalidation-${uniqueSuffix("opp")}`;
  await queryRows(
    `INSERT INTO crm_opportunities (
        opportunity_key, wa_id, channel, primary_intent, status, stage,
        requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json, created_at, conversation_case_id
      ) VALUES (?, ?, 'whatsapp', 'product_inquiry', 'engaged', 'recommendation', '[]', '[]', '[]', '[]', '[]', ?, ?)`,
    [
      opportunityKey,
      waId,
      (createdAt ?? new Date()).toISOString().slice(0, 19).replace("T", " "),
      conversationCaseId !== undefined && conversationCaseId !== null ? String(conversationCaseId) : null
    ]
  );
  const row = await safeQueryRows<{ id: number }>("SELECT id FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1", [opportunityKey]);
  assert.ok(row.ok && row.rows[0]?.id, row.ok ? "missing seeded opportunity id" : row.error);
  return row.rows[0]!.id;
}

async function scheduleFollowUpAction(input: {
  conversationId: number;
  waId: string;
  scheduledFor?: Date;
  attemptNumber?: number;
  maxAttempts?: number;
  followUpConfigurationSource?: string | null;
  opportunityId?: number | null;
}): Promise<string> {
  const actionId = `action-${uniqueSuffix("followup")}`;
  const scheduledFor = input.scheduledFor ?? new Date(Date.now() - 60_000);
  const createdAt = new Date(Date.now() + 2000);
  const insert = await safeExecute(
    `INSERT INTO crm_agent_actions (
        action_id, idempotency_key, conversation_case_id, wa_id, opportunity_id, channel,
        action_type, status, draft_message, scheduled_for, attempt_number, max_attempts,
        followup_configuration_source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'whatsapp', 'schedule_followup', 'planned', ?, ?, ?, ?, ?, ?, ?)`,
    [
      actionId,
      actionId,
      input.conversationId,
      input.waId,
      input.opportunityId ?? null,
      "Seguimos con tu cotizacion?",
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
  const result = await safeQueryRows<{
    status: string;
    cancel_reason: string | null;
    failure_reason: string | null;
    scheduled_for: string | null;
    attempt_number: number;
  }>("SELECT status, cancel_reason, failure_reason, scheduled_for, attempt_number FROM crm_agent_actions WHERE action_id = ? LIMIT 1", [actionId]);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows[0] ?? null;
}

async function forceActionDueNow(actionId: string): Promise<void> {
  const result = await safeExecute(`UPDATE crm_agent_actions SET scheduled_for = ? WHERE action_id = ?`, [
    new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace("T", " "),
    actionId
  ]);
  assert.ok(result.ok, result.ok ? "" : result.error);
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
    opportunity_id: null,
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
// optOutStore - detectExplicitOptOutCommand / detectExplicitOptInCommand (decision 11)
// ---------------------------------------------------------------------------

test("[OO1] detectExplicitOptOutCommand recognizes explicit unsubscribe commands, case/accent/punctuation-insensitive", () => {
  assert.equal(detectExplicitOptOutCommand("STOP"), true);
  assert.equal(detectExplicitOptOutCommand("stop"), true);
  assert.equal(detectExplicitOptOutCommand("Baja!"), true);
  assert.equal(detectExplicitOptOutCommand("Cancelar Suscripción"), true);
  assert.equal(detectExplicitOptOutCommand("  date de baja  "), true);
  assert.equal(detectExplicitOptOutCommand("NO ME ESCRIBAS MAS."), true);
  assert.equal(detectExplicitOptOutCommand("¡No quiero más mensajes!"), true);
  assert.equal(detectExplicitOptOutCommand("bórrame de la lista"), true);
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

test("[OO7] detectExplicitOptInCommand recognizes explicit re-subscribe commands, case/accent-insensitive", () => {
  assert.equal(detectExplicitOptInCommand("START"), true);
  assert.equal(detectExplicitOptInCommand("si"), true);
  assert.equal(detectExplicitOptInCommand("Si quiero"), true);
  assert.equal(detectExplicitOptInCommand("Reactivar"), true);
  assert.equal(detectExplicitOptInCommand("quiero suscribirme de nuevo"), true);
});

test("[OO8] detectExplicitOptInCommand never matches an unrelated message", () => {
  assert.equal(detectExplicitOptInCommand("hola"), false);
  assert.equal(detectExplicitOptInCommand("cuanto cuesta"), false);
  assert.equal(detectExplicitOptInCommand(""), false);
});

// ---------------------------------------------------------------------------
// optOutStore - checkCustomerOptOutStatus / recordCustomerOptOut / recordCustomerOptIn (decision 11)
// ---------------------------------------------------------------------------

test("[OO3] recordCustomerOptOut then checkCustomerOptOutStatus reports opted_out; an unrelated wa_id stays not_opted_out", async () => {
  const waId = uniqueWaId("oo3");
  assert.equal(await checkCustomerOptOutStatus(waId), "not_opted_out");
  const record = await recordCustomerOptOut({ waId, reason: "explicit_customer_command" });
  assert.equal(record.ok, true);
  assert.equal(await checkCustomerOptOutStatus(waId), "opted_out");
  assert.equal(await checkCustomerOptOutStatus(`different-${waId}`), "not_opted_out");
});

test("[OO4] recordCustomerOptOut is idempotent - recording the same wa_id twice never errors and stays one opt-out row", async () => {
  const waId = uniqueWaId("oo4");
  const first = await recordCustomerOptOut({ waId, reason: "explicit_customer_command" });
  const second = await recordCustomerOptOut({ waId, reason: "explicit_customer_command" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const rows = await queryRows<{ count: number }>("SELECT COUNT(*) as count FROM crm_customer_opt_outs WHERE wa_id = ?", [waId]);
  assert.equal(Number(rows[0].count), 1);
});

test("[OO6] recordCustomerOptIn durably reverses an opt-out and is audited", async () => {
  const waId = uniqueWaId("ooin");
  await recordCustomerOptOut({ waId, reason: "explicit_customer_command" });
  assert.equal(await checkCustomerOptOutStatus(waId), "opted_out");

  const result = await recordCustomerOptIn({ waId, reason: "explicit_customer_command" });
  assert.equal(result.ok, true);
  assert.equal(await checkCustomerOptOutStatus(waId), "not_opted_out");

  const auditRows = await queryRows<{ id: number }>(
    "SELECT id FROM hub_audit_log WHERE action = 'customer_opt_in.recorded' AND entity_id = ? ORDER BY id DESC LIMIT 1",
    [waId]
  );
  assert.equal(auditRows.length, 1);
});

test("[OO9] recordCustomerOptOut immediately and idempotently cancels an already-scheduled pending follow-up, without waiting for a worker tick", async () => {
  await publishFollowUpConfiguration(ENABLED_CONFIG);
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId, followUpConfigurationSource: "published" });

  const first = await recordCustomerOptOut({ waId: conversation.waId, reason: "explicit_customer_command" });
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.cancelledFollowUps, 1);

  const row = await loadAction(actionId);
  assert.equal(row?.status, "cancelled");
  assert.equal(row?.cancel_reason, "customer_opted_out");

  const second = await recordCustomerOptOut({ waId: conversation.waId, reason: "explicit_customer_command" });
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.cancelledFollowUps, 0, "a second registration finds nothing left pending - idempotent, never an error");
});

test("[OO10] recordCustomerOptOut audits both the registration and the pending-follow-up cancellation", async () => {
  await publishFollowUpConfiguration(ENABLED_CONFIG);
  const conversation = await seedConversation();
  await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId, followUpConfigurationSource: "published" });

  await recordCustomerOptOut({ waId: conversation.waId, reason: "explicit_customer_command" });

  const recordedAudit = await queryRows<{ id: number }>(
    "SELECT id FROM hub_audit_log WHERE action = 'customer_opt_out.recorded' AND entity_id = ? ORDER BY id DESC LIMIT 1",
    [conversation.waId]
  );
  assert.equal(recordedAudit.length, 1);

  const cancelledAudit = await queryRows<{ id: number }>(
    "SELECT id FROM hub_audit_log WHERE action = 'customer_opt_out.pending_followups_cancelled' AND entity_id = ? ORDER BY id DESC LIMIT 1",
    [conversation.waId]
  );
  assert.equal(cancelledAudit.length, 1);
});

// ---------------------------------------------------------------------------
// revalidateFollowUpConfiguration (decision 13)
// ---------------------------------------------------------------------------

test("[RV1] revalidateFollowUpConfiguration cancels when the CURRENT published config is disabled, even if it was enabled at scheduling time", async () => {
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, enabled: false });
  const result = await revalidateFollowUpConfiguration(buildCandidate({ wa_id: uniqueWaId("rv1") }));
  assert.deepEqual(result, { outcome: "cancel", reason: "follow_up_disabled" });
});

test("[RV2] revalidateFollowUpConfiguration cancels when the row's attempt_number exceeds the CURRENT config's maxAttempts", async () => {
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, maxAttempts: 1, attemptDelaysMinutes: [60] });
  const result = await revalidateFollowUpConfiguration(buildCandidate({ wa_id: uniqueWaId("rv2"), attempt_number: 2 }));
  assert.deepEqual(result, { outcome: "cancel", reason: "max_attempts_reached" });
});

test("[RV3] revalidateFollowUpConfiguration cancels when the OPPORTUNITY (by opportunity_id) is older than the CURRENT config's maxOpportunityAgeDays", async () => {
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, maxOpportunityAgeDays: 5 });
  const waId = uniqueWaId("rv3");
  const oldCreatedAt = new Date(Date.now() - 30 * 86_400_000);
  const opportunityId = await seedOpportunity(waId, oldCreatedAt);
  const result = await revalidateFollowUpConfiguration(buildCandidate({ wa_id: waId, opportunity_id: opportunityId }));
  assert.deepEqual(result, { outcome: "cancel", reason: "opportunity_too_old" });
});

test("[RV4] revalidateFollowUpConfiguration proceeds when the OPPORTUNITY (by opportunity_id) is within the CURRENT config's maxOpportunityAgeDays", async () => {
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, maxOpportunityAgeDays: 30 });
  const waId = uniqueWaId("rv4");
  const opportunityId = await seedOpportunity(waId, new Date());
  const result = await revalidateFollowUpConfiguration(buildCandidate({ wa_id: waId, opportunity_id: opportunityId }), "2026-03-02T14:00:00.000Z"); // Monday, inside the window
  assert.deepEqual(result, { outcome: "proceed" });
});

test("[RV7] the age check falls back to conversation_case_id ONLY when it resolves to EXACTLY one opportunity", async () => {
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, maxOpportunityAgeDays: 5 });
  const conversationCaseId = Number(`${Date.now()}`.slice(-7)) * 10 + 1;
  const oldCreatedAt = new Date(Date.now() - 30 * 86_400_000);
  await seedOpportunity(uniqueWaId("rv7a"), oldCreatedAt, conversationCaseId);

  const result = await revalidateFollowUpConfiguration(
    buildCandidate({ wa_id: uniqueWaId("rv7b"), opportunity_id: null, conversation_case_id: conversationCaseId })
  );
  assert.deepEqual(result, { outcome: "cancel", reason: "opportunity_too_old" });
});

test("[RV8] the age check is skipped (never guesses) when conversation_case_id matches MULTIPLE opportunities - proceeds instead of blocking on ambiguous data", async () => {
  await publishFollowUpConfiguration({ ...ENABLED_CONFIG, maxOpportunityAgeDays: 5 });
  const conversationCaseId = Number(`${Date.now()}`.slice(-7)) * 10 + 2;
  const oldCreatedAt = new Date(Date.now() - 30 * 86_400_000);
  await seedOpportunity(uniqueWaId("rv8a"), oldCreatedAt, conversationCaseId);
  await seedOpportunity(uniqueWaId("rv8b"), oldCreatedAt, conversationCaseId);

  const result = await revalidateFollowUpConfiguration(
    buildCandidate({ wa_id: uniqueWaId("rv8c"), opportunity_id: null, conversation_case_id: conversationCaseId }),
    "2026-03-02T14:00:00.000Z"
  );
  assert.deepEqual(result, { outcome: "proceed" }, "ambiguous conversation_case_id must never be guessed - the age check is skipped, not applied");
});

test("[RV5] revalidateFollowUpConfiguration reschedules (never cancels) when due outside the CURRENT allowed window", async () => {
  await publishFollowUpConfiguration(ENABLED_CONFIG); // 09:00-19:00 Mon-Fri America/Santiago
  const waId = uniqueWaId("rv5");
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
    const result = await revalidateFollowUpConfiguration(buildCandidate({ wa_id: uniqueWaId("rv6") }));
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
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId, followUpConfigurationSource: "published" });
  // Recorded AFTER scheduling, so recordCustomerOptOut's own immediate
  // cancellation (see [OO9]) does not pre-empt the worker path this test
  // exercises - both paths are real and independently tested.
  await recordCustomerOptOut({ waId: conversation.waId, reason: "explicit_customer_command" });

  let calls = 0;
  const cycleRunner: typeof runNativeAutonomousCycle = async (...args) => {
    calls += 1;
    return fakeCycleRunner(...args);
  };

  const tick = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner });
  assert.equal(calls, 0, "the cycle runner must never be invoked for an opted-out customer");
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

// ---------------------------------------------------------------------------
// Technical failures never consume a commercial attempt (review correction)
// ---------------------------------------------------------------------------

test("[TF1] three consecutive technical failures (corrupted config) never consume an attempt or invoke the cycle runner", async () => {
  const published = await publishFollowUpConfiguration(ENABLED_CONFIG);
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId, followUpConfigurationSource: "published" });

  await queryRows(`UPDATE ${SALES_AGENT_CONFIGURATION_TABLE} SET configuration_json = ? WHERE id = ?`, [JSON.stringify({}), published.id]);
  try {
    let calls = 0;
    const cycleRunner: typeof runNativeAutonomousCycle = async (...args) => {
      calls += 1;
      return fakeCycleRunner(...args);
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const tick = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner });
      assert.ok(tick.technicalFailures.some((t) => t.actionId === actionId), `tick ${attempt + 1} must report a technical failure`);
      const row = await loadAction(actionId);
      assert.equal(row?.status, "planned");
      assert.equal(row?.attempt_number, 1, `attempt_number must stay 1 after technical failure #${attempt + 1}`);
      await forceActionDueNow(actionId);
    }
    assert.equal(calls, 0, "the cycle runner must never be invoked across any of the three technical failures");

    const finalRow = await loadAction(actionId);
    assert.equal(finalRow?.attempt_number, 1, "attempt_number must never advance across repeated technical failures");
  } finally {
    await queryRows(`UPDATE ${SALES_AGENT_CONFIGURATION_TABLE} SET configuration_json = ? WHERE id = ?`, [
      JSON.stringify(published.configuration),
      published.id
    ]);
  }
});

test("[TF2] a technical failure during a RETRY claim reverts the claim's own attempt_number bump - never left at the bumped value", async () => {
  const published = await publishFollowUpConfiguration(ENABLED_CONFIG);
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({
    conversationId: conversation.id,
    waId: conversation.waId,
    followUpConfigurationSource: "published",
    attemptNumber: 1,
    maxAttempts: 3
  });
  // Move it into a real 'failed, retryable' state via raw SQL (mirrors
  // runFollowupTick.test.ts's setActionState convention) - claimFailedFollowUpRetry
  // will bump attempt_number 1 -> 2 as part of winning the claim.
  await safeExecute(`UPDATE crm_agent_actions SET status = 'failed' WHERE action_id = ?`, [actionId]);

  await queryRows(`UPDATE ${SALES_AGENT_CONFIGURATION_TABLE} SET configuration_json = ? WHERE id = ?`, [JSON.stringify({}), published.id]);
  try {
    let calls = 0;
    const cycleRunner: typeof runNativeAutonomousCycle = async (...args) => {
      calls += 1;
      return fakeCycleRunner(...args);
    };
    const tick = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner });
    assert.equal(calls, 0);
    assert.ok(tick.technicalFailures.some((t) => t.actionId === actionId));
    const row = await loadAction(actionId);
    assert.equal(row?.status, "planned");
    assert.equal(row?.attempt_number, 1, "the claim's own +1 bump (retry) must be reverted by the technical-failure backoff, never left advanced");
  } finally {
    await queryRows(`UPDATE ${SALES_AGENT_CONFIGURATION_TABLE} SET configuration_json = ? WHERE id = ?`, [
      JSON.stringify(published.configuration),
      published.id
    ]);
  }
});

test("[TF3] a customer opt-out status check failure (DB unavailable) is a technical failure, never a business cancellation - never consumes an attempt or invokes the model", async () => {
  await publishFollowUpConfiguration(ENABLED_CONFIG);
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId, followUpConfigurationSource: "published" });

  let calls = 0;
  const cycleRunner: typeof runNativeAutonomousCycle = async (...args) => {
    calls += 1;
    return fakeCycleRunner(...args);
  };

  // Breaking the DB connection BEFORE the tick would also break
  // selectDueFollowUps/the claim itself (nothing to revalidate at all) -
  // onAfterClaim fires right after the real claim CAS succeeds against the
  // real crm_test, isolating the failure to the opt-out check that follows
  // it, exactly like production (a real, transient DB error on THAT one
  // read, not a total outage).
  const originalDbName = process.env.DB_NAME;
  const tick = await runFollowupTick({
    limit: 10,
    actionIds: [actionId],
    cycleRunner,
    onAfterClaim: async () => {
      await resetPoolForTests();
      process.env.DB_NAME = "crm_test_nonexistent_for_tf3";
    }
  });
  // Restored immediately after the tick returns - the technical-failure
  // recovery write itself (applyTechnicalFailureBackoff) ran against the
  // still-broken connection too in this scenario, so it may not have
  // persisted; what matters (and is real, not skipped) is that the cycle
  // runner was never invoked and the outcome was correctly classified as a
  // technical failure, never a silent "proceed as if not opted out".
  process.env.DB_NAME = originalDbName;
  await resetPoolForTests();

  assert.equal(calls, 0, "the cycle runner must never be invoked when opt-out status is unavailable");
  assert.ok(tick.technicalFailures.some((t) => t.actionId === actionId && t.reason === "opt_out_status_unavailable"));

  const row = await loadAction(actionId);
  assert.notEqual(row?.status, "executed", "must never execute when opt-out status could not be determined");
  assert.notEqual(row?.attempt_number, 2, "must never advance attempt_number when opt-out status could not be determined");
});

// ---------------------------------------------------------------------------
// checkCustomerOptOutStatus never fails open (review correction)
// ---------------------------------------------------------------------------

test("[OO5] checkCustomerOptOutStatus never fails open - a real query failure (unreachable database) reports unavailable, never not_opted_out", async () => {
  await resetPoolForTests();
  const originalDbName = process.env.DB_NAME;
  process.env.DB_NAME = "crm_test_nonexistent_for_oo5";
  try {
    const status = await checkCustomerOptOutStatus(uniqueWaId("oo5"));
    assert.equal(status, "unavailable");
  } finally {
    process.env.DB_NAME = originalDbName;
    await resetPoolForTests();
  }
});
