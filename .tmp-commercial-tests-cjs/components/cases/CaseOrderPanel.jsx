"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaseOrderPanel = CaseOrderPanel;
const CaseDetailPrimitives_1 = require("./CaseDetailPrimitives");
function CaseOrderPanel({ row, sourceQueue }) {
    return (<CaseDetailPrimitives_1.CasePanelFrame title="Orden y compra" description="Contexto comercial recuperado desde el schema operativo conectado." accent="slate">
      <div className="grid gap-3">
        <CaseDetailPrimitives_1.CaseDetailField label="ID order" value={row.id_order ?? sourceQueue?.id_order}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Invoice number" value={row.invoice_number ?? sourceQueue?.invoice_number}/>
        <CaseDetailPrimitives_1.CaseDetailField label="ID customer" value={row.id_customer ?? sourceQueue?.id_customer}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Purchase date" value={sourceQueue?.purchase_date} date/>
        <CaseDetailPrimitives_1.CaseDetailField label="Months since purchase" value={sourceQueue?.months_since_purchase}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Maintenance due date" value={sourceQueue?.maintenance_due_date} date/>
        <CaseDetailPrimitives_1.CaseDetailField label="Products" value={sourceQueue?.product_names}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Product refs" value={sourceQueue?.product_references} mono/>
      </div>
    </CaseDetailPrimitives_1.CasePanelFrame>);
}
