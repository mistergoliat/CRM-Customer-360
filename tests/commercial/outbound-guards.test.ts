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
