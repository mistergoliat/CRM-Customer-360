import Link from "next/link";
import { StatusChip } from "@/components/ui/StatusChip";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";

type CampaignBuilderViewProps = {
  campaign: {
    id: string;
    name: string;
    objective: string;
    channel: string;
    segment: string;
    status: string;
    schedule: string;
    approval: string;
    utm: string;
    content: string[];
    preview_desktop: string;
    preview_mobile: string;
    suggestions: string[];
    tests: string[];
    governance: string[];
  };
  mode: "new" | "existing";
};

export function CampaignBuilderView({ campaign, mode }: CampaignBuilderViewProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
      <SectionCard title={mode === "new" ? "Nueva campaña" : campaign.name} eyebrow="Campaign builder" description="Editor visual, previsualización y governance.">
        <div className="grid gap-4 md:grid-cols-2">
          <InfoGrid
            items={[
              { label: "Objetivo", value: campaign.objective },
              { label: "Segmento", value: campaign.segment },
              { label: "Canal", value: campaign.channel },
              { label: "Estado", value: campaign.status },
              { label: "Scheduling", value: campaign.schedule },
              { label: "Aprobación", value: campaign.approval },
              { label: "UTM", value: campaign.utm }
            ]}
          />
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Subject</p>
              <p className="mt-2 text-body-md text-slate-700">{campaign.content[0]}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Preheader</p>
              <p className="mt-2 text-body-md text-slate-700">{campaign.content[1]}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">CTA</p>
              <p className="mt-2 text-body-md text-slate-700">{campaign.content[2]}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-label-bold uppercase text-slate-500">Preview desktop</p>
            <p className="mt-2 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-body-md text-slate-700">{campaign.preview_desktop}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-label-bold uppercase text-slate-500">Preview mobile</p>
            <p className="mt-2 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-body-md text-slate-700">{campaign.preview_mobile}</p>
          </div>
        </div>
      </SectionCard>

      <div className="space-y-5">
        <SectionCard title="Sugiere AI" eyebrow="AI" description="Sugerencias visibles, sin generación real.">
          <div className="flex flex-wrap gap-2">
            {campaign.suggestions.map((item) => <StatusChip key={item} label={item} tone="blue" />)}
          </div>
          <div className="mt-4 space-y-2">
            {campaign.tests.map((item) => (
              <p key={item} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-body-md text-slate-700">
                {item}
              </p>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Governance" eyebrow="Approval" description="Controles bloqueados hasta tener backend real.">
          <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
            {campaign.governance.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <div className="mt-4 grid gap-2">
            <button className="hub-button-primary" type="button" disabled>
              Guardar draft
            </button>
            <button className="hub-button-secondary" type="button" disabled>
              Solicitar aprobación
            </button>
            <button className="hub-button-secondary" type="button" disabled>
              Programar
            </button>
            <Link href="/marketing/segments" className="hub-button-ghost">
              Ver segmento
            </Link>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
