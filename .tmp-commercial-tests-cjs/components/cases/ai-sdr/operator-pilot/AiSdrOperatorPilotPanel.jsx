"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiSdrOperatorPilotPanel = AiSdrOperatorPilotPanel;
const react_1 = __importDefault(require("react"));
const CaseDetailPrimitives_1 = require("../../CaseDetailPrimitives");
const StatusChip_1 = require("@/components/ui/StatusChip");
const AiSdrKnownMissingInfo_1 = require("./AiSdrKnownMissingInfo");
const AiSdrNextActionCard_1 = require("./AiSdrNextActionCard");
const AiSdrOperatorSummary_1 = require("./AiSdrOperatorSummary");
const AiSdrPilotControls_1 = require("./AiSdrPilotControls");
const AiSdrPilotEmptyState_1 = require("./AiSdrPilotEmptyState");
function toneForStatus(status) {
    if (status === "available")
        return "green";
    if (status === "waiting_for_operational_loop")
        return "amber";
    if (status === "disabled")
        return "gray";
    if (status === "error")
        return "red";
    return "gray";
}
function AiSdrOperatorPilotPanel({ caseId, pilot }) {
    void react_1.default;
    return (<CaseDetailPrimitives_1.CasePanelFrame title="AI SDR Operator Pilot" description="Vista operacional read-only para revisar la próxima acción sugerida por el loop comercial." accent="blue">
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusChip_1.StatusChip label={pilot.status} tone={toneForStatus(pilot.status)}/>
          <span className="text-label-sm text-slate-500">Caso #{caseId}</span>
        </div>

        {pilot.status === "not_found" || pilot.status === "disabled" || pilot.status === "error" ? (<AiSdrPilotEmptyState_1.AiSdrPilotEmptyState pilot={pilot}/>) : null}

        {pilot.status === "waiting_for_operational_loop" ? (<CaseDetailPrimitives_1.CaseInlineNote tone="info" title="Observación parcial" body="Todavía no existe un resultado operacional persistido. El shell usa la observación shadow como referencia provisional."/>) : null}

        {pilot.commercialState ? <AiSdrOperatorSummary_1.AiSdrOperatorSummary pilot={pilot}/> : null}
        {pilot.nextAction ? <AiSdrNextActionCard_1.AiSdrNextActionCard pilot={pilot}/> : null}
        <AiSdrKnownMissingInfo_1.AiSdrKnownMissingInfo pilot={pilot}/>
        <AiSdrPilotControls_1.AiSdrPilotControls pilot={pilot}/>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-label-bold uppercase text-slate-500">Diagnóstico técnico</p>
            <StatusChip_1.StatusChip label={pilot.diagnosticsLink.label} tone="gray"/>
          </div>
          <p className="mt-2 text-body-md text-slate-600">La superficie técnica AI SDR sigue disponible debajo como detalle colapsable.</p>
        </div>

        {pilot.warnings.length > 0 ? (<div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-label-bold uppercase text-amber-800">Warnings</p>
            <ul className="mt-3 space-y-2 text-body-md text-amber-900">
              {pilot.warnings.map((warning) => (<li key={warning} className="rounded-lg bg-white px-3 py-2">
                  {warning}
                </li>))}
            </ul>
          </div>) : null}
      </div>
    </CaseDetailPrimitives_1.CasePanelFrame>);
}
