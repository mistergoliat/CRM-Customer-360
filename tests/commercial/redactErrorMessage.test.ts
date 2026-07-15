import assert from "node:assert/strict";
import test from "node:test";
import { redactErrorMessage } from "@/lib/brain/commercial/redactErrorMessage";

// ACS-R1-05-T06 (P1-2). Shared redaction used by runFollowupTick.ts and
// persistActionOutcome.ts#markActionFailed, previously writing error.message
// straight into crm_agent_actions.failure_reason without any sanitization.

test("[1] redacts a Bearer token", () => {
  const result = redactErrorMessage(new Error("request failed: Authorization: Bearer abc123.def-456_ghi"));
  assert.ok(!result.includes("abc123"));
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
