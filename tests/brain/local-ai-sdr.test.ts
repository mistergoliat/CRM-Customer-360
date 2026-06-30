import assert from "node:assert/strict";
import test from "node:test";
import {
  extractEmailCandidates,
  isExplicitCustomerConfirmation,
  localPublicId,
  normalizeIso
} from "../../lib/brain/local-ai-sdr/utils";

test("local ai sdr email extraction handles empty, single and ambiguous messages", () => {
  assert.deepEqual(extractEmailCandidates("Hola"), { status: "absent", emails: [] });
  assert.deepEqual(extractEmailCandidates("Mi correo es CAMILA@Example.Test"), {
    status: "single",
    emails: ["camila@example.test"]
  });
  assert.equal(extractEmailCandidates("uno@test.com y dos@test.com").status, "ambiguous");
});

test("local ai sdr confirmation detection accepts explicit yes and rejects negatives", () => {
  assert.equal(isExplicitCustomerConfirmation("sí, créala").status, "explicit");
  assert.equal(isExplicitCustomerConfirmation("no sé").status, "negative");
});

test("local ai sdr ids and timestamps are normalized", () => {
  const first = localPublicId("conv", ["abc", 123]);
  const second = localPublicId("conv", ["abc", 123]);
  assert.equal(first, second);
  assert.match(first, /^conv-[a-f0-9]{24}$/);
  assert.match(normalizeIso("2026-06-24T12:00:00.000Z"), /^2026-06-24T12:00:00\.000Z$/);
});
