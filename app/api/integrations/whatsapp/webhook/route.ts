import crypto from "node:crypto";
import { processNativeWhatsAppInbound, applyMetaDeliveryStatus } from "@/lib/brain/native-whatsapp";
import { normalizeWhatsAppRecipientDigits } from "@/lib/brain/messaging/whatsapp-transport/constants";

function parseCsv(value: string | undefined | null) {
  if (!value) return [];
  return value
    .split(/[\s,]+/g)
    .map((item) => normalizeWhatsAppRecipientDigits(item) ?? item.trim())
    .filter((item): item is string => Boolean(item));
}

function getAllowlist() {
  return [...new Set([...parseCsv(process.env.BRAIN_WHATSAPP_ALLOWED_WA_IDS), ...parseCsv(process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS)])];
}

function isAllowedRecipient(value: string) {
  const allowlist = getAllowlist();
  if (allowlist.length === 0) return true;
  const normalized = normalizeWhatsAppRecipientDigits(value) ?? value.trim();
  return allowlist.includes(normalized);
}

function verifyMetaSignature(rawBody: string, signatureHeader: string | null) {
  const appSecret = process.env.META_WHATSAPP_APP_SECRET?.trim() || process.env.BRAIN_META_WHATSAPP_APP_SECRET?.trim() || null;
  if (!appSecret) {
    return { ok: true as const, warning: "meta_signature_secret_not_configured" };
  }
  if (!signatureHeader) {
    return { ok: false as const, warning: "missing_signature" };
  }
  const [algorithm, digest] = signatureHeader.split("=", 2);
  if (algorithm !== "sha256" || !digest) {
    return { ok: false as const, warning: "invalid_signature_format" };
  }
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const actual = Buffer.from(digest, "hex");
  const target = Buffer.from(expected, "hex");
  if (actual.length !== target.length || !crypto.timingSafeEqual(actual, target)) {
    return { ok: false as const, warning: "invalid_signature" };
  }
  return { ok: true as const, warning: null };
}

function toIsoTimestamp(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return new Date(parsed * 1000).toISOString();
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  return new Date().toISOString();
}

function extractMessages(payload: Record<string, unknown>) {
  const entries = (Array.isArray(payload.entry) ? (payload.entry as unknown[]) : []) as unknown[];
  const messages: Array<Record<string, unknown>> = [];
  const statuses: Array<Record<string, unknown>> = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const entryRecord = entry as Record<string, unknown>;
    const changes = (Array.isArray(entryRecord.changes) ? (entryRecord.changes as unknown[]) : []) as unknown[];
    for (const change of changes) {
      if (!change || typeof change !== "object" || Array.isArray(change)) continue;
      const value = (change as Record<string, unknown>).value;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const valueRecord = value as Record<string, unknown>;
      const nextMessages = (Array.isArray(valueRecord.messages) ? (valueRecord.messages as unknown[]) : []) as unknown[];
      const nextStatuses = (Array.isArray(valueRecord.statuses) ? (valueRecord.statuses as unknown[]) : []) as unknown[];
      for (const message of nextMessages) {
        if (message && typeof message === "object" && !Array.isArray(message)) messages.push(message as Record<string, unknown>);
      }
      for (const status of nextStatuses) {
        if (status && typeof status === "object" && !Array.isArray(status)) statuses.push(status as Record<string, unknown>);
      }
    }
  }

  return { messages, statuses };
}

function extractPrimaryChangeValue(payload: Record<string, unknown>) {
  const entries = (Array.isArray(payload.entry) ? (payload.entry as unknown[]) : []) as unknown[];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const entryRecord = entry as Record<string, unknown>;
    const changes = (Array.isArray(entryRecord.changes) ? (entryRecord.changes as unknown[]) : []) as unknown[];
    for (const change of changes) {
      if (!change || typeof change !== "object" || Array.isArray(change)) continue;
      const value = (change as Record<string, unknown>).value;
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    }
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const verifyToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const configuredToken = process.env.META_WHATSAPP_VERIFY_TOKEN?.trim() || process.env.BRAIN_META_WHATSAPP_VERIFY_TOKEN?.trim() || null;

  if (!configuredToken) {
    return Response.json({ ok: false, error: "verify_token_not_configured" }, { status: 500 });
  }

  if (mode !== "subscribe" || verifyToken !== configuredToken || !challenge) {
    return Response.json({ ok: false, error: "verification_failed" }, { status: 403 });
  }

  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-hub-signature-256");
  const signature = verifyMetaSignature(rawBody, signatureHeader);
  if (!signature.ok) {
    return Response.json({ ok: false, error: signature.warning }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const { messages, statuses } = extractMessages(payload);
  const primaryValue = extractPrimaryChangeValue(payload);
  const results: Record<string, unknown>[] = [];
  const warnings = signature.warning ? [signature.warning] : [];

  for (const message of messages) {
    const providerMessageId = typeof message.id === "string" ? message.id : null;
    const phoneNumberId = typeof primaryValue?.metadata === "object" && !Array.isArray(primaryValue.metadata) && typeof (primaryValue.metadata as Record<string, unknown>).phone_number_id === "string"
      ? String((primaryValue.metadata as Record<string, unknown>).phone_number_id)
      : null;
    const from = typeof message.from === "string" ? message.from : null;
    const messageType = typeof message.type === "string" ? message.type : "text";
    const occurredAt = toIsoTimestamp((message as Record<string, unknown>).timestamp);
    const contacts = Array.isArray(primaryValue?.contacts) ? primaryValue.contacts : [];
    const senderName = contacts.find((contact) => contact && typeof contact === "object" && !Array.isArray(contact) && String((contact as Record<string, unknown>).wa_id ?? "") === String(from ?? "")) as Record<string, unknown> | undefined;
    const profileName = senderName && senderName.profile && typeof senderName.profile === "object" && !Array.isArray(senderName.profile) ? String((senderName.profile as Record<string, unknown>).name ?? "") : null;
    const allowed = from ? isAllowedRecipient(from) : false;

    if (!providerMessageId || !phoneNumberId || !from) {
      results.push({ kind: "inbound", ok: false, error: "missing_inbound_fields" });
      continue;
    }

    if (!allowed) {
      results.push({ kind: "inbound", ok: false, error: "sender_not_allowed", providerMessageId });
      continue;
    }

    const text = message.text && typeof message.text === "object" && !Array.isArray(message.text)
      ? String((message.text as Record<string, unknown>).body ?? "")
      : typeof message.body === "string"
        ? message.body
        : "";

    const result = await processNativeWhatsAppInbound({
      providerMessageId,
      phoneNumberId,
      externalSenderId: from,
      senderPhone: from,
      senderName: profileName,
      messageType,
      text,
      occurredAt,
      rawPayload: message
    });
    results.push({ kind: "inbound", ok: true, ...result });
  }

  for (const status of statuses) {
    const providerMessageId = typeof status.id === "string" ? status.id : null;
    const providerStatus = typeof status.status === "string" ? status.status : null;
    if (!providerMessageId || !providerStatus || !["sent", "delivered", "read", "failed"].includes(providerStatus)) {
      results.push({ kind: "status", ok: false, error: "invalid_status_payload" });
      continue;
    }

    const result = await applyMetaDeliveryStatus({
      providerMessageId,
      status: providerStatus as "sent" | "delivered" | "read" | "failed",
      occurredAt: toIsoTimestamp(status.timestamp),
      rawPayload: status
    });
    results.push({ kind: "status", ...result });
  }

  return Response.json({
    ok: true,
    warnings,
    processed: results.length,
    results
  });
}
