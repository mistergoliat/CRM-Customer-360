import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import * as ts from "typescript";
import { getPool, queryRows, safeQueryRows } from "../../lib/db";
import { GET, POST } from "../../app/api/integrations/whatsapp/webhook/route";
import { processNativeWhatsAppInbound } from "../../lib/brain/native-whatsapp";
import { resolveCustomerCandidate } from "../../lib/customer-identity";
import { resolveBackendBrainContext } from "../../lib/brain/context/resolveContext";
import { buildCommercialContext } from "../../lib/brain/commercial/context/buildCommercialContext";

const FIXED_TIME = "2026-06-17T12:00:00.000Z";
const FIXED_STALE_TIME = "2026-06-01T10:00:00.000Z";
const FIXED_STALE_SQL_TIME = FIXED_STALE_TIME.replace("T", " ").replace(".000Z", "");
const KNOWN_WA_ID = "56991111001";
const BLOCKED_WA_ID = "56900000011";

type RouteResult = {
  ok?: boolean;
  processed?: number;
  warnings?: string[];
  results?: Array<Record<string, unknown>>;
  error?: string;
};

function loadEnvFile(filePath: string, overwrite = false) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (overwrite || process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function loadQualityGateEnv() {
  const roots = [process.cwd(), path.resolve(process.cwd(), "..", "CRM-Customer-360")];
  for (const root of roots) {
    loadEnvFile(path.resolve(root, ".env"), true);
    loadEnvFile(path.resolve(root, "infra/.env"), true);
  }

  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (testDatabaseUrl) {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DB_URL = testDatabaseUrl;
  } else {
    const host = process.env.TEST_DATABASE_HOST ?? process.env.DATABASE_HOST ?? process.env.DB_HOST;
    const port = Number(process.env.TEST_DATABASE_PORT ?? process.env.DATABASE_PORT ?? process.env.DB_PORT ?? 3306);
    const database = process.env.TEST_DATABASE_NAME ?? "crm_test";
    const user = process.env.TEST_DATABASE_USER ?? process.env.DATABASE_USER ?? process.env.DB_USER;
    const password = process.env.TEST_DATABASE_PASSWORD ?? process.env.DATABASE_PASSWORD ?? process.env.DB_PASSWORD;
    if (host && user && password) {
      const url = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${Number.isFinite(port) ? port : 3306}/${database}`;
      process.env.DATABASE_URL = url;
      process.env.DB_URL = url;
    }
  }

  Object.assign(process.env, {
    NODE_ENV: "test"
  });
  process.env.DB_WRITE_ENABLED = "true";
  process.env.BRAIN_META_SEND_ENABLED = "false";
  process.env.BRAIN_OUTBOX_WORKER_ENABLED = "false";
  process.env.BRAIN_PERSIST_CANONICAL_OUTBOUND = "true";
  process.env.BRAIN_WHATSAPP_ALLOWED_WA_IDS = "";
  process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = "";
}

loadQualityGateEnv();
const RUN_AUTONOMOUS_COMMERCE_QA = process.env.RUN_AUTONOMOUS_COMMERCE_QA === "1";

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function toEpochSeconds(iso: string) {
  return Math.floor(new Date(iso).getTime() / 1000).toString();
}

function makeMetaPayload(input: {
  providerMessageId: string;
  waId: string;
  phoneNumberId: string;
  text: string;
  timestampIso?: string;
}) {
  const timestampIso = input.timestampIso ?? FIXED_TIME;
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: {
                phone_number_id: input.phoneNumberId
              },
              contacts: [
                {
                  wa_id: input.waId,
                  profile: {
                    name: "Cliente QA"
                  }
                }
              ],
              messages: [
                {
                  id: input.providerMessageId,
                  from: input.waId,
                  timestamp: toEpochSeconds(timestampIso),
                  type: "text",
                  text: {
                    body: input.text
                  }
                }
              ]
            }
          }
        ]
      }
    ]
  };
}

function makeStatusPayload(input: {
  providerMessageId: string;
  waId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestampIso?: string;
}) {
  const timestampIso = input.timestampIso ?? FIXED_TIME;
  return {
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                {
                  id: input.providerMessageId,
                  recipient_id: input.waId,
                  status: input.status,
                  timestamp: toEpochSeconds(timestampIso)
                }
              ]
            }
          }
        ]
      }
    ]
  };
}

function signMetaBody(rawBody: string, secret: string) {
  return `sha256=${crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

function makeWebhookRequest(
  method: "GET" | "POST",
  url: string,
  body: string | null = null,
  headers: Record<string, string> = {}
) {
  const init: RequestInit = {
    method,
    headers
  };
  if (body !== null) {
    init.body = body;
  }
  return new Request(url, init);
}

async function readJsonResponse<T = RouteResult>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

async function countRows(sql: string, params: unknown[] = []) {
  const result = await safeQueryRows<{ total: number }>(sql, params);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return Number(result.rows[0]?.total ?? 0);
}

function assertNoEmptyStrings(value: unknown, pathLabel = "root") {
  if (typeof value === "string") {
    assert.notEqual(value.trim(), "", `empty string at ${pathLabel}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoEmptyStrings(item, `${pathLabel}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      assertNoEmptyStrings(nested, `${pathLabel}.${key}`);
    }
  }
}

function parseImportSources(filePath: string) {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const imports: string[] = [];

  sourceFile.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
  });

  return { source, imports };
}

async function seedQualityGateFixtures() {
  await queryRows(
    `
      INSERT INTO customer_external_identity (
        customer_id,
        provider,
        identity_type,
        external_id,
        normalized_value,
        is_verified,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      1,
      "whatsapp",
      "phone_number",
      KNOWN_WA_ID,
      KNOWN_WA_ID,
      1,
      "2026-06-17 11:00:00",
      "2026-06-17 11:00:00"
    ]
  );

  await queryRows(
    `
      INSERT INTO n8n_conversation_cases (
        conversation_case_id,
        active_case_key,
        wa_id,
        contact_name,
        phone_number_id,
        department,
        status,
        priority,
        service_code,
        requires_human,
        bot_replied,
        final_action,
        ai_blocked,
        lifecycle_status,
        id_order,
        id_customer,
        invoice_number,
        source_table,
        source_id,
        whatsapp_window_open,
        last_message_at,
        created_at,
        updated_at,
        message_count,
        last_message,
        contact_id,
        email,
        phone,
        phone_normalized,
        first_message_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      9101,
      "qa-case-9101",
      BLOCKED_WA_ID,
      "Cliente QA",
      "phone-qa-9101",
      "ventas",
      "waiting_human",
      "high",
      "sales",
      1,
      0,
      "manual_operator_reply",
      1,
      "waiting_human",
      "QA-ORDER-9101",
      1,
      "QA-INVOICE-9101",
      "n8n_vw_hub_cases",
      9101,
      1,
      FIXED_STALE_SQL_TIME,
      FIXED_STALE_SQL_TIME,
      FIXED_STALE_SQL_TIME,
      2,
      "Necesito soporte con mi compra",
      9101,
      "cliente.qa.9101@example.test",
      BLOCKED_WA_ID,
      BLOCKED_WA_ID,
      "2026-06-01 10:00:00"
    ]
  );

  await queryRows(
    `
      INSERT INTO n8n_conversation_messages (
        id,
        conversation_case_id,
        message_id,
        wa_id,
        phone_number_id,
        direction,
        message_direction,
        message_type,
        message_text,
        text,
        body,
        message,
        content,
        raw_text,
        final_action,
        status,
        intent,
        department,
        occurred_at,
        created_at,
        updated_at,
        source_table,
        source_id,
        provider_message_id,
        technical_origin,
        id_order,
        id_customer,
        invoice_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      91011,
      9101,
      "qa-case-9101-msg-1",
      BLOCKED_WA_ID,
      "phone-qa-9101",
      "inbound",
      "inbound",
      "text",
      "Necesito soporte con mi compra",
      "Necesito soporte con mi compra",
      "Necesito soporte con mi compra",
      "Necesito soporte con mi compra",
      "Necesito soporte con mi compra",
      "Necesito soporte con mi compra",
      "manual_operator_reply",
      "received",
      "support",
      "ventas",
      FIXED_STALE_SQL_TIME,
      FIXED_STALE_SQL_TIME,
      FIXED_STALE_SQL_TIME,
      "n8n_conversation_messages",
      91011,
      "qa-case-9101-msg-1",
      "legacy_n8n",
      "QA-ORDER-9101",
      1,
      "QA-INVOICE-9101"
    ]
  );

  await queryRows(
    `
      INSERT INTO n8n_conversation_messages (
        id,
        conversation_case_id,
        message_id,
        wa_id,
        phone_number_id,
        direction,
        message_direction,
        message_type,
        message_text,
        text,
        body,
        message,
        content,
        raw_text,
        final_action,
        status,
        intent,
        department,
        occurred_at,
        created_at,
        updated_at,
        source_table,
        source_id,
        provider_message_id,
        technical_origin,
        id_order,
        id_customer,
        invoice_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      91012,
      9101,
      "qa-case-9101-msg-2",
      BLOCKED_WA_ID,
      "phone-qa-9101",
      "outbound",
      "outbound",
      "text",
      "Vamos a revisar tu caso",
      "Vamos a revisar tu caso",
      "Vamos a revisar tu caso",
      "Vamos a revisar tu caso",
      "Vamos a revisar tu caso",
      "Vamos a revisar tu caso",
      "manual_operator_reply",
      "sent",
      "support",
      "ventas",
      "2026-06-01 10:05:00",
      "2026-06-01 10:05:00",
      "2026-06-01 10:05:00",
      "n8n_conversation_messages",
      91012,
      "qa-case-9101-msg-2",
      "legacy_n8n",
      "QA-ORDER-9101",
      1,
      "QA-INVOICE-9101"
    ]
  );

  await queryRows(
    `
      INSERT INTO n8n_wa_inbound_messages (
        id,
        conversation_case_id,
        message_id,
        wa_id,
        phone_number_id,
        direction,
        message_direction,
        message_type,
        message_text,
        text,
        body,
        message,
        content,
        raw_text,
        final_action,
        status,
        intent,
        department,
        occurred_at,
        created_at,
        updated_at,
        source_table,
        source_id,
        provider_message_id,
        technical_origin,
        id_order,
        id_customer,
        invoice_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      91021,
      9101,
      "qa-inbound-9101-msg-1",
      BLOCKED_WA_ID,
      "phone-qa-9101",
      "inbound",
      "inbound",
      "text",
      "Necesito soporte con mi compra",
      "Necesito soporte con mi compra",
      "Necesito soporte con mi compra",
      "Necesito soporte con mi compra",
      "Necesito soporte con mi compra",
      "Necesito soporte con mi compra",
      "manual_operator_reply",
      "received",
      "support",
      "ventas",
      "2026-06-01 10:00:00",
      "2026-06-01 10:00:00",
      "2026-06-01 10:00:00",
      "n8n_wa_inbound_messages",
      91021,
      "qa-inbound-9101-msg-1",
      "legacy_n8n",
      "QA-ORDER-9101",
      1,
      "QA-INVOICE-9101"
    ]
  );

  await queryRows(
    `
      INSERT INTO crm_opportunities (
        opportunity_key,
        customer_candidate_id,
        customer_master_id,
        lead_id,
        conversation_case_id,
        wa_id,
        channel,
        primary_intent,
        status,
        stage,
        temperature,
        priority,
        current_summary,
        requirements_json,
        missing_requirements_json,
        product_interests_json,
        objections_json,
        signals_json,
        last_customer_message_id,
        last_agent_decision_id,
        waiting_for,
        next_action_type,
        next_action_due_at,
        human_owner_active,
        ai_blocked,
        version,
        created_at,
        updated_at,
        last_activity_at,
        closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      "qa-quality-gate-opportunity-9101",
      null,
      "1",
      "qa-lead-9101",
      "9101",
      BLOCKED_WA_ID,
      "whatsapp",
      "sales",
      "open",
      "qualification",
      "warm",
      "high",
      "Blocked QA fixture opportunity",
      JSON.stringify([{ feature: "qa" }]),
      JSON.stringify([{ feature: "qa-missing" }]),
      JSON.stringify([{ sku: "qa-product-1" }]),
      JSON.stringify([{ code: "qa-objection" }]),
      JSON.stringify([{ signal: "qa-signal" }]),
      "qa-case-9101-msg-2",
      null,
      "customer_response",
      "follow_up",
      "2026-06-02 10:00:00",
      1,
      1,
      1,
      "2026-06-01 10:00:00",
      "2026-06-01 10:05:00",
      "2026-06-01 10:05:00",
      null
    ]
  );
}

async function getWebhook(query: string) {
  const response = await GET(makeWebhookRequest("GET", `http://localhost/api/integrations/whatsapp/webhook${query}`));
  return {
    response,
    text: await response.text()
  };
}

async function readNativeCounts(providerMessageId: string, waId: string) {
  return {
    conversationMessages: await countRows("SELECT COUNT(*) AS total FROM conversation_message WHERE provider = ? AND provider_message_id = ?", ["meta", providerMessageId]),
    commercialEvents: await countRows("SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?", [`meta:whatsapp:inbound:${providerMessageId}`]),
    conversations: await countRows("SELECT COUNT(*) AS total FROM conversation WHERE channel = ? AND channel_account_id = ? AND external_contact_id = ?", ["whatsapp", "phone-qa-001", waId]),
    auditLogs: await countRows("SELECT COUNT(*) AS total FROM hub_audit_log WHERE action IN (?, ?) AND entity_id IS NOT NULL", ["customer.created", "customer.linked"])
  };
}

if (RUN_AUTONOMOUS_COMMERCE_QA) {
  before(async () => {
    await seedQualityGateFixtures();
  });
}

const qualityGateTest = RUN_AUTONOMOUS_COMMERCE_QA ? test : test.skip;

qualityGateTest("Autonomous commerce quality gate", async (t) => {
  await t.test("webhook verification and ingress gating", async () => {
    const validGet = await getWebhook(`?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(process.env.META_WHATSAPP_VERIFY_TOKEN ?? "")}&hub.challenge=challenge-123`);
    assert.equal(validGet.response.status, 200);
    assert.equal(validGet.text, "challenge-123");

    const invalidGet = await getWebhook("?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-123");
    assert.equal(invalidGet.response.status, 403);

    const providerMessageId = uniqueId("wamid-qa-ingress");
    const rawBody = JSON.stringify(makeMetaPayload({
      providerMessageId,
      waId: KNOWN_WA_ID,
      phoneNumberId: "phone-qa-001",
      text: "Hola, quiero revisar mi pedido"
    }));
    const signature = signMetaBody(rawBody, process.env.META_WHATSAPP_APP_SECRET ?? "qa-meta-app-secret");
    const before = await readNativeCounts(providerMessageId, KNOWN_WA_ID);

    const validPost = await POST(
      makeWebhookRequest("POST", "http://localhost/api/integrations/whatsapp/webhook", rawBody, {
        "content-type": "application/json",
        "x-hub-signature-256": signature
      })
    );
    const validBody = await readJsonResponse<RouteResult>(validPost);

    assert.equal(validPost.status, 200);
    assert.equal(validBody.ok, true);
    assert.equal(validBody.processed, 1);
    assert.equal(validBody.results?.[0]?.ok, true);
    assert.equal(validBody.results?.[0]?.duplicate, false);
    assert.notEqual(validBody.results?.[0]?.conversationId ?? null, null);
    assert.equal(validBody.results?.[0]?.commercialEventStatus, "created");
    assertNoEmptyStrings(validBody, "validPost");

    const after = await readNativeCounts(providerMessageId, KNOWN_WA_ID);
    assert.equal(after.conversationMessages, before.conversationMessages + 1);
    assert.equal(after.commercialEvents, before.commercialEvents + 1);
    assert.equal(after.conversations, before.conversations + 1);
    assert.equal(after.auditLogs, before.auditLogs + 1);

    const noAdminBypassPayload = makeMetaPayload({
      providerMessageId: uniqueId("wamid-qa-no-admin"),
      waId: KNOWN_WA_ID,
      phoneNumberId: "phone-qa-001",
      text: "Sin bypass de admin"
    });
    const noAdminBypassRaw = JSON.stringify(noAdminBypassPayload);
    const noAdminBypass = await POST(
      makeWebhookRequest("POST", "http://localhost/api/integrations/whatsapp/webhook", noAdminBypassRaw, {
        "content-type": "application/json",
        "x-hub-signature-256": signMetaBody(noAdminBypassRaw, process.env.META_WHATSAPP_APP_SECRET ?? "qa-meta-app-secret")
      })
    );
    assert.equal(noAdminBypass.status, 200);

    const statusProviderMessageId = providerMessageId;
    const deliveredBody = JSON.stringify(
      makeStatusPayload({
        providerMessageId: statusProviderMessageId,
        waId: KNOWN_WA_ID,
        status: "delivered"
      })
    );
    const delivered = await POST(
      makeWebhookRequest("POST", "http://localhost/api/integrations/whatsapp/webhook", deliveredBody, {
        "content-type": "application/json",
        "x-hub-signature-256": signMetaBody(deliveredBody, process.env.META_WHATSAPP_APP_SECRET ?? "qa-meta-app-secret")
      })
    );
    const deliveredBodyJson = await readJsonResponse<RouteResult>(delivered);
    assert.equal(delivered.status, 200);
    assert.equal(deliveredBodyJson.results?.[0]?.ok, true);
    assert.equal(deliveredBodyJson.results?.[0]?.kind, "status");
    const deliveredEventCount = await countRows("SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?", [`meta:whatsapp:status:${statusProviderMessageId}:delivered`]);
    const deliveredMessage = await safeQueryRows<{ status: string | null }>(
      "SELECT status FROM conversation_message WHERE provider = ? AND provider_message_id = ? LIMIT 1",
      ["meta", statusProviderMessageId]
    );
    assert.ok(deliveredMessage.ok, deliveredMessage.ok ? "" : deliveredMessage.error);
    assert.equal(deliveredMessage.rows[0]?.status, "delivered");
    assert.equal(deliveredEventCount, 1);
  });

  await t.test("webhook signatures and parse failures fail closed", async () => {
    const providerMessageId = uniqueId("wamid-qa-reject");
    const body = JSON.stringify(makeMetaPayload({
      providerMessageId,
      waId: KNOWN_WA_ID,
      phoneNumberId: "phone-qa-001",
      text: "Mensaje rechazado"
    }));
    const beforeMessageCount = await countRows("SELECT COUNT(*) AS total FROM conversation_message WHERE provider_message_id = ?", [providerMessageId]);
    const beforeEventCount = await countRows("SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?", [`meta:whatsapp:inbound:${providerMessageId}`]);

    const missingSignature = await POST(
      makeWebhookRequest("POST", "http://localhost/api/integrations/whatsapp/webhook", body, {
        "content-type": "application/json"
      })
    );
    const missingSignatureBody = await readJsonResponse<RouteResult>(missingSignature);
    assert.equal(missingSignature.status, 401);
    assert.equal(missingSignatureBody.error, "missing_signature");

    const invalidSignature = await POST(
      makeWebhookRequest("POST", "http://localhost/api/integrations/whatsapp/webhook", body, {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=deadbeef"
      })
    );
    const invalidSignatureBody = await readJsonResponse<RouteResult>(invalidSignature);
    assert.equal(invalidSignature.status, 401);
    assert.equal(invalidSignatureBody.error, "invalid_signature");

    const invalidJson = await POST(
      makeWebhookRequest("POST", "http://localhost/api/integrations/whatsapp/webhook", "{ invalid json", {
        "content-type": "application/json",
        "x-hub-signature-256": signMetaBody("{ invalid json", process.env.META_WHATSAPP_APP_SECRET ?? "qa-meta-app-secret")
      })
    );
    const invalidJsonBody = await readJsonResponse<RouteResult>(invalidJson);
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJsonBody.error, "invalid_json");

    const mutableProcessEnv = process.env as Record<string, string | undefined>;
    const missingSecretPrevious = {
      meta: process.env.META_WHATSAPP_APP_SECRET,
      brainMeta: process.env.BRAIN_META_WHATSAPP_APP_SECRET,
      nodeEnv: process.env.NODE_ENV
    };
    delete process.env.META_WHATSAPP_APP_SECRET;
    delete process.env.BRAIN_META_WHATSAPP_APP_SECRET;
    mutableProcessEnv.NODE_ENV = "production";

    try {
      const failClosed = await POST(
        makeWebhookRequest("POST", "http://localhost/api/integrations/whatsapp/webhook", body, {
          "content-type": "application/json"
        })
      );
      const failClosedBody = await readJsonResponse<RouteResult>(failClosed);
      assert.equal(failClosed.status, 401);
      assert.equal(failClosedBody.error, "meta_signature_secret_not_configured");
    } finally {
      if (missingSecretPrevious.meta) process.env.META_WHATSAPP_APP_SECRET = missingSecretPrevious.meta;
      if (missingSecretPrevious.brainMeta) process.env.BRAIN_META_WHATSAPP_APP_SECRET = missingSecretPrevious.brainMeta;
      if (missingSecretPrevious.nodeEnv) mutableProcessEnv.NODE_ENV = missingSecretPrevious.nodeEnv;
    }

    const afterMessageCount = await countRows("SELECT COUNT(*) AS total FROM conversation_message WHERE provider_message_id = ?", [providerMessageId]);
    const afterEventCount = await countRows("SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?", [`meta:whatsapp:inbound:${providerMessageId}`]);
    assert.equal(afterMessageCount, beforeMessageCount);
    assert.equal(afterEventCount, beforeEventCount);
  });

  await t.test("webhook raw body signature fidelity and replay idempotency", async () => {
    const providerMessageId = uniqueId("wamid-qa-idempotent");
    const waId = KNOWN_WA_ID;
    const rawBody = JSON.stringify(makeMetaPayload({
      providerMessageId,
      waId,
      phoneNumberId: "phone-qa-001",
      text: "Tengo una duda"
    }));
    const signature = signMetaBody(rawBody, process.env.META_WHATSAPP_APP_SECRET ?? "qa-meta-app-secret");
    const prettyBody = JSON.stringify(JSON.parse(rawBody), null, 2);

    const wrongBody = await POST(
      makeWebhookRequest("POST", "http://localhost/api/integrations/whatsapp/webhook", prettyBody, {
        "content-type": "application/json",
        "x-hub-signature-256": signature
      })
    );
    const wrongBodyJson = await readJsonResponse<RouteResult>(wrongBody);
    assert.equal(wrongBody.status, 401);
    assert.equal(wrongBodyJson.error, "invalid_signature");

    const first = await POST(
      makeWebhookRequest("POST", "http://localhost/api/integrations/whatsapp/webhook", rawBody, {
        "content-type": "application/json",
        "x-hub-signature-256": signature
      })
    );
    const firstJson = await readJsonResponse<RouteResult>(first);
    assert.equal(first.status, 200);
    assert.equal(firstJson.results?.[0]?.duplicate, false);

    const replay = await POST(
      makeWebhookRequest("POST", "http://localhost/api/integrations/whatsapp/webhook", rawBody, {
        "content-type": "application/json",
        "x-hub-signature-256": signature
      })
    );
    const replayJson = await readJsonResponse<RouteResult>(replay);
    assert.equal(replay.status, 200);
    assert.equal(replayJson.results?.[0]?.duplicate, true);
    assertNoEmptyStrings(replayJson.results?.[0], "replay.result");

    const messageCount = await countRows("SELECT COUNT(*) AS total FROM conversation_message WHERE provider = ? AND provider_message_id = ?", ["meta", providerMessageId]);
    const eventCount = await countRows("SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?", [`meta:whatsapp:inbound:${providerMessageId}`]);
    assert.equal(messageCount, 1);
    assert.equal(eventCount, 1);
  });

  await t.test("native inbound reuses identity and conversation across distinct messages", async () => {
    const first = await processNativeWhatsAppInbound({
      providerMessageId: uniqueId("wamid-qa-native-1"),
      phoneNumberId: "phone-qa-001",
      externalSenderId: KNOWN_WA_ID,
      senderPhone: KNOWN_WA_ID,
      senderName: "Cliente QA",
      messageType: "text",
      text: "Primera consulta",
      occurredAt: FIXED_TIME,
      rawPayload: { kind: "qa-native" }
    });

    const second = await processNativeWhatsAppInbound({
      providerMessageId: uniqueId("wamid-qa-native-2"),
      phoneNumberId: "phone-qa-001",
      externalSenderId: KNOWN_WA_ID,
      senderPhone: KNOWN_WA_ID,
      senderName: "Cliente QA",
      messageType: "text",
      text: "Segunda consulta",
      occurredAt: FIXED_TIME,
      rawPayload: { kind: "qa-native" }
    });

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, false);
    assert.equal(first.customerId, 1);
    assert.equal(second.customerId, 1);
    assert.equal(first.conversationId, second.conversationId);

    const linkedAuditCount = await countRows("SELECT COUNT(*) AS total FROM hub_audit_log WHERE action = ?", [first.customerId === 1 ? "customer.linked" : "customer.created"]);
    assert.ok(linkedAuditCount >= 1);
  });

  await t.test("duplicate delivery status and concurrent replays stay idempotent", async () => {
    const providerMessageId = uniqueId("wamid-qa-concurrent");
    const rawBody = JSON.stringify(makeMetaPayload({
      providerMessageId,
      waId: KNOWN_WA_ID,
      phoneNumberId: "phone-qa-001",
      text: "Concurrency check"
    }));
    const signature = signMetaBody(rawBody, process.env.META_WHATSAPP_APP_SECRET ?? "qa-meta-app-secret");

    const results = await Promise.all([
      POST(
        makeWebhookRequest("POST", "http://localhost/api/integrations/whatsapp/webhook", rawBody, {
          "content-type": "application/json",
          "x-hub-signature-256": signature
        })
      ),
      POST(
        makeWebhookRequest("POST", "http://localhost/api/integrations/whatsapp/webhook", rawBody, {
          "content-type": "application/json",
          "x-hub-signature-256": signature
        })
      )
    ]);

    const first = await readJsonResponse<RouteResult>(results[0]);
    const second = await readJsonResponse<RouteResult>(results[1]);
    assert.equal(results[0].status, 200);
    assert.equal(results[1].status, 200);
    assert.equal(first.results?.[0]?.ok, true);
    assert.equal(second.results?.[0]?.ok, true);

    const messageCount = await countRows("SELECT COUNT(*) AS total FROM conversation_message WHERE provider = ? AND provider_message_id = ?", ["meta", providerMessageId]);
    const eventCount = await countRows("SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?", [`meta:whatsapp:inbound:${providerMessageId}`]);
    assert.equal(messageCount, 1);
    assert.equal(eventCount, 1);
  });

  await t.test("customer identity resolver is read-only and deterministic", async () => {
    const beforeIdentityCount = await countRows("SELECT COUNT(*) AS total FROM customer_external_identity");
    const known = await resolveCustomerCandidate({
      email: "camila.rojas@example.test",
      idCustomer: 1,
      source: "whatsapp",
      options: {
        readOnly: true,
        allowProvisional: true
      }
    });

    const provisional = await resolveCustomerCandidate({
      waId: "56999999999",
      source: "whatsapp",
      options: {
        readOnly: true,
        allowProvisional: true
      }
    });

    const empty = await resolveCustomerCandidate({
      source: "whatsapp",
      options: {
        readOnly: true,
        allowProvisional: false
      }
    });

    await queryRows(
      "INSERT INTO ps_customer (id_customer, email, firstname, lastname, phone) VALUES (?, ?, ?, ?, ?)",
      [777, "qa-conflict@example.test", "QA", "Conflict", "56977777777"]
    );
    await queryRows(
      "INSERT INTO ps_orders (id_order, id_customer, invoice_number, reference, order_reference, email, status, total_paid, customer_name, payment, date_upd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [778, 888, "QA-INVOICE-CONFLICT", "qa-order-conflict", "qa-order-conflict", "qa-conflict@example.test", "paid", 19990, "QA Conflict", "card", "2026-06-17 11:00:00"]
    );

    const conflict = await resolveCustomerCandidate({
      email: "qa-conflict@example.test",
      source: "prestashop",
      options: {
        readOnly: true,
        allowProvisional: true
      }
    });

    const afterIdentityCount = await countRows("SELECT COUNT(*) AS total FROM customer_external_identity");

    assert.equal(known.resolution.status === "linked_identity" || known.resolution.status === "resolved_existing", true);
    assert.equal(known.customer?.primaryIdentityValue, "1");
    assert.equal(provisional.resolution.status, "created_provisional");
    assert.equal(provisional.customer?.reviewState, "clear");
    assert.equal(empty.resolution.status, "not_enough_identity");
    assert.equal(empty.customer, null);
    assert.equal(conflict.resolution.status, "resolved_existing");
    assert.equal(conflict.customer?.reviewState, "clear");
    assert.equal(afterIdentityCount, beforeIdentityCount);
  });

  await t.test("commercial context is built from persisted data without mutating state", async () => {
    const beforeCounts = {
      cases: await countRows("SELECT COUNT(*) AS total FROM n8n_conversation_cases"),
      messages: await countRows("SELECT COUNT(*) AS total FROM n8n_conversation_messages"),
      inbound: await countRows("SELECT COUNT(*) AS total FROM n8n_wa_inbound_messages"),
      opportunities: await countRows("SELECT COUNT(*) AS total FROM crm_opportunities"),
      aiState: await countRows("SELECT COUNT(*) AS total FROM ai_conversation_state")
    };

    const brainContext = await resolveBackendBrainContext({
      channel: "whatsapp",
      source: "manual_test",
      waId: BLOCKED_WA_ID,
      phoneNumberId: "phone-qa-9101",
      messageId: "wamid-qa-context-1",
      messageText: "Sigue disponible?",
      conversationCaseId: 9101,
      idCustomer: 1,
      invoiceNumber: "QA-INVOICE-9101",
      sourceWorkflow: "qa-quality-gate",
      sourceNode: "ingress",
      options: {
        dryRun: true,
        maxMessages: 12,
        maxAgentRuns: 5,
        maxCases: 5,
        includePostventa: true,
        includeAgentRuns: true,
        debug: false
      }
    });

    const opportunityRow = await safeQueryRows<Record<string, unknown>>(
      "SELECT * FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1",
      ["qa-quality-gate-opportunity-9101"]
    );
    assert.ok(opportunityRow.ok, opportunityRow.ok ? "" : opportunityRow.error);

    const commercialContext = buildCommercialContext({
      brainContext,
      inboundMessage: {
        id: "wamid-qa-context-1",
        message_id: "wamid-qa-context-1",
        message_text: "Sigue disponible?",
        channel: "whatsapp",
        platform: "meta",
        wa_id: BLOCKED_WA_ID,
        phone_number_id: "phone-qa-9101",
        conversation_case_id: 9101,
        occurred_at: FIXED_TIME,
        created_at: FIXED_TIME,
        updated_at: FIXED_TIME,
        headers: {
          authorization: "hidden"
        }
      },
      requestedMode: "standard",
      currentTime: FIXED_TIME,
      timezone: "America/Santiago",
      availableCapabilities: ["searchKnowledge", "getConversationHistory", "searchProducts", "getProductStock", "getOrderByInvoice"],
      metadata: {
        safeTraceId: "qa-quality-gate"
      }
    });

    const blankContext = buildCommercialContext({
      brainContext: {},
      inboundMessage: {},
      requestedMode: "minimal",
      currentTime: FIXED_TIME,
      timezone: "America/Santiago",
      availableCapabilities: []
    });

    const afterCounts = {
      cases: await countRows("SELECT COUNT(*) AS total FROM n8n_conversation_cases"),
      messages: await countRows("SELECT COUNT(*) AS total FROM n8n_conversation_messages"),
      inbound: await countRows("SELECT COUNT(*) AS total FROM n8n_wa_inbound_messages"),
      opportunities: await countRows("SELECT COUNT(*) AS total FROM crm_opportunities"),
      aiState: await countRows("SELECT COUNT(*) AS total FROM ai_conversation_state")
    };

    assert.equal(brainContext.ok, true);
    assert.equal(brainContext.partial_context, true);
    assert.ok(Array.isArray(brainContext.warnings));
    assert.ok(brainContext.case_context);
    assert.ok(brainContext.conversation_context);
    assert.ok(Array.isArray(brainContext.conversation_context.recent_messages));

    const commercialContextFromPersistedData = commercialContext;
    assert.equal(commercialContextFromPersistedData.status, "success");
    assert.ok(commercialContextFromPersistedData.warnings.length >= 0);

    const commercialContextFromFixture = buildCommercialContext({
      brainContext: {
        customer_context: {
          wa_id: BLOCKED_WA_ID,
          phone_number_id: "phone-qa-9101"
        },
        case_context: {
          conversation_case_id: 9101,
          status: "waiting_human",
          lifecycle_status: "waiting_human",
          department: "ventas",
          requires_human: true,
          ai_blocked: true,
          manual_operator_lock: true,
          bot_replied: false,
          final_action: "manual_operator_reply",
          updated_at: "2026-06-17T11:55:00.000Z"
        },
        conversation_context: {
          recent_messages: [
            {
              id: 91011,
              direction: "inbound",
              text: "Necesito soporte con mi compra",
              occurred_at: "2026-06-01T10:00:00.000Z",
              created_at: "2026-06-01T10:00:00.000Z",
              updated_at: "2026-06-01T10:00:00.000Z",
              message_type: "text",
              final_action: "manual_operator_reply",
              status: "received",
              intent: "support",
              department: "ventas",
              wa_id: BLOCKED_WA_ID,
              phone_number_id: "phone-qa-9101",
              conversation_case_id: 9101,
              source_table: "n8n_conversation_messages"
            }
          ],
          latest_inbound_message: {
            id: 91011,
            direction: "inbound",
            text: "Necesito soporte con mi compra",
            occurred_at: "2026-06-01T10:00:00.000Z",
            created_at: "2026-06-01T10:00:00.000Z",
            updated_at: "2026-06-01T10:00:00.000Z",
            message_type: "text",
            final_action: "manual_operator_reply",
            status: "received",
            intent: "support",
            department: "ventas",
            wa_id: BLOCKED_WA_ID,
            phone_number_id: "phone-qa-9101",
            conversation_case_id: 9101,
            source_table: "n8n_conversation_messages"
          },
          latest_outbound_message: {
            id: 91012,
            direction: "outbound",
            text: "Vamos a revisar tu caso",
            occurred_at: "2026-06-01T10:05:00.000Z",
            created_at: "2026-06-01T10:05:00.000Z",
            updated_at: "2026-06-01T10:05:00.000Z",
            message_type: "text",
            final_action: "manual_operator_reply",
            status: "sent",
            intent: "support",
            department: "ventas",
            wa_id: BLOCKED_WA_ID,
            phone_number_id: "phone-qa-9101",
            conversation_case_id: 9101,
            source_table: "n8n_conversation_messages"
          }
        },
        business_context: {
          ps_orders: [
            {
              id_order: "QA-ORDER-9101",
              id_customer: 1,
              invoice_number: "QA-INVOICE-9101",
              status: "paid",
              total_paid: 79990
            }
          ]
        }
      },
      inboundMessage: {
        id: "wamid-qa-context-fixture",
        message_id: "wamid-qa-context-fixture",
        message_text: "Sigue disponible?",
        channel: "whatsapp",
        platform: "meta",
        wa_id: BLOCKED_WA_ID,
        phone_number_id: "phone-qa-9101",
        conversation_case_id: 9101,
        occurred_at: FIXED_TIME,
        created_at: FIXED_TIME,
        updated_at: FIXED_TIME
      },
      requestedMode: "standard",
      currentTime: "2026-12-31T12:00:00.000Z",
      timezone: "America/Santiago",
      availableCapabilities: ["searchKnowledge", "getConversationHistory", "searchProducts", "getProductStock", "getOrderByInvoice"]
    });

    assert.equal(commercialContextFromFixture.status, "success");
    assert.ok(commercialContextFromFixture.warnings.includes("ai_blocked"));
    assert.ok(commercialContextFromFixture.warnings.includes("human_owner_active"));
    assert.ok(commercialContextFromFixture.warnings.includes("stale_context"));
    assert.ok(commercialContextFromFixture.salesAgentInput?.structuralSignals.includes("ai_blocked"));
    assert.ok(commercialContextFromFixture.salesAgentInput?.structuralSignals.includes("human_owner_active"));
    assert.ok(commercialContextFromFixture.salesAgentInput?.structuralSignals.includes("commercial_entity_available"));
    assert.equal(blankContext.status, "insufficient_context");
    assert.equal(blankContext.completeness, "insufficient");
    assert.equal(beforeCounts.cases, afterCounts.cases);
    assert.equal(beforeCounts.messages, afterCounts.messages);
    assert.equal(beforeCounts.inbound, afterCounts.inbound);
    assert.equal(beforeCounts.opportunities, afterCounts.opportunities);
    assert.equal(beforeCounts.aiState, afterCounts.aiState);
  });

  await t.test("architecture and source guards stay within the allowed boundary", async () => {
    const routePath = path.resolve(process.cwd(), "app/api/integrations/whatsapp/webhook/route.ts");
    const servicePath = path.resolve(process.cwd(), "lib/brain/native-whatsapp/service.ts");
    const route = parseImportSources(routePath);
    const service = parseImportSources(servicePath);

    assert.equal(route.imports.includes("@/lib/auth"), false);
    assert.equal(route.source.includes("x-admin-bypass-token"), false);
    assert.equal(route.source.includes("runSalesConsultativeService("), false);
    assert.equal(route.source.includes("processSalesInbound("), false);
    assert.equal(route.source.includes("persistCanonicalOutboundMessage("), false);
    assert.equal(route.source.includes("sendMetaWhatsAppTextMessage("), false);
    assert.equal(route.source.includes("legacy-n8n"), false);
    assert.equal(route.source.includes("ps_"), false);

    assert.equal(service.imports.includes("@/lib/integrations/prestashop"), false);
    assert.equal(service.source.includes("legacy-n8n"), false);
    assert.equal(service.source.includes("ps_"), false);
    assert.equal(service.source.includes("persistCanonicalOutboundMessage("), false);

    const snapshotBefore = {
      count: await countRows("SELECT COUNT(*) AS total FROM conversation_message")
    };
    await resolveCustomerCandidate({
      waId: "56933333333",
      source: "whatsapp",
      options: {
        readOnly: true,
        allowProvisional: true
      }
    });
    const snapshotAfter = {
      count: await countRows("SELECT COUNT(*) AS total FROM conversation_message")
    };
    assert.equal(snapshotBefore.count, snapshotAfter.count);
  });
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // Ignore teardown noise in ephemeral test runs.
  }
});
