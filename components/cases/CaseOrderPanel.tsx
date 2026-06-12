import type { DbRow } from "@/lib/db";
import type { SourceQueueDetail } from "@/lib/case-detail";
import { CaseDetailField, CasePanelFrame } from "./CaseDetailPrimitives";

export function CaseOrderPanel({ row, sourceQueue }: { row: DbRow; sourceQueue: SourceQueueDetail | null }) {
  return (
    <CasePanelFrame title="Orden y compra" description="Contexto comercial recuperado desde el schema operativo conectado." accent="slate">
      <div className="grid gap-3">
        <CaseDetailField label="ID order" value={row.id_order ?? sourceQueue?.id_order} />
        <CaseDetailField label="Invoice number" value={row.invoice_number ?? sourceQueue?.invoice_number} />
        <CaseDetailField label="ID customer" value={row.id_customer ?? sourceQueue?.id_customer} />
        <CaseDetailField label="Purchase date" value={sourceQueue?.purchase_date} date />
        <CaseDetailField label="Months since purchase" value={sourceQueue?.months_since_purchase} />
        <CaseDetailField label="Maintenance due date" value={sourceQueue?.maintenance_due_date} date />
        <CaseDetailField label="Products" value={sourceQueue?.product_names} />
        <CaseDetailField label="Product refs" value={sourceQueue?.product_references} mono />
      </div>
    </CasePanelFrame>
  );
}
