import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { getOpportunityInboxViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function OpportunitiesPage() {
  const data = getOpportunityInboxViewModel();
  const selected = data.rows.find((row) => row.id === data.selectedId) ?? data.rows[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
        title="Oportunidades"
        description="Vista de pipeline con listado y panel lateral de oportunidad seleccionada."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <SectionCard title="Pipeline" eyebrow="Opportunity inbox" description="Selecciona una fila para abrir el workspace." actions={<StatusChip label="Preview only" tone="amber" />}>
          <DataTable headers={["Cliente", "Etapa", "Estado", "Valor", "Última actividad", "Próxima acción", "Responsable", "Riesgo"]}>
            {data.rows.map((row) => (
              <tr key={row.id} className={row.id === selected?.id ? "bg-primary-fixed/30" : undefined}>
                <td>
                  <Link href={row.href ?? "#"} className="font-semibold text-primary hover:underline">
                    {row.customer}
                  </Link>
                </td>
                <td><StatusChip label={row.stage} tone={row.stage === "Quote pending" ? "amber" : "blue"} /></td>
                <td><StatusChip label={row.status} tone={row.status.includes("Revisión") ? "red" : "green"} /></td>
                <td>{row.estimated_value}</td>
                <td>{row.activity}</td>
                <td>{row.next_action}</td>
                <td>{row.owner}</td>
                <td><StatusChip label={row.risk} tone={row.risk === "Medio" ? "amber" : "green"} /></td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>

        <SectionCard title="Panel lateral" eyebrow="Opportunity preview" description={selected?.customer ?? "Sin selección"}>
          {selected ? (
            <div className="space-y-4">
              <InfoGrid
                items={[
                  { label: "Etapa", value: selected.stage },
                  { label: "Estado", value: selected.status },
                  { label: "Valor", value: selected.estimated_value },
                  { label: "Responsable", value: selected.owner },
                  { label: "Última actividad", value: selected.activity },
                  { label: "Riesgo", value: selected.risk }
                ]}
              />
              <div>
                <p className="text-label-bold uppercase text-slate-500">Próxima acción</p>
                <p className="mt-2 text-body-md text-slate-700">{selected.next_action}</p>
              </div>
              <Link href={selected.href ?? "#"} className="hub-button-primary">
                Abrir workspace
              </Link>
              <button className="hub-button-secondary" type="button" disabled>
                Revisar cotización
              </button>
            </div>
          ) : null}
        </SectionCard>
      </section>
    </div>
  );
}
