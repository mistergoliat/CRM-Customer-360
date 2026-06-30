import { PageHeader } from "@/components/ui/PageHeader";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { MarketingCopilotWorkspace } from "@/components/marketing/MarketingCopilotWorkspace";
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

      <MarketingCopilotWorkspace data={data} />
    </div>
  );
}
