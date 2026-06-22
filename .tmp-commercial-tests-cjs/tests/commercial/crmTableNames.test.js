"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_test_1 = __importDefault(require("node:test"));
const ROOT = process.cwd();
const OLD_OPPORTUNITY_TABLE = ["commercial", "opportunities"].join("_");
const OLD_DECISION_TABLE = ["commercial", "agent", "decisions"].join("_");
function read(relativePath) {
    return (0, node_fs_1.readFileSync)(`${ROOT}/${relativePath}`, "utf8");
}
(0, node_test_1.default)("operational loop SQL uses crm table names", () => {
    const loadSource = read("lib/brain/commercial/operational-loop/loadCommercialState.ts");
    const persistSource = read("lib/brain/commercial/operational-loop/persistCommercialState.ts");
    for (const source of [loadSource, persistSource]) {
        strict_1.default.match(source, /crm_opportunities/);
        strict_1.default.match(source, /crm_agent_decisions/);
        strict_1.default.doesNotMatch(source, new RegExp(OLD_OPPORTUNITY_TABLE));
        strict_1.default.doesNotMatch(source, new RegExp(OLD_DECISION_TABLE));
    }
});
(0, node_test_1.default)("migration 004 is aligned to crm table names", () => {
    const migration = read("migrations/004_ai_sdr_operational_loop.sql");
    strict_1.default.match(migration, /CREATE TABLE IF NOT EXISTS crm_opportunities/);
    strict_1.default.match(migration, /CREATE TABLE IF NOT EXISTS crm_agent_decisions/);
    strict_1.default.match(migration, /REFERENCES crm_opportunities \(id\)/);
    strict_1.default.doesNotMatch(migration, new RegExp(OLD_OPPORTUNITY_TABLE));
    strict_1.default.doesNotMatch(migration, new RegExp(OLD_DECISION_TABLE));
});
(0, node_test_1.default)("migration 005 is aligned to crm_agent_actions", () => {
    const migration = read("migrations/005_crm_agent_actions.sql");
    strict_1.default.match(migration, /CREATE TABLE IF NOT EXISTS crm_agent_actions/);
    strict_1.default.match(migration, /UNIQUE KEY uq_crm_agent_actions_action_id/);
    strict_1.default.match(migration, /UNIQUE KEY uq_crm_agent_actions_idempotency_key/);
    strict_1.default.match(migration, /FOREIGN KEY \(opportunity_id\)/);
    strict_1.default.match(migration, /FOREIGN KEY \(decision_row_id\)/);
    strict_1.default.doesNotMatch(migration, /crm_followup_tasks/);
    strict_1.default.doesNotMatch(migration, new RegExp(OLD_OPPORTUNITY_TABLE));
    strict_1.default.doesNotMatch(migration, new RegExp(OLD_DECISION_TABLE));
});
