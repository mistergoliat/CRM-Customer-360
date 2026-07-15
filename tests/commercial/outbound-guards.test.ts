import assert from "node:assert/strict";
import test from "node:test";
import { sendMetaWhatsAppTextMessage } from "../../lib/brain/messaging/metaClient";
import { planOutboxWorkerRun } from "../../lib/brain/messaging/outboxWorker";
import { transitionOutboxStatus } from "../../lib/brain/messaging/outboxTransitions";

test("Meta send is fail-closed when the enable flag is absent", async () => {
  const previous = process.env.BRAIN_META_SEND_ENABLED;
  delete process.env.BRAIN_META_SEND_ENABLED;
  try {
    const result = await sendMetaWhatsAppTextMessage({
      waId: "56912345678",
      phoneNumberId: "phone-001",
      messageText: "hola"
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, "disabled");
    assert.equal(result.provider_message_id ?? null, null);
  } finally {
    if (previous === undefined) {
      delete process.env.BRAIN_META_SEND_ENABLED;
    } else {
      process.env.BRAIN_META_SEND_ENABLED = previous;
    }
  }
});

test("Meta send accepts a template payload as a valid outbound shape", async () => {
  const previous = process.env.BRAIN_META_SEND_ENABLED;
  delete process.env.BRAIN_META_SEND_ENABLED;
  try {
    const result = await sendMetaWhatsAppTextMessage({
      waId: "56912345678",
      phoneNumberId: "phone-001",
      template: {
        name: "retomar_conversacion_v1",
        languageCode: "es_CL",
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: "hola" }]
          }
        ]
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, "disabled");
    assert.equal(result.meta_payload_preview?.type, "template");
    assert.equal(result.meta_payload_preview && "template" in result.meta_payload_preview, true);
  } finally {
    if (previous === undefined) {
      delete process.env.BRAIN_META_SEND_ENABLED;
    } else {
      process.env.BRAIN_META_SEND_ENABLED = previous;
    }
  }
});

test("Outbox worker is fail-closed when the enable flag is absent", async () => {
  const previous = process.env.BRAIN_OUTBOX_WORKER_ENABLED;
  delete process.env.BRAIN_OUTBOX_WORKER_ENABLED;
  try {
    const result = await planOutboxWorkerRun({ dryRun: true, lockOnly: false, debug: false });

    assert.equal(result.ok, false);
    assert.equal(result.disabled, true);
    assert.equal(result.status, "disabled");
  } finally {
    if (previous === undefined) {
      delete process.env.BRAIN_OUTBOX_WORKER_ENABLED;
    } else {
      process.env.BRAIN_OUTBOX_WORKER_ENABLED = previous;
    }
  }
});

// ACS-R1-05-T06.1 (P1-5 pilot isolation, layer 4 - final defense). This
// layer was already fail-closed before T06.1 (getAllowedRecipients returns
// blocked_by_policy on an empty OR non-matching allowlist) - these tests
// pin that behavior down explicitly as the last line of defense: even if an
// unauthorized row somehow reached this layer (a bug in an earlier gate),
// no real HTTP call to Meta ever happens. META_WHATSAPP_ACCESS_TOKEN is
// deleted too, so even a policy-check regression could never reach fetch().
function withMetaEnv(overrides: Record<string, string | undefined>, run: () => Promise<void>) {
  const keys = ["BRAIN_META_SEND_ENABLED", "BRAIN_AUTONOMOUS_TEST_WA_IDS", "BRAIN_WHATSAPP_ALLOWED_WA_IDS", "META_WHATSAPP_ACCESS_TOKEN", "META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  return run().finally(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

test("[T06.1] final defense: Meta send is blocked when no allowlist is configured, even with sending enabled", async () =>
  withMetaEnv({ BRAIN_META_SEND_ENABLED: "true" }, async () => {
    const result = await sendMetaWhatsAppTextMessage({ waId: "56912345678", phoneNumberId: "phone-001", messageText: "hola" });
    assert.equal(result.ok, false);
    assert.equal(result.status, "blocked_by_policy");
    assert.equal(result.provider_message_id ?? null, null);
  }));

test("[T06.1] final defense: Meta send is blocked for a wa_id outside the configured allowlist, even with sending enabled", async () =>
  withMetaEnv({ BRAIN_META_SEND_ENABLED: "true", BRAIN_AUTONOMOUS_TEST_WA_IDS: "56900000000" }, async () => {
    const result = await sendMetaWhatsAppTextMessage({ waId: "56912345678", phoneNumberId: "phone-001", messageText: "hola" });
    assert.equal(result.ok, false);
    assert.equal(result.status, "blocked_by_policy");
    assert.equal(result.provider_message_id ?? null, null);
  }));

test("Outbox transition rules include planned -> locked and locked -> cancelled", () => {
  const plannedToLocked = transitionOutboxStatus({
    dedupeKey: "dedupe-1",
    fromStatus: "planned",
    toStatus: "locked"
  });
  const lockedToCancelled = transitionOutboxStatus({
    dedupeKey: "dedupe-2",
    fromStatus: "locked",
    toStatus: "cancelled"
  });
  const plannedToSent = transitionOutboxStatus({
    dedupeKey: "dedupe-3",
    fromStatus: "planned",
    toStatus: "sent"
  });

  assert.equal(plannedToLocked.allowed, true);
  assert.equal(lockedToCancelled.allowed, true);
  assert.equal(plannedToSent.allowed, false);
});
