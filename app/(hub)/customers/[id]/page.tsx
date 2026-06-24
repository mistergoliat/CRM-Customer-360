import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { TabStrip } from "@/components/p1m/TabStrip";
import { getCustomerProfileViewModel, getCustomerDirectoryViewModel } from "@/lib/p1m/read-models";

type CustomerDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function CustomerDetailPage({ params }: CustomerDetailProps) {
  const { id } = await params;
  const profile = getCustomerProfileViewModel(id);
  const directory = getCustomerDirectoryViewModel();
  const directoryRow = directory.rows.find((row) => row.id === id) ?? directory.rows[0];
  const activity = [
    ...profile.conversations.map((item) => ({ id: item.id, title: item.title, subtitle: item.subtitle, time: item.time, tone: item.tone })),
    ...profile.opportunities.map((item) => ({ id: item.id, title: item.title, subtitle: item.subtitle, time: item.time, tone: item.tone })),
    ...profile.cases.map((item) => ({ id: item.id, title: item.title, subtitle: item.subtitle, time: item.time, tone: item.tone })),
    ...profile.actions.map((item) => ({ id: item.id, title: item.title, subtitle: item.subtitle, time: item.time, tone: item.tone }))
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clientes"
        title={profile.name}
        description="Perfil provisional de Customer Candidate. No hay Customer Master definitivo todavía."
        status="Preview"
        actions={
          <>
            <SurfaceBadge kind="fixture" />
            <Link href="/customers" className="hub-button-secondary">
              Volver al directorio
            </Link>
          </>
        }
      />

      <SectionCard title="Cabecera del cliente" eyebrow="Customer 360 provisional" description={profile.summary}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-fixed text-primary text-headline-md font-bold">
                  {profile.name
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")}
                </div>
                <div>
                  <p className="text-label-bold uppercase text-slate-500">Customer Candidate</p>
                  <h2 className="mt-1 text-headline-lg text-on-surface">{profile.name}</h2>
                  <p className="mt-1 text-body-md text-slate-600">{profile.identity} · {directoryRow?.source}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusChip label={directoryRow?.status ?? "Activo"} tone="blue" />
                <StatusChip label={directoryRow?.identity_state ?? "Provisional"} tone={directoryRow?.identity_state === "Resuelto" ? "green" : "amber"} />
                <StatusChip label={directoryRow?.risk ?? "Medio"} tone={directoryRow?.risk === "Alto" ? "red" : directoryRow?.risk === "Bajo" ? "green" : "amber"} />
              </div>
            </div>

            <InfoGrid
              items={[
                { label: "Identidad", value: profile.identity },
                { label: "Cliente ID", value: profile.id },
                { label: "Fuente", value: profile.source },
                { label: "RUT", value: profile.rut },
                { label: "Región", value: profile.region },
                { label: "Última actividad", value: profile.last_activity }
              ]}
              columns={3}
            />

            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Salud</p>
                <p className="mt-2 text-headline-md text-on-surface">{profile.operational_health ?? "Alta"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">LTV</p>
                <p className="mt-2 text-headline-md text-on-surface">{profile.ltv ?? "—"}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Oportunidades</p>
                <p className="mt-2 text-headline-md text-on-surface">{profile.opportunities.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Casos</p>
                <p className="mt-2 text-headline-md text-on-surface">{profile.cases.length}</p>
              </div>
            </div>

            <TabStrip
              tabs={[
                { label: "Resumen", active: true },
                { label: "Actividad" },
                { label: "Conversaciones" },
                { label: "Oportunidades" },
                { label: "Casos" },
                { label: "Acciones" },
                { label: "Sistemas vinculados" }
              ]}
            />

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-5">
                <SectionCard title="Actividad reciente" eyebrow="Timeline" description="Eventos combinados desde todas las relaciones.">
                  <div className="space-y-3">
                    {activity.map((item) => (
                      <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-on-surface">{item.title}</p>
                            <p className="text-body-md text-slate-600">{item.subtitle}</p>
                          </div>
                          <StatusChip label={item.time} tone={item.tone} />
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              </div>
              <div className="space-y-5">
                <SectionCard title="Notas internas" eyebrow="Ops" description="Notas operativas visibles al operador.">
                  <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
                    {profile.notes.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                </SectionCard>
                <SectionCard title="Datos faltantes" eyebrow="Gaps" description="Qué falta para completar la vista.">
                  <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
                    {profile.missing_data.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </SectionCard>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <SectionCard title="Resumen comercial" eyebrow="Commercial" description="Contexto de la cuenta.">
              <p className="text-body-md text-slate-700">{profile.commercial_summary}</p>
            </SectionCard>
            <SectionCard title="Sistemas vinculados" eyebrow="Sources" description="Señales de identidad y conectividad.">
              <div className="space-y-2">
                {profile.source_systems.map((system) => (
                  <div key={system.label} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <span className="text-body-md text-slate-700">{system.label}</span>
                    <StatusChip label={system.value} tone={system.tone} />
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
