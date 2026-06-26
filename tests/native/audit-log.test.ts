import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { auditLog } from "@/lib/audit";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

test("auditLog writes a real row under crm_app's minimal grants (successful write)", async () => {
  const entityId = uniqueSuffix("audit-success");
  await auditLog({
    action: "customer.created",
    entityType: "test_probe",
    entityId,
    after: { probe: true }
  });

  const rows = await safeQueryRows<{ id: number; action: string }>(
    "SELECT id, action FROM hub_audit_log WHERE entity_type = 'test_probe' AND entity_id = ? LIMIT 1",
    [entityId]
  );
  assert.ok(rows.ok, rows.ok ? "" : rows.error);
  assert.ok(rows.rows[0]?.id, "expected auditLog to persist a real row, not fail silently");
  assert.equal(rows.rows[0]?.action, "customer.created");
});

test("auditLog degrades on failure: never throws, logs the failure observably, and writes nothing", async () => {
  const entityId = uniqueSuffix("audit-failure");
  const circular: Record<string, unknown> = { probe: true };
  circular.self = circular; // forces JSON.stringify to throw inside auditLog's try block

  const originalConsoleError = console.error;
  const captured: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    captured.push(args);
  };

  try {
    await assert.doesNotReject(
      auditLog({
        action: "customer.created",
        entityType: "test_probe_failure",
        entityId,
        after: circular
      })
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.ok(captured.length > 0, "expected the failure to be logged observably");
  assert.equal(captured[0][0], "audit_log_failed");

  const rows = await safeQueryRows<{ id: number }>(
    "SELECT id FROM hub_audit_log WHERE entity_type = 'test_probe_failure' AND entity_id = ? LIMIT 1",
    [entityId]
  );
  assert.ok(rows.ok, rows.ok ? "" : rows.error);
  assert.equal(rows.rows[0], undefined, "a failed audit write must not leave a partial row");
});
