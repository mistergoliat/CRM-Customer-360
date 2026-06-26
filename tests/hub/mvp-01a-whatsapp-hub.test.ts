import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getPool, queryRows, safeQueryRows } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import { POST as postWhatsappWebhook } from "@/app/api/integrations/whatsapp/webhook/route";
import ConversationsPage from "@/app/(hub)/conversations/page";
import ConversationDetailPage from "@/app/(hub)/conversations/[id]/page";

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
  BRAIN_OUTBOX_WORKER_ENABLED: "false",
  META_WHATSAPP_APP_SECRET: "app-secret-for-tests",
  META_WHATSAPP_VERIFY_TOKEN: "verify-token-for-tests",
  SESSION_SECRET: "session-secret-for-tests"
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

function signBody(rawBody: string, secret: string) {
  return `sha256=${crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

function buildInboundPayload(input: { providerMessageId: string; waId: string; text: string }) {
  return {
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "phone-mvp-01a" },
              contacts: [{ profile: { name: "Cliente MVP" }, wa_id: input.waId }],
              messages: [
                {
                  id: input.providerMessageId,
                  from: input.waId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: input.text }
                }
              ]
            },
            field: "messages"
          }
        ]
      }
    ]
  };
}

async function postInbound(input: { providerMessageId: string; waId: string; text: string }) {
  const payload = buildInboundPayload(input);
  const rawBody = JSON.stringify(payload);
  const signature = signBody(rawBody, "app-secret-for-tests");
  const response = await postWhatsappWebhook(
    new Request("http://127.0.0.1/api/integrations/whatsapp/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature
      },
      body: rawBody
    })
  );
  const json = await response.json();
  return { response, json };
}

async function countRows(sql: string, params: Array<string | number>) {
  const result = await safeQueryRows<{ total: number }>(sql, params);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return Number(result.rows[0]?.total ?? 0);
}

async function loadConversationPublicId(conversationId: number) {
  const result = await safeQueryRows<{ public_id: string }>("SELECT public_id FROM conversation WHERE id = ? LIMIT 1", [conversationId]);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return String(result.rows[0]?.public_id ?? "");
}

async function makeCustomer(label: string) {
  const result = await createMasterCustomer({
    firstname: "MVP",
    lastname: label,
    email: `mvp-${uniqueSuffix(label)}@local.invalid`,
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

function occurrences(haystack: string, needle: string) {
  return haystack.split(needle).length - 1;
}

async function renderList(q: string) {
  const element = await ConversationsPage({ searchParams: Promise.resolve({ q, page: "1" }) });
  return renderToStaticMarkup(element);
}

async function renderDetail(publicId: string) {
  const element = await ConversationDetailPage({ params: Promise.resolve({ id: publicId }) });
  return renderToStaticMarkup(element);
}

test("inbound real becomes visible in the HUB list and detail view", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("visible")}`;
  const waId = `5697${String(Date.now()).slice(-8)}`;
  const text = "Mensaje visible en el HUB";

  const inbound = await postInbound({ providerMessageId, waId, text });
  assert.equal(inbound.response.status, 200);
  assert.equal(inbound.json.ok, true);

  const conversationId = Number(inbound.json.results[0].conversationId);
  const publicId = await loadConversationPublicId(conversationId);

  const listMarkup = await renderList(waId);
  const detailMarkup = await renderDetail(publicId);

  assert.equal(listMarkup.includes("Sin conversaciones"), false);
  assert.equal(listMarkup.includes(text), true);
  assert.equal(detailMarkup.includes(text), true);
  assert.equal(occurrences(detailMarkup, text), 1);
  assert.equal(await countRows("SELECT COUNT(*) AS total FROM conversation_message WHERE provider = ? AND provider_message_id = ?", ["meta", providerMessageId]), 1);
  assert.equal(await countRows("SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?", [`meta:whatsapp:inbound:${providerMessageId}`]), 1);
});

test("second inbound from the same number reuses the same conversation and keeps both messages once", async () => {
  const waId = `5696${String(Date.now()).slice(-8)}`;
  const firstMessageId = `wamid.${uniqueSuffix("same-1")}`;
  const secondMessageId = `wamid.${uniqueSuffix("same-2")}`;
  const firstText = "Primer mensaje visible";
  const secondText = "Segundo mensaje visible";

  const first = await postInbound({ providerMessageId: firstMessageId, waId, text: firstText });
  const firstConversationId = Number(first.json.results[0].conversationId);
  const firstPublicId = await loadConversationPublicId(firstConversationId);
  await postInbound({ providerMessageId: secondMessageId, waId, text: secondText });

  const secondPublicId = await loadConversationPublicId(firstConversationId);
  const detailMarkup = await renderDetail(secondPublicId);
  const listMarkup = await renderList(waId);

  assert.equal(secondPublicId, firstPublicId);
  assert.equal(detailMarkup.includes(firstText), true);
  assert.equal(detailMarkup.includes(secondText), true);
  assert.equal(occurrences(detailMarkup, firstText), 1);
  assert.equal(occurrences(detailMarkup, secondText), 1);
  assert.equal(listMarkup.includes(secondText), true);
  assert.equal(await countRows("SELECT COUNT(*) AS total FROM conversation WHERE external_contact_id = ?", [waId]), 1);
  assert.equal(await countRows("SELECT COUNT(*) AS total FROM conversation_message WHERE provider = ? AND provider_message_id IN (?, ?)", ["meta", firstMessageId, secondMessageId]), 2);
});

test("two different wa_ids produce separate conversations and separate timelines", async () => {
  const waIdA = `5695${String(Date.now()).slice(-8)}`;
  const waIdB = `5694${String(Date.now()).slice(-8)}`;
  const inboundA = await postInbound({ providerMessageId: `wamid.${uniqueSuffix("diff-a")}`, waId: waIdA, text: "Mensaje A" });
  const inboundB = await postInbound({ providerMessageId: `wamid.${uniqueSuffix("diff-b")}`, waId: waIdB, text: "Mensaje B" });

  const conversationIdA = Number(inboundA.json.results[0].conversationId);
  const conversationIdB = Number(inboundB.json.results[0].conversationId);
  assert.notEqual(conversationIdA, conversationIdB);

  const publicIdA = await loadConversationPublicId(conversationIdA);
  const publicIdB = await loadConversationPublicId(conversationIdB);
  const markupA = await renderDetail(publicIdA);
  const markupB = await renderDetail(publicIdB);

  assert.equal(markupA.includes("Mensaje A"), true);
  assert.equal(markupA.includes("Mensaje B"), false);
  assert.equal(markupB.includes("Mensaje B"), true);
  assert.equal(markupB.includes("Mensaje A"), false);
});

test("duplicate providerMessageId stays deduplicated in persistence and UI", async () => {
  const waId = `5693${String(Date.now()).slice(-8)}`;
  const providerMessageId = `wamid.${uniqueSuffix("dup")}`;
  const text = "Mensaje duplicado";

  const first = await postInbound({ providerMessageId, waId, text });
  const second = await postInbound({ providerMessageId, waId, text });
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);

  const conversationId = Number(first.json.results[0].conversationId);
  const publicId = await loadConversationPublicId(conversationId);
  const detailMarkup = await renderDetail(publicId);

  assert.equal(await countRows("SELECT COUNT(*) AS total FROM conversation_message WHERE provider = ? AND provider_message_id = ?", ["meta", providerMessageId]), 1);
  assert.equal(occurrences(detailMarkup, text), 1);
});

test("identity conflicts are visible in the HUB as a review indicator", async () => {
  const waId = `5692${String(Date.now()).slice(-8)}`;
  const customerA = await makeCustomer("ConflictA");
  const customerB = await makeCustomer("ConflictB");
  await linkExternalIdentity({ customerId: customerA, externalId: `legacy-a-${waId}`, normalizedValue: waId });
  await linkExternalIdentity({ customerId: customerB, externalId: `legacy-b-${waId}`, normalizedValue: waId });

  const inbound = await postInbound({ providerMessageId: `wamid.${uniqueSuffix("conflict")}`, waId, text: "Inbound con conflicto" });
  const conversationId = Number(inbound.json.results[0].conversationId);
  const publicId = await loadConversationPublicId(conversationId);
  const listMarkup = await renderList(waId);
  const detailMarkup = await renderDetail(publicId);

  assert.equal(listMarkup.includes("revisar"), true);
  assert.equal(detailMarkup.includes("requiere revisión"), true);
  assert.equal(detailMarkup.includes("identity_conflict_customer_conversation_mismatch"), true);
});

test("empty search shows an explicit no conversations state", async () => {
  const markup = await renderList(`no-match-${uniqueSuffix("empty")}`);
  assert.equal(markup.includes("Sin conversaciones"), true);
  assert.equal(markup.includes("Error al cargar conversaciones"), false);
});
