import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows, safeQueryRows } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
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

function uniqueWaId() {
  return `561${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
}

async function makeCustomer(label: string) {
  const result = await createMasterCustomer({
    firstname: "Identity",
    lastname: label,
    email: `identity-${uniqueSuffix(label)}@example.com`,
    platformOrigin: "whatsapp"
  });
  assert.ok(result.ok, result.ok ? "" : result.error);
  return Number(result.data.id);
}

async function linkExternalIdentity(input: { customerId: number; externalId: string; normalizedValue: string }) {
  await queryRows(
    `
      INSERT INTO customer_external_identity (customer_id, provider, identity_type, external_id, normalized_value, is_verified, created_at, updated_at)
      VALUES (?, 'whatsapp', 'phone_number', ?, ?, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    `,
    [input.customerId, input.externalId, input.normalizedValue]
  );
}

async function sendInbound(waId: string, text: string, phoneNumberId = "phone-identity-conflict") {
  return processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("identity")}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Identidad",
    messageType: "text",
    text,
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
}

test("unambiguous identity: a single linked customer resolves cleanly, no conflict", async () => {
  const waId = uniqueWaId();
  const customerId = await makeCustomer("Linked");
  await linkExternalIdentity({ customerId, externalId: `linked-${waId}`, normalizedValue: waId });

  const result = await sendInbound(waId, "primer contacto inequivoco");
  assert.equal(result.duplicate, false);
  assert.equal((result as { identityConflict: unknown }).identityConflict, null);
  assert.deepEqual((result as { identityWarnings: string[] }).identityWarnings, []);
  assert.equal(result.customerId, customerId);

  const second = await sendInbound(waId, "segundo mensaje, misma identidad");
  assert.equal((second as { identityConflict: unknown }).identityConflict, null);
  assert.equal(second.customerId, customerId);

  const identityCount = await safeQueryRows<{ total: number }>(
    "SELECT COUNT(*) AS total FROM customer_external_identity WHERE provider = 'whatsapp' AND external_id = ?",
    [waId]
  );
  assert.ok(identityCount.ok, identityCount.ok ? "" : identityCount.error);
  assert.equal(Number(identityCount.rows[0]?.total ?? 0), 1);

  const conversationCount = await safeQueryRows<{ total: number }>(
    "SELECT COUNT(*) AS total FROM conversation WHERE public_id = ?",
    [result.conversationPublicId as string]
  );
  assert.ok(conversationCount.ok, conversationCount.ok ? "" : conversationCount.error);
  assert.equal(Number(conversationCount.rows[0]?.total ?? 0), 1);
});

test("nonexistent identity: first contact keeps the conversation uncoupled and stores an unresolved external identity", async () => {
  const waId = uniqueWaId();
  const result = await sendInbound(waId, "soy nuevo");
  assert.equal((result as { identityConflict: unknown }).identityConflict, null);
  assert.equal(result.customerId, null);
  assert.equal((result as { customer: unknown }).customer, null);
  assert.equal((result as { externalIdentityId: number | null }).externalIdentityId !== null, true);

  const identityRow = await safeQueryRows<{ customer_id: number | null }>(
    "SELECT customer_id FROM customer_external_identity WHERE provider = 'whatsapp' AND external_id = ? LIMIT 1",
    [waId]
  );
  assert.ok(identityRow.ok, identityRow.ok ? "" : identityRow.error);
  assert.equal(identityRow.rows[0]?.customer_id, null);

  const conversationRow = await safeQueryRows<{ customer_id: number | null }>(
    "SELECT customer_id FROM conversation WHERE id = ? LIMIT 1",
    [result.conversationId as number]
  );
  assert.ok(conversationRow.ok, conversationRow.ok ? "" : conversationRow.error);
  assert.equal(conversationRow.rows[0]?.customer_id, null);

  const identityCount = await safeQueryRows<{ total: number }>(
    "SELECT COUNT(*) AS total FROM customer_external_identity WHERE provider = 'whatsapp' AND external_id = ?",
    [waId]
  );
  assert.ok(identityCount.ok, identityCount.ok ? "" : identityCount.error);
  assert.equal(Number(identityCount.rows[0]?.total ?? 0), 1);

  const conversationCount = await safeQueryRows<{ total: number }>(
    "SELECT COUNT(*) AS total FROM conversation WHERE public_id = ?",
    [result.conversationPublicId as string]
  );
  assert.ok(conversationCount.ok, conversationCount.ok ? "" : conversationCount.error);
  assert.equal(Number(conversationCount.rows[0]?.total ?? 0), 1);

  assert.doesNotMatch(JSON.stringify(result), /local\.invalid/i);
});

test("unresolved identity persists: a second message from the same still-unmatched contact stays unresolved, never fabricates a customer, never duplicates the identity row", async () => {
  const waId = uniqueWaId();
  const first = await sendInbound(waId, "primer mensaje, todavia sin match");
  assert.equal(first.customerId, null);
  assert.equal((first as { customer: unknown }).customer, null);
  const firstExternalIdentityId = (first as { externalIdentityId: number | null }).externalIdentityId;
  assert.ok(firstExternalIdentityId);

  const second = await sendInbound(waId, "segundo mensaje, sigue sin identificacion");
  assert.equal(second.customerId, null);
  assert.equal((second as { customer: unknown }).customer, null);
  assert.equal((second as { identityConflict: unknown }).identityConflict, null);
  assert.equal((second as { externalIdentityId: number | null }).externalIdentityId, firstExternalIdentityId);

  const identityCount = await safeQueryRows<{ total: number }>(
    "SELECT COUNT(*) AS total FROM customer_external_identity WHERE provider = 'whatsapp' AND external_id = ?",
    [waId]
  );
  assert.ok(identityCount.ok, identityCount.ok ? "" : identityCount.error);
  assert.equal(Number(identityCount.rows[0]?.total ?? 0), 1);
});

test("duplicate but equivalent identities: two links to the same customer do not conflict", async () => {
  const waId = uniqueWaId();
  const customerId = await makeCustomer("Equivalent");
  await linkExternalIdentity({ customerId, externalId: `alt-a-${waId}`, normalizedValue: waId });
  await linkExternalIdentity({ customerId, externalId: `alt-b-${waId}`, normalizedValue: waId });

  const result = await sendInbound(waId, "identidades equivalentes");
  assert.equal((result as { identityConflict: unknown }).identityConflict, null);
  assert.equal(result.customerId, customerId);
});

test("divergent identities: the same normalized value linked to two different customers raises a conflict and does not silently pick one", async () => {
  const waId = uniqueWaId();
  const customerA = await makeCustomer("DivergentA");
  const customerB = await makeCustomer("DivergentB");
  await linkExternalIdentity({ customerId: customerA, externalId: `legacy-a-${waId}`, normalizedValue: waId });
  await linkExternalIdentity({ customerId: customerB, externalId: `legacy-b-${waId}`, normalizedValue: waId });

  const result = await sendInbound(waId, "identidades divergentes");
  const conflict = (result as { identityConflict: { type: string; candidateCustomerIds: number[] } | null }).identityConflict;
  assert.ok(conflict);
  assert.equal(conflict!.type, "divergent_identity_links");
  assert.deepEqual([...conflict!.candidateCustomerIds].sort(), [customerA, customerB].sort());
  assert.equal(result.customerId, null);
  assert.equal((result as { identityWarnings: string[] }).identityWarnings.includes("identity_conflict_divergent_customers"), true);

  // continuity: the inbound message itself is always persisted regardless of identity conflict
  assert.ok(result.messageId);
  assert.ok(result.conversationId);
});

test("conflict between an existing conversation's customer and a freshly resolved customer is detected and does not overwrite the existing link", async () => {
  const waId = uniqueWaId();
  const first = await sendInbound(waId, "primer mensaje establece el vinculo");
  assert.equal(first.customerId, null);

  const originalCustomerId = await makeCustomer("ConversationLinked");
  await queryRows("UPDATE conversation SET customer_id = ? WHERE id = ?", [originalCustomerId, first.conversationId as number]);

  const otherCustomerId = await makeCustomer("Repointed");
  await queryRows(
    "UPDATE customer_external_identity SET customer_id = ? WHERE provider = 'whatsapp' AND external_id = ?",
    [otherCustomerId, waId]
  );

  const second = await sendInbound(waId, "segundo mensaje tras una identidad repuntada externamente");
  const conflict = (second as { identityConflict: { type: string; candidateCustomerIds: number[] } | null }).identityConflict;
  assert.ok(conflict);
  assert.equal(conflict!.type, "customer_conversation_mismatch");
  assert.deepEqual([...conflict!.candidateCustomerIds].sort(), [originalCustomerId, otherCustomerId].sort());
  assert.equal(second.customerId, null);

  const conversationRow = await safeQueryRows<{ customer_id: number | null }>(
    "SELECT customer_id FROM conversation WHERE id = ? LIMIT 1",
    [second.conversationId as number]
  );
  assert.ok(conversationRow.ok);
  assert.equal(Number(conversationRow.rows[0]?.customer_id), originalCustomerId);
});

test("human resolution: after disambiguating divergent identities, the next resolution is clean and the conflict stays visible in the audit trail", async () => {
  const waId = uniqueWaId();
  const customerA = await makeCustomer("ResolveA");
  const customerB = await makeCustomer("ResolveB");
  await linkExternalIdentity({ customerId: customerA, externalId: `legacy-a-${waId}`, normalizedValue: waId });
  await linkExternalIdentity({ customerId: customerB, externalId: `legacy-b-${waId}`, normalizedValue: waId });

  const conflicted = await sendInbound(waId, "mensaje en conflicto");
  assert.ok((conflicted as { identityConflict: unknown }).identityConflict);

  const auditRows = await safeQueryRows<{ id: number }>(
    "SELECT id FROM hub_audit_log WHERE action = 'customer.identity_conflict' AND entity_id = ? ORDER BY id DESC LIMIT 1",
    [String(conflicted.conversationId)]
  );
  assert.ok(auditRows.ok, auditRows.ok ? "" : auditRows.error);
  assert.ok(auditRows.rows[0]?.id, "expected the conflict to be recorded in hub_audit_log for human follow-up");

  // human resolution: remove the losing link so the normalized value now maps to a single customer
  await queryRows("DELETE FROM customer_external_identity WHERE provider = 'whatsapp' AND external_id = ?", [`legacy-b-${waId}`]);

  const resolved = await sendInbound(waId, "mensaje tras resolucion humana");
  assert.equal((resolved as { identityConflict: unknown }).identityConflict, null);
  assert.equal(resolved.customerId, customerA);

  const stillThere = await safeQueryRows<{ id: number }>(
    "SELECT id FROM hub_audit_log WHERE action = 'customer.identity_conflict' AND entity_id = ? LIMIT 1",
    [String(conflicted.conversationId)]
  );
  assert.ok(stillThere.ok);
  assert.ok(stillThere.rows[0]?.id, "the original conflict trail must remain visible after resolution");
});
