import type { TimelineEntry } from "@/lib/cases";
import { formatDateTime } from "@/lib/format";
import { StatusChip } from "@/components/ui/StatusChip";

function toneForDirection(direction: TimelineEntry["direction"]) {
  if (direction === "inbound") return "gray" as const;
  if (direction === "manual") return "blue" as const;
  if (direction === "outbound") return "blue" as const;
  return "amber" as const;
}

function containerClass(direction: TimelineEntry["direction"]) {
  if (direction === "inbound") return "max-w-[88%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white p-4";
  if (direction === "system") return "max-w-[88%] rounded-2xl border border-amber-100 bg-amber-50 p-4";
  return "ml-auto max-w-[88%] rounded-2xl rounded-br-sm border border-sky-100 bg-sky-50 p-4";
}

export function CaseTimeline({ messages, source }: { messages: TimelineEntry[]; source: string }) {
  if (messages.length === 0) {
    return (
      <div className="hub-card p-6">
        <p className="text-headline-md text-on-surface">Timeline conversacional</p>
        <p className="mt-2 text-body-md text-slate-500">Sin mensajes disponibles en tablas conversacionales.</p>
      </div>
    );
  }

  return (
    <div className="hub-card p-5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-headline-md text-on-surface">Timeline conversacional</p>
          <p className="text-label-sm text-slate-500">Fuente: {source}</p>
        </div>
        <StatusChip label={`${messages.length} mensajes`} tone="gray" />
      </div>
      <div className="space-y-4 bg-slate-50/70 p-2">
        {messages.map((message) => (
          <div key={message.key} className="grid gap-3 md:grid-cols-[140px_1fr]">
            <div className="pt-2 text-label-sm text-slate-500">{formatDateTime(message.occurredAt)}</div>
            <div className={containerClass(message.direction)}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusChip label={message.direction} tone={toneForDirection(message.direction)} />
                {message.status ? <StatusChip label={message.status} /> : null}
                {message.messageType ? <StatusChip label={message.messageType} tone="gray" /> : null}
                {message.intent ? <StatusChip label={message.intent} tone="amber" /> : null}
                {message.department ? <StatusChip label={message.department} tone="gray" /> : null}
              </div>
              <p className="whitespace-pre-wrap text-body-md text-on-surface">{message.body}</p>
              <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 text-label-sm text-slate-500 md:grid-cols-2">
                <span>Provider ID: {message.providerMessageId ?? "sin datos"}</span>
                <span>Origen tecnico: {message.technicalOrigin ?? message.source}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
