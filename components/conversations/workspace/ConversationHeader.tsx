import Link from "next/link";
import { StatusChip } from "@/components/ui/StatusChip";
import { toneForStatus } from "@/lib/status";
import { AiControlMode } from "./AiControlMode";
import { ConversationControls } from "./ConversationControls";
import type { ConversationHeaderData } from "./types";

type ConversationHeaderProps = {
  data: ConversationHeaderData;
  contextOpen: boolean;
  onToggleContext: () => void;
};

export function ConversationHeader({ data, contextOpen, onToggleContext }: ConversationHeaderProps) {
  const title = data.contactName ?? data.waId ?? data.conversationPublicId;
  const channelLabel = data.channel ? (data.channel.toLowerCase() === "whatsapp" ? "WhatsApp" : data.channel) : "Canal no disponible";
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-3">
      <Link href="/conversations" className="hub-button-secondary shrink-0" aria-label="Volver al inbox">
        ← Inbox
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StatusChip label={channelLabel} tone={data.channel ? "green" : "amber"} />
          <span className="truncate text-body-lg font-bold text-slate-800">{title}</span>
        </div>
        <p className="truncate text-label-sm text-slate-500">{data.waId ?? "wa_id no disponible"}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusChip label={data.status || "estado no disponible"} tone={toneForStatus(data.status || "")} />
        <StatusChip label={`Prioridad: ${data.priority}`} tone={data.priority === "high" ? "amber" : data.priority === "low" ? "gray" : "blue"} />
        <StatusChip label={data.ownerType ? `Responsable: ${data.ownerType}` : "Sin responsable"} tone="gray" />
        <StatusChip label={data.windowOpen ? "Ventana abierta" : "Ventana cerrada"} tone={data.windowOpen ? "green" : "amber"} />
        <AiControlMode mode={data.controlMode} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ConversationControls
          conversationPublicId={data.conversationPublicId}
          controlMode={data.controlMode}
          closed={data.closed}
          writeEnabled={data.writeEnabled}
        />
        {/* Transfer has no assignment backend yet: shown disabled with an explicit reason, not faked. */}
        <button type="button" className="hub-button-secondary opacity-50" disabled title="Sin backend de asignación todavía">
          Transferir
        </button>
        <button type="button" className="hub-button-secondary" onClick={onToggleContext} aria-expanded={contextOpen}>
          {contextOpen ? "Ocultar contexto" : "Ver contexto"}
        </button>
      </div>
    </header>
  );
}
