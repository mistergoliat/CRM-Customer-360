import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
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
        title="Directorio de clientes"
        description="Customer Candidate provisional con identidad, LTV, riesgo y accesos a perfiles."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <StatCard key={metric.key} title={metric.title} value={metric.value} description={metric.description} icon={metric.icon} state={stateForTone(metric.tone)} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <SectionCard title="Directorio" eyebrow="Customer directory" description="Cada fila abre el perfil provisional del cliente.">
          <div className="mb-4 flex flex-wrap gap-2">
            {["Buscar", "Segmento", "Estado", "Fuente", "Riesgo", "Más filtros"].map((filter, index) => (
              <StatusChip key={filter} label={filter} tone={index === 0 ? "blue" : "gray"} />
            ))}
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Identidad</th>
                  <th>Fuente</th>
                  <th>Actividad</th>
                  <th>Estado</th>
                  <th>Riesgo</th>
                  <th>LTV</th>
                </tr>
              </thead>
              <tbody>
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
                    <td><StatusChip label={row.risk ?? "Medio"} tone={row.risk === "Alto" ? "red" : row.risk === "Bajo" ? "green" : "amber"} /></td>
                    <td>{row.ltv ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                columns={3}
              />
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-label-bold uppercase text-slate-500">LTV</p>
                  <p className="mt-2 text-headline-md text-on-surface">{profile.ltv ?? "—"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-label-bold uppercase text-slate-500">Salud operacional</p>
                  <p className="mt-2 text-headline-md text-on-surface">{profile.operational_health ?? "—"}</p>
                </div>
              </div>
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
