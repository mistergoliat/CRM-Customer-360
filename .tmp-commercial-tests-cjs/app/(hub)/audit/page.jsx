"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AuditPage;
const db_1 = require("@/lib/db");
const PageHeader_1 = require("@/components/ui/PageHeader");
const AuditTable_1 = require("@/components/ui/AuditTable");
const ErrorState_1 = require("@/components/ui/ErrorState");
async function AuditPage() {
    const rows = await (0, db_1.safeQueryRows)("SELECT * FROM hub_audit_log ORDER BY created_at DESC LIMIT 200");
    return (<>
      <PageHeader_1.PageHeader eyebrow="Audit" title="Auditoría operacional" description="Eventos críticos del HUB: respuestas manuales, cierres, reaperturas, cambios de prioridad, errores DB/API y bloqueos IA." status="Activo"/>
      {rows.ok ? <AuditTable_1.AuditTable rows={rows.rows}/> : <ErrorState_1.ErrorState title="Audit log no disponible" message={rows.error}/>}
    </>);
}
