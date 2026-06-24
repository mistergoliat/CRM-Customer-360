import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { getMarketingSegmentsViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function MarketingSegmentsPage() {
  const data = getMarketingSegmentsViewModel();
  const selected = data.selected;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Crecimiento"
        title="Segmentos"
        description="Directorio y detalle de segmentos con consentimiento visible."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <SectionCard title="Segmentos" eyebrow="Directory" description="Filas navegables para construir campañas." actions={<StatusChip label="Preview only" tone="amber" />}>
          <DataTable headers={["Descripción", "Reglas", "Tamaño", "Canal", "Consentimiento", "Actualizado", "Campañas"]}>
            {data.rows.map((row) => (
              <tr key={row.id}>
                <td className="max-w-[280px]">
                  <p className="font-semibold text-on-surface">{row.description}</p>
                </td>
                <td className="max-w-[260px]">{row.rules}</td>
                <td>{row.size}</td>
                <td>{row.channel}</td>
                <td><StatusChip label={row.consent} tone={row.consent === "Sí" ? "green" : "amber"} /></td>
                <td>{row.updated}</td>
                <td>{row.campaigns}</td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>

        <SectionCard title="Detalle" eyebrow="Selected segment" description={selected.name}>
          <InfoGrid
            items={[
              { label: "Descripción", value: selected.description },
              { label: "Tamaño", value: selected.size },
              { label: "Canal", value: selected.channel },
              { label: "Consentimiento", value: selected.consent },
              { label: "Actualizado", value: selected.updated }
            ]}
          />
          <div className="mt-4">
            <p className="text-label-bold uppercase text-slate-500">Reglas</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
              {selected.rules.map((rule) => <li key={rule}>{rule}</li>)}
            </ul>
          </div>
          <div className="mt-4">
            <p className="text-label-bold uppercase text-slate-500">Campañas asociadas</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {selected.campaigns.map((item) => <StatusChip key={item} label={item} tone="blue" />)}
            </div>
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
