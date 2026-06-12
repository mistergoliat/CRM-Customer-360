import type { DbRow } from "@/lib/db";
import type { SourceQueueDetail } from "@/lib/case-detail";
import { asText } from "@/lib/format";
import { StatusChip } from "@/components/ui/StatusChip";
import { CaseDetailField, CasePanelFrame } from "./CaseDetailPrimitives";

function isTruthy(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

export function CaseStatusPanel({ row, sourceQueue }: { row: DbRow; sourceQueue: SourceQueueDetail | null }) {
  const windowOpen = isTruthy(row.whatsapp_window_open);

  return (
    <CasePanelFrame
      title="Estado operativo"
      description="Senales del caso, ventana WhatsApp y trazas de automatizacion legacy."
      accent={windowOpen ? "blue" : "amber"}
      actions={<StatusChip label={windowOpen ? "window open" : "window closed"} tone={windowOpen ? "green" : "amber"} />}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusChip label={asText(row.status)} />
        <StatusChip label={asText(row.priority, "normal")} />
        {isTruthy(row.requires_human) ? <StatusChip label="requires_human" tone="red" /> : <StatusChip label="sin flag humano" tone="gray" />}
        {isTruthy(row.bot_replied) ? <StatusChip label="bot replied" tone="blue" /> : <StatusChip label="bot idle" tone="gray" />}
      </div>

      <div className="grid gap-3">
        <CaseDetailField label="Final action" value={row.final_action} />
        <CaseDetailField label="Last customer message" value={row.last_customer_message} />
        <CaseDetailField label="Last customer message at" value={row.last_customer_message_at} date />
        <CaseDetailField label="Hours since last customer message" value={row.hours_since_last_customer_message} />
        <CaseDetailField label="Last message direction" value={row.last_message_direction} />
        <CaseDetailField label="Last message status" value={row.last_message_status} />
        <CaseDetailField label="Legacy queue status" value={sourceQueue?.status ?? sourceQueue?.estado_caso} />
        <CaseDetailField label="Legacy provider status" value={sourceQueue?.message_status} />
        <CaseDetailField label="Contact reply sent at" value={sourceQueue?.contact_reply_sent_at} date />
        <CaseDetailField label="Rechazo reply sent at" value={sourceQueue?.rechazo_reply_sent_at} date />
        <CaseDetailField label="Notification sent at" value={row.notification_sent_at} date />
        <CaseDetailField label="Bot replied at" value={row.bot_replied_at} date />
      </div>
    </CasePanelFrame>
  );
}
