import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { resolveRuntimeOpportunity } from "@/lib/brain/commercial/runtime-opportunity/resolveRuntimeOpportunity";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

const NOW = "2026-08-31T12:00:00.000Z";

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore teardown failures
  }
});

let conversationSeq = Date.now();
function nextConversationId() {
  conversationSeq += 1;
  return conversationSeq;
}

function baseInput(conversationId: number) {
  return {
    conversationId,
    customerMasterId: null,
    waId: `569${conversationId}`,
    channel: "whatsapp",
    correlationId: `corr-${conversationId}`,
    currentTime: NOW
  };
}

async function countOpportunitiesForConversation(conversationId: number) {
  const [rows] = await getPool().execute("SELECT id FROM crm_opportunities WHERE conversation_case_id = ?", [String(conversationId)]);
  return (rows as unknown[]).length;
}

test("no prior opportunity: creates one", async () => {
  const conversationId = nextConversationId();
  const result = await resolveRuntimeOpportunity(baseInput(conversationId));
  assert.equal(result.status, "created");
  if (result.status !== "created") return;
  assert.equal(result.opportunity.status, "new");
  assert.equal(await countOpportunitiesForConversation(conversationId), 1);
});

test("active opportunity: reused, not duplicated", async () => {
  const conversationId = nextConversationId();
  const first = await resolveRuntimeOpportunity(baseInput(conversationId));
  assert.equal(first.status, "created");
  if (first.status !== "created") return;

  const second = await resolveRuntimeOpportunity(baseInput(conversationId));
  assert.equal(second.status, "existing");
  if (second.status !== "existing") return;
  assert.equal(second.opportunity.opportunityId, first.opportunity.opportunityId);
  assert.equal(second.opportunity.opportunityKey, first.opportunity.opportunityKey);
  assert.equal(await countOpportunitiesForConversation(conversationId), 1);
});

test("idempotent: repeated resolution for the same conversation never grows row count", async () => {
  const conversationId = nextConversationId();
  await resolveRuntimeOpportunity(baseInput(conversationId));
  await resolveRuntimeOpportunity(baseInput(conversationId));
  await resolveRuntimeOpportunity(baseInput(conversationId));
  assert.equal(await countOpportunitiesForConversation(conversationId), 1);
});

test("terminal opportunity: not reused, a new one is created instead", async () => {
  const conversationId = nextConversationId();
  const first = await resolveRuntimeOpportunity(baseInput(conversationId));
  assert.equal(first.status, "created");
  if (first.status !== "created") return;

  await getPool().execute("UPDATE crm_opportunities SET status = 'won', updated_at = NOW() WHERE id = ?", [first.opportunity.opportunityId]);

  const second = await resolveRuntimeOpportunity(baseInput(conversationId));
  assert.equal(second.status, "created");
  if (second.status !== "created") return;
  assert.notEqual(second.opportunity.opportunityId, first.opportunity.opportunityId);
  assert.notEqual(second.opportunity.opportunityKey, first.opportunity.opportunityKey);
  assert.equal(await countOpportunitiesForConversation(conversationId), 2);

  // The now-terminal first opportunity must never resurface as "existing" -
  // the new one is the only one a following resolution reuses.
  const third = await resolveRuntimeOpportunity(baseInput(conversationId));
  assert.equal(third.status, "existing");
  if (third.status !== "existing") return;
  assert.equal(third.opportunity.opportunityId, second.opportunity.opportunityId);
});

test("concurrent resolution for the same conversation never creates two active opportunities", async () => {
  const conversationId = nextConversationId();
  const input = baseInput(conversationId);

  const results = await Promise.all([
    resolveRuntimeOpportunity(input),
    resolveRuntimeOpportunity(input),
    resolveRuntimeOpportunity(input),
    resolveRuntimeOpportunity(input),
    resolveRuntimeOpportunity(input)
  ]);

  for (const result of results) {
    assert.notEqual(result.status, "unavailable");
  }
  const opportunityIds = new Set(
    results.map((result) => (result.status === "unavailable" ? null : result.opportunity.opportunityId))
  );
  assert.equal(opportunityIds.size, 1, "all concurrent resolutions must agree on a single opportunityId");
  assert.equal(await countOpportunitiesForConversation(conversationId), 1);
});

test("customerMasterId/waId/channel propagate onto the created row", async () => {
  const conversationId = nextConversationId();
  const input = { ...baseInput(conversationId), customerMasterId: 4242 };
  const result = await resolveRuntimeOpportunity(input);
  assert.equal(result.status, "created");
  if (result.status !== "created") return;

  const [rows] = await getPool().execute(
    "SELECT customer_master_id, wa_id, channel, conversation_case_id FROM crm_opportunities WHERE id = ?",
    [result.opportunity.opportunityId]
  );
  const row = (rows as Array<Record<string, unknown>>)[0];
  assert.equal(Number(row.customer_master_id), 4242);
  assert.equal(row.wa_id, input.waId);
  assert.equal(row.channel, "whatsapp");
  assert.equal(row.conversation_case_id, String(conversationId));
});
