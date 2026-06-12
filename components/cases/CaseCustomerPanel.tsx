import type { DbRow } from "@/lib/db";
import type { SourceQueueDetail } from "@/lib/case-detail";
import { CaseDetailField, CasePanelFrame } from "./CaseDetailPrimitives";

export function CaseCustomerPanel({ row, sourceQueue }: { row: DbRow; sourceQueue: SourceQueueDetail | null }) {
  return (
    <CasePanelFrame title="Cliente" description="Identidad disponible desde caso, WhatsApp y colas legacy." accent="slate">
      <div className="grid gap-3">
        <CaseDetailField label="Contact name" value={row.contact_name} />
        <CaseDetailField label="WA ID" value={row.wa_id} mono />
        <CaseDetailField label="Contact ID" value={row.contact_id} />
        <CaseDetailField label="Phone number ID" value={row.phone_number_id} mono />
        <CaseDetailField label="Phone normalized" value={sourceQueue?.phone_normalized} mono />
        <CaseDetailField label="Firstname" value={sourceQueue?.firstname} />
        <CaseDetailField label="Lastname" value={sourceQueue?.lastname} />
        <CaseDetailField label="Comuna" value={sourceQueue?.comuna} />
      </div>
    </CasePanelFrame>
  );
}
