import { CustomerIntelligenceDashboardWorkspace } from "@/components/marketing/CustomerIntelligenceDashboardWorkspace";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { getMarketingCopilotViewModel } from "@/lib/p1m/read-models";

export default function CustomerIntelligencePage() {
  const copilotData = getMarketingCopilotViewModel();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Crecimiento"
        title="Customer Intelligence"
        description="Dashboard read-only de segmentos RFM, clusters e intersecciones activas sobre Customer Profile."
        status="Interno"
        actions={<SurfaceBadge kind="readOnly" />}
      />

      <CustomerIntelligenceDashboardWorkspace copilotData={copilotData} />
    </div>
  );
}
