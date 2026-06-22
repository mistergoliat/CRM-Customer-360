"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiSdrPilotControls = AiSdrPilotControls;
const react_1 = __importDefault(require("react"));
const CaseDetailPrimitives_1 = require("../../CaseDetailPrimitives");
const CONTROL_LABELS = [
    "Aprobar borrador",
    "Rechazar",
    "Editar borrador",
    "Tomar control humano",
    "Pedir más contexto"
];
function AiSdrPilotControls({ pilot }) {
    void react_1.default;
    return (<section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label-bold uppercase text-slate-500">Controles piloto</p>
        <span className="text-label-sm text-slate-500">Todos bloqueados por diseño</span>
      </div>

      <CaseDetailPrimitives_1.CaseInlineNote tone="info" title="Piloto controlado" body={pilot.operatorControls.disabledReason}/>

      <p className="mt-3 text-label-sm text-slate-500">Borrador local no guardado</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {CONTROL_LABELS.map((label) => (<button key={label} type="button" className="hub-button-secondary" disabled title={pilot.operatorControls.disabledReason}>
            {label}
          </button>))}
      </div>
    </section>);
}
