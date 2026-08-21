import { MarketingCopilotWorkspace } from "@/components/marketing/MarketingCopilotWorkspace";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { getMarketingCopilotViewModel } from "@/lib/p1m/read-models";

export default function MarketingCopilotPage() {
  const data = getMarketingCopilotViewModel();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Crecimiento"
        title="Marketing Copilot"
        description="Workspace conversacional interno sobre Customer Intelligence con sesiones, provenance y export XLSX."
        status="Interno"
        actions={<SurfaceBadge kind="readOnly" />}
      />

      <MarketingCopilotWorkspace data={data} />
    </div>
  );
}
