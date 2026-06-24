import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { WorkspaceShell } from "@/components/p1m/WorkspaceShell";
import { TabStrip } from "@/components/p1m/TabStrip";
import { getOpportunityWorkspaceViewModel } from "@/lib/p1m/read-models";

type OpportunityDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function OpportunityDetailPage({ params }: OpportunityDetailProps) {
  const { id } = await params;
  const opportunity = getOpportunityWorkspaceViewModel(id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Oportunidades"
        title={opportunity.customer}
        description="Workspace de oportunidad con AI SDR Copilot, cotización y acciones vinculadas."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <WorkspaceShell
        sidebar={
          <SectionCard title="Resumen" eyebrow="Opportunity" description={opportunity.stage}>
            <InfoGrid
              items={[
                { label: "Estado", value: opportunity.status },
                { label: "Monto", value: opportunity.amount },
                { label: "Fuente", value: opportunity.source },
                { label: "Responsable", value: opportunity.owner },
                { label: "Última actividad", value: opportunity.last_activity },
                { label: "Ubicación", value: opportunity.location }
              ]}
            />
            <div className="mt-4 space-y-3">
              <div>
                <p className="text-label-bold uppercase text-slate-500">Necesidades</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                  {opportunity.needs.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Productos</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {opportunity.products.map((item) => <StatusChip key={item} label={item} tone="blue" />)}
                </div>
              </div>
              <div>
                <p className="text-label-bold uppercase text-slate-500">Objeciones</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {opportunity.objections.map((item) => <StatusChip key={item} label={item} tone="amber" />)}
                </div>
              </div>
            </div>
          </SectionCard>
        }
        main={
          <SectionCard title="Detalle de oportunidad" eyebrow="Workspace" description="Tabs visuales y cotización sin lógica productiva.">
            <TabStrip
              tabs={[
                { label: "Resumen", active: true },
                { label: "Actividad" },
                { label: "Cotización" },
                { label: "Conversaciones" },
                { label: "Casos" },
                { label: "Acciones" }
              ]}
              className="mb-5"
            />
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_360px]">
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-label-bold uppercase text-slate-500">Próximo paso</p>
                  <p className="mt-2 text-body-md text-slate-700">{opportunity.next_step}</p>
                </div>
                <SectionCard title="Timeline" eyebrow="Activity" description="Línea de tiempo comercial">
                  <div className="space-y-3">
                    {opportunity.timeline.map((item) => (
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
              <div className="space-y-5">
                <SectionCard title="Cotización" eyebrow="Quote" description="Borrador visible">
                  <InfoGrid
                    items={[
                      { label: "Número", value: opportunity.quote.number },
                      { label: "Estado", value: opportunity.quote.status },
                      { label: "Monto", value: opportunity.quote.amount },
                      { label: "Emitida", value: opportunity.quote.issued },
                      { label: "Expira", value: opportunity.quote.expiry }
                    ]}
                  />
                </SectionCard>
                <SectionCard title="AI SDR Copilot" eyebrow="Preview" description="Sugerencia contextual del vendedor asistido.">
                  <div className="space-y-3">
                    <p className="text-body-md text-slate-700">{opportunity.copilot.summary}</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-label-bold uppercase text-slate-500">Riesgo</p>
                        <p className="mt-1 text-headline-md text-on-surface">{opportunity.copilot.risk}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-label-bold uppercase text-slate-500">Aprobación</p>
                        <p className="mt-1 text-headline-md text-on-surface">{opportunity.copilot.approval}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-label-bold uppercase text-slate-500">Evidencia</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                        {opportunity.copilot.evidence.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  </div>
                </SectionCard>
              </div>
            </div>
          </SectionCard>
        }
        rail={
          <SectionCard title="Acciones vinculadas" eyebrow="Action" description="Preview-only y bloqueadas.">
            <div className="space-y-2">
              {opportunity.actions.map((action) => (
                <button key={action.label} type="button" disabled className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left">
                  <span className="text-body-md font-semibold text-on-surface">{action.label}</span>
                  <StatusChip label={action.state} tone={action.state === "blocked" ? "red" : "amber"} />
                </button>
              ))}
            </div>
          </SectionCard>
        }
      />
    </div>
  );
}
