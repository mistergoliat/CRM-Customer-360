import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { TabStrip } from "@/components/p1m/TabStrip";
import { getCustomerProfileViewModel } from "@/lib/p1m/read-models";

type CustomerDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function CustomerDetailPage({ params }: CustomerDetailProps) {
  const { id } = await params;
  const profile = getCustomerProfileViewModel(id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clientes"
        title={profile.name}
        description="Perfil provisional de Customer Candidate. No hay Customer Master definitivo todavía."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <SectionCard title="Perfil del cliente" eyebrow="Customer 360 provisional" description={profile.summary}>
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
          className="mb-5"
        />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
          <div className="space-y-5">
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

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Resumen operacional</p>
                <p className="mt-2 text-body-md text-slate-700">{profile.summary}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Resumen comercial</p>
                <p className="mt-2 text-body-md text-slate-700">{profile.commercial_summary}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <SectionCard title="Conversaciones" eyebrow="Timeline" description="Historias vinculadas">
                <div className="space-y-3">
                  {profile.conversations.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-on-surface">{item.title}</p>
                        <StatusChip label={item.time} tone={item.tone} />
                      </div>
                      <p className="text-body-md text-slate-600">{item.subtitle}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>
              <SectionCard title="Oportunidades" eyebrow="Commercial" description="Relación comercial">
                <div className="space-y-3">
                  {profile.opportunities.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-on-surface">{item.title}</p>
                        <StatusChip label={item.time} tone={item.tone} />
                      </div>
                      <p className="text-body-md text-slate-600">{item.subtitle}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <SectionCard title="Casos" eyebrow="Service" description="Interacciones de atención">
                <div className="space-y-3">
                  {profile.cases.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-on-surface">{item.title}</p>
                        <StatusChip label={item.time} tone={item.tone} />
                      </div>
                      <p className="text-body-md text-slate-600">{item.subtitle}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>
              <SectionCard title="Acciones" eyebrow="Work" description="Preview de acciones vinculadas">
                <div className="space-y-3">
                  {profile.actions.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-on-surface">{item.title}</p>
                        <StatusChip label={item.time} tone={item.tone} />
                      </div>
                      <p className="text-body-md text-slate-600">{item.subtitle}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          </div>

          <div className="space-y-5">
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
      </SectionCard>
    </div>
  );
}
