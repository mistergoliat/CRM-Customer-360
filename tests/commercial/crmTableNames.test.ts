import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = process.cwd();
const OLD_OPPORTUNITY_TABLE = ["commercial", "opportunities"].join("_");
const OLD_DECISION_TABLE = ["commercial", "agent", "decisions"].join("_");

function read(relativePath: string) {
  return readFileSync(`${ROOT}/${relativePath}`, "utf8");
}

test("operational loop SQL uses crm table names", () => {
  const loadSource = read("lib/brain/commercial/operational-loop/loadCommercialState.ts");
  const persistSource = read("lib/brain/commercial/operational-loop/persistCommercialState.ts");

  for (const source of [loadSource, persistSource]) {
    assert.match(source, /crm_opportunities/);
    assert.match(source, /crm_agent_decisions/);
    assert.doesNotMatch(source, new RegExp(OLD_OPPORTUNITY_TABLE));
    assert.doesNotMatch(source, new RegExp(OLD_DECISION_TABLE));
  }
});

test("migration 004 is aligned to crm table names", () => {
  const migration = read("migrations/004_ai_sdr_operational_loop.sql");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS crm_opportunities/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS crm_agent_decisions/);
  assert.match(migration, /REFERENCES crm_opportunities \(id\)/);
  assert.doesNotMatch(migration, new RegExp(OLD_OPPORTUNITY_TABLE));
  assert.doesNotMatch(migration, new RegExp(OLD_DECISION_TABLE));
});

test("migration 005 is aligned to crm_agent_actions", () => {
  const migration = read("migrations/005_crm_agent_actions.sql");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS crm_agent_actions/);
  assert.match(migration, /UNIQUE KEY uq_crm_agent_actions_action_id/);
  assert.match(migration, /UNIQUE KEY uq_crm_agent_actions_idempotency_key/);
  assert.match(migration, /FOREIGN KEY \(opportunity_id\)/);
  assert.match(migration, /FOREIGN KEY \(decision_row_id\)/);
  assert.doesNotMatch(migration, /crm_followup_tasks/);
  assert.doesNotMatch(migration, new RegExp(OLD_OPPORTUNITY_TABLE));
  assert.doesNotMatch(migration, new RegExp(OLD_DECISION_TABLE));
});

test("migration 011 introduces commercial_event as an append-only event store", () => {
  const migration = read("migrations/011_commercial_event.sql");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS commercial_event/);
  assert.match(migration, /UNIQUE KEY uq_commercial_event_dedupe_key/);
  assert.match(migration, /KEY idx_commercial_event_correlation_id/);
  assert.match(migration, /KEY idx_commercial_event_conversation_id/);
  assert.match(migration, /KEY idx_commercial_event_opportunity_id/);
  assert.match(migration, /KEY idx_commercial_event_event_type/);
  assert.match(migration, /KEY idx_commercial_event_occurred_at/);
  assert.doesNotMatch(migration, /UPDATE commercial_event/);
  assert.doesNotMatch(migration, /DELETE FROM commercial_event/);
});

test("commercial_event repository stays append-only and duplicate-safe", () => {
  const repository = read("lib/brain/commercial/events/repository.ts");

  assert.match(repository, /INSERT IGNORE INTO/i);
  assert.match(repository, /COMMERCIAL_EVENT_TABLE/);
  assert.match(repository, /dedupe_key/);
  assert.match(repository, /duplicate/);
  assert.doesNotMatch(repository, /UPDATE\s+commercial_event/i);
  assert.doesNotMatch(repository, /DELETE\s+FROM\s+commercial_event/i);
});
