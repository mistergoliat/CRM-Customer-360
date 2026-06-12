import type { DbRow } from "@/lib/db";
import type { SourceQueueDetail } from "@/lib/case-detail";
import { asText } from "@/lib/format";
import { StatusChip } from "@/components/ui/StatusChip";
import { Icon } from "@/components/ui/Icon";

function isTruthy(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

export function CaseDetailHeader({ row, sourceQueue, writeEnabled }: { row: DbRow; sourceQueue: SourceQueueDetail | null; writeEnabled: boolean }) {
  const windowOpen = isTruthy(row.whatsapp_window_open);
  const requiresHuman = isTruthy(row.requires_human);
  const hoursSinceCustomer = row.hours_since_last_customer_message;

  return (
    <section className="hub-card overflow-hidden border-l-4 border-l-primary-container">
      <div className="px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div>
              <p className="text-label-bold uppercase text-primary-container">Case Detail</p>
              <h1 className="mt-1 text-[30px] font-semibold leading-tight text-on-surface">
                {asText(row.contact_name, "sin cliente")}
              </h1>
              <p className="mt-2 text-body-md text-slate-500">
                Caso #{asText(row.conversation_case_id)} | WA {asText(row.wa_id)} | Phone number ID {asText(row.phone_number_id, "sin resolver")}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <StatusChip label={asText(row.status)} />
              <StatusChip label={asText(row.priority, "normal")} />
              {row.department ? <StatusChip label={asText(row.department)} tone="gray" /> : null}
              {row.service_code ? <StatusChip label={asText(row.service_code)} tone="gray" /> : null}
              <StatusChip label={windowOpen ? "24h abierta" : "24h cerrada"} tone={windowOpen ? "green" : "amber"} />
              {requiresHuman ? <StatusChip label="requiere humano" tone="red" /> : null}
              {isTruthy(row.bot_replied) ? <StatusChip label="bot replied" tone="blue" /> : null}
              <StatusChip label={writeEnabled ? "writer enabled" : "read only"} tone={writeEnabled ? "green" : "amber"} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[360px]">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2">
                <Icon name={windowOpen ? "mark_chat_read" : "schedule"} className={windowOpen ? "text-emerald-600" : "text-amber-600"} />
                <p className="text-label-bold uppercase text-slate-500">Ventana WhatsApp</p>
              </div>
              <p className="mt-2 text-body-lg font-semibold text-on-surface">{windowOpen ? "Abierta para reply libre" : "Cerrada, requiere template"}</p>
              <p className="mt-1 text-body-md text-slate-500">
                Horas desde ultimo mensaje cliente: {asText(hoursSinceCustomer, "sin datos")}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2">
                <Icon name="conversion_path" className="text-primary-container" />
                <p className="text-label-bold uppercase text-slate-500">Match legacy</p>
              </div>
              <p className="mt-2 text-body-lg font-semibold text-on-surface">{sourceQueue ? asText(sourceQueue.source_domain) : "Sin cola asociada"}</p>
              <p className="mt-1 text-body-md text-slate-500">
                Fuente: {asText(sourceQueue?.source_table, asText(row.source_table))} / {asText(sourceQueue?.source_id, asText(row.source_id))}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
