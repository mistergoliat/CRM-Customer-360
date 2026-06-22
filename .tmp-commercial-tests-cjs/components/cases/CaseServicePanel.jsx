"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaseServicePanel = CaseServicePanel;
const CaseDetailPrimitives_1 = require("./CaseDetailPrimitives");
function CaseServicePanel({ row, sourceQueue }) {
    return (<CaseDetailPrimitives_1.CasePanelFrame title="Servicio y fuente" description="Datos de routing, origen y cola legacy util para operacion humana." accent="blue">
      <div className="grid gap-3">
        <CaseDetailPrimitives_1.CaseDetailField label="Service code" value={row.service_code}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Department" value={row.department}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Channel" value={row.channel}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Platform" value={row.platform}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Assigned to" value={row.assigned_to}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Source table" value={row.source_table} mono/>
        <CaseDetailPrimitives_1.CaseDetailField label="Source ID" value={row.source_id} mono/>
        <CaseDetailPrimitives_1.CaseDetailField label="Legacy queue" value={sourceQueue?.source_domain}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Canal derivacion" value={sourceQueue?.canal_derivacion}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Last intent legacy" value={sourceQueue?.last_intent ?? row.last_intent ?? row.first_intent}/>
      </div>
    </CaseDetailPrimitives_1.CasePanelFrame>);
}
