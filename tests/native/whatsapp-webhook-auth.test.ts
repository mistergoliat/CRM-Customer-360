import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after } from "node:test";
import { NextRequest } from "next/server";
import { getPool, safeQueryRows } from "@/lib/db";

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
  META_WHATSAPP_VERIFY_TOKEN: "verify-token-for-tests",
  META_WHATSAPP_APP_SECRET: "app-secret-for-tests",
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

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function countRows(sql: string, params: Array<string | number>) {
  const result = await safeQueryRows<{ total: number }>(sql, params);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return Number(result.rows[0]?.total ?? 0);
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
              metadata: { phone_number_id: "phone-webhook-auth" },
              contacts: [{ profile: { name: "Cliente Auth Test" }, wa_id: input.waId }],
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

function signBody(rawBody: string, secret: string) {
  return `sha256=${crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

const WEBHOOK_URL = "http://127.0.0.1:3010/api/integrations/whatsapp/webhook";

async function postWebhook(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/integrations/whatsapp/webhook/route");
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const request = new Request(WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: rawBody
  });
  const response = await POST(request);
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function getWebhookVerification(params: Record<string, string>) {
  const { GET } = await import("@/app/api/integrations/whatsapp/webhook/route");
  const url = new URL(WEBHOOK_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const request = new Request(url.toString(), { method: "GET" });
  return GET(request);
}

test("GET valid verification returns the challenge", async () => {
  const response = await getWebhookVerification({
    "hub.mode": "subscribe",
    "hub.verify_token": "verify-token-for-tests",
    "hub.challenge": "challenge-123"
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "challenge-123");
});

test("GET invalid verification (wrong token) is rejected", async () => {
  const response = await getWebhookVerification({
    "hub.mode": "subscribe",
    "hub.verify_token": "wrong-token",
    "hub.challenge": "challenge-123"
  });
  assert.equal(response.status, 403);
});

test("GET invalid verification (wrong mode) is rejected", async () => {
  const response = await getWebhookVerification({
    "hub.mode": "unsubscribe",
    "hub.verify_token": "verify-token-for-tests",
    "hub.challenge": "challenge-123"
  });
  assert.equal(response.status, 403);
});

test("GET invalid verification (missing challenge) is rejected", async () => {
  const response = await getWebhookVerification({
    "hub.mode": "subscribe",
    "hub.verify_token": "verify-token-for-tests"
  });
  assert.equal(response.status, 403);
});

test("POST signature is verified over the literal raw body, not a re-serialized form", async () => {
  // Pretty-printed with extra whitespace/newlines: JSON.parse -> JSON.stringify
  // would NOT reproduce these exact bytes. Signing over this literal string and
  // accepting it proves verifyMetaSignature checks the raw body, not a parsed
  // and re-serialized copy (which would silently disagree with Meta's real
  // signature on any payload that isn't already in canonical JSON.stringify form).
  const providerMessageId = `wamid.${uniqueSuffix("rawbody")}`;
  const waId = `5693${String(Date.now()).slice(-8)}`;
  const payload = buildInboundPayload({ providerMessageId, waId, text: "raw body fidelity" });
  const rawBody = JSON.stringify(payload, null, 2) + "\n";
  assert.notEqual(rawBody, JSON.stringify(JSON.parse(rawBody)), "fixture must differ from its canonical re-serialization");
  const signature = signBody(rawBody, "app-secret-for-tests");

  const result = await postWebhook(rawBody, { "x-hub-signature-256": signature });
  assert.equal(result.status, 200);
  assert.equal((result.json as { ok: boolean }).ok, true);

  const eventCount = await countRows(
    "SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?",
    [`meta:whatsapp:inbound:${providerMessageId}`]
  );
  assert.equal(eventCount, 1);
});

test("production fails closed: an unsigned POST is rejected when no app secret is configured and NODE_ENV=production", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.META_WHATSAPP_APP_SECRET;
  Object.assign(process.env, { NODE_ENV: "production" });
  delete process.env.META_WHATSAPP_APP_SECRET;
  delete process.env.BRAIN_META_WHATSAPP_APP_SECRET;

  try {
    const payload = buildInboundPayload({ providerMessageId: `wamid.${uniqueSuffix("prod")}`, waId: "569900000pp", text: "sin secreto en produccion" });
    const result = await postWebhook(payload);
    assert.equal(result.status, 401);
    assert.equal((result.json as { error: string }).error, "meta_signature_secret_not_configured");
  } finally {
    Object.assign(process.env, { NODE_ENV: originalNodeEnv });
    if (originalSecret !== undefined) process.env.META_WHATSAPP_APP_SECRET = originalSecret;
  }
});

test("authentic POST (valid signature) is processed and persists once", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("authentic")}`;
  const waId = `5696${String(Date.now()).slice(-8)}`;
  const payload = buildInboundPayload({ providerMessageId, waId, text: "Hola, autenticado" });
  const rawBody = JSON.stringify(payload);
  const signature = signBody(rawBody, "app-secret-for-tests");

  const result = await postWebhook(rawBody, { "x-hub-signature-256": signature });
  assert.equal(result.status, 200);
  assert.equal((result.json as { ok: boolean }).ok, true);

  const eventCount = await countRows(
    "SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?",
    [`meta:whatsapp:inbound:${providerMessageId}`]
  );
  assert.equal(eventCount, 1);
});

test("inauthentic POST (invalid signature) is rejected before persisting", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("forged")}`;
  const waId = `5695${String(Date.now()).slice(-8)}`;
  const payload = buildInboundPayload({ providerMessageId, waId, text: "Hola, forjado" });
  const rawBody = JSON.stringify(payload);

  const result = await postWebhook(rawBody, { "x-hub-signature-256": "sha256=deadbeef" });
  assert.equal(result.status, 401);

  const eventCount = await countRows(
    "SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?",
    [`meta:whatsapp:inbound:${providerMessageId}`]
  );
  assert.equal(eventCount, 0);
});

test("POST with zero credentials (no signature, no admin token) reaches the route's own auth and is rejected", async () => {
  const payload = buildInboundPayload({ providerMessageId: `wamid.${uniqueSuffix("nocreds")}`, waId: "569900000zz", text: "sin credenciales" });
  const result = await postWebhook(payload);
  assert.equal(result.status, 401);
  assert.equal((result.json as { error: string }).error, "missing_signature");
});

test("malformed payload (invalid JSON) fails safely without persisting", async () => {
  const rawBody = "not-json{{";
  const signature = signBody(rawBody, "app-secret-for-tests");
  const result = await postWebhook(rawBody, { "x-hub-signature-256": signature });
  assert.equal(result.status, 400);
  assert.equal((result.json as { error: string }).error, "invalid_json");
});

test("malformed payload (missing messages) is processed with zero results, no crash", async () => {
  const rawBody = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "x" } } }] }] });
  const signature = signBody(rawBody, "app-secret-for-tests");
  const result = await postWebhook(rawBody, { "x-hub-signature-256": signature });
  assert.equal(result.status, 200);
  assert.equal((result.json as { processed: number }).processed, 0);
});

test("duplicate providerMessageId does not duplicate the commercial_event row", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("dup-auth")}`;
  const waId = `5694${String(Date.now()).slice(-8)}`;
  const payload = buildInboundPayload({ providerMessageId, waId, text: "duplicado" });
  const rawBody = JSON.stringify(payload);
  const signature = signBody(rawBody, "app-secret-for-tests");

  const first = await postWebhook(rawBody, { "x-hub-signature-256": signature });
  assert.equal(first.status, 200);
  const second = await postWebhook(rawBody, { "x-hub-signature-256": signature });
  assert.equal(second.status, 200);

  const eventCount = await countRows(
    "SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?",
    [`meta:whatsapp:inbound:${providerMessageId}`]
  );
  assert.equal(eventCount, 1);
});

test("middleware lets a Meta-shaped webhook request through without any admin credential", async () => {
  const { middleware } = await import("@/middleware");
  const request = new NextRequest(new Request(WEBHOOK_URL, { method: "POST" }));
  const response = await middleware(request);
  assert.notEqual(response.status, 401);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("middleware still requires the admin credential for an unrelated /api route", async () => {
  const { middleware } = await import("@/middleware");
  const request = new NextRequest(new Request("http://127.0.0.1:3010/api/system/health", { method: "GET" }));
  const response = await middleware(request);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, "unauthorized");
});
