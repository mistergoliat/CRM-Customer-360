"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiSdrPilotEmptyState = AiSdrPilotEmptyState;
const react_1 = __importDefault(require("react"));
const CaseDetailPrimitives_1 = require("../../CaseDetailPrimitives");
function AiSdrPilotEmptyState({ pilot }) {
    void react_1.default;
    if (pilot.status === "disabled") {
        return <CaseDetailPrimitives_1.CaseInlineNote tone="warning" title="Piloto deshabilitado" body="El shell operativo estaba deshabilitado para esta corrida. No existe una vista operacional inspectable."/>;
    }
    if (pilot.status === "error") {
        return (<div className="grid gap-3">
        <CaseDetailPrimitives_1.CaseInlineNote tone="warning" title="Piloto con error" body="La lectura del piloto operativo falló de forma segura. La conversación y el caso siguen disponibles."/>
        {pilot.error ? (<div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-body-md text-rose-900">
            <p className="text-label-bold uppercase">Error seguro</p>
            <p className="mt-1 break-words">{pilot.error}</p>
          </div>) : null}
      </div>);
    }
    return <CaseDetailPrimitives_1.CaseInlineNote tone="info" title="No existe una vista operacional AI SDR" body="No existe un resultado operacional persistido o vinculable para este caso. Esto no es un error del caso."/>;
}
