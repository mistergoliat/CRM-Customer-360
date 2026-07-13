import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import { buildNativeCommercialContext } from "@/lib/brain/commercial/context/buildNativeCommercialContext";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";

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
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  BRAIN_META_SEND_ENABLED: "false",
  BRAIN_OUTBOX_WORKER_ENABLED: "false"
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

test("returns not_found when the conversation does not exist, without touching the loader contract", async () => {
  const snapshot = await buildNativeCommercialContext({
    conversationPublicId: `missing-${uniqueSuffix("conv")}`,
    currentTime: new Date().toISOString(),
    loadConversationDetail: async () => null
  });

  assert.equal(snapshot.contractName, "CommercialContext");
  assert.equal(snapshot.schemaVersion, "1.0");
  assert.equal(snapshot.status, "not_found");
  assert.equal(snapshot.completeness, "insufficient");
  assert.deepEqual(snapshot.warnings, ["conversation_not_found"]);
  assert.equal(snapshot.customer, null);
  assert.equal(snapshot.conversation, null);
});

test("rejects an invalid currentTime safely instead of throwing", async () => {
  const snapshot = await buildNativeCommercialContext({
    conversationPublicId: "any-id",
    currentTime: "not-a-date",
    loadConversationDetail: async () => null
  });

  assert.equal(snapshot.status, "insufficient_context");
  assert.deepEqual(snapshot.warnings, ["invalid_current_time"]);
});

test("degrades safely and flags warnings when opportunity, profile and messages are missing", async () => {
  const currentTime = new Date().toISOString();
  const snapshot = await buildNativeCommercialContext({
    conversationPublicId: "conv-minimal",
    currentTime,
    loadConversationDetail: async () => ({
      conversation: {
        id: 1,
        public_id: "conv-minimal",
        channel: "whatsapp",
        provider: "meta",
        external_contact_id: "56900000000",
        status: "open",
        ai_enabled: 1,
        human_owner_active: 0,
        last_message_at: currentTime
      },
      customer: null,
      messages: [],
      opportunity: null,
      profile: null,
      actions: []
    })
  });

  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.completeness, "minimal");
  assert.equal(snapshot.signals.hasCustomer, false);
  assert.equal(snapshot.signals.hasOpportunity, false);
  assert.equal(snapshot.signals.hasRecentMessages, false);
  assert.ok(snapshot.warnings.includes("missing_customer"));
  assert.ok(snapshot.warnings.includes("missing_opportunity"));
  assert.ok(snapshot.warnings.includes("missing_recent_messages"));
});

test("flags stale_context when the last message is older than the threshold", async () => {
  const currentTime = new Date().toISOString();
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

  const snapshot = await buildNativeCommercialContext({
    conversationPublicId: "conv-stale",
    currentTime,
    loadConversationDetail: async () => ({
      conversation: {
        id: 2,
        public_id: "conv-stale",
        channel: "whatsapp",
        provider: "meta",
        external_contact_id: "56900000001",
        status: "open",
        ai_enabled: 1,
        human_owner_active: 0,
        last_message_at: eightDaysAgo
      },
      customer: { id: 10, firstname: "Cliente", lastname: "Prueba", email: null, platform_origin: "whatsapp" },
      messages: [{ id: 1, direction: "inbound", body: "hola", status: "received", provider_timestamp: eightDaysAgo, created_at: eightDaysAgo }],
      opportunity: null,
      profile: null,
      actions: []
    })
  });

  assert.equal(snapshot.signals.staleContext, true);
  assert.ok(snapshot.warnings.includes("stale_context"));
});

test("reports human_owner_active and ai_blocked signals without mutating state", async () => {
  const currentTime = new Date().toISOString();
  const snapshot = await buildNativeCommercialContext({
    conversationPublicId: "conv-handoff",
    currentTime,
    loadConversationDetail: async () => ({
      conversation: {
        id: 3,
        public_id: "conv-handoff",
        channel: "whatsapp",
        provider: "meta",
        external_contact_id: "56900000002",
        status: "open",
        ai_enabled: 0,
        human_owner_active: 1,
        last_message_at: currentTime
      },
      customer: { id: 11, firstname: "Cliente", lastname: "Handoff", email: null, platform_origin: "whatsapp" },
      messages: [{ id: 2, direction: "inbound", body: "necesito ayuda", status: "received", provider_timestamp: currentTime, created_at: currentTime }],
      opportunity: null,
      profile: null,
      actions: []
    })
  });

  assert.equal(snapshot.signals.humanOwnerActive, true);
  assert.equal(snapshot.signals.aiBlocked, true);
  assert.ok(snapshot.warnings.includes("human_owner_active"));
  assert.ok(snapshot.warnings.includes("ai_blocked"));
});

test("integration: builds a complete-enough snapshot from a real native inbound thread", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("context")}`;
  const waId = `5697${String(Date.now()).slice(-8)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;

  // ACS-R1-04-T06.2. The native inbound no longer resolves a provisional
  // customer for an unknown sender, so a "complete" snapshot (hasCustomer:
  // true) needs a real customer linked before sending the inbound.
  const customer = await createMasterCustomer({
    firstname: "Cliente",
    lastname: "Contexto",
    email: `context-${uniqueSuffix("seed")}@example.com`,
    platformOrigin: "whatsapp"
  });
  assert.ok(customer.ok, customer.ok ? "" : customer.error);
  await queryRows(
    `
      INSERT INTO customer_external_identity (customer_id, provider, identity_type, external_id, normalized_value, is_verified, created_at, updated_at)
      VALUES (?, 'whatsapp', 'phone_number', ?, ?, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    `,
    [Number(customer.data.id), waId, waId]
  );

  const inbound = await processNativeWhatsAppInbound({
    providerMessageId,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Contexto",
    messageType: "text",
    text: "Hola, busco informacion de un producto.",
    occurredAt: new Date().toISOString(),
    rawPayload: { providerMessageId }
  });

  assert.ok(inbound.conversationPublicId, "expected processNativeWhatsAppInbound to return a conversationPublicId");

  const snapshot = await buildNativeCommercialContext({
    conversationPublicId: inbound.conversationPublicId as string,
    currentTime: new Date().toISOString()
  });

  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.metadata.source, "native_mariadb");
  assert.ok(snapshot.conversation);
  assert.equal(snapshot.conversation?.externalContactId, waId);
  assert.equal(snapshot.signals.hasCustomer, true);
  assert.equal(snapshot.signals.hasRecentMessages, true);
  assert.ok(snapshot.recentMessages.length >= 1);
  assert.equal(snapshot.recentMessages[snapshot.recentMessages.length - 1].body, "Hola, busco informacion de un producto.");
});

test("PR-03A: surfaces divergent_identity_links without picking a customer", async () => {
  const currentTime = new Date().toISOString();
  const snapshot = await buildNativeCommercialContext({
    conversationPublicId: "conv-divergent",
    currentTime,
    loadConversationDetail: async () => ({
      conversation: {
        id: 4,
        public_id: "conv-divergent",
        channel: "whatsapp",
        provider: "meta",
        external_contact_id: "56900000003",
        status: "open",
        ai_enabled: 1,
        human_owner_active: 0,
        last_message_at: currentTime
      },
      customer: { id: 20, firstname: "Cliente", lastname: "A", email: null, platform_origin: "whatsapp" },
      messages: [{ id: 1, direction: "inbound", body: "hola", status: "received", provider_timestamp: currentTime, created_at: currentTime }],
      opportunity: null,
      profile: null,
      actions: []
    }),
    findDistinctCustomers: async () => ({ ok: true, customerIds: [20, 21] })
  });

  assert.equal(snapshot.signals.identityConflict, true);
  assert.equal(snapshot.identityConflict?.type, "divergent_identity_links");
  assert.deepEqual(snapshot.identityConflict?.candidateCustomerIds, [20, 21]);
  assert.ok(snapshot.warnings.includes("identity_conflict_divergent_customers"));
});

test("PR-03A: surfaces customer_conversation_mismatch when the resolved customer differs from the single linked customer", async () => {
  const currentTime = new Date().toISOString();
  const snapshot = await buildNativeCommercialContext({
    conversationPublicId: "conv-mismatch",
    currentTime,
    loadConversationDetail: async () => ({
      conversation: {
        id: 5,
        public_id: "conv-mismatch",
        channel: "whatsapp",
        provider: "meta",
        external_contact_id: "56900000004",
        status: "open",
        ai_enabled: 1,
        human_owner_active: 0,
        last_message_at: currentTime
      },
      customer: { id: 30, firstname: "Cliente", lastname: "Stale", email: null, platform_origin: "whatsapp" },
      messages: [{ id: 1, direction: "inbound", body: "hola", status: "received", provider_timestamp: currentTime, created_at: currentTime }],
      opportunity: null,
      profile: null,
      actions: []
    }),
    findDistinctCustomers: async () => ({ ok: true, customerIds: [31] })
  });

  assert.equal(snapshot.signals.identityConflict, true);
  assert.equal(snapshot.identityConflict?.type, "customer_conversation_mismatch");
  assert.deepEqual([...snapshot.identityConflict!.candidateCustomerIds].sort(), [30, 31]);
  assert.ok(snapshot.warnings.includes("identity_conflict_customer_conversation_mismatch"));
});

test("PR-03A: no conflict signal when a single customer link is consistent", async () => {
  const currentTime = new Date().toISOString();
  const snapshot = await buildNativeCommercialContext({
    conversationPublicId: "conv-consistent",
    currentTime,
    loadConversationDetail: async () => ({
      conversation: {
        id: 6,
        public_id: "conv-consistent",
        channel: "whatsapp",
        provider: "meta",
        external_contact_id: "56900000005",
        status: "open",
        ai_enabled: 1,
        human_owner_active: 0,
        last_message_at: currentTime
      },
      customer: { id: 40, firstname: "Cliente", lastname: "Ok", email: null, platform_origin: "whatsapp" },
      messages: [{ id: 1, direction: "inbound", body: "hola", status: "received", provider_timestamp: currentTime, created_at: currentTime }],
      opportunity: null,
      profile: null,
      actions: []
    }),
    findDistinctCustomers: async () => ({ ok: true, customerIds: [40] })
  });

  assert.equal(snapshot.signals.identityConflict, false);
  assert.equal(snapshot.identityConflict, null);
  assert.equal(snapshot.warnings.includes("identity_conflict_divergent_customers"), false);
  assert.equal(snapshot.warnings.includes("identity_conflict_customer_conversation_mismatch"), false);
});
