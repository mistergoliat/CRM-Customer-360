import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { WorkspaceShell } from "@/components/p1m/WorkspaceShell";
import { getMarketingCopilotViewModel } from "@/lib/p1m/read-models";

export default function MarketingCopilotPage() {
  const data = getMarketingCopilotViewModel();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Crecimiento"
        title="Marketing Copilot"
        description="Creación conversacional de campañas con validación y governance a la derecha."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <WorkspaceShell
        sidebar={
          <SectionCard title="Instrucción" eyebrow="Chat" description="Entrada conversacional del usuario.">
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-[#efeae2] p-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-label-bold uppercase text-slate-500">Usuario</p>
                <p className="mt-2 text-body-md text-slate-700">{data.user_prompt}</p>
              </div>
              <div className="rounded-3xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
                <p className="text-label-bold uppercase text-amber-800">Copilot</p>
                <p className="mt-2 text-body-md text-slate-700">Voy a estructurar campaña, validar exclusiones y dejarla lista para aprobación.</p>
              </div>
            </div>
          </SectionCard>
        }
        main={
          <SectionCard title="Campaña estructurada" eyebrow="Draft" description="Flujo visual de instrucción hacia campaña.">
            <InfoGrid
              items={data.draft.map((item) => ({ label: item.label, value: item.value }))}
              columns={2}
            />
            <div className="mt-5 space-y-3">
              <p className="text-label-bold uppercase text-slate-500">Flujo</p>
              <div className="flex flex-wrap gap-2">
                {data.stages.map((stage, index) => (
                  <StatusChip key={stage} label={`${index + 1}. ${stage}`} tone={index === data.stages.length - 1 ? "red" : "blue"} />
                ))}
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Sugerencias</p>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-body-md text-slate-700">
                  {data.suggestions.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Validation</p>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-body-md text-slate-700">
                  {data.validation.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            </div>
          </SectionCard>
        }
        rail={
          <SectionCard title="Governance" eyebrow="Approval" description="Validación y límites visuales antes de cualquier ejecución.">
            <div className="space-y-4">
              <div>
                <p className="text-label-bold uppercase text-slate-500">Reglas</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                  {data.governance.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Canal</p>
                <p className="mt-2 text-headline-md text-on-surface">WhatsApp + Email</p>
              </div>
              <button className="hub-button-primary w-full" type="button" disabled>
                Solicitar aprobación
              </button>
            </div>
          </SectionCard>
        }
      />
    </div>
  );
}
