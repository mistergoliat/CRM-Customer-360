import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerById } from "@/lib/domains/customers";
import { platformOriginLabel } from "@/lib/domains/customers/platform-origin";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { CustomerCreateForm } from "@/components/customers/CustomerCreateForm";

type CustomerDetailProps = {
  params: Promise<{ id: string }>;
};

function surfaceKindForMode(mode: string) {
  if (mode === "real") return "real" as const;
  if (mode === "partial") return "preview" as const;
  return "notAvailable" as const;
}

export default async function CustomerDetailPage({ params }: CustomerDetailProps) {
  const { id } = await params;
  const result = await getCustomerById(id);
  if (!result) notFound();
  const badgeKind = surfaceKindForMode(result.meta.mode);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
        title={`Cliente #${result.customer?.id ?? id}`}
        description="Perfil real con identidad, relaciones y secciones no respaldadas por backend."
        status={result.meta.mode}
        actions={<SurfaceBadge kind={badgeKind} />}
      />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_360px]">
        <SectionCard title="Identidad canónica" eyebrow="master_customer" description={result.customer ? `${result.customer.firstname} ${result.customer.lastname}` : "No disponible"}>
          {result.customer ? (
            <div className="space-y-4">
              <InfoGrid
                items={[
                  { label: "ID", value: result.customer.id },
                  { label: "Firstname", value: result.customer.firstname },
                  { label: "Lastname", value: result.customer.lastname },
                  { label: "Email", value: result.customer.email },
                  { label: "Plataforma de origen", value: platformOriginLabel(result.customer.platformOrigin) },
                  { label: "Identity", value: result.identity.state },
                  { label: "Source", value: result.identity.source }
                ]}
                columns={3}
              />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-label-bold uppercase text-slate-500">Observations</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {result.identity.observations.length > 0 ? result.identity.observations.map((observation) => (
                    <StatusChip key={`${observation.source}-${observation.matchedBy}-${observation.identityValue}`} label={`${observation.source}:${observation.matchedBy}`} tone="blue" />
                  )) : <StatusChip label="sin observaciones" tone="gray" />}
                </div>
              </div>
            </div>
          ) : null}
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Warnings" eyebrow="Quality" description="Visibilidad explícita de gaps y fallback.">
            <div className="space-y-2">
              {(result.warnings.length > 0 ? result.warnings : ["sin warnings"]).map((warning) => (
                <StatusChip key={warning} label={warning} tone={warning === "sin warnings" ? "green" : "amber"} />
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Crear cliente" eyebrow="Write path" description="La misma interfaz de alta se reutiliza aquí.">
            <CustomerCreateForm redirectTo="/customers/:id" />
          </SectionCard>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Conversaciones relacionadas" eyebrow="Legacy" description={result.relatedConversations.source}>
          <div className="space-y-2">
            {result.relatedConversations.items.length > 0 ? result.relatedConversations.items.map((item) => (
              <Link key={item.id} href={item.href} className="block rounded-xl border border-slate-200 bg-slate-50 p-3 hover:border-primary">
                <p className="font-semibold text-on-surface">{item.label}</p>
                <p className="text-label-sm text-slate-500">{item.meta}</p>
              </Link>
            )) : <p className="text-body-md text-slate-600">No disponibles</p>}
          </div>
        </SectionCard>

        <SectionCard title="Casos relacionados" eyebrow="Legacy" description={result.relatedCases.source}>
          <div className="space-y-2">
            {result.relatedCases.items.length > 0 ? result.relatedCases.items.map((item) => (
              <Link key={item.id} href={item.href} className="block rounded-xl border border-slate-200 bg-slate-50 p-3 hover:border-primary">
                <p className="font-semibold text-on-surface">{item.label}</p>
                <p className="text-label-sm text-slate-500">{item.meta}</p>
              </Link>
            )) : <p className="text-body-md text-slate-600">No disponibles</p>}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Fuentes vinculadas" eyebrow="Identity" description={result.linkedSources.source}>
          <div className="space-y-2">
            {result.linkedSources.items.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-body-md text-slate-700">{item.label}</span>
                <span className="text-body-md font-semibold text-on-surface">{item.value}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Secciones no respaldadas" eyebrow="No disponible" description="LTV, scoring, segmento, notas y campañas no tienen backend operativo aun.">
          <div className="space-y-3">
            {Object.entries(result.sections).map(([key, section]) => (
              <div key={key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-label-bold uppercase text-slate-500">{key}</p>
                  <StatusChip label={section.state} tone={section.state === "real" ? "green" : section.state === "partial" ? "amber" : "gray"} />
                </div>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <div key={item.label} className="flex items-center justify-between text-body-md">
                      <span className="text-slate-600">{item.label}</span>
                      <span className="font-semibold text-on-surface">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
