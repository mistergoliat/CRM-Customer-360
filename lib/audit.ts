import type { PoolConnection } from "mysql2/promise";
import { headers } from "next/headers";
import { chileNowSql, hasTable, insertExistingColumns, queryRows, sanitizeDbError } from "./db";
import { isDbWriteEnabled } from "./write-access";

/** Minimal surface a caller's own transaction connection needs to expose. */
type AuditConnection = Pick<PoolConnection, "execute">;

export type AuditAction =
  | "manual_reply_sent"
  | "manual_reply_failed"
  | "case_closed"
  | "case_reopened"
  | "case_priority_changed"
  | "ai_blocked"
  | "api_error"
  | "meta_send_error"
  | "db_query_error"
  | "customer.created"
  | "ai_sdr.decision.created"
  | "ai_sdr.tool.requested"
  | "ai_sdr.tool.executed"
  | "ai_sdr.tool.failed"
  | "customer.lookup.completed"
  | "customer.creation.offered"
  | "customer.creation.confirmed"
  | "customer.linked"
  | "customer.link.failed"
  | "customer.identity_conflict"
  | "customer.identity_unresolved"
  | "ai_sdr.handoff.requested"
  | "whatsapp.delivery_status.applied"
  | "conversation.control.take"
  | "conversation.control.release"
  | "conversation.control.pause"
  | "conversation.control.close"
  | "conversation.control.reopen"
  | "outbox.send.cancelled"
  | "outbox.send.escalated"
  | "outbox.sent_after_cancel"
  | "outbox.window_closed.escalated"
  | "whatsapp.inbound.rejected"
  | "sales_agent_configuration.created"
  | "sales_agent_configuration.updated"
  | "sales_agent_configuration.published"
  | "sales_agent_configuration.archived";

export async function ensureAuditTable() {
  await queryRows(`
    CREATE TABLE IF NOT EXISTS hub_audit_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NULL,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(100) NOT NULL,
      entity_id VARCHAR(100) NULL,
      before_json JSON NULL,
      after_json JSON NULL,
      ip_address VARCHAR(100) NULL,
      user_agent TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function auditLog(input: {
  action: AuditAction;
  entityType: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  /**
   * When provided, the audit row is written on this connection instead of
   * the shared pool - so a caller inside its own transaction (e.g.
   * publishing a Sales Agent Configuration, ACS-R1-05.1-T02.3A) gets the
   * audit write inside that same commit/rollback boundary, never a second
   * writer racing the domain write. HTTP request context (ip/user-agent) is
   * skipped in this mode: a transactional domain write is not itself an
   * HTTP handler, and calling headers() there would either throw outside a
   * request scope or attribute the row to the wrong request.
   */
  connection?: AuditConnection;
}) {
  if (input.connection) {
    // Transactional path: errors are never swallowed here - the caller's
    // transaction is expected to commit atomically with this audit row, so
    // a failed write must roll back the whole transaction, not be logged
    // and ignored like the fire-and-forget pool path below.
    if (!isDbWriteEnabled()) return;
    const auditTableExists = await hasTable("hub_audit_log");
    if (!auditTableExists) return;

    await input.connection.execute(
      `INSERT INTO hub_audit_log (action, entity_type, entity_id, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, ${chileNowSql()})`,
      [
        input.action,
        input.entityType,
        input.entityId === undefined || input.entityId === null ? null : String(input.entityId),
        input.before === undefined ? null : JSON.stringify(input.before),
        input.after === undefined ? null : JSON.stringify(input.after)
      ]
    );
    return;
  }

  try {
    if (!isDbWriteEnabled()) return;
    const auditTableExists = await hasTable("hub_audit_log");
    if (!auditTableExists) return;

    // Do not call ensureAuditTable() here: the table already exists (just
    // confirmed above), and CREATE TABLE requires a privilege the app's
    // minimal-grant DB user intentionally does not have, which made every
    // audit write silently fail under those grants.
    let ip: string | null = null;
    let userAgent: string | null = null;
    try {
      const headerBag = await headers();
      ip = headerBag.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerBag.get("x-real-ip") ?? null;
      userAgent = headerBag.get("user-agent") ?? null;
    } catch (error) {
      if (!(error instanceof Error) || !/outside a request scope/i.test(error.message)) {
        throw error;
      }
    }

    await insertExistingColumns("hub_audit_log", {
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId === undefined || input.entityId === null ? null : String(input.entityId),
      before_json: input.before === undefined ? null : JSON.stringify(input.before),
      after_json: input.after === undefined ? null : JSON.stringify(input.after),
      ip_address: ip,
      user_agent: userAgent,
      created_at: "__CHILE_NOW__"
    });
  } catch (error) {
    console.error("audit_log_failed", sanitizeDbError(error));
  }
}
