"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DB_WRITE_DISABLED_MESSAGE } from "@/lib/action-policy";
import { Icon } from "@/components/ui/Icon";
import { CasePanelFrame } from "./CaseDetailPrimitives";

type CaseReplyPanelProps = {
  caseId: string;
  closed: boolean;
  writeEnabled: boolean;
  whatsappWindowOpen: boolean;
  embedded?: boolean;
};

export function CaseReplyPanel({ caseId, closed, writeEnabled, whatsappWindowOpen, embedded = false }: CaseReplyPanelProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");

  const disabledReason = !writeEnabled
    ? "Requiere credencial writer"
    : closed
      ? "Caso cerrado"
      : !whatsappWindowOpen
        ? "Ventana cerrada"
        : "";

  async function submitReply() {
    if (!writeEnabled) {
      setFeedback(DB_WRITE_DISABLED_MESSAGE);
      return;
    }

    setLoading(true);
    setFeedback("");
    const response = await fetch(`/api/cases/${caseId}/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message_text: message })
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);

    if (!response.ok) {
      setFeedback(data.message || data.error || "No se pudo enviar la respuesta");
      return;
    }

    setMessage("");
    setFeedback(data.message || "Respuesta registrada");
    router.refresh();
  }

  const content = (
    <>
      {!writeEnabled ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-body-md text-amber-900">
          Respuesta deshabilitada: requiere credencial writer para registrar trazabilidad antes de enviar por Meta.
        </div>
      ) : null}

      <textarea
        className="hub-textarea min-h-36 w-full resize-y"
        maxLength={4096}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Escribe una respuesta operacional..."
        disabled={!writeEnabled || closed || !whatsappWindowOpen || loading}
      />

      <div className="mt-3 flex items-center justify-between text-label-sm text-slate-500">
        <span>
          {closed
            ? "Caso cerrado: reabre antes de responder."
            : !whatsappWindowOpen
              ? "Ventana cerrada: el reply libre requiere template."
              : "Maximo 4096 caracteres."}
        </span>
        <span>{message.length}/4096</span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-body-md text-slate-500">El envio real queda bloqueado hasta poder registrar outbound y audit log.</div>
        <button
          className="hub-button-primary shrink-0"
          disabled={!writeEnabled || closed || !whatsappWindowOpen || loading || message.trim().length === 0}
          title={disabledReason || "Enviar respuesta manual"}
          onClick={() => void submitReply()}
        >
          <Icon name="send" />
          Enviar
        </button>
      </div>

      {feedback ? <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-body-md text-slate-700">{feedback}</p> : null}
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <CasePanelFrame title="Reply manual" description="Composer listo para Meta + trazabilidad DB, hoy bloqueado en modo read-only." accent="red">
      {content}
    </CasePanelFrame>
  );
}
