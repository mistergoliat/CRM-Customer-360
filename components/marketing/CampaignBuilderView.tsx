import Link from "next/link";
import { StatusChip } from "@/components/ui/StatusChip";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { Icon } from "@/components/ui/Icon";

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
    owner?: string;
    reach?: string;
    opens?: string;
    clicks?: string;
    conversion?: string;
    subject?: string;
    preheader?: string;
    cta?: string;
    variants?: { label: string; content: string }[];
    blocks?: string[];
  };
  mode: "new" | "existing";
};

const blockLibrary = ["Texto", "Imagen", "Botón", "Separador", "Footer", "Variable", "Producto", "Test A/B"];

export function CampaignBuilderView({ campaign, mode }: CampaignBuilderViewProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_360px]">
      <SectionCard title={mode === "new" ? "Nueva campaña" : campaign.name} eyebrow="Campaign builder" description="Editor visual, previsualización y governance." actions={<StatusChip label="Writer disabled" tone="amber" />}>
        <div className="space-y-5">
          <InfoGrid
            items={[
              { label: "Objetivo", value: campaign.objective },
              { label: "Segmento", value: campaign.segment },
              { label: "Canal", value: campaign.channel },
              { label: "Estado", value: campaign.status },
              { label: "Programación", value: campaign.schedule },
              { label: "Aprobación", value: campaign.approval },
              { label: "UTM", value: campaign.utm }
            ]}
            columns={3}
          />

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-label-bold uppercase text-slate-500">Toolbar</p>
                <p className="text-body-md text-slate-600">Bloques disponibles para armar la pieza.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusChip label="Desktop" tone="blue" />
                <StatusChip label="Mobile" tone="gray" />
                <StatusChip label="Preview only" tone="amber" />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {blockLibrary.map((block, index) => (
                <span key={block} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-md font-semibold text-slate-700">
                  <Icon name={index % 2 === 0 ? "add" : "drag_indicator"} className="text-slate-500" />
                  {block}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-label-bold uppercase text-slate-500">Canvas</p>
                  <h3 className="mt-1 text-headline-md text-on-surface">{campaign.subject ?? campaign.content[0]}</h3>
                  <p className="mt-1 text-body-md text-slate-500">{campaign.preheader ?? campaign.content[1]}</p>
                </div>
                <StatusChip label={campaign.cta ?? campaign.content[2]} tone="blue" />
              </div>

              <div className="mt-4 space-y-3">
                {(campaign.blocks ?? campaign.content).map((block, index) => (
                  <div key={block} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-primary-fixed text-primary font-bold">{index + 1}</div>
                    <div>
                      <p className="text-label-bold uppercase text-slate-500">{index === 0 ? "Hero" : index === 1 ? "Support" : index === 2 ? "CTA" : "Bloque"}</p>
                      <p className="mt-1 text-body-md text-slate-700">{block}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-label-bold uppercase text-slate-500">Preview</p>
              <div className="mt-4 space-y-4">
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-label-bold uppercase text-slate-500">Desktop</p>
                    <StatusChip label="1280 px" tone="green" />
                  </div>
                  <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-body-md text-slate-700">{campaign.preview_desktop}</p>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-label-bold uppercase text-slate-500">Mobile</p>
                    <StatusChip label="390 px" tone="blue" />
                  </div>
                  <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-body-md text-slate-700">{campaign.preview_mobile}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Variantes A/B</p>
              <div className="mt-3 space-y-2">
                {(campaign.variants ?? []).map((variant) => (
                  <div key={variant.label} className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-label-bold uppercase text-slate-500">Versión {variant.label}</p>
                    <p className="mt-1 text-body-md text-slate-700">{variant.content}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Test</p>
              <div className="mt-3 space-y-2">
                {campaign.tests.map((item) => (
                  <p key={item} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-md text-slate-700">
                    {item}
                  </p>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Métricas</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-label-sm text-slate-500">Alcance</p>
                  <p className="mt-1 text-headline-md text-on-surface">{campaign.reach ?? "—"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-label-sm text-slate-500">Open</p>
                  <p className="mt-1 text-headline-md text-on-surface">{campaign.opens ?? "—"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-label-sm text-slate-500">CTR</p>
                  <p className="mt-1 text-headline-md text-on-surface">{campaign.clicks ?? "—"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-label-sm text-slate-500">Conv.</p>
                  <p className="mt-1 text-headline-md text-on-surface">{campaign.conversion ?? "—"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="space-y-5">
        <SectionCard title="AI panel" eyebrow="Assistant" description="Sugerencias visuales para edición del copy.">
          <div className="space-y-3">
            {campaign.suggestions.map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-body-md text-slate-700">{item}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-label-bold uppercase text-slate-500">Última edición</p>
            <p className="mt-2 text-body-md text-slate-700">{campaign.subject ?? campaign.name}</p>
          </div>
        </SectionCard>

        <SectionCard title="Governance" eyebrow="Approval" description="Controles bloqueados hasta tener backend real.">
          <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
            {campaign.governance.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <div className="mt-4 grid gap-2">
            <button className="hub-button-primary" type="button" disabled>
              Guardar borrador
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
