"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaseConversationPanel = CaseConversationPanel;
const react_1 = require("react");
const format_1 = require("@/lib/format");
const StatusChip_1 = require("@/components/ui/StatusChip");
const Icon_1 = require("@/components/ui/Icon");
const CaseReplyPanel_1 = require("./CaseReplyPanel");
function isTruthy(value) {
    return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}
function bubbleClass(direction) {
    if (direction === "inbound")
        return "mr-auto max-w-[88%] rounded-[24px] rounded-bl-sm border border-slate-200 bg-white shadow-sm";
    if (direction === "system")
        return "mx-auto max-w-[78%] rounded-[24px] border border-slate-200 bg-white/85 shadow-sm";
    return "ml-auto max-w-[88%] rounded-[24px] rounded-br-sm border border-emerald-100 bg-emerald-50 shadow-sm";
}
function directionTone(direction) {
    if (direction === "inbound")
        return "gray";
    if (direction === "system")
        return "amber";
    return "blue";
}
function CaseConversationPanel({ caseId, row, messages, source, writeEnabled, closed }) {
    const viewportRef = (0, react_1.useRef)(null);
    const endRef = (0, react_1.useRef)(null);
    const windowOpen = isTruthy(row.whatsapp_window_open);
    (0, react_1.useLayoutEffect)(() => {
        const frame = window.requestAnimationFrame(() => {
            endRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [messages]);
    return (<section className="hub-card flex h-[calc(100vh-8.75rem)] min-h-[780px] flex-col overflow-hidden rounded-[28px] border border-emerald-100 bg-[#efeae2] shadow-[0_24px_90px_-45px_rgba(15,23,42,0.45)]">
      <div className="border-b border-white/70 bg-white/85 px-5 py-4 backdrop-blur">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip_1.StatusChip label="Chat WhatsApp" tone="green"/>
              <p className="text-headline-md text-on-surface">{(0, format_1.asText)(row.contact_name, "Conversacion")}</p>
              <StatusChip_1.StatusChip label={`${row.message_count ?? messages.length} mensajes`} tone="gray"/>
            </div>
            <p className="mt-1 text-body-md text-slate-500">
              {(0, format_1.asText)(row.wa_id)} | Fuente timeline: {source}
            </p>
          </div>
          <div className={`rounded-full px-3 py-1 text-label-bold uppercase ${windowOpen ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
            {windowOpen ? "ventana abierta" : "ventana cerrada"}
          </div>
        </div>
      </div>

      <div className={`border-b px-5 py-3 text-body-md ${windowOpen ? "border-emerald-200 bg-emerald-50/90 text-emerald-900" : "border-amber-200 bg-amber-50/90 text-amber-900"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Ventana WhatsApp {windowOpen ? "abierta" : "cerrada"}</span>
          <span>Ultimo mensaje cliente: {(0, format_1.asText)(row.hours_since_last_customer_message, "sin datos")} horas</span>
        </div>
      </div>

      <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#efeae2] px-4 py-5 md:px-5">
        {messages.length === 0 ? (<div className="rounded-xl border border-slate-200 bg-white p-6 text-body-md text-slate-500 shadow-sm">
            Sin mensajes disponibles en tablas conversacionales.
          </div>) : (<div className="flex min-h-full flex-col justify-end">
            <div className="space-y-4 pb-2">
              {messages.map((message) => (<div key={message.key} className={bubbleClass(message.direction)}>
                  <div className="p-4">
                    <div className="mb-2 flex flex-wrap gap-2">
                      <StatusChip_1.StatusChip label={message.direction} tone={directionTone(message.direction)}/>
                      {message.messageType ? <StatusChip_1.StatusChip label={message.messageType} tone="gray"/> : null}
                      {message.finalAction ? <StatusChip_1.StatusChip label={message.finalAction} tone="amber"/> : null}
                      {message.intent ? <StatusChip_1.StatusChip label={message.intent} tone="amber"/> : null}
                      {message.department ? <StatusChip_1.StatusChip label={message.department} tone="gray"/> : null}
                      {message.status ? <StatusChip_1.StatusChip label={message.status}/> : null}
                    </div>

                    <p className="whitespace-pre-wrap text-body-md text-on-surface">{message.body}</p>

                    <div className="mt-3 border-t border-slate-200/70 pt-3 text-label-sm text-slate-500">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>Hora: {(0, format_1.formatDateTime)(message.occurredAt)}</span>
                        {message.providerMessageId ? <span>Provider: {message.providerMessageId}</span> : null}
                        {message.technicalOrigin ? <span>Origen: {message.technicalOrigin}</span> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {message.sourceId ? <span>source_id: {message.sourceId}</span> : null}
                        {message.idOrder ? <span>id_order: {message.idOrder}</span> : null}
                      </div>
                    </div>
                  </div>
                </div>))}
              <div ref={endRef} aria-hidden="true"/>
            </div>
          </div>)}
      </div>

      <div className="border-t border-white/70 bg-white/85 px-5 py-4 backdrop-blur">
        <div className="mb-3 flex items-center gap-2">
          <Icon_1.Icon name="edit_square" className="text-slate-500"/>
          <p className="text-label-bold uppercase text-slate-500">Reply manual</p>
        </div>
        <CaseReplyPanel_1.CaseReplyPanel caseId={caseId} closed={closed} writeEnabled={writeEnabled} whatsappWindowOpen={windowOpen} embedded/>
      </div>
    </section>);
}
