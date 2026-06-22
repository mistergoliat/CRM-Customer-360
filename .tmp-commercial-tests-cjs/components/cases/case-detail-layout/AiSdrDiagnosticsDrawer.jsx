"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiSdrDiagnosticsDrawer = AiSdrDiagnosticsDrawer;
const react_1 = __importDefault(require("react"));
const StatusChip_1 = require("@/components/ui/StatusChip");
const AiSdrReviewPanel_1 = require("../ai-sdr/AiSdrReviewPanel");
function toneForStatus(status) {
    if (status === "available")
        return "green";
    if (status === "disabled")
        return "gray";
    if (status === "error")
        return "red";
    return "gray";
}
function AiSdrDiagnosticsDrawer({ caseId, review }) {
    void react_1.default;
    return (<details className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer list-none px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-label-bold uppercase text-slate-500">Ver diagnóstico técnico</p>
            <p className="mt-1 text-body-md text-slate-600">Bloque colapsado por defecto para no competir con el copiloto operativo.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <StatusChip_1.StatusChip label={review.status} tone={toneForStatus(review.status)}/>
            <StatusChip_1.StatusChip label="read-only" tone="gray"/>
          </div>
        </div>
      </summary>

      <div className="border-t border-slate-200 p-4">
        <AiSdrReviewPanel_1.AiSdrReviewPanel caseId={caseId} review={review}/>
      </div>
    </details>);
}
