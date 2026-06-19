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
