"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import { SystemEvent } from "./SystemEvent";
import type { ConversationThreadMessage } from "@/lib/domains/conversations/thread";

type ConversationThreadProps = {
  messages: ConversationThreadMessage[];
  error: string | null;
  canLoadOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
};

function dateSeparatorLabel(iso: string | null): string {
  if (!iso) return "Sin fecha";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Hoy";
  if (sameDay(date, yesterday)) return "Ayer";
  return date.toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" });
}

export function ConversationThread({ messages, error, canLoadOlder, loadingOlder, onLoadOlder }: ConversationThreadProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const lastCountRef = useRef(messages.length);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  // Initial open lands at the last message.
  useEffect(() => {
    scrollToBottom("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New messages: auto-scroll only if the operator is already at the bottom.
  useEffect(() => {
    const grew = messages.length > lastCountRef.current;
    lastCountRef.current = messages.length;
    if (grew && atBottom) scrollToBottom("smooth");
  }, [messages.length, atBottom, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distanceFromBottom < 80);
  }, []);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center">
          <p className="text-body-md font-bold text-red-700">No se pudo cargar el historial</p>
          <p className="mt-1 text-label-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-body-md text-slate-500">Sin mensajes en esta conversación todavía.</p>
      </div>
    );
  }

  let lastDate: string | null = null;

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={scrollRef} onScroll={handleScroll} className="h-full space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
        {canLoadOlder ? (
          <div className="flex justify-center">
            <button type="button" className="hub-button-secondary" onClick={onLoadOlder} disabled={loadingOlder}>
              {loadingOlder ? "Cargando…" : "Cargar anteriores"}
            </button>
          </div>
        ) : null}

        {messages.map((message) => {
          const label = dateSeparatorLabel(message.occurredAt);
          const showSeparator = label !== lastDate;
          lastDate = label;
          return (
            <div key={message.key} className="space-y-3">
              {showSeparator ? (
                <div className="flex justify-center">
                  <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase text-slate-500 ring-1 ring-slate-200">{label}</span>
                </div>
              ) : null}
              {message.direction === "system" ? <SystemEvent message={message} /> : <MessageBubble message={message} />}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {!atBottom ? (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className="absolute bottom-4 right-4 rounded-full bg-primary px-3 py-1.5 text-label-sm font-bold text-white shadow-lg"
        >
          Volver al final ↓
        </button>
      ) : null}
    </div>
  );
}
