import { runMigrations } from "./db-migrate";
import { createConnection, loadLocalEnv, resolveAppConnection } from "./db-utils";
import { testAdminPermissions, testAppPermissions } from "./db-permissions";

const REQUIRED_TABLES = [
  "schema_migrations",
  "master_customer",
  "customer_external_identity",
  "conversation",
  "conversation_message",
  "crm_opportunities",
  "crm_sales_need_profiles",
  "crm_agent_actions",
  "crm_agent_decisions",
  "commercial_event",
  "brain_message_outbox",
  "hub_audit_log",
  "ai_agent_execution",
  "ai_agent_decision",
  "ai_tool_execution",
  "ai_conversation_state"
];

async function assertExpectedTables() {
  const connection = await createConnection(resolveAppConnection(), false);
  try {
    const [rows] = await connection.query("SHOW TABLES");
    const tableNames = new Set((rows as Array<Record<string, string>>).map((row) => Object.values(row)[0]));
    const missing = REQUIRED_TABLES.filter((table) => !tableNames.has(table));
    if (missing.length > 0) {
      throw new Error(`Missing expected tables after bootstrap: ${missing.join(", ")}`);
    }
    await connection.query("SELECT 1");
    console.log(`[smoke] ok: ${REQUIRED_TABLES.length} expected tables present, crm_app can connect and query.`);
  } finally {
    await connection.end();
  }
}

async function main() {
  await loadLocalEnv();

  console.log("[smoke] applying migrations against the dev target (main_management)...");
  await runMigrations(["--database=dev"]);

  console.log("[smoke] checking expected tables and app connectivity...");
  await assertExpectedTables();

  console.log("[smoke] checking crm_app write/no-DDL permission boundary...");
  await testAppPermissions();

  console.log("[smoke] checking crm_dev_admin DDL permission...");
  await testAdminPermissions();

  console.log("[smoke] PASS: clean-volume bootstrap is reproducible (database, user, grants, migrations, app connection).");
}

main().catch((error) => {
  console.error("[smoke] FAIL:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
