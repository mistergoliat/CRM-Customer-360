import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { getMarketingTemplatesViewModel } from "@/lib/p1m/read-models";

export default function MarketingTemplatesPage() {
  const data = getMarketingTemplatesViewModel();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Crecimiento"
        title="Plantillas"
        description="Biblioteca visual de plantillas por canal, categoría y performance."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <SectionCard title="Biblioteca de plantillas" eyebrow="Templates" description="Cards visuales con miniatura, canal y rendimiento.">
        <div className="flex flex-wrap gap-2">
          <StatusChip label="Email" tone="blue" />
          <StatusChip label="WhatsApp" tone="green" />
          <StatusChip label="Promoción" tone="gray" />
          <StatusChip label="Recuperación" tone="amber" />
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {data.cards.map((template) => (
            <div key={template.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="h-16 w-20 rounded-2xl bg-gradient-to-br from-primary-fixed via-white to-slate-100" />
                <StatusChip label={template.channel} tone="blue" />
              </div>
              <p className="mt-4 text-headline-md text-on-surface">{template.name}</p>
              <p className="mt-1 text-label-sm text-slate-500">{template.category}</p>
              <p className="mt-3 text-body-md text-slate-700">{template.preview}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <StatusChip label={template.usage} tone="green" />
                <StatusChip label={template.performance} tone="amber" />
                <StatusChip label={`Actualizado ${template.updated}`} tone="gray" />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Preview" eyebrow="Selected" description="Vista lateral de la plantilla seleccionada.">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-label-bold uppercase text-slate-500">Miniatura</p>
            <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="h-44 rounded-2xl bg-gradient-to-br from-primary-fixed via-white to-slate-50" />
              <p className="mt-4 text-headline-md text-on-surface">{data.cards[0].name}</p>
              <p className="mt-2 text-body-md text-slate-700">{data.cards[0].preview}</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Canal</p>
              <p className="mt-2 text-body-md text-slate-700">{data.cards[0].channel}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Uso</p>
              <p className="mt-2 text-body-md text-slate-700">{data.cards[0].usage}</p>
            </div>
            <button className="hub-button-primary" type="button" disabled>
              Crear template
            </button>
            <button className="hub-button-secondary" type="button" disabled>
              Abrir preview
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
