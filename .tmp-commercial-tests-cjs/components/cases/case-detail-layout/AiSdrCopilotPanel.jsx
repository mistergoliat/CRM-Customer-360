"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiSdrCopilotPanel = AiSdrCopilotPanel;
const react_1 = __importDefault(require("react"));
const StatusChip_1 = require("@/components/ui/StatusChip");
const ActionQueuePanel_1 = require("../ai-sdr/action-queue/ActionQueuePanel");
const AiSdrKnownMissingInfo_1 = require("../ai-sdr/operator-pilot/AiSdrKnownMissingInfo");
const AiSdrOperatorSummary_1 = require("../ai-sdr/operator-pilot/AiSdrOperatorSummary");
const AiSdrPilotControls_1 = require("../ai-sdr/operator-pilot/AiSdrPilotControls");
const AiSdrSuggestedReplyCard_1 = require("./AiSdrSuggestedReplyCard");
const AiSdrDiagnosticsDrawer_1 = require("./AiSdrDiagnosticsDrawer");
function toneForStatus(value) {
    if (!value)
        return "gray";
    const text = value.toLowerCase();
    if (text.includes("blocked") || text.includes("error") || text.includes("unavailable"))
        return "red";
    if (text.includes("preview") || text.includes("review") || text.includes("wait") || text.includes("pending"))
        return "amber";
    if (text.includes("available") || text.includes("persisted") || text.includes("completed") || text.includes("allowed"))
        return "green";
    return "gray";
}
function AiSdrCopilotPanel({ caseId, pilot, actionQueue, review }) {
    void react_1.default;
    return (<aside className="flex min-h-0 flex-col gap-4 rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-[0_24px_90px_-45px_rgba(15,23,42,0.45)] backdrop-blur xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-emerald-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-label-bold uppercase text-slate-500">AI SDR Copilot</p>
            <h2 className="mt-1 text-headline-md text-on-surface">Copiloto lateral read-only</h2>
            <p className="mt-2 text-body-md text-slate-600">
              Acompaña el chat principal con insights, sugerencias, cola de acciones y diagnóstico colapsado.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <StatusChip_1.StatusChip label={pilot.status} tone={toneForStatus(pilot.status)}/>
            <StatusChip_1.StatusChip label={actionQueue.status} tone={toneForStatus(actionQueue.status)}/>
            <StatusChip_1.StatusChip label={pilot.nextAction?.riskLevel ?? "unknown"} tone={toneForStatus(pilot.nextAction?.riskLevel)}/>
          </div>
        </div>
      </div>

      <AiSdrOperatorSummary_1.AiSdrOperatorSummary pilot={pilot}/>
      <AiSdrSuggestedReplyCard_1.AiSdrSuggestedReplyCard pilot={pilot}/>
      <AiSdrKnownMissingInfo_1.AiSdrKnownMissingInfo pilot={pilot}/>
      <AiSdrPilotControls_1.AiSdrPilotControls pilot={pilot}/>

      <ActionQueuePanel_1.ActionQueuePanel caseId={caseId} actionQueue={actionQueue}/>
      <AiSdrDiagnosticsDrawer_1.AiSdrDiagnosticsDrawer caseId={caseId} review={review}/>

      {pilot.warnings.length > 0 ? (<div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-label-bold uppercase text-amber-800">Warnings</p>
          <ul className="mt-3 space-y-2 text-body-md text-amber-900">
            {pilot.warnings.map((warning) => (<li key={warning} className="rounded-lg bg-white px-3 py-2">
                {warning}
              </li>))}
          </ul>
        </div>) : null}
    </aside>);
}
