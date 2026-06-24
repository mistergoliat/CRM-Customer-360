import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { getKnowledgeViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function KnowledgePage() {
  const data = getKnowledgeViewModel();
  const selected = data.selected;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inteligencia"
        title="Knowledge"
        description="Biblioteca y artículo seleccionado en master-detail."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <SectionCard title="Biblioteca" eyebrow="Knowledge library" description="Artículos y estado visible.">
          <DataTable headers={["Categoría", "Artículo", "Estado", "Propietario", "Vigencia", "Confianza", "Uso", "Gaps"]}>
            {data.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.category}</td>
                <td className="max-w-[280px] font-semibold text-on-surface">{row.title}</td>
                <td><StatusChip label={row.status} tone={row.status === "Activo" ? "green" : "amber"} /></td>
                <td>{row.owner}</td>
                <td>{row.freshness}</td>
                <td>{row.confidence}</td>
                <td>{row.usage}</td>
                <td>{row.gaps}</td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>

        <SectionCard title="Artículo" eyebrow="Selected" description={selected.title}>
          <InfoGrid items={selected.metadata} />
          <div className="mt-4 space-y-3">
            <p className="text-label-bold uppercase text-slate-500">Resumen</p>
            <p className="text-body-md text-slate-700">{selected.summary}</p>
            <p className="text-label-bold uppercase text-slate-500">Contenido</p>
            <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
              {selected.body.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p className="text-label-bold uppercase text-slate-500">Relacionados</p>
            <div className="flex flex-wrap gap-2">
              {selected.related.map((item) => <StatusChip key={item} label={item} tone="blue" />)}
            </div>
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
