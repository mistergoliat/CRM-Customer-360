import type { DbRow } from "@/lib/db";
import type { SourceQueueDetail } from "@/lib/case-detail";
import { CaseDetailField, CasePanelFrame } from "./CaseDetailPrimitives";

export function CaseServicePanel({ row, sourceQueue }: { row: DbRow; sourceQueue: SourceQueueDetail | null }) {
  return (
    <CasePanelFrame title="Servicio y fuente" description="Datos de routing, origen y cola legacy util para operacion humana." accent="blue">
      <div className="grid gap-3">
        <CaseDetailField label="Service code" value={row.service_code} />
        <CaseDetailField label="Department" value={row.department} />
        <CaseDetailField label="Channel" value={row.channel} />
        <CaseDetailField label="Platform" value={row.platform} />
        <CaseDetailField label="Assigned to" value={row.assigned_to} />
        <CaseDetailField label="Source table" value={row.source_table} mono />
        <CaseDetailField label="Source ID" value={row.source_id} mono />
        <CaseDetailField label="Legacy queue" value={sourceQueue?.source_domain} />
        <CaseDetailField label="Canal derivacion" value={sourceQueue?.canal_derivacion} />
        <CaseDetailField label="Last intent legacy" value={sourceQueue?.last_intent ?? row.last_intent ?? row.first_intent} />
      </div>
    </CasePanelFrame>
  );
}
