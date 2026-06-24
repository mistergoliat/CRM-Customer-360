import { PageHeader } from "@/components/ui/PageHeader";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { CampaignBuilderView } from "@/components/marketing/CampaignBuilderView";
import { getMarketingCampaignViewModel } from "@/lib/p1m/read-models";

export default function NewCampaignPage() {
  const campaign = getMarketingCampaignViewModel("new");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Crecimiento"
        title="Nueva campaña"
        description="Editor de campaña visual con preview, sugerencias y governance."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />
      <CampaignBuilderView campaign={campaign} mode="new" />
    </div>
  );
}
