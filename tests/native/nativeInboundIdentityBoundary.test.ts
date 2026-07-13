import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";

// ACS-R1-04-T06.2. Permanent boundary invariants for the native WhatsApp
// inbound path after reconciling PR #43: identity resolution only, never
// onboarding, never customer creation/linking authority.

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
  return `562${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
}

test("structural: native-whatsapp/service.ts never imports the legacy onboarding writer or the canonical onboarding domain directly", () => {
  const source = readFileSync(join(process.cwd(), "lib/brain/native-whatsapp/service.ts"), "utf8");
  assert.doesNotMatch(source, /persistCustomerOnboardingState/, "must not reintroduce the legacy dual-write removed in T06.2");
  assert.doesNotMatch(source, /from ["']@\/lib\/brain\/commercial\/customer-onboarding/, "onboarding stays owned by resolveNativeCustomerSession, not the inbound writer");
  assert.doesNotMatch(source, /from ["']@\/lib\/domains\/customer-onboarding/, "CustomerOnboardingService is invoked from the session pipeline, not from the inbound writer");
});

// Scoped by this test's own waId/conversation rather than a global COUNT(*)
// before/after - the full suite runs other DB-backed test files concurrently
// (some of which legitimately create master_customer rows or execute
// create_customer/link_external_identity), so a global count is racy.

test("a plain inbound never writes the legacy crm_customer_onboarding table", async () => {
  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("boundary")}`,
    phoneNumberId: `phone-${uniqueSuffix("pnid")}`,
    externalSenderId: uniqueWaId(),
    senderPhone: uniqueWaId(),
    senderName: "Cliente Boundary",
    messageType: "text",
    text: "hola",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });

  const legacyRows = await safeQueryRows<{ total: number }>(
    "SELECT COUNT(*) AS total FROM crm_customer_onboarding WHERE conversation_case_id = ?",
    [String(result.conversationPublicId)]
  );
  assert.ok(legacyRows.ok, legacyRows.ok ? "" : legacyRows.error);
  assert.equal(Number(legacyRows.rows[0]?.total ?? 0), 0);
});

test("a plain inbound for an unknown sender never creates a master_customer row", async () => {
  const waId = uniqueWaId();
  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("boundary")}`,
    phoneNumberId: `phone-${uniqueSuffix("pnid")}`,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Boundary",
    messageType: "text",
    text: "hola",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.equal(result.customerId, null);

  const identityRow = await safeQueryRows<{ customer_id: number | null }>(
    "SELECT customer_id FROM customer_external_identity WHERE provider = 'whatsapp' AND external_id = ? LIMIT 1",
    [waId]
  );
  assert.ok(identityRow.ok, identityRow.ok ? "" : identityRow.error);
  assert.equal(identityRow.rows[0]?.customer_id, null);
});

test("a plain inbound never executes create_customer or link_external_identity against the Capability Gateway", async () => {
  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("boundary")}`,
    phoneNumberId: `phone-${uniqueSuffix("pnid")}`,
    externalSenderId: uniqueWaId(),
    senderPhone: uniqueWaId(),
    senderName: "Cliente Boundary",
    messageType: "text",
    text: "hola",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });

  const executions = await safeQueryRows<{ total: number }>(
    "SELECT COUNT(*) AS total FROM crm_capability_executions WHERE conversation_id = ? AND capability_name IN ('create_customer', 'link_external_identity')",
    [result.conversationId as number]
  );
  assert.ok(executions.ok, executions.ok ? "" : executions.error);
  assert.equal(Number(executions.rows[0]?.total ?? 0), 0);
});

test("no provisional wa-<phone>@local.invalid email is ever fabricated for an unmatched sender", async () => {
  const waId = uniqueWaId();
  await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("boundary")}`,
    phoneNumberId: `phone-${uniqueSuffix("pnid")}`,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Boundary",
    messageType: "text",
    text: "hola",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });

  const invalidRows = await safeQueryRows<{ total: number }>(
    "SELECT COUNT(*) AS total FROM master_customer WHERE email LIKE ?",
    [`%${waId}%@local.invalid`]
  );
  assert.ok(invalidRows.ok, invalidRows.ok ? "" : invalidRows.error);
  assert.equal(Number(invalidRows.rows[0]?.total ?? 0), 0);
});
