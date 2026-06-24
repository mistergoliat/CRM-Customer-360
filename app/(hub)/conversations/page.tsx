import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { getConversationInboxViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function ConversationsPage() {
  const data = getConversationInboxViewModel();
  const selected = data.rows.find((row) => row.id === data.selectedId) ?? data.rows[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operación"
        title="Conversaciones"
        description="Entrada del módulo Conversaciones. El chat completo se abre en la vista de workspace."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_360px]">
        <SectionCard title="Inbox de conversaciones" eyebrow="Listado" description="Selecciona una fila para navegar al workspace." actions={<StatusChip label="Preview only" tone="amber" />}>
          <div className="mb-4 flex flex-wrap gap-2">
            {data.filters.map((filter, index) => (
              <StatusChip key={filter} label={filter} tone={index === 0 ? "blue" : "gray"} />
            ))}
          </div>
          <DataTable headers={["Cliente", "Canal", "Estado", "Responsable", "Esperando", "Relacionado", "Último mensaje"]}>
            {data.rows.map((row) => (
              <tr key={row.id} className={row.id === selected?.id ? "bg-primary-fixed/30" : undefined}>
                <td>
                  <Link href={row.href ?? "#"} className="font-semibold text-primary hover:underline">
                    {row.client}
                  </Link>
                  <p className="text-label-sm text-slate-500">{row.wa_id}</p>
                </td>
                <td><StatusChip label={row.channel} tone="blue" /></td>
                <td><StatusChip label={row.status} tone={row.tone} /></td>
                <td>{row.owner}</td>
                <td>{row.waiting}</td>
                <td className="max-w-[240px]">{row.related}</td>
                <td className="max-w-[320px]">
                  <p>{row.last_message}</p>
                  <p className="mt-1 text-label-sm text-slate-500">{row.summary}</p>
                </td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>

        <SectionCard title="Panel lateral" eyebrow="Conversation preview" description={selected?.client ?? "Sin selección"}>
          {selected ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Cliente</p>
                <p className="mt-1 text-headline-md text-on-surface">{selected.client}</p>
                <p className="text-body-md text-slate-500">{selected.wa_id}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusChip label={selected.channel} tone="blue" />
                  <StatusChip label={selected.status} tone={selected.tone} />
                  <StatusChip label={selected.priority} tone={selected.priority === "P0" ? "red" : selected.priority === "P1" ? "amber" : "blue"} />
                </div>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Resumen AI SDR</p>
                <p className="mt-2 text-body-md text-slate-700">{selected.summary}</p>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Vinculado</p>
                <p className="mt-2 text-body-md text-slate-700">{selected.related}</p>
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
