import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { getPool, queryRows } from "@/lib/db";
import {
  ensureCommercialWorkCase,
  findActiveCommercialWorks,
  persistCommercialWorkProjection,
  type CommercialWork
} from "@/lib/brain/commercial/work";

// SALES-AGENT-R3-P3.5. Mirrors commercialWorkRepository.test.ts's own DB
// setup - real MariaDB (crm_test), no mocks. Not executed in this session
// (no local MariaDB/Docker reachable, same limitation documented by every
// recent SALES-AGENT-R3 task - see docs/releases/SALES-AGENT-R3-P3.5-*.md).

process.env.NODE_ENV ??= "development";
process.env.DB_HOST ??= "127.0.0.1";
process.env.DB_PORT ??= "3306";
process.env.DB_NAME ??= "crm_test";
process.env.DB_USER ??= "crm_app";
process.env.DB_PASSWORD ??= "una_clave_local";

process.env.DB_URL = "";
process.env.DATABASE_URL = "";
process.env.DB_WRITE_ENABLED = "true";

const NOW = "2026-09-16T12:00:00.000Z";

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore teardown failures
  }
});

function unique(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function seedConversation() {
  const [result] = await getPool().execute(
    `INSERT INTO conversation (
      public_id, channel, provider, channel_account_id, external_contact_id,
      status, owner_type, ai_enabled, human_owner_active
    ) VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [randomUUID(), unique("phone"), unique("wa")]
  );
  return Number((result as { insertId: number }).insertId);
}

async function seedOpportunity() {
  const [result] = await getPool().execute(
    `INSERT INTO crm_opportunities (
      opportunity_key, wa_id, channel, primary_intent, status,
      requirements_json, missing_requirements_json, product_interests_json,
      objections_json, signals_json
    ) VALUES (?, ?, 'whatsapp', 'sales', 'open', JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_OBJECT())`,
    [unique("kernel-opportunity"), unique("wa")]
  );
  return Number((result as { insertId: number }).insertId);
}

async function seedFixture() {
  const conversationId = await seedConversation();
  const opportunityId = await seedOpportunity();
  return { conversationId, opportunityId };
}

function bootstrapInput(conversationId: number, opportunityId: number, correlationId = unique("correlation")) {
  return {
    conversationId,
    opportunityId,
    conversation: { id: conversationId, humanOwnerActive: false, aiEnabled: true, status: "open" },
    opportunity: { id: opportunityId, status: "open" },
    correlationId,
    now: NOW
  };
}

test("P3.5-A missing work + valid opportunity: creates exactly one ACTIVE, objective-less case", async () => {
  const { conversationId, opportunityId } = await seedFixture();
  const result = await ensureCommercialWorkCase(bootstrapInput(conversationId, opportunityId));

  if (result.result === "FAILED") throw result.error;
  assert.equal(result.result, "CREATED");
  assert.equal(result.work.status, "ACTIVE");
  assert.equal(result.work.objectives.length, 0);
  assert.equal(result.work.version, 1);
  assert.equal(result.work.conversationId, conversationId);
  assert.equal(result.work.opportunityId, opportunityId);

  const rows = await queryRows<{ count: number }>(
    "SELECT COUNT(*) AS count FROM crm_commercial_work WHERE conversation_id = ? AND opportunity_id = ?",
    [conversationId, opportunityId]
  );
  assert.equal(Number(rows[0].count), 1);
});

test("P3.5-B/H a bootstrapped case is immediately visible to findActiveCommercialWorks (NO_ACTIVE_WORK disappears)", async () => {
  const { conversationId, opportunityId } = await seedFixture();
  const created = await ensureCommercialWorkCase(bootstrapInput(conversationId, opportunityId));
  if (created.result === "FAILED") throw created.error;

  const active = await findActiveCommercialWorks({ conversationId, opportunityId, limit: 5 });
  assert.equal(active.length, 1);
  assert.equal(active[0].publicId, created.work.publicId);
});

test("P3.5-A existing work: second call reuses the same work with zero mutation", async () => {
  const { conversationId, opportunityId } = await seedFixture();
  const first = await ensureCommercialWorkCase(bootstrapInput(conversationId, opportunityId));
  if (first.result === "FAILED") throw first.error;
  assert.equal(first.result, "CREATED");

  const second = await ensureCommercialWorkCase(bootstrapInput(conversationId, opportunityId));
  if (second.result === "FAILED") throw second.error;
  assert.equal(second.result, "EXISTING");
  assert.equal(second.work.publicId, first.work.publicId);
  // Section 19 of the brief: resolving an existing case is a pure read -
  // never bumps the optimistic-concurrency version.
  assert.equal(second.work.version, first.work.version);

  const rows = await queryRows<{ count: number }>(
    "SELECT COUNT(*) AS count FROM crm_commercial_work WHERE conversation_id = ? AND opportunity_id = ?",
    [conversationId, opportunityId]
  );
  assert.equal(Number(rows[0].count), 1);
});

test("P3.5-D repeated invocation across three calls stays idempotent (one row, same publicId)", async () => {
  const { conversationId, opportunityId } = await seedFixture();
  const results = [];
  for (let i = 0; i < 3; i += 1) {
    const outcome = await ensureCommercialWorkCase(bootstrapInput(conversationId, opportunityId));
    if (outcome.result === "FAILED") throw outcome.error;
    results.push(outcome);
  }
  assert.equal(results[0].result, "CREATED");
  assert.equal(results[1].result, "EXISTING");
  assert.equal(results[2].result, "EXISTING");
  const publicIds = new Set(results.map((r) => r.work.publicId));
  assert.equal(publicIds.size, 1);
});

test("P3.5-E concurrent invocation converges on exactly one durable work", async () => {
  const { conversationId, opportunityId } = await seedFixture();
  const outcomes = await Promise.all(
    Array.from({ length: 5 }, () => ensureCommercialWorkCase(bootstrapInput(conversationId, opportunityId)))
  );
  for (const outcome of outcomes) {
    if (outcome.result === "FAILED") throw outcome.error;
  }
  const publicIds = new Set((outcomes as Array<{ result: "EXISTING" | "CREATED"; work: CommercialWork & { publicId: string } }>).map((o) => o.work.publicId));
  assert.equal(publicIds.size, 1, "concurrent bootstraps must resolve to the same work, not one row per caller");

  const createdCount = outcomes.filter((outcome) => outcome.result === "CREATED").length;
  assert.equal(createdCount, 1, "exactly one caller should win the create race");

  const rows = await queryRows<{ count: number }>(
    "SELECT COUNT(*) AS count FROM crm_commercial_work WHERE conversation_id = ? AND opportunity_id = ?",
    [conversationId, opportunityId]
  );
  assert.equal(Number(rows[0].count), 1);
});

test("P3.5-F existing durable facts (cart) are untouched by the bootstrap", async () => {
  const { conversationId, opportunityId } = await seedFixture();
  // Same anchor/fact_key convention as lib/domains/commercial-line-items -
  // "opportunity:<id>" request_id, never crm_conversation_requests.
  const factId = unique("cart-fact");
  const requestId = `opportunity:${opportunityId}`;
  await getPool().execute(
    `INSERT INTO crm_request_facts (fact_id, request_id, fact_key, value_json, status)
     VALUES (?, ?, 'commercial_line_items', JSON_OBJECT('items', JSON_ARRAY()), 'confirmed')`,
    [factId, requestId]
  );

  await ensureCommercialWorkCase(bootstrapInput(conversationId, opportunityId));

  const rows = await queryRows<{ fact_id: string; superseded_at: string | null }>(
    "SELECT fact_id, superseded_at FROM crm_request_facts WHERE request_id = ? AND fact_key = 'commercial_line_items'",
    [requestId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fact_id, factId);
  assert.equal(rows[0].superseded_at, null);
});

test("P3.5-G a terminal previous work does not block a fresh bootstrap, and lineage points at it", async () => {
  const { conversationId, opportunityId } = await seedFixture();
  const terminal = await persistCommercialWorkProjection({
    work: {
      id: `projection:${conversationId}:terminal-seed`,
      projectionVersion: 1,
      opportunityId,
      conversationId,
      sourceMessageId: null,
      sourceSequence: null,
      lastReconciledSequence: null,
      previousWorkPublicId: null,
      supersedesWorkPublicId: null,
      trigger: { type: "SYSTEM_EVENT", eventType: "test_seed", correlationId: unique("seed"), conversationId, opportunityId },
      // FAILED (not CANCELLED/COMPLETED/SUPERSEDED) deliberately: it is the
      // one terminal status ALSO included in findActiveCommercialWorks'
      // ACTIVE_WORK_STATUSES (repository.ts), so resolveCommercialWorkTarget
      // actually surfaces it as previousWork and exercises the real
      // "terminal_work" branch (reconciliation.ts) with lineage intact - a
      // CANCELLED/COMPLETED seed would be invisible to the internal lookup
      // entirely and collapse this into the plain "no_work" case already
      // covered by P3.5-A above.
      status: "FAILED",
      objectives: [
        {
          objectiveId: "seed-objective",
          type: "DISCOVER_PRODUCTS",
          origin: "system_generated",
          status: "FAILED",
          inputs: { query: "mancuernas" },
          resolvedInputs: {},
          missingRequirements: [],
          supersedesObjectiveIds: [],
          evidence: [],
          blockers: []
        }
      ],
      steps: [],
      blockers: [],
      derivedAt: NOW,
      metrics: { objectiveCount: 1, readyStepCount: 0, waitingCustomerObjectiveCount: 0, waitingSystemStepCount: 0, blockerCount: 0 }
    }
  });
  assert.equal(terminal.status, "created");

  const bootstrapped = await ensureCommercialWorkCase(bootstrapInput(conversationId, opportunityId));
  if (bootstrapped.result === "FAILED") throw bootstrapped.error;
  assert.equal(bootstrapped.result, "CREATED");
  assert.notEqual(bootstrapped.work.publicId, terminal.work.publicId);
  assert.equal(bootstrapped.work.objectives.length, 0);
  assert.equal(bootstrapped.work.previousWorkPublicId, terminal.work.publicId);
});
