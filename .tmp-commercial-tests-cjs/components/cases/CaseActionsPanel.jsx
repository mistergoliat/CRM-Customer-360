"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaseActionsPanel = CaseActionsPanel;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
const action_policy_1 = require("@/lib/action-policy");
const Icon_1 = require("@/components/ui/Icon");
const CaseDetailPrimitives_1 = require("./CaseDetailPrimitives");
const closeReasons = [
    "resolved_contacted",
    "rejected_by_customer",
    "duplicate_or_test",
    "no_response",
    "wrong_context",
    "manual_cleanup"
];
function CaseActionsPanel({ caseId, writeEnabled, closed }) {
    const router = (0, navigation_1.useRouter)();
    const [priority, setPriority] = (0, react_1.useState)("normal");
    const [closeReason, setCloseReason] = (0, react_1.useState)("resolved_contacted");
    const [loading, setLoading] = (0, react_1.useState)(null);
    const [feedback, setFeedback] = (0, react_1.useState)("");
    async function post(path, body, confirmText) {
        if (!writeEnabled) {
            setFeedback(action_policy_1.DB_WRITE_DISABLED_MESSAGE);
            return;
        }
        if (confirmText && !window.confirm(confirmText))
            return;
        setLoading(path);
        setFeedback("");
        const response = await fetch(path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const data = await response.json().catch(() => ({}));
        setLoading(null);
        if (!response.ok) {
            setFeedback(data.message || data.error || "Operacion fallida");
            return;
        }
        setFeedback(data.message || "Operacion registrada");
        router.refresh();
    }
    return (<CaseDetailPrimitives_1.CasePanelFrame title="Acciones de caso" description="Acciones legacy preparadas para writer. Hoy visibles y bloqueadas." accent="red">
      {!writeEnabled ? (<div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-body-md text-amber-900">
          Requiere credencial writer antes de ejecutar close, reopen, priority o block AI.
        </div>) : null}

      <div className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="hub-button-secondary" disabled={!writeEnabled || loading !== null} title={!writeEnabled ? "Requiere credencial writer" : "Cerrar caso"} onClick={() => void post(`/api/cases/${caseId}/close`, { reason: closeReason }, "Cerrar este caso?")}>
            <Icon_1.Icon name="task_alt"/>
            Cerrar
          </button>
          <button className="hub-button-secondary" disabled={!writeEnabled || loading !== null} title={!writeEnabled ? "Requiere credencial writer" : "Reabrir caso"} onClick={() => void post(`/api/cases/${caseId}/reopen`)}>
            <Icon_1.Icon name="restart_alt"/>
            Reabrir
          </button>
          <button className="hub-button-secondary" disabled={!writeEnabled || loading !== null} title={!writeEnabled ? "Requiere credencial writer" : "Bloquear IA"} onClick={() => void post(`/api/cases/${caseId}/block-ai`)}>
            <Icon_1.Icon name="voice_over_off"/>
            Bloquear IA
          </button>
          <button className="hub-button-secondary" disabled={!writeEnabled || loading !== null} title={!writeEnabled ? "Requiere credencial writer" : "Cambiar prioridad"} onClick={() => void post(`/api/cases/${caseId}/priority`, { priority })}>
            <Icon_1.Icon name="flag"/>
            Prioridad
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-2 text-label-bold uppercase text-slate-500">Motivo de cierre</p>
            <select className="hub-input w-full" value={closeReason} onChange={(event) => setCloseReason(event.target.value)} disabled={!writeEnabled || loading !== null}>
              {closeReasons.map((reason) => (<option key={reason} value={reason}>
                  {reason}
                </option>))}
            </select>
          </div>

          <div>
            <p className="mb-2 text-label-bold uppercase text-slate-500">Nueva prioridad</p>
            <select className="hub-input w-full" value={priority} onChange={(event) => setPriority(event.target.value)} disabled={!writeEnabled || loading !== null}>
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
              <option value="urgent">urgent</option>
            </select>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-body-md text-slate-600">
          {closed
            ? "El caso ya aparece cerrado en la vista actual."
            : "Las acciones quedan listas para activarse cuando exista writer y audit log disponible."}
        </div>
      </div>

      {feedback ? <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-body-md text-slate-700">{feedback}</p> : null}
    </CaseDetailPrimitives_1.CasePanelFrame>);
}
