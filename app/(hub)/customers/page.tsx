import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { getCustomerDirectoryViewModel } from "@/lib/p1m/read-models";
import { stateForTone } from "@/lib/status";

export default function CustomersPage() {
  const data = getCustomerDirectoryViewModel();
  const selected = data.rows.find((row) => row.id === data.selectedId) ?? data.rows[0];
  const profile = data.profiles[data.selectedId];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
        title="Clientes"
        description="Directorio provisional de Customer Candidate. La identidad es visual y read-only."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <SectionCard title="Directorio" eyebrow="Customer directory" description="Cada fila abre el perfil provisional del cliente." actions={<StatusChip label="Customer Candidate" tone="amber" />}>
          <DataTable headers={["Cliente", "Identidad", "Fuente", "Actividad", "Estado", "Región"]}>
            {data.rows.map((row) => (
              <tr key={row.id} className={row.id === selected?.id ? "bg-primary-fixed/30" : undefined}>
                <td>
                  <Link href={row.href ?? "#"} className="font-semibold text-primary hover:underline">
                    {row.client}
                  </Link>
                </td>
                <td><StatusChip label={row.identity_state} tone={row.identity_state === "Resuelto" ? "green" : row.identity_state === "Conflicto" ? "red" : "amber"} /></td>
                <td>{row.source}</td>
                <td>{row.activity}</td>
                <td><StatusChip label={row.status} tone="blue" /></td>
                <td>{row.region}</td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>

        <SectionCard title="Perfil seleccionado" eyebrow="Customer profile" description={profile?.summary ?? "Sin selección"}>
          {profile ? (
            <div className="space-y-4">
              <InfoGrid
                items={[
                  { label: "Identidad", value: profile.identity },
                  { label: "Contacto", value: profile.contact },
                  { label: "Fuente principal", value: profile.source },
                  { label: "RUT", value: profile.rut },
                  { label: "Región", value: profile.region },
                  { label: "Última actividad", value: profile.last_activity }
                ]}
              />
              <div>
                <p className="text-label-bold uppercase text-slate-500">Resumen comercial</p>
                <p className="mt-2 text-body-md text-slate-700">{profile.commercial_summary}</p>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Sistemas vinculados</p>
                <div className="mt-2 space-y-2">
                  {profile.source_systems.map((system) => (
                    <div key={system.label} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="text-body-md text-slate-700">{system.label}</span>
                      <StatusChip label={system.value} tone={system.tone} />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Datos faltantes</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                  {profile.missing_data.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <Link href={`/customers/${profile.id}`} className="hub-button-primary">
                Abrir perfil
              </Link>
            </div>
          ) : null}
        </SectionCard>
      </section>
    </div>
  );
}
