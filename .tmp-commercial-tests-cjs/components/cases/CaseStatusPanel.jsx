"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaseStatusPanel = CaseStatusPanel;
const format_1 = require("@/lib/format");
const StatusChip_1 = require("@/components/ui/StatusChip");
const CaseDetailPrimitives_1 = require("./CaseDetailPrimitives");
function isTruthy(value) {
    return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}
function CaseStatusPanel({ row, sourceQueue }) {
    const windowOpen = isTruthy(row.whatsapp_window_open);
    return (<CaseDetailPrimitives_1.CasePanelFrame title="Estado operativo" description="Senales del caso, ventana WhatsApp y trazas de automatizacion legacy." accent={windowOpen ? "blue" : "amber"} actions={<StatusChip_1.StatusChip label={windowOpen ? "window open" : "window closed"} tone={windowOpen ? "green" : "amber"}/>}>
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusChip_1.StatusChip label={(0, format_1.asText)(row.status)}/>
        <StatusChip_1.StatusChip label={(0, format_1.asText)(row.priority, "normal")}/>
        {isTruthy(row.requires_human) ? <StatusChip_1.StatusChip label="requires_human" tone="red"/> : <StatusChip_1.StatusChip label="sin flag humano" tone="gray"/>}
        {isTruthy(row.bot_replied) ? <StatusChip_1.StatusChip label="bot replied" tone="blue"/> : <StatusChip_1.StatusChip label="bot idle" tone="gray"/>}
      </div>

      <div className="grid gap-3">
        <CaseDetailPrimitives_1.CaseDetailField label="Final action" value={row.final_action}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Last customer message" value={row.last_customer_message}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Last customer message at" value={row.last_customer_message_at} date/>
        <CaseDetailPrimitives_1.CaseDetailField label="Hours since last customer message" value={row.hours_since_last_customer_message}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Last message direction" value={row.last_message_direction}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Last message status" value={row.last_message_status}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Legacy queue status" value={sourceQueue?.status ?? sourceQueue?.estado_caso}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Legacy provider status" value={sourceQueue?.message_status}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Contact reply sent at" value={sourceQueue?.contact_reply_sent_at} date/>
        <CaseDetailPrimitives_1.CaseDetailField label="Rechazo reply sent at" value={sourceQueue?.rechazo_reply_sent_at} date/>
        <CaseDetailPrimitives_1.CaseDetailField label="Notification sent at" value={row.notification_sent_at} date/>
        <CaseDetailPrimitives_1.CaseDetailField label="Bot replied at" value={row.bot_replied_at} date/>
      </div>
    </CaseDetailPrimitives_1.CasePanelFrame>);
}
