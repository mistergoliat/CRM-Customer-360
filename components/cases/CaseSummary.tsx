import { asText, formatDateTime } from "@/lib/format";
import type { DbRow } from "@/lib/db";
import { StatusChip } from "@/components/ui/StatusChip";

const summaryFields = [
  ["wa_id", "WhatsApp ID"],
  ["contact_name", "Cliente"],
  ["phone_number_id", "Phone number ID"],
  ["department", "Departamento"],
  ["service_code", "Servicio"],
  ["id_order", "Orden"],
  ["invoice_number", "Factura"],
  ["source_table", "Fuente"],
  ["source_id", "Source ID"]
] as const;

export function CaseSummary({ row }: { row: DbRow }) {
  return (
    <div className="hub-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip label={asText(row.status)} />
        <StatusChip label={asText(row.priority, "normal")} />
        {row.requires_human ? <StatusChip label="requires_human" tone="red" /> : null}
        <StatusChip label={row.whatsapp_window_open ? "24h abierta" : "24h cerrada"} tone={row.whatsapp_window_open ? "green" : "amber"} />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {summaryFields.map(([field, label]) => (
          <div key={field} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-label-bold uppercase text-slate-500">{label}</p>
            <p className="mt-1 break-words text-body-md font-semibold text-on-surface">{asText(row[field])}</p>
          </div>
        ))}
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-label-bold uppercase text-slate-500">Último mensaje cliente</p>
          <p className="mt-1 text-body-md font-semibold text-on-surface">{formatDateTime(row.last_customer_message_at)}</p>
        </div>
      </div>
    </div>
  );
}
