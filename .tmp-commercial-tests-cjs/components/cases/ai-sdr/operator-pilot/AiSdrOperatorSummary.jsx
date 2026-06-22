"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiSdrOperatorSummary = AiSdrOperatorSummary;
const react_1 = __importDefault(require("react"));
const CaseDetailPrimitives_1 = require("../../CaseDetailPrimitives");
const StatusChip_1 = require("@/components/ui/StatusChip");
function statusTone(value) {
    if (!value)
        return "gray";
    const text = value.toLowerCase();
    if (text.includes("error") || text.includes("blocked") || text.includes("failed"))
        return "red";
    if (text.includes("wait") || text.includes("review") || text.includes("pending"))
        return "amber";
    if (text.includes("complete") || text.includes("available") || text.includes("respond") || text.includes("ready"))
        return "green";
    return "gray";
}
function AiSdrOperatorSummary({ pilot }) {
    void react_1.default;
    const commercialState = pilot.commercialState;
    if (!commercialState) {
        return <CaseDetailPrimitives_1.CaseInlineNote tone="info" title="Sin estado operacional" body="No existe un estado comercial duradero disponible para este caso."/>;
    }
    return (<section className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <StatusChip_1.StatusChip label={`status ${pilot.status}`} tone={statusTone(pilot.status)}/>
        <StatusChip_1.StatusChip label={`commercial ${commercialState.status ?? "unknown"}`} tone={statusTone(commercialState.status)}/>
        <StatusChip_1.StatusChip label={`stage ${commercialState.stage ?? "unknown"}`} tone={statusTone(commercialState.stage)}/>
        <StatusChip_1.StatusChip label={`risk ${pilot.nextAction?.riskLevel ?? "unknown"}`} tone={statusTone(pilot.nextAction?.riskLevel)}/>
        <StatusChip_1.StatusChip label={`approval ${pilot.nextAction?.approvalRequirement ?? "unknown"}`} tone={statusTone(pilot.nextAction?.approvalRequirement)}/>
      </div>

      {pilot.status === "waiting_for_operational_loop" ? (<CaseDetailPrimitives_1.CaseInlineNote tone="info" title="Modo puente" body="Aún no existe un resultado operacional persistido. Esta vista usa la observación shadow como referencia parcial."/>) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <CaseDetailPrimitives_1.CaseDetailField label="Estado comercial" value={commercialState.status ?? "sin datos"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Etapa" value={commercialState.stage ?? "sin datos"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Temperatura" value={commercialState.temperature ?? "sin datos"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Prioridad" value={commercialState.priority ?? "sin datos"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Resumen breve" value={commercialState.summary ?? "sin datos"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Esperando por" value={commercialState.waitingFor ?? "sin datos"}/>
      </div>
    </section>);
}
