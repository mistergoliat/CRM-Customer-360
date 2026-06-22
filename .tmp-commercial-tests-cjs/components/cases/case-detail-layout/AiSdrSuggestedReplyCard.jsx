"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiSdrSuggestedReplyCard = AiSdrSuggestedReplyCard;
const react_1 = __importDefault(require("react"));
const CaseDetailPrimitives_1 = require("../CaseDetailPrimitives");
const StatusChip_1 = require("@/components/ui/StatusChip");
function toneForValue(value) {
    if (!value)
        return "gray";
    const text = value.toLowerCase();
    if (text.includes("blocked") || text.includes("error"))
        return "red";
    if (text.includes("wait") || text.includes("review") || text.includes("pause") || text.includes("clarify"))
        return "amber";
    if (text.includes("respond") || text.includes("ready") || text.includes("allow"))
        return "green";
    return "gray";
}
function AiSdrSuggestedReplyCard({ pilot }) {
    void react_1.default;
    const nextAction = pilot.nextAction;
    if (!nextAction) {
        return <CaseDetailPrimitives_1.CaseInlineNote tone="info" title="Sin sugerencia disponible" body="No existe una próxima acción lista para mostrar en este caso."/>;
    }
    return (<section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-label-bold uppercase text-slate-500">Suggested reply / next action</p>
          <p className="mt-1 text-headline-sm text-on-surface">{nextAction.label}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <StatusChip_1.StatusChip label={nextAction.type} tone={toneForValue(nextAction.type)}/>
          <StatusChip_1.StatusChip label="ejecutable no" tone="gray"/>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-label-bold uppercase text-slate-500">Riesgo</p>
          <p className="mt-1 break-words text-body-md font-semibold text-on-surface">{nextAction.riskLevel ?? "sin dato"}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-label-bold uppercase text-slate-500">Approval requirement</p>
          <p className="mt-1 break-words text-body-md font-semibold text-on-surface">{nextAction.approvalRequirement ?? "sin dato"}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-label-bold uppercase text-slate-500">Confidence</p>
          <p className="mt-1 break-words text-body-md font-semibold text-on-surface">{nextAction.confidence ?? "sin dato"}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-label-bold uppercase text-slate-500">Canal recomendado</p>
          <p className="mt-1 break-words text-body-md font-semibold text-on-surface">{nextAction.recommendedChannel ?? "sin dato"}</p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-label-bold uppercase text-slate-500">Motivo</p>
        <p className="mt-1 break-words text-body-md text-on-surface">{nextAction.reason}</p>
      </div>

      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-label-bold uppercase text-slate-500">Borrador</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-body-md text-on-surface">{nextAction.draftMessage ?? "Sin sugerencia disponible"}</p>
      </div>

      {nextAction.blockedReasons.length > 0 ? (<div className="mt-3 flex flex-wrap gap-2">
          {nextAction.blockedReasons.map((reason) => (<StatusChip_1.StatusChip key={reason} label={reason} tone="red"/>))}
        </div>) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="hub-button-secondary" disabled title="Solo preview">
          Usar respuesta
        </button>
        <button type="button" className="hub-button-secondary" disabled title="Solo preview">
          Editar
        </button>
        <button type="button" className="hub-button-secondary" disabled title="Solo preview">
          Descartar
        </button>
      </div>

      <p className="mt-3 text-label-sm text-slate-500">Ejecutable: no | Persistencia: no | Borrador local no guardado</p>
    </section>);
}
