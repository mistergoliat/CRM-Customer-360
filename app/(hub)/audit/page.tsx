import { safeQueryRows } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { AuditTable } from "@/components/ui/AuditTable";
import { ErrorState } from "@/components/ui/ErrorState";

export default async function AuditPage() {
  const rows = await safeQueryRows("SELECT * FROM hub_audit_log ORDER BY created_at DESC LIMIT 200");
  return (
    <>
      <PageHeader
        eyebrow="Audit"
        title="Auditoría operacional"
        description="Eventos críticos del HUB: respuestas manuales, cierres, reaperturas, cambios de prioridad, errores DB/API y bloqueos IA."
        status="Activo"
      />
      {rows.ok ? <AuditTable rows={rows.rows} /> : <ErrorState title="Audit log no disponible" message={rows.error} />}
    </>
  );
}
