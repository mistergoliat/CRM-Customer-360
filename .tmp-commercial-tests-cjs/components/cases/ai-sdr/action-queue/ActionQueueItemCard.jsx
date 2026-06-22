"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionQueueItemCard = ActionQueueItemCard;
const react_1 = __importDefault(require("react"));
const CaseDetailPrimitives_1 = require("../../CaseDetailPrimitives");
const ActionQueueStatusBadge_1 = require("./ActionQueueStatusBadge");
function ActionQueueItemCard({ item }) {
    void react_1.default;
    return (<article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <ActionQueueStatusBadge_1.ActionQueueStatusBadge label={item.status}/>
          <ActionQueueStatusBadge_1.ActionQueueStatusBadge label={item.source}/>
          <ActionQueueStatusBadge_1.ActionQueueStatusBadge label={item.persisted ? "persisted" : "preview"}/>
          <ActionQueueStatusBadge_1.ActionQueueStatusBadge label="executable false"/>
          <ActionQueueStatusBadge_1.ActionQueueStatusBadge label={item.sandboxAutonomy.status}/>
        </div>
        {item.idempotencyKey ? <span className="text-label-sm text-slate-500 break-all">{item.idempotencyKey}</span> : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <CaseDetailPrimitives_1.CaseDetailField label="Tipo" value={item.actionType}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Estado" value={item.status}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Riesgo" value={item.riskLevel}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Approval requirement" value={item.approvalRequirement}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Programado para" value={item.scheduledFor ?? "sin dato"} date={Boolean(item.scheduledFor)}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Persistida" value={item.persisted ? "si" : "no"}/>
      </div>

      <div className="mt-3 grid gap-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-label-bold uppercase text-slate-500">Motivo / rationale</p>
          <p className="mt-1 break-words text-body-md text-on-surface">{item.rationale ?? "sin dato"}</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-label-bold uppercase text-slate-500">Borrador</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-body-md text-on-surface">{item.draftMessage ?? "sin borrador"}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-label-bold uppercase text-slate-500">Block reasons</p>
          <p className="mt-1 break-words text-body-md text-on-surface">{item.blockReasons.length > 0 ? item.blockReasons.join(", ") : "sin bloqueos"}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-label-bold uppercase text-slate-500">Cancel reason</p>
          <p className="mt-1 break-words text-body-md text-on-surface">{item.cancelReason ?? "sin cancelacion"}</p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-sky-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-label-bold uppercase text-slate-500">Sandbox eligibility</p>
          <ActionQueueStatusBadge_1.ActionQueueStatusBadge label={item.sandboxAutonomy.status}/>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <CaseDetailPrimitives_1.CaseDetailField label="Recipient" value={item.sandboxAutonomy.recipientMasked ?? "sin dato"}/>
          <CaseDetailPrimitives_1.CaseDetailField label="Risk" value={item.sandboxAutonomy.riskLevel}/>
          <CaseDetailPrimitives_1.CaseDetailField label="Whitelist" value={item.sandboxAutonomy.blockReasons.includes("recipient_not_whitelisted") ? "not matched" : "matched"}/>
          <CaseDetailPrimitives_1.CaseDetailField label="Execution" value="disabled in current milestone"/>
        </div>
      </div>
    </article>);
}
