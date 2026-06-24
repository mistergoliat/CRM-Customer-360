import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { getActionDetailViewModel } from "@/lib/p1m/read-models";

type ActionDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function ActionDetailPage({ params }: ActionDetailProps) {
  const { id } = await params;
  const action = getActionDetailViewModel(id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Acciones"
        title={action.client}
        description="Detalle interno de acción en cola. Sigue siendo preview-only."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <SectionCard title="Detalle de acción" eyebrow="Action detail" description={action.related_entity}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
          <div className="space-y-5">
            <InfoGrid
              items={[
                { label: "Cliente", value: action.client },
                { label: "Entidad", value: action.related_entity },
                { label: "Preview", value: action.preview }
              ]}
            />
            <div>
              <p className="text-label-bold uppercase text-slate-500">Lifecycle</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {action.lifecycle.map((item, index) => <StatusChip key={item} label={item} tone={index === action.lifecycle.length - 1 ? "blue" : "gray"} />)}
              </div>
            </div>
            <div>
              <p className="text-label-bold uppercase text-slate-500">Rationale</p>
              <p className="mt-2 text-body-md text-slate-700">{action.rationale}</p>
            </div>
            <div>
              <p className="text-label-bold uppercase text-slate-500">Evidence</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                {action.evidence.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
          <div className="space-y-5">
            <SectionCard title="Eligibility" eyebrow="Guardrails" description="Estado de ejecución hipotética">
              <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
                {action.eligibility.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </SectionCard>
            <SectionCard title="Missing" eyebrow="Gaps" description="Lo que falta para concretar la acción">
              <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
                {action.missing.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </SectionCard>
            <SectionCard title="Guardrails" eyebrow="Safety" description="No se ejecuta nada aquí">
              <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
                {action.guardrails.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </SectionCard>
            <button className="hub-button-primary w-full" type="button" disabled>
              Revisar
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
