import { AudienceWorkspace } from "@/components/audiences/AudienceWorkspace";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { PageHeader } from "@/components/ui/PageHeader";

export default function AudiencesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inteligencia"
        title="Audiencias"
        description="Construye, evalua y exporta audiencias contra Customer Profile. El CRM orquesta la UI; Customer Profile sigue siendo la autoridad analitica."
        actions={<SurfaceBadge kind="real" />}
      />
      <AudienceWorkspace />
    </div>
  );
}
