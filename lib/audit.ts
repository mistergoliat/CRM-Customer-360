import { headers } from "next/headers";
import { hasTable, insertExistingColumns, queryRows, sanitizeDbError } from "./db";
import { isDbWriteEnabled } from "./write-access";

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
  | "outbox.window_closed.escalated";

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
}) {
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
