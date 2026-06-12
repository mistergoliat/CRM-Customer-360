import type { DbRow } from "@/lib/db";
import type { SourceQueueDetail } from "@/lib/case-detail";
import { asText, formatDateTime } from "@/lib/format";
import { StatusChip } from "@/components/ui/StatusChip";
import { Icon } from "@/components/ui/Icon";
import { CaseDetailField, CasePanelFrame } from "./CaseDetailPrimitives";

function isTruthy(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function initials(value: unknown) {
  const base = String(value || "Cliente")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((chunk) => chunk[0] || "")
    .join("")
    .toUpperCase();

  return base || "CL";
}

export function CaseOperationalSidebar({
  row,
  sourceQueue,
  messageCount
}: {
  row: DbRow;
  sourceQueue: SourceQueueDetail | null;
  messageCount: number;
}) {
  const windowOpen = isTruthy(row.whatsapp_window_open);
  const resolvedMessageCount = Number(row.message_count ?? messageCount);

  return (
    <div className="space-y-5">
      <section className="hub-card overflow-hidden border-l-4 border-l-primary-container">
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-headline-md text-primary">
              {initials(row.contact_name)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-headline-md text-on-surface">{asText(row.contact_name, "sin cliente")}</p>
              <p className="mt-1 break-all text-body-md text-slate-500">{asText(row.wa_id)}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <StatusChip label={asText(row.status)} />
            <StatusChip label={asText(row.priority, "normal")} />
            {isTruthy(row.requires_human) ? <StatusChip label="requiere humano" tone="red" /> : <StatusChip label="sin flag humano" tone="gray" />}
            <StatusChip label={windowOpen ? "24h abierta" : "24h cerrada"} tone={windowOpen ? "green" : "amber"} />
          </div>

          <div className="mt-4 grid gap-3">
            <div className={`rounded-lg border px-4 py-3 ${windowOpen ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex items-center gap-2">
                <Icon name={windowOpen ? "mark_chat_read" : "schedule"} className={windowOpen ? "text-emerald-700" : "text-amber-700"} />
                <p className={`text-label-bold uppercase ${windowOpen ? "text-emerald-800" : "text-amber-800"}`}>Ventana WhatsApp</p>
              </div>
              <p className={`mt-1 text-body-md font-semibold ${windowOpen ? "text-emerald-900" : "text-amber-900"}`}>
                {windowOpen ? "Abierta para respuesta libre" : "Cerrada, requiere template"}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Ultimo mensaje cliente</p>
              <p className="mt-2 whitespace-pre-wrap text-body-md text-on-surface">{asText(row.last_customer_message)}</p>
              <p className="mt-2 text-label-sm text-slate-500">{formatDateTime(row.last_customer_message_at)}</p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Mensajes</p>
              <p className="mt-2 text-headline-md text-on-surface">{Number.isFinite(resolvedMessageCount) ? resolvedMessageCount : messageCount}</p>
            </div>
          </div>
        </div>
      </section>

      <CasePanelFrame title="Datos cliente y caso" description="Identidad y metadata operacional para operar sin salir del caso." accent="slate">
        <div className="grid gap-3">
          <CaseDetailField label="Telefono" value={sourceQueue?.phone_normalized ?? row.wa_id} mono />
          <CaseDetailField label="Contact ID" value={row.contact_id} />
          <CaseDetailField label="ID order" value={row.id_order ?? sourceQueue?.id_order} />
          <CaseDetailField label="Invoice number" value={row.invoice_number ?? sourceQueue?.invoice_number} />
          <CaseDetailField label="Source table" value={row.source_table} mono />
          <CaseDetailField label="Source ID" value={row.source_id} mono />
          <CaseDetailField label="Service code" value={row.service_code} />
          <CaseDetailField label="Legacy queue" value={sourceQueue?.source_domain} />
          <CaseDetailField label="Ultima intencion" value={sourceQueue?.last_intent ?? row.last_intent ?? row.first_intent} />
          <CaseDetailField label="Actualizado" value={row.updated_at} date />
        </div>
      </CasePanelFrame>
    </div>
  );
}
