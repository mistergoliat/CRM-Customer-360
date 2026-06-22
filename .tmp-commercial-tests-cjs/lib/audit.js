"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAuditTable = ensureAuditTable;
exports.auditLog = auditLog;
const headers_1 = require("next/headers");
const db_1 = require("./db");
const write_access_1 = require("./write-access");
async function ensureAuditTable() {
    await (0, db_1.queryRows)(`
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
async function auditLog(input) {
    try {
        if (!(0, write_access_1.isDbWriteEnabled)())
            return;
        const auditTableExists = await (0, db_1.hasTable)("hub_audit_log");
        if (!auditTableExists)
            return;
        await ensureAuditTable();
        const headerBag = await (0, headers_1.headers)();
        const ip = headerBag.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerBag.get("x-real-ip") ?? null;
        const userAgent = headerBag.get("user-agent") ?? null;
        await (0, db_1.insertExistingColumns)("hub_audit_log", {
            action: input.action,
            entity_type: input.entityType,
            entity_id: input.entityId === undefined || input.entityId === null ? null : String(input.entityId),
            before_json: input.before === undefined ? null : JSON.stringify(input.before),
            after_json: input.after === undefined ? null : JSON.stringify(input.after),
            ip_address: ip,
            user_agent: userAgent,
            created_at: "__CHILE_NOW__"
        });
    }
    catch (error) {
        console.error("audit_log_failed", (0, db_1.sanitizeDbError)(error));
    }
}
