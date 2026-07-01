"use client";

import { useState } from "react";
import clsx from "clsx";
import type { ConversationThreadMessage } from "@/lib/domains/conversations/thread";

type ConversationComposerProps = {
  conversationPublicId: string;
  writeEnabled: boolean;
  closed: boolean;
  windowOpen: boolean;
  onSent: (message: ConversationThreadMessage) => void;
};

function disabledReason(props: ConversationComposerProps): string | null {
  if (props.closed) return "La conversación está cerrada.";
  if (!props.writeEnabled) return "La escritura no está habilitada en este entorno (solo lectura).";
  // Meta rejects free text outside the 24h window and templates are not
  // implemented yet — the backend blocks it, so the composer does too.
  if (!props.windowOpen) return "La ventana de 24 horas de WhatsApp está cerrada. No es posible enviar texto libre (plantillas no disponibles todavía).";
  return null;
}

export function ConversationComposer(props: ConversationComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = disabledReason(props);
  const canSend = !blocked && !sending && text.trim().length > 0;

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${props.conversationPublicId}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text })
      });
      const data = await res.json().catch(() => null);

      if ((res.status === 200 || res.status === 502) && data?.threadMessage) {
        props.onSent(data.threadMessage as ConversationThreadMessage);
        setText("");
        if (data.status === "failed") {
          setError(`El mensaje se registró pero el envío falló${data.errorMessage ? `: ${data.errorMessage}` : "."}`);
        }
      } else {
        setError(data?.message || data?.error || `Error ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red al enviar.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-slate-200 bg-white px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-lg bg-primary px-3 py-1 text-label-sm font-bold text-white">Responder</span>
        <span className="rounded-lg bg-slate-100 px-3 py-1 text-label-sm text-slate-400" title="No disponible todavía">
          Nota interna
        </span>
      </div>

      {blocked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-label-sm text-amber-800">{blocked}</div>
      ) : (
        <>
          <textarea
            className="hub-input min-h-[72px] w-full resize-y"
            placeholder="Escribe tu respuesta…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
            disabled={sending}
          />
          {error ? <p className="mt-1 text-label-sm text-red-600">{error}</p> : null}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Enviar toma control humano y pausa la IA. ⌘/Ctrl + Enter</span>
            <button type="button" className={clsx("hub-button-primary", !canSend && "opacity-50")} onClick={() => void send()} disabled={!canSend}>
              {sending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
