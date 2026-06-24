import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { getActionQueueViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function ActionsPage() {
  const data = getActionQueueViewModel();
  const selected = data.rows.find((row) => row.id === data.selectedId) ?? data.rows[0];
  const detail = selected ? data.details[selected.id as keyof typeof data.details] : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
        title="Acciones"
        description="Cola global de acciones gubernadas. Todo queda en modo preview mientras no exista backend de ejecución."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <SectionCard title="Action queue" eyebrow="Global queue" description="Acciones visuales y gobernadas. No hay side effects reales." actions={<StatusChip label="Preview only" tone="amber" />}>
          <DataTable headers={["Cliente", "Entidad", "Estado", "Riesgo", "Aprobación", "Origen", "Programación", "Responsable"]}>
            {data.rows.map((row) => (
              <tr key={row.id} className={row.id === selected?.id ? "bg-primary-fixed/30" : undefined}>
                <td>
                  <Link href={row.href ?? "#"} className="font-semibold text-primary hover:underline">
                    {row.client}
                  </Link>
                </td>
                <td>{row.related_entity}</td>
                <td><StatusChip label={row.status} tone={row.status === "Blocked" ? "red" : row.status.includes("Revisión") ? "amber" : "blue"} /></td>
                <td><StatusChip label={row.risk} tone={row.risk === "Medio" ? "amber" : "green"} /></td>
                <td><StatusChip label={row.approval} tone={row.approval === "Requerida" ? "red" : "green"} /></td>
                <td>{row.origin}</td>
                <td>{row.schedule}</td>
                <td>{row.owner}</td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>

        <SectionCard title="Detalle lateral" eyebrow="Preview" description={selected?.client ?? "Sin selección"}>
          {selected && detail ? (
            <div className="space-y-4">
              <InfoGrid
                items={[
                  { label: "Cliente", value: detail.client },
                  { label: "Entidad", value: detail.related_entity },
                  { label: "Rationale", value: detail.rationale },
                  { label: "Preview", value: detail.preview }
                ]}
              />
              <div>
                <p className="text-label-bold uppercase text-slate-500">Lifecycle</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {detail.lifecycle.map((item, index) => (
                    <StatusChip key={item} label={item} tone={index === detail.lifecycle.length - 1 ? "blue" : "gray"} />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Evidence</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                  {detail.evidence.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Missing</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                  {detail.missing.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <div className="grid gap-2">
                <button className="hub-button-primary" type="button" disabled>
                  Aprobar
                </button>
                <button className="hub-button-secondary" type="button" disabled>
                  Rechazar
                </button>
                <button className="hub-button-secondary" type="button" disabled>
                  Programar
                </button>
              </div>
            </div>
          ) : null}
        </SectionCard>
      </section>
    </div>
  );
}
