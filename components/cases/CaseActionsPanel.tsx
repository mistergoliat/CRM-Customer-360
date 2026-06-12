"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DB_WRITE_DISABLED_MESSAGE } from "@/lib/action-policy";
import { Icon } from "@/components/ui/Icon";
import { CasePanelFrame } from "./CaseDetailPrimitives";

const closeReasons = [
  "resolved_contacted",
  "rejected_by_customer",
  "duplicate_or_test",
  "no_response",
  "wrong_context",
  "manual_cleanup"
] as const;

type CaseActionsPanelProps = {
  caseId: string;
  writeEnabled: boolean;
  closed: boolean;
};

export function CaseActionsPanel({ caseId, writeEnabled, closed }: CaseActionsPanelProps) {
  const router = useRouter();
  const [priority, setPriority] = useState("normal");
  const [closeReason, setCloseReason] = useState<(typeof closeReasons)[number]>("resolved_contacted");
  const [loading, setLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  async function post(path: string, body?: unknown, confirmText?: string) {
    if (!writeEnabled) {
      setFeedback(DB_WRITE_DISABLED_MESSAGE);
      return;
    }
    if (confirmText && !window.confirm(confirmText)) return;

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

  return (
    <CasePanelFrame title="Acciones de caso" description="Acciones legacy preparadas para writer. Hoy visibles y bloqueadas." accent="red">
      {!writeEnabled ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-body-md text-amber-900">
          Requiere credencial writer antes de ejecutar close, reopen, priority o block AI.
        </div>
      ) : null}

      <div className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            className="hub-button-secondary"
            disabled={!writeEnabled || loading !== null}
            title={!writeEnabled ? "Requiere credencial writer" : "Cerrar caso"}
            onClick={() => void post(`/api/cases/${caseId}/close`, { reason: closeReason }, "Cerrar este caso?")}
          >
            <Icon name="task_alt" />
            Cerrar
          </button>
          <button
            className="hub-button-secondary"
            disabled={!writeEnabled || loading !== null}
            title={!writeEnabled ? "Requiere credencial writer" : "Reabrir caso"}
            onClick={() => void post(`/api/cases/${caseId}/reopen`)}
          >
            <Icon name="restart_alt" />
            Reabrir
          </button>
          <button
            className="hub-button-secondary"
            disabled={!writeEnabled || loading !== null}
            title={!writeEnabled ? "Requiere credencial writer" : "Bloquear IA"}
            onClick={() => void post(`/api/cases/${caseId}/block-ai`)}
          >
            <Icon name="voice_over_off" />
            Bloquear IA
          </button>
          <button
            className="hub-button-secondary"
            disabled={!writeEnabled || loading !== null}
            title={!writeEnabled ? "Requiere credencial writer" : "Cambiar prioridad"}
            onClick={() => void post(`/api/cases/${caseId}/priority`, { priority })}
          >
            <Icon name="flag" />
            Prioridad
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-2 text-label-bold uppercase text-slate-500">Motivo de cierre</p>
            <select className="hub-input w-full" value={closeReason} onChange={(event) => setCloseReason(event.target.value as (typeof closeReasons)[number])} disabled={!writeEnabled || loading !== null}>
              {closeReasons.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
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
    </CasePanelFrame>
  );
}
