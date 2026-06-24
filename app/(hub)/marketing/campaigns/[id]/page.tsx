import { PageHeader } from "@/components/ui/PageHeader";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { CampaignBuilderView } from "@/components/marketing/CampaignBuilderView";
import { getMarketingCampaignViewModel } from "@/lib/p1m/read-models";

type CampaignDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function CampaignDetailPage({ params }: CampaignDetailProps) {
  const { id } = await params;
  const campaign = getMarketingCampaignViewModel(id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Crecimiento"
        title={campaign.name}
        description="Builder visual de campaña existente. Sigue siendo preview-only."
        status="Preview"
        actions={<SurfaceBadge kind="fixture" />}
      />
      <CampaignBuilderView campaign={campaign} mode="existing" />
    </div>
  );
}
