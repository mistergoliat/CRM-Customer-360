import clsx from "clsx";
import { StatusChip } from "@/components/ui/StatusChip";
import { formatDateTime } from "@/lib/format";
import { MESSAGE_STATE_LABEL, messageKindLabel, messageStateTone, originLabel } from "./presentation";
import type { ConversationThreadMessage } from "@/lib/domains/conversations/thread";

export function MessageBubble({ message }: { message: ConversationThreadMessage }) {
  const outbound = message.direction === "outbound";
  const isAi = message.origin === "ai";
  const kindLabel = messageKindLabel(message.messageType);
  return (
    <div className={clsx("flex w-full", outbound ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[78%] rounded-2xl px-4 py-2.5 shadow-sm ring-1",
          outbound ? (isAi ? "bg-sky-50 ring-sky-100" : "bg-emerald-50 ring-emerald-100") : "bg-white ring-slate-200"
        )}
      >
        <div className="mb-0.5">
          <span className="text-[11px] font-bold uppercase text-slate-500">{originLabel(message.origin, message.operatorName)}</span>
        </div>
        {kindLabel ? (
          <div className="mb-2">
            <StatusChip label={kindLabel} tone="amber" />
          </div>
        ) : null}
        {message.body ? (
          <p className="whitespace-pre-wrap break-words text-body-md text-slate-800">{message.body}</p>
        ) : (
          <p className="text-body-md italic text-slate-400">Sin contenido</p>
        )}
        <div className="mt-1.5 flex items-center justify-end gap-2">
          <span className="text-[11px] text-slate-400">{formatDateTime(message.occurredAt)}</span>
          <StatusChip label={MESSAGE_STATE_LABEL[message.state]} tone={messageStateTone(message.state)} />
        </div>
      </div>
    </div>
  );
}
