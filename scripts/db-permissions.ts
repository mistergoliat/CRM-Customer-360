import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectAsRoot, createConnection, loadLocalEnv, resolveAppConnection } from "./db-utils";

export async function testAppPermissions() {
  const connection = await createConnection(resolveAppConnection(), true);
  const probeEmail = `permission-probe-${Date.now()}@example.test`;
  try {
    await connection.query("SELECT 1");
    await connection.query(
      "INSERT INTO master_customer (firstname, lastname, email, platform_origin) VALUES (?, ?, ?, ?)",
      ["Permission", "Probe", probeEmail, "hub"]
    );
    await connection.query("UPDATE master_customer SET firstname = ? WHERE email = ?", ["Permission Updated", probeEmail]);
    await connection.query("DELETE FROM master_customer WHERE email = ?", [probeEmail]);

    const denyChecks = [
      "CREATE TABLE crm_permission_probe (id INT)",
      "ALTER TABLE master_customer ADD COLUMN permission_probe INT NULL",
      "DROP TABLE crm_permission_probe"
    ];
    for (const sql of denyChecks) {
      let denied = false;
      try {
        await connection.query(sql);
      } catch {
        denied = true;
      }
      if (!denied) {
        throw new Error(`crm_app unexpectedly allowed: ${sql}`);
      }
    }

    console.log("crm_app permissions: ok");
  } finally {
    await connection.query("DELETE FROM master_customer WHERE email = ?", [probeEmail]).catch(() => undefined);
    await connection.end();
  }
}

export async function testAdminPermissions() {
  const connection = await connectAsRoot();
  try {
    await connection.query("USE main_management");
    await connection.query("CREATE TABLE IF NOT EXISTS crm_permission_probe (id INT PRIMARY KEY)");
    await connection.query("DROP TABLE IF EXISTS crm_permission_probe");
    console.log("main_management admin/root permissions: ok");
  } finally {
    await connection.end();
  }
}

async function main() {
  await loadLocalEnv();
  await testAppPermissions();
  await testAdminPermissions();
}

const isDirectRun = process.argv[1] ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
