"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaseCustomerPanel = CaseCustomerPanel;
const CaseDetailPrimitives_1 = require("./CaseDetailPrimitives");
function CaseCustomerPanel({ row, sourceQueue }) {
    return (<CaseDetailPrimitives_1.CasePanelFrame title="Cliente" description="Identidad disponible desde caso, WhatsApp y colas legacy." accent="slate">
      <div className="grid gap-3">
        <CaseDetailPrimitives_1.CaseDetailField label="Contact name" value={row.contact_name}/>
        <CaseDetailPrimitives_1.CaseDetailField label="WA ID" value={row.wa_id} mono/>
        <CaseDetailPrimitives_1.CaseDetailField label="Contact ID" value={row.contact_id}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Phone number ID" value={row.phone_number_id} mono/>
        <CaseDetailPrimitives_1.CaseDetailField label="Phone normalized" value={sourceQueue?.phone_normalized} mono/>
        <CaseDetailPrimitives_1.CaseDetailField label="Firstname" value={sourceQueue?.firstname}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Lastname" value={sourceQueue?.lastname}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Comuna" value={sourceQueue?.comuna}/>
      </div>
    </CaseDetailPrimitives_1.CasePanelFrame>);
}
