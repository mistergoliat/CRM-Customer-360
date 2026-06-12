import { getSystemHealth } from "@/lib/system";
import { PageHeader } from "@/components/ui/PageHeader";
import { HealthStatusCard } from "@/components/ui/HealthStatusCard";

export default async function SystemPage() {
  const health = await getSystemHealth();
  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Salud del sistema"
        description="Chequeos básicos para continuidad operacional. Meta se valida por configuración local; n8n es monitoreado sin ser dependencia crítica."
        status="Activo"
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {health.items.map((item) => (
          <HealthStatusCard key={item.key} title={item.title} status={item.status} description={item.description} details={item.details} />
        ))}
      </div>
      <p className="mt-4 text-label-sm text-slate-500">Generado: {health.generatedAt}</p>
    </>
  );
}
