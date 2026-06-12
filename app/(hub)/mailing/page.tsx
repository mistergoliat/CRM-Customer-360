import { PageHeader } from "@/components/ui/PageHeader";
import { ModulePreview } from "@/components/ui/ModulePreview";

export default function MailingPage() {
  return (
    <>
      <PageHeader eyebrow="Lifecycle" title="Mailing" description="Preview de campañas y comunicación comercial." status="Preview" />
      <ModulePreview
        title="Mailing"
        icon="mail_lock"
        description="Mailing avanzado, automatizaciones comerciales y campañas quedan planificados para fases posteriores. No hay backend real en fase 1."
        planned={["Listas y consentimientos", "Campañas segmentadas", "Templates comerciales", "Métricas de entregabilidad"]}
      />
    </>
  );
}
