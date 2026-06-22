"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionQueuePanel = ActionQueuePanel;
const react_1 = __importDefault(require("react"));
const CaseDetailPrimitives_1 = require("../../CaseDetailPrimitives");
const ActionQueueItemCard_1 = require("./ActionQueueItemCard");
const ActionQueueStatusBadge_1 = require("./ActionQueueStatusBadge");
const PILOT_ACTION_LABELS = ["Aprobar", "Editar", "Cancelar", "Enviar", "Programar"];
function ActionQueuePanel({ caseId, actionQueue }) {
    void react_1.default;
    const hasActions = actionQueue.actions.length > 0;
    return (<CaseDetailPrimitives_1.CasePanelFrame title="AI Action Queue" description="Vista read-only de acciones propuestas, bloqueadas o sugeridas para revision futura." accent="blue">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <ActionQueueStatusBadge_1.ActionQueueStatusBadge label={actionQueue.status}/>
            <ActionQueueStatusBadge_1.ActionQueueStatusBadge label={actionQueue.origin}/>
            <ActionQueueStatusBadge_1.ActionQueueStatusBadge label={actionQueue.diagnostics.source}/>
          </div>
          <span className="text-label-sm text-slate-500">Caso #{caseId}</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <CaseDetailPrimitives_1.CaseDetailField label="Tabla" value={actionQueue.diagnostics.tableAvailable === null ? "desconocida" : actionQueue.diagnostics.tableAvailable ? "disponible" : "no disponible"}/>
          <CaseDetailPrimitives_1.CaseDetailField label="Permiso" value={actionQueue.diagnostics.permissionError ? "error" : "ok"}/>
          <CaseDetailPrimitives_1.CaseDetailField label="Fallback preview" value={actionQueue.diagnostics.usedPreviewFallback ? "si" : "no"}/>
          <CaseDetailPrimitives_1.CaseDetailField label="Sandbox eligibility" value={actionQueue.sandboxAutonomy.status}/>
          <CaseDetailPrimitives_1.CaseDetailField label="Observed at" value={actionQueue.observedAt ?? "sin dato"} date={Boolean(actionQueue.observedAt)}/>
        </div>

        {actionQueue.sandboxAutonomy.status !== "eligible" ? (<CaseDetailPrimitives_1.CaseInlineNote tone={actionQueue.sandboxAutonomy.status === "disabled" ? "info" : "warning"} title="Sandbox autonomy" body={actionQueue.sandboxAutonomy.note}/>) : null}

        {actionQueue.status === "error" ? (<CaseDetailPrimitives_1.CaseInlineNote tone="warning" title="Error seguro" body={actionQueue.error ?? "No se pudo leer la cola de acciones de forma segura."}/>) : null}

        {actionQueue.status === "unavailable" ? (<CaseDetailPrimitives_1.CaseInlineNote tone="info" title="Cola no disponible" body={actionQueue.disabledReason ?? "La cola durable todavia no esta disponible para esta corrida."}/>) : null}

        {actionQueue.status === "empty" ? (<CaseDetailPrimitives_1.CaseInlineNote tone="info" title="Sin acciones" body={actionQueue.disabledReason ?? "No hay acciones ni previews comerciales disponibles."}/>) : null}

        {actionQueue.status === "preview_only" ? (<CaseDetailPrimitives_1.CaseInlineNote tone="info" title="Vista previa" body={actionQueue.disabledReason ?? "Solo hay previews read-only hasta que exista persistencia duradera."}/>) : null}

        {hasActions ? (<div className="grid gap-4">
            {actionQueue.actions.map((item) => (<ActionQueueItemCard_1.ActionQueueItemCard key={item.idempotencyKey ?? item.actionId} item={item}/>))}
          </div>) : null}

        {!hasActions && actionQueue.status === "empty" ? (<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-label-bold uppercase text-slate-500">Estado vacio</p>
            <p className="mt-2 text-body-md text-slate-600">
              No hay acciones persistidas ni previews de cola para este caso en este momento.
            </p>
          </div>) : null}

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-label-bold uppercase text-slate-500">Controles piloto bloqueados</p>
            <ActionQueueStatusBadge_1.ActionQueueStatusBadge label={actionQueue.status}/>
          </div>
          <p className="mt-2 text-body-md text-slate-600">Disponible cuando Action Persistence y Execution Gate esten habilitados.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {PILOT_ACTION_LABELS.map((label) => (<button key={label} type="button" className="hub-button-secondary" disabled title={actionQueue.disabledReason ?? "Controles bloqueados por diseno"}>
                {label}
              </button>))}
          </div>
        </div>
      </div>
    </CaseDetailPrimitives_1.CasePanelFrame>);
}
