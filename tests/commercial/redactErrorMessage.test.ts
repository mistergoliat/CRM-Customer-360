import assert from "node:assert/strict";
import test from "node:test";
import { redactErrorMessage } from "@/lib/brain/commercial/redactErrorMessage";

// ACS-R1-05-T06/T06.1 (P1-2). Shared redaction used by runFollowupTick.ts,
// persistActionOutcome.ts#markActionFailed and autonomousOutboxTick.ts,
// previously writing error.message straight into crm_agent_actions.
// failure_reason / brain_message_outbox.error_message / crm_action_executions.
// error_message without any sanitization.

test("[1] redacts a Bearer token", () => {
  const result = redactErrorMessage(new Error("request failed: Authorization: Bearer not-a-real-secret.fixture-000"));
  assert.ok(!result.includes("not-a-real-secret"));
  assert.ok(result.includes("Bearer [redacted]") || result.includes("[redacted]"));
});

test("[2] redacts an sk- style API key", () => {
  const result = redactErrorMessage("invalid key sk-ABC123xyz_789 provided");
  assert.ok(!result.includes("sk-ABC123xyz_789"));
  assert.ok(result.includes("[redacted]"));
});

test("[3] redacts token=/secret=/password= style key-value pairs", () => {
  const result = redactErrorMessage("connection string token=super-secret-value failed");
  assert.ok(!result.includes("super-secret-value"));
});

test("[4] leaves a plain, non-sensitive error message untouched", () => {
  assert.equal(redactErrorMessage("ECONNREFUSED 127.0.0.1:3306"), "ECONNREFUSED 127.0.0.1:3306");
});

test("[5] accepts a raw string, not only an Error instance", () => {
  assert.equal(redactErrorMessage("plain string error"), "plain string error");
});

test("[6] redacts an email address", () => {
  const result = redactErrorMessage("delivery failed for contact billing@example.com, invalid recipient");
  assert.ok(!result.includes("billing@example.com"));
  assert.ok(result.includes("[redacted-email]"));
});

test("[7] redacts an 8+ digit phone-like sequence, formatted or not", () => {
  const plain = redactErrorMessage("Meta rejected recipient 56912345678: invalid number");
  assert.ok(!plain.includes("56912345678"));
  assert.ok(plain.includes("[redacted-phone]"));

  const formatted = redactErrorMessage("Meta rejected recipient +56 9 1234 5678: invalid number");
  assert.ok(!formatted.includes("1234 5678"));
  assert.ok(formatted.includes("[redacted-phone]"));
});

test("[8] a short digit run (HTTP status, port) is left untouched - only 8+ digit runs are treated as phone-like", () => {
  assert.equal(redactErrorMessage("Meta Graph API HTTP 500"), "Meta Graph API HTTP 500");
  assert.equal(redactErrorMessage("ECONNREFUSED 127.0.0.1:3306"), "ECONNREFUSED 127.0.0.1:3306");
});

test("[9] a single Meta error combining a Bearer token, an email and a phone number is fully redacted", () => {
  const result = redactErrorMessage(
    "Meta rejected the request for recipient 56912345678 (contact billing@example.com), Authorization: Bearer not-a-real-secret.fixture-000"
  );
  for (const sensitive of ["56912345678", "billing@example.com", "not-a-real-secret.fixture-000"]) {
    assert.ok(!result.includes(sensitive), `must not contain "${sensitive}"`);
  }
});
