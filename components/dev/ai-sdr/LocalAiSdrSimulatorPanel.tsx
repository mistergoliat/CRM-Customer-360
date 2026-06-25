"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { StatusChip } from "@/components/ui/StatusChip";
import type { LocalAiSdrOverview } from "@/lib/brain/local-ai-sdr";
import { PLATFORM_ORIGIN_LABELS } from "@/lib/domains/customers/platform-origin";

type Props = {
  overview: LocalAiSdrOverview;
};

function formatValue(value: unknown) {
  if (value === null || value === undefined) return "No disponible";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "No disponible";
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function RuntimeRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <span className="max-w-[16rem] text-right text-sm text-slate-900">{formatValue(value)}</span>
    </div>
  );
}

export function LocalAiSdrSimulatorPanel({ overview }: Props) {
  const router = useRouter();
  const [messageText, setMessageText] = useState("");
  const [waId, setWaId] = useState(overview.selectedConversation?.conversation?.waId ?? "56900000001");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const selectedConversation = overview.selectedConversation;
  const runtime = selectedConversation?.state ?? {
    state: "unresolved" as const,
    pendingAction: null,
    email: null,
    firstname: null,
    lastname: null,
    customerId: null,
    customerEmail: null,
    customerName: null,
    customerPlatformOrigin: null,
    linkStatus: null,
    lastDecisionId: null,
    lastToolName: null,
    lastToolStatus: null,
    lastToolResult: null,
    lastResponseText: null,
    reason: null,
    confidence: null,
    warnings: [],
    context: {}
  };
  const messages = useMemo(() => selectedConversation?.messages ?? [], [selectedConversation]);

  async function postJson(body: Record<string, unknown>) {
    const response = await fetch("/api/dev/ai-sdr-simulator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = (await response.json()) as { conversationId?: string; error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "simulator_request_failed");
    }
    return data;
  }

  function refreshConversation(conversationId?: string) {
    startTransition(() => {
      const path = window.location.pathname;
      const next = conversationId ? `${path}?conversationId=${encodeURIComponent(conversationId)}` : path;
      router.replace(next);
      router.refresh();
    });
  }

  async function handleTurn() {
    setFeedback(null);
    try {
      const result = (await postJson({
        action: "turn",
        conversationId: selectedConversation?.conversation?.publicId ?? overview.selectedConversationId,
        waId,
        messageText,
        idempotencyKey: crypto.randomUUID()
      })) as { conversationId?: string; responseText?: string };
      setMessageText("");
      setFeedback(result.responseText ?? "Turn ejecutado.");
      refreshConversation(result.conversationId ?? selectedConversation?.conversation?.publicId ?? undefined);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCreateConversation() {
    setFeedback(null);
    try {
      const result = (await postJson({
        action: "create-conversation",
        waId
      })) as { selectedConversationId?: string; selectedConversation?: { conversation?: { publicId?: string } } };
      const createdId = result.selectedConversation?.conversation?.publicId ?? result.selectedConversationId;
      setFeedback("Conversación creada.");
      refreshConversation(createdId);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.2fr_0.9fr]">
      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-label-bold uppercase text-primary">Conversaciones</p>
            <p className="text-sm text-slate-500">{overview.conversations.length} registradas</p>
          </div>
          <StatusChip label={overview.writeEnabled ? "writes on" : "writes off"} tone={overview.writeEnabled ? "green" : "amber"} />
        </div>

        <div className="mt-4 grid gap-2">
          {overview.conversations.length > 0 ? (
            overview.conversations.map((conversation) => {
              const active = conversation.publicId === selectedConversation?.conversation?.publicId;
              return (
                <button
                  key={conversation.publicId}
                  type="button"
                  onClick={() => refreshConversation(conversation.publicId)}
                  className={clsx(
                    "rounded-2xl border px-4 py-3 text-left transition",
                    active ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{conversation.customerName ?? conversation.waId ?? conversation.publicId}</p>
                      <p className="text-xs text-slate-500">{conversation.customerEmail ?? "Sin email"}</p>
                    </div>
                    <StatusChip label={conversation.state} tone={conversation.state === "customer_linked" || conversation.state === "completed" ? "green" : conversation.state === "handoff" ? "red" : "amber"} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                    <span>ID {conversation.publicId.slice(0, 12)}</span>
                    <span>Mensajes {conversation.messageCount}</span>
                    <span>{conversation.customerPlatformOrigin ? PLATFORM_ORIGIN_LABELS[conversation.customerPlatformOrigin] : "Origen no resuelto"}</span>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No hay conversaciones todavía. Crea una para probar el loop.
            </div>
          )}
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <label className="text-label-bold uppercase text-slate-500">WA ID / contacto</label>
          <input
            value={waId}
            onChange={(event) => setWaId(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-0 transition focus:border-sky-300"
            placeholder="56900000001"
          />
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={handleCreateConversation} className="hub-button-primary" disabled={isPending}>
              Nueva conversación
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-label-bold uppercase text-primary">Timeline</p>
            <p className="text-sm text-slate-500">Loop inbound y respuesta operativa</p>
          </div>
          <StatusChip label={overview.executionMode} tone={overview.executionMode === "simulate" ? "blue" : "gray"} />
        </div>

        <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-3">
            {messages.length > 0 ? (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={clsx(
                    "max-w-[90%] rounded-3xl px-4 py-3 text-sm shadow-sm",
                    message.direction === "inbound" ? "ml-auto bg-sky-100 text-slate-900" : "bg-white text-slate-700"
                  )}
                >
                  <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    <span>{message.direction === "inbound" ? "Inbound" : "AI SDR"}</span>
                    <span>{message.createdAt ? new Date(message.createdAt).toLocaleString() : "Ahora"}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap leading-6">{message.body}</p>
                </article>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-sm text-slate-500">
                Sin mensajes todavía. Envía uno para disparar el loop.
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-[24px] border border-slate-200 bg-white p-4">
          <label className="text-label-bold uppercase text-slate-500">Mensaje inbound</label>
          <textarea
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
            rows={4}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300"
            placeholder="Hola, necesito que me ayudes con mi cuenta"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleTurn} className="hub-button-primary" disabled={isPending || !messageText.trim()}>
              Procesar loop
            </button>
            <button type="button" onClick={() => setMessageText("Mi correo es camila.rojas@example.test")} className="hub-button-ghost">
              Pegar ejemplo
            </button>
          </div>
          {feedback ? <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">{feedback}</p> : null}
        </div>
      </section>

      <aside className="grid gap-4">
        <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
          <p className="text-label-bold uppercase text-primary">AI SDR Runtime</p>
          <div className="mt-4 grid gap-2">
            <RuntimeRow label="Estado" value={runtime.state} />
            <RuntimeRow label="Acción pendiente" value={runtime.pendingAction} />
            <RuntimeRow label="Última decisión" value={runtime.lastDecisionId} />
            <RuntimeRow label="Última tool" value={runtime.lastToolName} />
            <RuntimeRow label="Resultado" value={runtime.lastToolResult?.status ?? runtime.lastResponseText ?? "Sin resultado"} />
            <RuntimeRow label="Confianza" value={runtime.confidence ?? "n/a"} />
            <RuntimeRow label="Warnings" value={runtime.warnings.length > 0 ? runtime.warnings.join(", ") : "Sin warnings"} />
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
          <p className="text-label-bold uppercase text-primary">Cliente</p>
          <div className="mt-4 grid gap-3 text-sm text-slate-700">
            <RuntimeRow label="ID" value={selectedConversation?.customer?.id ?? "Sin vínculo"} />
            <RuntimeRow
              label="Nombre"
              value={selectedConversation?.customer ? [selectedConversation.customer.firstname, selectedConversation.customer.lastname].filter(Boolean).join(" ") : "Sin vínculo"}
            />
            <RuntimeRow label="Email" value={selectedConversation?.customer?.email ?? runtime.customerEmail ?? "Sin vínculo"} />
            <RuntimeRow label="Origen" value={selectedConversation?.customer?.platformOrigin ? PLATFORM_ORIGIN_LABELS[selectedConversation.customer.platformOrigin] : runtime.customerPlatformOrigin ? PLATFORM_ORIGIN_LABELS[runtime.customerPlatformOrigin] : "Sin vínculo"} />
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
          <p className="text-label-bold uppercase text-primary">Última respuesta</p>
          <p className="mt-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
            {runtime.lastResponseText ?? "Sin respuesta todavía."}
          </p>
        </section>
      </aside>
    </div>
  );
}
