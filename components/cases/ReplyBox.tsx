"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { DB_WRITE_DISABLED_MESSAGE } from "@/lib/action-policy";

type ReplyBoxProps = {
  caseId: string;
  closed: boolean;
  writeEnabled: boolean;
};

export function ReplyBox({ caseId, closed, writeEnabled }: ReplyBoxProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("normal");
  const [loading, setLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>("");

  const actionBlocked = !writeEnabled;
  const actionBlockReason = "Requiere credencial writer";

  async function post(path: string, body?: unknown, confirmText?: string) {
    if (actionBlocked) {
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
    if (path.endsWith("/reply")) setMessage("");
    router.refresh();
  }

  return (
    <div className="hub-card p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-headline-md text-on-surface">Respuesta manual WhatsApp</p>
          <p className="text-body-md text-slate-500">El envio ocurre server-side directo contra Meta Graph API cuando la trazabilidad DB esta habilitada.</p>
        </div>
      </div>

      {!writeEnabled ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-body-md text-amber-900">
          Requiere credencial writer para ejecutar acciones y registrar trazabilidad.
        </div>
      ) : null}

      <textarea
        className="hub-textarea min-h-32 w-full resize-y"
        maxLength={4096}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Escribe una respuesta operacional..."
        disabled={closed || actionBlocked}
      />
      <div className="mt-2 flex items-center justify-between text-label-sm text-slate-500">
        <span>{closed ? "Caso cerrado: reabre antes de responder." : "Maximo 4096 caracteres."}</span>
        <span>{message.length}/4096</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          className="hub-button-primary"
          title={actionBlocked ? actionBlockReason : "Enviar mensaje"}
          disabled={closed || actionBlocked || loading !== null || message.trim().length === 0}
          onClick={() => post(`/api/cases/${caseId}/reply`, { message_text: message })}
        >
          <Icon name="send" />
          Enviar
        </button>
        <button
          className="hub-button-secondary"
          title={actionBlocked ? actionBlockReason : "Cerrar caso"}
          disabled={actionBlocked || loading !== null}
          onClick={() => post(`/api/cases/${caseId}/close`, {}, "Cerrar este caso?")}
        >
          <Icon name="task_alt" />
          Cerrar
        </button>
        <button
          className="hub-button-secondary"
          title={actionBlocked ? actionBlockReason : "Reabrir caso"}
          disabled={actionBlocked || loading !== null}
          onClick={() => post(`/api/cases/${caseId}/reopen`)}
        >
          <Icon name="restart_alt" />
          Reabrir
        </button>
        <button
          className="hub-button-secondary"
          title={actionBlocked ? actionBlockReason : "Bloquear IA"}
          disabled={actionBlocked || loading !== null}
          onClick={() => post(`/api/cases/${caseId}/block-ai`)}
        >
          <Icon name="voice_over_off" />
          Bloquear IA
        </button>
        <select className="hub-input" value={priority} onChange={(event) => setPriority(event.target.value)} disabled={actionBlocked || loading !== null}>
          <option value="low">low</option>
          <option value="normal">normal</option>
          <option value="high">high</option>
          <option value="urgent">urgent</option>
        </select>
        <button
          className="hub-button-ghost"
          title={actionBlocked ? actionBlockReason : "Cambiar prioridad"}
          disabled={actionBlocked || loading !== null}
          onClick={() => post(`/api/cases/${caseId}/priority`, { priority })}
        >
          Cambiar prioridad
        </button>
      </div>
      {feedback ? <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-body-md text-slate-700">{feedback}</p> : null}
    </div>
  );
}
