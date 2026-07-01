import { formatDateTime } from "@/lib/format";
import type { ConversationThreadMessage } from "@/lib/domains/conversations/thread";

export function SystemEvent({ message }: { message: ConversationThreadMessage }) {
  return (
    <div className="flex justify-center">
      <span className="rounded-full bg-slate-100 px-3 py-1 text-center text-[11px] text-slate-500">
        {message.body || "Evento de sistema"} · {formatDateTime(message.occurredAt)}
      </span>
    </div>
  );
}
