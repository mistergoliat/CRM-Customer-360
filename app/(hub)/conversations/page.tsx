import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { getConversationInboxViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function ConversationsPage() {
  const data = getConversationInboxViewModel();
  const selected = data.rows.find((row) => row.id === data.selectedId) ?? data.rows[0];
  const sourceLabel = (rowChannel: string) => (rowChannel === "WhatsApp" ? "WhatsApp / Brain" : rowChannel === "Email" ? "Email / Brain" : "Sistema mixto");
  const directionLabel = (rowChannel: string) => (rowChannel === "WhatsApp" ? "Entrante" : "Entrante");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operación"
        title="Conversaciones"
        description="Inbox de conversaciones con filtros, tabla densa y panel lateral."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <SectionCard title="Inbox" eyebrow="Listado" description="Selecciona una fila para abrir el workspace." actions={<StatusChip label="Preview only" tone="amber" />}>
          <div className="mb-4 flex flex-wrap gap-2">
            {["Buscar", "WhatsApp", "Email", "Requiere humano", "Hoy", "Con oportunidad", "Más filtros"].map((filter, index) => (
              <StatusChip key={filter} label={filter} tone={index === 0 ? "blue" : "gray"} />
            ))}
          </div>
          <DataTable headers={["Cliente", "Último mensaje", "Oportunidad o caso", "Canal", "Estado", "Responsable", "Espera", "Fuente", "Dirección"]}>
            {data.rows.map((row) => (
              <tr key={row.id} className={row.id === selected?.id ? "bg-primary-fixed/30" : undefined}>
                <td>
                  <Link href={row.href ?? "#"} className="font-semibold text-primary hover:underline">
                    {row.client}
                  </Link>
                  <p className="text-label-sm text-slate-500">{row.wa_id}</p>
                </td>
                <td className="max-w-[320px]">
                  <p>{row.last_message}</p>
                  <p className="mt-1 text-label-sm text-slate-500">{row.summary}</p>
                </td>
                <td>{row.related}</td>
                <td><StatusChip label={row.channel} tone="blue" /></td>
                <td><StatusChip label={row.status} tone={row.tone} /></td>
                <td>{row.owner}</td>
                <td>{row.waiting}</td>
                <td>{sourceLabel(row.channel)}</td>
                <td>{directionLabel(row.channel)}</td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>

        <SectionCard title="Panel lateral" eyebrow="Conversation preview" description={selected?.client ?? "Sin selección"}>
          {selected ? (
            <div className="space-y-4">
              <InfoGrid
                items={[
                  { label: "Cliente", value: selected.client },
                  { label: "Identidad", value: selected.wa_id },
                  { label: "Canal", value: selected.channel },
                  { label: "Estado", value: selected.status },
                  { label: "Oportunidad", value: selected.related },
                  { label: "Fuente", value: sourceLabel(selected.channel) }
                ]}
                columns={3}
              />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Última actividad</p>
                <p className="mt-2 text-body-md text-slate-700">{selected.summary}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Ventana WhatsApp</p>
                <p className="mt-2 text-headline-md text-on-surface">Abierta</p>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">AI SDR Summary</p>
                <p className="mt-2 text-body-md text-slate-700">{selected.summary}</p>
              </div>
              <div className="grid gap-2">
                <Link href={selected.href ?? "#"} className="hub-button-primary">
                  Abrir workspace
                </Link>
                <button className="hub-button-secondary" type="button" disabled>
                  Revisar propuesta
                </button>
              </div>
            </div>
          ) : null}
        </SectionCard>
      </section>
    </div>
  );
}
