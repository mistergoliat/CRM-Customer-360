import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldTriggerSessionCompaction,
  splitForCompaction,
  SESSION_COMPACTION_MAX_RAW_MESSAGES_CEILING
} from "@/lib/brain/commercial/agent-session/sessionCompactionPolicy";
import {
  buildCompactedSessionPrefixContent,
  parseCompactedSessionPrefixContent,
  resolveValidCompactionCutoff
} from "@/lib/brain/commercial/agent-session/compactedSessionPrefixContent";

// SALES-AGENT-R3-V1.8-D7. Pure, no-DB, no-provider tests for the trigger
// decision, the split logic, and the compacted-prefix content contract.

test("[D7-P1] shouldTriggerSessionCompaction: only above the threshold", () => {
  assert.equal(shouldTriggerSessionCompaction(40, 40), false);
  assert.equal(shouldTriggerSessionCompaction(41, 40), true);
  assert.equal(shouldTriggerSessionCompaction(0, 40), false);
});

test("[D7-P2] splitForCompaction: keeps the last targetRecentMessages raw, compacts the rest", () => {
  const messages = Array.from({ length: 45 }, (_, i) => i + 1);
  const { toCompact, recentTail } = splitForCompaction(messages, 20);
  assert.equal(toCompact.length, 25);
  assert.equal(recentTail.length, 20);
  assert.deepEqual(toCompact, messages.slice(0, 25));
  assert.deepEqual(recentTail, messages.slice(25));
  // No overlap, no gap: concatenation reproduces the original ordered set exactly.
  assert.deepEqual([...toCompact, ...recentTail], messages);
});

test("[D7-P3] splitForCompaction: nothing to compact when at or under the target", () => {
  const messages = [1, 2, 3];
  assert.deepEqual(splitForCompaction(messages, 20), { toCompact: [], recentTail: [1, 2, 3] });
  assert.deepEqual(splitForCompaction(messages, 3), { toCompact: [], recentTail: [1, 2, 3] });
});

test("[D7-P4] ceiling constant leaves headroom under the transcript hard cap", () => {
  assert.ok(SESSION_COMPACTION_MAX_RAW_MESSAGES_CEILING < 100);
});

test("[D7-C1] build/parse round-trip", () => {
  const content = buildCompactedSessionPrefixContent("resumen de turnos previos");
  const parsed = parseCompactedSessionPrefixContent(content);
  assert.deepEqual(parsed, content);
});

test("[D7-C2] parse rejects missing/blank summaryText and wrong schemaVersion", () => {
  assert.equal(parseCompactedSessionPrefixContent({ schemaVersion: 1 }), null);
  assert.equal(parseCompactedSessionPrefixContent({ schemaVersion: 1, summaryText: "" }), null);
  assert.equal(parseCompactedSessionPrefixContent({ schemaVersion: 1, summaryText: "   " }), null);
  assert.equal(parseCompactedSessionPrefixContent({ schemaVersion: 2, summaryText: "x" }), null);
});

test("[D7-C3] resolveValidCompactionCutoff: null prefix, null on malformed content, real seq on valid content", () => {
  assert.equal(resolveValidCompactionCutoff(null), null);
  assert.equal(resolveValidCompactionCutoff({ throughSeq: 10, prefixJson: { schemaVersion: 1 } }), null);
  assert.equal(resolveValidCompactionCutoff({ throughSeq: 10, prefixJson: { schemaVersion: 1, summaryText: "ok" } }), 10);
});
